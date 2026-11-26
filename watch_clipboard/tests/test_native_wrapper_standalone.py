# Commandes pip à exécuter : Aucune dépendance externe requise (lancer avec : python -m unittest discover tests)

import json
import os
from pathlib import Path
import struct
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

from install_native_host import NativeHostInstaller


class TestNativeWrapperStandalone(unittest.TestCase):
    """Vérifie le PYTHONPATH du wrapper et l'exécution stdio autonome de native_host.py."""

    def test_wrapper_exports_pythonpath_on_windows_and_posix(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            root = Path(tmp_dir)
            inst = NativeHostInstaller(extension_id="abcdefghijklmnopabcdefghijklmnop")
            inst.project_dir = root
            inst.native_dir = root / ".native_host"
            inst.host_script = root / "clipboard_watcher" / "native_host.py"
            inst.host_script.parent.mkdir(parents=True)
            inst.host_script.write_text("# stub\n", encoding="utf-8")

            with patch("os.name", "nt"), patch.object(inst, "_resolve_console_python", return_value=r"C:\Py\python.exe"):
                bat = inst._create_wrapper()
                bat_txt = bat.read_text(encoding="utf-8")
                self.assertIn(f'set "PYTHONPATH={root.resolve()}"', bat_txt)

            with patch("os.name", "posix"), patch.object(inst, "_resolve_console_python", return_value="/usr/bin/python3"):
                sh = inst._create_wrapper()
                sh_txt = sh.read_text(encoding="utf-8")
                self.assertIn(f'export PYTHONPATH="{root.resolve()}"', sh_txt)

    def test_native_host_ping_without_external_pythonpath(self) -> None:
        watch_dir = Path(__file__).resolve().parent.parent
        host_py = watch_dir / "clipboard_watcher" / "native_host.py"
        clean_env = {k: v for k, v in os.environ.items() if k != "PYTHONPATH"}
        payload = json.dumps({"action": "ping"}).encode("utf-8")
        packet = struct.pack("@I", len(payload)) + payload

        proc = subprocess.run(
            [sys.executable, "-B", str(host_py)],
            input=packet,
            capture_output=True,
            env=clean_env,
            cwd=tempfile.gettempdir(),
            timeout=10,
            check=False,
        )
        self.assertEqual(proc.returncode, 0, msg=proc.stderr.decode("utf-8", errors="replace"))
        self.assertGreater(len(proc.stdout), 4)
        out_len = struct.unpack("@I", proc.stdout[:4])[0]
        reply = json.loads(proc.stdout[4 : 4 + out_len].decode("utf-8"))
        self.assertEqual(reply, {"ok": True, "service": "watch_clipboard_host"})


if __name__ == "__main__":
    unittest.main()
