# Commandes pip à exécuter : Aucune dépendance externe requise (bibliothèque standard uniquement)

import os
import re
from typing import List, Optional, Tuple
from clipboard_watcher.config import WatcherConfig


class UnsafePathError(ValueError):
    """
    Exception levée lorsqu'un chemin extrait du presse-papiers sort du dossier cible.
    """


class FileAssembler:
    """
    Analyse les blocs extraits du presse-papiers, maintient le cache miroir
    et écrit ou réassemble les fichiers cibles de manière sécurisée.
    """

    FILE_HEADER_PATTERN: str = r"(?m)^[ \t]*(?:#\s*)?=== FILE(?:_PART)?:\s*(.+?)\s*===[ \t]*"

    def __init__(self, base_dir: str, config: WatcherConfig) -> None:
        self.base_dir: str = os.path.realpath(base_dir)
        self.config: WatcherConfig = config
        temp_sub: str = (self.config.temp_dir_name or "").strip().strip("\\/")
        if not temp_sub or temp_sub in (".", ".."):
            temp_sub = ".watch_clipboard"
        self.temp_dir: str = os.path.realpath(os.path.join(self.base_dir, temp_sub))
        self.last_event: Optional[str] = None

    def _strip_redundant_base_prefix(self, rel_clean: str) -> str:
        """Évite la création de dossier/dossier/ lorsque rel_path répète le nom de base_dir."""
        base_name: str = os.path.basename(self.base_dir)
        if not base_name:
            return rel_clean
        prefix: str = f"{base_name}/"
        if rel_clean.lower().startswith(prefix.lower()):
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
        clean_raw: str = raw.replace("\u00a0", " ").replace("\r\n", "\n")
        return bool(re.search(self.FILE_HEADER_PATTERN, clean_raw))

    def resolve_target_path(self, rel_path: str) -> str:
        return self._safe_join(self.base_dir, rel_path)

    def resolve_temp_path(self, rel_path: str) -> str:
        candidate: str = self._safe_join(self.temp_dir, rel_path)
        if os.path.dirname(candidate) == self.base_dir:
            raise UnsafePathError(f"Le cache partiel doit résider dans {self.temp_dir}")
        return candidate

    def _clean_block_lines(self, raw_block: str) -> str:
        lines: List[str] = raw_block.strip("\n").splitlines()
        first: str = next(iter(lines), "")
        if first.lstrip().startswith("\x60" * 3) or first.strip() in self.config.strip_lang_tags:
            lines = lines[1:]
        if lines and lines[-1].strip().startswith("\x60" * 3):
            lines = lines[:-1]
        return "\n".join(lines).rstrip()

    def _parse_part_info(self, part_info: str) -> Tuple[int, Optional[int]]:
        if "/" in part_info:
            num_str, tot_str = [x.strip() for x in part_info.split("/", 1)]
            return int(num_str), int(tot_str)
        return int(part_info), None
    def _handle_partial_file(self, header: str, clean_code: str) -> None:
        rel_path, part_info = [x.strip() for x in header.split("|", 1)]
        target_path: str = self.resolve_target_path(rel_path)
        temp_base_path: str = self.resolve_temp_path(rel_path)
        part_num, total_parts = self._parse_part_info(part_info)

        if part_num < 1 or part_num > self.config.max_parts:
            raise ValueError(f"Numéro de partie hors limites ({part_num}) pour '{rel_path}'")

        # Supprime un éventuel .partN égaré directement dans le dossier projet
        stray_part: str = f"{target_path}.part{part_num}"
        if os.path.isfile(stray_part):
            os.remove(stray_part)

        os.makedirs(os.path.dirname(temp_base_path) or ".", exist_ok=True)
        part_file_path: str = f"{temp_base_path}.part{part_num}"
        with open(part_file_path, "w", encoding=self.config.encoding, newline="\n") as pf:
            pf.write(clean_code + "\n")

        if total_parts:
            self._cleanup_excess_parts(temp_base_path, total_parts + 1, self.config.max_parts)
        self._try_assemble(target_path, temp_base_path, part_num, total_parts)

    def _cleanup_excess_parts(self, temp_base_path: str, start: int, end: int) -> None:
        for n in range(start, end + 1):
            p_path: str = f"{temp_base_path}.part{n}"
            if os.path.exists(p_path):
                os.remove(p_path)

    def _record_event(self, tag: str, target_path: str, detail: str = "") -> None:
        rel_display: str = os.path.relpath(target_path, self.base_dir).replace("\\", "/")
        suffix: str = f" ({detail})" if detail else ""
        self.last_event = f"[{tag}] {rel_display}{suffix}"

    def _try_assemble(
        self,
        target_path: str,
        temp_base_path: str,
        part_num: int,
        total_parts: Optional[int],
    ) -> None:
        max_check: int = total_parts if total_parts else self.config.max_parts
        assembled: List[str] = []
        missing: List[int] = []

        for n in range(1, max_check + 1):
            p_path: str = f"{temp_base_path}.part{n}"
            if os.path.exists(p_path):
                with open(p_path, "r", encoding=self.config.encoding) as rf:
                    assembled.append(rf.read().rstrip())
            elif total_parts:
                missing.append(n)
            else:
                break

        if total_parts and not missing:
            os.makedirs(os.path.dirname(target_path) or ".", exist_ok=True)
            with open(target_path, "w", encoding=self.config.encoding, newline="\n") as out:
                out.write("\n".join(assembled).rstrip() + "\n")
            self._record_event("COMPLET", target_path, f"{total_parts}/{total_parts}")
            print(f"[COMPLET] {target_path} ({total_parts}/{total_parts} parties assemblées)")
        elif total_parts and missing:
            self._record_event("ATTENTE", target_path, f"{part_num}/{total_parts}, manque {missing}")
            print(f"[ATTENTE] {target_path} (partie {part_num}/{total_parts} sauvée, manque : {missing})")
        elif assembled:
            os.makedirs(os.path.dirname(target_path) or ".", exist_ok=True)
            with open(target_path, "w", encoding=self.config.encoding, newline="\n") as out:
                out.write("\n".join(assembled).rstrip() + "\n")
            self._record_event("OK", target_path, f"partie {part_num}")
            print(f"[OK] {target_path} (partie {part_num} assemblée)")

    def process_text(self, raw: str) -> int:
        clean_raw: str = raw.replace("\u00a0", " ").replace("\r\n", "\n")
        parts: List[str] = re.split(self.FILE_HEADER_PATTERN, clean_raw)
        if len(parts) < 3:
            return 0

        updated: int = 0
        blocked_event: Optional[str] = None
        for idx in range(1, len(parts), 2):
            header: str = parts[idx].strip()
            clean_code: str = self._clean_block_lines(parts[idx + 1])
            try:
                if "|" in header:
                    self._handle_partial_file(header, clean_code)
                else:
                    target_path: str = self.resolve_target_path(header)
                    temp_base_path: str = self.resolve_temp_path(header)
                    self._cleanup_excess_parts(temp_base_path, 1, self.config.max_parts)
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
