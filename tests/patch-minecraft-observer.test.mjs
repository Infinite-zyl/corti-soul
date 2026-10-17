import {test} from 'node:test';import assert from 'node:assert/strict';
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import {spawnSync} from 'node:child_process';
const patch=path.resolve('patches/patch-minecraft-observer.mjs');
const original="import { Bridge } from './bridge.ts';\n  private worldTimer: ReturnType<typeof setInterval> | null = null;\n  private worldTick(): void {\n}\n    this.shuttingDown = true;\n";
function fixture(source=original,version='0.2.1'){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'observer-patch-')),folder=path.join(root,'src/worlds/minecraft');fs.mkdirSync(folder,{recursive:true});
 fs.writeFileSync(path.join(root,'package.json'),JSON.stringify({version}));fs.writeFileSync(path.join(folder,'world.ts'),source);
 const run=(...args)=>spawnSync(process.execPath,[patch,...args],{env:{...process.env,CORTICO_ROOT:root},encoding:'utf8'});
 return{root,folder,run,read:()=>fs.readFileSync(path.join(folder,'world.ts'),'utf8'),close:()=>fs.rmSync(root,{recursive:true,force:true})};
}
test('dry preflight does not write; apply is idempotent and keeps original',()=>{
 const f=fixture();try{
  const preflight=f.run('--check');assert.equal(preflight.status,0,preflight.stderr);assert.equal(f.read(),original);assert.equal(fs.existsSync(path.join(f.folder,'observer-state.ts')),false);
  let r=f.run('--apply');assert.equal(r.status,0,r.stderr);const installed=f.read();r=f.run('--apply');assert.equal(r.status,0,r.stderr);assert.equal(f.read(),installed);
  assert.equal(fs.readFileSync(path.join(f.folder,'world.ts.observer.orig'),'utf8'),original);assert.ok(fs.existsSync(path.join(f.folder,'observer-state.ts')));
 }finally{f.close();}
});
test('unsupported version or missing hook rejects before writing',()=>{
 for(const[source,version]of[[original.replace('private worldTick','private changedTick'),'0.2.1'],[original,'0.3.0']]){
  const f=fixture(source,version);try{assert.notEqual(f.run('--apply').status,0);assert.equal(f.read(),source);assert.equal(fs.existsSync(path.join(f.folder,'observer-state.ts')),false);}finally{f.close();}
 }
});
