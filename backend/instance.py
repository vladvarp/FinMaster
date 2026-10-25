"""Одна копия FinMaster: вторая передаёт файл уже открытому окну и закрывается."""

from __future__ import annotations

import atexit
import ctypes
import hmac
import json
import os
import secrets
import sys
import threading
import time
import urllib.error
import urllib.request
from typing import Any

from backend import storage

MUTEX_NAME = "Local\\FinMaster.SingleInstance"
WINDOW_TITLE = "FinMaster — учёт заказов"
_ERROR_ALREADY_EXISTS = 183
_SYNCHRONIZE = 0x00100000

_mutex = None
_token = ""
_startup_path = ""
_hwnd = 0
_focus_pending = False
_pending: list[str] = []
_pending_guard = threading.Lock()
_cleanup_ready = False


def is_report_path(path: str) -> bool:
    low = str(path or "").lower()
    return low.endswith(".fmaster") or low.endswith(".fbak")


def requested_report() -> str:
    """Путь отчёта или резервной копии из аргумента запуска или из переменной FinMaster.exe."""
    for raw in sys.argv[1:]:
        text = str(raw or "").strip().strip('"')
        if is_report_path(text):
            return os.path.abspath(text)
    env = str(os.environ.get("FINMASTER_OPEN") or "").strip().strip('"')
    if is_report_path(env):
        return os.path.abspath(env)
    return ""


def requested_handoff() -> str:
    """Путь отчёта, который надо передать уже открытому окну. Словарь так не открывается."""
    return requested_report()


def _lock_path() -> str:
    return os.path.join(storage.config_dir(), "instance.json")


def _read_lock() -> dict[str, Any]:
    try:
        with open(_lock_path(), encoding="utf-8") as handle:
            data = json.load(handle)
        return data if isinstance(data, dict) else {}
    except (OSError, json.JSONDecodeError):
        return {}


def _pid_alive(pid: int) -> bool:
    if pid <= 0:
        return False
    if sys.platform != "win32":
        try:
            os.kill(pid, 0)
        except OSError:
            return False
        return True
    kernel32 = ctypes.windll.kernel32
    handle = kernel32.OpenProcess(_SYNCHRONIZE, False, int(pid))
    if handle:
        kernel32.CloseHandle(handle)
        return True
    return kernel32.GetLastError() == 5


def _primary_alive() -> bool:
    data = _read_lock()
    return _pid_alive(int(data.get("pid") or 0))


def mutex_exists() -> bool:
    if sys.platform != "win32":
        return False
    kernel32 = ctypes.windll.kernel32
    handle = kernel32.OpenMutexW(_SYNCHRONIZE, False, MUTEX_NAME)
    if not handle:
        return False
    kernel32.CloseHandle(handle)
    return True


def _post(path: str) -> bool:
    data = _read_lock()
    port = int(data.get("port") or 0)
    token = str(data.get("token") or "")
    pid = int(data.get("pid") or 0)
    if port <= 0 or not token or not _pid_alive(pid):
        return False
    body = json.dumps({"token": token, "path": path}, ensure_ascii=False).encode("utf-8")
    request = urllib.request.Request(
        f"http://127.0.0.1:{port}/api/instance/open",
        data=body,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=1.5) as response:
            payload = json.loads(response.read().decode("utf-8"))
        return bool(isinstance(payload, dict) and payload.get("ok"))
    except (OSError, urllib.error.URLError, json.JSONDecodeError, ValueError):
        return False


def handoff_existing(path: str = "") -> bool:
    """Если копия уже работает, передать ей файл и вернуть True. Иначе False — можно стартовать."""
    if sys.platform != "win32":
        return False
    if not mutex_exists() and not _primary_alive():
        return False
    deadline = time.time() + 120
    while time.time() < deadline:
        if _post(path):
            return True
        if not mutex_exists() and not _primary_alive():
            return False
        time.sleep(0.25)
    return mutex_exists() or _primary_alive()


def owns_instance() -> bool:
    return _mutex is not None


