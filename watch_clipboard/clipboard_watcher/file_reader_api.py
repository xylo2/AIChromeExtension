# Relecture sécurisée des fichiers cibles ou des fragments mis en cache.

import os
from typing import Any, Callable, List, Tuple


class SavedFileReader:
    """Relit un fichier cible ou une partie mise en cache par l'assembleur."""

    def __init__(
        self,
        target_dir: str,
        assembler_ref: Any,
        is_within_roots_fn: Callable[[str, List[str]], bool],
    ) -> None:
        """Initialise le lecteur avec le répertoire cible et la fonction de garde."""
        self.target_dir: str = target_dir
        self.assembler_ref: Any = assembler_ref
        self._is_within_allowed_roots = is_within_roots_fn

    def normalize_rel_path(self, raw_rel: str, base_real: str) -> str:
        """Retire l'éventuel préfixe redondant du dossier racine en tête de chemin."""
        rel_norm: str = raw_rel.replace("\\", "/")
        if self.assembler_ref is not None and hasattr(self.assembler_ref, "_strip_redundant_base_prefix"):
            return str(self.assembler_ref._strip_redundant_base_prefix(rel_norm))
        base_name: str = os.path.basename(base_real)
        prefix: str = f"{base_name}/"
        if base_name and rel_norm.lower().startswith(prefix.lower()):
            stripped: str = rel_norm[len(prefix):]
            if stripped:
                return stripped
        return rel_norm

    def read_from_header(self, header: str) -> Tuple[bool, str, str]:
        """Lit le fichier ou fragment désigné par une balise FILE ou FILE_PART."""
        clean_header: str = header.strip()
        if not clean_header:
            return False, "", "En-tête de fichier vide."
        base_real: str = os.path.realpath(self.target_dir)
        temp_dir_name: str = ".watch_clipboard"
        encoding: str = "utf-8"
        if self.assembler_ref is not None:
            base_real = os.path.realpath(getattr(self.assembler_ref, "base_dir", base_real))
            cfg = getattr(self.assembler_ref, "config", None)
            if cfg is not None:
                temp_dir_name = getattr(cfg, "temp_dir_name", temp_dir_name)
                encoding = getattr(cfg, "encoding", encoding)
        temp_real: str = os.path.realpath(os.path.join(base_real, temp_dir_name))
        if "|" in clean_header:
            rel_part, part_spec = [x.strip() for x in clean_header.split("|", 1)]
            rel_norm: str = self.normalize_rel_path(rel_part, base_real)
            if not rel_norm or rel_norm.startswith("/") or os.path.isabs(rel_norm):
                return False, "", "Chemin relatif non autorisé."
            num_str: str = next(iter(part_spec.split("/", 1)), "").strip()
            if not num_str.isdigit() or int(num_str) < 1:
                return False, "", "Numéro de partie invalide."
            part_num: int = int(num_str)
            candidate: str = os.path.realpath(os.path.join(temp_real, f"{rel_norm}.part{part_num}"))
            if not self._is_within_allowed_roots(candidate, [temp_real]):
                return False, "", "Chemin cache hors périmètre autorisé."
            attach_name: str = f"{os.path.basename(rel_norm)}.part{part_num}.txt"
        else:
            rel_norm = self.normalize_rel_path(clean_header, base_real)
            if not rel_norm or rel_norm.startswith("/") or os.path.isabs(rel_norm):
                return False, "", "Chemin relatif non autorisé."
            candidate = os.path.realpath(os.path.join(base_real, rel_norm))
            if not self._is_within_allowed_roots(candidate, [base_real]):
                return False, "", "Chemin cible hors périmètre autorisé."
            attach_name = os.path.basename(rel_norm)
        if not os.path.isfile(candidate):
            return False, "", f"Fichier introuvable sur disque : {candidate}"
        with open(candidate, "r", encoding=encoding, errors="replace") as f_in:
            return True, attach_name, f_in.read()
