/** 起点搜索失败的保守 fallback：已加载的平地上短步退出窄缝，不挖、不搭、不跳。 */
type Point = { x:number; y:number; z:number };
type Shape = readonly number[];
interface Block { name:string; shapes:readonly Shape[]; getProperties?:()=>Record<string,unknown> }
type Read = (p:Point)=>Block|null;
const DANGER = /^(water|lava|fire|soul_fire|cactus|magma_block|campfire|soul_campfire|sweet_berry_bush|powder_snow|wither_rose)$/;
const recent = new WeakMap<object,number>();
const EPS = 1e-6;

/** 读取真实碰撞盒；栅栏所在整格并不等于整格都不可站。缺失读数不猜为空气。 */
function body(read:Read,p:Point):Map<string,number>|null {
  const overlaps = new Map<string,number>();
  for(let x=Math.floor(p.x-.3+EPS);x<=Math.floor(p.x+.3-EPS);x++)
    for(let y=Math.floor(p.y)-1;y<=Math.floor(p.y+1.8-EPS);y++)
      for(let z=Math.floor(p.z-.3+EPS);z<=Math.floor(p.z+.3-EPS);z++){
        const b=read({x,y,z});
        if(!b||!Array.isArray(b.shapes)||DANGER.test(b.name)||b.getProperties?.().waterlogged===true)return null;
        b.shapes.forEach((s,i)=>{
          const dx=Math.min(p.x+.3,x+s[3]!)-Math.max(p.x-.3,x+s[0]!);
          const dy=Math.min(p.y+1.8,y+s[4]!)-Math.max(p.y,y+s[1]!);
          const dz=Math.min(p.z+.3,z+s[5]!)-Math.max(p.z-.3,z+s[2]!);
          if(dx>EPS&&dy>EPS&&dz>EPS)overlaps.set(`${x},${y},${z},${i}`,dx*dy*dz);
        });
      }
  return overlaps;
}
function supported(read:Read,p:Point):boolean {
  // 四个脚底采样都要有同高度支撑，不跨边缘、落差、水面或未知区块。
  return [-.27,.27].every(dx=>[-.27,.27].every(dz=>{
    const x=Math.floor(p.x+dx),y=Math.floor(p.y-.02),z=Math.floor(p.z+dz),b=read({x,y,z});
    return b&&!DANGER.test(b.name)&&Array.isArray(b.shapes)&&b.shapes.some(s=>
      p.x+dx>=x+s[0]!-EPS&&p.x+dx<=x+s[3]!+EPS&&p.z+dz>=z+s[2]!-EPS&&p.z+dz<=z+s[5]!+EPS&&Math.abs(y+s[4]!-p.y)<.04);
  }));
}

export function safeShortStep(read:Read,from:Point,to:Point):boolean {
  if(Math.abs(from.y-to.y)>.001||Math.hypot(to.x-from.x,to.z-from.z)>.61)return false;
  let previous=body(read,from);if(!previous)return false;
  for(let i=1;i<=12;i++){
    const p={x:from.x+(to.x-from.x)*i/12,y:from.y,z:from.z+(to.z-from.z)*i/12};
    const current=body(read,p);if(!current||!supported(read,p))return false;
    // 已有碰撞只能逐步减少，不能引入新的碰撞或挤得更深。
    for(const [key,value]of current)if(value>(previous.get(key)??0)+EPS)return false;
    previous=current;
  }
  return previous.size===0;
}

interface RecoveryBot {
  entity:{position:Point;id?:number;onGround:boolean;isInWater?:boolean;isInLava?:boolean};entities?:Record<string,{position?:Point;id?:number}>;
  vehicle?:unknown;health?:number;
  pathfinder:{goal?:unknown};
  look:(yaw:number,pitch:number,force:boolean)=>Promise<void>;
  setControlState:(key:'forward'|'sneak',value:boolean)=>void;
}
interface RecoveryContext {
  aborted:()=>boolean; taskId?:number;
  diag?:{write:(data:{lane:'path';event:string;taskId?:number;msg:string;data:Record<string,unknown>})=>unknown};
}
export async function recoverStart(
  bot:RecoveryBot,ctx:RecoveryContext,
  read:Read,
):Promise<number|null>{
  const now=Date.now();
  const health=bot.health??20;
  const available=()=>!ctx.aborted()&&!bot.pathfinder.goal&&!bot.vehicle&&bot.entity.onGround&&!bot.entity.isInWater&&!bot.entity.isInLava&&(bot.health??20)>=health&&health>0;
  if(!available()||now-(recent.get(bot)??-Infinity)<30_000)return null;
  recent.set(bot,now);
  const from={...bot.entity.position};
  const candidates=[[.45,0],[-.45,0],[0,.45],[0,-.45]].map(([dx,dz])=>({x:from.x+dx!,y:from.y,z:from.z+dz!}));
  const occupied=(to:Point)=>Object.values(bot.entities??{}).some(e=>e!==bot.entity&&e.position&&
    Math.abs(e.position.y-from.y)<2&&Math.hypot(e.position.x-to.x,e.position.z-to.z)<1.1);
  const to=candidates.find(p=>safeShortStep(read,from,p)&&!occupied(p));
  if(!to){ctx.diag?.write({lane:'path',event:'goto-start-recovery',taskId:ctx.taskId,msg:'起点短步脱困未执行：没有核验安全的平地落脚方向',data:{from,moved:0,attempted:false}});return 0;}
  let moved=0;
  try{
    if(!available())return null;
    await bot.look(Math.atan2(-(to.x-from.x),-(to.z-from.z)),0,true);
    if(!available())return null;
    bot.setControlState('sneak',true);
    const deadline=Date.now()+900;
    while(Date.now()<deadline&&available()){
      const p=bot.entity.position;
      moved=Math.hypot(p.x-from.x,p.z-from.z);
      const sideways=to.x!==from.x?Math.abs(p.z-from.z):Math.abs(p.x-from.x);
      if(moved>=.42||sideways>.06||Math.abs(p.y-from.y)>.1||!safeShortStep(read,p,to)||occupied(to))break;
      bot.setControlState('forward',true);
      await new Promise(resolve=>setTimeout(resolve,40));
    }
  }finally{
    // 抢占方已经接管目标时，不清它的控制键；换目标本身会让寻路器重置旧键。
    if(!bot.pathfinder.goal){bot.setControlState('forward',false);bot.setControlState('sneak',false);}
    const p=bot.entity.position;
    moved=Math.hypot(p.x-from.x,p.z-from.z);
    ctx.diag?.write({lane:'path',event:'goto-start-recovery',taskId:ctx.taskId,msg:`起点短步脱困实测水平移动 ${moved.toFixed(2)} 格；没有挖掘、放置、跳跃或传送`,data:{from,to:{...p},moved,attempted:true}});
  }
  return available()?moved:null;
}

/** 静态空间探查允许手能开的门连通；真正开门与能否通过仍由执行器核验。 */
export function diagnosticSolid(b:{name:string;boundingBox:string;getProperties?:()=>Record<string,unknown>}):boolean {
  if(b.name.endsWith('_door')||b.name.endsWith('_fence_gate')){
    if(!b.name.startsWith('iron_'))return false;
    const open=b.getProperties?.().open;if(open===true||open==='true')return false;
  }
  return b.boundingBox==='block';
}
