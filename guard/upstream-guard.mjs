/**
 * Free-lane failover for Cortico, driven by real generation failures.
 *
 * Do not run synthetic inference probes here: they consume the same free-lane
 * request/session budget as normal traffic. The DSH plugin already maintains
 * its own catalog/availability probes. This guard watches Cortico's run logs,
 * switches across configured free-lane endpoints after a final LLM failure,
 * and uses the paid endpoint only after the free candidates are unavailable.
 */
import fs from 'node:fs';
import path from 'node:path';
import { syncAuxiliaryModels as syncAuxiliaryConfig } from './auxiliary-models.mjs';
import {routingMode,assertAutoRouting} from './routing-mode.mjs';

const GUARD_DIR = import.meta.dirname;
const REPO_ROOT = path.resolve(GUARD_DIR, '..');
const selectionFile = path.join(REPO_ROOT, 'runtime-selection.json');
const selectedRoot = !process.env.CORTICO_ROOT && fs.existsSync(selectionFile) ? JSON.parse(fs.readFileSync(selectionFile, 'utf8')).corticoRoot : null;
if (selectedRoot !== null && (typeof selectedRoot !== 'string' || !path.isAbsolute(selectedRoot) || !fs.existsSync(path.join(selectedRoot, 'package.json')))) {
  throw new Error('Cortico 运行目录选择文件无效，请恢复 runtime-selection.json 或使用回退脚本。');
}
const CORTICO = process.env.CORTICO_ROOT ?? selectedRoot ?? path.join(REPO_ROOT, '..', 'cortico-qq');
const CFG_PATH = process.env.GUARD_CONFIG ?? path.join(GUARD_DIR, 'upstream-guard.json');
const RUNS_DIR = path.join(CORTICO, 'deployments', process.env.DEPLOY_NAME ?? 'mybot', 'data', 'runs');

const DEFAULTS = {
  corticoUrl: 'http://127.0.0.1:7788',
  freeProviders: [
    { name: 'DSH_free_dots-3-note', lane: 'kilo', sideModel: 'dots-studio/dots-3-note-preview:free' },
    {
      name: 'DSH_free_zen-mimo-v26-flash',
      lane: 'zen',
      model: 'mimo-v2.6-flash-free',
      sideModel: 'mimo-v2.6-flash-free',
      copyFrom: 'DSH_free_dots-3-note',
    },
  ],
  paidFallback: 'DSH_free_deepseek-v41-flash',
  /** Create a missing lane endpoint by copying the configured source endpoint. */
  provisionMissingFreeProviders: true,
  /** Consecutive failed turns before switching on transient 5xx/network errors. */
  failuresToSwitch: 2,
  /** Keep a failed lane out of rotation for this long when upstream gives no retry hint. */
  rateLimitCooldownMinutes: 30,
  transientCooldownMinutes: 5,
  hardFailureCooldownMinutes: 360,
  /** Once a higher-priority lane's cooldown expires, restore it without a synthetic request. */
  recoverFreeLaneAfterMinutes: 30,
  maxPaidSwitchesPerDay: 12,
  logPollIntervalMs: 1500,
  notify: {
    enabled: true,
    httpUrl: 'http://127.0.0.1:3005',
    accessToken: process.env.ONEBOT_TOKEN ?? '',
    toUser: process.env.NOTIFY_QQ ?? '',
  },
  statePath: process.env.GUARD_STATE ?? path.join(GUARD_DIR, 'upstream-guard-state.json'),
};

function loadConfig() {
  if (!fs.existsSync(CFG_PATH)) {
    fs.writeFileSync(CFG_PATH, JSON.stringify(DEFAULTS, null, 2) + '\n', 'utf8');
    console.log(`[guard] 已生成默认配置 ${CFG_PATH}`);
    return structuredClone(DEFAULTS);
  }
  const raw = JSON.parse(fs.readFileSync(CFG_PATH, 'utf8'));
  // Migrate the former primary/fallback config without requiring a manual edit.
  const freeProviders = Array.isArray(raw.freeProviders) && raw.freeProviders.length
    ? raw.freeProviders
    : [
        { ...DEFAULTS.freeProviders[0], name: raw.primary ?? DEFAULTS.freeProviders[0].name },
        {
          ...DEFAULTS.freeProviders[1],
          copyFrom: raw.primary ?? DEFAULTS.freeProviders[0].name,
        },
      ];
  return {
    ...DEFAULTS,
    ...raw,
    freeProviders,
    paidFallback: raw.paidFallback ?? raw.fallback ?? DEFAULTS.paidFallback,
    notify: { ...DEFAULTS.notify, ...(raw.notify ?? {}) },
  };
}

const cfg = loadConfig();
const state = loadState();
const cursors = new Map();
let stopping = false;
let nextAuxiliarySyncAt = 0;
let auxiliaryProvider = null;

