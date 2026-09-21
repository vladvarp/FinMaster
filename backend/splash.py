"""Заставка запуска: анимированный tech-экран вместо окна консоли."""

from __future__ import annotations

import math
import os
import random
import subprocess
import sys
import time
import tkinter as tk
from typing import Any, Callable


CREATE_NO_WINDOW = 0x08000000

# Палитра FinMaster
BG = "#05070f"
PANEL = "#0a101c"
PANEL_EDGE = "#152033"
TEAL = "#14b8a6"
TEAL_DIM = "#0f766e"
TEAL_GLOW = "#2dd4bf"
CYAN = "#22d3ee"
INK = "#f1f5f9"
MUTED = "#64748b"
MUTED_2 = "#94a3b8"
DANGER = "#f87171"
GRID = "#10182a"
STAR = "#1e293b"


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


def _round_rect(canvas: tk.Canvas, x1: float, y1: float, x2: float, y2: float, r: float, **kwargs: Any) -> int:
    r = max(0.0, min(r, (x2 - x1) / 2, (y2 - y1) / 2))
    pts = [
        x1 + r, y1, x2 - r, y1, x2, y1, x2, y1 + r,
        x2, y2 - r, x2, y2, x2 - r, y2, x1 + r, y2,
        x1, y2, x1, y2 - r, x1, y1 + r, x1, y1,
    ]
    return canvas.create_polygon(pts, smooth=True, splinesteps=36, **kwargs)


def _lerp(a: float, b: float, t: float) -> float:
    return a + (b - a) * t


