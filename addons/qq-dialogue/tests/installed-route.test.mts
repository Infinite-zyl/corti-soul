import {test} from 'node:test';import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';import {join} from 'node:path';import {pathToFileURL} from 'node:url';
import {fixture} from './active-model-route.test.mjs';
const root=JSON.parse(readFileSync(new URL('../../../runtime-selection.json',import.meta.url),'utf8')).corticoRoot;
await import(pathToFileURL(join(root,'src/extensions/runtime.ts')).href);
const pkg=join(root,'extensions/node_modules/cortico-world-qq-better-alont1');
const {QQWorld}=await import(pathToFileURL(join(pkg,'src/world.ts')).href);
const {Vision}=await import(pathToFileURL(join(pkg,'src/vision.ts')).href);
const {activeModelRoute}=await import(pathToFileURL(join(pkg,'src/active-model-route.ts')).href);
const log:any={warn:()=>{},info:()=>{},child:()=>log};
test('actual QQ generation follows active route, discards old reply after switch, never falls back',async()=>{
 const f=fixture(),original=globalThis.fetch,calls:any[]=[];
 const world:any=new QQWorld({},pkg,f.data,'',(name:string)=>name+'_VALUE');world.log=log;
 let switchInside=false;
 globalThis.fetch=async(url:any,init:any)=>{calls.push({url,body:JSON.parse(init.body),headers:init.headers});if(switchInside)f.select('second');return{ok:true,json:async()=>({choices:[{message:{content:'reply'}}]})}as any;};
 try{
  assert.equal(await world.completeChat('http://legacy','LEGACY','legacy-model',[]),'reply');
  assert.equal(calls[0].url,'http://127.0.0.1:18900/v1/chat/completions');assert.equal(calls[0].body.model,'free-model');assert.equal(calls[0].headers.authorization,'Bearer first_KEY_VALUE');
  switchInside=true;assert.equal(await world.completeChat('legacy','OLD','OLD',[]),null);
  switchInside=false;assert.equal(await world.completeChat('legacy','OLD','OLD',[]),'reply');assert.equal(calls[2].body.model,'other-model');assert.match(calls[2].url,/:8326/);
  f.select('missing');assert.equal(await world.completeChat('legacy','OLD','OLD',[]),null);assert.equal(calls.length,3);
 }finally{globalThis.fetch=original;f.close();}
});
test('actual vision shares active route and pauses if current provider has no vision',async()=>{
 const f=fixture(),original=globalThis.fetch,calls:any[]=[];
 const world:any=new QQWorld({},pkg,f.data);
 const vision:any=new Vision(world.config.vision,log,f.data,(name:string)=>name+'_VALUE',()=>activeModelRoute(f.data));
 globalThis.fetch=async(url:any,init:any)=>{calls.push({url,body:JSON.parse(init.body),headers:init.headers});return{ok:true,json:async()=>({choices:[{message:{content:'picture'}}]})}as any;};
 try{
  assert.equal(vision.ready,true);assert.equal(await vision.describe(new Uint8Array([1])), 'picture');
  assert.equal(calls[0].body.model,'free-model');assert.equal(calls[0].headers.authorization,'Bearer first_KEY_VALUE');
  f.select('second');assert.equal(await vision.describe(new Uint8Array([1])),'picture');assert.match(calls[1].url,/:8326/);
  const file=join(f.dir,'deployments/providers/second/config.json'),entry=JSON.parse(readFileSync(file,'utf8'));entry.multimodal=false;writeFileSync(file,JSON.stringify(entry));
  assert.equal(vision.ready,false);assert.equal(await vision.describe(new Uint8Array([1])),null);assert.equal(calls.length,2);
 }finally{globalThis.fetch=original;f.close();}
});
