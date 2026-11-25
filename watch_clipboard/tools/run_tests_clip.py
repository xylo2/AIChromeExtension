# Commandes pip à exécuter : Aucune dépendance externe requise (bibliothèque standard uniquement)

import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
from typing import List, Optional, Set, Tuple

_TOOLS_PKG_DIR: str = os.path.dirname(os.path.abspath(__file__))
_WATCH_CLIP_ROOT: str = os.path.dirname(_TOOLS_PKG_DIR)
if _WATCH_CLIP_ROOT not in sys.path:
    sys.path.insert(0, _WATCH_CLIP_ROOT)

from tools.coverage_report import CoverageReporter, CoverageRow  # noqa: E402
from tools.fix_urls import repair_tools_urls  # noqa: E402
from tools.suite_executor import (  # noqa: E402
    WARNING_PATTERN,
    compact_error_report,
    extract_warnings_and_console_errors,
    run_single_python_suite,
)


class ClipboardTestRunner:
    """
    Exécute les suites unittest et Node.js, détecte les warnings Python,
    mesure la couverture de code et copie le rapport compact dans le presse-papiers.
    """

    WARNING_PATTERN = WARNING_PATTERN

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
                candidates.extend([base / venv_name / "Scripts" / "node.exe", base / venv_name / "bin" / "node"])
        for cand in candidates:
            if cand.is_file():
                return str(cand)
        return shutil.which("node.exe") or shutil.which("node")

    @classmethod
    def extract_warnings_and_console_errors(cls, raw_output: str) -> str:
        return extract_warnings_and_console_errors(raw_output)

    @staticmethod
    def _format_line_ranges(lines: List[int]) -> str:
        return CoverageReporter.format_line_ranges(lines)

    @staticmethod
    def _executable_lines(file_path: str) -> Set[int]:
        return CoverageReporter.executable_lines(file_path)

    def _collect_source_files(self, top_dir: str) -> List[str]:
        return CoverageReporter.collect_source_files(top_dir)

    def format_coverage_report(self, rows: List[CoverageRow], total_tests: int = 0) -> Tuple[float, str]:
        return CoverageReporter.format_report(rows, total_tests=total_tests)

    def compact_error_report(self, raw_output: str, top_dir: str = "") -> str:
        return compact_error_report(raw_output, top_dir=top_dir)

    def _run_single_suite(self, suite_name: str, tests_dir: str, top_dir: str) -> Tuple[int, str, List[CoverageRow]]:
        return run_single_python_suite(suite_name, tests_dir, top_dir)

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
        proc = subprocess.run([node_bin, "--test", *[str(f) for f in test_files]], cwd=str(chrome_ai_dir), capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=60, check=False)
        if proc.returncode != 0:
            err_txt: str = ((proc.stderr or "") + "\n" + (proc.stdout or "")).strip()
            return 1, f"[ChromeAI]\n{err_txt}"
        return 0, f"[ChromeAI] OK ({len(test_files)} fichier(s) de test)"

    def run(self, report_file: str = "", coverage_file: str = "") -> int:
        root_p: Path = Path(self.project_root).resolve()
        tools_parent: Path = root_p.parent if root_p.name == "watch_clipboard" else root_p
        if tools_parent.name == "tools":
            repair_tools_urls(tools_parent)
        suites: List[Tuple[str, str, str]] = [("watch_clipboard", os.path.join(self.project_root, "tests"), self.project_root)]
        export_dir: Path = tools_parent / "export"
        if (export_dir / "tests").is_dir():
            suites.append(("export", str(export_dir / "tests"), str(export_dir)))
        overall_rc, summaries, all_rows, total_tests = 0, [], [], 0
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
    return ClipboardTestRunner(project_root=watch_root, use_clipboard=use_clip).run(report_file=report_file, coverage_file=coverage_file)


if __name__ == "__main__":
    sys.exit(main())
