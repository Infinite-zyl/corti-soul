/** Actual QQ transport receipts and inbound identities, independent of model history. */
import {existsSync,readFileSync,writeFileSync,renameSync,unlinkSync} from 'node:fs';
import {randomUUID,createHash} from 'node:crypto';
export interface Sent {address:string;ts:string;text:string;ids:string[];fingerprint?:string;revision?:number}
const WINDOW=10*60_000;
export class DialogueLedger {
 private sent:Sent[]=[];
 private revisions=new Map<string,number>();
 private seen=new Map<string,number>();
 private pending=new Set<string>();
 private writable=true;
 warning='';
 private file:string|null;
 constructor(file:string|null){
  this.file=file;
  if(!file||!existsSync(file))return;
  try{
   const v=JSON.parse(readFileSync(file,'utf8'));
   if(v.version!==1||!Array.isArray(v.sent)||!Array.isArray(v.revisions)||!Array.isArray(v.seen))throw Error('format');
   if(!v.sent.every((s:Sent)=>typeof s.address==='string'&&typeof s.text==='string'&&Number.isFinite(Date.parse(s.ts))&&Array.isArray(s.ids))
    ||!v.revisions.every((r:unknown[])=>Array.isArray(r)&&typeof r[0]==='string'&&Number.isSafeInteger(r[1]))
    ||!v.seen.every((r:unknown[])=>Array.isArray(r)&&typeof r[0]==='string'&&typeof r[1]==='number'))throw Error('entries');
   this.sent=v.sent.slice(-100);this.revisions=new Map(v.revisions.slice(-200));this.seen=new Map(v.seen.slice(-300));
  }catch{this.writable=false;this.warning='QQ收发账本读取失败，原文件已保留；本次会话仅在内存中记录。';}
 }
 private save(){
  if(!this.file||!this.writable)return;
  const temp=this.file+'.tmp-'+randomUUID();
  try{writeFileSync(temp,JSON.stringify({version:1,sent:this.sent,revisions:[...this.revisions],seen:[...this.seen]}),'utf8');renameSync(temp,this.file);}
  catch{try{unlinkSync(temp);}catch{}this.writable=false;this.warning='QQ收发账本保存失败；本次会话继续在内存中记录。';}
 }
 inbound(address:string,id:unknown,now=Date.now()):boolean{
  for(const [key,time] of this.seen)if(now-time>WINDOW)this.seen.delete(key);
  const key=id!==undefined&&id!==null?JSON.stringify([address,String(id)]):null;
  if(key&&this.seen.has(key))return false;
  if(key)this.seen.set(key,now);
  this.revisions.set(address,(this.revisions.get(address)??0)+1);
  while(this.seen.size>300)this.seen.delete(this.seen.keys().next().value!);
  while(this.revisions.size>200)this.revisions.delete(this.revisions.keys().next().value!);
  this.save();return true;
 }
 begin(address:string,text:string,reply:unknown,now=Date.now()):{blocked:string}|{key:string;fingerprint:string;revision:number}{
  const fingerprint=createHash('sha256').update(JSON.stringify([text.replaceAll('\r\n','\n').trim(),reply??null])).digest('hex');
  const revision=this.revisions.get(address)??0,key=JSON.stringify([address,fingerprint,revision]);
  if(this.pending.has(key))return{blocked:'相同消息仍在发送中，本次没有重复发送。'};
  const previous=this.sent.findLast(s=>s.address===address&&s.fingerprint===fingerprint&&s.revision===revision&&now-Date.parse(s.ts)>=0&&now-Date.parse(s.ts)<WINDOW);
  if(previous)return{blocked:`相同正文已于 ${previous.ts} 成功发送，此后没有该会话的新消息；本次没有重复发送。`};
  this.pending.add(key);return{key,fingerprint,revision};
 }
 finish(token:{key:string;fingerprint:string;revision:number},address:string,delivered:string[],ids:string[],complete:boolean,now=Date.now()){
  this.pending.delete(token.key);
  if(!delivered.length)return;
  this.sent.push({address,ts:new Date(now).toISOString(),text:delivered.join('\n'),ids,
   ...(complete?{fingerprint:token.fingerprint,revision:token.revision}:{})});
  this.sent=this.sent.slice(-100);this.save();
 }
 outgoing():Sent[]{return this.sent.map(s=>({...s,ids:[...s.ids]}));}
}
export function dialogueHistory(events:Array<{ts:string;text:string;senderKey?:string}>,sent:Sent[],address:string,limit:number,clock:(ts:string)=>string):string{
 const rows=[...events.map(e=>({ts:e.ts,text:e.text,direction:'对方→自己'})),
  ...sent.filter(s=>s.address===address).map(s=>({ts:s.ts,text:s.text,direction:'自己→对方（实际已发送）'}))]
  .sort((a,b)=>Date.parse(a.ts)-Date.parse(b.ts)).slice(-limit);
 if(!rows.length)return '没有消息记录。';
 return '以下是历史记录（旧→新），不是新收到的消息。只回应对方的发言，不要把自己已发送的话当作对方的问题。\n'+
  rows.map(r=>`[${clock(r.ts)}][${r.direction}] ${r.text.slice(0,1000)}`).join('\n');
}
