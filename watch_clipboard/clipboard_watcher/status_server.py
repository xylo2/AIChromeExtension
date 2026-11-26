# Commandes pip à exécuter : Aucune dépendance externe requise (bibliothèque standard uniquement)

import hmac
import json
import os
import subprocess
import sys
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any, Dict, List, Optional, Tuple
from clipboard_watcher.export_api import ProjectExportRunner
from clipboard_watcher.file_reader_api import SavedFileReader
from clipboard_watcher.git_api import GitOperations
from clipboard_watcher.status_server_http import StatusHttpMixin
from clipboard_watcher.test_runner_api import LiveTestManager


class _QuietThreadingHTTPServer(ThreadingHTTPServer):
    """Serveur HTTP multi-thread ignorant silencieusement les coupures réseau côté client."""

    daemon_threads: bool = True

    def handle_error(self, request: Any, client_address: Any) -> None:
        exc_val = sys.exc_info()[1]
        if isinstance(exc_val, (BrokenPipeError, ConnectionAbortedError, ConnectionResetError)):
            return
        super().handle_error(request, client_address)


class _StatusRequestHandler(StatusHttpMixin, BaseHTTPRequestHandler):
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
        return True if not self.api_token else hmac.compare_digest(self.headers.get("X-Watcher-Token", ""), self.api_token)

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

    def _run_project_export(self, mode: str = "full", subpaths: Optional[List[str]] = None) -> Tuple[bool, str, str, int]:
        return self._exporter().run_export(mode=mode, subpaths=subpaths)

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
        for search_dir in [base_real, os.path.join(base_real, "watch_clipboard")] + ([parent_real] if parent_real and parent_real != base_real else []):
            candidate: str = os.path.realpath(os.path.join(search_dir, rel_path))
            if self._is_within_allowed_roots(candidate, allowed_roots) and os.path.isfile(candidate):
                return candidate
        return None


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
