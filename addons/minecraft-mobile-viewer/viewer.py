"""LAN-only observer video gateway; no bot lifecycle or model calls."""
from __future__ import annotations
import base64
import ctypes
from ctypes import wintypes
import hmac
import http.client
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import ipaddress
import json
from pathlib import Path
import re
import secrets
import struct
import socket
import subprocess
import sys
import threading
import time
import urllib.request
import webbrowser

ROOT = Path(__file__).resolve().parent
REPO = ROOT.parent.parent
RUN = ROOT / '.runtime'
DEPLOY = REPO.parent / 'cortico-qq/deployments/mybot/config.json'
PORT, LOCAL, WHIP, ICE = 7898, 7899, 8899, 8199
FLAGS = getattr(subprocess, 'CREATE_NO_WINDOW', 0)

def save(path, data):
    tmp = path.with_suffix('.tmp')
    tmp.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding='utf-8')
    tmp.replace(path)

def powershell(code):
    result = subprocess.run(['powershell.exe', '-NoProfile', '-NonInteractive', '-Command', code], capture_output=True, encoding='utf-8', errors='replace', timeout=20, creationflags=FLAGS)
    if result.returncode:
        raise RuntimeError(result.stderr.strip()[:180])
    return result.stdout.lstrip('\ufeff').strip()

def lan_ip():
    script = "[Console]::OutputEncoding=[Text.UTF8Encoding]::new(); @(Get-NetIPConfiguration | Where-Object {$_.IPv4DefaultGateway -and $_.NetAdapter.HardwareInterface} | ForEach-Object {$_.IPv4Address.IPAddress}) | ConvertTo-Json -Compress"
    ips = json.loads(powershell(script) or '[]')
    if isinstance(ips, str):
        ips = [ips]
    for address in ips:
        ip = ipaddress.ip_address(address)
        if ip.version == 4 and ip.is_private and not ip.is_loopback and not ip.is_link_local:
            return address
    raise RuntimeError('没有找到带默认网关的物理局域网网卡。请连接家庭 Wi-Fi 或有线网络。')

def valid_auth(header, password):
    expected = 'Basic ' + base64.b64encode(('viewer:' + password).encode()).decode()
    return hmac.compare_digest(header or '', expected)

def session_path(location):
    from urllib.parse import urlsplit
    path = urlsplit(location).path
    if not re.fullmatch(r'/corti/whep/[a-zA-Z0-9-]+', path):
        raise ValueError('Unexpected WHEP session location')
    return path

def credentials():
    path = RUN / 'secrets.json'
    if path.exists():
        data = json.loads(path.read_text())
        if not all(isinstance(data.get(k), str) and len(data[k]) >= 12 for k in ('password', 'control')):
            raise RuntimeError('观看凭据损坏，请保留 secrets.json 并检查，不自动覆盖。')
        return data
    data = {'password': secrets.token_urlsafe(12), 'control': secrets.token_urlsafe(24)}
    save(path, data)
    return data

def child_job():
    """Windows closes the owned process tree even if the supervisor crashes."""
    kernel = ctypes.WinDLL('kernel32', use_last_error=True)
    kernel.CreateJobObjectW.restype = wintypes.HANDLE
    kernel.SetInformationJobObject.argtypes = [wintypes.HANDLE, ctypes.c_int, ctypes.c_void_p, wintypes.DWORD]
    kernel.AssignProcessToJobObject.argtypes = [wintypes.HANDLE, wintypes.HANDLE]
    handle = kernel.CreateJobObjectW(None, None)
    limits = ctypes.create_string_buffer(144)
    struct.pack_into('I', limits, 16, 0x2000)
    if not handle or not kernel.SetInformationJobObject(handle,9,limits,len(limits)):
        raise ctypes.WinError(ctypes.get_last_error())
    return kernel, handle

def preferred_encoder():
    try:
        names = powershell('(Get-CimInstance Win32_VideoController).Name -join ","').lower()
        if 'nvidia' in names: return 'obs_nvenc_h264_tex'
        if 'amd' in names or 'radeon' in names: return 'h264_texture_amf'
        if 'intel' in names: return 'obs_qsv11_v2'
    except Exception: pass
    return 'obs_x264'

