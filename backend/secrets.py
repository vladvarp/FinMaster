"""Токены ngrok и Telegram: отдельный файл, который не читается как текст.

Пароль не спрашивается. Тот же файл открывается на другом компьютере, где стоит FinMaster.
"""

from __future__ import annotations

import hashlib
import hmac
import json
import os
import sys
import threading
from typing import Any

from backend import storage


_NAME = "secrets.bin"
_KIND = "finmaster-tokens"
_MAGIC = b"FMK1"
_UI_FORBIDDEN = 0x1
_LOCK = threading.RLock()
_CACHE: dict[str, Any] | None = None
_BROKEN = False
_SECRET_KEYS = ("ngrok_token", "telegram_bot_token", "telegram_chat_id")


def path() -> str:
    return os.path.join(storage.config_dir(), _NAME)


def forget_cache() -> None:
    global _CACHE, _BROKEN
    with _LOCK:
        _CACHE = None
        _BROKEN = False


def load() -> dict[str, Any]:
    global _CACHE, _BROKEN
    with _LOCK:
        if _CACHE is not None:
            return _clone(_CACHE)
        file_path = path()
        if not os.path.isfile(file_path):
            data = _blank()
            _CACHE = data
            return _clone(data)
        try:
            with open(file_path, "rb") as handle:
                raw = handle.read()
            plain, rewrite = _open_blob(raw)
            data = _normalize(json.loads(plain.decode("utf-8")))
        except (OSError, UnicodeDecodeError, json.JSONDecodeError, ValueError):
            _BROKEN = True
            data = _blank()
            _CACHE = None
            return data
        _BROKEN = False
        _CACHE = data
        if rewrite:
            try:
                save(data)
            except OSError:
                pass
        return _clone(data)


def save(data: dict[str, Any]) -> None:
    global _CACHE, _BROKEN
    with _LOCK:
        if _BROKEN:
            raise OSError("Файл токенов не читается. Запись отменена, чтобы не стереть его.")
        payload = _normalize(data)
        blob = _protect(json.dumps(payload, ensure_ascii=False).encode("utf-8"))
        file_path = path()
        parent = os.path.dirname(file_path)
        if parent:
            os.makedirs(parent, exist_ok=True)
        tmp = f"{file_path}.{os.getpid()}.tmp"
        try:
            with open(tmp, "wb") as handle:
                handle.write(blob)
                handle.flush()
                os.fsync(handle.fileno())
            os.replace(tmp, file_path)
            _CACHE = payload
        finally:
            if os.path.exists(tmp):
                try:
                    os.remove(tmp)
                except OSError:
                    pass


def absorb_remote(remote: dict[str, Any]) -> bool:
    """Забирает токены старого config.json в зашифрованный файл и вычищает их из словаря."""
    if not isinstance(remote, dict):
        return False
    found = any(key in remote for key in _SECRET_KEYS)
    if not found:
        return False
    data = load()
    if _BROKEN:
        return False
    ngrok = str(remote.pop("ngrok_token", "") or "").strip()
    bot = str(remote.pop("telegram_bot_token", "") or "").strip()
    chat = str(remote.pop("telegram_chat_id", "") or "").strip()
    if ngrok and storage.valid_ngrok_token(ngrok):
        data["ngrok_token"] = ngrok
    if bot and storage.valid_telegram_token(bot):
        data["telegram_bot_token"] = bot
    if _private_id(chat):
        _add_user(data, chat, "", "")
    save(data)
    return True


def update_tokens(*, ngrok_token: str | None = None, telegram_bot_token: str | None = None) -> dict[str, Any]:
    data = load()
    if ngrok_token is not None and storage.valid_ngrok_token(ngrok_token):
        data["ngrok_token"] = str(ngrok_token).strip()
    if telegram_bot_token is not None and storage.valid_telegram_token(telegram_bot_token):
        data["telegram_bot_token"] = str(telegram_bot_token).strip()
    save(data)
    return _clone(data)


def users() -> list[dict[str, str]]:
    return list(load().get("users") or [])


def pending() -> list[dict[str, str]]:
    return list(load().get("pending") or [])


def allowed(chat_id: str) -> bool:
    return any(item["id"] == str(chat_id) for item in users())


