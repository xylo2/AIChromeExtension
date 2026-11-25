# Commandes pip à exécuter : Aucune dépendance externe requise (bibliothèque standard uniquement)

from pathlib import Path
from typing import List


def register_windows_host(host_name: str, manifest_path: Path) -> None:
    import winreg  # type: ignore[import-not-found]

    browser_keys: List[str] = [
        rf"Software\Google\Chrome\NativeMessagingHosts\{host_name}",
        rf"Software\WOW6432Node\Google\Chrome\NativeMessagingHosts\{host_name}",
        rf"Software\Microsoft\Edge\NativeMessagingHosts\{host_name}",
        rf"Software\WOW6432Node\Microsoft\Edge\NativeMessagingHosts\{host_name}",
        rf"Software\BraveSoftware\Brave-Browser\NativeMessagingHosts\{host_name}",
        rf"Software\Chromium\NativeMessagingHosts\{host_name}",
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


def register_unix_host(host_name: str, manifest_path: Path, system: str) -> None:
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
            dest_file: Path = dest_dir / f"{host_name}.json"
            dest_file.write_text(raw_json, encoding="utf-8")
            print(f"[OK] Manifeste copié : {dest_file}")
