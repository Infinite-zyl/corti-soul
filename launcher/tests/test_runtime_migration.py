import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

SCRIPT = Path(__file__).resolve().parents[2] / 'tools/cortico-runtime.py'
spec = importlib.util.spec_from_file_location('runtime_migration', SCRIPT)
migration = importlib.util.module_from_spec(spec)
spec.loader.exec_module(migration)


class MigrationTests(unittest.TestCase):
    def test_snapshot_preserves_original_and_backup_and_removes_dst_only_from_new(self):
        with tempfile.TemporaryDirectory() as directory:
            repo = Path(directory)
            old, new = repo / 'old', repo / 'new'
            for root, version in ((old, '0.1.8'), (new, '0.2.1')):
                root.mkdir(); (root / 'package.json').write_text(json.dumps({'name':'cortico','version':version}))
            deploy = old / 'deployments/mybot'; deploy.mkdir(parents=True)
            config = {'worlds':{'dst':{'enabled':True},'minecraft':{'enabled':True},'terminal':{'enabled':True}},'logging':{'console':False}}
            original = json.dumps(config)
            (deploy / 'config.json').write_text(original)
            (deploy / '.env').write_text('TEST_SECRET=fixture')
            ext = old / 'extensions'; ext.mkdir()
            (ext / 'package.json').write_text(json.dumps({'dependencies':{'cortico-world-dst':'link:fixture'}}))
            with patch.object(migration, 'REPO', repo), patch.object(migration, 'offline'):
                migration.snapshot(old, new)
                self.assertEqual((deploy / 'config.json').read_text(), original)
                self.assertEqual((repo / 'backups/cortico-0.2-migration/deployments/mybot/config.json').read_text(), original)
                changed = json.loads((new / 'deployments/mybot/config.json').read_text())
                self.assertNotIn('dst', changed['worlds']);self.assertIn('console', changed['worlds'])
                self.assertEqual(changed['logging'], {'stdout':False})
                self.assertEqual((new / 'deployments/mybot/.env').read_text(), 'TEST_SECRET=fixture')
                self.assertEqual(json.loads((new / 'extensions/package.json').read_text())['dependencies'], {})
                with self.assertRaises(ValueError):migration.snapshot(old, new)
                with self.assertRaises(ValueError):migration.select(new)
                (new / '.corti-upgrade-ready.json').write_text('{}')
                migration.select(new);migration.select(old)
                self.assertEqual(json.loads((repo / 'runtime-selection.json').read_text())['corticoRoot'],str(old.resolve()))

    def test_live_service_blocks_snapshot(self):
        with patch.object(migration, 'offline', side_effect=RuntimeError('仍在运行')):
            with self.assertRaisesRegex(RuntimeError,'仍在运行'):
                migration.snapshot('unused', 'unused')
