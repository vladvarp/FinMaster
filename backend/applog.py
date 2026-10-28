"""Журнал правок программы для вкладки «Лог» в консоли."""

from __future__ import annotations

import threading
import time
from collections import deque
from typing import Any

LIMIT = 400

_lock = threading.Lock()
_seq = 0
_events: deque[dict[str, Any]] = deque(maxlen=LIMIT)


def add(what: str, *, where: str = "", actor: str = "") -> None:
    """Короткая запись: что изменилось, где и кем."""
    global _seq
    text = " ".join(str(what or "").split())
    if not text:
        return
    item = {
        "where": " ".join(str(where or "").split())[:160],
        "what": text[:500],
        "actor": " ".join(str(actor or "").split())[:80],
    }
    with _lock:
        _seq += 1
        item["id"] = _seq
        item["ts"] = time.time()
        _events.append(item)


def since(last_id: int = 0) -> dict[str, Any]:
    with _lock:
        items = [dict(ev) for ev in _events if int(ev.get("id") or 0) > int(last_id or 0)]
        return {"events": items, "last_id": _seq, "total": len(_events)}


def clear() -> dict[str, Any]:
    global _seq
    with _lock:
        _events.clear()
        _seq = 0
        return {"events": [], "last_id": 0, "total": 0}
