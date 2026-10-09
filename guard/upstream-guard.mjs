/**
 * 上游配额守护：优先免费池，撞限流自动切到渠道网关，免费池恢复了再切回来。
 *
 * 为什么需要它（读插件源码得出的事实）：
 *   · 免费池（18899，opencode.ai/zen）的配额是**按会话**算的，不是按模型。
 *     sessionForConversation() 只从 sessionId 派生上游会话 id，换模型换不掉限流。
 *   · 那条车道的 429 带**递增的 retry-after**，插件自己的注释说重试会把
 *     "同一轮付费三次、还来得更晚"。所以撞墙后该做的是换上游，不是重试。
 *   · 换上游才换配额池：18899 与 8326 是两套完全独立的额度。
 *
 * 策略：
 *   1. 默认驻留在免费池。
 *   2. 探测到免费池不可用（429/5xx/超时）→ 切到渠道网关备用端点，并在 QQ 里说一声。
 *   3. 之后按 backoff 周期探测免费池；一旦恢复 → 切回免费池。
 *   4. 渠道网关有积分成本，所以设了每日切换次数上限与最短驻留时间。
 *
 * 只做"探测 + 切 activeProvider"，不代理请求：不额外消耗 token。
 */
import fs from 'node:fs';
import path from 'node:path';

// ---------- 配置 ----------
// 本脚本所在目录（放 upstream-guard.json / 状态文件），以及仓库根、cortico-qq。
const GUARD_DIR = import.meta.dirname;
const REPO_ROOT = path.resolve(GUARD_DIR, '..');
const CORTICO = process.env.CORTICO_ROOT ?? path.join(REPO_ROOT, '..', 'cortico-qq');
const CFG_PATH = process.env.GUARD_CONFIG ?? path.join(GUARD_DIR, 'upstream-guard.json');

const DEFAULTS = {
  /** Cortico 控制台地址。 */
  corticoUrl: 'http://127.0.0.1:7788',
  /** 首选端点（免费池）。 */
  primary: 'DSH_free_mimo-v26-flash',
  /** 备用端点（渠道网关，有积分成本）。 */
  fallback: 'DSH_free_deepseek-v41-flash',
  /** 主池探测间隔（秒）。 */
  probeIntervalSec: 60,
  /** 主池连续失败几次才切换。1 = 一次失败就切。 */
  failuresToSwitch: 2,
  /** 探测请求超时（毫秒）。 */
  probeTimeoutMs: 20000,
  /** 一次探测最多花多少输出 token。 */
  probeMaxTokens: 8,
  /** 切到备用后，最短驻留多久才允许切回（分钟）——避免来回抖。 */
  minFallbackStayMinutes: 5,
  /** 每日最多切到备用几次（保护渠道网关积分）。 */
  maxFallbackSwitchesPerDay: 12,
  /** 通过 OneBot HTTP 往 QQ 发通知。留空则不发。 */
  notify: {
    enabled: true,
    httpUrl: 'http://127.0.0.1:3005',
    accessToken: process.env.ONEBOT_TOKEN ?? '',
    /** 通知发给谁（私聊 QQ 号）。 */
    toUser: process.env.NOTIFY_QQ ?? '',
  },
  /** 状态文件（记录当日切换次数）。 */
  statePath: process.env.GUARD_STATE ?? path.join(GUARD_DIR, 'upstream-guard-state.json'),
};

function loadConfig() {
  if (!fs.existsSync(CFG_PATH)) {
    fs.writeFileSync(CFG_PATH, JSON.stringify(DEFAULTS, null, 2) + '\n', 'utf8');
    console.log(`[guard] 已生成默认配置 ${CFG_PATH}`);
    return { ...DEFAULTS };
  }
  const raw = JSON.parse(fs.readFileSync(CFG_PATH, 'utf8'));
  return { ...DEFAULTS, ...raw, notify: { ...DEFAULTS.notify, ...(raw.notify ?? {}) } };
}

const cfg = loadConfig();

// ---------- 状态 ----------
function loadState() {
  try {
    if (fs.existsSync(cfg.statePath)) return JSON.parse(fs.readFileSync(cfg.statePath, 'utf8'));
  } catch {}
  return { day: today(), fallbackSwitches: 0, current: null, consecutiveFailures: 0, switchedToFallbackAt: 0 };
}
function saveState(s) {
  try { fs.writeFileSync(cfg.statePath, JSON.stringify(s, null, 2) + '\n', 'utf8'); } catch {}
}
function today() {
  return new Date().toISOString().slice(0, 10);
}
function log(msg) {
  console.log(`[${new Date().toLocaleTimeString('zh-CN', { hour12: false })}] ${msg}`);
}

