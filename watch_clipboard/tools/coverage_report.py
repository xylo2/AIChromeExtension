# Commandes pip à exécuter : Aucune dépendance externe requise (bibliothèque standard uniquement)

import ast
import io
import os
import tokenize
from typing import List, Set, Tuple

CoverageRow = Tuple[str, int, int, List[int]]


class CoverageReporter:
    """Mesure les lignes exécutables Python via AST/tokenize et formate un bilan compact."""

    @staticmethod
    def format_line_ranges(lines: List[int]) -> str:
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
    def executable_lines(file_path: str) -> Set[int]:
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
            if isinstance(node, (ast.Module, ast.ClassDef, ast.FunctionDef, ast.AsyncFunctionDef)) and node.body:
                first_stmt = next(iter(node.body), None)
                if isinstance(first_stmt, ast.Expr) and isinstance(first_stmt.value, ast.Constant) and isinstance(first_stmt.value.value, str):
                    ignored.update(range(first_stmt.lineno, getattr(first_stmt, "end_lineno", first_stmt.lineno) + 1))
        exec_lines: Set[int] = set()
        try:
            for tok_type, _tok_str, (s_row, _), _, _ in tokenize.generate_tokens(io.StringIO(source).readline):
                if tok_type in (tokenize.NAME, tokenize.NUMBER, tokenize.STRING, tokenize.OP) and s_row not in ignored:
                    exec_lines.add(s_row)
        except Exception:
            pass
        return exec_lines

    @staticmethod
    def collect_source_files(top_dir: str) -> List[str]:
        sources: List[str] = []
        skip_dirs: Set[str] = {"tests", "__pycache__", ".venv", "venv", ".git", ".watch_clipboard", "node_modules"}
        for curr_root, dirs, files in os.walk(top_dir):
            dirs[:] = [d for d in dirs if d not in skip_dirs]
            for fname in sorted(files):
                if fname.endswith(".py") and fname != "__init__.py" and not fname.startswith("test_"):
                    sources.append(os.path.realpath(os.path.join(curr_root, fname)))
        return sources

    @classmethod
    def format_report(cls, rows: List[CoverageRow], total_tests: int = 0) -> Tuple[float, str]:
        if not rows:
            return 100.0, "COUVERTURE GLOBALE : 100.0% (0/0 lignes)"
        tot_cov: int = sum(cov for _, cov, _, _ in rows)
        tot_all: int = sum(total for _, _, total, _ in rows)
        pct: float = (tot_cov * 100.0 / tot_all) if tot_all else 100.0
        lines: List[str] = [f"COUVERTURE GLOBALE : {pct:.1f}% ({tot_cov}/{tot_all} lignes) ({total_tests} tests unitaires)"]
        full_count: int = 0
        for rel_name, cov, total, missing in sorted(rows, key=lambda x: ((x[1] / x[2]) if x[2] else 1.0, x[0])):
            if not missing:
                full_count += 1
                continue
            fpct: float = (cov * 100.0 / total) if total else 100.0
            level: str = "OK" if fpct >= 90.0 else ("MOYEN" if fpct >= 70.0 else "BAS")
            lines.append(f"{fpct:5.1f}% | {level:<7} | {cov}/{total} | {rel_name} -> lignes {cls.format_line_ranges(missing)}")
        if full_count > 0:
            lines.append(f"({full_count} fichier(s) couverts à 100 % masqués pour économiser le contexte)")
        return pct, "\n".join(lines)
