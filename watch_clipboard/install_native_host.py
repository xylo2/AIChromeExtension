# Commandes pip à exécuter : Aucune dépendance externe requise (bibliothèque standard uniquement)

import json
import os
import platform
import stat
import sys
from pathlib import Path
from typing import Dict, Any, List


class NativeHostInstaller:
    """
    Génère le lanceur natif silencieux, le manifeste JSON et enregistre l'hôte auprès des
    navigateurs Chromium (Chrome, Edge, Brave) sur Windows, Linux et macOS.
    """

    HOST_NAME: str = "com.watch_clipboard.host"

    def __init__(self, extension_id: str) -> None:
        self.extension_id: str = extension_id.strip()
        self.project_dir: Path = Path(__file__).resolve().parent
        self.native_dir: Path = self.project_dir / ".native_host"
        self.host_script: Path = self.project_dir / "clipboard_watcher" / "native_host.py"

    def _resolve_silent_python(self) -> str:
        py_path: Path = Path(sys.executable).resolve()
        if os.name == "nt" and py_path.name.lower() == "python.exe":
            pyw_path: Path = py_path.with_name("pythonw.exe")
            if pyw_path.is_file():
                return str(pyw_path)
        return str(py_path)

    def _create_wrapper(self) -> Path:
        self.native_dir.mkdir(parents=True, exist_ok=True)
        py_exe: str = self._resolve_silent_python()
        host_py: str = str(self.host_script.resolve())

        if os.name == "nt":
            wrapper_path: Path = self.native_dir / "watch_clipboard_host.bat"
            content: str = f'@echo off\r\n"{py_exe}" "{host_py}" %*\r\n'
            wrapper_path.write_text(content, encoding="utf-8")
            return wrapper_path

        wrapper_path = self.native_dir / "watch_clipboard_host.sh"
        content = f'#!/usr/bin/env bash\nexec "{py_exe}" "{host_py}" "$@"\n'
        wrapper_path.write_text(content, encoding="utf-8")
        current_mode: int = wrapper_path.stat().st_mode
        wrapper_path.chmod(current_mode | stat.S_IXUSR | stat.S_IXGRP | stat.S_IXOTH)
        return wrapper_path

    def _write_manifest(self, wrapper_path: Path) -> Path:
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
        import winreg  # type: ignore[import-not-found]

        browser_keys: List[str] = [
            rf"Software\Google\Chrome\NativeMessagingHosts\{self.HOST_NAME}",
            rf"Software\WOW6432Node\Google\Chrome\NativeMessagingHosts\{self.HOST_NAME}",
            rf"Software\Microsoft\Edge\NativeMessagingHosts\{self.HOST_NAME}",
            rf"Software\WOW6432Node\Microsoft\Edge\NativeMessagingHosts\{self.HOST_NAME}",
            rf"Software\BraveSoftware\Brave-Browser\NativeMessagingHosts\{self.HOST_NAME}",
            rf"Software\Chromium\NativeMessagingHosts\{self.HOST_NAME}",
        ]
        manifest_str: str = str(manifest_path.resolve())
        views: List[int] = [winreg.KEY_WRITE | winreg.KEY_WOW64_64KEY, winreg.KEY_WRITE | winreg.KEY_WOW64_32KEY]

        for reg_path in browser_keys:
            for access_mask in views:
                try:
                    with winreg.CreateKeyEx(winreg.HKEY_CURRENT_USER, reg_path, 0, access_mask) as key:
                        winreg.SetValueEx(key, "", 0, winreg.REG_SZ, manifest_str)
                except OSError:
                    pass
            print(f"[OK] HKCU\\{reg_path} -> {manifest_str}")

            try:
                with winreg.CreateKeyEx(
                    winreg.HKEY_LOCAL_MACHINE, reg_path, 0, winreg.KEY_WRITE | winreg.KEY_WOW64_64KEY
                ) as key:
                    winreg.SetValueEx(key, "", 0, winreg.REG_SZ, manifest_str)
                print(f"[OK] HKLM\\{reg_path} -> {manifest_str}")
            except PermissionError:
                pass

    def _install_unix(self, manifest_path: Path, system: str) -> None:
        targets: List[Path] = (
            [
                Path.home() / "Library/Application Support/Google/Chrome/NativeMessagingHosts",
                Path.home() / "Library/Application Support/Microsoft Edge/NativeMessagingHosts",
                Path.home() / "Library/Application Support/BraveSoftware/Brave-Browser/NativeMessagingHosts",
            ]
            if system == "Darwin"
            else [
                Path.home() / ".config/google-chrome/NativeMessagingHosts",
                Path.home() / ".config/microsoft-edge/NativeMessagingHosts",
                Path.home() / ".config/BraveSoftware/Brave-Browser/NativeMessagingHosts",
                Path.home() / ".config/chromium/NativeMessagingHosts",
            ]
        )
        raw_json: str = manifest_path.read_text(encoding="utf-8")
        for dest_dir in targets:
            if dest_dir.parent.exists():
                dest_dir.mkdir(parents=True, exist_ok=True)
                dest_file: Path = dest_dir / f"{self.HOST_NAME}.json"
                dest_file.write_text(raw_json, encoding="utf-8")
                print(f"[OK] Manifeste copié : {dest_file}")

    def install(self) -> None:
        if not self.host_script.is_file():
            print(f"[ERREUR] Script hôte introuvable : {self.host_script}")
            sys.exit(1)
        wrapper: Path = self._create_wrapper()
        manifest_path: Path = self._write_manifest(wrapper)
        system: str = platform.system()
        if system == "Windows":
            self._install_windows(manifest_path)
        else:
            self._install_unix(manifest_path, system)


def main() -> None:
    args_iter = iter(sys.argv)
    next(args_iter, None)
    ext_id: str = next(args_iter, "")
    if not ext_id:
        print("Usage : python install_native_host.py <ID_EXTENSION_CHROME>")
        sys.exit(1)
    NativeHostInstaller(extension_id=ext_id).install()


if __name__ == "__main__":
    main()