/** 在住宅登记之上安装保护和夜间优先。所有文本锚点预检后才写入。 */
import fs from 'node:fs';
import path from 'node:path';
const root=path.resolve(import.meta.dirname,'..');
const target=path.resolve(process.env.CORTICO_ROOT??path.join(root,'../cortico-qq'));
const mc=path.join(target,'src/worlds/minecraft');const check=process.argv.includes('--check');
if(process.argv.slice(2).some(x=>x!=='--check'))throw Error('只支持--check');
const files=new Map();
function edit(name,marker,anchor,replacement){
  const file=path.join(mc,name);let item=files.get(file);
  if(!item){const original=fs.readFileSync(file,'utf8');item={original,text:original};files.set(file,item);}
  if(item.text.includes(marker))return;
  if(item.text.split(anchor).length!==2)throw Error(name+'锚点不匹配：'+marker);
  item.text=item.text.replace(anchor,replacement);
}
try{
  edit('world.ts',"from './home-life.ts'","import { HomeBook, MINECRAFT_HOME_TOOL, type HomeObserver, type Point } from './home.ts';","import { HomeBook, MINECRAFT_HOME_TOOL, type HomeObserver, type Point } from './home.ts';\nimport { homeBox, protectedHomeCell, NightRest } from './home-life.ts';");
  edit('world.ts','private readonly nightRest','  private readonly homeBook: HomeBook;','  private readonly homeBook: HomeBook;\n  private readonly nightRest = new NightRest();\n  private homeProtectionCache: {realm:string;until:number;home:ReturnType<HomeBook[\'get\']>;broken:boolean}|null=null;');
  const methods=`  private homeProtectedCell(x: number, y: number, z: number): boolean {
    const realm=this.realmKey();const now=Date.now();
    if(!this.homeProtectionCache || this.homeProtectionCache.realm!==realm || now>=this.homeProtectionCache.until){
      try{this.homeProtectionCache={realm,until:now+1000,home:this.homeBook.get(realm),broken:false};}
      catch{this.homeProtectionCache={realm,until:now+1000,home:null,broken:true};}
    }
    return this.homeProtectionCache.broken || protectedHomeCell(this.homeProtectionCache.home, normalizeDimension(this.bridge?.bot?.game?.dimension), [x,y,z]);
  }

  private nightRestTick(): void {
    const bot=this.bridge?.connected ? this.bridge.bot : null;
    const executor=this.executor;
    if(!bot?.entity || !executor)return;
    let home: ReturnType<HomeBook['get']>=null;
    try {home=this.homeBook.get(this.realmKey());}catch{ /* 不拿损坏档案推断家。 */ }
    const own=home?.facilities.find(f=>f.role==='own-bed');
    const p=bot.entity.position;
    let bedState: 'present'|'occupied'|'invalid'|'unloaded'='unloaded';
    try{if(home&&own){const q=this.homeBook.query(this.realmKey(),this.homeObserver()) as {facilities:Array<{role:string;status:typeof bedState}>};bedState=q.facilities.find(f=>f.role==='own-bed')?.status??'invalid';}}catch{bedState='invalid';}
    this.nightRest.tick({ time:bot.time?.timeOfDay??0, now:Date.now(), home,
      dimension:normalizeDimension(bot.game.dimension), sleeping:bot.isSleeping===true,
      pending:executor.nightRestPending(), health:bot.health??20,
      emergency:executor.escaping || (this.reflexes?.envActive??false) || (this.combat?.active??false),
      atHome:!!home&&!!own&&Math.hypot(p.x-home.returnAt[0],p.y-home.returnAt[1],p.z-home.returnAt[2])<=3&&Math.hypot(p.x-own.at[0],p.y-own.at[1],p.z-own.at[2])<=8, bedState,
    },{
      priority:(active)=>executor.setNightPriority(active),
      submit:(steps)=>{executor.submit(steps,'now',undefined,true);},
      notify:(text)=>this.emit('minecraft.home', '[Minecraft] '+text, false, {trigger:'piggyback'}),
    });
  }

`;
  edit('world.ts','private homeProtectedCell(', '  private homeObserver(): HomeObserver | null {', methods+'  private homeObserver(): HomeObserver | null {');
  edit('world.ts','emergency:executor.escaping', '      pending:executor.nightRestPending(), health:bot.health??20,', '      pending:executor.nightRestPending(), health:bot.health??20,\n      emergency:executor.escaping || (this.reflexes?.envActive??false) || (this.combat?.active??false),');
  edit('world.ts','p.x-home.returnAt[0]', '      atHome:!!own&&Math.hypot(p.x-own.at[0],p.y-own.at[1],p.z-own.at[2])<=6, bedState,', '      atHome:!!home&&!!own&&Math.hypot(p.x-home.returnAt[0],p.y-home.returnAt[1],p.z-home.returnAt[2])<=3&&Math.hypot(p.x-own.at[0],p.y-own.at[1],p.z-own.at[2])<=8, bedState,');
  edit('world.ts','      homeCell:', '      scaffoldBlocks: () => this.scaffoldBlocksForUse(),', '      scaffoldBlocks: () => this.scaffoldBlocksForUse(),\n      homeCell: (x,y,z) => this.homeProtectedCell(x,y,z),');
  edit('world.ts','    this.nightRestTick();','    const time = bot.time?.timeOfDay ?? 0;','    this.nightRestTick();\n    const time = bot.time?.timeOfDay ?? 0;');
  edit('world.ts',"action === 'protect'", "      if (action === 'query') return JSON.stringify(this.homeBook.query(realm, observer));", `      if (action === 'query') {
        const record=this.homeBook.get(realm);
        return JSON.stringify({ ...this.homeBook.query(realm,observer), ...(record?{protection:homeBox(record)}:{}), nightRest:{active:this.nightRest.active,state:this.nightRest.state} });
      }
      if (action === 'protect') {this.homeBook.protect(realm,args.protection,args.confirmation);return '保护边界已保存；不执行任何拆改。';}`);
  edit('world.ts',"this.homeProtectionCache=null;", "      const action = args.action ?? 'query';", "      const action = args.action ?? 'query';\n      if(['save','remove','protect'].includes(String(action)))this.homeProtectionCache=null;");
  edit('world.ts','nightRest.active && action', "      if (action === 'remove') {", "      if (this.nightRest.active && action === 'remove') return '夜间休息优先期间不撤销住宅登记，请白天再确认。';\n      if (action === 'remove') {");
  edit('world.ts','mc_stop 不打断', '      mc_stop: async () => {', "      mc_stop: async () => {\n        if (this.nightRest.active) return this.toolLog('mc_stop', {}, '夜间回家睡觉优先，mc_stop 不打断休息；紧急危险由求生反射处理，要停机请使用控制台。');");
  edit('world.ts','nightRest.active ? true', '      taskEscaping: () => this.executor?.escaping ?? false,','      taskEscaping: () => this.nightRest.active ? true : (this.executor?.escaping ?? false),');
  edit('world.ts','夜间接单前同步优先级','    const accepted = this.executor.submit(parsed.steps, mode.mode, args.steps);','    this.nightRestTick(); // 夜间接单前同步优先级，不等下一秒心跳。\n    const accepted = this.executor.submit(parsed.steps, mode.mode, args.steps);');
  edit('world.ts',"cmp: home + this.nightRest.state", "      { key: 'home' as const, text: home, cmp: home },", "      { key: 'home' as const, text: home + (this.nightRest.active ? '\\n[夜间] ' + this.nightRest.state : ''), cmp: home + this.nightRest.state },");
  edit('world.ts','|night:${this.nightRest.state}', '`|goals:${goals}|marks:${marks}|home:${home}`;', '`|goals:${goals}|marks:${marks}|home:${home}|night:${this.nightRest.state}`;');

  edit('bridge.ts',"from './home-life.ts'", "import { Vec3 } from 'vec3';", "import { Vec3 } from 'vec3';\nimport { installHomeDigGuard } from './home-life.ts';");
  edit('bridge.ts','  homeCell?:', 'interface BridgeOptions {', 'interface BridgeOptions {\n  homeCell?: (x:number,y:number,z:number)=>boolean;');
  edit('bridge.ts','    installHomeDigGuard(', '    const movements = new Movements(bot);', '    installHomeDigGuard(bot, ([x,y,z]) => this.opts.homeCell?.(x,y,z) ?? false);\n    const movements = new Movements(bot);');
  edit('bridge.ts','|| (this.opts.homeCell?.(x,y,z)', 'this.digBackedOff(x, y, z) || (workCell?.(x, y, z) ?? false)', 'this.digBackedOff(x, y, z) || (workCell?.(x, y, z) ?? false) || (this.opts.homeCell?.(x,y,z) ?? false)');

  edit('executor.ts','  nightRest?: boolean;', 'interface QueuedTask {', 'interface QueuedTask {\n  nightRest?: boolean;');
  edit('executor.ts','private nightDeferred:', 'export class Executor {', 'export class Executor {\n  private restOnly=false;\n  private nightDeferred: QueuedTask[]=[];');
  const restMethods=`  setNightPriority(active:boolean):void {
    if(active===this.restOnly)return;
    this.restOnly=active;
    if(active){
      if(!this.escaping)this.suspend('夜间回家睡觉','queue');
      if(this.frozen){this.nightDeferred.push(this.frozen);this.frozen=null;}
      this.nightDeferred.push(...this.queue.splice(0));
    }else{
      if(this.task?.nightRest)this.abortTask(this.task,'天亮，结束夜间专用任务');
      if(this.frozen?.nightRest)this.frozen=null;
      this.queue=this.queue.filter(t=>!t.nightRest);
      this.queue.unshift(...this.nightDeferred.splice(0));this.pump();
    }
  }
  nightRestPending():boolean {return !!this.task?.nightRest||!!this.frozen?.nightRest||this.queue.some(t=>t.nightRest);}

`;
  edit('executor.ts','  setNightPriority(', "  submit(steps: SkillCall[], mode: QueueMode = 'replace', wrote?: unknown): string {", restMethods+"  submit(steps: SkillCall[], mode: QueueMode = 'replace', wrote?: unknown, nightRest = false): string {\n    if(this.restOnly && !nightRest)return '夜间回家睡觉优先：这件普通工作没有接单，白天再安排；不能用now抢占。';");
  edit('executor.ts','id, nightRest, steps:', 'const task: QueuedTask = { id, steps:', 'const task: QueuedTask = { id, nightRest, steps:');
  edit('executor.ts','const nextIndex = this.restOnly', '    const next = this.queue.shift();', '    const nextIndex = this.restOnly ? this.queue.findIndex(t=>t.nightRest) : 0;\n    const next = nextIndex < 0 ? undefined : this.queue.splice(nextIndex,1)[0];');
  // 两个冻结点必须都携带内部标志，否则战斗恢复会丢失夜间优先。
  const ex=files.get(path.join(mc,'executor.ts'));
  if(!ex.text.includes('nightRest: t.nightRest, steps: t.steps')){
    const anchor='id: t.id, steps: t.steps, enqueuedAt: t.enqueuedAt, startedAt: t.startedAt,';
    if(ex.text.split(anchor).length!==3)throw Error('执行器冻结锚点不匹配');
    ex.text=ex.text.replaceAll(anchor,'id: t.id, nightRest: t.nightRest, steps: t.steps, enqueuedAt: t.enqueuedAt, startedAt: t.startedAt,');
  }
  edit('executor.ts',"...this.nightDeferred.map(q=>", '...this.queue.map((q) => ({ id: q.id, label: labelOf(q) })),', "...this.queue.map((q) => ({ id: q.id, label: labelOf(q) })),\n        ...this.nightDeferred.map(q=>({id:q.id,label:labelOf(q)+'(夜间暂停)'})),");
  edit('executor.ts',"hold: this.restOnly ? '夜间最高优先", '      hold: this.holdReason() ?? this.opts.busyWith?.() ?? null,', "      hold: this.restOnly ? '夜间最高优先：回家睡觉，普通工作暂停' : (this.holdReason() ?? this.opts.busyWith?.() ?? null),");
  let sawDeferredLine=false;
  ex.text=ex.text.split('\n').filter(line=>{if(!line.includes('...this.nightDeferred.map(q=>'))return true;if(sawDeferredLine)return false;sawDeferredLine=true;return true;}).join('\n');
  edit('executor.ts','clear(): string | null {\n    for', '  clear(): string | null {', "  clear(): string | null {\n    for(const q of this.nightDeferred.splice(0))this.reportCancelled(q,'清空夜间暂存任务',null);");
  edit('executor.ts',"'连接丢失，撤销夜间暂存'", "  onConnectionLost(reason = 'Minecraft 连接断开'): void {", "  onConnectionLost(reason = 'Minecraft 连接断开'): void {\n    for(const q of this.nightDeferred.splice(0))this.reportCancelled(q,'连接丢失，撤销夜间暂存',null);");
  edit('executor.ts',"'停机撤销夜间暂存'",'  shutdown(): void {',"  shutdown(): void {\n    for(const q of this.nightDeferred.splice(0))this.reportCancelled(q,'停机撤销夜间暂存',null);");
  edit('executor.ts','nightRest: task.nightRest','    const ctx: SkillContext = {','    const ctx: SkillContext = {\n      nightRest: task.nightRest,');
  edit('skill-context.ts','  nightRest?: boolean;', 'export interface SkillContext {','export interface SkillContext {\n  /** 用户夜间优先专用任务，不能由模型工具参数设置。 */\n  nightRest?: boolean;');
  edit('skills-interact.ts','const wakeLimit = ctx.nightRest', '    while (bot.isSleeping === true && Date.now() - from < BED_WAKE_MS && !ctx.aborted()) {', '    const wakeLimit = ctx.nightRest ? 12 * 60_000 : BED_WAKE_MS;\n    while (bot.isSleeping === true && Date.now() - from < wakeLimit && !ctx.aborted()) {');
  edit('skills-gather.ts',"from './home-life.ts'", "import { Vec3 } from 'vec3';", "import { Vec3 } from 'vec3';\nimport { homeDigDenied } from './home-life.ts';");
  edit('skills-gather.ts','const homeFiltered =', '    const found = visibleBlocks(bot, ids, 48);', '    const visible = visibleBlocks(bot, ids, 48);\n    const found = visible.filter(p=>!homeDigDenied(bot,[p.x,p.y,p.z]));\n    const homeFiltered = visible.length - found.length;\n    if(found.length===0 && homeFiltered>0)throw new SkillBlocked(\'可见材料都在住宅保护范围内，不能拆柱子或墙取材，请去外部资源区。\');');
  edit('ENV_PROMPT.md','## 家的保护与夜间优先', '{{minecraft.home}}', '{{minecraft.home}}\n\n## 家的保护与夜间优先\n用户已要求：夜间最高普通事务优先级是回家睡自己的床。程序在游戏12000刻开始暂停旧任务，12542刻后使用自己的床；普通mc_do/mc_scout/now和mc_stop都不能打断，直到天亮。即时攻击/溺水/岩浆先脱险，随后继续回家。床不可用或路径受阻时留在安全处，报告原因，不去下矿或采集。mc_home query能读保护边界和夜间状态。家的范围禁止挖掘（含采集、通道和寻路），请走门或绕路；旧登记默认覆盖设施包围盒外扩水平6格、下2格、上6格，用户可确认精确边界后用protect调整，不能为普通任务绕过保护。\n');
  const copies=['home.ts','home-life.ts'].map(name=>({from:path.join(root,'addons/minecraft-home/src',name),to:path.join(mc,name)}));
  for(const c of copies)if(!fs.existsSync(c.from))throw Error('缺少自有模块：'+path.basename(c.from));
  if(check){const drift=[...files].filter(([,i])=>i.text!==i.original).map(([file])=>path.basename(file));const stale=copies.filter(c=>!fs.existsSync(c.to)||!fs.readFileSync(c.from).equals(fs.readFileSync(c.to))).map(c=>path.basename(c.to));if(drift.length||stale.length)throw Error('住宅生活补丁未安装或不是最新：'+[...drift,...stale].join(','));console.log('住宅保护/夜间补丁检查通过，未写盘');}
  else{for(const [file,item]of files)if(item.original!==item.text){if(!fs.existsSync(file+'.minecraft-home-life.orig'))fs.copyFileSync(file,file+'.minecraft-home-life.orig');fs.writeFileSync(file,item.text);}for(const c of copies)fs.copyFileSync(c.from,c.to);console.log('住宅保护与夜间优先已安装，未启停bot');}
}catch(e){console.error(e.message);process.exit(1);}
