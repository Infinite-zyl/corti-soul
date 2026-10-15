/** home.ts 的住宅建筑登记控制台；按需查询，无后台模型调用。 */
import type { ConsolePanel, ConsolePanelContext } from '../../../web/shared/client-panel.ts';
import type { Point, HomeRecord, BuildingRecord } from '../home.ts';
type Facility=HomeRecord['facilities'][number]&{status:string};
interface State {realm:string;home:Partial<HomeRecord>&{registered:boolean;facilities?:Facility[]};buildings:BuildingRecord[];protection:{min:Point;max:Point}|null}
interface Survey {center:Point;centerSource:string;dimension:string;facilities:Array<{at:Point;kind:string}>}
const coords=(p:Point)=>p.join(', ');
const range=(b:{min:Point;max:Point})=>`(${coords(b.min)}) 至 (${coords(b.max)})`;
const states:Record<string,string>={present:'已确认存在',occupied:'被占用',invalid:'已失效',unloaded:'尚未加载'};
export const homeLedgerPanel:ConsolePanel={
  mount(ctx:ConsolePanelContext){
    const {ui,root}=ctx;
    const card=ui.sheet({title:'住宅与建筑账本',en:'home & buildings',desc:'保护范围包含边界，禁止范围内挖掘。炉子、工作台、门和箱子仍可正常使用；作物也在禁挖范围内。'});
    root.append(card.el);
    const msg=ui.msgline(),body=ui.h('div'),actions=ui.actions();
    const radius=ui.input({type:'number',value:'12'});radius.min='1';radius.max='64';
    const name=ui.input({placeholder:'例如：自动农田'});
    const refresh=ui.button('刷新登记',{onClick:()=>void run(load)});
    const survey=ui.button('调查附近设施',{onClick:()=>void run(showSurvey)});
    actions.append(refresh,survey,msg);
    card.body.append(actions,body,ui.section('保护范围','半径左右各扩展指定格数；垂直范围为中心下4格至上16格。保存前展示坐标供确认。'),ui.field('水平半径（格）',radius));
    const protect=ui.button('调整家的保护范围',{onClick:()=>void run(async()=>{
      if(!state?.home.returnAt)throw Error('请先在游戏中带她登记家和床');
      await saveBox('protect',state.home.name??'家',state.home.returnAt);
    })});
    card.body.append(protect,ui.section('现场登记建筑','在建筑处站好，调查中心优先使用附近的 Infinite。范围需要覆盖整座建筑；较高或不规则建筑可和她商量精确边界。'),ui.field('建筑名称',name));
    const register=ui.button('登记当前位置的建筑',{variant:'primary',onClick:()=>void run(async()=>{
      if(!name.value.trim())throw Error('请填写建筑名称');
      const s=await readSurvey();await saveBox('building-save',name.value.trim(),s.center,s.dimension,s.centerSource);
    })});card.body.append(register);
    const nearby=ui.h('div');card.body.append(nearby);
    let state:State|null=null,busy=false;
    const buttons=[refresh,survey,protect,register];
    async function run(action:()=>Promise<void>){
      if(busy)return;busy=true;buttons.forEach(b=>b.disabled=true);msg.textContent='';
      try{await action();}catch(e){if(!ctx.signal.aborted)msg.textContent=e instanceof Error?e.message:String(e);}
      finally{busy=false;buttons.forEach(b=>b.disabled=false);}
    }
    async function change(input:Record<string,unknown>){
      const out=await ctx.invoke<string>('change',[input]);
      if(out.startsWith('[mc_home')||out.startsWith('夜间休息'))throw Error(out);
      if(ctx.signal.aborted)return;msg.textContent='已保存';nearby.replaceChildren();await load();
    }
    async function readSurvey():Promise<Survey>{
      const out=await ctx.invoke<string>('survey',[]);
      if(out.startsWith('[mc_home'))throw Error(out);
      return JSON.parse(out) as Survey;
    }
    async function saveBox(action:string,label:string,center:Point,dimension?:string,source?:string){
      const r=Number(radius.value);
      if(!Number.isInteger(r)||r<1||r>64)throw Error('半径需为1至64格的整数');
      const protection={min:[center[0]-r,center[1]-4,center[2]-r] as Point,max:[center[0]+r,center[1]+16,center[2]+r] as Point};
      const replace=action==='building-save'&&state?.buildings.some(b=>b.name===label&&b.dimension===dimension);
      if(!await ui.confirm({title:`${replace?'更新':'保存'}「${label}」的保护范围`,body:`${source?'调查中心：'+source+'；':''}中心 (${coords(center)})\n范围：${range(protection)}\n范围内禁止挖掘，包括作物。确认覆盖所有需要保护的结构。`}))return;
      await change({action,name:label,protection,replace:!!replace,confirmation:`控制台用户确认：${label} ${range(protection)}`});
    }
    async function load(){
      const next=await ctx.invoke<State>('state',[]);if(ctx.signal.aborted)return;state=next;
      body.replaceChildren();
      if(!next.home.registered)body.append(ui.placeholder('尚未登记家。带她到房间，告诉她“这里是我们的家”，再确认两人的床和共享设施。'));
      else{
        body.append(ui.section(next.home.name??'家'),ui.kv([{k:'维度',v:next.home.dimension},{k:'返回位置',v:coords(next.home.returnAt!)},{k:'保护范围',v:next.protection?range(next.protection):'未设置'}]));
        const table=ui.table({head:['设施','用途','坐标','现场状态']});
        for(const f of next.home.facilities??[])table.addRow([f.kind,({'own-bed':'她的床','user-bed':'你的床','shared-storage':'共享容器',workbench:'工作台',furnace:'炉子'})[f.role],coords(f.at),states[f.status]??f.status]);
        body.append(table.el);
      }
      body.append(ui.section('其他建筑'));
      if(!next.buildings.length)body.append(ui.placeholder('尚未登记其他建筑。'));
      for(const b of next.buildings){
        const row=ui.actions();const remove=ui.button('撤销保护',{variant:'danger',size:'sm',onClick:()=>void run(async()=>{
          if(await ui.confirm({title:`撤销「${b.name}」保护？`,body:`${b.dimension}；${range(b.protection)}\n只删除登记，不拆除建筑。`,danger:true}))await change({action:'building-remove',name:b.name,dimension:b.dimension,confirmation:'控制台用户确认撤销 '+b.name});
        })});row.append(ui.h('span','',`${b.name} · ${b.dimension} · ${range(b.protection)}`),remove);body.append(row);
      }
    }
    async function showSurvey(){
      const s=await readSurvey();if(ctx.signal.aborted)return;
      nearby.replaceChildren(ui.section('现场设施候选',`中心 ${s.centerSource} (${coords(s.center)})，16格内已加载设施；候选不代表拥有或授权。`));
      for(const f of s.facilities){
        const role=f.kind==='crafting_table'?'workbench':['furnace','blast_furnace','smoker'].includes(f.kind)?'furnace':['chest','trapped_chest','barrel'].includes(f.kind)?'shared-storage':null;
        const row=ui.actions();row.append(ui.h('span','',`${f.kind} (${coords(f.at)})`));
        if(role&&!state?.home.facilities?.some(x=>coords(x.at)===coords(f.at)))row.append(ui.button('登记为家中共享设施',{size:'sm',onClick:()=>void run(async()=>{
          if(await ui.confirm({title:'确认设施可供她使用？',body:`${f.kind} (${coords(f.at)})；确认这是家中可以使用的设施。`}))await change({action:'facilities',facilities:[{at:f.at,role}],confirmation:'控制台用户确认共享设施 '+f.kind+' '+coords(f.at)});
        })}));nearby.append(row);
      }
      if(!s.facilities.length)nearby.append(ui.placeholder('未找到已加载设施；这不代表周围没有。'));
    }
    void run(load);
    return {dispose(){}};
  },
};
