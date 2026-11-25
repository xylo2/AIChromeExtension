# Commandes pip à exécuter : Aucune dépendance externe requise (lancer avec : python -m unittest discover -s export/tests -t export)

import logging
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from project_exporter.config import ExporterConfig
from project_exporter.exporter import ProjectExporter
from project_exporter.gitignore import GitignoreManager


class TestExporterBranches(unittest.TestCase):
    """Couvre les branches restantes de project_exporter (config, exporter, gitignore)."""

    def setUp(self) -> None:
        self.logger: logging.Logger = logging.getLogger("test_exporter_branches")
        self.logger.addHandler(logging.NullHandler())

    def test_exporter_read_error_and_gitignore_read_failure(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            root = Path(tmp_dir)
            (root / ".gitignore").write_text("ignored.py\n", encoding="utf-8")
            (root / "ignored.py").write_text("x = 1\n", encoding="utf-8")
            unreadable = root / "broken.py"
            unreadable.write_text("y = 2\n", encoding="utf-8")

            cfg = ExporterConfig(config_path=root / "missing.ini", logger=self.logger)
            out_file = root / "out.txt"
            exp = ProjectExporter(
                root_dir=root, config=cfg, output_file=out_file,
                script_path=root / "export_project.py", logger=self.logger,
            )

            orig_read_text = Path.read_text

            def _selective_fail(self_path: Path, *args: object, **kwargs: object) -> str:
                if self_path.name == "broken.py":
                    raise PermissionError("access denied")
                return orig_read_text(self_path, *args, **kwargs)  # type: ignore[arg-type]

            with patch.object(Path, "read_text", _selective_fail):
                count = exp.export()
            self.assertEqual(count, 1)
            exported = out_file.read_text(encoding="utf-8")
            self.assertIn("ERREUR DE LECTURE", exported)
            self.assertNotIn("ignored.py", exported)

            gi = GitignoreManager(root_dir=root, logger=self.logger, enabled=True)
            with patch.object(Path, "read_text", side_effect=OSError("io fail")):
                gi.register_directory(root)
            self.assertEqual(gi._rules_by_dir, {})


if __name__ == "__main__":
    unittest.main()