function loadState() {
  try {
    if (fs.existsSync(cfg?.statePath ?? path.join(GUARD_DIR, 'upstream-guard-state.json')))
      return JSON.parse(fs.readFileSync(cfg?.statePath ?? path.join(GUARD_DIR, 'upstream-guard-state.json'), 'utf8'));
  } catch {}
  return {};
}

function saveState() {
  try { fs.writeFileSync(cfg.statePath, JSON.stringify(state, null, 2) + '\n', 'utf8'); } catch (e) {
    log(`状态写入失败: ${String(e.message).slice(0, 100)}`);
  }
}

function log(message) {
  console.log(`[${new Date().toLocaleTimeString('zh-CN', { hour12: false })}] ${message}`);
}

function todayShanghai() {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date());
  const get = (type) => parts.find((part) => part.type === type)?.value ?? '00';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

async function api(pathname, options = {}) {
  assertAutoRouting(options.method??'GET');
  const { timeoutMs = 10000, ...init } = options;
  return fetch(`${cfg.corticoUrl.replace(/\/+$/, '')}${pathname}`, {
    ...init,
    signal: AbortSignal.timeout(timeoutMs),
  });
}

async function getActive() {
  const res = await api('/api/providers');
  if (!res.ok) throw new Error(`GET providers HTTP ${res.status}`);
  return (await res.json()).active;
}

async function getProvider(name) {
  const res = await api(`/api/providers/${encodeURIComponent(name)}`);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`GET provider ${name} HTTP ${res.status}`);
  return res.json();
}

async function activate(name) {
  const res = await api(`/api/providers/${encodeURIComponent(name)}/activate`, { method: 'POST' });
  const body = await res.text();
  if (!res.ok) throw new Error(`activate ${name} HTTP ${res.status}: ${body.slice(0, 120)}`);
}

/** Keep the QQ/gaming side-calls on the same currently selected free lane. */
async function syncAuxiliaryModels(model) {
  await syncAuxiliaryConfig(api, model, log);
}

async function reconcileAuxiliaryModels(active) {
  const provider = cfg.freeProviders.find((item) => item.name === active);
  if (!provider?.sideModel) return;
  if (auxiliaryProvider === active && Date.now() < nextAuxiliarySyncAt) return;
  auxiliaryProvider = active;
  nextAuxiliarySyncAt = Date.now() + 60_000;
  try { await syncAuxiliaryModels(provider.sideModel); }
  catch (e) { log(`侧调用同步失败，60 秒后重试: ${String(e.message).slice(0, 220)}`); }
}

async function activateFreeProvider(provider) {
  await activate(provider.name);
  if (provider.sideModel) {
    try { await syncAuxiliaryModels(provider.sideModel); }
    catch (e) { log(`主端点已切换，但侧调用同步失败: ${String(e.message).slice(0, 100)}`); }
  }
}

async function provisionFreeProviders() {
  if (!cfg.provisionMissingFreeProviders) return;
  for (const candidate of cfg.freeProviders) {
    if (!candidate.model || !candidate.copyFrom) continue;
    const exists = await getProvider(candidate.name);
    if (exists) continue;
    const source = await getProvider(candidate.copyFrom);
    if (!source?.entry?.spec) {
      log(`未创建 ${candidate.name}：复制源 ${candidate.copyFrom} 不存在或未选模型`);
      continue;
    }
    const entry = structuredClone(source.entry);
    entry.spec.model = candidate.model;
    const res = await api('/api/providers', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: candidate.name,
        entry,
        copyFrom: { name: candidate.copyFrom, revision: source.revision },
      }),
    });
    const body = await res.text();
    if (!res.ok) {
      log(`创建免费车道 ${candidate.name} 失败 HTTP ${res.status}: ${body.slice(0, 160)}`);
      continue;
    }
    log(`已创建免费车道端点 ${candidate.name} (${candidate.lane}: ${candidate.model})`);
  }
}

async function notify(message) {
  if (!cfg.notify.enabled || !cfg.notify.httpUrl || !cfg.notify.toUser) return;
  try {
    await fetch(`${cfg.notify.httpUrl.replace(/\/+$/, '')}/send_private_msg`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(cfg.notify.accessToken ? { Authorization: `Bearer ${cfg.notify.accessToken}` } : {}),
      },
      body: JSON.stringify({ user_id: cfg.notify.toUser, message: [{ type: 'text', data: { text: message } }] }),
      signal: AbortSignal.timeout(10000),
    });
  } catch (e) { log(`QQ 通知失败: ${String(e.message).slice(0, 80)}`); }
}

function laneStates() {
  if (!state.lanes || typeof state.lanes !== 'object') state.lanes = {};
  return state.lanes;
}

