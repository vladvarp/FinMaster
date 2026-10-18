"""Telegram-бот: отчёты, заказы, снимки и ссылка на телефон."""

from __future__ import annotations

import json
import os
import secrets
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from typing import Any, Callable

from backend import netlog
from backend import storage
from backend.document import normalize_document
from backend.finance import (
    html_esc,
    is_frozen,
    money_decimals,
    line_kind,
    line_totals,
    money,
    order_totals,
    qty_text,
    split_lines,
    type_index,
)
from backend.remote import SESSION as REMOTE
from backend import snapshot as snapmod
from backend.pdf_bridge import PDF_BRIDGE


ASK_LINK = {
    "получить ссылку",
    "ссылка",
    "link",
    "/link",
    "/url",
    "открыть",
    "открыть finmaster",
}
ASK_NEW_LINK = {"новая ссылка", "/newlink", "/rotate", "new link"}
ASK_REPORTS = {"отчёты", "отчеты", "/reports", "/files"}
ASK_ORDERS = {"заказы", "/orders"}
ASK_SNAP = {"снимок", "/snap"}
ASK_MENU = {"/start", "/help", "меню", "start", "help"}

PAGE = 6
SNAP_THEMES = list(snapmod.THEMES.keys())


def _share_profiles() -> list[dict[str, Any]]:
    """Пользовательские профили полей снимка — те же, что в окне на компьютере."""
    raw = storage.ui_prefs().get("share_profiles")
    if not isinstance(raw, list):
        return []
    known = set(snapmod.FIELD_IDS)
    out: list[dict[str, Any]] = []
    for item in raw:
        if not isinstance(item, dict):
            continue
        name = " ".join(str(item.get("name") or "").split())
        fields = [str(field) for field in (item.get("fields") or []) if isinstance(field, str) and field in known]
        if not name or not fields:
            continue
        out.append(
            {
                "name": name[:80],
                "fields": snapmod.normalize_fields(fields),
                "hideLabels": bool(item.get("hideLabels")),
                "hideStamp": bool(item.get("hideStamp")),
            }
        )
        if len(out) >= 40:
            break
    return out


def _pdf_opts(raw: Any = None) -> dict[str, Any]:
    return snapmod.normalize_pdf_opts(raw)


def _default_pdf_opts() -> dict[str, Any]:
    """Обычная вёрстка PDF. Поля, тема и заказы берутся из меню снимка в боте, не из окна на компьютере."""
    return _pdf_opts(None)


def _pdf_profiles() -> list[dict[str, Any]]:
    """Профили оформления PDF — те же, что в окне PDF на компьютере."""
    raw = storage.ui_prefs().get("pdf_profiles")
    if not isinstance(raw, list):
        return []
    out: list[dict[str, Any]] = []
    for item in raw:
        if not isinstance(item, dict):
            continue
        name = " ".join(str(item.get("name") or "").split())
        opts = item.get("opts")
        if not name or not isinstance(opts, dict):
            continue
        out.append({"name": name[:80], "opts": _pdf_opts(opts)})
        if len(out) >= 40:
            break
    return out


def _pdf_profile_on(opts: dict[str, Any], profile: dict[str, Any]) -> bool:
    cur = _pdf_opts(opts)
    saved = profile.get("opts") or {}
    return all(str(cur.get(key)) == str(saved.get(key)) for key in snapmod.PDF_DEFAULTS)


def _chunk_btns(items: list[dict[str, str]], cols: int = 2) -> list[list[dict[str, str]]]:
    rows: list[list[dict[str, str]]] = []
    row: list[dict[str, str]] = []
    for item in items:
        row.append(item)
        if len(row) >= cols:
            rows.append(row)
            row = []
    if row:
        rows.append(row)
    return rows


def _call(token: str, method: str, payload: dict[str, Any] | None = None, timeout: float = 15) -> dict[str, Any]:
    url = f"https://api.telegram.org/bot{urllib.parse.quote(token, safe=':-_')}/{method}"
    body = json.dumps(payload or {}).encode("utf-8")
    req = urllib.request.Request(url, data=body, headers={"Content-Type": "application/json"}, method="POST")
    return _read(req, timeout)


def _read(req: urllib.request.Request, timeout: float) -> dict[str, Any]:
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
        low = desc.lower()
        if "unauthorized" in low:
            raise RuntimeError("Токен бота неверный. Скопируйте его заново у @BotFather.")
        if "chat not found" in low:
            raise RuntimeError("Чат не найден. Напишите боту любое сообщение и повторите.")
        if "message is not modified" in low:
            return data
        raise RuntimeError(desc)
    return data


def _call_file(
    token: str,
    method: str,
    fields: dict[str, Any],
    file_field: str,
    filename: str,
    data: bytes,
    mime: str,
) -> dict[str, Any]:
    boundary = "----FM" + secrets.token_hex(8)
    chunks: list[bytes] = []
    for key, value in fields.items():
        chunks.append(
            (
                f"--{boundary}\r\nContent-Disposition: form-data; name=\"{key}\"\r\n\r\n{value}\r\n"
            ).encode("utf-8")
        )
    chunks.append(
        (
            f"--{boundary}\r\nContent-Disposition: form-data; name=\"{file_field}\"; "
            f"filename=\"{filename}\"\r\nContent-Type: {mime}\r\n\r\n"
        ).encode("utf-8")
    )
    chunks.append(data)
    chunks.append(f"\r\n--{boundary}--\r\n".encode("utf-8"))
    url = f"https://api.telegram.org/bot{urllib.parse.quote(token, safe=':-_')}/{method}"
    req = urllib.request.Request(
        url,
        data=b"".join(chunks),
        headers={"Content-Type": f"multipart/form-data; boundary={boundary}"},
        method="POST",
    )
    return _read(req, 45)


def _web_app_url(url: str) -> str:
    link = str(url or "").strip()
    return link if link.startswith("https://") else ""


def _menu_keyboard(app_url: str = "") -> dict[str, Any]:
    second: list[dict[str, Any]] = [{"text": "Ссылка"}, {"text": "Меню"}]
    app = _web_app_url(app_url)
    if app:
        second = [{"text": "Открыть", "web_app": {"url": app}}, {"text": "Ссылка"}, {"text": "Меню"}]
    return {
        "keyboard": [[{"text": "Отчёты"}, {"text": "Заказы"}, {"text": "Снимок"}], second, [{"text": "Новая ссылка"}]],
        "resize_keyboard": True,
        "input_field_placeholder": "Отчёты, заказы, снимок или поиск",
    }


def _inline(rows: list[list[dict[str, Any]]]) -> dict[str, Any]:
    return {"inline_keyboard": rows}


def _btn(text: str, data: str) -> dict[str, Any]:
    return {"text": text, "url": data} if data.startswith("http") else {"text": text, "callback_data": data}


def _open_btn(text: str, url: str) -> dict[str, Any]:
    app = _web_app_url(url)
    if app:
        return {"text": text, "web_app": {"url": app}}
    return _btn(text, url)


_last_menu = ""
_menu_lock = threading.Lock()
_chat_tail: dict[str, int] = {}


def _bump_tail(chat_id: str, message_id: int | None) -> None:
    """Запоминает самое нижнее сообщение чата, чтобы меню не оставалось выше переписки."""
    if message_id is None:
        return
    key = str(chat_id)
    mid = int(message_id)
    if mid > _chat_tail.get(key, 0):
        _chat_tail[key] = mid


def set_menu_button(token: str, url: str = "", force: bool = False, chat_id: str = "") -> None:
    """Кнопка меню бота: Mini App по HTTPS, иначе обычные команды."""
    global _last_menu
    token = str(token or "").strip()
    if not token:
        return
    app = _web_app_url(url)
    cid = str(chat_id or "").strip()
    key = f"{token[-12:]}:{cid}:{app}"
    if not force:
        with _menu_lock:
            if key == _last_menu:
                return
    if app:
        payload: dict[str, Any] = {
            "menu_button": {"type": "web_app", "text": "Открыть", "web_app": {"url": app}}
        }
    else:
        payload = {"menu_button": {"type": "commands"}}
    if cid:
        payload["chat_id"] = cid
    try:
        _call(token, "setChatMenuButton", payload)
        with _menu_lock:
            _last_menu = key
        netlog.add(
            "telegram",
            "Mini App в меню бота" if app else "Меню бота без Mini App",
            level="ok" if app else "info",
            key="tg-menu",
        )
    except RuntimeError as exc:
        netlog.add("telegram", f"Не обновилась кнопка «Открыть»: {exc}", level="err", key="tg-menu")


def push_open_controls(token: str, chat_id: str | list[str], url: str, notice: str = "") -> None:
    """Сбрасывает кэш Telegram у «Открыть» и ставит клавиатуру с актуальным URL."""
    token = str(token or "").strip()
    link = str(url or "").strip()
    if not token:
        return
    ids: list[str] = []
    for item in chat_id if isinstance(chat_id, list) else [chat_id]:
        cid = str(item or "").strip()
        if cid and cid not in ids:
            ids.append(cid)
    set_menu_button(token, link, force=True)
    if not ids:
        return
    text = notice or "Ссылка на телефон обновлена. Нажмите <b>Открыть</b>."
    kb = _menu_keyboard(link)
    for cid in ids:
        set_menu_button(token, link, force=True, chat_id=cid)
        try:
            _call(
                token,
                "sendMessage",
                {
                    "chat_id": cid,
                    "text": "Старая ссылка отключена.",
                    "reply_markup": {"remove_keyboard": True},
                },
            )
            time.sleep(0.35)
            send_html(token, cid, text, kb)
            netlog.add("telegram", "Клавиатура бота с новой ссылкой", source=f"chat {cid}", key=f"tg-kb-{cid}")
        except RuntimeError as exc:
            netlog.add("telegram", f"Не обновилась клавиатура: {exc}", level="err", key=f"tg-kb-{cid}")


