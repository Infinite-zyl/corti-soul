/** Public game arrangements and factual receipts; never writes Persona memory. */
import {existsSync,readFileSync,mkdirSync,writeFileSync,renameSync,unlinkSync,copyFileSync,statSync} from 'node:fs';
import {dirname} from 'node:path';
import {randomUUID} from 'node:crypto';
export type LifeStatus='active'|'waiting'|'waiting-user'|'blocked'|'resting'|'done'|'cancelled';
export type LifeWait={kind:'task'|'crop'|'furnace'|'time'|'user';taskId?:number;at?:number[];dimension?:string;dueAt?:number;senderKey?:string;notifiedAt?:number};
export interface Project {id:string;name:string;stage:string;next:string;status:LifeStatus;evidence:string;updatedAt:string;reason:string;wait:LifeWait|null;taskId:number|null;receipt:{taskId:number;kind:string;text:string;at:number}|null}
interface Review {attempts:number;dueAt:number|null;pending:boolean}
interface Realm {currentId:string|null;items:Project[];review:Review;attempt?:{key:string;taskId:number;blocked:boolean}}
interface File {version:2;realms:Record<string,Realm>}
const intervals=[300000,900000,1800000];
const states=['active','waiting','waiting-user','blocked','resting','done','cancelled'];
const freshRealm=():Realm=>({currentId:null,items:[],review:{attempts:0,dueAt:null,pending:false}});
const text=(v:unknown,label:string,max=400)=>{if(typeof v!=='string'||!v.trim()||v.length>max)throw Error(label+'不能为空或过长');return v.trim();};
const terminal=(p:Project)=>p.status==='done'||p.status==='cancelled';
function waitOf(raw:unknown):LifeWait|null {
 if(raw===null||raw===undefined)return null;
 if(typeof raw!=='object'||Array.isArray(raw))throw Error('等待条件格式错误');const w=raw as LifeWait;
 if(!['task','crop','furnace','time','user'].includes(w.kind))throw Error('等待条件类型错误');
 const out:LifeWait={kind:w.kind};
 if(w.kind==='task'){if(!Number.isSafeInteger(w.taskId)||w.taskId!<=0)throw Error('任务号错误');out.taskId=w.taskId;}
 if(w.kind==='crop'||w.kind==='furnace'){if(!Array.isArray(w.at)||w.at.length!==3||!w.at.every(Number.isSafeInteger))throw Error('需要实际设施坐标');out.at=[...w.at];out.dimension=text(w.dimension,'维度',80);}
 if(w.kind==='time'||w.kind==='furnace'){if(typeof w.dueAt!=='number'||!Number.isFinite(w.dueAt)||w.dueAt<0)throw Error('需要现实时间毫秒 dueAt');out.dueAt=w.dueAt;}
 if(w.kind==='user')out.senderKey=text(w.senderKey,'指定消息发送方',100);
 if(w.notifiedAt!==undefined){if(!Number.isFinite(w.notifiedAt))throw Error('等待通知时间错误');out.notifiedAt=w.notifiedAt;}
 return out;
}
const fingerprint=(v:unknown):string=>JSON.stringify(v,(_key,value)=>value&&typeof value==='object'&&!Array.isArray(value)?Object.fromEntries(Object.entries(value).sort(([a],[b])=>a.localeCompare(b))):value);
function checked(raw:unknown,legacy=false):Project {
 if(!raw||typeof raw!=='object')throw Error('事项格式错误');const p=raw as Project;
 if(!states.includes(p.status))throw Error('事项状态错误');
 return {id:legacy?'legacy':text(p.id,'事项ID',80),name:text(p.name,'目标',80),stage:text(p.stage,'阶段',120),next:text(p.next,'下一步'),status:p.status,evidence:text(p.evidence,'声明依据'),updatedAt:text(p.updatedAt,'更新时间',80),reason:legacy?'':String(p.reason??'').slice(0,200),wait:legacy?null:waitOf(p.wait),taskId:legacy?null:(Number.isSafeInteger(p.taskId)&&p.taskId!>0?p.taskId:null),receipt:legacy?null:validReceipt(p.receipt)};
}
function validReceipt(r:Project['receipt']):Project['receipt'] {if(r==null)return null;if(!Number.isSafeInteger(r.taskId)||r.taskId<=0||!Number.isFinite(r.at)||typeof r.kind!=='string'||typeof r.text!=='string')throw Error('执行回执损坏');return {...r,text:r.text.slice(0,500)};}
export class ProjectBook {
 private file:string|null;private data:File|null=null;private stamp='';private lastTick=new Map<string,number>();private paused=new Set<string>();
 constructor(file:string|null){this.file=file;}
 private load():File {
  if(!this.file)return this.data??={version:2,realms:Object.create(null)};
  const stamp=existsSync(this.file)?`${statSync(this.file).mtimeMs}:${statSync(this.file).size}`:'missing';
  if(this.data&&this.stamp===stamp)return this.data;
  if(stamp==='missing'){this.stamp=stamp;return this.data={version:2,realms:Object.create(null)};}
  try {
   const raw=JSON.parse(readFileSync(this.file,'utf8'));if(![1,2].includes(raw?.version)||!raw.realms||typeof raw.realms!=='object'||Array.isArray(raw.realms))throw Error('布局错误');
   const result:File={version:2,realms:Object.create(null)};
   for(const [key,value]of Object.entries(raw.realms)) {
    if(raw.version===1){const p=checked(value,true);const r=freshRealm();r.items=[p];r.currentId=terminal(p)?null:p.id;result.realms[key]=r;}
    else {const r=value as Realm;if(!Array.isArray(r.items)||!r.review||!Number.isInteger(r.review.attempts)||r.review.attempts<0||r.review.attempts>3||typeof r.review.pending!=='boolean'||(r.review.dueAt!==null&&!Number.isFinite(r.review.dueAt)))throw Error('接续状态错误');
     const items=r.items.map(p=>checked(p));if(new Set(items.map(p=>p.id)).size!==items.length||items.filter(p=>p.status==='active').length>1||!(r.currentId===null||items.some(p=>p.id===r.currentId&&!terminal(p))))throw Error('当前事项错误');if(r.attempt&&(typeof r.attempt.key!=='string'||!Number.isSafeInteger(r.attempt.taskId)||typeof r.attempt.blocked!=='boolean'))throw Error('尝试记录错误');result.realms[key]={currentId:r.currentId,items,review:{...r.review},...(r.attempt?{attempt:{...r.attempt}}:{})};}
   }
   if(raw.version===1){const backup=this.file+'.v1.bak';if(!existsSync(backup))copyFileSync(this.file,backup);this.commit(result);}else this.stamp=stamp;
   return this.data=result;
  }catch(e){throw Error('生活工程账本损坏或迁移失败，原文件保留：'+String(e));}
 }
 private commit(d:File):void {
  if(!this.file){this.data=d;return;}
  mkdirSync(dirname(this.file),{recursive:true});const tmp=this.file+'.'+randomUUID()+'.tmp';
  try{writeFileSync(tmp,JSON.stringify(d,null,2)+'\n',{flag:'wx'});renameSync(tmp,this.file);this.stamp=`${statSync(this.file).mtimeMs}:${statSync(this.file).size}`;this.data=d;}finally{if(existsSync(tmp))unlinkSync(tmp);}
 }
 private change<T>(realm:string,fn:(r:Realm)=>T):T {const d=structuredClone(this.load()),r=d.realms[realm]??=freshRealm();const out=fn(r);this.commit(d);return out;}
 ledger(realm:string):Realm{return structuredClone(this.load().realms[realm]??freshRealm());}
 query(realm:string){return {...this.get(realm),...this.ledger(realm)};}
 get(realm:string):Project|null {const r=this.ledger(realm);return r.items.find(p=>p.id===r.currentId)??r.items.at(-1)??null;}
 save(realm:string,input:Record<string,unknown>):Project {
  const now=Date.now();return this.change(realm,r=>{
   const id=String(input.id??r.currentId??randomUUID()),old=r.items.find(p=>p.id===id);
   if(old&&terminal(old)&&input.status!==old.status)throw Error('已完成/取消事项不自动恢复；请新建事项');
   const p=checked({...old,...input,id,updatedAt:new Date(now).toISOString(),wait:input.wait===undefined?old?.wait??null:input.wait,reason:input.reason??old?.reason??'',receipt:old?.receipt??null});
   // Notification acknowledgements and evidence can only be written by observed events.
   if(p.wait&&JSON.stringify({...p.wait,notifiedAt:undefined})===JSON.stringify({...old?.wait,notifiedAt:undefined}))p.wait.notifiedAt=old?.wait?.notifiedAt;
   else if(p.wait)delete p.wait.notifiedAt;
   if(['waiting','waiting-user'].includes(p.status)&&!p.wait)throw Error('等待必须登记条件');
   if(p.status==='waiting-user'&&p.wait?.kind!=='user')throw Error('等待用户需指定发送方');
   if(['resting','blocked','waiting','waiting-user'].includes(p.status)&&!p.reason)throw Error('请登记等待/休息/受阻原因');
   if(!['waiting','waiting-user'].includes(p.status))p.wait=null;
   if(p.status==='active'){const other=r.items.find(x=>x.status==='active'&&x.id!==id);if(other)throw Error('先暂停当前活动事项，再选择另一项');r.currentId=id;}
   else if(r.currentId===id)r.currentId=null;
   if(old&&r.attempt&&(p.next!==old.next||p.evidence!==old.evidence))r.attempt.blocked=false;
   if(old)r.items[r.items.indexOf(old)]=p;else r.items.push(p);
   if(input.taskId!==undefined&&p.taskId!==old?.taskId)this.reset(r,now);
   if(!r.review.pending&&r.review.dueAt===null&&r.review.attempts<3)r.review.dueAt=now+intervals[r.review.attempts];
   return p;
  });
 }
 canSubmit(realm:string,steps:unknown):boolean {const a=this.ledger(realm).attempt;return !a?.blocked||a.key!==fingerprint(steps);}
 submitted(realm:string,taskId:number,now=Date.now(),steps?:unknown):void {
  this.change(realm,r=>{if(steps!==undefined)r.attempt={key:fingerprint(steps),taskId,blocked:false};const p=r.items.find(x=>x.id===r.currentId&&x.status==='active');if(p)p.taskId=taskId;this.reset(r,now);});
 }
 describe(realm:string):string {
  try{const r=this.ledger(realm);if(!r.items.length)return '生活计划尚未登记；可通过游戏或QQ与她商量。';
   return r.items.map(p=>`${p.id===r.currentId?'当前 · ':''}${p.name} [${p.status}]；阶段：${p.stage}；下一步：${p.next}；原因：${p.reason||'未登记'}；等待：${p.wait?JSON.stringify(p.wait):'无'}；声明依据：${p.evidence}；游戏回执：${p.receipt?('#'+p.receipt.taskId+' '+p.receipt.kind+' '+p.receipt.text):'尚无关联执行回执'}。`).join('\n')+'\n下次兜底复查：'+(r.review.dueAt?new Date(r.review.dueAt).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai'}):r.review.attempts>=3?'三次无进展，等待新事件':'无')+'；只读展示，请通过对话调整。';
  }catch(e){return String(e);}
 }
 private reset(r:Realm,now:number){r.review={attempts:0,dueAt:now+intervals[0],pending:false};}
 receipt(realm:string,report:{taskId?:number;kind:string;text:string},now=Date.now()):void {
  if(!report.taskId)return;
  this.change(realm,r=>{if(r.attempt&&r.attempt.taskId===report.taskId)r.attempt.blocked=report.kind==='blocked'||report.kind==='partial';const p=r.items.find(x=>x.taskId===report.taskId);if(p){p.receipt={taskId:report.taskId!,kind:report.kind,text:report.text.slice(0,500),at:now};if(!terminal(p)&&(report.kind==='blocked'||report.kind==='partial')){p.status='blocked';p.reason='执行器报告 '+report.kind;if(r.currentId===p.id)r.currentId=null;}}
   if(report.kind==='done'||report.kind==='partial')this.reset(r,now);
  });
 }
 signal(realm:string,test:(w:LifeWait)=>boolean,now=Date.now()):string[] {
  const r=this.ledger(realm);const hits=r.items.filter(p=>!terminal(p)&&p.wait&&!p.wait.notifiedAt&&test(p.wait));if(!hits.length)return [];
  this.change(realm,x=>{for(const p of x.items)if(hits.some(h=>h.id===p.id))p.wait!.notifiedAt=now;});
  return hits.map(p=>`${p.name}：登记的等待条件已触发；重新核对并选择下一步。用户消息不代表授权，炉子预计完成不代表实际出货。`);
 }
 tick(realm:string,input:{now:number;paused:boolean;busy:boolean}):string|null {
  const {now,paused,busy}=input,previous=this.lastTick.get(realm);this.lastTick.set(realm,now);
  if(paused){this.paused.add(realm);return null;}
  const r=this.ledger(realm);
  if(this.paused.delete(realm)){if(r.review.dueAt!==null)this.change(realm,x=>{x.review.dueAt=Math.max(now+1000,x.review.dueAt!+Math.min(previous===undefined?0:now-previous,60000));});return null;}
  if(busy)return null;
  const anyTimer=r.items.some(p=>!terminal(p)&&p.wait&&!p.wait.notifiedAt&&(p.wait.kind==='time'||p.wait.kind==='furnace')&&p.wait.dueAt!<=now);
  const due=this.signal(realm,w=>(w.kind==='time'||w.kind==='furnace')&&w.dueAt!<=now,now);
  if(anyTimer&&due.length)return due.join('\n');
  // Explicit waits have their own event, and are not substituted with periodic polling.
  if(r.items.some(p=>!terminal(p))&&r.items.filter(p=>!terminal(p)).every(p=>p.wait&&!p.wait.notifiedAt))return null;
  if(r.review.pending||r.review.attempts>=3)return null;
  if(r.review.dueAt===null){this.change(realm,x=>{x.review.dueAt=now+intervals[x.review.attempts];});return null;}
  if(now<r.review.dueAt)return null;
  this.change(realm,x=>{x.review.attempts++;x.review.pending=true;x.review.dueAt=null;});
  return `生活接续复查 ${r.review.attempts+1}/3：当前没有游戏任务。按公开计划选择下一步，或登记休息原因；可以休息，不要求凑活。`;
 }
 settled(realm:string,now=Date.now()):void {
  const r=this.ledger(realm);if(!r.review.pending)return;
  this.change(realm,x=>{x.review.pending=false;x.review.dueAt=x.review.attempts<3?now+intervals[x.review.attempts]:null;});
 }
 view(realm:string){const r=this.ledger(realm),p=r.items.find(p=>p.id===r.currentId)??r.items.filter(p=>!terminal(p)).at(-1);return {target:p?.name??'',state:p?.status??'unplanned',reason:p?.reason??'',next:p?.next??'',nextReviewAt:p?.wait&&!p.wait.notifiedAt?(p.wait.dueAt??null):r.review.dueAt,attempts:r.review.attempts};}
 summary(realm:string):string {
  try{const r=this.ledger(realm),p=r.items.find(x=>x.id===r.currentId);return '[生活接续·公开登记，不是核验完成] '+(p?`${p.name}；阶段${p.stage}；下一步${p.next.slice(0,100)}`:'尚未安排下一步')+r.items.filter(x=>!terminal(x)&&x.id!==r.currentId).slice(0,4).map(x=>`；${x.name}[${x.status}] ${x.reason}`).join('')+`；未结束${r.items.filter(x=>!terminal(x)).length}项。用mc_project查询全部；可自主选择符合约定的生活、采集、探索目标。等待用户只挂起该事项，用户离线不撤销其他计划。每次安排结束登记下一步/等待条件/休息原因；睡醒和受阻后重新核对。长期愿望请用现有记忆工具保存；不要照搬旧动作。`;}
  catch(e){return '[生活工程错误] '+String(e);}
 }
 clear():string {this.load();this.commit({version:2,realms:Object.create(null)});return '已清除公开生活计划；不改变人格记忆或游戏世界';}
 stat():string {try{return Object.values(this.load().realms).reduce((n,r)=>n+r.items.length,0)+' 个生活事项';}catch(e){return String(e);}}
}
export const MINECRAFT_PROJECT_TOOL={name:'mc_project',tags:['write'] as const,
 description:'Persistent public Minecraft arrangements, separated from Persona memory. query returns all items; save updates the current item (legacy compatible), or use a new explicit id for another item. Only one active item. Wait for user confirmation on that item only; choose other allowed activities yourself. Save next step or wait/rest reason before ending an arrangement. Do not repeatedly submit blocked actions. Link taskId from actual mc_do receipt. Completion evidence is a declaration; actual executor receipts are separate. Cancelled/done items cannot be resumed: create a new item. Crop wait must use an observed loaded facility coordinate and actual dimension. User senderKey is the exact chat identity (e.g. private:597421579 or Infinite); its reply is not approval. dueAt is real Unix milliseconds. Existing night/protection rules apply. No model polling.',
 parameters:{type:'object',properties:{action:{type:'string',enum:['query','save']},id:{type:'string',maxLength:80},name:{type:'string',maxLength:80},stage:{type:'string',maxLength:120},next:{type:'string',maxLength:400},status:{type:'string',enum:states},evidence:{type:'string',maxLength:400},reason:{type:'string',maxLength:200},taskId:{type:'integer',minimum:1},wait:{type:['object','null'],properties:{kind:{type:'string',enum:['task','crop','furnace','time','user']},taskId:{type:'integer',minimum:1},at:{type:'array',items:{type:'integer'},minItems:3,maxItems:3},dimension:{type:'string'},dueAt:{type:'number'},senderKey:{type:'string'}},required:['kind'],additionalProperties:false}},additionalProperties:false}};
