# Commandes pip à exécuter : Aucune dépendance externe requise (bibliothèque standard uniquement)

import ctypes
from ctypes import wintypes
import json
import os
import shlex
import struct
import subprocess
import sys
from typing import Any, Dict, List


class NativeMessagingHost:
    """
    Reçoit les commandes JSON de Chrome via stdin, lance watch_clipboard en arrière-plan
    depuis le répertoire racine du workspace, et renvoie la réponse sur stdout.
    """

    def __init__(self, script_path: str) -> None:
        """
        Initialise l'hôte avec le chemin absolu vers watch_clipboard.py et sa racine de travail.

        :param script_path: Chemin complet du point d'entrée watch_clipboard.py.
        """
        self.script_path: str = os.path.abspath(script_path)
        watch_dir: str = os.path.dirname(self.script_path)
        parent_dir: str = os.path.dirname(watch_dir)
        if os.path.basename(parent_dir).lower() == "tools":
            self.work_dir: str = os.path.dirname(parent_dir) or parent_dir
        else:
            self.work_dir = parent_dir or watch_dir

    def _detect_browser_executable(self) -> str:
        """
        Identifie le nom de l'exécutable du navigateur parent (ex: chrome.exe, msedge.exe).

        :return: Nom de l'exécutable du navigateur ou chaîne vide si non déterminé.
        """
        if os.name != "nt":
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

        try:
            kernel32 = ctypes.windll.kernel32
            snap = kernel32.CreateToolhelp32Snapshot(0x00000002, 0)
            if snap == wintypes.HANDLE(-1).value:
                return ""

            try:
                proc_map: Dict[int, tuple[int, str]] = {}
                entry = PROCESSENTRY32W()
                entry.dwSize = ctypes.sizeof(PROCESSENTRY32W)
                if kernel32.Process32FirstW(snap, ctypes.byref(entry)):
                    while True:
                        proc_map[int(entry.th32ProcessID)] = (
                            int(entry.th32ParentProcessID),
                            str(entry.szExeFile),
                        )
                        if not kernel32.Process32NextW(snap, ctypes.byref(entry)):
                            break

                curr_pid: int = os.getpid()
                for _ in range(12):
                    parent_info = proc_map.get(curr_pid)
                    if not parent_info:
                        break
                    parent_pid, parent_exe = parent_info
                    low_exe: str = parent_exe.lower()
                    if any(b in low_exe for b in ("chrome", "msedge", "brave", "chromium")):
                        return parent_exe
                    if parent_pid == curr_pid:
                        break
                    curr_pid = parent_pid
            finally:
                kernel32.CloseHandle(snap)
        except Exception:
            pass
        return ""

    def read_message(self) -> Dict[str, Any]:
        """
        Lit un message préfixé par sa longueur sur 4 octets depuis stdin.

        :return: Dictionnaire JSON décodé.
        """
        raw_length: bytes = sys.stdin.buffer.read(4)
        if len(raw_length) < 4:
            return {}
        message_length: int = next(iter(struct.unpack("@I", raw_length)), 0)
        raw_data: bytes = sys.stdin.buffer.read(message_length)
        return json.loads(raw_data.decode("utf-8"))

    def send_message(self, payload: Dict[str, Any]) -> None:
        """
        Encode et écrit une réponse JSON sur stdout selon le protocole Native Messaging.

        :param payload: Dictionnaire à transmettre à l'extension Chrome.
        """
        encoded: bytes = json.dumps(payload).encode("utf-8")
        sys.stdout.buffer.write(struct.pack("@I", len(encoded)))
        sys.stdout.buffer.write(encoded)
        sys.stdout.buffer.flush()
    def _build_command(self, target_dir: str, extra_args: str) -> List[str]:
        """
        Construit la liste des arguments CLI pour démarrer watch_clipboard.py.

        :param target_dir: Dossier cible passé en premier argument (ex: Médical).
        :param extra_args: Options supplémentaires éventuelles.
        :return: Liste complète des arguments de commande.
        """
        cmd: List[str] = [sys.executable, self.script_path]
        clean_target: str = target_dir.strip().rstrip("\\/") or "."
        cmd.append(clean_target)
        clean_extra: str = extra_args.strip()
        if clean_extra:
            cmd.extend(shlex.split(clean_extra, posix=(os.name != "nt")))
        return cmd

    def start_watcher(
        self,
        target_dir: str = ".",
        extra_args: str = "",
        api_token: str = "",
        allowed_origin: str = "",
    ) -> Dict[str, Any]:
        """
        Démarre watch_clipboard.py dans un processus détaché depuis self.work_dir.

        :param target_dir: Dossier de destination relatif ou absolu.
        :param extra_args: Arguments supplémentaires éventuels.
        :param api_token: Jeton d'authentification transmis par variable d'environnement.
        :param allowed_origin: Origine de l'extension Chrome autorisée pour CORS.
        :return: Statut du démarrage et PID du processus créé.
        """
        if not os.path.isfile(self.script_path):
            return {"ok": False, "error": f"Script introuvable : {self.script_path}"}

        cmd: List[str] = self._build_command(target_dir, extra_args)
        child_env: Dict[str, str] = os.environ.copy()
        browser_exe: str = self._detect_browser_executable()
        if browser_exe:
            child_env["WATCH_CLIPBOARD_BROWSER_EXE"] = browser_exe
        if api_token:
            child_env["WATCH_CLIPBOARD_TOKEN"] = api_token
        if allowed_origin:
            child_env["WATCH_CLIPBOARD_ORIGIN"] = allowed_origin

        try:
            if os.name == "nt":
                creation_flags: int = (
                    subprocess.DETACHED_PROCESS | subprocess.CREATE_NEW_PROCESS_GROUP
                )
                proc = subprocess.Popen(
                    cmd,
                    cwd=self.work_dir,
                    env=child_env,
                    stdin=subprocess.DEVNULL,
                    stdout=subprocess.DEVNULL,
                    stderr=subprocess.DEVNULL,
                    creationflags=creation_flags,
                    close_fds=True,
                )
            else:
                proc = subprocess.Popen(
                    cmd,
                    cwd=self.work_dir,
                    env=child_env,
                    stdin=subprocess.DEVNULL,
                    stdout=subprocess.DEVNULL,
                    stderr=subprocess.DEVNULL,
                    start_new_session=True,
                    close_fds=True,
                )
            return {
                "ok": True,
                "pid": proc.pid,
                "cwd": self.work_dir,
                "command": " ".join(cmd),
            }
        except Exception as exc:
            return {"ok": False, "error": str(exc)}

    def handle_once(self) -> None:
        """
        Traite une requête unique envoyée par l'extension puis quitte.
        """
        msg: Dict[str, Any] = self.read_message()
        action: str = str(msg.get("action", ""))
        if action == "start":
            target_dir: str = str(msg.get("target_dir", "."))
            extra_args: str = str(msg.get("extra_args", ""))
            api_token: str = str(msg.get("api_token", ""))
            allowed_origin: str = str(msg.get("allowed_origin", ""))
            self.send_message(
                self.start_watcher(
                    target_dir=target_dir,
                    extra_args=extra_args,
                    api_token=api_token,
                    allowed_origin=allowed_origin,
                )
            )
        else:
            self.send_message({"ok": False, "error": f"Action inconnue : {action}"})


def main() -> None:
    """
    Point d'entrée exécuté directement par Google Chrome.
    """
    base_dir: str = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    watcher_script: str = os.path.join(base_dir, "watch_clipboard.py")
    host: NativeMessagingHost = NativeMessagingHost(script_path=watcher_script)
    host.handle_once()


if __name__ == "__main__":
    main()
