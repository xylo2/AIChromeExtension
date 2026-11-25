# Commandes pip à exécuter : Aucune dépendance externe requise (lancer avec : python -m unittest discover tests)

import io
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import MagicMock, patch

from clipboard_watcher.assembler import FileAssembler
from clipboard_watcher.config import WatcherConfig
from clipboard_watcher.export_api import ProjectExportRunner
from clipboard_watcher.status_server import _StatusRequestHandler
import tools.fix_urls as fix_urls_mod
import tools.generate_icons as gen_icons_mod
from tools.run_tests_clip import ClipboardTestRunner


class _MemHandler(_StatusRequestHandler):
    def __init__(self, method: str, path: str, body: bytes = b"", target_dir: str = ".", api_token: str = "", assembler_ref: object = None) -> None:
        self.command, self.path, self.request_version = method, path, "HTTP/1.1"
        self.rfile, self.wfile = io.BytesIO(body), io.BytesIO()
        self.headers = {"Host": "127.0.0.1", "Origin": "chrome-extension://abc", "Content-Length": str(len(body))}  # type: ignore[assignment]
        self.target_dir, self.api_token, self.assembler_ref = target_dir, api_token, assembler_ref
        self.status_code: int = 0

    def send_response(self, code: int, message: str | None = None) -> None:
        self.status_code = code

    def send_header(self, keyword: str, value: str) -> None:
        pass

    def end_headers(self) -> None:
        pass

    def json_body(self) -> dict:
        raw = self.wfile.getvalue().decode("utf-8")
        return json.loads(raw) if raw else {}


class TestHttpAndTools(unittest.TestCase):
    def test_mem_handler_git_and_http_routes(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            root = Path(tmp_dir)
            remote_d, work_d = root / "remote.git", root / "work"
            remote_d.mkdir()
            work_d.mkdir()
            subprocess.run(["git", "init", "--bare"], cwd=remote_d, check=True, capture_output=True)
            subprocess.run(["git", "init", "-b", "main"], cwd=work_d, check=True, capture_output=True)
            subprocess.run(["git", "config", "user.email", "test@exemple.invalid"], cwd=work_d, check=True)
            subprocess.run(["git", "config", "user.name", "Utilisateur_A"], cwd=work_d, check=True)
            subprocess.run(["git", "remote", "add", "origin", str(remote_d)], cwd=work_d, check=True)

            (work_d / "a.py").write_text("x = 1\n", encoding="utf-8")
            subprocess.run(["git", "add", "a.py"], cwd=work_d, check=True)
            subprocess.run(["git", "commit", "-m", "init"], cwd=work_d, check=True, capture_output=True)
            (work_d / "a.py").write_text("x = 2\n", encoding="utf-8")
            (work_d / "new.py").write_text("y = 3\n", encoding="utf-8")

            asm = FileAssembler(base_dir=str(work_d), config=WatcherConfig(config_path="missing.ini"))
            asm.process_text("=== FILE_PART: pkg/p.py | 1/2 ===\nz = 1\n")
            asm.process_text("=== FILE: pkg/q.py ===\nw = 2\n")

            for m, p, b in [
                ("OPTIONS", "/status", b""),
                ("GET", "/status?test_runner=tools/run_tests_clip.py", b""),
                ("GET", "/read-file?header=pkg/q.py", b""),
                ("GET", "/read-file?header=pkg/p.py%20%7C%201/2", b""),
                ("GET", "/read-file?header=", b""),
                ("GET", "/read-file?header=../x", b""),
                ("GET", "/git-status", b""),
                ("GET", "/404", b""),
                ("POST", "/git-diff", b'{"files":["a.py","new.py"]}'),
                ("POST", "/git-commit", b'{"message":"feat: test","files":["a.py","new.py"]}'),
                ("POST", "/git-push", b'{"remote":"origin","branch":"main"}'),
                ("POST", "/run-tests", b'{"test_runner":"../bad.py"}'),
                ("POST", "/unknown", b"{}"),
            ]:
                h = _MemHandler(m, p, body=b, target_dir=str(work_d), assembler_ref=asm)
                h.do_OPTIONS() if m == "OPTIONS" else (h.do_GET() if m == "GET" else h.do_POST())
                self.assertIn(h.status_code, (200, 204, 400, 403, 404))

            h_401 = _MemHandler("GET", "/status", target_dir=str(work_d), api_token="tok")
            h_401.do_GET()
            self.assertEqual(h_401.status_code, 401)

            with patch.object(ProjectExportRunner, "resolve_exporter_dir", return_value=None):
                he = _MemHandler("POST", "/export-project", target_dir=str(work_d))
                he.do_POST()
                self.assertEqual(he.status_code, 500)

            with patch.object(_MemHandler, "_execute_tests_streaming", side_effect=subprocess.TimeoutExpired("c", 180)):
                (work_d / "ok_t.py").write_text("print('OK')\n", encoding="utf-8")
                ht = _MemHandler("POST", "/run-tests", body=b'{"test_runner":"ok_t.py"}', target_dir=str(work_d))
                ht.do_POST()
                self.assertEqual(ht.status_code, 504)

    def test_fix_urls_icons_and_runner_failures(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            root = Path(tmp_dir)
            js_f = root / "u.js"
            js_f.write_text('const u = "' + "https" + "://www." + "github" + '.com";\n', encoding="utf-8")
            self.assertEqual(fix_urls_mod.repair_tools_urls(root).get("u.js"), 1)
            gen_icons_mod.generate_all_icons(tmp_dir)
            self.assertTrue((root / "ChromeAI" / "icons" / "icon48.png").is_file())

            tdir = root / "tests"
            tdir.mkdir()
            (tdir / "__init__.py").write_text("", encoding="utf-8")
            (tdir / "test_fail.py").write_text("import unittest\nclass F(unittest.TestCase):\n    def test_bad(self): self.assertEqual(1, 2)\n", encoding="utf-8")
            runner = ClipboardTestRunner(project_root=tmp_dir, use_clipboard=True)
            with patch.dict(sys.modules, {"tkinter": MagicMock()}), patch("shutil.which", return_value="/usr/bin/node"):
                self.assertEqual(ClipboardTestRunner.find_node_binary(root), "/usr/bin/node")
                self.assertEqual(runner.run(), 1)


if __name__ == "__main__":
    unittest.main()
