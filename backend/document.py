from __future__ import annotations

from datetime import datetime, timezone
from typing import Any


SCHEMA_VERSION = 1

DEFAULT_STATUSES = [
    {"id": "new", "name": "Новый заказ", "color": "#0284c7"},
    {"id": "in_progress", "name": "Выполняется", "color": "#2563eb"},
    {"id": "waiting", "name": "Ожидание", "color": "#d97706"},
    {"id": "unpaid", "name": "Не оплачено", "color": "#dc2626"},
    {"id": "paid", "name": "Оплачено", "color": "#059669", "is_paid": True},
    {"id": "cancelled", "name": "Отменено", "color": "#64748b"},
    {"id": "annulled", "name": "Аннулирован", "color": "#475569"},
    {"id": "blacklist", "name": "Черный список", "color": "#111827"},
]

DEFAULT_UNITS = ["шт.", "м²", "м", "мин"]
DEFAULT_ORDER_TYPES = ["Производство", "Услуга", "Поставка", "Монтаж"]
DEFAULT_PRODUCTS: list[str] = []


def now_iso() -> str:
    return datetime.now(timezone.utc).astimezone().replace(microsecond=0).isoformat()


def empty_document(title: str = "Новый отчёт") -> dict[str, Any]:
    stamp = now_iso()
    return {
        "version": SCHEMA_VERSION,
        "title": title,
        "created_at": stamp,
        "modified_at": stamp,
        "currency": "₽",
        "statuses": [dict(item) for item in DEFAULT_STATUSES],
        "units": list(DEFAULT_UNITS),
        "order_types": list(DEFAULT_ORDER_TYPES),
        "products": list(DEFAULT_PRODUCTS),
        "customers": [],
        "orders": [],
        "ui": {
            "sidebar_collapsed": False,
            "column_widths": {},
            "share_fields": [],
        },
    }


def normalize_document(raw: Any) -> dict[str, Any]:
    if not isinstance(raw, dict):
        raise ValueError("Файл отчёта повреждён: ожидался объект JSON.")

    base = empty_document(str(raw.get("title") or "Отчёт"))
    base["version"] = SCHEMA_VERSION
    base["created_at"] = str(raw.get("created_at") or base["created_at"])
    base["modified_at"] = str(raw.get("modified_at") or now_iso())
    base["currency"] = str(raw.get("currency") or "₽")

    statuses = raw.get("statuses")
    if isinstance(statuses, list) and statuses:
        cleaned = []
        for item in statuses:
            if not isinstance(item, dict):
                continue
            name = str(item.get("name") or "").strip()
            if not name:
                continue
            cleaned.append(
                {
                    "id": str(item.get("id") or name),
                    "name": name,
                    "color": str(item.get("color") or "#64748b"),
                    "is_paid": bool(item.get("is_paid")),
                    "locked": bool(item.get("locked")),
                }
            )
        if cleaned and not any(x.get("is_paid") for x in cleaned):
            for item in cleaned:
                if item["id"] == "paid" or "оплач" in item["name"].lower():
                    item["is_paid"] = True
                    break
        paid_seen = False
        for item in cleaned:
            if item.get("is_paid"):
                if paid_seen:
                    item["is_paid"] = False
                else:
                    paid_seen = True
        if cleaned:
            base["statuses"] = cleaned

    units = raw.get("units")
    if isinstance(units, list) and units:
        base["units"] = [str(u).strip() for u in units if str(u).strip()]

    order_types = raw.get("order_types")
    if isinstance(order_types, list) and order_types:
        base["order_types"] = [str(t).strip() for t in order_types if str(t).strip()]

    products = raw.get("products")
    if isinstance(products, list):
        seen = set()
        cleaned_products = []
        for item in products:
            name = str(item).strip()
            if not name or name in seen:
                continue
            seen.add(name)
            cleaned_products.append(name)
        if cleaned_products:
            base["products"] = cleaned_products

    customers = raw.get("customers")
    if isinstance(customers, list):
        base["customers"] = [c for c in customers if isinstance(c, dict)]

    orders = raw.get("orders")
    if isinstance(orders, list):
        base["orders"] = [o for o in orders if isinstance(o, dict)]

    if not isinstance(products, list):
        seen = set()
        harvested = []
        for order in base["orders"]:
            if not isinstance(order, dict):
                continue
            for line in order.get("lines") or []:
                if not isinstance(line, dict):
                    continue
                name = str(line.get("product") or "").strip()
                if name and name not in seen:
                    seen.add(name)
                    harvested.append(name)
        if harvested:
            base["products"] = harvested

    ui = raw.get("ui")
    if isinstance(ui, dict):
        base["ui"] = {
            "sidebar_collapsed": bool(ui.get("sidebar_collapsed")),
            "column_widths": ui.get("column_widths") if isinstance(ui.get("column_widths"), dict) else {},
            "share_fields": ui.get("share_fields") if isinstance(ui.get("share_fields"), list) else [],
        }

    return base
