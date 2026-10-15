/** 实际World迁移赶路偏好，不启动bot。 */
import assert from 'node:assert/strict';import {mkdtempSync,writeFileSync,readFileSync,rmSync} from 'node:fs';import {tmpdir} from 'node:os';import {resolve,join} from 'node:path';import {pathToFileURL} from 'node:url';
const root=resolve(process.env.CORTICO_ROOT??resolve(import.meta.dirname,'../../../../cortico-qq'));
const {MinecraftWorld}=await import(pathToFileURL(join(root,'src/worlds/minecraft/world.ts')).href);
const {MINECRAFT_DEFAULTS}=await import(pathToFileURL(join(root,'src/worlds/minecraft/config.ts')).href);
const dir=mkdtempSync(join(tmpdir(),'mc-surface-policy-'));
try{
 const file=join(dir,'minecraft-policy.json');writeFileSync(file,JSON.stringify({travel:'dig',scaffold:['dirt'],light:['torch'],lightWhen:'anywhere',reserve:['iron_pickaxe'],fight:'armed'}));
 const world=new MinecraftWorld({cfg:structuredClone(MINECRAFT_DEFAULTS),dataDir:dir});assert.equal(world.policy.get().travel,'walk');
 const saved=JSON.parse(readFileSync(file,'utf8'));assert.deepEqual(saved.scaffold,['dirt']);assert.deepEqual(saved.reserve,['iron_pickaxe']);assert.equal(saved.lightWhen,'anywhere');assert.equal(saved.travel,'walk');
 assert.match(world.setPolicy({travel:'dig'}),/旧赶路偏好未采用/);assert.equal(world.policy.get().travel,'walk');
 assert.equal(new MinecraftWorld({cfg:structuredClone(MINECRAFT_DEFAULTS),dataDir:dir}).policy.get().travel,'walk');
 console.log('实际World：旧dig迁移walk、保留其他偏好、拒绝模型恢复挖路、重建保留通过。');
}finally{rmSync(dir,{recursive:true,force:true});}
