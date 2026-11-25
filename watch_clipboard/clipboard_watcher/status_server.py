# Commandes pip à exécuter : Aucune dépendance externe requise (bibliothèque standard uniquement)

import hmac
import json
import os
import re
import shlex
import signal
import subprocess
import sys
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any, Dict, List, Optional, Tuple
from urllib.parse import parse_qs, urlparse
from clipboard_watcher.export_api import ProjectExportRunner
from clipboard_watcher.file_reader_api import SavedFileReader
from clipboard_watcher.git_api import GitOperations
from clipboard_watcher.test_runner_api import LiveTestManager


class _QuietThreadingHTTPServer(ThreadingHTTPServer):
    """Serveur HTTP multi-thread ignorant silencieusement les coupures réseau côté client."""

    daemon_threads: bool = True

    def handle_error(self, request: Any, client_address: Any) -> None:
        exc_val = sys.exc_info()[1]
        if isinstance(exc_val, (BrokenPipeError, ConnectionAbortedError, ConnectionResetError)):
            return
        super().handle_error(request, client_address)


class _StatusRequestHandler(BaseHTTPRequestHandler):
    """Gestionnaire HTTP local pour statut, relecture, tests, export et opérations Git."""

    target_dir: str = "."
    default_test_runner: str = "tools/run_tests_clip.py"
    api_token: str = ""
    allowed_origin: str = ""
    assembler_ref: Any = None
    _test_mgr: LiveTestManager = LiveTestManager()
    _test_lock: threading.Lock = _test_mgr._lock
    _live_test_state: Dict[str, Any] = _test_mgr._state

    def _is_authorized(self) -> bool:
        if not self.api_token:
            return True
        return hmac.compare_digest(self.headers.get("X-Watcher-Token", ""), self.api_token)

    def _drain_unread_body(self, max_bytes: int = 65536) -> None:
        try:
            content_len: int = int(self.headers.get("Content-Length", "0") or "0")
            if 0 < content_len <= max_bytes:
                self.rfile.read(content_len)
        except Exception:
            pass

    def _read_json_body(self) -> Dict[str, Any]:
        try:
            content_len: int = int(self.headers.get("Content-Length", "0") or "0")
            if content_len > 0:
                parsed = json.loads(self.rfile.read(content_len).decode("utf-8"))
                if isinstance(parsed, dict):
                    return parsed
        except Exception:
            pass
        return {}
    def _is_within_allowed_roots(self, candidate: str, roots: List[str]) -> bool:
        cand_norm: str = os.path.normcase(os.path.realpath(candidate))
        for root in roots:
            root_norm: str = os.path.normcase(os.path.realpath(root))
            try:
                if os.path.commonpath([root_norm, cand_norm]) == root_norm and cand_norm != root_norm:
                    return True
            except ValueError:
                continue
        return False

    def _file_reader(self) -> SavedFileReader:
        return SavedFileReader(self.target_dir, self.assembler_ref, self._is_within_allowed_roots)

    def _normalize_header_rel_path(self, raw_rel: str, base_real: str) -> str:
        return self._file_reader().normalize_rel_path(raw_rel, base_real)

    def _read_saved_file_from_header(self, header: str) -> Tuple[bool, str, str]:
        return self._file_reader().read_from_header(header)

    def _git_ops(self) -> GitOperations:
        return GitOperations(self.target_dir, self._is_within_allowed_roots, self._find_git_root, subprocess.run)

    def _find_git_root(self) -> Optional[str]:
        return GitOperations(self.target_dir, self._is_within_allowed_roots, None, subprocess.run).find_git_root()

    def _git_status_entries(self) -> Tuple[bool, List[Dict[str, str]], str]:
        return self._git_ops().status_entries()

    def _git_diff_selected(self, files: List[str]) -> Tuple[bool, str, str]:
        return self._git_ops().diff_selected(files)

    @staticmethod
    def _format_git_push_error(raw_output: str) -> str:
        return GitOperations.format_push_error(raw_output)

    def _git_commit_and_push(self, action: str, message: str = "", files: Optional[List[str]] = None, remote: str = "origin", branch: str = "") -> Tuple[bool, str]:
        return self._git_ops().commit_and_push(action, message, files, remote, branch)

    def _exporter(self) -> ProjectExportRunner:
        return ProjectExportRunner(self.target_dir, subprocess.run)

    def _resolve_exporter_package_dir(self) -> Optional[str]:
        return self._exporter().resolve_exporter_dir()

    def _compute_export_project_label(self, target_real: str, exporter_root: str) -> str:
        return self._exporter().compute_project_label(target_real, exporter_root)

    def _run_project_export(self) -> Tuple[bool, str, str, int]:
        return self._exporter().run_export()
    def _resolve_test_runner_path(self, custom_path: str = "") -> Optional[str]:
        raw_custom: str = custom_path.strip()
        is_custom: bool = bool(raw_custom) and raw_custom != self.default_test_runner
        rel_path: str = (raw_custom or self.default_test_runner).replace("\\", "/")
        if not rel_path or rel_path.startswith("/") or os.path.isabs(rel_path) or not rel_path.endswith(".py"):
            return None
        base_real: str = os.path.realpath(self.target_dir)
        parent_real: str = os.path.dirname(base_real)
        allowed_roots: List[str] = [base_real] + ([parent_real] if parent_real and parent_real != base_real else [])
        direct_candidate: str = os.path.realpath(os.path.join(base_real, rel_path))
        if not self._is_within_allowed_roots(direct_candidate, allowed_roots):
            return None
        if os.path.isfile(direct_candidate):
            return direct_candidate
        if is_custom:
            if parent_real and parent_real != base_real:
                parent_cand: str = os.path.realpath(os.path.join(parent_real, rel_path))
                if self._is_within_allowed_roots(parent_cand, allowed_roots) and os.path.isfile(parent_cand):
                    return parent_cand
            return None
        search_dirs = [base_real, os.path.join(base_real, "watch_clipboard")]
        if parent_real and parent_real != base_real:
            search_dirs.append(parent_real)
        for search_dir in search_dirs:
            candidate: str = os.path.realpath(os.path.join(search_dir, rel_path))
            if self._is_within_allowed_roots(candidate, allowed_roots) and os.path.isfile(candidate):
                return candidate
        return None
    def _send_cors_headers(self) -> None:
        origin: str = self.headers.get("Origin", "")
        cors_val: str = self.allowed_origin or (origin if origin.startswith("chrome-extension://") else "null")
        self.send_header("Access-Control-Allow-Origin", cors_val)
        self.send_header("Vary", "Origin")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, X-Watcher-Token")
        self.send_header("Access-Control-Allow-Private-Network", "true")

    def _send_json(self, status_code: int, data: dict) -> None:
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

    def do_OPTIONS(self) -> None:
        try:
            self.send_response(204)
            self._send_cors_headers()
            self.end_headers()
        except (BrokenPipeError, ConnectionAbortedError, ConnectionResetError, OSError):
            return

    def do_GET(self) -> None:
        if not self._is_authorized():
            self._send_json(401, {"error": "unauthorized"})
            return
        parsed = urlparse(self.path)
        params = parse_qs(parsed.query)
        if parsed.path == "/read-file":
            ok, filename, content_or_err = self._read_saved_file_from_header(next(iter(params.get("header", [])), ""))
            self._send_json(200 if ok else 404, {"ok": True, "filename": filename, "content": content_or_err} if ok else {"ok": False, "error": content_or_err})
            return
        if parsed.path == "/git-status":
            ok_g, entries, err_g = self._git_status_entries()
            self._send_json(200 if ok_g else 400, {"ok": ok_g, "entries": entries, "error": err_g})
            return
        if parsed.path == "/test-stream":
            raw_off: str = next(iter(params.get("offset", ["0"])), "0").strip()
            self._send_json(200, self._test_mgr.get_stream_snapshot(max(0, int(raw_off)) if raw_off.isdigit() else 0))
            return
        if parsed.path not in ("/status", "/health", "/"):
            self._send_json(404, {"error": "not_found"})
            return
        custom_runner: str = next(iter(params.get("test_runner", [])), "")
        test_script: Optional[str] = self._resolve_test_runner_path(custom_runner)
        has_tests: bool = bool(test_script and os.path.isfile(test_script))
        self._send_json(200, {
            "status": "running", "service": "watch_clipboard", "pid": os.getpid(),
            "target_dir": os.path.realpath(self.target_dir),
            "command": " ".join(shlex.quote(a) for a in [sys.executable, *sys.argv]),
            "has_run_tests_clip": has_tests, "has_exporter": self._resolve_exporter_package_dir() is not None,
            "has_git": self._find_git_root() is not None,
            "configured_test_runner": custom_runner or self.default_test_runner,
            "test_runner_path": test_script if has_tests else None,
            "last_event": getattr(self.assembler_ref, "last_event", None),
        })

    def _execute_tests_streaming(self, test_script: str) -> Tuple[int, str, str]:
        return self._test_mgr.execute_streaming(test_script, self.target_dir)

    def _run_tests_background(self, test_script: str) -> None:
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
    def do_POST(self) -> None:
        if not self._is_authorized():
            self._drain_unread_body()
            self._send_json(401, {"ok": False, "error": "unauthorized"})
            return
        parsed = urlparse(self.path)
        if parsed.path == "/shutdown":
            self._drain_unread_body()
            self._send_json(200, {"status": "stopping", "pid": os.getpid()})
            threading.Timer(0.15, lambda: os.kill(os.getpid(), signal.SIGINT)).start()
            return
        if parsed.path == "/export-project":
            self._drain_unread_body()
            ok, filename, payload_or_err, count = self._run_project_export()
            self._send_json(200 if ok else 500, {"ok": ok, "filename": filename, "content": payload_or_err, "file_count": count} if ok else {"ok": False, "error": payload_or_err})
            return
        if parsed.path == "/git-diff":
            body_g = self._read_json_body()
            raw_files = body_g.get("files")
            selected_files: List[str] = [str(x) for x in raw_files] if isinstance(raw_files, list) else []
            ok_d, diff_txt, err_d = self._git_diff_selected(selected_files)
            self._send_json(200 if ok_d else 400, {"ok": True, "filename": "git_changes.diff.txt", "content": diff_txt, "diff": diff_txt, "file_count": len(selected_files)} if ok_d else {"ok": False, "error": err_d})
            return
        if parsed.path == "/git-commit":
            body_c = self._read_json_body()
            raw_fc = body_c.get("files")
            files_c: List[str] = [str(x) for x in raw_fc] if isinstance(raw_fc, list) else []
            ok_c, out_c = self._git_commit_and_push(str(body_c.get("action", "commit")).strip(), str(body_c.get("message", "")), files_c)
            self._send_json(200 if ok_c else 400, {"ok": ok_c, "output": out_c} if ok_c else {"ok": False, "error": out_c})
            return
        if parsed.path == "/git-push":
            body_p = self._read_json_body()
            ok_p, out_p = self._git_commit_and_push("push", remote=str(body_p.get("remote", "origin")), branch=str(body_p.get("branch", "")))
            self._send_json(200 if ok_p else 400, {"ok": ok_p, "output": out_p} if ok_p else {"ok": False, "error": out_p})
            return
        if parsed.path == "/run-tests-stop":
            self._drain_unread_body()
            ok_st, msg_st = self._test_mgr.stop()
            self._send_json(200 if ok_st else 409, {"ok": ok_st, "stopped": ok_st, "message": msg_st} if ok_st else {"ok": False, "error": msg_st})
            return
        if parsed.path in ("/run-tests", "/run-tests-start"):
            body_t = self._read_json_body()
            test_script: Optional[str] = self._resolve_test_runner_path(str(body_t.get("test_runner", "")).strip())
            if test_script is None:
                self._send_json(403, {"ok": False, "error": "Chemin du lanceur de tests non autorisé."})
                return
            if not os.path.isfile(test_script):
                self._send_json(404, {"ok": False, "error": f"Lanceur introuvable : {test_script}"})
                return
            if not self._test_mgr.try_begin():
                self._send_json(409, {"ok": False, "error": "Une exécution de tests est déjà en cours."})
                return
            if parsed.path == "/run-tests-start":
                threading.Thread(target=self._run_tests_background, args=(test_script,), daemon=True).start()
                self._send_json(200, {"ok": True, "started": True})
                return
            try:
                rc, clean_out, uncovered_out = self._execute_tests_streaming(test_script)
                has_warnings: bool = bool(re.search(r"(?:WARNINGS DÉTECTÉS|ResourceWarning|DeprecationWarning|UserWarning|RuntimeWarning)", clean_out))
                passed: bool = rc == 0 and not has_warnings
                with self._test_lock:
                    self._live_test_state.update({"running": False, "passed": passed, "output": clean_out, "uncovered": uncovered_out if passed else "", "error": ""})
                self._send_json(200, {"ok": True, "passed": passed, "returncode": rc, "output": clean_out, "uncovered": uncovered_out if passed else ""})
            except subprocess.TimeoutExpired:
                with self._test_lock:
                    self._live_test_state.update({"running": False, "passed": False, "error": "Délai dépassé (180s) pendant les tests."})
                self._send_json(504, {"ok": False, "error": "Délai dépassé (180s) pendant les tests."})
            except Exception as exc:
                with self._test_lock:
                    self._live_test_state.update({"running": False, "passed": False, "error": str(exc)})
                self._send_json(500, {"ok": False, "error": str(exc)})
            return
        self._drain_unread_body()
        self._send_json(404, {"error": "not_found"})

    def log_message(self, format: str, *args: object) -> None:
        return


