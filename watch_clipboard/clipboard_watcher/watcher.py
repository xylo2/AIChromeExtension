# Surveillance continue du presse-papiers système sans verrouillage.

import ctypes
import os
import time
import tkinter as tk
from typing import Optional
from clipboard_watcher.assembler import FileAssembler
from clipboard_watcher.browser_monitor import is_process_running
from clipboard_watcher.config import WatcherConfig


class ClipboardWatcher:
    """Surveille le presse-papiers et s'arrête si le navigateur parent ferme."""

    STARTUP_GRACE_SECONDS: float = 8.0

    def __init__(self, base_dir: str, assembler: FileAssembler, config: WatcherConfig) -> None:
        """Initialise l'état de scrutation et la détection du navigateur parent."""
        self.base_dir: str = base_dir
        self.assembler: FileAssembler = assembler
        self.config: WatcherConfig = config
        self._root: Optional[tk.Tk] = None
        self._last_seq_num: Optional[int] = None
        self._browser_exe: str = os.environ.get("WATCH_CLIPBOARD_BROWSER_EXE", "").strip()
        self._started_at: float = time.monotonic()
        self._last_browser_check: float = self._started_at

    def _is_process_running(self, process_name: str) -> bool:
        """Délègue la vérification d'activité du processus navigateur."""
        return is_process_running(process_name)

    def _should_exit_with_browser(self) -> bool:
        """Indique si le watcher doit s'arrêter après fermeture du navigateur."""
        if not self.config.auto_exit_on_browser_close or not self._browser_exe:
            return False
        now: float = time.monotonic()
        if now - self._started_at < self.STARTUP_GRACE_SECONDS or now - self._last_browser_check < 2.0:
            return False
        self._last_browser_check = now
        return not self._is_process_running(self._browser_exe)

    def _get_win32_sequence_number(self) -> Optional[int]:
        """Lit le compteur de séquence du presse-papiers Windows sans l'ouvrir."""
        if os.name != "nt":
            return None
        try:
            return int(ctypes.windll.user32.GetClipboardSequenceNumber())
        except Exception:
            return None

    def _get_clipboard_text(self, retries: int = 3) -> Optional[str]:
        """Lit le contenu texte du presse-papiers avec tentatives en cas de contention."""
        if self._root is None:
            return ""
        for attempt in range(retries):
            try:
                return self._root.clipboard_get()
            except tk.TclError as exc:
                err_msg: str = str(exc).lower()
                if "doesn't exist" in err_msg or "selection" in err_msg:
                    return ""
                if attempt < retries - 1:
                    time.sleep(0.015)
        return None
    def _clear_clipboard_once(self) -> None:
        """Vide le presse-papiers au démarrage pour éviter de retraiter un ancien bloc."""
        if os.name == "nt":
            try:
                user32 = ctypes.windll.user32
                if user32.OpenClipboard(0):
                    user32.EmptyClipboard()
                    user32.CloseClipboard()
                    return
            except Exception:
                pass
        if self._root is not None:
            try:
                self._root.clipboard_clear()
                self._root.update()
            except tk.TclError:
                pass

    def start(self) -> None:
        """Lance la boucle principale de surveillance et d'assemblage des fichiers."""
        os.makedirs(self.base_dir, exist_ok=True)
        os.makedirs(self.assembler.temp_dir, exist_ok=True)
        self._root = tk.Tk()
        self._root.withdraw()
        initial_text: str = self._get_clipboard_text() or ""
        last_seen: str = initial_text
        if initial_text and self.assembler.has_file_tags(initial_text) and self.config.clear_on_startup:
            self._clear_clipboard_once()
            last_seen = ""
        self._last_seq_num = self._get_win32_sequence_number()
        self._started_at = self._last_browser_check = time.monotonic()
        print(f"Écoute activée (dossier parent : '{os.path.abspath(self.base_dir)}')...", flush=True)
        print(f"Cache miroir : '{os.path.abspath(self.assembler.temp_dir)}'", flush=True)
        try:
            while True:
                if self._should_exit_with_browser():
                    print(f"\nNavigateur ({self._browser_exe}) fermé : arrêt automatique de watch_clipboard.")
                    break
                seq_num: Optional[int] = self._get_win32_sequence_number()
                if seq_num is not None and seq_num == self._last_seq_num:
                    time.sleep(self.config.poll_interval)
                    continue
                current: Optional[str] = self._get_clipboard_text()
                if current is not None:
                    if seq_num is not None:
                        self._last_seq_num = seq_num
                    if current and current != last_seen:
                        last_seen = current
                        if self.assembler.process_text(current) > 0:
                            print("--> Bloc(s) traité(s).\n", flush=True)
                time.sleep(self.config.poll_interval)
        except KeyboardInterrupt:
            print("\nArrêt de l'écoute.")
        finally:
            if self._root is not None:
                self._root.destroy()
