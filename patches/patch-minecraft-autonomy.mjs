/** 脱困传送、夜间请求合并、持久生活工程。锚点全部预检后写入。 */
import fs from 'node:fs';import path from 'node:path';
const root=path.resolve(import.meta.dirname,'..'),mc=path.join(path.resolve(process.env.CORTICO_ROOT??path.join(root,'../cortico-qq')),'src/worlds/minecraft');
const check=process.argv.includes('--check');if(process.argv.slice(2).some(x=>x!=='--check'))throw Error('只支持--check');
const files=new Map();function edit(name,marker,anchor,replacement){const file=path.join(mc,name);let i=files.get(file);if(!i){const original=fs.readFileSync(file,'utf8');i={original,text:original};files.set(file,i);}if(i.text.includes(marker))return;if(i.text.split(anchor).length!==2)throw Error(name+'锚点不匹配：'+marker);i.text=i.text.replace(anchor,replacement);}
try{
 edit('world.ts',"from './autonomy.ts'","import { homeBox, protectedHomeCell, NightRest } from './home-life.ts';","import { homeBox, protectedHomeCell, NightRest } from './home-life.ts';\nimport { claimStuckTeleport, isHomeRestRequest } from './autonomy.ts';\nimport { ProjectBook, MINECRAFT_PROJECT_TOOL } from './projects.ts';");
 edit('world.ts','  MINECRAFT_PROJECT_TOOL,','  MINECRAFT_HOME_TOOL,','  MINECRAFT_HOME_TOOL,\n  MINECRAFT_PROJECT_TOOL,');
 edit('world.ts','private readonly projectBook:','  private readonly homeBook: HomeBook;','  private readonly homeBook: HomeBook;\n  private readonly projectBook: ProjectBook;');
 edit('world.ts',"new ProjectBook(ledger('minecraft-projects.json'))","    this.homeBook = new HomeBook(ledger('minecraft-home.json'));","    this.homeBook = new HomeBook(ledger('minecraft-home.json'));\n    this.projectBook = new ProjectBook(ledger('minecraft-projects.json'));");
 edit('world.ts','mc_project: async',"      mc_home: async (args) => this.toolLog('mc_home', args, this.homeTool(args)),",`      mc_home: async (args) => this.toolLog('mc_home', args, this.homeTool(args)),
      mc_project: async (args) => {
        try {if(args.action!==undefined&&args.action!=='query'&&args.action!=='save')throw new Error('action仅支持query/save');
          const value=args.action==='save'?this.projectBook.save(this.realmKey(),args):this.projectBook.get(this.realmKey());
          return this.toolLog('mc_project',args,JSON.stringify(value??{message:this.projectBook.summary(this.realmKey())}));
        } catch(e){return this.toolLog('mc_project',args,'[mc_project 失败] '+String(e));}
      },`);
 edit('world.ts','const teleportDenied=claimStuckTeleport', '    const marks = this.markTable().list;\n    return runEscape({', `    const teleportDenied=claimStuckTeleport(bot);if(teleportDenied)return teleportDenied;
    const marks = this.markTable().list;
    return runEscape({`);
 edit('world.ts','夜间同目的请求合并', '    this.nightRestTick(); // 夜间接单前同步优先级，不等下一秒心跳。', `    this.nightRestTick(); // 夜间接单前同步优先级，不等下一秒心跳。
    // 夜间同目的请求合并，不重复入队，不打断已在进行的睡床。
    if(this.nightRest.active){
      try{if(isHomeRestRequest(parsed.steps,this.homeBook.get(this.realmKey())))return this.toolLog(name,args,'[休息请求已合并] 夜间执行器正在处理回家/自己的床：'+this.nightRest.state+'。无需再下同一单或查询队列，等待入睡/天亮/受阻状态事件。');}catch{ /* 原登记错误由正常工具回执报告。 */ }
    }`);
 edit('world.ts',"'minecraft.home': this.homeBook.summary(this.realmKey()) +", "'minecraft.home': this.homeBook.summary(this.realmKey()),", "'minecraft.home': this.homeBook.summary(this.realmKey()) + '\\n' + this.projectBook.summary(this.realmKey()),");
 edit('world.ts','const home = this.homeBook.summary(this.realmKey()) +','const home = this.homeBook.summary(this.realmKey());',"const home = this.homeBook.summary(this.realmKey()) + '\\n' + this.projectBook.summary(this.realmKey());");
 edit('world.ts',"key: 'minecraft-projects'",'export const MINECRAFT_STORAGE_DECLS: ReadonlyArray<Omit<StoragePart, \'stat\' | \'clear\'>> = [',`export const MINECRAFT_STORAGE_DECLS: ReadonlyArray<Omit<StoragePart, 'stat' | 'clear'>> = [
  {key: 'minecraft-projects',label:'生活工程进度',kind:'disk',location:'data/minecraft-projects.json',note:'按存档保存当前生活工程、阶段、下一步及回执；由模型登记，不等于已核验完成。清除删除进度，不撤销World的默认生活目标。'},`);
 edit('world.ts',"'minecraft-projects': {","      'minecraft-home': {","      'minecraft-projects': {stat:()=>this.projectBook.stat(),clear:()=>this.projectBook.clear()},\n      'minecraft-home': {");
 edit('world.ts','Only available after the movement executor', 'Cheat: teleport to the NEAREST safe anchor', 'Only available after the movement executor has confirmed sustained no movement and failed mechanical unwedging at your current position within 90 seconds; one attempt per 5 minutes. Never use for commuting, nightfall, hunger or ordinary blocked paths. No evidence means no teleport or queue changes. Teleport to the NEAREST safe anchor');
 edit('world.ts','Report the reason and resulting position', 'Say something to the audience first.', 'Report the reason and resulting position when used.');
 edit('travel.ts',"from './autonomy.ts'","import { Vec3 } from 'vec3';","import { Vec3 } from 'vec3';\nimport { noteFailedUnwedge } from './autonomy.ts';");
 edit('travel.ts','attempt > 0) {noteFailedUnwedge', 'if (attempt > 0) throw stallBlocked(bot, err.stall, unwedged);','if (attempt > 0) {noteFailedUnwedge(bot);throw stallBlocked(bot, err.stall, unwedged);}');
 edit('travel.ts','unwedged < UNWEDGE_MOVED) {noteFailedUnwedge', 'if (unwedged < UNWEDGE_MOVED) throw stallBlocked(bot, err.stall, unwedged);','if (unwedged < UNWEDGE_MOVED) {noteFailedUnwedge(bot);throw stallBlocked(bot, err.stall, unwedged);}');
 edit('proxy.ts',"from './projects.ts'","import { HomeBook, homeRealmKey } from './home.ts';","import { HomeBook, homeRealmKey } from './home.ts';\nimport { ProjectBook } from './projects.ts';");
 edit('proxy.ts',"new ProjectBook(this.opts.dataDir", "return new HomeBook(this.opts.dataDir ? join(this.opts.dataDir, 'minecraft-home.json') : null).summary(realm);", "return new HomeBook(this.opts.dataDir ? join(this.opts.dataDir, 'minecraft-home.json') : null).summary(realm) + '\\n' + new ProjectBook(this.opts.dataDir ? join(this.opts.dataDir, 'minecraft-projects.json') : null).summary(realm);");
 edit('proxy.ts',"key === 'minecraft-projects'", "    if (key === 'minecraft-home') return", "    if (key === 'minecraft-projects') return join(this.opts.dataDir,'minecraft-projects.json');\n    if (key === 'minecraft-home') return");
 edit('proxy.ts','new ProjectBook(file).stat()',"    if (key==='minecraft-home') return", "    if (key==='minecraft-projects') return new ProjectBook(file).stat();\n    if (key==='minecraft-home') return");
 edit('proxy.ts','new ProjectBook(file).clear()',"    if(key==='minecraft-home')return", "    if(key==='minecraft-projects')return new ProjectBook(file).clear();\n    if(key==='minecraft-home')return");
 edit('ENV_PROMPT.md','## 自己的生活与受阻改计划','{{minecraft.home}}',`{{minecraft.home}}

## 自己的生活与受阻改计划
用户提出的当前生活方向是建立自己的稳定食物来源，可在保护区外自行规划并打造小农场。先调查地形、水源、种子和工具；选址不使用用户住宅、农田、牧场的保护格，正常做耕地/种植后由成果账本记录。先用mc_project保存你选择的工程阶段和下一步，依据填真实回执或当前尚未开工的事实；mc_goal只作暂态投影。夜间暂停、天亮继续，用户离线不等于取消你的工作；可以交流，不必因他离线停工。由你选步骤，不需要为每个普通生活动作等待用户派活。
建筑归属user默认只表示保护，未委托经营的用户农田/牧场不是你的收获、维修或调查待办。已有旧笔记里“等用户解除保护才能收菜”的判断不再作为自己的目标；不要改写个人记忆，由你核对后自行修正。自己的新农场应选在保护区外，不以撤销保护解决资源问题。
必须按最新执行回执解释失败：没看见成熟小麦不等于被保护拦截；未加载不等于不存在。相同原因受阻后，保存原因、改地点/方法或转其他可行阶段，不重复同一失败动作。缺少现成农田可以自己开垦，不必四处寻找别人的成熟小麦。
夜间回家和睡自己的床由执行器安排；收到“休息请求已合并”或普通任务延后后end_turn，等入睡/天亮/受阻事件，不反复mc_do、mc_queue或用TP绕过夜间优先。mc_escape仅接受实际执行器脱困失败的近期证据，模型说卡住不算证据；普通危险先用步行求生，不能把TP当回城技能。
`);
 const copies=['home.ts','home-life.ts','autonomy.ts','projects.ts'].map(n=>({from:path.join(root,'addons/minecraft-home/src',n),to:path.join(mc,n)}));copies.push({from:path.join(root,'addons/minecraft-home/console/home-ledger.ts'),to:path.join(mc,'console/home-ledger.ts')});
 for(const c of copies)if(!fs.existsSync(c.from))throw Error('缺少模块'+c.from);
 if(check){const changed=[...files].filter(([,i])=>i.text!==i.original).map(([f])=>path.basename(f));const stale=copies.filter(c=>!fs.existsSync(c.to)||!fs.readFileSync(c.from).equals(fs.readFileSync(c.to))).map(c=>path.basename(c.to));if(changed.length||stale.length)throw Error('自主生活补丁未安装/过期：'+[...changed,...stale].join(','));console.log('自主生活补丁检查通过');}
 else{for(const [file,i]of files)if(i.original!==i.text){if(!fs.existsSync(file+'.minecraft-autonomy.orig'))fs.copyFileSync(file,file+'.minecraft-autonomy.orig');fs.writeFileSync(file,i.text);}for(const c of copies)fs.copyFileSync(c.from,c.to);console.log('自主生活补丁已安装，未启停bot');}
}catch(e){console.error(e.message);process.exit(1);}
