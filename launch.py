"""Тихий вход: заставка, проверка библиотек, затем окно программы."""

from __future__ import annotations

import os
import sys

ROOT = os.path.dirname(os.path.abspath(__file__))
if ROOT not in sys.path:
    sys.path.insert(0, ROOT)


def _hide_console_early() -> None:
    """Скрыть консоль до импорта Tk — если вдруг стартовали через python.exe."""
    if sys.platform != "win32" or os.environ.get("FINMASTER_CONSOLE") == "1":
        return
    try:
        import ctypes

        hwnd = ctypes.windll.kernel32.GetConsoleWindow()
        if hwnd:
            ctypes.windll.user32.ShowWindow(hwnd, 0)
    except Exception:
        pass


def start() -> int:
    _hide_console_early()
    from backend.instance import claim_or_handoff, requested_report

    if claim_or_handoff(requested_report()):
        return 0
    from backend.splash import ensure_packages, hide_console, Splash

    hide_console()
    splash = Splash(os.path.join(ROOT, "frontend", "favicon.png"))
    try:
        splash.step("Запуск FinMaster…", 6)
        ensure_packages(splash, os.path.join(ROOT, "requirements.txt"))
        splash.step("Загрузка программы…", 36)
        import app

        app.main(splash)
        return 0
    except Exception as exc:
        splash.fail(str(exc))
        return 1


if __name__ == "__main__":
    sys.exit(start())
