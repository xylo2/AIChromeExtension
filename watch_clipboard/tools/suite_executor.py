# Exécution d'une suite unittest avec interception des warnings et compactage des erreurs.

import io
import os
import re
import sys
import trace
from typing import Dict, List, Optional, Set, Tuple
import unittest
import warnings
from tools.coverage_report import CoverageReporter, CoverageRow

WARNING_PATTERN = re.compile(
    r"^(?P<loc>.+?:\d+:\s+(?:DeprecationWarning|ResourceWarning|UserWarning|RuntimeWarning|SyntaxWarning|FutureWarning):.+)$",
    re.MULTILINE,
)
MAX_COMPACT_REPORT_CHARS: int = 6000


def extract_warnings_and_console_errors(raw_output: str) -> str:
    """Extrait et déduplique les lignes d'avertissement Python de la sortie brute."""
    seen: Set[str] = set()
    unique_lines: List[str] = []
    for match in WARNING_PATTERN.finditer(raw_output or ""):
        line: str = match.group("loc").strip()
        if line and line not in seen:
            seen.add(line)
            unique_lines.append(line)
    return "\n".join(unique_lines)


def _extract_location_and_snippet(lines: List[str], top_dir: str) -> Tuple[str, str]:
    """Repère les fichiers sources, lignes et instructions de la pile d'appel en échec."""
    frames: List[str] = []
    code_hint: str = ""
    for idx, ln in enumerate(lines):
        stripped = ln.lstrip()
        if stripped.startswith('File "'):
            m_loc = re.search(r'File "([^"]+)", line (\d+)(?:, in (.+))?', stripped)
            if m_loc:
                f_path: str = m_loc.group(1)
                is_proj: bool = bool(top_dir and top_dir in f_path)
                rel_f: str = os.path.relpath(f_path, top_dir).replace("\\", "/") if is_proj else os.path.basename(f_path)
                func_name: str = f" ({m_loc.group(3)})" if m_loc.group(3) else ""
                frames.append(f"{rel_f}:{m_loc.group(2)}{func_name}")
            if idx + 1 < len(lines) and not lines[idx + 1].lstrip().startswith(('File "', "---", "===")):
                code_hint = f"CODE: {lines[idx + 1].strip()}"
    loc_hint: str = f"TRACE: {' -> '.join(frames[-4:])}" if frames else ""
    return loc_hint, code_hint


def _filter_unittest_suite(suite: unittest.TestSuite, failed_filters: List[str]) -> unittest.TestSuite:
    """Filtre récursivement une TestSuite pour ne conserver que les cas correspondant à failed_filters."""
    targets: Set[str] = {f.strip() for f in failed_filters if f.strip()}
    filtered = unittest.TestSuite()
    for item in suite:
        if isinstance(item, unittest.TestSuite):
            sub = _filter_unittest_suite(item, failed_filters)
            if sub.countTestCases() > 0:
                filtered.addTest(sub)
        else:
            test_str: str = str(item).strip()
            test_id: str = item.id().strip()
            method_name: str = test_id.rsplit(".", 1)[-1]
            if any(t in (test_str, test_id, method_name) or t in test_str for t in targets):
                filtered.addTest(item)
    return filtered


def compact_error_report(raw_output: str, top_dir: str = "", max_chars: int = MAX_COMPACT_REPORT_CHARS) -> str:
    """Condense et déduplique les tracebacks unittest en conservant les détails d'assertion."""
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
            err_lines: List[str] = []
            for ln in reversed(lines):
                if ln.startswith(("---", "Ran ", "FAILED")) or ln.lstrip().startswith(('File "', "Traceback")):
                    break
                err_lines.append(ln)
            err_lines.reverse()
            err_block: str = "\n".join(err_lines) if err_lines else lines[-1]
            sig: str = err_block[:160]
            if sig in seen_sigs:
                kept_blocks.append(f"[DOUBLON] {header} -> {err_lines[-1][:140] if err_lines else ''}")
                continue
            seen_sigs.add(sig)
            loc_hint, code_hint = _extract_location_and_snippet(lines, top_dir)
            truncated_err: str = err_block if len(err_block) <= 600 else err_block[:600] + " [...]"
            kept_blocks.append("\n".join([p for p in (header, loc_hint, code_hint, truncated_err) if p]))
        for ln in lines:
            if ln.startswith("Ran "):
                summary_line = ln
            elif ln.startswith(("FAILED", "OK")) and summary_line:
                summary_line = f"{summary_line} | {ln}"
    if summary_line:
        kept_blocks.append(summary_line)
    result: str = "\n".join(kept_blocks).strip() or raw_output.strip()
    if len(result) > max_chars:
        tail: str = f"\n[... tronqué ({len(result) - max_chars} car. omis) ...]\n{summary_line}".rstrip()
        head_budget: int = max(0, max_chars - len(tail))
        result = (result[:head_budget].rstrip() + tail) if head_budget > 0 else tail[:max_chars]
    return result


