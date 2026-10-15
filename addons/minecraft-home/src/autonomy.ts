/** 无模型探测：脱困证据授权与夜间同目的请求判定。 */
import type {HomeRecord,Point} from './home.ts';
interface Body {entity:{position:{x:number;y:number;z:number}};game?:{dimension?:string}}
const stuck=new WeakMap<object,{at:Point;dimension:string;time:number}>();
const used=new WeakMap<object,number>();
const dimension=(bot:Body)=>String(bot.game?.dimension??'overworld').replace(/^minecraft:/,'');
export function noteFailedUnwedge(bot:Body,now=Date.now()):void {
 const p=bot.entity.position;stuck.set(bot,{at:[p.x,p.y,p.z],dimension:dimension(bot),time:now});
}
/** 只接受真实寻路脱困失败留下的证据；模型不能通过工具参数声明卡死。 */
export function claimStuckTeleport(bot:Body,now=Date.now()):string|null {
 const e=stuck.get(bot),p=bot.entity.position;
 if(!e||now-e.time>90_000||dimension(bot)!==e.dimension||Math.hypot(p.x-e.at[0],p.y-e.at[1],p.z-e.at[2])>2)
   return '传送未执行：没有当前位置90秒内“持续无进展且机械脱困失败”的证据。回家、天黑、缺食物和普通受阻都应步行或改计划，不能用TP代替。';
 if(now-(used.get(bot)??-Infinity)<300_000)return '传送未执行：脱困传送冷却5分钟；请换路线或请求协助。';
 stuck.delete(bot);used.set(bot,now);return null;
}
export function isHomeRestRequest(steps:readonly {skill:string;at?:unknown}[],home:HomeRecord|null):boolean {
 if(!home||!steps.length)return false;
 const bed=home.facilities.find(f=>f.role==='own-bed')?.at;if(!bed)return false;
 const same=(a:unknown,b:Point)=>Array.isArray(a)&&a.length===3&&a.every((n,i)=>typeof n==='number'&&n===b[i]);
 return steps.every(s=>s.skill==='goto'?(same(s.at,bed)||same(s.at,home.returnAt)):s.skill==='use'&&same(s.at,bed));
}
