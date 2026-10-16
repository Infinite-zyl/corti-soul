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
