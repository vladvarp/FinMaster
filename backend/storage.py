from __future__ import annotations

import hashlib
import json
import os
import re
import secrets
import shutil
import threading
from datetime import datetime, timezone
from typing import Any


APP_NAME = "FinMaster"
MAX_RECENT = 15
MAX_DEVICES = 20
DEFAULT_REMOTE_PORT = 17891
HISTORY_LIMIT_MIN = 5
HISTORY_LIMIT_MAX = 200
HISTORY_LIMIT_DEFAULT = 40
_TELEGRAM_TOKEN_RE = re.compile(r"^\d{5,}:[A-Za-z0-9_-]{20,}$")
_LOCK = threading.RLock()
_CACHE: dict[str, Any] | None = None
_SECRETS = {"ngrok_token": "", "telegram_bot_token": "", "telegram_chat_id": ""}
_VOLUME_CACHE: dict[str, tuple[float, dict[str, Any]]] = {}


def config_dir() -> str:
    base = os.environ.get("APPDATA") or os.path.join(os.path.expanduser("~"), ".config")
    path = os.path.join(base, APP_NAME)
    os.makedirs(path, exist_ok=True)
    return path


def config_path() -> str:
    return os.path.join(config_dir(), "config.json")


def _blank_config() -> dict[str, Any]:
    return {
        "recent": [],
        "autosave": False,
        "last_dir": "",
        "theme": "light",
        "window_maximized": False,
        "history_limit": HISTORY_LIMIT_DEFAULT,
    }


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
            data["history_limit"] = clamp_history_limit(data.get("history_limit"))
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


def clamp_history_limit(value: Any) -> int:
    try:
        n = int(value)
    except (TypeError, ValueError):
        n = HISTORY_LIMIT_DEFAULT
    return max(HISTORY_LIMIT_MIN, min(HISTORY_LIMIT_MAX, n))


def history_limit() -> int:
    return clamp_history_limit(load_config().get("history_limit"))


def set_history_limit(value: Any) -> int:
    n = clamp_history_limit(value)
    cfg = load_config()
    cfg["history_limit"] = n
    save_config(cfg)
    return n


HISTORY_META = "meta.json"


def history_root() -> str:
    path = os.path.join(default_reports_dir(), "history")
    os.makedirs(path, exist_ok=True)
    return path


def _norm_report_path(path: str) -> str:
    return os.path.normcase(os.path.abspath(str(path or "").replace("/", os.sep)))


def _folder_bytes(path: str) -> int:
    total = 0
    for root, _dirs, files in os.walk(path):
        for name in files:
            try:
                total += os.path.getsize(os.path.join(root, name))
            except OSError:
                continue
    return total


def _read_history_meta(folder: str) -> dict[str, Any]:
    path = os.path.join(folder, HISTORY_META)
    if not os.path.isfile(path):
        return {}
    try:
        with open(path, encoding="utf-8") as fh:
            raw = json.load(fh)
        return raw if isinstance(raw, dict) else {}
    except (OSError, json.JSONDecodeError, TypeError, ValueError):
        return {}


def _write_history_meta(folder: str, data: dict[str, Any]) -> None:
    os.makedirs(folder, exist_ok=True)
    path = os.path.join(folder, HISTORY_META)
    tmp = f"{path}.{os.getpid()}.tmp"
    try:
        with open(tmp, "w", encoding="utf-8") as fh:
            json.dump(data, fh, ensure_ascii=False, indent=2)
            fh.flush()
            os.fsync(fh.fileno())
        os.replace(tmp, path)
    finally:
        if os.path.exists(tmp):
            try:
                os.remove(tmp)
            except OSError:
                pass


def _snap_name(item_id: str) -> str:
    text = os.path.basename(str(item_id or "").strip())
    if text.lower().endswith(".json"):
        text = text[:-5]
    text = re.sub(r"[^A-Za-z0-9_-]+", "", text)
    return f"{text or secrets.token_hex(8)}.json"


