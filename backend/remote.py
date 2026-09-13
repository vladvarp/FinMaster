"""Сессия удалённого доступа: телефон работает с отчётом через локальную сеть.

Компьютер выступает сервером, документ хранится в памяти сессии и раздаётся
всем подключённым клиентам через длинный опрос (long polling).
"""

from __future__ import annotations

import secrets
import socket
import threading
import time
from typing import Any

CLIENT_TTL = 45.0
POLL_TIMEOUT = 25.0


def _ip_rank(ip: str) -> int:
    """Чем меньше, тем вероятнее это домашний Wi-Fi, а не VPN или туннель."""
    if ip.startswith("192.168."):
        return 0
    if ip.startswith("10."):
        return 1
    try:
        second = int(ip.split(".")[1])
    except (IndexError, ValueError):
        second = -1
    if ip.startswith("172.") and 16 <= second <= 31:
        return 2
    if ip.startswith("169.254.") or ip.startswith("127."):
        return 9
    if ip.startswith("198.18.") or ip.startswith("198.19."):  # диапазон тестов, обычно VPN-клиент
        return 8
    return 5


def lan_candidates() -> list[str]:
    """Все адреса компьютера, пригодные для подключения телефона."""
    found: list[str] = []

    try:
        sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        try:
            sock.connect(("8.8.8.8", 80))  # соединение без передачи данных, только чтобы узнать адрес
            found.append(str(sock.getsockname()[0]))
        finally:
            sock.close()
    except OSError:
        pass

    try:
        for info in socket.getaddrinfo(socket.gethostname(), None, socket.AF_INET):
            found.append(str(info[4][0]))
    except OSError:
        pass

    unique: list[str] = []
    for ip in found:
        if ip and ip not in unique and not ip.startswith("127."):
            unique.append(ip)
    unique.sort(key=_ip_rank)
    return unique or ["127.0.0.1"]


def lan_ip() -> str:
    return lan_candidates()[0]


