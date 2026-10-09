/**
 * 扩展 qqbot 的正文清洗：加 XML 风格的伪工具调用。
 *
 * 上次（patch-qqbot-bugs.mjs）只处理了 JSON 形态：
 *   {"tool_calls":[{"name":"qq_send","arguments":{"to":"...","text":"..."}}]}
 * 2026-10-09 13:21 又出现另一种形态（弱模型常见的 XML 风格）：
 *   <tool_call><function=bash><parameter=parameter name">qq_send</parameter>
 *   <parameter=arguments>{"to":"...","text":"..."}</parameter></function></tool_call>
 * 这段整段发到了 QQ，还被按句拆成两条。
 *
 * 本脚本把 stripStructuredNoise 整段替换成覆盖两种形态的版本。
 * 幂等：有 .orig 先还原。回滚：覆盖回 world.ts。
 */
import fs from 'node:fs';
import path from 'node:path';

// 目标目录：Cortico 检出下的 qqbot 扩展源码。
// 默认取本仓库的兄弟目录 ../cortico-qq；可用环境变量 CORTICO_ROOT 覆盖。
const REPO_ROOT = path.resolve(import.meta.dirname, '..');
const CORTICO = path.resolve(process.env.CORTICO_ROOT ?? path.join(REPO_ROOT, '..', 'cortico-qq'));
const SRC = path.join(CORTICO, 'extensions', 'node_modules', 'cortico-world-qq-better-alont1', 'src');


const FILE = path.join(SRC, 'world.ts');
const BACKUP = FILE + '.orig';

if (!fs.existsSync(BACKUP)) {
  console.error('找不到 world.ts.orig —— 请先运行 patch-qqbot-bugs.mjs。');
  process.exit(1);
}

// 从原始文件重来，再依次打「基础补丁」与「本次扩展」
fs.copyFileSync(BACKUP, FILE);
let src = fs.readFileSync(FILE, 'utf8');

// ---- 重新应用基础补丁（noteOutgoing + 清洗调用点）----
const a1 = `    return this.sendSegments(address, buildOutgoing(text, this.emojiDirAbs, this.mentionResolver(address)), replyMessageId);`;
if (!src.includes(a1)) { console.error('基础补丁锚点未命中'); process.exit(1); }
src = src.replace(a1, `    const clean = stripStructuredNoise(text);
    if (!clean) {
      this.log.warn('正文清洗后为空，未发送', { raw: String(text).slice(0, 200) });
      return '（内容清洗后为空，未发送）';
    }
    // 记一次开口：主动说话的冷却据此推后，避免“刚回完又主动冒一条”。
    this.proactive?.noteOutgoing();
    return this.sendSegments(address, buildOutgoing(clean, this.emojiDirAbs, this.mentionResolver(address)), replyMessageId);`);

// ---- 新的清洗函数（覆盖 JSON + XML 两种形态）----
const FN = `
/**
 * 剥掉模型混进正文的结构化残留。
 *
 * 已见两种形态（都是"模型没走 function_call，把工具调用写进了正文"）：
 *   JSON: {"tool_calls":[{"name":"qq_send","arguments":{"to":"...","text":"..."}}]}
 *   XML : <tool_call><function=bash><parameter=parameter name">qq_send</parameter>
 *         <parameter=arguments>{"to":"...","text":"..."}</parameter></function></tool_call>
 * 后者来自较弱的模型，整段发到 QQ 后还被按句拆成两条（2026-10-09 13:21 实测）。
 *
 * 处理顺序：先从工具结构里挖出真正的 text；挖不到就整段丢弃。
 * 保守原则：不含工具标记的正文原样放行——"{笑}"、"带<尖括号>的话"都不受影响。
 */
function stripStructuredNoise(input: string): string {
  let text = String(input ?? '');
  if (!text.trim()) return '';

  // A) XML 形态：整段是伪工具调用
  if (/<\\s*(tool_call|function_call|function=|parameter=)/i.test(text)) {
    const t = /"text"\\s*:\\s*"((?:[^"\\\\]|\\\\.)*)"/.exec(text);
    if (t) {
      try { text = JSON.parse('"' + t[1] + '"'); } catch { text = t[1]; }
    } else {
      return '';
    }
  }

  // B) JSON 形态：从句柄里挖 text
  const re = /"arguments"\\s*:\\s*\\{[^{}]*?"text"\\s*:\\s*"((?:[^"\\\\]|\\\\.)*)"/g;
  const picked: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    try { picked.push(JSON.parse('"' + m[1] + '"')); } catch { picked.push(m[1]); }
  }
  if (picked.length) text = picked.join('\\n');

  // C) 整条仍是 JSON 对象时，认得出工具结构才丢弃
  const trimmed = text.trim();
  if (/^[{[]/.test(trimmed)) {
    const open = trimmed.indexOf('{');
    const close = trimmed.lastIndexOf('}');
    if (open >= 0 && close > open) {
      try {
        const obj = JSON.parse(trimmed.slice(open, close + 1)) as Record<string, unknown>;
        const maybe = obj?.text ?? obj?.content ?? obj?.message;
        if (typeof maybe === 'string' && maybe.trim()) text = maybe;
        else if (obj && (obj.tool_calls || obj.function_call || obj.name)) text = '';
      } catch { /* 不是 JSON，原样保留 */ }
    }
  }

  // D) 通用清理：残留的工具标记与标签
  text = text
    .replace(/\\{?\\s*"tool_calls"\\s*:\\s*\\[[\\s\\S]*?\\]\\s*\\}?/g, ' ')
    .replace(/\\{?\\s*"function_call"\\s*:\\s*\\{[\\s\\S]*?\\}\\s*\\}?/g, ' ')
    .replace(/<\\/?[a-z_]*(tool_call|function_call|function|parameter)[^>]*>/gi, ' ')
    .replace(/[ \\t]+\\n/g, '\\n')
    .replace(/\\n{3,}/g, '\\n\\n')
    .replace(/[ \\t]{2,}/g, ' ')
    .trim();

  return text;
}
`;

src = src.trimEnd() + '\n' + FN;
fs.writeFileSync(FILE, src, 'utf8');
console.log('已更新 stripStructuredNoise：覆盖 JSON + XML 两种形态。');
console.log('文件:', FILE);
