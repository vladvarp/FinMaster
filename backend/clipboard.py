from __future__ import annotations

import os
import subprocess
import tempfile


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
        completed = subprocess.run(
            [
                "powershell",
                "-NoProfile",
                "-STA",
                "-ExecutionPolicy",
                "Bypass",
                "-Command",
                script,
            ],
            capture_output=True,
            text=True,
            timeout=25,
        )
        if completed.returncode != 0:
            err = (completed.stderr or completed.stdout or "неизвестная ошибка").strip()
            raise RuntimeError(err)
    finally:
        try:
            os.remove(path)
        except OSError:
            pass


def copy_text_to_clipboard(text: str) -> None:
    if text is None:
        raise ValueError("Нет текста.")
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
        completed = subprocess.run(
            [
                "powershell",
                "-NoProfile",
                "-STA",
                "-ExecutionPolicy",
                "Bypass",
                "-Command",
                script,
            ],
            capture_output=True,
            text=True,
            timeout=25,
        )
        if completed.returncode != 0:
            err = (completed.stderr or completed.stdout or "неизвестная ошибка").strip()
            raise RuntimeError(err)
    finally:
        try:
            os.remove(path)
        except OSError:
            pass
