# Commandes pip à exécuter : Aucune dépendance externe requise (bibliothèque standard uniquement)

import ast
import io
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import tempfile
import tokenize
import trace
from typing import Dict, List, Optional, Set, Tuple
import unittest
import warnings

_TOOLS_PKG_DIR: str = os.path.dirname(os.path.abspath(__file__))
_WATCH_CLIP_ROOT: str = os.path.dirname(_TOOLS_PKG_DIR)
if _WATCH_CLIP_ROOT not in sys.path:
    sys.path.insert(0, _WATCH_CLIP_ROOT)

from tools.fix_urls import repair_tools_urls  # noqa: E402


class ClipboardTestRunner:
    """
    Exécute les suites unittest et Node.js, détecte les warnings Python,
    mesure la couverture de code et copie le rapport compact dans le presse-papiers.
    """

    WARNING_PATTERN = re.compile(
        r"^(?P<loc>.+?:\d+:\s+(?:DeprecationWarning|ResourceWarning|UserWarning|RuntimeWarning|SyntaxWarning|FutureWarning):.+)$",
        re.MULTILINE,
    )

    def __init__(self, project_root: str, use_clipboard: bool = True) -> None:
        self.project_root: str = os.path.abspath(project_root)
        self.use_clipboard: bool = use_clipboard

    @staticmethod
    def find_node_binary(search_root: Path) -> Optional[str]:
        candidates: List[Path] = []
        py_dir: Path = Path(sys.executable).resolve().parent
        candidates.extend([py_dir / "node.exe", py_dir / "node"])
        for base in (search_root, search_root.parent, search_root.parent.parent):
            for venv_name in (".venv", "venv"):
                candidates.extend([
                    base / venv_name / "Scripts" / "node.exe",
                    base / venv_name / "bin" / "node",
                ])
        for cand in candidates:
            if cand.is_file():
                return str(cand)
        return shutil.which("node.exe") or shutil.which("node")

    @classmethod
    def extract_warnings_and_console_errors(cls, raw_output: str) -> str:
        seen: Set[str] = set()
        unique_lines: List[str] = []
        for match in cls.WARNING_PATTERN.finditer(raw_output or ""):
            line: str = match.group("loc").strip()
            if line and line not in seen:
                seen.add(line)
                unique_lines.append(line)
        return "\n".join(unique_lines)

    @staticmethod
    def _format_line_ranges(lines: List[int]) -> str:
        if not lines:
            return ""
        sorted_lines: List[int] = sorted(set(lines))
        ranges: List[str] = []
        start: int = next(iter(sorted_lines))
        prev: int = start
        for ln in sorted_lines[1:]:
            if ln == prev + 1:
                prev = ln
            else:
                ranges.append(f"{start}-{prev}" if start != prev else str(start))
                start = prev = ln
        ranges.append(f"{start}-{prev}" if start != prev else str(start))
        return ", ".join(ranges)
    @staticmethod
    def _executable_lines(file_path: str) -> Set[int]:
        try:
            with open(file_path, "r", encoding="utf-8", errors="replace") as f_src:
                source: str = f_src.read()
            tree = ast.parse(source, filename=file_path)
        except Exception:
            return set()
        ignored: Set[int] = set()
        for node in ast.walk(tree):
            if isinstance(node, (ast.ClassDef, ast.FunctionDef, ast.AsyncFunctionDef)):
                ignored.add(node.lineno)
            if isinstance(node, (ast.Module, ast.ClassDef, ast.FunctionDef, ast.AsyncFunctionDef)):
                if node.body and isinstance(node.body, list):
                    first_stmt = next(iter(node.body), None)
                    if isinstance(first_stmt, ast.Expr) and isinstance(first_stmt.value, ast.Constant) and isinstance(first_stmt.value.value, str):
                        end_ln: int = getattr(first_stmt, "end_lineno", first_stmt.lineno)
                        ignored.update(range(first_stmt.lineno, end_ln + 1))
        exec_lines: Set[int] = set()
        try:
            tokens = tokenize.generate_tokens(io.StringIO(source).readline)
            for tok_type, _tok_str, (s_row, _), _, _ in tokens:
                if tok_type in (tokenize.NAME, tokenize.NUMBER, tokenize.STRING, tokenize.OP):
                    if s_row not in ignored:
                        exec_lines.add(s_row)
        except Exception:
            pass
        return exec_lines

    def compact_error_report(self, raw_output: str, top_dir: str = "") -> str:
        sections: List[str] = re.split(r"(?m)^={60,}\s*$", raw_output)
        kept_blocks: List[str] = []
        seen_sigs: Set[str] = set()
        summary_line: str = ""
        for sec in sections:
            lines: List[str] = [ln.rstrip() for ln in sec.strip().splitlines() if ln.strip()]
            if not lines:
                continue
            header: str = next(iter(lines))
            if header.startswith(("ERROR:", "FAIL:")):
                err_line: str = lines[-1]
                for ln in reversed(lines):
                    if not ln.startswith("---") and not ln.startswith("Ran ") and not ln.startswith("FAILED"):
                        err_line = ln
                        break
                sig: str = err_line[:120]
                if sig in seen_sigs:
                    kept_blocks.append(f"[DOUBLON] {header} -> {err_line[:140]}")
                    continue
                seen_sigs.add(sig)
                code_hint: str = ""
                for idx, ln in enumerate(lines):
                    if ln.lstrip().startswith('File "') and top_dir and top_dir in ln and idx + 1 < len(lines):
                        code_hint = f"CODE: {lines[idx + 1].strip()}"
                truncated_err: str = err_line if len(err_line) <= 220 else err_line[:220] + " [...]"
                block_items: List[str] = [header]
                if code_hint:
                    block_items.append(code_hint)
                block_items.append(truncated_err)
                kept_blocks.append("\n".join(block_items))
            for ln in lines:
                if ln.startswith("Ran "):
                    summary_line = ln
                elif ln.startswith(("FAILED", "OK")) and summary_line:
                    summary_line = f"{summary_line} | {ln}"
        if summary_line:
            kept_blocks.append(summary_line)
        return "\n".join(kept_blocks).strip() or raw_output.strip()

    def _collect_source_files(self, top_dir: str) -> List[str]:
        sources: List[str] = []
        skip_dirs: Set[str] = {"tests", "__pycache__", ".venv", "venv", ".git", ".watch_clipboard", "node_modules"}
        for curr_root, dirs, files in os.walk(top_dir):
            dirs[:] = [d for d in dirs if d not in skip_dirs]
            for fname in sorted(files):
                if fname.endswith(".py") and fname != "__init__.py" and not fname.startswith("test_"):
                    sources.append(os.path.realpath(os.path.join(curr_root, fname)))
        return sources

    def _run_single_suite(
        self, suite_name: str, tests_dir: str, top_dir: str
    ) -> Tuple[int, str, List[Tuple[str, int, int, List[int]]]]:
        if not os.path.isdir(tests_dir):
            return 1, f"[{suite_name}] Dossier de tests introuvable : {tests_dir}", []
        saved_test_mods = {k: sys.modules.pop(k) for k in list(sys.modules) if k == "tests" or k.startswith("tests.")}
        top_real: str = os.path.realpath(top_dir)
        saved_proj_mods = {
            k: sys.modules.pop(k)
            for k, mod in list(sys.modules.items())
            if getattr(mod, "__file__", None) and os.path.realpath(str(mod.__file__)).startswith(top_real + os.sep)
        }
        added_paths: List[str] = [p for p in (top_dir, tests_dir) if p not in sys.path]
        for p in added_paths:
            sys.path.insert(0, p)
        stream = io.StringIO()
        tracer = trace.Trace(count=1, trace=0)
        captured_warnings: List[str] = []
        orig_warn = warnings.warn
        prev_trace = sys.gettrace()

        def _intercept_warn(message: object, category: type = UserWarning, stacklevel: int = 1, source: object = None) -> None:
            cat = message.__class__ if isinstance(message, Warning) else category
            if not (issubclass(cat, ResourceWarning) and "socket" in str(message).lower()):
                frame = sys._getframe(min(stacklevel, 4))
                captured_warnings.append(f"{frame.f_code.co_filename}:{frame.f_lineno}: {cat.__name__}: {message}")

        def _discover_and_run() -> unittest.TestResult:
            loader = unittest.TestLoader()
            suite = loader.discover(start_dir=tests_dir, pattern="test_*.py", top_level_dir=top_dir)
            runner = unittest.TextTestRunner(stream=stream, verbosity=2)
            return runner.run(suite)

        try:
            warnings.warn = _intercept_warn  # type: ignore[assignment]
            result = tracer.runfunc(_discover_and_run)
            raw_out: str = stream.getvalue()
            if captured_warnings:
                raw_out += "\n" + "\n".join(captured_warnings)
            warn_text: str = self.extract_warnings_and_console_errors(raw_out)
            rc: int = 0 if result.wasSuccessful() and not warn_text else 1
            if rc != 0:
                compact: str = self.compact_error_report(raw_out, top_dir=top_dir)
                if warn_text:
                    compact = f"{compact}\nWARNINGS DÉTECTÉS :\n{warn_text}".strip()
                return 1, f"[{suite_name}]\n{compact}", []
            counts = tracer.results().counts
            hit_by_file: Dict[str, Set[int]] = {}
            for (fname, lineno), cnt in counts.items():
                if cnt > 0:
                    hit_by_file.setdefault(os.path.realpath(fname), set()).add(lineno)
            cov_rows: List[Tuple[str, int, int, List[int]]] = []
            for src in self._collect_source_files(top_dir):
                exec_lns: Set[int] = self._executable_lines(src)
                if not exec_lns:
                    continue
                covered: Set[int] = exec_lns & hit_by_file.get(src, set())
                missing: List[int] = sorted(exec_lns - covered)
                rel_name: str = os.path.relpath(src, top_dir).replace("\\", "/")
                cov_rows.append((rel_name, len(covered), len(exec_lns), missing))
            return 0, f"[{suite_name}] OK ({result.testsRun} tests)", cov_rows
        finally:
            sys.settrace(prev_trace)
            warnings.warn = orig_warn
            for k in list(sys.modules):
                if k == "tests" or k.startswith("tests."):
                    sys.modules.pop(k, None)
            sys.modules.update(saved_proj_mods)
            sys.modules.update(saved_test_mods)
            for p in added_paths:
                if p in sys.path:
                    sys.path.remove(p)
    def format_coverage_report(
        self, rows: List[Tuple[str, int, int, List[int]]], total_tests: int = 0
    ) -> Tuple[float, str]:
        if not rows:
            return 100.0, "COUVERTURE GLOBALE : 100.0% (0/0 lignes)"
        tot_cov: int = sum(cov for _, cov, _, _ in rows)
        tot_all: int = sum(total for _, _, total, _ in rows)
        pct: float = (tot_cov * 100.0 / tot_all) if tot_all else 100.0
        lines: List[str] = [
            f"COUVERTURE GLOBALE : {pct:.1f}% ({tot_cov}/{tot_all} lignes) ({total_tests} tests unitaires)"
        ]
        incomplete_details: List[str] = []
        for rel_name, cov, total, missing in sorted(rows, key=lambda x: ((x[1] / x[2]) if x[2] else 1.0, x[0])):
            fpct: float = (cov * 100.0 / total) if total else 100.0
            level: str = "OK" if fpct >= 90.0 else ("MOYEN" if fpct >= 70.0 else "BAS")
            lines.append(f"{fpct:5.1f}% | {level:<7} | {cov}/{total} | {rel_name}")
            if missing:
                incomplete_details.append(f"- {rel_name} ({fpct:.1f}%) : lignes {self._format_line_ranges(missing)}")
        if incomplete_details:
            lines.append("\nLignes non couvertes :")
            lines.extend(incomplete_details)
        return pct, "\n".join(lines)

    def copy_to_clipboard(self, text: str) -> bool:
        if not self.use_clipboard or not text:
            return False
        try:
            import tkinter as tk
            root = tk.Tk()
            root.withdraw()
            root.clipboard_clear()
            root.clipboard_append(text)
            root.update()
            root.destroy()
            return True
        except Exception:
            return False

    def _run_node_suite(self, chrome_ai_dir: Path) -> Tuple[int, str]:
        test_files: List[Path] = sorted((chrome_ai_dir / "tests").glob("*.test.js"))
        if not test_files:
            return 0, ""
        node_bin: Optional[str] = self.find_node_binary(chrome_ai_dir)
        if not node_bin:
            return 0, "[ChromeAI] Node.js absent (tests JS ignorés)"
        proc = subprocess.run(
            [node_bin, "--test", *[str(f) for f in test_files]],
            cwd=str(chrome_ai_dir),
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            timeout=60,
            check=False,
        )
        if proc.returncode != 0:
            err_txt: str = ((proc.stderr or "") + "\n" + (proc.stdout or "")).strip()
            return 1, f"[ChromeAI]\n{err_txt}"
        return 0, f"[ChromeAI] OK ({len(test_files)} fichier(s) de test)"

    def run(self, report_file: str = "", coverage_file: str = "") -> int:
        root_p: Path = Path(self.project_root).resolve()
        tools_parent: Path = root_p.parent if root_p.name == "watch_clipboard" else root_p
        if tools_parent.name == "tools":
            repair_tools_urls(tools_parent)

        suites: List[Tuple[str, str, str]] = [
            ("watch_clipboard", os.path.join(self.project_root, "tests"), self.project_root),
        ]
        export_dir: Path = tools_parent / "export"
        if (export_dir / "tests").is_dir():
            suites.append(("export", str(export_dir / "tests"), str(export_dir)))

        overall_rc: int = 0
        summaries: List[str] = []
        all_rows: List[Tuple[str, int, int, List[int]]] = []
        total_tests: int = 0

        for name, t_dir, top_d in suites:
            rc, summary, rows = self._run_single_suite(name, t_dir, top_d)
            summaries.append(summary)
            all_rows.extend(rows)
            m_cnt = re.search(r"\((\d+)\s+tests?\)", summary)
            if m_cnt:
                total_tests += int(m_cnt.group(1))
            if rc != 0:
                overall_rc = 1

        chrome_ai_dir: Path = tools_parent / "ChromeAI"
        if (chrome_ai_dir / "tests").is_dir():
            js_rc, js_summary = self._run_node_suite(chrome_ai_dir)
            if js_summary:
                summaries.append(js_summary)
            if js_rc != 0:
                overall_rc = 1

        final_report: str = "\n".join(summaries).strip()
        _, cov_report = self.format_coverage_report(all_rows, total_tests=total_tests)
        print(final_report)
        if overall_rc == 0:
            print("\n" + cov_report)

        if report_file:
            Path(report_file).write_text(final_report + "\n", encoding="utf-8")
        if coverage_file:
            Path(coverage_file).write_text(cov_report + "\n", encoding="utf-8")
        if overall_rc != 0 and self.copy_to_clipboard(final_report):
            print("[PRESSE-PAPIERS] Rapport d'erreurs copié.")
        return overall_rc


def main() -> int:
    use_clip: bool = "--no-clipboard" not in sys.argv
    report_file: str = ""
    coverage_file: str = ""
    if "--report-file" in sys.argv:
        idx_r: int = sys.argv.index("--report-file")
        if idx_r + 1 < len(sys.argv):
            report_file = sys.argv[idx_r + 1]
    if "--coverage-file" in sys.argv:
        idx_c: int = sys.argv.index("--coverage-file")
        if idx_c + 1 < len(sys.argv):
            coverage_file = sys.argv[idx_c + 1]
    watch_root: str = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    return ClipboardTestRunner(project_root=watch_root, use_clipboard=use_clip).run(
        report_file=report_file, coverage_file=coverage_file
    )


if __name__ == "__main__":
    sys.exit(main())