def _history_file_candidates(item: dict[str, Any]) -> list[str]:
    names: list[str] = []
    seen: set[str] = set()

    def add(value: Any) -> None:
        raw = os.path.basename(str(value or "").strip())
        if not raw:
            return
        variants = [raw, _snap_name(raw)]
        if raw.lower().endswith(".json"):
            stem = raw[:-5]
            variants.append(re.sub(r"[^A-Za-z0-9_-]+", "", stem) + "json.json")
        for name in variants:
            name = os.path.basename(str(name or "").strip())
            if not name or name == HISTORY_META or name in seen:
                continue
            seen.add(name)
            names.append(name)

    add(item.get("file"))
    add(item.get("id"))
    return names


def _read_history_snap(path: str) -> dict[str, Any] | None:
    try:
        with open(path, encoding="utf-8") as fh:
            data = json.load(fh)
        return data if isinstance(data, dict) else None
    except (OSError, json.JSONDecodeError, TypeError, ValueError):
        return None


def find_history_folder(report_path: str) -> str:
    if not report_path:
        return ""
    want = _norm_report_path(report_path)
    want_name = os.path.basename(want)
    root = history_root()
    try:
        names = os.listdir(root)
    except OSError:
        return ""
    fallback = ""
    fallback_hits = 0
    for name in names:
        folder = os.path.join(root, name)
        if not os.path.isdir(folder):
            continue
        path = str(_read_history_meta(folder).get("path") or "")
        if not path:
            continue
        got = _norm_report_path(path)
        if got == want:
            return folder
        if os.path.basename(got) == want_name:
            fallback = folder
            fallback_hits += 1
    if fallback_hits == 1:
        return fallback
    return ""


def _alloc_history_folder(report_path: str, title: str) -> str:
    existing = find_history_folder(report_path)
    if existing:
        return existing
    base = safe_report_title(title or os.path.splitext(os.path.basename(report_path))[0])
    root = history_root()
    folder = os.path.join(root, base)
    if os.path.isdir(folder):
        meta = _read_history_meta(folder)
        other = str(meta.get("path") or "")
        if other and _norm_report_path(other) != _norm_report_path(report_path):
            suffix = hashlib.sha1(_norm_report_path(report_path).encode("utf-8")).hexdigest()[:8]
            folder = os.path.join(root, f"{base} — {suffix}")
    os.makedirs(folder, exist_ok=True)
    return folder


def _in_library(path: str) -> bool:
    if not path:
        return False
    folder = os.path.abspath(default_reports_dir())
    full = os.path.abspath(path)
    prefix = folder if folder.endswith(os.sep) else folder + os.sep
    check = full.lower() if os.name == "nt" else full
    root = prefix.lower() if os.name == "nt" else prefix
    return check.startswith(root)


def _clean_history_item(item: dict[str, Any]) -> dict[str, Any] | None:
    if not isinstance(item, dict):
        return None
    item_id = str(item.get("id") or "").strip()
    if not item_id:
        return None
    return {
        "id": item_id,
        "at": str(item.get("at") or ""),
        "label": str(item.get("label") or "Правка"),
        "source": "mobile" if item.get("source") == "mobile" else "pc",
        "device": str(item.get("device") or ("Телефон" if item.get("source") == "mobile" else "ПК")),
        "file": _snap_name(item.get("file") or item_id),
    }


def load_doc_history(report_path: str) -> dict[str, Any]:
    folder = find_history_folder(report_path)
    if not folder:
        return {"index": -1, "items": []}
    meta = _read_history_meta(folder)
    raw_items = meta.get("items") if isinstance(meta.get("items"), list) else []
    items = []
    for raw in raw_items:
        if not isinstance(raw, dict):
            continue
        info = _clean_history_item(raw)
        if not info:
            continue
        doc = None
        used = info["file"]
        for name in _history_file_candidates(raw):
            found = _read_history_snap(os.path.join(folder, name))
            if found is None:
                continue
            doc = found
            used = name
            break
        if doc is None:
            continue
        items.append({**info, "file": used, "doc": doc})
    limit = history_limit()
    if len(items) > limit:
        extra = len(items) - limit
        items = items[extra:]
        index = max(-1, int(meta.get("index") or -1) - extra)
    else:
        index = int(meta.get("index") if meta.get("index") is not None else len(items) - 1)
    if items and (index < 0 or index >= len(items)):
        index = len(items) - 1
    return {"index": index, "items": items, "folder": os.path.basename(folder)}


