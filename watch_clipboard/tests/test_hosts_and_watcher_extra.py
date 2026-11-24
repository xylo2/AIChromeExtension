# Commandes pip à exécuter : Aucune dépendance externe requise (lancer avec : python -m unittest discover tests)

import io
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
from clipboard_watcher.watcher import ClipboardWatcher
from install_native_host import NativeHostInstaller
from tools.run_tests_clip import ClipboardTestRunner


class TestHostsAndWatcherExtra(unittest.TestCase):
    def test_watcher_and_hosts_branches(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            root = Path(tmp_dir)
            cfg = WatcherConfig(config_path="missing.ini")
            asm = FileAssembler(base_dir=tmp_dir, config=cfg)
            watcher = ClipboardWatcher(base_dir=tmp_dir, assembler=asm, config=cfg)
            watcher._root = MagicMock()
            watcher._clear_clipboard_once()
            self.assertFalse(watcher._is_process_running("proc_inexistant_999.exe"))
            with patch("os.name", "posix"), patch("subprocess.run", return_value=type("R", (), {"returncode": 0})()):
                self.assertTrue(watcher._is_process_running("chrome"))

            host = NativeMessagingHost(script_path=str(root / "absent.py"))
            self.assertFalse(host._start_watcher_process({"action": "start"})["ok"])
            self.assertTrue(host._resolve_python_executable())

            bad_stdin = type("S", (), {"buffer": io.BytesIO(struct.pack("@I", 99999999))})()
            with patch("sys.stdin", bad_stdin):
                self.assertIsNone(host.read_message())

            inst = NativeHostInstaller(extension_id="abcdefghijklmnopabcdefghijklmnop")
            inst.host_script = root / "missing_host.py"
            with self.assertRaises(SystemExit):
                inst.install()

            fake_winreg = types.SimpleNamespace(
                HKEY_CURRENT_USER=1,
                HKEY_LOCAL_MACHINE=2,
                KEY_WRITE=1,
                KEY_WOW64_64KEY=2,
                KEY_WOW64_32KEY=4,
                REG_SZ=1,
                CreateKeyEx=lambda *a, **kw: MagicMock(__enter__=lambda s: s, __exit__=lambda *e: None),
                SetValueEx=lambda *a, **kw: None,
            )
            with patch.dict(sys.modules, {"winreg": fake_winreg}):
                inst._install_windows(root / "manifest.json")

            with patch.dict(os.environ, {"PATH": tmp_dir, "LOCALAPPDATA": tmp_dir, "ProgramFiles": tmp_dir}), patch("shutil.which", return_value=None):
                res_py = NativeHostInstaller.find_real_windows_python(r"C:\Microsoft\WindowsApps\python.exe", project_dir=root)
                self.assertTrue(res_py)

            tdir = root / "tests"
            tdir.mkdir()
            (tdir / "__init__.py").write_text("", encoding="utf-8")
            (tdir / "test_ok.py").write_text("import unittest\nclass C(unittest.TestCase):\n    def test_a(self): self.assertEqual(1, 1)\n", encoding="utf-8")
            runner = ClipboardTestRunner(project_root=tmp_dir, use_clipboard=False)
            rep, cov = root / "rep.txt", root / "cov.txt"
            self.assertEqual(runner.run(report_file=str(rep), coverage_file=str(cov)), 0)
            self.assertTrue(rep.is_file() and cov.is_file())

            with patch.object(ClipboardTestRunner, "run", return_value=0) as m_run, patch.object(sys, "argv", ["run_tests_clip.py", "--no-clipboard"]):
                from tools import run_tests_clip as rtc
                self.assertEqual(rtc.main(), 0)
                m_run.assert_called_once()