def ask(
    chat_id: str,
    username: str = "",
    name: str = "",
    restart: bool = False,
    **extra: Any,
) -> str:
    """Создаёт заявку на доступ и сохраняет сведения о пользователе."""
    cid = str(chat_id or "").strip()

    if not _private_id(cid):
        return "group"

    data = load()
    profile = {
        "first_name": extra.get("first_name"),
        "last_name": extra.get("last_name"),
        "language_code": extra.get("language_code"),
    }

    if any(item["id"] == cid for item in data["users"]):
        _touch(data, "users", cid, username, name, **profile)
        save(data)
        return "allowed"

    for key in ("pending", "hidden_pending"):
        if any(item["id"] == cid for item in data[key]):
            _touch(data, key, cid, username, name, **profile)
            save(data)
            return "pending"

    if cid in data["declined"] and not restart:
        return "declined"

    data["declined"] = [item for item in data["declined"] if item != cid]

    person = _person(
        cid,
        username,
        name,
        **profile,
        requested_at=extra.get("requested_at"),
    )

    data["pending"].append(person)

    save(data)
    return "new"

def approve(chat_id: str) -> dict[str, Any] | None:
    cid = str(chat_id or "").strip()
    data = load()

    person = next(
        (
            item
            for key in ("pending", "hidden_pending")
            for item in data[key]
            if item["id"] == cid
        ),
        None,
    )

    if person is None:
        return next(
            (item for item in data["users"] if item["id"] == cid),
            None,
        )

    data["pending"] = [
        item for item in data["pending"] if item["id"] != cid
    ]
    data["hidden_pending"] = [
        item for item in data["hidden_pending"] if item["id"] != cid
    ]
    data["declined"] = [
        item for item in data["declined"] if item != cid
    ]

    _add_user(
        data,
        cid,
        person.get("username") or "",
        person.get("name") or "",
        extra=person,
    )

    save(data)

    return next(
        item for item in data["users"] if item["id"] == cid
    )


def decline(chat_id: str) -> dict[str, Any] | None:
    cid = str(chat_id or "").strip()
    data = load()

    person = next(
        (
            item
            for key in ("pending", "hidden_pending")
            for item in data[key]
            if item["id"] == cid
        ),
        None,
    )

    if person is None:
        return None

    data["pending"] = [
        item for item in data["pending"] if item["id"] != cid
    ]
    data["hidden_pending"] = [
        item for item in data["hidden_pending"] if item["id"] != cid
    ]

    if cid not in data["declined"]:
        data["declined"].append(cid)

    data["declined"] = data["declined"][-100:]

    save(data)
    return person

def hide_pending(chat_id: str) -> dict[str, Any] | None:
    cid = str(chat_id or "").strip()
    data = load()

    person = next(
        (item for item in data["pending"] if item["id"] == cid),
        None,
    )

    if person is None:
        return None

    data["pending"] = [
        item for item in data["pending"] if item["id"] != cid
    ]

    if not any(item["id"] == cid for item in data["hidden_pending"]):
        data["hidden_pending"].append(person)

    save(data)
    return person

def restore_pending(chat_id: str) -> dict[str, Any] | None:
    cid = str(chat_id or "").strip()
    data = load()

    person = next(
        (item for item in data["hidden_pending"] if item["id"] == cid),
        None,
    )

    if person is None:
        return None

    data["hidden_pending"] = [
        item for item in data["hidden_pending"] if item["id"] != cid
    ]

    if not any(item["id"] == cid for item in data["pending"]):
        data["pending"].append(person)

    save(data)
    return person

def remove_user(chat_id: str) -> dict[str, str] | None:
    cid = str(chat_id or "").strip()
    data = load()
    person = next((item for item in data["users"] if item["id"] == cid), None)
    if person is None:
        return None
    data["users"] = [item for item in data["users"] if item["id"] != cid]
    if cid not in data["declined"]:
        data["declined"].append(cid)
    data["declined"] = data["declined"][-100:]
    save(data)
    return person


def export_parts() -> list[dict[str, Any]]:
    data = load()
    parts: list[dict[str, Any]] = []
    if data.get("ngrok_token"):
        parts.append({"id": "ngrok", "label": "Токен ngrok", "on": True, "detail": ""})
    users_n = len(data.get("users") or [])
    if data.get("telegram_bot_token") or users_n:
        detail = f"{users_n} пол." if users_n else "без пользователей"
        parts.append({"id": "telegram", "label": "Telegram: бот и пользователи", "on": True, "detail": detail})
    return parts


