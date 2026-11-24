# Commandes pip à exécuter : Aucune dépendance externe requise (lancer avec : python -m unittest discover tests)

import os
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import MagicMock, patch
import urllib.error
import urllib.request

from clipboard_watcher.assembler import FileAssembler
from clipboard_watcher.config import WatcherConfig
from clipboard_watcher.native_host import NativeMessagingHost
from clipboard_watcher.status_server import StatusServer
from clipboard_watcher.watcher import ClipboardWatcher
from install_native_host import NativeHostInstaller
import watch_clipboard as wc_main


class TestCoverageBoost(unittest.TestCase):
    """
    Tests complémentaires couvrant les branches secondaires de watch_clipboard,
    StatusServer, NativeHostInstaller, ClipboardWatcher et FileAssembler.
    """

    def test_application_runner_and_main(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            with patch.object(ClipboardWatcher, "start") as mock_start, patch.object(
                StatusServer, "start", return_value=True
            ) as mock_srv_start, patch.object(StatusServer, "stop") as mock_srv_stop:
                app = wc_main.ApplicationRunner(target_dir=tmp_dir, config_file="missing.ini")
                app.run()
                mock_srv_start.assert_called_once()
                mock_start.assert_called_once()
                mock_srv_stop.assert_called_once()

            with patch.object(sys, "argv", ["watch_clipboard.py", tmp_dir]), patch.object(
                wc_main.ApplicationRunner, "run"
            ) as mock_run:
                wc_main.main()
                mock_run.assert_called_once()

    def test_native_host_installer_wrapper_manifest_and_cli(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            inst = NativeHostInstaller(extension_id="abcdefghijklmnopabcdefghijklmnop")
            inst.project_dir = Path(tmp_dir)
            inst.native_dir = Path(tmp_dir) / ".native_host"
            inst.host_script = Path(tmp_dir) / "host.py"
            inst.host_script.write_text("# stub\n", encoding="utf-8")

            wrapper = inst._create_wrapper()
            self.assertTrue(wrapper.is_file())
            manifest = inst._write_manifest(wrapper)
            self.assertIn("abcdefghijklmnopabcdefghijklmnop", manifest.read_text(encoding="utf-8"))

            with patch("pathlib.Path.home", return_value=Path(tmp_dir) / "home"):
                (Path(tmp_dir) / "home" / ".config" / "google-chrome").mkdir(parents=True)
                inst._install_unix(manifest, "Linux")
                self.assertTrue(
                    (Path(tmp_dir) / "home" / ".config" / "google-chrome" / "NativeMessagingHosts" / f"{inst.HOST_NAME}.json").is_file()
                )

            with patch.object(sys, "argv", ["install_native_host.py"]), self.assertRaises(SystemExit):
                import install_native_host
                install_native_host.main()

    def test_native_messaging_host_actions(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            script_p = os.path.join(tmp_dir, "watch_clipboard.py")
            with open(script_p, "w", encoding="utf-8") as f_s:
                f_s.write("# stub\n")
            host = NativeMessagingHost(script_path=script_p)
            sent = []
            with patch.object(host, "read_message", return_value={"action": "ping"}), patch.object(
                host, "send_message", side_effect=sent.append
            ):
                host.run_once()
            self.assertEqual(next(iter(sent))["service"], "watch_clipboard_host")

            sent.clear()
            with patch.object(host, "read_message", return_value={"action": "unknown"}), patch.object(
                host, "send_message", side_effect=sent.append
            ):
                host.run_once()
            self.assertFalse(next(iter(sent))["ok"])

            sent.clear()
            with patch.object(host, "read_message", return_value={"action": "start", "target_dir": tmp_dir, "api_token": "tok"}), patch.object(
                host, "send_message", side_effect=sent.append
            ), patch("subprocess.Popen", return_value=type("P", (), {"pid": 4321})()):
                host.run_once()
            self.assertEqual(next(iter(sent))["pid"], 4321)

    def test_watcher_loop_and_assembler_edge_cases(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            cfg = WatcherConfig(config_path="missing.ini")
            cfg.poll_interval = 0.001
            asm = FileAssembler(base_dir=tmp_dir, config=cfg)
            self.assertTrue(asm.has_file_tags("=== FILE: a.py ==="))
            self.assertEqual(asm.process_text("sans balise"), 0)
            asm.process_text("=== FILE_PART: seq.py | 1 ===\na = 1\n")
            asm.process_text("=== FILE_PART: seq.py | 2 ===\nb = 2\n")
            self.assertTrue(os.path.isfile(os.path.join(tmp_dir, "seq.py")))

            watcher = ClipboardWatcher(base_dir=tmp_dir, assembler=asm, config=cfg)
            mock_root = MagicMock()
            mock_root.clipboard_get.side_effect = [
                "=== FILE: startup.py ===\nx = 1",
                "=== FILE: loop.py ===\ny = 2",
                KeyboardInterrupt(),
            ]
            with patch("tkinter.Tk", return_value=mock_root), patch.object(
                watcher, "_clear_clipboard_once"
            ), patch.object(watcher, "_get_win32_sequence_number", return_value=None):
                watcher.start()
            self.assertTrue(os.path.isfile(os.path.join(tmp_dir, "loop.py")))

    def test_status_server_404_and_runner_helpers(self) -> None:
        from tools.run_tests_clip import ClipboardTestRunner
        with tempfile.TemporaryDirectory() as tmp_dir:
            srv = StatusServer(host="127.0.0.1", port=0, target_dir=tmp_dir)
            self.assertTrue(srv.start())
            assert srv._httpd is not None
            _, port = srv._httpd.server_address
            opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
            try:
                with self.assertRaises(urllib.error.HTTPError) as ctx:
                    opener.open(f"http://127.0.0.1:{port}/unknown-route", timeout=2.0)
                self.assertEqual(ctx.exception.code, 404)
            finally:
                srv.stop()

            runner = ClipboardTestRunner(project_root=tmp_dir, use_clipboard=False)
            self.assertEqual(runner.run(), 1)
            self.assertFalse(runner.copy_to_clipboard(""))
