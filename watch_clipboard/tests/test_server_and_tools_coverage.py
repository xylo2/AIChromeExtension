# Commandes pip à exécuter : Aucune dépendance externe requise (lancer avec : python -m unittest discover tests)

import io
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import MagicMock, patch

from clipboard_watcher.assembler import FileAssembler
from clipboard_watcher.config import WatcherConfig
from clipboard_watcher.export_api import ProjectExportRunner
from clipboard_watcher.native_host import NativeMessagingHost
from clipboard_watcher.status_server import _StatusRequestHandler
from clipboard_watcher.watcher import ClipboardWatcher
from install_native_host import NativeHostInstaller
import tools.fix_urls as fix_urls_mod
import tools.generate_icons as gen_icons_mod
from tools.run_tests_clip import ClipboardTestRunner


class _FakeHandler(_StatusRequestHandler):
    """Instancie _StatusRequestHandler en mémoire sans socket réseau pour tracer chaque branche."""

    def __init__(
        self,
        method: str,
        path: str,
        body: bytes = b"",
        headers: dict | None = None,
        target_dir: str = ".",
        api_token: str = "",
        allowed_origin: str = "",
        assembler_ref: object = None,
    ) -> None:
        self.command = method
        self.path = path
        self.request_version = "HTTP/1.1"
        self.rfile = io.BytesIO(body)
        self.wfile = io.BytesIO()
        hdrs = {"Host": "127.0.0.1", **(headers or {})}
        if body and "Content-Length" not in hdrs:
            hdrs["Content-Length"] = str(len(body))
        self.headers = hdrs  # type: ignore[assignment]
        self.target_dir = target_dir
        self.api_token = api_token
        self.allowed_origin = allowed_origin
        self.assembler_ref = assembler_ref
        self.status_code: int = 0
        self.sent_headers: dict[str, str] = {}

    def send_response(self, code: int, message: str | None = None) -> None:
        self.status_code = code

    def send_header(self, keyword: str, value: str) -> None:
        self.sent_headers[keyword] = value

    def end_headers(self) -> None:
        pass

    def response_json(self) -> dict:
        raw = self.wfile.getvalue().decode("utf-8")
        return json.loads(raw) if raw else {}
