# Commandes pip à exécuter : Aucune dépendance externe requise (bibliothèque standard uniquement)

import ctypes
from ctypes import wintypes
import glob
import json
import os
import shlex
import shutil
import struct
import subprocess
import sys
from typing import Any, Dict, List, Optional


class NativeMessagingHost:
    """
    Hôte Native Messaging compatible avec le protocole stdio de Chrome/Edge/Brave.
    Lance watch_clipboard.py en arrière-plan et lui transmet le jeton d'API et l'origine autorisée.
    """

    BROWSER_EXECUTABLES: tuple[str, ...] = (
        "chrome.exe",
        "msedge.exe",
        "brave.exe",
        "opera.exe",
        "vivaldi.exe",
        "chromium.exe",
    )

    def __init__(self, script_path: Optional[str] = None) -> None:
        if script_path is None:
            watcher_dir: str = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
            script_path = os.path.join(watcher_dir, "watch_clipboard.py")
        self.script_path: str = os.path.abspath(script_path)
        self.work_dir: str = self._resolve_work_dir()

    def _resolve_work_dir(self) -> str:
        watch_clip_dir: str = os.path.dirname(self.script_path)
        parent_dir: str = os.path.dirname(watch_clip_dir)
        if os.path.basename(parent_dir).lower() == "tools":
            return os.path.dirname(parent_dir)
        return parent_dir

    @staticmethod
    def _is_bare_windowsapps_alias(exe_path: str) -> bool:
        norm: str = os.path.normcase(os.path.normpath(exe_path))
        return os.path.basename(os.path.dirname(norm)) == "windowsapps"

    def _resolve_python_executable(self) -> str:
        if os.name == "nt":
            candidates: List[str] = []
            base_exe: str = getattr(sys, "_base_executable", "") or ""
            if base_exe:
                candidates.append(base_exe)
            candidates.append(sys.executable)
            for raw in candidates:
                if not raw:
                    continue
                resolved: str = os.path.realpath(raw) if os.path.exists(raw) else raw
                if not self._is_bare_windowsapps_alias(resolved):
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
            if found:
                return found
        return sys.executable

    def _detect_browser_executable(self) -> str:
        if os.name != "nt":
            return ""
        try:
            kernel32 = ctypes.windll.kernel32
            snap = kernel32.CreateToolhelp32Snapshot(0x00000002, 0)
            if snap == wintypes.HANDLE(-1).value:
                return ""

            class PROCESSENTRY32W(ctypes.Structure):
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

            procs: Dict[int, tuple[int, str]] = {}
            try:
                entry = PROCESSENTRY32W()
                entry.dwSize = ctypes.sizeof(PROCESSENTRY32W)
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
                if exe_name.lower() in self.BROWSER_EXECUTABLES:
                    return exe_name
                curr_pid = parent_pid
        except Exception:
            pass
        return ""
    def _build_command(self, target_dir: str = ".", extra_args: str = "") -> List[str]:
        clean_target: str = (target_dir or ".").strip().rstrip("\\/") or "."
        py_exe: str = self._resolve_python_executable()
        cmd: List[str] = [py_exe, "-B", self.script_path, clean_target]
        clean_extra: str = (extra_args or "").strip()
        if clean_extra:
            cmd.extend(shlex.split(clean_extra, posix=(os.name != "nt")))
        return cmd

    def read_message(self) -> Optional[Dict[str, Any]]:
        raw_len: bytes = sys.stdin.buffer.read(4)
        if not raw_len or len(raw_len) < 4:
            return None
        msg_len: int = next(iter(struct.unpack("@I", raw_len)), 0)
        if msg_len <= 0 or msg_len > 10 * 1024 * 1024:
            return None
        raw_body: bytes = sys.stdin.buffer.read(msg_len)
        if not raw_body or len(raw_body) < msg_len:
            return None
        parsed = json.loads(raw_body.decode("utf-8"))
        return parsed if isinstance(parsed, dict) else None

    def send_message(self, payload: Dict[str, Any]) -> None:
        encoded: bytes = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        sys.stdout.buffer.write(struct.pack("@I", len(encoded)))
        sys.stdout.buffer.write(encoded)
        sys.stdout.buffer.flush()

    def _start_watcher_process(self, message: Dict[str, Any]) -> Dict[str, Any]:
        if not os.path.isfile(self.script_path):
            return {"ok": False, "error": f"Script introuvable : {self.script_path}"}

        target_dir: str = str(message.get("target_dir", ".")).strip() or "."
        extra_args: str = str(message.get("extra_args", "")).strip()
        api_token: str = str(message.get("api_token", "")).strip()
        allowed_origin: str = str(message.get("allowed_origin", "")).strip()

        cmd: List[str] = self._build_command(target_dir=target_dir, extra_args=extra_args)
        env: Dict[str, str] = os.environ.copy()
        env["PYTHONUTF8"] = "1"
        env["PYTHONIOENCODING"] = "utf-8"
        if api_token:
            env["WATCH_CLIPBOARD_TOKEN"] = api_token
        if allowed_origin:
            env["WATCH_CLIPBOARD_ORIGIN"] = allowed_origin

        browser_exe: str = self._detect_browser_executable()
        if browser_exe:
            env["WATCH_CLIPBOARD_BROWSER_EXE"] = browser_exe

        kwargs: Dict[str, Any] = {
            "cwd": self.work_dir,
            "env": env,
            "stdin": subprocess.DEVNULL,
            "stdout": subprocess.DEVNULL,
            "stderr": subprocess.DEVNULL,
            "close_fds": True,
        }
        if os.name == "nt":
            no_window_flag: int = getattr(subprocess, "CREATE_NO_WINDOW", 0x08000000)
            new_group_flag: int = getattr(subprocess, "CREATE_NEW_PROCESS_GROUP", 0x00000200)
            kwargs["creationflags"] = no_window_flag | new_group_flag
        else:
            kwargs["start_new_session"] = True

        proc = subprocess.Popen(cmd, **kwargs)
        return {"ok": True, "pid": proc.pid, "work_dir": self.work_dir}

    def run_once(self) -> None:
        try:
            msg: Optional[Dict[str, Any]] = self.read_message()
            if not msg:
                return
            action: str = str(msg.get("action", "")).strip()
            if action == "ping":
                self.send_message({"ok": True, "service": "watch_clipboard_host"})
            elif action == "start":
                self.send_message(self._start_watcher_process(msg))
            else:
                self.send_message({"ok": False, "error": f"Action inconnue : {action}"})
        except Exception as exc:
            try:
                self.send_message({"ok": False, "error": str(exc)})
            except Exception:
                pass


def main() -> None:
    NativeMessagingHost().run_once()


if __name__ == "__main__":
    main()
