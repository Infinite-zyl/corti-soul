/** Run after patch-qq-dialogue. QQ 0.1.17 only; preflight before writes. */
import fs from 'node:fs';import path from 'node:path';
const root=path.resolve(process.env.CORTICO_ROOT??JSON.parse(fs.readFileSync(new URL('../runtime-selection.json',import.meta.url),'utf8')).corticoRoot);
const pkg=path.join(root,'extensions/node_modules/cortico-world-qq-better-alont1');
if(JSON.parse(fs.readFileSync(path.join(pkg,'package.json'),'utf8')).version!=='0.1.17')throw Error('QQ版本不匹配');
const files=new Map();
function edit(file,from,to){let source=files.get(file)??fs.readFileSync(path.join(pkg,'src',file),'utf8').replaceAll('\r\n','\n');if(!source.includes(to)){if(source.split(from).length!==2)throw Error(file+' 锚点不匹配：'+from.slice(0,65));source=source.replace(from,to);}files.set(file,source);}
edit('world.ts',"import { DialogueLedger } from './dialogue-ledger.ts';","import { DialogueLedger } from './dialogue-ledger.ts';\nimport { activeModelRoute, routeStillActive } from './active-model-route.ts';");
edit('world.ts','    this.vision = new Vision(this.config.vision, consoleLogger());','    this.vision = new Vision(this.config.vision, consoleLogger(), this.dataDir, name => this.resolveSecret(name), () => activeModelRoute(this.dataDir));');
edit('world.ts','    this.vision = new Vision(this.config.vision, this.log, this.dataDir, (name) => this.resolveSecret(name));','    this.vision = new Vision(this.config.vision, this.log, this.dataDir, (name) => this.resolveSecret(name), () => activeModelRoute(this.dataDir));');
edit('world.ts','    const apiKey = this.resolveSecret(apiKeySecret);',`    // Own deployment policy: all QQ generations follow the active main provider.
    let route: ReturnType<typeof activeModelRoute>;
    try { route = activeModelRoute(this.dataDir); }
    catch { this.log.warn('当前主模型配置不可用，QQ辅助调用已跳过；不会回退到独立模型'); return null; }
    endpoint = route.endpoint; model = route.model; apiKeySecret = route.secret;
    const apiKey = this.resolveSecret(apiKeySecret);`);
edit('world.ts',"      const text = json.choices?.[0]?.message?.content?.trim();\n      return text || null;","      if (!routeStillActive(this.dataDir, route)) return null; // Discard a result from a replaced provider.\n      const text = json.choices?.[0]?.message?.content?.trim();\n      return text || null;");
edit('world.ts',"          return '看不了图：视觉端点没配（`worlds.qqbot.vision`）。让主人开一下。';","          return '当前主模型的视觉能力或鉴权不可用，暂时看不了图；不会切到另一个识图模型。';");
edit('vision.ts',"import type { Logger } from 'cortico/core/types.ts';","import type { Logger } from 'cortico/core/types.ts';\nimport type { ActiveModelRoute } from './active-model-route.ts';");
edit('vision.ts','    if (!this.cfg.enabled) return null;','    if (!this.cfg.enabled || !this.ready) return null;');
edit('vision.ts','  async viewImage(url: string): Promise<string | null> {','  async viewImage(url: string): Promise<string | null> {\n    if (!this.ready) return null;');
edit('vision.ts','    secret?: (name: string) => string | undefined,','    secret?: (name: string) => string | undefined,\n    private readonly activeRoute?: () => ActiveModelRoute,');
edit('vision.ts','    return !!this.cfg.endpoint && !!this.secret(this.cfg.apiKeySecret);',`    try {
      const route = this.activeRoute?.();
      if (route) return route.vision && !!this.secret(route.secret);
      return !!this.cfg.endpoint && !!this.secret(this.cfg.apiKeySecret);
    } catch { return false; }`);
edit('vision.ts','    const apiKey = this.secret(this.cfg.apiKeySecret);',`    let route: ActiveModelRoute | undefined;
    try { route = this.activeRoute?.(); } catch { return null; }
    if (route && !route.vision) return null;
    const endpoint = route?.endpoint ?? this.cfg.endpoint;
    const model = route?.model ?? this.cfg.model;
    const apiKey = this.secret(route?.secret ?? this.cfg.apiKeySecret);`);
edit('vision.ts',"      const res = await fetch(`${this.cfg.endpoint.replace(/\\/$/, '')}/chat/completions`, {","      const res = await fetch(`${endpoint.replace(/\\/$/, '')}/chat/completions`, {");
edit('vision.ts','          model: this.cfg.model,','          model,');
edit('vision.ts',"      const text = json.choices?.[0]?.message?.content?.trim();","      try { if (route && this.activeRoute?.().signature !== route.signature) return null; } catch { return null; }\n      const text = json.choices?.[0]?.message?.content?.trim();");
for(const[key,title,old]of[
 ['vision','VLM 模型',''],
 ['proactive','主动消息模型','生成主动闲聊用的 chat 模型（OpenAI 兼容端点）。'],
 ['qzone','动态生成模型','生成动态/评论所用 chat 模型（OpenAI 兼容端点）。'],
 ['emotion','情绪感知模型','用于分析用户消息情绪、抽取心情变化的 chat 模型（OpenAI 兼容端点）。'],
]){
 const prefix=`      'worlds.qqbot.${key}.model': { type: 'string', title: '${title}', 'x-hot': false`;
 edit('config.ts',prefix+(old?`, description: '${old}'`:'')+' },',prefix+", description: '本部署始终跟随当前主模型；本字段仅保留兼容，不用于独立选模。' },");
}
const helper=fs.readFileSync(new URL('../addons/qq-dialogue/src/active-model-route.ts',import.meta.url),'utf8');
if(process.argv.includes('--apply')){
 for(const[file,source]of files){const p=path.join(pkg,'src',file);if(!fs.existsSync(p+'.active-route.orig'))fs.copyFileSync(p,p+'.active-route.orig');fs.writeFileSync(p,source);}
 fs.writeFileSync(path.join(pkg,'src/active-model-route.ts'),helper);
 console.log('QQ统一主模型补丁已安装；正常重启Cortico后生效。');
}else console.log('QQ统一主模型补丁预检通过；--apply才写入。');