class TestServerAndToolsCoverage(unittest.TestCase):
    """Couvre les branches HTTP de _StatusRequestHandler, fix_urls, generate_icons et watcher."""

    def test_status_handler_routes_git_and_streaming_tests(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            cfg = WatcherConfig(config_path="missing.ini")
            asm = FileAssembler(base_dir=tmp_dir, config=cfg)
            asm.process_text("=== FILE_PART: pkg/a.py | 1/2 ===\nx = 1\n")
            asm.process_text("=== FILE: pkg/b.py ===\ny = 2\n")

            h_opt = _FakeHandler("OPTIONS", "/status", headers={"Origin": "chrome-extension://abc"}, target_dir=tmp_dir)
            h_opt.do_OPTIONS()
            self.assertEqual(h_opt.status_code, 204)

            h_unauth = _FakeHandler("GET", "/status", target_dir=tmp_dir, api_token="secret")
            h_unauth.do_GET()
            self.assertEqual(h_unauth.status_code, 401)

            h_unauth_post = _FakeHandler("POST", "/shutdown", target_dir=tmp_dir, api_token="secret")
            h_unauth_post.do_POST()
            self.assertEqual(h_unauth_post.status_code, 401)

            for bad_hdr in ("", "../evil.py", "pkg/a.py | 0/2", "pkg/a.py | 2/2", "pkg/a.py | 1/2"):
                h_rf = _FakeHandler("GET", f"/read-file?header={bad_hdr}", target_dir=tmp_dir, assembler_ref=asm)
                h_rf.do_GET()
                self.assertIn(h_rf.status_code, (200, 404))

            h_full = _FakeHandler("GET", "/read-file?header=pkg/b.py", target_dir=tmp_dir, assembler_ref=asm)
            h_full.do_GET()
            self.assertEqual(h_full.status_code, 200)

            h_404 = _FakeHandler("GET", "/unknown", target_dir=tmp_dir)
            h_404.do_GET()
            self.assertEqual(h_404.status_code, 404)

            h_post_404 = _FakeHandler("POST", "/unknown", target_dir=tmp_dir)
            h_post_404.do_POST()
            self.assertEqual(h_post_404.status_code, 404)

            h_nogit = _FakeHandler("GET", "/git-status", target_dir=tmp_dir)
            h_nogit.do_GET()
            self.assertEqual(h_nogit.status_code, 400)

            h_noexp = _FakeHandler("POST", "/export-project", target_dir=tmp_dir)
            with patch.object(ProjectExportRunner, "resolve_exporter_dir", return_value=None):
                h_noexp.do_POST()
            self.assertEqual(h_noexp.status_code, 500)

            for ep, payload in (("/git-diff", b'{"files": []}'), ("/git-commit", b'{"message": ""}'), ("/git-push", b'{}')):
                h_git_err = _FakeHandler("POST", ep, body=payload, target_dir=tmp_dir)
                h_git_err.do_POST()
                self.assertEqual(h_git_err.status_code, 400)

            h_forbid = _FakeHandler("POST", "/run-tests", body=b'{"test_runner": "../bad.py"}', target_dir=tmp_dir)
            h_forbid.do_POST()
            self.assertEqual(h_forbid.status_code, 403)

            runner_py = Path(tmp_dir) / "ok_runner.py"
            runner_py.write_text("print('Ran 1 test in 0.00s\\nOK')\n", encoding="utf-8")
            h_run_ok = _FakeHandler("POST", "/run-tests", body=b'{"test_runner": "ok_runner.py"}', target_dir=tmp_dir)
            h_run_ok.do_POST()
            self.assertTrue(h_run_ok.response_json()["passed"])

            with patch.object(_FakeHandler, "_execute_tests_streaming", side_effect=subprocess.TimeoutExpired("cmd", 180)):
                h_to = _FakeHandler("POST", "/run-tests", body=b'{"test_runner": "ok_runner.py"}', target_dir=tmp_dir)
                h_to.do_POST()
                self.assertEqual(h_to.status_code, 504)
    def test_fix_urls_generate_icons_runner_and_hosts_coverage(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            root = Path(tmp_dir)
            bad_js = root / "app.js"
            bad_js.write_text('const u = "' + "https" + "://www." + "github" + '.com";\n', encoding="utf-8")
            res = fix_urls_mod.repair_tools_urls(root)
            self.assertEqual(res.get("app.js"), 1)
            self.assertIn("https" + "://" + "github" + ".com", bad_js.read_text(encoding="utf-8"))

            gen_icons_mod.generate_all_icons(tmp_dir)
            for sz in (16, 48, 128):
                self.assertTrue((root / "ChromeAI" / "icons" / f"icon{sz}.png").is_file())

            fake_chrome = root / "ChromeAI" / "tests"
            fake_chrome.mkdir(parents=True, exist_ok=True)
            (fake_chrome / "sample.test.js").write_text("// stub\n", encoding="utf-8")
            runner = ClipboardTestRunner(project_root=tmp_dir, use_clipboard=True)
            with patch.object(ClipboardTestRunner, "find_node_binary", return_value=None):
                rc_js, msg_js = runner._run_node_suite(root / "ChromeAI")
                self.assertEqual(rc_js, 0)
                self.assertIn("ignorés", msg_js)

            mock_tk = MagicMock()
            with patch.dict(sys.modules, {"tkinter": mock_tk}):
                self.assertTrue(runner.copy_to_clipboard("rapport erreur"))

            tests_dir = root / "tests"
            tests_dir.mkdir()
            (tests_dir / "__init__.py").write_text("", encoding="utf-8")
            (tests_dir / "test_mini.py").write_text(
                "import unittest\nclass M(unittest.TestCase):\n    def test_ok(self):\n        self.assertEqual(1, 1)\n",
                encoding="utf-8",
            )
            rep_f = root / "rep.txt"
            cov_f = root / "cov.txt"
            self.assertEqual(runner.run(report_file=str(rep_f), coverage_file=str(cov_f)), 0)
            self.assertTrue(rep_f.is_file() and cov_f.is_file())

            cfg = WatcherConfig(config_path="missing.ini")
            asm = FileAssembler(base_dir=tmp_dir, config=cfg)
            self.assertEqual(asm._strip_redundant_base_prefix("other/file.py"), "other/file.py")

            watcher = ClipboardWatcher(base_dir=tmp_dir, assembler=asm, config=cfg)
            watcher._root = MagicMock()
            watcher._clear_clipboard_once()
            self.assertFalse(watcher._is_process_running("processus_inexistant_xyz_999.exe"))
            with patch("os.name", "posix"), patch("subprocess.run", return_value=type("R", (), {"returncode": 0})()):
                self.assertTrue(watcher._is_process_running("chrome"))

            host = NativeMessagingHost(script_path=str(root / "missing_watch.py"))
            self.assertFalse(host._start_watcher_process({"action": "start"})["ok"])
            self.assertTrue(NativeHostInstaller._is_windowsapps_path(r"C:\Users\U\AppData\Local\Microsoft\WindowsApps\python.exe"))


if __name__ == "__main__":
    unittest.main()
