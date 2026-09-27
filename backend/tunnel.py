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

from backend import netlog


def find_ngrok() -> str:
    for name in ("ngrok", "ngrok.exe"):
        path = shutil.which(name)
        if path:
            return path
    return ""


def inspect_tunnels(timeout: float = 1.2) -> list[dict[str, Any]]:
    try:
        with urllib.request.urlopen("http://127.0.0.1:4040/api/tunnels", timeout=timeout) as resp:
            data = json.loads(resp.read().decode("utf-8"))
        return [t for t in data.get("tunnels") or [] if isinstance(t, dict)]
    except (OSError, urllib.error.URLError, json.JSONDecodeError, TimeoutError):
        return []


def public_https(port: int, timeout: float = 1.2, strict: bool = False) -> str:
    matched = ""
    fallback = ""
    for tunnel in inspect_tunnels(timeout):
        url = str(tunnel.get("public_url") or "")
        if not url.startswith("https://"):
            continue
        cfg = tunnel.get("config") if isinstance(tunnel.get("config"), dict) else {}
        addr = str(cfg.get("addr") or "")
        if str(port) in addr or addr.endswith(f":{port}") or addr.endswith(f"/{port}"):
            matched = url
            break
        if not fallback:
            fallback = url
    if matched:
        return matched
    return "" if strict else fallback


def tunnel_reachable(url: str, timeout: float = 2.5) -> bool:
    """Адрес ngrok реально открывается. Локальный агент и пинг 1.1.1.1 для этого не годятся."""
    link = str(url or "").strip()
    if not link.startswith("https://"):
        return False
    if not link.endswith("/"):
        link += "/"
    req = urllib.request.Request(
        link,
        method="GET",
        headers={"User-Agent": "FinMaster", "ngrok-skip-browser-warning": "1"},
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return int(getattr(resp, "status", 0) or 0) < 500
    except urllib.error.HTTPError as exc:
        # Ответ пришёл с той стороны. 5xx — края нет или туннель мёртвый.
        return 0 < int(exc.code or 0) < 500
    except (OSError, urllib.error.URLError, TimeoutError, ValueError):
        return False


class NgrokTunnel:
    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._proc: subprocess.Popen[bytes] | None = None
        self._url = ""
        self._error = ""
        self._online = False
        self._owned = False
        self._probed_at = 0.0

    def snapshot(self) -> dict[str, Any]:
        with self._lock:
            proc = self._proc
            if proc is not None and proc.poll() is not None:
                self._proc = None
                self._owned = False
                self._url = ""
                self._online = False
                if not self._error:
                    self._error = "Процесс ngrok остановился."
            return {
                "available": bool(find_ngrok()),
                "url": self._url,
                "error": self._error,
                "online": bool(self._online and self._url),
                "running": bool(self._online and self._url),
            }

    def probe(self, port: int, wanted: bool = False, timeout: float = 2.5, force: bool = False) -> dict[str, Any]:
        """Сверяет запомненную ссылку с живым адресом ngrok, не поднимая новый процесс."""
        now = time.time()
        with self._lock:
            if not force and self._probed_at and now - self._probed_at < 2.0:
                fresh = False
            else:
                self._probed_at = now
                fresh = True
        if not fresh:
            return self.snapshot()
        url = public_https(port, timeout=min(timeout, 1.2), strict=True)
        online = bool(url) and tunnel_reachable(url, timeout)
        with self._lock:
            proc = self._proc
            dead = proc is not None and proc.poll() is not None
            if dead:
                self._proc = None
                self._owned = False
            if url and online:
                self._url = url
                self._online = True
                self._error = ""
            elif url:
                # Агент ещё держит адрес, но наружу он не выходит.
                self._url = url
                self._online = False
                self._error = "Интернета нет. С телефона доступна только локальная ссылка."
            elif wanted:
                self._url = ""
                self._online = False
                self._error = "Процесс ngrok остановился." if dead else "Туннель сейчас не открыт."
            else:
                self._url = ""
                self._online = False
                if dead:
                    self._error = ""
        return self.snapshot()

    def start(self, port: int, authtoken: str = "") -> str:
        with self._lock:
            url = public_https(port)
            if not url:
                exe = find_ngrok()
                if not exe:
                    self._error = "ngrok не найден. Скачайте с ngrok.com, добавьте в PATH и вставьте токен."
                    self._url = ""
                    self._online = False
                    netlog.add("ngrok", self._error, level="err", key="ngrok-missing")
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

                self._proc = subprocess.Popen(
                    [exe, "http", str(int(port)), "--log=stdout"],
                    stdout=subprocess.DEVNULL,
                    stderr=subprocess.DEVNULL,
                    stdin=subprocess.DEVNULL,
                    creationflags=_no_window(),
                )
                self._owned = True
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
                    netlog.add("ngrok", self._error, level="err", key="ngrok-fail")
                    raise RuntimeError(self._error)
            self._url = url
            self._online = False
        online = tunnel_reachable(url, 2.5)
        with self._lock:
            self._probed_at = time.time()
            self._online = online
            if online:
                self._error = ""
                netlog.add("ngrok", f"Туннель открыт: {url}", level="ok", key="ngrok-up")
            else:
                self._error = "Интернета нет. С телефона доступна только локальная ссылка."
                netlog.add("ngrok", self._error, level="warn", key="ngrok-offline")
            return url

    def stop(self) -> None:
        with self._lock:
            had = bool(self._url or self._proc)
            self._stop_locked()
            if had:
                netlog.add("ngrok", "Туннель остановлен", level="warn", key="ngrok-stop")

    def _stop_locked(self) -> None:
        proc = self._proc
        self._proc = None
        self._url = ""
        self._online = False
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
