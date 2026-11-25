# Commandes pip à exécuter : Aucune dépendance externe requise (bibliothèque standard uniquement)

import os
import subprocess
import sys
import tempfile
from typing import Any, Callable, List, Optional, Tuple


class ProjectExportRunner:
    """Résout et exécute l'export du projet cible via project_exporter."""

    def __init__(self, target_dir: str, run_fn: Callable[..., Any] = subprocess.run) -> None:
        self.target_dir: str = target_dir
        self._run = run_fn

    def resolve_exporter_dir(self) -> Optional[str]:
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

    def compute_project_label(self, target_real: str, exporter_root: str) -> str:
        raw_norm: str = self.target_dir.strip().replace("\\", "/").strip("/")
        if raw_norm and raw_norm != "." and not os.path.isabs(raw_norm):
            parts: List[str] = [p for p in raw_norm.split("/") if p and p != "."]
            if len(parts) >= 2 and ".." not in parts:
                return "/".join(parts)
        exp_parent: str = os.path.dirname(os.path.realpath(exporter_root))
        workspace_root: str = (
            os.path.dirname(exp_parent) if os.path.basename(exp_parent).lower() == "tools" else exp_parent
        )
        try:
            if os.path.commonpath([workspace_root, target_real]) == workspace_root and target_real != workspace_root:
                rel_label: str = os.path.relpath(target_real, workspace_root).replace("\\", "/")
                if rel_label and not rel_label.startswith(".."):
                    return rel_label
        except ValueError:
            pass
        return os.path.basename(target_real) or "project"

    def run_export(self) -> Tuple[bool, str, str, int]:
        exporter_root: Optional[str] = self.resolve_exporter_dir()
        if not exporter_root:
            return False, "", "Package project_exporter introuvable dans le workspace.", 0
        target_real: str = os.path.realpath(self.target_dir)
        project_label: str = self.compute_project_label(target_real, exporter_root)
        with tempfile.TemporaryDirectory(prefix="watch_clip_export_") as tmp_dir:
            code: str = (
                "import logging, sys; from pathlib import Path; "
                "from project_exporter.config import ExporterConfig; "
                "from project_exporter.exporter import ProjectExporter; "
                "logger = logging.getLogger('export'); logger.addHandler(logging.NullHandler()); "
                "_, exp_s, target_s, out_s, proj_label = sys.argv; "
                "exp_root, target, out_dir = Path(exp_s), Path(target_s), Path(out_s); "
                "cfg = ExporterConfig(exp_root / 'config.ini', logger); "
                "fname = cfg.build_output_filename(proj_label); out_file = out_dir / fname; "
                "cnt = ProjectExporter(target, cfg, out_file, exp_root / 'export_project.py', logger).export(); "
                "print(f'{fname}|{cnt}')"
            )
            env = {**os.environ, "PYTHONUTF8": "1", "PYTHONIOENCODING": "utf-8", "PYTHONPATH": exporter_root}
            proc = self._run(
                [sys.executable, "-c", code, exporter_root, target_real, tmp_dir, project_label],
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
