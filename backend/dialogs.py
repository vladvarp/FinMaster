from __future__ import annotations

import ctypes
import os
import sys
import threading
from ctypes import wintypes
from typing import Any


_lock = threading.Lock()
_TK: bool | None = None
_OFN_EXPLORER = 0x00080000
_OFN_FILEMUSTEXIST = 0x00001000
_OFN_PATHMUSTEXIST = 0x00000800
_OFN_OVERWRITEPROMPT = 0x00000002
_OFN_NOCHANGEDIR = 0x00000008


class _OpenFileName(ctypes.Structure):
    _fields_ = (
        ("lStructSize", wintypes.DWORD),
        ("hwndOwner", wintypes.HWND),
        ("hInstance", wintypes.HINSTANCE),
        ("lpstrFilter", wintypes.LPCWSTR),
        ("lpstrCustomFilter", wintypes.LPWSTR),
        ("nMaxCustFilter", wintypes.DWORD),
        ("nFilterIndex", wintypes.DWORD),
        ("lpstrFile", wintypes.LPWSTR),
        ("nMaxFile", wintypes.DWORD),
        ("lpstrFileTitle", wintypes.LPWSTR),
        ("nMaxFileTitle", wintypes.DWORD),
        ("lpstrInitialDir", wintypes.LPCWSTR),
        ("lpstrTitle", wintypes.LPCWSTR),
        ("Flags", wintypes.DWORD),
        ("nFileOffset", wintypes.WORD),
        ("nFileExtension", wintypes.WORD),
        ("lpstrDefExt", wintypes.LPCWSTR),
        ("lCustData", wintypes.LPARAM),
        ("lpfnHook", ctypes.c_void_p),
        ("lpTemplateName", wintypes.LPCWSTR),
        ("pvReserved", ctypes.c_void_p),
        ("dwReserved", wintypes.DWORD),
        ("FlagsEx", wintypes.DWORD),
    )


def _tk_ready() -> bool:
    global _TK
    if _TK is None:
        try:
            import tkinter  # noqa: F401

            _TK = True
        except ImportError:
            _TK = False
    return _TK


def _filter_text(pairs: list[tuple[str, str]]) -> str:
    parts: list[str] = []
    for label, pattern in pairs:
        parts.append(label)
        parts.append(pattern)
    return "\0".join(parts) + "\0\0"


def _native_dialog(
    *,
    save: bool,
    title: str,
    pairs: list[tuple[str, str]],
    initial_dir: str = "",
    initial_file: str = "",
    default_ext: str = "",
) -> str | None:
    if sys.platform != "win32":
        return None
    buffer = ctypes.create_unicode_buffer(initial_file or "", 32768)
    title_text = title
    filter_text = _filter_text(pairs)
    folder = initial_dir or None
    extension = default_ext.lstrip(".") or None
    dialog = _OpenFileName()
    dialog.lStructSize = ctypes.sizeof(dialog)
    dialog.lpstrFilter = filter_text
    dialog.nFilterIndex = 1
    dialog.lpstrFile = ctypes.cast(buffer, wintypes.LPWSTR)
    dialog.nMaxFile = 32768
    dialog.lpstrInitialDir = folder
    dialog.lpstrTitle = title_text
    dialog.Flags = _OFN_EXPLORER | _OFN_PATHMUSTEXIST | _OFN_NOCHANGEDIR
    if save:
        dialog.Flags |= _OFN_OVERWRITEPROMPT
        dialog.lpstrDefExt = extension
    else:
        dialog.Flags |= _OFN_FILEMUSTEXIST
    function = ctypes.windll.comdlg32.GetSaveFileNameW if save else ctypes.windll.comdlg32.GetOpenFileNameW
    function.argtypes = [ctypes.POINTER(_OpenFileName)]
    function.restype = wintypes.BOOL
    if not function(ctypes.byref(dialog)):
        return None
    path = buffer.value.strip()
    return path or None