def save_doc_history(report_path: str, payload: dict[str, Any]) -> dict[str, Any]:
    if not report_path:
        return {"index": -1, "items": []}
    title = ""
    if isinstance(payload, dict):
        title = str(payload.get("title") or "")
    folder = _alloc_history_folder(report_path, title)
    old_meta = _read_history_meta(folder)
    old_items = old_meta.get("items") if isinstance(old_meta.get("items"), list) else []
    old_ids = {str(item.get("id") or "") for item in old_items if isinstance(item, dict) and item.get("id")}
    raw_items = payload.get("items") if isinstance(payload, dict) else []
    if not isinstance(raw_items, list):
        raw_items = []
    keep = []
    keep_files = {HISTORY_META}
    pending_writes: list[tuple[dict[str, Any], dict[str, Any]]] = []
    for raw in raw_items:
        if not isinstance(raw, dict):
            continue
        info = _clean_history_item(raw)
        if not info:
            continue
        used = ""
        for name in _history_file_candidates({**raw, "file": info.get("file"), "id": info.get("id")}):
            if os.path.isfile(os.path.join(folder, name)):
                used = name
                break
        if used:
            info["file"] = used
        else:
            doc = raw.get("doc")
            if not isinstance(doc, dict):
                continue
            pending_writes.append((info, doc))
        keep.append(info)
        keep_files.add(info["file"])
    new_ids = {item["id"] for item in keep}
    if old_ids and new_ids.isdisjoint(old_ids) and len(keep) < max(1, len(old_items)):
        return load_doc_history(report_path)
    written: list[dict[str, Any]] = []
    for info, doc in pending_writes:
        snap = os.path.join(folder, info["file"])
        try:
            with open(snap, "w", encoding="utf-8") as fh:
                json.dump(doc, fh, ensure_ascii=False)
        except OSError:
            continue
        if os.path.isfile(snap):
            written.append(info)
    if pending_writes:
        ok = {id(item) for item in written}
        keep = [item for item in keep if id(item) in ok or os.path.isfile(os.path.join(folder, item["file"]))]
        keep_files = {HISTORY_META, *(item["file"] for item in keep)}
    limit = history_limit()
    if len(keep) > limit:
        extra = len(keep) - limit
        for gone in keep[:extra]:
            keep_files.discard(gone["file"])
        keep = keep[extra:]
        index = max(-1, int(payload.get("index") or -1) - extra)
    else:
        index = int(payload.get("index") if isinstance(payload, dict) and payload.get("index") is not None else len(keep) - 1)
    if keep and (index < 0 or index >= len(keep)):
        index = len(keep) - 1
    try:
        for name in os.listdir(folder):
            if name in keep_files:
                continue
            path = os.path.join(folder, name)
            if os.path.isfile(path):
                try:
                    os.remove(path)
                except OSError:
                    pass
    except OSError:
        pass
    _write_history_meta(
        folder,
        {
            "path": os.path.abspath(report_path),
            "title": title or os.path.splitext(os.path.basename(report_path))[0],
            "index": index,
            "items": keep,
        },
    )
    return load_doc_history(report_path)


def delete_doc_history(report_path: str) -> None:
    folder = find_history_folder(report_path)
    if folder:
        shutil.rmtree(folder, ignore_errors=True)


def delete_history_folder(name: str) -> str:
    root = os.path.abspath(history_root())
    folder = os.path.abspath(os.path.join(root, os.path.basename(str(name or ""))))
    prefix = root if root.endswith(os.sep) else root + os.sep
    check = folder if os.name != "nt" else folder.lower()
    base = prefix if os.name != "nt" else prefix.lower()
    if check != (root if os.name != "nt" else root.lower()) and not check.startswith(base):
        raise ValueError("Нельзя удалить эту папку.")
    if not os.path.isdir(folder):
        raise FileNotFoundError("Папка истории не найдена.")
    shutil.rmtree(folder)
    return folder


