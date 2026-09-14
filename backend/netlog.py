"""Кольцевой журнал сетевых событий для консоли в окне программы."""

from __future__ import annotations

import threading
import time
from collections import deque
from typing import Any

LIMIT = 500
THROTTLE = 1.6

_lock = threading.Lock()
_seq = 0
_events: deque[dict[str, Any]] = deque(maxlen=LIMIT)


def add(
    kind: str,
    text: str,
    *,
    level: str = "info",
    source: str = "",
    detail: str = "",
    key: str = "",
) -> dict[str, Any]:
    """Пишет событие. Повторы с тем же key в коротком окне отбрасываются."""
    global _seq
    now = time.time()
    kind = str(kind or "net")[:24]
    text = str(text or "").strip()[:400]
    level = level if level in {"info", "ok", "warn", "err"} else "info"
    source = str(source or "").strip()[:120]
    detail = str(detail or "").strip()[:400]
    key = str(key or "")[:80]
    with _lock:
        if key:
            for ev in reversed(_events):
                if ev.get("key") != key:
                    continue
                if now - float(ev.get("ts") or 0) <= THROTTLE:
                    return ev
                break
        _seq += 1
        ev = {
            "id": _seq,
            "ts": now,
            "level": level,
            "kind": kind,
            "source": source,
            "text": text,
            "detail": detail,
            "key": key,
        }
        _events.append(ev)
        return ev


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
