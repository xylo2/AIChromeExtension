# Commandes pip à exécuter : Aucune dépendance externe requise (bibliothèque standard uniquement)

"""
Point d'entrée de watch_clipboard (synchronisation presse-papiers -> fichiers).

RÈGLES DE GÉNÉRATION (ChromeAI & watch_clipboard) :
1. Balise en 1re ligne à l'intérieur du bloc Markdown :
   - Fichier complet : === FILE: tools/chemin/relatif/fichier.ext ===
   - Fichier découpé : === FILE_PART: tools/chemin/relatif/fichier.ext | 1/N ===
2. Limites anti-troncature : ne jamais dépasser 110 lignes par bloc (viser 70 à 105)
   ni 2 à 3 blocs FILE_PART par réponse. Calculer N avant d'écrire la partie 1/N.
3. Intégrité : code complet sans ellipses (...), zéro note juste sous un bloc,
   chemins relatifs en tools/ uniquement (pas de / initial ni de ..).
4. Pièges d'affichage web : construire dynamiquement les séquences de 3 backticks
   (chr(96) * 3 en Python, String.fromCharCode(96).repeat(3) en JS), concaténer les
   URLs sensibles et éviter les index numériques entre crochets.
"""

import argparse
import os
import sys
from typing import List, Optional
from clipboard_watcher.assembler import FileAssembler
from clipboard_watcher.config import WatcherConfig
from clipboard_watcher.status_server import StatusServer
from clipboard_watcher.watcher import ClipboardWatcher


def _resolve_default_api_token(explicit_token: Optional[str]) -> str:
    if explicit_token is not None:
        return explicit_token.strip()
    env_tok: str = os.environ.get("WATCH_CLIPBOARD_TOKEN", "").strip()
    if env_tok:
        return env_tok
    script_dir: str = os.path.dirname(os.path.abspath(__file__))
    token_file: str = os.path.join(script_dir, ".native_host", "session_token.txt")
    try:
        if os.path.isfile(token_file):
            with open(token_file, "r", encoding="utf-8") as f_tok:
                return f_tok.read().strip()
    except OSError:
        pass
    return ""


class ApplicationRunner:
    """
    Orchestre l'initialisation des composants, le serveur de statut et la surveillance.
    """

    def __init__(
        self,
        target_dir: str,
        config_file: str = "config_watch_clipboard.ini",
        poll_interval: Optional[float] = None,
        port: Optional[int] = None,
        clear_on_startup: Optional[bool] = None,
        api_token: Optional[str] = None,
        allowed_origin: Optional[str] = None,
    ) -> None:
        self.target_dir: str = target_dir
        self.config: WatcherConfig = WatcherConfig(config_path=config_file)
        if poll_interval is not None:
            self.config.poll_interval = poll_interval
        if port is not None:
            self.config.server_port = port
        if clear_on_startup is not None:
            self.config.clear_on_startup = clear_on_startup
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
            tok: str = _resolve_default_api_token(api_token)
            orig: str = (allowed_origin if allowed_origin is not None else os.environ.get("WATCH_CLIPBOARD_ORIGIN", "")).strip()
            self.status_server = StatusServer(
                host=self.config.server_host,
                port=self.config.server_port,
                target_dir=self.target_dir,
                test_runner_path=self.config.test_runner_path,
                api_token=tok,
                allowed_origin=orig,
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
def _parse_cli_args(argv: List[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Surveille le presse-papiers et assemble les fichiers.")
    parser.add_argument("positional_dir", nargs="?", default=None, help="Dossier cible")
    parser.add_argument("--dir", dest="opt_dir", default=None, help="Dossier cible explicite")
    parser.add_argument("--interval", type=float, default=None, help="Intervalle de scrutation en secondes")
    parser.add_argument("--port", type=int, default=None, help="Port HTTP du serveur de statut")
    parser.add_argument("--no-clear", action="store_true", help="Ne pas vider le presse-papiers au démarrage")
    parser.add_argument("--api-token", default=None, help="Jeton d'authentification HTTP")
    parser.add_argument("--allowed-origin", default=None, help="Origine CORS autorisée")
    args, _ = parser.parse_known_args(argv)
    return args


def main() -> None:
    parsed = _parse_cli_args(sys.argv[1:])
    destination: str = parsed.opt_dir or parsed.positional_dir or "."

    script_dir: str = os.path.dirname(os.path.abspath(__file__))
    config_path: str = os.path.join(script_dir, "config_watch_clipboard.ini")

    app: ApplicationRunner = ApplicationRunner(
        target_dir=destination,
        config_file=config_path,
        poll_interval=parsed.interval,
        port=parsed.port,
        clear_on_startup=False if parsed.no_clear else None,
        api_token=parsed.api_token,
        allowed_origin=parsed.allowed_origin,
    )
    app.run()


if __name__ == "__main__":
    main()
