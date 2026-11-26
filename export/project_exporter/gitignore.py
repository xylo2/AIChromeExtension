# Gestionnaire de filtrage hiérarchique des règles .gitignore sans dépendance externe.

import logging
import re
from pathlib import Path
from typing import Dict, List, Pattern


class GitignoreRule:
    """Représente une règle unitaire issue d'un fichier .gitignore."""

    def __init__(self, pattern: str) -> None:
        """Analyse la négation, le ciblage de dossier et compile le motif."""
        self.negated: bool = pattern.startswith("!")
        if self.negated:
            pattern = pattern[1:]

        self.dir_only: bool = pattern.endswith("/")
        if self.dir_only:
            pattern = pattern.rstrip("/")

        anchored: bool = pattern.startswith("/") or ("/" in pattern)
        pattern = pattern.lstrip("/")
        self.regex: Pattern[str] = self._compile_pattern(pattern, anchored)

    @staticmethod
    def _restore_char_classes(escaped: str) -> str:
        """Restaure les classes de caractères [...] après échappement regex."""
        def _replace_class(match: re.Match[str]) -> str:
            """Convertit une classe échappée en classe regex valide."""
            inner: str = match.group(1)
            if inner.startswith(r"\!"):
                inner = "^" + inner[2:]
            elif inner.startswith("!"):
                inner = "^" + inner[1:]
            inner = inner.replace(r"\-", "-")
            return f"[{inner}]"

        return re.sub(r"\\\[((?:\\.|[^\\\]])+)\\\]", _replace_class, escaped)

    def _compile_pattern(self, pattern: str, anchored: bool) -> Pattern[str]:
        """Traduit un motif glob .gitignore en expression régulière."""
        escaped: str = re.escape(pattern)
        escaped = self._restore_char_classes(escaped)
        escaped = escaped.replace(r"\*\*/", "(?:.+/)?")
        escaped = escaped.replace(r"/\*\*", "(?:/.*)?")
        escaped = escaped.replace(r"\*\*", ".*")
        escaped = escaped.replace(r"\*", "[^/]*")
        escaped = escaped.replace(r"\?", "[^/]")

        prefix: str = "^" if anchored else "(?:^|/)"
        return re.compile(f"{prefix}{escaped}(?:/.*)?\\Z")

    def matches(self, rel_path: str, is_dir: bool) -> bool:
        """Vérifie si un chemin relatif et son type correspondent à la règle."""
        if self.dir_only and not is_dir:
            return False
        return bool(self.regex.search(rel_path))
class GitignoreManager:
    """Charge et évalue hiérarchiquement les fichiers .gitignore."""

    def __init__(
        self, root_dir: Path, logger: logging.Logger, enabled: bool = True
    ) -> None:
        """Initialise le gestionnaire de règles pour une arborescence donnée."""
        self.root_dir: Path = root_dir
        self.logger: logging.Logger = logger
        self.enabled: bool = enabled
        self._rules_by_dir: Dict[Path, List[GitignoreRule]] = {}

    def register_directory(self, current_dir: Path) -> None:
        """Charge et compile les règles du .gitignore présent dans current_dir."""
        if not self.enabled:
            return
        gi_file: Path = current_dir / ".gitignore"
        if not gi_file.is_file():
            return

        rules: List[GitignoreRule] = []
        try:
            raw_txt: str = gi_file.read_text(encoding="utf-8", errors="ignore")
            for raw_line in raw_txt.splitlines():
                line: str = raw_line.strip()
                if not line or line.startswith("#"):
                    continue
                rules.append(GitignoreRule(line))
            self._rules_by_dir[current_dir] = rules
        except Exception as exc:
            self.logger.warning("Impossible de lire %s : %s", gi_file, exc)

    def is_ignored(self, target_path: Path, is_dir: bool = False) -> bool:
        """Évalue séquentiellement toutes les règles applicables à target_path."""
        if not self.enabled:
            return False

        ignored: bool = False
        ordered_dirs = sorted(
            self._rules_by_dir.keys(), key=lambda p: len(p.parts)
        )
        for base_dir in ordered_dirs:
            try:
                rel_path: str = target_path.relative_to(base_dir).as_posix()
            except ValueError:
                continue

            for rule in self._rules_by_dir[base_dir]:
                if rule.matches(rel_path, is_dir):
                    ignored = not rule.negated
        return ignored