def inspect_export(file_path: str) -> list[dict[str, Any]]:
    payload = _read_export(file_path)
    parts: list[dict[str, Any]] = []
    if payload.get("ngrok_token"):
        parts.append({"id": "ngrok", "label": "Токен ngrok", "on": True, "detail": ""})
    users_n = len(payload.get("users") or [])
    if payload.get("telegram_bot_token") or users_n:
        detail = f"{users_n} пол." if users_n else "без пользователей"
        parts.append({"id": "telegram", "label": "Telegram: бот и пользователи", "on": True, "detail": detail})
    return parts


def write_export(file_path: str, ids: list[str]) -> None:
    chosen = set(_clean_ids(ids))
    if not chosen:
        raise ValueError("Отметьте, что положить в файл.")
    data = load()
    payload: dict[str, Any] = {"kind": _KIND, "version": 1}
    if "ngrok" in chosen:
        if not data.get("ngrok_token"):
            raise ValueError("Токен ngrok ещё не сохранён.")
        payload["ngrok_token"] = data["ngrok_token"]
    if "telegram" in chosen:
        if not data.get("telegram_bot_token") and not data.get("users"):
            raise ValueError("Токен бота и пользователи ещё не сохранены.")
        payload["telegram_bot_token"] = data.get("telegram_bot_token") or ""
        payload["users"] = list(data.get("users") or [])
    blob = _protect(json.dumps(payload, ensure_ascii=False).encode("utf-8"))
    dest = os.path.abspath(file_path)
    parent = os.path.dirname(dest)
    if parent:
        os.makedirs(parent, exist_ok=True)
    tmp = f"{dest}.{os.getpid()}.tmp"
    try:
        with open(tmp, "wb") as handle:
            handle.write(blob)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(tmp, dest)
    finally:
        if os.path.exists(tmp):
            try:
                os.remove(tmp)
            except OSError:
                pass


def apply_export(file_path: str, ids: list[str]) -> None:
    chosen = set(_clean_ids(ids))
    if not chosen:
        raise ValueError("Отметьте, что импортировать.")
    payload = _read_export(file_path)
    data = load()
    if "ngrok" in chosen:
        token = str(payload.get("ngrok_token") or "").strip()
        if token and storage.valid_ngrok_token(token):
            data["ngrok_token"] = token
    if "telegram" in chosen:
        token = str(payload.get("telegram_bot_token") or "").strip()
        if token and storage.valid_telegram_token(token):
            data["telegram_bot_token"] = token
        for person in payload.get("users") or []:
            if isinstance(person, dict) and _private_id(str(person.get("id") or "")):
                _add_user(
                    data,
                    str(person["id"]),
                    str(person.get("username") or ""),
                    str(person.get("name") or ""),
                    extra=person,
                )
    save(data)


def _read_export(file_path: str) -> dict[str, Any]:
    if not file_path or not os.path.isfile(file_path):
        raise ValueError("Файл токенов не найден.")
    try:
        with open(file_path, "rb") as handle:
            raw = handle.read()
        payload = json.loads(_unprotect(raw).decode("utf-8"))
    except (OSError, UnicodeDecodeError, json.JSONDecodeError, ValueError):
        raise ValueError("Файл токенов не открывается.") from None
    if not isinstance(payload, dict) or payload.get("kind") != _KIND:
        raise ValueError("Это не файл токенов FinMaster.")
    return payload


def _blank() -> dict[str, Any]:
    return {
        "ngrok_token": "",
        "telegram_bot_token": "",
        "users": [],
        "pending": [],
        "declined": [],
        "hidden_pending": [],
    }


