# Commandes pip à exécuter : Aucune dépendance externe requise (lancer avec : python -m unittest discover tests)

import os
import tempfile
import unittest
from unittest.mock import MagicMock, patch
from clipboard_watcher.assembler import FileAssembler
from clipboard_watcher.config import WatcherConfig
from clipboard_watcher.watcher import ClipboardWatcher


class TestClipboardWatcher(unittest.TestCase):
    """
    Tests unitaires vérifiant l'arrêt automatique lors de la fermeture du navigateur,
    la lecture résiliente du presse-papiers et la gestion des erreurs TclError.
    """

    def test_auto_exit_on_browser_close_logic(self) -> None:
        """
        Vérifie que _should_exit_with_browser retourne True lorsque le processus navigateur
        disparaît et False s'il est encore actif ou lancé hors navigateur.
        """
        with tempfile.TemporaryDirectory() as tmp_dir:
            cfg = WatcherConfig(config_path="non_existent.ini")
            cfg.auto_exit_on_browser_close = True
            assembler = FileAssembler(base_dir=tmp_dir, config=cfg)

            # 1. Lancé manuellement (sans WATCH_CLIPBOARD_BROWSER_EXE) -> ne quitte jamais
            with patch.dict(os.environ, {"WATCH_CLIPBOARD_BROWSER_EXE": ""}):
                watcher_cli = ClipboardWatcher(base_dir=tmp_dir, assembler=assembler, config=cfg)
                self.assertFalse(watcher_cli._should_exit_with_browser())

            # 2. Lancé par Chrome -> quitte uniquement quand chrome.exe n'est plus actif
            with patch.dict(os.environ, {"WATCH_CLIPBOARD_BROWSER_EXE": "chrome.exe"}):
                watcher_browser = ClipboardWatcher(base_dir=tmp_dir, assembler=assembler, config=cfg)
                with patch.object(watcher_browser, "_is_process_running", return_value=True):
                    self.assertFalse(watcher_browser._should_exit_with_browser())

                watcher_browser._last_browser_check = 0.0
                with patch.object(watcher_browser, "_is_process_running", return_value=False):
                    self.assertTrue(watcher_browser._should_exit_with_browser())

    def test_get_clipboard_text_handles_empty_selection_and_retries(self) -> None:
        """
        Vérifie que _get_clipboard_text retourne '' si le presse-papiers ne contient pas de texte
        et réessaie brièvement en cas de verrouillage temporaire.
        """
        import tkinter as tk

        with tempfile.TemporaryDirectory() as tmp_dir:
            cfg = WatcherConfig(config_path="non_existent.ini")
            assembler = FileAssembler(base_dir=tmp_dir, config=cfg)
            watcher = ClipboardWatcher(base_dir=tmp_dir, assembler=assembler, config=cfg)

            mock_root = MagicMock()
            watcher._root = mock_root

            # Cas 1 : Sélection vide / contenu image -> retourne "" immédiatement
            mock_root.clipboard_get.side_effect = tk.TclError("CLIPBOARD selection doesn't exist")
            self.assertEqual(watcher._get_clipboard_text(retries=3), "")
            self.assertEqual(mock_root.clipboard_get.call_count, 1)

            # Cas 2 : Verrouillage temporaire puis succès au 2e essai
            mock_root.clipboard_get.reset_mock()
            mock_root.clipboard_get.side_effect = [
                tk.TclError("Unable to open clipboard"),
                "=== FILE: a.py ===\nx = 1",
            ]
            result = watcher._get_clipboard_text(retries=3)
            self.assertEqual(result, "=== FILE: a.py ===\nx = 1")
            self.assertEqual(mock_root.clipboard_get.call_count, 2)


if __name__ == "__main__":
    unittest.main()
