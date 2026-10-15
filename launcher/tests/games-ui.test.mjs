import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';import {createRequire} from 'node:module';import {resolve} from 'node:path';
const require=createRequire(resolve('../cortico-qq/package.json'));const{JSDOM}=require('jsdom');
const tick=()=>new Promise(r=>setTimeout(r,0));
function fixture(){
 const dom=new JSDOM(readFileSync('launcher/ui/index.html','utf8'),{runScripts:'dangerously',url:'http://localhost'}),w=dom.window,d=w.document;
 w.eval(readFileSync('launcher/ui/games.js','utf8'));
 w.HTMLDialogElement.prototype.showModal=function(){this.open=true};w.HTMLDialogElement.prototype.close=function(){this.open=false};
 const data={actions:{},games:[{id:'minecraft',lanes:['server','client','player'].map(id=>({id,name:id,phase:'stopped',configured:true,up:false}))},{id:'dst',available:false}],viewer:{phase:'stopped',up:false,detail:'已关闭'}};
 const calls=[];w.pywebview={api:{get_games_status:async()=>data,game_action:async(...args)=>{calls.push(args);return{ok:true,msg:'已提交'}},open_mobile_viewer:async()=>({ok:true,msg:'手机入口已打开'}),open_game_settings:async()=>({ok:true,msg:'配置已打开'})}};
 w.GamePanel.init();w.GamePanel.render(data);return{dom,w,d,data,calls};
}
test('游戏状态独立显示；服务器离线时不允许启动客户端；DOM更新保留焦点节点',()=>{
 const f=fixture();try{const buttons=f.d.querySelectorAll('#game-rows button');assert.equal(buttons.length,3);assert.equal(buttons[0].disabled,false);assert.equal(buttons[1].disabled,true);f.data.games[0].lanes[0].up=true;f.data.games[0].lanes[0].phase='running';f.w.GamePanel.render(f.data);assert.equal(f.d.querySelectorAll('#game-rows button')[0],buttons[0]);assert.equal(buttons[1].disabled,false);assert.match(f.d.querySelector('.game-reserved').textContent,/预留接入/);}finally{f.dom.window.close()}
});
test('启动操作提交一次，挂起期间禁用操作，失败后恢复并保留错误',async()=>{
 const f=fixture();try{let release;f.w.pywebview.api.game_action=(...args)=>{f.calls.push(args);return new Promise(r=>release=r)};const button=f.d.querySelector('#game-rows button');button.click();button.click();await tick();assert.equal(f.calls.length,1);assert.equal(button.disabled,true);release({ok:false,msg:'控制台离线'});await tick();assert.equal(button.disabled,false);assert.match(f.d.getElementById('game-notice').textContent,/控制台离线/);}finally{f.dom.window.close()}
});
test('停止服务器先确认；取消不发请求，确认只调用服务器停止',async()=>{
 const f=fixture();try{f.data.games[0].lanes[0].up=true;f.data.games[0].lanes[0].phase='running';f.w.GamePanel.render(f.data);const button=f.d.querySelector('#game-rows button');button.click();await tick();assert.equal(f.calls.length,0);f.d.querySelector('[data-cancel]').click();await tick();assert.equal(f.calls.length,0);button.click();await tick();f.d.querySelector('dialog .confirm').click();await tick();assert.deepEqual(Array.from(f.calls[0]),['minecraft','server','stop']);}finally{f.dom.window.close()}
});
test('手机观看开关独立操作，外部服务器不可强停',async()=>{
 const f=fixture();try{f.data.viewer={phase:'running',up:true,ready:false,detail:'等待观察者'};f.data.games[0].lanes[0].external=true;f.w.GamePanel.render(f.data);assert.equal(f.d.querySelector('#game-rows button').disabled,true);assert.match(f.d.querySelector('#viewer-row .game-state').textContent,/等待画面/);f.d.querySelector('#viewer-row button[data-lane]').click();await tick();assert.deepEqual(Array.from(f.calls[0]),['minecraft','viewer','stop']);}finally{f.dom.window.close()}
});
