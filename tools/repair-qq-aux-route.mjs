/** Repair only the retired local QQ auxiliary route. No model requests or key copies. */
import fs from 'node:fs';
import path from 'node:path';
const root=JSON.parse(fs.readFileSync(new URL('../runtime-selection.json',import.meta.url),'utf8')).corticoRoot;
const world=path.join(root,'extensions/node_modules/cortico-world-qq-better-alont1/src/world.ts');
if(fs.existsSync(world)&&fs.readFileSync(world,'utf8').includes('endpoint = route.endpoint; model = route.model; apiKeySecret = route.secret;')){
 console.log('已安装统一主模型路由；QQ请求实时跟随activeProvider，无需再修独立模型字段。');process.exit(0);
}
const file=path.join(root,'deployments/mybot/config.json');
const original=fs.readFileSync(file,'utf8'),config=JSON.parse(original);
const providers=path.join(root,'deployments/providers');
const dir=path.resolve(providers,config.activeProvider);
if(path.dirname(dir)!==path.resolve(providers))throw Error('invalid provider');
const provider=JSON.parse(fs.readFileSync(path.join(dir,'config.json'),'utf8'));
if(!provider.spec?.model||typeof provider.secret!=='string'||!provider.secret)throw Error('unsupported provider');
const url=new URL(provider.baseUrl);
if(!['127.0.0.1','localhost','[::1]'].includes(url.hostname)||!['http:','https:'].includes(url.protocol))throw Error('only verified local gateway supported');
let changed=0;
for(const name of ['proactive','emotion']){
 const section=config.worlds?.qqbot?.[name];
 if(!section?.enabled)continue;
 if(section.endpoint===provider.baseUrl&&section.model===provider.spec.model&&section.apiKeySecret===provider.secret)continue;
 if(!/^http:\/\/127\.0\.0\.1:18899\/v1\/?$/.test(section.endpoint??''))throw Error(`${name}: custom route; do not overwrite`);
 Object.assign(section,{endpoint:provider.baseUrl,model:provider.spec.model,apiKeySecret:provider.secret});changed++;
}
if(changed&&process.argv.includes('--apply')){
 if(fs.readFileSync(file,'utf8')!==original)throw Error('config changed; retry preflight');
 const backup=path.join(root,'deployments/mybot',`config.qq-aux-backup-${Date.now()}.json`);
 fs.writeFileSync(backup,original,{flag:'wx'});
 const temp=file+'.qq-aux.tmp';fs.writeFileSync(temp,JSON.stringify(config,null,2)+'\n',{flag:'wx'});fs.renameSync(temp,file);
 console.log(`已备份并修正 ${changed} 个 QQ 辅助入口；重启生效，没有发送模型请求。`);
}else console.log(`QQ 辅助入口待修正 ${changed} 项；--apply 才写入。`);
