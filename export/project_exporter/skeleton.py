# Extraction des signatures et imports pour l'export en mode squelette léger.

import ast
import re
from typing import List


def _extract_python_skeleton(source: str) -> str:
    """Extrait les imports et signatures de classes/fonctions d'un source Python."""
    try:
        tree = ast.parse(source)
    except SyntaxError:
        return source
    lines: List[str] = source.splitlines()
    out: List[str] = []
    for node in tree.body:
        if isinstance(node, (ast.Import, ast.ImportFrom)):
            out.append(lines[node.lineno - 1])
        elif isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
            out.append(lines[node.lineno - 1] + " ...")
        elif isinstance(node, ast.ClassDef):
            out.append(lines[node.lineno - 1])
            for item in node.body:
                if isinstance(item, (ast.FunctionDef, ast.AsyncFunctionDef)):
                    out.append(lines[item.lineno - 1] + " ...")
    return "\n".join(out) if out else source


def _extract_js_skeleton(source: str) -> str:
    """Extrait les déclarations de classes, fonctions et constantes d'un source JS."""
    sig_re = re.compile(
        r"^\s*(?:export\s+)?(?:class\s+\w+|async\s+\w+\s*\(|"
        r"(?:const|let|var)\s+\w+\s*=|\w+\s*\([^;]*\)\s*\{)"
    )
    out: List[str] = [ln.rstrip() for ln in source.splitlines() if sig_re.match(ln)]
    return "\n".join(out) if out else source


def extract_skeleton(ext_low: str, source: str) -> str:
    """Sélectionne l'extracteur de squelette selon l'extension du fichier."""
    if ext_low == ".py":
        return _extract_python_skeleton(source)
    if ext_low == ".js":
        return _extract_js_skeleton(source)
    return source
