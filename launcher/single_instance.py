"""Windows session-wide ownership, acquired before constructing service controls."""
import ctypes
from ctypes import wintypes


class SingleInstance:
    def __init__(self, title, name=r'Local\corti-soul.launcher', legacy=True):
        self.title, self.name, self.legacy = title, name, legacy
        self.handle = None
        self.kernel = ctypes.WinDLL('kernel32', use_last_error=True)
        self.user = ctypes.WinDLL('user32', use_last_error=True)
        self.kernel.CreateMutexW.argtypes = [ctypes.c_void_p, wintypes.BOOL, wintypes.LPCWSTR]
        self.kernel.CreateMutexW.restype = wintypes.HANDLE
        self.kernel.CloseHandle.argtypes = [wintypes.HANDLE]
        self.user.FindWindowW.argtypes = [wintypes.LPCWSTR, wintypes.LPCWSTR]
        self.user.FindWindowW.restype = wintypes.HWND
        self.user.IsIconic.argtypes = [wintypes.HWND]
        self.user.ShowWindow.argtypes = [wintypes.HWND, ctypes.c_int]
        self.user.SetForegroundWindow.argtypes = [wintypes.HWND]

    def focus_existing(self):
        window = self.user.FindWindowW(None, self.title)
        if window:
            self.user.ShowWindow(window, 9 if self.user.IsIconic(window) else 5)
            self.user.SetForegroundWindow(window)
        return bool(window)

    def acquire(self):
        ctypes.set_last_error(0)
        handle = self.kernel.CreateMutexW(None, False, self.name)
        error = ctypes.get_last_error()
        if not handle:
            raise ctypes.WinError(error)
        if error == 183:  # ERROR_ALREADY_EXISTS, including another release of this app.
            self.kernel.CloseHandle(handle)
            self.focus_existing()
            return False
        self.handle = handle
        if self.legacy and self.focus_existing():
            self.close()
            return False
        return True

    def close(self):
        if self.handle:
            self.kernel.CloseHandle(self.handle)
            self.handle = None