def run_single_python_suite(
    suite_name: str,
    tests_dir: str,
    top_dir: str,
    failed_filters: Optional[List[str]] = None,
) -> Tuple[int, str, List[CoverageRow]]:
    """Exécute une suite unittest isolée sous trace.Trace et calcule la couverture."""
    if not os.path.isdir(tests_dir):
        return 1, f"[{suite_name}] Dossier de tests introuvable : {tests_dir}", []
    saved_test_mods = {k: sys.modules.pop(k) for k in list(sys.modules) if k == "tests" or k.startswith("tests.")}
    top_real: str = os.path.realpath(top_dir)
    saved_proj_mods = {k: sys.modules.pop(k) for k, mod in list(sys.modules.items()) if getattr(mod, "__file__", None) and os.path.realpath(str(mod.__file__)).startswith(top_real + os.sep)}
    added_paths: List[str] = [p for p in (top_dir, tests_dir) if p not in sys.path]
    for p in added_paths:
        sys.path.insert(0, p)
    stream, tracer, captured_warnings = io.StringIO(), trace.Trace(count=1, trace=0), []
    orig_warn, prev_trace = warnings.warn, sys.gettrace()

    def _intercept_warn(message: object, category: type = UserWarning, stacklevel: int = 1, source: object = None) -> None:
        """Capture les avertissements Python émis pendant l'exécution des tests."""
        cat = message.__class__ if isinstance(message, Warning) else category
        if not (issubclass(cat, ResourceWarning) and "socket" in str(message).lower()):
            frame = sys._getframe(min(stacklevel, 4))
            captured_warnings.append(f"{frame.f_code.co_filename}:{frame.f_lineno}: {cat.__name__}: {message}")

    def _discover_and_run() -> unittest.TestResult:
        """Découvre et exécute les tests (complets ou filtrés sur failed_filters)."""
        discovered = unittest.TestLoader().discover(start_dir=tests_dir, pattern="test_*.py", top_level_dir=top_dir)
        suite_to_run = _filter_unittest_suite(discovered, failed_filters) if failed_filters else discovered
        return unittest.TextTestRunner(stream=stream, verbosity=2).run(suite_to_run)

    try:
        warnings.warn = _intercept_warn  # type: ignore[assignment]
        result = tracer.runfunc(_discover_and_run)
        if failed_filters and result.testsRun == 0:
            return 0, "", []
        raw_out: str = stream.getvalue() + ("\n" + "\n".join(captured_warnings) if captured_warnings else "")
        warn_text: str = extract_warnings_and_console_errors(raw_out)
        if not (result.wasSuccessful() and not warn_text):
            compact: str = compact_error_report(raw_out, top_dir=top_dir)
            detail_txt: str = f"{compact}\nWARNINGS DÉTECTÉS :\n{warn_text}".strip() if warn_text else compact
            return 1, f"[{suite_name}]\n{detail_txt}", []
        if failed_filters:
            return 0, f"[{suite_name}] OK ({result.testsRun} test(s) KO corrigé(s))", []
        hit_by_file: Dict[str, Set[int]] = {}
        for (fname, lineno), cnt in tracer.results().counts.items():
            if cnt > 0:
                hit_by_file.setdefault(os.path.realpath(fname), set()).add(lineno)
        cov_rows: List[CoverageRow] = []
        for src in CoverageReporter.collect_source_files(top_dir):
            exec_lns: Set[int] = CoverageReporter.executable_lines(src)
            if exec_lns:
                covered: Set[int] = exec_lns & hit_by_file.get(src, set())
                cov_rows.append((os.path.relpath(src, top_dir).replace("\\", "/"), len(covered), len(exec_lns), sorted(exec_lns - covered)))
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
