/** Install bounded public life arrangements; anchors are validated before writes. */
import fs from 'node:fs';import path from 'node:path';
const repo=path.resolve(import.meta.dirname,'..');
const root=path.resolve(process.env.CORTICO_ROOT??JSON.parse(fs.readFileSync(path.join(repo,'runtime-selection.json'),'utf8')).corticoRoot);
if(JSON.parse(fs.readFileSync(path.join(root,'package.json'),'utf8')).version!=='0.2.1')throw Error('Only Cortico 0.2.1 is adapted');
const mc=path.join(root,'src/worlds/minecraft'),changes=new Map();
function edit(name,marker,anchor,replacement){const file=path.join(mc,name);let x=changes.get(file);if(!x){const original=fs.readFileSync(file,'utf8').replaceAll('\r\n','\n');x={original,text:original};changes.set(file,x);}if(x.text.includes(marker))return;if(x.text.split(anchor).length!==2)throw Error('Life anchor mismatch: '+name+' '+marker);x.text=x.text.replace(anchor,replacement);}
edit('world.ts',"from './life-runtime.ts'","import { ProjectBook, MINECRAFT_PROJECT_TOOL } from './projects.ts';","import { ProjectBook, MINECRAFT_PROJECT_TOOL } from './projects.ts';\nimport type { LifeRuntime } from './life-runtime.ts';");
edit('world.ts','private lifeRuntime:', '  private readonly projectBook: ProjectBook;',`  private readonly projectBook: ProjectBook;
  private lifeRuntime: LifeRuntime = {busy:true,paused:true,at:0,userKeys:[]};
  private lifeNotices: string[] = [];
  private lifeScanAt = 0;
  private lifeError = false;
  private lifeBootRealm = '';
  public updateLifeRuntime(state: LifeRuntime): void {
    this.lifeRuntime=state;
    try { for(const key of state.userKeys) {const notes=this.projectBook.signal(this.realmKey(),w=>w.kind==='user'&&w.senderKey===key);if(notes.length)this.emit('minecraft.home','[生活接续] '+notes.join('；'),false,{trigger:'piggyback'});} } catch { }
  }
  public lifeTurnEnded(): void { try {this.projectBook.settled(this.realmKey());} catch { } }
  public lifeHandoff(): void {this.emit('minecraft.home',this.projectBook.summary(this.realmKey()),false,{trigger:'piggyback'});}
  private lifeTick(): void {
    const now=Date.now(),bot=this.bridge?.bot,realm=this.realmKey();
    const paused=!this.bridge?.connected||this.shuttingDown||this.reconnectPaused!==null||this.nightRest.active||bot?.isSleeping===true||this.lifeRuntime.paused||now-this.lifeRuntime.at>10000;
    const q=this.executor?.status(),busy=this.lifeRuntime.busy||!!q?.running||!!q?.waiting.length||!!q?.hold||!!this.combat?.active||!!this.reflexes?.envActive;
    try {
      if(this.lifeBootRealm!==realm&&!paused){this.lifeBootRealm=realm;this.projectBook.settled(realm);this.lifeHandoff();}
      const notice=this.projectBook.tick(realm,{now,paused,busy});
      if(notice)this.lifeNotices.push(notice);
      if(!paused&&now-this.lifeScanAt>=10000){
        this.lifeScanAt=now;
        this.lifeNotices.push(...this.projectBook.signal(realm,w=>{
          if(w.kind!=='crop'||!w.at||w.dimension!==normalizeDimension(bot?.game?.dimension))return false;
          const block=bot?.blockAt(new Vec3(w.at[0]!,w.at[1]!,w.at[2]!));
          if(!block)return false;
          const max:Record<string,number>={wheat:7,carrots:7,potatoes:7,beetroots:3};return block.name in max&&Number(block.getProperties().age)>=max[block.name]!;
        },now));
      }
      if(!paused&&!busy&&this.lifeNotices.length){const notes=[...new Set(this.lifeNotices)].slice(0,8);this.lifeNotices=[];this.emit('minecraft.home','[生活接续] '+notes.join('\\n')+'\\n'+this.projectBook.summary(realm),false);}
      this.lifeError=false;
    }catch(e){if(!this.lifeError){this.lifeError=true;this.host?.log.warn('生活接续暂停；原游戏心跳继续',{err:String(e)});}}
  }
`);
edit('world.ts','    this.lifeTick();','    this.nightRestTick();\n    const time = bot.time?.timeOfDay ?? 0;','    this.nightRestTick();\n    this.lifeTick();\n    const time = bot.time?.timeOfDay ?? 0;');
edit('world.ts','life:{...this.projectBook.view', 'last:this.lastFinishedTask}));','last:this.lastFinishedTask,life:{...this.projectBook.view(this.realmKey()),paused:this.lifeRuntime.paused}}));');
edit('world.ts','this.projectBook.query(this.realmKey())','this.projectBook.get(this.realmKey());\n          return this.toolLog','this.projectBook.query(this.realmKey());\n          return this.toolLog');
edit('world.ts','this.projectBook.receipt(this.realmKey(),r)', '    this.lastFinishedTask = { at: Date.now(), kind: r.kind, text: r.text };',`    this.lastFinishedTask = { at: Date.now(), kind: r.kind, text: r.text };
    try {this.projectBook.receipt(this.realmKey(),r);if(r.taskId)this.projectBook.signal(this.realmKey(),w=>w.kind==='task'&&w.taskId===r.taskId);}catch(e){this.host?.log.warn('生活执行回执登记失败',{err:String(e)});}`);