class RemoteSession:
    def __init__(self) -> None:
        self._cond = threading.Condition()
        self.enabled = False
        self.token = ""
        self.version = 0
        self.doc: dict[str, Any] | None = None
        self.path = ""
        self.dirty = False
        self.origin = ""
        self.command: dict[str, Any] | None = None
        self.nav: dict[str, Any] = {"seq": 0, "view": "", "order_id": "", "cid": "", "period": "", "filter": "", "status": ""}
        self.history: dict[str, bool] = {"undo": False, "redo": False}
        self.doc_version = 0
        self._command_id = 0
        self._nav_seq = 0
        self._clients: dict[str, dict[str, Any]] = {}

    # ---------- управление сессией ----------

    def start(self, token: str = "") -> str:
        with self._cond:
            self.enabled = True
            self.token = str(token or self.token or secrets.token_urlsafe(12))
            self._clients = {}
            self.command = None
            self.nav = {"seq": 0, "view": "", "order_id": "", "cid": "", "period": "", "filter": "", "status": ""}
            self.version += 1
            self._cond.notify_all()
            return self.token

    def stop(self) -> None:
        with self._cond:
            self.enabled = False
            self.doc = None
            self.path = ""
            self._clients = {}
            self.command = None
            self.nav = {"seq": 0, "view": "", "order_id": "", "cid": "", "period": "", "filter": "", "status": ""}
            self.version += 1
            self._cond.notify_all()

    def check(self, token: str | None) -> bool:
        if not self.enabled or not self.token or not token:
            return False
        got = str(token)
        if len(got) != len(self.token):
            return False
        return secrets.compare_digest(got, self.token)

    # ---------- документ ----------

    def publish(
        self,
        doc: Any,
        path: str,
        origin: str,
        dirty: bool = False,
        history: Any = None,
    ) -> int:
        with self._cond:
            if isinstance(doc, dict):
                self.doc = doc
            if isinstance(history, dict):
                self.history = {"undo": bool(history.get("undo")), "redo": bool(history.get("redo"))}
            self.path = str(path or "")
            self.dirty = bool(dirty)
            self.origin = str(origin or "")
            self.doc_version += 1
            self.version += 1
            self._cond.notify_all()
            return self.version

    def set_history(self, history: Any) -> int:
        """Компьютер сообщает, есть ли что отменять — телефон гасит свои кнопки."""
        with self._cond:
            if isinstance(history, dict):
                flags = {"undo": bool(history.get("undo")), "redo": bool(history.get("redo"))}
                if flags != self.history:
                    self.history = flags
                    self.version += 1
                    self._cond.notify_all()
            return self.version

    def issue_command(self, kind: str, **payload: Any) -> int:
        with self._cond:
            self._command_id += 1
            self.command = {"id": self._command_id, "type": kind, **payload}
            self.version += 1
            self._cond.notify_all()
            return self.version

    def set_nav(
        self,
        view: str,
        order_id: str = "",
        cid: str = "",
        period: str = "",
        order_filter: str = "",
        status: str = "",
    ) -> int:
        """Телефон сообщает, какой экран и какие фильтры сводки открыты."""
        periods = {"all", "today", "week", "month", "year"}
        filters = {"all", "debt", "paid"}
        with self._cond:
            self._nav_seq += 1
            self.nav = {
                "seq": self._nav_seq,
                "view": str(view or ""),
                "order_id": str(order_id or ""),
                "cid": str(cid or ""),
                "period": period if period in periods else "all",
                "filter": order_filter if order_filter in filters else "all",
                "status": str(status or "")[:80],
            }
            self.version += 1
            self._cond.notify_all()
            return self.version

    # ---------- клиенты ----------

    def _bump(self) -> None:
        self.version += 1
        self._cond.notify_all()

    def _prune_locked(self) -> bool:
        now = time.time()
        stale = [cid for cid, c in self._clients.items() if now - c.get("seen", 0) > CLIENT_TTL]
        for cid in stale:
            self._clients.pop(cid, None)
        return bool(stale)

    def touch(self, cid: str, kind: str = "mobile", name: str = "") -> None:
        if not cid:
            return
        now = time.time()
        with self._cond:
            is_new = cid not in self._clients
            client = self._clients.setdefault(cid, {"kind": kind, "name": name, "since": now})
            client["seen"] = now
            client["kind"] = kind or client.get("kind") or "mobile"
            if name:
                client["name"] = name
            pruned = self._prune_locked()
            if is_new or pruned:
                self._bump()

    def drop(self, cid: str) -> None:
        with self._cond:
            if self._clients.pop(cid, None) is not None:
                self._bump()

    def _live_clients(self) -> list[dict[str, Any]]:
        self._prune_locked()
        return [
            {
                "id": cid,
                "kind": c.get("kind", "mobile"),
                "name": c.get("name", ""),
                "since": c.get("since", 0),
                "seen": c.get("seen", 0),
            }
            for cid, c in self._clients.items()
        ]

    def clients(self, kind: str | None = None) -> list[dict[str, Any]]:
        with self._cond:
            items = self._live_clients()
        return [c for c in items if kind is None or c["kind"] == kind]

    # ---------- синхронизация ----------

    def _snapshot(self, with_doc: bool) -> dict[str, Any]:
        data: dict[str, Any] = {
            "enabled": self.enabled,
            "version": self.version,
            "path": self.path,
            "dirty": self.dirty,
            "origin": self.origin,
            "command": self.command,
            "nav": self.nav,
            "history": self.history,
            "doc_version": self.doc_version,
            "clients": self._live_clients(),
        }
        if with_doc:
            data["document"] = self.doc
        return data

    def snapshot(self, with_doc: bool = True) -> dict[str, Any]:
        with self._cond:
            return self._snapshot(with_doc)

    def wait(self, since: int, timeout: float = POLL_TIMEOUT) -> dict[str, Any]:
        deadline = time.time() + timeout
        with self._cond:
            while self.version <= since and self.enabled:
                if self._prune_locked():
                    self._bump()
                    break
                left = deadline - time.time()
                if left <= 0:
                    snap = self._snapshot(False)
                    snap["changed"] = False
                    return snap
                self._cond.wait(min(left, 4.0))
            snap = self._snapshot(True)
            snap["changed"] = True
            return snap


SESSION = RemoteSession()
