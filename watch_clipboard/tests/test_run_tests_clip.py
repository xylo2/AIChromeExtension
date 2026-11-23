# Commandes pip à exécuter : Aucune dépendance externe requise (lancer avec : python -m unittest discover tests)

import os
import tempfile
import unittest
from tools.run_tests_clip import ClipboardTestRunner


class TestClipboardTestRunner(unittest.TestCase):
    """
    Tests unitaires vérifiant le compactage des rapports d'erreurs unittest,
    la déduplication des échecs identiques et la troncature des longues assertions.
    """

    def test_compact_error_report_deduplication_and_truncation(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            src_file: str = os.path.join(tmp_dir, "sample.py")
            with open(src_file, "w", encoding="utf-8") as f_src:
                f_src.write("def compute():\n    raise ValueError('boom')\n")

            long_assertion: str = "A" * 500
            raw_unittest_output: str = (
                "test_one (test_mod.Suite) ... ERROR\n"
                "test_two (test_mod.Suite) ... ERROR\n"
                "test_long (test_mod.Suite) ... FAIL\n"
                "======================================================================\n"
                "ERROR: test_one (test_mod.Suite)\n"
                "----------------------------------------------------------------------\n"
                "Traceback (most recent call last):\n"
                f'  File "{src_file}", line 2, in compute\n'
                "    raise ValueError('boom')\n"
                "ValueError: boom\n"
                "======================================================================\n"
                "ERROR: test_two (test_mod.Suite)\n"
                "----------------------------------------------------------------------\n"
                "Traceback (most recent call last):\n"
                f'  File "{src_file}", line 2, in compute\n'
                "    raise ValueError('boom')\n"
                "ValueError: boom\n"
                "======================================================================\n"
                "FAIL: test_long (test_mod.Suite)\n"
                "----------------------------------------------------------------------\n"
                "Traceback (most recent call last):\n"
                f"AssertionError: {long_assertion}\n"
                "----------------------------------------------------------------------\n"
                "Ran 3 tests in 0.005s\n\n"
                "FAILED (failures=1, errors=2)\n"
            )

            runner = ClipboardTestRunner(project_root=tmp_dir, use_clipboard=False)
            report: str = runner.compact_error_report(raw_unittest_output, top_dir=tmp_dir)

            self.assertIn("ERROR: test_one", report)
            self.assertIn("CODE: raise ValueError('boom')", report)
            self.assertIn("[DOUBLON] ERROR: test_two (test_mod.Suite) -> ValueError: boom", report)
            self.assertIn("[...]", report)
            self.assertIn("Ran 3 tests in 0.005s | FAILED (failures=1, errors=2)", report)


if __name__ == "__main__":
    unittest.main()
