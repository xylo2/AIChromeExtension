# Commandes pip à exécuter : Aucune dépendance externe requise (bibliothèque standard uniquement)

import os
import shlex
import signal
import sys
import threading
from typing import Any, List, Optional
from urllib.parse import parse_qs, urlparse
from clipboard_watcher.export_api import ProjectExportRunner
from clipboard_watcher.http_routes_tests import handle_run_tests_route


def handle_get_request(handler: Any) -> None:
    if not handler._is_authorized():
        handler._send_json(401, {"error": "unauthorized"})
        return
    parsed = urlparse(handler.path)
    params = parse_qs(parsed.query)
    if parsed.path == "/read-file":
        ok, filename, content_or_err = handler._read_saved_file_from_header(next(iter(params.get("header", [])), ""))
        handler._send_json(200 if ok else 404, {"ok": True, "filename": filename, "content": content_or_err} if ok else {"ok": False, "error": content_or_err})
        return
    if parsed.path == "/last-syntax-error":
        syn_err = getattr(handler.assembler_ref, "last_syntax_error", None)
        handler._send_json(200, {"ok": bool(syn_err), "syntax_error": syn_err})
        return
    if parsed.path == "/export-folders":
        handler._send_json(200, {"ok": True, "folders": handler._exporter().list_top_folders()})
        return
    if parsed.path == "/git-status":
        ok_g, entries, err_g = handler._git_status_entries()
        handler._send_json(200 if ok_g else 400, {"ok": ok_g, "entries": entries, "error": err_g})
        return
    if parsed.path == "/test-stream":
        raw_off: str = next(iter(params.get("offset", ["0"])), "0").strip()
        handler._send_json(200, handler._test_mgr.get_stream_snapshot(max(0, int(raw_off)) if raw_off.isdigit() else 0))
        return
    if parsed.path not in ("/status", "/health", "/"):
        handler._send_json(404, {"error": "not_found"})
        return
    custom_runner: str = next(iter(params.get("test_runner", [])), "")
    test_script: Optional[str] = handler._resolve_test_runner_path(custom_runner)
    has_tests: bool = bool(test_script and os.path.isfile(test_script))
    syn_err = getattr(handler.assembler_ref, "last_syntax_error", None)
    handler._send_json(200, {
        "status": "running", "service": "watch_clipboard", "pid": os.getpid(),
        "target_dir": os.path.realpath(handler.target_dir),
        "command": " ".join(shlex.quote(a) for a in [sys.executable, *sys.argv]),
        "has_run_tests_clip": has_tests, "has_exporter": handler._resolve_exporter_package_dir() is not None,
        "has_git": handler._find_git_root() is not None,
        "configured_test_runner": custom_runner or handler.default_test_runner,
        "test_runner_path": test_script if has_tests else None,
        "last_event": getattr(handler.assembler_ref, "last_event", None),
        "recent_events": list(getattr(handler.assembler_ref, "recent_events", [])),
        "has_syntax_error": bool(syn_err),
    })


def handle_post_request(handler: Any) -> None:
    if not handler._is_authorized():
        handler._drain_unread_body()
        handler._send_json(401, {"ok": False, "error": "unauthorized"})
        return
    parsed = urlparse(handler.path)
    if parsed.path == "/shutdown":
        handler._drain_unread_body()
        handler._send_json(200, {"status": "stopping", "pid": os.getpid()})
        threading.Timer(0.15, lambda: os.kill(os.getpid(), signal.SIGINT)).start()
        return
    if parsed.path == "/export-project":
        body_e = handler._read_json_body()
        export_mode: str = ProjectExportRunner.normalize_mode(str(body_e.get("mode", "full")))
        subpaths: List[str] = [str(x) for x in body_e.get("subpaths")] if isinstance(body_e.get("subpaths"), list) else []
        ok, filename, payload_or_err, count = handler._run_project_export(mode=export_mode, subpaths=subpaths)
        est_tokens: int = ProjectExportRunner.estimate_tokens(payload_or_err) if ok else 0
        handler._send_json(200 if ok else 500, {"ok": ok, "filename": filename, "content": payload_or_err, "file_count": count, "estimated_tokens": est_tokens, "mode": export_mode} if ok else {"ok": False, "error": payload_or_err})
        return
    if parsed.path == "/git-diff":
        body_g = handler._read_json_body()
        selected_files: List[str] = [str(x) for x in body_g.get("files")] if isinstance(body_g.get("files"), list) else []
        ok_d, diff_txt, err_d = handler._git_diff_selected(selected_files)
        handler._send_json(200 if ok_d else 400, {"ok": True, "filename": "git_changes.diff.txt", "content": diff_txt, "diff": diff_txt, "file_count": len(selected_files), "estimated_tokens": ProjectExportRunner.estimate_tokens(diff_txt)} if ok_d else {"ok": False, "error": err_d})
        return
    if parsed.path == "/git-commit":
        body_c = handler._read_json_body()
        files_c: List[str] = [str(x) for x in body_c.get("files")] if isinstance(body_c.get("files"), list) else []
        ok_c, out_c = handler._git_commit_and_push(str(body_c.get("action", "commit")).strip(), str(body_c.get("message", "")), files_c)
        handler._send_json(200 if ok_c else 400, {"ok": ok_c, "output": out_c} if ok_c else {"ok": False, "error": out_c})
        return
    if parsed.path == "/git-push":
        body_p = handler._read_json_body()
        ok_p, out_p = handler._git_commit_and_push("push", remote=str(body_p.get("remote", "origin")), branch=str(body_p.get("branch", "")))
        handler._send_json(200 if ok_p else 400, {"ok": ok_p, "output": out_p} if ok_p else {"ok": False, "error": out_p})
        return
    if parsed.path == "/run-tests-stop":
        handler._drain_unread_body()
        ok_st, msg_st = handler._test_mgr.stop()
        handler._send_json(200 if ok_st else 409, {"ok": ok_st, "stopped": ok_st, "message": msg_st} if ok_st else {"ok": False, "error": msg_st})
        return
    if parsed.path in ("/run-tests", "/run-tests-start"):
        handle_run_tests_route(handler, parsed.path == "/run-tests-start")
        return
    handler._drain_unread_body()
    handler._send_json(404, {"error": "not_found"})
