# Lanceur global exécutant l'ensemble des suites Python et Node.js du dossier tools.

import os
import sys
from typing import List

TOOLS_DIR: str = os.path.dirname(os.path.abspath(__file__))
WATCH_CLIPBOARD_ROOT: str = os.path.join(TOOLS_DIR, "watch_clipboard")
if WATCH_CLIPBOARD_ROOT not in sys.path:
    sys.path.insert(0, WATCH_CLIPBOARD_ROOT)

from tools.run_tests_clip import ClipboardTestRunner, parse_failed_tests_arg  # noqa: E402


def main() -> int:
    """Analyse les arguments CLI et exécute le lanceur de tests avec couverture."""
    use_clip: bool = "--no-clipboard" not in sys.argv
    report_file: str = ""
    coverage_file: str = ""
    if "--report-file" in sys.argv:
        idx_arg: int = sys.argv.index("--report-file")
        if idx_arg + 1 < len(sys.argv):
            report_file = sys.argv[idx_arg + 1]
    if "--coverage-file" in sys.argv:
        idx_cov: int = sys.argv.index("--coverage-file")
        if idx_cov + 1 < len(sys.argv):
            coverage_file = sys.argv[idx_cov + 1]
    failed_list: List[str] = parse_failed_tests_arg(sys.argv)
    runner = ClipboardTestRunner(project_root=WATCH_CLIPBOARD_ROOT, use_clipboard=use_clip)
    return runner.run(report_file=report_file, coverage_file=coverage_file, failed_tests=failed_list or None)


if __name__ == "__main__":
    sys.exit(main())