def observer():
    cfg = json.loads(DEPLOY.read_text(encoding='utf-8-sig'))['worlds']['minecraft']['client']
    username, directory = cfg.get('username', 'CortiCam'), cfg.get('gameDir', '')
    if not directory:
        return None
    user32 = ctypes.WinDLL('user32', use_last_error=True)
    windows = []
    callback_type = ctypes.WINFUNCTYPE(wintypes.BOOL, wintypes.HWND, wintypes.LPARAM)
    @callback_type
    def visit(hwnd, _):
        if not user32.IsWindowVisible(hwnd):
            return True
        title = ctypes.create_unicode_buffer(512)
        user32.GetWindowTextW(hwnd, title, 512)
        if title.value != username:
            return True
        pid = wintypes.DWORD()
        user32.GetWindowThreadProcessId(hwnd, ctypes.byref(pid))
        cls = ctypes.create_unicode_buffer(256)
        user32.GetClassNameW(hwnd, cls, 256)
        windows.append((pid.value, title.value, cls.value, bool(user32.IsIconic(hwnd))))
        return True
    user32.EnumWindows(visit, 0)
    if len(windows) != 1 or windows[0][3]:
        return None
    pid, title, cls, _ = windows[0]
    # Only return the fields required for identity; never output the command line or tokens.
    code = f"$p=Get-CimInstance Win32_Process -Filter 'ProcessId = {pid}'; if($p){{ $c=$p.CommandLine; [pscustomobject]@{{exe=$p.ExecutablePath; gameDir=([regex]::Match($c,'--gameDir\\s+(\"[^\"]+\"|\\S+)').Groups[1].Value.Trim('\"')); username=([regex]::Match($c,'--username\\s+(\"[^\"]+\"|\\S+)').Groups[1].Value.Trim('\"')); born=$p.CreationDate.ToUniversalTime().ToString('o')}} | ConvertTo-Json -Compress }}"
    data = json.loads(powershell(code) or 'null')
    if not data or data['username'] != username or Path(data['gameDir']).resolve() != Path(directory).resolve():
        return None
    exe = Path(data['exe']).name
    if exe.lower() not in ('java.exe', 'javaw.exe'):
        return None
    return {'pid': pid, 'born': data['born'], 'window': f'{title}:{cls}:{exe}'}

def mtx_config(ip, password):
    # JSON is valid YAML; all unneeded network protocols are disabled.
    return {'logLevel':'info', 'rtsp':False, 'rtmp':False, 'hls':False, 'srt':False, 'moq':False,
        'api':True, 'apiAddress':'127.0.0.1:9996', 'metrics':False, 'pprof':False,
        'webrtc':True, 'webrtcAddress':f'127.0.0.1:{WHIP}',
        'webrtcAllowOrigins':[f'http://{ip}:{PORT}'],
        'webrtcLocalUDPAddress':f':{ICE}', 'webrtcLocalTCPAddress':f':{ICE}',
        'webrtcIPsFromInterfaces':False, 'webrtcAdditionalHosts':[ip, '127.0.0.1'], 'webrtcICEServers2':[],
        'authInternalUsers':[
            {'user':'any','ips':['127.0.0.1','::1'],'permissions':[{'action':'publish','path':'corti'}, {'action':'api'}]},
            {'user':'viewer','pass':password,'ips':['127.0.0.1','::1'],'permissions':[{'action':'read','path':'corti'}]}],
        'paths':{'corti':{'source':'publisher'}}}