class StatusServer:
    """Serveur HTTP léger exécuté dans un thread démon."""

    def __init__(self, host: str = "127.0.0.1", port: int = 18765, target_dir: str = ".", test_runner_path: str = "tools/run_tests_clip.py", api_token: str = "", allowed_origin: str = "", assembler: Any = None) -> None:
        self.host, self.port, self.target_dir = host, port, os.path.realpath(target_dir)
        self.test_runner_path, self.api_token, self.allowed_origin, self.assembler = test_runner_path, api_token, allowed_origin, assembler
        self._httpd: Optional[_QuietThreadingHTTPServer] = None
        self._thread: Optional[threading.Thread] = None

    def start(self) -> bool:
        handler_cls = type("_BoundStatusHandler", (_StatusRequestHandler,), {"target_dir": self.target_dir, "default_test_runner": self.test_runner_path, "api_token": self.api_token, "allowed_origin": self.allowed_origin, "assembler_ref": self.assembler})
        try:
            self._httpd = _QuietThreadingHTTPServer((self.host, self.port), handler_cls)
        except OSError as exc:
            print(f"[AVERTISSEMENT] Serveur de statut impossible sur {self.host}:{self.port} ({exc})")
            return False
        self._thread = threading.Thread(target=self._httpd.serve_forever, daemon=True)
        self._thread.start()
        print(f"API de statut active : http://{self.host}:{self.port}/status")
        return True

    def stop(self) -> None:
        if self._httpd is not None:
            self._httpd.shutdown()
            self._httpd.server_close()
            self._httpd = None
