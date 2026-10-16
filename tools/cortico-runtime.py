"""Select or snapshot an offline Cortico installation; never launch a bot."""
import argparse
import hashlib
import json
from pathlib import Path
import re
import shutil
import socket
import subprocess
import sys

REPO = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO / 'launcher'))
from runtime_paths import active_runtime


def offline():
    check = subprocess.run(['powershell.exe', '-NoProfile', '-NonInteractive', '-Command',
        "@(Get-Process | Where-Object {$_.ProcessName -like '*corti-soul*'}).Count"],
        capture_output=True, text=True, timeout=10, creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))
    if check.returncode or check.stdout.strip() != '0':
        raise RuntimeError('请先退出启动器，再切换运行目录；已打开的启动器仍持有原运行目录。')
    with socket.socket() as connection:
        connection.settimeout(.3)
        if connection.connect_ex(('127.0.0.1', 7788)) == 0:
            raise RuntimeError('请先退出启动器并正常关闭 Cortico，再执行切换或部署快照。')


def framework(root):
    root = Path(root).resolve()
    pkg = json.loads((root / 'package.json').read_text(encoding='utf-8'))
    if pkg.get('name') != 'cortico':
        raise ValueError('目标不是 Cortico 运行目录')
    return root, pkg['version']


def select(root):
    offline()
    root, version = framework(root)
    if version.startswith('0.2.') and not (root / '.corti-upgrade-ready.json').is_file():
        raise ValueError('候选尚未完成迁移验收，拒绝选择')
    selector = REPO / 'runtime-selection.json'
    # The previous selector and both data trees remain available for manual recovery.
    if selector.exists():
        directory = REPO / 'backups' / 'runtime-selections'
        directory.mkdir(parents=True, exist_ok=True)
        digest = hashlib.sha256(selector.read_bytes()).hexdigest()[:16]
        shutil.copy2(selector, directory / (digest + '.json'))
    temp = selector.with_suffix('.tmp')
    temp.write_text(json.dumps({'corticoRoot': str(root), 'version': version}, ensure_ascii=False, indent=2), encoding='utf-8')
    temp.replace(selector)
    print('已选择 Cortico ' + version + '。请使用新版启动器启动；未启动任何进程。')


def snapshot(source, target):
    offline()
    source, _ = framework(source)
    target, version = framework(target)
    if source == target or source in target.parents or target in source.parents:
        raise ValueError('源与目标必须是独立运行目录')
    if (target / 'deployments').exists() or (target / 'extensions').exists():
        raise ValueError('候选已有部署或扩展，拒绝覆盖')
    if not version.startswith('0.2.'):
        raise ValueError('快照迁移只支持已经适配的 0.2 候选')
    manifest = REPO / 'backups' / 'cortico-0.2-migration'
    manifest.mkdir(parents=True, exist_ok=True)
    if (manifest / 'deployments').exists():
        raise ValueError('已有切换前部署备份，拒绝覆盖')
    files = []
    deployment = source / 'deployments'
    # Do not follow a deployment symlink into an unknown data directory.
    if any(p.is_symlink() for p in deployment.rglob('*')):
        raise ValueError('部署包含符号链接，请先人工核对真实数据路径')
    shutil.copytree(deployment, target / 'deployments')
    shutil.copytree(deployment, manifest / 'deployments')
    for p in deployment.rglob('*'):
        if p.is_file():
            q = target / 'deployments' / p.relative_to(deployment)
            with p.open('rb') as stream:
                before = hashlib.file_digest(stream, 'sha256').hexdigest()
            with q.open('rb') as stream:
                after = hashlib.file_digest(stream, 'sha256').hexdigest()
            with (manifest / 'deployments' / p.relative_to(deployment)).open('rb') as stream:
                backup_hash = hashlib.file_digest(stream, 'sha256').hexdigest()
            if before != after or before != backup_hash:
                raise RuntimeError('部署快照校验失败，禁止切换')
            files.append({'path': str(p.relative_to(source)), 'sha256': before})
    for config in (target / 'deployments').glob('*/config.json'):
        value = json.loads(config.read_text(encoding='utf-8-sig'))
        worlds = value.get('worlds', {})
        worlds.pop('dst', None)
        if 'terminal' in worlds:
            if 'console' in worlds:
                raise ValueError('terminal 与 console 配置同时存在，请人工合并')
            worlds['console'] = worlds.pop('terminal')
        logging = value.get('logging', {})
        if 'console' in logging:
            if 'stdout' in logging:
                raise ValueError('console 与 stdout 日志配置同时存在，请人工合并')
            logging['stdout'] = logging.pop('console')
        config.write_text(json.dumps(value, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    ext_source = source / 'extensions'
    ext_target = target / 'extensions'
    ext_target.mkdir()
    package = json.loads((ext_source / 'package.json').read_text(encoding='utf-8'))
    package.get('dependencies', {}).pop('cortico-world-dst', None)
    (ext_target / 'package.json').write_text(json.dumps(package, ensure_ascii=False, indent=2)+'\n', encoding='utf-8')
    lock = ext_source / 'pnpm-lock.yaml'
    if lock.exists():
        text = lock.read_text(encoding='utf-8')
        text = re.sub(r'^      cortico-world-dst:\n(?:        .*\n)+', '', text, flags=re.M)
        (ext_target / lock.name).write_text(text, encoding='utf-8')
    for name in package.get('dependencies', {}):
        # Copy each actual package, preserving installed local patches without old absolute junctions.
        destination = ext_target / 'node_modules' / name
        shutil.copytree(ext_source / 'node_modules' / name, destination,
                        ignore=shutil.ignore_patterns('*.orig', '__pycache__'))
    assets = source / 'bots/cormini/emoji'
    if assets.exists():
        shutil.copytree(assets, target / 'bots/cormini/emoji', dirs_exist_ok=True)
    offline()
    (manifest / 'deployment-files.json').write_text(json.dumps({'preservedRoot': str(source), 'candidateRoot': str(target), 'files': files}, ensure_ascii=False, indent=2), encoding='utf-8')
    print(f'部署快照校验通过：{len(files)} 个文件；旧目录保留，候选移除饥荒配置与扩展。')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest='action', required=True)
    sub.add_parser('status')
    use = sub.add_parser('select'); use.add_argument('root')
    snap = sub.add_parser('snapshot'); snap.add_argument('source'); snap.add_argument('target')
    args = parser.parse_args()
    if args.action == 'status':
        root, version = framework(active_runtime(REPO, REPO.parent))
        print(f'Cortico {version}\n{root}')
    elif args.action == 'select':
        select(args.root)
    else:
        snapshot(args.source, args.target)


if __name__ == '__main__':
    try:
        main()
    except (OSError, ValueError, KeyError, RuntimeError) as error:
        print(str(error), file=sys.stderr)
        sys.exit(1)
