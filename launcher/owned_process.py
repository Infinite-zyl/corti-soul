"""Windows job scope for child processes created by this launcher instance."""
import ctypes
from ctypes import wintypes
import struct

class ChildJob:
    def __init__(self):
        self.kernel=ctypes.WinDLL('kernel32',use_last_error=True)
        self.kernel.CreateJobObjectW.restype=wintypes.HANDLE
        self.kernel.SetInformationJobObject.argtypes=[wintypes.HANDLE,ctypes.c_int,ctypes.c_void_p,wintypes.DWORD]
        self.kernel.AssignProcessToJobObject.argtypes=[wintypes.HANDLE,wintypes.HANDLE]
        self.kernel.CloseHandle.argtypes=[wintypes.HANDLE]
        self.handle=self.kernel.CreateJobObjectW(None,None)
        limits=ctypes.create_string_buffer(144)
        struct.pack_into('I',limits,16,0x2000)
        if not self.handle or not self.kernel.SetInformationJobObject(self.handle,9,limits,len(limits)):
            self.close();raise ctypes.WinError(ctypes.get_last_error())

    def attach(self,process):
        if not self.handle or not self.kernel.AssignProcessToJobObject(self.handle,int(process._handle)):
            process.terminate();raise ctypes.WinError(ctypes.get_last_error())

    def close(self):
        if self.handle:self.kernel.CloseHandle(self.handle);self.handle=None
