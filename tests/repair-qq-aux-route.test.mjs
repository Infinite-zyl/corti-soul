import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {spawnSync} from 'node:child_process';
const source=fs.readFileSync(new URL('../tools/repair-qq-aux-route.mjs',import.meta.url),'utf8');
function fixture(){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'qq-route-'));
 const runtime=path.join(dir,'runtime'),dep=path.join(runtime,'deployments/mybot'),provider=path.join(runtime,'deployments/providers/active');
 fs.mkdirSync(dep,{recursive:true});fs.mkdirSync(provider,{recursive:true});fs.mkdirSync(path.join(dir,'tools'));
 fs.writeFileSync(path.join(dir,'tools/repair.mjs'),source);
 fs.writeFileSync(path.join(dir,'runtime-selection.json'),JSON.stringify({corticoRoot:runtime}));
 fs.writeFileSync(path.join(provider,'config.json'),JSON.stringify({baseUrl:'http://127.0.0.1:8326/v1',secret:'KEY_REFERENCE',spec:{model:'active-model'}}));
 const file=path.join(dep,'config.json');
 fs.writeFileSync(file,JSON.stringify({activeProvider:'active',other:'keep',worlds:{qqbot:{proactive:{enabled:true,endpoint:'http://127.0.0.1:18899/v1',model:'old'},emotion:{enabled:false,endpoint:'custom'}}}}));
 const run=(...args)=>spawnSync(process.execPath,[path.join(dir,'tools/repair.mjs'),...args],{encoding:'utf8'});
 return{dir,dep,file,run};
}
test('dry run preserves config; apply backs up once, keeps disabled/custom fields, is repeatable',()=>{
 const f=fixture();try{
  const before=fs.readFileSync(f.file,'utf8');assert.equal(f.run().status,0);assert.equal(fs.readFileSync(f.file,'utf8'),before);
  const applied=f.run('--apply');assert.equal(applied.status,0,applied.stderr);
  const updated=JSON.parse(fs.readFileSync(f.file,'utf8'));
  assert.equal(updated.worlds.qqbot.proactive.endpoint,'http://127.0.0.1:8326/v1');
  assert.equal(updated.worlds.qqbot.proactive.apiKeySecret,'KEY_REFERENCE');
  assert.equal(updated.worlds.qqbot.emotion.endpoint,'custom');assert.equal(updated.other,'keep');
  const backups=fs.readdirSync(f.dep).filter(n=>n.includes('backup'));assert.equal(backups.length,1);
  assert.equal(fs.readFileSync(path.join(f.dep,backups[0]),'utf8'),before);
  assert.equal(f.run('--apply').status,0);
  assert.equal(fs.readdirSync(f.dep).filter(n=>n.includes('backup')).length,1);
 }finally{fs.rmSync(f.dir,{recursive:true,force:true});}
});
test('unrecognized active custom endpoint rejects all writes',()=>{
 const f=fixture();try{
  const cfg=JSON.parse(fs.readFileSync(f.file,'utf8'));cfg.worlds.qqbot.emotion.enabled=true;
  const before=JSON.stringify(cfg);fs.writeFileSync(f.file,before);
  assert.notEqual(f.run('--apply').status,0);assert.equal(fs.readFileSync(f.file,'utf8'),before);
  assert.deepEqual(fs.readdirSync(f.dep),['config.json']);
 }finally{fs.rmSync(f.dir,{recursive:true,force:true});}
});
