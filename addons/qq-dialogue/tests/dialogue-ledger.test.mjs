import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {DialogueLedger,dialogueHistory} from '../src/dialogue-ledger.ts';
const at=Date.parse('2026-10-17T00:00:00Z');
test('inbound IDs are idempotent, independent for each conversation',()=>{
 const d=new DialogueLedger(null);
 assert.equal(d.inbound('private:1',4,at),true);
 assert.equal(d.inbound('private:1',4,at+1),false);
 assert.equal(d.inbound('private:2',4,at+1),true);
 assert.equal(d.inbound('private:1',4,at+600001),true);
});
test('concurrent and completed duplicate suppressed; fresh input allows repetition',()=>{
 const d=new DialogueLedger(null),a='private:1';
 const t=d.begin(a,'hello',null,at); assert.ok(!('blocked'in t));
 assert.ok('blocked'in d.begin(a,'hello',null,at));
 d.finish(t,a,['hello'],['4'],true,at);
 assert.ok('blocked'in d.begin(a,'hello',null,at+3*60000));
 assert.ok(!('blocked'in d.begin('private:2','hello',null,at)));
 d.inbound(a,5,at+1);
 assert.ok(!('blocked'in d.begin(a,'hello',null,at+2)));
});
test('failed and partial deliveries never claim complete delivery',()=>{
 for(const delivered of [[],['first']]){
  const d=new DialogueLedger(null),t=d.begin('private:1','hello',null,at);
  d.finish(t,'private:1',delivered,[],false,at);
  assert.ok(!('blocked'in d.begin('private:1','hello',null,at+1)));
  assert.equal(d.outgoing().length,delivered.length?1:0);
 }
});
test('persistence keeps actual receipts and inbound IDs across restart',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'qq-dialogue-'));
 try{
  const file=path.join(dir,'ledger.json'),a='private:1',d=new DialogueLedger(file);
  d.inbound(a,7,at);const t=d.begin(a,'hello',null,at);d.finish(t,a,['hello'],['8'],true,at);
  const loaded=new DialogueLedger(file);
  assert.equal(loaded.inbound(a,7,at+1),false);
  assert.ok('blocked'in loaded.begin(a,'hello',null,at+1));
  assert.deepEqual(loaded.outgoing()[0].ids,['8']);
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
test('corrupt file is preserved and reported',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'qq-dialogue-'));
 try{
  const file=path.join(dir,'ledger.json');fs.writeFileSync(file,'broken');
  const d=new DialogueLedger(file);assert.ok(d.warning);d.inbound('private:1',1,at);
  assert.equal(fs.readFileSync(file,'utf8'),'broken');
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
test('history distinguishes own speech, sorts chronologically, isolates conversations',()=>{
 const d=new DialogueLedger(null),t=d.begin('private:1','go?',null,at);
 d.finish(t,'private:1',['go?'],['1'],true,at);
 const s=dialogueHistory([{ts:new Date(at+1).toISOString(),text:'yes'}],
 [...d.outgoing(),{address:'private:2',text:'SECRET',ts:new Date(at).toISOString(),ids:[]}],
 'private:1',30,ts=>ts);
 assert.match(s,/历史记录/);assert.match(s,/自己→对方（实际已发送）/);assert.match(s,/对方→自己/);
 assert.ok(s.indexOf('go?')<s.indexOf('yes'));assert.ok(!s.includes('SECRET'));
});
