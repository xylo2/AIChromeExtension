# Utilitaires d'arrêt d'arbre de processus et de lecture des rapports de tests.

import os
import re
import signal
import subprocess
from typing import Tuple


def terminate_process_tree(proc: subprocess.Popen[str]) -> None:
    """Termine un processus et l'ensemble de ses processus enfants."""
    pid: int = getattr(proc, "pid", 0) or 0
    if os.name == "nt" and pid > 0:
        try:
            subprocess.run(
                ["taskkill", "/F", "/T", "/PID", str(pid)],
                capture_output=True, timeout=5, check=False,
            )
        except Exception:
            pass
    elif pid > 0 and hasattr(os, "killpg"):
        try:
            os.killpg(os.getpgid(pid), signal.SIGKILL)
        except Exception:
            pass
    try:
        proc.kill()
    except Exception:
        pass


def read_runner_reports(
    is_clip_runner: bool,
    live_lines: list[str],
    report_path: str,
    coverage_path: str,
) -> Tuple[str, str]:
    """Lit les fichiers de rapport et couverture générés par run_tests_clip.py."""
    compact_out: str = "".join(live_lines).strip()
    if is_clip_runner and os.path.isfile(report_path):
        with open(report_path, "r", encoding="utf-8", errors="replace") as f_rep:
            compact_out = f_rep.read().strip()
    uncovered_out: str = ""
    if is_clip_runner and os.path.isfile(coverage_path):
        with open(coverage_path, "r", encoding="utf-8", errors="replace") as f_cov:
            uncovered_out = f_cov.read().strip()
    clean_out: str = re.sub(r"^\x5bPRESSE-PAPIERS\x5d.*$", "", compact_out, flags=re.MULTILINE).strip()
    return clean_out, uncovered_out
