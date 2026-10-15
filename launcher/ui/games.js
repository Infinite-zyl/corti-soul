/* World controls are separate from the chat stack and never join start_all. */
(() => {
  const panel=document.getElementById('games');
  let snapshot=null,localPending=null,fetching=false,timer=null,lastNotice=0,confirming=false;
  const rows=new Map(),phaseNames={unknown:'读取中',stopped:'已停止',starting:'启动中',running:'运行中',stopping:'停止中',external:'外部在线',error:'出错',unavailable:'未连接',unconfigured:'未配置'};
  function notice(text,error=false){const el=document.getElementById('game-notice');el.textContent=text;el.classList.toggle('error',error)}
  function row(id,name,target){
    if(rows.has(id))return rows.get(id);
    const el=document.createElement('div');el.className='game-row';
    const identity=document.createElement('div');identity.className='game-identity';
    const label=document.createElement('div');label.className='game-name';label.textContent=name;
    const detail=document.createElement('div');detail.className='game-detail';identity.append(label,detail);
    const state=document.createElement('span');state.className='game-state';
    const controls=document.createElement('div');controls.className='game-controls';
    if(id==='viewer'){const entry=document.createElement('button');entry.textContent='手机入口';entry.type='button';entry.dataset.entry='true';entry.onclick=async()=>{try{const r=await window.pywebview.api.open_mobile_viewer();notice(r.msg,!r.ok)}catch{notice('无法打开手机入口，请确认观看服务在线。',true)}};controls.append(entry)}
    const button=document.createElement('button');button.type='button';button.dataset.lane=id;
    button.onclick=()=>perform(id);controls.append(button);el.append(identity,state,controls);target.append(el);
    const value={el,detail,state,button,entry:controls.querySelector('[data-entry]')};rows.set(id,value);return value;
  }
  function render(data){
    snapshot=data;const mc=(data.games||[]).find(g=>g.id==='minecraft');
    const serverOnline=mc?.lanes.some(l=>l.id==='server'&&l.up);
    const actions=data.actions||{},busy=!!localPending||Object.keys(actions).length>0;
    for(const item of [...(mc?.lanes||[]),{id:'viewer',name:'手机观看服务',...(data.viewer||{})}]){
      const r=row(item.id,item.name,item.id==='viewer'?document.getElementById('viewer-row'):document.getElementById('game-rows'));
      const key='minecraft:'+item.id,pending=localPending===item.id?'pending':actions[key];
      r.detail.textContent=item.detail||'';r.state.textContent=pending?'处理中':item.id==='viewer'&&item.up?(item.ready?'画面已连接':'等待画面'):phaseNames[item.phase]||'未知';r.state.dataset.phase=pending?'starting':item.phase;
      r.button.textContent=pending?'处理中…':item.up?'关闭':'启动';
      r.button.className=pending?'pending':item.up?'stop':'primary';
      r.button.disabled=busy||['starting','stopping','unknown','unavailable','unconfigured'].includes(item.phase)||!!item.external||(item.id!=='viewer'&&item.configured===false);
      if(['client','player'].includes(item.id)&&!item.up&&!serverOnline)r.button.disabled=true;
      r.button.title=item.external?'外部服务器请到原启动入口关闭':item.phase==='unavailable'?'请先启动 Cortico':'';
      if(['client','player'].includes(item.id)&&!item.up&&!serverOnline)r.button.title='请先启动游戏服务器';
      r.button.setAttribute('aria-label',(item.up?'关闭':'启动')+item.name);r.el.setAttribute('aria-busy',pending?'true':'false');
      if(r.entry)r.entry.disabled=!item.up||busy;
    }
    if(data.notice?.at>lastNotice){lastNotice=data.notice.at;notice(data.notice.message,!data.notice.ok)}
    else if(!lastNotice&&!busy&&document.getElementById('game-notice').textContent==='正在读取游戏状态…')notice('MC 各组件独立启停；手机关闭观看不会停止 corti 或游戏。');
  }
  async function refresh(){
    if(fetching)return;fetching=true;
    try{render(await window.pywebview.api.get_games_status())}catch{notice('无法读取游戏状态，请重新打开启动器。',true)}finally{fetching=false}
  }
  async function confirmServerStop(){
    const dialog=document.createElement('dialog');dialog.className='game-dialog';
    dialog.innerHTML='<h3>停止 Minecraft 服务器？</h3><p>服务器会保存并关闭，corti 和已连接的玩家会离线。客户端窗口不会被强制关闭。</p><footer><button type="button" data-cancel>取消</button><button type="button" class="confirm">停止服务器</button></footer>';
    document.body.append(dialog);
    return new Promise(resolve=>{const finish=value=>{dialog.close();dialog.remove();resolve(value)};dialog.querySelector('[data-cancel]').onclick=()=>finish(false);dialog.querySelector('.confirm').onclick=()=>finish(true);dialog.oncancel=e=>{e.preventDefault();finish(false)};dialog.showModal();dialog.querySelector('[data-cancel]').focus()});
  }
  async function perform(lane){
    if(localPending||confirming||!snapshot||Object.keys(snapshot.actions||{}).length)return;
    const mc=snapshot.games.find(g=>g.id==='minecraft'),item=lane==='viewer'?snapshot.viewer:mc.lanes.find(x=>x.id===lane);
    if(!item||item.external)return;
    if(lane==='server'&&item.up){confirming=true;let confirmed;try{confirmed=await confirmServerStop()}finally{confirming=false}if(!confirmed)return}
    localPending=lane;render(snapshot);
    try{const result=await window.pywebview.api.game_action('minecraft',lane,item.up?'stop':'start');notice(result.msg,!result.ok)}catch{notice('操作没有提交成功，请刷新状态后重试。',true)}finally{localPending=null;await refresh()}
  }
  function init(){
    document.getElementById('game-settings').onclick=async()=>{try{const r=await window.pywebview.api.open_game_settings('minecraft');notice(r.msg,!r.ok)}catch{notice('无法打开 MC World 配置。',true)}};
    if(!timer)timer=setInterval(()=>{if(panel.style.display!=='none')refresh()},4000);
  }
  window.GamePanel={init,refresh,render};
})();