function cooldownFor(status) {
  if (status === 429) return cfg.rateLimitCooldownMinutes * 60_000;
  if (status === 401 || status === 403 || status === 404 || (status >= 400 && status < 500))
    return cfg.hardFailureCooldownMinutes * 60_000;
  return cfg.transientCooldownMinutes * 60_000;
}

function failureThreshold(status) {
  return status === 429 || (status >= 400 && status < 500) ? 1 : cfg.failuresToSwitch;
}

async function switchAfterFailure(status) {
  let active;
  try { active = await getActive(); }
  catch (e) { log(`读取当前端点失败: ${String(e.message).slice(0, 100)}`); return; }
  state.current = active;
  const lanes = laneStates();
  const current = cfg.freeProviders.find((provider) => provider.name === active);
  if (!current) {
    state.unmanagedFailures = (state.unmanagedFailures ?? 0) + 1;
    state.lastUnmanagedFailure = { provider: active, status, at: Date.now() };
    saveState();
    log(`当前端点 ${active} 未列入 freeProviders，已记录失败但不自动切换；请检查守护配置。`);
    return;
  }

  const failure = lanes[active] ??= { count: 0, blockedUntil: 0 };
  failure.count++;
  failure.lastStatus = status;
  if (failure.count < failureThreshold(status)) {
    log(`${current.lane} 端点失败 ${failure.count}/${failureThreshold(status)} (HTTP ${status || 'network'})`);
    saveState();
    return;
  }
  failure.count = 0;
  failure.blockedUntil = Date.now() + cooldownFor(status);

  const now = Date.now();
  const currentIndex = cfg.freeProviders.findIndex((provider) => provider.name === active);
  const nextFreeCandidates = [
    ...cfg.freeProviders.slice(currentIndex + 1),
    ...cfg.freeProviders.slice(0, currentIndex),
  ].filter((provider) => {
    const laneState = lanes[provider.name];
    return !laneState || (laneState.blockedUntil ?? 0) <= now;
  });
  for (const nextFree of nextFreeCandidates) {
    try {
      await activateFreeProvider(nextFree);
      state.current = nextFree.name;
      state.managedCurrent = nextFree.name;
      state.switchedAt = now;
      saveState();
      const message = `免费模型车道 ${current.lane} 遇到 HTTP ${status || '网络错误'}，已切到 ${nextFree.lane}。`;
      log(message);
      await notify(message);
      return;
    } catch (e) {
      const failed = lanes[nextFree.name] ??= { count: 0, blockedUntil: 0 };
      failed.blockedUntil = now + cfg.hardFailureCooldownMinutes * 60_000;
      log(`切换免费车道 ${nextFree.name} 失败: ${String(e.message).slice(0, 120)}`);
    }
  }

  if ((state.paidSwitches ?? 0) >= cfg.maxPaidSwitchesPerDay) {
    log(`免费车道均不可用；今日付费备用切换已达上限 ${cfg.maxPaidSwitchesPerDay}`);
    saveState();
    return;
  }
  try {
    await activate(cfg.paidFallback);
    state.current = cfg.paidFallback;
    state.managedCurrent = cfg.paidFallback;
    state.switchedAt = now;
    state.paidSwitches = (state.paidSwitches ?? 0) + 1;
    saveState();
    const message = `免费车道均遇到故障，已切到付费备用 ${cfg.paidFallback}（今日第 ${state.paidSwitches} 次）。`;
    log(message);
    await notify(message);
  } catch (e) { log(`切换付费备用失败: ${String(e.message).slice(0, 120)}`); }
}

function errorStatus(record) {
  const status = Number(record?.data?.status ?? record?.err?.status ?? 0);
  return Number.isFinite(status) ? status : 0;
}

async function handleLogLine(line) {
  let entry;
  try { entry = JSON.parse(line); } catch { return; }
  const record = entry.record ?? entry;
  // The core logs a final event after its own retries. Ignore intermediate
  // retries so the guard does not race Cortico's built-in retry policy.
  if (record?.area !== 'core.loop' || record?.msg !== 'LLM调用失败,本轮自然结束') return;
  const status = errorStatus(record);
  if (status === 429 || status === 0 || status >= 500 || (status >= 400 && status < 500))
    await switchAfterFailure(status);
}

function seedLogCursors() {
  if (!fs.existsSync(RUNS_DIR)) return;
  for (const run of fs.readdirSync(RUNS_DIR, { withFileTypes: true })) {
    if (!run.isDirectory()) continue;
    const file = path.join(RUNS_DIR, run.name, 'log.jsonl');
    try { cursors.set(file, { offset: fs.statSync(file).size, carry: '' }); } catch {}
  }
}

