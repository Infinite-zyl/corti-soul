import json
from pathlib import Path
import sys,tempfile,unittest
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from gateway_health import gateway_health

class GatewayHealthTests(unittest.TestCase):
    def fixture(self,root,url):
        d=root/'deployments/mybot';d.mkdir(parents=True)
        (d/'config.json').write_text(json.dumps({'activeProvider':'chosen'}))
        p=root/'deployments/providers/chosen';p.mkdir(parents=True)
        (p/'config.json').write_text(json.dumps({'baseUrl':url}))
    def test_actual_selected_port_and_no_model_request(self):
        with tempfile.TemporaryDirectory()as t:
            root=Path(t);self.fixture(root,'http://127.0.0.1:8326/v1');calls=[]
            result=gateway_health(root,probe=lambda h,p:calls.append((h,p))or True)
            self.assertTrue(result['up']);self.assertEqual(calls,[('127.0.0.1',8326)])
            self.assertIn('8326',result['detail']);self.assertNotIn('18899',result['detail'])
    def test_offline_unknown_and_remote_are_distinct(self):
        with tempfile.TemporaryDirectory()as t:
            root=Path(t);self.assertIsNone(gateway_health(root)['up'])
            self.fixture(root,'http://localhost:1234/v1')
            self.assertFalse(gateway_health(root,probe=lambda *_:False)['up'])
            (root/'deployments/providers/chosen/config.json').write_text(json.dumps({'baseUrl':'https://example.invalid/v1'}))
            result=gateway_health(root,probe=lambda *_:self.fail('不应探测远程'))
            self.assertIsNone(result['up']);self.assertIn('远程渠道',result['detail'])
    def test_ipv6_and_changed_selection(self):
        with tempfile.TemporaryDirectory()as t:
            root=Path(t);self.fixture(root,'http://[::1]:4567/v1');calls=[]
            self.assertTrue(gateway_health(root,probe=lambda h,p:calls.append((h,p))or True)['up'])
            self.assertEqual(calls,[('::1',4567)])
            (root/'deployments/mybot/config.json').write_text('{"activeProvider":"../other"}')
            self.assertIsNone(gateway_health(root)['up'])
