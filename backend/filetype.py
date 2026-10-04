"""Привязка .fmaster к FinMaster.exe и иконке отчёта. Только для текущего пользователя."""

from __future__ import annotations

import ctypes
import os
import sys

PROG_ID = "FinMaster.Report"
EXT = ".fmaster"
_CLASSES = r"Software\Classes"


def _exe(root: str) -> str:
    return os.path.abspath(os.path.join(root, "FinMaster.exe"))


def _icon(root: str) -> str:
    return os.path.abspath(os.path.join(root, "frontend", "report.ico"))


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


def _notify() -> None:
    if sys.platform != "win32":
        return
    SHCNE_ASSOCCHANGED = 0x08000000
    SHCNF_IDLIST = 0x0000
    ctypes.windll.shell32.SHChangeNotify(SHCNE_ASSOCCHANGED, SHCNF_IDLIST, None, None)


def register_reports(root: str) -> None:
    """Сопоставить .fmaster с программой. Повторный запуск ничего не меняет, если запись уже верная."""
    if sys.platform != "win32":
        return
    exe = _exe(root)
    if not os.path.isfile(exe):
        return
    icon = _icon(root)
    icon_value = f'"{icon}",0' if os.path.isfile(icon) else f'"{exe}",0'
    command = f'"{exe}" "%1"'
    changed = False
    changed |= _write(f"{_CLASSES}\\{EXT}", PROG_ID, {"PerceivedType": "Document", "Content Type": "application/x-finmaster"})
    changed |= _write(f"{_CLASSES}\\{EXT}\\OpenWithProgids", "", {PROG_ID: ""})
    changed |= _write(f"{_CLASSES}\\{PROG_ID}", "Отчёт FinMaster")
    changed |= _write(f"{_CLASSES}\\{PROG_ID}\\DefaultIcon", icon_value)
    changed |= _write(f"{_CLASSES}\\{PROG_ID}\\shell\\open", "Открыть")
    changed |= _write(f"{_CLASSES}\\{PROG_ID}\\shell\\open\\command", command)
    if changed:
        _notify()
