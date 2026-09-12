from __future__ import annotations

import json
import os
from datetime import datetime, timezone
from typing import Any


APP_NAME = "FinMaster"
MAX_RECENT = 15


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
        return {"recent": [], "autosave": False, "last_dir": ""}
    try:
        with open(path, encoding="utf-8") as fh:
            data = json.load(fh)
        if not isinstance(data, dict):
            return {"recent": [], "autosave": False, "last_dir": ""}
        data.setdefault("recent", [])
        data.setdefault("autosave", False)
        data.setdefault("last_dir", "")
        return data
    except (OSError, json.JSONDecodeError):
        return {"recent": [], "autosave": False, "last_dir": ""}


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


def set_autosave(enabled: bool) -> None:
    cfg = load_config()
    cfg["autosave"] = bool(enabled)
    save_config(cfg)


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