def obs_profile(window, encoder='obs_x264'):
    config = RUN / 'obs/config/obs-studio'
    profile = config / 'basic/profiles/CortiMobile'
    scenes = config / 'basic/scenes'
    profile.mkdir(parents=True, exist_ok=True)
    scenes.mkdir(parents=True, exist_ok=True)
    (config / 'global.ini').write_text('[General]\nFirstRun=true\nEnableAutoUpdates=false\n[Basic]\nProfile=CortiMobile\nProfileDir=CortiMobile\nSceneCollection=CortiMobile\nSceneCollectionFile=CortiMobile\n[BasicWindow]\nWarnBeforeStartingStream=false\nWarnBeforeStoppingStream=false\nSysTrayEnabled=true\n', encoding='utf-8')
    (profile / 'basic.ini').write_text('[General]\nName=CortiMobile\n[Video]\nBaseCX=1280\nBaseCY=720\nOutputCX=1280\nOutputCY=720\nFPSType=0\nFPSCommon=30\n[Output]\nMode=Advanced\n[AdvOut]\nEncoder='+encoder+'\nTrackIndex=1\nRescale=false\n[Audio]\nSampleRate=48000\nChannelSetup=Stereo\n', encoding='utf-8')
    save(profile / 'service.json', {'type':'whip_custom','settings':{'server':f'http://127.0.0.1:{WHIP}/corti/whip','bearer_token':''}})
    settings = {'rate_control':'CBR','bitrate':3000,'keyint_sec':2,'profile':'baseline','bf':0}
    if encoder == 'obs_x264': settings.update(preset='veryfast',tune='zerolatency')
    if encoder == 'obs_nvenc_h264_tex': settings.update(preset='p4',tune='ull')
    save(profile / 'streamEncoder.json', settings)
    source = {'name':'观察者窗口','id':'game_capture','versioned_id':'game_capture','settings':{'capture_mode':'window','window':window,'priority':1,'capture_cursor':False,'capture_audio':False,'limit_framerate':True},'mixers':0}
    scene = {'name':'CortiMobile','id':'scene','versioned_id':'scene','settings':{'items':[{'name':'观察者窗口','visible':True,'locked':True,'pos':{'x':0.0,'y':0.0},'scale':{'x':1.0,'y':1.0},'bounds_type':2,'bounds':{'x':1280.0,'y':720.0},'bounds_align':0,'align':5,'id':1}]}}
    save(scenes / 'CortiMobile.json', {'name':'CortiMobile','current_scene':'CortiMobile','current_program_scene':'CortiMobile','scene_order':[{'name':'CortiMobile'}],'sources':[source,scene],'groups':[],'modules':{},'transition_duration':300})

