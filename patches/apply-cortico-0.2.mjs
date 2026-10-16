/** Apply the tested customizations to the exact supported upstream version. */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const root = path.resolve(process.env.CORTICO_ROOT ?? process.argv.find(a=>a.startsWith('--root='))?.slice(7) ?? '');
if (!process.env.CORTICO_ROOT && !process.argv.some(a=>a.startsWith('--root='))) throw new Error('请用 CORTICO_ROOT 或 --root= 指定独立候选目录');
if (process.argv.slice(2).some(a=>!['--apply','--check'].includes(a)&&!a.startsWith('--root='))) throw new Error('未知选项');
const pkg = JSON.parse(fs.readFileSync(path.join(root,'package.json'),'utf8'));
if (pkg.name !== 'cortico' || pkg.version !== '0.2.1') throw new Error('此补丁仅支持 Cortico 0.2.1，不能用于旧版或浮动 main');
const patch = path.join(import.meta.dirname,'cortico-0.2.1-custom.patch');
function git(args) {
  const result=spawnSync('git',['-C',root,'apply',...args,patch],{encoding:'utf8',windowsHide:true});
  if(result.error)throw result.error;
  return result;
}
if(git(['--reverse','--check']).status===0){
  console.log('0.2.1 自有补丁已完整安装；无需重写。');
}else{
  const checked=git(['--check']);
  if(checked.status!==0)throw new Error('补丁预检未通过，未写入文件。请在独立目录解决冲突。\n'+checked.stderr);
  if(process.argv.includes('--apply')){
    const result=git([]);
    if(result.status!==0)throw new Error(result.stderr);
    console.log('补丁已安装；尚未构建、启动或操作运行数据。');
  }else console.log('补丁预检通过；--apply 才写入文件。');
}
