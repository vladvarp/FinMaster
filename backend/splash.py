"""Заставка запуска: прогресс и журнал вместо окна консоли."""

from __future__ import annotations

import os
import subprocess
import sys
import tkinter as tk
from typing import Callable


CREATE_NO_WINDOW = 0x08000000


def hide_console() -> None:
    if sys.platform != "win32" or os.environ.get("FINMASTER_CONSOLE") == "1":
        return
    try:
        import ctypes

        hwnd = ctypes.windll.kernel32.GetConsoleWindow()
        if hwnd:
            ctypes.windll.user32.ShowWindow(hwnd, 0)
    except Exception:
        pass


def _python_for_pip() -> str:
    exe = sys.executable
    if exe.lower().endswith("pythonw.exe"):
        alt = exe[: -len("pythonw.exe")] + "python.exe"
        if os.path.exists(alt):
            return alt
    return exe


def ensure_packages(splash: "Splash", requirements: str) -> None:
    missing: list[str] = []
    for module, package in (("flask", "flask"), ("webview", "pywebview"), ("PIL", "pillow")):
        try:
            __import__(module)
        except ImportError:
            missing.append(package)
    if not missing:
        splash.step("Библиотеки на месте", 24)
        return

    splash.step("Устанавливаю " + ", ".join(missing) + "…", 16)
    cmd = [_python_for_pip(), "-m", "pip", "install", "-r", requirements]
    kwargs: dict = {
        "stdout": subprocess.PIPE,
        "stderr": subprocess.STDOUT,
        "text": True,
        "bufsize": 1,
    }
    if sys.platform == "win32":
        kwargs["creationflags"] = CREATE_NO_WINDOW
    proc = subprocess.Popen(cmd, **kwargs)
    assert proc.stdout is not None
    seen = 0
    for raw in proc.stdout:
        line = raw.strip()
        if not line:
            continue
        seen += 1
        splash.log(line)
        splash.set_progress(min(16 + seen, 30))
    code = proc.wait()
    if code != 0:
        raise RuntimeError("Не удалось установить библиотеки. Проверьте интернет и Python.")
    splash.step("Библиотеки установлены", 32)


def _round_rect(canvas: tk.Canvas, x1: float, y1: float, x2: float, y2: float, r: float, **kwargs) -> int:
    r = max(0, min(r, (x2 - x1) / 2, (y2 - y1) / 2))
    pts = [
        x1 + r, y1, x2 - r, y1, x2, y1, x2, y1 + r,
        x2, y2 - r, x2, y2, x2 - r, y2, x1 + r, y2,
        x1, y2, x1, y2 - r, x1, y1 + r, x1, y1,
    ]
    return canvas.create_polygon(pts, smooth=True, splinesteps=24, **kwargs)


