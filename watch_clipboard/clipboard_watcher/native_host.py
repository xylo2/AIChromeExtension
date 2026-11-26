# Hôte Native Messaging stdio pilotant watch_clipboard depuis l'extension navigateur.

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
    """Hôte Native Messaging stdio : démarrage du watcher, dossiers et jeton API."""

    BROWSER_EXECUTABLES: tuple[str, ...] = (
        "chrome.exe", "msedge.exe", "brave.exe", "opera.exe", "vivaldi.exe", "chromium.exe",
    )
    IGNORED_FOLDERS: set[str] = {
        ".git", ".venv", "venv", "env", "__pycache__", "node_modules",
        ".watch_clipboard", ".native_host", ".idea", ".vscode", "build", "dist",
    }

    def __init__(self, script_path: Optional[str] = None) -> None:
        """Initialise les chemins du script watch_clipboard et du cache de jeton."""
        if script_path is None:
            watcher_dir: str = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
            script_path = os.path.join(watcher_dir, "watch_clipboard.py")
        self.script_path: str = os.path.abspath(script_path)
        self.work_dir: str = self._resolve_work_dir()
        self.token_cache_path: str = os.path.join(os.path.dirname(self.script_path), ".native_host", "session_token.txt")

    def _resolve_work_dir(self) -> str:
        """Détermine la racine du workspace parent contenant le dossier tools."""
        watch_clip_dir: str = os.path.dirname(self.script_path)
        parent_dir: str = os.path.dirname(watch_clip_dir)
        return os.path.dirname(parent_dir) if os.path.basename(parent_dir).lower() == "tools" else parent_dir

    @staticmethod
    def _is_bare_windowsapps_alias(exe_path: str) -> bool:
        """Délègue la détection des alias Python WindowsApps."""
        return is_bare_windowsapps_alias(exe_path)

    def _resolve_python_executable(self) -> str:
        """Résout l'exécutable Python console utilisé pour lancer watch_clipboard."""
        return resolve_python_executable()

    def _detect_browser_executable(self) -> str:
        """Identifie le nom de l'exécutable du navigateur parent."""
        return detect_parent_browser_executable(self.BROWSER_EXECUTABLES)

    def _build_command(self, target_dir: str = ".", extra_args: str = "") -> List[str]:
        """Construit la ligne de commande complète pour démarrer watch_clipboard.py."""
        clean_target: str = (target_dir or ".").strip().rstrip("\\/") or "."
        cmd: List[str] = [self._resolve_python_executable(), "-B", self.script_path, clean_target]
        clean_extra: str = (extra_args or "").strip()
        if clean_extra:
            cmd.extend(shlex.split(clean_extra, posix=(os.name != "nt")))
        return cmd
    def list_workspace_folders(self, root_dir: str = "") -> Dict[str, Any]:
        """Retourne les sous-dossiers non ignorés présents sous root_dir."""
        clean_root: str = (root_dir or "").strip() or self.work_dir
        resolved_root: str = os.path.realpath(clean_root)
        if not os.path.isdir(resolved_root):
            return {"ok": False, "folders": [], "error": f"Dossier introuvable : {resolved_root}"}
        try:
            folders: List[str] = sorted(
                (
                    name for name in os.listdir(resolved_root)
                    if name not in self.IGNORED_FOLDERS
                    and not name.startswith(".")
                    and not name.endswith(".egg-info")
                    and os.path.isdir(os.path.join(resolved_root, name))
                ),
                key=str.lower,
            )
            return {"ok": True, "root_dir": resolved_root, "folders": folders}
        except OSError as exc:
            return {"ok": False, "folders": [], "error": str(exc)}

    def _save_session_token(self, token: str) -> None:
        """Persiste le jeton d'authentification HTTP dans .native_host/session_token.txt."""
        try:
            os.makedirs(os.path.dirname(self.token_cache_path), exist_ok=True)
            with open(self.token_cache_path, "w", encoding="utf-8") as f_tok:
                f_tok.write(token.strip())
        except OSError:
            pass

    def _load_session_token(self) -> str:
        """Charge le jeton API depuis l'environnement ou le fichier de cache local."""
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
        """Lit un message JSON préfixé par sa longueur sur 4 octets depuis stdin."""
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
        """Sérialise et écrit une réponse JSON encadrée par sa taille sur stdout."""
        encoded: bytes = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        sys.stdout.buffer.write(struct.pack("@I", len(encoded)))
        sys.stdout.buffer.write(encoded)
        sys.stdout.buffer.flush()

    def _start_watcher_process(self, message: Dict[str, Any]) -> Dict[str, Any]:
        """Démarre watch_clipboard.py en processus détaché avec les paramètres reçus."""
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
        """Traite une requête Native Messaging unique puis rend la main."""
        try:
            msg: Optional[Dict[str, Any]] = self.read_message()
            if not msg:
                return
            action: str = str(msg.get("action", "")).strip()
            if action == "ping":
                self.send_message({"ok": True, "service": "watch_clipboard_host"})
            elif action == "get_token":
                self.send_message({"ok": True, "api_token": self._load_session_token()})
            elif action == "list_folders":
                self.send_message(self.list_workspace_folders(str(msg.get("root_dir", ""))))
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
    """Point d'entrée exécutant un cycle d'échange Native Messaging."""
    NativeMessagingHost().run_once()


if __name__ == "__main__":
    main()
