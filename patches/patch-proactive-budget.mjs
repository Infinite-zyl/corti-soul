/**
 * 给 qqbot 扩展的两条侧调用补足预算（配合免费池换成 dots-studio 推理型模型）。
 *
 * 背景（2026-10-10 实测）：免费池主池从 mimo-v2.6-flash-free 换成
 * dots-studio/dots-3-note-preview:free 后，该模型是重推理模型 —— 默认会把
 * 相当一部分 token 预算烧在思维链上。原代码有两处按"非推理模型"给的小预算：
 *
 * 1) world.ts completeChat() 硬编码 `max_tokens: opts?.maxTokens ?? 200`。
 *    实测 proactive 那条提示词：一次烧掉 834 个 reasoning token、completion 512、
 *    finish_reason=length，**正文返回空** → 约 1/3 概率主动说话变哑巴。
 *    修：默认提到 2000，并允许调用方传 reasoningEffort 压低推理开销。
 *
 * 2) config.ts QQ_DEFAULTS.vision.timeoutMs = 30000，而 dots 标注表情包实测
 *    18~30s（最慢 29969ms，正好卡在超时线上）→ 表情包情感标注会间歇性失败降级。
 *    修：不改默认值（别的端点是快模型），改实例配置 deployments/mybot/config.json
 *    的 worlds.qqbot.vision.timeoutMs = 90000。
 *
 * 幂等：靠 MARK 判断是否已打过；重复运行直接跳过。回滚：从 world.ts.orig
 * 重跑 patch-qqbot-bugs.mjs + patch-qqbot-bugs2.mjs。
 */
import fs from 'node:fs';
import path from 'node:path';

const REPO_ROOT = path.resolve(import.meta.dirname, '..');
const CORTICO = path.resolve(process.env.CORTICO_ROOT ?? path.join(REPO_ROOT, '..', 'cortico-qq'));
const SRC = path.join(CORTICO, 'extensions', 'node_modules', 'cortico-world-qq-better-alont1', 'src');
const FILE = path.join(SRC, 'world.ts');

const MARK = '// [patch-proactive-budget]';

const raw = fs.readFileSync(FILE, 'utf8');
if (raw.includes(MARK)) {
  console.log('已打过 patch-proactive-budget，跳过。');
  process.exit(0);
}
// 本文件是 CRLF：把多行锚点统一成 LF 再匹配，写回时还原，避免锚点永远命中不了。
const crlf = raw.includes('\r\n');
let src = crlf ? raw.replace(/\r\n/g, '\n') : raw;

// ---- 1) completeChat 签名：允许传 reasoningEffort ----
const SIG_FROM = `    opts?: { temperature?: number; maxTokens?: number },`;
const SIG_TO = `    opts?: { temperature?: number; maxTokens?: number; reasoningEffort?: string },`;
if (!src.includes(SIG_FROM)) { console.error('锚点未命中: completeChat 签名'); process.exit(1); }
src = src.replace(SIG_FROM, SIG_TO);

// ---- 2) 请求体：默认预算 2000，并带上压低后的推理强度 ----
const BODY_FROM = `        body: JSON.stringify({ model, messages, temperature: opts?.temperature ?? 0.9, max_tokens: opts?.maxTokens ?? 200 }),`;
const BODY_TO = `        body: JSON.stringify({ model, messages, temperature: opts?.temperature ?? 0.9, max_tokens: opts?.maxTokens ?? 2000, ...(opts?.reasoningEffort ? { reasoning: { effort: opts.reasoningEffort } } : {}) }), ${MARK}`;
if (!src.includes(BODY_FROM)) { console.error('锚点未命中: completeChat 请求体'); process.exit(1); }
src = src.replace(BODY_FROM, BODY_TO);

// ---- 3) 主动说话 / 动态生成：显式给足预算 + 压低推理强度 ----
const PRO_FROM = `  private async chatCompletion(messages: ChatMsg[]): Promise<string | null> {
    const cfg = this.config.proactive;
    return this.completeChat(cfg.endpoint, cfg.apiKeySecret, cfg.model, messages);
  }`;
const PRO_TO = `  private async chatCompletion(messages: ChatMsg[]): Promise<string | null> {
    const cfg = this.config.proactive;
    // 推理型模型（dots-studio 等）会把预算烧在思维链上：200 token 时实测正文为空。
    // 提到 2000 并压低推理强度 —— 实测空回复 0/4、平均 4.1s（原 7.5s）。
    return this.completeChat(cfg.endpoint, cfg.apiKeySecret, cfg.model, messages, {
      temperature: 0.9,
      maxTokens: 2000,
      reasoningEffort: 'low',
    });
  }`;
if (!src.includes(PRO_FROM)) { console.error('锚点未命中: chatCompletion'); process.exit(1); }
src = src.replace(PRO_FROM, PRO_TO);

const out = crlf ? src.replace(/\n/g, '\r\n') : src;
fs.writeFileSync(FILE, out, 'utf8');
console.log('✓ world.ts: completeChat 默认 max_tokens 200 → 2000，proactive 带 reasoningEffort=low');
console.log('  文件:', FILE);
