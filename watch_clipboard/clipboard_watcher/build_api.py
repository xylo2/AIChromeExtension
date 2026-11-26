import os
import subprocess
import sys
import threading
from typing import Any, Callable, Dict, List, Optional, Tuple
from clipboard_watcher.test_process_utils import terminate_process_tree


class PackageBuildRunner:
    """Résout, exécute (synchrone ou streaming) et arrête tools/build_package.py."""

    RELATIVE_SCRIPT: str = "tools/build_package.py"
    _lock: threading.Lock = threading.Lock()
    _state: Dict[str, Any] = {"running": False, "lines": [], "passed": None, "output": "", "error": "", "proc": None, "stopped": False}

    def __init__(self, target_dir: str, is_within_roots_fn: Callable[[str, list[str]], bool], run_fn: Callable[..., Any] = subprocess.run) -> None:
        self.target_dir, self._is_within_allowed_roots, self._run = target_dir, is_within_roots_fn, run_fn

    def resolve_build_script(self) -> Optional[str]:
        base_real: str = os.path.realpath(self.target_dir)
        parent_real: str = os.path.dirname(base_real)
        allowed_roots: list[str] = [base_real] + ([parent_real] if parent_real and parent_real != base_real else [])
        for search_dir in allowed_roots:
            candidate: str = os.path.realpath(os.path.join(search_dir, self.RELATIVE_SCRIPT))
            if self._is_within_allowed_roots(candidate, allowed_roots) and os.path.isfile(candidate):
                return candidate
        return None

    @classmethod
    def get_stream_snapshot(cls, offset: int) -> Dict[str, Any]:
        with cls._lock:
            lines: List[str] = list(cls._state["lines"])
            return {"ok": True, "running": cls._state["running"], "stopped": bool(cls._state.get("stopped")), "offset": len(lines), "chunk": "".join(lines[offset:]), "passed": cls._state["passed"], "output": cls._state["output"], "error": cls._state["error"]}

    @classmethod
    def stop_build(cls) -> Tuple[bool, str]:
        with cls._lock:
            if not cls._state["running"]:
                return False, "Aucune génération de package en cours."
            cls._state["stopped"] = True
            proc = cls._state.get("proc")
        if proc is not None:
            terminate_process_tree(proc)
        return True, "Arrêt de build_package.py demandé."

    def start_streaming(self) -> Tuple[bool, str, int]:
        script_path: Optional[str] = self.resolve_build_script()
        if not script_path:
            return False, "Script tools/build_package.py introuvable.", 404
        with self._lock:
            if self._state["running"]:
                return False, "Une génération de package est déjà en cours.", 409
            self._state.update({"running": True, "lines": [], "passed": None, "output": "", "error": "", "proc": None, "stopped": False})
        threading.Thread(target=self._run_worker, args=(script_path,), daemon=True).start()
        return True, "", 200

    def _run_worker(self, script_path: str) -> None:
        env = {**os.environ, "PYTHONUTF8": "1", "PYTHONIOENCODING": "utf-8", "PYTHONUNBUFFERED": "1"}
        kwargs: Dict[str, Any] = {"cwd": os.path.realpath(self.target_dir), "env": env, "stdout": subprocess.PIPE, "stderr": subprocess.STDOUT, "text": True, "encoding": "utf-8", "errors": "replace"}
        kwargs["creationflags" if os.name == "nt" else "start_new_session"] = getattr(subprocess, "CREATE_NEW_PROCESS_GROUP", 0) if os.name == "nt" else True
        try:
            proc = subprocess.Popen([sys.executable, "-u", script_path], **kwargs)
            with self._lock:
                self._state["proc"] = proc
            live_lines: List[str] = []
            assert proc.stdout is not None
            for line in proc.stdout:
                live_lines.append(line)
                with self._lock:
                    self._state["lines"].append(line)
            rc: int = proc.wait(timeout=180)
            proc.stdout.close()
            out: str = "".join(live_lines).strip()
            with self._lock:
                stopped = bool(self._state.get("stopped"))
                self._state.update({"running": False, "proc": None, "passed": (rc == 0 and not stopped), "output": out or ("Package généré avec succès." if rc == 0 else ""), "error": "" if (rc == 0 or stopped) else (out or f"Échec de build_package.py (code {rc}).")})
        except Exception as exc:
            with self._lock:
                stopped = bool(self._state.get("stopped"))
                self._state.update({"running": False, "proc": None, "passed": False, "error": "" if stopped else str(exc)})

    def run_build(self) -> Tuple[bool, str, int]:
        script_path: Optional[str] = self.resolve_build_script()
        if not script_path:
            return False, "Script tools/build_package.py introuvable.", 404
        env = {**os.environ, "PYTHONUTF8": "1", "PYTHONIOENCODING": "utf-8", "PYTHONUNBUFFERED": "1"}
        try:
            proc = self._run([sys.executable, "-u", script_path], cwd=os.path.realpath(self.target_dir), env=env, capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=180, check=False)
        except subprocess.TimeoutExpired:
            return False, "Délai dépassé (180s) pendant la génération du package.", 504
        except Exception as exc:
            return False, str(exc), 500
        out: str = ((proc.stdout or "") + "\n" + (proc.stderr or "")).strip()
        return (True, out or "Package généré avec succès.", 200) if proc.returncode == 0 else (False, out or f"Échec de build_package.py (code {proc.returncode}).", 400)
