from __future__ import annotations

import threading
from typing import Any


_lock = threading.Lock()


def _root():
    import tkinter as tk

    root = tk.Tk()
    root.withdraw()
    root.overrideredirect(True)
    root.geometry("1x1+0+0")
    root.attributes("-topmost", True)
    root.update()
    root.lift()
    root.focus_force()
    return root


def open_report_dialog(initial_dir: str = "") -> str | None:
    from tkinter import filedialog

    with _lock:
        root = _root()
        try:
            kwargs: dict[str, Any] = {
                "parent": root,
                "title": "Открыть отчёт FinMaster",
                "filetypes": [
                    ("Отчёты FinMaster", "*.fmaster"),
                    ("JSON", "*.json"),
                    ("Все файлы", "*.*"),
                ],
            }
            if initial_dir:
                kwargs["initialdir"] = initial_dir
            path = filedialog.askopenfilename(**kwargs)
            return path or None
        finally:
            root.destroy()


def save_report_dialog(suggested: str = "Отчёт.fmaster", initial_dir: str = "") -> str | None:
    from tkinter import filedialog
    import os

    with _lock:
        root = _root()
        try:
            kwargs: dict[str, Any] = {
                "parent": root,
                "title": "Сохранить отчёт FinMaster",
                "defaultextension": ".fmaster",
                "filetypes": [
                    ("Отчёты FinMaster", "*.fmaster"),
                    ("Все файлы", "*.*"),
                ],
                "initialfile": suggested,
            }
            if initial_dir:
                kwargs["initialdir"] = initial_dir
            path = filedialog.asksaveasfilename(**kwargs)
            if not path:
                return None
            if not os.path.splitext(path)[1]:
                path += ".fmaster"
            return path
        finally:
            root.destroy()


def save_csv_dialog(suggested: str = "Экспорт.csv", initial_dir: str = "") -> str | None:
    from tkinter import filedialog
    import os

    with _lock:
        root = _root()
        try:
            kwargs: dict[str, Any] = {
                "parent": root,
                "title": "Экспорт CSV",
                "defaultextension": ".csv",
                "filetypes": [("CSV", "*.csv"), ("Все файлы", "*.*")],
                "initialfile": suggested,
            }
            if initial_dir:
                kwargs["initialdir"] = initial_dir
            path = filedialog.asksaveasfilename(**kwargs)
            if not path:
                return None
            if not os.path.splitext(path)[1]:
                path += ".csv"
            return path
        finally:
            root.destroy()


def save_pdf_dialog(suggested: str = "Заказы.pdf", initial_dir: str = "") -> str | None:
    from tkinter import filedialog
    import os

    with _lock:
        root = _root()
        try:
            kwargs: dict[str, Any] = {
                "parent": root,
                "title": "Сохранить PDF для заказчика",
                "defaultextension": ".pdf",
                "filetypes": [("PDF", "*.pdf"), ("Все файлы", "*.*")],
                "initialfile": suggested,
            }
            if initial_dir:
                kwargs["initialdir"] = initial_dir
            path = filedialog.asksaveasfilename(**kwargs)
            if not path:
                return None
            if not os.path.splitext(path)[1]:
                path += ".pdf"
            return path
        finally:
            root.destroy()


def save_png_dialog(suggested: str = "Заказ.png", initial_dir: str = "") -> str | None:
    from tkinter import filedialog
    import os

    with _lock:
        root = _root()
        try:
            kwargs: dict[str, Any] = {
                "parent": root,
                "title": "Сохранить снимок заказа",
                "defaultextension": ".png",
                "filetypes": [("PNG", "*.png"), ("Все файлы", "*.*")],
                "initialfile": suggested,
            }
            if initial_dir:
                kwargs["initialdir"] = initial_dir
            path = filedialog.asksaveasfilename(**kwargs)
            if not path:
                return None
            if not os.path.splitext(path)[1]:
                path += ".png"
            return path
        finally:
            root.destroy()
