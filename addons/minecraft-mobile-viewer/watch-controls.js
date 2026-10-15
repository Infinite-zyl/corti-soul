/* Authenticated viewers may stop this video service, never the game or bot. */
(() => {
  const section=document.createElement('section');section.className='watch-stop';
  section.innerHTML='<button type="button" id="stop-viewing" class="stop-service">关闭观看服务</button><div id="stop-confirm" hidden><p>所有观看端都会断开。corti 和 Minecraft 继续运行。</p><div class="actions"><button type="button" id="stop-yes" class="stop-service">确认关闭</button><button type="button" id="stop-no" class="secondary">继续观看</button></div></div><p id="stop-error" role="status" aria-live="polite"></p>';
  const footer=document.querySelector('main>footer');footer.before(section);
  const css=document.createElement('style');css.textContent='.watch-stop{margin-top:24px;padding-top:20px;border-top:1px solid #303541}.stop-service{color:#fca5a5;background:#25191f;border:1px solid #6c3641}#stop-confirm p{color:#b4becd;font-size:14px;line-height:1.8;margin:0 0 14px}#stop-error{color:#fca5a5;font-size:14px;line-height:1.7}[hidden]{display:none!important}';document.head.append(css);
  const trigger=document.querySelector('#stop-viewing'),confirm=document.querySelector('#stop-confirm'),yes=document.querySelector('#stop-yes'),cancel=document.querySelector('#stop-no'),error=document.querySelector('#stop-error');
  trigger.onclick=()=>{trigger.hidden=true;confirm.hidden=false;cancel.focus()};
  cancel.onclick=()=>{confirm.hidden=true;trigger.hidden=false;trigger.focus()};
  yes.onclick=async()=>{
    yes.disabled=true;cancel.disabled=true;yes.textContent='正在关闭…';error.textContent='';
    try{
      const response=await fetch('/status');if(!response.ok)throw Error('登录已失效，请刷新后重试。');
      const state=await response.json();if(!state.stopToken)throw Error('当前观看服务版本较旧，请在电脑端关闭后重新开启。');
      viewerStopped=true;desired=false;await disconnect();button.disabled=true;
      const stopped=await fetch('/watch/stop',{method:'POST',headers:{'X-Viewer-Stop':state.stopToken}});
      if(!stopped.ok)throw Error('关闭没有完成，请刷新状态后重试。');
      video.srcObject=null;status.textContent='观看服务已关闭。corti 和游戏继续运行。';confirm.hidden=true;
      trigger.hidden=false;trigger.disabled=true;trigger.textContent='观看服务已关闭';button.textContent='已关闭';button.disabled=true;
    }catch(e){viewerStopped=false;button.disabled=false;error.textContent=e.message;yes.disabled=false;cancel.disabled=false;yes.textContent='确认关闭'}
  };
})();
