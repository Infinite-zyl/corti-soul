import test from 'node:test';import assert from 'node:assert/strict';
import {HomeBook} from '../src/home.ts';import {homePassage,installHomeEntry,throughHomeEntry} from '../src/home-entry.ts';
import {mkdtempSync,rmSync,readFileSync} from 'node:fs';import {tmpdir} from 'node:os';import {join} from 'node:path';
function fixture(fn){const dir=mkdtempSync(join(tmpdir(),'mc-entry-'));try{
 const file=join(dir,'home.json'),book=new HomeBook(file),blocks=new Map([
 ['2,64,2',{name:'red_bed',properties:{part:'head',facing:'south'}}],['2,64,1',{name:'red_bed',properties:{part:'foot',facing:'south'}}],
 ['0,64,0',{name:'oak_door',properties:{half:'lower',facing:'north',open:false}}],['0,65,0',{name:'oak_door',properties:{half:'upper',facing:'north',open:false}}]]);
 const observer={dimension:'minecraft:overworld',position:[0,64,2],playerPosition:[0,64,-1],read:p=>blocks.get(p.join(','))??{name:p[1]===63?'stone':'air',properties:{},solid:p[1]===63},candidates:()=>[...blocks.keys()].map(k=>k.split(',').map(Number))};
 book.save('a',{name:'家',returnAt:[0,64,2],confirmation:'确认床',facilities:[{at:[2,64,2],role:'own-bed'}]},observer);
 fn({file,book,blocks,observer});
 }finally{rmSync(dir,{recursive:true,force:true});}}
test('木门上下半合并；用户站门外确认后保存两侧落脚点，重建保留',()=>fixture(f=>{
 assert.equal(f.book.survey(f.observer).facilities.filter(x=>x.kind==='oak_door').length,1);
 f.book.setEntrance('a',{at:[0,65,0],confirmation:'我站门外，确认大门'},f.observer);
 const next=new HomeBook(f.file).get('a');assert.deepEqual(next.entrance,{at:[0,64,0],inside:[0,64,1],outside:[0,64,-1],kind:'oak_door'});
 assert.match(f.book.summary('a'),/家门\(0,64,0\)/);assert.equal(f.book.query('a',f.observer).facilities.find(x=>x.role==='entrance').status,'present');
}));
test('拒绝门框站位、实心落脚点与铁门，失败不破坏旧档案',()=>fixture(f=>{
 const before=readFileSync(f.file,'utf8');assert.throws(()=>f.book.setEntrance('a',{at:[0,64,0],confirmation:'确认'}, {...f.observer,playerPosition:[0,64,0]}),/门框/);
 f.blocks.set('0,64,1',{name:'stone',solid:true,properties:{}});assert.throws(()=>f.book.setEntrance('a',{at:[0,64,0],confirmation:'确认'},f.observer),/实心/);
 for(const y of [64,65])f.blocks.get(`0,${y},0`).name='iron_door';assert.throws(()=>f.book.setEntrance('a',{at:[0,64,0],confirmation:'确认'},f.observer),/木门/);
 assert.equal(readFileSync(f.file,'utf8'),before);
}));
test('局部进出经过门两侧，异维度、同侧和远处室外目标不绕家门',()=>fixture(f=>{
 const home=f.book.setEntrance('a',{at:[0,64,0],confirmation:'确认'},f.observer),dim=home.dimension;
 assert.deepEqual(homePassage(home,dim,[0,64,2],[0,64,-30]).before,[0,64,1]);
 assert.deepEqual(homePassage(home,dim,[0,64,-30],[0,64,2]).before,[0,64,-1]);
 assert.equal(homePassage(home,'minecraft:the_nether',[0,64,2],[0,64,-30]),null);
 assert.equal(homePassage(home,dim,[0,64,2],[3,64,2]),null);assert.equal(homePassage(home,dim,[11,64,2],[11,64,-30]),null);
}));
test('通行回调不递归规划；开门失败后允许下一次重新尝试',async()=>{
 const bot={},home={dimension:'minecraft:overworld',returnAt:[0,64,2],entrance:{at:[0,64,0],inside:[0,64,1],outside:[0,64,-1],kind:'oak_door'}};installHomeEntry(bot,()=>home);
 const points=[];const actions={go:async p=>{points.push(p);await throughHomeEntry(bot,home.dimension,[0,64,2],[0,64,-30],actions);},open:async()=>{throw Error('门坏了');}};
 await assert.rejects(throughHomeEntry(bot,home.dimension,[0,64,2],[0,64,-30],actions),/门坏/);assert.equal(points.length,1);
 actions.open=async()=>{};await throughHomeEntry(bot,home.dimension,[0,64,2],[0,64,-30],actions);assert.equal(points.length,3);
});