def _normalize(raw: Any) -> dict[str, Any]:
    data = _blank()
    if not isinstance(raw, dict):
        return data

    ngrok = str(raw.get("ngrok_token") or "").strip()
    bot = str(raw.get("telegram_bot_token") or "").strip()

    if storage.valid_ngrok_token(ngrok):
        data["ngrok_token"] = ngrok
    if storage.valid_telegram_token(bot):
        data["telegram_bot_token"] = bot

    extra_keys = ("first_name", "last_name", "language_code", "requested_at")

    seen: set[str] = set()

    for person in raw.get("users") or []:
        if not isinstance(person, dict):
            continue

        cid = str(person.get("id") or "").strip()
        if not _private_id(cid) or cid in seen:
            continue

        seen.add(cid)
        data["users"].append(
            _person(
                cid,
                person.get("username") or "",
                person.get("name") or "",
                **{key: person.get(key) for key in extra_keys},
            )
        )

    data["users"] = data["users"][:30]

    seen_p: set[str] = set()

    for person in raw.get("pending") or []:
        if not isinstance(person, dict):
            continue

        cid = str(person.get("id") or "").strip()
        if not _private_id(cid) or cid in seen or cid in seen_p:
            continue

        seen_p.add(cid)
        data["pending"].append(
            _person(
                cid,
                person.get("username") or "",
                person.get("name") or "",
                **{key: person.get(key) for key in extra_keys},
            )
        )

    seen_h: set[str] = set()

    for person in raw.get("hidden_pending") or []:
        if not isinstance(person, dict):
            continue

        cid = str(person.get("id") or "").strip()
        if (
            not _private_id(cid)
            or cid in seen
            or cid in seen_p
            or cid in seen_h
        ):
            continue

        seen_h.add(cid)
        data["hidden_pending"].append(
            _person(
                cid,
                person.get("username") or "",
                person.get("name") or "",
                **{key: person.get(key) for key in extra_keys},
            )
        )

    for item in raw.get("declined") or []:
        cid = str(item or "").strip()
        if _private_id(cid) and cid not in data["declined"] and cid not in seen:
            data["declined"].append(cid)

    data["declined"] = data["declined"][-100:]
    return data

def _person(
    chat_id: str,
    username: str = "",
    name: str = "",
    **extra: Any,
) -> dict[str, Any]:
    nick = str(username or "").strip().lstrip("@")[:64]
    title = " ".join(str(name or "").split())[:80]

    person: dict[str, Any] = {
        "id": str(chat_id),
        "username": nick,
        "name": title,
        "first_name": str(extra.get("first_name") or "")[:80],
        "last_name": str(extra.get("last_name") or "")[:80],
        "language_code": str(extra.get("language_code") or "")[:16],
        "requested_at": int(extra.get("requested_at") or 0),
    }

    return person


def _private_id(chat_id: str) -> bool:
    text = str(chat_id or "").strip()
    return text.isdigit() and int(text) > 0


def _add_user(
    data: dict[str, Any],
    chat_id: str,
    username: str,
    name: str,
    extra: dict[str, Any] | None = None,
) -> None:
    cid = str(chat_id)

    current = next(
        (item for item in data["users"] if item["id"] == cid),
        None,
    )

    source = extra if isinstance(extra, dict) else {}

    person = _person(
        cid,
        username or (current or {}).get("username") or "",
        name or (current or {}).get("name") or "",
        first_name=source.get("first_name") or (current or {}).get("first_name"),
        last_name=source.get("last_name") or (current or {}).get("last_name"),
        language_code=source.get("language_code") or (current or {}).get("language_code"),
        requested_at=source.get("requested_at") or (current or {}).get("requested_at"),
    )

    rest = [
        item for item in data["users"]
        if item["id"] != cid
    ]

    rest.append(person)
    data["users"] = rest[:30]

    data["pending"] = [
        item for item in data["pending"]
        if item["id"] != cid
    ]

    data["declined"] = [
        item for item in data["declined"]
        if item != cid
    ]


def _touch(
    data: dict[str, Any],
    key: str,
    chat_id: str,
    username: str,
    name: str,
    **extra: Any,
) -> None:
    for item in data[key]:
        if item["id"] != str(chat_id):
            continue

        if username:
            item["username"] = str(username).strip().lstrip("@")[:64]

        if name:
            item["name"] = " ".join(str(name).split())[:80]

        for field, limit in (
            ("first_name", 80),
            ("last_name", 80),
            ("language_code", 16),
        ):
            value = extra.get(field)
            if value:
                item[field] = str(value)[:limit]

        return


def _clean_ids(ids: list[str]) -> list[str]:
    out: list[str] = []
    for raw in ids or []:
        text = str(raw or "").strip()
        if text in {"ngrok", "telegram"} and text not in out:
            out.append(text)
    return out


