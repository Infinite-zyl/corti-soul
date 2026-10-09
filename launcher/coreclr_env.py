"""Make pywebview's WinForms backend work on modern .NET.

Import this **before** `import webview`:

    import coreclr_env  # noqa: F401
    import webview

Two separate problems are solved here, both Windows-specific.

1. pythonnet defaults to legacy .NET Framework on Windows. WebView2 needs
   CoreCLR, and pythonnet needs a `runtimeconfig.json` naming the framework to
   host on. We point it at the installed Microsoft.WindowsDesktop.App, rolling
   forward to the newest version present.

2. pywebview's `webview/platforms/winforms.py` resolves three types in its
   *class body* at import time:

       System.Windows.Forms.FileDialogNative+IFileDialog
       System.Windows.Forms.FileDialogNative+FOS
       System.Windows.Forms.FileDialog+VistaDialogEvents

   Those are internal **.NET Framework** types. CoreCLR has never had them, so
   the class definition raises AttributeError and the whole GUI stack becomes
   unimportable -- even though the native dialog is only needed if you actually
   call `create_file_dialog`. We rewrite those lookups to be lazy.

Both fixes are idempotent and safe to run repeatedly.
"""
from __future__ import annotations

import json
import os
import pathlib
import re
import sys

_VERBOSE = os.environ.get("APP_VERBOSE", "1") != "0"
_DOTNET = pathlib.Path(r"C:\Program Files\dotnet\shared\Microsoft.WindowsDesktop.App")


def _log(msg: str) -> None:
    if _VERBOSE:
        print(f"[coreclr] {msg}", file=sys.stderr, flush=True)


def _newest_desktop() -> str | None:
    if not _DOTNET.is_dir():
        return None
    vers = [
        tuple(int(x) for x in d.name.split("."))
        for d in _DOTNET.iterdir()
        if d.is_dir() and re.match(r"^\d+\.\d+\.\d+$", d.name)
    ]
    return ".".join(str(x) for x in max(vers)) if vers else None


def _runtimeconfig(version: str) -> pathlib.Path:
    out = pathlib.Path(__file__).parent / "runtimeconfig.json"
    if out.exists():
        try:
            cur = json.loads(out.read_text(encoding="utf-8"))
            if cur["runtimeOptions"]["framework"]["version"] == version:
                return out
        except Exception:  # noqa: BLE001
            pass
    cfg = {
        "runtimeOptions": {
            "tfm": f"net{version.split('.')[0]}.0",
            "framework": {"name": "Microsoft.WindowsDesktop.App", "version": version},
            "configProperties": {"System.GC.Server": False},
        }
    }
    out.write_text(json.dumps(cfg, indent=2), encoding="utf-8")
    return out


_OLD_BLOCK = """    windowsFormsAssembly = Assembly.LoadWithPartialName('System.Windows.Forms')
    iFileDialogType = windowsFormsAssembly.GetType(
        'System.Windows.Forms.FileDialogNative+IFileDialog'
    )
    OpenFileDialogType = windowsFormsAssembly.GetType('System.Windows.Forms.OpenFileDialog')
    FileDialogType = windowsFormsAssembly.GetType('System.Windows.Forms.FileDialog')
    createVistaDialogMethodInfo = OpenFileDialogType.GetMethod('CreateVistaDialog', flags)
    onBeforeVistaDialogMethodInfo = OpenFileDialogType.GetMethod('OnBeforeVistaDialog', flags)
    getOptionsMethodInfo = FileDialogType.GetMethod('GetOptions', flags)
    setOptionsMethodInfo = iFileDialogType.GetMethod('SetOptions', flags)
    fosPickFoldersBitFlag = (
        windowsFormsAssembly.GetType('System.Windows.Forms.FileDialogNative+FOS')
        .GetField('FOS_PICKFOLDERS')
        .GetValue(None)
    )

    vistaDialogEventsConstructorInfo = windowsFormsAssembly.GetType(
        'System.Windows.Forms.FileDialog+VistaDialogEvents'
    ).GetConstructor(flags, None, [FileDialogType], [])
    adviseMethodInfo = iFileDialogType.GetMethod('Advise')
    unadviseMethodInfo = iFileDialogType.GetMethod('Unadvise')
    showMethodInfo = iFileDialogType.GetMethod('Show')
"""

