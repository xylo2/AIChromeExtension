# Commandes pip à exécuter : Aucune dépendance externe requise (lancer avec : python -m unittest discover tests)

import ctypes
import io
import os
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

from clipboard_watcher.assembler import FileAssembler
from clipboard_watcher.config import WatcherConfig
from clipboard_watcher.native_host import NativeMessagingHost
from clipboard_watcher.status_server import _StatusRequestHandler
from clipboard_watcher.watcher import ClipboardWatcher


class TestExtraModulesCoverage(unittest.TestCase):
    """Couvre les branches restantes de status_server.py, native_host.py et watcher.py."""

    def test_status_server_remaining_routes_and_helpers(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            root = Path(tmp_dir)
            handler = object.__new__(_StatusRequestHandler)
            handler.target_dir = tmp_dir
            handler.assembler_ref = None
            handler.api_token = ""
            handler.allowed_origin = ""
            handler.headers = {"Origin": "https://example.com"}  # type: ignore[assignment]
            handler.wfile = io.BytesIO()
            handler.send_response = lambda *_a, **_kw: None  # type: ignore[method-assign]
            handler.send_header = lambda *_a, **_kw: None  # type: ignore[method-assign]
            handler.end_headers = lambda: None  # type: ignore[method-assign]

            self.assertEqual(handler._normalize_header_rel_path("sub/a.py", str(root)), "sub/a.py")

            handler.path = "/test-stream?offset=abc"
            handler.wfile = io.BytesIO()
            handler.do_GET()
            self.assertIn(b'"offset":', handler.wfile.getvalue())

            with patch.object(handler, "_find_git_root", return_value=str(root)):
                ok_d, _, err_d = handler._git_diff_selected(["/outside.py"])
                self.assertFalse(ok_d)
                self.assertIn("Aucun fichier valide", err_d)

            self.assertEqual(handler._compute_export_project_label(str(root), str(root / "export")), root.name)
            self.assertIsNone(handler._resolve_test_runner_path(""))

            with patch.object(handler, "_resolve_test_runner_path", return_value=str(root / "missing_run.py")):
                handler.path = "/run-tests-start"
                body = b'{"test_runner":"missing_run.py"}'
                handler.headers = {"Content-Length": str(len(body))}  # type: ignore[assignment]
                handler.rfile = io.BytesIO(body)
                handler.wfile = io.BytesIO()
                handler.do_POST()
                self.assertIn(b"introuvable", handler.wfile.getvalue())

    def test_native_host_and_watcher_remaining_branches(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            root = Path(tmp_dir)
            tools_dir = root / "tools" / "watch_clipboard"
            tools_dir.mkdir(parents=True)
            sc = tools_dir / "watch_clipboard.py"
            sc.write_text("# stub\n", encoding="utf-8")
            host = NativeMessagingHost(script_path=str(sc))
            self.assertEqual(host.work_dir, str(root))

            with patch("os.name", "nt"), patch.object(sys, "_base_executable", "", create=True), patch.object(
                sys, "executable", str(root / "Microsoft" / "WindowsApps" / "python.exe")
            ), patch.dict(os.environ, {"PATH": str(root / "Microsoft" / "WindowsApps"), "LOCALAPPDATA": tmp_dir}):
                with patch("glob.glob", return_value=[]), patch("shutil.which", return_value=None):
                    self.assertTrue(host._resolve_python_executable().endswith("python.exe"))

            with patch("os.name", "nt"), patch.object(host, "_detect_browser_executable", return_value="chrome.exe"), patch(
                "subprocess.Popen", return_value=type("P", (), {"pid": 99})()
            ):
                res = host._start_watcher_process({"target_dir": "."})
                self.assertEqual(res["pid"], 99)

            cfg = WatcherConfig(config_path="missing.ini")
            asm = FileAssembler(base_dir=tmp_dir, config=cfg)
            w = ClipboardWatcher(base_dir=tmp_dir, assembler=asm, config=cfg)
            self.assertTrue(w._is_process_running(""))
            self.assertEqual(w._get_clipboard_text(), "")
            if os.name == "nt":
                with patch.object(ctypes.windll.user32, "GetClipboardSequenceNumber", side_effect=OSError("fail")):
                    self.assertIsNone(w._get_win32_sequence_number())


if __name__ == "__main__":
    unittest.main()
