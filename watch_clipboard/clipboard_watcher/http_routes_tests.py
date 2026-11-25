# Commandes pip à exécuter : Aucune dépendance externe requise (bibliothèque standard uniquement)

import os
import re
import subprocess
import threading
from typing import Any, Optional


def handle_run_tests_route(handler: Any, async_mode: bool) -> None:
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
        has_warnings: bool = bool(re.search(r"(?:WARNINGS DÉTECTÉS|ResourceWarning|DeprecationWarning|UserWarning|RuntimeWarning)", clean_out))
        passed: bool = rc == 0 and not has_warnings
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
