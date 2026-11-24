# Commandes pip à exécuter : Aucune dépendance externe requise (lancer avec : python -m unittest discover tests)

import json
import os
import subprocess
import tempfile
import time
import unittest
from unittest.mock import patch
import urllib.error
import urllib.request
from clipboard_watcher.status_server import StatusServer, _StatusRequestHandler


class TestStatusServerTestStream(unittest.TestCase):
    """Vérifie l'exécution asynchrone des tests, les erreurs stream et le flux /test-stream."""

    def setUp(self) -> None:
        self.tmp_dir: tempfile.TemporaryDirectory[str] = tempfile.TemporaryDirectory()
        self.base_dir: str = self.tmp_dir.name
        self.runner_path: str = os.path.join(self.base_dir, "slow_runner.py")
        with open(self.runner_path, "w", encoding="utf-8") as f:
            f.write(
                "import sys, time\n"
                "print('ETAPE_1', flush=True)\n"
                "time.sleep(0.15)\n"
                "print('ETAPE_2', flush=True)\n"
            )
        self.server: StatusServer = StatusServer(
            host="127.0.0.1",
            port=0,
            target_dir=self.base_dir,
            test_runner_path="slow_runner.py",
            api_token="secret-stream-token",
        )
        self.assertTrue(self.server.start())
        assert self.server._httpd is not None
        _, bound_port = self.server._httpd.server_address
        self.port: int = int(bound_port)

    def tearDown(self) -> None:
        self.server.stop()
        self.tmp_dir.cleanup()

    def _req(self, path: str, data: bytes | None = None) -> dict:
        url: str = f"http://127.0.0.1:{self.port}{path}"
        headers = {"X-Watcher-Token": "secret-stream-token", "Content-Type": "application/json"}
        req = urllib.request.Request(url, data=data, headers=headers, method="POST" if data is not None else "GET")
        with urllib.request.urlopen(req, timeout=10) as resp:
            return json.loads(resp.read().decode("utf-8"))

    def test_async_test_stream_delivers_chunks_until_completion(self) -> None:
        started = self._req("/run-tests-start", data=b"{}")
        self.assertTrue(started.get("ok"))
        self.assertTrue(started.get("started"))

        with self.assertRaises(urllib.error.HTTPError) as conflict_err:
            self._req("/run-tests-start", data=b"{}")
        self.assertEqual(conflict_err.exception.code, 409)

        offset: int = 0
        collected: str = ""
        final_state: dict = {}
        for _ in range(40):
            st = self._req(f"/test-stream?offset={offset}")
            self.assertTrue(st.get("ok"))
            collected += st.get("chunk", "")
            offset = int(st.get("offset", offset))
            final_state = st
            if not st.get("running"):
                break
            time.sleep(0.08)

        self.assertFalse(final_state.get("running"))
        self.assertTrue(final_state.get("passed"))
        self.assertIn("ETAPE_1", collected)
        self.assertIn("ETAPE_2", collected)
        self.assertIn("ETAPE_2", final_state.get("output", ""))

    def test_background_test_stream_timeout_and_exception_branches(self) -> None:
        handler = object.__new__(_StatusRequestHandler)
        with patch.object(handler, "_execute_tests_streaming", side_effect=subprocess.TimeoutExpired("c", 180)):
            handler._run_tests_background("dummy.py")
        self.assertIn("180s", _StatusRequestHandler._live_test_state["error"])

        with patch.object(handler, "_execute_tests_streaming", side_effect=ValueError("boom_bg")):
            handler._run_tests_background("dummy.py")
        self.assertEqual(_StatusRequestHandler._live_test_state["error"], "boom_bg")


if __name__ == "__main__":
    unittest.main()
