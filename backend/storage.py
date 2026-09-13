from __future__ import annotations

import json
import os
import secrets
from datetime import datetime, timezone
from typing import Any


APP_NAME = "FinMaster"
MAX_RECENT = 15
MAX_DEVICES = 20
DEFAULT_REMOTE_PORT = 17891


def config_dir() -> str:
    base = os.environ.get("APPDATA") or os.path.join(os.path.expanduser("~"), ".config")
    path = os.path.join(base, APP_NAME)
    os.makedirs(path, exist_ok=True)
    return path


def config_path() -> str:
    return os.path.join(config_dir(), "config.json")


def load_config() -> dict[str, Any]:
    path = config_path()
    if not os.path.exists(path):
        return {"recent": [], "autosave": False, "last_dir": "", "theme": "light"}
    try:
        with open(path, encoding="utf-8") as fh:
            data = json.load(fh)
        if not isinstance(data, dict):
            return {"recent": [], "autosave": False, "last_dir": "", "theme": "light"}
        data.setdefault("recent", [])
        data.setdefault("autosave", False)
        data.setdefault("last_dir", "")
        data.setdefault("theme", "light")
        return data
    except (OSError, json.JSONDecodeError):
        return {"recent": [], "autosave": False, "last_dir": "", "theme": "light"}


def save_config(data: dict[str, Any]) -> None:
    with open(config_path(), "w", encoding="utf-8") as fh:
        json.dump(data, fh, ensure_ascii=False, indent=2)


def add_recent(path: str, title: str = "") -> list[dict[str, Any]]:
    cfg = load_config()
    path = os.path.abspath(path)
    recent = [item for item in cfg.get("recent", []) if item.get("path") != path]
    recent.insert(
        0,
        {
            "path": path,
            "title": title or os.path.splitext(os.path.basename(path))[0],
            "opened_at": datetime.now(timezone.utc).astimezone().replace(microsecond=0).isoformat(),
        },
    )
    cfg["recent"] = recent[:MAX_RECENT]
    cfg["last_dir"] = os.path.dirname(path)
    save_config(cfg)
    return cfg["recent"]


def remove_recent(path: str) -> list[dict[str, Any]]:
    cfg = load_config()
    cfg["recent"] = [item for item in cfg.get("recent", []) if item.get("path") != path]
    save_config(cfg)
    return cfg["recent"]


def set_theme(theme: str) -> str:
    value = "dark" if theme == "dark" else "light"
    cfg = load_config()
    cfg["theme"] = value
    save_config(cfg)
    return value


def set_autosave(enabled: bool) -> None:
    cfg = load_config()
    cfg["autosave"] = bool(enabled)
    save_config(cfg)


def now_local_iso() -> str:
    return datetime.now(timezone.utc).astimezone().replace(microsecond=0).isoformat()


def remote_settings() -> dict[str, Any]:
    cfg = load_config()
    raw = cfg.get("remote")
    if not isinstance(raw, dict):
        raw = {}
    token = str(raw.get("token") or "").strip()
    if not token:
        token = secrets.token_urlsafe(12)
    try:
        port = int(raw.get("port") or DEFAULT_REMOTE_PORT)
    except (TypeError, ValueError):
        port = DEFAULT_REMOTE_PORT
    if port <= 0 or port > 65535:
        port = DEFAULT_REMOTE_PORT
    devices = [d for d in (raw.get("devices") or []) if isinstance(d, dict) and d.get("id")]
    out = {
        "token": token,
        "port": port,
        "autostart": bool(raw.get("autostart")),
        "devices": devices[:MAX_DEVICES],
        "ngrok": bool(raw.get("ngrok")),
        "ngrok_token": str(raw.get("ngrok_token") or "").strip(),
        "via": str(raw.get("via") or "lan"),
        "telegram_bot_token": str(raw.get("telegram_bot_token") or "").strip(),
        "telegram_chat_id": str(raw.get("telegram_chat_id") or "").strip(),
        "telegram_offset": 0,
    }
    try:
        out["telegram_offset"] = max(0, int(raw.get("telegram_offset") or 0))
    except (TypeError, ValueError):
        out["telegram_offset"] = 0
    if raw.get("token") != token or raw.get("port") != port or not isinstance(cfg.get("remote"), dict):
        cfg["remote"] = out
        save_config(cfg)
    return out


def save_remote_settings(**updates: Any) -> dict[str, Any]:
    cfg = load_config()
    data = remote_settings()
    if "token" in updates and updates["token"]:
        data["token"] = str(updates["token"])
    if "port" in updates:
        try:
            data["port"] = int(updates["port"])
        except (TypeError, ValueError):
            pass
    if "autostart" in updates:
        data["autostart"] = bool(updates["autostart"])
    if "devices" in updates and isinstance(updates["devices"], list):
        data["devices"] = [d for d in updates["devices"] if isinstance(d, dict) and d.get("id")][:MAX_DEVICES]
    if "ngrok" in updates:
        data["ngrok"] = bool(updates["ngrok"])
    if "ngrok_token" in updates:
        token_value = str(updates["ngrok_token"] or "").strip()
        if token_value:
            data["ngrok_token"] = token_value
    if "via" in updates:
        data["via"] = "ngrok" if updates["via"] == "ngrok" else "lan"
    if "telegram_bot_token" in updates:
        bot = str(updates["telegram_bot_token"] or "").strip()
        if bot:
            if bot != data.get("telegram_bot_token"):
                data["telegram_offset"] = 0
            data["telegram_bot_token"] = bot
    if "telegram_chat_id" in updates:
        chat = str(updates["telegram_chat_id"] or "").strip()
        if chat:
            data["telegram_chat_id"] = chat
    if "telegram_offset" in updates:
        try:
            data["telegram_offset"] = max(0, int(updates["telegram_offset"] or 0))
        except (TypeError, ValueError):
            pass
    cfg["remote"] = data
    save_config(cfg)
    return data


def remember_device(cid: str, name: str = "", ip: str = "") -> list[dict[str, Any]]:
    cid = str(cid or "").strip()
    if not cid:
        return remote_settings()["devices"]
    data = remote_settings()
    devices = [d for d in data["devices"] if d.get("id") != cid]
    prev = next((d for d in data["devices"] if d.get("id") == cid), {})
    devices.insert(
        0,
        {
            "id": cid,
            "name": str(name or prev.get("name") or "Телефон").strip() or "Телефон",
            "ip": str(ip or prev.get("ip") or ""),
            "seen_at": now_local_iso(),
        },
    )
    return save_remote_settings(devices=devices)["devices"]


def forget_device(cid: str) -> list[dict[str, Any]]:
    data = remote_settings()
    devices = [d for d in data["devices"] if d.get("id") != cid]
    return save_remote_settings(devices=devices)["devices"]


def rotate_remote_token() -> dict[str, Any]:
    return save_remote_settings(token=secrets.token_urlsafe(12), devices=[])


def atomic_write(path: str, content: str) -> None:
    directory = os.path.dirname(os.path.abspath(path)) or "."
    os.makedirs(directory, exist_ok=True)
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8", newline="\n") as fh:
        fh.write(content)
        fh.flush()
        os.fsync(fh.fileno())
    os.replace(tmp, path)


def read_text(path: str) -> str:
    with open(path, encoding="utf-8") as fh:
        return fh.read()