class Splash:
    W = 680
    H = 420

    def __init__(self, icon_png: str = "") -> None:
        self._closed = False
        self.lines: list[str] = []
        self._progress = 0.0
        self._display = 0.0
        self._anim_t = 0.0
        self._last_tick = time.perf_counter()
        self._failed = False
        self._icon_png = icon_png
        self._photo: tk.PhotoImage | None = None
        self._particles: list[dict[str, float]] = []
        self._ring_ids: list[int] = []
        self._orbit_ids: list[int] = []
        self._shimmer_id = 0
        self._pct_id = 0
        self._pulse_id = 0
        self._grid_ids: list[int] = []
        self._scan_id = 0

        if sys.platform == "win32":
            try:
                import ctypes

                ctypes.windll.shcore.SetProcessDpiAwareness(1)
            except Exception:
                pass

        self.root = tk.Tk()
        self.root.title("FinMaster")
        self.root.overrideredirect(True)
        self.root.configure(bg=BG)
        try:
            self.root.attributes("-topmost", True)
        except tk.TclError:
            pass
        try:
            # Лёгкая прозрачность окна на Windows (если поддерживается)
            self.root.attributes("-alpha", 0.985)
        except tk.TclError:
            pass
        self.root.geometry(self._centered())
        self._build()
        self._seed_particles()
        self.pump()
        self._schedule_tick()

    def _centered(self) -> str:
        self.root.update_idletasks()
        sw = self.root.winfo_screenwidth()
        sh = self.root.winfo_screenheight()
        x = max(0, (sw - self.W) // 2)
        y = max(0, (sh - self.H) // 3)
        return f"{self.W}x{self.H}+{x}+{y}"

    def _seed_particles(self) -> None:
        rnd = random.Random(42)
        self._particles = []
        for _ in range(48):
            self._particles.append(
                {
                    "x": rnd.uniform(24, self.W - 24),
                    "y": rnd.uniform(24, self.H - 24),
                    "r": rnd.uniform(0.8, 2.4),
                    "vx": rnd.uniform(-12, 12),
                    "vy": rnd.uniform(-8, 8),
                    "phase": rnd.uniform(0, math.tau),
                    "id": 0,
                }
            )

    def _build(self) -> None:
        c = tk.Canvas(self.root, width=self.W, height=self.H, highlightthickness=0, bd=0, bg=BG)
        c.pack(fill="both", expand=True)
        self._canvas = c

        # Глубинный фон — мягкие световые пятна
        c.create_oval(-160, -180, 280, 220, fill="#07131a", outline="")
        c.create_oval(380, 180, 860, 560, fill="#0a0c18", outline="")
        c.create_oval(420, -120, 760, 140, fill="#0b1c1a", outline="")
        c.create_oval(120, 260, 360, 520, fill="#080f1c", outline="")

        # Техно-сетка
        for x in range(40, self.W, 28):
            self._grid_ids.append(c.create_line(x, 28, x, self.H - 28, fill=GRID, width=1))
        for y in range(40, self.H, 28):
            self._grid_ids.append(c.create_line(28, y, self.W - 28, y, fill=GRID, width=1))

        # Внешняя рамка с уголками
        pad = 16
        _round_rect(c, pad, pad, self.W - pad, self.H - pad, 26, fill=PANEL, outline="")
        self._draw_corners(c, pad + 10, pad + 10, self.W - pad - 10, self.H - pad - 10)

        # Верхняя accent-линия
        c.create_line(56, pad + 2, self.W - 56, pad + 2, fill=TEAL, width=2)
        c.create_line(56, pad + 5, 180, pad + 5, fill=TEAL_GLOW, width=1)

        # Скан-линия (анимируется)
        self._scan_id = c.create_line(40, 80, self.W - 40, 80, fill="#0f766e", width=1)

        # Логотип / орбиты
        cx, cy = 88, 96
        self._logo_cx, self._logo_cy = cx, cy
        for i, rad in enumerate((46, 58, 70)):
            ring = c.create_oval(cx - rad, cy - rad, cx + rad, cy + rad, outline=TEAL_DIM if i else TEAL, width=1)
            self._ring_ids.append(ring)
        # Орбитальные точки
        for _ in range(3):
            self._orbit_ids.append(c.create_oval(0, 0, 6, 6, fill=CYAN, outline=""))

        if not self._try_draw_icon(c, cx, cy):
            self._draw_mark(c, cx - 27, cy - 27)

        # Бренд
        c.create_text(150, 78, text="FinMaster", fill=INK, font=("Segoe UI Semibold", 32, "bold"), anchor="w")
        c.create_text(
            152,
            118,
            text="FINANCE  ·  ORDERS  ·  SYSTEMS",
            fill=MUTED,
            font=("Segoe UI", 9),
            anchor="w",
        )
        c.create_text(
            152,
            138,
            text="локальный контур учёта",
            fill=MUTED_2,
            font=("Segoe UI", 11),
            anchor="w",
        )

        # Статус
        self._status_id = c.create_text(48, 214, text="Инициализация ядра…", fill=INK, font=("Segoe UI", 12), anchor="w")
        self._pulse_id = c.create_oval(self.W - 64, 208, self.W - 52, 220, fill=TEAL, outline="")

        # Прогресс-трек
        self._bar = (48.0, 242.0, float(self.W - 48), 254.0)
        x1, y1, x2, y2 = self._bar
        _round_rect(c, x1 - 1, y1 - 1, x2 + 1, y2 + 1, 7, fill="#0c1524", outline="")
        _round_rect(c, x1, y1, x2, y2, 6, fill="#152033", outline="")
        self._bar_fill = _round_rect(c, x1, y1, x1, y2, 6, fill=TEAL, outline="")
        self._shimmer_id = c.create_rectangle(x1, y1, x1, y2, fill=TEAL_GLOW, outline="")
        self._pct_id = c.create_text(self.W - 48, 228, text="0%", fill=TEAL_GLOW, font=("Segoe UI", 10, "bold"), anchor="e")

        # Журнал
        self._log_id = c.create_text(
            48,
            292,
            text="ожидание модулей",
            fill=MUTED,
            font=("Consolas", 9),
            anchor="w",
        )

        # Низ
        c.create_text(48, self.H - 40, text="SECURE  ·  OFFLINE-FIRST", fill="#3d4f66", font=("Segoe UI", 8), anchor="w")
        self._foot_id = c.create_text(
            self.W - 48,
            self.H - 40,
            text="без облака · данные у вас",
            fill="#3d4f66",
            font=("Segoe UI", 9),
            anchor="e",
        )

        # Частицы поверх
        for p in self._particles:
            p["id"] = c.create_oval(0, 0, 2, 2, fill=STAR, outline="")

        self._draw_bar(0)

    def _draw_corners(self, c: tk.Canvas, x1: float, y1: float, x2: float, y2: float) -> None:
        L = 18
        color = TEAL_DIM
        # TL
        c.create_line(x1, y1 + L, x1, y1, x1 + L, y1, fill=color, width=2)
        # TR
        c.create_line(x2 - L, y1, x2, y1, x2, y1 + L, fill=color, width=2)
        # BL
        c.create_line(x1, y2 - L, x1, y2, x1 + L, y2, fill=color, width=2)
        # BR
        c.create_line(x2 - L, y2, x2, y2, x2, y2 - L, fill=color, width=2)
        # Точки на углах
        for x, y in ((x1, y1), (x2, y1), (x1, y2), (x2, y2)):
            c.create_oval(x - 2, y - 2, x + 2, y + 2, fill=TEAL, outline="")

    def _try_draw_icon(self, canvas: tk.Canvas, cx: float, cy: float) -> bool:
        path = self._icon_png
        if not path or not os.path.isfile(path):
            return False
        try:
            img = tk.PhotoImage(file=path)
            # Подгоняем к ~48px через subsample / zoom
            w, h = img.width(), img.height()
            target = 48
            if w > target * 2 and h > target * 2:
                factor = max(1, min(w, h) // target)
                img = img.subsample(factor, factor)
            elif w < target and h < target and w > 0:
                factor = max(1, target // max(w, h))
                img = img.zoom(factor, factor)
            self._photo = img
            canvas.create_oval(cx - 34, cy - 34, cx + 34, cy + 34, fill="#0b2a28", outline="")
            canvas.create_image(cx, cy, image=img)
            return True
        except Exception:
            self._photo = None
            return False

    def _draw_mark(self, canvas: tk.Canvas, x: float, y: float) -> None:
        size = 54
        # Свечение под знаком
        canvas.create_oval(x - 8, y - 8, x + size + 8, y + size + 8, fill="#0b2a28", outline="")
        _round_rect(canvas, x, y, x + size, y + size, 16, fill=TEAL_DIM, outline="")
        _round_rect(canvas, x + 2, y + 2, x + size - 2, y + size - 2, 14, fill="#0d9488", outline="")
        pad = 12
        bar_h = 5
        gap = 7
        canvas.create_rectangle(x + pad, y + 14, x + size - pad, y + 14 + bar_h, fill="#ecfeff", outline="")
        canvas.create_rectangle(
            x + pad, y + 14 + bar_h + gap, x + size - pad, y + 14 + 2 * bar_h + gap, fill="#99f6e4", outline=""
        )
        canvas.create_rectangle(
            x + pad,
            y + 14 + 2 * (bar_h + gap),
            x + size - pad - 10,
            y + 14 + 3 * bar_h + 2 * gap,
            fill="#ecfeff",
            outline="",
        )

    def _draw_bar(self, value: float) -> None:
        x1, y1, x2, y2 = self._bar
        t = max(0.0, min(1.0, value / 100.0))
        right = x1 + max(0.0, (x2 - x1) * t)
        self._canvas.delete(self._bar_fill)
        if right <= x1 + 0.5:
            self._bar_fill = self._canvas.create_rectangle(x1, y1, x1, y2, outline="")
        else:
            r = 6 if right - x1 > 14 else max(0.0, (right - x1) / 2)
            self._bar_fill = _round_rect(self._canvas, x1, y1, right, y2, r, fill=TEAL, outline="")
        self._canvas.tag_raise(self._bar_fill)
        if self._shimmer_id:
            self._canvas.tag_raise(self._shimmer_id)
        self._canvas.itemconfigure(self._pct_id, text=f"{int(round(t * 100))}%")

    def _schedule_tick(self) -> None:
        if self._closed:
            return
        try:
            self.root.after(16, self._tick)
        except tk.TclError:
            self._closed = True

    def _tick(self) -> None:
        if self._closed:
            return
        now = time.perf_counter()
        dt = min(0.05, max(0.001, now - self._last_tick))
        self._last_tick = now
        self._anim_t += dt
        t = self._anim_t
        c = self._canvas

        # Плавный прогресс
        self._display = _lerp(self._display, self._progress, min(1.0, dt * 6.5))
        if abs(self._display - self._progress) > 0.05 or self._progress >= 99.5:
            self._draw_bar(self._display)

        # Скан-линия
        scan_y = 40 + ((t * 55) % (self.H - 80))
        try:
            c.coords(self._scan_id, 36, scan_y, self.W - 36, scan_y)
            alpha_proxy = 0.25 + 0.25 * math.sin(t * 3)
            # Tk не умеет alpha у линий — мигаем цветом
            c.itemconfigure(self._scan_id, fill="#0f766e" if alpha_proxy > 0.3 else "#0a3d38")
        except tk.TclError:
            pass

        # Орбитальные точки вокруг логотипа
        cx, cy = self._logo_cx, self._logo_cy
        for i, oid in enumerate(self._orbit_ids):
            ang = t * (1.1 + i * 0.35) + i * 2.1
            rad = 46 + i * 12
            x = cx + math.cos(ang) * rad
            y = cy + math.sin(ang) * rad * 0.72
            try:
                c.coords(oid, x - 3, y - 3, x + 3, y + 3)
                c.itemconfigure(oid, fill=CYAN if i % 2 == 0 else TEAL_GLOW)
            except tk.TclError:
                pass

        # Пульс колец
        for i, rid in enumerate(self._ring_ids):
            pulse = 0.5 + 0.5 * math.sin(t * 2.2 + i)
            try:
                c.itemconfigure(rid, outline=TEAL_GLOW if pulse > 0.65 else TEAL_DIM)
            except tk.TclError:
                pass

        # Пульс индикатора статуса
        try:
            pr = 5 + 2 * (0.5 + 0.5 * math.sin(t * 4))
            c.coords(self._pulse_id, self.W - 58 - pr, 214 - pr, self.W - 58 + pr, 214 + pr)
            c.itemconfigure(self._pulse_id, fill=TEAL_GLOW if not self._failed else DANGER)
        except tk.TclError:
            pass

        # Частицы
        for p in self._particles:
            p["x"] = (p["x"] + p["vx"] * dt) % (self.W - 48) + 24
            p["y"] = (p["y"] + p["vy"] * dt) % (self.H - 48) + 24
            tw = 0.45 + 0.55 * (0.5 + 0.5 * math.sin(t * 2.5 + p["phase"]))
            r = p["r"] * tw
            try:
                c.coords(p["id"], p["x"] - r, p["y"] - r, p["x"] + r, p["y"] + r)
                c.itemconfigure(p["id"], fill=TEAL_GLOW if tw > 0.85 else STAR)
            except tk.TclError:
                pass

        # Блик на прогресс-баре
        x1, y1, x2, y2 = self._bar
        span = x2 - x1
        fill_w = span * (self._display / 100.0)
        if fill_w > 8:
            sh = 18
            sx = x1 + ((t * 90) % max(1.0, fill_w + sh)) - sh
            left = max(x1, sx)
            right = min(x1 + fill_w, sx + sh)
            try:
                if right > left:
                    c.coords(self._shimmer_id, left, y1 + 1, right, y2 - 1)
                    c.itemconfigure(self._shimmer_id, state="normal")
                    c.tag_raise(self._shimmer_id)
                else:
                    c.itemconfigure(self._shimmer_id, state="hidden")
            except tk.TclError:
                pass

        self.pump()
        self._schedule_tick()

    def set_progress(self, value: float) -> None:
        if self._closed:
            return
        self._progress = max(0.0, min(100.0, float(value)))
        self.pump()

    def log(self, text: str) -> None:
        if self._closed or not text:
            return
        line = " ".join(str(text).split())
        if len(line) > 78:
            line = line[:77] + "…"
        self.lines.append(line)
        self.lines = self.lines[-5:]
        shown = "  ·  ".join(self.lines[-2:])
        try:
            self._canvas.itemconfigure(self._log_id, text=shown)
        except tk.TclError:
            pass
        self.pump()

    def step(self, text: str, progress: float | None = None) -> None:
        if self._closed:
            return
        try:
            self._canvas.itemconfigure(self._status_id, text=text, fill=INK)
        except tk.TclError:
            pass
        if progress is not None:
            self.set_progress(progress)
        else:
            self.pump()

    def fail(self, text: str) -> None:
        self._failed = True
        try:
            self._canvas.itemconfigure(self._status_id, text="Сбой запуска", fill=DANGER)
            self._canvas.itemconfigure(self._foot_id, text="")
            self._canvas.itemconfigure(self._pulse_id, fill=DANGER)
        except tk.TclError:
            pass
        self.log(text)
        self.set_progress(100)
        if self._closed:
            return
        x1, y1, x2, y2 = self.W / 2 - 70, self.H - 88, self.W / 2 + 70, self.H - 54
        btn = _round_rect(self._canvas, x1, y1, x2, y2, 12, fill=TEAL_DIM, outline="")
        label = self._canvas.create_text(
            (x1 + x2) / 2, (y1 + y2) / 2, text="Закрыть", fill="#ffffff", font=("Segoe UI", 11, "bold")
        )

        def _hover(_e: object, color: str) -> None:
            try:
                self._canvas.itemconfigure(btn, fill=color)
            except tk.TclError:
                pass

        for item in (btn, label):
            self._canvas.tag_bind(item, "<Button-1>", lambda _e: self.close())
            self._canvas.tag_bind(item, "<Enter>", lambda e: _hover(e, TEAL))
            self._canvas.tag_bind(item, "<Leave>", lambda e: _hover(e, TEAL_DIM))
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
