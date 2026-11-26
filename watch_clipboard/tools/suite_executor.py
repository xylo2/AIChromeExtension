import io
import os
import re
import sys
import trace
from typing import Dict, List, Set, Tuple
import unittest
import warnings
from tools.coverage_report import CoverageReporter, CoverageRow

WARNING_PATTERN = re.compile(
    r"^(?P<loc>.+?:\d+:\s+(?:DeprecationWarning|ResourceWarning|UserWarning|RuntimeWarning|SyntaxWarning|FutureWarning):.+)$",
    re.MULTILINE,
)
MAX_COMPACT_REPORT_CHARS: int = 3200


def extract_warnings_and_console_errors(raw_output: str) -> str:
    seen: Set[str] = set()
    unique_lines: List[str] = []
    for match in WARNING_PATTERN.finditer(raw_output or ""):
        line: str = match.group("loc").strip()
        if line and line not in seen:
            seen.add(line)
            unique_lines.append(line)
    return "\n".join(unique_lines)


def _extract_location_and_snippet(lines: List[str], top_dir: str) -> Tuple[str, str]:
    loc_hint, code_hint = "", ""
    for idx, ln in enumerate(lines):
        stripped = ln.lstrip()
        if stripped.startswith('File "') and (not top_dir or top_dir in ln):
            m_loc = re.search(r'File "([^"]+)", line (\d+)', stripped)
            if m_loc:
                rel_f = os.path.relpath(m_loc.group(1), top_dir).replace("\\", "/") if top_dir else os.path.basename(m_loc.group(1))
                loc_hint = f"LOC: {rel_f}:{m_loc.group(2)}"
            if idx + 1 < len(lines) and not lines[idx + 1].lstrip().startswith(('File "', "---", "===")):
                code_hint = f"CODE: {lines[idx + 1].strip()}"
    return loc_hint, code_hint


def compact_error_report(raw_output: str, top_dir: str = "", max_chars: int = MAX_COMPACT_REPORT_CHARS) -> str:
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
            err_line: str = next((ln for ln in reversed(lines) if not ln.startswith(("---", "Ran ", "FAILED"))), lines[-1])
            sig: str = err_line[:120]
            if sig in seen_sigs:
                kept_blocks.append(f"[DOUBLON] {header} -> {err_line[:140]}")
                continue
            seen_sigs.add(sig)
            loc_hint, code_hint = _extract_location_and_snippet(lines, top_dir)
            truncated_err: str = err_line if len(err_line) <= 220 else err_line[:220] + " [...]"
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


def run_single_python_suite(suite_name: str, tests_dir: str, top_dir: str) -> Tuple[int, str, List[CoverageRow]]:
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
        cat = message.__class__ if isinstance(message, Warning) else category
        if not (issubclass(cat, ResourceWarning) and "socket" in str(message).lower()):
            frame = sys._getframe(min(stacklevel, 4))
            captured_warnings.append(f"{frame.f_code.co_filename}:{frame.f_lineno}: {cat.__name__}: {message}")

    def _discover_and_run() -> unittest.TestResult:
        return unittest.TextTestRunner(stream=stream, verbosity=2).run(unittest.TestLoader().discover(start_dir=tests_dir, pattern="test_*.py", top_level_dir=top_dir))

    try:
        warnings.warn = _intercept_warn  # type: ignore[assignment]
        result = tracer.runfunc(_discover_and_run)
        raw_out: str = stream.getvalue() + ("\n" + "\n".join(captured_warnings) if captured_warnings else "")
        warn_text: str = extract_warnings_and_console_errors(raw_out)
        if not (result.wasSuccessful() and not warn_text):
            compact: str = compact_error_report(raw_out, top_dir=top_dir)
            detail_txt: str = f"{compact}\nWARNINGS DÉTECTÉS :\n{warn_text}".strip() if warn_text else compact
            return 1, f"[{suite_name}]\n{detail_txt}", []
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
