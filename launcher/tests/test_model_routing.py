import sys
import tempfile
import unittest
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from model_routing import ModelRouting


class RoutingTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.events = []
        self.active = 'old'
        self.fail_activate = False
        def request(path, method='GET'):
            self.events.append((path, method))
            if path == '/api/providers':
                return {'active': self.active, 'providers': [{'id': 'chosen', 'name': 'Chosen', 'model': 'example', 'key': 'DO-NOT-RETURN'}]}
            if method == 'POST':
                self.assertEqual(self.routing.state()['mode'], 'manual')
                if self.fail_activate:
                    raise RuntimeError('HTTP 429')
                self.active = 'chosen'
                return {'ok': True}
            raise AssertionError(path)
        self.routing = ModelRouting(Path(self.temp.name) / 'mode.json', 'http://localhost', self.stop, self.start, request)

    def tearDown(self):
        self.temp.cleanup()

    def stop(self):
        self.events.append('stop')
        return {'ok': True}

    def start(self):
        self.events.append('start')
        return {'ok': True}

    def test_manual_stops_guard_before_activation_and_persists(self):
        result = self.routing.apply('manual', 'chosen')
        self.assertTrue(result['ok'])
        self.assertLess(self.events.index('stop'), self.events.index(('/api/providers/chosen/activate', 'POST')))
        self.assertEqual(ModelRouting(self.routing.file, '', None, None).state()['provider'], 'chosen')
        self.assertNotIn('key', self.routing.options()['providers'][0])

    def test_limited_model_keeps_manual_and_does_not_fallback(self):
        self.fail_activate = True
        self.assertFalse(self.routing.apply('manual', 'chosen')['ok'])
        self.assertEqual(self.routing.state()['mode'], 'manual')
        self.assertNotIn('start', self.events)
        self.assertEqual(self.active, 'old')

    def test_stop_failure_rolls_back_without_activation(self):
        self.routing.stop_guard = lambda: {'ok': False}
        self.assertFalse(self.routing.apply('manual', 'chosen')['ok'])
        self.assertEqual(self.routing.state()['mode'], 'auto')
        self.assertFalse(any(isinstance(e, tuple) and e[1] == 'POST' for e in self.events))

    def test_auto_starts_guard_and_bad_choice_never_changes_mode(self):
        self.assertFalse(self.routing.apply('manual', 'unknown')['ok'])
        self.assertEqual(self.routing.state()['mode'], 'auto')
        self.assertTrue(self.routing.apply('auto')['ok'])
        self.assertIn('start', self.events)

    def test_corrupt_mode_pauses_switching(self):
        self.routing.file.write_text('{broken')
        self.assertEqual(self.routing.state()['mode'], 'manual')
        self.assertIn('error', self.routing.state())


if __name__ == '__main__':
    unittest.main()
