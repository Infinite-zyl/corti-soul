/** 普通赶路采用walk，迁移旧的挖路偏好；显式采矿仍走原技能。 */
import fs from 'node:fs';import path from 'node:path';
const root=path.resolve(import.meta.dirname,'..'),mc=path.join(path.resolve(process.env.CORTICO_ROOT??path.join(root,'../cortico-qq')),'src/worlds/minecraft'),check=process.argv.includes('--check'),files=new Map();
if(process.argv.slice(2).some(x=>x!=='--check'))throw Error('只支持--check');
function edit(name,marker,anchor,replacement){const f=path.join(mc,name);let i=files.get(f);if(!i){const original=fs.readFileSync(f,'utf8');i={original,text:original};files.set(f,i);}if(i.text.includes(marker))return;if(i.text.split(anchor).length!==2)throw Error(name+'锚点不匹配：'+marker);i.text=i.text.replace(anchor,replacement);}
function testEdit(name,anchor,replacement,count){const f=path.join(mc,'../../../tests/worlds/minecraft',name);let i=files.get(f);if(!i){const original=fs.readFileSync(f,'utf8');i={original,text:original};files.set(f,i);}if(i.text.includes(replacement))return;const n=i.text.split(anchor).length-1;if(n!==count)throw Error('测试锚点不匹配：'+name);i.text=i.text.replaceAll(anchor,replacement);}
try{
 edit('policy.ts',"s.travel !== 'walk'", "s.travel !== 'auto'", "s.travel !== 'walk'");
 edit('policy.ts',"TravelPrefer = 'walk'", "TravelPrefer = 'auto' | 'dig' | 'place'", "TravelPrefer = 'walk' | 'auto' | 'dig' | 'place'");
 edit('policy.ts',"['walk', 'auto', 'dig', 'place']", "['auto', 'dig', 'place']", "['walk', 'auto', 'dig', 'place']");
 edit('policy.ts',"travel: 'walk'", "travel: 'auto'", "travel: 'walk'");
 edit('policy.ts',"walk: '步行绕行，不挖路'", 'const TRAVEL_ZH: Record<TravelPrefer, string> = {',"const TRAVEL_ZH: Record<TravelPrefer, string> = {\n  walk: '步行绕行，不挖路',");
 edit('policy.ts','walk 是当前普通赶路规则', '赶路遇到坎是挖开还是垫过去', 'walk 是当前普通赶路规则：不挖路，允许按现有垫脚名单搭短路；auto/dig/place保留用于旧档案读取，不授权普通寻路挖掘');
 edit('policy.ts','travel    "walk" |', 'travel    "auto" | "dig" | "place"', 'travel    "walk" | "auto" | "dig" | "place"');
 edit('world.ts','walk: { placeCost:', 'const TRAVEL_COSTS: Record<TravelPrefer, { placeCost: number; digCost: number }> = {','const TRAVEL_COSTS: Record<TravelPrefer, { placeCost: number; digCost: number }> = {\n  walk: { placeCost: 2, digCost: 100 },');
 edit('world.ts',"this.policy.get().travel !== 'walk'", "    this.policy = new PolicyBook(ledger('minecraft-policy.json'));", "    this.policy = new PolicyBook(ledger('minecraft-policy.json'));\n    if(this.policy.get().travel !== 'walk')this.policy.set({travel:'walk'}); // 用户要求普通赶路不挖路，保留其他设置。");
 edit('world.ts','旧赶路偏好未采用', '    const { patch, notes } = parsePolicy(args);',"    const { patch, notes } = parsePolicy(args);\n    if(patch.travel!==undefined&&patch.travel!=='walk'){notes.push({field:'travel',given:patch.travel,why:'旧赶路偏好未采用；普通赶路只步行绕行，不用挖掘开路'});patch.travel='walk';}");
 edit('bridge.ts',"from './surface-route.ts'", "import { installHomeEntry } from './home-entry.ts';", "import { installHomeEntry } from './home-entry.ts';\nimport { tuneSurfaceTravel } from './surface-route.ts';");
 edit('bridge.ts','movements.canDig = false;', 'movements.canDig = true;', 'movements.canDig = false;');
 edit('bridge.ts','tuneSurfaceTravel(bot, movements);', '    movements.maxDropDown = 2;', '    tuneSurfaceTravel(bot, movements);');
 // 试算的dig档是明确的假设路线，普通style与walk同实际寻路不挖路。
 edit('bridge.ts',"m.canDig = profile === 'dig';", "      if (profile !== 'style') m.scafoldingBlocks = [];", "      m.canDig = profile === 'dig';\n      if (profile !== 'style') m.scafoldingBlocks = [];");
 testEdit('policy.test.ts','只认 auto/dig/place,没收下','只认 walk/auto/dig/place,没收下',2);
 testEdit('policy.test.ts','赶路遇坎按代价自选挖还是垫','赶路遇坎步行绕行，不挖路',3);
 testEdit('policy.test.ts',"lightWhen: 'dig', travel: 'auto',","lightWhen: 'dig', travel: 'walk',",1);
 testEdit('bridge.test.ts','    const canBreak = (x: number): boolean =>','    expect(m.canDig).toBe(false);\n    m.canDig = true; // 明确dig试算中继续核对成果保护。\n    const canBreak = (x: number): boolean =>',1);
 testEdit('bridge.test.ts','    const stone = { type: registry.blocksByName.stone.id as number, position: new Vec3(3, 60, 3) };','    m.canDig = true; // 明确dig试算，验证退避而非普通赶路许可。\n    const stone = { type: registry.blocksByName.stone.id as number, position: new Vec3(3, 60, 3) };',1);
 edit('ENV_PROMPT.md','## 地面赶路与明确采矿','{{minecraft.home}}',`{{minecraft.home}}

## 地面赶路与明确采矿
用户要求普通赶路优先地面绕行，不挖墙、不钻山、不主动沿洞穴抄近路。普通寻路canDig已关闭，单步落差上限1格；已知低亮且比出发处低3格以上的路点增加代价，优先避开洞穴。这是偏好，不保证所有路线都在露天；树荫、屋内和未知亮度不直接当作洞穴。明确的地下三维目的地允许步行沿现成通道，但不挖路。旧travel:dig已迁移walk，不能自行改回挖路来绕过赶路约定。
走不到时先调查地面、门、桥或绕行方向；报告受阻，不把goto改成tunnel/excavate完成同一个赶路目标。明确采集、建设和你自己规划的采矿任务仍可用原技能，但要先保存其独立目标、准备食物工具与返程，不把深入60至104格的采矿当作出门/取物的默认方式。回家睡床优先和住宅建筑保护保持有效。
`);
 edit('ENV_PROMPT.md','支撑格落差参数保留2','单步落差上限1格','支撑格落差参数保留2（保证正常下一格台阶）');
 const source=path.join(root,'addons/minecraft-home/src/surface-route.ts'),dest=path.join(mc,'surface-route.ts');
 if(check){const bad=[...files].filter(([,i])=>i.text!==i.original).map(([f])=>path.basename(f));if(!fs.existsSync(dest)||!fs.readFileSync(source).equals(fs.readFileSync(dest)))bad.push('surface-route.ts');if(bad.length)throw Error('地面赶路补丁未安装/过期：'+bad.join(','));console.log('地面赶路补丁检查通过');}
 else{for(const [f,i]of files)if(i.text!==i.original){if(!fs.existsSync(f+'.minecraft-surface-route.orig'))fs.copyFileSync(f,f+'.minecraft-surface-route.orig');fs.writeFileSync(f,i.text);}fs.copyFileSync(source,dest);console.log('地面赶路补丁已安装，未启停bot；旧偏好将在下次World构造时迁移。');}
}catch(e){console.error(e.message);process.exit(1);}