async function pollRunLogs() {
  if (!fs.existsSync(RUNS_DIR)) return;
  for (const run of fs.readdirSync(RUNS_DIR, { withFileTypes: true })) {
    if (!run.isDirectory()) continue;
    const file = path.join(RUNS_DIR, run.name, 'log.jsonl');
    let stat;
    try { stat = fs.statSync(file); } catch { continue; }
    let cursor = cursors.get(file);
    if (!cursor) {
      cursor = { offset: 0, carry: '' };
      cursors.set(file, cursor);
    }
    if (stat.size < cursor.offset) { cursor.offset = 0; cursor.carry = ''; }
    if (stat.size === cursor.offset) continue;
    const length = stat.size - cursor.offset;
    const buffer = Buffer.allocUnsafe(length);
    const fd = fs.openSync(file, 'r');
    try { fs.readSync(fd, buffer, 0, length, cursor.offset); }
    finally { fs.closeSync(fd); }
    cursor.offset = stat.size;
    const lines = (cursor.carry + buffer.toString('utf8')).split(/\r?\n/);
    cursor.carry = lines.pop() ?? '';
    for (const line of lines) if (line.trim()) await handleLogLine(line);
  }
}

async function recoverHigherPriorityLane() {
  const active = state.current;
  if (state.managedCurrent !== active) return;
  const foundIndex = cfg.freeProviders.findIndex((provider) => provider.name === active);
  const currentIndex = active === cfg.paidFallback ? cfg.freeProviders.length : foundIndex;
  if (currentIndex <= 0 || currentIndex < 0 || Date.now() - (state.switchedAt ?? 0) < cfg.recoverFreeLaneAfterMinutes * 60_000) return;
  const now = Date.now();
  const lanes = laneStates();
  const preferred = cfg.freeProviders.slice(0, currentIndex).find((provider) => {
    const s = lanes[provider.name];
    return !s || (s.blockedUntil ?? 0) <= now;
  });
  if (!preferred) return;
  try {
    await activateFreeProvider(preferred);
    state.current = preferred.name;
    state.managedCurrent = preferred.name;
    state.switchedAt = now;
    saveState();
    const message = `免费车道冷却期结束，已恢复优先车道 ${preferred.lane}；后续真实请求会确认可用性。`;
    log(message);
    await notify(message);
  } catch (e) { log(`恢复优先免费车道失败: ${String(e.message).slice(0, 100)}`); }
}

function resetDailyBudget() {
  const day = todayShanghai();
  if (state.day === day) return;
  state.day = day;
  state.paidSwitches = 0;
  saveState();
  log('上海时区日期变更，已重置付费备用切换计数');
}

process.on('SIGINT', () => { stopping = true; log('收到停止信号'); process.exit(0); });
process.on('SIGTERM', () => { stopping = true; process.exit(0); });

log('免费池轮换守护已启动（监听真实生成失败，不发送合成模型探测）');
log(`免费车道顺序: ${cfg.freeProviders.map((provider) => `${provider.lane}:${provider.name}`).join(' → ')}`);
log(`付费备用: ${cfg.paidFallback}; 每日最多切入 ${cfg.maxPaidSwitchesPerDay} 次`);

try {
  if(routingMode()==='auto')await provisionFreeProviders();
  state.current = await getActive();
  if (state.managedCurrent !== state.current) state.managedCurrent = null;
  if (!cfg.freeProviders.some((provider) => provider.name === state.current) && state.current !== cfg.paidFallback)
    log(`配置提示：当前端点 ${state.current} 不在 freeProviders 中，免费池轮换不会接管此端点。`);
  if(routingMode()==='auto')await reconcileAuxiliaryModels(state.current);
  if (!state.day) { state.day = todayShanghai(); state.paidSwitches = 0; }
  seedLogCursors();
  saveState();
  log(`当前生效端点: ${state.current}`);
} catch (e) {
  // Keep watching logs even if Cortico is still starting up.
  seedLogCursors();
  log(`启动时连接 Cortico 未就绪: ${String(e.message).slice(0, 100)}（稍后继续）`);
}

let routingWasManual=false;
while (!stopping) {
  if(routingMode()!=='auto'){
    routingWasManual=true;
    await new Promise(resolve=>setTimeout(resolve,cfg.logPollIntervalMs));
    continue;
  }
  if(routingWasManual){seedLogCursors();routingWasManual=false;}
  try {
    resetDailyBudget();
    const active = await getActive();
    if (state.current !== active && state.managedCurrent !== active) state.managedCurrent = null;
    state.current = active;
    await reconcileAuxiliaryModels(active);
    await pollRunLogs();
    await recoverHigherPriorityLane();
  } catch (e) { log(`轮询异常: ${String(e.message).slice(0, 120)}`); }
  await new Promise((resolve) => setTimeout(resolve, cfg.logPollIntervalMs));
}
