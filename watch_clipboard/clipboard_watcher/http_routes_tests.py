# Gestion des routes HTTP POST déclenchant l'exécution synchrone ou asynchrone des tests.

import os
import re
import subprocess
import threading
from typing import Any, Optional


def is_managed_clip_runner(test_script: str) -> bool:
    """Indique si le script utilise ClipboardTestRunner (--report-file / --coverage-file)."""
    return os.path.basename(test_script) in ("run_tests_clip.py", "run_all_tests.py")


def compute_tests_passed(rc: int, clean_out: str, test_script: str) -> bool:
    """Détermine si la campagne de tests est réussie sans faux positif sur les logs."""
    if rc != 0:
        return False
    if "WARNINGS DÉTECTÉS" in clean_out:
        return False
    if is_managed_clip_runner(test_script):
        return True
    return not bool(re.search(r"(?:ResourceWarning|DeprecationWarning|UserWarning|RuntimeWarning)", clean_out))


def handle_run_tests_route(handler: Any, async_mode: bool) -> None:
    """Valide le lanceur de tests et démarre la campagne en mode synchrone ou streaming."""
    body_t = handler._read_json_body()
    test_script: Optional[str] = handler._resolve_test_runner_path(str(body_t.get("test_runner", "")).strip())
    if test_script is None:
        handler._send_json(403, {"ok": False, "error": "Chemin du lanceur de tests non autorisé."})
        return
    if not os.path.isfile(test_script):
        handler._send_json(404, {"ok": False, "error": f"Lanceur introuvable : {test_script}"})
        return
    if not handler._test_mgr.try_begin():
        handler._send_json(409, {"ok": False, "error": "Une exécution de tests est déjà en cours."})
        return
    if async_mode:
        threading.Thread(target=handler._run_tests_background, args=(test_script,), daemon=True).start()
        handler._send_json(200, {"ok": True, "started": True})
        return
    try:
        rc, clean_out, uncovered_out = handler._execute_tests_streaming(test_script)
        passed: bool = compute_tests_passed(rc, clean_out, test_script)
        with handler._test_lock:
            handler._live_test_state.update({"running": False, "passed": passed, "output": clean_out, "uncovered": uncovered_out if passed else "", "error": ""})
        handler._send_json(200, {"ok": True, "passed": passed, "returncode": rc, "output": clean_out, "uncovered": uncovered_out if passed else ""})
    except subprocess.TimeoutExpired:
        with handler._test_lock:
            handler._live_test_state.update({"running": False, "passed": False, "error": "Délai dépassé (180s) pendant les tests."})
        handler._send_json(504, {"ok": False, "error": "Délai dépassé (180s) pendant les tests."})
    except Exception as exc:
        with handler._test_lock:
            handler._live_test_state.update({"running": False, "passed": False, "error": str(exc)})
        handler._send_json(500, {"ok": False, "error": str(exc)})
