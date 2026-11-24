# Commandes pip à exécuter : Aucune dépendance externe requise (bibliothèque standard uniquement)

import ast
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
from typing import Dict, List, Optional, Set, Tuple

ROOT_DIR: str = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


class ClipboardTestRunner:
    """
    Exécute la suite de tests unitaires en affichant tout en direct, calcule
    la couverture des lignes (trace Python + V8 Node.js) et génère un bilan compact.
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
            return " ".join(ln.strip() for ln in all_lines[start:end])[:240]
        except OSError:
            return ""

    @staticmethod
    def _clean_noise_banners(text: str) -> str:
        cleaned: str = re.sub(r"[#=-]{6,}", "", text)
        cleaned = cleaned.replace("\\n", " | ")
        cleaned = re.sub(r"(?:\s*\|\s*){2,}", " | ", cleaned)
        cleaned = re.sub(r"\s{2,}", " ", cleaned)
        return cleaned.strip()
    @staticmethod
    def _format_line_ranges(lines: List[int]) -> str:
        if not lines:
            return ""
        sorted_lines: List[int] = sorted(set(lines))
        it = iter(sorted_lines)
        start: int = next(it)
        prev: int = start
        ranges: List[str] = []
        for num in it:
            if num == prev + 1:
                prev = num
            else:
                ranges.append(f"{start}-{prev}" if start != prev else str(start))
                start = prev = num
        ranges.append(f"{start}-{prev}" if start != prev else str(start))
        return ", ".join(ranges)

    @staticmethod
    def _collect_executable_py_lines(py_path: str) -> Set[int]:
        try:
            with open(py_path, "r", encoding="utf-8", errors="replace") as f_src:
                source: str = f_src.read()
            tree = ast.parse(source, filename=py_path)
        except Exception:
            return set()
        docstring_lines: Set[int] = set()
        for node in ast.walk(tree):
            if isinstance(node, (ast.Module, ast.ClassDef, ast.FunctionDef, ast.AsyncFunctionDef)):
                first_stmt = next(iter(node.body), None)
                if isinstance(first_stmt, ast.Expr):
                    val = first_stmt.value
                    if isinstance(val, ast.Constant) and isinstance(val.value, str):
                        end_ln: int = getattr(first_stmt, "end_lineno", first_stmt.lineno)
                        docstring_lines.update(range(first_stmt.lineno, end_ln + 1))
        exec_lines: Set[int] = set()
        for node in ast.walk(tree):
            if isinstance(node, ast.stmt) and hasattr(node, "lineno"):
                if not isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef, ast.Import, ast.ImportFrom)):
                    if node.lineno not in docstring_lines:
                        exec_lines.add(node.lineno)
        return exec_lines

    def _compute_python_uncovered(self, counts: Dict[Tuple[str, int], int], top_dir: str) -> List[str]:
        executed_by_file: Dict[str, Set[int]] = {}
        for (fname, lineno), hit in counts.items():
            if hit > 0:
                executed_by_file.setdefault(os.path.normcase(os.path.realpath(fname)), set()).add(lineno)
        top_real: str = os.path.realpath(top_dir)
        reports: List[str] = []
        skip_dirs = {"tests", "__pycache__", ".venv", "venv", ".watch_clipboard", ".native_host"}
        for root, dirs, files in os.walk(top_real):
            dirs[:] = sorted(d for d in dirs if d not in skip_dirs)
            for fname in sorted(files):
                if not fname.endswith(".py") or fname == "__init__.py":
                    continue
                full_p: str = os.path.join(root, fname)
                exec_lines: Set[int] = self._collect_executable_py_lines(full_p)
                if not exec_lines:
                    continue
                hit_lines: Set[int] = executed_by_file.get(os.path.normcase(full_p), set())
                missed: List[int] = sorted(exec_lines - hit_lines)
                if missed:
                    rel_p: str = os.path.relpath(full_p, self.workspace_root).replace("\\", "/")
                    pct: int = int(round(100 * (len(exec_lines) - len(missed)) / len(exec_lines)))
                    reports.append(f"- {rel_p} ({pct}%) : lignes {self._format_line_ranges(missed)}")
        return reports
    def _parse_v8_coverage(self, cov_dir: str, ext_dir: str) -> List[str]:
        ext_real: str = os.path.normcase(os.path.realpath(ext_dir))
        uncovered_by_file: Dict[str, Set[int]] = {}
        for entry in os.listdir(cov_dir):
            if not entry.endswith(".json"):
                continue
            try:
                with open(os.path.join(cov_dir, entry), "r", encoding="utf-8") as f_cov:
                    data = json.load(f_cov)
            except Exception:
                continue
            for script in data.get("result", []):
                raw_url: str = str(script.get("url", ""))
                if not raw_url.startswith("file:///"):
                    continue
                local_p: str = os.path.normcase(os.path.realpath(raw_url[8:].replace("/", os.sep)))
                if not local_p.startswith(ext_real + os.sep) or f"{os.sep}tests{os.sep}" in local_p or not os.path.isfile(local_p):
                    continue
                with open(local_p, "r", encoding="utf-8", errors="replace") as f_js:
                    text: str = f_js.read()
                line_starts: List[int] = list((0,)) + [m.end() for m in re.finditer(r"\n", text)]
                missed_lines: Set[int] = set()
                for fn_cov in script.get("functions", []):
                    for rng in fn_cov.get("ranges", []):
                        if rng.get("count", 0) == 0:
                            s_off, e_off = rng.get("startOffset", 0), rng.get("endOffset", 0)
                            for idx, off in enumerate(line_starts):
                                end_line_off: int = line_starts[idx + 1] if idx + 1 < len(line_starts) else len(text)
                                if end_line_off > s_off and off < e_off:
                                    ln_txt: str = text[off:end_line_off].strip()
                                    if ln_txt and not ln_txt.startswith(("//", "/*", "*")) and ln_txt not in ("{", "}", "});"):
                                        missed_lines.add(idx + 1)
                if missed_lines:
                    uncovered_by_file.setdefault(local_p, set()).update(missed_lines)
        out: List[str] = []
        for norm_p, missed_set in sorted(uncovered_by_file.items()):
            rel_p: str = os.path.relpath(norm_p, self.workspace_root).replace("\\", "/")
            out.append(f"- {rel_p} : lignes {self._format_line_ranges(sorted(missed_set))}")
        return out

    def compact_error_report(self, raw_output: str, top_dir: str) -> str:
        lines: List[str] = raw_output.splitlines()
        start_idx: Optional[int] = next(
            (i for i, ln in enumerate(lines) if ln.startswith("=" * 20) and i + 1 < len(lines) and lines[i + 1].lstrip().startswith(("FAIL:", "ERROR:"))),
            None,
        )
        if start_idx is None:
            start_idx = next((i for i, ln in enumerate(lines) if ln.lstrip().startswith(("FAIL:", "ERROR:", "Traceback"))), None)
        if start_idx is None:
            return "\n".join(ln.strip() for ln in lines[-20:] if ln.strip())
        blocks: List[List[str]] = []
        current: List[str] = []
        summary_footer: List[str] = []
        for ln in lines[start_idx:]:
            s_strip: str = ln.strip()
            if s_strip.startswith(("Ran ", "FAILED", "OK")):
                summary_footer.append(s_strip)
            elif ln.startswith("=" * 20):
                if current:
                    blocks.append(current)
                    current = []
            elif not ln.startswith("-" * 20):
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
                if not s or s == "Traceback (most recent call last):" or (idx == 1 and not s.startswith(("File ", "ERROR:", "FAIL:"))):
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
                err_file, err_line = last_file_info
                code_ctx: str = self._read_source_snippet(err_file, err_line, top_dir=top_dir, context=4)
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
            compact_lines.extend(["", " | ".join(summary_footer)])
        return "\n".join(compact_lines).strip()
    def _stream_subprocess(self, cmd: List[str], cwd: str, env: dict) -> Tuple[int, str]:
        proc = subprocess.Popen(cmd, cwd=cwd, env=env, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, encoding="utf-8", errors="replace")
        lines_out: List[str] = []
        assert proc.stdout is not None
        for line in proc.stdout:
            sys.stdout.write(line)
            sys.stdout.flush()
            lines_out.append(line)
        return proc.wait(), "".join(lines_out).strip()

    def _run_single_suite(self, suite_name: str, tests_dir: str, top_dir: str) -> Tuple[int, str, List[str]]:
        env = {**os.environ, "PYTHONUTF8": "1", "PYTHONIOENCODING": "utf-8", "PYTHONUNBUFFERED": "1", "PYTHONPATH": top_dir}
        with tempfile.TemporaryDirectory(prefix="cov_py_") as tmp_cov:
            cov_json: str = os.path.join(tmp_cov, "py_cov.json")
            harness: str = (
                "import json, sys, trace, unittest; "
                "_, t_dir, top_d, out_j = sys.argv; "
                "tr = trace.Trace(count=1, trace=0); "
                "res = tr.runfunc(lambda: unittest.TextTestRunner(verbosity=2).run(unittest.defaultTestLoader.discover(t_dir, top_level_dir=top_d))); "
                "counts = {f'{f}|{ln}': c for (f, ln), c in tr.results().counts.items()}; "
                "open(out_j, 'w', encoding='utf-8').write(json.dumps(counts)); "
                "sys.exit(0 if res.wasSuccessful() else 1)"
            )
            rc, combined = self._stream_subprocess([sys.executable, "-u", "-c", harness, tests_dir, top_dir, cov_json], cwd=top_dir, env=env)
            uncovered: List[str] = []
            if os.path.isfile(cov_json):
                raw_counts = json.loads(open(cov_json, "r", encoding="utf-8").read())
                parsed_counts: Dict[Tuple[str, int], int] = {}
                for key_str, hit_val in raw_counts.items():
                    f_part, ln_part = key_str.rsplit("|", 1)
                    parsed_counts[(f_part, int(ln_part))] = int(hit_val)
                uncovered = self._compute_python_uncovered(parsed_counts, top_dir)
        has_failure: bool = any(ln.strip().startswith(("FAIL:", "ERROR:", "FAILED")) for ln in combined.splitlines())
        if rc == 0 and not has_failure:
            summary_lines: List[str] = [ln.strip() for ln in combined.splitlines() if ln.strip().startswith(("Ran ", "OK"))]
            return 0, f"[{suite_name}] {' | '.join(summary_lines) if summary_lines else 'OK'}", uncovered
        return rc or 1, f"[{suite_name}] ÉCHEC :\n{self.compact_error_report(combined, top_dir=top_dir)}", uncovered

    def _run_node_extension_tests(self) -> List[Tuple[int, str, List[str]]]:
        results: List[Tuple[int, str, List[str]]] = []
        node_exe: Optional[str] = shutil.which("node")
        if not node_exe:
            return results
        targets = [
            ("ChromeAI", os.path.join(self.workspace_root, "ChromeAI"), os.path.join("tests", "extension_logic.test.js")),
            ("CareBreakAI", os.path.join(self.workspace_root, "CareBreakAI"), os.path.join("tests", "break_guard.test.js")),
        ]
        for label, ext_dir, rel_test in targets:
            js_test_file: str = os.path.join(ext_dir, rel_test)
            if not os.path.isfile(js_test_file):
                continue
            with tempfile.TemporaryDirectory(prefix="cov_v8_") as cov_dir:
                env = {**os.environ, "NODE_V8_COVERAGE": cov_dir}
                rc, combined = self._stream_subprocess([node_exe, "--test", js_test_file], cwd=ext_dir, env=env)
                uncovered: List[str] = self._parse_v8_coverage(cov_dir, ext_dir)
            if rc == 0:
                summary: List[str] = [ln.strip() for ln in combined.splitlines() if ln.strip().startswith("# ")]
                results.append((0, f"[{label}] {' | '.join(summary) if summary else 'OK'}", uncovered))
            else:
                results.append((rc or 1, f"[{label}] ÉCHEC :\n{combined}", uncovered))
        return results

    def run(self, report_file: str = "", coverage_file: str = "") -> int:
        suites = self._discover_suites()
        overall_rc: int = 0
        reports: List[str] = []
        all_uncovered: List[str] = []
        for suite_name, tests_dir, top_dir in suites:
            rc, report, uncov = self._run_single_suite(suite_name, tests_dir, top_dir)
            if rc != 0 and overall_rc == 0:
                overall_rc = rc
            reports.append(report)
            all_uncovered.extend(uncov)
        for js_rc, js_report, js_uncov in self._run_node_extension_tests():
            if js_rc != 0 and overall_rc == 0:
                overall_rc = js_rc
            reports.append(js_report)
            all_uncovered.extend(js_uncov)
        if not reports:
            print("Aucune suite de tests trouvée.", flush=True)
            return 1
        final_output: str = "\n".join(reports).strip()
        if report_file:
            with open(report_file, "w", encoding="utf-8") as f_rep:
                f_rep.write(final_output)
        if coverage_file:
            cov_text: str = "\n".join(all_uncovered).strip()
            with open(coverage_file, "w", encoding="utf-8") as f_cov:
                f_cov.write(cov_text)
        if self.use_clipboard and self.copy_to_clipboard(final_output):
            print("[PRESSE-PAPIERS] Résumé copié." if overall_rc == 0 else f"\n[PRESSE-PAPIERS] {len(final_output)} car. copiés.", flush=True)
        return overall_rc


def main() -> int:
    use_clip: bool = "--no-clipboard" not in sys.argv
    report_file: str = ""
    coverage_file: str = ""
    if "--report-file" in sys.argv:
        idx_arg: int = sys.argv.index("--report-file")
        if idx_arg + 1 < len(sys.argv):
            report_file = sys.argv[idx_arg + 1]
    if "--coverage-file" in sys.argv:
        idx_cov: int = sys.argv.index("--coverage-file")
        if idx_cov + 1 < len(sys.argv):
            coverage_file = sys.argv[idx_cov + 1]
    return ClipboardTestRunner(project_root=ROOT_DIR, use_clipboard=use_clip).run(report_file=report_file, coverage_file=coverage_file)


if __name__ == "__main__":
    sys.exit(main())
