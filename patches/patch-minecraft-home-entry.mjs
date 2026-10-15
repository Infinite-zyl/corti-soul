/** 门登记与局部进出路线；全部锚点预检后安装。 */
import fs from 'node:fs';import path from 'node:path';
const root=path.resolve(import.meta.dirname,'..'),mc=path.join(path.resolve(process.env.CORTICO_ROOT??path.join(root,'../cortico-qq')),'src/worlds/minecraft');
const check=process.argv.includes('--check'),files=new Map();if(process.argv.slice(2).some(x=>x!=='--check'))throw Error('只支持--check');
function edit(name,marker,anchor,replacement){const file=path.join(mc,name);let i=files.get(file);if(!i){const original=fs.readFileSync(file,'utf8');i={original,text:original};files.set(file,i);}if(i.text.includes(marker))return;if(i.text.split(anchor).length!==2)throw Error(name+'锚点不匹配：'+marker);i.text=i.text.replace(anchor,replacement);}
try{
 edit('world.ts','solid: block.boundingBox', 'properties: block.getProperties() } : null;',"properties: block.getProperties(), solid: block.boundingBox === 'block' } : null;");
 edit('world.ts',"|| block.name.endsWith('_door')", "block.name.endsWith('_bed') || ['chest'", "block.name.endsWith('_bed') || block.name.endsWith('_door') || ['chest'");
 edit('world.ts',"'facilities','entrance'","'building-remove','facilities'].includes","'building-remove','facilities','entrance'].includes");
 edit('world.ts',"action === 'entrance'","      if (action === 'building-save')",`      if (action === 'entrance') {const home=this.homeBook.setEntrance(realm,args,observer);this.emit('minecraft.home','[Minecraft] 家门及内外落脚点已登记。',false,{trigger:'piggyback'});return JSON.stringify(home);}
      if (action === 'building-save')`);
 edit('world.ts','homeEntrance: () =>', '      homeCell: (x,y,z) => this.homeProtectedCell(x,y,z),', '      homeCell: (x,y,z) => this.homeProtectedCell(x,y,z),\n      homeEntrance: () => this.homeBook.get(this.realmKey()),');
 edit('bridge.ts',"from './home-entry.ts'","import { installHomeDigGuard } from './home-life.ts';","import { installHomeDigGuard } from './home-life.ts';\nimport { installHomeEntry } from './home-entry.ts';\nimport type { HomeRecord } from './home.ts';");
 edit('bridge.ts','  homeEntrance?:', 'interface BridgeOptions {','interface BridgeOptions {\n  homeEntrance?: () => HomeRecord|null;');
 edit('bridge.ts','    installHomeEntry(', '    installHomeDigGuard(bot, ([x,y,z]) => this.opts.homeCell?.(x,y,z) ?? false);','    installHomeDigGuard(bot, ([x,y,z]) => this.opts.homeCell?.(x,y,z) ?? false);\n    installHomeEntry(bot,()=>this.opts.homeEntrance?.()??null);');
 edit('travel.ts',"from './home-entry.ts'","import { noteFailedUnwedge } from './autonomy.ts';","import { noteFailedUnwedge } from './autonomy.ts';\nimport { throughHomeEntry } from './home-entry.ts';");
 edit('travel.ts','const registeredHomeTarget=', 'export async function gotoGoal(bot: Bot, goal: InstanceType<typeof goals.Goal>, ctx: SkillContext): Promise<void> {',`export async function gotoGoal(bot: Bot, goal: InstanceType<typeof goals.Goal>, ctx: SkillContext): Promise<void> {
  const registeredHomeTarget=goal as unknown as {x?:number;y?:number;z?:number};
  if(['GoalNear','GoalBlock','GoalNearXZ'].includes(goal.constructor.name)&&[registeredHomeTarget.x,registeredHomeTarget.z].every(n=>typeof n==='number')){
    const p=bot.entity.position;
    const dim=String(bot.game?.dimension??'overworld').replace(/^minecraft:/,'');
    await throughHomeEntry(bot,'minecraft:'+dim,[p.x,p.y,p.z],[registeredHomeTarget.x!,registeredHomeTarget.y??p.y,registeredHomeTarget.z!],{
      go:async(at)=>{checkAbort(ctx);await gotoGoal(bot,new goals.GoalBlock(...at),ctx);},
      open:async(at,kind)=>{
        checkAbort(ctx);const read=()=>bot.blockAt(new Vec3(...at));let door=read();
        if(!door||door.name!==kind)throw new SkillBlocked('登记家门未加载或已变动，请重新核验；没有拆墙或传送。');
        if(door.getProperties().open===true||door.getProperties().open==='true')return;
        await bot.activateBlock(door);
        for(let n=0;n<8;n++){await sleep(100);checkAbort(ctx);door=read();if(door?.name===kind&&(door.getProperties().open===true||door.getProperties().open==='true'))return;}
        throw new SkillBlocked('登记家门尚未确认打开，请检查门控或内外落脚点；没有重复开关门。');
      },
    });
  }`);
 edit('ENV_PROMPT.md','## 登记家门与通行','{{minecraft.home}}',`{{minecraft.home}}

## 登记家门与通行
大门必须由用户现场指认。mc_home survey会列木门候选；请用户站在门外一至三格，确认所选门后用action:entrance、at和confirmation登记，outside默认取Infinite当前站位，inside默认门对侧一格；特殊台阶可明确inside/outside，必须可站立。多门不猜归属。查询会给门内外落脚点；进出家的局部跨门路线会先到同侧落脚点、确认开门、穿到对侧再继续，不拆门或墙。门改动/未加载/开门未确认会受阻；核对入口，不反复提交九步耕种任务。铁门暂不支持自动家门路线。
`);
 const copies=['home.ts','home-entry.ts'].map(n=>({from:path.join(root,'addons/minecraft-home/src',n),to:path.join(mc,n)}));copies.push({from:path.join(root,'addons/minecraft-home/console/home-ledger.ts'),to:path.join(mc,'console/home-ledger.ts')});
 if(check){const bad=[...files].filter(([,i])=>i.text!==i.original).map(([f])=>path.basename(f));for(const c of copies)if(!fs.existsSync(c.to)||!fs.readFileSync(c.from).equals(fs.readFileSync(c.to)))bad.push(path.basename(c.to));if(bad.length)throw Error('家门补丁未安装/过期：'+bad.join(','));console.log('家门补丁检查通过');}
 else{for(const [f,i]of files)if(i.text!==i.original){if(!fs.existsSync(f+'.minecraft-home-entry.orig'))fs.copyFileSync(f,f+'.minecraft-home-entry.orig');fs.writeFileSync(f,i.text);}for(const c of copies)fs.copyFileSync(c.from,c.to);console.log('家门补丁已安装，未启停bot');}
}catch(e){console.error(e.message);process.exit(1);}