// ---------- Cortico API ----------
async function getActive() {
  const res = await fetch(`${cfg.corticoUrl}/api/providers`, { signal: AbortSignal.timeout(8000) });
  if (!res.ok) throw new Error(`GET /api/providers ${res.status}`);
  const j = await res.json();
  return j.active;
}

async function activate(name) {
  const res = await fetch(`${cfg.corticoUrl}/api/providers/${encodeURIComponent(name)}/activate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    signal: AbortSignal.timeout(15000),
  });
  const body = await res.text();
  if (!res.ok) throw new Error(`activate ${name} → ${res.status} ${body.slice(0, 120)}`);
  return true;
}

/** 读某个端点的 baseUrl / model，用来直接探测上游。 */
async function readEndpoint(name) {
  const res = await fetch(`${cfg.corticoUrl}/api/providers/${encodeURIComponent(name)}`, { signal: AbortSignal.timeout(8000) });
  if (!res.ok) return null;
  const j = await res.json();
  return { baseUrl: j.entry?.baseUrl, model: j.entry?.spec?.model, secret: j.entry?.secret };
}

/** 从端点目录读密钥（控制台不回传明文）。 */
function readSecret(secretName) {
  if (!secretName) return '';
  // 先看进程环境
  if (process.env[secretName]) return process.env[secretName];
  // 再看 providers 目录下各端点的 .env
  const dir = path.join(CORTICO, 'deployments', 'providers');
  try {
    for (const d of fs.readdirSync(dir)) {
      const f = path.join(dir, d, '.env');
      if (!fs.existsSync(f)) continue;
      const m = new RegExp(`^\\s*${secretName}\\s*=\\s*(\\S+)`, 'm').exec(fs.readFileSync(f, 'utf8'));
      if (m) return m[1];
    }
    // 部署级 .env
    const dep = path.join(CORTICO, 'deployments', process.env.DEPLOY_NAME ?? 'mybot', '.env');
    if (fs.existsSync(dep)) {
      const m = new RegExp(`^\\s*${secretName}\\s*=\\s*(\\S+)`, 'm').exec(fs.readFileSync(dep, 'utf8'));
      if (m) return m[1];
    }
  } catch {}
  return '';
}

/**
 * 探测一个端点是否可用。发一条极小请求，只看状态码。
 * 429 / 5xx / 超时都算不可用。
 */
async function probe(name) {
  const ep = await readEndpoint(name);
  if (!ep?.baseUrl || !ep?.model) return { ok: false, reason: '端点配置不完整' };
  const key = readSecret(ep.secret);
  const t0 = Date.now();
  try {
    const res = await fetch(`${ep.baseUrl.replace(/\/+$/, '')}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(key ? { Authorization: `Bearer ${key}` } : {}),
      },
      body: JSON.stringify({
        model: ep.model,
        messages: [{ role: 'user', content: 'ping' }],
        max_tokens: cfg.probeMaxTokens,
      }),
      signal: AbortSignal.timeout(cfg.probeTimeoutMs),
    });
    const ms = Date.now() - t0;
    if (res.ok) return { ok: true, ms };
    const body = await res.text();
    return { ok: false, reason: `HTTP ${res.status} ${body.slice(0, 100)}`, status: res.status, ms };
  } catch (e) {
    return { ok: false, reason: String(e.message).slice(0, 100) };
  }
}

// ---------- QQ 通知 ----------
async function notify(text) {
  if (!cfg.notify.enabled || !cfg.notify.httpUrl || !cfg.notify.toUser) return;
  try {
    await fetch(`${cfg.notify.httpUrl.replace(/\/+$/, '')}/send_private_msg`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(cfg.notify.accessToken ? { Authorization: `Bearer ${cfg.notify.accessToken}` } : {}),
      },
      body: JSON.stringify({ user_id: cfg.notify.toUser, message: [{ type: 'text', data: { text } }] }),
      signal: AbortSignal.timeout(10000),
    });
    log('已发出 QQ 通知');
  } catch (e) {
    log(`QQ 通知失败: ${String(e.message).slice(0, 80)}`);
  }
}

