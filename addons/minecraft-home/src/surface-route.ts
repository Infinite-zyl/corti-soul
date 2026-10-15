/** 普通赶路不挖路；已知阴暗低处加代价，不把未知亮度当洞穴。 */
export function caveStepCost(y:number,skyLight:unknown,originY:number,targetY?:number):number {
 if(typeof skyLight!=='number'||!Number.isFinite(skyLight)||!Number.isFinite(y)||!Number.isFinite(originY))return 0;
 if(typeof targetY==='number'&&targetY<originY-4)return 0;
 return y<originY-3&&skyLight<=3?30:0;
}
const tuned=new WeakSet<object>();
export function tuneSurfaceTravel<B extends {position?:{y:number};skyLight?:unknown}>(bot:{entity?:{position:{y:number}};pathfinder?:{goal?:unknown}},movements:{canDig:boolean;maxDropDown:number;exclusionAreasStep:Array<(b:B)=>number>}):void {
 // 寻路库按支撑格计落差，2才能下正常的一格实心台阶。
 movements.canDig=false;movements.maxDropDown=2;
 if(tuned.has(movements))return;tuned.add(movements);
 movements.exclusionAreasStep.push(b=>{
  if(movements.canDig)return 0; // 明确dig假设试算不套普通赶路偏好。
  const goal=bot.pathfinder?.goal as {y?:number}|undefined;
  return caveStepCost(b.position?.y??NaN,b.skyLight,bot.entity?.position.y??NaN,goal?.y);
 });
}
