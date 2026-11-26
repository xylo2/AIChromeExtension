# Commandes pip à exécuter : Aucune dépendance externe requise (bibliothèque standard uniquement)

import json
import os
import shlex
import struct
import subprocess
import sys
from typing import Any, Dict, List, Optional

_PKG_PARENT: str = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if _PKG_PARENT not in sys.path:
    sys.path.insert(0, _PKG_PARENT)

from clipboard_watcher.win32_process_helper import (  # noqa: E402
    detect_parent_browser_executable,
    is_bare_windowsapps_alias,
    resolve_python_executable,
)


class NativeMessagingHost:
    """
    Hôte Native Messaging compatible avec le protocole stdio de Chrome/Edge/Brave.
    Lance watch_clipboard.py en arrière-plan et synchronise le jeton d'API de session.
    """

    BROWSER_EXECUTABLES: tuple[str, ...] = (
        "chrome.exe", "msedge.exe", "brave.exe", "opera.exe", "vivaldi.exe", "chromium.exe",
    )

    def __init__(self, script_path: Optional[str] = None) -> None:
        if script_path is None:
            watcher_dir: str = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
            script_path = os.path.join(watcher_dir, "watch_clipboard.py")
        self.script_path: str = os.path.abspath(script_path)
        self.work_dir: str = self._resolve_work_dir()
        self.token_cache_path: str = os.path.join(os.path.dirname(self.script_path), ".native_host", "session_token.txt")

    def _resolve_work_dir(self) -> str:
        watch_clip_dir: str = os.path.dirname(self.script_path)
        parent_dir: str = os.path.dirname(watch_clip_dir)
        return os.path.dirname(parent_dir) if os.path.basename(parent_dir).lower() == "tools" else parent_dir

    @staticmethod
    def _is_bare_windowsapps_alias(exe_path: str) -> bool:
        return is_bare_windowsapps_alias(exe_path)

    def _resolve_python_executable(self) -> str:
        return resolve_python_executable()

    def _detect_browser_executable(self) -> str:
        return detect_parent_browser_executable(self.BROWSER_EXECUTABLES)

    def _build_command(self, target_dir: str = ".", extra_args: str = "") -> List[str]:
        clean_target: str = (target_dir or ".").strip().rstrip("\\/") or "."
        cmd: List[str] = [self._resolve_python_executable(), "-B", self.script_path, clean_target]
        clean_extra: str = (extra_args or "").strip()
        if clean_extra:
            cmd.extend(shlex.split(clean_extra, posix=(os.name != "nt")))
        return cmd
    def _save_session_token(self, token: str) -> None:
        try:
            os.makedirs(os.path.dirname(self.token_cache_path), exist_ok=True)
            with open(self.token_cache_path, "w", encoding="utf-8") as f_tok:
                f_tok.write(token.strip())
        except OSError:
            pass

    def _load_session_token(self) -> str:
        env_tok: str = os.environ.get("WATCH_CLIPBOARD_TOKEN", "").strip()
        if env_tok:
            return env_tok
        try:
            if os.path.isfile(self.token_cache_path):
                with open(self.token_cache_path, "r", encoding="utf-8") as f_tok:
                    return f_tok.read().strip()
        except OSError:
            pass
        return ""

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
        self._save_session_token(api_token)
        cmd: List[str] = self._build_command(target_dir=target_dir, extra_args=extra_args)
        env: Dict[str, str] = {**os.environ, "PYTHONUTF8": "1", "PYTHONIOENCODING": "utf-8"}
        if api_token:
            env["WATCH_CLIPBOARD_TOKEN"] = api_token
        if allowed_origin:
            env["WATCH_CLIPBOARD_ORIGIN"] = allowed_origin
        browser_exe: str = self._detect_browser_executable()
        if browser_exe:
            env["WATCH_CLIPBOARD_BROWSER_EXE"] = browser_exe
        kwargs: Dict[str, Any] = {"cwd": self.work_dir, "env": env, "stdin": subprocess.DEVNULL, "stdout": subprocess.DEVNULL, "stderr": subprocess.DEVNULL, "close_fds": True}
        if os.name == "nt":
            kwargs["creationflags"] = getattr(subprocess, "CREATE_NO_WINDOW", 0x08000000) | getattr(subprocess, "CREATE_NEW_PROCESS_GROUP", 0x00000200)
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
            elif action == "get_token":
                self.send_message({"ok": True, "api_token": self._load_session_token()})
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
