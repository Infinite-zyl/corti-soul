/** 家门是用户确认的局部路线；不从房屋外观推断室内边界。 */
import type {HomeRecord,Point,HomeEntrance} from './home.ts';
export function homePassage(home:HomeRecord|null,dimension:string,from:Point,to:Point):{before:Point;after:Point;door:HomeEntrance}|null {
 const e=home?.entrance;if(!home||!e||home.dimension!==dimension)return null;
 if(Math.abs(from[1]-e.at[1])>4&&Math.abs(to[1]-e.at[1])>4)return null;
 if(Math.min(Math.hypot(from[0]-e.at[0],from[2]-e.at[2]),Math.hypot(to[0]-e.at[0],to[2]-e.at[2]))>12)return null;
 const side=(p:Point)=>(p[0]-e.at[0])*(e.inside[0]-e.at[0])+(p[2]-e.at[2])*(e.inside[2]-e.at[2]);
 const a=side(from),b=side(to);if(a*b>=0)return null;
 const insidePoint=a>0?from:to;
 if(Math.hypot(...insidePoint.map((n,i)=>n-home.returnAt[i]!))>6)return null;
 return {before:a>0?e.inside:e.outside,after:a>0?e.outside:e.inside,door:e};
}
const entries=new WeakMap<object,()=>HomeRecord|null>(),crossing=new WeakSet<object>();
export function installHomeEntry(bot:object,read:()=>HomeRecord|null):void {entries.set(bot,read);}
export async function throughHomeEntry(bot:object,dimension:string,from:Point,to:Point,actions:{go(p:Point):Promise<void>;open(at:Point,kind:string):Promise<void>}):Promise<void> {
 if(crossing.has(bot))return;
 const route=homePassage(entries.get(bot)?.()??null,dimension,from,to);if(!route)return;
 crossing.add(bot);try{await actions.go(route.before);await actions.open(route.door.at,route.door.kind);await actions.go(route.after);}finally{crossing.delete(bot);}
}
