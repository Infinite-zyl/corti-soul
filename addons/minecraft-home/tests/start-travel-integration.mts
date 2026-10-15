/** 实际 travel.ts 上回放起点无路→短步→重试，以及封闭房间不一票否决。 */
import assert from 'node:assert/strict';
import {resolve,join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createRequire} from 'node:module';
const root=resolve(process.env.CORTICO_ROOT??resolve(import.meta.dirname,'../../../../cortico-qq')),require=createRequire(join(root,'package.json'));
const {Vec3}=require('vec3'),{goals}=require('mineflayer-pathfinder');
const {gotoGoal,routeNote,renderRouteMenu}=await import(pathToFileURL(join(root,'src/worlds/minecraft/travel.ts')).href);
const probes=['style','dig','walk'].map(profile=>({profile,status:'noPath',steps:0,place:0,breaks:0,endDist:5,visited:1}));
function fixture(move=true,retryFails=false,empty=false){
 let calls=0,yaw=0;const controls:Record<string,boolean>={},logs:unknown[]=[];
 const bot:any={entity:{position:new Vec3(.95,64,.5),onGround:true},health:20,entities:{},game:{dimension:'overworld'},
  look:async(y:number)=>{yaw=y},setControlState:(k:string,v:boolean)=>{controls[k]=v},
  blockAt:(p:any)=>p.y===63?{name:'stone',shapes:[[0,0,0,1,1,1]]}:p.x===0&&p.y===64&&p.z===0?{name:'oak_fence',shapes:[[.375,0,.375,.625,1.5,.625]]}:{name:'air',shapes:[]},
  pathfinder:{goal:null,setGoal:(g:unknown)=>{bot.pathfinder.goal=g},goto:async(g:any)=>{calls++;bot.pathfinder.goal=g;if(calls===1||retryFails){if(empty)return;const e=new Error('No path');e.name='NoPath';throw e;}bot.entity.position=new Vec3(g.x,g.y,g.z)},isMoving:()=>false,isMining:()=>false,isBuilding:()=>false}};
 const ctx:any={aborted:()=>false,taskId:7,probeRoutes:()=>probes,diag:{write:(d:unknown)=>logs.push(d)}};
 const timer=setInterval(()=>{if(move&&controls.forward){bot.entity.position.x-=Math.sin(yaw)*.04;bot.entity.position.z-=Math.cos(yaw)*.04}},30);
 return{bot,ctx,controls,logs,stop:()=>clearInterval(timer),calls:()=>calls};
}
const r=fixture();try{
 r.ctx.probeTarget=()=>({kind:'sealed',size:87});
 assert.match(routeNote(r.bot,r.ctx,{x:5,y:64,z:0}),/不能据此判定封死/);
 await gotoGoal(r.bot,new goals.GoalBlock(5,64,0),r.ctx);
 assert.equal(r.calls(),2);assert.equal(r.bot.entity.position.x,5);assert.equal(r.controls.forward,false);
 assert.ok(r.logs.some((d:any)=>d.event==='goto-start-recovery'&&d.data.moved>=.2));
 assert.doesNotMatch(renderRouteMenu(probes,{x:5,y:64,z:0}),/一步都迈不出去/);
}finally{r.stop()}
const empty=fixture(true,false,true);try{await gotoGoal(empty.bot,new goals.GoalBlock(5,64,0),empty.ctx);assert.equal(empty.calls(),2);assert.equal(empty.bot.entity.position.x,5);}finally{empty.stop()}
for(const [move,retryFails,expected]of [[false,false,1],[true,true,2]]as const){
 const f=fixture(move,retryFails);try{
  await assert.rejects(gotoGoal(f.bot,new goals.GoalBlock(5,64,0),f.ctx),/短步脱困实测水平移动/);
  assert.equal(f.calls(),expected);assert.equal(f.controls.forward,false);
 }finally{f.stop()}
}
console.log('实际travel回放通过：封闭空间仅提示、栅栏空隙短步、实际位移、一次重试、未移动不重试、诊断诚实。无服务器/模型/TP。');
