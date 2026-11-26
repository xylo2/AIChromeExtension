# SPDX-License-Identifier: GPL-3.0-or-later
# Copyright (C) 2026 Utilisateur_A
# Analyse, validation des chemins, nettoyage et assemblage des blocs du presse-papiers.

import os
import re
from typing import Dict, List, Optional
from clipboard_watcher.config import WatcherConfig
from clipboard_watcher.part_assembler import assemble_partial_file, cleanup_excess_parts
from clipboard_watcher.syntax_checker import SyntaxChecker


class UnsafePathError(ValueError):
    """Exception levée lorsqu'un chemin extrait du presse-papiers sort du dossier cible."""


class FileAssembler:
    """Analyse les blocs extraits du presse-papiers, nettoie et assemble les fichiers cibles."""

    FILE_HEADER_PATTERN: str = r"(?m)^[ \t]*(?:#\s*)?=== FILE(?:_PART)?:\s*(.+?)\s*===[ \t]*"
    END_FILE_PATTERN: str = r"(?m)^[ \t]*(?:#\s*)?=== END_FILE ===[ \t]*$"

    def __init__(self, base_dir: str, config: WatcherConfig) -> None:
        """Initialise les répertoires racine et cache miroir de l'assembleur."""
        self.base_dir: str = os.path.realpath(base_dir)
        self.config: WatcherConfig = config
        sep_chars: str = chr(92) + "/"
        temp_sub: str = (self.config.temp_dir_name or "").strip().strip(sep_chars)
        if not temp_sub or temp_sub in (".", ".."):
            temp_sub = ".watch_clipboard"
        self.temp_dir: str = os.path.realpath(os.path.join(self.base_dir, temp_sub))
        self.last_event: Optional[str] = None
        self.recent_events: List[str] = []
        self.last_syntax_error: Optional[Dict[str, object]] = None

    def _strip_redundant_base_prefix(self, rel_clean: str) -> str:
        """Retire le préfixe redondant du dossier racine en tête de chemin relatif."""
        base_name: str = os.path.basename(self.base_dir)
        prefix: str = f"{base_name}/"
        if base_name and rel_clean.lower().startswith(prefix.lower()):
            stripped: str = rel_clean[len(prefix):]
            if stripped:
                return stripped
        return rel_clean

    def _safe_join(self, root_dir: str, rel_path: str) -> str:
        """Résout un chemin relatif en interdisant toute traversée hors de root_dir."""
        sep_back: str = chr(92)
        raw_clean: str = rel_path.strip().replace(sep_back, "/")
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
        """Indique si le texte brut contient au moins une balise FILE ou FILE_PART."""
        clean_raw: str = raw.replace("\u00a0", " ").replace("\r\n", "\n").replace("\r", "\n")
        return bool(re.search(self.FILE_HEADER_PATTERN, clean_raw))
    def resolve_target_path(self, rel_path: str) -> str:
        """Résout et valide le chemin de destination final sous base_dir."""
        return self._safe_join(self.base_dir, rel_path)

    def resolve_temp_path(self, rel_path: str) -> str:
        """Résout et valide le chemin du fragment dans le cache miroir."""
        candidate: str = self._safe_join(self.temp_dir, rel_path)
        if os.path.dirname(candidate) == self.base_dir:
            raise UnsafePathError(f"Le cache partiel doit résider dans {self.temp_dir}")
        return candidate

    def _clean_block_lines(self, raw_block: str) -> str:
        """Retire les marqueurs de fin, les clôtures Markdown et les espaces superflus."""
        truncated: str = next(iter(re.split(self.END_FILE_PATTERN, raw_block, maxsplit=1)), "")
        lines: List[str] = truncated.strip("\n").splitlines()
        fence: str = chr(96) * 3
        first: str = next(iter(lines), "")
        had_open_fence: bool = first.lstrip().startswith(fence)
        if had_open_fence:
            lines = lines[1:]
            if lines and lines[0].strip() in self.config.strip_lang_tags:
                lines = lines[1:]
        if lines and lines[-1].strip().startswith(fence):
            lines = lines[:-1]
        cleaned: List[str] = [ln.rstrip() for ln in lines]
        return "\n".join(cleaned).rstrip()

    def _push_history(self, event_text: str) -> None:
        """Enregistre l'événement courant dans l'historique glissant récent."""
        self.last_event = event_text
        if not self.recent_events or self.recent_events[-1] != event_text:
            self.recent_events = [*self.recent_events[-4:], event_text]

    def _record_event(self, tag: str, target_path: str, detail: str = "") -> None:
        """Formate et mémorise un événement horodaté pour un fichier cible."""
        sep_back: str = chr(92)
        rel_display: str = os.path.relpath(target_path, self.base_dir).replace(sep_back, "/")
        suffix: str = f" ({detail})" if detail else ""
        self._push_history(f"[{tag}] {rel_display}{suffix}")

    def _verify_written_syntax(self, target_path: str, ok_tag: str = "OK", ok_detail: str = "") -> None:
        """Contrôle la syntaxe du fichier écrit et met à jour l'état d'alerte."""
        sep_back: str = chr(92)
        rel_display: str = os.path.relpath(target_path, self.base_dir).replace(sep_back, "/")
        err = SyntaxChecker.check_file(target_path, rel_display, encoding=self.config.encoding)
        if err is not None:
            self.last_syntax_error = err
            self._record_event("SYNTAXE", target_path, f"ligne {err['line']}")
            print(f"[SYNTAXE] {rel_display}:{err['line']} -> {err['message']}")
        else:
            if self.last_syntax_error and self.last_syntax_error.get("file") == rel_display:
                self.last_syntax_error = None
            self._record_event(ok_tag, target_path, ok_detail)
            suffix: str = f" ({ok_detail})" if ok_detail else ""
            print(f"[{ok_tag}] {target_path}{suffix}")

    def process_text(self, raw: str) -> int:
        """Découpe le texte du presse-papiers en blocs FILE/FILE_PART et écrit les fichiers."""
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
                    self._verify_written_syntax(target_path, ok_tag="OK")
                updated += 1
            except (UnsafePathError, ValueError) as exc:
                blocked_event = f"[BLOQUÉ] {exc}"
                self._push_history(blocked_event)
                print(blocked_event)
        if blocked_event is not None:
            self.last_event = blocked_event
        elif updated > 1 and self.last_event:
            self.last_event = f"{self.last_event} (+{updated - 1})"
        return updated
