import base64
import http.client
from http.server import ThreadingHTTPServer, BaseHTTPRequestHandler
import json
from pathlib import Path
import tempfile
import threading
from types import SimpleNamespace
import unittest
from unittest.mock import patch
import viewer

PASSWORD='test-viewer-password'
AUTH='Basic '+base64.b64encode(('viewer:'+PASSWORD).encode()).decode()

class GatewayTests(unittest.TestCase):
    def setUp(self):
        self.state=SimpleNamespace(secret={'password':PASSWORD,'control':'private-control-token'},state='waiting',stream_ready=False,sessions=set(),ip='192.168.1.2',quit=threading.Event())
        self.server=ThreadingHTTPServer(('127.0.0.1',0),viewer.handler(self.state,False))
        self.local=ThreadingHTTPServer(('127.0.0.1',0),viewer.handler(self.state,True))
        for server in (self.server,self.local): threading.Thread(target=server.serve_forever,daemon=True).start()
    def tearDown(self):
        for server in (self.server,self.local): server.shutdown();server.server_close()
    def request(self,path='/',method='GET',auth=AUTH,local=False,headers=None):
        conn=http.client.HTTPConnection('127.0.0.1',(self.local if local else self.server).server_port)
        conn.request(method,path,headers={**({'Authorization':auth} if auth else {}),**(headers or {})})
        res=conn.getresponse();data=res.read();result=(res.status,dict(res.headers),data);conn.close();return result
    def test_password_required(self):
        for auth in (None,'Basic invalid'):
            self.assertEqual(self.request(auth=auth)[0],401)
    def test_mobile_page_contains_no_password_or_management(self):
        code,headers,data=self.request()
        self.assertEqual(code,200);self.assertNotIn(PASSWORD.encode(),data)
        self.assertIn(b'RTCPeerConnection',data);self.assertEqual(headers['Cache-Control'],'no-store')
    def test_mobile_cannot_read_secret_qr_or_stop(self):
        self.assertEqual(self.request('/qr.svg')[0],404)
        self.assertEqual(self.request('/stop','POST')[0],503)
        self.assertFalse(self.state.quit.is_set())
    def test_waiting_does_not_create_video_session(self):
        self.assertEqual(self.request('/corti/whep','POST')[0],503)
        self.assertEqual(self.state.sessions,set())
    def test_status_is_read_only_and_has_no_secrets(self):
        data=json.loads(self.request('/status')[2]);self.assertFalse(data['ready'])
        self.assertNotIn('password',data)
    def test_local_stop_requires_control_token(self):
        self.assertEqual(self.request('/stop','POST',local=True)[0],403)
        self.assertEqual(self.request('/stop','POST',local=True,headers={'X-Control-Token':'private-control-token'})[0],200)
        self.assertTrue(self.state.quit.is_set())
    def test_unknown_sessions_are_not_proxied(self):
        self.assertEqual(self.request('/corti/whep/unknown','DELETE')[0],404)
    def test_local_info_and_qr(self):
        self.assertIn(PASSWORD.encode(),self.request(local=True)[2])
        self.assertEqual(self.request('/qr.svg',local=True)[0],200)

class ConfigTests(unittest.TestCase):
    def test_local_only_publisher_read_only_viewer_no_public_control(self):
        cfg=viewer.mtx_config('192.168.1.2',PASSWORD)
        self.assertTrue(cfg['webrtcAddress'].startswith('127.0.0.1:'))
        self.assertTrue(cfg['apiAddress'].startswith('127.0.0.1:'))
        self.assertEqual(cfg['authInternalUsers'][1]['permissions'],[{'action':'read','path':'corti'}])
        self.assertEqual(cfg['webrtcICEServers2'],[])
        for protocol in ('rtsp','rtmp','hls','srt','moq'):self.assertFalse(cfg[protocol])
    def test_session_path_rejects_other_resources(self):
        self.assertEqual(viewer.session_path('http://localhost:8899/corti/whep/abc-123'),'/corti/whep/abc-123')
        for path in ('/corti/whip','/api/config','/corti/whep/../x'):
            with self.assertRaises(ValueError):viewer.session_path(path)
    def test_corrupt_secrets_are_not_overwritten(self):
        with tempfile.TemporaryDirectory() as temp,patch.object(viewer,'RUN',Path(temp)):
            target=Path(temp)/'secrets.json';target.write_text('{}')
            with self.assertRaises(RuntimeError):viewer.credentials()
            self.assertEqual(target.read_text(),'{}')
    def test_obs_has_only_strict_observer_capture_and_silent_sources(self):
        with tempfile.TemporaryDirectory() as temp,patch.object(viewer,'RUN',Path(temp)):
            viewer.obs_profile('CortiCam:GLFW30:java.exe')
            scene=json.loads((Path(temp)/'obs/config/obs-studio/basic/scenes/CortiMobile.json').read_text(encoding='utf-8'))
            source=scene['sources'][0]
            self.assertEqual(source['id'],'game_capture')
            self.assertEqual(source['settings']['priority'],1)
            self.assertEqual(source['settings']['window'],'CortiCam:GLFW30:java.exe')
            self.assertFalse(source['settings']['capture_audio'])
            self.assertEqual([s['id'] for s in scene['sources']],['game_capture','scene'])

if __name__=='__main__':unittest.main()
