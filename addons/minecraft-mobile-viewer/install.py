"""Download pinned official portable tools, verifying release SHA-256 digests."""
import hashlib
import json
from pathlib import Path
import urllib.request
import zipfile

ROOT = Path(__file__).resolve().parent
RUNTIME = ROOT / '.runtime'
PACKAGES = [
    ('obs', 'https://github.com/obsproject/obs-studio/releases/download/32.2.2/OBS-Studio-32.2.2-Windows-x64.zip', '4d6e40e3ab155f56b30de517380566a206d74b63cdf5ad49aa596924768f97e1'),
    ('mediamtx', 'https://github.com/bluenviron/mediamtx/releases/download/v1.21.2/mediamtx_v1.21.2_windows_amd64.zip', 'a84224f5a490855684e62ba6fb71e80ea2a5e16aed61883bb58380290e93e467'),
]

def install():
    RUNTIME.mkdir(exist_ok=True)
    manifest = []
    for name, url, digest in PACKAGES:
        archive = RUNTIME / (name + '.zip')
        if not archive.exists() or hashlib.sha256(archive.read_bytes()).hexdigest() != digest:
            print('Downloading ' + name, flush=True)
            partial = archive.with_suffix('.partial')
            req = urllib.request.Request(url, headers={'User-Agent': 'corti-soul/2.8.0'})
            with urllib.request.urlopen(req, timeout=60) as response, partial.open('wb') as out:
                while chunk := response.read(1024 * 1024):
                    out.write(chunk)
            if hashlib.sha256(partial.read_bytes()).hexdigest() != digest:
                raise RuntimeError('SHA-256 mismatch: ' + name)
            partial.replace(archive)
        target = RUNTIME / name
        if not (target / '.verified').exists():
            with zipfile.ZipFile(archive) as z:
                for item in z.infolist():
                    if not (target / item.filename).resolve().is_relative_to(target.resolve()):
                        raise RuntimeError('Unsafe archive entry')
                z.extractall(target)
            (target / '.verified').write_text(digest)
        manifest.append({'name': name, 'url': url, 'sha256': digest})
        print('Verified ' + name, flush=True)
    (RUNTIME / 'obs' / 'portable_mode.txt').touch()
    (RUNTIME / 'installed.json').write_text(json.dumps(manifest, indent=2))

if __name__ == '__main__':
    install()
