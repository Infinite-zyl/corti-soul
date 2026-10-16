/** QQ 0.1.17 local dialogue repair. Preflight all source before any write. */
import fs from 'node:fs';import path from 'node:path';
const root=path.resolve(process.env.CORTICO_ROOT??JSON.parse(fs.readFileSync(new URL('../runtime-selection.json',import.meta.url),'utf8')).corticoRoot);
const pkg=path.join(root,'extensions/node_modules/cortico-world-qq-better-alont1');
if(JSON.parse(fs.readFileSync(path.join(pkg,'package.json'),'utf8')).version!=='0.1.17')throw Error('仅支持QQ扩展0.1.17；先核对新版本再迁移');
const files=new Map();
function edit(f,from,to){let s=files.get(f)??fs.readFileSync(path.join(pkg,'src',f),'utf8').replaceAll('\r\n','\n');if(!s.includes(to)){if(s.split(from).length!==2)throw Error(f+'锚点不匹配：'+from.slice(0,60));s=s.replace(from,to);}files.set(f,s);}
edit('world.ts',"import { makeHistoryTools } from './history-tools.ts';","import { makeHistoryTools } from './history-tools.ts';\nimport { DialogueLedger } from './dialogue-ledger.ts';");
edit('world.ts',"  private dataDir = '';","  private dataDir = '';\n  private dialogue: DialogueLedger;");
edit('world.ts',"    this.dataDir = dataDir;","    this.dataDir = dataDir;\n    this.dialogue = new DialogueLedger(dataDir ? join(dataDir, 'qqbot-dialogue.json') : null);");
edit('world.ts',"    this.loadState();","    this.loadState();\n    if(this.dialogue.warning)this.log.warn(this.dialogue.warning);");
edit('world.ts',"    if (this.identity && Number(ev.user_id) === this.identity.selfId) return;","    if (this.identity && Number(ev.user_id) === this.identity.selfId) return;\n    if (ev.self_id != null && Number(ev.user_id) === Number(ev.self_id)) return;");
edit('world.ts',"    if (!this.isListened(kind, id)) return;","    if (!this.isListened(kind, id)) return;\n    if (!this.dialogue.inbound(`${kind}:${id}`, ev.message_id)) return;");
edit('world.ts',"      if (about) parts.push(`【你记的关于他】${about}`);","      if (about) parts.push(`【历史人册备注，不代表当前仍在进行；不要仅据此催问旧事】${about}`);");
edit('world.ts',"    const whoLine = known ? `（你记的：${known}）` : '';","    const whoLine = known ? `（历史人册备注，非本轮发言、不代表当前进度：${known}）` : '';");
edit('world.ts',"    if (!this.driver) return '未连接到 NapCat。';\n    const gl = this.checkGroupSpeak(address);","    if (!this.driver) return QQWorld.SEND_FAILED + '未连接到 NapCat。';\n    const gl = this.checkGroupSpeak(address);");
edit('world.ts',"    let ok = 0;\n    let total = 0;", "    const token = this.dialogue.begin(address, JSON.stringify(outgoing), replyMessageId);\n    if ('blocked' in token) return QQWorld.SEND_BLOCKED + token.blocked;\n    let ok = 0;\n    let total = 0;");
edit('world.ts',"    const ids: string[] = [];\n    for (const segs of messages)","    const ids: string[] = [];\n    const delivered: string[] = [];\n    for (const segs of messages)");
edit('world.ts',"        ok++;\n        if (r?.message_id != null)","        ok++;\n        delivered.push(renderSegmentsPlain(valid));\n        if (r?.message_id != null)");
edit('world.ts',"    if (ok > 0) {\n      this.recordGroupSpeak(address);","    this.dialogue.finish(token, address, delivered, ids, total > 0 && ok === total);\n    if (ok > 0) {\n      this.recordGroupSpeak(address);");
edit('world.ts',"      getHost: () => this.host,\n      sourceId: SOURCE,","      getHost: () => this.host,\n      outgoing: () => this.dialogue.outgoing(),\n      sourceId: SOURCE,");
edit('world.ts',"        if (entry) entry.sent = true;","        if (entry) entry.sent = ![QQWorld.SEND_BLOCKED, QQWorld.SEND_FAILED, QQWorld.SEND_PARTIAL].some(prefix => res.startsWith(prefix));");
edit('history-tools.ts',"import type { ToolDef, WorldHost } from 'cortico/core/types.ts';","import type { ToolDef, WorldHost } from 'cortico/core/types.ts';\nimport { dialogueHistory, type Sent } from './dialogue-ledger.ts';");
edit('history-tools.ts',"  getHost: () => WorldHost | null;","  getHost: () => WorldHost | null;\n  outgoing?: () => Sent[];");
{
 const from='查询某个群或私聊最近的消息（按时间倒序）。用于回顾刚才说过的话、确认上下文。';
 const to='查询某个群或私聊的历史收发记录（旧到新，明确收发方向；不是新收到的消息）。';
 let source=files.get('history-tools.ts');
 if(source.includes(from)){
  if(source.split(from).length!==3)throw Error('历史工具描述锚点不匹配');
  files.set('history-tools.ts',source.replaceAll(from,to));
 }else if(source.split(to).length!==3)throw Error('历史工具描述不匹配');
 const describeFile=path.join(pkg,'describe.json');
 const describe=JSON.parse(fs.readFileSync(describeFile,'utf8'));
 const tool=describe.tools.find(t=>t.name==='qq_recent');
 if(!tool||(!tool.description.includes(from)&&!tool.description.includes(to)))throw Error('qq_recent自描述不匹配');
 tool.description=tool.description.replace(from,to);
 files.set('../describe.json',JSON.stringify(describe,null,2)+'\n');
}
edit('history-tools.ts',"        if (!events.length) return `${ctx.convLabel(address)} 在最近 ${minutes} 分钟内没有消息记录。`;\n        const label = ctx.convLabel(address);\n        const lines = events.map(\n          (e) => `[${shortTime(ctx.timezone, new Date(e.ts))}] ${e.senderKey ?? ''} ${e.text}`,\n        );\n        return `${label} 最近消息：\\n${lines.join('\\n')}`;","        const sent=(ctx.outgoing?.()??[]).filter(s=>Date.parse(s.ts)>=Date.parse(fromTs));\n        return dialogueHistory(events, sent, address, limit, ts=>shortTime(ctx.timezone,new Date(ts)));");
const helper=fs.readFileSync(new URL('../addons/qq-dialogue/src/dialogue-ledger.ts',import.meta.url),'utf8');
if(process.argv.includes('--apply')){
 for(const [f,s]of files){const p=path.join(pkg,'src',f);if(!fs.existsSync(p+'.dialogue.orig'))fs.copyFileSync(p,p+'.dialogue.orig');fs.writeFileSync(p,s);}
 fs.writeFileSync(path.join(pkg,'src/dialogue-ledger.ts'),helper);console.log('QQ对话补丁已安装；重启Cortico生效。');
}else console.log('QQ对话补丁预检通过；--apply才写入。');
