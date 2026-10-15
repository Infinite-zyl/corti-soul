import test from 'node:test';
import assert from 'node:assert/strict';
import { homeBox, protectedHomeCell, installHomeDigGuard, NightRest } from '../src/home-life.ts';
const home={name:'家',dimension:'minecraft:overworld',returnAt:[0,64,0],facilities:[{at:[1,64,1],role:'own-bed',kind:'red_bed'}],confirmation:'确认',updatedAt:'2026'};
test('旧登记保守保护柱墙与屋顶；不同维度、外围资源不受误判',()=>{
  assert.deepEqual(homeBox(home).min,[-6,62,-6]);
  assert.equal(protectedHomeCell(home,home.dimension,[4,66,3]),true);
  assert.equal(protectedHomeCell(home,home.dimension,[20,64,0]),false);
  assert.equal(protectedHomeCell(home,'minecraft:the_nether',[0,64,0]),false);
  assert.equal(protectedHomeCell({...home,protection:{min:[0,64,0],max:[2,66,2]}},home.dimension,[4,66,3]),false);
});
test('统一dig入口拒绝采集和路径挖掘，外部挖掘保持原行为且不重复包裹',async()=>{
  let digs=0;const bot={dig:async()=>{digs++;return 'dug';}};
  const denied=at=>protectedHomeCell(home,home.dimension,at);
  installHomeDigGuard(bot,denied);const wrapped=bot.dig;installHomeDigGuard(bot,denied);assert.equal(bot.dig,wrapped);
  await assert.rejects(bot.dig({position:{x:2,y:64,z:0}}),/住宅保护/);
  assert.equal(await bot.dig({position:{x:20,y:64,z:0}}),'dug');assert.equal(digs,1);
});
function harness(){
  const rest=new NightRest();const submissions=[],notices=[],priorities=[];
  const h={priority:x=>priorities.push(x),submit:x=>submissions.push(x),notify:x=>notices.push(x)};
  const i={time:13000,now:1000,home,dimension:home.dimension,sleeping:false,pending:false,atHome:false,health:20,bedState:'present'};
  return {rest,h,i,submissions,notices,priorities,tick(o={}){rest.tick({...i,...o},h);}};
}
test('夜间自动抢占普通工作，指定自己的床；白天才恢复',()=>{
  const f=harness();f.tick();assert.deepEqual(f.priorities,[true]);
  assert.deepEqual(f.submissions[0],[{skill:'goto',at:home.returnAt},{skill:'use',at:[1,64,1]}]);
  f.tick({time:23000,pending:true});assert.equal(f.rest.active,true);
  f.tick({time:0});assert.deepEqual(f.priorities,[true,false]);assert.equal(f.rest.active,false);
});
test('傍晚先回家，未到允许时间不反复点床',()=>{
  const f=harness();f.tick({time:12000});assert.equal(f.submissions[0].length,1);
  f.tick({time:12200,atHome:true,now:90000});assert.equal(f.submissions.length,1);
  f.tick({time:12542,atHome:true,now:100000});assert.equal(f.submissions[1][0].skill,'use');
});
test('床占用或失效不借床、不干别的、不发重复状态',()=>{
  const f=harness();for(let n=0;n<30;n++)f.tick({atHome:true,bedState:'occupied',now:n*1000});
  assert.equal(f.submissions.length,0);assert.equal(f.priorities.length,1);assert.equal(f.notices.length,2);
  f.tick({bedState:'invalid'});assert.equal(f.submissions.length,0);
});
test('即时脱险允许抢占，脱险后继续休息；已睡下不下新单',()=>{
  const f=harness();f.tick({health:3,emergency:true});assert.equal(f.submissions.length,0);
  f.tick({health:15});assert.equal(f.submissions.length,1);
  f.tick({sleeping:true,pending:true});assert.equal(f.submissions.length,1);
});
test('持续受阻每分钟至多重试一次，每夜最多三次，无限tick不增加调用',()=>{
  const f=harness();for(let n=0;n<1000;n++)f.tick({now:n*1000});
  assert.equal(f.submissions.length,3);assert.match(f.rest.state,/停止自动重试/);
  f.tick({time:0});f.tick({now:2_000_000});assert.equal(f.submissions.length,4);
});
test('已排队/执行的睡觉任务不重复提交，异维度不点击床',()=>{
  const f=harness();for(let n=0;n<30;n++)f.tick({pending:true,now:n*100000});
  assert.equal(f.submissions.length,0);
  f.tick({dimension:'minecraft:the_nether'});assert.equal(f.submissions.length,0);
});
test('离家时床被占用只回家，不向已知被占用的床重复发使用动作',()=>{
  const f=harness();f.tick({atHome:false,bedState:'occupied'});
  assert.deepEqual(f.submissions[0],[{skill:'goto',at:home.returnAt}]);
});
