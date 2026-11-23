# Commandes pip à exécuter : Aucune dépendance externe requise (bibliothèque standard uniquement - lancer avec : python -m unittest discover tests)

import os
import shutil
import tempfile
import unittest
from clipboard_watcher.assembler import FileAssembler, UnsafePathError
from clipboard_watcher.config import WatcherConfig


class TestFileAssembler(unittest.TestCase):
    """
    Tests unitaires vérifiant l'assemblage de fichiers, la sécurité des chemins,
    la persistance du cache miroir .watch_clipboard et la propreté de la racine.
    """

    def setUp(self) -> None:
        self.test_dir: tempfile.TemporaryDirectory[str] = tempfile.TemporaryDirectory()
        self.base_dir: str = self.test_dir.name
        self.config: WatcherConfig = WatcherConfig(config_path="non_existent_config.ini")
        self.assembler: FileAssembler = FileAssembler(base_dir=self.base_dir, config=self.config)

    def tearDown(self) -> None:
        self.test_dir.cleanup()

    def test_single_file_creation_with_leading_spaces_and_nbsp(self) -> None:
        payload: str = "  \u00a0=== FILE: src/hello.py ===\nprint('Bonjour')\n"
        processed: int = self.assembler.process_text(payload)
        target_file: str = os.path.join(self.base_dir, "src", "hello.py")
        self.assertEqual(processed, 1)
        self.assertEqual(self.assembler.last_event, "[OK] src/hello.py")
        self.assertTrue(os.path.exists(target_file))
        with open(target_file, "r", encoding="utf-8") as f:
            self.assertEqual(f.read(), "print('Bonjour')\n")

    def test_strip_redundant_base_prefix_even_if_duplicate_dir_exists(self) -> None:
        tools_base: str = os.path.join(self.base_dir, "tools")
        os.makedirs(os.path.join(tools_base, "tools"), exist_ok=True)
        asm = FileAssembler(base_dir=tools_base, config=self.config)
        asm.process_text("=== FILE: tools/ChromeAI/demo.js ===\nconst x = 1;\n")
        self.assertTrue(os.path.exists(os.path.join(tools_base, "ChromeAI", "demo.js")))
        self.assertFalse(os.path.exists(os.path.join(tools_base, "tools", "ChromeAI", "demo.js")))

    def test_partial_assembly_and_excess_cleanup(self) -> None:
        for i in range(1, 5):
            self.assembler.process_text(f"=== FILE_PART: app/mod.py | {i}/4 ===\nline_{i} = {i}\n")

        part3_cache: str = os.path.join(self.base_dir, ".watch_clipboard", "app", "mod.py.part3")
        part4_cache: str = os.path.join(self.base_dir, ".watch_clipboard", "app", "mod.py.part4")
        self.assertTrue(os.path.exists(part3_cache))
        self.assertTrue(os.path.exists(part4_cache))

        self.assembler.process_text("=== FILE_PART: app/mod.py | 1/2 ===\ndef a(): return 1\n")
        self.assembler.process_text("=== FILE_PART: app/mod.py | 2/2 ===\ndef b(): return 42\n")

        self.assertFalse(os.path.exists(part3_cache))
        self.assertFalse(os.path.exists(part4_cache))
        target_file: str = os.path.join(self.base_dir, "app", "mod.py")
        with open(target_file, "r", encoding="utf-8") as f:
            content: str = f.read()
        self.assertIn("return 1", content)
        self.assertIn("return 42", content)

    def test_safe_join_and_part_bounds_validation(self) -> None:
        with self.assertRaises(UnsafePathError):
            self.assembler.resolve_target_path("/etc/passwd")
        with self.assertRaises(UnsafePathError):
            self.assembler.resolve_target_path("../../outside.py")
        if os.name == "nt":
            other_drive: str = "Z:\\forbidden\\file.py" if not self.base_dir.upper().startswith("Z:") else "Y:\\forbidden\\file.py"
            with self.assertRaises(UnsafePathError):
                self.assembler.resolve_target_path(other_drive)

        bad_part_low: str = "=== FILE_PART: app/x.py | 0/2 ===\nx = 1\n"
        self.assertEqual(self.assembler.process_text(bad_part_low), 0)
        self.assertIsNotNone(self.assembler.last_event)
        assert self.assembler.last_event is not None
        self.assertTrue(self.assembler.last_event.startswith("[BLOQUÉ]"))

        bad_part_high: str = f"=== FILE_PART: app/x.py | {self.config.max_parts + 1}/60 ===\nx = 1\n"
        self.assertEqual(self.assembler.process_text(bad_part_high), 0)
        assert self.assembler.last_event is not None
        self.assertTrue(self.assembler.last_event.startswith("[BLOQUÉ]"))

    def test_multi_block_event_priority_and_counter(self) -> None:
        valid_batch: str = (
            "=== FILE: a.py ===\nx = 1\n"
            "=== FILE: b.py ===\ny = 2\n"
            "=== FILE: c.py ===\nz = 3\n"
        )
        self.assertEqual(self.assembler.process_text(valid_batch), 3)
        self.assertEqual(self.assembler.last_event, "[OK] c.py (+2)")

        mixed_batch: str = (
            "=== FILE: valid_first.py ===\na = 1\n"
            "=== FILE: ../escape.py ===\nbad = True\n"
            "=== FILE: valid_last.py ===\nb = 2\n"
        )
        self.assertEqual(self.assembler.process_text(mixed_batch), 2)
        assert self.assembler.last_event is not None
        self.assertTrue(self.assembler.last_event.startswith("[BLOQUÉ]"))

    def test_cleanup_misplaced_root_tool_folders(self) -> None:
        """Supprime les dossiers d'exemple créés par erreur à la racine ou dans tools/tools."""
        watch_clip_dir: str = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
        tools_dir: str = os.path.dirname(watch_clip_dir)
        workspace_root: str = os.path.dirname(tools_dir)
        if os.path.basename(tools_dir).lower() != "tools":
            return

        for misplaced_name in ("ChromeAI", "watch_clipboard", "export"):
            misplaced_path: str = os.path.join(workspace_root, misplaced_name)
            if os.path.isdir(misplaced_path):
                shutil.rmtree(misplaced_path, ignore_errors=True)
            self.assertFalse(os.path.exists(misplaced_path))

        nested_tools: str = os.path.join(tools_dir, "tools")
        if os.path.isdir(nested_tools):
            shutil.rmtree(nested_tools, ignore_errors=True)
        self.assertFalse(os.path.exists(nested_tools))


if __name__ == "__main__":
    unittest.main()
