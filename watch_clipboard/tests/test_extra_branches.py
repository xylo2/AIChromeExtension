# Commandes pip à exécuter : Aucune dépendance externe requise (lancer avec : python -m unittest discover tests)

import io
import os
from pathlib import Path
import struct
import sys
import tempfile
import trace
import unittest
from unittest.mock import MagicMock, patch

from clipboard_watcher.native_host import NativeMessagingHost
from clipboard_watcher.status_server import _StatusRequestHandler
from tools.run_tests_clip import ClipboardTestRunner


class TestExtraBranches(unittest.TestCase):
    """Couvre les dernières branches de run_tests_clip.py, native_host.py et status_server.py."""

    def test_runner_executable_lines_collect_and_suite_counts(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            root = Path(tmp_dir)
            sample_py = root / "module_a.py"
            sample_py.write_text(
                '"""Docstring module."""\n'
                "def alpha(v):\n"
                '    """Docstring fonction."""\n'
                "    if v:\n"
                "        return 1\n"
                "    return 2\n",
                encoding="utf-8",
            )
            bad_py = root / "broken.py"
            bad_py.write_text("def broken(:\n    pass\n", encoding="utf-8")
            (root / "__init__.py").write_text("", encoding="utf-8")
            (root / "test_skip.py").write_text("x = 1\n", encoding="utf-8")
            (root / "__pycache__").mkdir()
            (root / "__pycache__" / "cached.py").write_text("y = 2\n", encoding="utf-8")

            runner = ClipboardTestRunner(project_root=tmp_dir, use_clipboard=False)
            exec_lns = runner._executable_lines(str(sample_py))
            self.assertEqual(exec_lns, {4, 5, 6})
            self.assertEqual(runner._executable_lines(str(bad_py)), set())
            self.assertEqual(runner.compact_error_report("Sortie brute sans section"), "Sortie brute sans section")

            collected = runner._collect_source_files(tmp_dir)
            self.assertIn(os.path.realpath(str(sample_py)), collected)
            self.assertFalse(any("cached.py" in p or "test_skip.py" in p for p in collected))

            tests_dir = root / "tests"
            tests_dir.mkdir()
            (tests_dir / "__init__.py").write_text("", encoding="utf-8")
            (tests_dir / "test_mini.py").write_text(
                "import unittest\nclass T(unittest.TestCase):\n    def test_ok(self): self.assertTrue(True)\n",
                encoding="utf-8",
            )
            fake_counts = {(os.path.realpath(str(sample_py)), 4): 1, (os.path.realpath(str(sample_py)), 5): 1}
            fake_tracer = MagicMock()
            fake_tracer.runfunc.side_effect = lambda fn, *a, **kw: fn(*a, **kw)
            fake_tracer.results.return_value = type("Res", (), {"counts": fake_counts})()
            with patch.object(trace, "Trace", return_value=fake_tracer):
                rc, summary, rows = runner._run_single_suite("mini", str(tests_dir), tmp_dir)
            self.assertEqual(rc, 0)
            self.assertIn("OK", summary)
            self.assertTrue(any(rel_f == "module_a.py" and missing_lns == list((6,)) for rel_f, _, _, missing_lns in rows))

            fake_py_dir = root / "py_install"
            fake_py_dir.mkdir()
            fake_py = fake_py_dir / "python.exe"
            fake_node = fake_py_dir / "node.exe"
            fake_py.write_text("py", encoding="utf-8")
            fake_node.write_text("node", encoding="utf-8")
            with patch.object(sys, "executable", str(fake_py)):
                self.assertEqual(ClipboardTestRunner.find_node_binary(root / "sub"), str(fake_node))

    def test_native_host_glob_which_and_truncated_body(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            root = Path(tmp_dir)
            host = NativeMessagingHost(script_path=str(root / "watch_clipboard.py"))

            glob_py = root / "glob_python.exe"
            glob_py.write_text("py", encoding="utf-8")
            with patch("os.name", "nt"), patch.object(sys, "_base_executable", "", create=True), patch.object(
                sys, "executable", str(root / "Microsoft" / "WindowsApps" / "python.exe")
            ), patch.dict(os.environ, {"PATH": "", "LOCALAPPDATA": tmp_dir}):
                with patch("glob.glob", return_value=[str(glob_py)]):
                    self.assertEqual(host._resolve_python_executable(), str(glob_py))
                with patch("glob.glob", return_value=[]), patch("shutil.which", return_value="C:\\bin\\python.exe"):
                    self.assertEqual(host._resolve_python_executable(), "C:\\bin\\python.exe")

            trunc_in = type("S", (), {"buffer": io.BytesIO(struct.pack("@I", 20) + b"abc")})()
            with patch("sys.stdin", trunc_in):
                self.assertIsNone(host.read_message())

    def test_status_server_misc_error_branches(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            handler = object.__new__(_StatusRequestHandler)
            handler.target_dir = tmp_dir
            handler.assembler_ref = None

            ok_h, _, err_h = handler._read_saved_file_from_header("   ")
            self.assertFalse(ok_h)
            self.assertIn("vide", err_h)

            self.assertEqual(_StatusRequestHandler._format_git_push_error("simple error line"), "simple error line")

            with patch.object(handler, "_find_git_root", return_value=tmp_dir):
                ok_act, err_act = handler._git_commit_and_push("unknown_action")
                self.assertFalse(ok_act)
                self.assertIn("inconnue", err_act)
