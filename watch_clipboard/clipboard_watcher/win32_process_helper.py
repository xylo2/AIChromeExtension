# Utilitaires Win32 pour résoudre Python réel et détecter le navigateur parent.

import ctypes
from ctypes import wintypes
import glob
import os
import shutil
import sys
from typing import Dict, List, Optional, Tuple


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


def is_bare_windowsapps_alias(exe_path: str) -> bool:
    """Indique si le chemin pointe vers un alias brut du dossier WindowsApps."""
    norm: str = os.path.normcase(os.path.normpath(exe_path))
    return os.path.basename(os.path.dirname(norm)) == "windowsapps"


def resolve_python_executable() -> str:
    """Résout le chemin vers un exécutable Python console fonctionnel sous Windows/Unix."""
    if os.name != "nt":
        return sys.executable
    candidates: List[str] = []
    base_exe: str = getattr(sys, "_base_executable", "") or ""
    if base_exe:
        candidates.append(base_exe)
    candidates.append(sys.executable)
    for raw in candidates:
        if not raw:
            continue
        resolved: str = os.path.realpath(raw) if os.path.exists(raw) else raw
        if not is_bare_windowsapps_alias(resolved):
            if os.path.basename(resolved).lower() == "pythonw.exe":
                console_cand: str = os.path.join(os.path.dirname(resolved), "python.exe")
                if os.path.isfile(console_cand):
                    return console_cand
            if os.path.isfile(resolved):
                return resolved
    for entry in os.environ.get("PATH", "").split(os.pathsep):
        clean_dir: str = entry.strip().strip('"')
        if clean_dir and os.path.basename(os.path.normcase(clean_dir)) != "windowsapps":
            cand: str = os.path.join(clean_dir, "python.exe")
            if os.path.isfile(cand):
                return cand
    local_app: str = os.environ.get("LOCALAPPDATA", "")
    for pattern in (
        os.path.join(local_app, "Microsoft", "WindowsApps", "PythonSoftwareFoundation.Python*", "python.exe"),
        os.path.join(local_app, "Programs", "Python", "Python*", "python.exe"),
        r"C:\Program Files\Python*\python.exe",
        r"C:\Python*\python.exe",
    ):
        for match in sorted(glob.glob(pattern), reverse=True):
            if os.path.isfile(match):
                return match
    found: Optional[str] = shutil.which("python.exe") or shutil.which("python")
    return found or sys.executable


def detect_parent_browser_executable(browser_names: Tuple[str, ...]) -> str:
    """Remonte l'arbre des processus parents Win32 pour identifier le navigateur hôte."""
    if os.name != "nt":
        return ""
    try:
        kernel32 = ctypes.windll.kernel32
        snap = kernel32.CreateToolhelp32Snapshot(0x00000002, 0)
        if snap == wintypes.HANDLE(-1).value:
            return ""
        procs: Dict[int, Tuple[int, str]] = {}
        try:
            entry = _PROCESSENTRY32W()
            entry.dwSize = ctypes.sizeof(_PROCESSENTRY32W)
            if kernel32.Process32FirstW(snap, ctypes.byref(entry)):
                while True:
                    procs[int(entry.th32ProcessID)] = (int(entry.th32ParentProcessID), str(entry.szExeFile))
                    if not kernel32.Process32NextW(snap, ctypes.byref(entry)):
                        break
        finally:
            kernel32.CloseHandle(snap)
        curr_pid: int = os.getpid()
        visited: set[int] = set()
        while curr_pid in procs and curr_pid not in visited:
            visited.add(curr_pid)
            parent_pid, exe_name = procs[curr_pid]
            if exe_name.lower() in browser_names:
                return exe_name
            curr_pid = parent_pid
    except Exception:
        pass
    return ""
