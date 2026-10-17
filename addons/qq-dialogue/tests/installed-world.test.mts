import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFileSync,mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
const root=JSON.parse(readFileSync(new URL('../../../runtime-selection.json',import.meta.url),'utf8')).corticoRoot;
await import(pathToFileURL(join(root,'src/extensions/runtime.ts')).href);
const pkg=join(root,'extensions/node_modules/cortico-world-qq-better-alont1');
const {QQWorld}=await import(pathToFileURL(join(pkg,'src/world.ts')).href);
const {makeHistoryTools}=await import(pathToFileURL(join(pkg,'src/history-tools.ts')).href);
test('installed send handler records receipts, suppresses repeats and allows fresh input',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'qq-installed-'));
 const world:any=new QQWorld({sendIntervalMs:0,splitReplyBySentence:false},pkg,dir);
 let calls=0,fail=false;
 world.driver={callApi:async()=>{calls++;if(fail)throw Error('simulated failure');return{message_id:calls};}};
 // Keep this test transport-only: no sockets, save timers or actual World.start.
 world.scheduleSaveState=()=>{};
 world.log={warn:()=>{}};
 try{
  assert.match(await world.sendSegments('private:123',[{type:'text',data:{text:'hello'}}]),/发送 1\/1/);
  assert.match(await world.sendSegments('private:123',[{type:'text',data:{text:'hello'}}]),/没有重复发送/);
  assert.equal(calls,1);
  world.dialogue.inbound('private:123',500);
  await world.sendSegments('private:123',[{type:'text',data:{text:'hello'}}]);assert.equal(calls,2);
  fail=true;
  assert.match(await world.sendSegments('private:123',[{type:'text',data:{text:'fail'}}]),/0\/1/);
  fail=false;
  assert.match(await world.sendSegments('private:123',[{type:'text',data:{text:'fail'}}]),/发送 1\/1/);
  assert.equal(world.dialogue.outgoing().length,3);
  world.driver=null;
  assert.match(await world.sendSegments('private:123',[]),/未连接/);
 }finally{rmSync(dir,{recursive:true,force:true});}
});
test('actual history tool includes own receipts even without inbound history',async()=>{
 const ts=new Date().toISOString();
 const tools=makeHistoryTools({getHost:()=>({store:{range:()=>[]}}),sourceId:'qqbot',timezone:'Asia/Shanghai',
  convLabel:()=>'',resolveAddress:()=>({address:'private:123'}),
  outgoing:()=>[{address:'private:123',ts,text:'my own question',ids:['7']}]});
 const reply=await tools[0].handler({conv:'private:123'});
 assert.match(reply,/自己→对方（实际已发送）/);assert.match(reply,/不是新收到的消息/);
});
test('actual receiver drops self echo before identity loads and repeated inbound IDs',async()=>{
 const world:any=new QQWorld({},pkg,'');let received=0;
 world.host={};world.isListened=()=>true;
 world.ensureConv=()=>({address:'private:123'});world.resolveSender=()=>({});
 world.enqueue=()=>{received++;};
 const event={post_type:'message',message_type:'private',self_id:99,user_id:99,message_id:1};
 world.handleEvent(event);assert.equal(received,0);
 world.handleEvent({...event,user_id:123});world.handleEvent({...event,user_id:123});
 assert.equal(received,1);
});
const {ProactiveSpeaker}=await import(pathToFileURL(join(pkg,'src/proactive.ts')).href);
const quietLog:any={emit(){},warn(){},info(){},debug(){},error(){},child(){return this;}};
test('proactive material includes incoming ownership and actual completion receipt in the same conversation',()=>{
 const world:any=new QQWorld({},pkg,'');const now=Date.now();
 world.host={store:{range:()=>[{ts:new Date(now-2000).toISOString(),origin:'external',type:'qq.message',text:'请你去拆栏杆'}]}};
 const t=world.dialogue.begin('private:123','已拆完',null,now-1000);world.dialogue.finish(t,'private:123',['已拆完'],['1'],true,now-1000);
 const other=world.dialogue.begin('private:999','SECRET',null,now-1000);world.dialogue.finish(other,'private:999',['SECRET'],['2'],true,now-1000);
 const material=world.recentWordsOf('private:123');assert.match(material,/对方→自己/);assert.match(material,/自己→对方/);assert.match(material,/已拆完/);assert.ok(!material.includes('SECRET'));
});
test('scheduled feedback is a self receipt rather than an incoming user message',async()=>{
 const start=ProactiveSpeaker.prototype.start;ProactiveSpeaker.prototype.start=()=>{};
 try{const world:any=new QQWorld({},pkg,'');world.log=quietLog;const events:any[]=[];
  world.sendTo=async()=> '已向用户发送 1/1 段。';world.host={pushEvent:async(e:any,o:any)=>{events.push({e,o});return e;}};
  world.initProactive();await world.proactive.send('private:123','栅栏拆了没？');
  assert.equal(events.length,1);assert.equal(events[0].e.type,'qq.sent');assert.equal(events[0].e.origin,'internal');assert.equal(events[0].e.meta.self,true);assert.equal(events[0].o.trigger,'piggyback');assert.match(events[0].e.text,/不是用户发言/);
 }finally{ProactiveSpeaker.prototype.start=start;}
});
test('no-grounded-topic skip does not send or increment proactive delivery count',async()=>{
 const world:any=new QQWorld({},pkg,'');let sends=0;
 const speaker:any=new ProactiveSpeaker({cfg:world.config.proactive,log:quietLog,dataDir:'',generate:async()=> '[skip]',send:async()=>{sends++;return 'sent';},getTargets:()=>[]});
 const target={address:'private:123',kind:'private',label:'用户'};
 assert.match(speaker.buildUserPrompt(target,false),/不能反问对方做完没有/);assert.equal(await speaker.emit(target,false),false);assert.equal(sends,0);assert.equal(speaker.dailyCount,0);
});
