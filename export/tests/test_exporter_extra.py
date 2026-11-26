import importlib.util
import logging
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

from project_exporter.config import ExporterConfig
from project_exporter.exporter import ProjectExporter
from project_exporter.gitignore import GitignoreManager


class TestExporterExtra(unittest.TestCase):
    """Tests complémentaires couvrant les modes d'export (code, tests, modified, skeleton, subpaths)."""

    def setUp(self) -> None:
        self.logger: logging.Logger = logging.getLogger("test_exporter_extra")
        self.logger.addHandler(logging.NullHandler())

    def test_config_missing_section_and_custom_template(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            ini_path = Path(tmp_dir) / "bad.ini"
            ini_path.write_text("[other]\nkey = val\n", encoding="utf-8")
            cfg = ExporterConfig(config_path=ini_path, logger=self.logger)
            cfg.output_filename = "archive.txt"
            self.assertEqual(cfg.build_output_filename("demo"), "demo_archive.txt")

    def test_export_modes_code_tests_skeleton_and_subpaths(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            root = Path(tmp_dir)
            (root / "app.py").write_text("import os\n\nclass Demo:\n    def run(self):\n        return 1\n", encoding="utf-8")
            (root / "script.js").write_text("function hello(a) {\n  return a;\n}\n", encoding="utf-8")
            (root / "tests").mkdir()
            (root / "tests" / "test_app.py").write_text("assert True\n", encoding="utf-8")
            cfg = ExporterConfig(config_path=root / "missing.ini", logger=self.logger)
            cfg.included_extensions.add(".js")

            out_code = root / "code_only.txt"
            cnt_code = ProjectExporter(root, cfg, out_code, root / "export_project.py", self.logger, export_mode="code").export()
            txt_code = out_code.read_text(encoding="utf-8")
            self.assertEqual(cnt_code, 2)
            self.assertIn("PARTIEL — CODE UNIQUEMENT", txt_code)
            self.assertIn("--- app.py ---", txt_code)
            self.assertNotIn("--- tests/test_app.py ---", txt_code)

            out_tests = root / "tests_only.txt"
            cnt_tests = ProjectExporter(root, cfg, out_tests, root / "export_project.py", self.logger, export_mode="tests").export()
            txt_tests = out_tests.read_text(encoding="utf-8")
            self.assertEqual(cnt_tests, 1)
            self.assertIn("PARTIEL — TESTS UNIQUEMENT", txt_tests)
            self.assertIn("--- tests/test_app.py ---", txt_tests)

            out_skel = root / "skel.txt"
            cnt_skel = ProjectExporter(root, cfg, out_skel, root / "export_project.py", self.logger, export_mode="skeleton", include_subpaths=["app.py", "script.js"]).export()
            txt_skel = out_skel.read_text(encoding="utf-8")
            self.assertEqual(cnt_skel, 2)
            self.assertIn("def run(self): ...", txt_skel)
            self.assertIn("function hello(a) {", txt_skel)
            self.assertIn("--- Arborescence omise (", txt_skel)
            self.assertIn("tests/test_app.py", txt_skel)
    def test_export_mode_modified_git_and_exclusions(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            root = Path(tmp_dir)
            subprocess.run(["git", "init", "-b", "main"], cwd=root, check=True, capture_output=True)
            subprocess.run(["git", "config", "user.email", "t@example.invalid"], cwd=root, check=True)
            subprocess.run(["git", "config", "user.name", "Tester"], cwd=root, check=True)
            (root / "committed.py").write_text("A = 1\n", encoding="utf-8")
            subprocess.run(["git", "add", "committed.py"], cwd=root, check=True)
            subprocess.run(["git", "commit", "-m", "init"], cwd=root, check=True, capture_output=True)
            (root / "modified.py").write_text("B = 2\n", encoding="utf-8")

            cfg = ExporterConfig(config_path=root / "missing.ini", logger=self.logger)
            out_mod = root / "mod.txt"
            cnt_mod = ProjectExporter(root, cfg, out_mod, root / "export_project.py", self.logger, export_mode="modified").export()
            txt_mod = out_mod.read_text(encoding="utf-8")
            self.assertEqual(cnt_mod, 1)
            self.assertIn("PARTIEL — MODIFIÉS GIT UNIQUEMENT", txt_mod)
            self.assertIn("--- modified.py ---", txt_mod)

    def test_exporter_exclusions_and_gitignore_wildcards(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            root = Path(tmp_dir)
            (root / ".gitignore").write_text("# comment\ndocs/**\n**/cache_dir/\n?temp.py\n", encoding="utf-8")
            (root / "docs").mkdir()
            (root / "docs" / "readme.md").write_text("ignored\n", encoding="utf-8")
            (root / "pkg" / "cache_dir").mkdir(parents=True)
            (root / "pkg" / "cache_dir" / "item.py").write_text("ignored\n", encoding="utf-8")
            (root / "atemp.py").write_text("ignored\n", encoding="utf-8")
            (root / "keep.py").write_text("OK = 1\n", encoding="utf-8")
            (root / "skip.tmp").write_text("skip\n", encoding="utf-8")

            out_file = root / "demo_export.txt"
            out_file.write_text("stale\n", encoding="utf-8")
            cfg = ExporterConfig(config_path=root / "missing.ini", logger=self.logger)
            cfg.excluded_patterns.add(".tmp")

            exp = ProjectExporter(
                root_dir=root, config=cfg, output_file=out_file,
                script_path=root / "export_project.py", logger=self.logger,
            )
            self.assertFalse(exp.is_target_file(Path(tmp_dir).parent / "outside.py"))
            self.assertEqual(exp.export(), 1)
            self.assertIn("--- keep.py ---", out_file.read_text(encoding="utf-8"))

            gi_disabled = GitignoreManager(root_dir=root, logger=self.logger, enabled=False)
            gi_disabled.register_directory(root)
            self.assertFalse(gi_disabled.is_ignored(root / "atemp.py"))

    def test_export_project_cli_entrypoint(self) -> None:
        export_dir = Path(__file__).resolve().parent.parent
        cli_script = export_dir / "export_project.py"
        if not cli_script.is_file():
            self.skipTest("export_project.py absent")
        with tempfile.TemporaryDirectory() as tmp_dir:
            proj = Path(tmp_dir) / "sample_proj"
            proj.mkdir()
            (proj / "main.py").write_text("x = 42\n", encoding="utf-8")
            out_path = Path(tmp_dir) / "out.txt"
            argv_ok = ["export_project.py", str(proj), "-o", str(out_path), "-i", "py", "-e", "*.bak", "--no-gitignore", "-v"]
            with patch.object(sys, "argv", argv_ok):
                spec = importlib.util.spec_from_file_location("__main__", str(cli_script))
                assert spec and spec.loader
                mod = importlib.util.module_from_spec(spec)
                try:
                    spec.loader.exec_module(mod)
                except SystemExit as exc:
                    self.assertIn(exc.code, (0, None))
            self.assertTrue(out_path.is_file())


if __name__ == "__main__":
    unittest.main()
