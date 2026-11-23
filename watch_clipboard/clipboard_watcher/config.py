# Commandes pip à exécuter : Aucune dépendance externe requise (bibliothèque standard uniquement)

import configparser
import os
from typing import List


class WatcherConfig:
    """
    Charge et expose de manière typée les paramètres techniques depuis config.ini.
    """

    def __init__(self, config_path: str = "config.ini") -> None:
        """
        Initialise la configuration avec des valeurs par défaut puis charge le fichier INI.

        :param config_path: Chemin vers le fichier de configuration INI.
        """
        self.config_path: str = config_path
        self._parser: configparser.ConfigParser = configparser.ConfigParser()
        self.poll_interval: float = 0.15
        self.clear_on_startup: bool = True
        self.auto_exit_on_browser_close: bool = True
        self.max_parts: int = 50
        self.encoding: str = "utf-8"
        self.temp_dir_name: str = ".watch_clipboard"
        self.strip_lang_tags: List[str] = ["toml", "text", "python", "json", "javascript", "css", "html", "ini"]
        self.server_enabled: bool = True
        self.server_host: str = "127.0.0.1"
        self.server_port: int = 18765
        self.test_runner_path: str = "tools/run_tests_clip.py"
        self._load()

    def _load(self) -> None:
        """
        Lit le fichier config.ini s'il existe et met à jour les attributs de configuration.
        """
        if not os.path.exists(self.config_path):
            return
        self._parser.read(self.config_path, encoding="utf-8")
        self.poll_interval = self._parser.getfloat("watcher", "poll_interval", fallback=self.poll_interval)
        self.clear_on_startup = self._parser.getboolean("watcher", "clear_on_startup", fallback=self.clear_on_startup)
        self.auto_exit_on_browser_close = self._parser.getboolean(
            "watcher",
            "auto_exit_on_browser_close",
            fallback=self.auto_exit_on_browser_close,
        )
        self.max_parts = self._parser.getint("assembler", "max_parts", fallback=self.max_parts)
        self.encoding = self._parser.get("assembler", "encoding", fallback=self.encoding)
        self.temp_dir_name = self._parser.get("assembler", "temp_dir_name", fallback=self.temp_dir_name)
        raw_tags: str = self._parser.get(
            "assembler",
            "strip_lang_tags",
            fallback="toml, text, python, json, javascript, css, html, ini",
        )
        self.strip_lang_tags = [tag.strip() for tag in raw_tags.split(",") if tag.strip()]
        self.server_enabled = self._parser.getboolean("server", "enabled", fallback=self.server_enabled)
        self.server_host = self._parser.get("server", "host", fallback=self.server_host)
        self.server_port = self._parser.getint("server", "port", fallback=self.server_port)
        raw_runner: str = self._parser.get("server", "test_runner_path", fallback=self.test_runner_path).strip()
        if raw_runner:
            self.test_runner_path = raw_runner
