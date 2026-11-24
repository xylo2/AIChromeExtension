# Commandes pip à exécuter : Aucune dépendance externe requise (bibliothèque standard uniquement)

import hmac
import json
import os
import re
import shlex
import signal
import subprocess
import sys
import tempfile
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any, Dict, List, Optional, Tuple
from urllib.parse import parse_qs, urlparse


class _QuietThreadingHTTPServer(ThreadingHTTPServer):
    """Serveur HTTP multi-thread ignorant silencieusement les coupures réseau côté client."""

    daemon_threads: bool = True

    def handle_error(self, request: Any, client_address: Any) -> None:
        exc = sys.exc_info()
        if isinstance(exc, (BrokenPipeError, ConnectionAbortedError, ConnectionResetError)):
            return
        super().handle_error(request, client_address)


class _StatusRequestHandler(BaseHTTPRequestHandler):
    """Gestionnaire HTTP local pour statut, relecture, tests, export et opérations Git."""

    target_dir: str = "."
    default_test_runner: str = "tools/run_tests_clip.py"
    api_token: str = ""
    allowed_origin: str = ""
    assembler_ref: Any = None

    def _is_authorized(self) -> bool:
        if not self.api_token:
            return True
        provided: str = self.headers.get("X-Watcher-Token", "")
        return hmac.compare_digest(provided, self.api_token)

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

    def _normalize_header_rel_path(self, raw_rel: str, base_real: str) -> str:
        rel_norm: str = raw_rel.replace("\\", "/")
        if self.assembler_ref is not None and hasattr(self.assembler_ref, "_strip_redundant_base_prefix"):
            return str(self.assembler_ref._strip_redundant_base_prefix(rel_norm))
        base_name: str = os.path.basename(base_real)
        prefix: str = f"{base_name}/"
        if base_name and rel_norm.lower().startswith(prefix.lower()):
            stripped: str = rel_norm[len(prefix):]
            if stripped:
                return stripped
        return rel_norm
    def _read_saved_file_from_header(self, header: str) -> Tuple[bool, str, str]:
        clean_header: str = header.strip()
        if not clean_header:
            return False, "", "En-tête de fichier vide."
        base_real: str = os.path.realpath(self.target_dir)
        temp_dir_name: str = ".watch_clipboard"
        encoding: str = "utf-8"
        if self.assembler_ref is not None:
            base_real = os.path.realpath(getattr(self.assembler_ref, "base_dir", base_real))
            cfg = getattr(self.assembler_ref, "config", None)
            if cfg is not None:
                temp_dir_name = getattr(cfg, "temp_dir_name", temp_dir_name)
                encoding = getattr(cfg, "encoding", encoding)
        temp_real: str = os.path.realpath(os.path.join(base_real, temp_dir_name))
        if "|" in clean_header:
            rel_part, part_spec = [x.strip() for x in clean_header.split("|", 1)]
            rel_norm: str = self._normalize_header_rel_path(rel_part, base_real)
            if not rel_norm or rel_norm.startswith("/") or os.path.isabs(rel_norm):
                return False, "", "Chemin relatif non autorisé."
            num_str: str = next(iter(part_spec.split("/", 1)), "").strip()
            if not num_str.isdigit() or int(num_str) < 1:
                return False, "", "Numéro de partie invalide."
            part_num: int = int(num_str)
            candidate: str = os.path.realpath(os.path.join(temp_real, f"{rel_norm}.part{part_num}"))
            if not self._is_within_allowed_roots(candidate, [temp_real]):
                return False, "", "Chemin cache hors périmètre autorisé."
            attach_name: str = f"{os.path.basename(rel_norm)}.part{part_num}.txt"
        else:
            rel_norm = self._normalize_header_rel_path(clean_header, base_real)
            if not rel_norm or rel_norm.startswith("/") or os.path.isabs(rel_norm):
                return False, "", "Chemin relatif non autorisé."
            candidate = os.path.realpath(os.path.join(base_real, rel_norm))
            if not self._is_within_allowed_roots(candidate, [base_real]):
                return False, "", "Chemin cible hors périmètre autorisé."
            attach_name = os.path.basename(rel_norm)
        if not os.path.isfile(candidate):
            return False, "", f"Fichier introuvable sur disque : {candidate}"
        with open(candidate, "r", encoding=encoding, errors="replace") as f_in:
            return True, attach_name, f_in.read()

    def _find_git_root(self) -> Optional[str]:
        base_real: str = os.path.realpath(self.target_dir)
        try:
            proc = subprocess.run(
                ["git", "rev-parse", "--show-toplevel"],
                cwd=base_real, capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=10, check=False,
            )
            if proc.returncode == 0 and proc.stdout.strip():
                return os.path.realpath(proc.stdout.strip())
        except Exception:
            pass
        return None

    def _git_status_entries(self) -> Tuple[bool, List[Dict[str, str]], str]:
        git_root: Optional[str] = self._find_git_root()
        if not git_root:
            return False, [], "Aucun dépôt Git détecté."
        base_real: str = os.path.realpath(self.target_dir)
        cmd: List[str] = ["git", "-c", "core.quotePath=false", "status", "--porcelain", "-uall"]
        if base_real != git_root and self._is_within_allowed_roots(base_real, [git_root]):
            rel_scope: str = os.path.relpath(base_real, git_root).replace("\\", "/")
            cmd.extend(["--", rel_scope])
        proc = subprocess.run(cmd, cwd=git_root, capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=15, check=False)
        if proc.returncode != 0:
            return False, [], (proc.stderr or proc.stdout or "Erreur git status").strip()
        entries: List[Dict[str, str]] = []
        for raw_line in proc.stdout.splitlines():
            if len(raw_line) < 4:
                continue
            code: str = raw_line[:2].strip() or "M"
            rel_path: str = raw_line[3:].strip().strip('"')
            if " -> " in rel_path:
                _, rel_path = rel_path.split(" -> ", 1)
            if rel_path:
                entries.append({"status": code, "path": rel_path.replace("\\", "/")})
        return True, entries, ""
    def _git_diff_selected(self, files: List[str]) -> Tuple[bool, str, str]:
        git_root: Optional[str] = self._find_git_root()
        if not git_root:
            return False, "", "Aucun dépôt Git détecté."
        clean_files: List[str] = []
        for item in files:
            rel: str = str(item).strip().replace("\\", "/")
            if not rel or rel.startswith("/") or os.path.isabs(rel):
                continue
            cand: str = os.path.realpath(os.path.join(git_root, rel))
            if self._is_within_allowed_roots(cand, [git_root]):
                clean_files.append(rel)
        if not clean_files:
            return False, "", "Aucun fichier valide sélectionné."
        chunks: List[str] = []
        st_proc = subprocess.run(["git", "status", "--short", "--", *clean_files], cwd=git_root, capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=15, check=False)
        if st_proc.stdout.strip():
            chunks.append("=== GIT STATUS ===\n" + st_proc.stdout.strip())
        has_head = subprocess.run(["git", "rev-parse", "--verify", "HEAD"], cwd=git_root, capture_output=True, check=False).returncode == 0
        diff_cmd: List[str] = ["git", "diff", "HEAD", "--", *clean_files] if has_head else ["git", "diff", "--", *clean_files]
        diff_proc = subprocess.run(diff_cmd, cwd=git_root, capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=20, check=False)
        if diff_proc.stdout.strip():
            chunks.append("=== GIT DIFF ===\n" + diff_proc.stdout.strip())
        for rel in clean_files:
            full_p: str = os.path.join(git_root, rel)
            ut_proc = subprocess.run(["git", "ls-files", "--others", "--exclude-standard", "--", rel], cwd=git_root, capture_output=True, text=True, check=False)
            if ut_proc.stdout.strip() and os.path.isfile(full_p):
                with open(full_p, "r", encoding="utf-8", errors="replace") as f_ut:
                    chunks.append(f"=== NOUVEAU FICHIER : {rel} ===\n" + f_ut.read()[:12000])
        combined: str = "\n\n".join(chunks).strip() or "Modifications sélectionnées sans diff textuel."
        return True, combined, ""

    @staticmethod
    def _format_git_push_error(raw_output: str) -> str:
        lines: List[str] = [ln.strip() for ln in raw_output.splitlines() if ln.strip()]
        if not lines:
            return "Échec de git push (sortie vide)."
        priority_prefixes: Tuple[str, ...] = ("fatal:", "error:", "! [", "remote: error", "permission denied")
        important: List[str] = [ln for ln in lines if any(ln.lower().startswith(pref) for pref in priority_prefixes)]
        summary: str = " | ".join(important[:2]) if important else lines[-1]
        low_all: str = raw_output.lower()
        if "terminal prompts disabled" in low_all or "could not read username" in low_all:
            summary += "\nConseil : exécutez `git config --global credential.helper manager` dans un terminal."
        return f"{summary}\n\nSortie complète Git :\n{raw_output.strip()}" if len(lines) > 1 else summary

    def _git_commit_and_push(self, action: str, message: str = "", files: Optional[List[str]] = None, remote: str = "origin", branch: str = "") -> Tuple[bool, str]:
        git_root: Optional[str] = self._find_git_root()
        if not git_root:
            return False, "Aucun dépôt Git détecté."
        env: Dict[str, str] = {**os.environ, "GIT_TERMINAL_PROMPT": "0"}
        if action == "commit":
            clean_msg: str = message.strip()
            if not clean_msg:
                return False, "Message de commit vide."
            safe_files: List[str] = [
                str(item).strip().replace("\\", "/")
                for item in (files or [])
                if str(item).strip() and not os.path.isabs(str(item).strip())
                and self._is_within_allowed_roots(os.path.realpath(os.path.join(git_root, str(item).strip())), [git_root])
            ]
            if safe_files:
                subprocess.run(["git", "reset", "-q"], cwd=git_root, env=env, capture_output=True, timeout=15, check=False)
                add_cmd: List[str] = ["git", "add", "-A", "--", *safe_files]
            else:
                add_cmd = ["git", "add", "-A"]
            add_proc = subprocess.run(add_cmd, cwd=git_root, env=env, capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=20, check=False)
            if add_proc.returncode != 0:
                return False, (add_proc.stderr or add_proc.stdout or "Échec de git add.").strip()
            proc = subprocess.run(["git", "commit", "-m", clean_msg], cwd=git_root, env=env, capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=25, check=False)
            out: str = (proc.stdout or proc.stderr or "").strip()
            return (True, out) if proc.returncode == 0 else (False, out or "Échec de git commit.")
        if action == "push":
            clean_remote: str = (remote or "origin").strip() or "origin"
            clean_branch: str = (branch or "").strip()
            ref_re = re.compile(r"^[A-Za-z0-9._/-]+$")
            if not ref_re.match(clean_remote) or clean_remote.startswith("-") or (clean_branch and (not ref_re.match(clean_branch) or clean_branch.startswith("-"))):
                return False, "Paramètres remote ou branch invalides."
            target_ref: str = clean_branch or "HEAD"
            if os.name == "nt" and not env.get("HOME") and env.get("USERPROFILE"):
                env["HOME"] = env["USERPROFILE"]
            p_pu = subprocess.run(["git", "push", "-u", clean_remote, target_ref], cwd=git_root, env=env, capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=55, check=False)
            out_p: str = ((p_pu.stderr or "") + "\n" + (p_pu.stdout or "")).strip()
            return (True, out_p or f"Push effectué vers {clean_remote}/{target_ref}.") if p_pu.returncode == 0 else (False, self._format_git_push_error(out_p))
        return False, "Action Git inconnue."
    def _resolve_exporter_package_dir(self) -> Optional[str]:
        base_real: str = os.path.realpath(self.target_dir)
        parent_real: str = os.path.dirname(base_real)
        watcher_dir: str = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
        watcher_parent: str = os.path.dirname(watcher_dir)
        for cand in (os.path.join(base_real, "export"), os.path.join(base_real, "tools", "export"), os.path.join(parent_real, "export"), os.path.join(parent_real, "tools", "export"), os.path.join(watcher_parent, "export")):
            if os.path.isdir(os.path.join(cand, "project_exporter")):
                return cand
        return None

    def _compute_export_project_label(self, target_real: str, exporter_root: str) -> str:
        raw_norm: str = self.target_dir.strip().replace("\\", "/").strip("/")
        if raw_norm and raw_norm != "." and not os.path.isabs(raw_norm):
            parts: List[str] = [p for p in raw_norm.split("/") if p and p != "."]
            if len(parts) >= 2 and ".." not in parts:
                return "/".join(parts)
        exp_parent: str = os.path.dirname(os.path.realpath(exporter_root))
        workspace_root: str = os.path.dirname(exp_parent) if os.path.basename(exp_parent).lower() == "tools" else exp_parent
        try:
            if os.path.commonpath([workspace_root, target_real]) == workspace_root and target_real != workspace_root:
                rel_label: str = os.path.relpath(target_real, workspace_root).replace("\\", "/")
                if rel_label and not rel_label.startswith(".."):
                    return rel_label
        except ValueError:
            pass
        return os.path.basename(target_real) or "project"

    def _run_project_export(self) -> Tuple[bool, str, str, int]:
        exporter_root: Optional[str] = self._resolve_exporter_package_dir()
        if not exporter_root:
            return False, "", "Package project_exporter introuvable dans le workspace.", 0
        target_real: str = os.path.realpath(self.target_dir)
        project_label: str = self._compute_export_project_label(target_real, exporter_root)
        with tempfile.TemporaryDirectory(prefix="watch_clip_export_") as tmp_dir:
            code: str = "import logging, sys; from pathlib import Path; from project_exporter.config import ExporterConfig; from project_exporter.exporter import ProjectExporter; logger = logging.getLogger('export'); logger.addHandler(logging.NullHandler()); _, exp_s, target_s, out_s, proj_label = sys.argv; exp_root, target, out_dir = Path(exp_s), Path(target_s), Path(out_s); cfg = ExporterConfig(exp_root / 'config.ini', logger); fname = cfg.build_output_filename(proj_label); out_file = out_dir / fname; cnt = ProjectExporter(target, cfg, out_file, exp_root / 'export_project.py', logger).export(); print(f'{fname}|{cnt}')"
            env = {**os.environ, "PYTHONUTF8": "1", "PYTHONIOENCODING": "utf-8", "PYTHONPATH": exporter_root}
            proc = subprocess.run([sys.executable, "-c", code, exporter_root, target_real, tmp_dir, project_label], cwd=target_real, env=env, capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=60, check=False)
            if proc.returncode != 0:
                return False, "", (proc.stderr or proc.stdout or "Erreur export").strip(), 0
            fname_out, cnt_str = (proc.stdout or "").strip().splitlines()[-1].split("|", 1)
            out_path: str = os.path.join(tmp_dir, fname_out)
            if not os.path.isfile(out_path):
                return False, "", "Fichier d'export non généré.", 0
            with open(out_path, "r", encoding="utf-8", errors="replace") as f_out:
                return True, fname_out, f_out.read(), int(cnt_str)

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
    def _send_cors_headers(self) -> None:
        origin: str = self.headers.get("Origin", "")
        self.send_header("Access-Control-Allow-Origin", self.allowed_origin or (origin if origin.startswith("chrome-extension://") else "null"))
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
            self._send_json(200 if ok else 404, {"ok": ok, "filename": filename, "content": content_or_err} if ok else {"ok": False, "error": content_or_err})
            return
        if parsed.path == "/git-status":
            ok_g, entries, err_g = self._git_status_entries()
            self._send_json(200 if ok_g else 400, {"ok": ok_g, "entries": entries, "error": err_g})
            return
        if parsed.path not in ("/status", "/health", "/"):
            self._send_json(404, {"error": "not_found"})
            return
        custom_runner: str = next(iter(params.get("test_runner", [])), "")
        test_script: Optional[str] = self._resolve_test_runner_path(custom_runner)
        has_tests: bool = bool(test_script and os.path.isfile(test_script))
        self._send_json(200, {"status": "running", "service": "watch_clipboard", "pid": os.getpid(), "target_dir": os.path.realpath(self.target_dir), "command": " ".join(shlex.quote(a) for a in [sys.executable, *sys.argv]), "has_run_tests_clip": has_tests, "has_exporter": self._resolve_exporter_package_dir() is not None, "has_git": self._find_git_root() is not None, "configured_test_runner": custom_runner or self.default_test_runner, "test_runner_path": test_script if has_tests else None, "last_event": getattr(self.assembler_ref, "last_event", None)})

    def _execute_tests_streaming(self, test_script: str) -> Tuple[int, str, str]:
        env = {**os.environ, "PYTHONUTF8": "1", "PYTHONIOENCODING": "utf-8", "PYTHONUNBUFFERED": "1"}
        is_clip_runner: bool = os.path.basename(test_script) == "run_tests_clip.py"
        with tempfile.TemporaryDirectory(prefix="watch_clip_tests_") as tmp_dir:
            report_path: str = os.path.join(tmp_dir, "compact_report.txt")
            coverage_path: str = os.path.join(tmp_dir, "coverage_report.txt")
            cmd: List[str] = [sys.executable, "-u", test_script]
            if is_clip_runner:
                cmd.extend(["--no-clipboard", "--report-file", report_path, "--coverage-file", coverage_path])
            proc = subprocess.Popen(cmd, cwd=os.path.realpath(self.target_dir), env=env, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, encoding="utf-8", errors="replace")
            timed_out: List[bool] = []
            watchdog = threading.Timer(180.0, lambda: (timed_out.append(True), proc.kill()))
            watchdog.daemon = True
            watchdog.start()
            live_lines: List[str] = []
            try:
                assert proc.stdout is not None
                for line in proc.stdout:
                    sys.stdout.write(line)
                    sys.stdout.flush()
                    live_lines.append(line)
                rc: int = proc.wait(timeout=10)
            finally:
                watchdog.cancel()
                if proc.stdout is not None:
                    proc.stdout.close()
            if timed_out:
                raise subprocess.TimeoutExpired(cmd=cmd, timeout=180)
            compact_out: str = open(report_path, "r", encoding="utf-8", errors="replace").read().strip() if (is_clip_runner and os.path.isfile(report_path)) else "".join(live_lines).strip()
            uncovered_out: str = open(coverage_path, "r", encoding="utf-8", errors="replace").read().strip() if (is_clip_runner and os.path.isfile(coverage_path)) else ""
            clean_out: str = re.sub(r"^\[PRESSE-PAPIERS\].*$", "", compact_out, flags=re.MULTILINE).strip()
            return rc, clean_out, uncovered_out
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
        if parsed.path == "/run-tests":
            body_t = self._read_json_body()
            test_script: Optional[str] = self._resolve_test_runner_path(str(body_t.get("test_runner", "")).strip())
            if test_script is None:
                self._send_json(403, {"ok": False, "error": "Chemin du lanceur de tests non autorisé."})
                return
            if not os.path.isfile(test_script):
                self._send_json(404, {"ok": False, "error": f"Lanceur introuvable : {test_script}"})
                return
            try:
                rc, clean_out, uncovered_out = self._execute_tests_streaming(test_script)
                has_warnings: bool = bool(re.search(r"(?:WARNINGS DÉTECTÉS|ResourceWarning|DeprecationWarning|UserWarning|RuntimeWarning)", clean_out))
                self._send_json(200, {"ok": True, "passed": rc == 0 and not has_warnings, "returncode": rc, "output": clean_out, "uncovered": uncovered_out if (rc == 0 and not has_warnings) else ""})
            except subprocess.TimeoutExpired:
                self._send_json(504, {"ok": False, "error": "Délai dépassé (180s) pendant les tests."})
            except Exception as exc:
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
