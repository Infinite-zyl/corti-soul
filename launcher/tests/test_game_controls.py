import copy
from http.server import BaseHTTPRequestHandler,ThreadingHTTPServer
import json
from pathlib import Path
import sys
import tempfile
import threading
import time
import unittest
from unittest.mock import patch
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from game_controls import GameControls
from ui_assets import load_ui

class ControlsTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.calls=[];self.logs=[];self.block=threading.Event();self.block.set()
        self.states={key:{'phase':'stopped','reachable':False,'configured':True,'pid':None} for key in ('server','client','player')}
        self.paths=[]
        self.framework=Path(self.temp.name)/'framework';self.framework.mkdir()
        (self.framework/'package.json').write_text('{"version":"0.2.1"}',encoding='utf-8')
        self.delay_once=False;self.delayed=threading.Event();self.release_state=threading.Event();self.release_state.set()
        owner=self
        class Handler(BaseHTTPRequestHandler):
            def log_message(self,*args):pass
            def do_POST(self):
                self.rfile.read(int(self.headers.get('Content-Length','0')))
                if self.path=='/stop':
                    data=b'stopping';self.send_response(200);self.send_header('Content-Length',str(len(data)));self.end_headers();self.wfile.write(data);return
                lane,action=self.path.rsplit('/',1)[-1].split('.')
                owner.paths.append(self.path)
                owner.calls.append((lane,action))
                if action!='state':
                    owner.block.wait(timeout=2)
                    owner.states[lane].update(phase='running' if action=='start' else 'stopped',reachable=action=='start',pid=321 if action=='start' else None)
                data=json.dumps(owner.states[lane]).encode()
                if lane=='server' and action=='state' and owner.delay_once:
                    owner.delay_once=False;owner.delayed.set();owner.release_state.wait(timeout=2)
                self.send_response(200);self.send_header('Content-Length',str(len(data)));self.end_headers();self.wfile.write(data)
        self.server=ThreadingHTTPServer(('127.0.0.1',0),Handler)
        threading.Thread(target=self.server.serve_forever,daemon=True).start()
        self.control=GameControls(self.temp.name,f'http://127.0.0.1:{self.server.server_port}',self.logs.append,cortico_root=self.framework)
        self.control._viewer_state=lambda:{'phase':'stopped','up':False,'detail':'off'}
    def tearDown(self):
        self.block.set();self.release_state.set();self.wait_idle();self.control.close();self.server.shutdown();self.server.server_close();self.temp.cleanup()
    def wait_idle(self):
        deadline=time.monotonic()+3
        while time.monotonic()<deadline:
            with self.control.lock:
                idle=not self.control.active and not self.control.refreshing
            if idle:return
            time.sleep(.01)
        self.fail('操作没有按时结束')
    def test_snapshot_is_immediate_and_only_reads_states(self):
        begin=time.monotonic();state=self.control.snapshot();self.assertLess(time.monotonic()-begin,.1)
        self.wait_idle();state=self.control.snapshot();self.assertEqual(len(state['games'][0]['lanes']),3)
        self.assertTrue(all(action=='state' for _,action in self.calls))
        self.assertEqual([g['id'] for g in state['games']],['minecraft'])
    def test_clients_require_running_server(self):
        self.assertTrue(self.control.action('minecraft','client','start')['ok']);self.wait_idle()
        self.assertFalse(self.control.cache['notice']['ok']);self.assertNotIn(('client','start'),self.calls)
    def test_start_and_stop_use_world_api(self):
        for action in ('start','stop'):
            self.assertTrue(self.control.action('minecraft','server',action)['ok']);self.wait_idle()
            self.assertIn(('server',action),self.calls)
        self.assertTrue(all(p.startswith('/api/webui/') for p in self.paths))

    def test_old_framework_uses_old_route_without_replaying_actions(self):
        (self.framework/'package.json').write_text('{"version":"0.1.8"}',encoding='utf-8')
        self.control.action('minecraft','server','start');self.wait_idle()
        self.assertEqual(self.calls.count(('server','start')),1)
        self.assertTrue(all(p.startswith('/api/console/') for p in self.paths))

    def test_unknown_framework_fails_before_sending_any_action(self):
        (self.framework/'package.json').write_text('{"version":"broken"}',encoding='utf-8')
        self.control.action('minecraft','server','start');self.wait_idle()
        self.assertFalse(self.calls);self.assertFalse(self.control.cache['notice']['ok'])
    def test_external_server_not_stopped(self):
        self.states['server'].update(reachable=True,pid=None)
        self.assertTrue(self.control._lane('server')['external'])
        self.control.action('minecraft','server','stop');self.wait_idle()
        self.assertNotIn(('server','stop'),self.calls);self.assertFalse(self.control.cache['notice']['ok'])
    def test_double_click_and_other_actions_do_not_overlap(self):
        self.block.clear();self.assertTrue(self.control.action('minecraft','server','start')['ok'])
        self.assertFalse(self.control.action('minecraft','player','start')['ok'])
        self.assertFalse(self.control.action('minecraft','server','start')['ok']);self.block.set();self.wait_idle()
        self.assertEqual(self.calls.count(('server','start')),1)
    def test_dst_reserved_without_side_effect(self):
        self.assertFalse(self.control.action('dst','server','start')['ok']);self.assertEqual(self.calls,[])
    def test_config_missing_returns_actionable_error(self):
        self.states['server']['configured']=False
        self.control.action('minecraft','server','start');self.wait_idle()
        self.assertIn('配置',self.control.cache['notice']['message']);self.assertNotIn(('server','start'),self.calls)
    def test_console_offline_does_not_fake_stopped(self):
        def offline(*args):raise RuntimeError('offline')
        self.control.request=offline
        self.assertEqual(self.control._lane('server')['phase'],'unavailable')
    def test_close_does_not_stop_external_viewer(self):
        with patch.object(self.control,'_viewer_action') as action:self.control.close();action.assert_not_called()
    def test_viewer_stop_checks_service_identity(self):
        self.control.request=lambda *args:{'service':'other-program'}
        with self.assertRaisesRegex(RuntimeError,'其他程序'):self.control._viewer_action('stop')
    def test_frozen_html_inlines_all_game_assets(self):
        html=load_ui(Path(__file__).resolve().parents[1]/'ui')
        self.assertIn('window.GamePanel=',html);self.assertIn('.game-panel{',html)
        self.assertNotIn('src="games.js"',html);self.assertNotIn('href="games.css"',html)
    def test_previous_viewer_plain_text_stop_acknowledgement(self):
        self.assertTrue(self.control._request(f'http://127.0.0.1:{self.server.server_port}/stop','POST',{})['ok'])
    def test_slow_old_poll_cannot_overwrite_completed_start(self):
        self.delay_once=True;self.release_state.clear();self.control.snapshot();self.assertTrue(self.delayed.wait(timeout=1))
        self.control.action('minecraft','server','start')
        deadline=time.monotonic()+2
        while self.control.snapshot()['actions'] and time.monotonic()<deadline:time.sleep(.01)
        self.assertTrue(self.control.snapshot()['games'][0]['lanes'][0]['up'])
        self.release_state.set();self.wait_idle()
        self.assertTrue(self.control.snapshot()['games'][0]['lanes'][0]['up'])

if __name__=='__main__':unittest.main()
