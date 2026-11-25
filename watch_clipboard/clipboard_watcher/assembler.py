# Commandes pip à exécuter : Aucune dépendance externe requise (bibliothèque standard uniquement)

import os
import re
from typing import List, Optional
from clipboard_watcher.config import WatcherConfig
from clipboard_watcher.part_assembler import assemble_partial_file, cleanup_excess_parts


class UnsafePathError(ValueError):
    """Exception levée lorsqu'un chemin extrait du presse-papiers sort du dossier cible."""


class FileAssembler:
    """Analyse les blocs extraits du presse-papiers et écrit ou réassemble les fichiers cibles."""

    FILE_HEADER_PATTERN: str = r"(?m)^[ \t]*(?:#\s*)?=== FILE(?:_PART)?:\s*(.+?)\s*===[ \t]*"
    END_FILE_PATTERN: str = r"(?m)^[ \t]*(?:#\s*)?=== END_FILE ===[ \t]*$"

    def __init__(self, base_dir: str, config: WatcherConfig) -> None:
        self.base_dir: str = os.path.realpath(base_dir)
        self.config: WatcherConfig = config
        temp_sub: str = (self.config.temp_dir_name or "").strip().strip("\\/")
        if not temp_sub or temp_sub in (".", ".."):
            temp_sub = ".watch_clipboard"
        self.temp_dir: str = os.path.realpath(os.path.join(self.base_dir, temp_sub))
        self.last_event: Optional[str] = None

    def _strip_redundant_base_prefix(self, rel_clean: str) -> str:
        base_name: str = os.path.basename(self.base_dir)
        prefix: str = f"{base_name}/"
        if base_name and rel_clean.lower().startswith(prefix.lower()):
            stripped: str = rel_clean[len(prefix):]
            if stripped:
                return stripped
        return rel_clean

    def _safe_join(self, root_dir: str, rel_path: str) -> str:
        raw_clean: str = rel_path.strip().replace("\\", "/")
        if not raw_clean or raw_clean.startswith("/") or os.path.isabs(raw_clean):
            raise UnsafePathError(f"Chemin interdit (absolu ou vide) : '{rel_path}'")
        raw_clean = self._strip_redundant_base_prefix(raw_clean)
        candidate: str = os.path.realpath(os.path.join(root_dir, raw_clean))
        try:
            common: str = os.path.commonpath([root_dir, candidate])
        except ValueError as exc:
            raise UnsafePathError(f"Lecteur incompatible pour '{rel_path}'") from exc
        if common != root_dir or candidate == root_dir:
            raise UnsafePathError(f"Tentative de traversée de répertoire bloquée : '{rel_path}'")
        return candidate

    def has_file_tags(self, raw: str) -> bool:
        clean_raw: str = raw.replace("\u00a0", " ").replace("\r\n", "\n").replace("\r", "\n")
        return bool(re.search(self.FILE_HEADER_PATTERN, clean_raw))

    def resolve_target_path(self, rel_path: str) -> str:
        return self._safe_join(self.base_dir, rel_path)

    def resolve_temp_path(self, rel_path: str) -> str:
        candidate: str = self._safe_join(self.temp_dir, rel_path)
        if os.path.dirname(candidate) == self.base_dir:
            raise UnsafePathError(f"Le cache partiel doit résider dans {self.temp_dir}")
        return candidate

    def _clean_block_lines(self, raw_block: str) -> str:
        truncated: str = next(iter(re.split(self.END_FILE_PATTERN, raw_block, maxsplit=1)), "")
        lines: List[str] = truncated.strip("\n").splitlines()
        first: str = next(iter(lines), "")
        if first.lstrip().startswith("\x60" * 3) or first.strip() in self.config.strip_lang_tags:
            lines = lines[1:]
        if lines and lines[-1].strip().startswith("\x60" * 3):
            lines = lines[:-1]
        return "\n".join(lines).rstrip()

    def _record_event(self, tag: str, target_path: str, detail: str = "") -> None:
        rel_display: str = os.path.relpath(target_path, self.base_dir).replace("\\", "/")
        suffix: str = f" ({detail})" if detail else ""
        self.last_event = f"[{tag}] {rel_display}{suffix}"

    def process_text(self, raw: str) -> int:
        clean_raw: str = raw.replace("\u00a0", " ").replace("\r\n", "\n").replace("\r", "\n")
        parts: List[str] = re.split(self.FILE_HEADER_PATTERN, clean_raw)
        if len(parts) < 3:
            return 0
        updated, blocked_event = 0, None
        for idx in range(1, len(parts), 2):
            header: str = parts[idx].strip()
            clean_code: str = self._clean_block_lines(parts[idx + 1])
            try:
                if "|" in header:
                    assemble_partial_file(self, header, clean_code)
                else:
                    target_path: str = self.resolve_target_path(header)
                    cleanup_excess_parts(self.resolve_temp_path(header), 1, self.config.max_parts)
                    os.makedirs(os.path.dirname(target_path) or ".", exist_ok=True)
                    with open(target_path, "w", encoding=self.config.encoding, newline="\n") as f:
                        f.write(clean_code + "\n")
                    self._record_event("OK", target_path)
                    print(f"[OK] {target_path}")
                updated += 1
            except (UnsafePathError, ValueError) as exc:
                blocked_event = f"[BLOQUÉ] {exc}"
                self.last_event = blocked_event
                print(blocked_event)
        if blocked_event is not None:
            self.last_event = blocked_event
        elif updated > 1 and self.last_event:
            self.last_event = f"{self.last_event} (+{updated - 1})"
        return updated
