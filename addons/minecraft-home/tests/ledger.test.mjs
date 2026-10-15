import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {HomeBook,radiusBox} from '../src/home.ts';
function fixture(fn){const dir=mkdtempSync(join(tmpdir(),'home-ledger-'));const file=join(dir,'home.json');
 const blocks=new Map([['0,64,0',{name:'red_bed',properties:{part:'head',facing:'south'}}],['0,64,-1',{name:'red_bed',properties:{part:'foot',facing:'south'}}],['5,64,0',{name:'furnace',properties:{}}],['6,64,0',{name:'crafting_table',properties:{}}]]);
 const observer={dimension:'minecraft:overworld',position:[0,64,0],playerPosition:[4,64,4],read:p=>blocks.get(p.join(','))??null,candidates:()=>[...blocks.keys()].map(k=>k.split(',').map(Number))};
 const book=new HomeBook(file);try{fn({dir,file,book,observer,blocks});}finally{rmSync(dir,{recursive:true,force:true});}}
test('半径范围明确，拒绝负数、小数和过大半径',()=>{
 assert.deepEqual(radiusBox([4,64,4],12),{min:[-8,60,-8],max:[16,80,16]});
 for(const r of [0,-1,1.5,65,'12',null])assert.throws(()=>radiusBox([0,0,0],r));
});
test('建筑按存档及维度隔离，现场中心优先玩家；重建后保留',()=>fixture(f=>{
 const b=f.book.registerBuilding('a',{name:'农田',radius:8,confirmation:'用户确认农田左右8格'},f.observer);
 assert.deepEqual(b.protection,radiusBox(f.observer.playerPosition,8));
 assert.equal(new HomeBook(f.file).buildings('a')[0].name,'农田');assert.deepEqual(f.book.buildings('b'),[]);
 f.book.registerBuilding('a',{name:'农田',radius:8,confirmation:'确认下界农田'}, {...f.observer,dimension:'minecraft:the_nether'});
 assert.equal(f.book.buildings('a').length,2);
 f.book.removeBuilding('a','农田','minecraft:overworld','确认撤销主世界农田');assert.equal(f.book.buildings('a')[0].dimension,'minecraft:the_nether');
}));
test('更新建筑必须明确确认；非法范围及损坏文件保留原文',()=>fixture(f=>{
 f.book.registerBuilding('a',{name:'农田',radius:8,confirmation:'确认'},f.observer);const before=readFileSync(f.file,'utf8');
 assert.throws(()=>f.book.registerBuilding('a',{name:'农田',radius:10,confirmation:'确认'},f.observer),/replace/);
 assert.throws(()=>f.book.registerBuilding('a',{name:'农田',radius:10,replace:true,confirmation:''},f.observer),/确认/);
 assert.throws(()=>f.book.registerBuilding('a',{name:'外地',protection:{min:[100,60,100],max:[110,80,110]},confirmation:'确认'},f.observer),/中心/);
 assert.equal(readFileSync(f.file,'utf8'),before);
 f.book.registerBuilding('a',{name:'农田',radius:10,replace:true,confirmation:'确认扩大'},f.observer);assert.equal(f.book.buildings('a').length,1);
 writeFileSync(f.file,'{"version":1,"homes":{},"buildings":{"a":[{}]}}');const corrupt=readFileSync(f.file,'utf8');
 assert.throws(()=>f.book.clear(),/损坏/);assert.equal(readFileSync(f.file,'utf8'),corrupt);
}));
test('旧版住宅迁移不丢床；补登记炉子和工作台保留已有未加载床',()=>fixture(f=>{
 f.book.save('a',{name:'家',confirmation:'确认床',facilities:[{at:[0,64,0],role:'own-bed'}]},f.observer);
 const old=JSON.parse(readFileSync(f.file,'utf8'));delete old.buildings;writeFileSync(f.file,JSON.stringify(old));
 f.blocks.delete('0,64,0');f.blocks.delete('0,64,-1');
 f.book.addFacilities('a',{confirmation:'确认现成炉子和工作台',facilities:[{at:[5,64,0],role:'furnace'},{at:[6,64,0],role:'workbench'}]},f.observer);
 assert.equal(f.book.get('a').facilities.length,3);assert.match(f.book.summary('a'),/furnace\(5,64,0\)/);
 assert.equal(f.book.query('a',f.observer).facilities[0].status,'unloaded');
 const before=readFileSync(f.file,'utf8');assert.throws(()=>f.book.addFacilities('a',{confirmation:'确认',facilities:[{at:[5,64,0],role:'furnace'}]},f.observer),/已登记/);assert.equal(readFileSync(f.file,'utf8'),before);
 f.book.registerBuilding('a',{name:'农田',radius:8,confirmation:'确认'},f.observer);f.book.remove('a','确认搬走');assert.equal(f.book.buildings('a').length,1);
 f.book.clear();assert.equal(new HomeBook(f.file).get('a'),null);assert.deepEqual(new HomeBook(f.file).buildings('a'),[]);
}));
