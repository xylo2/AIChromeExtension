# Commandes pip à exécuter : Aucune dépendance externe requise (bibliothèque standard uniquement - lancer avec : python -m unittest discover tests)

import json
import os
import socket
import subprocess
import tempfile
import unittest
import urllib.error
import urllib.request
from clipboard_watcher.status_server import StatusServer, _StatusRequestHandler


class TestGitEndpoints(unittest.TestCase):
    """
    Tests unitaires vérifiant GET /git-status, POST /git-diff, POST /git-commit et POST /git-push.
    """

    def _find_free_port(self) -> int:
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
            sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
            sock.bind(("127.0.0.1", 0))
            _, port = sock.getsockname()
            return int(port)

    def _no_proxy_opener(self) -> urllib.request.OpenerDirector:
        return urllib.request.build_opener(urllib.request.ProxyHandler({}))

    def test_format_git_push_error_extracts_fatal_and_credential_hint(self) -> None:
        raw: str = (
            "To https://example.com\n"
            "fatal: could not read Username for 'https://example.com': terminal prompts disabled\n"
        )
        formatted: str = _StatusRequestHandler._format_git_push_error(raw)
        self.assertIn("fatal: could not read Username", formatted)
        self.assertIn("credential.helper manager", formatted)

    def test_git_status_selective_diff_commit_and_push(self) -> None:
        opener = self._no_proxy_opener()
        with tempfile.TemporaryDirectory() as base_tmp:
            bare_remote = os.path.join(base_tmp, "remote.git")
            tmp_dir = os.path.join(base_tmp, "work")
            os.makedirs(bare_remote)
            os.makedirs(tmp_dir)
            subprocess.run(["git", "init", "--bare"], cwd=bare_remote, check=True, capture_output=True)
            subprocess.run(["git", "init", "-b", "main"], cwd=tmp_dir, check=True, capture_output=True)
            subprocess.run(["git", "config", "user.email", "test@example.com"], cwd=tmp_dir, check=True)
            subprocess.run(["git", "config", "user.name", "Test User"], cwd=tmp_dir, check=True)
            subprocess.run(["git", "remote", "add", "origin", bare_remote], cwd=tmp_dir, check=True)

            tracked = os.path.join(tmp_dir, "app.py")
            other = os.path.join(tmp_dir, "other.py")
            with open(tracked, "w", encoding="utf-8") as f:
                f.write("x = 1\n")
            with open(other, "w", encoding="utf-8") as f:
                f.write("y = 1\n")
            subprocess.run(["git", "add", "app.py", "other.py"], cwd=tmp_dir, check=True)
            subprocess.run(["git", "commit", "-m", "init"], cwd=tmp_dir, check=True, capture_output=True)

            with open(tracked, "w", encoding="utf-8") as f:
                f.write("x = 2\n")
            with open(other, "w", encoding="utf-8") as f:
                f.write("y = 2\n")

            port = self._find_free_port()
            server = StatusServer(host="127.0.0.1", port=port, target_dir=tmp_dir)
            self.assertTrue(server.start())
            try:
                with opener.open(f"http://127.0.0.1:{port}/git-status", timeout=5.0) as st_resp:
                    st_data = json.loads(st_resp.read().decode("utf-8"))
                    self.assertTrue(st_data.get("ok"))
                    paths = {e["path"] for e in st_data.get("entries", [])}
                    self.assertEqual(paths, {"app.py", "other.py"})

                diff_req = urllib.request.Request(
                    f"http://127.0.0.1:{port}/git-diff",
                    data=json.dumps({"files": ["app.py"]}).encode("utf-8"),
                    headers={"Content-Type": "application/json"},
                    method="POST",
                )
                with opener.open(diff_req, timeout=5.0) as diff_resp:
                    diff_data = json.loads(diff_resp.read().decode("utf-8"))
                    self.assertTrue(diff_data.get("ok"))
                    self.assertIn("+x = 2", diff_data.get("content", ""))
                    self.assertNotIn("+y = 2", diff_data.get("content", ""))

                commit_req = urllib.request.Request(
                    f"http://127.0.0.1:{port}/git-commit",
                    data=json.dumps({"message": "fix: update x only", "files": ["app.py"]}).encode("utf-8"),
                    headers={"Content-Type": "application/json"},
                    method="POST",
                )
                with opener.open(commit_req, timeout=5.0) as commit_resp:
                    commit_data = json.loads(commit_resp.read().decode("utf-8"))
                    self.assertTrue(commit_data.get("ok"))

                bad_push = urllib.request.Request(
                    f"http://127.0.0.1:{port}/git-push",
                    data=json.dumps({"remote": "--force", "branch": "main"}).encode("utf-8"),
                    headers={"Content-Type": "application/json"},
                    method="POST",
                )
                with self.assertRaises(urllib.error.HTTPError) as push_err:
                    opener.open(bad_push, timeout=5.0)
                self.assertEqual(push_err.exception.code, 400)

                push_req = urllib.request.Request(
                    f"http://127.0.0.1:{port}/git-push",
                    data=json.dumps({"remote": "origin", "branch": "main"}).encode("utf-8"),
                    headers={"Content-Type": "application/json"},
                    method="POST",
                )
                with opener.open(push_req, timeout=10.0) as push_resp:
                    push_data = json.loads(push_resp.read().decode("utf-8"))
                    self.assertTrue(push_data.get("ok"))

                with opener.open(f"http://127.0.0.1:{port}/git-status", timeout=5.0) as after_resp:
                    after_data = json.loads(after_resp.read().decode("utf-8"))
                    remaining = [e["path"] for e in after_data.get("entries", [])]
                    self.assertEqual(remaining, ["other.py"])
            finally:
                server.stop()


if __name__ == "__main__":
    unittest.main()
