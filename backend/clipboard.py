from __future__ import annotations

import ctypes
import os
import subprocess
import tempfile


CREATE_NO_WINDOW = 0x08000000


def _no_window() -> int:
    return int(getattr(subprocess, "CREATE_NO_WINDOW", CREATE_NO_WINDOW))


def _copy_text_win32(text: str) -> bool:
    if os.name != "nt":
        return False
    user32 = ctypes.windll.user32
    kernel32 = ctypes.windll.kernel32
    payload = str(text).encode("utf-16-le") + b"\x00\x00"
    handle = kernel32.GlobalAlloc(0x0002, len(payload))
    if not handle:
        return False
    locked = kernel32.GlobalLock(handle)
    if not locked:
        kernel32.GlobalFree(handle)
        return False
    ctypes.memmove(locked, payload, len(payload))
    kernel32.GlobalUnlock(handle)
    if not user32.OpenClipboard(None):
        kernel32.GlobalFree(handle)
        return False
    try:
        user32.EmptyClipboard()
        if not user32.SetClipboardData(13, handle):
            kernel32.GlobalFree(handle)
            return False
        return True
    finally:
        user32.CloseClipboard()


def _run_powershell(script: str) -> None:
    startup = subprocess.STARTUPINFO() if os.name == "nt" else None
    if startup is not None:
        startup.dwFlags |= subprocess.STARTF_USESHOWWINDOW
        startup.wShowWindow = 0
    completed = subprocess.run(
        [
            "powershell",
            "-NoProfile",
            "-STA",
            "-NonInteractive",
            "-WindowStyle",
            "Hidden",
            "-ExecutionPolicy",
            "Bypass",
            "-Command",
            script,
        ],
        capture_output=True,
        text=True,
        timeout=25,
        stdin=subprocess.DEVNULL,
        creationflags=_no_window() if os.name == "nt" else 0,
        startupinfo=startup,
    )
    if completed.returncode != 0:
        err = (completed.stderr or completed.stdout or "неизвестная ошибка").strip()
        raise RuntimeError(err)


def copy_png_to_clipboard(png_bytes: bytes) -> None:
    if not png_bytes:
        raise ValueError("Пустое изображение.")
    fd, path = tempfile.mkstemp(suffix=".png")
    os.close(fd)
    try:
        with open(path, "wb") as fh:
            fh.write(png_bytes)
        escaped = path.replace("'", "''")
        script = (
            "Add-Type -AssemblyName System.Windows.Forms; "
            "Add-Type -AssemblyName System.Drawing; "
            f"$img = [System.Drawing.Image]::FromFile('{escaped}'); "
            "[System.Windows.Forms.Clipboard]::SetImage($img); "
            "$img.Dispose();"
        )
        _run_powershell(script)
    finally:
        try:
            os.remove(path)
        except OSError:
            pass


def copy_text_to_clipboard(text: str) -> None:
    if text is None:
        raise ValueError("Нет текста.")
    if _copy_text_win32(str(text)):
        return
    fd, path = tempfile.mkstemp(suffix=".txt")
    os.close(fd)
    try:
        with open(path, "w", encoding="utf-8") as fh:
            fh.write(text)
        escaped = path.replace("'", "''")
        script = (
            "Add-Type -AssemblyName System.Windows.Forms; "
            f"$t = [System.IO.File]::ReadAllText('{escaped}', [System.Text.Encoding]::UTF8); "
            "[System.Windows.Forms.Clipboard]::SetText($t);"
        )
        _run_powershell(script)
    finally:
        try:
            os.remove(path)
        except OSError:
            pass
