# Commandes pip à exécuter : Aucune dépendance externe requise (bibliothèque standard uniquement)

"""
Package clipboard_watcher : surveillance du presse-papiers et assemblage de fichiers.

Format attendu dans les réponses IA pour une prise en charge automatique :
- `=== FILE: chemin/relatif.ext ===` en 1re ligne à l'intérieur d'un bloc Markdown (```).
- `=== FILE_PART: chemin/relatif.ext | 1/N ===` si le fichier dépasse ~120 lignes.
- Code complet sans raccourcis ni ellipses (chaque fichier cible est écrasé à l'écriture).
"""

from clipboard_watcher.assembler import FileAssembler
from clipboard_watcher.config import WatcherConfig
from clipboard_watcher.status_server import StatusServer
from clipboard_watcher.watcher import ClipboardWatcher

__all__ = ["WatcherConfig", "FileAssembler", "StatusServer", "ClipboardWatcher"]
