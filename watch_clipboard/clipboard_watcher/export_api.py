# Exécution et prévisualisation des exports de projet via project_exporter.

import json
import logging
import os
from pathlib import Path
import subprocess
import sys
import tempfile
from typing import Any, Callable, Dict, List, Optional, Tuple


class ProjectExportRunner:
    """Résout et exécute l'export du projet cible via project_exporter."""

    VALID_MODES: Tuple[str, ...] = ("full", "code", "tests", "modified", "skeleton")

    def __init__(self, target_dir: str, run_fn: Callable[..., Any] = subprocess.run) -> None:
        """Initialise l'exécuteur d'export pour le répertoire cible."""
        self.target_dir: str = target_dir
        self._run = run_fn

    def resolve_exporter_dir(self) -> Optional[str]:
        """Localise le dossier contenant le package project_exporter dans le workspace."""
        base_real: str = os.path.realpath(self.target_dir)
        parent_real: str = os.path.dirname(base_real)
        watcher_dir: str = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
        watcher_parent: str = os.path.dirname(watcher_dir)
        for cand in (
            os.path.join(base_real, "export"),
            os.path.join(base_real, "tools", "export"),
            os.path.join(parent_real, "export"),
            os.path.join(parent_real, "tools", "export"),
            os.path.join(watcher_parent, "export"),
        ):
            if os.path.isdir(os.path.join(cand, "project_exporter")):
                return cand
        return None

    def list_top_folders(self) -> List[str]:
        """Liste les sous-dossiers exportables en respectant config.ini et .gitignore."""
        base_path: Path = Path(os.path.realpath(self.target_dir))
        ignored = {".git", ".venv", "venv", "env", "__pycache__", "node_modules", ".watch_clipboard", ".native_host", ".idea", ".vscode"}
        try:
            entries = sorted(
                d for d in base_path.iterdir()
                if d.is_dir() and d.name not in ignored and not d.name.endswith(".egg-info")
            )
        except OSError:
            return []
        exporter_root: Optional[str] = self.resolve_exporter_dir()
        if not exporter_root:
            return [d.name for d in entries]
        added: bool = exporter_root not in sys.path
        if added:
            sys.path.insert(0, exporter_root)
        try:
            from project_exporter.config import ExporterConfig
            from project_exporter.exporter import ProjectExporter
            logger = logging.getLogger("export")
            logger.addHandler(logging.NullHandler())
            cfg = ExporterConfig(Path(exporter_root) / "config.ini", logger)
            exp = ProjectExporter(base_path, cfg, base_path / "_prev.tmp", Path(exporter_root) / "export_project.py", logger)
            exp.gitignore_mgr.register_directory(base_path)
            return [d.name for d in entries if not exp.should_exclude_dir(d)]
        except Exception:
            return [d.name for d in entries]
        finally:
            if added and exporter_root in sys.path:
                sys.path.remove(exporter_root)
    def compute_project_label(self, target_real: str, exporter_root: str) -> str:
        """Calcule le nom logique du projet utilisé pour nommer le fichier d'export."""
        raw_norm: str = self.target_dir.strip().replace("\\", "/").strip("/")
        if raw_norm and raw_norm != "." and not os.path.isabs(raw_norm):
            parts: List[str] = [p for p in raw_norm.split("/") if p and p != "."]
            if len(parts) >= 2 and ".." not in parts:
                return "/".join(parts)
        exp_parent: str = os.path.dirname(os.path.realpath(exporter_root))
        workspace_root: str = os.path.dirname(exp_parent) if os.path.basename(exp_parent).lower() == "tools" else exp_parent
        try:
            if os.path.commonpath([workspace_root, target_real]) == workspace_root and target_real != workspace_root:
                rel_label: str = os.path.relpath(target_real, workspace_root).replace("\\", "/")
                if rel_label and not rel_label.startswith(".."):
                    return rel_label
        except ValueError:
            pass
        return os.path.basename(target_real) or "project"

    @staticmethod
    def estimate_tokens(text: str) -> int:
        """Estime le volume en tokens d'une chaîne (~4 caractères par token)."""
        return max(1, (len(text) + 3) // 4) if text else 0

    @classmethod
    def normalize_mode(cls, mode: str) -> str:
        """Valide et normalise le mode d'export demandé (full par défaut)."""
        clean: str = (mode or "full").strip().lower()
        return clean if clean in cls.VALID_MODES else "full"

    def preview_all_modes(self, subpaths: Optional[List[str]] = None) -> Tuple[bool, Dict[str, Dict[str, int]], str]:
        """Calcule le nombre de fichiers et de tokens estimés pour chaque mode d'export."""
        exporter_root: Optional[str] = self.resolve_exporter_dir()
        if not exporter_root:
            return False, {}, "Package project_exporter introuvable dans le workspace."
        clean_subpaths: List[str] = [str(s).strip() for s in (subpaths or []) if str(s).strip()]
        target_real: str = os.path.realpath(self.target_dir)
        code: str = "\n".join([
            "import json, logging, os, sys",
            "from pathlib import Path",
            "from project_exporter.config import ExporterConfig",
            "from project_exporter.exporter import ProjectExporter",
            "logger = logging.getLogger('export'); logger.addHandler(logging.NullHandler())",
            "_, exp_s, target_s, sub_json = sys.argv",
            "exp_root, target, subs = Path(exp_s), Path(target_s), json.loads(sub_json)",
            "cfg = ExporterConfig(exp_root / 'config.ini', logger)",
            "res = {}",
            "for m in ('modified', 'code', 'skeleton', 'tests', 'full'):",
            "    exp = ProjectExporter(target, cfg, target / '_prev.tmp', exp_root / 'export_project.py', logger, export_mode=m, include_subpaths=subs)",
            "    cnt, toks = 0, 0",
            "    for cr, dirs, files in os.walk(target):",
            "        cp = Path(cr); exp.gitignore_mgr.register_directory(cp)",
            "        dirs[:] = [d for d in dirs if not exp.should_exclude_dir(cp / d)]",
            "        for fn in files:",
            "            fp = cp / fn",
            "            if exp.is_target_file(fp):",
            "                cnt += 1; toks += ProjectExporter.estimate_tokens(exp._read_file_content(fp))",
            "    res[m] = {'files': cnt, 'tokens': toks}",
            "print(json.dumps(res))",
        ])
        env = {**os.environ, "PYTHONUTF8": "1", "PYTHONIOENCODING": "utf-8", "PYTHONPATH": exporter_root}
        proc = self._run(
            [sys.executable, "-c", code, exporter_root, target_real, json.dumps(clean_subpaths)],
            cwd=target_real, env=env, capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=20, check=False,
        )
        if proc.returncode != 0:
            return False, {}, (proc.stderr or proc.stdout or "Erreur aperçu export").strip()
        try:
            raw_line: str = next((ln for ln in reversed((proc.stdout or "").splitlines()) if ln.strip()), "{}")
            parsed = json.loads(raw_line)
            return (True, parsed, "") if isinstance(parsed, dict) else (False, {}, "Réponse preview invalide.")
        except Exception as exc:
            return False, {}, str(exc)
    def run_export(self, mode: str = "full", subpaths: Optional[List[str]] = None) -> Tuple[bool, str, str, int]:
        """Génère l'archive texte consolidée dans un répertoire temporaire et lit son contenu."""
        exporter_root: Optional[str] = self.resolve_exporter_dir()
        if not exporter_root:
            return False, "", "Package project_exporter introuvable dans le workspace.", 0
        clean_mode: str = self.normalize_mode(mode)
        clean_subpaths: List[str] = [str(s).strip() for s in (subpaths or []) if str(s).strip()]
        target_real: str = os.path.realpath(self.target_dir)
        project_label: str = self.compute_project_label(target_real, exporter_root)
        with tempfile.TemporaryDirectory(prefix="watch_clip_export_") as tmp_dir:
            code: str = (
                "import json, logging, sys; from pathlib import Path; "
                "from project_exporter.config import ExporterConfig; from project_exporter.exporter import ProjectExporter; "
                "logger = logging.getLogger('export'); logger.addHandler(logging.NullHandler()); "
                "_, exp_s, target_s, out_s, proj_label, exp_mode, sub_json = sys.argv; "
                "exp_root, target, out_dir = Path(exp_s), Path(target_s), Path(out_s); "
                "cfg = ExporterConfig(exp_root / 'config.ini', logger); "
                "base_fname = cfg.build_output_filename(proj_label); "
                "fname = base_fname if exp_mode == 'full' else base_fname.replace('_export.txt', f'_{exp_mode}_export.txt'); "
                "out_file = out_dir / fname; "
                "cnt = ProjectExporter(target, cfg, out_file, exp_root / 'export_project.py', logger, export_mode=exp_mode, include_subpaths=json.loads(sub_json)).export(); "
                "print(f'{fname}|{cnt}')"
            )
            env = {**os.environ, "PYTHONUTF8": "1", "PYTHONIOENCODING": "utf-8", "PYTHONPATH": exporter_root}
            proc = self._run(
                [sys.executable, "-c", code, exporter_root, target_real, tmp_dir, project_label, clean_mode, json.dumps(clean_subpaths)],
                cwd=target_real, env=env, capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=60, check=False,
            )
            if proc.returncode != 0:
                return False, "", (proc.stderr or proc.stdout or "Erreur export").strip(), 0
            fname_out, cnt_str = (proc.stdout or "").strip().splitlines()[-1].split("|", 1)
            out_path: str = os.path.join(tmp_dir, fname_out)
            if not os.path.isfile(out_path):
                return False, "", "Fichier d'export non généré.", 0
            with open(out_path, "r", encoding="utf-8", errors="replace") as f_out:
                return True, fname_out, f_out.read(), int(cnt_str)
