/**
 * 修 gaming 扩展的"游戏识别"误判。
 *
 * 现象（2026-10-09）：窗口标题是「Download - 文件资源管理器」，却被认成守望先锋。
 * 根因：别名匹配是 `title.includes(alias)` 的**子串**匹配，别名 `OW` 撞上了
 *       "Download" 里的 "ow"。而原有的保护 `if (proc.includes(alias)) return false`
 *       只挡"别名出现在进程名里"的情况，挡不住标题里的巧合子串。
 *
 * 修法（两道闸，都不影响正常识别）：
 *   1. 别名匹配只对"非系统进程"生效——explorer / TextInputHost 这类桌面组件
 *      永远不靠标题别名判成游戏。它们本来也不是游戏的宿主。
 *   2. 纯 ASCII 别名要求"词边界"：`ow` 不再匹配 "Download"，但 `Overwatch` 照样匹配。
 *
 * 佐证见仓库 README：别名本意是给"进程名通用的启动器"兜底，不是让系统进程参与匹配。
 *
 * 幂等：有 .orig 就先还原再打。回滚：覆盖回 tracker-logic.ts。
 */
import fs from 'node:fs';
import path from 'node:path';

// 目标目录：Cortico 检出下的 gaming 扩展源码。
// 默认取本仓库的兄弟目录 ../cortico-qq；可用环境变量 CORTICO_ROOT 覆盖。
const REPO_ROOT = path.resolve(import.meta.dirname, '..');
const CORTICO = path.resolve(process.env.CORTICO_ROOT ?? path.join(REPO_ROOT, '..', 'cortico-qq'));
const SRC = path.join(CORTICO, 'extensions', 'node_modules', 'cortico-world-gaming-alont1', 'src');



const FILE = path.join(SRC, 'tracker-logic.ts');
const BACKUP = FILE + '.orig';

if (!fs.existsSync(BACKUP)) {
  fs.copyFileSync(FILE, BACKUP);
  console.log('已备份 tracker-logic.ts -> tracker-logic.ts.orig');
} else {
  fs.copyFileSync(BACKUP, FILE);
  console.log('已从 .orig 还原，重新打补丁。');
}

let src = fs.readFileSync(FILE, 'utf8');
const before = src.length;

// 1) 在 matchGame 前插入一个"词边界包含"辅助函数
const anchor1 = `/** 在游戏库里找这个采样属于哪个游戏。进程名优先，其次别名。 */`;
if (!src.includes(anchor1)) { console.error('锚点1 未命中'); process.exit(1); }

src = src.replace(anchor1, `/**
 * 别名是不是"作为一个词"出现在标题里。
 *
 * 纯 ASCII 别名按词边界判定：\`ow\` 不再命中 "Download"（实测过的误判），
 * 而 \`Overwatch\`、\`NTE\` 这类完整词照常命中。含中文的别名按子串判定——
 * 中文没有词边界，"异环"出现在"异环 - 文件资源管理器"里就是命中。
 */
function containsAlias(title: string, alias: string): boolean {
  if (!alias) return false
  // 含非 ASCII（中文等）：直接子串
  if (/[^\\x00-\\x7f]/.test(alias)) return title.includes(alias)
  // 纯 ASCII：要求前后不是字母数字，避免 ow 撞 Download、nte 撞 "content" 这类巧合
  const escaped = alias.replace(/[.*+?^$\${}()|[\\]\\\\]/g, '\\\\$&')
  return new RegExp(\`(?<![a-z0-9])\${escaped}(?![a-z0-9])\`, 'i').test(title)
}

/** 在游戏库里找这个采样属于哪个游戏。进程名优先，其次别名。 */`);

// 2) 别名循环里：跳过系统进程 + 用 containsAlias 替换 includes
const anchor2 = `  for (const g of games) {
    const all = [g.id, g.name, ...g.aliases]
    if (all.some((a) => {
      const alias = a?.toLowerCase()
      if (!alias) return false
      if (proc.includes(alias)) return false
      return title.includes(alias)
    })) return g
  }`;
if (!src.includes(anchor2)) { console.error('锚点2 未命中'); process.exit(1); }

src = src.replace(anchor2, `  // 别名只给"可能承载游戏的非系统进程"兜底。
  // explorer / 输入法这类桌面组件永远不靠标题别名算作游戏——它们不是游戏的宿主，
  // 而标题里出现游戏名（下载目录、文件夹名）纯属巧合。实测：Download 里的 ow → 守望先锋。
  const systemish = new Set([...DEFAULT_NON_GAME, ...cfgNonGame.map((p) => p.toLowerCase())])
  if (!systemish.has(proc)) {
    for (const g of games) {
      const all = [g.id, g.name, ...g.aliases]
      if (all.some((a) => {
        const alias = a?.toLowerCase()
        if (!alias) return false
        if (proc.includes(alias)) return false
        return containsAlias(title, alias)
      })) return g
    }
  }`);

// 3) matchGame 需要拿到"非游戏进程表"才能挡住系统进程；加一个可选参数保持向后兼容
const anchor3 = `export function matchGame(sample: ForegroundSample, games: readonly GameConfig[]): GameConfig | null {`;
if (!src.includes(anchor3)) { console.error('锚点3 未命中'); process.exit(1); }

src = src.replace(anchor3, `export function matchGame(
  sample: ForegroundSample,
  games: readonly GameConfig[],
  extraNonGame: readonly string[] = [],
): GameConfig | null {`);

// 4) 唯一的调用点把 cfg.nonGameProcesses 传进去
const anchor4 = `    const matched = matchGame(sample, cfg.games)`;
if (!src.includes(anchor4)) { console.error('锚点4 未命中'); process.exit(1); }
src = src.replace(anchor4, `    const matched = matchGame(sample, cfg.games, cfg.nonGameProcesses)`);

// 5) 修正第 2 步里引用的变量名（改用参数 extraNonGame）
src = src.replace(
  `  const systemish = new Set([...DEFAULT_NON_GAME, ...cfgNonGame.map((p) => p.toLowerCase())])`,
  `  const systemish = new Set([...DEFAULT_NON_GAME, ...extraNonGame.map((p) => p.toLowerCase())])`,
);

fs.writeFileSync(FILE, src, 'utf8');
console.log(`补丁已应用（${src.length - before >= 0 ? '+' : ''}${src.length - before} 字符）。`);
