import test from 'node:test';import assert from 'node:assert/strict';
import {noteFailedUnwedge,claimStuckTeleport,isHomeRestRequest} from '../src/autonomy.ts';
import {HomeBook} from '../src/home.ts';import {ProjectBook} from '../src/projects.ts';
import {mkdtempSync,rmSync,readFileSync,writeFileSync} from 'node:fs';import {tmpdir} from 'node:os';import {join} from 'node:path';
const body=()=>({entity:{position:{x:0,y:64,z:0}},game:{dimension:'minecraft:overworld'}});
test('无真实脱困失败证据不得传送；证据一次性且5分钟冷却',()=>{
 const b=body();assert.match(claimStuckTeleport(b,1000),/没有/);noteFailedUnwedge(b,1000);assert.equal(claimStuckTeleport(b,2000),null);
 assert.match(claimStuckTeleport(b,2001),/没有/);noteFailedUnwedge(b,3000);assert.match(claimStuckTeleport(b,4000),/冷却/);
 noteFailedUnwedge(b,303000);assert.equal(claimStuckTeleport(b,304000),null);
});
test('过期、已经移动、换维度的卡死证据不授权传送',()=>{
 for(const change of ['time','move','dimension']){const b=body();noteFailedUnwedge(b,1000);if(change==='move')b.entity.position.x=3;if(change==='dimension')b.game.dimension='minecraft:the_nether';assert.match(claimStuckTeleport(b,change==='time'?92000:2000),/没有/);}
});
test('仅精确回家/自己的床合并，其他床和夹带工作不合并',()=>{
 const h={returnAt:[0,64,0],facilities:[{role:'own-bed',at:[1,64,0]}]};
 assert.equal(isHomeRestRequest([{skill:'goto',at:h.returnAt},{skill:'use',at:[1,64,0]}],h),true);
 for(const s of [[{skill:'use',at:[2,64,0]}],[{skill:'goto',at:[0,64]}],[{skill:'goto',at:h.returnAt},{skill:'collect',at:[1,64,0]}],[]])assert.equal(isHomeRestRequest(s,h),false);
});
test('生活工程跨实例保留、跨存档隔离；坏文件与非法更新不覆盖',()=>{
 const dir=mkdtempSync(join(tmpdir(),'mc-project-'));try{const file=join(dir,'p.json'),b=new ProjectBook(file);
 assert.match(b.summary('a'),/自己的稳定食物/);b.save('a',{name:'自己的农场',stage:'选址',next:'调查保护区外水边',status:'active',evidence:'尚未开工，用户允许自建农场'});
 assert.equal(new ProjectBook(file).get('a').stage,'选址');assert.equal(b.get('b'),null);
 const before=readFileSync(file,'utf8');assert.throws(()=>b.save('a',{name:'错误'}));assert.equal(readFileSync(file,'utf8'),before);
 writeFileSync(file,'{broken');assert.throws(()=>b.clear(),/损坏/);assert.equal(readFileSync(file,'utf8'),'{broken');
 }finally{rmSync(dir,{recursive:true,force:true});}
});
test('旧建筑默认用户设施，不从名称生成经营任务',()=>{
 const dir=mkdtempSync(join(tmpdir(),'mc-owner-'));try{const file=join(dir,'home.json');writeFileSync(file,JSON.stringify({version:1,homes:{},buildings:{a:[{name:'农田',dimension:'minecraft:overworld',protection:{min:[0,60,0],max:[10,80,10]},confirmation:'用户登记',updatedAt:'2026'}]}}));
 const b=new HomeBook(file);assert.equal(b.buildings('a')[0].owner,'user');assert.match(b.buildings('a')[0].purpose,/未委托/);
 const o={dimension:'minecraft:overworld',position:[1,64,1],playerPosition:null,read:()=>null,candidates:()=>[]};
 b.registerBuilding('a',{name:'农田',replace:true,radius:4,owner:'shared',purpose:'仅取箱内食物',confirmation:'确认共享'},o);
 assert.equal(new HomeBook(file).buildings('a')[0].owner,'shared');
 b.registerBuilding('a',{name:'农田',replace:true,radius:5,confirmation:'确认扩大'},o);assert.equal(b.buildings('a')[0].owner,'shared');
 }finally{rmSync(dir,{recursive:true,force:true});}
});
