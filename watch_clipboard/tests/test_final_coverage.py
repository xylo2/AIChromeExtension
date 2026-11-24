# Commandes pip à exécuter : Aucune dépendance externe requise (lancer avec : python -m unittest discover tests)

import importlib.util
import io
import json
import os
from pathlib import Path
import struct
import sys
import tempfile
import types
import unittest
from unittest.mock import MagicMock, patch

from clipboard_watcher.assembler import FileAssembler
from clipboard_watcher.config import WatcherConfig
from clipboard_watcher.native_host import NativeMessagingHost
import clipboard_watcher.native_host as native_host_mod
from clipboard_watcher.status_server import StatusServer, _QuietThreadingHTTPServer, _StatusRequestHandler
from clipboard_watcher.watcher import ClipboardWatcher
from install_native_host import NativeHostInstaller
import tools.fix_urls as fix_urls_mod
import watch_clipboard as watch_cli_mod


class TestFinalCoverage(unittest.TestCase):
    """Couvre les dernières branches de fix_urls, install_native_host, native_host, status_server, watcher et watch_clipboard."""

    def test_fix_urls_and_watch_clipboard_cli_branches(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            root = Path(tmp_dir)
            (root / "binary.py").write_bytes(b"\xff\xfe\xfd")
            (root / "skip.bin").write_text("ignored", encoding="utf-8")
            bad_js = root / "web.js"
            bad_js.write_text('const u = "' + "https" + "://www." + "github" + '.com";\n', encoding="utf-8")

            spec = importlib.util.spec_from_file_location("__main__", str(fix_urls_mod.__file__))
            assert spec and spec.loader
            mod = importlib.util.module_from_spec(spec)
            with patch.object(Path, "resolve", return_value=root / "watch_clipboard" / "tools" / "fix_urls.py"):
                spec.loader.exec_module(mod)
            self.assertIn("https" + "://" + "github" + ".com", bad_js.read_text(encoding="utf-8"))

            argv_watch = [
                "watch_clipboard.py",
                "--dir", tmp_dir,
                "--interval", "0.2",
                "--port", "0",
                "--no-clear",
                "--api-token", "tok123",
                "--allowed-origin", "chrome-extension://abc",
            ]
            with patch.object(sys, "argv", argv_watch), patch.object(ClipboardWatcher, "start", return_value=None):
                watch_cli_mod.main()

    def test_installer_and_native_host_remaining_branches(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            root = Path(tmp_dir)
            py_dir = root / "py"
            py_dir.mkdir()
            (py_dir / "pythonw.exe").write_text("w", encoding="utf-8")
            real_py = py_dir / "python.exe"
            real_py.write_text("c", encoding="utf-8")

            with patch.object(sys, "_base_executable", str(py_dir / "pythonw.exe"), create=True):
                self.assertEqual(NativeHostInstaller.find_real_windows_python("unused"), str(real_py))

            with patch.object(sys, "_base_executable", "", create=True), patch.dict(os.environ, {"PATH": ""}), patch(
                "glob.glob", return_value=[str(real_py)]
            ):
                self.assertEqual(NativeHostInstaller.find_real_windows_python(r"C:\Microsoft\WindowsApps\python.exe"), str(real_py))

            inst = NativeHostInstaller(extension_id="abcdefghijklmnopabcdefghijklmnop")
            inst.project_dir, inst.native_dir, inst.host_script = root, root / ".native_host", root / "host.py"
            inst.host_script.write_text("# stub\n", encoding="utf-8")

            with patch.object(inst, "_resolve_console_python", return_value=r"C:\Microsoft\WindowsApps\python.exe"), patch("os.name", "nt"):
                bat = inst._create_wrapper()
                self.assertIn("python -B", bat.read_text(encoding="utf-8"))

            def _raise_perm(*_a: object, **_kw: object) -> object:
                raise PermissionError("denied")

            fake_winreg = types.SimpleNamespace(
                HKEY_CURRENT_USER=1, HKEY_LOCAL_MACHINE=2, KEY_WRITE=1, KEY_WOW64_64KEY=2, KEY_WOW64_32KEY=4, REG_SZ=1,
                CreateKeyEx=_raise_perm, SetValueEx=lambda *a, **kw: None,
            )
            with patch.dict(sys.modules, {"winreg": fake_winreg}), patch("platform.system", return_value="Windows"):
                inst.install()

            host = NativeMessagingHost(script_path=str(inst.host_script))
            with patch("os.name", "posix"):
                self.assertEqual(host._resolve_python_executable(), sys.executable)

            for action_msg in (b'{"action":"ping"}', b'{"action":"status","port":19999}', b'{"action":"unknown"}'):
                stdin_ok = type("S", (), {"buffer": io.BytesIO(struct.pack("@I", len(action_msg)) + action_msg)})()
                stdout_ok = type("S", (), {"buffer": io.BytesIO()})()
                with patch("sys.stdin", stdin_ok), patch("sys.stdout", stdout_ok):
                    host.run_once()
                raw_out = stdout_ok.buffer.getvalue()
                self.assertGreater(len(raw_out), 4)
                decoded = json.loads(raw_out[4:].decode("utf-8"))
                self.assertIn("ok", decoded)

            with patch.object(NativeMessagingHost, "run_once") as m_once:
                native_host_mod.main()
                m_once.assert_called_once()
    def test_status_server_and_watcher_remaining_branches(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            root = Path(tmp_dir)
            handler = object.__new__(_StatusRequestHandler)
            handler.target_dir = tmp_dir
            handler.assembler_ref = None
            handler.api_token = ""
            handler.allowed_origin = ""
            handler.headers = {"Content-Length": "invalid"}  # type: ignore[assignment]
            handler.rfile = io.BytesIO(b"")
            handler.wfile = io.BytesIO()
            handler.send_response = lambda *_a, **_kw: None  # type: ignore[method-assign]
            handler.send_header = lambda *_a, **_kw: None  # type: ignore[method-assign]
            handler.end_headers = lambda: None  # type: ignore[method-assign]
            self.assertEqual(handler._read_json_body(), {})

            self.assertFalse(handler._is_within_allowed_roots("C:\\a.py", ["D:\\"]))
            ok_abs1, _, _ = handler._read_saved_file_from_header("/abs/path.py")
            ok_abs2, _, _ = handler._read_saved_file_from_header("/abs/part.py | 1/2")
            self.assertFalse(ok_abs1)
            self.assertFalse(ok_abs2)

            fake_exp = root / "export" / "project_exporter"
            fake_exp.mkdir(parents=True)
            (fake_exp / "__init__.py").write_text("", encoding="utf-8")

            def _fake_export_run(cmd: list[str], **_kw: object) -> object:
                out_dir = Path(cmd[-2])
                (out_dir / "proj_export.txt").write_text("EXPORT_OK", encoding="utf-8")
                return type("R", (), {"returncode": 0, "stdout": "proj_export.txt|1\n", "stderr": ""})()

            with patch("subprocess.run", side_effect=_fake_export_run):
                handler.path = "/export-project"
                handler.wfile = io.BytesIO()
                handler.do_POST()
                self.assertIn(b"EXPORT_OK", handler.wfile.getvalue())

            with patch("subprocess.run", return_value=type("R", (), {"returncode": 0, "stdout": "missing.txt|0\n", "stderr": ""})()):
                ok_miss, _, _, _ = handler._run_project_export()
                self.assertFalse(ok_miss)

            with patch("threading.Timer") as m_timer:
                handler.path = "/shutdown"
                handler.wfile = io.BytesIO()
                handler.do_POST()
                m_timer.assert_called_once()

            (root / "boom_runner.py").write_text("print('ok')\n", encoding="utf-8")
            body_run = b'{"test_runner":"boom_runner.py"}'
            handler.path = "/run-tests"
            handler.headers = {"Content-Length": str(len(body_run))}  # type: ignore[assignment]
            handler.rfile = io.BytesIO(body_run)
            handler.wfile = io.BytesIO()
            with patch.object(handler, "_execute_tests_streaming", side_effect=RuntimeError("crash")):
                handler.do_POST()
                self.assertIn(b"crash", handler.wfile.getvalue())

            srv = StatusServer(host="127.0.0.1", port=18765, target_dir=tmp_dir)
            with patch("clipboard_watcher.status_server._QuietThreadingHTTPServer", side_effect=OSError("in use")):
                self.assertFalse(srv.start())

            cfg = WatcherConfig(config_path="missing.ini")
            cfg.poll_interval = 0.001
            asm = FileAssembler(base_dir=tmp_dir, config=cfg)
            watcher = ClipboardWatcher(base_dir=tmp_dir, assembler=asm, config=cfg)
            import tkinter as tk
            bad_tk = MagicMock()
            bad_tk.clipboard_clear.side_effect = tk.TclError("busy")
            watcher._root = bad_tk

            with patch("os.name", "posix"):
                self.assertIsNone(watcher._get_win32_sequence_number())
                watcher._clear_clipboard_once()
                with patch("subprocess.run", side_effect=OSError("no pgrep")):
                    self.assertTrue(watcher._is_process_running("chrome"))

            mock_loop_root = MagicMock()
            mock_loop_root.clipboard_get.side_effect = ["", "same", KeyboardInterrupt()]
            with patch("tkinter.Tk", return_value=mock_loop_root), patch.object(
                watcher, "_get_win32_sequence_number", side_effect=list((1, 1, 2, 3))
            ):
                watcher.start()
