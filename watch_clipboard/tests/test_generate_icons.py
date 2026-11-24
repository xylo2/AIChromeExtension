# Commandes pip à exécuter : Aucune dépendance externe requise (lancer avec : python -m unittest discover tests)

import os
import tempfile
import unittest
from tools.generate_icons import generate_all_icons


class TestGenerateIcons(unittest.TestCase):
    """
    Vérifie la génération des icônes PNG (16x16, 48x48, 128x128) pour ChromeAI.
    """

    def test_generate_all_icons_creates_valid_pngs(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_tools:
            generate_all_icons(tmp_tools)
            for sz in (16, 48, 128):
                png_path: str = os.path.join(tmp_tools, "ChromeAI", "icons", f"icon{sz}.png")
                self.assertTrue(os.path.isfile(png_path), f"Icône manquante : {png_path}")
                with open(png_path, "rb") as f_png:
                    header: bytes = f_png.read(24)
                self.assertEqual(header[:8], b"\x89PNG\r\n\x1a\n")
                width: int = int.from_bytes(header[16:20], "big")
                height: int = int.from_bytes(header[20:24], "big")
                self.assertEqual((width, height), (sz, sz))


if __name__ == "__main__":
    unittest.main()