def send_html(
    token: str,
    chat_id: str,
    text: str,
    markup: dict[str, Any] | None = None,
    preview: bool = False,
    message_id: int | None = None,
) -> int | None:
    payload: dict[str, Any] = {
        "chat_id": chat_id,
        "text": text,
        "parse_mode": "HTML",
        "disable_web_page_preview": not preview,
    }
    if markup:
        payload["reply_markup"] = markup
    if message_id:
        payload["message_id"] = message_id
        try:
            _call(token, "editMessageText", payload)
            return message_id
        except RuntimeError:
            payload.pop("message_id", None)
    data = _call(token, "sendMessage", payload)
    result = data.get("result") if isinstance(data.get("result"), dict) else {}
    mid = result.get("message_id")
    sent = int(mid) if mid is not None else (int(message_id) if message_id else None)
    _bump_tail(chat_id, sent)
    return sent


def send_photo(token: str, chat_id: str, png: bytes, caption: str, filename: str) -> dict[str, Any]:
    data = _call_file(
        token,
        "sendPhoto",
        {"chat_id": chat_id, "caption": caption[:1024]},
        "photo",
        filename,
        png,
        "image/png",
    )
    result = data.get("result") if isinstance(data.get("result"), dict) else {}
    if result.get("message_id") is not None:
        _bump_tail(chat_id, int(result["message_id"]))
    return data


def send_document(
    token: str,
    chat_id: str,
    body: bytes,
    filename: str,
    caption: str = "",
    mime: str = "text/plain",
) -> dict[str, Any]:
    fields: dict[str, Any] = {"chat_id": chat_id}
    if caption:
        fields["caption"] = caption[:1024]
    data = _call_file(token, "sendDocument", fields, "document", filename, body, mime)
    result = data.get("result") if isinstance(data.get("result"), dict) else {}
    if result.get("message_id") is not None:
        _bump_tail(chat_id, int(result["message_id"]))
    return data


def _photo_file_id(data: dict[str, Any]) -> str:
    result = data.get("result") if isinstance(data, dict) else {}
    photos = result.get("photo") if isinstance(result, dict) else None
    if not isinstance(photos, list) or not photos:
        return ""
    last = photos[-1] if isinstance(photos[-1], dict) else {}
    return str(last.get("file_id") or "")


def _prepared_share_id(token: str, user_id: int, file_id: str, caption: str) -> str:
    if not token or not user_id or not file_id:
        return ""
    try:
        data = _call(
            token,
            "savePreparedInlineMessage",
            {
                "user_id": int(user_id),
                "result": {
                    "type": "photo",
                    "id": "snap",
                    "photo_file_id": file_id,
                    "caption": caption[:1024],
                },
                "allow_user_chats": True,
                "allow_bot_chats": True,
                "allow_group_chats": True,
                "allow_channel_chats": True,
            },
        )
    except RuntimeError:
        return ""
    result = data.get("result") if isinstance(data, dict) else {}
    return str(result.get("id") or "") if isinstance(result, dict) else ""


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
        return "🚫 <b>ВХОД С ТЕЛЕФОНА ЗАКРЫТ</b>\nотчёты в боте всё равно доступны, пока открыт FinMaster"
    if is_internet(flags, url):
        return "🌐 <b>ИНТЕРНЕТ</b>\nтелефон можно открыть из любой сети"
    extra = "\nтуннель включён, но ссылка пока локальная" if flags.get("ngrok") else ""
    return "📶 <b>ЛОКАЛЬНАЯ СЕТЬ</b>\nтелефон откроется только в той же Wi‑Fi" + extra


def toggle_warnings(info: Any) -> list[str]:
    flags = _status(info)
    notes: list[str] = []
    if not flags.get("access"):
        notes.append("Нажмите <b>Включить доступ к веб</b> или тумблер «Включить доступ» в окне <b>Телефон</b> на компьютере.")
    elif not flags.get("ngrok"):
        notes.append("Чтобы зайти не из домашнего Wi‑Fi, включите тумблер <b>Через интернет (ngrok)</b>.")
    return notes


def welcome_text(info: Any = None) -> str:
    return (
        "<b>FinMaster</b>\n"
        "отчёты, заказы и снимки прямо здесь\n\n"
        f"{channel_block(info)}\n\n"
        "Кнопки внизу: <b>Отчёты</b>, <b>Заказы</b>, <b>Снимок</b>, <b>Ссылка</b>, <b>Новая ссылка</b>.\n"
        "Если включён интернет — «Открыть» запускает приложение внутри Telegram.\n"
        "В списке заказов можно написать имя или номер — найду."
    )


def access_text(url: str, info: Any = None) -> str:
    flags = _status(info)
    link = str(url or flags.get("url") or "").strip()
    banner = channel_block(flags, link)
    warns = toggle_warnings(flags)
    if not flags.get("access"):
        return f"{banner}\n\n" + "\n\n".join(warns)
    if not link:
        return f"{banner}\n\nПока нет ссылки. Проверьте окно <b>Телефон</b> на компьютере."
    how = "Откроется из любой сети, внутри Telegram." if is_internet(flags, link) else "Откроется только в той же Wi‑Fi."
    action = "Нажмите «Открыть приложение»." if _web_app_url(link) else "Нажмите «Открыть FinMaster»."
    text = f"{banner}\n\n<b>Ссылка готова.</b> {how} {action}\n\n<code>{html_esc(link)}</code>"
    if warns:
        text += "\n\n" + "\n\n".join(warns)
    return text


def send_welcome(token: str, chat_id: str, info: Any = None) -> None:
    flags = _status(info)
    send_html(token, chat_id, welcome_text(info), _menu_keyboard(str(flags.get("url") or "")))


def web_access_btn(info: Any, data: str = "Wa") -> dict[str, Any]:
    on = bool(_status(info).get("access"))
    return _btn("Выключить доступ к веб" if on else "Включить доступ к веб", data)


def access_rows(url: str, info: Any = None) -> list[list[dict[str, Any]]]:
    flags = _status(info)
    link = str(url or flags.get("url") or "").strip()
    can_open = bool(flags.get("access")) and link.startswith(("http://", "https://"))
    rows: list[list[dict[str, Any]]] = []
    if can_open:
        rows.append([_open_btn("Открыть приложение" if _web_app_url(link) else "Открыть FinMaster", link)])
        rows.append([_btn("Обновить ссылку", "L"), _btn("Новая ссылка", "N")])
    else:
        rows.append([_btn("Получить ссылку", "L")])
    rows.append([web_access_btn(flags, "Wa")])
    rows.append([_btn("Отчёты", "R"), _btn("Заказы", "O")])
    return rows


def send_access(token: str, chat_id: str, url: str, info: Any = None, message_id: int | None = None) -> None:
    flags = _status(info)
    link = str(url or flags.get("url") or "").strip()
    send_html(token, chat_id, access_text(link, flags), _inline(access_rows(link, flags)), preview=False, message_id=message_id)


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
                    {"command": "start", "description": "Меню"},
                    {"command": "reports", "description": "Отчёты"},
                    {"command": "orders", "description": "Заказы"},
                    {"command": "snap", "description": "Снимок для заказчика"},
                    {"command": "link", "description": "Ссылка на телефон"},
                    {"command": "newlink", "description": "Новая ссылка на телефон"},
                ]
            },
        )
    except RuntimeError:
        pass


def _recent_items() -> list[dict[str, Any]]:
    items: list[dict[str, Any]] = []
    for item in storage.load_config().get("recent") or []:
        if not isinstance(item, dict) or not item.get("path"):
            continue
        if str(item.get("path") or "").lower().endswith(".fbak"):
            continue
        items.append({**item, "exists": os.path.exists(str(item.get("path")))})
    return items


def _library_items() -> list[dict[str, Any]]:
    return list((storage.list_library_reports().get("items") or []))


def _path_allowed(path: str) -> bool:
    if not path or not str(path).lower().endswith(".fmaster") or not os.path.isfile(path):
        return False
    if REMOTE.path and storage.same_path(REMOTE.path, path):
        return True
    try:
        storage.library_file_path(path)
        return True
    except (ValueError, FileNotFoundError, OSError):
        return any(storage.same_path(str(item.get("path") or ""), path) for item in _recent_items())


def _load_doc(path: str) -> tuple[dict[str, Any], bool]:
    if REMOTE.enabled and isinstance(REMOTE.doc, dict) and storage.same_path(REMOTE.path, path):
        return REMOTE.doc, True
    raw = json.loads(storage.read_text(path))
    return normalize_document(raw), False


def _live_path() -> str:
    return str(REMOTE.path or "") if REMOTE.enabled else ""


def _order_label(order: dict[str, Any], currency: str, types: dict[str, str] | None = None, decimals: int = 2) -> str:
    tot = order_totals(order, types)
    title = " · ".join(part for part in (str(order.get("number") or "—"), str(order.get("name") or "без названия")) if part)
    if tot["unpaid"] > 0.005:
        extra = f"долг {money(tot['unpaid'], currency, decimals)}"
    else:
        extra = "оплачен" if tot["after"] > 0.005 else money(tot["after"], currency, decimals)
    return f"{title} · {extra}"


def _clip(text: str, limit: int = 56) -> str:
    text = " ".join(str(text or "").split())
    return text if len(text) <= limit else text[: limit - 1] + "…"


