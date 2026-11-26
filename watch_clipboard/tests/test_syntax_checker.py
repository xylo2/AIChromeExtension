# Commandes pip à exécuter : Aucune dépendance externe requise (lancer avec : python -m unittest discover tests)

import io
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from clipboard_watcher.assembler import FileAssembler
from clipboard_watcher.config import WatcherConfig
from clipboard_watcher.status_server import _StatusRequestHandler
from clipboard_watcher.syntax_checker import SyntaxChecker


class TestSyntaxCheckerAndIntegration(unittest.TestCase):
    """Vérifie la validation syntaxique automatique (.py, .json, .js) et l'endpoint /last-syntax-error."""

    def test_syntax_checker_python_json_and_js(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            root = Path(tmp_dir)
            bad_py = root / "bad.py"
            bad_py.write_text("x = 1\ndef broken(:\n    return x\n", encoding="utf-8")
            err_py = SyntaxChecker.check_file(str(bad_py), "bad.py")
            self.assertIsNotNone(err_py)
            assert err_py is not None
            self.assertEqual(err_py["line"], 2)
            self.assertIn("> 2: def broken(:", str(err_py["snippet"]))

            bad_json = root / "bad.json"
            bad_json.write_text('{"a": 1,\n"b": }\n', encoding="utf-8")
            err_json = SyntaxChecker.check_file(str(bad_json), "bad.json")
            self.assertIsNotNone(err_json)
            assert err_json is not None
            self.assertEqual(err_json["line"], 2)

            bad_js = root / "bad.js"
            bad_js.write_text("const a = 1;\nfunction f( {\n", encoding="utf-8")
            with patch.object(SyntaxChecker, "_find_node", return_value="node"), patch(
                "subprocess.run",
                return_value=type("P", (), {"returncode": 1, "stdout": "", "stderr": "bad.js:2\nSyntaxError: Unexpected token '{'\n"})(),
            ):
                err_js = SyntaxChecker.check_file(str(bad_js), "bad.js")
                self.assertIsNotNone(err_js)
                assert err_js is not None
                self.assertEqual(err_js["line"], 2)
                self.assertIn("SyntaxError", str(err_js["message"]))

            with patch.object(SyntaxChecker, "_find_node", return_value=None):
                self.assertIsNone(SyntaxChecker.check_file(str(bad_js), "bad.js"))

    def test_assembler_and_http_endpoint_report_and_clear_syntax_error(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            cfg = WatcherConfig(config_path="missing.ini")
            asm = FileAssembler(base_dir=tmp_dir, config=cfg)

            asm.process_text("=== FILE_PART: app/broken.py | 1/2 ===\ndef ok():\n")
            asm.process_text("=== FILE_PART: app/broken.py | 2/2 ===\n    if :\n        pass\n")
            self.assertIsNotNone(asm.last_event)
            assert asm.last_event is not None
            self.assertTrue(asm.last_event.startswith("[SYNTAXE] app/broken.py"))
            self.assertIsNotNone(asm.last_syntax_error)

            handler = object.__new__(_StatusRequestHandler)
            handler.target_dir = tmp_dir
            handler.assembler_ref = asm
            handler.api_token = ""
            handler.allowed_origin = ""
            handler.headers = {"Origin": "chrome-extension://abc"}  # type: ignore[assignment]
            handler.send_response = lambda *_a, **_kw: None  # type: ignore[method-assign]
            handler.send_header = lambda *_a, **_kw: None  # type: ignore[method-assign]
            handler.end_headers = lambda: None  # type: ignore[method-assign]

            handler.path = "/last-syntax-error"
            handler.wfile = io.BytesIO()
            handler.do_GET()
            data = json.loads(handler.wfile.getvalue().decode("utf-8"))
            self.assertTrue(data["ok"])
            self.assertEqual(data["syntax_error"]["file"], "app/broken.py")

            asm.process_text("=== FILE: app/broken.py ===\ndef ok():\n    return 1\n")
            self.assertEqual(asm.last_event, "[OK] app/broken.py")
            self.assertIsNone(asm.last_syntax_error)
            self.assertTrue(os.path.isfile(os.path.join(tmp_dir, "app", "broken.py")))


if __name__ == "__main__":
    unittest.main()
