# Installeur de l'hôte Native Messaging pour les navigateurs Chromium.

import glob
import json
import os
import platform
import shutil
import stat
import sys
from pathlib import Path
from typing import Any, Dict, List, Optional

_WATCH_ROOT: str = str(Path(__file__).resolve().parent)
if _WATCH_ROOT not in sys.path:
    sys.path.insert(0, _WATCH_ROOT)

from clipboard_watcher.host_registry import register_unix_host, register_windows_host  # noqa: E402


class NativeHostInstaller:
    """Génère le lanceur natif stdio, le manifeste JSON et enregistre l'hôte."""

    HOST_NAME: str = "com.watch_clipboard.host"

    def __init__(self, extension_id: str) -> None:
        """Initialise les chemins de l'hôte natif pour l'ID d'extension fourni."""
        self.extension_id: str = extension_id.strip()
        self.project_dir: Path = Path(__file__).resolve().parent
        self.native_dir: Path = self.project_dir / ".native_host"
        self.host_script: Path = self.project_dir / "clipboard_watcher" / "native_host.py"

    @staticmethod
    def _is_windowsapps_path(exe_path: str) -> bool:
        """Détecte les alias Python du Microsoft Store incompatibles avec stdio."""
        return "microsoft\\windowsapps" in os.path.normcase(os.path.normpath(exe_path))

    @classmethod
    def find_real_windows_python(cls, current_exe: str, project_dir: Optional[Path] = None) -> str:
        """Résout un exécutable python.exe réel en évitant les alias WindowsApps."""
        search_dirs: List[Path] = (
            [project_dir / ".venv", project_dir.parent / ".venv", project_dir.parent.parent / ".venv"]
            if project_dir is not None else []
        )
        for venv_dir in search_dirs:
            venv_py: Path = venv_dir / "Scripts" / "python.exe"
            if venv_py.is_file():
                return str(venv_py.resolve())
        base_exe: str = getattr(sys, "_base_executable", "") or ""
        for raw in ([base_exe, current_exe] if base_exe else [current_exe]):
            if not raw:
                continue
            resolved: str = os.path.realpath(raw) if os.path.exists(raw) else raw
            if os.path.basename(resolved).lower() == "pythonw.exe":
                resolved = os.path.join(os.path.dirname(resolved), "python.exe")
            if not cls._is_windowsapps_path(resolved) and os.path.isfile(resolved):
                return resolved
        for entry in os.environ.get("PATH", "").split(os.pathsep):
            clean_dir: str = entry.strip().strip('"')
            if clean_dir and "windowsapps" not in clean_dir.lower() and (Path(clean_dir) / "python.exe").is_file():
                return str(Path(clean_dir) / "python.exe")
        local_app, prog_files = os.environ.get("LOCALAPPDATA", ""), os.environ.get("ProgramFiles", r"C:\Program Files")
        for pat in (os.path.join(local_app, "Programs", "Python", "Python*", "python.exe"), os.path.join(prog_files, "Python*", "python.exe"), r"C:\Python*\python.exe"):
            for match in sorted(glob.glob(pat), reverse=True):
                if os.path.isfile(match):
                    return match
        return shutil.which("python.exe") or shutil.which("python") or str(Path(current_exe))
    def _resolve_console_python(self) -> str:
        """Retourne le chemin vers l'interpréteur Python console adapté au système."""
        return self.find_real_windows_python(sys.executable, project_dir=self.project_dir) if os.name == "nt" else str(Path(sys.executable))

    def _create_wrapper(self) -> Path:
        """Génère le script lanceur (.bat ou .sh) définissant PYTHONPATH."""
        self.native_dir.mkdir(parents=True, exist_ok=True)
        py_exe: str = self._resolve_console_python()
        host_py: str = str(self.host_script.resolve())
        pkg_root: str = str(self.project_dir.resolve())
        print(f"[INFO] Exécutable Python stdio résolu : {py_exe}")
        if os.name == "nt":
            wrapper_path: Path = self.native_dir / "watch_clipboard_host.bat"
            cmd_line: str = f'python -B "{host_py}" %*' if self._is_windowsapps_path(py_exe) else f'"{py_exe}" -B "{host_py}" %*'
            wrapper_path.write_text(f'@echo off\r\nset "PYTHONPATH={pkg_root}"\r\n{cmd_line}\r\n', encoding="utf-8")
            return wrapper_path
        wrapper_path = self.native_dir / "watch_clipboard_host.sh"
        wrapper_path.write_text(f'#!/usr/bin/env bash\nexport PYTHONPATH="{pkg_root}"\nexec "{py_exe}" -B "{host_py}" "$@"\n', encoding="utf-8")
        wrapper_path.chmod(wrapper_path.stat().st_mode | stat.S_IXUSR | stat.S_IXGRP | stat.S_IXOTH)
        return wrapper_path

    def _write_manifest(self, wrapper_path: Path) -> Path:
        """Écrit le manifeste JSON Native Messaging autorisant l'extension."""
        manifest: Dict[str, Any] = {
            "name": self.HOST_NAME,
            "description": "Lanceur natif pour watch_clipboard",
            "path": str(wrapper_path.resolve()),
            "type": "stdio",
            "allowed_origins": [f"chrome-extension://{self.extension_id}/"],
        }
        manifest_path: Path = self.native_dir / f"{self.HOST_NAME}.json"
        manifest_path.write_text(json.dumps(manifest, indent=2), encoding="utf-8")
        return manifest_path

    def _install_windows(self, manifest_path: Path) -> None:
        """Enregistre le manifeste dans le registre Windows."""
        register_windows_host(self.HOST_NAME, manifest_path)

    def _install_unix(self, manifest_path: Path, system: str) -> None:
        """Copie le manifeste dans les dossiers NativeMessagingHosts Unix."""
        register_unix_host(self.HOST_NAME, manifest_path, system)

    def install(self) -> None:
        """Exécute la création du lanceur, du manifeste et l'enregistrement système."""
        if not self.host_script.is_file():
            print(f"[ERREUR] Script hôte introuvable : {self.host_script}")
            sys.exit(1)
        manifest_path: Path = self._write_manifest(self._create_wrapper())
        system: str = platform.system()
        self._install_windows(manifest_path) if system == "Windows" else self._install_unix(manifest_path, system)


def main() -> None:
    """Point d'entrée CLI récupérant l'identifiant d'extension Chrome."""
    args_iter = iter(sys.argv)
    next(args_iter, None)
    ext_id: str = next(args_iter, "")
    if not ext_id:
        print("Usage : python install_native_host.py <ID_EXTENSION_CHROME>")
        sys.exit(1)
    NativeHostInstaller(extension_id=ext_id).install()


if __name__ == "__main__":
    main()
