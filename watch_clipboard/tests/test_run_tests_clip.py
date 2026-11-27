import json
import os
import tempfile
import unittest
from unittest.mock import patch
from tools.run_tests_clip import ClipboardTestRunner, parse_failed_tests_arg
from tools.suite_executor import compact_error_report


class TestClipboardTestRunner(unittest.TestCase):
    """
    Tests unitaires vérifiant le compactage des rapports d'erreurs unittest,
    la déduplication des échecs identiques, la troncature, le filtrage KO et la couverture.
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
            self.assertIn("LOC: sample.py:2", report)
            self.assertIn("CODE: raise ValueError('boom')", report)
            self.assertIn("[DOUBLON] ERROR: test_two (test_mod.Suite) -> ValueError: boom", report)
            self.assertIn("[...]", report)
            self.assertIn("Ran 3 tests in 0.005s | FAILED (failures=1, errors=2)", report)

            capped: str = compact_error_report(raw_unittest_output, top_dir=tmp_dir, max_chars=260)
            self.assertLessEqual(len(capped), 260)
            self.assertIn("tronqué", capped)
            self.assertIn("FAILED (failures=1, errors=2)", capped)

    def test_run_single_suite_detects_uncovered_lines_and_table_format(self) -> None:
        sample_lines = list((2, 3, 4, 8, 10, 11))
        self.assertEqual(ClipboardTestRunner._format_line_ranges(sample_lines), "2-4, 8, 10-11")
        with tempfile.TemporaryDirectory() as tmp_dir:
            mod_file: str = os.path.join(tmp_dir, "demo.py")
            with open(mod_file, "w", encoding="utf-8") as f_mod:
                f_mod.write('"""Docstring."""\ndef fn(x):\n    if x:\n        return 1\n    return 2\n')
            unused_file: str = os.path.join(tmp_dir, "unused.py")
            with open(unused_file, "w", encoding="utf-8") as f_un:
                f_un.write("def never_called():\n    x = 1\n    return x\n")
            tests_dir: str = os.path.join(tmp_dir, "tests")
            os.makedirs(tests_dir, exist_ok=True)
            with open(os.path.join(tests_dir, "__init__.py"), "w", encoding="utf-8") as f_init:
                f_init.write("")
            with open(os.path.join(tests_dir, "test_demo.py"), "w", encoding="utf-8") as f_t:
                f_t.write(
                    "import unittest\nfrom demo import fn\n"
                    "class T(unittest.TestCase):\n"
                    "    def test_true(self):\n        self.assertEqual(fn(True), 1)\n"
                    "    def test_false(self):\n        self.assertEqual(fn(False), 2)\n"
                )

            runner = ClipboardTestRunner(project_root=tmp_dir, use_clipboard=False)
            self.assertEqual(parse_failed_tests_arg(["--failed-tests", json.dumps(["test_true"])]), ["test_true"])
            with patch.dict(os.environ, {"WATCH_CLIPBOARD_FAILED_TESTS": "test_a|test_b"}):
                self.assertEqual(parse_failed_tests_arg([]), ["test_a", "test_b"])

            rc_f, sum_f, rows_f = runner._run_single_suite("demo", tests_dir, tmp_dir, failed_filters=["test_true"])
            self.assertEqual((rc_f, rows_f), (0, []))
            self.assertIn("1 test(s) KO corrigé(s)", sum_f)

            rc_none, sum_none, _ = runner._run_single_suite("demo", tests_dir, tmp_dir, failed_filters=["test_inexistant"])
            self.assertEqual((rc_none, sum_none), (0, ""))

            with open(os.path.join(tests_dir, "test_demo.py"), "w", encoding="utf-8") as f_t2:
                f_t2.write("import unittest\nfrom demo import fn\nclass T(unittest.TestCase):\n    def test_true(self):\n        self.assertEqual(fn(True), 1)\n")
            rc, summary, rows = runner._run_single_suite("demo", tests_dir, tmp_dir)
            self.assertEqual(rc, 0, msg=summary)
            pct, table_text = runner.format_coverage_report(rows, total_tests=1)
            self.assertAlmostEqual(pct, 40.0)
            self.assertIn("COUVERTURE GLOBALE : 40.0% (2/5 lignes) (1 tests unitaires)", table_text)
            self.assertIn("0.0% | BAS     | 0/2 | unused.py -> lignes 2-3", table_text)
            self.assertIn("66.7% | BAS     | 2/3 | demo.py -> lignes 5", table_text)


if __name__ == "__main__":
    unittest.main()
