"""Заставка запуска FinMaster: светлая карточка в стиле приложения."""

from __future__ import annotations

import math
import os
import subprocess
import sys
import time
import tkinter as tk
from typing import Any, Callable


CREATE_NO_WINDOW = 0x08000000

# Совпадает с frontend/styles.css — светлый продукт, не «тёмный неон»
CHROMA = "#01fe03"  # ключ прозрачности углов (не используется в UI)
BG = "#e8eef4"
CARD = "#ffffff"
INK = "#0f172a"
MUTED = "#64748b"
SOFT = "#94a3b8"
LINE = "#dbe3ec"
TRACK = "#e8eef4"
ACCENT = "#0f766e"
ACCENT_2 = "#14b8a6"
ACCENT_SOFT = "#99f6e4"
ACCENT_WASH = "#ccfbf1"
GOLD = "#c9a227"
DANGER = "#dc2626"


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
        splash.step("Библиотеки на месте", 22)
        return

    splash.step("Устанавливаю " + ", ".join(missing) + "…", 14)
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
        splash.set_progress(min(14 + seen * 0.35, 28))
    code = proc.wait()
    if code != 0:
        raise RuntimeError("Не удалось установить библиотеки. Проверьте интернет и Python.")
    splash.step("Библиотеки установлены", 30)


def _round_rect(canvas: tk.Canvas, x1: float, y1: float, x2: float, y2: float, r: float, **kwargs: Any) -> int:
    r = max(0.0, min(r, (x2 - x1) / 2, (y2 - y1) / 2))
    pts = [
        x1 + r, y1, x2 - r, y1, x2, y1, x2, y1 + r,
        x2, y2 - r, x2, y2, x2 - r, y2, x1 + r, y2,
        x1, y2, x1, y2 - r, x1, y1 + r, x1, y1,
    ]
    return canvas.create_polygon(pts, smooth=True, splinesteps=48, **kwargs)


def _rounded_rect_perimeter(x1: float, y1: float, x2: float, y2: float, r: float, n: int = 128) -> list[tuple[float, float]]:
    r = max(0.0, min(r, (x2 - x1) / 2, (y2 - y1) / 2))
    w = x2 - x1 - 2 * r
    h = y2 - y1 - 2 * r
    straight = 2 * (w + h)
    arc = math.pi * r / 2
    total = straight + 4 * arc
    if total <= 0:
        return [(x1, y1)]

    def point_at(dist: float) -> tuple[float, float]:
        d = dist % total
        if d <= w:
            return x1 + r + d, y1
        d -= w
        if d <= arc:
            a = -math.pi / 2 + d / max(r, 0.001)
            return x2 - r + math.cos(a) * r, y1 + r + math.sin(a) * r
        d -= arc
        if d <= h:
            return x2, y1 + r + d
        d -= h
        if d <= arc:
            a = d / max(r, 0.001)
            return x2 - r + math.cos(a) * r, y2 - r + math.sin(a) * r
        d -= arc
        if d <= w:
            return x2 - r - d, y2
        d -= w
        if d <= arc:
            a = math.pi / 2 + d / max(r, 0.001)
            return x1 + r + math.cos(a) * r, y2 - r + math.sin(a) * r
        d -= arc
        if d <= h:
            return x1, y2 - r - d
        d -= h
        a = math.pi + d / max(r, 0.001)
        return x1 + r + math.cos(a) * r, y1 + r + math.sin(a) * r

    return [point_at(total * i / n) for i in range(n)]


def _lerp_hex(a: str, b: str, t: float) -> str:
    t = max(0.0, min(1.0, t))

    def ch(s: str, i: int) -> int:
        return int(s[i : i + 2], 16)

    ar, ag, ab = ch(a, 1), ch(a, 3), ch(a, 5)
    br, bg, bb = ch(b, 1), ch(b, 3), ch(b, 5)
    return "#{:02x}{:02x}{:02x}".format(
        int(ar + (br - ar) * t),
        int(ag + (bg - ag) * t),
        int(ab + (bb - ab) * t),
    )


