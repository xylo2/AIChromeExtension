# Commandes pip à exécuter : Aucune dépendance externe requise (lancer avec : python -m unittest discover tests)

import io
import os
from pathlib import Path
import struct
import subprocess
import sys
import tempfile
import types
import unittest
from unittest.mock import MagicMock, patch

from clipboard_watcher.native_host import NativeMessagingHost
from clipboard_watcher.status_server import _QuietThreadingHTTPServer, _StatusRequestHandler
from install_native_host import NativeHostInstaller


class TestDeepBranches(unittest.TestCase):
    """Couvre les branches profondes de status_server.py, native_host.py et install_native_host.py."""

    def test_status_server_git_and_resolution_edge_cases(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            root = Path(tmp_dir)
            handler = object.__new__(_StatusRequestHandler)
            handler.target_dir = tmp_dir
            handler.assembler_ref = None
            handler.api_token = ""
            handler.allowed_origin = ""
            handler.wfile = io.BytesIO()
            handler.send_response = lambda *_a, **_kw: None  # type: ignore[method-assign]
            handler.send_header = lambda *_a, **_kw: None  # type: ignore[method-assign]
            handler.end_headers = lambda: None  # type: ignore[method-assign]

            handler.headers = {"Content-Length": "10"}  # type: ignore[assignment]
            handler.rfile = io.BytesIO(b"1234567890")
            handler._drain_unread_body(max_bytes=100)

            self.assertFalse(handler._is_within_allowed_roots(tmp_dir, [tmp_dir]))

            git_repo = root / "repo"
            sub_proj = git_repo / "sub_proj"
            sub_proj.mkdir(parents=True)
            handler.target_dir = str(sub_proj)

            def _fake_git_status_err(cmd: list[str], **_kw: object) -> object:
                if "rev-parse" in cmd:
                    return type("R", (), {"returncode": 0, "stdout": str(git_repo) + "\n", "stderr": ""})()
                return type("R", (), {"returncode": 1, "stdout": "", "stderr": "git status failed"})()

            with patch("subprocess.run", side_effect=_fake_git_status_err):
                ok_s, _, err_s = handler._git_status_entries()
                self.assertFalse(ok_s)
                self.assertIn("git status failed", err_s)

            def _fake_git_rename_and_diff(cmd: list[str], **_kw: object) -> object:
                if "rev-parse" in cmd and "--show-toplevel" in cmd:
                    return type("R", (), {"returncode": 0, "stdout": str(git_repo) + "\n", "stderr": ""})()
                if "status" in cmd and "--porcelain" in cmd:
                    return type("R", (), {"returncode": 0, "stdout": "R  old.py -> new.py\n", "stderr": ""})()
                if "rev-parse" in cmd and "--verify" in cmd:
                    return type("R", (), {"returncode": 1, "stdout": "", "stderr": ""})()
                if "diff" in cmd:
                    return type("R", (), {"returncode": 0, "stdout": "diff --git a/x b/x\n", "stderr": ""})()
                return type("R", (), {"returncode": 0, "stdout": "", "stderr": ""})()

            with patch("subprocess.run", side_effect=_fake_git_rename_and_diff):
                ok_r, entries_r, _ = handler._git_status_entries()
                self.assertTrue(ok_r)
                self.assertEqual(entries_r[0]["path"], "new.py")
                ok_d, diff_txt, _ = handler._git_diff_selected(["/abs.py", "new.py"])
                self.assertTrue(ok_d)
                self.assertIn("WORKING TREE", diff_txt)

            def _fake_git_add_and_commit_fail(cmd: list[str], **_kw: object) -> object:
                if "rev-parse" in cmd:
                    return type("R", (), {"returncode": 0, "stdout": str(git_repo) + "\n", "stderr": ""})()
                if "add" in cmd:
                    return type("R", (), {"returncode": 1, "stdout": "", "stderr": "add error"})()
                return type("R", (), {"returncode": 0, "stdout": "", "stderr": ""})()

            with patch("subprocess.run", side_effect=_fake_git_add_and_commit_fail):
                ok_add, err_add = handler._git_commit_and_push("commit", message="msg")
                self.assertFalse(ok_add)
                self.assertIn("add error", err_add)

            def _fake_git_commit_fail(cmd: list[str], **_kw: object) -> object:
                if "rev-parse" in cmd:
                    return type("R", (), {"returncode": 0, "stdout": str(git_repo) + "\n", "stderr": ""})()
                if "commit" in cmd:
                    return type("R", (), {"returncode": 1, "stdout": "", "stderr": "nothing to commit"})()
                return type("R", (), {"returncode": 0, "stdout": "", "stderr": ""})()

            with patch("subprocess.run", side_effect=_fake_git_commit_fail):
                ok_cm, err_cm = handler._git_commit_and_push("commit", message="msg")
                self.assertFalse(ok_cm)
                self.assertIn("nothing to commit", err_cm)

            with patch.object(handler, "_find_git_root", return_value=str(git_repo)), patch.dict(
                os.environ, {"HOME": "", "USERPROFILE": str(root)}, clear=False
            ), patch("os.name", "nt"), patch(
                "subprocess.run", return_value=type("R", (), {"returncode": 1, "stdout": "", "stderr": "fatal: rejected"})()
            ):
                ok_pu, err_pu = handler._git_commit_and_push("push", remote="origin", branch="main")
                self.assertFalse(ok_pu)
                self.assertIn("fatal: rejected", err_pu)
