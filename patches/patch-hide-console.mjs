// 修复：启动器拉起 Cortico 时弹出的命令行窗口。
//
// 原因：bin/cortico.mjs 的 supervise() 用 fork() 起 tsx 子进程，没有传 windowsHide。
// Node 的 windowsHide 默认 false，Windows 会给这个 console 子系统子进程
// 新分配一个控制台窗口 —— 也就是「拉起 Cortico 时多出来的那个命令行」。
// 启动器（app.py）虽然用了 CREATE_NO_WINDOW | DETACHED_PROCESS，
// 但那只能压住它直接 spawn 的那一层 node.exe；fork 出来的孙进程不在其列。
//
// 修法：给 fork 的 options 加 windowsHide: true。
//
// 幂等：已有 windowsHide 就跳过；带 .orig 备份，重复运行会先还原再打。

import { readFileSync, writeFileSync, existsSync, copyFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

// 目标：Cortico 检出下的 bin/cortico.mjs。
// 默认取本仓库的兄弟目录 ../cortico-qq；可用环境变量 CORTICO_ROOT 覆盖。
const REPO_ROOT = resolve(import.meta.dirname, '..');
const CORTICO = resolve(process.env.CORTICO_ROOT ?? join(REPO_ROOT, '..', 'cortico-qq'));


const ROOT = CORTICO;
const TARGET = join(ROOT, 'bin', 'cortico.mjs');
const BACKUP = TARGET + '.orig';

if (!existsSync(TARGET)) {
  console.error(`找不到目标文件：${TARGET}`);
  process.exit(1);
}

// 从备份重来，保证可重复运行
if (existsSync(BACKUP)) {
  copyFileSync(BACKUP, TARGET);
} else {
  copyFileSync(TARGET, BACKUP);
  console.log(`已备份 → ${BACKUP}`);
}

let src = readFileSync(TARGET, 'utf8');

if (/const child = fork\(entry/.test(src) === false) {
  console.error('锚点未命中：没找到 `const child = fork(entry`');
  process.exit(1);
}

// 找到 fork 的 options 块里插入 windowsHide。
// 目标片段（cortico.mjs:255-265）：
//   const child = fork(entry, [bot, ...passthrough], {
//     cwd: REPO_ROOT,
//     execArgv,
//     stdio: ['inherit', 'inherit', 'inherit', 'ipc'],
//     env: {
const before = src;
src = src.replace(
  /(const child = fork\(entry, \[bot, \.\.\.passthrough\], \{\n)(\s*)cwd: REPO_ROOT,/,
  (m, head, indent) =>
    `${head}${indent}cwd: REPO_ROOT,\n${indent}// 启动器场景下父进程没有控制台，不隐藏的话 Windows 会给子进程新开一个命令行窗口。\n${indent}windowsHide: true,`,
);

if (src === before) {
  console.error('替换未生效：锚点正则没匹配到 fork 的 options 块');
  process.exit(1);
}

// 注意：文件里本来就有别的 windowsHide（:110/:140/:167 的 spawnSync），
// 所以只校验「fork 那一段里」有一个，不能数全文。
const anchor = 'const child = fork(entry';
const forkBlock = src.slice(src.indexOf(anchor));
const forkChunk = forkBlock.slice(0, forkBlock.indexOf('child.on('));
if ((forkChunk.match(/windowsHide: true/g) || []).length !== 1) {
  console.error('结果异常：fork options 块里 windowsHide 不是恰好 1 个');
  process.exit(1);
}

writeFileSync(TARGET, src, 'utf8');
console.log('补丁已应用：bin/cortico.mjs 的 fork() 现在带 windowsHide: true');
console.log('\n改动预览：');
const lines = src.split(/\r?\n/);
const idx = lines.findIndex((l) => l.includes('const child = fork(entry'));
for (let i = idx; i < Math.min(idx + 8, lines.length); i++) {
  console.log(`  ${i + 1}: ${lines[i]}`);
}
