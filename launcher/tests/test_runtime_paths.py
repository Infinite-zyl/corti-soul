import json
from pathlib import Path
import sys
import tempfile
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from runtime_paths import active_runtime


class RuntimePathsTests(unittest.TestCase):
    def test_default_and_selected_installations_do_not_share_paths(self):
        with tempfile.TemporaryDirectory() as directory:
            repo = Path(directory)
            self.assertEqual(active_runtime(repo, repo), repo / 'cortico-qq')
            candidate = repo / 'new'; candidate.mkdir()
            (candidate / 'package.json').write_text('{}')
            (repo / 'runtime-selection.json').write_text(json.dumps({'corticoRoot': str(candidate)}))
            self.assertEqual(active_runtime(repo, repo), candidate.resolve())

    def test_invalid_selection_does_not_silently_start_another_installation(self):
        with tempfile.TemporaryDirectory() as directory:
            repo = Path(directory)
            for text in ('{', '{}', '{"corticoRoot":"relative"}', '{"corticoRoot":null}'):
                (repo / 'runtime-selection.json').write_text(text)
                with self.assertRaises(RuntimeError):
                    active_runtime(repo, repo)
