/** 实际ConsoleUi与账本面板的DOM交互，无服务请求或模型。 */
import assert from 'node:assert/strict';
import {resolve,join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createRequire} from 'node:module';
const root=resolve(process.env.CORTICO_ROOT??resolve(import.meta.dirname,'../../../../cortico-qq'));
const require=createRequire(join(root,'package.json'));const {JSDOM}=require('jsdom');
const dom=new JSDOM('<html><body><main></main><aside></aside></body></html>',{url:'http://localhost'});
const doc=dom.window.document;const controller=new dom.window.AbortController();
const {createConsoleUi}=await import(pathToFileURL(join(root,'src/web/client/ui/index.ts')).href);
const {homeLedgerPanel}=await import(pathToFileURL(join(root,'src/worlds/minecraft/console/home-ledger.ts')).href);
const ui=createConsoleUi({doc,overlayHost:doc.querySelector('aside'),signal:controller.signal,memo:{get:(_k:string,f:unknown)=>f,set(){}}});
let accept=false;const confirmations:string[]=[];ui.confirm=async(a:{body:string})=>{confirmations.push(a.body);return accept;};
const requests:Record<string,unknown>[]=[];
const state={realm:'test',home:{registered:true,name:'家',dimension:'minecraft:overworld',returnAt:[0,64,0],facilities:[{at:[1,64,0],kind:'red_bed',role:'own-bed',status:'unloaded'}]},buildings:[],protection:{min:[-6,62,-6],max:[7,70,6]}};
let fail=false;
const mounted=homeLedgerPanel.mount({root:doc.querySelector('main'),signal:controller.signal,ui,invoke:async(method:string,args:unknown[])=>{
 if(fail)throw Error('测试连接已断开');
 if(method==='state')return structuredClone(state);
 if(method==='survey')return JSON.stringify({center:[10,64,0],centerSource:'Infinite',dimension:'minecraft:overworld',facilities:[{at:[2,64,0],kind:'furnace'}]});
 if(method==='change'){requests.push(args[0] as Record<string,unknown>);return '已保存';}
 throw Error('未知测试方法');
}});
const settle=()=>new Promise(r=>setTimeout(r,0));
const click=(text:string)=>{const b=[...doc.querySelectorAll('button')].find((b:any)=>b.textContent===text) as HTMLButtonElement;assert.ok(b,text);b.click();};
try{
 await settle();assert.match(doc.body.textContent,/尚未加载/);assert.equal(doc.querySelectorAll('th').length,4);
 click('调整家的保护范围');await settle();assert.equal(requests.length,0);assert.match(confirmations[0],/-12, 60, -12/);
 accept=true;click('调整家的保护范围');await settle();assert.deepEqual(requests[0].protection,{min:[-12,60,-12],max:[12,80,12]});
 doc.querySelector('input[placeholder]').value='自动农田';click('登记当前位置的建筑');await settle();assert.equal(requests[1].action,'building-save');assert.deepEqual(requests[1].protection,{min:[-2,60,-12],max:[22,80,12]});assert.match(confirmations.at(-1)!,/Infinite/);
 click('调查附近设施');await settle();click('登记为家中共享设施');await settle();assert.equal(requests[2].action,'facilities');
 fail=true;click('刷新登记');await settle();assert.match(doc.body.textContent,/连接已断开/);assert.ok([...doc.querySelectorAll('button')].every((b:any)=>!b.disabled));
 console.log('真实ConsoleUi DOM：床未加载状态、半径确认取消/保存、玩家中心建筑登记、共享炉子补登记和断线解锁通过。');
}finally{controller.abort();await mounted?.dispose();dom.window.close();}
