# Sauvegarde des fragments .partN et assemblage des fichiers multi-parties.

import os
from typing import Any, List, Optional, Tuple


def parse_part_info(part_info: str) -> Tuple[int, Optional[int]]:
    """Extrait l'indice de partie et le total éventuel depuis 'k/N' ou 'k'."""
    if "/" in part_info:
        num_str, tot_str = [x.strip() for x in part_info.split("/", 1)]
        return int(num_str), int(tot_str)
    return int(part_info), None


def cleanup_excess_parts(temp_base_path: str, start: int, end: int) -> None:
    """Supprime les anciens fragments résiduels au-delà de la borne attendue."""
    for n in range(start, end + 1):
        p_path: str = f"{temp_base_path}.part{n}"
        if os.path.exists(p_path):
            os.remove(p_path)


def assemble_partial_file(assembler: Any, header: str, clean_code: str) -> None:
    """Enregistre un fragment dans le cache miroir et tente l'assemblage complet."""
    rel_path, part_info = [x.strip() for x in header.split("|", 1)]
    target_path: str = assembler.resolve_target_path(rel_path)
    temp_base_path: str = assembler.resolve_temp_path(rel_path)
    part_num, total_parts = parse_part_info(part_info)

    if part_num < 1 or part_num > assembler.config.max_parts:
        raise ValueError(f"Numéro de partie hors limites ({part_num}) pour '{rel_path}'")

    stray_part: str = f"{target_path}.part{part_num}"
    if os.path.isfile(stray_part):
        os.remove(stray_part)

    os.makedirs(os.path.dirname(temp_base_path) or ".", exist_ok=True)
    part_file_path: str = f"{temp_base_path}.part{part_num}"
    with open(part_file_path, "w", encoding=assembler.config.encoding, newline="\n") as pf:
        pf.write(clean_code + "\n")

    if total_parts:
        cleanup_excess_parts(temp_base_path, total_parts + 1, assembler.config.max_parts)
    try_assemble_parts(assembler, target_path, temp_base_path, part_num, total_parts)


def try_assemble_parts(
    assembler: Any,
    target_path: str,
    temp_base_path: str,
    part_num: int,
    total_parts: Optional[int],
) -> None:
    """Vérifie la présence de tous les fragments et écrit le fichier cible assemblé."""
    max_check: int = total_parts if total_parts else assembler.config.max_parts
    assembled: List[str] = []
    missing: List[int] = []

    for n in range(1, max_check + 1):
        p_path: str = f"{temp_base_path}.part{n}"
        if os.path.exists(p_path):
            with open(p_path, "r", encoding=assembler.config.encoding) as rf:
                assembled.append(rf.read().rstrip())
        elif total_parts:
            missing.append(n)
        else:
            break

    if total_parts and not missing:
        os.makedirs(os.path.dirname(target_path) or ".", exist_ok=True)
        with open(target_path, "w", encoding=assembler.config.encoding, newline="\n") as out:
            out.write("\n".join(assembled).rstrip() + "\n")
        assembler._verify_written_syntax(target_path, ok_tag="COMPLET", ok_detail=f"{total_parts}/{total_parts}")
    elif total_parts and missing:
        assembler._record_event("ATTENTE", target_path, f"{part_num}/{total_parts}, manque {missing}")
        print(f"[ATTENTE] {target_path} (partie {part_num}/{total_parts} sauvée, manque : {missing})")
    elif assembled:
        os.makedirs(os.path.dirname(target_path) or ".", exist_ok=True)
        with open(target_path, "w", encoding=assembler.config.encoding, newline="\n") as out:
            out.write("\n".join(assembled).rstrip() + "\n")
        assembler._verify_written_syntax(target_path, ok_tag="OK", ok_detail=f"partie {part_num}")
