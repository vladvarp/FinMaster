"""Тихий вход: заставка, проверка библиотек, затем окно программы."""

from __future__ import annotations

import os
import sys

ROOT = os.path.dirname(os.path.abspath(__file__))
if ROOT not in sys.path:
    sys.path.insert(0, ROOT)


def start() -> int:
    from backend.splash import ensure_packages, hide_console, Splash

    hide_console()
    splash = Splash(os.path.join(ROOT, "frontend", "favicon.png"))
    try:
        splash.step("Запуск FinMaster…", 5)
        ensure_packages(splash, os.path.join(ROOT, "requirements.txt"))
        splash.step("Загрузка программы…", 34)
        import app

        app.main(splash)
        return 0
    except Exception as exc:
        splash.fail(str(exc))
        return 1


if __name__ == "__main__":
    sys.exit(start())