class Service:
    def __init__(self):
        self.secret = credentials()
        self.ip = lan_ip()
        self.state = '等待观察者窗口：请从 MC World 启动观察者，保持窗口非最小化。'
        self.quit = threading.Event()
        self.children = []
        self.obs = None
        self.target = None
        self.stream_ready = False
        self.sessions = set()
        self.log = (RUN / 'service.log').open('a', encoding='utf-8')
        self.kernel, self.job = child_job()
        self.encoder = preferred_encoder()
        self.started_at = 0

    def spawn(self, args, cwd):
        proc = subprocess.Popen(args, cwd=cwd, stdin=subprocess.DEVNULL, stdout=self.log, stderr=self.log, creationflags=FLAGS)
        if not self.kernel.AssignProcessToJobObject(self.job, int(proc._handle)):
            proc.terminate()
            raise ctypes.WinError(ctypes.get_last_error())
        self.children.append(proc)
        return proc

    def drop_capture(self):
        if self.obs and self.obs.poll() is None:
            self.obs.terminate()
            try: self.obs.wait(timeout=6)
            except subprocess.TimeoutExpired: self.obs.kill()
        self.obs = None
        self.stream_ready = False
        self.sessions.clear()

    def monitor(self):
        attempts = 0
        while not self.quit.wait(3):
            try:
                found = observer()
                if found != self.target:
                    self.drop_capture()
                    self.target = found
                    attempts = 0
                if not found:
                    self.state = '等待观察者窗口：请从 MC World 启动观察者，保持窗口非最小化。'
                    continue
                if not self.obs and attempts < 2:
                    attempts += 1
                    obs_profile(found['window'], self.encoder)
                    exe = RUN / 'obs/bin/64bit/obs64.exe'
                    self.obs = self.spawn([str(exe), '--portable', '--multi', '--disable-updater', '--profile','CortiMobile','--collection','CortiMobile','--scene','CortiMobile','--minimize-to-tray','--startstreaming'], exe.parent)
                    self.started_at = time.time()
                    self.state = '观察者已识别，正在连接视频流。'
                if self.obs and self.obs.poll() is not None:
                    self.obs = None
                    self.encoder = 'obs_x264'
                    self.state = '视频采集退出，请检查本机日志后重新开启。'
                try:
                    with urllib.request.urlopen('http://127.0.0.1:9996/v3/paths/get/corti', timeout=2) as response:
                        path = json.load(response)
                    logs = sorted((RUN/'obs/config/obs-studio/logs').glob('*.txt'),key=lambda p:p.stat().st_mtime)
                    text = logs[-1].read_text(encoding='utf-8',errors='replace') if logs else ''
                    captured = text.rfind('capture successful') > text.rfind('capture stopped')
                    self.stream_ready = bool(path.get('ready')) and captured
                except Exception:
                    self.stream_ready = False
                if self.stream_ready:
                    self.state = '视频流已连接；若画面停住，请检查观察者是否仍在渲染。'
                elif self.obs and time.time()-self.started_at>40:
                    if self.encoder != 'obs_x264':
                        self.drop_capture()
                        self.encoder = 'obs_x264'
                    else:
                        self.state = '未能确认观察者画面，暂不向手机交付视频。请检查 OBS 日志与窗口。'
            except Exception as exc:
                self.drop_capture()
                self.state = '观察者核验失败，已停止捕获：' + str(exc)[:140]

    def run(self):
        local = ThreadingHTTPServer(('127.0.0.1', LOCAL), handler(self, True))
        lan = ThreadingHTTPServer((self.ip, PORT), handler(self, False))
        sockets = []
        try:
            for host, port, kind in [('127.0.0.1',WHIP,socket.SOCK_STREAM),('127.0.0.1',9996,socket.SOCK_STREAM),('0.0.0.0',ICE,socket.SOCK_STREAM),('0.0.0.0',ICE,socket.SOCK_DGRAM)]:
                sock = socket.socket(socket.AF_INET,kind)
                sock.bind((host,port))
                sockets.append(sock)
        finally:
            for sock in sockets: sock.close()
        save(RUN / 'mediamtx.json', mtx_config(self.ip,self.secret['password']))
        mtx = RUN / 'mediamtx/mediamtx.exe'
        self.mtx = self.spawn([str(mtx),str(RUN/'mediamtx.json')], mtx.parent)
        for server in (local,lan):
            threading.Thread(target=server.serve_forever, daemon=True).start()
        threading.Thread(target=self.monitor, daemon=True).start()
        save(RUN/'state.json', {'url':f'http://{self.ip}:{PORT}/','local':f'http://127.0.0.1:{LOCAL}/'})
        try:
            while not self.quit.wait(1):
                if self.mtx.poll() is not None:
                    self.state='视频服务器退出，请关闭后重新开启。'
                    self.drop_capture()
        finally:
            self.drop_capture()
            local.shutdown(); lan.shutdown()
            for proc in self.children:
                if proc.poll() is None:
                    proc.terminate()
                    try: proc.wait(timeout=5)
                    except subprocess.TimeoutExpired: proc.kill()
            self.log.close()
            self.kernel.CloseHandle.argtypes=[wintypes.HANDLE]
            self.kernel.CloseHandle(self.job)

