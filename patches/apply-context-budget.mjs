/**
 * 调整部署的上下文阶段预算与记忆快照推送周期。
 *
 * 两处都是 persona/world 自己声明的配置项，不碰源码：
 *   context.maxTokens              —— 上下文阶段预算；软阈值 = 预算 × softRatio，越过即交接
 *   worlds.memory.observeIntervalMs —— 记忆快照推送周期；同一份正文反复推送只占上下文
 *
 * 默认只预检，--apply 才写盘，并在部署目录留 config.json.bak-context-budget-<时间>。
 * --revert 用最新的备份还原；--check 只核对当前值（重启后用它确认改动还在）。
 */
import fs from 'node:fs';
import path from 'node:path';

const MAX_TOKENS_DEFAULT = 80000;
const MEMORY_INTERVAL_MS_DEFAULT = 300000;

const repo = path.resolve(import.meta.dirname, '..');
const root = path.resolve(
  process.env.CORTICO_ROOT ??
    JSON.parse(fs.readFileSync(path.join(repo, 'runtime-selection.json'), 'utf8')).corticoRoot,
);
const deployment = process.env.CORTICO_DEPLOYMENT ?? 'mybot';
const file = path.join(root, 'deployments', deployment, 'config.json');

const argv = process.argv.slice(2);
const apply = argv.includes('--apply');
const revert = argv.includes('--revert');
const check = argv.includes('--check');
const number = (name, fallback) => {
  const hit = argv.find((a) => a.startsWith(`--${name}=`));
  if (!hit) return fallback;
  const value = Number(hit.slice(name.length + 3));
  if (!Number.isFinite(value) || value <= 0) throw Error(`--${name} 需要正数`);
  return value;
};
const maxTokens = number('max-tokens', MAX_TOKENS_DEFAULT);
const memoryIntervalMs = number('memory-interval-ms', MEMORY_INTERVAL_MS_DEFAULT);

if (!fs.existsSync(file)) throw Error(`找不到部署配置：${file}`);
const original = fs.readFileSync(file, 'utf8');
const config = JSON.parse(original);

/** 键序无关的序列化；比对时不该因为插入位置不同而报错。 */
function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') {
    const keys = Object.keys(value).sort();
    return `{${keys.map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value ?? null);
}

/** 只比对除这两条之外的内容，确保脚本不悄悄改动别的配置。 */
function restOf(value) {
  const copy = JSON.parse(JSON.stringify(value));
  delete copy.context?.maxTokens;
  if (copy.context && Object.keys(copy.context).length === 0) delete copy.context;
  delete copy.worlds?.memory?.observeIntervalMs;
  return canonical(copy);
}

const current = {
  maxTokens: config.context?.maxTokens ?? null,
  observeIntervalMs: config.worlds?.memory?.observeIntervalMs ?? null,
};
const target = { maxTokens, observeIntervalMs: memoryIntervalMs };

if (revert) {
  const dir = path.dirname(file);
  const backups = fs
    .readdirSync(dir)
    .filter((name) => name.startsWith('config.json.bak-context-budget-'))
    .sort();
  if (!backups.length) throw Error(`没有找到 ${path.join(dir, 'config.json.bak-context-budget-*')}`);
  const newest = path.join(dir, backups[backups.length - 1]);
  fs.copyFileSync(newest, file);
  console.log(`已用备份还原：${path.basename(newest)} → ${file}`);
  process.exit(0);
}

const same = current.maxTokens === target.maxTokens && current.observeIntervalMs === target.observeIntervalMs;
if (check) {
  console.log(`context.maxTokens               = ${current.maxTokens ?? '（默认 64000）'}`);
  console.log(`worlds.memory.observeIntervalMs = ${current.observeIntervalMs ?? '（默认 30000）'}`);
  console.log(same ? 'PASS 两处都已生效' : 'FAIL 与目标不一致，需要重新 --apply');
  process.exit(same ? 0 : 1);
}

console.log(`部署配置：${file}`);
console.log(`  context.maxTokens               ${String(current.maxTokens ?? '默认 64000').padStart(12)} → ${target.maxTokens}`);
console.log(`  worlds.memory.observeIntervalMs ${String(current.observeIntervalMs ?? '默认 30000').padStart(12)} → ${target.observeIntervalMs}`);

if (same) {
  console.log('已经是指定值，无需改动。');
  process.exit(0);
}
if (!apply) {
  console.log('\n预检通过；加 --apply 才写盘（会先留 config.json.bak-context-budget-<时间>）。');
  process.exit(0);
}

const next = JSON.parse(JSON.stringify(config));
// context 段按声明语义插在 tick 之后，其余键顺序不变。
const rebuilt = {};
for (const [key, value] of Object.entries(next)) {
  if (key === 'context') continue;
  rebuilt[key] = value;
  if (key === 'tick') rebuilt.context = { ...(next.context ?? {}), maxTokens: target.maxTokens };
}
if (!('context' in rebuilt)) rebuilt.context = { ...(next.context ?? {}), maxTokens: target.maxTokens };
rebuilt.worlds = { ...(rebuilt.worlds ?? {}) };
rebuilt.worlds.memory = { ...(rebuilt.worlds.memory ?? {}), observeIntervalMs: target.observeIntervalMs };

if (restOf(rebuilt) !== restOf(config)) throw Error('内部检查失败：改动波及了这两条以外的配置，已中止');

const d = new Date();
const pad = (n) => String(n).padStart(2, '0');
const stamp = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
const backup = `${file}.bak-context-budget-${stamp}`;
fs.copyFileSync(file, backup);
const text = JSON.stringify(rebuilt, null, 2) + (original.endsWith('\n') ? '\n' : '');
fs.writeFileSync(file, text);
console.log(`\n已写入。备份：${path.basename(backup)}`);
console.log('需要重启 bot 才生效；重启后可运行 node patches/apply-context-budget.mjs --check 确认。');
