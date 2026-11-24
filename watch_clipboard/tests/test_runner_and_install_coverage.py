# Commandes pip à exécuter : Aucune dépendance externe requise (lancer avec : python -m unittest discover tests)

import io
import os
from pathlib import Path
import struct
import sys
import tempfile
import unittest
from unittest.mock import MagicMock, patch

from clipboard_watcher.assembler import FileAssembler
from clipboard_watcher.config import WatcherConfig
from clipboard_watcher.native_host import NativeMessagingHost
from clipboard_watcher.status_server import _StatusRequestHandler
from clipboard_watcher.watcher import ClipboardWatcher
from install_native_host import NativeHostInstaller
from tools.run_tests_clip import ClipboardTestRunner


class TestRunnerAndInstallCoverage(unittest.TestCase):
    """Couvre les branches restantes de run_tests_clip.py, native_host.py, watcher.py et status_server.py."""

    def test_runner_edge_cases_and_cli_flags(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            root = Path(tmp_dir)
            runner = ClipboardTestRunner(project_root=tmp_dir, use_clipboard=False)

            self.assertEqual(runner._executable_lines(str(root / "absent.py")), set())
            rc_miss, msg_miss, rows_miss = runner._run_single_suite("miss", str(root / "no_tests"), tmp_dir)
            self.assertEqual((rc_miss, rows_miss), (1, []))
            self.assertIn("introuvable", msg_miss)

            empty_chrome = root / "EmptyChrome"
            (empty_chrome / "tests").mkdir(parents=True)
            self.assertEqual(runner._run_node_suite(empty_chrome), (0, ""))

            tests_js = root / "ChromeAI" / "tests"
            tests_js.mkdir(parents=True)
            (tests_js / "unit.test.js").write_text("// ok\n", encoding="utf-8")
            self.assertEqual(runner._format_line_ranges([]), "")
            self.assertEqual(runner.format_coverage_report([])[0], 100.0)

            with patch.object(ClipboardTestRunner, "find_node_binary", return_value="node"):
                with patch("subprocess.run", return_value=type("P", (), {"returncode": 0, "stdout": "ok", "stderr": ""})()):
                    self.assertEqual(runner._run_node_suite(root / "ChromeAI")[0], 0)
                with patch("subprocess.run", return_value=type("P", (), {"returncode": 1, "stdout": "fail", "stderr": "err"})()):
                    self.assertEqual(runner._run_node_suite(root / "ChromeAI")[0], 1)

            argv_clip = ["run_tests_clip.py", "--no-clipboard", "--report-file", "r.txt", "--coverage-file", "c.txt"]
            with patch.object(ClipboardTestRunner, "run", return_value=0) as m_run, patch.object(sys, "argv", argv_clip):
                from tools import run_tests_clip as rtc
                self.assertEqual(rtc.main(), 0)
                m_run.assert_called_once_with(report_file="r.txt", coverage_file="c.txt")
    def test_native_host_installer_watcher_and_server_export_branches(self) -> None:
        auto_host = NativeMessagingHost()
        self.assertTrue(auto_host.script_path.endswith("watch_clipboard.py"))

        with tempfile.TemporaryDirectory() as tmp_dir:
            root = Path(tmp_dir)
            custom_script = root / "custom_dir" / "watch_clipboard.py"
            custom_script.parent.mkdir()
            custom_script.write_text("# stub\n", encoding="utf-8")
            custom_host = NativeMessagingHost(script_path=str(custom_script))
            self.assertEqual(custom_host.work_dir, str(root))

            py_dir = root / "pybin"
            py_dir.mkdir()
            pyw_exe = py_dir / "pythonw.exe"
            py_console = py_dir / "python.exe"
            pyw_exe.write_text("w", encoding="utf-8")
            py_console.write_text("c", encoding="utf-8")
            with patch("os.name", "nt"), patch.object(sys, "_base_executable", str(pyw_exe), create=True):
                self.assertEqual(custom_host._resolve_python_executable(), str(py_console))

            with patch("os.name", "posix"), patch("subprocess.Popen", return_value=type("P", (), {"pid": 77})()):
                res_posix = custom_host._start_watcher_process(
                    {"target_dir": ".", "extra_args": "--verbose", "allowed_origin": "chrome-extension://xyz"}
                )
                self.assertEqual(res_posix["pid"], 77)

            empty_stdin = type("S", (), {"buffer": io.BytesIO(b"")})()
            with patch("sys.stdin", empty_stdin):
                self.assertIsNone(auto_host.read_message())

            packed_bad = struct.pack("@I", 4) + b"{bad"
            sent_err: list[dict] = []
            with patch("sys.stdin", type("S", (), {"buffer": io.BytesIO(packed_bad)})()), patch.object(
                auto_host, "send_message", side_effect=sent_err.append
            ):
                auto_host.run_once()
            self.assertFalse(next(iter(sent_err))["ok"])

            inst = NativeHostInstaller(extension_id="abcdefghijklmnopabcdefghijklmnop")
            inst.project_dir, inst.native_dir, inst.host_script = root, root / ".native_host", root / "host.py"
            inst.host_script.write_text("# stub\n", encoding="utf-8")
            with patch.object(inst, "_resolve_console_python", return_value="/usr/bin/python3"), patch("os.name", "posix"):
                sh_wrapper = inst._create_wrapper()
            manifest = inst._write_manifest(sh_wrapper)
            with patch("pathlib.Path.home", return_value=root / "mac_home"):
                (root / "mac_home" / "Library" / "Application Support" / "Google" / "Chrome").mkdir(parents=True)
                inst._install_unix(manifest, "Darwin")

            cfg = WatcherConfig(config_path="missing.ini")
            asm = FileAssembler(base_dir=tmp_dir, config=cfg)
            watcher = ClipboardWatcher(base_dir=tmp_dir, assembler=asm, config=cfg)
            import tkinter as tk
            mock_root = MagicMock()
            mock_root.clipboard_get.side_effect = tk.TclError("locked")
            watcher._root = mock_root
            self.assertIsNone(watcher._get_clipboard_text(retries=2))
            with patch("os.name", "posix"):
                watcher._clear_clipboard_once()
            with patch("tkinter.Tk", return_value=mock_root), patch.object(watcher, "_should_exit_with_browser", return_value=True):
                watcher.start()

            fake_exp = root / "export" / "project_exporter"
            fake_exp.mkdir(parents=True)
            (fake_exp / "__init__.py").write_text("", encoding="utf-8")
            (fake_exp / "config.ini").write_text("[export]\n", encoding="utf-8")
            handler = object.__new__(_StatusRequestHandler)
            handler.target_dir = str(root / "proj")
            os.makedirs(handler.target_dir, exist_ok=True)
            with patch("subprocess.run", return_value=type("R", (), {"returncode": 1, "stdout": "", "stderr": "boom"})()):
                ok_e, _, err_e, _ = handler._run_project_export()
                self.assertFalse(ok_e)
                self.assertIn("boom", err_e)