def _acquire_mutex() -> bool:
    global _mutex
    if sys.platform != "win32":
        return True
    kernel32 = ctypes.windll.kernel32
    kernel32.SetLastError(0)
    handle = kernel32.CreateMutexW(None, False, MUTEX_NAME)
    if not handle:
        return False
    if kernel32.GetLastError() == _ERROR_ALREADY_EXISTS:
        kernel32.CloseHandle(handle)
        return False
    _mutex = handle
    return True


def claim_or_handoff(path: str = "") -> bool:
    """True — эта копия лишняя и должна завершиться. False — это единственное окно."""
    global _startup_path
    _startup_path = path or ""
    if sys.platform != "win32":
        return False
    if _acquire_mutex():
        _arm_cleanup()
        return False
    if handoff_existing(path):
        return True
    if _acquire_mutex():
        _arm_cleanup()
        return False
    return True


def _arm_cleanup() -> None:
    global _cleanup_ready
    if _cleanup_ready:
        return
    _cleanup_ready = True
    atexit.register(_cleanup)


def _cleanup() -> None:
    data = _read_lock()
    if int(data.get("pid") or 0) != os.getpid():
        return
    try:
        os.remove(_lock_path())
    except OSError:
        pass


def publish(port: int) -> None:
    """Запомнить порт этой копии и поставить в очередь файл, с которым её запустили."""
    global _token, _startup_path
    if not _token:
        _token = secrets.token_hex(16)
    payload = {"pid": os.getpid(), "port": int(port), "token": _token}
    path = _lock_path()
    temporary = path + ".tmp"
    with open(temporary, "w", encoding="utf-8") as handle:
        json.dump(payload, handle)
    os.replace(temporary, path)
    if _startup_path:
        queue(_startup_path)
        _startup_path = ""
    _arm_cleanup()


def check_token(value: str) -> bool:
    if not _token or not value:
        return False
    return hmac.compare_digest(str(value), _token)


def queue(path: str) -> None:
    text = str(path or "").strip().strip('"')
    if not is_report_path(text):
        return
    absolute = os.path.abspath(text)
    with _pending_guard:
        if absolute not in _pending:
            _pending.append(absolute)


def take_pending() -> list[str]:
    with _pending_guard:
        items = list(_pending)
        _pending.clear()
        return items


def capture_hwnd(window: Any) -> None:
    hwnd = 0
    native = getattr(window, "native", None)
    handle = getattr(native, "Handle", None) if native is not None else None
    if handle is not None:
        try:
            hwnd = int(handle)
        except (TypeError, ValueError):
            convert = getattr(handle, "ToInt64", None) or getattr(handle, "ToInt32", None)
            if callable(convert):
                try:
                    hwnd = int(convert())
                except (TypeError, ValueError):
                    hwnd = 0
    if hwnd:
        set_hwnd(hwnd)


def set_hwnd(hwnd: int) -> None:
    global _hwnd
    _hwnd = int(hwnd or 0)
    if _focus_pending and _hwnd:
        focus_window()


def request_focus() -> None:
    focus_window()


def focus_window() -> None:
    global _focus_pending, _hwnd
    if sys.platform != "win32":
        _focus_pending = False
        return
    try:
        user32 = ctypes.windll.user32
        hwnd = _hwnd or int(user32.FindWindowW(None, WINDOW_TITLE) or 0)
        if not hwnd:
            _focus_pending = True
            return
        _hwnd = hwnd
        _focus_pending = False
        kernel32 = ctypes.windll.kernel32
        foreground = user32.GetForegroundWindow()
        foreground_thread = user32.GetWindowThreadProcessId(foreground, None) if foreground else 0
        this_thread = kernel32.GetCurrentThreadId()
        attached = False
        if foreground_thread and foreground_thread != this_thread:
            attached = bool(user32.AttachThreadInput(this_thread, foreground_thread, True))
        if user32.IsIconic(hwnd):
            user32.ShowWindow(hwnd, 9)
        user32.ShowWindow(hwnd, 5)
        user32.SetForegroundWindow(hwnd)
        user32.BringWindowToTop(hwnd)
        if attached:
            user32.AttachThreadInput(this_thread, foreground_thread, False)
    except Exception:
        _focus_pending = True
