"""Поиск по папке отчётов и копия дня. Сами отчёты не переписывает."""

from __future__ import annotations

import json
import os
from typing import Any

from backend import storage
from backend import backup as report_backup

MAX_BYTES = 12_000_000
MAX_HITS = 30


def _read_raw(path: str) -> dict[str, Any]:
    full = os.path.abspath(path)
    if os.path.getsize(full) > MAX_BYTES:
        raise ValueError("Файл слишком большой.")
    raw = json.loads(storage.read_text(full))
    if not isinstance(raw, dict):
        raise ValueError("Файл повреждён.")
    return raw


def _title(doc: dict[str, Any], path: str) -> str:
    title = str(doc.get("title") or "").strip()
    if title:
        return title
    return os.path.splitext(os.path.basename(path))[0]


def search_library(query: str) -> list[dict[str, Any]]:
    words = [part.casefold() for part in str(query or "").split() if part.strip()]
    if len(" ".join(words)) < 2:
        return []
    hits: list[dict[str, Any]] = []
    for item in storage.list_library_reports().get("items") or []:
        path = str(item.get("path") or "")
        if not path:
            continue
        try:
            doc = _read_raw(path)
        except (OSError, json.JSONDecodeError, TypeError, ValueError):
            continue
        report = _title(doc, path)
        for order in doc.get("orders") or []:
            if not isinstance(order, dict):
                continue
            products = [
                str(line.get("product") or "")
                for line in (order.get("lines") or [])
                if isinstance(line, dict)
            ]
            blob = " ".join(
                [
                    str(order.get("number") or ""),
                    str(order.get("customer") or ""),
                    str(order.get("name") or ""),
                    " ".join(products),
                ]
            ).casefold()
            if not all(word in blob for word in words):
                continue
            hits.append(
                {
                    "path": path,
                    "report": report,
                    "order_id": str(order.get("id") or ""),
                    "number": str(order.get("number") or ""),
                    "name": str(order.get("name") or ""),
                    "customer": str(order.get("customer") or ""),
                }
            )
            if len(hits) >= MAX_HITS:
                return hits
    return hits


def ensure_daily(doc: dict[str, Any], path: str) -> dict[str, Any]:
    if report_backup.is_backup_path(path):
        raise ValueError("Резервную копию нельзя копировать.")
    report_id = report_backup.valid_id(doc.get("id") if isinstance(doc, dict) else "")
    if report_id and report_backup.has_today(report_id):
        return {"created": False}
    report_backup.create_backup(doc, path)
    return {"created": True}
