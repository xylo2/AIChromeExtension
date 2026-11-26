import os
import tempfile
import unittest
from clipboard_watcher.assembler import FileAssembler
from clipboard_watcher.config import WatcherConfig
from clipboard_watcher.git_api import GitOperations


class TestAssemblerAndGitCompact(unittest.TestCase):
    """Vérifie le nettoyage automatique des espaces et la compaction du diff Git (-U2)."""

    def test_assembler_strips_trailing_whitespace_on_lines(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            asm = FileAssembler(base_dir=tmp_dir, config=WatcherConfig(config_path="missing.ini"))
            payload = "=== FILE: clean_ws.py ===\ndef demo():   \n    x = 1\t \n    return x  \n"
            self.assertEqual(asm.process_text(payload), 1)
            target = os.path.join(tmp_dir, "clean_ws.py")
            with open(target, "r", encoding="utf-8") as f_in:
                self.assertEqual(f_in.read(), "def demo():\n    x = 1\n    return x\n")

    def test_git_diff_uses_u2_and_skips_noisy_lockfiles(self) -> None:
        recorded_cmds: list[list[str]] = []

        def _fake_run(cmd: list[str], **_kw: object) -> object:
            recorded_cmds.append(list(cmd))
            if "status" in cmd:
                return type("R", (), {"returncode": 0, "stdout": " M app.py\n M package-lock.json\n", "stderr": ""})()
            if "rev-parse" in cmd:
                return type("R", (), {"returncode": 0, "stdout": "abc123\n", "stderr": ""})()
            if "diff" in cmd:
                return type("R", (), {"returncode": 0, "stdout": "diff --git a/app.py b/app.py\n+x = 2\n", "stderr": ""})()
            return type("R", (), {"returncode": 0, "stdout": "", "stderr": ""})()

        with tempfile.TemporaryDirectory() as tmp_dir:
            git_ops = GitOperations(
                target_dir=tmp_dir,
                is_within_roots_fn=lambda _c, _r: True,
                find_git_root_fn=lambda: tmp_dir,
                run_fn=_fake_run,
            )
            ok, diff_text, err = git_ops.diff_selected(["app.py", "package-lock.json", "bundle.min.js"])
            self.assertTrue(ok, msg=err)
            self.assertIn("+x = 2", diff_text)
            diff_cmds = [c for c in recorded_cmds if len(c) > 1 and c[1] == "diff"]
            self.assertEqual(len(diff_cmds), 1)
            self.assertIn("-U2", diff_cmds[0])
            self.assertIn("app.py", diff_cmds[0])
            self.assertNotIn("package-lock.json", diff_cmds[0])
            self.assertNotIn("bundle.min.js", diff_cmds[0])


if __name__ == "__main__":
    unittest.main()