def list_histories(current_path: str = "") -> dict[str, Any]:
    root = history_root()
    items: list[dict[str, Any]] = []
    total = 0
    try:
        names = os.listdir(root)
    except OSError:
        names = []
    for name in names:
        folder = os.path.join(root, name)
        if not os.path.isdir(folder):
            continue
        meta = _read_history_meta(folder)
        path = str(meta.get("path") or "")
        snaps = meta.get("items") if isinstance(meta.get("items"), list) else []
        size = _folder_bytes(folder)
        total += size
        last = ""
        for snap in snaps:
            if isinstance(snap, dict) and str(snap.get("at") or "") > last:
                last = str(snap.get("at") or "")
        items.append(
            {
                "folder": name,
                "title": str(meta.get("title") or name),
                "path": path,
                "exists": bool(path and os.path.isfile(path)),
                "in_library": _in_library(path),
                "current": same_path(path, current_path),
                "count": len(snaps),
                "bytes": size,
                "index": meta.get("index"),
                "updated": last,
            }
        )
    items.sort(key=lambda row: (not row.get("current"), -(row.get("bytes") or 0), str(row.get("title") or "")))
    return {"root": root, "bytes": total, "items": items}


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


def report_volume(path: str) -> dict[str, Any]:
    """Лёгкая сводка файла: размер, заказы, позиции, сумма — для размера галактики."""
    empty = {"bytes": 0, "orders": 0, "lines": 0, "value": 0.0, "title": ""}
    try:
        stamp = os.path.getmtime(path)
        size = os.path.getsize(path)
    except OSError:
        return empty
    cached = _VOLUME_CACHE.get(path)
    if cached and cached[0] == stamp:
        return dict(cached[1])
    out: dict[str, Any] = {"bytes": int(size), "orders": 0, "lines": 0, "value": 0.0, "title": ""}
    try:
        with open(path, encoding="utf-8") as fh:
            doc = json.load(fh)
        if isinstance(doc, dict):
            out["title"] = str(doc.get("title") or "").strip()
            orders = doc.get("orders") if isinstance(doc.get("orders"), list) else []
            out["orders"] = len(orders)
            value = 0.0
            lines_n = 0
            for order in orders:
                if not isinstance(order, dict):
                    continue
                rows = order.get("lines") if isinstance(order.get("lines"), list) else []
                lines_n += len(rows)
                for line in rows:
                    if not isinstance(line, dict):
                        continue
                    try:
                        qty = float(line.get("quantity") or 0)
                        price = float(line.get("price") or 0)
                        disc = min(100.0, max(0.0, float(line.get("discount") or 0)))
                        value += qty * price * (1.0 - disc / 100.0)
                    except (TypeError, ValueError):
                        continue
            out["lines"] = lines_n
            out["value"] = round(value, 2)
    except (OSError, json.JSONDecodeError, TypeError, ValueError, MemoryError):
        pass
    _VOLUME_CACHE[path] = (stamp, out)
    return dict(out)


def with_volume(item: dict[str, Any]) -> dict[str, Any]:
    path = str(item.get("path") or "")
    if not path:
        return item
    vol = report_volume(path)
    out = {
        **item,
        "bytes": vol.get("bytes") or 0,
        "orders": vol.get("orders") or 0,
        "lines": vol.get("lines") or 0,
        "value": vol.get("value") or 0,
    }
    title = str(vol.get("title") or "").strip()
    if title and not str(item.get("title") or "").strip():
        out["title"] = title
    elif title and item.get("title") == os.path.splitext(os.path.basename(path))[0]:
        out["title"] = title
    return out


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
            with_volume(
                {
                    "path": os.path.abspath(path),
                    "title": os.path.splitext(name)[0],
                    "name": name,
                    "modified_at": datetime.fromtimestamp(stamp).astimezone().replace(microsecond=0).isoformat(),
                }
            )
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
    delete_doc_history(full)
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
