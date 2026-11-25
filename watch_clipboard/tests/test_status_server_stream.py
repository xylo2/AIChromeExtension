# Commandes pip à exécuter : Aucune dépendance externe requise (lancer avec : python -m unittest discover tests)

import io
import json
import os
from pathlib import Path
import tempfile
import time
import unittest
from unittest.mock import patch

from clipboard_watcher.status_server import _StatusRequestHandler
from clipboard_watcher.test_runner_api import LiveTestManager


class TestStatusServerStreamAndStop(unittest.TestCase):
    """Vérifie le streaming en direct et l'arrêt complet de l'arbre de processus des tests."""

    def test_terminate_process_tree_calls_taskkill_on_windows(self) -> None:
        killed: list[bool] = []

        class DummyProc:
            pid = 43210

            def kill(self) -> None:
                killed.append(True)

        with patch("clipboard_watcher.test_runner_api.os.name", "nt"), patch(
            "clipboard_watcher.test_runner_api.subprocess.run"
        ) as run_mock:
            LiveTestManager._terminate_process_tree(DummyProc())  # type: ignore[arg-type]
            run_mock.assert_called_once()
            cmd_arg = run_mock.call_args.args[0]
            self.assertEqual(cmd_arg, ["taskkill", "/F", "/T", "/PID", "43210"])
            self.assertEqual(killed, [True])

    def test_stop_endpoint_and_live_test_manager(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            root = Path(tmp_dir)
            runner = root / "slow_runner.py"
            runner.write_text("import time; print('START', flush=True); time.sleep(5)\n", encoding="utf-8")

            handler = object.__new__(_StatusRequestHandler)
            handler.target_dir = tmp_dir
            handler.default_test_runner = "slow_runner.py"
            handler.api_token = ""
            handler.allowed_origin = ""
            handler.assembler_ref = None
            handler.headers = {"Origin": "chrome-extension://abc"}  # type: ignore[assignment]
            handler.send_response = lambda *_a, **_kw: None  # type: ignore[method-assign]
            handler.send_header = lambda *_a, **_kw: None  # type: ignore[method-assign]
            handler.end_headers = lambda: None  # type: ignore[method-assign]

            handler.path = "/run-tests-stop"
            handler.wfile = io.BytesIO()
            handler.do_POST()
            self.assertFalse(json.loads(handler.wfile.getvalue().decode("utf-8"))["ok"])

            body = json.dumps({"test_runner": "slow_runner.py"}).encode("utf-8")
            handler.path = "/run-tests-start"
            handler.headers = {"Content-Length": str(len(body)), "Origin": "chrome-extension://abc"}  # type: ignore[assignment]
            handler.rfile = io.BytesIO(body)
            handler.wfile = io.BytesIO()
            handler.do_POST()
            self.assertTrue(json.loads(handler.wfile.getvalue().decode("utf-8"))["ok"])

            deadline = time.time() + 3.0
            while time.time() < deadline:
                snap = handler._test_mgr.get_stream_snapshot(0)
                if snap["running"] and "START" in snap["chunk"]:
                    break
                time.sleep(0.05)

            handler.path = "/run-tests-stop"
            handler.headers = {"Content-Length": "0"}  # type: ignore[assignment]
            handler.wfile = io.BytesIO()
            handler.do_POST()
            stop_res = json.loads(handler.wfile.getvalue().decode("utf-8"))
            self.assertTrue(stop_res["ok"])
            self.assertTrue(stop_res["stopped"])

            end_deadline = time.time() + 3.0
            while time.time() < end_deadline and handler._test_mgr.get_stream_snapshot(0)["running"]:
                time.sleep(0.05)
            final_snap = handler._test_mgr.get_stream_snapshot(0)
            self.assertFalse(final_snap["running"])
            self.assertTrue(final_snap["stopped"])


if __name__ == "__main__":
    unittest.main()
