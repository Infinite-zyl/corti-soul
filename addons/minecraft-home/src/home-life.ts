/** 用户要求的住宅破坏边界与夜间优先规则；不调用模型。 */
import type { HomeRecord, Point } from './home.ts';
export interface HomeBox { min: Point; max: Point }
/** 未划边界的旧登记采用保守范围，明确覆盖登记设施周边的墙柱与屋顶。 */
export function homeBox(home: HomeRecord): HomeBox {
  if (home.protection) return home.protection;
  const points = [home.returnAt, ...home.facilities.map((f) => f.at)];
  return {
    min: [Math.min(...points.map(p=>p[0]))-6, Math.min(...points.map(p=>p[1]))-2, Math.min(...points.map(p=>p[2]))-6],
    max: [Math.max(...points.map(p=>p[0]))+6, Math.max(...points.map(p=>p[1]))+6, Math.max(...points.map(p=>p[2]))+6],
  };
}
export function protectedHomeCell(home: HomeRecord | null, dimension: string, at: Point): boolean {
  if (!home || home.dimension !== dimension) return false;
  const box = homeBox(home);
  return at.every((n,i)=>n>=box.min[i]! && n<=box.max[i]!);
}
interface DigBlock { position: {x:number;y:number;z:number} }
interface DigBot { dig(block: DigBlock, ...args: unknown[]): Promise<unknown> }
const installed = new WeakSet<object>();
const digGuards = new WeakMap<object, (at:Point)=>boolean>();
export function homeDigDenied(bot:object, at:Point):boolean {return digGuards.get(bot)?.(at)??false;}
/** 兜底拦截所有显式dig；路径搜索另用同一判据排除，避免先选中墙再失败。 */
export function installHomeDigGuard(bot: DigBot, denied: (at: Point)=>boolean): void {
  if (installed.has(bot)) return;
  installed.add(bot);
  digGuards.set(bot,denied);
  const original = bot.dig;
  bot.dig = function(block, ...args) {
    const p=block.position;
    if (denied([p.x,p.y,p.z])) return Promise.reject(new Error('住宅保护/建筑保护：这里是已登记的保护范围，不允许采集或挖掘通行，请走门、绕路或去外部资源区。'));
    return original.call(this,block,...args);
  };
}

export interface NightInput {
  time: number; now: number; home: HomeRecord | null; dimension: string;
  sleeping: boolean; pending: boolean; atHome: boolean; health: number;
  bedState: 'present'|'occupied'|'invalid'|'unloaded';
  emergency?: boolean;
}
export interface NightHooks {
  priority(active:boolean): void;
  submit(steps: Array<{skill:'goto'|'use';at:Point}>): void;
  notify(text:string): void;
}
export class NightRest {
  active=false;
  state='白天';
  private attempts=0;
  private nextTry=0;
  private announce(state:string,h:NightHooks):void {
    if(this.state===state)return;
    this.state=state;h.notify(state);
  }
  tick(i:NightInput,h:NightHooks):void {
    const night=i.time>=12000 && i.time<24000;
    if(!night){
      if(this.active){this.active=false;h.priority(false);this.announce('天亮了，解除夜间优先，恢复暂存工作。',h);}
      this.attempts=0;this.nextTry=0;return;
    }
    if(!this.active){this.active=true;h.priority(true);this.announce('夜间优先：暂停其他工作，回家睡自己的床；仅即时脱险可以暂时抢占。',h);}
    const home=i.home;
    if(!home){this.announce('夜间优先：没有住宅登记，暂停冒险，等待确认家和床。',h);return;}
    if(home.dimension!==i.dimension || !i.dimension.includes('overworld')){
      this.announce('夜间优先：当前维度不能使用登记床，需要安全返回主世界；不会在异维度点击床。',h);return;
    }
    if(i.sleeping){this.announce('已经睡下，普通事务不能抢占；实际床位以游戏回执为准。',h);return;}
    if(i.pending)return;
    if(i.emergency){this.announce('夜间优先：先处理即时危险，脱险后继续回家。',h);return;}
    const bed=home.facilities.find(f=>f.role==='own-bed');
    if(!bed||i.bedState==='invalid'){this.announce('夜间优先：自己的床已失效，停止其他事务，等待修复床。',h);return;}
    if(i.atHome&&i.bedState==='occupied'){this.announce('已到家，自己的床被占用，等待腾床；不借用用户的床、不出去工作。',h);return;}
    if(i.atHome&&i.time<12542){this.announce('已回家，等待游戏允许入睡；不再开启工作。',h);return;}
    if(i.now<this.nextTry)return;
    if(this.attempts>=3){this.announce('夜间回家/睡床连续受阻，已停止自动重试；保持夜间优先，请协助检查道路、床或附近怪物。',h);return;}
    this.attempts++;this.nextTry=i.now+60_000;
    const steps:Array<{skill:'goto'|'use';at:Point}>=[];
    if(!i.atHome)steps.push({skill:'goto',at:home.returnAt});
    if(i.time>=12542 && i.bedState!=='occupied')steps.push({skill:'use',at:bed.at});
    if(steps.length){this.announce('夜间优先：正在回家或使用自己的床。',h);h.submit(steps);}
  }
}
