# Vérification de l'activité du processus navigateur parent (Windows et Unix).

import ctypes
from ctypes import wintypes
import os
import subprocess


class _PROCESSENTRY32W(ctypes.Structure):
    """Structure Win32 décrivant une entrée de processus dans un instantané Toolhelp32."""

    _fields_ = [
        ("dwSize", wintypes.DWORD),
        ("cntUsage", wintypes.DWORD),
        ("th32ProcessID", wintypes.DWORD),
        ("th32DefaultHeapID", ctypes.POINTER(wintypes.ULONG)),
        ("th32ModuleID", wintypes.DWORD),
        ("cntThreads", wintypes.DWORD),
        ("th32ParentProcessID", wintypes.DWORD),
        ("pcPriClassBase", wintypes.LONG),
        ("dwFlags", wintypes.DWORD),
        ("szExeFile", wintypes.WCHAR * 260),
    ]


def is_process_running(process_name: str) -> bool:
    """Vérifie si au moins un processus portant process_name est actif."""
    if not process_name:
        return True
    if os.name == "nt":
        try:
            kernel32 = ctypes.windll.kernel32
            snap = kernel32.CreateToolhelp32Snapshot(0x00000002, 0)
            if snap == wintypes.HANDLE(-1).value:
                return True
            try:
                entry = _PROCESSENTRY32W()
                entry.dwSize = ctypes.sizeof(_PROCESSENTRY32W)
                target_low: str = process_name.lower()
                if kernel32.Process32FirstW(snap, ctypes.byref(entry)):
                    while True:
                        if str(entry.szExeFile).lower() == target_low:
                            return True
                        if not kernel32.Process32NextW(snap, ctypes.byref(entry)):
                            break
                return False
            finally:
                kernel32.CloseHandle(snap)
        except Exception:
            return True
    try:
        res = subprocess.run(["pgrep", "-f", process_name], capture_output=True, check=False)
        return res.returncode == 0
    except Exception:
        return True
