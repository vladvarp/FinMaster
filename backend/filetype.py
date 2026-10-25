"""Привязка .fmaster и .fbak к FinMaster.exe. У .fmwb только иконка книги: щелчок его не открывает."""

from __future__ import annotations

import ctypes
import os
import sys

PROG_ID = "FinMaster.Report"
EXT = ".fmaster"
_CLASSES = r"Software\Classes"


def _exe(root: str) -> str:
    return os.path.abspath(os.path.join(root, "FinMaster.exe"))


def _icon(root: str, name: str) -> str:
    return os.path.abspath(os.path.join(root, "frontend", name))


def _read(key: str) -> str:
    import winreg

    try:
        with winreg.OpenKey(winreg.HKEY_CURRENT_USER, key, 0, winreg.KEY_READ) as handle:
            value, _ = winreg.QueryValueEx(handle, "")
            return str(value or "")
    except OSError:
        return ""


def _write(key: str, value: str, extra: dict[str, str] | None = None) -> bool:
    import winreg

    changed = _read(key) != value
    with winreg.CreateKey(winreg.HKEY_CURRENT_USER, key) as handle:
        winreg.SetValueEx(handle, "", 0, winreg.REG_SZ, value)
        for name, item in (extra or {}).items():
            current = ""
            try:
                current, _ = winreg.QueryValueEx(handle, name)
            except OSError:
                current = ""
            if str(current or "") != item:
                changed = True
            winreg.SetValueEx(handle, name, 0, winreg.REG_SZ, item)
    return changed


def _delete_key(key: str) -> bool:
    import winreg

    try:
        winreg.DeleteKey(winreg.HKEY_CURRENT_USER, key)
        return True
    except OSError:
        return False


def _delete_value(key: str, name: str) -> bool:
    import winreg

    try:
        with winreg.OpenKey(winreg.HKEY_CURRENT_USER, key, 0, winreg.KEY_SET_VALUE) as handle:
            winreg.DeleteValue(handle, name)
        return True
    except OSError:
        return False


def _drop_dictionary_launch() -> bool:
    """Снять команду «Открыть» у словаря, если она уже записана."""
    prog = "FinMaster.Dictionary"
    changed = False
    for key in (
        f"{_CLASSES}\\{prog}\\shell\\open\\command",
        f"{_CLASSES}\\{prog}\\shell\\open",
        f"{_CLASSES}\\{prog}\\shell",
    ):
        changed |= _delete_key(key)
    changed |= _delete_value(f"{_CLASSES}\\.fmwb\\OpenWithProgids", prog)
    ext_key = r"Software\Microsoft\Windows\CurrentVersion\Explorer\FileExts\.fmwb"
    changed |= _delete_key(ext_key + r"\UserChoice")
    changed |= _delete_key(ext_key + r"\OpenWithList")
    changed |= _delete_key(ext_key + r"\OpenWithProgids")
    changed |= _delete_key(ext_key)
    return changed


def _register_dictionary_icon(root: str) -> bool:
    """Иконка книги без запуска программы."""
    prog = "FinMaster.Dictionary"
    icon = _icon(root, "dictionary.ico")
    exe = _exe(root)
    icon_value = f'"{icon}",0' if os.path.isfile(icon) else f'"{exe}",0'
    changed = False
    changed |= _write(
        f"{_CLASSES}\\.fmwb",
        prog,
        {"PerceivedType": "Document", "Content Type": "application/x-finmaster-dictionary"},
    )
    changed |= _write(f"{_CLASSES}\\{prog}", "Словарь FinMaster")
    changed |= _write(f"{_CLASSES}\\{prog}\\DefaultIcon", icon_value)
    return changed


def _notify() -> None:
    if sys.platform != "win32":
        return
    SHCNE_ASSOCCHANGED = 0x08000000
    SHCNF_IDLIST = 0x0000
    ctypes.windll.shell32.SHChangeNotify(SHCNE_ASSOCCHANGED, SHCNF_IDLIST, None, None)


def _register_kind(root: str, exe: str, ext: str, prog_id: str, description: str, icon_name: str, content_type: str) -> bool:
    icon = _icon(root, icon_name)
    icon_value = f'"{icon}",0' if os.path.isfile(icon) else f'"{exe}",0'
    command = f'"{exe}" "%1"'
    changed = False
    changed |= _write(f"{_CLASSES}\\{ext}", prog_id, {"PerceivedType": "Document", "Content Type": content_type})
    changed |= _write(f"{_CLASSES}\\{ext}\\OpenWithProgids", "", {prog_id: ""})
    changed |= _write(f"{_CLASSES}\\{prog_id}", description)
    changed |= _write(f"{_CLASSES}\\{prog_id}\\DefaultIcon", icon_value)
    changed |= _write(f"{_CLASSES}\\{prog_id}\\shell\\open", "Открыть")
    changed |= _write(f"{_CLASSES}\\{prog_id}\\shell\\open\\command", command)
    return changed


def register_reports(root: str) -> None:
    """Сопоставить отчёты и резервные копии с программой. Повторный запуск ничего не меняет, если запись уже верная."""
    if sys.platform != "win32":
        return
    exe = _exe(root)
    if not os.path.isfile(exe):
        return
    changed = False
    changed |= _register_kind(root, exe, EXT, PROG_ID, "Отчёт FinMaster", "report.ico", "application/x-finmaster")
    changed |= _register_kind(
        root,
        exe,
        ".fbak",
        "FinMaster.Backup",
        "Резервная копия FinMaster",
        "backup.ico",
        "application/x-finmaster-backup",
    )
    changed |= _drop_dictionary_launch()
    changed |= _register_dictionary_icon(root)
    if changed:
        _notify()
