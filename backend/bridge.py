"""Парный обмен для консоли: слева ответ компьютера, справа входящий запрос."""

from __future__ import annotations

import contextvars
import html
import re
import threading
import time
from collections import deque
from contextlib import contextmanager
from typing import Any, Iterator

LIMIT = 250

_lock = threading.Lock()
_current: contextvars.ContextVar[Box | None] = contextvars.ContextVar("fm_bridge", default=None)
_books: dict[str, deque[dict[str, Any]]] = {
    "telegram": deque(maxlen=LIMIT),
    "ngrok": deque(maxlen=LIMIT),
}
_seq = {"telegram": 0, "ngrok": 0}
_TAG = re.compile(r"<[^>]+>")


class Box:
    def __init__(self, channel: str, ask: str, ask_body: Any, who: str) -> None:
        self.channel = channel if channel in _books else "telegram"
        self.ask = str(ask or "")[:500]
        self.ask_body = ask_body
        self.who = str(who or "")[:120]
        self.parts: list[dict[str, Any]] = []
        self.done = False

    def note(self, method: str, body: Any) -> None:
        if self.done:
            return
        self.parts.append({"method": str(method or "")[:40], "body": body})
        if len(self.parts) > 40:
            self.parts = self.parts[-40:]


def note(method: str, body: Any) -> None:
    box = _current.get()
    if box is not None:
        box.note(method, body)


def current() -> Box | None:
    return _current.get()


def activate(box: Box) -> contextvars.Token:
    return _current.set(box)


def deactivate(token: contextvars.Token) -> None:
    _current.reset(token)


def open_box(channel: str, ask: str, ask_body: Any = None, who: str = "") -> Box:
    return Box(channel, ask, ask_body, who)


@contextmanager
def slot(channel: str, ask: str, ask_body: Any = None, who: str = "") -> Iterator[Box]:
    box = open_box(channel, ask, ask_body, who)
    token = activate(box)
    try:
        yield box
    finally:
        deactivate(token)
        commit(box)


def commit(box: Box) -> None:
    if box.done:
        return
    box.done = True
    _append(box.channel, box.ask, _reply_summary(box.parts), box.ask_body, box.parts, box.who)


def pair(channel: str, ask: str, reply: str, ask_body: Any = None, reply_body: Any = None, who: str = "") -> None:
    _append(channel, ask, reply, ask_body, reply_body, who)


def since(channel: str, last_id: int = 0) -> dict[str, Any]:
    book = _books.get(channel)
    if book is None:
        return {"events": [], "last_id": 0, "total": 0}
    with _lock:
        seq = _seq.get(channel, 0)
        items = [dict(ev) for ev in book if int(ev.get("id") or 0) > int(last_id or 0)]
        return {"events": items, "last_id": seq, "total": len(book)}


def clear(channel: str) -> dict[str, Any]:
    book = _books.get(channel)
    if book is None:
        return {"events": [], "last_id": 0, "total": 0}
    with _lock:
        book.clear()
        _seq[channel] = 0
        return {"events": [], "last_id": 0, "total": 0}


def sanitize(value: Any, depth: int = 0) -> Any:
    if depth > 8:
        return "…"
    if isinstance(value, bytes):
        return f"{len(value)} байт"
    if isinstance(value, dict):
        out: dict[str, Any] = {}
        for index, (key, item) in enumerate(value.items()):
            if index >= 50:
                out["…"] = f"ещё {len(value) - 50}"
                break
            low = str(key).lower()
            if low in {"token", "authtoken", "password"} or low.endswith("_token") or "secret" in low:
                out[str(key)] = "•" if item else ""
                continue
            if str(key) in {"document", "doc"} and isinstance(item, (dict, list)):
                title = item.get("title") if isinstance(item, dict) else ""
                out[str(key)] = {"объём": _size_hint(item), "title": str(title or "")[:80]}
                continue
            if str(key) in {"content", "png", "base64", "file"} and isinstance(item, str) and len(item) > 400:
                out[str(key)] = f"{len(item)} символов"
                continue
            out[str(key)] = sanitize(item, depth + 1)
        return out
    if isinstance(value, list):
        head = [sanitize(item, depth + 1) for item in value[:40]]
        if len(value) > 40:
            head.append(f"… ещё {len(value) - 40}")
        return head
    if isinstance(value, str):
        if len(value) > 4000:
            return value[:4000] + f"… ({len(value)} симв.)"
        return value
    if isinstance(value, (int, float, bool)) or value is None:
        return value
    return str(value)[:500]


def _append(channel: str, ask: str, reply: str, ask_body: Any, reply_body: Any, who: str) -> None:
    book = _books.get(channel)
    if book is None:
        return
    event = {
        "ts": time.time(),
        "channel": channel,
        "who": str(who or "")[:120],
        "ask": " ".join(str(ask or "").split())[:500] or "—",
        "reply": " ".join(str(reply or "").split())[:500] or "Без ответа",
        "ask_body": sanitize(ask_body),
        "reply_body": sanitize(reply_body),
    }
    with _lock:
        _seq[channel] = int(_seq.get(channel) or 0) + 1
        event["id"] = _seq[channel]
        book.append(event)


def _plain(text: str) -> str:
    raw = _TAG.sub(" ", str(text or ""))
    return " ".join(html.unescape(raw).split())


def _reply_summary(parts: list[dict[str, Any]]) -> str:
    texts: list[str] = []
    for part in parts:
        body = part.get("body") if isinstance(part.get("body"), dict) else {}
        req = body.get("запрос") if isinstance(body.get("запрос"), dict) else {}
        method = str(part.get("method") or "")
        if method == "sendChatAction":
            continue
        text = req.get("text") or req.get("caption") or ""
        if method == "sendPhoto":
            text = text or "фото"
        elif method == "sendDocument":
            text = text or "файл"
        elif method == "answerCallbackQuery" and not text:
            continue
        plain = _plain(str(text))
        if plain:
            texts.append(plain)
    if not texts:
        if not parts:
            return "Без ответа"
        last = str(parts[-1].get("method") or "ответ")
        return last
    head = texts[0][:220]
    if len(texts) > 1:
        return f"{head} · ещё {len(texts) - 1}"
    return head


def _size_hint(value: Any) -> str:
    if isinstance(value, dict):
        orders = value.get("orders")
        if isinstance(orders, list):
            return f"{len(orders)} заказов"
        return f"{len(value)} полей"
    if isinstance(value, list):
        return f"{len(value)} элементов"
    return "данные"
