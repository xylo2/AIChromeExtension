import fnmatch
import os
import re
import subprocess
from typing import Any, Callable, Dict, List, Optional, Tuple


class GitOperations:
    """Encapsule les opérations Git locales (status, diff -U2 compact, commit, push)."""

    NOISY_DIFF_PATTERNS: Tuple[str, ...] = (
        "package-lock.json", "yarn.lock", "pnpm-lock.yaml", "poetry.lock",
        "*.min.js", "*.min.css", "*.map", "*.png", "*.jpg", "*.jpeg", "*.ico", "*.woff2",
    )

    def __init__(
        self,
        target_dir: str,
        is_within_roots_fn: Callable[[str, List[str]], bool],
        find_git_root_fn: Optional[Callable[[], Optional[str]]] = None,
        run_fn: Callable[..., Any] = subprocess.run,
    ) -> None:
        self.target_dir: str = target_dir
        self._is_within_allowed_roots = is_within_roots_fn
        self._find_git_root_override = find_git_root_fn
        self._run = run_fn

    def _resolve_root(self) -> Optional[str]:
        return self._find_git_root_override() if self._find_git_root_override is not None else self.find_git_root()

    def find_git_root(self) -> Optional[str]:
        base_real: str = os.path.realpath(self.target_dir)
        try:
            proc = self._run(
                ["git", "rev-parse", "--show-toplevel"],
                cwd=base_real, capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=10, check=False,
            )
            if proc.returncode == 0 and proc.stdout.strip():
                return os.path.realpath(proc.stdout.strip())
        except Exception:
            pass
        return None

    def status_entries(self) -> Tuple[bool, List[Dict[str, str]], str]:
        git_root: Optional[str] = self._resolve_root()
        if not git_root:
            return False, [], "Aucun dépôt Git détecté."
        base_real: str = os.path.realpath(self.target_dir)
        cmd: List[str] = ["git", "-c", "core.quotePath=false", "status", "--porcelain", "-uall"]
        if base_real != git_root and self._is_within_allowed_roots(base_real, [git_root]):
            cmd.extend(["--", os.path.relpath(base_real, git_root).replace("\\", "/")])
        proc = self._run(cmd, cwd=git_root, capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=15, check=False)
        if proc.returncode != 0:
            return False, [], (proc.stderr or proc.stdout or "Erreur git status").strip()
        entries: List[Dict[str, str]] = []
        for raw_line in proc.stdout.splitlines():
            if len(raw_line) < 4:
                continue
            code: str = raw_line[:2].strip() or "M"
            rel_path: str = raw_line[3:].strip().strip('"').split(" -> ")[-1]
            if rel_path:
                entries.append({"status": code, "path": rel_path.replace("\\", "/")})
        return True, entries, ""

    @classmethod
    def _is_noisy_diff_file(cls, rel: str) -> bool:
        bname: str = os.path.basename(rel).lower()
        return any(fnmatch.fnmatch(bname, pat) for pat in cls.NOISY_DIFF_PATTERNS)
    @staticmethod
    def _summarize_untracked_test(rel: str, content: str) -> str:
        low = rel.lower()
        is_test = "/tests/" in f"/{low}" or os.path.basename(low).startswith("test_") or low.endswith((".test.js", ".spec.js"))
        if not is_test or len(content) <= 3500:
            return content[:12000]
        test_defs = [ln.strip() for ln in content.splitlines() if re.match(r"^\s*(?:async\s+)?(?:def\s+test_|test\(|it\()", ln)]
        summary = "\n".join(test_defs[:40]) or content[:2500]
        return f"[Résumé nouveau fichier de tests ({len(content.splitlines())} lignes)]\n{summary}"

    def diff_selected(self, files: List[str]) -> Tuple[bool, str, str]:
        git_root: Optional[str] = self._resolve_root()
        if not git_root:
            return False, "", "Aucun dépôt Git détecté."
        clean_files: List[str] = [
            str(item).strip().replace("\\", "/") for item in files
            if str(item).strip() and not str(item).strip().startswith("/") and not os.path.isabs(str(item).strip())
            and self._is_within_allowed_roots(os.path.realpath(os.path.join(git_root, str(item).strip())), [git_root])
        ]
        if not clean_files:
            return False, "", "Aucun fichier valide sélectionné."
        diffable: List[str] = [f for f in clean_files if not self._is_noisy_diff_file(f)]
        chunks: List[str] = []
        st_proc = self._run(["git", "status", "--short", "--", *clean_files], cwd=git_root, capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=15, check=False)
        if st_proc.stdout.strip():
            chunks.append("=== GIT STATUS ===\n" + st_proc.stdout.strip())
        if diffable:
            has_head = self._run(["git", "rev-parse", "--verify", "HEAD"], cwd=git_root, capture_output=True, check=False).returncode == 0
            diff_cmd: List[str] = ["git", "diff", "-U2", "HEAD", "--", *diffable] if has_head else ["git", "diff", "-U2", "--cached", "--", *diffable]
            diff_proc = self._run(diff_cmd, cwd=git_root, capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=20, check=False)
            if diff_proc.stdout.strip():
                chunks.append("=== GIT DIFF ===\n" + diff_proc.stdout.strip())
            if not has_head:
                wt_proc = self._run(["git", "diff", "-U2", "--", *diffable], cwd=git_root, capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=20, check=False)
                if wt_proc.stdout.strip():
                    chunks.append("=== GIT DIFF (WORKING TREE) ===\n" + wt_proc.stdout.strip())
        for rel in diffable:
            full_p: str = os.path.join(git_root, rel)
            ut_proc = self._run(["git", "ls-files", "--others", "--exclude-standard", "--", rel], cwd=git_root, capture_output=True, text=True, check=False)
            if ut_proc.stdout.strip() and os.path.isfile(full_p):
                with open(full_p, "r", encoding="utf-8", errors="replace") as f_ut:
                    chunks.append(f"=== NOUVEAU FICHIER : {rel} ===\n" + self._summarize_untracked_test(rel, f_ut.read()))
        return True, ("\n\n".join(chunks).strip() or "Modifications sélectionnées sans diff textuel."), ""

    @staticmethod
    def format_push_error(raw_output: str) -> str:
        lines: List[str] = [ln.strip() for ln in raw_output.splitlines() if ln.strip()]
        if not lines:
            return "Échec de git push (sortie vide)."
        prefixes: Tuple[str, ...] = ("fatal:", "error:", "! [", "remote: error", "permission denied")
        important: List[str] = [ln for ln in lines if any(ln.lower().startswith(pref) for pref in prefixes)]
        summary: str = " | ".join(important[:2]) if important else lines[-1]
        if "terminal prompts disabled" in raw_output.lower() or "could not read username" in raw_output.lower():
            summary += "\nConseil : exécutez `git config --global credential.helper manager` dans un terminal."
        return f"{summary}\n\nSortie complète Git :\n{raw_output.strip()}" if len(lines) > 1 else summary

    def commit_and_push(self, action: str, message: str = "", files: Optional[List[str]] = None, remote: str = "origin", branch: str = "") -> Tuple[bool, str]:
        git_root: Optional[str] = self._resolve_root()
        if not git_root:
            return False, "Aucun dépôt Git détecté."
        env: Dict[str, str] = {**os.environ, "GIT_TERMINAL_PROMPT": "0"}
        if action == "commit":
            clean_msg: str = message.strip()
            if not clean_msg:
                return False, "Message de commit vide."
            safe_files: List[str] = [
                str(item).strip().replace("\\", "/") for item in (files or [])
                if str(item).strip() and not os.path.isabs(str(item).strip())
                and self._is_within_allowed_roots(os.path.realpath(os.path.join(git_root, str(item).strip())), [git_root])
            ]
            if safe_files:
                self._run(["git", "reset", "-q"], cwd=git_root, env=env, capture_output=True, timeout=15, check=False)
                add_cmd: List[str] = ["git", "add", "-A", "--", *safe_files]
            else:
                add_cmd = ["git", "add", "-A"]
            add_proc = self._run(add_cmd, cwd=git_root, env=env, capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=20, check=False)
            if add_proc.returncode != 0:
                return False, (add_proc.stderr or add_proc.stdout or "Échec de git add.").strip()
            proc = self._run(["git", "commit", "-m", clean_msg], cwd=git_root, env=env, capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=25, check=False)
            out: str = (proc.stdout or proc.stderr or "").strip()
            return (True, out) if proc.returncode == 0 else (False, out or "Échec de git commit.")
        if action == "push":
            clean_remote: str = (remote or "origin").strip() or "origin"
            clean_branch: str = (branch or "").strip()
            ref_re = re.compile(r"^[A-Za-z0-9._/-]+$")
            if not ref_re.match(clean_remote) or clean_remote.startswith("-") or (clean_branch and (not ref_re.match(clean_branch) or clean_branch.startswith("-"))):
                return False, "Paramètres remote ou branch invalides."
            target_ref: str = clean_branch or "HEAD"
            if os.name == "nt" and not env.get("HOME") and env.get("USERPROFILE"):
                env["HOME"] = env["USERPROFILE"]
            p_pu = self._run(["git", "push", "-u", clean_remote, target_ref], cwd=git_root, env=env, capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=55, check=False)
            out_p: str = ((p_pu.stderr or "") + "\n" + (p_pu.stdout or "")).strip()
            return (True, out_p or f"Push effectué vers {clean_remote}/{target_ref}.") if p_pu.returncode == 0 else (False, self.format_push_error(out_p))
        return False, "Action Git inconnue."
