"""Resolve the selected framework without editing the preserved installation."""
import json
from pathlib import Path


def active_runtime(repo, base):
    selector = Path(repo) / 'runtime-selection.json'
    if not selector.exists():
        return Path(base) / 'cortico-qq'
    try:
        value = json.loads(selector.read_text(encoding='utf-8'))['corticoRoot']
        root = Path(value)
        if not root.is_absolute() or not (root / 'package.json').is_file():
            raise ValueError('运行目录无效')
        return root.resolve()
    except (OSError, ValueError, KeyError, TypeError) as error:
        raise RuntimeError('Cortico 运行目录选择文件无效，请恢复 runtime-selection.json 或使用回退脚本。') from error
