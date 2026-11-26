# Commandes pip à exécuter : Aucune dépendance externe requise (bibliothèque standard uniquement)

import fnmatch
import logging
import os
from pathlib import Path
from typing import List, Tuple
from project_exporter.config import ExporterConfig
from project_exporter.gitignore import GitignoreManager


class ProjectExporter:
    """
    Parcourt récursivement un répertoire projet et consolide les fichiers cibles dans un export unique,
    précédé d'un manifeste listant les fichiers, leur nombre de lignes et une estimation de tokens.
    """

    MODE_LABELS: dict[str, str] = {
        "full": "COMPLET (code + tests)",
        "code": "PARTIEL — CODE UNIQUEMENT (sans fichiers de tests)",
        "tests": "PARTIEL — TESTS UNIQUEMENT",
    }

    def __init__(
        self,
        root_dir: Path,
        config: ExporterConfig,
        output_file: Path,
        script_path: Path,
        logger: logging.Logger,
        export_mode: str = "full",
    ) -> None:
        self.root_dir: Path = root_dir.resolve()
        self.config: ExporterConfig = config
        self.output_file: Path = output_file.resolve()
        self.script_path: Path = script_path.resolve()
        self.logger: logging.Logger = logger
        clean_mode: str = (export_mode or "full").strip().lower()
        self.export_mode: str = clean_mode if clean_mode in self.MODE_LABELS else "full"
        self.gitignore_mgr: GitignoreManager = GitignoreManager(
            root_dir=self.root_dir,
            logger=self.logger,
            enabled=self.config.respect_gitignore,
        )

    @staticmethod
    def is_test_rel_path(rel_posix: str) -> bool:
        parts: List[str] = [p.lower() for p in rel_posix.replace("\\", "/").split("/") if p]
        if any(p in ("tests", "test", "__tests__") for p in parts[:-1]):
            return True
        fname: str = parts[-1] if parts else ""
        return fname.startswith("test_") or fname.endswith(("_test.py", ".test.js", ".spec.js", ".test.ts", ".spec.ts"))

    def should_exclude_dir(self, dir_path: Path) -> bool:
        """
        Vérifie si un dossier doit être ignoré selon les exclusions fixes et .gitignore.
        Les dossiers cachés (ex: .github) sont conservés s'ils ne figurent pas dans excluded_dirs.
        """
        dir_name: str = dir_path.name
        rel_dir: str = dir_path.relative_to(self.root_dir).as_posix()

        if dir_name in self.config.excluded_dirs or dir_name.endswith(".egg-info"):
            self.logger.debug("Dossier ignoré (règle fixe) : %s/", rel_dir)
            return True

        if self.export_mode == "code" and dir_name.lower() in ("tests", "test", "__tests__"):
            return True

        if self.gitignore_mgr.is_ignored(dir_path, is_dir=True):
            self.logger.debug("Dossier ignoré (.gitignore) : %s/", rel_dir)
            return True

        return False
    def _matches_exclusion(self, file_path: Path) -> bool:
        rel_posix: str = file_path.relative_to(self.root_dir).as_posix().lower()
        name_low: str = file_path.name.lower()
        suf_low: str = file_path.suffix.lower()

        for pattern in self.config.excluded_patterns:
            pat_low: str = pattern.lower()
            if pat_low.startswith(".") and not pat_low.startswith("*"):
                if suf_low == pat_low:
                    return True
            elif fnmatch.fnmatch(name_low, pat_low) or fnmatch.fnmatch(rel_posix, pat_low):
                return True
        return False

    def is_target_file(self, file_path: Path) -> bool:
        try:
            resolved: Path = file_path.resolve()
            resolved.relative_to(self.root_dir)
        except (OSError, ValueError):
            return False

        if resolved == self.output_file or resolved == self.script_path:
            return False
        if self.gitignore_mgr.is_ignored(file_path, is_dir=False):
            return False
        if self._matches_exclusion(file_path):
            return False
        rel_posix: str = file_path.relative_to(self.root_dir).as_posix()
        is_test: bool = self.is_test_rel_path(rel_posix)
        if self.export_mode == "code" and is_test:
            return False
        if self.export_mode == "tests" and not is_test:
            return False
        if file_path.name in self.config.included_exact_names:
            return True
        if file_path.suffix.lower() in self.config.included_extensions:
            return True
        return False

    def _read_file_content(self, file_path: Path) -> str:
        try:
            return file_path.read_text(encoding=self.config.primary_encoding)
        except UnicodeDecodeError:
            return file_path.read_text(encoding=self.config.fallback_encoding)
        except Exception as exc:
            return f"[ERREUR DE LECTURE : {exc}]"

    def _prepare_output_file(self) -> None:
        self.output_file.parent.mkdir(parents=True, exist_ok=True)
        if self.output_file.exists():
            self.output_file.unlink()

    @staticmethod
    def estimate_tokens(text: str) -> int:
        return max(1, (len(text) + 3) // 4) if text else 0

    @classmethod
    def build_manifest(cls, entries: List[Tuple[str, str, int]], export_mode: str = "full") -> str:
        sep: str = "=" * 80
        mode_label: str = cls.MODE_LABELS.get(export_mode, cls.MODE_LABELS["full"])
        total_lines: int = sum(ln_cnt for _, _, ln_cnt in entries)
        total_tokens: int = sum(cls.estimate_tokens(body) for _, body, _ in entries)
        header_lines: List[str] = [
            sep,
            f"TYPE D'EXPORT : {mode_label}",
            f"MANIFESTE DU PROJET : {len(entries)} fichier(s) | {total_lines} lignes | ~{total_tokens:,} tokens".replace(",", " "),
            sep,
        ]
        for rel, body, ln_cnt in entries:
            tok_est: int = cls.estimate_tokens(body)
            split_hint: str = " [>75l -> FILE_PART]" if ln_cnt > 75 else ""
            header_lines.append(f"- {rel} ({ln_cnt} lignes, ~{tok_est} tok){split_hint}")
        return "\n".join(header_lines) + "\n\n"

    def export(self) -> int:
        self._prepare_output_file()
        sep: str = "=" * 80 + "\n"
        entries: List[Tuple[str, str, int]] = []

        for current_root, dirs, files in os.walk(self.root_dir):
            curr_path: Path = Path(current_root)
            self.gitignore_mgr.register_directory(curr_path)
            dirs[:] = sorted(d for d in dirs if not self.should_exclude_dir(curr_path / d))
            for file_name in sorted(files):
                file_path: Path = curr_path / file_name
                if not self.is_target_file(file_path):
                    continue
                rel: str = file_path.relative_to(self.root_dir).as_posix()
                content: str = self._read_file_content(file_path)
                normalized: str = content if content.endswith("\n") else content + "\n"
                entries.append((rel, normalized, len(normalized.splitlines())))

        with self.output_file.open("w", encoding="utf-8") as out:
            out.write(self.build_manifest(entries, export_mode=self.export_mode))
            for rel, normalized, _ in entries:
                out.write(f"{sep}FICHIER : {rel}\n{sep}{normalized}\n")
        return len(entries)
