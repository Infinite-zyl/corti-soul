import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
const script = resolve('patches/patch-minecraft-home.mjs');
function fixture(broken=false) {
  const root = mkdtempSync(join(tmpdir(),'home-patch-'));const mc=join(root,'src/worlds/minecraft');mkdirSync(mc,{recursive:true});
  writeFileSync(join(mc,'world.ts'),[
    "import { Vec3 } from 'vec3';",
    "export const MINECRAFT_TOOL_DECLS: ReadonlyArray<Omit<ToolDef, 'handler'>> = [",
    '  private readonly worldFile: string | null;',
    "    this.worldFile = ledger('minecraft-world.json');",
    "      mc_goal: async (args) => this.toolLog('mc_goal', args, this.setGoal(args)),",
    '  tools(): ToolDef[] {',
    "      'minecraft.world': worldEnvLine(this.worldIdentity()),",
    '    const marks = mapSnapshotLine(this.markTable().list);',
    "      { key: 'marks' as const, text: marks, cmp: marks },",
    '`|goals:${goals}|marks:${marks}`;',
  ].join('\n'));
  writeFileSync(join(mc,'proxy.ts'),[
    "import { loadPolicy, renderPolicyEnv } from './policy.ts';",
    "      'minecraft.policy': renderPolicyEnv(loadPolicy(this.storageFileOf('minecraft-policy'))),",
    '          vars: [',
  ].join('\n'));
  writeFileSync(join(mc,'ENV_PROMPT.md'),broken?'unknown':'{{minecraft.world}}');
  return {root,mc};
}
const run=(root,...args)=>spawnSync(process.execPath,[script,...args],{encoding:'utf8',env:{...process.env,CORTICO_ROOT:root}});
test('住宅补丁可独立安装、重复安装不重复插入，check不写盘',()=>{
  const f=fixture();try{
    assert.equal(run(f.root).status,0);
    const before=readFileSync(join(f.mc,'world.ts'),'utf8');
    assert.equal(run(f.root).status,0);assert.equal(run(f.root,'--check').status,0);
    assert.equal(readFileSync(join(f.mc,'world.ts'),'utf8'),before);
    assert.equal(before.split('mc_home: async').length,2);
    assert.match(readFileSync(join(f.mc,'proxy.ts'),'utf8'),/minecraft.home/);
  }finally{rmSync(f.root,{recursive:true,force:true});}
});
test('任何锚点不匹配都先停止，不部分写入World',()=>{
  const f=fixture(true);try{
    const before=readFileSync(join(f.mc,'world.ts'),'utf8');
    assert.equal(run(f.root).status,1);assert.equal(readFileSync(join(f.mc,'world.ts'),'utf8'),before);
  }finally{rmSync(f.root,{recursive:true,force:true});}
});
