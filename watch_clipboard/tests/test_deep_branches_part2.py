# Commandes pip à exécuter : Aucune dépendance externe requise (lancer avec : python -m unittest discover tests)

import io
import os
from pathlib import Path
import struct
import sys
import tempfile
import unittest
from unittest.mock import patch

from clipboard_watcher.native_host import NativeMessagingHost
from clipboard_watcher.status_server import _QuietThreadingHTTPServer, _StatusRequestHandler
from install_native_host import NativeHostInstaller


class TestDeepBranchesPart2(unittest.TestCase):
    """Couvre les branches restantes de resolve_test_runner_path, send_json, native_host et installer."""

    def test_status_server_runner_resolution_and_socket_errors(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            root = Path(tmp_dir)
            child = root / "child"
            child.mkdir()
            parent_runner = root / "custom_parent.py"
            parent_runner.write_text("print('ok')\n", encoding="utf-8")

            handler = object.__new__(_StatusRequestHandler)
            handler.target_dir = str(child)
            handler.assembler_ref = None
            handler.api_token = ""
            handler.allowed_origin = ""
            handler.headers = {"Origin": "chrome-extension://abc"}  # type: ignore[assignment]

            self.assertEqual(handler._resolve_test_runner_path("custom_parent.py"), str(parent_runner.resolve()))
            self.assertIsNone(handler._resolve_test_runner_path("missing_custom.py"))
            self.assertIsNone(handler._resolve_test_runner_path("../outside.py"))

            class _BrokenWfile:
                def write(self, _data: bytes) -> int:
                    raise BrokenPipeError("broken")

            handler.wfile = _BrokenWfile()  # type: ignore[assignment]
            handler.send_response = lambda *_a, **_kw: None  # type: ignore[method-assign]
            handler.send_header = lambda *_a, **_kw: None  # type: ignore[method-assign]
            handler.end_headers = lambda: None  # type: ignore[method-assign]
            handler._send_json(200, {"ok": True})
            handler.do_OPTIONS()

            q_srv = object.__new__(_QuietThreadingHTTPServer)
            with patch("http.server.ThreadingHTTPServer.handle_error") as m_super_err:
                try:
                    raise BrokenPipeError("client disconnect")
                except BrokenPipeError:
                    q_srv.handle_error(None, ("127.0.0.1", 9999))
                m_super_err.assert_not_called()

                try:
                    raise ValueError("other error")
                except ValueError:
                    q_srv.handle_error(None, ("127.0.0.1", 9999))
                m_super_err.assert_called_once()
    def test_native_host_and_installer_lookup_paths(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            root = Path(tmp_dir)
            script_p = root / "watch_clipboard.py"
            script_p.write_text("# stub\n", encoding="utf-8")
            host = NativeMessagingHost(script_path=str(script_p))

            bin_dir = root / "bin"
            bin_dir.mkdir()
            py_in_path = bin_dir / "python.exe"
            py_in_path.write_text("py", encoding="utf-8")

            with patch("os.name", "nt"), patch.object(sys, "_base_executable", "", create=True), patch.object(
                sys, "executable", str(root / "Microsoft" / "WindowsApps" / "python.exe")
            ), patch.dict(os.environ, {"PATH": str(bin_dir), "LOCALAPPDATA": tmp_dir}):
                self.assertEqual(host._resolve_python_executable(), str(py_in_path))
                self.assertEqual(NativeHostInstaller.find_real_windows_python("unused"), str(py_in_path))

            with patch.object(host, "read_message", side_effect=RuntimeError("stdin broken")), patch.object(
                host, "send_message"
            ) as m_send:
                host.run_once()
                self.assertFalse(m_send.call_args[0][0]["ok"])

            bad_json = struct.pack("@I", 4) + b"[12]"
            with patch("sys.stdin", type("S", (), {"buffer": io.BytesIO(bad_json)})()):
                self.assertIsNone(host.read_message())


if __name__ == "__main__":
    unittest.main()
