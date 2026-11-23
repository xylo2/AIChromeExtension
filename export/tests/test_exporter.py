# Commandes pip à exécuter : Aucune dépendance externe requise (lancer avec : python -m unittest discover -s export/tests -t export)

import logging
import tempfile
import unittest
from pathlib import Path
from project_exporter.config import ExporterConfig
from project_exporter.exporter import ProjectExporter
from project_exporter.gitignore import GitignoreRule


class TestProjectExporter(unittest.TestCase):
    """
    Tests unitaires vérifiant le filtrage .gitignore (classes [...], négations, sous-dossiers),
    les surcharges CLI, le repli d'encodage latin-1 et la consolidation finale.
    """

    def setUp(self) -> None:
        self.logger: logging.Logger = logging.getLogger("test_exporter")
        self.logger.addHandler(logging.NullHandler())

    def test_config_normalizes_extensions_and_cli_overrides(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_str:
            ini_file = Path(tmp_str) / "config.ini"
            ini_file.write_text(
                "[export]\nincluded_extensions = py, .json, MD\nincluded_exact_names = Makefile\n",
                encoding="utf-8",
            )
            cfg = ExporterConfig(config_path=ini_file, logger=self.logger)
            self.assertEqual(cfg.included_extensions, {".py", ".json", ".md"})
            self.assertEqual(cfg.included_exact_names, {"Makefile"})

            self.assertEqual(cfg.build_output_filename("Mon Projet / v2!"), "Mon_Projet___v2_export.txt")
            self.assertEqual(cfg.build_output_filename("///"), "project_export.txt")

            cfg.apply_cli_overrides(includes=["ts", ".tsx"], excludes=["*.spec.ts", ".map"], no_gitignore=True)
            self.assertEqual(cfg.included_extensions, {".ts", ".tsx"})
            self.assertEqual(cfg.included_exact_names, set())
            self.assertEqual(cfg.excluded_patterns, {"*.spec.ts", ".map"})
            self.assertFalse(cfg.respect_gitignore)

    def test_gitignore_rule_glob_and_char_classes(self) -> None:
        rule_brackets = GitignoreRule("log_[0-9].txt")
        self.assertTrue(rule_brackets.matches("log_1.txt", is_dir=False))
        self.assertTrue(rule_brackets.matches("sub/log_9.txt", is_dir=False))
        self.assertFalse(rule_brackets.matches("log_a.txt", is_dir=False))

        rule_negated_class = GitignoreRule("temp_[!a-c].py")
        self.assertTrue(rule_negated_class.matches("temp_z.py", is_dir=False))
        self.assertFalse(rule_negated_class.matches("temp_b.py", is_dir=False))

        rule_dir = GitignoreRule("build/")
        self.assertTrue(rule_dir.matches("build", is_dir=True))
        self.assertFalse(rule_dir.matches("build", is_dir=False))

    def test_export_negation_fallback_encoding_and_nested_gitignore(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_str:
            root = Path(tmp_str)

            (root / ".gitignore").write_text("*.log\n!important.log\n", encoding="utf-8")
            (root / "debug.log").write_text("ignored trace\n", encoding="utf-8")
            (root / "important.log").write_text("kept trace\n", encoding="utf-8")

            # Fichier encodé en latin-1 (non UTF-8 valide)
            latin_file = root / "legacy_latin1.py"
            latin_file.write_bytes("# Commentaire café résumé\nx = 1\n".encode("latin-1"))

            # Sous-répertoire avec son propre .gitignore
            sub_dir = root / "subpkg"
            sub_dir.mkdir()
            (sub_dir / ".gitignore").write_text("local_secret.py\n", encoding="utf-8")
            (sub_dir / "local_secret.py").write_text("SECRET = '123'\n", encoding="utf-8")
            (sub_dir / "public.py").write_text("OK = True\n", encoding="utf-8")

            out_file = root / "out" / "result.txt"
            cfg = ExporterConfig(config_path=root / "missing.ini", logger=self.logger)
            cfg.included_extensions.add(".log")

            exporter = ProjectExporter(
                root_dir=root,
                config=cfg,
                output_file=out_file,
                script_path=root / "export_script.py",
                logger=self.logger,
            )

            count: int = exporter.export()
            self.assertEqual(count, 3)

            exported_text: str = out_file.read_text(encoding="utf-8")
            self.assertIn("FICHIER : important.log", exported_text)
            self.assertIn("FICHIER : legacy_latin1.py", exported_text)
            self.assertIn("café résumé", exported_text)
            self.assertIn("FICHIER : subpkg/public.py", exported_text)
            self.assertNotIn("debug.log", exported_text)
            self.assertNotIn("local_secret.py", exported_text)


if __name__ == "__main__":
    unittest.main()
