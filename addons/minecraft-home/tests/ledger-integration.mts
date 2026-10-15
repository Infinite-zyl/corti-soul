/** 实际World及工作站选择接线；假身体，无服务/模型。 */
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createRequire} from 'node:module';
const root=resolve(process.env.CORTICO_ROOT??resolve(import.meta.dirname,'../../../../cortico-qq'));
const load=(n:string)=>import(pathToFileURL(join(root,'src/worlds/minecraft',n)).href);
const {MinecraftWorld}=await load('world.ts'),{MinecraftWorldProxy}=await load('proxy.ts');
const {MINECRAFT_DEFAULTS}=await load('config.ts');
const require=createRequire(join(root,'package.json'));const {Vec3}=require('vec3');
const dir=mkdtempSync(join(tmpdir(),'mc-ledger-world-'));
try{
 const cfg=structuredClone(MINECRAFT_DEFAULTS);cfg.local.serverDir='';
 const world=new MinecraftWorld({cfg,dataDir:dir});
 const bot={entity:{position:new Vec3(0,64,0)},players:{Infinite:{entity:{position:new Vec3(20,64,0)}}},game:{dimension:'minecraft:overworld'},time:{timeOfDay:0},blockAt:()=>null};
 world.bridge={connected:true,bot};
 const out=world.homeTool({action:'building-save',name:'自动农田',radius:5,confirmation:'用户确认农田左右5格'});assert.ok(!out.startsWith('[mc_home'),out);
 assert.equal(world.homeProtectedCell(20,64,0),true);assert.equal(world.homeProtectedCell(25,80,5),true);assert.equal(world.homeProtectedCell(26,64,0),false);
 bot.game.dimension='minecraft:the_nether';assert.equal(world.homeProtectedCell(20,64,0),false);bot.game.dimension='minecraft:overworld';
 const panel=await world.invokePanel('home-ledger','state',[]);assert.equal(panel.buildings[0].name,'自动农田');assert.equal(panel.home.registered,false);
 const bookRow=world.storageParts().find((s:{key:string})=>s.key==='minecraft-home');assert.match(bookRow.stat(),/1 项建筑/);
 const proxy=new MinecraftWorldProxy({cfg,dataDir:dir});assert.match(proxy.storageStatOffline('minecraft-home'),/1 项建筑/);
 assert.match(await proxy.storageClear('minecraft-home'),/已清空/);
 world.homeProtectionCache=null;assert.equal(world.homeProtectedCell(20,64,0),false);
 assert.equal((await world.invokePanel('home-ledger','state',[])).buildings.length,0);
 await assert.rejects(world.invokePanel('home-ledger','unknown',[]),/未知/);
 console.log('实际World/离线代理：建筑登记、含边界保护、维度隔离、账本面板、存储状态及合法清除通过。');
 const {ensureStation,CRAFTING_STATION}=await load('placement.ts');
 const stationPos=new Vec3(12,64,0);let walks=0;
 const stationBot={entity:{position:new Vec3(0,64,0)},inventory:{items:()=>[{name:'crafting_table',count:1}]},registry:{blocksByName:{crafting_table:{id:1}}},
   findBlocks:()=>[stationPos],blockAt:()=>({name:'crafting_table',position:stationPos}),
   pathfinder:{goto:async(goal:{x:number;y:number;z:number})=>{walks++;stationBot.entity.position=new Vec3(goal.x,goal.y,goal.z);}},
 };
 const ctx={aborted:()=>false,taskId:1};
 const reused=await ensureStation(stationBot,CRAFTING_STATION,ctx);
 assert.equal(reused.placed,false);assert.equal(reused.x,12);assert.equal(walks,1);assert.match(reused.note,/复用/);
 stationBot.entity.position=new Vec3(0,64,0);let reads=0;
 stationBot.blockAt=()=>++reads===1?{name:'crafting_table',position:stationPos}:null;
 await assert.rejects(ensureStation(stationBot,CRAFTING_STATION,ctx),/失效/);
 console.log('实际ensureStation：背包有备用工作台仍走向12格外现成设施；抵达失效不再放备用。');
}finally{rmSync(dir,{recursive:true,force:true});}
