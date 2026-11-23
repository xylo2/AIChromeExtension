# Commandes pip à exécuter : Aucune dépendance externe requise (bibliothèque standard uniquement)

import os
import re
import shutil
import subprocess
import sys
from typing import List, Optional, Set, Tuple

ROOT_DIR: str = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


class ClipboardTestRunner:
    """
    Exécute la suite de tests unitaires en affichant tout en direct, puis
    génère un bilan compact (uniquement erreurs/résumé) pour le presse-papiers et Chrome.
    """

    def __init__(self, project_root: str, use_clipboard: bool = True) -> None:
        self.project_root: str = project_root
        self.workspace_root: str = os.path.dirname(self.project_root)
        self.use_clipboard: bool = use_clipboard

    def _discover_suites(self) -> List[Tuple[str, str, str]]:
        suites: List[Tuple[str, str, str]] = []

        local_tests: str = os.path.join(self.project_root, "tests")
        if os.path.isdir(local_tests):
            suites.append(("watch_clipboard", local_tests, self.project_root))

        sibling_export_root: str = os.path.join(self.workspace_root, "export")
        sibling_export_tests: str = os.path.join(sibling_export_root, "tests")
        if os.path.isdir(sibling_export_tests):
            suites.append(("export", sibling_export_tests, sibling_export_root))

        return suites

    @staticmethod
    def copy_to_clipboard(text: str) -> bool:
        if not text:
            return False
        if os.name == "nt":
            ps_script: str = (
                "[Console]::InputEncoding = [System.Text.Encoding]::UTF8; "
                "$txt = [Console]::In.ReadToEnd(); "
                "Set-Clipboard -Value $txt"
            )
            proc = subprocess.run(
                ["powershell", "-NoProfile", "-Command", ps_script],
                input=text.encode("utf-8"),
                check=False,
            )
            return proc.returncode == 0
        cmd: List[str] = ["pbcopy"] if sys.platform == "darwin" else ["xclip", "-selection", "clipboard"]
        try:
            proc = subprocess.run(cmd, input=text, text=True, encoding="utf-8", check=False)
            return proc.returncode == 0
        except FileNotFoundError:
            return False

    def _read_source_snippet(self, rel_file: str, line_num: int, top_dir: str, context: int = 3) -> str:
        full_path: str = rel_file if os.path.isabs(rel_file) else os.path.join(top_dir, rel_file)
        if not os.path.isfile(full_path):
            return ""
        try:
            with open(full_path, "r", encoding="utf-8", errors="replace") as f_in:
                all_lines: List[str] = f_in.read().splitlines()
            start: int = max(0, line_num - 1)
            end: int = min(len(all_lines), line_num + context)
            snippet: str = " ".join(ln.strip() for ln in all_lines[start:end])
            return snippet[:240]
        except OSError:
            return ""

    @staticmethod
    def _clean_noise_banners(text: str) -> str:
        cleaned: str = re.sub(r"[#=-]{6,}", "", text)
        cleaned = cleaned.replace("\\n", " | ")
        cleaned = re.sub(r"(?:\s*\|\s*){2,}", " | ", cleaned)
        cleaned = re.sub(r"\s{2,}", " ", cleaned)
        return cleaned.strip()

    def compact_error_report(self, raw_output: str, top_dir: str) -> str:
        lines: List[str] = raw_output.splitlines()
        start_idx: Optional[int] = next(
            (
                i
                for i, ln in enumerate(lines)
                if ln.startswith("=" * 20)
                and i + 1 < len(lines)
                and lines[i + 1].lstrip().startswith(("FAIL:", "ERROR:"))
            ),
            None,
        )
        if start_idx is None:
            start_idx = next(
                (i for i, ln in enumerate(lines) if ln.lstrip().startswith(("FAIL:", "ERROR:", "Traceback"))),
                None,
            )
        if start_idx is None:
            tail: List[str] = [ln.strip() for ln in lines[-20:] if ln.strip()]
            return "\n".join(tail)

        relevant: List[str] = lines[start_idx:]
        blocks: List[List[str]] = []
        current: List[str] = []
        summary_footer: List[str] = []
        for ln in relevant:
            s_strip: str = ln.strip()
            if s_strip.startswith(("Ran ", "FAILED", "OK")):
                summary_footer.append(s_strip)
                continue
            if ln.startswith("=" * 20):
                if current:
                    blocks.append(current)
                    current = []
            elif ln.startswith("-" * 20):
                continue
            else:
                current.append(ln)
        if current:
            blocks.append(current)
        root_prefix: str = top_dir.rstrip("\\/") + os.sep
        file_line_re = re.compile(r'File "([^"]+)", line (\d+)')
        seen_signatures: Set[str] = set()
        compact_lines: List[str] = []

        for blk in blocks:
            cleaned_blk: List[str] = []
            last_file_info: Optional[Tuple[str, int]] = None
            exc_line: str = ""
            for idx, ln in enumerate(blk):
                s: str = ln.strip()
                if not s or s == "Traceback (most recent call last):":
                    continue
                if idx == 1 and not s.startswith(("File ", "ERROR:", "FAIL:")):
                    continue
                s = s.replace(root_prefix, "").replace(root_prefix.replace("\\", "/"), "")
                m_fl = file_line_re.search(s)
                if m_fl:
                    last_file_info = (m_fl.group(1), int(m_fl.group(2)))
                if s.startswith("AssertionError:"):
                    s = self._clean_noise_banners(s)
                    if len(s) > 420:
                        s = s[:200] + " [...] " + s[-200:]
                if not s.startswith(("File ", "ERROR:", "FAIL:")):
                    exc_line = s
                cleaned_blk.append(s)
            if not cleaned_blk:
                continue
            if last_file_info is not None:
                rel_path, line_num = last_file_info
                code_ctx: str = self._read_source_snippet(rel_path, line_num, top_dir=top_dir, context=4)
                if code_ctx:
                    cleaned_blk.append(f"CODE: {code_ctx}")
            sig: str = "|".join(cleaned_blk[-3:])
            header: str = next(iter(cleaned_blk))
            if sig in seen_signatures and len(cleaned_blk) > 2:
                compact_lines.append(f"[DOUBLON] {header} -> {exc_line}")
            else:
                seen_signatures.add(sig)
                compact_lines.append(" | ".join(cleaned_blk))

        if summary_footer:
            compact_lines.append("")
            compact_lines.append(" | ".join(summary_footer))

        return "\n".join(compact_lines).strip()

    def _stream_subprocess(self, cmd: List[str], cwd: str, env: dict) -> Tuple[int, str]:
        proc = subprocess.Popen(
            cmd, cwd=cwd, env=env, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
            text=True, encoding="utf-8", errors="replace",
        )
        lines_out: List[str] = []
        assert proc.stdout is not None
        for line in proc.stdout:
            sys.stdout.write(line)
            sys.stdout.flush()
            lines_out.append(line)
        return proc.wait(), "".join(lines_out).strip()

    def _run_single_suite(self, suite_name: str, tests_dir: str, top_dir: str) -> Tuple[int, str]:
        env = {**os.environ, "PYTHONUTF8": "1", "PYTHONIOENCODING": "utf-8", "PYTHONUNBUFFERED": "1"}
        cmd: List[str] = [sys.executable, "-u", "-m", "unittest", "discover", "-s", tests_dir, "-t", top_dir, "-v"]
        rc, combined = self._stream_subprocess(cmd, cwd=top_dir, env=env)
        has_failure: bool = any(ln.strip().startswith(("FAIL:", "ERROR:", "FAILED")) for ln in combined.splitlines())

        if rc == 0 and not has_failure:
            summary_lines: List[str] = [ln.strip() for ln in combined.splitlines() if ln.strip().startswith(("Ran ", "OK"))]
            summary_txt: str = " | ".join(summary_lines) if summary_lines else "OK"
            return 0, f"[{suite_name}] {summary_txt}"

        compact_report: str = self.compact_error_report(combined, top_dir=top_dir)
        return rc or 1, f"[{suite_name}] ÉCHEC :\n{compact_report}"

    def _run_chrome_ai_node_tests(self) -> Optional[Tuple[int, str]]:
        chrome_ai_dir: str = os.path.join(self.workspace_root, "ChromeAI")
        js_test_file: str = os.path.join(chrome_ai_dir, "tests", "extension_logic.test.js")
        node_exe: Optional[str] = shutil.which("node")
        if not os.path.isfile(js_test_file) or not node_exe:
            return None

        rc, combined = self._stream_subprocess([node_exe, "--test", js_test_file], cwd=chrome_ai_dir, env=os.environ.copy())
        if rc == 0:
            summary: List[str] = [ln.strip() for ln in combined.splitlines() if ln.strip().startswith("# ")]
            return 0, f"[ChromeAI] {' | '.join(summary) if summary else 'OK'}"
        return rc or 1, f"[ChromeAI] ÉCHEC :\n{combined}"

    def run(self, report_file: str = "") -> int:
        suites: List[Tuple[str, str, str]] = self._discover_suites()
        overall_rc: int = 0
        reports: List[str] = []

        for suite_name, tests_dir, top_dir in suites:
            rc, report = self._run_single_suite(suite_name, tests_dir, top_dir)
            if rc != 0 and overall_rc == 0:
                overall_rc = rc
            reports.append(report)

        js_res: Optional[Tuple[int, str]] = self._run_chrome_ai_node_tests()
        if js_res is not None:
            js_rc, js_report = js_res
            if js_rc != 0 and overall_rc == 0:
                overall_rc = js_rc
            reports.append(js_report)

        if not reports:
            print("Aucune suite de tests trouvée.", flush=True)
            return 1

        final_output: str = "\n".join(reports).strip()
        if report_file:
            with open(report_file, "w", encoding="utf-8") as f_rep:
                f_rep.write(final_output)

        if self.use_clipboard and self.copy_to_clipboard(final_output):
            if overall_rc == 0:
                print("[PRESSE-PAPIERS] Résumé copié.", flush=True)
            else:
                print(f"\n[PRESSE-PAPIERS] {len(final_output)} car. copiés.", flush=True)

        return overall_rc


def main() -> int:
    use_clip: bool = "--no-clipboard" not in sys.argv
    report_file: str = ""
    if "--report-file" in sys.argv:
        idx_arg: int = sys.argv.index("--report-file")
        if idx_arg + 1 < len(sys.argv):
            report_file = sys.argv[idx_arg + 1]
    runner: ClipboardTestRunner = ClipboardTestRunner(project_root=ROOT_DIR, use_clipboard=use_clip)
    return runner.run(report_file=report_file)


if __name__ == "__main__":
    sys.exit(main())
