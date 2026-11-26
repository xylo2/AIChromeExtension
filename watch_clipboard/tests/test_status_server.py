# Commandes pip à exécuter : Aucune dépendance externe requise (bibliothèque standard uniquement - lancer avec : python -m unittest discover tests)

import json
import os
import shutil
import signal
import socket
import tempfile
import unittest
from unittest.mock import patch
import urllib.error
import urllib.parse
import urllib.request
from clipboard_watcher.assembler import FileAssembler
from clipboard_watcher.config import WatcherConfig
from clipboard_watcher.status_server import StatusServer


class TestStatusServer(unittest.TestCase):
    """
    Tests unitaires vérifiant le serveur HTTP local, l'authentification par jeton,
    CORS/OPTIONS, GET /read-file, POST /shutdown, POST /run-tests et POST /export-project.
    """

    def _find_free_port(self) -> int:
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
            sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
            sock.bind(("127.0.0.1", 0))
            return int(sock.getsockname()[1])

    def _no_proxy_opener(self) -> urllib.request.OpenerDirector:
        return urllib.request.build_opener(urllib.request.ProxyHandler({}))

    def test_status_endpoint_and_security_controls(self) -> None:
        opener = self._no_proxy_opener()
        with tempfile.TemporaryDirectory() as tmp_dir:
            tools_dir: str = os.path.join(tmp_dir, "tools")
            os.makedirs(tools_dir, exist_ok=True)
            default_runner: str = os.path.join(tools_dir, "run_tests_clip.py")
            with open(default_runner, "w", encoding="utf-8") as f_def:
                f_def.write("print('Ran 3 tests in 0.01s\\nOK')\n")

            custom_runner: str = os.path.join(tmp_dir, "custom_tests.py")
            with open(custom_runner, "w", encoding="utf-8") as f_cus:
                f_cus.write("print('CUSTOM_TESTS_PASSED')\n")

            secret_token: str = "test-secret-token-123"
            allowed_origin: str = "chrome-extension://abcdefghijklmnopabcdefghijklmnop"
            port: int = self._find_free_port()
            server: StatusServer = StatusServer(
                host="127.0.0.1",
                port=port,
                target_dir=tmp_dir,
                test_runner_path="tools/run_tests_clip.py",
                api_token=secret_token,
                allowed_origin=allowed_origin,
            )
            self.assertTrue(server.start())

            try:
                opt_req = urllib.request.Request(
                    f"http://127.0.0.1:{port}/status",
                    headers={"Origin": "https://example.com"},
                    method="OPTIONS",
                )
                with opener.open(opt_req, timeout=2.0) as opt_resp:
                    self.assertEqual(opt_resp.status, 204)
                    self.assertEqual(opt_resp.headers.get("Access-Control-Allow-Origin"), allowed_origin)

                unauth_req = urllib.request.Request(f"http://127.0.0.1:{port}/status")
                with self.assertRaises(urllib.error.HTTPError) as ctx:
                    opener.open(unauth_req, timeout=2.0)
                self.assertEqual(ctx.exception.code, 401)

                auth_headers = {"X-Watcher-Token": secret_token}
                req_post = urllib.request.Request(
                    f"http://127.0.0.1:{port}/run-tests",
                    data=json.dumps({"test_runner": "custom_tests.py"}).encode("utf-8"),
                    headers={"Content-Type": "application/json", **auth_headers},
                    method="POST",
                )
                with opener.open(req_post, timeout=5.0) as post_resp:
                    post_data = json.loads(post_resp.read().decode("utf-8"))
                    self.assertTrue(post_data.get("ok"))
                    self.assertTrue(post_data.get("passed"))
                    self.assertIn("CUSTOM_TESTS_PASSED", post_data.get("output", ""))

                unauth_stop = urllib.request.Request(f"http://127.0.0.1:{port}/shutdown", data=b"{}", method="POST")
                with self.assertRaises(urllib.error.HTTPError) as stop_err:
                    opener.open(unauth_stop, timeout=2.0)
                self.assertEqual(stop_err.exception.code, 401)

                with patch("os.kill") as mock_kill, patch("threading.Timer") as mock_timer:
                    mock_timer.side_effect = lambda _delay, fn: type("T", (), {"start": lambda self: fn()})()
                    auth_stop = urllib.request.Request(
                        f"http://127.0.0.1:{port}/shutdown",
                        data=b"{}",
                        headers=auth_headers,
                        method="POST",
                    )
                    with opener.open(auth_stop, timeout=2.0) as stop_resp:
                        self.assertEqual(stop_resp.status, 200)
                        stop_data = json.loads(stop_resp.read().decode("utf-8"))
                        self.assertEqual(stop_data.get("status"), "stopping")
                    mock_kill.assert_called_once_with(os.getpid(), signal.SIGINT)
            finally:
                server.stop()
    def test_read_file_endpoint_for_parts_and_complete_files(self) -> None:
        opener = self._no_proxy_opener()
        with tempfile.TemporaryDirectory() as tmp_dir:
            cfg = WatcherConfig(config_path="non_existent.ini")
            assembler = FileAssembler(base_dir=tmp_dir, config=cfg)
            assembler.process_text("=== FILE_PART: src/mod.py | 2/4 ===\ndef part_two():\n    return 2\n")
            assembler.process_text("=== FILE: src/full.py ===\nVALUE = 99\n")

            port: int = self._find_free_port()
            server = StatusServer(host="127.0.0.1", port=port, target_dir=tmp_dir, assembler=assembler)
            self.assertTrue(server.start())
            try:
                q_part = urllib.parse.quote("src/mod.py | 2/4")
                with opener.open(f"http://127.0.0.1:{port}/read-file?header={q_part}", timeout=2.0) as r_part:
                    data_part = json.loads(r_part.read().decode("utf-8"))
                    self.assertTrue(data_part.get("ok"))
                    self.assertEqual(data_part.get("filename"), "mod.py.part2.txt")
                    self.assertIn("def part_two():", data_part.get("content", ""))

                q_full = urllib.parse.quote("src/full.py")
                with opener.open(f"http://127.0.0.1:{port}/read-file?header={q_full}", timeout=2.0) as r_full:
                    data_full = json.loads(r_full.read().decode("utf-8"))
                    self.assertTrue(data_full.get("ok"))
                    self.assertEqual(data_full.get("filename"), "full.py")
                    self.assertIn("VALUE = 99", data_full.get("content", ""))

                q_bad = urllib.parse.quote("../secret.txt")
                with self.assertRaises(urllib.error.HTTPError) as err_ctx:
                    opener.open(f"http://127.0.0.1:{port}/read-file?header={q_bad}", timeout=2.0)
                self.assertEqual(err_ctx.exception.code, 404)
            finally:
                server.stop()

    def test_case_mismatch_target_dir_resolves_test_runner(self) -> None:
        opener = self._no_proxy_opener()
        with tempfile.TemporaryDirectory() as tmp_dir:
            tools_dir: str = os.path.join(tmp_dir, "tools")
            os.makedirs(tools_dir, exist_ok=True)
            runner: str = os.path.join(tools_dir, "run_tests_clip.py")
            with open(runner, "w", encoding="utf-8") as f_run:
                f_run.write("print('Ran 1 test in 0.00s\\nOK')\n")

            port: int = self._find_free_port()
            mixed_case_target: str = os.path.join(tmp_dir, "Tools")
            server = StatusServer(host="127.0.0.1", port=port, target_dir=mixed_case_target)
            self.assertTrue(server.start())
            try:
                with opener.open(f"http://127.0.0.1:{port}/status", timeout=2.0) as resp:
                    data = json.loads(resp.read().decode("utf-8"))
                    self.assertTrue(data.get("has_run_tests_clip"))
                    self.assertIsNotNone(data.get("test_runner_path"))
            finally:
                server.stop()

    def test_export_project_and_folders_endpoints(self) -> None:
        opener = self._no_proxy_opener()
        workspace_root: str = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
        real_exporter_dir: str = os.path.join(workspace_root, "export")
        if not os.path.isdir(os.path.join(real_exporter_dir, "project_exporter")):
            self.skipTest("Dossier export/project_exporter non disponible dans cet environnement")

        with tempfile.TemporaryDirectory() as tmp_workspace:
            shutil.copytree(real_exporter_dir, os.path.join(tmp_workspace, "export"))
            sample_proj: str = os.path.join(tmp_workspace, "demo_app")
            os.makedirs(os.path.join(sample_proj, "pkg_a"), exist_ok=True)
            with open(os.path.join(sample_proj, "pkg_a", "app.py"), "w", encoding="utf-8") as f_app:
                f_app.write("def run():\n    return 42\n")

            port: int = self._find_free_port()
            server: StatusServer = StatusServer(host="127.0.0.1", port=port, target_dir=sample_proj)
            self.assertTrue(server.start())
            try:
                with opener.open(f"http://127.0.0.1:{port}/export-folders", timeout=5.0) as fld_resp:
                    fld_data = json.loads(fld_resp.read().decode("utf-8"))
                    self.assertEqual(fld_data.get("folders"), ["pkg_a"])

                exp_req = urllib.request.Request(f"http://127.0.0.1:{port}/export-project", data=b'{"mode":"full","subpaths":["pkg_a"]}', method="POST")
                with opener.open(exp_req, timeout=15.0) as exp_resp:
                    exp_data = json.loads(exp_resp.read().decode("utf-8"))
                    self.assertTrue(exp_data.get("ok"))
                    self.assertEqual(exp_data.get("filename"), "demo_app_export.txt")
                    self.assertEqual(exp_data.get("file_count"), 1)
                    self.assertIn("=== EXPORT : COMPLET (code + tests) | 1 fichier(s) | 2 lignes", exp_data.get("content", ""))
                    self.assertIn("--- pkg_a/app.py ---", exp_data.get("content", ""))
            finally:
                server.stop()

    def test_config_loads_custom_test_runner_path(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            ini_path: str = os.path.join(tmp_dir, "custom.ini")
            with open(ini_path, "w", encoding="utf-8") as f_ini:
                f_ini.write("[server]\ntest_runner_path = scripts/my_runner.py\n")
            cfg: WatcherConfig = WatcherConfig(config_path=ini_path)
            self.assertEqual(cfg.test_runner_path, "scripts/my_runner.py")


if __name__ == "__main__":
    unittest.main()