class ChatSession:
    def __init__(self) -> None:
        self.screen = "home"
        self.path = ""
        self.live = False
        self.filter = "all"
        self.search = ""
        self.rpage = 0
        self.opage = 0
        self.reports: list[str] = []
        self.orders: list[str] = []
        self.order_id = ""
        self.awaiting = ""
        self.message_id: int | None = None
        self.snap: dict[str, Any] = self._fresh_snap()

    def _fresh_snap(self) -> dict[str, Any]:
        return {
            "fields": list(snapmod.PRESETS["invoice"]),
            "theme": "teal",
            "hide_labels": False,
            "hide_stamp": False,
            "title": "",
            "order_ids": [],
            "extra_orders": [],
            "skip": {},
            "pay_filter": "all",
            "pdf_opts": _default_pdf_opts(),
            "ready": False,
        }


class TelegramBot:
    """Опрос Telegram: меню, отчёты, заказы и снимки."""

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._token = ""
        self._offset = 0
        self._error = ""
        self._running = False
        self._thread: threading.Thread | None = None
        self._on_request: Callable[[str], Any] | None = None
        self._on_offset: Callable[[int], None] | None = None
        self._on_rotate: Callable[[], Any] | None = None
        self._on_access: Callable[[bool], Any] | None = None
        self._skip = True
        self._chats: dict[str, ChatSession] = {}

    def snapshot(self) -> dict[str, Any]:
        with self._lock:
            return {"listening": self._running and bool(self._token), "error": self._error}

    def probe(self, token: str = "") -> dict[str, Any]:
        """Проверяет токен запросом getMe, не трогая очередь сообщений."""
        with self._lock:
            active = self._token
            token = str(token or active or "").strip()
            listening = bool(self._running and active and active == token)
        if not token:
            return {"ok": False, "listening": False, "error": "Токен Telegram-бота не сохранён."}
        try:
            data = _call(token, "getMe", timeout=8)
        except RuntimeError as exc:
            message = str(exc)
            with self._lock:
                if self._token == token:
                    self._error = message
            return {"ok": False, "listening": listening, "error": message}
        user = data.get("result") if isinstance(data.get("result"), dict) else {}
        username = str(user.get("username") or "").strip()
        with self._lock:
            if self._token == token:
                self._error = ""
                listening = bool(self._running and self._token)
        return {"ok": True, "listening": listening, "username": username, "error": ""}

    def token(self) -> str:
        with self._lock:
            return self._token

    def chat_ids(self) -> list[str]:
        with self._lock:
            return [str(cid) for cid in self._chats.keys()]

    def deliver_webapp_snapshot(
        self,
        png: bytes,
        filename: str,
        caption: str,
        mode: str = "share",
        user_id: int = 0,
    ) -> dict[str, Any]:
        token, _, running = self._state()
        if not token or not running:
            raise RuntimeError("Бот Telegram выключен. Включите его в окне «Телефон».")
        chat_id = str(storage.remote_settings().get("telegram_chat_id") or "").strip()
        if not chat_id:
            raise RuntimeError("Напишите боту /start — без привязанного чата снимок некуда отправить.")
        name = str(filename or "finmaster-snapshot.png").replace("\\", "_").replace("/", "_")
        if not name.lower().endswith(".png"):
            name = f"{name}.png"
        title = str(caption or "Снимок заказа")[:1024]
        if mode == "save":
            send_document(token, chat_id, png, name, title, "image/png")
            netlog.add("telegram", "Mini App отправил PNG в чат", source=f"chat {chat_id}", key=f"tg-snap-{chat_id}")
            return {"ok": True, "via": "chat"}
        sent = send_photo(token, chat_id, png, title, name)
        uid = int(user_id or 0)
        if uid <= 0 and chat_id.lstrip("-").isdigit():
            uid = int(chat_id)
        share_id = _prepared_share_id(token, uid, _photo_file_id(sent), title)
        netlog.add("telegram", "Mini App отправил снимок", source=f"chat {chat_id}", key=f"tg-snap-{chat_id}")
        return {"ok": True, "via": "chat", "share_id": share_id}

    def start(
        self,
        token: str,
        offset: int = 0,
        on_request: Callable[[str], Any] | None = None,
        on_offset: Callable[[int], None] | None = None,
        on_rotate: Callable[[], Any] | None = None,
        on_access: Callable[[bool], Any] | None = None,
    ) -> None:
        token = str(token or "").strip()
        with self._lock:
            same = token == self._token and self._running
            self._on_request = on_request
            self._on_offset = on_offset
            self._on_rotate = on_rotate
            self._on_access = on_access
            if not same:
                self._token = token
                self._offset = max(0, int(offset or 0))
                self._skip = self._offset <= 0
                self._error = ""
                self._running = bool(token)
        if token:
            setup_bot(token)
        if same:
            return
        if token:
            netlog.add("telegram", "Бот слушает обновления", level="ok", key="tg-on")
        if token and (self._thread is None or not self._thread.is_alive()):
            self._thread = threading.Thread(target=self._loop, name="fm-telegram", daemon=True)
            self._thread.start()

    def stop(self) -> None:
        with self._lock:
            was = self._running
            self._running = False
            self._token = ""
        if was:
            netlog.add("telegram", "Бот остановлен", level="warn", key="tg-off")

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

    def _reply_kb(self, chat_id: str) -> dict[str, Any]:
        return _menu_keyboard(str(self._status_for(chat_id).get("url") or ""))

    def _chat(self, chat_id: str) -> ChatSession:
        with self._lock:
            session = self._chats.get(chat_id)
            if session is None:
                session = ChatSession()
                self._chats[chat_id] = session
            return session

    def _authorized(self, chat_id: str) -> bool:
        saved = str(storage.remote_settings().get("telegram_chat_id") or "")
        if not saved:
            storage.save_remote_settings(telegram_chat_id=str(chat_id))
            return True
        return saved == str(chat_id)

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
                netlog.add("telegram", str(exc), level="err", key="tg-error")
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
            if msg.get("message_id") is not None:
                _bump_tail(str(cid), int(msg["message_id"]))
            text = str(msg.get("text") or "").strip()
            netlog.add(
                "telegram",
                f"Сообщение: {text[:80] or 'без текста'}",
                source=f"chat {cid}",
                key=f"tg-msg-{cid}",
            )
            self._on_text(token, str(cid), text)
            with self._lock:
                self._error = ""
        except RuntimeError as exc:
            with self._lock:
                self._error = str(exc)

    def _on_text(self, token: str, chat_id: str, text: str) -> None:
        low = text.lower()
        info = self._status_for(chat_id)
        if low in ASK_MENU or not text:
            send_welcome(token, chat_id, info)
            self._show(token, chat_id, "home")
            return
        if not self._authorized(chat_id):
            send_html(
                token,
                chat_id,
                "Этот бот уже привязан к другому чату. В FinMaster → Телефон очистите Chat id, если хотите сменить аккаунт.",
            )
            return
        session = self._chat(chat_id)
        if session.awaiting == "title":
            session.snap["title"] = text[:80]
            session.awaiting = ""
            self._show(token, chat_id, "look")
            return
        if low in ASK_LINK:
            send_access(token, chat_id, str(info.get("url") or ""), info)
            return
        if low in ASK_NEW_LINK:
            self._ask_new_link(token, chat_id)
            return
        if low in ASK_REPORTS:
            self._show(token, chat_id, "reports")
            return
        if low in ASK_ORDERS:
            self._show(token, chat_id, "orders")
            return
        if low in ASK_SNAP:
            doc, _ = self._doc_of(session)
            if not (session.path or _live_path() or doc.get("orders")):
                send_html(token, chat_id, "Сначала выберите отчёт.", self._reply_kb(chat_id))
                self._show(token, chat_id, "reports")
                return
            self._prepare_snap(session, reset=not bool(session.snap.get("ready")))
            self._show(token, chat_id, "snap")
            return
        if session.screen in {"orders", "order", "home"} and text:
            session.search = text
            session.opage = 0
            self._show(token, chat_id, "orders")
            return
        send_html(token, chat_id, "Нажмите <b>Отчёты</b>, <b>Заказы</b>, <b>Снимок</b> или <b>Меню</b>.", self._reply_kb(chat_id))

    def _on_callback(self, token: str, query: dict[str, Any]) -> None:
        qid = str(query.get("id") or "")
        data = str(query.get("data") or "")
        chat = {}
        if isinstance(query.get("message"), dict) and isinstance(query["message"].get("chat"), dict):
            chat = query["message"]["chat"]
            mid = query["message"].get("message_id")
        else:
            mid = None
        if isinstance(query.get("from"), dict) and not chat:
            chat = {"id": query["from"].get("id")}
        cid = chat.get("id")
        notice = ""
        if data == "L":
            notice = "Обновляю ссылку…"
        elif data == "N":
            notice = "Новая ссылка…"
        elif data == "Ny":
            notice = "Выпускаю новую ссылку…"
        elif data in {"SP", "ST", "Sdp"}:
            notice = "Готовлю снимок…"
        elif data in {"Wh", "Wa"}:
            notice = "Переключаю доступ…"
        if qid:
            try:
                payload = {"callback_query_id": qid}
                if notice:
                    payload["text"] = notice
                _call(token, "answerCallbackQuery", payload)
            except RuntimeError:
                pass
        if cid is None:
            return
        chat_id = str(cid)
        labels = {
            "H": "меню",
            "R": "отчёты",
            "O": "заказы",
            "L": "ссылка",
            "N": "новая ссылка",
            "Ny": "подтверждение новой ссылки",
            "Nn": "отмена новой ссылки",
            "S": "снимок",
            "SB": "снимок",
            "So": "оформление снимка",
            "Sv": "профили снимка",
            "PC": "открыть на ПК",
            "D": "детали заказа",
            "SP": "снимок PNG",
            "Sd": "шаблон PDF",
            "Sdp": "снимок PDF",
            "ST": "снимок текстом",
            "Wh": "доступ к веб",
            "Wa": "доступ к веб",
        }
        hint = labels.get(data)
        if not hint:
            if data.startswith("Oi:"):
                hint = "заказ"
            elif data.startswith("Ri:"):
                hint = "открыть отчёт"
            elif data.startswith("Of:"):
                hint = "фильтр заказов"
            else:
                hint = data or "кнопка"
        netlog.add("telegram", f"Кнопка: {hint}", source=f"chat {chat_id}", key=f"tg-cb-{chat_id}")
        if data == "L":
            info = self._status_for(chat_id)
            send_access(token, chat_id, str(info.get("url") or ""), info)
            return
        if data == "N":
            self._ask_new_link(token, chat_id)
            return
        if data == "Nn":
            info = self._status_for(chat_id)
            send_access(token, chat_id, str(info.get("url") or ""), info)
            return
        if data == "Ny":
            self._rotate_link(token, chat_id)
            return
        if not self._authorized(chat_id):
            send_html(token, chat_id, "Этот бот уже привязан к другому чату.")
            return
        session = self._chat(chat_id)
        if mid is not None:
            session.message_id = int(mid)
        self._dispatch(token, chat_id, data)

    def _toggle_web_access(self, token: str, chat_id: str, home: bool) -> None:
        info = self._status_for(chat_id)
        want = not bool(info.get("access"))
        with self._lock:
            cb = self._on_access
        if cb is None:
            send_html(token, chat_id, "Переключить доступ можно в окне «Телефон» на компьютере.")
            return
        try:
            result = cb(want)
        except Exception as exc:
            send_html(token, chat_id, f"Не удалось переключить доступ: {html_esc(str(exc))}")
            return
        flags = _status(result if isinstance(result, dict) else None)
        if home:
            self._show(token, chat_id, "home")
            return
        session = self._chat(chat_id)
        send_access(token, chat_id, str(flags.get("url") or ""), flags, session.message_id)

    def _dispatch(self, token: str, chat_id: str, data: str) -> None:
        session = self._chat(chat_id)
        if data in {"Wh", "Wa"}:
            self._toggle_web_access(token, chat_id, data == "Wh")
        elif data == "H":
            self._show(token, chat_id, "home")
        elif data == "R":
            session.rpage = 0
            self._show(token, chat_id, "reports")
        elif data.startswith("Rp:"):
            session.rpage = max(0, int(data[3:] or 0))
            self._show(token, chat_id, "reports")
        elif data.startswith("Ri:"):
            self._open_report(token, chat_id, int(data[3:] or -1))
        elif data == "O":
            session.opage = 0
            self._show(token, chat_id, "orders")
        elif data.startswith("Op:"):
            session.opage = max(0, int(data[3:] or 0))
            self._show(token, chat_id, "orders")
        elif data.startswith("Of:"):
            session.filter = data[3:] if data[3:] in {"all", "debt", "paid"} else "all"
            session.opage = 0
            self._show(token, chat_id, "orders")
        elif data == "Os":
            session.search = ""
            session.opage = 0
            self._show(token, chat_id, "orders")
        elif data.startswith("Oi:"):
            self._open_order(token, chat_id, int(data[3:] or -1))
        elif data == "D":
            self._show(token, chat_id, "order")
        elif data == "PC":
            self._open_on_pc(token, chat_id)
        elif data == "S":
            self._prepare_snap(session, reset=True)
            self._show(token, chat_id, "snap")
        elif data == "SB":
            self._show(token, chat_id, "snap")
        elif data == "So":
            self._show(token, chat_id, "look")
        elif data == "Sv":
            self._show(token, chat_id, "profiles")
        elif data.startswith("Sx:"):
            self._apply_share_profile(session, int(data[3:] or -1))
            self._show(token, chat_id, "snap")
        elif data.startswith("Sy:"):
            self._apply_pay_filter(session, data[3:] if data[3:] in {"all", "debt", "paid"} else "all")
            self._show(token, chat_id, "snap")
        elif data.startswith("Sp:"):
            preset = data[3:]
            if preset in snapmod.PRESETS:
                session.snap["fields"] = list(snapmod.PRESETS[preset])
            self._show(token, chat_id, "snap")
        elif data.startswith("St:"):
            session.snap["theme"] = snapmod.theme_key(data[3:])
            self._show(token, chat_id, "look")
        elif data == "Shl":
            session.snap["hide_labels"] = not session.snap.get("hide_labels")
            self._show(token, chat_id, "look")
        elif data == "Shs":
            session.snap["hide_stamp"] = not session.snap.get("hide_stamp")
            self._show(token, chat_id, "look")
        elif data == "SF":
            self._show(token, chat_id, "fields")
        elif data.startswith("Sf:"):
            self._toggle_field(session, int(data[3:] or -1))
            self._show(token, chat_id, "fields")
        elif data == "SN":
            self._show(token, chat_id, "lines")
        elif data.startswith("Sn:"):
            self._toggle_line(session, int(data[3:] or -1))
            self._show(token, chat_id, "lines")
        elif data == "La":
            self._select_lines_all(session, True)
            self._show(token, chat_id, "lines")
        elif data == "Ln":
            self._select_lines_all(session, False)
            self._show(token, chat_id, "lines")
        elif data == "Li":
            self._invert_lines(session)
            self._show(token, chat_id, "lines")
        elif data.startswith("Ls:"):
            self._select_lines_by_status(session, int(data[3:] or -1))
            self._show(token, chat_id, "lines")
        elif data == "LG":
            self._finish_lines(token, chat_id)
        elif data == "SA":
            self._show(token, chat_id, "add")
        elif data.startswith("Sa:"):
            self._toggle_order(session, int(data[3:] or -1))
            self._show(token, chat_id, "add")
        elif data == "Aa":
            self._select_orders_all(session, True)
            self._show(token, chat_id, "add")
        elif data == "An":
            self._select_orders_all(session, False)
            self._show(token, chat_id, "add")
        elif data == "Ai":
            self._invert_orders(session)
            self._show(token, chat_id, "add")
        elif data.startswith("As:"):
            self._select_orders_by_status(session, int(data[3:] or -1))
            self._show(token, chat_id, "add")
        elif data == "AG":
            self._finish_orders(token, chat_id)
        elif data == "SC":
            session.awaiting = "title"
            send_html(token, chat_id, "Напишите заголовок снимка одним сообщением. Пустое не отправляйте — отмена через «Меню».")
        elif data == "SX":
            session.snap["title"] = ""
            self._show(token, chat_id, "look")
        elif data == "SP":
            self._send_snap(token, chat_id, "png")
        elif data == "Sd":
            session.snap["pdf_opts"] = _pdf_opts(session.snap.get("pdf_opts") or _default_pdf_opts())
            self._show(token, chat_id, "pdf")
        elif data == "Sdp":
            self._send_snap(token, chat_id, "pdf")
        elif data.startswith("Pf:"):
            self._apply_pdf_profile(session, int(data[3:] or -1))
            self._show(token, chat_id, "pdf")
        elif data == "ST":
            self._send_snap(token, chat_id, "text")
        elif data == "B":
            back = {
                "fields": "snap",
                "lines": "snap",
                "add": "snap",
                "look": "snap",
                "profiles": "snap",
                "pdf": "snap",
                "snap": "order",
                "order": "orders",
                "orders": "home",
                "reports": "home",
            }.get(session.screen, "home")
            self._show(token, chat_id, back)
        else:
            self._show(token, chat_id, session.screen or "home")

    def _ask_new_link(self, token: str, chat_id: str) -> None:
        send_html(
            token,
            chat_id,
            "Старая закладка на телефоне перестанет работать. Бот останется на связи, кнопка «Открыть» обновится.\n\nСоздать новую ссылку?",
            _inline([[_btn("Создать новую ссылку", "Ny")], [_btn("Отмена", "Nn")]]),
        )

    def _rotate_link(self, token: str, chat_id: str) -> None:
        with self._lock:
            cb = self._on_rotate
        if not cb:
            send_html(token, chat_id, "Новую ссылку выпускает программа на компьютере. Откройте FinMaster.")
            return
        try:
            payload = cb() or {}
        except Exception as exc:
            send_html(token, chat_id, html_esc(str(exc) or "Не удалось выпустить ссылку."))
            return
        info = self._status_for(chat_id)
        link = str(payload.get("public_url") or payload.get("url") or info.get("url") or "")
        send_access(token, chat_id, link, info)

    def _open_report(self, token: str, chat_id: str, index: int) -> None:
        session = self._chat(chat_id)
        if index < 0 or index >= len(session.reports):
            self._show(token, chat_id, "reports")
            return
        path = session.reports[index]
        if not _path_allowed(path):
            send_html(token, chat_id, "Этот файл открыть нельзя.")
            return
        session.path = path
        session.order_id = ""
        session.search = ""
        session.filter = "all"
        session.opage = 0
        session.snap = session._fresh_snap()
        self._show(token, chat_id, "orders")

    def _open_order(self, token: str, chat_id: str, index: int) -> None:
        session = self._chat(chat_id)
        if index < 0 or index >= len(session.orders):
            self._show(token, chat_id, "orders")
            return
        session.order_id = session.orders[index]
        self._show(token, chat_id, "order")

    def _open_on_pc(self, token: str, chat_id: str) -> None:
        session = self._chat(chat_id)
        if not session.path or not _path_allowed(session.path):
            send_html(token, chat_id, "Сначала откройте отчёт в боте.")
            return
        if not REMOTE.enabled:
            send_html(token, chat_id, "Включите доступ с телефона в окне «Телефон» — тогда компьютер откроет файл.")
            return
        REMOTE.issue_command("open", path=os.path.abspath(session.path))
        send_html(token, chat_id, "Прошу компьютер открыть этот отчёт.")

    def _prepare_snap(self, session: ChatSession, *, reset: bool = False) -> None:
        doc, _ = self._doc_of(session)
        ui = doc.get("ui") if isinstance(doc.get("ui"), dict) else {}
        if reset or not session.snap.get("ready"):
            saved = ui.get("share_fields") if isinstance(ui.get("share_fields"), list) else []
            if saved:
                session.snap["fields"] = snapmod.normalize_fields(saved)
            else:
                session.snap["fields"] = list(snapmod.PRESETS["invoice"])
            session.snap["theme"] = snapmod.theme_key(str(ui.get("share_theme") or session.snap.get("theme") or "teal"))
            session.snap["hide_labels"] = False
            session.snap["hide_stamp"] = False
            session.snap["title"] = ""
            session.snap["skip"] = {}
            session.snap["extra_orders"] = []
            session.snap["pay_filter"] = "all"
            session.snap["pdf_opts"] = _default_pdf_opts()
            if session.order_id:
                session.snap["order_ids"] = [session.order_id]
            else:
                session.snap["order_ids"] = list(session.orders[:1])
            session.snap["ready"] = True
            return
        ids = [str(item) for item in (session.snap.get("order_ids") or []) if item]
        if session.order_id and session.order_id not in ids:
            ids = [session.order_id] + ids
        if not ids and session.orders:
            ids = list(session.orders[:1])
        session.snap["order_ids"] = ids
        session.snap.setdefault("skip", {})
        session.snap.setdefault("extra_orders", [])
        session.snap["fields"] = snapmod.normalize_fields(session.snap.get("fields"))
        session.snap["theme"] = snapmod.theme_key(str(session.snap.get("theme") or "teal"))

    def _apply_share_profile(self, session: ChatSession, index: int) -> None:
        profiles = _share_profiles()
        if index < 0 or index >= len(profiles):
            return
        profile = profiles[index]
        session.snap["fields"] = list(profile["fields"])
        session.snap["hide_labels"] = bool(profile.get("hideLabels"))
        session.snap["hide_stamp"] = bool(profile.get("hideStamp"))

    def _line_pay_match(
        self, line: dict[str, Any], order: dict[str, Any], types: dict[str, str] | None, mode: str
    ) -> bool:
        if mode not in {"debt", "paid"}:
            return True
        if line_kind(line, types):
            return False
        tot = line_totals(line, types, order)
        if mode == "debt":
            return tot["unpaid"] > 0.005
        return tot["after"] > 0.005 and tot["unpaid"] <= 0.005

    def _apply_pay_filter(self, session: ChatSession, mode: str) -> None:
        session.snap["pay_filter"] = mode if mode in {"all", "debt", "paid"} else "all"
        session.snap["skip"] = {}
        session.snap["extra_orders"] = []
        if session.snap["pay_filter"] == "all":
            return
        doc, _ = self._doc_of(session)
        ids: list[str] = []
        for order in doc.get("orders") or []:
            if not isinstance(order, dict):
                continue
            if self._snap_lines(doc, order, session):
                oid = str(order.get("id") or "")
                if oid:
                    ids.append(oid)
        session.snap["order_ids"] = ids

    def _apply_pdf_profile(self, session: ChatSession, index: int) -> None:
        if index < 0:
            session.snap["pdf_opts"] = _default_pdf_opts()
            return
        profiles = _pdf_profiles()
        if index >= len(profiles):
            return
        session.snap["pdf_opts"] = _pdf_opts(profiles[index].get("opts"))

    def _toggle_field(self, session: ChatSession, index: int) -> None:
        if index < 0 or index >= len(snapmod.FIELD_IDS):
            return
        field = snapmod.FIELD_IDS[index]
        fields = list(session.snap.get("fields") or [])
        if field in fields:
            fields = [item for item in fields if item != field]
        else:
            fields.append(field)
        session.snap["fields"] = snapmod.normalize_fields(fields) or [field]

    def _snap_lines(
        self, doc: dict[str, Any], order: dict[str, Any] | None, session: ChatSession | None = None
    ) -> list[dict[str, Any]]:
        """Позиции для снимка: без замороженных; налоги/затраты — только с полем «Налоги и затраты»; долг/оплата — по фильтру снимка."""
        with_expenses = "expenses" in snapmod.normalize_fields((session.snap if session else {}).get("fields"))
        pay = str((session.snap if session else {}).get("pay_filter") or "all")
        order_id = str((order or {}).get("id") or "")
        extras = {str(item) for item in ((session.snap if session else {}).get("extra_orders") or [])}
        if order_id and order_id in extras:
            pay = "all"
        types = type_index(doc)
        return [
            line
            for line in ((order or {}).get("lines") or [])
            if isinstance(line, dict)
            and not is_frozen(line)
            and (with_expenses or not line_kind(line, types))
            and self._line_pay_match(line, order or {}, types, pay)
        ]

    def _snap_line_entries(self, session: ChatSession, doc: dict[str, Any]) -> list[dict[str, Any]]:
        """Плоский список позиций по всем выбранным заказам."""
        entries: list[dict[str, Any]] = []
        for order_id in session.snap.get("order_ids") or []:
            order = self._find_order(doc, order_id)
            if not order:
                continue
            label = str(order.get("number") or order.get("name") or "заказ")
            for index, line in enumerate(self._snap_lines(doc, order, session)):
                line_id = str(line.get("id") or f"i{index}")
                entries.append({"order_id": order_id, "order_label": label, "line": line, "line_id": line_id})
        return entries

    def _toggle_line(self, session: ChatSession, index: int) -> None:
        doc, _ = self._doc_of(session)
        entries = self._snap_line_entries(session, doc)
        if index < 0 or index >= len(entries):
            return
        entry = entries[index]
        skip: dict[str, list[str]] = session.snap.setdefault("skip", {})
        current = set(skip.get(entry["order_id"]) or [])
        if entry["line_id"] in current:
            current.remove(entry["line_id"])
        else:
            current.add(entry["line_id"])
        skip[entry["order_id"]] = list(current)

    def _line_statuses(self, entries: list[dict[str, Any]]) -> list[str]:
        seen: list[str] = []
        for entry in entries:
            status = str((entry.get("line") or {}).get("status") or "").strip()
            if status and status not in seen:
                seen.append(status)
        return seen

    def _select_lines_all(self, session: ChatSession, on: bool) -> None:
        doc, _ = self._doc_of(session)
        entries = self._snap_line_entries(session, doc)
        skip: dict[str, list[str]] = session.snap.setdefault("skip", {})
        if on:
            for entry in entries:
                banned = set(skip.get(entry["order_id"]) or [])
                banned.discard(entry["line_id"])
                skip[entry["order_id"]] = list(banned)
            return
        by_order: dict[str, set[str]] = {}
        for entry in entries:
            by_order.setdefault(entry["order_id"], set()).add(entry["line_id"])
        for order_id, ids in by_order.items():
            skip[order_id] = list(ids)

    def _invert_lines(self, session: ChatSession) -> None:
        doc, _ = self._doc_of(session)
        entries = self._snap_line_entries(session, doc)
        skip: dict[str, list[str]] = session.snap.setdefault("skip", {})
        by_order: dict[str, list[str]] = {}
        for entry in entries:
            by_order.setdefault(entry["order_id"], []).append(entry["line_id"])
        for order_id, ids in by_order.items():
            banned = set(skip.get(order_id) or [])
            skip[order_id] = [line_id for line_id in ids if line_id not in banned]

    def _select_lines_by_status(self, session: ChatSession, index: int) -> None:
        doc, _ = self._doc_of(session)
        entries = self._snap_line_entries(session, doc)
        statuses = self._line_statuses(entries)
        if index < 0 or index >= len(statuses):
            return
        want = statuses[index]
        skip: dict[str, list[str]] = session.snap.setdefault("skip", {})
        for entry in entries:
            if str((entry.get("line") or {}).get("status") or "").strip() != want:
                continue
            banned = set(skip.get(entry["order_id"]) or [])
            banned.discard(entry["line_id"])
            skip[entry["order_id"]] = list(banned)

    def _lines_selected_count(self, session: ChatSession) -> int:
        doc, _ = self._doc_of(session)
        entries = self._snap_line_entries(session, doc)
        skip = session.snap.get("skip") or {}
        return sum(1 for entry in entries if entry["line_id"] not in set(skip.get(entry["order_id"]) or []))

    def _finish_lines(self, token: str, chat_id: str) -> None:
        session = self._chat(chat_id)
        if self._lines_selected_count(session) < 1:
            session.snap["pick_error"] = "Выберите хотя бы одну позицию."
            self._show(token, chat_id, "lines")
            return
        session.snap.pop("pick_error", None)
        self._show(token, chat_id, "snap")

    def _order_matches_pay(self, session: ChatSession, doc: dict[str, Any], order: dict[str, Any]) -> bool:
        """Есть ли у заказа позиции, которые текущий фильтр снимка (долг/оплата) оставляет."""
        pay = str(session.snap.get("pay_filter") or "all")
        if pay not in {"debt", "paid"}:
            return True
        with_expenses = "expenses" in snapmod.normalize_fields(session.snap.get("fields"))
        types = type_index(doc)
        for line in order.get("lines") or []:
            if not isinstance(line, dict) or is_frozen(line):
                continue
            if not with_expenses and line_kind(line, types):
                continue
            if self._line_pay_match(line, order, types, pay):
                return True
        return False

    def _toggle_order(self, session: ChatSession, index: int) -> None:
        picker = [str(item) for item in (session.snap.get("picker") or [])]
        if index < 0 or index >= len(picker):
            return
        order_id = picker[index]
        ids = list(session.snap.get("order_ids") or [])
        extras = [str(item) for item in (session.snap.get("extra_orders") or [])]
        if order_id in ids:
            ids = [item for item in ids if item != order_id]
            extras = [item for item in extras if item != order_id]
        else:
            ids.append(order_id)
            doc, _ = self._doc_of(session)
            order = self._find_order(doc, order_id)
            if order and not self._order_matches_pay(session, doc, order):
                if order_id not in extras:
                    extras.append(order_id)
            else:
                extras = [item for item in extras if item != order_id]
        session.snap["order_ids"] = ids
        session.snap["extra_orders"] = extras

    def _order_list_statuses(self, session: ChatSession, doc: dict[str, Any], orders: list[dict[str, Any]]) -> list[str]:
        seen: list[str] = []
        for order in orders:
            for line in self._snap_lines(doc, order, session):
                status = str(line.get("status") or "").strip()
                if status and status not in seen:
                    seen.append(status)
        return seen

    def _select_orders_all(self, session: ChatSession, on: bool) -> None:
        picker = [str(item) for item in (session.snap.get("picker") or [])]
        if on:
            session.snap["order_ids"] = picker
        else:
            session.snap["order_ids"] = []
            session.snap["extra_orders"] = []

    def _invert_orders(self, session: ChatSession) -> None:
        picker = [str(item) for item in (session.snap.get("picker") or [])]
        chosen = set(session.snap.get("order_ids") or [])
        session.snap["order_ids"] = [oid for oid in picker if oid not in chosen]
        keep = set(session.snap["order_ids"])
        session.snap["extra_orders"] = [oid for oid in (session.snap.get("extra_orders") or []) if oid in keep]

    def _select_orders_by_status(self, session: ChatSession, index: int) -> None:
        doc, _ = self._doc_of(session)
        orders = self._filtered_orders(session, doc, filt="all", needle="")
        picker = [str(order.get("id") or "") for order in orders]
        session.snap["picker"] = picker
        statuses = self._order_list_statuses(session, doc, orders)
        if index < 0 or index >= len(statuses):
            return
        want = statuses[index]
        chosen = set(session.snap.get("order_ids") or [])
        for order in orders:
            oid = str(order.get("id") or "")
            if not oid:
                continue
            if any(str(line.get("status") or "").strip() == want for line in self._snap_lines(doc, order, session)):
                chosen.add(oid)
        session.snap["order_ids"] = [oid for oid in picker if oid in chosen]

    def _finish_orders(self, token: str, chat_id: str) -> None:
        session = self._chat(chat_id)
        if not (session.snap.get("order_ids") or []):
            session.snap["pick_error"] = "Выберите хотя бы один заказ."
            self._show(token, chat_id, "add")
            return
        session.snap.pop("pick_error", None)
        self._show(token, chat_id, "snap")

    def _doc_of(self, session: ChatSession) -> tuple[dict[str, Any], bool]:
        path = session.path or _live_path()
        if path and _path_allowed(path):
            try:
                doc, live = _load_doc(path)
                session.path = path
                session.live = live
                return doc, live
            except (OSError, ValueError, json.JSONDecodeError):
                pass
        if REMOTE.enabled and isinstance(REMOTE.doc, dict):
            session.path = str(REMOTE.path or session.path)
            session.live = True
            return REMOTE.doc, True
        return {"title": "", "currency": "₽", "money_decimals": 2, "orders": [], "customers": []}, False

    def _find_order(self, doc: dict[str, Any], order_id: str) -> dict[str, Any]:
        for order in doc.get("orders") or []:
            if isinstance(order, dict) and str(order.get("id") or "") == str(order_id):
                return order
        return {}

    def _filtered_orders(
        self, session: ChatSession, doc: dict[str, Any], *, filt: str | None = None, needle: str | None = None
    ) -> list[dict[str, Any]]:
        found: list[dict[str, Any]] = []
        mode = session.filter if filt is None else filt
        query = (session.search or "") if needle is None else needle
        needle = query.strip().lower()
        types = type_index(doc)
        for order in doc.get("orders") or []:
            if not isinstance(order, dict):
                continue
            tot = order_totals(order, types)
            if mode == "debt" and tot["unpaid"] <= 0.005:
                continue
            if mode == "paid" and tot["unpaid"] > 0.005:
                continue
            if needle:
                blob = " ".join(
                    [
                        str(order.get("number") or ""),
                        str(order.get("name") or ""),
                        str(order.get("customer") or ""),
                        *[str(line.get("product") or "") for line in order.get("lines") or [] if isinstance(line, dict)],
                    ]
                ).lower()
                if needle not in blob:
                    continue
            found.append(order)
        found.sort(
            key=lambda item: max(
                [str(item.get("created_at") or "")]
                + [str(line.get("order_date") or "") for line in item.get("lines") or [] if isinstance(line, dict)]
            ),
            reverse=True,
        )
        return found

    def _snap_blocks(self, session: ChatSession, doc: dict[str, Any]) -> list[dict[str, Any]]:
        blocks: list[dict[str, Any]] = []
        skip = session.snap.get("skip") or {}
        for order_id in session.snap.get("order_ids") or []:
            order = self._find_order(doc, order_id)
            if not order:
                continue
            banned = set(skip.get(order_id) or [])
            allowed = self._snap_lines(doc, order, session)
            lines = [line for i, line in enumerate(allowed) if str(line.get("id") or f"i{i}") not in banned]
            if not lines and not banned:
                lines = allowed
            if lines:
                blocks.append({"order": order, "lines": lines})
        return blocks

    def _send_snap(self, token: str, chat_id: str, kind: str) -> None:
        session = self._chat(chat_id)
        doc, _ = self._doc_of(session)
        blocks = self._snap_blocks(session, doc)
        if not blocks:
            send_html(token, chat_id, "Нечего снимать: включите хотя бы одну позицию.")
            return
        fields = snapmod.normalize_fields(session.snap.get("fields"))
        title = str(session.snap.get("title") or "")
        hide_labels = bool(session.snap.get("hide_labels"))
        hide_stamp = bool(session.snap.get("hide_stamp"))
        caption = snapmod.default_title(blocks, title)
        try:
            if kind == "png":
                png = snapmod.render_png(
                    doc,
                    blocks,
                    fields,
                    str(session.snap.get("theme") or "teal"),
                    hide_labels,
                    hide_stamp,
                    title,
                )
                send_photo(token, chat_id, png, caption, "finmaster-snapshot.png")
            elif kind == "pdf":
                opts = _pdf_opts(session.snap.get("pdf_opts") or _default_pdf_opts())
                payload = {
                    "blocks": [{"order": block["order"], "lines": block["lines"]} for block in blocks],
                    "fields": fields,
                    "theme": str(session.snap.get("theme") or "teal"),
                    "hide_labels": hide_labels,
                    "hide_stamp": hide_stamp,
                    "title": title,
                    "opts": opts,
                    "path": session.path or "",
                }
                pdf = PDF_BRIDGE.request(payload, timeout=90.0)
                name = f"{(caption or 'Заказы')[:80]}.pdf".replace("/", "_").replace("\\", "_")
                send_document(token, chat_id, pdf, name, caption, "application/pdf")
            else:
                text = snapmod.render_text(doc, blocks, fields, hide_labels, hide_stamp, title)
                if len(text) < 3800:
                    send_html(token, chat_id, f"<pre>{html_esc(text)}</pre>")
                else:
                    send_document(token, chat_id, text.encode("utf-8"), "finmaster-snapshot.txt", caption)
        except Exception as exc:
            send_html(token, chat_id, html_esc(str(exc) or "Не удалось собрать снимок."))

    def _show(self, token: str, chat_id: str, screen: str) -> None:
        session = self._chat(chat_id)
        session.screen = screen
        session.awaiting = ""
        text, rows = self._screen(session, screen)
        anchor = session.message_id
        if anchor is not None and _chat_tail.get(str(chat_id), 0) > int(anchor):
            anchor = None
        session.message_id = send_html(
            token,
            chat_id,
            text,
            _inline(rows) if rows else self._reply_kb(chat_id),
            message_id=anchor,
        )

    def _screen(self, session: ChatSession, screen: str) -> tuple[str, list[list[dict[str, str]]]]:
        if screen == "reports":
            return self._screen_reports(session)
        if screen == "orders":
            return self._screen_orders(session)
        if screen == "order":
            return self._screen_order(session)
        if screen == "snap":
            return self._screen_snap(session)
        if screen == "look":
            return self._screen_look(session)
        if screen == "profiles":
            return self._screen_profiles(session)
        if screen == "pdf":
            return self._screen_pdf(session)
        if screen == "fields":
            return self._screen_fields(session)
        if screen == "lines":
            return self._screen_lines(session)
        if screen == "add":
            return self._screen_add(session)
        return self._screen_home(session)

    def _screen_home(self, session: ChatSession) -> tuple[str, list[list[dict[str, str]]]]:
        settings = storage.remote_settings()
        info = {"url": "", "access": REMOTE.enabled, "ngrok": bool(settings.get("ngrok"))}
        doc, live = self._doc_of(session)
        title = str(doc.get("title") or "")
        path = session.path or _live_path()
        if title and path:
            mark = "с несохранёнными правками на компьютере" if live else "с диска"
            current = f"Сейчас: <b>{html_esc(title)}</b>\n{html_esc(os.path.basename(path))}\n<i>{mark}</i>"
        else:
            current = "Отчёт ещё не выбран — откройте файл из папки FinMaster."
        text = f"{welcome_text(info)}\n\n{current}"
        rows = [
            [web_access_btn(info, "Wh")],
            [_btn("Отчёты", "R"), _btn("Заказы", "O")],
            [_btn("Ссылка на телефон", "L"), _btn("Новая ссылка", "N")],
        ]
        return text, rows

    def _screen_reports(self, session: ChatSession) -> tuple[str, list[list[dict[str, str]]]]:
        lib = _library_items()
        recent = [item for item in _recent_items() if item.get("exists") is not False]
        seen: list[str] = []
        merged: list[dict[str, Any]] = []
        for item in lib + recent:
            path = str(item.get("path") or "")
            if not path or any(storage.same_path(path, other) for other in seen):
                continue
            seen.append(path)
            merged.append(item)
        session.reports = [str(item.get("path") or "") for item in merged]
        pages = max(1, (len(merged) + PAGE - 1) // PAGE)
        session.rpage = min(session.rpage, pages - 1)
        chunk = merged[session.rpage * PAGE : session.rpage * PAGE + PAGE]
        folder = storage.list_library_reports().get("path") or ""
        lines = [f"<b>Отчёты</b>\nпапка <code>{html_esc(folder)}</code>"]
        if not merged:
            lines.append("\nПока пусто — сохраните .fmaster в эту папку или откройте файл на компьютере.")
        rows: list[list[dict[str, str]]] = []
        offset = session.rpage * PAGE
        for i, item in enumerate(chunk):
            title = item.get("title") or item.get("name") or os.path.basename(str(item.get("path") or ""))
            mark = " · открыт" if session.path and storage.same_path(session.path, str(item.get("path") or "")) else ""
            rows.append([_btn(_clip(f"{title}{mark}"), f"Ri:{offset + i}")])
        nav: list[dict[str, str]] = []
        if session.rpage > 0:
            nav.append(_btn("‹", f"Rp:{session.rpage - 1}"))
        if pages > 1:
            nav.append(_btn(f"{session.rpage + 1}/{pages}", "R"))
        if session.rpage < pages - 1:
            nav.append(_btn("›", f"Rp:{session.rpage + 1}"))
        if nav:
            rows.append(nav)
        rows.append([_btn("Заказы", "O"), _btn("Меню", "H")])
        return "\n".join(lines), rows

    def _screen_orders(self, session: ChatSession) -> tuple[str, list[list[dict[str, str]]]]:
        doc, live = self._doc_of(session)
        if not (session.path or _live_path() or doc.get("orders")):
            return "Сначала выберите отчёт.", [[_btn("К отчётам", "R")]]
        orders = self._filtered_orders(session, doc)
        session.orders = [str(order.get("id") or "") for order in orders]
        currency = str(doc.get("currency") or "₽")
        decimals = money_decimals(doc.get("money_decimals"))
        types = type_index(doc)
        debt = sum(order_totals(order, types)["unpaid"] for order in (doc.get("orders") or []) if isinstance(order, dict))
        pages = max(1, (len(orders) + PAGE - 1) // PAGE)
        session.opage = min(session.opage, pages - 1)
        chunk = orders[session.opage * PAGE : session.opage * PAGE + PAGE]
        filt = {"all": "все", "debt": "с долгом", "paid": "оплаченные"}[session.filter]
        live_note = " · правки с компьютера" if live else ""
        search = f"\nпоиск: <i>{html_esc(session.search)}</i>" if session.search else ""
        text = (
            f"<b>{html_esc(doc.get('title') or 'Отчёт')}</b>{live_note}\n"
            f"{len(doc.get('orders') or [])} заказов · долг {html_esc(money(debt, currency, decimals))}\n"
            f"фильтр: {filt} · показано {len(orders)}{search}"
        )
        rows: list[list[dict[str, str]]] = []
        offset = session.opage * PAGE
        for i, order in enumerate(chunk):
            rows.append([_btn(_clip(_order_label(order, currency, types, decimals)), f"Oi:{offset + i}")])
        if not chunk:
            text += "\n\nНичего не нашлось."
        rows.append(
            [
                _btn("Все" if session.filter != "all" else "· Все", "Of:all"),
                _btn("Долг" if session.filter != "debt" else "· Долг", "Of:debt"),
                _btn("Оплата" if session.filter != "paid" else "· Оплата", "Of:paid"),
            ]
        )
        nav: list[dict[str, str]] = []
        if session.opage > 0:
            nav.append(_btn("‹", f"Op:{session.opage - 1}"))
        if pages > 1:
            nav.append(_btn(f"{session.opage + 1}/{pages}", "O"))
        if session.opage < pages - 1:
            nav.append(_btn("›", f"Op:{session.opage + 1}"))
        if session.search:
            nav.append(_btn("Сбросить поиск", "Os"))
        if nav:
            rows.append(nav)
        rows.append([_btn("Отчёты", "R"), _btn("Меню", "H")])
        return text, rows

    def _screen_order(self, session: ChatSession) -> tuple[str, list[list[dict[str, str]]]]:
        doc, _ = self._doc_of(session)
        order = self._find_order(doc, session.order_id)
        if not order:
            return "Заказ не найден.", [[_btn("К заказам", "O")]]
        currency = str(doc.get("currency") or "₽")
        decimals = money_decimals(doc.get("money_decimals"))
        types = type_index(doc)
        tot = order_totals(order, types)
        income, expense = split_lines(
            [line for line in order.get("lines") or [] if isinstance(line, dict)], types
        )
        lines_out = []
        for line in income:
            bit = order_totals({"lines": [line]}, types)
            lines_out.append(
                f"• {html_esc(line.get('product') or '—')} · {html_esc(qty_text(line))} · "
                f"{html_esc(money(bit['after'], currency, decimals))} · {html_esc(line.get('status') or '—')}"
            )
        cost_out = []
        for line in expense:
            bit = line_totals(line, types, order)
            tag = "налог" if bit["kind"] == "tax" else "затрата"
            how = qty_text(line) if bit["mode"] == "amount" else f"{bit['percent']:g} % от {money(bit['base'], currency, decimals)}"
            cost_out.append(
                f"− {html_esc(line.get('product') or line.get('order_type') or '—')} · {html_esc(how)} · "
                f"{html_esc(money(bit['cost'], currency, decimals))} · {tag}"
            )
        notes = str(order.get("notes") or "").strip()
        sums = (
            f"Итого {html_esc(money(tot['after'], currency, decimals))} · оплачено {html_esc(money(tot['paid'], currency, decimals))} · "
            f"долг {html_esc(money(tot['unpaid'], currency, decimals))}"
        )
        if tot["cost"] > 0.005:
            sums += f"\nРасход {html_esc(money(tot['cost'], currency, decimals))} · чистыми {html_esc(money(tot['net'], currency, decimals))}"
        text = (
            f"<b>{html_esc(order.get('number') or '—')} · {html_esc(order.get('name') or 'без названия')}</b>\n"
            f"Заказчик: {html_esc(order.get('customer') or '—')}\n"
            f"{sums}\n\n"
            + ("\n".join(lines_out) if lines_out else "Нет позиций.")
        )
        if cost_out:
            text += "\n\n<b>Расходы</b>\n" + "\n".join(cost_out)
        if notes:
            text += f"\n\nЗаметки: {html_esc(notes)}"
        if len(text) > 3800:
            text = text[:3790] + "…"
        rows = [
            [_btn("Снимок", "S")],
            [_btn("Открыть на компьютере", "PC")],
            [_btn("К заказам", "O"), _btn("Отчёты", "R")],
        ]
        return text, rows

    def _screen_snap(self, session: ChatSession) -> tuple[str, list[list[dict[str, str]]]]:
        doc, _ = self._doc_of(session)
        blocks = self._snap_blocks(session, doc)
        fields = snapmod.normalize_fields(session.snap.get("fields"))
        theme = snapmod.theme_key(str(session.snap.get("theme") or "teal"))
        preset = next((key for key, ids in snapmod.PRESETS.items() if ids == fields), "")
        profiles = _share_profiles()
        active_profile = ""
        field_set = set(fields)
        for profile in profiles:
            if (
                set(profile["fields"]) == field_set
                and bool(profile.get("hideLabels")) == bool(session.snap.get("hide_labels"))
                and bool(profile.get("hideStamp")) == bool(session.snap.get("hide_stamp"))
            ):
                active_profile = profile["name"]
                break
        names = [str(block["order"].get("number") or block["order"].get("name") or "заказ") for block in blocks]
        lines_n = sum(len(block["lines"]) for block in blocks)
        set_label = active_profile or snapmod.PRESET_LABELS.get(preset, "свой набор")
        pay = str(session.snap.get("pay_filter") or "all")
        pay_label = {"all": "все позиции", "debt": "только с долгом", "paid": "только оплаченные"}.get(pay, "все позиции")
        text = (
            f"<b>Снимок для заказчика</b>\n"
            f"{html_esc(', '.join(names) or 'нет заказов')} · позиций: {lines_n}\n"
            f"позиции: {pay_label}\n"
            f"набор: {html_esc(set_label)}\n"
            f"тема: {html_esc(snapmod.THEMES[theme]['label'])} · "
            f"подписи: {'скрыты' if session.snap.get('hide_labels') else 'видны'} · "
            f"дата: {'скрыта' if session.snap.get('hide_stamp') else 'есть'}\n"
            f"заголовок: {html_esc(session.snap.get('title') or 'как на компьютере')}"
        )
        rows: list[list[dict[str, str]]] = []
        if profiles:
            if len(profiles) <= 4:
                rows.extend(
                    _chunk_btns(
                        [
                            _btn(("· " if p["name"] == active_profile else "") + _clip(p["name"], 28), f"Sx:{i}")
                            for i, p in enumerate(profiles)
                        ],
                        2,
                    )
                )
            else:
                rows.append([_btn(f"Профили ({len(profiles)})" + (f" · {active_profile}" if active_profile else ""), "Sv")])
        rows.append(
            [
                _btn("· Все" if pay == "all" else "Все", "Sy:all"),
                _btn("· Долг" if pay == "debt" else "Долг", "Sy:debt"),
                _btn("· Оплата" if pay == "paid" else "Оплата", "Sy:paid"),
            ]
        )
        rows.append([_btn("Для работы", "Sp:work"), _btn("Как счёт", "Sp:invoice")])
        rows.append([_btn("Коротко", "Sp:short"), _btn("Все поля", "Sp:full")])
        rows.append([_btn("Поля", "SF"), _btn("Позиции", "SN"), _btn("Заказы", "SA")])
        rows.append([_btn("Оформление", "So")])
        rows.append([_btn("Картинка PNG", "SP"), _btn("PDF", "Sd"), _btn("Текст", "ST")])
        rows.append([_btn("К заказу", "D"), _btn("К заказам", "O")])
        return text, rows

    def _snap_set_label(self, session: ChatSession) -> str:
        fields = snapmod.normalize_fields(session.snap.get("fields"))
        preset = next((key for key, ids in snapmod.PRESETS.items() if list(ids) == fields), "")
        field_set = set(fields)
        for profile in _share_profiles():
            if (
                set(profile["fields"]) == field_set
                and bool(profile.get("hideLabels")) == bool(session.snap.get("hide_labels"))
                and bool(profile.get("hideStamp")) == bool(session.snap.get("hide_stamp"))
            ):
                return str(profile["name"])
        return snapmod.PRESET_LABELS.get(preset, "свой набор")

    def _screen_pdf(self, session: ChatSession) -> tuple[str, list[list[dict[str, str]]]]:
        profiles = _pdf_profiles()
        opts = _pdf_opts(session.snap.get("pdf_opts") or _default_pdf_opts())
        session.snap["pdf_opts"] = opts
        active = ""
        for profile in profiles:
            if _pdf_profile_on(opts, profile):
                active = profile["name"]
                break
        orient = "альбом" if opts.get("orient") == "landscape" else "книга"
        margin = {"narrow": "узкие", "normal": "обычные", "wide": "широкие"}.get(str(opts.get("margin")), "обычные")
        theme = snapmod.theme_key(str(session.snap.get("theme") or "teal"))
        text = (
            "<b>PDF для заказчика</b>\n"
            f"шаблон страницы: {html_esc(active or 'по умолчанию')}\n"
            f"снимок: {html_esc(self._snap_set_label(session))} · "
            f"тема {html_esc(snapmod.THEMES[theme]['label'])}\n"
            f"{orient} · поля {margin} · масштаб {int(opts.get('scale') or 100)}%"
            + (" · обрезка" if opts.get("crop") else "")
        )
        rows: list[list[dict[str, str]]] = []
        default_on = not active
        rows.append([_btn(("· " if default_on else "") + "По умолчанию", "Pf:-1")])
        if profiles:
            for i, profile in enumerate(profiles):
                on = profile["name"] == active
                rows.append([_btn(("· " if on else "") + _clip(profile["name"], 56), f"Pf:{i}")])
        else:
            text += "\n\nСохранённых шаблонов страницы пока нет. PDF соберётся из меню снимка."
        rows.append([_btn("Отправить PDF", "Sdp")])
        rows.append([_btn("Назад", "SB")])
        return text, rows

    def _screen_look(self, session: ChatSession) -> tuple[str, list[list[dict[str, str]]]]:
        theme = snapmod.theme_key(str(session.snap.get("theme") or "teal"))
        text = (
            "<b>Оформление снимка</b>\n"
            f"тема: {html_esc(snapmod.THEMES[theme]['label'])}\n"
            f"подписи: {'скрыты' if session.snap.get('hide_labels') else 'видны'} · "
            f"дата: {'скрыта' if session.snap.get('hide_stamp') else 'есть'}\n"
            f"заголовок: {html_esc(session.snap.get('title') or 'как на компьютере')}"
        )
        theme_btns = [
            _btn(("· " if key == theme else "") + snapmod.THEMES[key]["label"], f"St:{key}") for key in SNAP_THEMES
        ]
        rows = _chunk_btns(theme_btns, 3)
        rows.append(
            [
                _btn("Подписи ✓" if not session.snap.get("hide_labels") else "Подписи", "Shl"),
                _btn("Дата ✓" if not session.snap.get("hide_stamp") else "Дата", "Shs"),
            ]
        )
        rows.append([_btn("Заголовок", "SC"), _btn("Сбросить заголовок", "SX")])
        rows.append([_btn("Готово", "SB")])
        return text, rows

    def _screen_profiles(self, session: ChatSession) -> tuple[str, list[list[dict[str, str]]]]:
        profiles = _share_profiles()
        fields = snapmod.normalize_fields(session.snap.get("fields"))
        if not profiles:
            return "Пользовательских профилей пока нет. Сохраните их в снимке на компьютере.", [[_btn("Назад", "SB")]]
        rows: list[list[dict[str, str]]] = []
        for i, profile in enumerate(profiles):
            on = (
                set(profile["fields"]) == set(fields)
                and bool(profile.get("hideLabels")) == bool(session.snap.get("hide_labels"))
                and bool(profile.get("hideStamp")) == bool(session.snap.get("hide_stamp"))
            )
            rows.append([_btn(("· " if on else "") + _clip(profile["name"], 56), f"Sx:{i}")])
        rows.append([_btn("Назад", "SB")])
        return "<b>Профили снимка</b>\nте же, что сохранены на компьютере.", rows

    def _screen_fields(self, session: ChatSession) -> tuple[str, list[list[dict[str, str]]]]:
        fields = set(snapmod.normalize_fields(session.snap.get("fields")))
        meta = [item for item in snapmod.FIELDS if item["kind"] == "meta"]
        cols = [item for item in snapmod.FIELDS if item["kind"] == "col"]
        rows: list[list[dict[str, str]]] = []

        def add_group(title: str, items: list[dict[str, Any]]) -> None:
            rows.append([_btn(title, "SF")])
            pair: list[dict[str, str]] = []
            for item in items:
                index = snapmod.FIELD_IDS.index(item["id"])
                mark = "✓ " if item["id"] in fields else ""
                pair.append(_btn(f"{mark}{item['label']}", f"Sf:{index}"))
                if len(pair) == 2:
                    rows.append(pair)
                    pair = []
            if pair:
                rows.append(pair)

        add_group("— Шапка заказа —", meta)
        add_group("— Столбцы таблицы —", cols)
        rows.append([_btn("Готово", "SB")])
        return "<b>Поля снимка</b>\nнажмите, чтобы включить или выключить. Выбор сохранится.", rows

    def _screen_lines(self, session: ChatSession) -> tuple[str, list[list[dict[str, str]]]]:
        doc, _ = self._doc_of(session)
        entries = self._snap_line_entries(session, doc)
        if not entries:
            return "Нет позиций для снимка среди выбранных заказов.", [[_btn("Назад", "SB")]]
        skip = session.snap.get("skip") or {}
        types = type_index(doc)
        selected = self._lines_selected_count(session)
        statuses = self._line_statuses(entries)
        rows: list[list[dict[str, str]]] = [
            [_btn("Выбрать все", "La"), _btn("Снять все", "Ln"), _btn("Инверт.", "Li")],
        ]
        if statuses:
            rows.append([_btn("— Статусы —", "SN")])
            rows.extend(
                _chunk_btns([_btn(_clip(status, 28), f"Ls:{i}") for i, status in enumerate(statuses)], 2)
            )
        multi = len({entry["order_id"] for entry in entries}) > 1
        for index, entry in enumerate(entries[:40]):
            banned = set(skip.get(entry["order_id"]) or [])
            mark = "" if entry["line_id"] in banned else "✓ "
            line = entry["line"]
            kind = line_kind(line, types)
            tail = " · налог" if kind == "tax" else " · затрата" if kind else ""
            status = str(line.get("status") or "").strip()
            status_bit = f" · {status}" if status else ""
            head = f"{entry['order_label']}: " if multi else ""
            label = f"{mark}{head}{line.get('product') or '—'} · {qty_text(line)}{status_bit}{tail}"
            rows.append([_btn(_clip(label, 60), f"Sn:{index}")])
        if len(entries) > 40:
            rows.append([_btn(f"…ещё {len(entries) - 40}", "SN")])
        rows.append([_btn("Готово", "LG")])
        warn = str(session.snap.pop("pick_error", "") or "")
        head = f"⚠️ {html_esc(warn)}\n\n" if warn else ""
        return (
            f"{head}<b>Позиции снимка</b>\nвыбрано {selected} из {len(entries)}. "
            "Статус добавляет позиции к уже выбранным, не сбрасывая предыдущий выбор.",
            rows,
        )

    def _screen_add(self, session: ChatSession) -> tuple[str, list[list[dict[str, str]]]]:
        doc, _ = self._doc_of(session)
        currency = str(doc.get("currency") or "₽")
        decimals = money_decimals(doc.get("money_decimals"))
        chosen = set(session.snap.get("order_ids") or [])
        orders = self._filtered_orders(session, doc, filt="all", needle="")
        session.snap["picker"] = [str(order.get("id") or "") for order in orders]
        types = type_index(doc)
        statuses = self._order_list_statuses(session, doc, orders)
        rows: list[list[dict[str, str]]] = [
            [_btn("Выбрать все", "Aa"), _btn("Снять все", "An"), _btn("Инверт.", "Ai")],
        ]
        if statuses:
            rows.append([_btn("— Статусы —", "SA")])
            rows.extend(
                _chunk_btns([_btn(_clip(status, 28), f"As:{i}") for i, status in enumerate(statuses)], 2)
            )
        for index, order in enumerate(orders[:18]):
            mark = "✓ " if str(order.get("id") or "") in chosen else ""
            rows.append([_btn(_clip(f"{mark}{_order_label(order, currency, types, decimals)}"), f"Sa:{index}")])
        if not orders:
            rows.append([_btn("Нет заказов", "SB")])
        rows.append([_btn("Готово", "AG")])
        warn = str(session.snap.pop("pick_error", "") or "")
        head = f"⚠️ {html_esc(warn)}\n\n" if warn else ""
        return (
            f"{head}<b>Заказы на снимке</b>\nвыбрано {len(chosen)} из {len(orders)}. "
            "Статус добавляет заказы с такими позициями, не снимая уже отмеченные.",
            rows,
        )


BOT = TelegramBot()
