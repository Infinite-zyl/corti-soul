/** QQ auxiliary requests follow the deployment's active provider; never select another. */
import {readFileSync} from 'node:fs';
import {dirname,join,resolve} from 'node:path';
export interface ActiveModelRoute {provider:string;endpoint:string;model:string;secret:string;vision:boolean;signature:string}
export function activeModelRoute(dataDir:string):ActiveModelRoute {
 if(!dataDir)throw Error('缺少部署数据目录，不能确定当前主模型');
 const deployment=dirname(resolve(dataDir));
 const config=JSON.parse(readFileSync(join(deployment,'config.json'),'utf8').replace(/^\uFEFF/,''));
 const name=config.activeProvider;
 if(typeof name!=='string'||!name)throw Error('未选择主模型');
 const parent=resolve(deployment,'../providers'),folder=resolve(parent,name);
 if(dirname(folder)!==parent)throw Error('无效的主模型名称');
 const entry=JSON.parse(readFileSync(join(folder,'config.json'),'utf8').replace(/^\uFEFF/,''));
 if(entry.kind!=='openai-responses-compat')throw Error('当前主模型不是已适配的 OpenAI 兼容渠道，辅助调用已暂停');
 const url=new URL(entry.baseUrl);
 if(!['http:','https:'].includes(url.protocol)||url.username||url.password||url.search||url.hash)throw Error('无效的主模型入口');
 if(typeof entry.spec?.model!=='string'||!entry.spec.model||typeof entry.secret!=='string'||!entry.secret)throw Error('主模型或鉴权引用未配置');
 const endpoint=entry.baseUrl.replace(/\/+$/,'');
 const route={provider:name,endpoint,model:entry.spec.model,secret:entry.secret,vision:entry.multimodal===true};
 return{...route,signature:JSON.stringify(route)};
}
export function routeStillActive(dataDir:string,route:ActiveModelRoute):boolean {
 try{return activeModelRoute(dataDir).signature===route.signature;}catch{return false;}
}
