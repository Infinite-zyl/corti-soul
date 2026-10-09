/**
 * 修 qqbot 扩展的两个 bug（见文件末尾说明）。
 * 幂等：有 .orig 就先还原再打。回滚：把 src/*.ts.orig 覆盖回 src/*.ts。
 */
import fs from 'node:fs';
import path from 'node:path';

// 目标目录：Cortico 检出下的 qqbot 扩展源码。
// 默认取本仓库的兄弟目录 ../cortico-qq；可用环境变量 CORTICO_ROOT 覆盖。
const REPO_ROOT = path.resolve(import.meta.dirname, '..');
const CORTICO = path.resolve(process.env.CORTICO_ROOT ?? path.join(REPO_ROOT, '..', 'cortico-qq'));
const SRC = path.join(CORTICO, 'extensions', 'node_modules', 'cortico-world-qq-better-alont1', 'src');




function patchFile(name, fn) {
  const file = path.join(SRC, name);
  const backup = file + '.orig';
  if (!fs.existsSync(backup)) {
    fs.copyFileSync(file, backup);
    console.log(`  备份 ${name} -> ${name}.orig`);
  } else {
    fs.copyFileSync(backup, file);
    console.log(`  从 ${name}.orig 还原后重新打`);
  }
  const before = fs.readFileSync(file, 'utf8');
  const after = fn(before, name);
  if (after === before) { console.log(`  ${name}: 无改动`); return; }
  fs.writeFileSync(file, after, 'utf8');
  const d = after.length - before.length;
  console.log(`  ${name}: 已打补丁 (${d >= 0 ? '+' : ''}${d} 字符)`);
}

// ---------- 补丁 1：proactive 记录每一次开口 ----------
console.log('=== 补丁 1/2：proactive 记录每一次开口 ===');
patchFile('proactive.ts', (src) => {
  const a1 = '  /** 收到对方消息时调用：重置该会话的未回复计数并解除静默。 */';
  if (!src.includes(a1)) { console.error('   锚点1 未命中'); return src; }

  src = src.replace(a1, `  /**
   * 记一次“以它的名义发出去的话”（回复或主动），并把下一次允许主动开口的时刻推后。
   *
   * 正常回复走 qq_send，不经过 emit()，而冷却判定只看 lastEmitAt。不在这里记一笔，
   * 刚回复完就会被当成“很久没开口”，冷却一过再冒一条——表现就是回复两次。
   */
  noteOutgoing(): void {
    this.lastEmitAt = Date.now();
    this.rollNextJitter();
    this.save();
  }

  /** 收到对方消息时调用：重置该会话的未回复计数并解除静默。 */`);

  const a2 = `    s.lastSent = Date.now();
    this.lastEmitAt = Date.now();
    // 这一轮发出去之后，下一句要等 minGapSec + 一段随机时间（不这样就是整十分钟一下午）。
    this.rollNextJitter();`;
  if (!src.includes(a2)) { console.error('   锚点2 未命中'); return src; }
  src = src.replace(a2, `    s.lastSent = Date.now();
    // 这一轮发出去之后，下一句要等 minGapSec + 一段随机时间（不这样就是整十分钟一下午）。
    // 走同一个入口，回复与主动的记账行为一致。
    this.noteOutgoing();`);
  return src;
});

// ---------- 补丁 2：发送前剥掉结构化残留 ----------
console.log('\n=== 补丁 2/2：发送前剥掉结构化残留 ===');
patchFile('world.ts', (src) => {
  const a1 = `    return this.sendSegments(address, buildOutgoing(text, this.emojiDirAbs, this.mentionResolver(address)), replyMessageId);`;
  if (!src.includes(a1)) { console.error('   锚点1 未命中'); return src; }

  src = src.replace(a1, `    const clean = stripStructuredNoise(text);
    if (!clean) {
      this.log.warn('正文清洗后为空，未发送', { raw: String(text).slice(0, 200) });
      return '（内容清洗后为空，未发送）';
    }
    // 记一次开口：主动说话的冷却据此推后，避免“刚回完又主动冒一条”。
    this.proactive?.noteOutgoing();
    return this.sendSegments(address, buildOutgoing(clean, this.emojiDirAbs, this.mentionResolver(address)), replyMessageId);`);

  const FN = [
    '',
    '/**',
    ' * 剥掉模型偶尔混进正文的结构化残留。',
    ' *',
    ' * 模型有时不把工具调用走 function_call，而是把 {"tool_calls":[{"name":...}]} 写进正文；',
    ' * 主动说话那条路对正文不做校验，于是整段 JSON 发到 QQ（2026-10-09 13:07 真发生，还被按句拆成两段）。',
    ' * 这里只在发送前兜底。',
    ' *',
    ' * 保守原则：解析不出 JSON 就原样放行，免得把 "{笑}" 这类正常发言吃掉。',
    ' */',
    'function stripStructuredNoise(input: string): string {',
    '  let text = String(input ?? \'\');',
    '  if (!text.trim()) return \'\';',
    '',
    '  // 形如 ..."arguments":{"to":"...","text":"真正要说的话"}...：先把 text 抽出来。',
    '  const re = /"arguments"\\s*:\\s*\\{[^{}]*?"text"\\s*:\\s*"((?:[^"\\\\]|\\\\.)*)"/g;',
    '  const picked: string[] = [];',
    '  let m: RegExpExecArray | null;',
    '  while ((m = re.exec(text)) !== null) {',
    '    try { picked.push(JSON.parse(\'"\' + m[1] + \'"\')); } catch { picked.push(m[1]); }',
    '  }',
    '  if (picked.length) text = picked.join(\'\\n\');',
    '',
    '  // 整条仍是一个 JSON 对象/数组时，只认得出工具结构才丢弃。',
    '  const trimmed = text.trim();',
    '  if (/^[{[]/.test(trimmed)) {',
    '    const open = trimmed.indexOf(\'{\');',
    '    const close = trimmed.lastIndexOf(\'}\');',
    '    if (open >= 0 && close > open) {',
    '      try {',
    '        const obj = JSON.parse(trimmed.slice(open, close + 1)) as Record<string, unknown>;',
    '        const maybe = obj?.text ?? obj?.content ?? obj?.message;',
    '        if (typeof maybe === \'string\' && maybe.trim()) text = maybe;',
    '        else if (obj && (obj.tool_calls || obj.function_call || obj.name)) text = \'\';',
    '      } catch { /* 不是 JSON，原样保留 */ }',
    '    }',
    '  }',
    '',
    '  text = text',
    '    .replace(/\\{?\\s*"tool_calls"\\s*:\\s*\\[[\\s\\S]*?\\]\\s*\\}?/g, \' \')',
    '    .replace(/\\{?\\s*"function_call"\\s*:\\s*\\{[\\s\\S]*?\\}\\s*\\}?/g, \' \')',
    '    .replace(/[ \\t]+\\n/g, \'\\n\')',
    '    .replace(/\\n{3,}/g, \'\\n\\n\')',
    '    .trim();',
    '',
    '  return text;',
    '}',
    '',
  ].join('\n');

  return src.trimEnd() + '\n' + FN;
});

console.log('\n完成。重启 Cortico 生效。');
