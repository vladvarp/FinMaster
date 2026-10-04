"""Точка входа FinMaster.exe: без консоли ставит среду в папку и запускает run.vbs."""

from __future__ import annotations

import os
import queue
import subprocess
import sys
import threading
import time


def project_root() -> str:
    if getattr(sys, "frozen", False):
        return os.path.dirname(os.path.abspath(sys.executable))
    return os.path.dirname(os.path.abspath(__file__))


ROOT = project_root()
if ROOT not in sys.path:
    sys.path.insert(0, ROOT)

from backend.runtime import folder_pythonw, install_blocking, missing_packages, program_pythonw  # noqa: E402
from backend.splash import Splash, hide_console, install_caption  # noqa: E402


def _tell(text: str) -> None:
    if sys.platform != "win32":
        return
    try:
        import ctypes

        ctypes.windll.user32.MessageBoxW(None, str(text)[:800], "FinMaster", 0x10)
    except Exception:
        pass


def _child_env() -> dict[str, str]:
    """Не отдавать дочернему Python пути Tcl из сборки exe — из-за них системный Python не стартует."""
    env = os.environ.copy()
    meipass = getattr(sys, "_MEIPASS", "")
    drop = [key for key in ("TCL_LIBRARY", "TK_LIBRARY", "PYTHONHOME", "PYTHONPATH") if key in env]
    if meipass:
        drop.extend(key for key, value in env.items() if meipass in str(value) and key not in drop)
    for key in drop:
        env.pop(key, None)
    return env


def launch_app() -> None:
    script = os.path.join(ROOT, "run.vbs")
    if not os.path.isfile(script):
        raise FileNotFoundError("Не найден run.vbs рядом с программой.")
    system = os.environ.get("SystemRoot") or r"C:\Windows"
    host = os.path.join(system, "System32", "wscript.exe")
    if not os.path.isfile(host):
        host = "wscript.exe"
    flags = 0x08000000 if sys.platform == "win32" else 0
    subprocess.Popen(
        [host, "//nologo", script],
        cwd=ROOT,
        env=_child_env(),
        creationflags=flags,
        close_fds=True,
    )


def _pump_until(splash: Splash, worker: threading.Thread) -> None:
    while worker.is_alive():
        splash.pump()
        time.sleep(0.016)


def _follow_install(splash: Splash) -> None:
    box: queue.Queue[str | None] = queue.Queue()
    failed: list[BaseException] = []

    def on_line(line: str) -> None:
        box.put(line)

    def work() -> None:
        try:
            install_blocking(on_line, project_root=ROOT)
        except BaseException as exc:
            failed.append(exc)
        finally:
            box.put(None)

    threading.Thread(target=work, daemon=True).start()
    progress = 16.0
    while True:
        try:
            item = box.get(timeout=0.016)
        except queue.Empty:
            splash.pump()
            continue
        if item is None:
            splash.pump()
            break
        caption = install_caption(item)
        low = caption.lower()
        if "python.org" in low or caption.startswith("Скачиваю Python"):
            progress = max(progress, 24)
        elif caption.startswith("Распаков"):
            progress = max(progress, 40)
        elif "pip" in low:
            progress = max(progress, 48)
        elif caption.startswith(("Скачиваю ", "Загружаю", "Беру из кэша")):
            progress = min(80, progress + 2.2)
        elif caption.startswith(("Записываю", "Собираю")):
            progress = min(92, max(progress, 82))
        elif caption.startswith(("Готово", "Уже установлен")):
            progress = min(94, progress + 1.2)
        else:
            progress = min(88, progress + 0.5)
        splash.step(caption)
        splash.log(item)
        splash.set_progress(progress)
    if failed:
        raise failed[0]


def _needs_install() -> tuple[bool, list[str]]:
    """Своя заставка exe нужна, когда Python ещё не лежит ни рядом с программой, ни в папке отчётов."""
    if program_pythonw(ROOT):
        return False, []
    if not folder_pythonw():
        return True, []
    missing = missing_packages(ROOT)
    return bool(missing), missing


def main() -> int:
    hide_console()
    os.chdir(ROOT)
    try:
        while True:
            install, missing = _needs_install()
            if not install:
                launch_app()
                return 0
            splash = Splash(os.path.join(ROOT, "frontend", "favicon.png"))
            try:
                if missing:
                    splash.step("В файлах программы не хватает: " + ", ".join(missing) + ". Скачиваю…", 14)
                else:
                    splash.step("В папке FinMaster нет Python. Скачиваю 3.12.10 с python.org…", 14)
                _follow_install(splash)
                splash.step("Запускаю программу…", 97)
                launch_app()
                splash.close()
                return 0
            except Exception as exc:
                if not splash.fail(str(exc), retry=True):
                    return 1
    except Exception as exc:
        _tell(str(exc))
        return 1


if __name__ == "__main__":
    sys.exit(main())
