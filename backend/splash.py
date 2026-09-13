"""Заставка запуска: прогресс и журнал вместо окна консоли."""

from __future__ import annotations

import os
import subprocess
import sys
import tkinter as tk
from tkinter import ttk
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


class Splash:
    W = 580
    H = 368

    def __init__(self, icon_png: str = "") -> None:
        self._closed = False
        self.lines: list[str] = []
        if sys.platform == "win32":
            try:
                import ctypes

                ctypes.windll.shcore.SetProcessDpiAwareness(1)
            except Exception:
                pass
        self.root = tk.Tk()
        self.root.title("FinMaster")
        self.root.overrideredirect(True)
        self.root.configure(bg="#0b1220")
        try:
            self.root.attributes("-topmost", True)
        except tk.TclError:
            pass
        self.root.geometry(self._centered())
        self._photo = None
        self._build(icon_png)
        self.pump()

    def _centered(self) -> str:
        self.root.update_idletasks()
        sw = self.root.winfo_screenwidth()
        sh = self.root.winfo_screenheight()
        x = max(0, (sw - self.W) // 2)
        y = max(0, (sh - self.H) // 3)
        return f"{self.W}x{self.H}+{x}+{y}"

    def _build(self, icon_png: str) -> None:
        canvas = tk.Canvas(self.root, width=self.W, height=self.H, highlightthickness=0, bd=0)
        canvas.pack(fill="both", expand=True)
        for i in range(self.H):
            t = i / max(self.H - 1, 1)
            r = int(11 + (18 - 11) * t)
            g = int(18 + (38 - 18) * t)
            b = int(32 + (58 - 32) * t)
            canvas.create_line(0, i, self.W, i, fill=f"#{r:02x}{g:02x}{b:02x}")
        canvas.create_rectangle(0, 0, self.W, 4, fill="#14b8a6", outline="")
        canvas.create_rectangle(0, self.H - 3, self.W, self.H, fill="#c9a227", outline="")

        if icon_png and os.path.exists(icon_png):
            try:
                img = tk.PhotoImage(file=icon_png)
                w = max(img.width(), 1)
                factor = max(1, w // 64)
                if factor > 1:
                    img = img.subsample(factor, factor)
                self._photo = img
                canvas.create_image(36, 36, image=img, anchor="nw")
            except tk.TclError:
                self._draw_mark(canvas)
        else:
            self._draw_mark(canvas)

        canvas.create_text(116, 48, text="FinMaster", fill="#f8fafc", font=("Segoe UI Semibold", 22), anchor="w")
        canvas.create_text(116, 80, text="Бухгалтерский учёт заказов", fill="#94a3b8", font=("Segoe UI", 11), anchor="w")

        self.status = tk.StringVar(value="Запуск…")
        tk.Label(
            self.root,
            textvariable=self.status,
            bg="#12263a",
            fg="#e2e8f0",
            font=("Segoe UI", 10),
            anchor="w",
        ).place(x=28, y=118, width=524, height=22)

        style = ttk.Style(self.root)
        try:
            style.theme_use("clam")
        except tk.TclError:
            pass
        style.configure(
            "FM.Horizontal.TProgressbar",
            troughcolor="#1b2538",
            background="#14b8a6",
            bordercolor="#12263a",
            lightcolor="#14b8a6",
            darkcolor="#0f766e",
            thickness=8,
        )
        self.bar = ttk.Progressbar(self.root, style="FM.Horizontal.TProgressbar", maximum=100, mode="determinate")
        self.bar.place(x=28, y=146, width=524, height=10)

        self.log_var = tk.StringVar(value="")
        tk.Label(
            self.root,
            textvariable=self.log_var,
            bg="#0d1726",
            fg="#7c8ba1",
            font=("Consolas", 9),
            anchor="nw",
            justify="left",
            padx=10,
            pady=8,
        ).place(x=28, y=172, width=524, height=148)

        tk.Label(
            self.root,
            text="локальная программа · без облака",
            bg="#12263a",
            fg="#64748b",
            font=("Segoe UI", 8),
            anchor="e",
        ).place(x=28, y=332, width=524, height=18)

        self._canvas = canvas

    def _draw_mark(self, canvas: tk.Canvas) -> None:
        canvas.create_rectangle(36, 36, 100, 100, fill="#0f766e", outline="")
        canvas.create_rectangle(50, 52, 86, 57, fill="#eafaf7", outline="")
        canvas.create_rectangle(50, 64, 86, 69, fill="#eafaf7", outline="")
        canvas.create_rectangle(50, 76, 74, 81, fill="#eafaf7", outline="")

    def set_progress(self, value: float) -> None:
        if self._closed:
            return
        self.bar["value"] = max(0, min(100, value))
        self.pump()

    def log(self, text: str) -> None:
        if self._closed or not text:
            return
        line = " ".join(str(text).split())
        if len(line) > 92:
            line = line[:91] + "…"
        self.lines.append(line)
        self.lines = self.lines[-8:]
        self.log_var.set("\n".join(self.lines))
        self.pump()

    def step(self, text: str, progress: float | None = None) -> None:
        self.status.set(text)
        self.log(text)
        if progress is not None:
            self.set_progress(progress)
        else:
            self.pump()

    def fail(self, text: str) -> None:
        self.status.set("Ошибка запуска")
        self.log(text)
        self.set_progress(100)
        if self._closed:
            return
        btn = tk.Button(
            self.root,
            text="Закрыть",
            command=self.close,
            bg="#0f766e",
            fg="#ffffff",
            activebackground="#14b8a6",
            activeforeground="#ffffff",
            relief="flat",
            font=("Segoe UI Semibold", 10),
            cursor="hand2",
        )
        btn.place(x=230, y=328, width=120, height=28)
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
