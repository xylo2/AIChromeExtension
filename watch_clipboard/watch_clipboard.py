# Commandes pip à exécuter : Aucune dépendance externe requise (bibliothèque standard uniquement)

"""
Point d'entrée de watch_clipboard (synchronisation automatique presse-papiers -> fichiers).

RÈGLES DE GÉNÉRATION POUR LES ASSISTANTS IA (blocs exploitables par ChromeAI & watch_clipboard) :
1. Balise OBLIGATOIRE en 1re ligne À L'INTÉRIEUR du bloc de code Markdown :
   - Fichier complet : `=== FILE: tools/chemin/relatif/fichier.ext ===`
   - Fichier découpé : `=== FILE_PART: tools/chemin/relatif/fichier.ext | 1/N ===`
2. Limite de longueur : ne jamais dépasser ~120 lignes par bloc de code (sinon l'interface web
   tronque le bloc). Découper systématiquement les fichiers longs en N parties `FILE_PART`.
3. Contenu intégral : toujours fournir le code complet de chaque fichier ou partie, sans ellipses
   (`...` ou `# code inchangé`), car chaque bloc écrit ou réassemble intégralement la cible.
4. Chemins relatifs uniquement : pas de `/` initial ni de traversée `..` (rejetés par sécurité).
5. Pièges d'affichage web :
   - Éviter les triples backticks littéraux dans le code (utiliser `"\x60" * 3` en Python,
     `"\x60\x60\x60"` en JS, ou entourer les blocs Markdown de 4 backticks).
   - Éviter les URLs brutes réécrites (les concaténer) et les index numériques entre crochets
     (`[0]`, `[1]`, supprimés comme citations -> utiliser `.at(1)` ou `next(iter(...))`).
"""

import os
import sys
from typing import Optional
from clipboard_watcher.assembler import FileAssembler
from clipboard_watcher.config import WatcherConfig
from clipboard_watcher.status_server import StatusServer
from clipboard_watcher.watcher import ClipboardWatcher


class ApplicationRunner:
    """
    Orchestre l'initialisation des composants, le serveur de statut et la surveillance.
    """

    def __init__(self, target_dir: str, config_file: str = "config_watch_clipboard.ini") -> None:
        self.target_dir: str = target_dir
        self.config: WatcherConfig = WatcherConfig(config_path=config_file)
        self.assembler: FileAssembler = FileAssembler(
            base_dir=self.target_dir,
            config=self.config,
        )
        self.watcher: ClipboardWatcher = ClipboardWatcher(
            base_dir=self.target_dir,
            assembler=self.assembler,
            config=self.config,
        )
        self.status_server: Optional[StatusServer] = None
        if self.config.server_enabled:
            api_token: str = os.environ.get("WATCH_CLIPBOARD_TOKEN", "").strip()
            allowed_origin: str = os.environ.get("WATCH_CLIPBOARD_ORIGIN", "").strip()
            self.status_server = StatusServer(
                host=self.config.server_host,
                port=self.config.server_port,
                target_dir=self.target_dir,
                test_runner_path=self.config.test_runner_path,
                api_token=api_token,
                allowed_origin=allowed_origin,
                assembler=self.assembler,
            )

    def run(self) -> None:
        if self.status_server is not None:
            self.status_server.start()
        try:
            self.watcher.start()
        finally:
            if self.status_server is not None:
                self.status_server.stop()


def main() -> None:
    args_iter = iter(sys.argv)
    next(args_iter, None)
    destination: str = next(args_iter, ".")

    script_dir: str = os.path.dirname(os.path.abspath(__file__))
    config_path: str = os.path.join(script_dir, "config_watch_clipboard.ini")

    app: ApplicationRunner = ApplicationRunner(target_dir=destination, config_file=config_path)
    app.run()


if __name__ == "__main__":
    main()
