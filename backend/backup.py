"""Резервные копии отчётов. Папка привязана к номеру отчёта, не к названию."""

from __future__ import annotations

import json
import os
import uuid
from datetime import datetime
from typing import Any

from backend import storage

EXT = ".fbak"
META = "meta.json"


def is_backup_path(path: str) -> bool:
    return str(path or "").lower().endswith(EXT)


def new_id() -> str:
    return str(uuid.uuid4())


def valid_id(value: Any) -> str:
    text = str(value or "").strip().lower()
    parts = text.split("-")
    if [len(part) for part in parts] != [8, 4, 4, 4, 12]:
        return ""
    if any(ch not in "0123456789abcdef" for part in parts for ch in part):
        return ""
    return text


def backups_root() -> str:
    path = os.path.join(storage.default_reports_dir(), "backups")
    os.makedirs(path, exist_ok=True)
    return path


def _norm(path: str) -> str:
    return os.path.normcase(os.path.abspath(str(path or "").replace("/", os.sep)))


def _folder(report_id: str) -> str:
    return os.path.join(backups_root(), valid_id(report_id))


def _read_meta(report_id: str) -> dict[str, Any]:
    path = os.path.join(_folder(report_id), META)
    if not os.path.isfile(path):
        return {}
    try:
        with open(path, encoding="utf-8") as handle:
            raw = json.load(handle)
        return raw if isinstance(raw, dict) else {}
    except (OSError, json.JSONDecodeError, TypeError, ValueError):
        return {}


def _write_meta(report_id: str, path: str, title: str) -> None:
    folder = _folder(report_id)
    os.makedirs(folder, exist_ok=True)
    payload = {"id": report_id, "path": os.path.abspath(path) if path else "", "title": str(title or "")}
    storage.atomic_write(os.path.join(folder, META), json.dumps(payload, ensure_ascii=False, indent=2))


def refuses_overwrite(report_id: str, path: str) -> bool:
    """Нельзя сохранить просмотр копии поверх исходного отчёта: у сохранения должен быть свой номер."""
    owner = str(_read_meta(valid_id(report_id)).get("path") or "")
    if not owner or not path or not os.path.isfile(owner):
        return False
    return _norm(owner) == _norm(path)


def _owned_by_other(report_id: str, path: str) -> bool:
    other = str(_read_meta(report_id).get("path") or "")
    if not other or not path or is_backup_path(path):
        return False
    if _norm(other) == _norm(path):
        return False
    return os.path.isfile(other)


def stamp_id(path: str, report_id: str) -> None:
    """Дописать номер в файл отчёта, не трогая резервную копию."""
    report_id = valid_id(report_id)
    if not report_id or not path or is_backup_path(path) or not os.path.isfile(path):
        return
    try:
        raw = json.loads(storage.read_text(path))
    except (OSError, json.JSONDecodeError, TypeError, ValueError):
        return
    if not isinstance(raw, dict) or valid_id(raw.get("id")) == report_id:
        return
    raw["id"] = report_id
    storage.atomic_write(path, json.dumps(raw, ensure_ascii=False, indent=2))


def ensure_id(doc: dict[str, Any], path: str, *, fresh: bool = False) -> str:
    current = "" if fresh else valid_id(doc.get("id"))
    if not current or _owned_by_other(current, path):
        current = new_id()
    doc["id"] = current
    if path and not is_backup_path(path):
        _write_meta(current, path, str(doc.get("title") or ""))
        stamp_id(path, current)
    return current


def _safe_name(name: str) -> str:
    base = os.path.basename(str(name or "").strip())
    if base != str(name or "").strip() or not base.lower().endswith(EXT):
        raise ValueError("Некорректное имя резервной копии.")
    if base == META:
        raise ValueError("Некорректное имя резервной копии.")
    return base


def _items(report_id: str) -> list[dict[str, Any]]:
    folder = _folder(report_id)
    rows: list[dict[str, Any]] = []
    try:
        names = os.listdir(folder)
    except OSError:
        return rows
    for name in names:
        if not name.lower().endswith(EXT):
            continue
        full = os.path.join(folder, name)
        if not os.path.isfile(full):
            continue
        try:
            size = os.path.getsize(full)
            mtime = os.path.getmtime(full)
        except OSError:
            continue
        title = ""
        try:
            raw = json.loads(storage.read_text(full))
            if isinstance(raw, dict):
                title = str(raw.get("title") or "")
        except (OSError, json.JSONDecodeError, TypeError, ValueError):
            title = ""
        rows.append(
            {
                "name": name,
                "path": os.path.abspath(full),
                "title": title,
                "bytes": size,
                "at": datetime.fromtimestamp(mtime).isoformat(timespec="seconds"),
            }
        )
    rows.sort(key=lambda item: item["at"], reverse=True)
    return rows


def describe(doc: dict[str, Any] | None, path: str) -> dict[str, Any]:
    document = doc if isinstance(doc, dict) else {}
    if not path or is_backup_path(path):
        report_id = valid_id(document.get("id"))
    elif not os.path.isfile(path):
        raise ValueError("Сначала сохраните отчёт на диск.")
    else:
        report_id = ensure_id(document, path)
    meta = _read_meta(report_id) if report_id else {}
    return {
        "id": report_id,
        "title": str(meta.get("title") or document.get("title") or ""),
        "root": os.path.join(backups_root(), report_id) if report_id else backups_root(),
        "items": _items(report_id) if report_id else [],
        "preview": is_backup_path(path),
    }


def create_backup(doc: dict[str, Any], path: str) -> dict[str, Any]:
    if is_backup_path(path):
        raise ValueError("Резервную копию нельзя изменять. Сначала сохраните её как отчёт.")
    if not path or not os.path.isfile(path):
        raise ValueError("Сначала сохраните отчёт на диск.")
    if not isinstance(doc, dict):
        raise ValueError("Нет данных отчёта.")
    report_id = ensure_id(doc, path)
    folder = _folder(report_id)
    os.makedirs(folder, exist_ok=True)
    stamp = datetime.now().strftime("%Y-%m-%d_%H-%M-%S")
    name = f"{stamp}{EXT}"
    full = os.path.join(folder, name)
    suffix = 2
    while os.path.exists(full):
        name = f"{stamp}-{suffix}{EXT}"
        full = os.path.join(folder, name)
        suffix += 1
    storage.atomic_write(full, json.dumps(doc, ensure_ascii=False, indent=2))
    _write_meta(report_id, path, str(doc.get("title") or ""))
    return describe(doc, path)


def read_backup(report_id: str, name: str) -> dict[str, Any]:
    report_id = valid_id(report_id)
    if not report_id:
        raise ValueError("Неизвестный отчёт.")
    base = _safe_name(name)
    full = os.path.join(_folder(report_id), base)
    if not os.path.isfile(full):
        raise FileNotFoundError("Резервная копия не найдена.")
    try:
        raw = json.loads(storage.read_text(full))
    except (OSError, json.JSONDecodeError, TypeError, ValueError) as exc:
        raise ValueError("Файл копии повреждён.") from exc
    if not isinstance(raw, dict):
        raise ValueError("Файл копии повреждён.")
    return raw


def delete_backup(report_id: str, name: str) -> None:
    report_id = valid_id(report_id)
    if not report_id:
        raise ValueError("Неизвестный отчёт.")
    base = _safe_name(name)
    full = os.path.join(_folder(report_id), base)
    if not os.path.isfile(full):
        raise FileNotFoundError("Резервная копия не найдена.")
    storage.send_to_trash(full)
