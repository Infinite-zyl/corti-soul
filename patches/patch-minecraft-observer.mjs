import fs from 'node:fs';import path from 'node:path';
const root=path.resolve(process.env.CORTICO_ROOT??JSON.parse(fs.readFileSync(new URL('../runtime-selection.json',import.meta.url),'utf8')).corticoRoot);
if(JSON.parse(fs.readFileSync(path.join(root,'package.json'),'utf8')).version!=='0.2.1')throw Error('观察者补丁当前仅适配Cortico 0.2.1，请先适配新版本');
const folder=path.join(root,'src/worlds/minecraft'),file=path.join(folder,'world.ts');
let source=fs.readFileSync(file,'utf8').replaceAll('\r\n','\n');
function edit(from,to){if(source.includes(to))return;if(source.split(from).length!==2)throw Error('HUD锚点不匹配：'+from.slice(0,60));source=source.replace(from,to);}
edit("import { Bridge } from './bridge.ts';","import { Bridge } from './bridge.ts';\nimport { observerSnapshot, ObserverStateWriter } from './observer-state.ts';");
edit('  private worldTimer: ReturnType<typeof setInterval> | null = null;',`  private worldTimer: ReturnType<typeof setInterval> | null = null;
  private observerStateWriter: ObserverStateWriter | null = null;
  private observerStateFailed = false;
  private writeObserverState(online = this.bridge?.connected === true && !this.shuttingDown): void {
    if (!this.dataDir) return;
    try {
      this.observerStateWriter ??= new ObserverStateWriter(join(this.dataDir, 'minecraft-observer-hud.json'), text => this.host?.log.warn(text));
      this.observerStateWriter.write(observerSnapshot({bot:this.bridge?.bot,online,target:this.chatName(),observer:this.cfg.client.username,queue:this.executor?.status(),last:this.lastFinishedTask}));
      this.observerStateFailed = false;
    } catch { if (!this.observerStateFailed) {this.observerStateFailed=true;this.host?.log.warn('观察者HUD状态采样失败；不影响原有游戏心跳。');} }
  }`);
edit('  private worldTick(): void {','  private worldTick(): void {\n    this.writeObserverState();');
edit('    this.shuttingDown = true;','    this.shuttingDown = true;\n    this.writeObserverState(false);');
const helper=fs.readFileSync(new URL('../addons/minecraft-observer/src/state.ts',import.meta.url),'utf8');
if(process.argv.includes('--apply')){
 if(!fs.existsSync(file+'.observer.orig'))fs.copyFileSync(file,file+'.observer.orig');
 fs.writeFileSync(file,source);fs.writeFileSync(path.join(folder,'observer-state.ts'),helper);
 console.log('观察者状态补丁已安装；正常重启后生效，不启动bot。');
}else console.log('观察者状态补丁预检通过；--apply才写入。');
