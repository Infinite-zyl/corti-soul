/** 当前存档的生活工程进度；由模型登记，完成声明需附实际回执。 */
import {existsSync,readFileSync,mkdirSync,writeFileSync,renameSync,unlinkSync} from 'node:fs';
import {dirname} from 'node:path';
import {randomUUID} from 'node:crypto';
interface Project {name:string;stage:string;next:string;status:'active'|'blocked'|'done';evidence:string;updatedAt:string}
type File={version:1;realms:Record<string,Project>};
function field(v:unknown,label:string,max=400):string {if(typeof v!=='string'||!v.trim()||v.length>max)throw Error(label+'不能为空且需在'+max+'字内');return v.trim();}
function project(v:unknown):Project {
 if(!v||typeof v!=='object'||Array.isArray(v))throw Error('工程记录格式错误');const a=v as Record<string,unknown>;
 if(!['active','blocked','done'].includes(String(a.status)))throw Error('工程状态错误');
 return {name:field(a.name,'目标',80),stage:field(a.stage,'阶段',120),next:field(a.next,'下一步'),status:a.status as Project['status'],evidence:field(a.evidence,'依据/实际回执'),updatedAt:field(a.updatedAt,'更新时间',80)};
}
export class ProjectBook {
 private file:string|null;
 constructor(file:string|null){this.file=file;}
 private load():File {
  if(!this.file||!existsSync(this.file))return {version:1,realms:Object.create(null)};
  try{const raw=JSON.parse(readFileSync(this.file,'utf8'));if(raw?.version!==1||!raw.realms||typeof raw.realms!=='object'||Array.isArray(raw.realms))throw Error('布局错误');
   const realms=Object.create(null) as Record<string,Project>;for(const [key,value]of Object.entries(raw.realms))realms[key]=project(value);return {version:1,realms};
  }catch(e){throw Error('生活工程账本损坏，原文件保留：'+String(e));}
 }
 get(realm:string):Project|null{return this.load().realms[realm]??null;}
 save(realm:string,input:Record<string,unknown>):Project {
  const d=this.load(),p=project({...input,updatedAt:new Date().toISOString()});
  d.realms[realm]=p;this.commit(d);return p;
 }
 private commit(d:File):void {
  if(!this.file)throw Error('未配置数据目录');mkdirSync(dirname(this.file),{recursive:true});const tmp=this.file+'.'+randomUUID()+'.tmp';
  try{writeFileSync(tmp,JSON.stringify(d,null,2)+'\n',{flag:'wx'});renameSync(tmp,this.file);}finally{if(existsSync(tmp))unlinkSync(tmp);}
 }
 clear():string{this.load();this.commit({version:1,realms:Object.create(null)});return '已清除生活工程进度；默认生活目标仍由World说明提供';}
 stat():string{try{return Object.keys(this.load().realms).length+' 个存档有生活工程';}catch(e){return String(e);}}
 summary(realm:string):string {
  try{const p=this.get(realm);if(!p)return '[生活目标] 建立自己的稳定食物来源。白天自行调查保护区外的合适位置，先规划一个小农场；用mc_project保存阶段、下一步和回执。用户农田不是你的待办，用户离线不撤销自己的生活目标。';
   return `[生活工程·模型登记，非完成核验] ${p.name}；${p.status}；阶段：${p.stage}；下一步：${p.next.slice(0,160)}；依据：${p.evidence.slice(0,100)}。完整记录用mc_project查询。夜间暂停，白天接续；受阻换方法/地点，不反复撞同一保护边界。`;
  }catch(e){return '[生活工程] '+String(e);}
 }
}
export const MINECRAFT_PROJECT_TOOL={name:'mc_project',tags:['write'] as const,
 description:'Persistent current-save life project. Query by default; save the goal, phase, next action and actual evidence after meaningful progress/failure. This records a plan and reported progress, not verified success or a game command. Build your own food source outside user-protected structures; owner:user buildings are not your jobs. A blocked phase needs a changed method/site, not waiting for ownership restrictions to disappear. User offline is not cancellation. Use mc_goal as temporary working projection; works.json records completed cells. No polling.',
 parameters:{type:'object',properties:{action:{type:'string',enum:['query','save']},name:{type:'string',maxLength:80},stage:{type:'string',maxLength:120},next:{type:'string',maxLength:400},status:{type:'string',enum:['active','blocked','done']},evidence:{type:'string',maxLength:400}},additionalProperties:false}};