edit('world.ts','const lifeContinuation =', "    this.emit('minecraft.task', `[执行器] ${r.text}${queue}`, r.kind !== 'cancelled');", "    const lifeContinuation = r.kind==='cancelled'?'':'\\n[生活接续] 核对结果后继续、改方法或登记等待/休息；无需重复已提交动作。'+this.projectBook.summary(this.realmKey());\n    this.emit('minecraft.task', `[执行器] ${r.text}${queue}${lifeContinuation}`, r.kind !== 'cancelled');");
edit('world.ts','note:this.projectBook.describe', "'minecraft-projects': {stat:()=>this.projectBook.stat(),clear:()=>this.projectBook.clear()},", "'minecraft-projects': {note:this.projectBook.describe(this.realmKey()),stat:()=>this.projectBook.stat(),clear:()=>this.projectBook.clear()},");
edit('world.ts', "'stat' | 'clear' | 'note'", "Record<string, Pick<StoragePart, 'stat' | 'clear'>>", "Record<string, Pick<StoragePart, 'stat' | 'clear' | 'note'>>");
edit('world.ts','this.projectBook.submitted(this.realmKey()', '    const accepted = this.executor.submit(parsed.steps, mode.mode, args.steps);', `    try {if(!this.projectBook.canSubmit(this.realmKey(),parsed.steps))return this.toolLog(name,args,'[生活接续] 同一动作刚刚受阻，请换方法，或用mc_project登记改变后的下一步/新依据再重试；不反复撞同一障碍。');}catch(e){return this.toolLog(name,args,'[生活接续] 账本读取失败，暂停新动作：'+String(e));}
    const accepted = this.executor.submit(parsed.steps, mode.mode, args.steps);
    const lifeTask = /任务#(\\d+)/.exec(accepted);
    if(lifeTask)try {this.projectBook.submitted(this.realmKey(),Number(lifeTask[1]),Date.now(),parsed.steps);}catch(e){this.host?.log.warn('生活任务关联失败',{err:String(e)});}`);
edit('world.ts','生活等待设施必须当前已加载', "          const value=args.action==='save'?this.projectBook.save", `          if(args.action==='save'&&args.wait&&typeof args.wait==='object') {
            const w=args.wait as {kind:string;at?:number[];dimension?:string};
            if(w.kind==='crop'||w.kind==='furnace') {
              const bot=this.bridge?.bot;if(!bot||w.dimension!==normalizeDimension(bot.game.dimension)||!Array.isArray(w.at)||w.at.length!==3)throw Error('生活等待设施必须当前已加载且维度一致');
              const b=bot.blockAt(new Vec3(w.at[0]!,w.at[1]!,w.at[2]!));
              if(!b||(w.kind==='crop'&&!['wheat','carrots','potatoes','beetroots'].includes(b.name))||(w.kind==='furnace'&&!['furnace','smoker','blast_furnace'].includes(b.name)))throw Error('等待坐标不是已观察到的对应设施');
            }
          }
          const value=args.action==='save'?this.projectBook.save`);
