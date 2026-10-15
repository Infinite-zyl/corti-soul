/** 住宅建筑账本及现成工作站复用；全部锚点预检后安装。 */
import fs from 'node:fs';
import path from 'node:path';
const root=path.resolve(import.meta.dirname,'..');
const mc=path.join(path.resolve(process.env.CORTICO_ROOT??path.join(root,'../cortico-qq')),'src/worlds/minecraft');
const check=process.argv.includes('--check');
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
  edit('world.ts','type BuildingRecord, radiusBox',"type HomeObserver, type Point } from './home.ts'","type HomeObserver, type Point, type BuildingRecord, radiusBox } from './home.ts'");
  edit('world.ts','buildings:BuildingRecord[];broken',"home:ReturnType<HomeBook['get']>;broken:boolean}","home:ReturnType<HomeBook['get']>;buildings:BuildingRecord[];broken:boolean}");
  edit('world.ts','buildings:this.homeBook.buildings(realm)',"home:this.homeBook.get(realm),broken:false","home:this.homeBook.get(realm),buildings:this.homeBook.buildings(realm),broken:false");
  edit('world.ts','home:null,buildings:[]','home:null,broken:true','home:null,buildings:[],broken:true');
  edit('world.ts','this.homeProtectionCache.buildings.some',
    'return this.homeProtectionCache.broken || protectedHomeCell(this.homeProtectionCache.home, normalizeDimension(this.bridge?.bot?.game?.dimension), [x,y,z]);',
    `const dimension=normalizeDimension(this.bridge?.bot?.game?.dimension);
    return this.homeProtectionCache.broken || protectedHomeCell(this.homeProtectionCache.home,dimension,[x,y,z]) || this.homeProtectionCache.buildings.some(b=>b.dimension===dimension&&[x,y,z].every((n,i)=>n>=b.protection.min[i]!&&n<=b.protection.max[i]!));`);
  edit('world.ts',"'building-save','building-remove','facilities'","['save','remove','protect']","['save','remove','protect','building-save','building-remove','facilities']");
  edit('world.ts','radiusBox(home.returnAt',"this.homeBook.protect(realm,args.protection,args.confirmation);",`const home=this.homeBook.get(realm);if(!home)throw new Error('尚未登记家');this.homeBook.protect(realm,args.protection??radiusBox(home.returnAt,args.radius),args.confirmation);`);
  edit('world.ts',"action === 'ledger'","      if (action === 'protect')",`      if (action === 'ledger') return JSON.stringify(this.homeBook.ledger(realm,observer));
      if (action === 'building-remove') {this.homeBook.removeBuilding(realm,args.name,args.dimension,args.confirmation);this.emit('minecraft.home','[Minecraft] 建筑保护登记已撤销。',false,{trigger:'piggyback'});return '建筑登记已撤销，世界方块未改动。';}
      if (action === 'protect')`);
  edit('world.ts',"action === 'building-save'","      if (action === 'survey')",`      if (action === 'building-save') {const b=this.homeBook.registerBuilding(realm,args,observer);this.emit('minecraft.home','[Minecraft] 建筑已登记：'+b.name+' '+JSON.stringify(b.protection),false,{trigger:'piggyback'});return JSON.stringify(b);}
      if (action === 'facilities') {const home=this.homeBook.addFacilities(realm,args,observer);this.emit('minecraft.home','[Minecraft] 住宅设施已补登记。',false,{trigger:'piggyback'});return JSON.stringify(home);}
      if (action === 'survey')`);
  edit('world.ts',"key: 'minecraft-home',",'export const MINECRAFT_STORAGE_DECLS: ReadonlyArray<Omit<StoragePart, \'stat\' | \'clear\'>> = [',`export const MINECRAFT_STORAGE_DECLS: ReadonlyArray<Omit<StoragePart, 'stat' | 'clear'>> = [
  {key: 'minecraft-home',label:'住宅与建筑账本',kind:'disk',location:'data/minecraft-home.json',danger:true,
    note:'登记的家、两人的床、共享设施和建筑保护边界；在「住宅与建筑」页管理。清除会删除所有存档的登记并解除对应保护。'},`);
  edit('world.ts',"'minecraft-home': {", "      'minecraft-chests': {",`      'minecraft-home': {stat:()=>this.homeBook.stat(),clear:()=>{const result=this.homeBook.clear();this.homeProtectionCache=null;return result;}},
      'minecraft-chests': {`);
  edit('world.ts',"id: 'home-ledger'",'export const MINECRAFT_PANEL_DECLS: readonly WorldPanelDecl[] = [',`export const MINECRAFT_PANEL_DECLS: readonly WorldPanelDecl[] = [
  {id: 'home-ledger',title:'住宅与建筑',description:'家、设施和建筑保护范围；现场登记，确认后保存。'},`);
  edit('world.ts',"case 'home-ledger':",'    switch (panel) {',`    switch (panel) {
      case 'home-ledger':
        if(method==='state') {const home=this.homeBook.get(this.realmKey());return {...this.homeBook.ledger(this.realmKey(),this.homeObserver()),protection:home?homeBox(home):null,realm:this.realmKey()};}
        if(method==='survey')return this.homeTool({action:'survey'});
        if(method==='change')return this.homeTool(args[0]);
        throw new Error('未知住宅账本方法');`);
  edit('proxy.ts',"key === 'minecraft-home'", "    if (key === 'minecraft-chests')", "    if (key === 'minecraft-home') return join(this.opts.dataDir, 'minecraft-home.json');\n    if (key === 'minecraft-chests')");
  edit('proxy.ts','new HomeBook(file).stat()', "    if (!file || !existsSync(file)) return '(无文件)';", "    if (key==='minecraft-home') return new HomeBook(file).stat();\n    if (!file || !existsSync(file)) return '(无文件)';");
  edit('proxy.ts','new HomeBook(file).clear()',"    writeFileSync(file, '{}\\n', 'utf8');", "    if(key==='minecraft-home')return new HomeBook(file).clear();\n    writeFileSync(file, '{}\\n', 'utf8');");
  edit('placement.ts','// Prefer existing stations', 'if (near && (carried === null || inReach)) {','// Prefer existing stations, even when carrying a spare.\n  if (near) {');
  edit('placement.ts','优先走向32格内现成工作站','优先使用可及的现成工作站，否则就地放自备工作站；没有自备时才走向现成工作站。','优先走向32格内现成工作站；没有可用的现成工作站时才放自备的。');
  edit('placement.ts','先查家中已登记设施再决定', '  if (!carried) {', `  if (near) throw new SkillBlocked(skipNote+'现成工作站在抵达时失效，请重新调查；本步没有放置备用设施。');
  // 先查家中已登记设施再决定制作新的，远处登记通过环境摘要提供。
  if (!carried) {`);
  edit('placement.ts','先调查家附近是否有已登记设施',`throw new SkillBlocked(skipNote + (near
      ? \`走到 (\${near.x}, \${near.y}, \${near.z}) 那一格,\${label}已经不在了;包里也没有。\${hint}\`
      : \`32 格内没有\${skipped.length > 0 ? '别的' : ''}\${kinds.map((k) => zhName(k)).join('或')},包里也没有。\${hint}\`));`,
    `throw new SkillBlocked(skipNote + \`32 格内没有\${kinds.map(k=>zhName(k)).join('或')},包里也没有。先调查家附近是否有已登记设施；需要新工作站时再：\${hint}\`);`);
  edit('placement.ts','走过去复用现成的那个', '包里没有${label},走过去用了现成的那个', '走过去复用现成的那个');
  edit('console/client.ts',"from './home-ledger.ts'", "import { timelinePanel } from './timeline.ts';", "import { timelinePanel } from './timeline.ts';\nimport { homeLedgerPanel } from './home-ledger.ts';");
  edit('console/client.ts',"'home-ledger': homeLedgerPanel",'    timeline: timelinePanel,',"    timeline: timelinePanel,\n    'home-ledger': homeLedgerPanel,");
  edit('ENV_PROMPT.md','## 住宅与建筑账本','{{minecraft.home}}',`{{minecraft.home}}

## 住宅与建筑账本
用户可以现场指认自动农田等建筑；先用mc_home survey说明调查中心，再与用户确认水平半径或精确min/max和用途，之后building-save。radius是中心左右各多少格（下4上16格），家protect以登记返回点为中心，建筑以附近Infinite或自己的现场位置为中心。整个范围的挖掘都被禁止，包括收获作物；开门、使用炉子/箱子不受影响。不能为普通任务自行缩小或撤销边界。mc_home ledger查询全部登记；facilities补登记已确认的共享箱、工作台、炉子。合成或熔炼前先查已有设施，附近现成的优先使用；已登记但远处/未加载的先走近核验，不把未加载当作没有，不先造第二个。登记仅代表历史事实和用户授权保护，不保证当前设施仍在。
`);
  const copies=[['src/home.ts','home.ts'],['src/home-life.ts','home-life.ts'],['console/home-ledger.ts','console/home-ledger.ts']].map(([a,b])=>({from:path.join(root,'addons/minecraft-home',a),to:path.join(mc,b)}));
  for(const c of copies)if(!fs.existsSync(c.from))throw Error('缺少模块 '+c.from);
  if(check){const drift=[...files].filter(([,i])=>i.original!==i.text).map(([f])=>path.basename(f));const stale=copies.filter(c=>!fs.existsSync(c.to)||!fs.readFileSync(c.from).equals(fs.readFileSync(c.to))).map(c=>path.basename(c.to));if(drift.length||stale.length)throw Error('补丁未安装或过期：'+[...drift,...stale].join(','));console.log('住宅建筑账本检查通过，未写盘');}
  else{for(const [file,i] of files)if(i.original!==i.text){if(!fs.existsSync(file+'.minecraft-home-ledger.orig'))fs.copyFileSync(file,file+'.minecraft-home-ledger.orig');fs.writeFileSync(file,i.text);}for(const c of copies)fs.copyFileSync(c.from,c.to);console.log('住宅建筑账本已安装，未启动bot');}
}catch(error){console.error(error.message);process.exit(1);}
