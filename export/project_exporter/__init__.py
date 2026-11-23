# Commandes pip à exécuter : Aucune dépendance externe requise (bibliothèque standard uniquement)

"""
Package project_exporter regroupant la configuration, le filtrage Gitignore
et l'exportation consolidée d'arborescences de projets.
"""

from project_exporter.config import ExporterConfig
from project_exporter.exporter import ProjectExporter
from project_exporter.gitignore import GitignoreManager, GitignoreRule

__all__ = ["ExporterConfig", "GitignoreRule", "GitignoreManager", "ProjectExporter"]