// ---------- 主循环 ----------
const state = loadState();
if (state.day !== today()) {
  state.day = today();
  state.fallbackSwitches = 0;
}

log('上游配额守护已启动');
log(`  首选(免费池): ${cfg.primary}`);
log(`  备用(渠道网关): ${cfg.fallback}`);
log(`  探测间隔: ${cfg.probeIntervalSec}s · 连续失败 ${cfg.failuresToSwitch} 次切换`);
log(`  每日最多切到备用: ${cfg.maxFallbackSwitchesPerDay} 次`);
log('');

let stopping = false;
process.on('SIGINT', () => { stopping = true; log('收到停止信号'); process.exit(0); });
process.on('SIGTERM', () => { stopping = true; process.exit(0); });

// 启动时对齐一次
try {
  state.current = await getActive();
  log(`当前生效端点: ${state.current}`);
} catch (e) {
  log(`读不到 Cortico 状态: ${String(e.message).slice(0, 80)}（先继续，稍后重试）`);
}

async function tick() {
  if (stopping) return;

  // 跨天重置计数
  const d = today();
  if (state.day !== d) {
    state.day = d;
    state.fallbackSwitches = 0;
    saveState(state);
    log('跨天，已重置切换计数');
  }

  let active;
  try {
    active = await getActive();
  } catch (e) {
    log(`⚠ 连不上 Cortico 控制台: ${String(e.message).slice(0, 80)}`);
    return;
  }
  state.current = active;

  const onPrimary = active === cfg.primary;
  const onFallback = active === cfg.fallback;

  if (onPrimary || !onFallback) {
    // 驻留在主池（或一个非我们管理的端点）：探测主池
    const r = await probe(cfg.primary);
    if (r.ok) {
      state.consecutiveFailures = 0;
      if (!onPrimary) {
        // 之前的判断是错的，其实可用 → 若是我们切的备用，切回来
        log(`主池可用（${r.ms}ms），当前在 ${active}`);
      }
    } else {
      state.consecutiveFailures++;
      log(`主池不可用 [${state.consecutiveFailures}/${cfg.failuresToSwitch}]: ${r.reason}`);
      if (state.consecutiveFailures >= cfg.failuresToSwitch) {
        // 需要切换到备用
        if (state.fallbackSwitches >= cfg.maxFallbackSwitchesPerDay) {
          log(`⚠ 今日切到备用的次数已达上限(${cfg.maxFallbackSwitchesPerDay})，不再切换`);
        } else if (!onFallback) {
          try {
            await activate(cfg.fallback);
            state.fallbackSwitches++;
            state.switchedToFallbackAt = Date.now();
            state.consecutiveFailures = 0;
            saveState(state);
            log(`→ 已切换到备用端点 ${cfg.fallback}（今日第 ${state.fallbackSwitches} 次）`);
            await notify('免费池限流了，我先换到渠道模型上继续～等你这边缓过来我再切回去');
          } catch (e) {
            log(`✗ 切换失败: ${String(e.message).slice(0, 100)}`);
          }
        }
      }
    }
  } else if (onFallback) {
    // 驻留在备用：探测主池是否恢复
    const stayedMin = (Date.now() - state.switchedToFallbackAt) / 60000;
    if (stayedMin < cfg.minFallbackStayMinutes) {
      log(`备用驻留中（${stayedMin.toFixed(1)}/${cfg.minFallbackStayMinutes} 分钟）`);
    } else {
      const r = await probe(cfg.primary);
      if (r.ok) {
        try {
          await activate(cfg.primary);
          state.consecutiveFailures = 0;
          state.switchedToFallbackAt = 0;
          saveState(state);
          log(`← 免费池已恢复（${r.ms}ms），切回 ${cfg.primary}`);
          await notify('免费池缓过来了，我切回免费模型啦');
        } catch (e) {
          log(`✗ 切回失败: ${String(e.message).slice(0, 100)}`);
        }
      } else {
        log(`免费池仍未恢复: ${r.reason}`);
      }
    }
  }

  saveState(state);
}

// 主循环
while (!stopping) {
  try {
    await tick();
  } catch (e) {
    log(`tick 异常: ${String(e.message).slice(0, 120)}`);
  }
  await new Promise((r) => setTimeout(r, cfg.probeIntervalSec * 1000));
}
