"""Telegram-бот: кнопки «Получить ссылку» и «Открыть FinMaster»."""

from __future__ import annotations

import json
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from typing import Any, Callable


ASK_TEXTS = {
    "получить ссылку",
    "ссылка",
    "link",
    "/link",
    "/url",
    "открыть",
    "открыть finmaster",
}


def _call(token: str, method: str, payload: dict[str, Any] | None = None, timeout: float = 15) -> dict[str, Any]:
    url = f"https://api.telegram.org/bot{urllib.parse.quote(token, safe=':-_')}/{method}"
    body = json.dumps(payload or {}).encode("utf-8")
    req = urllib.request.Request(url, data=body, headers={"Content-Type": "application/json"}, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            data = json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        raw = exc.read().decode("utf-8", errors="replace")
        try:
            data = json.loads(raw)
        except json.JSONDecodeError:
            raise RuntimeError("Telegram не ответил. Проверьте токен бота.") from exc
    except (OSError, urllib.error.URLError, TimeoutError) as exc:
        raise RuntimeError("Нет связи с Telegram. Проверьте интернет на компьютере.") from exc
    except json.JSONDecodeError as exc:
        raise RuntimeError("Telegram вернул непонятный ответ.") from exc
    if not data.get("ok"):
        desc = str(data.get("description") or "ошибка Telegram")
        if "unauthorized" in desc.lower():
            raise RuntimeError("Токен бота неверный. Скопируйте его заново у @BotFather.")
        if "chat not found" in desc.lower():
            raise RuntimeError("Чат не найден. Напишите боту любое сообщение и повторите.")
        raise RuntimeError(desc)
    return data


def _menu_keyboard() -> dict[str, Any]:
    return {
        "keyboard": [[{"text": "Получить ссылку"}]],
        "resize_keyboard": True,
        "is_persistent": True,
        "input_field_placeholder": "Нажмите «Получить ссылку»",
    }


def _open_keyboard(url: str) -> dict[str, Any]:
    rows = [[{"text": "Открыть FinMaster", "url": url}]]
    rows.append([{"text": "Обновить ссылку", "callback_data": "link"}])
    return {"inline_keyboard": rows}


def _ask_keyboard() -> dict[str, Any]:
    return {"inline_keyboard": [[{"text": "Получить ссылку", "callback_data": "link"}]]}


def send_html(
    token: str,
    chat_id: str,
    text: str,
    markup: dict[str, Any] | None = None,
    preview: bool = False,
) -> None:
    payload: dict[str, Any] = {
        "chat_id": chat_id,
        "text": text,
        "parse_mode": "HTML",
        "disable_web_page_preview": not preview,
    }
    if markup:
        payload["reply_markup"] = markup
    _call(token, "sendMessage", payload)


def _status(info: Any) -> dict[str, Any]:
    if isinstance(info, dict):
        return info
    return {"url": str(info or ""), "access": bool(info), "ngrok": False}


def is_internet(info: Any, url: str = "") -> bool:
    flags = _status(info)
    link = str(url or flags.get("url") or "")
    return bool(flags.get("ngrok") and ("ngrok" in link.lower() or link.startswith("https://")))


def channel_block(info: Any, url: str = "") -> str:
    flags = _status(info)
    if not flags.get("access"):
        return (
            "🚫 <b>ВХОД ЗАКРЫТ</b>\n"
            "на компьютере выключен доступ с телефона"
        )
    if is_internet(flags, url):
        return (
            "🌐 <b>ИНТЕРНЕТ</b>\n"
            "можно открыть из любой сети — Wi‑Fi, 4G, другая квартира"
        )
    extra = ""
    if flags.get("ngrok"):
        extra = "\nтуннель включён, но ссылка пока локальная"
    return (
        "📶 <b>ЛОКАЛЬНАЯ СЕТЬ</b>\n"
        "только та же Wi‑Fi, что и компьютер\n"
        "с мобильного интернета <b>не откроется</b>"
        + extra
    )


def toggle_warnings(info: Any) -> list[str]:
    flags = _status(info)
    notes: list[str] = []
    if not flags.get("access"):
        notes.append(
            "Откройте FinMaster → <b>Телефон</b> и включите тумблер доступа."
        )
    elif not flags.get("ngrok"):
        notes.append(
            "Чтобы зайти не из домашнего Wi‑Fi, включите тумблер <b>Через интернет (ngrok)</b>."
        )
    return notes


def welcome_text(info: Any = None) -> str:
    flags = _status(info)
    text = (
        "<b>FinMaster</b>\n"
        "учёт заказов с телефона\n\n"
        f"{channel_block(flags)}\n\n"
        "Нажмите <b>Получить ссылку</b> — пришлю вход на компьютер."
    )
    warns = toggle_warnings(flags)
    if warns:
        text += "\n\n" + "\n\n".join(warns)
    return text


def access_text(url: str, info: Any = None) -> str:
    flags = _status(info)
    link = str(url or flags.get("url") or "").strip()
    banner = channel_block(flags, link)
    warns = toggle_warnings(flags)
    if not flags.get("access"):
        return (
            f"{banner}\n\n"
            + "\n\n".join(warns)
            + "\n\nПосле включения нажмите «Получить ссылку» ещё раз."
        )
    if not link:
        return (
            f"{banner}\n\n"
            "Пока нет ссылки. Проверьте окно <b>Телефон</b> на компьютере."
            + ("\n\n" + "\n\n".join(warns) if warns else "")
        )
    if is_internet(flags, link):
        how = "Откроется из любой сети."
    else:
        how = "Откроется только в той же Wi‑Fi."
    text = (
        f"{banner}\n\n"
        f"<b>Ссылка готова.</b> {how}\n"
        "Кнопка ниже — «Открыть FinMaster».\n\n"
        f"<code>{link}</code>"
    )
    if warns:
        text += "\n\n" + "\n\n".join(warns)
    return text


def send_welcome(token: str, chat_id: str, info: Any = None) -> None:
    send_html(token, chat_id, welcome_text(info), _menu_keyboard())


def send_access(token: str, chat_id: str, url: str, info: Any = None) -> None:
    flags = _status(info)
    link = str(url or flags.get("url") or "").strip()
    can_open = bool(flags.get("access")) and link.startswith(("http://", "https://"))
    markup = _open_keyboard(link) if can_open else _ask_keyboard()
    send_html(token, chat_id, access_text(link, flags), markup, preview=False)


def send_link(token: str, chat_id: str, url: str, info: Any = None) -> str:
    token = str(token or "").strip()
    if not token:
        raise RuntimeError("Вставьте токен бота от @BotFather.")
    cid = str(chat_id or "").strip()
    if not cid:
        raise RuntimeError("Напишите боту /start — chat id подставится сам. Или вставьте его вручную.")
    send_access(token, cid, url, info)
    return cid


def setup_bot(token: str) -> None:
    try:
        _call(
            token,
            "setMyCommands",
            {
                "commands": [
                    {"command": "start", "description": "Открыть меню"},
                    {"command": "link", "description": "Получить ссылку на FinMaster"},
                ]
            },
        )
    except RuntimeError:
        pass


class TelegramBot:
    """Длинный опрос: кнопки меню и актуальная ссылка «Открыть FinMaster»."""

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._token = ""
        self._offset = 0
        self._error = ""
        self._running = False
        self._thread: threading.Thread | None = None
        self._on_request: Callable[[str], Any] | None = None
        self._on_offset: Callable[[int], None] | None = None
        self._skip = True

    def snapshot(self) -> dict[str, Any]:
        with self._lock:
            return {
                "listening": self._running and bool(self._token),
                "error": self._error,
            }

    def start(
        self,
        token: str,
        offset: int = 0,
        on_request: Callable[[str], Any] | None = None,
        on_offset: Callable[[int], None] | None = None,
    ) -> None:
        token = str(token or "").strip()
        with self._lock:
            same = token == self._token and self._running
            self._on_request = on_request
            self._on_offset = on_offset
            if same:
                return
            self._token = token
            self._offset = max(0, int(offset or 0))
            self._skip = self._offset <= 0
            self._error = ""
            self._running = bool(token)
        if token:
            setup_bot(token)
        if token and (self._thread is None or not self._thread.is_alive()):
            self._thread = threading.Thread(target=self._loop, name="fm-telegram", daemon=True)
            self._thread.start()

    def stop(self) -> None:
        with self._lock:
            self._running = False
            self._token = ""

    def _state(self) -> tuple[str, int, bool]:
        with self._lock:
            return self._token, self._offset, self._running

    def _set_offset(self, value: int) -> None:
        with self._lock:
            self._offset = value
            cb = self._on_offset
        if cb:
            try:
                cb(value)
            except Exception:
                pass

    def _status_for(self, chat_id: str) -> dict[str, Any]:
        with self._lock:
            cb = self._on_request
        if not cb:
            return {"url": "", "access": False, "ngrok": False}
        try:
            return _status(cb(str(chat_id)))
        except Exception:
            return {"url": "", "access": False, "ngrok": False}

    def _loop(self) -> None:
        while True:
            token, offset, running = self._state()
            if not running or not token:
                return
            try:
                payload: dict[str, Any] = {"timeout": 25, "allowed_updates": ["message", "callback_query"]}
                if offset:
                    payload["offset"] = offset
                data = _call(token, "getUpdates", payload, timeout=32)
                updates = [u for u in (data.get("result") or []) if isinstance(u, dict)]
                skip = False
                with self._lock:
                    skip = self._skip
                    if updates:
                        self._skip = False
                last = offset
                for upd in updates:
                    last = int(upd.get("update_id") or last) + 1
                    if skip:
                        continue
                    self._handle(token, upd)
                if last != offset:
                    self._set_offset(last)
                if not updates:
                    time.sleep(0.4)
            except RuntimeError as exc:
                with self._lock:
                    self._error = str(exc)
                    still = self._running and self._token == token
                if not still:
                    return
                time.sleep(4)
            except Exception:
                time.sleep(2)

    def _handle(self, token: str, upd: dict[str, Any]) -> None:
        try:
            if isinstance(upd.get("callback_query"), dict):
                self._on_callback(token, upd["callback_query"])
                return
            msg = upd.get("message")
            if not isinstance(msg, dict):
                return
            sender = msg.get("from") if isinstance(msg.get("from"), dict) else {}
            if sender.get("is_bot"):
                return
            chat = msg.get("chat") if isinstance(msg.get("chat"), dict) else {}
            cid = chat.get("id")
            if cid is None:
                return
            text = str(msg.get("text") or "").strip()
            low = text.lower()
            if low in {"/start", "/help", "меню", "start"}:
                send_welcome(token, str(cid), self._status_for(str(cid)))
            elif low in ASK_TEXTS or low.startswith("/link"):
                info = self._status_for(str(cid))
                send_access(token, str(cid), str(info.get("url") or ""), info)
            else:
                info = self._status_for(str(cid))
                warns = toggle_warnings(info)
                text = f"{channel_block(info)}\n\nНажмите кнопку, чтобы получить ссылку."
                if warns:
                    text = text + "\n\n" + "\n\n".join(warns)
                send_html(token, str(cid), text, _ask_keyboard())
            with self._lock:
                self._error = ""
        except RuntimeError as exc:
            with self._lock:
                self._error = str(exc)

    def _on_callback(self, token: str, query: dict[str, Any]) -> None:
        qid = str(query.get("id") or "")
        data = str(query.get("data") or "")
        chat = {}
        if isinstance(query.get("message"), dict) and isinstance(query["message"].get("chat"), dict):
            chat = query["message"]["chat"]
        elif isinstance(query.get("from"), dict):
            chat = {"id": query["from"].get("id")}
        cid = chat.get("id")
        if qid:
            try:
                _call(token, "answerCallbackQuery", {"callback_query_id": qid, "text": "Обновляю ссылку…"})
            except RuntimeError:
                pass
        if cid is None or data != "link":
            return
        info = self._status_for(str(cid))
        send_access(token, str(cid), str(info.get("url") or ""), info)


BOT = TelegramBot()
