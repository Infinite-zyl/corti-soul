import {test} from 'node:test';
import assert from 'node:assert/strict';
import {safeShortStep,recoverStart,diagnosticSolid} from '../src/start-recovery.ts';
const cube=[[0,0,0,1,1,1]];
const air={name:'air',shapes:[]},stone={name:'stone',shapes:cube};
const flat=p=>p.y===63?stone:air;
const from={x:.5,y:64,z:.5},to={x:.95,y:64,z:.5};
test('平地短步；栅栏整格中的真实空隙可以离开',()=>{
 assert.equal(safeShortStep(flat,from,to),true);
 const read=p=>p.x===0&&p.y===64&&p.z===0?{name:'oak_fence',shapes:[[.375,0,.375,.625,1.5,.625]]}:flat(p);
 assert.equal(safeShortStep(read,{x:.95,y:64,z:.5},{x:1.4,y:64,z:.5}),true);
 assert.equal(safeShortStep(read,from,to),true); // 已有碰撞逐步减少，只允许退出。
 assert.equal(safeShortStep(read,to,from),false);
});
test('不穿实心墙、不跨落差、不走未知区块或头顶障碍',()=>{
 for(const read of [p=>p.x===1&&p.y===64?stone:flat(p),p=>p.x===1?air:flat(p),p=>p.x===1?null:flat(p),p=>p.y===65?stone:flat(p)])assert.equal(safeShortStep(read,from,to),false);
 assert.equal(safeShortStep(flat,from,{...to,y:65}),false);
});
test('不踏火、水、岩浆、岩浆块或篝火',()=>{
 for(const name of ['fire','water','lava','magma_block','campfire'])assert.equal(safeShortStep(p=>p.x===1&&p.y===64?{name,shapes:[]}:flat(p),from,to),false);
});
test('门的静态连通性不等于墙；关铁门仍是障碍',()=>{
 assert.equal(diagnosticSolid({name:'oak_door',boundingBox:'block'}),false);
 assert.equal(diagnosticSolid({name:'oak_fence_gate',boundingBox:'block'}),false);
 assert.equal(diagnosticSolid({name:'iron_door',boundingBox:'block'}),true);
 assert.equal(diagnosticSolid({name:'iron_door',boundingBox:'block',getProperties:()=>({open:true})}),false);
 assert.equal(diagnosticSolid({name:'stone',boundingBox:'block'}),true);
});
function body(){
 const controls={},logs=[];
 const bot={entity:{position:{...from},onGround:true},pathfinder:{goal:null},health:20,blockAt:flat,look:async()=>{},setControlState:(k,v)=>{controls[k]=v;}};
 const ctx={aborted:()=>false,diag:{write:x=>logs.push(x)}};
 return {bot,ctx,controls,logs};
}
test('没有实际位移不算脱困；30秒内不重复短步',async()=>{
 const r=body();const moved=await recoverStart(r.bot,r.ctx,flat);
 assert.equal(moved,0);assert.equal(r.controls.forward,false);assert.equal(r.controls.sneak,false);
 assert.equal(await recoverStart(r.bot,r.ctx,flat),null);assert.equal(r.logs.length,1);
});
test('中止、抢占、水中、空中、骑乘不启动短步',async()=>{
 for(const setup of [r=>{r.ctx.aborted=()=>true},r=>{r.bot.pathfinder.goal={}},r=>{r.bot.entity.isInWater=true},r=>{r.bot.entity.onGround=false},r=>{r.bot.vehicle={}}]){
  const r=body();setup(r);assert.equal(await recoverStart(r.bot,r.ctx,flat),null);assert.deepEqual(r.controls,{});
 }
});
test('实际短步按读回坐标记账，移动后释放方向键',async()=>{
 const r=body();const timer=setInterval(()=>{if(r.controls.forward)r.bot.entity.position.x+=.04},30);
 try{const moved=await recoverStart(r.bot,r.ctx,flat);assert.ok(moved>=.2&&moved<.6);assert.equal(r.controls.forward,false);assert.ok(r.logs[0].data.moved>=.2);}finally{clearInterval(timer)}
});
test('移动途中中止，最多一轮等待后释放方向键',async()=>{
 const r=body();let aborted=false;r.ctx.aborted=()=>aborted;const timer=setTimeout(()=>{aborted=true},90);
 try{await recoverStart(r.bot,r.ctx,flat);assert.equal(r.controls.forward,false);assert.equal(r.controls.sneak,false);}finally{clearTimeout(timer)}
});
test('附近实体占位不尝试穿过',async()=>{
 const r=body();r.bot.entities={animal:{position:from}};
 assert.equal(await recoverStart(r.bot,r.ctx,flat),0);assert.deepEqual(r.controls,{});assert.equal(r.logs[0].data.attempted,false);
});
test('已有位移但被新目标接管，不授权继续重试或清掉新目标',async()=>{
 const r=body(),goal={escape:true};
 const timer=setTimeout(()=>{r.bot.entity.position.x+=.25;r.bot.pathfinder.goal=goal},80);
 try{assert.equal(await recoverStart(r.bot,r.ctx,flat),null);assert.equal(r.bot.pathfinder.goal,goal);}finally{clearTimeout(timer)}
});
