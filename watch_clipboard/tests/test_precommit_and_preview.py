import io
import json
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest
from clipboard_watcher.export_api import ProjectExportRunner
from clipboard_watcher.git_api import GitOperations
from clipboard_watcher.status_server import _StatusRequestHandler


class TestPrecommitAndExportPreview(unittest.TestCase):
    """Vérifie GET /export-preview (succès + erreurs) et le nettoyage pré-commit (URLs, CRLF, espaces)."""

    def test_export_preview_endpoint_and_error_branches(self) -> None:
        workspace_root = Path(__file__).resolve().parents[2]
        real_exporter = workspace_root / "export"
        if not (real_exporter / "project_exporter").is_dir():
            self.skipTest("project_exporter absent")

        with tempfile.TemporaryDirectory() as tmp_dir:
            root = Path(tmp_dir)
            shutil.copytree(real_exporter, root / "export")
            proj = root / "sample"
            proj.mkdir()
            (proj / "app.py").write_text("def hello():\n    return 'world'\n", encoding="utf-8")
            (proj / "test_app.py").write_text("assert True\n", encoding="utf-8")

            handler = object.__new__(_StatusRequestHandler)
            handler.target_dir = str(proj)
            handler.api_token = ""
            handler.allowed_origin = ""
            handler.headers = {"Origin": "chrome-extension://abc"}  # type: ignore[assignment]
            handler.path = "/export-preview?subpaths=app.py,test_app.py"
            handler.wfile = io.BytesIO()
            handler.send_response = lambda *_a, **_kw: None  # type: ignore[method-assign]
            handler.send_header = lambda *_a, **_kw: None  # type: ignore[method-assign]
            handler.end_headers = lambda: None  # type: ignore[method-assign]
            handler.do_GET()

            payload = json.loads(handler.wfile.getvalue().decode("utf-8"))
            self.assertTrue(payload["ok"])
            self.assertEqual(payload["modes"]["full"]["files"], 2)
            self.assertEqual(payload["modes"]["code"]["files"], 1)
            self.assertGreater(payload["modes"]["full"]["tokens"], 0)

            runner_missing = ProjectExportRunner(target_dir=str(proj / "isolated"))
            runner_missing.resolve_exporter_dir = lambda: None  # type: ignore[method-assign]
            ok_m, _, _ = runner_missing.preview_all_modes()
            self.assertFalse(ok_m)

            runner_sub_err = ProjectExportRunner(
                target_dir=str(proj),
                run_fn=lambda *_a, **_kw: type("P", (), {"returncode": 1, "stdout": "", "stderr": "subproc fail"})(),
            )
            ok_se, _, err_se = runner_sub_err.preview_all_modes()
            self.assertFalse(ok_se)
            self.assertIn("subproc fail", err_se)

            runner_bad_json = ProjectExportRunner(
                target_dir=str(proj),
                run_fn=lambda *_a, **_kw: type("P", (), {"returncode": 0, "stdout": "not-json\n", "stderr": ""})(),
            )
            ok_bj, _, _ = runner_bad_json.preview_all_modes()
            self.assertFalse(ok_bj)

    def test_git_commit_normalizes_crlf_trailing_ws_and_urls_before_staging(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            root = Path(tmp_dir)
            subprocess.run(["git", "init", "-b", "main"], cwd=root, check=True, capture_output=True)
            subprocess.run(["git", "config", "user.email", "t@example.invalid"], cwd=root, check=True)
            subprocess.run(["git", "config", "user.name", "Tester"], cwd=root, check=True)

            bad_js = root / "url_check.js"
            bad_js.write_bytes(('const u = "' + "https" + "://www." + "github" + '.com";   \r\n').encode("utf-8"))
            dirty_py = root / "dirty.py"
            dirty_py.write_bytes(b"def f():   \r\n    return 1\t \r\n")

            git_ops = GitOperations(target_dir=str(root), is_within_roots_fn=lambda _c, _r: True)
            ok, out = git_ops.commit_and_push("commit", message="fix: clean urls and whitespace")
            self.assertTrue(ok, msg=out)
            self.assertIn("https" + "://" + "github" + ".com", bad_js.read_text(encoding="utf-8"))
            self.assertEqual(dirty_py.read_bytes(), b"def f():\n    return 1\n")


if __name__ == "__main__":
    unittest.main()
