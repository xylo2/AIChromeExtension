# Commandes pip à exécuter : Aucune dépendance externe requise (bibliothèque standard uniquement)

import argparse
import logging
import sys
from pathlib import Path
from typing import Optional
from project_exporter.config import ExporterConfig
from project_exporter.exporter import ProjectExporter


class ExportCliApp:
    """
    Point d'entrée CLI orchestrant les arguments, la configuration et l'exportation.
    """

    def __init__(self) -> None:
        """
        Initialise le parseur d'arguments en ligne de commande.
        """
        self.parser: argparse.ArgumentParser = self._build_parser()

    def _build_parser(self) -> argparse.ArgumentParser:
        """
        Construit et configure les options acceptées par la ligne de commande.

        :return: Instance configurée de ArgumentParser.
        """
        parser = argparse.ArgumentParser(
            description="Exporte les fichiers texte d'un projet dans un fichier unique."
        )
        parser.add_argument("target_dir", nargs="?", default=".", help="Dossier à exporter.")
        parser.add_argument("-o", "--output", default=None, help="Chemin du fichier de sortie.")
        parser.add_argument("-c", "--config", default=None, help="Chemin vers config.ini.")
        parser.add_argument("-i", "--include", action="append", default=[], help="Extensions à inclure.")
        parser.add_argument("-e", "--exclude", action="append", default=[], help="Motifs glob à exclure.")
        parser.add_argument("--no-gitignore", action="store_true", help="Ignore les fichiers .gitignore.")
        parser.add_argument("-v", "--verbose", action="store_true", help="Affiche les traces détaillées.")
        return parser

    def _setup_logger(self, verbose: bool) -> logging.Logger:
        """
        Configure le logger horodaté sur la sortie standard.

        :param verbose: Active le niveau DEBUG si True, sinon INFO.
        :return: Instance de logging.Logger prête à l'emploi.
        """
        logger = logging.getLogger("ProjectExporter")
        logger.setLevel(logging.DEBUG if verbose else logging.INFO)
        if not logger.handlers:
            handler = logging.StreamHandler(sys.stdout)
            handler.setFormatter(logging.Formatter("[%(asctime)s] [%(levelname)s] %(message)s", "%H:%M:%S"))
            logger.addHandler(handler)
        return logger

    def _resolve_config(self, cli_cfg: Optional[str], cwd: Path, target: Path, script: Path) -> Path:
        """
        Détermine l'emplacement du fichier config.ini selon l'ordre de priorité.

        :param cli_cfg: Chemin passé via -c/--config, ou None.
        :param cwd: Répertoire courant d'exécution.
        :param target: Répertoire cible du projet à exporter.
        :param script: Chemin absolu du script exécuté.
        :return: Chemin résolu vers config.ini.
        """
        if cli_cfg:
            return Path(cli_cfg).resolve()
        for candidate in (cwd / "config.ini", target / "config.ini", script.parent / "config.ini"):
            if candidate.is_file():
                return candidate
        return script.parent / "config.ini"

    def run(self) -> None:
        """
        Exécute le flux complet d'analyse des arguments et de génération de l'export.
        """
        args = self.parser.parse_args()
        logger = self._setup_logger(args.verbose)
        cwd, target, script = Path.cwd().resolve(), Path(args.target_dir).resolve(), Path(__file__).resolve()

        if not target.is_dir():
            logger.error("Le dossier cible n'existe pas : %s", target)
            sys.exit(1)

        cfg_path = self._resolve_config(args.config, cwd, target, script)
        config = ExporterConfig(config_path=cfg_path, logger=logger)
        config.apply_cli_overrides(args.include, args.exclude, args.no_gitignore)

        out_name = config.build_output_filename(target.name)
        output_path = Path(args.output).resolve() if args.output else (cwd / out_name)

        logger.info("Répertoire courant (sortie) : %s", cwd)
        logger.info("Dossier cible : %s | Fichier généré : %s", target, output_path)
        ProjectExporter(target, config, output_path, script, logger).export()


if __name__ == "__main__":
    ExportCliApp().run()