_NEW_BLOCK = """    windowsFormsAssembly = Assembly.LoadWithPartialName('System.Windows.Forms')
    _lazy_done = False

    @classmethod
    def _lazy_resolve(cls):
        # These types are .NET Framework internals absent from CoreCLR; resolve
        # on demand so importing the module never fails.
        if cls._lazy_done:
            return
        cls._lazy_done = True
        a, f = cls.windowsFormsAssembly, cls.flags
        cls.iFileDialogType = a.GetType('System.Windows.Forms.FileDialogNative+IFileDialog')
        cls.OpenFileDialogType = a.GetType('System.Windows.Forms.OpenFileDialog')
        cls.FileDialogType = a.GetType('System.Windows.Forms.FileDialog')
        if cls.iFileDialogType is None or cls.FileDialogType is None:
            return
        cls.createVistaDialogMethodInfo = cls.OpenFileDialogType.GetMethod('CreateVistaDialog', f)
        cls.onBeforeVistaDialogMethodInfo = cls.OpenFileDialogType.GetMethod('OnBeforeVistaDialog', f)
        cls.getOptionsMethodInfo = cls.FileDialogType.GetMethod('GetOptions', f)
        cls.setOptionsMethodInfo = cls.iFileDialogType.GetMethod('SetOptions', f)
        fos = a.GetType('System.Windows.Forms.FileDialogNative+FOS')
        cls.fosPickFoldersBitFlag = fos.GetField('FOS_PICKFOLDERS').GetValue(None) if fos else None
        vde = a.GetType('System.Windows.Forms.FileDialog+VistaDialogEvents')
        cls.vistaDialogEventsConstructorInfo = (
            vde.GetConstructor(f, None, [cls.FileDialogType], []) if vde else None
        )
        cls.adviseMethodInfo = cls.iFileDialogType.GetMethod('Advise')
        cls.unadviseMethodInfo = cls.iFileDialogType.GetMethod('Unadvise')
        cls.showMethodInfo = cls.iFileDialogType.GetMethod('Show')
"""

_SHOW_OLD = """    def show(cls, parent=None, initialDirectory=None, allow_multiple=False, title=None):
        openFileDialog = WinForms.OpenFileDialog()"""

_SHOW_NEW = """    def show(cls, parent=None, initialDirectory=None, allow_multiple=False, title=None):
        cls._lazy_resolve()
        openFileDialog = WinForms.OpenFileDialog()"""


def patch_webview() -> bool:
    """Rewrite the class-body lookups to be lazy. Returns True if patched/ok.

    In a frozen PyInstaller build the module is inside the PYZ archive, so
    there is no source file left to patch -- it must already have been patched
    at build time (install_deps.py does this). That case is a normal success,
    not a failure, so it stays quiet.
    """
    if getattr(sys, "frozen", False):
        return True

    try:
        import webview
        src_path = pathlib.Path(webview.__file__).parent / "platforms" / "winforms.py"
    except Exception as e:  # noqa: BLE001
        _log(f"cannot locate winforms.py: {e}")
        return False

    if not src_path.exists():
        _log(f"missing {src_path}")
        return False

    src = src_path.read_text(encoding="utf-8")
    if "_lazy_resolve" in src:
        return True
    if _OLD_BLOCK not in src:
        _log("winforms.py layout unrecognised -- skipping lazy patch")
        return False

    src = src.replace(_OLD_BLOCK, _NEW_BLOCK, 1)
    if _SHOW_OLD in src:
        src = src.replace(_SHOW_OLD, _SHOW_NEW, 1)
    else:
        _log("show() anchor missing -- folder picker may fail")

    try:
        src_path.write_text(src, encoding="utf-8")
        _log(f"patched {src_path.name}")
    except Exception as e:  # noqa: BLE001
        _log(f"could not patch (read-only?): {e}")
        return False
    return True


def install() -> bool:
    """Point pythonnet at CoreCLR and make pywebview importable."""
    if sys.platform != "win32":
        return False

    version = _newest_desktop()
    if not version:
        _log("Microsoft.WindowsDesktop.App not found; leaving runtime default")
        return False

    os.environ["PYTHONNET_RUNTIME"] = "coreclr"
    os.environ["PYTHONNET_CORECLR_RUNTIME_CONFIG"] = str(_runtimeconfig(version))

    try:
        import clr

        # WPF split SystemEvents into its own assembly; pywebview does
        # `from Microsoft.Win32 import SystemEvents`, which only resolves once
        # that assembly is loaded.
        base = _DOTNET / version
        for dll in ("Microsoft.Win32.SystemEvents.dll", "System.Windows.Forms.dll",
                    "System.Drawing.Common.dll", "System.Drawing.Primitives.dll"):
            p = base / dll
            if p.exists():
                try:
                    clr.AddReference(str(p))
                except Exception as e:  # noqa: BLE001
                    _log(f"preload {dll}: {e}")
    except Exception as e:  # noqa: BLE001
        _log(f"CoreCLR init failed: {type(e).__name__}: {e}")
        return False

    patch_webview()
    _log(f"ready on WindowsDesktop.App {version}")
    return True


READY = install()