def handler(service, local):
    class Handler(BaseHTTPRequestHandler):
        def log_message(self,*args): pass
        def reply(self,code,body=b'',kind='text/plain; charset=utf-8',extra=None):
            if isinstance(body,str): body=body.encode('utf-8')
            self.send_response(code)
            for key,value in {'Content-Type':kind,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer',**(extra or {})}.items(): self.send_header(key,value)
            self.send_header('Content-Length',str(len(body))); self.end_headers()
            try: self.wfile.write(body)
            except (BrokenPipeError, ConnectionResetError, ConnectionAbortedError): pass
        def allowed(self):
            if local: return True
            if valid_auth(self.headers.get('Authorization'),service.secret['password']): return True
            self.reply(401,'请输入观看账号 viewer 与本机说明页上的密码。',extra={'WWW-Authenticate':'Basic realm="Corti viewer", charset="UTF-8"'})
            return False
        def do_GET(self):
            if not self.allowed(): return
            path=self.path.split('?')[0]
            if path=='/status':
                self.reply(200,json.dumps({'service':'corti-mobile-viewer','message':service.state,'ready':service.stream_ready},ensure_ascii=False),'application/json'); return
            if path=='/' and local:
                import html
                url=f'http://{service.ip}:{PORT}/'
                self.reply(200,(ROOT/'local.html').read_text(encoding='utf-8').replace('{{URL}}',html.escape(url)).replace('{{PASSWORD}}',html.escape(service.secret['password'])),'text/html; charset=utf-8'); return
            if path=='/qr.svg' and local:
                import io,qrcode,qrcode.image.svg
                image=qrcode.make(f'http://{service.ip}:{PORT}/',image_factory=qrcode.image.svg.SvgPathImage)
                out=io.BytesIO(); image.save(out)
                self.reply(200,out.getvalue(),'image/svg+xml'); return
            if path=='/' and not local:
                self.reply(200,(ROOT/'watch.html').read_bytes(),'text/html; charset=utf-8'); return
            self.reply(404)
        def do_POST(self):
            if local and self.path=='/stop':
                if not hmac.compare_digest(self.headers.get('X-Control-Token',''),service.secret['control']): self.reply(403); return
                self.reply(200,'stopping'); service.quit.set(); return
            if local or not self.allowed():
                if local: self.reply(404)
                return
            if self.path!='/corti/whep' or not service.stream_ready: self.reply(503,'观察者视频尚未就绪'); return
            self.proxy('POST')
        def do_DELETE(self):
            if local or not self.allowed():
                if local: self.reply(404)
                return
            if self.path not in service.sessions: self.reply(404); return
            self.proxy('DELETE')
            service.sessions.discard(self.path)
        def proxy(self,method):
            try:
                length=int(self.headers.get('Content-Length','0'))
                if not 0<=length<=131072: self.reply(413); return
                body=self.rfile.read(length)
                conn=http.client.HTTPConnection('127.0.0.1',WHIP,timeout=8)
                auth='Basic '+base64.b64encode(('viewer:'+service.secret['password']).encode()).decode()
                conn.request(method,self.path,body,{'Authorization':auth,'Content-Type':'application/sdp'})
                res=conn.getresponse(); data=res.read(262144)
                extra={}
                if location:=res.getheader('Location'):
                    path=session_path(location); service.sessions.add(path); extra['Location']=path
                self.reply(res.status,data,res.getheader('Content-Type','application/sdp'),extra)
                conn.close()
            except Exception:
                self.reply(502,'视频连接暂时不可用，请稍后重试。')
    return Handler

def main():
    RUN.mkdir(exist_ok=True)
    command=sys.argv[1] if len(sys.argv)>1 else 'start'
    local=f'http://127.0.0.1:{LOCAL}/'
    if command=='serve':
        Service().run(); return
    if command=='stop':
        secret=json.loads((RUN/'secrets.json').read_text())
        req=urllib.request.Request(local+'stop',data=b'',headers={'X-Control-Token':secret['control']})
        try: urllib.request.urlopen(req,timeout=3).close()
        except OSError: print('观看服务未运行。')
        return
    try:
        with urllib.request.urlopen(local+'status',timeout=2) as res:
            if json.load(res).get('service')!='corti-mobile-viewer': raise RuntimeError('本机说明端口被其他服务占用')
    except urllib.error.URLError:
        if not (RUN/'obs/bin/64bit/obs64.exe').exists() or not (RUN/'mediamtx/mediamtx.exe').exists():
            raise RuntimeError('请先运行 install.py 安装观看组件。')
        log=(RUN/'bootstrap.log').open('a',encoding='utf-8')
        subprocess.Popen([sys.executable,str(Path(__file__).resolve()),'serve'],cwd=ROOT,stdout=log,stderr=log,creationflags=FLAGS)
        for _ in range(30):
            time.sleep(1)
            try:
                with urllib.request.urlopen(local+'status',timeout=1) as res:
                    if json.load(res).get('service')=='corti-mobile-viewer': break
            except OSError: pass
        else: raise RuntimeError('观看服务未能启动，请查看 .runtime/bootstrap.log。')
    webbrowser.open(local)

if __name__=='__main__':
    main()
