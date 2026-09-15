from __future__ import annotations

import json
import os
import re
import secrets
import threading
from datetime import datetime, timezone
from typing import Any


APP_NAME = "FinMaster"
MAX_RECENT = 15
MAX_DEVICES = 20
DEFAULT_REMOTE_PORT = 17891
_TELEGRAM_TOKEN_RE = re.compile(r"^\d{5,}:[A-Za-z0-9_-]{20,}$")
_LOCK = threading.RLock()
_CACHE: dict[str, Any] | None = None
_SECRETS = {"ngrok_token": "", "telegram_bot_token": "", "telegram_chat_id": ""}


def config_dir() -> str:
    base = os.environ.get("APPDATA") or os.path.join(os.path.expanduser("~"), ".config")
    path = os.path.join(base, APP_NAME)
    os.makedirs(path, exist_ok=True)
    return path


def config_path() -> str:
    return os.path.join(config_dir(), "config.json")


def _blank_config() -> dict[str, Any]:
    return {"recent": [], "autosave": False, "last_dir": "", "theme": "light", "window_maximized": False}


def _clone(data: dict[str, Any]) -> dict[str, Any]:
    return json.loads(json.dumps(data))


def valid_telegram_token(value: str) -> bool:
    return bool(_TELEGRAM_TOKEN_RE.match(str(value or "").strip()))


def valid_ngrok_token(value: str) -> bool:
    text = str(value or "").strip()
    return 16 <= len(text) <= 200 and all(ch.isalnum() or ch in "-_." for ch in text)


def _remember_secrets(remote: dict[str, Any]) -> None:
    for key in _SECRETS:
        value = str(remote.get(key) or "").strip()
        if not value:
            continue
        if key == "telegram_bot_token" and ":" not in value:
            continue
        if key == "ngrok_token" and len(value) < 16:
            continue
        _SECRETS[key] = value


def _fill_secrets(remote: dict[str, Any]) -> dict[str, Any]:
    _remember_secrets(remote)
    for key, value in _SECRETS.items():
        if value and not str(remote.get(key) or "").strip():
            remote[key] = value
    return remote


def load_config() -> dict[str, Any]:
    global _CACHE
    path = config_path()
    with _LOCK:
        if not os.path.exists(path):
            data = _blank_config()
            _CACHE = _clone(data)
            return _clone(data)
        try:
            with open(path, encoding="utf-8") as fh:
                loaded = json.load(fh)
            if not isinstance(loaded, dict):
                raise json.JSONDecodeError("not an object", "", 0)
            data = _blank_config()
            data.update(loaded)
            data.setdefault("recent", [])
            data.setdefault("autosave", False)
            data.setdefault("last_dir", "")
            data.setdefault("theme", "light")
            data.setdefault("window_maximized", False)
            if isinstance(data.get("remote"), dict):
                _fill_secrets(data["remote"])
            _CACHE = _clone(data)
            return _clone(data)
        except (OSError, json.JSONDecodeError, TypeError, ValueError):
            if _CACHE is not None:
                return _clone(_CACHE)
            return _blank_config()


def save_config(data: dict[str, Any]) -> None:
    global _CACHE
    if not isinstance(data, dict):
        return
    with _LOCK:
        payload = _clone(data)
        remote = payload.get("remote")
        if isinstance(remote, dict):
            _fill_secrets(remote)
            payload["remote"] = remote
        elif _CACHE and isinstance(_CACHE.get("remote"), dict):
            payload["remote"] = _clone(_CACHE["remote"])
        path = config_path()
        tmp = f"{path}.{os.getpid()}.tmp"
        try:
            with open(tmp, "w", encoding="utf-8") as fh:
                json.dump(payload, fh, ensure_ascii=False, indent=2)
                fh.flush()
                os.fsync(fh.fileno())
            os.replace(tmp, path)
            _CACHE = _clone(payload)
        finally:
            if os.path.exists(tmp):
                try:
                    os.remove(tmp)
                except OSError:
                    pass


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


def window_maximized() -> bool:
    return bool(load_config().get("window_maximized"))


def set_window_maximized(enabled: bool) -> None:
    cfg = load_config()
    cfg["window_maximized"] = bool(enabled)
    save_config(cfg)


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
        if valid_ngrok_token(token_value):
            data["ngrok_token"] = token_value
    if "via" in updates:
        data["via"] = "ngrok" if updates["via"] == "ngrok" else "lan"
    if "telegram_bot_token" in updates:
        bot = str(updates["telegram_bot_token"] or "").strip()
        if valid_telegram_token(bot):
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


_DEVICE_INFO_KEYS = (
    "model",
    "platform",
    "platform_version",
    "brands",
    "user_agent",
    "language",
    "screen",
    "viewport",
    "pixel_ratio",
    "timezone",
)


def remember_device(cid: str, name: str = "", ip: str = "", info: Any = None) -> list[dict[str, Any]]:
    cid = str(cid or "").strip()
    if not cid:
        return remote_settings()["devices"]
    data = remote_settings()
    devices = [d for d in data["devices"] if d.get("id") != cid]
    prev = next((d for d in data["devices"] if d.get("id") == cid), {})
    prev_info = prev.get("info") if isinstance(prev.get("info"), dict) else {}
    incoming = info if isinstance(info, dict) else {}
    merged = dict(prev_info)
    for key in _DEVICE_INFO_KEYS:
        value = incoming.get(key)
        if value in (None, ""):
            continue
        limit = 400 if key == "user_agent" else 120
        merged[key] = str(value).strip()[:limit]
    devices.insert(
        0,
        {
            "id": cid,
            "name": str(name or prev.get("name") or "Телефон").strip() or "Телефон",
            "ip": str(ip or prev.get("ip") or ""),
            "seen_at": now_local_iso(),
            "info": merged,
        },
    )
    return save_remote_settings(devices=devices)["devices"]


