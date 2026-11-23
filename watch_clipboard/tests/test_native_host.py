# Commandes pip à exécuter : Aucune dépendance externe requise (lancer avec : python -m unittest discover tests)

import ctypes
import io
import json
import os
from pathlib import Path
import struct
import tempfile
import unittest
from unittest.mock import patch
from clipboard_watcher.native_host import NativeMessagingHost
from install_native_host import NativeHostInstaller


class TestNativeMessagingHost(unittest.TestCase):
    """
    Tests unitaires vérifiant le protocole binaire Native Messaging,
    la résolution du répertoire racine, du binaire Python réel (hors WindowsApps)
    et du navigateur parent.
    """

    def test_work_dir_resolution_and_command_building(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_root:
            script_path: str = os.path.join(tmp_root, "tools", "watch_clipboard", "watch_clipboard.py")
            os.makedirs(os.path.dirname(script_path), exist_ok=True)
            with open(script_path, "w", encoding="utf-8") as f:
                f.write("# stub\n")

            host: NativeMessagingHost = NativeMessagingHost(script_path=script_path)
            self.assertEqual(host.work_dir, os.path.abspath(tmp_root))

            cmd = host._build_command(target_dir="Médical\\", extra_args="--verbose")
            self.assertEqual(cmd[-2:], ["Médical", "--verbose"])

    def test_find_real_windows_python_prefers_local_venv(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            proj_dir: Path = Path(tmp_dir) / "watch_clipboard"
            venv_py: Path = proj_dir / ".venv" / "Scripts" / "python.exe"
            venv_py.parent.mkdir(parents=True, exist_ok=True)
            venv_py.write_text("real_venv", encoding="utf-8")

            fake_store_py: str = os.path.join(tmp_dir, "Microsoft", "WindowsApps", "python.exe")
            resolved: str = NativeHostInstaller.find_real_windows_python(fake_store_py, project_dir=proj_dir)
            self.assertEqual(os.path.normcase(resolved), os.path.normcase(str(venv_py.resolve())))

    def test_read_and_send_message_protocol(self) -> None:
        host: NativeMessagingHost = NativeMessagingHost(script_path="watch_clipboard.py")
        raw_payload: bytes = json.dumps({"action": "ping"}).encode("utf-8")
        packed_in: bytes = struct.pack("@I", len(raw_payload)) + raw_payload

        fake_stdin = type("FakeStdin", (), {"buffer": io.BytesIO(packed_in)})()
        fake_stdout = type("FakeStdout", (), {"buffer": io.BytesIO()})()

        with patch("sys.stdin", fake_stdin), patch("sys.stdout", fake_stdout):
            decoded = host.read_message()
            self.assertEqual(decoded, {"action": "ping"})

            host.send_message({"ok": True})
            out_bytes: bytes = fake_stdout.buffer.getvalue()
            out_len: int = next(iter(struct.unpack("@I", out_bytes[:4])), 0)
            out_json = json.loads(out_bytes[4 : 4 + out_len].decode("utf-8"))
            self.assertEqual(out_json, {"ok": True})

    @unittest.skipUnless(os.name == "nt", "Test spécifique à l'API Toolhelp32 Windows")
    def test_detect_browser_executable_deep_tree_and_no_fallback(self) -> None:
        host: NativeMessagingHost = NativeMessagingHost(script_path="watch_clipboard.py")

        chain_edge = [
            (100, 90, "python.exe"),
            (90, 80, "cmd.exe"),
            (80, 70, "conhost.exe"),
            (70, 60, "sub1.exe"),
            (60, 50, "sub2.exe"),
            (50, 40, "sub3.exe"),
            (40, 30, "sub4.exe"),
            (30, 10, "msedge.exe"),
        ]

        def make_fake_kernel32(entries):
            state = {"iter": None}

            class FakeKernel32:
                def CreateToolhelp32Snapshot(self, _flags, _pid):
                    return 1234

                def Process32FirstW(self, _snap, entry_ptr):
                    state["iter"] = iter(entries)
                    item = next(state["iter"], None)
                    if item is None:
                        return False
                    self._fill(entry_ptr, item)
                    return True

                def Process32NextW(self, _snap, entry_ptr):
                    item = next(state["iter"], None)
                    if item is None:
                        return False
                    self._fill(entry_ptr, item)
                    return True

                def _fill(self, entry_ptr, item):
                    pid, ppid, exe_name = item
                    addr = ctypes.addressof(entry_ptr._obj)
                    obj = type(entry_ptr._obj).from_address(addr)
                    obj.th32ProcessID = pid
                    obj.th32ParentProcessID = ppid
                    obj.szExeFile = exe_name

                def CloseHandle(self, _snap):
                    return True

            return FakeKernel32()

        with patch("os.getpid", return_value=100), patch.object(
            ctypes.windll, "kernel32", make_fake_kernel32(chain_edge)
        ):
            self.assertEqual(host._detect_browser_executable(), "msedge.exe")

        chain_cli = [(200, 150, "python.exe"), (150, 1, "explorer.exe")]
        with patch("os.getpid", return_value=200), patch.object(
            ctypes.windll, "kernel32", make_fake_kernel32(chain_cli)
        ):
            self.assertEqual(host._detect_browser_executable(), "")


if __name__ == "__main__":
    unittest.main()