class Splash:
    W = 500
    H = 300

    def __init__(self, icon_png: str = "") -> None:
        self._closed = False
        self.lines: list[str] = []
        self._progress = 0.0
        if sys.platform == "win32":
            try:
                import ctypes

                ctypes.windll.shcore.SetProcessDpiAwareness(1)
            except Exception:
                pass
        self.root = tk.Tk()
        self.root.title("FinMaster")
        self.root.overrideredirect(True)
        self.root.configure(bg="#070b14")
        try:
            self.root.attributes("-topmost", True)
        except tk.TclError:
            pass
        self.root.geometry(self._centered())
        self._build()
        self.pump()

    def _centered(self) -> str:
        self.root.update_idletasks()
        sw = self.root.winfo_screenwidth()
        sh = self.root.winfo_screenheight()
        x = max(0, (sw - self.W) // 2)
        y = max(0, (sh - self.H) // 3)
        return f"{self.W}x{self.H}+{x}+{y}"

    def _build(self) -> None:
        c = tk.Canvas(self.root, width=self.W, height=self.H, highlightthickness=0, bd=0, bg="#070b14")
        c.pack(fill="both", expand=True)
        self._canvas = c

        c.create_oval(-80, -90, 220, 160, fill="#0d1a22", outline="")
        c.create_oval(300, 140, 620, 420, fill="#12100c", outline="")
        c.create_oval(360, -70, 560, 110, fill="#14241f", outline="")

        _round_rect(c, 18, 18, self.W - 18, self.H - 18, 22, fill="#101826", outline="")
        c.create_line(48, 20, self.W - 48, 20, fill="#14b8a6", width=2)

        self._draw_mark(c, 48, 52)

        c.create_text(118, 68, text="FinMaster", fill="#f8fafc", font=("Segoe UI", 26, "bold"), anchor="w")
        c.create_text(
            118,
            102,
            text="Бухгалтерский учёт заказов",
            fill="#8b9cb3",
            font=("Segoe UI", 11),
            anchor="w",
        )

        self._status_id = c.create_text(
            48,
            168,
            text="Запуск…",
            fill="#e2e8f0",
            font=("Segoe UI", 11),
            anchor="w",
        )
        self._log_id = c.create_text(
            48,
            220,
            text="",
            fill="#5b6b82",
            font=("Segoe UI", 9),
            anchor="w",
        )
        self._foot_id = c.create_text(
            self.W - 48,
            self.H - 42,
            text="локально · без облака",
            fill="#4b5a70",
            font=("Segoe UI", 9),
            anchor="e",
        )

        self._bar = (48, 188, self.W - 48, 198)
        x1, y1, x2, y2 = self._bar
        _round_rect(c, x1, y1, x2, y2, 5, fill="#1b2538", outline="")
        self._bar_fill = _round_rect(c, x1, y1, x1, y2, 5, fill="#14b8a6", outline="")
        self._draw_bar(0)

    def _draw_mark(self, canvas: tk.Canvas, x: int, y: int) -> None:
        size = 54
        _round_rect(canvas, x, y, x + size, y + size, 15, fill="#0f766e", outline="")
        pad = 12
        bar_h = 5
        gap = 8
        canvas.create_rectangle(x + pad, y + 15, x + size - pad, y + 15 + bar_h, fill="#eafaf7", outline="")
        canvas.create_rectangle(x + pad, y + 15 + bar_h + gap, x + size - pad, y + 15 + 2 * bar_h + gap, fill="#99f6e4", outline="")
        canvas.create_rectangle(
            x + pad,
            y + 15 + 2 * (bar_h + gap),
            x + size - pad - 12,
            y + 15 + 3 * bar_h + 2 * gap,
            fill="#eafaf7",
            outline="",
        )

    def _draw_bar(self, value: float) -> None:
        x1, y1, x2, y2 = self._bar
        t = max(0.0, min(1.0, value / 100))
        right = x1 + max(0, (x2 - x1) * t)
        r = 5 if right - x1 > 12 else max(0, (right - x1) / 2)
        self._canvas.delete(self._bar_fill)
        if right <= x1:
            self._bar_fill = self._canvas.create_rectangle(x1, y1, x1, y2, outline="")
            return
        self._bar_fill = _round_rect(self._canvas, x1, y1, right, y2, r, fill="#14b8a6", outline="")
        self._canvas.tag_raise(self._bar_fill)

    def set_progress(self, value: float) -> None:
        if self._closed:
            return
        self._progress = max(0, min(100, value))
        self._draw_bar(self._progress)
        self.pump()

    def log(self, text: str) -> None:
        if self._closed or not text:
            return
        line = " ".join(str(text).split())
        if len(line) > 72:
            line = line[:71] + "…"
        self.lines.append(line)
        self.lines = self.lines[-4:]
        self._canvas.itemconfigure(self._log_id, text=line)
        self.pump()

    def step(self, text: str, progress: float | None = None) -> None:
        if self._closed:
            return
        self._canvas.itemconfigure(self._status_id, text=text, fill="#e2e8f0")
        if progress is not None:
            self.set_progress(progress)
        else:
            self.pump()

    def fail(self, text: str) -> None:
        self._canvas.itemconfigure(self._status_id, text="Не удалось запустить", fill="#fca5a5")
        self._canvas.itemconfigure(self._foot_id, text="")
        self.log(text)
        self.set_progress(100)
        if self._closed:
            return
        x1, y1, x2, y2 = 190, 238, 310, 270
        btn = _round_rect(self._canvas, x1, y1, x2, y2, 10, fill="#0f766e", outline="")
        label = self._canvas.create_text((x1 + x2) / 2, (y1 + y2) / 2, text="Закрыть", fill="#ffffff", font=("Segoe UI", 10, "bold"))

        def _hover(_e, color: str) -> None:
            self._canvas.itemconfigure(btn, fill=color)

        for item in (btn, label):
            self._canvas.tag_bind(item, "<Button-1>", lambda _e: self.close())
            self._canvas.tag_bind(item, "<Enter>", lambda e: _hover(e, "#14b8a6"))
            self._canvas.tag_bind(item, "<Leave>", lambda e: _hover(e, "#0f766e"))
        try:
            self.root.mainloop()
        except tk.TclError:
            pass

    def pump(self) -> None:
        if self._closed:
            return
        try:
            self.root.update_idletasks()
            self.root.update()
        except tk.TclError:
            self._closed = True

    def close(self) -> None:
        if self._closed:
            return
        self._closed = True
        try:
            self.root.destroy()
        except tk.TclError:
            pass


def with_splash(run: Callable[["Splash"], None], icon_png: str = "", requirements: str = "") -> int:
    hide_console()
    splash = Splash(icon_png)
    try:
        splash.step("Запуск FinMaster…", 4)
        if requirements:
            ensure_packages(splash, requirements)
        run(splash)
        return 0
    except Exception as exc:
        splash.fail(str(exc))
        return 1
