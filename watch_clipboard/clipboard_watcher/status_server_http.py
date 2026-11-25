# Commandes pip à exécuter : Aucune dépendance externe requise (bibliothèque standard uniquement)

import json
import os
import re
import subprocess
import threading
from typing import Any, Optional, Tuple
from clipboard_watcher.http_routes import handle_get_request, handle_post_request


class StatusHttpMixin:
    """Méthodes bas niveau HTTP (CORS, réponses JSON, streaming tests en arrière-plan)."""

    def _send_cors_headers(self: Any) -> None:
        origin: str = self.headers.get("Origin", "")
        cors_val: str = self.allowed_origin or (origin if origin.startswith("chrome-extension://") else "null")
        self.send_header("Access-Control-Allow-Origin", cors_val)
        self.send_header("Vary", "Origin")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, X-Watcher-Token")
        self.send_header("Access-Control-Allow-Private-Network", "true")

    def _send_json(self: Any, status_code: int, data: dict) -> None:
        payload: bytes = json.dumps(data, ensure_ascii=False).encode("utf-8")
        try:
            self.send_response(status_code)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(payload)))
            self._send_cors_headers()
            self.end_headers()
            self.wfile.write(payload)
        except (BrokenPipeError, ConnectionAbortedError, ConnectionResetError, OSError):
            return

    def do_OPTIONS(self: Any) -> None:
        try:
            self.send_response(204)
            self._send_cors_headers()
            self.end_headers()
        except (BrokenPipeError, ConnectionAbortedError, ConnectionResetError, OSError):
            return

    def do_GET(self: Any) -> None:
        handle_get_request(self)

    def do_POST(self: Any) -> None:
        handle_post_request(self)

    def _execute_tests_streaming(self: Any, test_script: str) -> Tuple[int, str, str]:
        return self._test_mgr.execute_streaming(test_script, self.target_dir)

    def _run_tests_background(self: Any, test_script: str) -> None:
        try:
            rc, clean_out, uncovered_out = self._execute_tests_streaming(test_script)
            with self._test_lock:
                was_stopped: bool = bool(self._live_test_state.get("stopped"))
            if was_stopped:
                with self._test_lock:
                    self._live_test_state.update({"running": False, "passed": False, "output": clean_out, "uncovered": "", "error": ""})
                return
            has_warnings: bool = bool(re.search(r"(?:WARNINGS DÉTECTÉS|ResourceWarning|DeprecationWarning|UserWarning|RuntimeWarning)", clean_out))
            passed: bool = rc == 0 and not has_warnings
            with self._test_lock:
                self._live_test_state.update({"running": False, "passed": passed, "output": clean_out, "uncovered": uncovered_out if passed else "", "error": ""})
        except subprocess.TimeoutExpired:
            with self._test_lock:
                self._live_test_state.update({"running": False, "passed": False, "error": "Délai dépassé (180s) pendant les tests."})
        except Exception as exc:
            with self._test_lock:
                was_stopped_exc: bool = bool(self._live_test_state.get("stopped"))
                self._live_test_state.update({"running": False, "passed": False, "error": "" if was_stopped_exc else str(exc)})

    def log_message(self: Any, format: str, *args: object) -> None:
        return
