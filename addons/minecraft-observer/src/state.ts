/** SPDX-License-Identifier: MIT. Bounded observer facts; no events or model requests. */
import {writeFileSync,renameSync,unlinkSync} from 'node:fs';
type Item={name?:string;count?:number}|null|undefined;
const clean=(v:unknown,n=100)=>String(v??'').replace(/[\r\n\x00-\x1f§]/g,' ').slice(0,n);
const number=(v:unknown)=>typeof v==='number'&&Number.isFinite(v)?v:null;
function item(value:Item){return value?.name?{id:'minecraft:'+clean(value.name,80).replace(/^minecraft:/,''),count:number(value.count)??1}:null;}
// Vanilla armor points, independent of durability and enchantment mitigation.
function armorPoints(slots:any){
 if(!slots)return null;
 const points:Record<string,number[]>={leather:[1,3,2,1],golden:[2,5,3,1],chainmail:[2,5,4,1],iron:[2,6,5,2],diamond:[3,8,6,3],netherite:[3,8,6,3]};
 const pieces=['helmet','chestplate','leggings','boots'];let sum=0;
 for(let i=0;i<4;i++){const name=slots[5+i]?.name;if(!name)continue;if(i===0&&name==='turtle_helmet'){sum+=2;continue;}const material=name.slice(0,-pieces[i].length-1);if(name!==material+'_'+pieces[i]||!points[material])return null;sum+=points[material][i];}
 return sum;
}
export function observerSnapshot(input:{bot:any;online:boolean;target:string;observer:string;queue:any;last:any;now?:number}){
 const {bot,queue:q={},last,online}=input,now=input.now??Date.now();
 const running=online?q?.running:null,hold=online?q?.hold:null;
 let phase=online?'idle':'offline';
 if(online&&bot?.isSleeping)phase='sleeping';
 else if(hold)phase='held';
 else if(running)phase='executing';
 else if(online&&q?.waiting?.length)phase='queued';
 const p=online?bot?.entity?.position:null;
 return{version:1,at:now,online,target:clean(input.target,32),observer:clean(input.observer,32),
  uuid:online?clean(bot?.entity?.uuid,64):'',phase,hold:clean(hold),
  health:online?number(bot?.health):null,food:online?number(bot?.food):null,
  experience:online?{level:number(bot?.experience?.level),progress:number(bot?.experience?.progress)}:null,
  armor:online?armorPoints(bot?.inventory?.slots):null,
  position:p?[Math.floor(p.x),Math.floor(p.y),Math.floor(p.z)]:null,
  dimension:online?clean(bot?.game?.dimension,60):'',
  task:running?{id:running.id,label:clean(running.label),step:clean(running.step),index:running.stepIndex+1,total:running.stepCount,elapsedMs:number(running.elapsedMs)}:null,
  waiting:online?(q?.waiting??[]).length:0,
  last:online&&last?{at:number(last.at),kind:clean(last.kind,24),text:clean(last.text,130)}:null,
  selected:online?number(bot?.quickBarSlot):null,
  hotbar:online?Array.from({length:9},(_,i)=>item(bot?.inventory?.slots?.[36+i])):[],
  main:online?item(bot?.heldItem):null,off:online?item(bot?.inventory?.slots?.[45]):null};
}
export class ObserverStateWriter{
 private warned=false;
 private file:string;
 private warn:(text:string)=>void;
 constructor(file:string,warn:(text:string)=>void){this.file=file;this.warn=warn;}
 write(value:ReturnType<typeof observerSnapshot>){
  const temp=this.file+'.tmp';
  try{writeFileSync(temp,JSON.stringify(value),'utf8');renameSync(temp,this.file);this.warned=false;}
  catch{try{unlinkSync(temp);}catch{}if(!this.warned){this.warned=true;this.warn('观察者HUD状态写入失败；游戏与模型不受影响。');}}
 }
}
