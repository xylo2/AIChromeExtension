# Validation syntaxique automatique des fichiers Python, JSON et JavaScript assemblés.

import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
from typing import Dict, List, Optional


class SyntaxChecker:
    """Vérifie la syntaxe des fichiers Python, JSON et JavaScript après assemblage."""

    @staticmethod
    def _find_node() -> Optional[str]:
        """Recherche le binaire Node.js dans l'environnement Python ou le PATH."""
        py_dir: Path = Path(sys.executable).resolve().parent
        for cand in (py_dir / "node.exe", py_dir / "node"):
            if cand.is_file():
                return str(cand)
        return shutil.which("node.exe") or shutil.which("node")

    @staticmethod
    def _extract_context(source: str, error_line: Optional[int], radius: int = 5) -> str:
        """Extrait un extrait numéroté centré sur la ligne fautive du fichier."""
        lines: List[str] = source.splitlines()
        if not lines:
            return ""
        if not error_line or error_line < 1:
            return "\n".join(f"{idx + 1}: {ln}" for idx, ln in enumerate(lines[:12]))
        start: int = max(1, error_line - radius)
        end: int = min(len(lines), error_line + radius)
        return "\n".join(
            f"{'>' if ln_no == error_line else ' '} {ln_no}: {lines[ln_no - 1]}"
            for ln_no in range(start, end + 1)
        )

    @classmethod
    def check_file(cls, file_path: str, rel_path: str, encoding: str = "utf-8") -> Optional[Dict[str, object]]:
        """Contrôle la syntaxe d'un fichier (.py, .json, .js) et retourne le diagnostic."""
        _, raw_ext = os.path.splitext(file_path)
        ext: str = raw_ext.lower()
        if ext not in (".py", ".json", ".js"):
            return None
        try:
            with open(file_path, "r", encoding=encoding, errors="replace") as f_in:
                source: str = f_in.read()
        except OSError:
            return None
        if ext == ".py":
            try:
                compile(source, rel_path, "exec")
                return None
            except SyntaxError as exc:
                ln: int = int(exc.lineno or 1)
                return {"file": rel_path, "line": ln, "message": f"{exc.msg} (ligne {ln})", "snippet": cls._extract_context(source, ln)}
        if ext == ".json":
            try:
                json.loads(source)
                return None
            except json.JSONDecodeError as exc:
                ln = int(exc.lineno or 1)
                return {"file": rel_path, "line": ln, "message": f"{exc.msg} (ligne {ln}, col {exc.colno})", "snippet": cls._extract_context(source, ln)}
        node_bin: Optional[str] = cls._find_node()
        if not node_bin:
            return None
        proc = subprocess.run([node_bin, "--check", file_path], capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=10, check=False)
        if proc.returncode == 0:
            return None
        raw_err: str = ((proc.stderr or "") + "\n" + (proc.stdout or "")).strip()
        m_line = re.search(r":(\d+)(?::\d+)?\s*$", raw_err, re.MULTILINE)
        err_ln: int = int(m_line.group(1)) if m_line else 1
        first_msg: str = next((ln_txt.strip() for ln_txt in raw_err.splitlines() if "SyntaxError" in ln_txt), "") or (raw_err.splitlines()[-1].strip() if raw_err else "Erreur syntaxe JS")
        return {"file": rel_path, "line": err_ln, "message": first_msg, "snippet": cls._extract_context(source, err_ln)}
