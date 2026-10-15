/** 假世界验证World秒心跳接线，不调用start或网络。 */
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
const root=resolve(process.env.CORTICO_ROOT??resolve(import.meta.dirname,'../../../../cortico-qq'));
const load=(name:string)=>import(pathToFileURL(resolve(root,'src/worlds/minecraft',name)).href);
const {MinecraftWorld}=await load('world.ts');const {Executor}=await load('executor.ts');
const {HomeBook}=await load('home.ts');const {MINECRAFT_DEFAULTS}=await load('config.ts');
const dir=mkdtempSync(join(tmpdir(),'world-home-life-'));
try{
  const cfg=structuredClone(MINECRAFT_DEFAULTS);cfg.local.serverDir='';
  const blocks=new Map([
    ['1,64,1',{name:'red_bed',properties:{facing:'south',part:'foot',occupied:false}}],
    ['1,64,2',{name:'red_bed',properties:{facing:'south',part:'head',occupied:false}}],
  ]);
  new HomeBook(join(dir,'minecraft-home.json')).save(`weak:${cfg.host}:${cfg.port}|`,{
    name:'家',confirmation:'用户确认自己的床',facilities:[{at:[1,64,1],role:'own-bed'}],
  },{dimension:'minecraft:overworld',position:[0,64,0],playerPosition:null,read:(p:number[])=>blocks.get(p.join(','))??null,candidates:()=>[]});
  const bot={entity:{position:{x:20,y:64,z:20}},game:{dimension:'minecraft:overworld'},time:{timeOfDay:13000},players:{},health:20,isSleeping:false,
    blockAt:(v:{x:number;y:number;z:number})=>{const b=blocks.get([v.x,v.y,v.z].join(','));return b?{name:b.name,getProperties:()=>b.properties}:null;},
  };
  let id=0;const ex=new Executor({getBot:()=>null,nextId:()=>++id,report(){},log:{info(){},warn(){},error(){},debug(){}}});ex.run=async()=>{};
  const world=new MinecraftWorld({cfg,dataDir:dir});world.bridge={connected:true,bot};world.executor=ex;
  assert.equal(world.homeProtectedCell(3,65,3),true);assert.equal(world.homeProtectedCell(30,64,30),false);
  world.nightRestTick();assert.equal(ex.task.nightRest,true);assert.deepEqual(ex.task.steps.at(-1).at,[1,64,2]);
  const restTask=ex.task;
  assert.match(await world.doEscape(),/传送未执行/);assert.equal(ex.task,restTask);
  const merged=world.enqueueTool('mc_do',{steps:[{skill:'goto',at:[0,64,0]},{skill:'use',at:[1,64,2]}]},(steps:unknown)=>({steps}));
  assert.match(merged,/休息请求已合并/);assert.equal(ex.task,restTask);
  assert.match(world.enqueueTool('mc_do',{steps:[{skill:'collect',block:'wheat',count:1}]},(steps:unknown)=>({steps})),/没有接单/);
  const projectTool=world.tools().find((t:{name:string})=>t.name==='mc_project');assert.ok(projectTool);
  const saved=await projectTool.handler({action:'save',name:'自建食物来源',stage:'选址',next:'调查保护区外水源',status:'active',evidence:'尚未开工'});
  assert.match(String(saved),/选址/);
  const rebuilt=new MinecraftWorld({cfg,dataDir:dir});
  assert.equal(rebuilt.projectBook.get('weak:'+cfg.host+':'+cfg.port+'|').name,'自建食物来源');
  assert.match(ex.submit([{skill:'goto',at:[30,64,30]}],'now'),/没有接单/);
  const state=JSON.parse(world.homeTool({}));assert.equal(state.nightRest.active,true);assert.ok(state.protection);
  bot.time.timeOfDay=0;world.nightRestTick();assert.equal(ex.task,null);
  bot.time.timeOfDay=13000;bot.entity.position={x:0,y:64,z:0};blocks.get('1,64,2')!.properties.occupied=true;
  world.nightRestTick();assert.equal(ex.task,null);assert.match(JSON.parse(world.homeTool({})).nightRest.state,/占用/);
  ex.shutdown();console.log('实际World：保护范围、自动夜间接管、自己的床、拒绝抢占、天亮解除和占用等待通过。无bot start/无模型。');
}finally{rmSync(dir,{recursive:true,force:true});}
