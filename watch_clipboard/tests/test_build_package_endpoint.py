import io
import json
from pathlib import Path
import subprocess
import tempfile
import time
import unittest
from unittest.mock import patch

from clipboard_watcher.build_api import PackageBuildRunner
from clipboard_watcher.status_server import _StatusRequestHandler


class TestBuildPackageEndpoint(unittest.TestCase):
    """Vérifie /status, POST /build-package, le streaming /build-stream et l'arrêt /build-package-stop."""

    def _make_handler(self, target_dir: str) -> _StatusRequestHandler:
        handler = object.__new__(_StatusRequestHandler)
        handler.target_dir = target_dir
        handler.default_test_runner = "tools/run_tests_clip.py"
        handler.api_token = ""
        handler.allowed_origin = ""
        handler.assembler_ref = None
        handler.headers = {"Origin": "chrome-extension://abc", "Content-Length": "0"}  # type: ignore[assignment]
        handler.rfile = io.BytesIO()
        handler.wfile = io.BytesIO()
        handler.send_response = lambda *_a, **_kw: None  # type: ignore[method-assign]
        handler.send_header = lambda *_a, **_kw: None  # type: ignore[method-assign]
        handler.end_headers = lambda: None  # type: ignore[method-assign]
        return handler

    def test_status_sync_and_streaming_build_lifecycle(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            root = Path(tmp_dir)
            h_missing = self._make_handler(tmp_dir)
            h_missing.path = "/status"
            h_missing.do_GET()
            self.assertFalse(json.loads(h_missing.wfile.getvalue().decode("utf-8"))["has_build_package"])

            h_stop_idle = self._make_handler(tmp_dir)
            h_stop_idle.path = "/build-package-stop"
            h_stop_idle.do_POST()
            self.assertFalse(json.loads(h_stop_idle.wfile.getvalue().decode("utf-8"))["ok"])

            tools_dir = root / "tools"
            tools_dir.mkdir()
            build_py = tools_dir / "build_package.py"
            build_py.write_text("import time\nprint('BUILD_STEP_1', flush=True)\ntime.sleep(3)\n", encoding="utf-8")

            h_start = self._make_handler(tmp_dir)
            h_start.path = "/build-package-start"
            h_start.do_POST()
            self.assertTrue(json.loads(h_start.wfile.getvalue().decode("utf-8"))["ok"])

            deadline = time.time() + 3.0
            while time.time() < deadline:
                snap = PackageBuildRunner.get_stream_snapshot(0)
                if snap["running"] and "BUILD_STEP_1" in snap["chunk"]:
                    break
                time.sleep(0.05)

            h_stop = self._make_handler(tmp_dir)
            h_stop.path = "/build-package-stop"
            h_stop.do_POST()
            stop_res = json.loads(h_stop.wfile.getvalue().decode("utf-8"))
            self.assertTrue(stop_res["ok"])
            self.assertTrue(stop_res["stopped"])

            end_deadline = time.time() + 3.0
            while time.time() < end_deadline and PackageBuildRunner.get_stream_snapshot(0)["running"]:
                time.sleep(0.05)

            build_py.write_text("print('BUILD_ARTIFACT_READY')\n", encoding="utf-8")
            h_ok = self._make_handler(tmp_dir)
            h_ok.path = "/build-package"
            h_ok.do_POST()
            res_ok = json.loads(h_ok.wfile.getvalue().decode("utf-8"))
            self.assertTrue(res_ok["ok"])
            self.assertIn("BUILD_ARTIFACT_READY", res_ok["output"])

            runner = PackageBuildRunner(tmp_dir, lambda *_a: True)
            with patch.object(runner, "_run", side_effect=subprocess.TimeoutExpired("cmd", 180)):
                ok_to, err_to, code_to = runner.run_build()
                self.assertFalse(ok_to)
                self.assertEqual(code_to, 504)
                self.assertIn("180s", err_to)


if __name__ == "__main__":
    unittest.main()
