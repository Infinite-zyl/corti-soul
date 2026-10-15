/** 手动模式下守护只读；损坏控制文件也不得自动改路由。 */
import fs from 'node:fs';import path from 'node:path';
export const ROUTING_MODE_FILE=process.env.GUARD_ROUTING_FILE??path.join(import.meta.dirname,'routing-mode.json');
export function routingMode(file=ROUTING_MODE_FILE){
 try{if(!fs.existsSync(file))return 'auto';const d=JSON.parse(fs.readFileSync(file,'utf8'));return d.version===1&&d.mode==='auto'?'auto':'manual';}catch{return 'manual';}
}
export function assertAutoRouting(method='GET',file=ROUTING_MODE_FILE){if(!['GET','HEAD'].includes(method.toUpperCase())&&routingMode(file)!=='auto')throw Error('手动模式：自动路由写入已暂停');}
