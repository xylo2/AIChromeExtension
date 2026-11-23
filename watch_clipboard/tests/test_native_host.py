# Commandes pip à exécuter : Aucune dépendance externe requise (lancer avec : python -m unittest discover tests)

import ctypes
import io
import json
import os
import struct
import tempfile
import unittest
from unittest.mock import patch
from clipboard_watcher.native_host import NativeMessagingHost


class TestNativeMessagingHost(unittest.TestCase):
    """
    Tests unitaires vérifiant le protocole binaire Native Messaging,
    la résolution du répertoire racine et la détection du navigateur parent.
    """

    def test_work_dir_resolution_and_command_building(self) -> None:
        """
        Vérifie que work_dir remonte deux niveaux au-dessus de tools/watch_clipboard
        et que les arguments CLI sont correctement assemblés.
        """
        with tempfile.TemporaryDirectory() as tmp_root:
            script_path: str = os.path.join(tmp_root, "tools", "watch_clipboard", "watch_clipboard.py")
            os.makedirs(os.path.dirname(script_path), exist_ok=True)
            with open(script_path, "w", encoding="utf-8") as f:
                f.write("# stub\n")

            host: NativeMessagingHost = NativeMessagingHost(script_path=script_path)
            self.assertEqual(host.work_dir, os.path.abspath(tmp_root))

            cmd = host._build_command(target_dir="Médical\\", extra_args="--verbose")
            self.assertEqual(cmd[-2:], ["Médical", "--verbose"])

    def test_read_and_send_message_protocol(self) -> None:
        """
        Vérifie la lecture et l'écriture des messages préfixés par leur taille sur 4 octets.
        """
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
        """
        Vérifie que _detect_browser_executable remonte jusqu'à 12 niveaux (ex: msedge.exe)
        et retourne '' sans forcer chrome.exe si aucun navigateur n'est trouvé.
        """
        host: NativeMessagingHost = NativeMessagingHost(script_path="watch_clipboard.py")

        # Arbre de 8 processus intermédiaires menant à msedge.exe
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
            idx = {"pos": 0}

            class FakeKernel32:
                def CreateToolhelp32Snapshot(self, _flags, _pid):
                    return 1234

                def Process32FirstW(self, _snap, entry_ptr):
                    if not entries:
                        return False
                    idx["pos"] = 0
                    obj = ctypes.cast(entry_ptr, ctypes.POINTER(ctypes.c_byte))
                    self._fill(entry_ptr, entries[0])
                    return True

                def Process32NextW(self, _snap, entry_ptr):
                    idx["pos"] += 1
                    if idx["pos"] >= len(entries):
                        return False
                    self._fill(entry_ptr, entries[idx["pos"]])
                    return True

                def _fill(self, entry_ptr, item):
                    struct_obj = ctypes.pythonapi.PyCapsule_GetPointer if False else None
                    # Accès direct aux attributs via ctypes.from_address
                    addr = ctypes.addressof(entry_ptr._obj)
                    type(entry_ptr._obj).from_address(addr).th32ProcessID = item[0]
                    type(entry_ptr._obj).from_address(addr).th32ParentProcessID = item[1]
                    type(entry_ptr._obj).from_address(addr).szExeFile = item[2]

                def CloseHandle(self, _snap):
                    return True

            return FakeKernel32()

        with patch("os.getpid", return_value=100), patch.object(
            ctypes.windll, "kernel32", make_fake_kernel32(chain_edge)
        ):
            self.assertEqual(host._detect_browser_executable(), "msedge.exe")

        # Arbre sans navigateur -> doit retourner "" et non "chrome.exe"
        chain_cli = [(200, 150, "python.exe"), (150, 1, "explorer.exe")]
        with patch("os.getpid", return_value=200), patch.object(
            ctypes.windll, "kernel32", make_fake_kernel32(chain_cli)
        ):
            self.assertEqual(host._detect_browser_executable(), "")


if __name__ == "__main__":
    unittest.main()
