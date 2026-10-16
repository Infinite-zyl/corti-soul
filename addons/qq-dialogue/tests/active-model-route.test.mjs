import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {activeModelRoute,routeStillActive} from '../src/active-model-route.ts';
export function fixture(){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'qq-active-route-')),dep=path.join(dir,'deployments/mybot');
 const data=path.join(dep,'data');fs.mkdirSync(data,{recursive:true});
 for(const[name,port,model]of[['first',18900,'free-model'],['second',8326,'other-model']]){
  const folder=path.join(dir,'deployments/providers',name);fs.mkdirSync(folder,{recursive:true});
  fs.writeFileSync(path.join(folder,'config.json'),JSON.stringify({kind:'openai-responses-compat',baseUrl:`http://127.0.0.1:${port}/v1`,spec:{model},secret:name+'_KEY',multimodal:true}));
 }
 const select=name=>fs.writeFileSync(path.join(dep,'config.json'),JSON.stringify({activeProvider:name}));select('first');
 return{dir,dep,data,select,close:()=>fs.rmSync(dir,{recursive:true,force:true})};
}
test('endpoint, model and key reference follow the same active provider without probes',()=>{
 const f=fixture();try{
  const first=activeModelRoute(f.data);assert.equal(first.endpoint,'http://127.0.0.1:18900/v1');assert.equal(first.model,'free-model');assert.equal(first.secret,'first_KEY');
  f.select('second');const second=activeModelRoute(f.data);assert.equal(second.endpoint,'http://127.0.0.1:8326/v1');assert.equal(second.model,'other-model');assert.equal(second.secret,'second_KEY');
  assert.equal(routeStillActive(f.data,first),false);assert.equal(routeStillActive(f.data,second),true);
 }finally{f.close();}
});
test('corruption, missing active provider, traversal and unsupported protocol fail closed',()=>{
 const f=fixture();try{
  const first=activeModelRoute(f.data);f.select('../escape');assert.throws(()=>activeModelRoute(f.data));assert.equal(routeStillActive(f.data,first),false);
  fs.writeFileSync(path.join(f.dep,'config.json'),'broken');assert.throws(()=>activeModelRoute(f.data));
  f.select('first');const file=path.join(f.dir,'deployments/providers/first/config.json'),entry=JSON.parse(fs.readFileSync(file,'utf8'));
  entry.kind='anthropic';fs.writeFileSync(file,JSON.stringify(entry));assert.throws(()=>activeModelRoute(f.data),/已暂停/);
  entry.kind='openai-responses-compat';entry.baseUrl='file:///secret';fs.writeFileSync(file,JSON.stringify(entry));assert.throws(()=>activeModelRoute(f.data));
 }finally{f.close();}
});
