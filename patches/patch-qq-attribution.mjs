/** Repair scheduled-message attribution and history; preserve current dialogue/routing patches. */
import fs from 'node:fs';import path from 'node:path';
const repo=path.resolve(import.meta.dirname,'..');const root=path.resolve(process.env.CORTICO_ROOT??JSON.parse(fs.readFileSync(path.join(repo,'runtime-selection.json'),'utf8')).corticoRoot);
const pkg=path.join(root,'extensions/node_modules/cortico-world-qq-better-alont1');
if(JSON.parse(fs.readFileSync(path.join(pkg,'package.json'),'utf8')).version!=='0.1.17')throw Error('QQ attribution patch supports 0.1.17 only');
const changes=new Map();
function edit(file,marker,anchor,replacement){const name=path.join(root,file);let x=changes.get(name);if(!x){x={original:fs.readFileSync(name,'utf8').replaceAll('\r\n','\n')};x.text=x.original;changes.set(name,x);}if(x.text.includes(marker))return;if(x.text.split(anchor).length!==2)throw Error('Attribution anchor mismatch '+file+' '+marker);x.text=x.text.replace(anchor,replacement);}
const qq='extensions/node_modules/cortico-world-qq-better-alont1/src/';
edit(qq+'world.ts','DialogueLedger, dialogueHistory, DIALOGUE_OWNERSHIP_RULES',"import { DialogueLedger } from './dialogue-ledger.ts';","import { DialogueLedger, dialogueHistory, DIALOGUE_OWNERSHIP_RULES } from './dialogue-ledger.ts';");
edit(qq+'world.ts',"type: 'qq.sent'", "              type: 'qq.message',\n              ts: eventTs(this.config.timezone),\n              source: SOURCE,\n              origin: 'internal',", "              type: 'qq.sent',\n              ts: eventTs(this.config.timezone),\n              source: SOURCE,\n              origin: 'internal',");
edit(qq+'world.ts','【本账号已发送的回执', 'text: `【这条是我自己冒的泡，不是你写的】[${clock} 发给 ${this.convTag(address)}]：${text}`,', 'text: `【本账号已发送的回执；不是用户发言，不要回复此回执】[${clock} 发给 ${this.convTag(address)}]：${text}`,');
edit(qq+'world.ts','const sent = this.dialogue.outgoing()',`      const today = events.filter((e) => e.origin === 'external' && e.ts && Date.parse(e.ts) >= startOfDay.getTime());
      return clampText(stripLoneSurrogates(today.slice(-14).map((e) => String(e.text ?? '')).filter(Boolean).join('\\n')), 2500);`, `      const today = events.filter((e) => e.ts && Date.parse(e.ts) >= startOfDay.getTime()) as import('./dialogue-ledger.ts').HistoryEvent[];
      const sent = this.dialogue.outgoing().filter(s=>Date.parse(s.ts)>=startOfDay.getTime());
      // Keep the latest six exchanges and their transport direction; omit stale profile wrappers.
      return stripLoneSurrogates(dialogueHistory(today.map(e=>({...e,text:e.text.slice(-320)})),sent.map(s=>({...s,text:s.text.slice(-320)})),address,6,ts=>shortTime(this.config.timezone,new Date(ts))));`);
edit(qq+'world.ts','历史收发与实际发送回执', '【${this.convTag(t.address)} 里今天说过的原话】','【${this.convTag(t.address)} 里的历史收发与实际发送回执；最新回执优先于旧笔记】');
edit(qq+'world.ts',"antiLoopLine + '\\n' + DIALOGUE_OWNERSHIP_RULES", "'qq.antiLoop': antiLoopLine,", "'qq.antiLoop': antiLoopLine + '\\n' + DIALOGUE_OWNERSHIP_RULES,");
edit(qq+'history-tools.ts','dialogueHistory, historyDirection',"import { dialogueHistory, type Sent } from './dialogue-ledger.ts';","import { dialogueHistory, historyDirection, type Sent } from './dialogue-ledger.ts';");
edit(qq+'history-tools.ts',"e.type === 'qq.message' || e.type === 'qq.sent'", ".filter((e) => e.type === 'qq.message')", ".filter((e) => e.type === 'qq.message' || e.type === 'qq.sent')");
edit(qq+'history-tools.ts','${historyDirection(e)}', '(e) => `[${shortTime(ctx.timezone, new Date(e.ts))}] ${e.senderKey ?? \'\'} ${e.text}`', '(e) => `[${shortTime(ctx.timezone, new Date(e.ts))}][${historyDirection(e)}] ${e.senderKey ?? \'\'} ${e.text}`');
edit(qq+'proactive.ts',"clean === '[skip]'", '    const clean = text.trim();', "    const clean = text.trim();\n    if (clean === '[skip]') {this.lastEmitAt=Date.now();this.rollNextJitter();return false;}");
edit(qq+'proactive.ts','【主动聊天归属规则】', "      + '实在没什么可说，就说一句你现在在干嘛，或者问一句对方。';", "      + '【主动聊天归属规则】根据收发方向判断谁负责哪件事：对方委托你去做的任务，不能反问对方做完没有。你已发送的进度/完成回执优先于旧笔记；已完成或取消的事项不催问。你没有实时游戏状态，不能编现在正在做什么，也不能据旧记录给对方制造待办。没有新话题或无法确认归属时，原样输出[skip]，允许这次不发消息。';");
edit('bots/cormini/persona/handoffNote.ts','【交接归属】', "  const common = '同一项状态读数只留了最后一次,更早的长回执只留了个头。';", "  const common = '同一项状态读数只留了最后一次,更早的长回执只留了个头。【交接归属】保留谁说的、谁负责、状态和凭据。自己的发送回执/问句不是用户请求，我负责的任务不能改成等用户做；自己发言没人回复不自动构成待办。最新取消与完成回执优先于旧笔记，不确定先查收发历史。';");
const helper=fs.readFileSync(path.join(repo,'addons/qq-dialogue/src/dialogue-ledger.ts'),'utf8');
if(process.argv.includes('--apply')){for(const [file,x] of changes){if(!fs.existsSync(file+'.qq-attribution.orig'))fs.copyFileSync(file,file+'.qq-attribution.orig');if(x.text!==x.original)fs.writeFileSync(file,x.text);}fs.writeFileSync(path.join(pkg,'src/dialogue-ledger.ts'),helper);console.log('QQ attribution installed; restart required, no messages sent.');}else console.log('QQ attribution preflight passed; --apply required.');
