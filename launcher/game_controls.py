"""Game adapters use each World's console API; viewing is an independent process."""
import copy
import json
import pathlib
import subprocess
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
import webbrowser
import uuid
from concurrent.futures import ThreadPoolExecutor
from owned_process import ChildJob

LANES = {'server': '游戏服务器', 'client': '观察者客户端', 'player': '玩家客户端'}
# Reserved adapters keep the launcher API stable without guessing DST lifecycle semantics.
ADAPTERS = {'minecraft': {'provider':'world:minecraft','panel':'mount'}, 'dst': None}


class GameControls:
    def __init__(self, repo, console_url, log, request=None):
        self.repo = pathlib.Path(repo).resolve()
        self.console = console_url.rstrip('/')
        self.log = log
        self.request = request or self._request
        self.lock = threading.Lock()
        self.active = {}
        self.updated = 0
        self.refreshing = False
        self.revision = 0
        self.closed = False
        self.viewer_owned = False
        self.viewer_proc = None
        self.viewer_job = None
        self.viewer_owner = ''
        self.cache = self._initial()

    def _initial(self):
        return {'games': [{'id': 'minecraft', 'name': 'Minecraft', 'available': True,
            'lanes': [{'id': k, 'name': v, 'phase': 'unknown', 'detail': '正在读取状态', 'up': False} for k,v in LANES.items()]},
            {'id': 'dst', 'name': '饥荒联机版', 'available': False, 'detail': '接入位置已预留，当前版本暂不提供启动操作。', 'lanes': []}],
            'viewer': {'phase': 'unknown', 'up': False, 'detail': '正在读取观看状态'}}

    def _request(self, url, method='GET', body=None, timeout=3, headers=None):
        data = json.dumps(body).encode() if body is not None else None
        req = urllib.request.Request(url, data=data, method=method, headers={'Content-Type': 'application/json', **(headers or {})})
        try:
            with urllib.request.urlopen(req, timeout=timeout) as response:
                raw=response.read()
                # The 2.8.x viewer acknowledges stop with plain text.
                if urllib.parse.urlsplit(url).path=='/stop' and raw==b'stopping':return {'ok':True}
                try:return json.loads(raw)
                except (ValueError,UnicodeError):raise RuntimeError('服务返回了无法识别的状态，请查看对应日志。') from None
        except urllib.error.HTTPError as error:
            if error.code in (401,403): raise RuntimeError('控制台需要登录，请在控制台确认访问设置。') from None
            raise RuntimeError(f'控制请求失败（HTTP {error.code}），请在 MC World 查看状态。') from None
        except (OSError, TimeoutError):
            raise RuntimeError('无法连接 Cortico 控制台，请先启动 Cortico。') from None

    def _mc(self, lane, action='state'):
        if lane not in LANES or action not in ('state','start','stop'): raise ValueError('未知游戏操作')
        adapter=ADAPTERS['minecraft']
        url = self.console + '/api/console/providers/'+urllib.parse.quote(adapter['provider'],safe='')+'/panels/'+adapter['panel']+'/' + lane + '.' + action
        # Mount state methods are POST-only, but reading them does not start a game or model.
        return self.request(url, 'POST', {'args': []}, 3 if action == 'state' else 90,
                            {'Origin': self.console})

    def _lane(self, lane):
        try:
            state = self._mc(lane)
            phase = state.get('phase','unknown')
            up = bool(state.get('reachable')) if lane == 'server' else phase == 'running'
            external=lane=='server' and up and not state.get('pid')
            if external:phase='external'
            return {'id':lane,'name':LANES[lane],'phase':phase,'up':up,
                    'configured':state.get('configured',False),'external':external,
                    'detail':state.get('detail') or ('外部服务在线' if phase=='external' else '运行中' if up else '已停止')}
        except Exception as error:
            return {'id':lane,'name':LANES[lane],'phase':'unavailable','up':False,'detail':str(error)}

    def _viewer_state(self):
        try:
            state=self.request('http://127.0.0.1:7899/status')
            if state.get('service') != 'corti-mobile-viewer': return {'phase':'error','up':False,'detail':'本机观看端口被其他程序占用。'}
            return {'phase':'running','up':True,'ready':bool(state.get('ready')),'detail':state.get('message','观看服务已开启')}
        except Exception:
            installed=(self.repo/'addons/minecraft-mobile-viewer/.runtime/obs/bin/64bit/obs64.exe').exists()
            return {'phase':'stopped' if installed else 'unconfigured','up':False,'detail':'已关闭，开启后显示手机入口' if installed else '观看组件尚未安装'}

    def snapshot(self):
        with self.lock:
            if not self.closed and not self.refreshing and time.monotonic()-self.updated>3:
                self.refreshing=True
                threading.Thread(target=self._refresh,daemon=True).start()
            result=copy.deepcopy(self.cache)
            result['actions']=dict(self.active)
            return result

    def _refresh(self):
        with self.lock:revision=self.revision
        try:
            with ThreadPoolExecutor(max_workers=3) as pool:
                lanes=list(pool.map(self._lane,LANES))
            viewer=self._viewer_state()
            with self.lock:
                if revision==self.revision:
                    self.cache['games'][0]['lanes']=lanes
                    self.cache['viewer']=viewer
        finally:
            with self.lock:self.updated=time.monotonic() if revision==self.revision else 0;self.refreshing=False

    def action(self, game, lane, action):
        if self.closed:return {'ok':False,'msg':'启动器正在退出。'}
        if game!='minecraft' or lane not in (*LANES,'viewer') or action not in ('start','stop'):
            return {'ok':False,'msg':'该游戏操作尚未接入。'}
        with self.lock:
            if self.active:return {'ok':False,'msg':'正在处理游戏操作，请等当前操作完成。'}
            key=f'{game}:{lane}';self.active[key]=action
            self.revision+=1
        threading.Thread(target=self._perform,args=(key,lane,action),daemon=True).start()
        return {'ok':True,'msg':('正在开启' if action=='start' else '正在关闭')+('手机观看' if lane=='viewer' else LANES[lane])}

    def _perform(self,key,lane,action):
        try:
            if lane=='viewer':self._viewer_action(action)
            else:
                current=self._mc(lane)
                if action=='stop' and lane=='server' and current.get('reachable') and not current.get('pid'):
                    raise RuntimeError('该服务器由外部程序启动，请到原启动入口关闭；启动器不会强杀它。')
                if action=='start' and lane!='server' and not self._mc('server').get('reachable'):
                    raise RuntimeError('请先启动游戏服务器，等在线后再启动客户端。')
                if action=='start' and not current.get('configured'):
                    raise RuntimeError('请先到 MC World 配置目录和版本。')
                state=self._mc(lane,action)
                if state.get('phase')=='error':raise RuntimeError(state.get('detail') or '游戏操作失败')
            msg=('已提交启动' if action=='start' else '已提交停止')+('手机观看' if lane=='viewer' else LANES[lane])+'，以状态读回为准。'
            self.log(msg)
            with self.lock:self.cache['notice']={'ok':True,'message':msg,'at':time.time()}
        except Exception as error:
            self.log(str(error))
            with self.lock:self.cache['notice']={'ok':False,'message':str(error),'at':time.time()}
        finally:
            fresh=self._viewer_state() if lane=='viewer' else self._lane(lane)
            with self.lock:
                self.revision+=1
                if lane=='viewer':self.cache['viewer']=fresh
                else:self.cache['games'][0]['lanes']=[fresh if item['id']==lane else item for item in self.cache['games'][0]['lanes']]
                self.active.pop(key,None);self.updated=0
            if self.closed and self.viewer_proc and self.viewer_proc.poll() is None:
                if self.viewer_job:self.viewer_job.close()
            self.snapshot()

    def _viewer_action(self,action):
        runtime=self.repo/'addons/minecraft-mobile-viewer/.runtime'
        if action=='stop':
            # Only this local service understands this control token. Never kill a PID by port.
            try:
                status=self.request('http://127.0.0.1:7899/status')
            except RuntimeError:return
            if status.get('service')!='corti-mobile-viewer':raise RuntimeError('端口由其他程序占用，未执行关闭。')
            secret=json.loads((runtime/'secrets.json').read_text(encoding='utf-8'))
            self.request('http://127.0.0.1:7899/stop','POST',{},3,{'X-Control-Token':secret['control']})
            self.viewer_owned=False
            return
        current=self._viewer_state()
        if current['up']:return
        if current['phase']=='error':raise RuntimeError(current['detail'])
        script=self.repo/'addons/minecraft-mobile-viewer/viewer.py'
        python=self.repo/'launcher/.venv/Scripts/pythonw.exe'
        if not python.exists():python=python.with_name('python.exe')
        if not python.exists() or not (runtime/'mediamtx/mediamtx.exe').exists() or not (runtime/'obs/bin/64bit/obs64.exe').exists():
            raise RuntimeError('手机观看组件未安装，请参阅观看模块说明。')
        self.viewer_owner=uuid.uuid4().hex
        if self.viewer_job is None:self.viewer_job=ChildJob()
        with (runtime/'bootstrap.log').open('ab') as log:
            self.viewer_proc=subprocess.Popen([str(python),str(script),'serve','--owner',self.viewer_owner],cwd=script.parent,stdin=subprocess.DEVNULL,stdout=log,stderr=log,creationflags=getattr(subprocess,'CREATE_NO_WINDOW',0))
        self.viewer_job.attach(self.viewer_proc)
        for _ in range(30):
            if self.closed:raise RuntimeError('启动器正在退出。')
            if self.viewer_proc.poll() is not None:raise RuntimeError('观看服务启动失败，请查看观看日志。')
            try:
                state=self.request('http://127.0.0.1:7899/status')
                if state.get('service')=='corti-mobile-viewer' and state.get('owner')==self.viewer_owner:
                    self.viewer_owned=True
                    return
            except RuntimeError:pass
            time.sleep(.5)
        raise RuntimeError('观看服务未能就绪，请检查端口或观看日志。')

    def open_viewer(self):
        if not self._viewer_state()['up']:return {'ok':False,'msg':'请先开启手机观看。'}
        webbrowser.open('http://127.0.0.1:7899/')
        return {'ok':True,'msg':'已打开手机入口、二维码和密码。'}

    def open_settings(self,game):
        adapter=ADAPTERS.get(game)
        if not adapter:return {'ok':False,'msg':'该游戏尚未接入。'}
        webbrowser.open(self.console+'/#/provider/'+urllib.parse.quote(adapter['provider'],safe='')+'/mount')
        return {'ok':True,'msg':'已打开 MC World，可设置目录与版本。'}

    def close(self):
        self.closed=True
        if self.viewer_owned and self.viewer_proc and self.viewer_proc.poll() is None:
            try:
                current=self.request('http://127.0.0.1:7899/status')
                if current.get('owner')==self.viewer_owner:self._viewer_action('stop')
            except Exception:pass  # The owned Windows job below also handles an already-closed HTTP listener.
        if self.viewer_proc and self.viewer_proc.poll() is None:
            try:self.viewer_proc.wait(timeout=3)
            except subprocess.TimeoutExpired:self.viewer_proc.terminate()
        if self.viewer_job:self.viewer_job.close()
