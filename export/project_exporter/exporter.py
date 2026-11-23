# Commandes pip à exécuter : Aucune dépendance externe requise (bibliothèque standard uniquement)

import fnmatch
import logging
import os
from pathlib import Path
from project_exporter.config import ExporterConfig
from project_exporter.gitignore import GitignoreManager


class ProjectExporter:
    """
    Parcourt récursivement un répertoire projet et consolide les fichiers cibles dans un export unique.
    """

    def __init__(
        self,
        root_dir: Path,
        config: ExporterConfig,
        output_file: Path,
        script_path: Path,
        logger: logging.Logger,
    ) -> None:
        self.root_dir: Path = root_dir.resolve()
        self.config: ExporterConfig = config
        self.output_file: Path = output_file.resolve()
        self.script_path: Path = script_path.resolve()
        self.logger: logging.Logger = logger
        self.gitignore_mgr: GitignoreManager = GitignoreManager(
            root_dir=self.root_dir,
            logger=self.logger,
            enabled=self.config.respect_gitignore,
        )

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

    def export(self) -> int:
        self._prepare_output_file()
        exported: int = 0
        sep: str = "=" * 80 + "\n"

        with self.output_file.open("w", encoding="utf-8") as out:
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
                    out.write(f"{sep}FICHIER : {rel}\n{sep}")
                    out.write(content if content.endswith("\n") else content + "\n")
                    out.write("\n")
                    exported += 1
        return exported
