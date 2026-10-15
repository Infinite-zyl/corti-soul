/** 实际启动器HTML交互，模拟pywebview API，不加载原生窗口。 */
import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';import {createRequire} from 'node:module';import {resolve} from 'node:path';
const require=createRequire(resolve('../cortico-qq/package.json'));const {JSDOM}=require('jsdom');
test('模型选择读取、手动提交、恢复自动及失败解锁',async()=>{
 const dom=new JSDOM(readFileSync('launcher/ui/index.html','utf8'),{runScripts:'dangerously',url:'http://localhost'});
 const w=dom.window,d=w.document,calls=[];let mode='auto';
 w.pywebview={api:{get_model_options:async()=>({ok:true,active:'example',routing:{mode},providers:[{id:'example',name:'配置端点',model:'example-model'}]}),set_model_mode:async(m,p)=>{mode=m;calls.push([m,p]);return {ok:true,msg:'已切换'};},get_status:async()=>({services:[{id:'cortico',name:'Cortico',up:true},{id:'guard',name:'守护',up:mode==='auto',paused:mode==='manual'}],provider:{active:'example',routing:{mode}},allUp:true,activity:[],log:[],ts:'test',uptime:'0s'})}};
 const tick=()=>new Promise(r=>setTimeout(r,0));
 try{
  d.getElementById('model-mode').value='manual';d.getElementById('model-mode').dispatchEvent(new w.Event('change'));await tick();
  assert.equal(d.getElementById('model-choice').value,'example');assert.equal(d.getElementById('model-choice').disabled,false);
  d.getElementById('model-apply').click();await tick();assert.deepEqual(calls[0],['manual','example']);
  assert.equal(d.querySelector('[data-service-id="guard"] button').disabled,true);assert.match(d.querySelector('[data-service-id="guard"] .st').textContent,/已暂停/);assert.equal(d.getElementById('cnt').textContent,'1/1');
  d.getElementById('model-mode').value='auto';d.getElementById('model-mode').dispatchEvent(new w.Event('change'));d.getElementById('model-apply').click();await tick();assert.equal(calls[1][0],'auto');assert.equal(d.getElementById('model-choice').disabled,true);
  w.pywebview.api.get_model_options=async()=>{throw Error('控制台离线');};d.getElementById('model-refresh').click();await tick();assert.match(d.getElementById('model-note').textContent,/离线/);assert.equal(d.getElementById('model-refresh').disabled,false);
 }finally{dom.window.close();}
});
