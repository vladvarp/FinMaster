"""Telegram-бот: отчёты, заказы, снимки и ссылка на телефон."""

from __future__ import annotations

import json
import os
import re
import secrets
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from typing import Any, Callable

from backend import ask
from backend import bridge
from backend import netlog
from backend import storage
from backend import voice
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


ASK_DESK = {"интерфейс пк", "/desk"}
ASK_BANK = {"хранилище", "/bank"}
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


_BRIDGE_OUT = {
    "sendMessage",
    "sendPhoto",
    "sendDocument",
    "editMessageText",
    "editMessageReplyMarkup",
    "deleteMessage",
    "answerCallbackQuery",
    "sendChatAction",
}


def _person_label(sender: Any, chat_id: Any) -> str:
    person = sender if isinstance(sender, dict) else {}
    username = str(person.get("username") or "").strip()
    if username:
        return "@" + username.lstrip("@")
    name = " ".join(
        part for part in (str(person.get("first_name") or ""), str(person.get("last_name") or "")) if part
    ).strip()
    return name or str(chat_id or "")


def _tg_public_result(data: Any) -> Any:
    if not isinstance(data, dict):
        return data
    result = data.get("result") if isinstance(data.get("result"), dict) else {}
    out: dict[str, Any] = {"ok": bool(data.get("ok"))}
    if data.get("description"):
        out["description"] = data.get("description")
    if result.get("message_id") is not None:
        out["message_id"] = result.get("message_id")
    return out


def _bridge_note(method: str, request_view: Any, response_view: Any = None, error: str = "") -> None:
    if method not in _BRIDGE_OUT:
        return
    body: dict[str, Any] = {"запрос": request_view}
    if error:
        body["ошибка"] = error[:500]
    elif response_view is not None:
        body["ответ"] = response_view
    bridge.note(method, body)


def _call(token: str, method: str, payload: dict[str, Any] | None = None, timeout: float = 15) -> dict[str, Any]:
    url = f"https://api.telegram.org/bot{urllib.parse.quote(token, safe=':-_')}/{method}"
    body = json.dumps(payload or {}).encode("utf-8")
    req = urllib.request.Request(url, data=body, headers={"Content-Type": "application/json"}, method="POST")
    try:
        data = _read(req, timeout)
    except Exception as exc:
        _bridge_note(method, payload or {}, error=str(exc))
        raise
    _bridge_note(method, payload or {}, _tg_public_result(data))
    return data


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
    view = {**fields, file_field: f"{filename}, {len(data)} байт, {mime}"}
    try:
        result = _read(req, 45)
    except Exception as exc:
        _bridge_note(method, view, error=str(exc))
        raise
    _bridge_note(method, view, _tg_public_result(result))
    return result


def _web_app_url(url: str) -> str:
    link = str(url or "").strip()
    return link if link.startswith("https://") else ""


def _swap_link(url: str, path: str) -> str:
    link = str(url or "").strip()
    mark = "/m?"
    if mark not in link:
        return ""
    return link.replace(mark, f"/{path}?", 1)


def _desk_link(url: str) -> str:
    return _swap_link(url, "desk")


def _bank_link(url: str) -> str:
    return _swap_link(url, "bank")