def _clone(data: dict[str, Any]) -> dict[str, Any]:
    return json.loads(json.dumps(data))


def _material() -> bytes:
    folds = (
        (0x17, 0xA3, 0x4C, 0x91, 0x0E),
        (0x6B, 0x22, 0xD8, 0x55),
        (0xC1, 0x09, 0x7E, 0x3A, 0xF4, 0x18),
        (0x2D, 0x80, 0x46, 0xB7),
        (0x9F, 0x14, 0x63, 0xCA, 0x31),
        (0x58, 0xE2, 0x0B, 0x77, 0xAD),
    )
    acc = bytearray(48)
    for index, part in enumerate(folds):
        turn = (index * 11 + 5) & 0xFF
        for offset, value in enumerate(part):
            slot = (index * 7 + offset * 5 + turn) % len(acc)
            acc[slot] ^= (value * (offset + 3) + turn) & 0xFF
            acc[(slot + 13) % len(acc)] = (acc[(slot + 13) % len(acc)] + value + index) & 0xFF
    return hashlib.sha256(bytes(acc)).digest()


def _stream(key: bytes, nonce: bytes, size: int) -> bytes:
    out = bytearray()
    counter = 0
    while len(out) < size:
        block = hmac.new(key, nonce + counter.to_bytes(4, "big"), hashlib.sha256).digest()
        out.extend(block)
        counter += 1
    return bytes(out[:size])


def _protect(data: bytes) -> bytes:
    nonce = os.urandom(16)
    key = _material()
    body = bytes(left ^ right for left, right in zip(data, _stream(key, nonce, len(data))))
    mac = hmac.new(key, nonce + body, hashlib.sha256).digest()
    return _MAGIC + nonce + mac + body


def _open_portable(data: bytes) -> bytes:
    if len(data) < 4 + 16 + 32 or not data.startswith(_MAGIC):
        raise ValueError("Не удалось обработать файл токенов.")
    nonce = data[4:20]
    mac = data[20:52]
    body = data[52:]
    key = _material()
    expect = hmac.new(key, nonce + body, hashlib.sha256).digest()
    if not hmac.compare_digest(mac, expect):
        raise ValueError("Не удалось обработать файл токенов.")
    return bytes(left ^ right for left, right in zip(body, _stream(key, nonce, len(body))))


def _open_blob(raw: bytes) -> tuple[bytes, bool]:
    if raw.startswith(_MAGIC):
        return _open_portable(raw), False
    return _dpapi_unprotect(raw), True


def _unprotect(data: bytes) -> bytes:
    if data.startswith(_MAGIC):
        return _open_portable(data)
    if sys.platform == "win32":
        try:
            return _dpapi_unprotect(data)
        except (OSError, ValueError):
            pass
    raise ValueError("Не удалось обработать файл токенов.")


def _dpapi_unprotect(data: bytes) -> bytes:
    if sys.platform != "win32":
        raise ValueError("Не удалось обработать файл токенов.")
    import ctypes
    from ctypes import wintypes

    class DATA_BLOB(ctypes.Structure):
        _fields_ = [("cbData", wintypes.DWORD), ("pbData", ctypes.POINTER(ctypes.c_char))]

    def blob(payload: bytes) -> tuple[DATA_BLOB, ctypes.Array[ctypes.c_char]]:
        buf = ctypes.create_string_buffer(payload, len(payload))
        return DATA_BLOB(len(payload), ctypes.cast(buf, ctypes.POINTER(ctypes.c_char))), buf

    crypt32 = ctypes.windll.crypt32
    kernel32 = ctypes.windll.kernel32
    src, hold_src = blob(data)
    entropy, hold_entropy = blob(b"FinMaster.secrets.v1")
    out = DATA_BLOB()
    ok = crypt32.CryptUnprotectData(ctypes.byref(src), None, ctypes.byref(entropy), None, None, _UI_FORBIDDEN, ctypes.byref(out))
    del hold_src, hold_entropy
    if not ok:
        raise ValueError("Не удалось обработать файл токенов.")
    try:
        return ctypes.string_at(out.pbData, out.cbData)
    finally:
        kernel32.LocalFree(out.pbData)
