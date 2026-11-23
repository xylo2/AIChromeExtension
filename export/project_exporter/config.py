# Commandes pip à exécuter : Aucune dépendance externe requise (bibliothèque standard uniquement)

import configparser
import logging
import re
from pathlib import Path
from typing import List, Set


class ExporterConfig:
    """
    Charge et expose de manière typée les paramètres d'export depuis config.ini et la CLI.
    """

    def __init__(self, config_path: Path, logger: logging.Logger) -> None:
        """
        Initialise les valeurs par défaut puis charge le fichier INI s'il existe.

        :param config_path: Chemin vers le fichier config.ini.
        :param logger: Logger applicatif pour tracer le chargement.
        """
        self.config_path: Path = config_path
        self.logger: logging.Logger = logger
        self._parser: configparser.ConfigParser = configparser.ConfigParser()
        self.output_filename: str = "{project_name}_export.txt"
        self.respect_gitignore: bool = True
        self.excluded_dirs: Set[str] = {
            ".venv", "venv", "env", "__pycache__", ".git", ".idea", ".vscode",
            "build", "dist", "node_modules", ".pytest_cache", ".mypy_cache",
            ".ruff_cache", "htmlcov", "lib", "sdk", "cache", "..",
        }
        self.included_extensions: Set[str] = {
            ".py", ".xml", ".toml", ".txt", ".example", ".md", ".ini"
        }
        self.included_exact_names: Set[str] = set()
        self.excluded_patterns: Set[str] = set()
        self.primary_encoding: str = "utf-8"
        self.fallback_encoding: str = "latin-1"
        self._load()

    def _parse_csv(self, raw_value: str) -> Set[str]:
        """
        Convertit une chaîne séparée par des virgules en ensemble nettoyé.

        :param raw_value: Chaîne brute issue du INI ou de la CLI.
        :return: Ensemble des éléments non vides.
        """
        return {item.strip() for item in raw_value.split(",") if item.strip()}

    def _normalize_extensions(self, raw_items: Set[str]) -> Set[str]:
        """
        Normalise chaque extension en minuscules avec un point initial obligatoire.
        """
        normalized: Set[str] = set()
        for item in raw_items:
            low: str = item.lower()
            normalized.add(low if low.startswith(".") else f".{low}")
        return normalized

    def build_output_filename(self, project_name: str) -> str:
        """
        Construit le nom final du fichier d'export en y intégrant le nom du dossier cible.

        :param project_name: Nom du répertoire exporté.
        :return: Nom de fichier formaté et sécurisé.
        """
        clean_name: str = re.sub(r"[^\w\-.]", "_", project_name).strip("_") or "project"
        template: str = self.output_filename.strip()
        if "{project_name}" in template:
            return template.replace("{project_name}", clean_name)
        target: Path = Path(template)
        return f"{clean_name}_{target.stem}{target.suffix or '.txt'}"

    def apply_cli_overrides(
        self, includes: List[str], excludes: List[str], no_gitignore: bool
    ) -> None:
        """
        Applique les surcharges passées en ligne de commande sur la configuration chargée.

        :param includes: Extensions exclusives demandées via -i/--include.
        :param excludes: Motifs ou extensions à exclure via -e/--exclude.
        :param no_gitignore: Désactive le filtrage .gitignore si True.
        """
        if includes:
            raw_set: Set[str] = set()
            for entry in includes:
                raw_set.update(self._parse_csv(entry))
            normalized: Set[str] = self._normalize_extensions(raw_set)
            if normalized:
                self.included_extensions = normalized
                self.included_exact_names = set()
                self.logger.debug("Extensions restreintes via CLI : %s", ", ".join(sorted(normalized)))

        for entry in excludes:
            parsed: Set[str] = self._parse_csv(entry)
            self.excluded_patterns.update(parsed)
            self.logger.debug("Exclusions ajoutées via CLI : %s", ", ".join(sorted(parsed)))

        if no_gitignore:
            self.respect_gitignore = False
            self.logger.info("Prise en compte du .gitignore désactivée via CLI.")

    def _load(self) -> None:
        """
        Lit la section [export] du fichier config.ini s'il est présent sur disque.
        """
        if not self.config_path.is_file():
            self.logger.info("Fichier config.ini absent ('%s'), valeurs par défaut utilisées.", self.config_path)
            return

        self.logger.info("Chargement de la configuration : '%s'", self.config_path)
        self._parser.read(self.config_path, encoding="utf-8")
        if "export" not in self._parser:
            self.logger.warning("Section [export] absente dans '%s'.", self.config_path)
            return

        sec = self._parser["export"]
        self.output_filename = sec.get("output_filename", fallback=self.output_filename)
        self.respect_gitignore = sec.getboolean("respect_gitignore", fallback=self.respect_gitignore)

        if "excluded_dirs" in sec:
            self.excluded_dirs = self._parse_csv(sec["excluded_dirs"])
        if "included_extensions" in sec:
            self.included_extensions = self._normalize_extensions(self._parse_csv(sec["included_extensions"]))
        if "included_exact_names" in sec:
            self.included_exact_names = self._parse_csv(sec["included_exact_names"])
        if "excluded_patterns" in sec:
            self.excluded_patterns = self._parse_csv(sec["excluded_patterns"])

        self.primary_encoding = sec.get("primary_encoding", fallback=self.primary_encoding)
        self.fallback_encoding = sec.get("fallback_encoding", fallback=self.fallback_encoding)
