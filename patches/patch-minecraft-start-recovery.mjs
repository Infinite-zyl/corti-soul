/** 起点失败的安全短步 fallback 与诚实诊断；锚点全部预检后安装。 */
import fs from 'node:fs';
import path from 'node:path';
const root=path.resolve(import.meta.dirname,'..'),mc=path.join(path.resolve(process.env.CORTICO_ROOT??path.join(root,'../cortico-qq')),'src/worlds/minecraft');
const check=process.argv.includes('--check'),files=new Map();
if(process.argv.slice(2).some(a=>a!=='--check'))throw Error('只支持 --check');
function edit(name,marker,anchor,replacement){
 const file=path.join(mc,name);let item=files.get(file);
 if(!item){const original=fs.readFileSync(file,'utf8');item={original,text:original};files.set(file,item);}
 if(item.text.includes(marker))return;
 if(item.text.split(anchor).length!==2)throw Error(name+' 锚点不匹配：'+marker);
 item.text=item.text.replace(anchor,replacement);
}
try{
 edit('travel.ts',"from './start-recovery.ts'", "import { throughHomeEntry } from './home-entry.ts';", "import { throughHomeEntry } from './home-entry.ts';\nimport { recoverStart } from './start-recovery.ts';");
 edit('travel.ts','静态空气连通性未计入开门', '`目标封在一个约 ${diag.size} 格的死角里`', '`目标附近静态空气连通空间约 ${diag.size} 格；静态空气连通性未计入开门和进出路线，不能据此判定封死`');
 edit('travel.ts','起点没有生成可用的第一步', "'算不出路:从我站的这一格一步都迈不出去'", "'算不出路:寻路器在起点没有生成可用的第一步；尚未证明身体不能移动'");
 edit('travel.ts',"if (diag?.kind === 'noStand') {\n    throw", "if (diag && diag.kind !== 'open')", "if (diag?.kind === 'noStand')");
 edit('travel.ts','目标空间较小仅作提示', '**目标本身进不去**(站不进人、封在死角)是事实,拦下——确认一万次也走不到。', '目标空间较小仅作提示，不能阻止开门或实际寻路；无候选落脚格仍报告受阻。');
 edit('travel.ts','静态连通性不计门状态与移动规则', ' * 这是当场读得出的世界读数(落脚预检 O(27) + 死角灌水),比寻路器的\n * "限时内没算完"硬——超时只说明 A* 没搜完,分诊说明搜什么都没用。', ' * 这是静态空间读数；静态连通性不计门状态与移动规则，空间较小不等于无法到达。');
 edit('travel.ts','let startRecovered: number | null', '  let unwedged: number | null = null;', '  let unwedged: number | null = null;\n  let startRecovered: number | null = null;');
 // 每轮保留真实起点，不能把原已在目标容差内的任务当作移动证明。
 edit('travel.ts','const startPosition = bot.entity.position.clone();', '  for (let attempt = 0; ; attempt++) {\n    try {', '  for (let attempt = 0; ; attempt++) {\n    const startPosition = bot.entity.position.clone();\n    try {');
 edit('travel.ts','probe.visited !== undefined && probe.visited <= 1', '      if (!(err instanceof Wedged)) throw err;', `      if (!(err instanceof Wedged)) {
        if(attempt===0 && err instanceof SkillBlocked && !ctx.aborted() && !bot.pathfinder.goal
          && bot.entity.position.distanceTo(startPosition)<0.1){
          const probes=ctx.probeRoutes?.(goalCell(goal)??feetOf(bot),goal);
          if(probes?.length && probes.every(probe=>probe.status==='noPath' && probe.visited !== undefined && probe.visited <= 1)){
            startRecovered=await recoverStart(bot,ctx,p=>bot.blockAt(new Vec3(p.x,p.y,p.z)));
            checkAbort(ctx);
            if(startRecovered!==null && startRecovered>=UNWEDGE_MOVED)continue;
          }
        }
        if(startRecovered!==null && err instanceof SkillBlocked)throw new SkillBlocked(err.message+'；起点短步脱困实测水平移动 '+startRecovered.toFixed(2)+' 格，未证明已脱困；未继续重试。');
        throw err;
      }`);
 edit('bridge.ts',"from './start-recovery.ts'", "import { tuneSurfaceTravel } from './surface-route.ts';", "import { tuneSurfaceTravel } from './surface-route.ts';\nimport { diagnosticSolid } from './start-recovery.ts';");
 edit('bridge.ts','solid: diagnosticSolid(b)', "return b ? { name: b.name, solid: b.boundingBox === 'block' } : null;", 'return b ? { name: b.name, solid: diagnosticSolid(b) } : null;');
 const test=path.join(mc,'../../../tests/worlds/minecraft/executor-3.test.ts');
 const original=fs.readFileSync(test,'utf8');let text=original.replaceAll('从我站的这一格一步都迈不出去','寻路器在起点没有生成可用的第一步；尚未证明身体不能移动').replaceAll(".toContain('一步都迈不出去')", ".toContain('起点没有生成可用的第一步')").replace(".toContain('约 7 格的死角')", ".toContain('静态空气连通空间约 7 格')").replace('visited=1:说破一步都迈不出去','visited=1:只报告搜索没有生成第一步');
 files.set(test,{original,text});
 const source=path.join(root,'addons/minecraft-home/src/start-recovery.ts'),dest=path.join(mc,'start-recovery.ts');
 if(check){const bad=[...files].filter(([,v])=>v.text!==v.original).map(([f])=>path.basename(f));if(!fs.existsSync(dest)||!fs.readFileSync(source).equals(fs.readFileSync(dest)))bad.push('start-recovery.ts');if(bad.length)throw Error('补丁未安装/过期：'+bad.join(','));console.log('起点脱困补丁检查通过');}
 else{for(const [f,v]of files)if(v.text!==v.original){if(!fs.existsSync(f+'.minecraft-start-recovery.orig'))fs.copyFileSync(f,f+'.minecraft-start-recovery.orig');fs.writeFileSync(f,v.text);}fs.copyFileSync(source,dest);console.log('起点脱困补丁已安装，未启停 bot');}
}catch(e){console.error(e.message);process.exit(1);}