def forget_device(cid: str) -> list[dict[str, Any]]:
    data = remote_settings()
    devices = [d for d in data["devices"] if d.get("id") != cid]
    return save_remote_settings(devices=devices)["devices"]


def rotate_remote_token() -> dict[str, Any]:
    return save_remote_settings(token=secrets.token_urlsafe(12), devices=[])


def user_documents_dir() -> str:
    if os.name == "nt":
        try:
            import ctypes

            buf = ctypes.create_unicode_buffer(260)
            if ctypes.windll.shell32.SHGetFolderPathW(None, 5, None, 0, buf) == 0 and buf.value:
                return buf.value
        except Exception:
            pass
        home = os.environ.get("USERPROFILE") or os.path.expanduser("~")
        for name in ("Documents", "Документы"):
            path = os.path.join(home, name)
            if os.path.isdir(path):
                return path
        return os.path.join(home, "Documents")
    xdg = os.environ.get("XDG_DOCUMENTS_DIR")
    if xdg:
        return os.path.expanduser(xdg)
    home = os.path.expanduser("~")
    docs = os.path.join(home, "Documents")
    return docs if os.path.isdir(docs) else home


def default_reports_dir() -> str:
    path = os.path.join(user_documents_dir(), APP_NAME)
    os.makedirs(path, exist_ok=True)
    return path


def list_library_reports() -> dict[str, Any]:
    folder = os.path.abspath(default_reports_dir())
    items: list[dict[str, Any]] = []
    try:
        names = os.listdir(folder)
    except OSError:
        names = []
    for name in names:
        if not name.lower().endswith(".fmaster"):
            continue
        path = os.path.join(folder, name)
        if not os.path.isfile(path):
            continue
        try:
            stamp = os.path.getmtime(path)
        except OSError:
            continue
        items.append(
            {
                "path": os.path.abspath(path),
                "title": os.path.splitext(name)[0],
                "name": name,
                "modified_at": datetime.fromtimestamp(stamp).astimezone().replace(microsecond=0).isoformat(),
            }
        )
    items.sort(key=lambda item: item.get("modified_at") or "", reverse=True)
    return {"path": folder, "items": items}


def same_path(a: str, b: str) -> bool:
    if not a or not b:
        return False
    left = os.path.normcase(os.path.abspath(a))
    right = os.path.normcase(os.path.abspath(b))
    return left == right


def library_file_path(path: str) -> str:
    folder = os.path.abspath(default_reports_dir())
    full = os.path.abspath(path)
    prefix = folder if folder.endswith(os.sep) else folder + os.sep
    check = full if os.name != "nt" else full.lower()
    root = prefix if os.name != "nt" else prefix.lower()
    if not check.startswith(root):
        raise ValueError("Можно удалять только файлы из папки FinMaster.")
    if not full.lower().endswith(".fmaster"):
        raise ValueError("Можно удалять только отчёты .fmaster.")
    if not os.path.isfile(full):
        raise FileNotFoundError("Файл не найден.")
    return full


def send_to_trash(path: str) -> None:
    full = os.path.abspath(path)
    if not os.path.exists(full):
        raise FileNotFoundError("Файл не найден.")
    if os.name == "nt":
        import ctypes
        from ctypes import wintypes

        class SHFILEOPSTRUCTW(ctypes.Structure):
            _fields_ = [
                ("hwnd", wintypes.HWND),
                ("wFunc", wintypes.UINT),
                ("pFrom", wintypes.LPCWSTR),
                ("pTo", wintypes.LPCWSTR),
                ("fFlags", wintypes.WORD),
                ("fAnyOperationsAborted", wintypes.BOOL),
                ("hNameMappings", ctypes.c_void_p),
                ("lpszProgressTitle", wintypes.LPCWSTR),
            ]

        fo_delete = 3
        fof_allowundo = 0x40
        fof_noconfirmation = 0x10
        fof_silent = 0x04
        fof_noerrorui = 0x400
        source = ctypes.create_unicode_buffer(full + "\0")
        op = SHFILEOPSTRUCTW()
        op.wFunc = fo_delete
        op.pFrom = ctypes.cast(source, wintypes.LPCWSTR)
        op.fFlags = fof_allowundo | fof_noconfirmation | fof_silent | fof_noerrorui
        code = ctypes.windll.shell32.SHFileOperationW(ctypes.byref(op))
        if code != 0 or op.fAnyOperationsAborted:
            raise OSError(f"Не удалось отправить в корзину (код {code}).")
        return
    for cmd in (("gio", "trash", full), ("trash-put", full), ("trash", full)):
        try:
            import subprocess

            subprocess.run(cmd, check=True, capture_output=True)
            return
        except (FileNotFoundError, subprocess.CalledProcessError, OSError):
            continue
    os.remove(full)


def delete_library_report(path: str) -> str:
    full = library_file_path(path)
    send_to_trash(full)
    remove_recent(full)
    return full


def safe_report_title(title: str) -> str:
    name = re.sub(r'[\\/:*?"<>|]+', " ", str(title or "").strip())
    name = re.sub(r"\s+", " ", name).strip(" .")
    return name[:80] or "Новый отчёт"


def default_report_path(title: str) -> str:
    return os.path.join(default_reports_dir(), f"{safe_report_title(title)}.fmaster")


def suggest_report_title(title: str) -> str:
    base = safe_report_title(title)
    stem = re.sub(r"\s+\d+$", "", base).strip() or base
    n = 2
    while os.path.exists(default_report_path(f"{stem} {n}")) and n < 200:
        n += 1
    return f"{stem} {n}"


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