edit('world.ts', "'生活计划账本'", "language==='en'?'Life project progress':'生活工程进度'", "language==='en'?'Life plan ledger':'生活计划账本'");
edit('engine-ipc.ts',"kind: 'life-runtime'", "  | { kind: 'caps'; cognition: boolean };", "  | { kind: 'caps'; cognition: boolean }\n  | { kind: 'life-runtime'; state: import('./life-runtime.ts').LifeRuntime }\n  | { kind: 'life-ended' }\n  | { kind: 'life-handoff' };");
edit('engine-child.ts',"cast.kind === 'life-runtime'", "  const cast = msg.cast;", "  const cast = msg.cast;\n  if(cast.kind === 'life-runtime'){mod?.updateLifeRuntime(cast.state);return;}\n  if(cast.kind === 'life-ended'){mod?.lifeTurnEnded();return;}\n  if(cast.kind === 'life-handoff'){mod?.lifeHandoff();return;}");
edit('proxy.ts',"from './life-availability.ts'","import { ProjectBook } from './projects.ts';","import { ProjectBook } from './projects.ts';\nimport { providerPause } from './life-availability.ts';");
const guard=JSON.stringify(path.join(repo,'guard/upstream-guard-state.json'));
edit('proxy.ts','private lifePhase=', '  private configTimer: ReturnType<typeof setInterval> | null = null;', `  private configTimer: ReturnType<typeof setInterval> | null = null;
  private lifePhase='idle';
  private lifeCursor: number|null=null;
  private lifeStallUntil=0;
  private lifeStallAt=0;
  private lifeStallPending=false;
  onRunPhase(phase: import('../../core/types.ts').RunPhase): void {this.lifePhase=phase.state;}
  onTurnEnded(): void {this.cast({kind:'life-ended'});}
  onHandoffEnded(): void {this.cast({kind:'life-handoff'});}
  private pushLifeRuntime(): void {
    const now=Date.now(),host=this.host;if(!host)return;
    const userKeys:string[]=[];
    try {const latest=host.store.latestCursor();if(this.lifeCursor!==null){for(const e of host.store.range({fromCursor:this.lifeCursor+1,toCursor:latest,origin:'external',limit:100})){if((e.source==='qqbot'&&e.type==='qq.message')||(e.source==='minecraft'&&(e.type==='minecraft.chat')&&!e.text.startsWith('[MC 系统]')&&!e.text.startsWith('[MC 动作栏]'))){if(e.senderKey)userKeys.push(e.senderKey);}}}this.lifeCursor=latest;}catch { }
    if(host.llmStalls&&!this.lifeStallPending&&now-this.lifeStallAt>=30000){this.lifeStallAt=now;this.lifeStallPending=true;void host.llmStalls(300000).then(n=>{if(n>0)this.lifeStallUntil=Date.now()+30000;}).catch(()=>{this.lifeStallUntil=Date.now()+30000;}).finally(()=>{this.lifeStallPending=false;});}
    this.cast({kind:'life-runtime',state:{at:now,busy:this.lifePhase!=='idle',paused:this.lifePhase==='backoff'||now<this.lifeStallUntil||providerPause(this.opts.dataDir,${guard},now),userKeys:[...new Set(userKeys)]}});
  }
`);
edit('proxy.ts','    this.pushLifeRuntime();','    this.pushCapsIfChanged();\n    const json = JSON.stringify(this.opts.cfg);','    this.pushCapsIfChanged();\n    this.pushLifeRuntime();\n    const json = JSON.stringify(this.opts.cfg);');
edit('proxy.ts',"note: d.key==='minecraft-projects'",'      storage: minecraftStorageDecls(language).map((d): StoragePart => ({\n        ...d,',"      storage: minecraftStorageDecls(language).map((d): StoragePart => ({\n        ...d,\n        note: d.key==='minecraft-projects' ? this.storageCache.find(s=>s.key===d.key)?.note ?? (this.opts.dataDir?new ProjectBook(join(this.opts.dataDir,'minecraft-projects.json')).describe(this.realmForLife()):d.note) : d.note,");
// Derive the same realm used by existing home/project prefix when the engine is offline.
// The existing envPromptVars contains the authoritative identity expression.
const proxyItem=changes.get(path.join(mc,'proxy.ts'));
const match=proxyItem.text.match(/new ProjectBook\([^\n]+?\.summary\(([^\n]+)\)/);
if(!match)throw Error('Proxy realm expression unavailable');
const realmExpr=match[1];
edit('proxy.ts','private realmForLife()', '  private pushLifeRuntime(): void {', `  private realmForLife(): string {const cfg=this.opts.cfg;const world=worldIdentityOf(serverModeOf(cfg.serverMode,cfg.local.serverDir)==='local'?cfg.local.serverDir:'',cfg.host+':'+cfg.port);return homeRealmKey(cfg.local.serverDir,world.local,world.key,cfg.host+':'+cfg.port);}\n  private pushLifeRuntime(): void {`);
const copies=[['addons/minecraft-life/src/projects.ts','projects.ts'],['addons/minecraft-life/src/life-runtime.ts','life-runtime.ts'],['addons/minecraft-life/src/availability.ts','life-availability.ts'],['addons/minecraft-observer/src/state.ts','observer-state.ts']];
for(const [from] of copies)if(!fs.existsSync(path.join(repo,from)))throw Error('Missing source '+from);
if(process.argv.includes('--apply')){for(const [file,x]of changes){if(!fs.existsSync(file+'.life-continuity.orig'))fs.copyFileSync(file,file+'.life-continuity.orig');if(x.text!==x.original)fs.writeFileSync(file,x.text);}for(const [a,b]of copies)fs.copyFileSync(path.join(repo,a),path.join(mc,b));console.log('Life continuity installed; no bot started.');}
else console.log('Life continuity preflight passed; --apply required.');
