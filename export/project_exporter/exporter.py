# Consolidation de fichiers d'un projet selon différents modes d'export.

import fnmatch
import logging
import os
from pathlib import Path
import subprocess
from typing import List, Optional, Set, Tuple
from project_exporter.config import ExporterConfig
from project_exporter.gitignore import GitignoreManager


class ProjectExporter:
    """Consolide un projet en mode full, code, tests, modified ou skeleton."""

    MODE_LABELS: dict[str, str] = {
        "full": "COMPLET (code + tests)",
        "code": "PARTIEL — CODE UNIQUEMENT (sans tests)",
        "tests": "PARTIEL — TESTS UNIQUEMENT",
        "modified": "PARTIEL — MODIFIÉS GIT UNIQUEMENT",
        "skeleton": "PARTIEL — SQUELETTE / SIGNATURES",
    }

    def __init__(
        self,
        root_dir: Path,
        config: ExporterConfig,
        output_file: Path,
        script_path: Path,
        logger: logging.Logger,
        export_mode: str = "full",
        include_subpaths: Optional[List[str]] = None,
    ) -> None:
        """Initialise les chemins, le mode d'export et les filtres Gitignore."""
        self.root_dir: Path = root_dir.resolve()
        self.config: ExporterConfig = config
        self.output_file: Path = output_file.resolve()
        self.script_path: Path = script_path.resolve()
        self.logger: logging.Logger = logger
        clean_mode: str = (export_mode or "full").strip().lower()
        self.export_mode: str = (
            clean_mode if clean_mode in self.MODE_LABELS else "full"
        )
        self.include_subpaths: List[str] = [
            p.strip().replace("\\", "/").strip("/")
            for p in (include_subpaths or [])
            if p.strip()
        ]
        self._git_modified_rel: Optional[Set[str]] = (
            self._detect_git_modified_files()
            if self.export_mode == "modified"
            else None
        )
        self.gitignore_mgr: GitignoreManager = GitignoreManager(
            root_dir=self.root_dir,
            logger=self.logger,
            enabled=self.config.respect_gitignore,
        )
    def _detect_git_modified_files(self) -> Set[str]:
        """Retourne les chemins relatifs des fichiers modifiés ou non suivis."""
        try:
            top_p = subprocess.run(
                ["git", "rev-parse", "--show-toplevel"],
                cwd=str(self.root_dir), capture_output=True, text=True,
                encoding="utf-8", errors="replace", timeout=10, check=False,
            )
            if top_p.returncode != 0 or not top_p.stdout.strip():
                return set()
            git_root = Path(top_p.stdout.strip()).resolve()
            st_p = subprocess.run(
                ["git", "-c", "core.quotePath=false", "status", "--porcelain", "-uall"],
                cwd=str(git_root), capture_output=True, text=True,
                encoding="utf-8", errors="replace", timeout=15, check=False,
            )
            modified: Set[str] = set()
            for raw_ln in st_p.stdout.splitlines():
                if len(raw_ln) >= 4:
                    rel_raw = raw_ln[3:].strip().strip('"').split(" -> ")[-1]
                    full_p = (git_root / rel_raw.replace("\\", "/")).resolve()
                    try:
                        modified.add(full_p.relative_to(self.root_dir).as_posix().lower())
                    except ValueError:
                        continue
            return modified
        except Exception:
            return set()

    @staticmethod
    def is_test_rel_path(rel_posix: str) -> bool:
        """Indique si un chemin relatif correspond à un fichier ou dossier de test."""
        parts: List[str] = [p.lower() for p in rel_posix.replace("\\", "/").split("/") if p]
        if any(p in ("tests", "test", "__tests__") for p in parts[:-1]):
            return True
        fname: str = parts[-1] if parts else ""
        return fname.startswith("test_") or fname.endswith(
            ("_test.py", ".test.js", ".spec.js", ".test.ts", ".spec.ts")
        )

    def should_exclude_dir(self, dir_path: Path) -> bool:
        """Détermine si un répertoire doit être ignoré lors du parcours."""
        dir_name: str = dir_path.name
        if dir_name in self.config.excluded_dirs or dir_name.endswith(".egg-info"):
            return True
        if self.export_mode == "code" and dir_name.lower() in ("tests", "test", "__tests__"):
            return True
        return self.gitignore_mgr.is_ignored(dir_path, is_dir=True)
    def _matches_exclusion(self, file_path: Path) -> bool:
        """Vérifie si le fichier correspond aux motifs d'exclusion configurés."""
        rel_posix: str = file_path.relative_to(self.root_dir).as_posix().lower()
        name_low, suf_low = file_path.name.lower(), file_path.suffix.lower()
        for pat in self.config.excluded_patterns:
            pat_low: str = pat.lower()
            if (pat_low.startswith(".") and not pat_low.startswith("*") and suf_low == pat_low) or fnmatch.fnmatch(name_low, pat_low) or fnmatch.fnmatch(rel_posix, pat_low):
                return True
        return False

    def is_target_file(self, file_path: Path) -> bool:
        """Valide qu'un fichier est éligible à l'export selon le mode et les filtres."""
        try:
            resolved: Path = file_path.resolve()
            resolved.relative_to(self.root_dir)
        except (OSError, ValueError):
            return False
        if resolved in (self.output_file, self.script_path) or self.gitignore_mgr.is_ignored(file_path, is_dir=False) or self._matches_exclusion(file_path):
            return False
        rel_posix: str = file_path.relative_to(self.root_dir).as_posix()
        if self.include_subpaths and not any(rel_posix == sp or rel_posix.startswith(f"{sp}/") for sp in self.include_subpaths):
            return False
        if self.export_mode == "modified" and self._git_modified_rel is not None and rel_posix.lower() not in self._git_modified_rel:
            return False
        is_test: bool = self.is_test_rel_path(rel_posix)
        if (self.export_mode == "code" and is_test) or (self.export_mode == "tests" and not is_test):
            return False
        return file_path.name in self.config.included_exact_names or file_path.suffix.lower() in self.config.included_extensions

    def _read_file_content(self, file_path: Path) -> str:
        """Lit le contenu d'un fichier avec encodage de repli et extrait son squelette si requis."""
        try:
            raw: str = file_path.read_text(encoding=self.config.primary_encoding)
        except UnicodeDecodeError:
            raw = file_path.read_text(encoding=self.config.fallback_encoding)
        except Exception as exc:
            return f"[ERREUR DE LECTURE : {exc}]"
        if self.export_mode == "skeleton":
            from project_exporter.skeleton import extract_skeleton
            return extract_skeleton(file_path.suffix.lower(), raw)
        return raw

    def _prepare_output_file(self) -> None:
        """Crée le répertoire parent et supprime un éventuel ancien export."""
        self.output_file.parent.mkdir(parents=True, exist_ok=True)
        if self.output_file.exists():
            self.output_file.unlink()

    @staticmethod
    def estimate_tokens(text: str) -> int:
        """Estime le nombre de tokens d'un texte (~4 caractères par token)."""
        return max(1, (len(text) + 3) // 4) if text else 0

    @classmethod
    def build_manifest(cls, entries: List[Tuple[str, str, int]], export_mode: str = "full", all_files: Optional[List[str]] = None) -> str:
        """Génère l'en-tête récapitulatif des fichiers exportés et omis."""
        mode_label: str = cls.MODE_LABELS.get(export_mode, cls.MODE_LABELS["full"])
        total_lines: int = sum(ln_cnt for _, _, ln_cnt in entries)
        total_tokens: int = sum(cls.estimate_tokens(body) for _, body, _ in entries)
        header_lines: List[str] = [f"=== EXPORT : {mode_label} | {len(entries)} fichier(s) | {total_lines} lignes | ~{total_tokens:,} tok ===".replace(",", " ")]
        for rel, body, ln_cnt in entries:
            header_lines.append(f"- {rel} ({ln_cnt}l, ~{cls.estimate_tokens(body)}t){' [>75l]' if ln_cnt > 75 else ''}")
        if all_files and len(all_files) > len(entries):
            included_set = {rel for rel, _, _ in entries}
            omitted = [f for f in all_files if f not in included_set]
            header_lines.append(f"--- Arborescence omise ({len(omitted)} fichier(s)) : {', '.join(omitted)} ---")
        return "\n".join(header_lines) + "\n\n"

    def export(self) -> int:
        """Parcourt l'arborescence et écrit le fichier consolidé final."""
        self._prepare_output_file()
        entries: List[Tuple[str, str, int]] = []
        all_files: List[str] = []
        for current_root, dirs, files in os.walk(self.root_dir):
            curr_path: Path = Path(current_root)
            self.gitignore_mgr.register_directory(curr_path)
            dirs[:] = sorted(d for d in dirs if not self.should_exclude_dir(curr_path / d))
            for file_name in sorted(files):
                file_path: Path = curr_path / file_name
                rel: str = file_path.relative_to(self.root_dir).as_posix()
                is_valid = file_path.suffix.lower() in self.config.included_extensions or file_path.name in self.config.included_exact_names
                if is_valid and not self.gitignore_mgr.is_ignored(file_path, is_dir=False) and not self._matches_exclusion(file_path):
                    all_files.append(rel)
                if not self.is_target_file(file_path):
                    continue
                content: str = self._read_file_content(file_path)
                cleaned = [ln for ln in content.splitlines() if not ln.startswith("# Commandes pip à exécuter :")]
                normalized: str = "\n".join(cleaned).rstrip() + "\n"
                entries.append((rel, normalized, len(normalized.splitlines())))
        with self.output_file.open("w", encoding="utf-8") as out:
            out.write(self.build_manifest(entries, export_mode=self.export_mode, all_files=all_files))
            for rel, normalized, _ in entries:
                out.write(f"--- {rel} ---\n{normalized}\n")
        return len(entries)