class Splash:
    # Окно чуть больше карточки — место под тень и свечение
    W = 720
    H = 420
    MARGIN = 28
    CORNER = 26

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
        self._ring_ids: list[int] = []
        self._orbit_ids: list[int] = []
        self._shadow_ids: list[int] = []
        self._glow_ids: list[int] = []
        self._border_id = 0
        self._trail_ids: list[int] = []
        self._perimeter: list[tuple[float, float]] = []
        self._shimmer_id = 0
        self._pct_id = 0
        self._accent_line = 0
        self._last_pct = -1

        if sys.platform == "win32":
            try:
                import ctypes

                ctypes.windll.shcore.SetProcessDpiAwareness(1)
            except Exception:
                pass

        self.root = tk.Tk()
        self.root.title("FinMaster")
        self.root.overrideredirect(True)
        self.root.configure(bg=CHROMA)
        try:
            self.root.attributes("-topmost", True)
        except tk.TclError:
            pass
        # Прозрачные углы — реальное скругление окна
        try:
            self.root.wm_attributes("-transparentcolor", CHROMA)
        except tk.TclError:
            pass
        self.root.geometry(self._centered())
        self._build()
        self.pump()
        self._schedule_tick()

    def _centered(self) -> str:
        self.root.update_idletasks()
        sw = self.root.winfo_screenwidth()
        sh = self.root.winfo_screenheight()
        x = max(0, (sw - self.W) // 2)
        y = max(0, (sh - self.H) // 3)
        return f"{self.W}x{self.H}+{x}+{y}"

    def _card_box(self) -> tuple[float, float, float, float, float]:
        m = float(self.MARGIN)
        return m, m, float(self.W - self.MARGIN), float(self.H - self.MARGIN), float(self.CORNER)

    def _build(self) -> None:
        c = tk.Canvas(self.root, width=self.W, height=self.H, highlightthickness=0, bd=0, bg=CHROMA)
        c.pack(fill="both", expand=True)
        self._canvas = c

        x1, y1, x2, y2, r = self._card_box()

        # Soft drop shadow (layered, no harsh outline)
        for i, (off, col) in enumerate(
            (
                (10, "#c5d0dc"),
                (7, "#d2dbe6"),
                (4, "#dde5ee"),
                (2, "#e4ebf2"),
            )
        ):
            self._shadow_ids.append(
                _round_rect(c, x1 + 2, y1 + off, x2 + 2, y2 + off, r, fill=col, outline="")
            )

        # Card
        _round_rect(c, x1, y1, x2, y2, r, fill=CARD, outline="")

        # Soft inner wash — строго внутри карточки
        c.create_oval(x1 + 70, y1 + 24, x1 + 290, y1 + 170, fill="#f3faf9", outline="")
        c.create_oval(x2 - 250, y2 - 150, x2 - 50, y2 - 30, fill="#f5f8fc", outline="")

        # Animated glow border (outer soft → inner crisp)
        for inset, width, color in (
            (0.0, 5, ACCENT_WASH),
            (1.5, 3, ACCENT_SOFT),
            (3.0, 2, ACCENT_2),
        ):
            self._glow_ids.append(
                _round_rect(
                    c,
                    x1 + inset,
                    y1 + inset,
                    x2 - inset,
                    y2 - inset,
                    max(8.0, r - inset * 0.6),
                    fill="",
                    outline=color,
                    width=width,
                )
            )
        self._border_id = _round_rect(
            c, x1 + 4.5, y1 + 4.5, x2 - 4.5, y2 - 4.5, max(6.0, r - 4), fill="", outline=ACCENT, width=1
        )

        # Traveling highlight along border
        self._perimeter = _rounded_rect_perimeter(x1 + 3, y1 + 3, x2 - 3, y2 - 3, r - 2, n=140)
        for _ in range(22):
            self._trail_ids.append(c.create_oval(0, 0, 3, 3, fill=ACCENT_2, outline=""))

        # Brand block
        cx, cy = x1 + 78, y1 + 88
        self._logo_cx, self._logo_cy = cx, cy
        for i, rad in enumerate((30, 42, 54)):
            col = ACCENT_SOFT if i == 0 else LINE
            self._ring_ids.append(
                c.create_oval(cx - rad, cy - rad, cx + rad, cy + rad, outline=col, width=1)
            )
        for _ in range(2):
            self._orbit_ids.append(c.create_oval(0, 0, 5, 5, fill=ACCENT_2, outline=""))

        if not self._try_draw_icon(c, cx, cy):
            self._draw_mark(c, cx - 22, cy - 22)

        tx = cx + 72
        c.create_text(tx, cy - 18, text="FinMaster", fill=INK, font=("Segoe UI Semibold", 32, "bold"), anchor="w")
        c.create_text(tx, cy + 18, text="Учёт заказов · локально", fill=MUTED, font=("Segoe UI", 12), anchor="w")
        self._accent_line = c.create_line(tx, cy + 36, tx + 48, cy + 36, fill=GOLD, width=2)

        # Status + progress
        left = x1 + 36
        right = x2 - 36
        self._status_id = c.create_text(left, y1 + 198, text="Запуск…", fill=INK, font=("Segoe UI", 12), anchor="w")
        self._pct_id = c.create_text(right, y1 + 198, text="0%", fill=ACCENT, font=("Segoe UI Semibold", 12), anchor="e")

        by = y1 + 226
        self._bar = (left, by, right, by + 8)
        bx1, by1, bx2, by2 = self._bar
        _round_rect(c, bx1, by1, bx2, by2, 4, fill=TRACK, outline="")
        self._bar_fill = c.create_rectangle(bx1, by1, bx1, by2, fill=ACCENT, outline="")
        self._shimmer_id = c.create_rectangle(bx1, by1, bx1, by2, fill=ACCENT_SOFT, outline="")

        self._log_id = c.create_text(left, by + 36, text="", fill=SOFT, font=("Segoe UI", 9), anchor="w")

        c.create_text(left, y2 - 28, text="OFFLINE-FIRST", fill=SOFT, font=("Segoe UI", 8), anchor="w")
        self._foot_id = c.create_text(
            right, y2 - 28, text="данные остаются у вас", fill=SOFT, font=("Segoe UI", 9), anchor="e"
        )

        for gid in self._glow_ids:
            c.tag_raise(gid)
        c.tag_raise(self._border_id)
        for tid in self._trail_ids:
            c.tag_raise(tid)

        self._draw_bar(0)

    def _try_draw_icon(self, canvas: tk.Canvas, cx: float, cy: float) -> bool:
        path = self._icon_png
        if not path or not os.path.isfile(path):
            return False
        try:
            img = tk.PhotoImage(file=path)
            w, h = img.width(), img.height()
            target = 44
            if w > target * 2 and h > target * 2:
                factor = max(1, min(w, h) // target)
                img = img.subsample(factor, factor)
            elif w < target and h < target and w > 0:
                factor = max(1, target // max(w, h))
                img = img.zoom(factor, factor)
            self._photo = img
            canvas.create_oval(cx - 28, cy - 28, cx + 28, cy + 28, fill=ACCENT_WASH, outline="")
            canvas.create_image(cx, cy, image=img)
            return True
        except Exception:
            self._photo = None
            return False

    def _draw_mark(self, canvas: tk.Canvas, x: float, y: float) -> None:
        size = 44
        canvas.create_oval(x - 4, y - 4, x + size + 4, y + size + 4, fill=ACCENT_WASH, outline="")
        _round_rect(canvas, x, y, x + size, y + size, 13, fill=ACCENT, outline="")
        _round_rect(canvas, x + 2, y + 2, x + size - 2, y + size - 2, 11, fill=ACCENT_2, outline="")
        pad = 10
        bar_h = 3
        gap = 5
        canvas.create_rectangle(x + pad, y + 12, x + size - pad, y + 12 + bar_h, fill="#ffffff", outline="")
        canvas.create_rectangle(
            x + pad, y + 12 + bar_h + gap, x + size - pad, y + 12 + 2 * bar_h + gap, fill="#ecfeff", outline=""
        )
        canvas.create_rectangle(
            x + pad,
            y + 12 + 2 * (bar_h + gap),
            x + size - pad - 8,
            y + 12 + 3 * bar_h + 2 * gap,
            fill="#ffffff",
            outline="",
        )

    def _draw_bar(self, value: float) -> None:
        x1, y1, x2, y2 = self._bar
        t = max(0.0, min(1.0, value / 100.0))
        right = x1 + max(0.0, (x2 - x1) * t)
        try:
            if right <= x1 + 0.5:
                self._canvas.coords(self._bar_fill, x1, y1, x1, y2)
            else:
                self._canvas.coords(self._bar_fill, x1, y1, right, y2)
            self._canvas.tag_raise(self._bar_fill)
            if self._shimmer_id:
                self._canvas.tag_raise(self._shimmer_id)
            pct = int(round(t * 100))
            if pct != self._last_pct:
                self._last_pct = pct
                self._canvas.itemconfigure(self._pct_id, text=f"{pct}%")
        except tk.TclError:
            pass

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

        gap = self._progress - self._display
        if abs(gap) > 0.02:
            alpha = 1.0 - math.exp(-dt * 3.2)
            step = gap * alpha
            max_step = 55.0 * dt
            if step > max_step:
                step = max_step
            elif step < -max_step:
                step = -max_step
            self._display += step
            if (gap > 0 and self._display > self._progress) or (gap < 0 and self._display < self._progress):
                self._display = self._progress
        else:
            self._display = self._progress
        self._draw_bar(self._display)

        cx, cy = self._logo_cx, self._logo_cy
        for i, oid in enumerate(self._orbit_ids):
            ang = t * (0.5 + i * 0.16) + i * 2.2
            rad = 30 + i * 12
            x = cx + math.cos(ang) * rad
            y = cy + math.sin(ang) * rad * 0.7
            try:
                c.coords(oid, x - 2.2, y - 2.2, x + 2.2, y + 2.2)
                c.itemconfigure(oid, fill=ACCENT_2 if i == 0 else ACCENT)
            except tk.TclError:
                pass

        for i, rid in enumerate(self._ring_ids):
            pulse = 0.5 + 0.5 * math.sin(t * 1.3 + i)
            try:
                if i == 0:
                    c.itemconfigure(rid, outline=_lerp_hex(ACCENT_SOFT, ACCENT_2, pulse))
                else:
                    c.itemconfigure(rid, outline=LINE)
            except tk.TclError:
                pass

        # Soft breathing glow on frame
        pulse = 0.5 + 0.5 * math.sin(t * 1.5)
        pulse2 = 0.5 + 0.5 * math.sin(t * 1.5 + 0.9)
        try:
            palette = (
                (_lerp_hex("#e6f7f5", ACCENT_WASH, pulse), 4 + int(pulse > 0.55)),
                (_lerp_hex(ACCENT_WASH, ACCENT_SOFT, pulse2), 3),
                (_lerp_hex(ACCENT_SOFT, ACCENT_2, pulse), 2),
            )
            for gid, (col, w) in zip(self._glow_ids, palette):
                c.itemconfigure(gid, outline=col, width=w)
            if self._border_id:
                c.itemconfigure(self._border_id, outline=_lerp_hex(ACCENT, ACCENT_2, pulse2))
                c.tag_raise(self._border_id)
            if self._accent_line:
                c.itemconfigure(self._accent_line, fill=_lerp_hex(GOLD, "#e8c547", pulse))
        except tk.TclError:
            pass

        n = len(self._perimeter)
        trail_n = len(self._trail_ids)
        if n > 0 and trail_n > 0:
            head = int((t * 32) % n)
            for i, tid in enumerate(self._trail_ids):
                idx = (head - i) % n
                px, py = self._perimeter[idx]
                fade = 1.0 - i / max(1, trail_n)
                rad = 1.0 + 3.2 * fade * fade
                col = _lerp_hex(ACCENT_WASH, ACCENT_2 if i < 4 else ACCENT, fade)
                try:
                    c.coords(tid, px - rad, py - rad, px + rad, py + rad)
                    c.itemconfigure(tid, fill=col, state="normal")
                    c.tag_raise(tid)
                except tk.TclError:
                    pass

        x1, y1, x2, y2 = self._bar
        fill_w = (x2 - x1) * (self._display / 100.0)
        if fill_w > 14:
            sh = 26
            sx = x1 + ((t * 50) % max(1.0, fill_w + sh)) - sh
            left = max(x1, sx)
            right = min(x1 + fill_w, sx + sh)
            try:
                if right > left + 1:
                    c.coords(self._shimmer_id, left, y1 + 1, right, y2 - 1)
                    c.itemconfigure(self._shimmer_id, state="normal")
                    c.tag_raise(self._shimmer_id)
                else:
                    c.itemconfigure(self._shimmer_id, state="hidden")
            except tk.TclError:
                pass
        else:
            try:
                c.itemconfigure(self._shimmer_id, state="hidden")
            except tk.TclError:
                pass

        self.pump()
        self._schedule_tick()

    def set_progress(self, value: float) -> None:
        if self._closed:
            return
        nxt = max(0.0, min(100.0, float(value)))
        if nxt >= self._progress - 0.01:
            self._progress = nxt
        self.pump()

    def log(self, text: str) -> None:
        if self._closed or not text:
            return
        line = " ".join(str(text).split())
        if len(line) > 78:
            line = line[:77] + "…"
        self.lines.append(line)
        self.lines = self.lines[-3:]
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

    def finish(self, hold: float = 2.0) -> None:
        if self._closed:
            return
        self.set_progress(100)
        deadline = time.perf_counter() + 8.0
        while not self._closed and self._display < 99.4 and time.perf_counter() < deadline:
            self.pump()
            time.sleep(0.016)
        self._display = 100.0
        self._progress = 100.0
        self._draw_bar(100.0)
        self.step("Готово")
        self.pump()
        end = time.perf_counter() + max(0.0, hold)
        while not self._closed and time.perf_counter() < end:
            self.pump()
            time.sleep(0.016)
        self.close()

    def fail(self, text: str) -> None:
        self._failed = True
        try:
            self._canvas.itemconfigure(self._status_id, text="Сбой запуска", fill=DANGER)
            self._canvas.itemconfigure(self._foot_id, text="")
            self._canvas.itemconfigure(self._pct_id, fill=DANGER)
        except tk.TclError:
            pass
        self.log(text)
        self.set_progress(100)
        if self._closed:
            return
        x1, y1, x2, y2 = self.W / 2 - 72, self.H - 78, self.W / 2 + 72, self.H - 44
        btn = _round_rect(self._canvas, x1, y1, x2, y2, 12, fill=ACCENT, outline="")
        label = self._canvas.create_text(
            (x1 + x2) / 2, (y1 + y2) / 2, text="Закрыть", fill="#ffffff", font=("Segoe UI Semibold", 11)
        )

        def _hover(_e: object, color: str) -> None:
            try:
                self._canvas.itemconfigure(btn, fill=color)
            except tk.TclError:
                pass

        for item in (btn, label):
            self._canvas.tag_bind(item, "<Button-1>", lambda _e: self.close())
            self._canvas.tag_bind(item, "<Enter>", lambda e: _hover(e, ACCENT_2))
            self._canvas.tag_bind(item, "<Leave>", lambda e: _hover(e, ACCENT))
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
