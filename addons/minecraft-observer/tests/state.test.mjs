import {test} from 'node:test';import assert from 'node:assert/strict';
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {observerSnapshot,ObserverStateWriter} from '../src/state.ts';
const bot={entity:{uuid:'uuid',position:{x:1,y:65,z:-1}},health:18,food:16,quickBarSlot:1,heldItem:{name:'iron_pickaxe',count:1},inventory:{slots:{36:{name:'stone',count:32},45:{name:'torch',count:24}}},game:{dimension:'overworld'}};
function state(extra={}){return observerSnapshot({bot,online:true,target:'corti',observer:'CortiCam',queue:{running:null,waiting:[]},last:null,now:1000,...extra});}
test('empty queue is idle, never invented model thinking; bounded whitelisted equipment',()=>{
 const s=state();assert.equal(s.phase,'idle');assert.equal(s.health,18);assert.equal(s.hotbar.length,9);assert.equal(s.off.id,'minecraft:torch');assert.equal(s.main.id,'minecraft:iron_pickaxe');
 const withSecrets={...bot,token:'SECRET',chat:['PRIVATE'],inventory:{...bot.inventory,history:'PRIVATE'}};
 assert.ok(!JSON.stringify(state({bot:withSecrets})).includes('SECRET'));assert.ok(!JSON.stringify(state({bot:withSecrets})).includes('PRIVATE'));
});
test('execution, hold and sleeping are derived from actual game state',()=>{
 const running={id:7,label:'go',step:'goto',stepIndex:1,stepCount:4,elapsedMs:3000};
 assert.equal(state({queue:{running,waiting:[]}}).task.index,2);assert.equal(state({queue:{running,waiting:[]}}).phase,'executing');
 assert.equal(state({queue:{running,waiting:[],hold:'combat'}}).phase,'held');
 assert.equal(state({bot:{...bot,isSleeping:true}}).phase,'sleeping');
 assert.equal(state({queue:{running:null,waiting:[{}]}}).phase,'queued');
});
test('offline clears equipment, stale last task, coordinates and stats',()=>{
 const s=state({online:false,last:{kind:'done',text:'old',at:20}});
 assert.equal(s.phase,'offline');assert.equal(s.task,null);assert.equal(s.last,null);assert.equal(s.health,null);assert.deepEqual(s.hotbar,[]);assert.equal(s.position,null);
});
test('receipts are bounded; atomic file can be replaced; write failures are warning-only',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'observer-state-'));try{
  const file=path.join(dir,'state.json'),warnings=[],writer=new ObserverStateWriter(file,t=>warnings.push(t));
  writer.write(state({last:{kind:'blocked',text:'x'.repeat(500),at:1}}));assert.equal(JSON.parse(fs.readFileSync(file)).last.text.length,130);
  writer.write(state({online:false}));assert.equal(JSON.parse(fs.readFileSync(file)).online,false);assert.equal(warnings.length,0);
  const broken=new ObserverStateWriter(path.join(dir,'missing','state.json'),t=>warnings.push(t));broken.write(state());broken.write(state());assert.equal(warnings.length,1);
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});

test('experience and equipped armor are real readings, missing or unknown values stay unknown',()=>{
 const b={...bot,experience:{level:27,progress:.42},inventory:{slots:{5:{name:'iron_helmet'},6:{name:'iron_chestplate'},7:{name:'iron_leggings'},8:{name:'iron_boots'}}}};
 assert.deepEqual(state({bot:b}).experience,{level:27,progress:.42});assert.equal(state({bot:b}).armor,15);
 assert.equal(state({bot:{...b,inventory:{slots:{6:{name:'elytra'}}}}}).armor,null);
 assert.equal(state().experience.level,null);assert.equal(state({online:false}).armor,null);assert.equal(state({online:false}).experience,null);
});

test('life HUD is bounded, pause has no false review countdown, offline clears it',()=>{
 const life={target:'x'.repeat(500),state:'resting',reason:'rest',next:'later',nextReviewAt:1000,attempts:2,privateHistory:'SECRET'};
 assert.equal(state({life}).life.target.length,80);assert.ok(!JSON.stringify(state({life})).includes('SECRET'));
 assert.equal(state({life:{...life,paused:true}}).life.state,'paused');assert.equal(state({life:{...life,paused:true}}).life.nextReviewAt,null);assert.equal(state({life,online:false}).life,null);
});