def _menu_keyboard(app_url: str = "") -> dict[str, Any]:
    second: list[dict[str, Any]] = [{"text": "Ссылка"}, {"text": "Меню"}]
    app = _web_app_url(app_url)
    if app:
        second = [{"text": "Открыть", "web_app": {"url": app}}, {"text": "Ссылка"}, {"text": "Меню"}]
    rows: list[list[dict[str, Any]]] = [[{"text": "Отчёты"}, {"text": "Заказы"}, {"text": "Снимок"}], second]
    tools: list[dict[str, Any]] = []
    bank = _bank_link(app_url)
    bank_app = _web_app_url(bank)
    if bank_app:
        tools.append({"text": "Хранилище", "web_app": {"url": bank_app}})
    elif bank:
        tools.append({"text": "Хранилище"})
    desk = _desk_link(app_url)
    desk_app = _web_app_url(desk)
    if desk_app:
        tools.append({"text": "Интерфейс ПК", "web_app": {"url": desk_app}})
    elif desk:
        tools.append({"text": "Интерфейс ПК"})
    if tools:
        rows.append(tools)
    rows.append([{"text": "Новая ссылка"}, {"text": "Голос"}])
    return {
        "keyboard": rows,
        "resize_keyboard": True,
        "input_field_placeholder": "Вопрос голосом или текстом",
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


def push_open_controls(
    token: str,
    chat_id: str | list[str],
    url: str,
    notice: str = "",
) -> None:
    """Обновляет ссылку и кнопку Mini App только в указанных чатах."""
    token = str(token or "").strip()
    link = str(url or "").strip()
    if not token:
        return

    ids: list[str] = []
    for item in chat_id if isinstance(chat_id, list) else [chat_id]:
        cid = str(item or "").strip()
        if cid and cid not in ids:
            ids.append(cid)

    if not ids:
        return

    text = notice or "Ссылка на телефон обновлена. Нажмите <b>Открыть</b>."
    kb = _menu_keyboard(link) if link else {"remove_keyboard": True}

    for cid in ids:
        # Устанавливаем Mini App только для конкретного чата.
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

            if link:
                send_html(token, cid, text, kb)

            netlog.add(
                "telegram",
                "Кнопка и клавиатура Mini App обновлены",
                source=f"chat {cid}",
                key=f"tg-kb-{cid}",
            )
        except RuntimeError as exc:
            netlog.add(
                "telegram",
                f"Не обновились кнопки Mini App: {exc}",
                level="err",
                key=f"tg-kb-{cid}",
            )


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


def _html_to_text(text: str) -> str:
    plain = re.sub(r"<[^>]+>", "", str(text or ""))
    return plain.replace("&amp;", "&").replace("&lt;", "<").replace("&gt;", ">")


def _md_text(value: str) -> str:
    plain = _html_to_text(value)

    def slash(match: re.Match[str]) -> str:
        return "\\" + match.group(1)

    return re.sub(r"([\\*_`~\[\]|])", slash, plain)


_RICH_SECTIONS = {
    "Сводка",
    "Долги",
    "Заказы",
    "Календарь",
    "Заказчики",
    "Продукты",
    "Расходы",
    "Заметки",
    "Замороженные",
    "Напоминание",
    "Коротко",
    "Просрочено",
    "Крупные",
    "Статусы",
    "Скидки",
    "Ответ",
}
_MONEY_LABELS = (
    "к оплате",
    "оплачено",
    "долг",
    "расходы",
    "чистыми",
    "средний чек",
    "собираемость",
    "этот месяц",
    "прошлый",
    "прогноз месяца",
    "дебиторка",
    "просрочено",
    "срок по договорённости",
    "отменённые",
    "средний срок оплаты",
    "срок оплаты",
)


def _money_pairs(plain: str) -> list[tuple[str, str]] | None:
    parts = [part.strip() for part in plain.split("·") if part.strip()]
    if len(parts) < 2:
        return None
    pairs: list[tuple[str, str]] = []
    for part in parts:
        low = part.lower()
        label = next((item for item in _MONEY_LABELS if low.startswith(item)), "")
        if not label:
            return None
        pairs.append((part[: len(label)], part[len(label) :].strip()))
    return pairs


def _kv_table(pairs: list[tuple[str, str]]) -> str:
    rows = ["| | |", "|:---|---:|"]
    for key, value in pairs:
        rows.append(f"| {_md_text(key)} | **{_md_text(value)}** |")
    return "\n".join(rows)


def _position_cells(plain: str) -> list[str] | None:
    parts = [part.strip() for part in plain.split("·") if part.strip()]
    debt_i = next((i for i, part in enumerate(parts) if part.lower().startswith("долг ")), -1)
    if debt_i < 3:
        return None
    product = parts[0] if debt_i == 3 else " · ".join(parts[: debt_i - 2])
    qty = parts[debt_i - 2]
    total = parts[debt_i - 1]
    debt = parts[debt_i][5:].strip()
    rest = parts[debt_i + 1 :]
    # Сводки продуктов и статусов кончаются на долге. Дата и статус — только у строки позиции.
    if not rest:
        return None
    date = rest[0]
    status = " · ".join(rest[1:]) if len(rest) > 1 else ""
    return [product, qty, total, debt, date, status]


def _generic_table(header: list[str], rows: list[list[str]]) -> str:
    lines = [
        "| " + " | ".join(_md_text(cell) for cell in header) + " |",
        "|" + "|".join("---" for _cell in header) + "|",
    ]
    for row in rows:
        lines.append("| " + " | ".join(_md_text(cell) for cell in row) + " |")
    return "\n".join(lines)


def _positions_table(rows: list[list[str]]) -> str:
    lines = [
        "| Продукт | Кол-во | Сумма | Долг | Дата | Статус |",
        "|:---|---:|---:|---:|:---:|:---|",
    ]
    for cells in rows:
        lines.append("| " + " | ".join(_md_text(cell) for cell in cells) + " |")
    return "\n".join(lines)


def _html_table_markdown(html: str) -> str:
    """Таблица шаблона уходит в бот сеткой, а не списком ячеек."""

    def one(match: re.Match[str]) -> str:
        found = re.findall(r"<tr>(.*?)</tr>", match.group(1), flags=re.I | re.S)
        body: list[list[str]] = []
        for row in found:
            cells = re.findall(r"<td>(.*?)</td>", row, flags=re.I | re.S)
            body.append([_html_to_text(cell).strip() for cell in cells])
        if not body:
            return ""
        width = max(len(row) for row in body)

        def line(cells: list[str]) -> str:
            padded = cells + [""] * (width - len(cells))
            return "| " + " | ".join(_md_text(cell) for cell in padded) + " |"

        lines = [line(body[0]), "|" + "|".join("---" for _index in range(width)) + "|"]
        lines.extend(line(row) for row in body[1:])
        return "\n" + "\n".join(lines) + "\n"

    return re.sub(r"<table>(.*?)</table>", one, html, flags=re.I | re.S)


def _rich_markdown(html: str, *, nested: bool = False) -> str:
    """Ответ бота: заголовки, таблицы сумм и позиций, списки и цитаты заметок."""
    html = _html_table_markdown(html)
    out: list[str] = []
    first = not nested
    rows = str(html or "").split("\n")
    index = 0
    while index < len(rows):
        raw = rows[index]
        line = raw.strip()
        if not line:
            if out and out[-1] != "":
                out.append("")
            index += 1
            continue
        if line == "<details>":
            summary = "Показать ещё"
            inner: list[str] = []
            index += 1
            while index < len(rows):
                cur = rows[index].strip()
                if cur == "</details>":
                    index += 1
                    break
                found = re.fullmatch(r"<summary>(.*?)</summary>", cur)
                if found:
                    summary = _html_to_text(found.group(1)).strip() or summary
                    index += 1
                    continue
                inner.append(rows[index])
                index += 1
            body = _rich_markdown("\n".join(inner), nested=True)
            out.append("<details>")
            out.append(f"<summary>{html_esc(summary)}</summary>")
            if body:
                out.append("")
                out.append(body)
            out.append("</details>")
            continue
        mixed = re.fullmatch(r"<b>(.*?)</b>\s*(.*)", line)
        if mixed:
            title = _html_to_text(mixed.group(1)).strip()
            rest = _html_to_text(mixed.group(2)).strip(" ·")
            section = title in _RICH_SECTIONS
            if out and str(out[-1]).startswith(">"):
                out.append("")
            if not first and not section and out:
                out.append("---")
            level = "#" if first else ("##" if section else "###")
            head = f"{level} {_md_text(title)}"
            if rest and (section or "·" not in rest):
                head += " — " + _md_text(rest)
                rest = ""
            out.append(head)
            if first and rest:
                out.append("*" + _md_text(rest) + "*")
                rest = ""
            if rest:
                bits = [bit.strip() for bit in rest.split("·") if bit.strip()]
                lead = f"**{_md_text(bits[0])}**" if bits else ""
                if len(bits) > 1:
                    lead += " · " + " · ".join(_md_text(bit) for bit in bits[1:])
                if lead:
                    out.append(lead)
            first = False
            index += 1
            continue
        plain = _html_to_text(line).strip()
        if plain.lower().startswith("заметка:"):
            out.append("> " + _md_text(plain.split(":", 1)[1].strip()))
            index += 1
            continue
        pairs = _money_pairs(plain)
        if not pairs and "·" not in plain:
            low = plain.lower()
            label = next((item for item in _MONEY_LABELS if low.startswith(item)), "")
            if label:
                pairs = [(plain[: len(label)], plain[len(label) :].strip())]
        if pairs:
            out.append("")
            out.append(_kv_table(pairs))
            index += 1
            continue
        if plain.startswith("•") or plain.startswith("-"):
            positions: list[list[str]] = []
            notes: list[tuple[int, str]] = []
            plain_items: list[str] = []
            while index < len(rows):
                cur = rows[index]
                stripped = _html_to_text(cur).strip()
                if not stripped:
                    break
                if cur.startswith("  ") and not stripped.startswith(("•", "-")):
                    if positions:
                        notes.append((len(positions) - 1, stripped))
                    elif plain_items:
                        notes.append((-1, stripped))
                    index += 1
                    continue
                if not stripped.startswith(("•", "-")):
                    break
                body = re.sub(r"^[•\-]\s*", "", stripped)
                cells = _position_cells(body)
                if cells and not plain_items:
                    positions.append(cells)
                elif positions:
                    break
                else:
                    plain_items.append(body)
                index += 1
            if positions:
                out.append("")
                out.append(_positions_table(positions))
                for row_i, note in notes:
                    if row_i < 0:
                        out.append("> " + _md_text(note))
                        continue
                    name = positions[row_i][0]
                    out.append(f"> **{_md_text(name)}.** {_md_text(note)}")
            else:
                for item in plain_items:
                    out.append("- " + _md_text(item))
                for _row_i, note in notes:
                    out.append("> " + _md_text(note))
            continue
        if plain.startswith("|"):
            out.append(plain)
            index += 1
            continue
        if plain.lower().startswith("ещё") or plain.lower().startswith("еще"):
            out.append("*" + _md_text(plain) + "*")
        elif " · " in plain:
            header = [bit.strip() for bit in plain.split("·") if bit.strip()]
            look = index + 1
            body_rows: list[list[str]] = []
            while look < len(rows) and len(header) >= 2:
                raw_next = rows[look]
                nxt = _html_to_text(raw_next).strip()
                if not nxt:
                    look += 1
                    continue
                if raw_next.startswith("  ") or not nxt.startswith(("•", "-")):
                    break
                cells = [bit.strip() for bit in re.sub(r"^[•\-]\s*", "", nxt).split("·") if bit.strip()]
                if len(cells) != len(header):
                    break
                body_rows.append(cells)
                look += 1
            if body_rows:
                out.append("")
                out.append(_generic_table(header, body_rows))
                index = look
                first = False
                continue
            bits = header
            for bit in bits:
                out.append("- " + _md_text(bit))
        else:
            out.append(_md_text(plain))
        first = False
        index += 1
    return re.sub(r"\n{3,}", "\n\n", "\n".join(out)).strip()


def _send_rich(token: str, chat_id: str, markdown: str, markup: dict[str, Any] | None) -> int | None:
    payload: dict[str, Any] = {
        "chat_id": chat_id,
        "rich_message": {"markdown": markdown},
    }
    if markup:
        payload["reply_markup"] = markup
    data = _call(token, "sendRichMessage", payload, timeout=30)
    result = data.get("result") if isinstance(data.get("result"), dict) else {}
    mid = result.get("message_id")
    if mid is not None:
        _bump_tail(chat_id, int(mid))
        return int(mid)
    return None


def _html_chunks(text: str, limit: int = 3800) -> list[str]:
    parts: list[str] = []
    buf = ""
    for line in str(text or "").split("\n"):
        piece = line if not buf else "\n" + line
        if buf and len(buf) + len(piece) > limit:
            parts.append(buf)
            buf = line
            continue
        buf += piece
        while len(buf) > limit:
            parts.append(buf[:limit])
            buf = buf[limit:]
    if buf.strip():
        parts.append(buf)
    return parts


def send_long_html(token: str, chat_id: str, text: str, markup: dict[str, Any] | None = None) -> None:
    """Ответ остаётся в чате списком. Файл — только если он не влезает даже в длинное сообщение."""
    body = str(text or "").strip()
    if not body:
        return
    plain = _html_to_text(body).strip()
    markdown = _rich_markdown(body)
    if markdown and len(markdown) <= 30000 and markdown.count("\n") < 450:
        try:
            _send_rich(token, chat_id, markdown, markup)
            return
        except RuntimeError:
            pass
    chunks = _html_chunks(body)
    if len(plain) > 30000 or len(chunks) > 6:
        head = chunks[0] if chunks else html_esc(plain[:500])
        send_html(token, chat_id, f"{head}\n<i>Дальше — в файле.</i>", markup)
        with _ChatBusy(token, chat_id, "Отправляю файл с ответом…", bar=True, action="upload_document") as busy:
            busy.step("Готовлю файл…", 0.4)
            send_document(token, chat_id, plain.encode("utf-8"), "finmaster-otvet.txt", "Полный ответ")
        return
    for index, chunk in enumerate(chunks):
        send_html(token, chat_id, chunk, markup if index == len(chunks) - 1 else None)


def _tg_file(token: str, file_id: str) -> bytes:
    data = _call(token, "getFile", {"file_id": file_id}, timeout=30)
    result = data.get("result") if isinstance(data.get("result"), dict) else {}
    path = str(result.get("file_path") or "")
    if not path or ".." in path.replace("\\", "/").split("/"):
        raise RuntimeError("Telegram не отдал файл записи.")
    url = (
        f"https://api.telegram.org/file/bot{urllib.parse.quote(token, safe=':-_')}/"
        f"{urllib.parse.quote(path, safe='/')}"
    )
    with urllib.request.urlopen(url, timeout=60) as response:
        return response.read()


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


def _send_chat_action(token: str, chat_id: str, action: str) -> None:
    try:
        _call(token, "sendChatAction", {"chat_id": chat_id, "action": action}, timeout=8)
    except RuntimeError:
        pass


def _progress_bar_determinate(ratio: float, width: int = 20) -> str:
    """Полоса с восьмушками на границе — плавнее, чем целые блоки."""
    clamped = max(0.0, min(1.0, ratio))
    units = clamped * width * 8
    full = int(units // 8)
    partial = int(round(units - full * 8))
    if partial >= 8:
        full += 1
        partial = 0
    shades = "▏▎▍▌▋▊▉"
    tail = shades[partial - 1] if 0 < partial < 8 and full < width else ""
    empty = width - full - (1 if tail else 0)
    return "█" * full + tail + "░" * max(0, empty)


def _progress_bar_scan(tick: int, width: int = 20) -> str:
    """Бегущий блик, пока доля готовности неизвестна."""
    span = 5
    head = tick % (width + span)
    shades = "▏▎▍▌▋▊▉█"
    cells: list[str] = []
    for index in range(width):
        dist = head - index
        if 0 <= dist < span:
            level = min(7, int((span - dist) / span * 8))
            cells.append(shades[level])
        else:
            cells.append("░")
    return "".join(cells)


def _callback_notice(data: str) -> str:
    fixed = {
        "H": "Меню…",
        "R": "Список отчётов…",
        "O": "Список заказов…",
        "L": "Обновляю ссылку…",
        "Bk": "Ссылка на хранилище…",
        "N": "Новая ссылка…",
        "Ny": "Выпускаю новую ссылку…",
        "Nn": "Отмена…",
        "S": "Снимок…",
        "SB": "Снимок…",
        "So": "Оформление снимка…",
        "Sv": "Профили снимка…",
        "SP": "Готовлю PNG…",
        "Sd": "Настройки PDF…",
        "Sdp": "Собираю PDF…",
        "ST": "Готовлю текст…",
        "Wh": "Переключаю доступ…",
        "Wa": "Переключаю доступ…",
        "PC": "Открываю на компьютере…",
        "D": "Карточка заказа…",
        "Vr": "Отменяю распознавание…",
    }
    if data in fixed:
        return fixed[data]
    if data.startswith("Ri:"):
        return "Открываю отчёт…"
    if data.startswith("Oi:"):
        return "Открываю заказ…"
    if data.startswith("Aq:"):
        return "Отвечаю…"
    if data.startswith(("Rp:", "Op:", "Of:", "Os")):
        return "Обновляю список…"
    if data.startswith(("Sx:", "Sy:", "Sp:", "St:", "Sf:", "Sn:", "Sa:", "Pf:")):
        return "Обновляю снимок…"
    if data in {"SF", "SN", "SA", "SC", "SX", "Shl", "Shs", "La", "Ln", "Li", "LG", "Aa", "An", "Ai", "AG", "B"}:
        return "Обновляю снимок…"
    if data.startswith(("Ls:", "As:")):
        return "Отмечаю позиции…"
    return "Обрабатываю…"


def _callback_action(data: str) -> str:
    if data in {"SP"}:
        return "upload_photo"
    if data in {"Sdp", "ST"}:
        return "upload_document"
    if data.startswith("Aq:"):
        return "typing"
    return "typing"


class _ChatBusy:
    """«Печатает…» в шапке чата и, для долгих задач, сообщение с полосой прогресса."""

    def __init__(self, token: str, chat_id: str, label: str, *, bar: bool = False, action: str = "typing") -> None:
        self._token = token
        self._chat_id = chat_id
        self._label = label
        self._bar = bar
        self._action = action
        self._ratio = 0.08 if bar else 0.0
        self._pulse = 0
        self._determinate = bar
        self._msg_id: int | None = None
        self._markup: dict[str, Any] | None = None
        self._stop = threading.Event()
        self._thread: threading.Thread | None = None
        self._cancel_timer: threading.Timer | None = None
        self._last_edit = 0.0
        self._last_ratio = -1.0

    def __enter__(self) -> _ChatBusy:
        _send_chat_action(self._token, self._chat_id, self._action)
        self._thread = threading.Thread(target=self._loop, name="fm-tg-busy", daemon=True)
        self._thread.start()
        if self._bar:
            self._msg_id = send_html(self._token, self._chat_id, self._progress_html())
        return self

    def arm_cancel(self, data: str, delay: float = 2.0) -> None:
        """Кнопка «Отменить» на карточке, если работа ещё идёт через delay секунд."""
        timer = threading.Timer(delay, self._show_cancel, args=(data,))
        timer.daemon = True
        self._cancel_timer = timer
        timer.start()

    def _show_cancel(self, data: str) -> None:
        if self._stop.is_set() or self._msg_id is None:
            return
        self._markup = _inline([[_btn("Отменить", data)]])
        self._last_edit = 0.0
        self._paint()

    def __exit__(self, *exc: object) -> None:
        self._stop.set()
        if self._cancel_timer:
            self._cancel_timer.cancel()
        if self._thread:
            self._thread.join(timeout=1.5)
        if self._msg_id is not None:
            try:
                _call(
                    self._token,
                    "deleteMessage",
                    {"chat_id": self._chat_id, "message_id": self._msg_id},
                    timeout=8,
                )
            except RuntimeError:
                pass
            self._msg_id = None

    def step(self, label: str | None = None, ratio: float | None = None) -> None:
        if label:
            self._label = label
        if ratio is not None:
            self._ratio = max(0.0, min(1.0, ratio))
            self._determinate = True
        elif self._bar:
            self._determinate = False
            self._pulse += 1
        self._paint()

    def _loop(self) -> None:
        while not self._stop.wait(4.2):
            _send_chat_action(self._token, self._chat_id, self._action)
            if self._bar:
                self.step(ratio=None)

    def _progress_html(self) -> str:
        width = 20
        show_pct = self._determinate and self._ratio > 0.008
        if show_pct:
            bar = _progress_bar_determinate(self._ratio, width)
            pct = f"{int(round(self._ratio * 100)):>3}%"
        else:
            bar = _progress_bar_scan(self._pulse, width)
            pct = "  · "
        track = f"▏{bar}▕"
        return f"<b>{html_esc(self._label)}</b>\n<pre>{track}\n{pct}</pre>"

    def _paint(self) -> None:
        if not self._bar or self._msg_id is None:
            return
        now = time.time()
        if now - self._last_edit < 0.5 and abs(self._ratio - self._last_ratio) < 0.035:
            return
        self._last_edit = now
        self._last_ratio = self._ratio
        try:
            send_html(self._token, self._chat_id, self._progress_html(), self._markup, message_id=self._msg_id)
        except RuntimeError:
            pass


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
        "Кнопки внизу: <b>Отчёты</b>, <b>Заказы</b>, <b>Снимок</b>, <b>Ссылка</b>, <b>Хранилище</b>, <b>Интерфейс ПК</b>, <b>Новая ссылка</b>, <b>Голос</b>.\n"
        "«Открыть» — телефон. «Хранилище» — копилки на телефоне. «Интерфейс ПК» — тот же экран, что на компьютере.\n"
        "Голосом или текстом можно спросить долги, заказы, кассу, календарь, заказчика — отвечу по открытому отчёту.\n"
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
    desk = _desk_link(link)
    bank = _bank_link(link)
    text = f"{banner}\n\n<b>Три ссылки.</b> {how}\n\n<b>Телефон</b>\n<code>{html_esc(link)}</code>"
    if bank:
        text += f"\n\n<b>Хранилище</b>\n<code>{html_esc(bank)}</code>"
    if desk:
        text += f"\n\n<b>Интерфейс ПК</b>\n<code>{html_esc(desk)}</code>"
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
        rows.append([_open_btn("Телефон", link)])
        bank = _bank_link(link)
        if bank:
            rows.append([_open_btn("Хранилище", bank)])
        desk = _desk_link(link)
        if desk:
            rows.append([_open_btn("Интерфейс ПК", desk)])
        rows.append([_btn("Обновить ссылку", "L"), _btn("Новая ссылка", "N")])
    else:
        rows.append([_btn("Получить ссылку", "L")])
    rows.append([web_access_btn(flags, "Wa")])
    rows.append([_btn("Отчёты", "R"), _btn("Заказы", "O")])
    return rows


def send_bank_link(token: str, chat_id: str, url: str, info: Any = None) -> None:
    flags = _status(info)
    link = _bank_link(str(url or flags.get("url") or ""))
    if not flags.get("access") or not link:
        send_html(
            token,
            chat_id,
            "Хранилище откроется после кнопки <b>Включить доступ к веб</b>.",
            _inline([[web_access_btn(flags)]]),
        )
        return
    send_html(
        token,
        chat_id,
        "<b>Хранилище</b>\n"
        f"<code>{html_esc(link)}</code>\n"
        "те же страницы, строки, цель и график, что на компьютере. Экран собран под телефон.",
        _inline([[_open_btn("Открыть хранилище", link)]]),
    )


def send_desk_link(token: str, chat_id: str, url: str, info: Any = None) -> None:
    flags = _status(info)
    link = _desk_link(str(url or flags.get("url") or ""))
    if not flags.get("access") or not link:
        send_html(
            token,
            chat_id,
            "Интерфейс компьютера откроется после кнопки <b>Включить доступ к веб</b>.",
            _inline([[web_access_btn(flags)]]),
        )
        return
    phone = str(url or flags.get("url") or "").strip()
    rows = []
    text = "<b>Две ссылки.</b> Файлы остаются на главном компьютере."
    if phone.startswith(("http://", "https://")):
        text += f"\n\n<b>Телефон</b>\n<code>{html_esc(phone)}</code>"
        rows.append([_open_btn("Телефон", phone)])
    text += (
        "\n\n<b>Интерфейс ПК</b>\n"
        f"<code>{html_esc(link)}</code>\n"
        "тот же экран, что в окне FinMaster."
    )
    rows.append([_open_btn("Интерфейс ПК", link)])
    send_html(token, chat_id, text, _inline(rows))


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
        raise RuntimeError("Нет подтверждённых пользователей. Пусть человек напишет боту — запрос придёт в окно «Телефон».")
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
                    {"command": "bank", "description": "Хранилище на телефоне"},
                    {"command": "newlink", "description": "Новая ссылка на телефон"},
                    {"command": "ask", "description": "Спросить по открытому отчёту"},
                    {"command": "voice", "description": "Модель распознавания речи"},
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
    """Отчёт, открытый в окне программы. С телефона приходят правки того же файла."""
    desktop = str(REMOTE.desktop_path or "")
    if desktop and os.path.isfile(desktop):
        return desktop
    if REMOTE.enabled and REMOTE.path and os.path.isfile(str(REMOTE.path)):
        return str(REMOTE.path)
    return ""


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
        self.chosen = False
        self.live = False
        self.filter = "all"
        self.search = ""
        self.rpage = 0
        self.opage = 0
        self.reports: list[str] = []
        self.orders: list[str] = []
        self.order_id = ""
        self.awaiting = ""
        self.pending_ask = ""
        self.ask_hints: list[str] = []
        self.message_id: int | None = None
        self.snap: dict[str, Any] = self._fresh_snap()

    def _fresh_snap(self) -> dict[str, Any]:
        return {
            "fields": list(snapmod.PRESETS["invoice"]),
            "theme": "teal",
            "hide_labels": False,
            "hide_stamp": False,
            "hide_totals": False,
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
        self._group_told: set[str] = set()
        self._declined_told: set[str] = set()
        self._voice_watch: threading.Thread | None = None
        self._hear_thread: threading.Thread | None = None
        self._hear_stop: threading.Event | None = None
        self._work_lock = threading.Lock()

    def _busy(
        self,
        token: str,
        chat_id: str,
        label: str,
        *,
        bar: bool = False,
        action: str = "typing",
    ) -> _ChatBusy:
        return _ChatBusy(token, chat_id, label, bar=bar, action=action)

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
        people = storage.remote_settings().get("telegram_users") or []
        chat_id = ""
        if user_id:
            chat_id = next((str(item.get("id") or "") for item in people if str(item.get("id") or "") == str(user_id)), "")
        if not chat_id and people:
            chat_id = str(people[0].get("id") or "")
        if not chat_id:
            raise RuntimeError("Нет подтверждённого чата. Пусть человек напишет боту и подтвердите запрос в окне «Телефон».")
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

    def _reply_kb(self, chat_id: str) -> None:
        """Нижние кнопки не прикладываются к ответу: иначе Telegram раскрывает их после каждого сообщения."""
        return None

    def _chat(self, chat_id: str) -> ChatSession:
        with self._lock:
            session = self._chats.get(chat_id)
            if session is None:
                session = ChatSession()
                self._chats[chat_id] = session
            return session

    def _admit(
        self,
        token: str,
        chat_id: str,
        sender: dict[str, Any] | None = None,
        text: str = "",
    ) -> bool:
        from backend import secrets as token_store

        person = sender if isinstance(sender, dict) else {}

        username = str(person.get("username") or "")
        first_name = str(person.get("first_name") or "")
        last_name = str(person.get("last_name") or "")

        name = " ".join(
            part for part in (first_name, last_name) if part
        ).strip()

        low = text.lower().strip()
        restart = low in {"/start", "start"} or low.startswith("/start@")

        state = token_store.ask(
            str(chat_id),
            username,
            name,
            restart=restart,
            first_name=first_name,
            last_name=last_name,
            language_code=person.get("language_code") or "",
            requested_at=int(time.time()),
        )

        if state == "allowed":
            self._declined_told.discard(str(chat_id))
            return True

        if state == "group":
            if str(chat_id) not in self._group_told:
                self._group_told.add(str(chat_id))
                send_html(
                    token,
                    chat_id,
                    "Напишите боту в личные сообщения. В группе он не отвечает.",
                )
            return False

        if state == "new":
            nick = f"@{username.lstrip('@')}" if username else (name or str(chat_id))

            send_html(
                token,
                chat_id,
                "Запрос отправлен на компьютер. Дождитесь подтверждения в окне «Телефон».",
            )

            requested = time.strftime(
                "%d.%m.%Y %H:%M:%S",
                time.localtime(int(time.time())),
            )

            netlog.add(
                "telegram",
                f"Запрос доступа: {nick}, id {chat_id}, время {requested}",
                level="warn",
                key=f"tg-ask-{chat_id}",
            )

            return False

        if state == "declined":
            if str(chat_id) not in self._declined_told:
                self._declined_told.add(str(chat_id))
                send_html(
                    token,
                    chat_id,
                    "Доступ закрыт. Чтобы попросить снова, напишите /start.",
                )
            return False

        return False

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
                query = upd["callback_query"]
                sender = query.get("from") if isinstance(query.get("from"), dict) else {}
                chat = {}
                message = query.get("message") if isinstance(query.get("message"), dict) else {}
                if isinstance(message.get("chat"), dict):
                    chat = message["chat"]
                cid = chat.get("id")
                if cid is None:
                    cid = sender.get("id")
                who = _person_label(sender, cid)
                data = str(query.get("data") or "")
                with bridge.slot("telegram", data or "кнопка", {"data": data, "chat_id": cid, "from": who}, who):
                    self._on_callback(token, query)
                return
            with self._work_lock:
                self._handle_message(token, upd)
        except RuntimeError as exc:
            with self._lock:
                self._error = str(exc)

    def _handle_message(self, token: str, upd: dict[str, Any]) -> None:
        try:
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
            voice_msg = msg.get("voice") if isinstance(msg.get("voice"), dict) else None
            audio_msg = msg.get("audio") if isinstance(msg.get("audio"), dict) else None
            clip = voice_msg or audio_msg
            if clip and clip.get("file_id"):
                self._on_voice(token, str(cid), str(clip.get("file_id")), sender if isinstance(sender, dict) else {})
                return
            text = str(msg.get("text") or "").strip()
            who = _person_label(sender, cid)
            netlog.add(
                "telegram",
                f"Сообщение: {text[:80] or 'без текста'}",
                source=f"chat {cid}",
                key=f"tg-msg-{cid}",
            )
            with bridge.slot(
                "telegram",
                text or "Сообщение без текста",
                {"chat_id": cid, "from": who, "text": text, "message_id": msg.get("message_id")},
                who,
            ):
                self._on_text(token, str(cid), text, sender=sender if isinstance(sender, dict) else {})
            with self._lock:
                self._error = ""
        except RuntimeError as exc:
            with self._lock:
                self._error = str(exc)

    def _on_voice(self, token: str, chat_id: str, file_id: str, sender: dict[str, Any] | None = None) -> None:
        who = _person_label(sender, chat_id)
        box = bridge.open_box("telegram", "Голосовое", {"chat_id": chat_id, "file_id": file_id, "from": who}, who)
        token_ctx = bridge.activate(box)
        handed = False
        try:
            if not self._admit(token, chat_id, sender):
                return
            with self._lock:
                if self._hear_thread is not None and self._hear_thread.is_alive():
                    busy = True
                else:
                    busy = False
                    self._hear_stop = threading.Event()
                    thread = threading.Thread(
                        target=self._hear_voice,
                        args=(token, chat_id, file_id, box),
                        name="fm-hear",
                        daemon=True,
                    )
                    self._hear_thread = thread
                    thread.start()
                    handed = True
            if busy:
                send_html(token, chat_id, "Уже разбираю предыдущую запись.")
        finally:
            bridge.deactivate(token_ctx)
            if not handed:
                bridge.commit(box)

    def _cancel_hear(self, token: str, chat_id: str) -> None:
        with self._lock:
            stop = self._hear_stop
            alive = self._hear_thread is not None and self._hear_thread.is_alive()
        if stop is not None and alive:
            stop.set()
            return
        send_html(token, chat_id, "Сейчас ничего не разбирается.")

    def _hear_voice(self, token: str, chat_id: str, file_id: str, box: bridge.Box | None = None) -> None:
        stop = self._hear_stop
        token_ctx = bridge.activate(box) if box is not None else None
        try:
            self._hear_voice_body(token, chat_id, file_id, box, stop)
        finally:
            if token_ctx is not None:
                bridge.deactivate(token_ctx)
            if box is not None:
                bridge.commit(box)

    def _hear_voice_body(self, token: str, chat_id: str, file_id: str, box: bridge.Box | None, stop: Any) -> None:
        with self._busy(token, chat_id, "Слушаю запись…", bar=True, action="record_voice") as busy:
            busy.arm_cancel("Vr")
            try:
                voice.require()
                need_model = not voice.model_ready()
                if need_model:
                    busy.step(
                        "Первый раз скачиваю распознавание речи. Нужен интернет, дальше голос разбирается здесь.",
                        0.05,
                    )

                def _voice_progress(ratio: float, text: str) -> None:
                    busy.step(text, ratio if need_model else None)

                heard = voice.transcribe(
                    _tg_file(token, file_id),
                    on_progress=_voice_progress,
                    should_stop=stop.is_set if stop is not None else None,
                )
            except (voice.RecognizeCancelled, voice.DownloadCancelled):
                send_html(token, chat_id, "Распознавание отменено.")
                return
            except voice.VoiceError as exc:
                send_html(token, chat_id, html_esc(str(exc)))
                return
            except Exception as exc:
                send_html(token, chat_id, f"Не удалось разобрать голос: {html_esc(str(exc) or 'ошибка')}")
                return
        heard = " ".join(str(heard or "").split())
        if not heard:
            send_html(token, chat_id, "Не разобрал речь. Скажите ближе к телефону или напишите вопрос текстом.")
            return
        netlog.add("telegram", f"Голос: {heard[:80]}", source=f"chat {chat_id}", key=f"tg-voice-{chat_id}")
        if box is not None:
            box.ask = f"Голос: {heard[:400]}"
            box.ask_body = {"chat_id": chat_id, "file_id": file_id, "from": box.who, "text": heard}
        send_html(token, chat_id, f"Услышал: <i>{html_esc(heard)}</i>")
        with self._work_lock:
            self._on_text(token, chat_id, heard, voice=True)

    def _on_text(self, token: str, chat_id: str, text: str, voice: bool = False, sender: dict[str, Any] | None = None) -> None:
        if not self._admit(token, chat_id, sender, text):
            return
        low = text.lower()
        info = self._status_for(chat_id)
        if low in ASK_MENU or not text:
            self._chat(chat_id).pending_ask = ""
            send_welcome(token, chat_id, info)
            self._show(token, chat_id, "home")
            return
        busy_label = "Разбираю голос…" if voice else "Читаю запрос…"
        with self._busy(token, chat_id, busy_label, action="typing"):
            self._on_text_body(token, chat_id, text, voice=voice)

    def _on_text_body(self, token: str, chat_id: str, text: str, voice: bool = False) -> None:
        low = text.lower()
        info = self._status_for(chat_id)
        session = self._chat(chat_id)
        if session.awaiting == "title" and not voice:
            session.snap["title"] = text[:80]
            session.awaiting = ""
            self._show(token, chat_id, "look")
            return
        if low in ASK_LINK:
            send_access(token, chat_id, str(info.get("url") or ""), info)
            return
        if low in ASK_DESK:
            send_desk_link(token, chat_id, str(info.get("url") or ""), info)
            return
        if low in ASK_BANK:
            send_bank_link(token, chat_id, str(info.get("url") or ""), info)
            return
        if low in ASK_NEW_LINK:
            self._ask_new_link(token, chat_id)
            return
        if low in {"/voice", "voice", "голос", "модель голоса", "модели голоса"} or low.startswith("/voice@"):
            self._show_voice(token, chat_id)
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
        if text and self._try_ask(token, chat_id, text, voice=voice):
            return
        if voice:
            send_html(
                token,
                chat_id,
                "Не нашёл это в отчёте. Спросите долги, заказы, выручку, календарь или имя заказчика.",
                self._reply_kb(chat_id),
            )
            return
        if session.screen in {"orders", "order", "home"} and text and not ask.blocks_order_search(text):
            session.search = text
            session.opage = 0
            self._show(token, chat_id, "orders")
            return
        if ask.blocks_order_search(text):
            send_html(token, chat_id, "Не разобрал эту фразу.", self._reply_kb(chat_id))
            return
        send_html(token, chat_id, "Нажмите <b>Отчёты</b>, <b>Заказы</b>, <b>Снимок</b>, <b>Хранилище</b> или <b>Меню</b>.", self._reply_kb(chat_id))

    def _adopt_open(self, session: ChatSession) -> str:
        """Пока в чате цель не выбирали, вопрос идёт в отчёт, открытый в программе."""
        if session.chosen and session.path:
            return session.path
        live = _live_path()
        session.path = live
        return live

    def _has_report(self, session: ChatSession) -> bool:
        if self._adopt_open(session):
            return True
        return bool(not session.chosen and REMOTE.enabled and isinstance(REMOTE.doc, dict))

    def _try_ask(self, token: str, chat_id: str, text: str, voice: bool = False) -> bool:
        session = self._chat(chat_id)
        doc, live = self._doc_of(session)
        reply = ask.parse(text, doc, voice=voice, live=live)
        if reply is None:
            return False
        if reply.action == "open_report":
            self._open_named_report(token, chat_id, reply.target)
            return True
        if reply.action == "reports":
            self._show(token, chat_id, "reports")
            return True
        if reply.action == "orders":
            session.opage = 0
            self._show(token, chat_id, "orders")
            return True
        if reply.action == "link":
            info = self._status_for(chat_id)
            send_access(token, chat_id, str(info.get("url") or ""), info)
            return True
        if reply.action == "bank":
            info = self._status_for(chat_id)
            send_bank_link(token, chat_id, str(info.get("url") or ""), info)
            return True
        if reply.action == "pc":
            self._open_on_pc(token, chat_id)
            return True
        if reply.suggestions and not str(reply.html or "").strip() and not reply.action:
            hints = [str(item) for item in reply.suggestions[:6]]
            session.ask_hints = hints
            rows = [[_btn(item[:48], f"Aq:{index}")] for index, item in enumerate(hints)]
            send_html(token, chat_id, "Возможно, вы имели в виду:", _inline(rows))
            return True
        if reply.action == "snap" and not reply.html:
            self._prepare_snap(session, reset=not bool(session.snap.get("ready")))
            self._show(token, chat_id, "snap")
            return True
        if reply.needs_report and not self._has_report(session):
            session.pending_ask = text
            send_html(
                token,
                chat_id,
                "Сначала выберите отчёт. После выбора отвечу на этот вопрос.",
                self._reply_kb(chat_id),
            )
            self._show(token, chat_id, "reports")
            return True
        if reply.html:
            send_long_html(token, chat_id, reply.html, self._reply_kb(chat_id))
        if reply.action == "snap":
            self._prepare_snap(session, reset=True)
            session.snap["hide_totals"] = bool(reply.hide_totals)
            self._show(token, chat_id, "snap")
        elif reply.action == "snap_send":
            self._prepare_snap(session, reset=True)
            if reply.order_ids:
                session.snap["order_ids"] = list(reply.order_ids)
            session.snap["hide_totals"] = bool(reply.hide_totals)
            self._send_snap(token, chat_id, reply.kind or "png")
        return True

    def _open_named_report(self, token: str, chat_id: str, query: str) -> None:
        needle = " ".join(str(query or "").lower().replace("ё", "е").split())
        if not needle:
            self._show(token, chat_id, "reports")
            return
        seen: list[str] = []
        found: list[dict[str, Any]] = []
        for item in _library_items() + [row for row in _recent_items() if row.get("exists") is not False]:
            path = str(item.get("path") or "")
            if not path or any(storage.same_path(path, other) for other in seen):
                continue
            seen.append(path)
            title = str(item.get("title") or item.get("name") or os.path.basename(path)).lower().replace("ё", "е")
            base = os.path.basename(path).lower()
            if needle in title or needle in base:
                found.append(item)
        if len(found) != 1:
            send_html(
                token,
                chat_id,
                "Не вижу такого отчёта." if not found else "Подходит несколько файлов — выберите в списке.",
                self._reply_kb(chat_id),
            )
            self._show(token, chat_id, "reports")
            return
        path = str(found[0].get("path") or "")
        if not _path_allowed(path):
            send_html(token, chat_id, "Этот файл открыть нельзя.")
            return
        session = self._chat(chat_id)
        session.path = path
        session.chosen = True
        session.order_id = ""
        session.search = ""
        session.filter = "all"
        session.opage = 0
        session.snap = session._fresh_snap()
        self._show(token, chat_id, "orders")

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
        notice = _callback_notice(data)
        if qid:
            try:
                _call(token, "answerCallbackQuery", {"callback_query_id": qid, "text": notice})
            except RuntimeError:
                pass
        if cid is None:
            return
        chat_id = str(cid)
        sender = query.get("from") if isinstance(query.get("from"), dict) else {}
        if not self._admit(token, chat_id, sender):
            return
        labels = {
            "H": "меню",
            "R": "отчёты",
            "O": "заказы",
            "L": "ссылка",
            "Bk": "хранилище",
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
            elif data.startswith("Aq:"):
                hint = "вариант запроса"
            else:
                hint = data or "кнопка"
        netlog.add("telegram", f"Кнопка: {hint}", source=f"chat {chat_id}", key=f"tg-cb-{chat_id}")
        slot = bridge.current()
        if slot is not None:
            slot.ask = f"Кнопка: {hint}"
            slot.ask_body = {"data": data, "button": hint, "chat_id": chat_id, "from": slot.who}
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
        if data == "Vr":
            self._cancel_hear(token, chat_id)
            return
        if data in {"Vx", "Vn"} or data.startswith(("Vu:", "Vg:", "Vi:", "Vd:", "Vy:")):
            self._voice_action(token, chat_id, data)
            return
        with self._work_lock:
            self._dispatch_callback(token, chat_id, data, mid, notice)

    def _dispatch_callback(self, token: str, chat_id: str, data: str, mid: Any, notice: str) -> None:
        session = self._chat(chat_id)
        if mid is not None:
            session.message_id = int(mid)
        with self._busy(token, chat_id, notice, bar=data == "Ny", action=_callback_action(data)):
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

    def _show_voice(self, token: str, chat_id: str) -> None:
        data = voice.catalog()
        lines = ["<b>Модели речи</b>", "Распознавание идёт на этом компьютере. Запись никуда не отправляется."]
        rows: list[list[dict[str, Any]]] = []
        for model in data.get("models") or []:
            if not isinstance(model, dict) or not model.get("code"):
                continue
            job = data.get("job") if isinstance(data.get("job"), dict) else {}
            busy = bool(job.get("running") and job.get("model") == model.get("id"))
            mark = " · рабочая" if model.get("active") else ""
            if busy:
                state = f"скачивается, {int(job.get('progress') or 0)}%"
            elif model.get("ready"):
                state = "скачана"
            else:
                state = f"можно скачать, {model.get('size') or 'размер неизвестен'}"
            lines.append(f"\n<b>{html_esc(str(model.get('label') or ''))}</b>{mark}\n{html_esc(state)}")
            code = str(model.get("code") or "")
            row: list[dict[str, Any]] = []
            if busy:
                row.append(_btn("Отменить", "Vx"))
            elif model.get("ready") and not model.get("active"):
                row.append(_btn("Включить", f"Vu:{code}"))
            elif not model.get("ready"):
                row.append(_btn("Скачать", f"Vg:{code}"))
            if model.get("ready") and not busy:
                row.append(_btn("Удалить", f"Vd:{code}"))
            row.append(_btn("i", f"Vi:{code}"))
            rows.append(row)
        rows.append([_btn("Меню", "H")])
        send_html(token, chat_id, "\n".join(lines), _inline(rows))

    def _voice_action(self, token: str, chat_id: str, data: str) -> None:
        if data == "Vn":
            self._show_voice(token, chat_id)
            return
        if data == "Vx":
            job = voice.cancel_download()
            with self._lock:
                live = self._voice_watch is not None and self._voice_watch.is_alive()
            if not live:
                if job.get("running") or job.get("text") == "Отмена…":
                    send_html(token, chat_id, "Отменяю скачивание…")
                else:
                    send_html(token, chat_id, "Сейчас ничего не скачивается.")
            return
        code = data.split(":", 1)[1] if ":" in data else ""
        model_id = voice.id_of(code)
        if not model_id:
            send_html(token, chat_id, "Такой модели нет.")
            return
        spec = next((item for item in voice.CATALOG if item["id"] == model_id), None)
        label = str((spec or {}).get("label") or model_id)
        if data.startswith("Vi:"):
            send_html(token, chat_id, f"<b>{html_esc(label)}</b>\n{html_esc(voice.describe(model_id))}")
            return
        if data.startswith("Vu:"):
            try:
                voice.set_active(model_id)
            except voice.VoiceError as exc:
                send_html(token, chat_id, html_esc(str(exc)))
                return
            send_html(token, chat_id, f"Рабочая модель: <b>{html_esc(label)}</b>.")
            self._show_voice(token, chat_id)
            return
        if data.startswith("Vd:"):
            send_html(
                token,
                chat_id,
                f"Удалить <b>{html_esc(label)}</b> с этого компьютера? Если она рабочая, подпись снимется.",
                _inline([[_btn("Удалить", f"Vy:{code}"), _btn("Отмена", "Vn")]]),
            )
            return
        if data.startswith("Vy:"):
            try:
                voice.remove_model(model_id)
            except voice.VoiceError as exc:
                send_html(token, chat_id, html_esc(str(exc)))
                return
            send_html(token, chat_id, f"<b>{html_esc(label)}</b> удалена.")
            self._show_voice(token, chat_id)
            return
        try:
            snap = voice.start_download(model_id)
        except voice.VoiceError as exc:
            send_html(token, chat_id, html_esc(str(exc)))
            return
        except RuntimeError:
            snap = voice.job_snapshot()
        if not snap.get("running"):
            if snap.get("ok") and voice.model_ready(model_id):
                send_html(token, chat_id, f"<b>{html_esc(label)}</b> уже скачана.")
                self._show_voice(token, chat_id)
            return
        self._arm_voice_watch(token, chat_id, label)

    def _arm_voice_watch(self, token: str, chat_id: str, label: str) -> None:
        with self._lock:
            live = self._voice_watch is not None and self._voice_watch.is_alive()
            if live:
                send_html(token, chat_id, "Скачивание уже идёт. Отменить можно кнопкой в том сообщении.")
                return
            thread = threading.Thread(
                target=self._voice_job_loop,
                args=(token, chat_id, label),
                name="fm-voice-job",
                daemon=True,
            )
            self._voice_watch = thread
            thread.start()

    def _voice_job_html(self, job: dict[str, Any]) -> str:
        ratio = max(0, min(100, int(job.get("progress") or 0))) / 100
        bar = _progress_bar_determinate(ratio)
        text = html_esc(str(job.get("text") or "Скачиваю модель…"))
        pct = f"{int(round(ratio * 100)):>3}%"
        return f"<b>{text}</b>\n<pre>▏{bar}▕\n{pct}</pre>"

    def _voice_job_loop(self, token: str, chat_id: str, label: str) -> None:
        keyboard = _inline([[_btn("Отменить", "Vx")]])
        html = self._voice_job_html(voice.job_snapshot())
        mid = send_html(token, chat_id, html, keyboard)
        last = html
        while voice.job_snapshot().get("running"):
            time.sleep(1)
            job = voice.job_snapshot()
            if not job.get("running"):
                break
            html = self._voice_job_html(job)
            if html == last or mid is None:
                continue
            last = html
            try:
                send_html(token, chat_id, html, keyboard, message_id=mid)
            except RuntimeError:
                pass
        job = voice.job_snapshot()
        empty = _inline([])
        if job.get("cancelled"):
            send_html(token, chat_id, "Скачивание отменено.", empty, message_id=mid)
            return
        if job.get("error"):
            send_html(token, chat_id, html_esc(str(job.get("error"))), empty, message_id=mid)
            return
        send_html(
            token,
            chat_id,
            f"<b>{html_esc(label)}</b> скачана. Можно включить её кнопкой ниже.",
            empty,
            message_id=mid,
        )
        self._show_voice(token, chat_id)

    def _dispatch(self, token: str, chat_id: str, data: str) -> None:
        session = self._chat(chat_id)
        if data in {"Wh", "Wa"}:
            self._toggle_web_access(token, chat_id, data == "Wh")
        elif data == "Bk":
            info = self._status_for(chat_id)
            send_bank_link(token, chat_id, str(info.get("url") or ""), info)
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
        elif data.startswith("Aq:"):
            try:
                index = int(data[3:] or -1)
            except ValueError:
                return
            hints = list(session.ask_hints or [])
            if 0 <= index < len(hints):
                self._on_text(token, chat_id, hints[index])
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
        session.chosen = True
        session.order_id = ""
        session.search = ""
        session.filter = "all"
        session.opage = 0
        session.snap = session._fresh_snap()
        pending = str(session.pending_ask or "")
        session.pending_ask = ""
        self._show(token, chat_id, "orders")
        if pending:
            self._try_ask(token, chat_id, pending)

    def _open_order(self, token: str, chat_id: str, index: int) -> None:
        session = self._chat(chat_id)
        if index < 0 or index >= len(session.orders):
            self._show(token, chat_id, "orders")
            return
        session.order_id = session.orders[index]
        self._show(token, chat_id, "order")

    def _open_on_pc(self, token: str, chat_id: str) -> None:
        session = self._chat(chat_id)
        if not self._adopt_open(session) or not _path_allowed(session.path):
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
            session.snap["hide_totals"] = False
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
        path = self._adopt_open(session)
        if path and _path_allowed(path):
            try:
                doc, live = _load_doc(path)
                session.live = live
                return doc, live
            except (OSError, ValueError, json.JSONDecodeError):
                pass
        if not session.chosen and REMOTE.enabled and isinstance(REMOTE.doc, dict):
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
        hide_totals = bool(session.snap.get("hide_totals"))
        if hide_totals:
            fields = snapmod.without_prices(fields)
        caption = snapmod.default_title(blocks, title)
        labels = {"png": "Готовлю PNG…", "pdf": "Собираю PDF…", "text": "Готовлю текст…"}
        action = "upload_photo" if kind == "png" else "upload_document"
        with self._busy(token, chat_id, labels.get(kind, "Готовлю снимок…"), bar=True, action=action) as busy:
            try:
                if kind == "png":
                    busy.step("Рисую картинку…", 0.18)
                    png = snapmod.render_png(
                        doc,
                        blocks,
                        fields,
                        str(session.snap.get("theme") or "teal"),
                        hide_labels,
                        hide_stamp,
                        title,
                        hide_totals,
                    )
                    busy.step("Отправляю PNG…", 0.9)
                    send_photo(token, chat_id, png, caption, "finmaster-snapshot.png")
                elif kind == "pdf":
                    busy.step("Прошу FinMaster собрать PDF…", 0.08)
                    opts = _pdf_opts(session.snap.get("pdf_opts") or _default_pdf_opts())
                    if len(blocks) > 1:
                        opts["orderTitles"] = True
                    payload = {
                        "blocks": [{"order": block["order"], "lines": block["lines"]} for block in blocks],
                        "fields": fields,
                        "theme": str(session.snap.get("theme") or "teal"),
                        "hide_labels": hide_labels,
                        "hide_stamp": hide_stamp,
                        "hide_totals": hide_totals,
                        "title": title or caption,
                        "opts": opts,
                        "path": session.path or "",
                    }

                    def _pdf_tick(ratio: float) -> None:
                        busy.step("Собираю PDF на компьютере…", ratio)

                    pdf = PDF_BRIDGE.request(payload, timeout=90.0, on_tick=_pdf_tick)
                    busy.step("Отправляю PDF…", 0.96)
                    name = f"{(caption or 'Заказы')[:80]}.pdf".replace("/", "_").replace("\\", "_")
                    send_document(token, chat_id, pdf, name, caption, "application/pdf")
                else:
                    busy.step("Собираю текст…", 0.25)
                    text = snapmod.render_text(doc, blocks, fields, hide_labels, hide_stamp, title, hide_totals)
                    busy.step("Отправляю…", 0.88)
                    if len(text) < 3800:
                        send_html(token, chat_id, f"<pre>{html_esc(text)}</pre>")
                    else:
                        send_document(token, chat_id, text.encode("utf-8"), "finmaster-snapshot.txt", caption)
            except Exception as exc:
                send_html(token, chat_id, html_esc(str(exc) or "Не удалось собрать снимок."))

    def _show(self, token: str, chat_id: str, screen: str) -> None:
        session = self._chat(chat_id)
        previous = session.screen
        session.screen = screen
        session.awaiting = ""
        text, rows = self._screen(session, screen)
        markup = _inline(rows) if rows else self._reply_kb(chat_id)
        anchor = session.message_id
        if anchor is not None and _chat_tail.get(str(chat_id), 0) > int(anchor):
            anchor = None
        if screen == "order" or previous == "order":
            if anchor is not None:
                try:
                    _call(token, "deleteMessage", {"chat_id": chat_id, "message_id": anchor})
                except RuntimeError:
                    pass
            anchor = None
        if screen == "order":
            markdown = _rich_markdown(text)
            mid = None
            if markdown and len(markdown) <= 30000 and markdown.count("\n") < 450:
                try:
                    mid = _send_rich(token, chat_id, markdown, markup)
                except RuntimeError:
                    mid = None
            session.message_id = mid if mid is not None else send_html(token, chat_id, text, markup)
            return
        session.message_id = send_html(
            token,
            chat_id,
            text,
            markup,
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
            [_btn("Хранилище", "Bk"), _btn("Ссылка на телефон", "L")],
            [_btn("Новая ссылка", "N")],
        ]
        return text, rows

    def _screen_reports(self, session: ChatSession) -> tuple[str, list[list[dict[str, str]]]]:
        self._adopt_open(session)
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
            when = str(line.get("order_date") or "").strip()
            if len(when) >= 10 and when[4] == "-":
                year, month, day = when[:10].split("-")
                when = f"{day}.{month}.{year}"
            lines_out.append(
                f"• {html_esc(line.get('product') or '—')} · {html_esc(qty_text(line))} · "
                f"{html_esc(money(bit['after'], currency, decimals))} · долг {html_esc(money(bit['unpaid'], currency, decimals))}"
                f" · {html_esc(when or '—')} · {html_esc(line.get('status') or '—')}"
            )
            comment = str(line.get("notes") or "").strip()
            if comment:
                lines_out.append("  " + html_esc(comment))
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
            f"к оплате {html_esc(money(tot['after'], currency, decimals))} · оплачено {html_esc(money(tot['paid'], currency, decimals))} · "
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
            text += f"\nзаметка: {html_esc(notes)}"
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
