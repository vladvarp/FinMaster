"""Автозагрузка FinMaster при входе в Windows (текущий пользователь, без прав администратора)."""

from __future__ import annotations

import os
import sys

RUN_KEY = r"Software\Microsoft\Windows\CurrentVersion\Run"
VALUE_NAME = "FinMaster"


def _entry(root: str) -> str:
    return os.path.abspath(os.path.join(root, "FinMaster.exe"))


def _command(root: str) -> str:
    return f'"{_entry(root)}"'


def _read() -> str:
    if sys.platform != "win32":
        return ""
    import winreg

    try:
        with winreg.OpenKey(winreg.HKEY_CURRENT_USER, RUN_KEY, 0, winreg.KEY_READ) as key:
            value, _ = winreg.QueryValueEx(key, VALUE_NAME)
            return str(value or "")
    except OSError:
        return ""


def windows_login_enabled(root: str) -> bool:
    """Включено, если в автозагрузке записан именно этот экземпляр программы."""
    entry = os.path.normcase(_entry(root))
    current = os.path.normcase(_read())
    return bool(current) and entry in current


def set_windows_login(root: str, enabled: bool) -> bool:
    if sys.platform != "win32":
        raise OSError("Автозагрузка доступна только в Windows.")
    entry = _entry(root)
    if enabled and not os.path.isfile(entry):
        raise FileNotFoundError("Не найден FinMaster.exe рядом с программой.")
    import winreg

    with winreg.CreateKey(winreg.HKEY_CURRENT_USER, RUN_KEY) as key:
        if enabled:
            winreg.SetValueEx(key, VALUE_NAME, 0, winreg.REG_SZ, _command(root))
        else:
            try:
                winreg.DeleteValue(key, VALUE_NAME)
            except FileNotFoundError:
                pass
    return windows_login_enabled(root)
