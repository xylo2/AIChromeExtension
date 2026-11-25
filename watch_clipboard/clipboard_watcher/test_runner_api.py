# Commandes pip à exécuter : Aucune dépendance externe requise (bibliothèque standard uniquement)

import os
import subprocess
import sys
import tempfile
import threading
from typing import Any, Dict, List, Tuple
from clipboard_watcher.test_process_utils import read_runner_reports, terminate_process_tree


class LiveTestManager:
    """Gère l'exécution asynchrone, le streaming et l'arrêt complet des tests unitaires."""

    def __init__(self) -> None:
        self._lock: threading.Lock = threading.Lock()
        self._state: Dict[str, Any] = {
            "running": False,
            "lines": [],
            "passed": None,
            "output": "",
            "uncovered": "",
            "error": "",
            "proc": None,
            "stopped": False,
        }

    def get_stream_snapshot(self, offset: int) -> Dict[str, Any]:
        with self._lock:
            lines: List[str] = list(self._state["lines"])
            return {
                "ok": True,
                "running": self._state["running"],
                "stopped": bool(self._state.get("stopped")),
                "offset": len(lines),
                "chunk": "".join(lines[offset:]),
                "passed": self._state["passed"],
                "output": self._state["output"],
                "uncovered": self._state["uncovered"],
                "error": self._state["error"],
            }

    @staticmethod
    def _terminate_process_tree(proc: subprocess.Popen[str]) -> None:
        terminate_process_tree(proc)

    def stop(self) -> Tuple[bool, str]:
        with self._lock:
            if not self._state["running"]:
                return False, "Aucune exécution de tests en cours."
            self._state["stopped"] = True
            proc = self._state.get("proc")
        if proc is not None:
            self._terminate_process_tree(proc)
        return True, "Arrêt complet de l'arbre de processus demandé."

    def try_begin(self) -> bool:
        with self._lock:
            if self._state["running"]:
                return False
            self._state.update({
                "running": True, "lines": [], "passed": None,
                "output": "", "uncovered": "", "error": "", "proc": None, "stopped": False,
            })
            return True

    def execute_streaming(self, test_script: str, target_dir: str) -> Tuple[int, str, str]:
        env = {**os.environ, "PYTHONUTF8": "1", "PYTHONIOENCODING": "utf-8", "PYTHONUNBUFFERED": "1"}
        is_clip_runner: bool = os.path.basename(test_script) == "run_tests_clip.py"
        with tempfile.TemporaryDirectory(prefix="watch_clip_tests_") as tmp_dir:
            report_path: str = os.path.join(tmp_dir, "compact_report.txt")
            coverage_path: str = os.path.join(tmp_dir, "coverage_report.txt")
            cmd: List[str] = [sys.executable, "-u", test_script]
            if is_clip_runner:
                cmd.extend(["--no-clipboard", "--report-file", report_path, "--coverage-file", coverage_path])
            popen_kwargs: Dict[str, Any] = {
                "cwd": os.path.realpath(target_dir), "env": env,
                "stdout": subprocess.PIPE, "stderr": subprocess.STDOUT,
                "text": True, "encoding": "utf-8", "errors": "replace",
            }
            if os.name == "nt":
                popen_kwargs["creationflags"] = getattr(subprocess, "CREATE_NEW_PROCESS_GROUP", 0)
            else:
                popen_kwargs["start_new_session"] = True
            proc: subprocess.Popen[str] = subprocess.Popen(cmd, **popen_kwargs)
            with self._lock:
                self._state["proc"] = proc
            timed_out: List[bool] = []
            watchdog = threading.Timer(180.0, lambda: (timed_out.append(True), self._terminate_process_tree(proc)))
            watchdog.daemon = True
            watchdog.start()
            live_lines: List[str] = []
            try:
                assert proc.stdout is not None
                for line in proc.stdout:
                    sys.stdout.write(line)
                    sys.stdout.flush()
                    live_lines.append(line)
                    with self._lock:
                        self._state["lines"].append(line)
                rc: int = proc.wait(timeout=10)
            finally:
                watchdog.cancel()
                with self._lock:
                    if self._state.get("proc") is proc:
                        self._state["proc"] = None
                if proc.stdout is not None:
                    proc.stdout.close()
            if timed_out:
                raise subprocess.TimeoutExpired(cmd=cmd, timeout=180)
            clean_out, uncovered_out = read_runner_reports(is_clip_runner, live_lines, report_path, coverage_path)
            return rc, clean_out, uncovered_out
