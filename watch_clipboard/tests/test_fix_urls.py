# Commandes pip à exécuter : Aucune dépendance externe requise (lancer avec : python -m unittest discover tests)

from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

from tools.fix_urls import cleanup_temp_files, get_canonical_segments, repair_tools_urls
from tools.run_tests_clip import ClipboardTestRunner


class TestFixUrlsAndNodeDiscovery(unittest.TestCase):
    """
    Vérifie la réparation automatique des URLs tronquées par l'interface web,
    le nettoyage des fichiers temporaires, la détection du binaire Node.js
    et la capture des warnings Python par ClipboardTestRunner.
    """

    def test_repair_tools_urls_fixes_truncated_urls_and_cleans_temp_files(self) -> None:
        scheme, google_base, gh_base = get_canonical_segments()
        with tempfile.TemporaryDirectory(prefix="tools_urls_") as tmp_dir:
            tmp_root = Path(tmp_dir)
            (tmp_root / "iaexport").write_text("tmp", encoding="utf-8")
            (tmp_root / "verification_liens.txt").write_text("tmp", encoding="utf-8")

            sample_js = tmp_root / "sample.js"
            broken_google = "https" + "://" + "google" + ".com"
            broken_gh = "https" + "://:/" + "github" + ".com"
            sample_js.write_text(
                f'const a = "{broken_google}";\nconst b = "{broken_gh}";\n',
                encoding="utf-8",
            )
            ignored_dir = tmp_root / ".venv"
            ignored_dir.mkdir()
            (ignored_dir / "skip.js").write_text(f'const x = "{broken_google}";\n', encoding="utf-8")

            first = repair_tools_urls(root_dir=tmp_root)
            self.assertEqual(first.get("sample.js"), 1)
            self.assertNotIn(".venv/skip.js", first)
            self.assertFalse((tmp_root / "iaexport").exists())
            self.assertFalse((tmp_root / "verification_liens.txt").exists())
            self.assertEqual(cleanup_temp_files(tmp_root), 0)

            repaired_text = sample_js.read_text(encoding="utf-8")
            self.assertIn(f'const a = "{google_base}";', repaired_text)
            self.assertIn(f'const b = "{gh_base}";', repaired_text)
            self.assertNotIn(scheme + "://:/", repaired_text)

            second = repair_tools_urls(root_dir=tmp_root)
            self.assertEqual(second.get("sample.js"), 0)

    def test_find_node_binary_prefers_venv_node(self) -> None:
        with tempfile.TemporaryDirectory(prefix="tools_node_") as tmp_dir:
            tmp_root = Path(tmp_dir)
            venv_node = tmp_root / ".venv" / "Scripts" / "node.exe"
            venv_node.parent.mkdir(parents=True)
            venv_node.write_text("stub", encoding="utf-8")
            fake_py = tmp_root / "isolated_py" / "python.exe"

            with patch.object(sys, "executable", str(fake_py)), patch("shutil.which", return_value=None):
                found = ClipboardTestRunner.find_node_binary(tmp_root)
            self.assertEqual(found, str(venv_node))

    def test_extract_warnings_and_fail_suite_on_warning(self) -> None:
        raw_console = (
            "test_demo (t.S) ... ok\n"
            "sample.py:12: ResourceWarning: unclosed file <_io.TextIOWrapper>\n"
            "sample.py:12: ResourceWarning: unclosed file <_io.TextIOWrapper>\n"
            "sample.py:18: DeprecationWarning: old api\n"
            "Ran 1 test in 0.001s\nOK\n"
        )
        extracted = ClipboardTestRunner.extract_warnings_and_console_errors(raw_console)
        self.assertEqual(len(extracted.splitlines()), 2)
        self.assertIn("ResourceWarning:", extracted)
        self.assertIn("DeprecationWarning:", extracted)

        with tempfile.TemporaryDirectory(prefix="tools_warn_") as tmp_dir:
            tests_dir = Path(tmp_dir) / "tests"
            tests_dir.mkdir()
            (tests_dir / "__init__.py").write_text("", encoding="utf-8")
            (tests_dir / "test_warn.py").write_text(
                "import unittest, warnings\n"
                "class W(unittest.TestCase):\n"
                "    def test_w(self):\n"
                "        warnings.warn('deprecated call', DeprecationWarning)\n",
                encoding="utf-8",
            )
            runner = ClipboardTestRunner(project_root=tmp_dir, use_clipboard=False)
            rc, report, _ = runner._run_single_suite("warn_suite", str(tests_dir), tmp_dir)
            self.assertEqual(rc, 1)
            self.assertIn("WARNINGS DÉTECTÉS", report)
            self.assertIn("DeprecationWarning", report)


if __name__ == "__main__":
    unittest.main()