def _with_extension(path: str | None, suffix: str) -> str | None:
    if not path:
        return None
    if not os.path.splitext(path)[1]:
        path += suffix
    return path


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
    if not _tk_ready():
        return _native_dialog(
            save=False,
            title="Открыть отчёт FinMaster",
            pairs=[("Отчёты FinMaster", "*.fmaster"), ("Резервные копии", "*.fbak"), ("JSON", "*.json"), ("Все файлы", "*.*")],
            initial_dir=initial_dir,
        )
    from tkinter import filedialog

    with _lock:
        root = _root()
        try:
            kwargs: dict[str, Any] = {
                "parent": root,
                "title": "Открыть отчёт FinMaster",
                "filetypes": [
                    ("Отчёты FinMaster", "*.fmaster"),
                    ("Резервные копии", "*.fbak"),
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
    if not _tk_ready():
        return _with_extension(
            _native_dialog(
                save=True,
                title="Сохранить отчёт FinMaster",
                pairs=[("Отчёты FinMaster", "*.fmaster"), ("Все файлы", "*.*")],
                initial_dir=initial_dir,
                initial_file=suggested,
                default_ext=".fmaster",
            ),
            ".fmaster",
        )
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
    if not _tk_ready():
        return _with_extension(
            _native_dialog(
                save=True,
                title="Экспорт CSV",
                pairs=[("CSV", "*.csv"), ("Все файлы", "*.*")],
                initial_dir=initial_dir,
                initial_file=suggested,
                default_ext=".csv",
            ),
            ".csv",
        )
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
    if not _tk_ready():
        return _with_extension(
            _native_dialog(
                save=True,
                title="Сохранить PDF для заказчика",
                pairs=[("PDF", "*.pdf"), ("Все файлы", "*.*")],
                initial_dir=initial_dir,
                initial_file=suggested,
                default_ext=".pdf",
            ),
            ".pdf",
        )
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
    if not _tk_ready():
        return _with_extension(
            _native_dialog(
                save=True,
                title="Сохранить снимок заказа",
                pairs=[("PNG", "*.png"), ("Все файлы", "*.*")],
                initial_dir=initial_dir,
                initial_file=suggested,
                default_ext=".png",
            ),
            ".png",
        )
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


def open_dictionary_dialog(initial_dir: str = "") -> str | None:
    pairs = [("Словарь FinMaster", "*.fmwb"), ("Все файлы", "*.*")]
    if not _tk_ready():
        return _native_dialog(save=False, title="Открыть словарь FinMaster", pairs=pairs, initial_dir=initial_dir)
    from tkinter import filedialog

    with _lock:
        root = _root()
        try:
            kwargs: dict[str, Any] = {"parent": root, "title": "Открыть словарь FinMaster", "filetypes": pairs}
            if initial_dir:
                kwargs["initialdir"] = initial_dir
            path = filedialog.askopenfilename(**kwargs)
            return path or None
        finally:
            root.destroy()


def save_dictionary_dialog(suggested: str = "Словарь.fmwb", initial_dir: str = "") -> str | None:
    pairs = [("Словарь FinMaster", "*.fmwb"), ("Все файлы", "*.*")]
    if not _tk_ready():
        return _with_extension(
            _native_dialog(
                save=True,
                title="Сохранить словарь FinMaster",
                pairs=pairs,
                initial_dir=initial_dir,
                initial_file=suggested,
                default_ext=".fmwb",
            ),
            ".fmwb",
        )
    from tkinter import filedialog
    import os

    with _lock:
        root = _root()
        try:
            kwargs: dict[str, Any] = {
                "parent": root,
                "title": "Сохранить словарь FinMaster",
                "defaultextension": ".fmwb",
                "filetypes": pairs,
                "initialfile": suggested,
            }
            if initial_dir:
                kwargs["initialdir"] = initial_dir
            path = filedialog.asksaveasfilename(**kwargs)
            if not path:
                return None
            if not os.path.splitext(path)[1]:
                path += ".fmwb"
            return path
        finally:
            root.destroy()
