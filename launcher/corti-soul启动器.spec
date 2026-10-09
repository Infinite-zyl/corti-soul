# -*- mode: python ; coding: utf-8 -*-
"""corti-soul 启动器 — one-folder build.

one-folder rather than one-file: the one-file bootloader unpacks itself into
%TEMP% on every launch, which fails on locked-down or redirected Windows
profiles with "Could not create temporary directory!". one-folder starts
instantly and needs no temp dir; wrap it in NSIS/MSI for a real installer.
"""

a = Analysis(
    ['app.py'],
    pathex=[],
    binaries=[],
    datas=[('ui', 'ui'), ('brand', 'brand')],
    hiddenimports=[
        'coreclr_env',
        'webview.platforms.edgechromium',
        'webview.platforms.winforms',
        'clr_loader', 'pythonnet', 'clr',
    ],
    hookspath=[], hooksconfig={}, runtime_hooks=[],
    excludes=['tkinter', 'matplotlib', 'numpy', 'pytest'],
    noarchive=False, optimize=0,
)
pyz = PYZ(a.pure)

exe = EXE(
    pyz, a.scripts, [],
    exclude_binaries=True,
    name='corti-soul启动器',
    debug=False, bootloader_ignore_signals=False, strip=False,
    upx=False,
    console=False,
    disable_windowed_traceback=False, argv_emulation=False,
    target_arch=None, codesign_identity=None, entitlements_file=None,
    icon='brand/icon.ico',
    version='brand/version_info.txt',
)

coll = COLLECT(
    exe, a.binaries, a.datas,
    strip=False, upx=False, upx_exclude=[],
    name='corti-soul启动器',
)
