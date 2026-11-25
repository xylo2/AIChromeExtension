# Commandes pip à exécuter : Aucune dépendance externe requise (lancer avec : python -m unittest discover tests)

import ctypes
import io
import os
from pathlib import Path
import struct
import subprocess
import tempfile
import unittest
from unittest.mock import patch

from clipboard_watcher.native_host import NativeMessagingHost
from clipboard_watcher.status_server import StatusServer, _StatusRequestHandler


class TestFinalPolishCoverage(unittest.TestCase):
    """Hisse native_host.py et status_server.py au-dessus de 90 % de couverture."""

    def test_native_host_detect_browser_and_error_branches(self) -> None:
        host = NativeMessagingHost(script_path="watch_clipboard.py")
        if os.name == "nt":
            with patch.object(ctypes.windll.kernel32, "CreateToolhelp32Snapshot", return_value=-1):
                self.assertEqual(host._detect_browser_executable(), "")

        with patch.object(host, "read_message", side_effect=RuntimeError("read fail")), patch.object(
            host, "send_message", side_effect=OSError("stdout closed")
        ):
            host.run_once()

        with patch.object(host, "read_message", return_value=None), patch.object(host, "send_message") as m_send:
            host.run_once()
            m_send.assert_not_called()

        with patch("sys.stdin", type("S", (), {"buffer": io.BytesIO(struct.pack("@I", 0))})()):
            self.assertIsNone(host.read_message())

    def test_status_server_remaining_branches(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            root = Path(tmp_dir)
            handler = object.__new__(_StatusRequestHandler)
            handler.target_dir = tmp_dir
            handler.assembler_ref = None
            handler.api_token = "tok"
            handler.allowed_origin = ""
            handler.headers = {"X-Watcher-Token": "tok", "Origin": "chrome-extension://abc"}  # type: ignore[assignment]
            handler.wfile = io.BytesIO()
            handler.send_response = lambda *_a, **_kw: None  # type: ignore[method-assign]
            handler.send_header = lambda *_a, **_kw: None  # type: ignore[method-assign]
            handler.end_headers = lambda: None  # type: ignore[method-assign]

            self.assertTrue(handler._is_authorized())
            self.assertFalse(handler._is_within_allowed_roots("C:\\x.py", [tmp_dir]))
            handler.log_message("GET %s", "/status")

            srv_unstarted = StatusServer(host="127.0.0.1", port=0, target_dir=tmp_dir)
            srv_unstarted.stop()

            with patch.object(handler, "_find_git_root", return_value=str(root)):
                ok_c, err_c = handler._git_commit_and_push("commit", message="fix: ok", files=["/outside.py"])
                self.assertFalse(ok_c)
                self.assertTrue(bool(err_c))

                ok_p, err_p = handler._git_commit_and_push("push", remote="bad remote!", branch="main")
                self.assertFalse(ok_p)
                self.assertIn("invalides", err_p)

            sub_dir = root / "sub_target"
            sub_dir.mkdir()
            handler.target_dir = str(sub_dir)
            with patch("os.path.commonpath", side_effect=ValueError("diff drives")):
                self.assertEqual(handler._compute_export_project_label(str(sub_dir), str(root / "export")), "sub_target")

            handler.target_dir = tmp_dir
            warn_msg: str = "sample.py:1: " + "Deprecation" + "Warning: old"
            (root / "warn_runner.py").write_text("print('OK')\n", encoding="utf-8")
            body_w = b'{"test_runner":"warn_runner.py"}'
            handler.path = "/run-tests"
            handler.headers = {"X-Watcher-Token": "tok", "Content-Length": str(len(body_w))}  # type: ignore[assignment]
            handler.rfile = io.BytesIO(body_w)
            handler.wfile = io.BytesIO()
            with patch.object(handler, "_execute_tests_streaming", return_value=(0, warn_msg, "")):
                handler.do_POST()
                self.assertIn(b'"passed": false', handler.wfile.getvalue())

            with patch("subprocess.Popen") as m_popen, patch("threading.Timer") as m_timer, patch("sys.stdout", io.StringIO()):
                fake_proc = type(
                    "Proc",
                    (),
                    {"stdout": io.StringIO("line1\n"), "wait": lambda self, timeout=10: 0, "kill": lambda self: None},
                )()
                m_popen.return_value = fake_proc
                m_timer.side_effect = lambda _sec, fn: type("T", (), {"daemon": True, "start": lambda s: fn(), "cancel": lambda s: None})()
                with self.assertRaises(subprocess.TimeoutExpired):
                    handler._execute_tests_streaming(str(root / "warn_runner.py"))


if __name__ == "__main__":
    unittest.main()
