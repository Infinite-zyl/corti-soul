/** 在本地Cortico上验证实际执行器，不启动bot。用Cortico的tsx运行此ESM文件。 */
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
const root=resolve(process.env.CORTICO_ROOT??resolve(import.meta.dirname,'../../../../cortico-qq'));
const {Executor}=await import(pathToFileURL(resolve(root,'src/worlds/minecraft/executor.ts')).href);
const {waitForWake}=await import(pathToFileURL(resolve(root,'src/worlds/minecraft/skills-interact.ts')).href);
let id=0;const reports:unknown[]=[];
const log={info(){},warn(){},error(){},debug(){}};
const ex=new Executor({getBot:()=>null,nextId:()=>++id,report:(r:unknown)=>reports.push(r),log});
const started:unknown[]=[];
ex.run=async(t:unknown)=>{started.push(t);};
ex.submit([{skill:'goto',at:[10,64,0]}]);
ex.submit([{skill:'goto',at:[20,64,0]}],'append');
ex.setNightPriority(true);
assert.equal(ex.status().waiting.filter((q:{label:string})=>q.label.includes('夜间暂停')).length,2);
assert.match(ex.submit([{skill:'goto',at:[30,64,0]}],'now'),/没有接单/);
ex.submit([{skill:'use',at:[1,64,1]}],'now',undefined,true);
assert.equal(ex.nightRestPending(),true);assert.equal(ex.task.nightRest,true);
ex.suspend('被攻击','combat');assert.equal(ex.frozen.nightRest,true);
ex.resume('combat');assert.equal(ex.task.nightRest,true);
const restTask=ex.task;
ex.finish(restTask.flag,{kind:'done',taskId:restTask.id,text:'已睡醒'});
assert.equal(ex.task,null);assert.equal(ex.nightRestPending(),false);
ex.setNightPriority(false);
assert.equal(ex.task.id,1);assert.equal(ex.task.nightRest,false);
assert.equal(ex.status().waiting.length,1);
ex.shutdown();

// 正常任务仍60秒兜底；夜间专用睡眠不会被旧60秒超时强行叫醒。
const oldNow=Date.now,oldTimer=globalThis.setTimeout;
let now=0,wakes=0;
const bot={isSleeping:true,wake:async()=>{wakes++;bot.isSleeping=false;}};
try{
  Date.now=()=>now;
  globalThis.setTimeout=((fn:()=>void,ms:number)=>{queueMicrotask(()=>{now+=ms;if(now>=90_000)bot.isSleeping=false;fn();});return 0;}) as unknown as typeof setTimeout;
  await waitForWake(bot,{aborted:()=>false,nightRest:true});
  assert.equal(wakes,0);assert.ok(now>=90_000);
  now=0;bot.isSleeping=true;
  await waitForWake(bot,{aborted:()=>false});assert.equal(wakes,1);
}finally{Date.now=oldNow;globalThis.setTimeout=oldTimer;}
console.log('实际执行器：暂停/拒绝now/战斗后续睡/天亮恢复；实际睡床：夜间不被60秒兜底叫醒。均通过，无bot、无模型调用。');
