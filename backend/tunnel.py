"""Туннель ngrok: телефон открывает FinMaster через интернет."""

from __future__ import annotations

import json
import os
import shutil
import subprocess
import threading
import time
import urllib.error
import urllib.request
from typing import Any


def find_ngrok() -> str:
    for name in ("ngrok", "ngrok.exe"):
        path = shutil.which(name)
        if path:
            return path
    return ""


def inspect_tunnels() -> list[dict[str, Any]]:
    try:
        with urllib.request.urlopen("http://127.0.0.1:4040/api/tunnels", timeout=1.2) as resp:
            data = json.loads(resp.read().decode("utf-8"))
        return [t for t in data.get("tunnels") or [] if isinstance(t, dict)]
    except (OSError, urllib.error.URLError, json.JSONDecodeError, TimeoutError):
        return []


def public_https(port: int) -> str:
    for tunnel in inspect_tunnels():
        url = str(tunnel.get("public_url") or "")
        if not url.startswith("https://"):
            continue
        cfg = tunnel.get("config") if isinstance(tunnel.get("config"), dict) else {}
        addr = str(cfg.get("addr") or "")
        if str(port) in addr or addr.endswith(f":{port}") or addr.endswith(f"/{port}"):
            return url
    https = [str(t.get("public_url") or "") for t in inspect_tunnels() if str(t.get("public_url") or "").startswith("https://")]
    return https[0] if https else ""


class NgrokTunnel:
    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._proc: subprocess.Popen[bytes] | None = None
        self._url = ""
        self._error = ""
        self._owned = False

    def snapshot(self) -> dict[str, Any]:
        with self._lock:
            return {
                "available": bool(find_ngrok()),
                "url": self._url,
                "error": self._error,
                "running": bool(self._url) or (self._proc is not None and self._proc.poll() is None),
            }

    def start(self, port: int, authtoken: str = "") -> str:
        with self._lock:
            existing = public_https(port)
            if existing:
                self._url = existing
                self._error = ""
                return existing

            exe = find_ngrok()
            if not exe:
                self._error = "ngrok не найден. Скачайте с ngrok.com, добавьте в PATH и вставьте токен."
                self._url = ""
                raise RuntimeError(self._error)

            token = str(authtoken or "").strip()
            if token:
                subprocess.run(
                    [exe, "config", "add-authtoken", token],
                    check=False,
                    capture_output=True,
                    timeout=20,
                    creationflags=_no_window(),
                )

            args = [exe, "http", str(int(port)), "--log=stdout"]
            self._proc = subprocess.Popen(
                args,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
                stdin=subprocess.DEVNULL,
                creationflags=_no_window(),
            )
            self._owned = True

            url = ""
            for _ in range(40):
                if self._proc.poll() is not None:
                    break
                url = public_https(port)
                if url:
                    break
                time.sleep(0.25)

            if not url:
                self._stop_locked()
                self._error = (
                    "ngrok не выдал ссылку. Нужен токен с ngrok.com → Your Authtoken. "
                    "Если ngrok уже запущен в другом окне — закройте его и попробуйте снова."
                )
                raise RuntimeError(self._error)

            self._url = url
            self._error = ""
            return url

    def stop(self) -> None:
        with self._lock:
            self._stop_locked()

    def _stop_locked(self) -> None:
        proc = self._proc
        self._proc = None
        self._url = ""
        if not self._owned or proc is None:
            self._owned = False
            return
        self._owned = False
        try:
            proc.terminate()
            proc.wait(timeout=3)
        except Exception:
            try:
                proc.kill()
            except Exception:
                pass


def _no_window() -> int:
    if os.name != "nt":
        return 0
    return int(getattr(subprocess, "CREATE_NO_WINDOW", 0))


TUNNEL = NgrokTunnel()
