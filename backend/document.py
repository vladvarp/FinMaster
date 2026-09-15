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
DEFAULT_ORDER_TYPES = [
    {"id": "production", "name": "Производство", "is_tax": False, "is_cost": False},
    {"id": "service", "name": "Услуга", "is_tax": False, "is_cost": False},
    {"id": "supply", "name": "Поставка", "is_tax": False, "is_cost": False},
    {"id": "install", "name": "Монтаж", "is_tax": False, "is_cost": False},
]
DEFAULT_PRODUCTS: list[dict[str, str]] = []

DEFAULT_PAYMENT_TERMS = 14
DEFAULT_CASH_HORIZON = 30
CASH_HORIZONS = (14, 30, 60, 90)
CLOUD_LAYOUTS = ("galaxy", "orbit", "timeline", "constellation")
CLOUD_COLOR_MODES = ("status", "customer", "debt", "type")
CLOUD_SIZE_MODES = ("amount", "debt", "quantity", "equal")


def _cloud_ui(raw: Any) -> dict[str, Any]:
    if not isinstance(raw, dict):
        return {}
    out: dict[str, Any] = {}
    if raw.get("layout") in CLOUD_LAYOUTS:
        out["layout"] = raw["layout"]
    if raw.get("color") in CLOUD_COLOR_MODES:
        out["color"] = raw["color"]
    if raw.get("size") in CLOUD_SIZE_MODES:
        out["size"] = raw["size"]
    if isinstance(raw.get("labels"), bool):
        out["labels"] = raw["labels"]
    if isinstance(raw.get("motion"), bool):
        out["motion"] = raw["motion"]
    if isinstance(raw.get("heat"), bool):
        out["heat"] = raw["heat"]
    if isinstance(raw.get("space3d"), bool):
        out["space3d"] = raw["space3d"]
    if isinstance(raw.get("debtOnly"), bool):
        out["debtOnly"] = raw["debtOnly"]
    return out


def _line_series_ui(raw: Any) -> dict[str, Any]:
    ids = ("after", "paid", "unpaid", "cost", "net")
    defaults = {"after": True, "paid": True, "unpaid": True, "cost": True, "net": False}

    def one(src: Any) -> dict[str, bool]:
        out = dict(defaults)
        if isinstance(src, dict):
            for key in ids:
                if isinstance(src.get(key), bool):
                    out[key] = src[key]
        if not any(out.values()):
            out["after"] = True
        return out

    if not isinstance(raw, dict):
        return {}
    if any(isinstance(raw.get(key), bool) for key in ids) and "dash" not in raw and "analytics" not in raw:
        shared = one(raw)
        return {"dash": dict(shared), "analytics": dict(shared)}
    out: dict[str, Any] = {}
    if isinstance(raw.get("dash"), dict):
        out["dash"] = one(raw.get("dash"))
    if isinstance(raw.get("analytics"), dict):
        out["analytics"] = one(raw.get("analytics"))
    return out


def _int_in_range(value: Any, default: int, low: int, high: int) -> int:
    try:
        number = int(round(float(value)))
    except (TypeError, ValueError):
        return default
    return max(low, min(high, number))


def _order_type_entry(item: Any) -> dict[str, Any] | None:
    """Тип заказа: строка из старых файлов или объект с галочками «налог» / «затрата»."""
    if isinstance(item, dict):
        name = str(item.get("name") or "").strip()
        is_tax = bool(item.get("is_tax"))
        is_cost = bool(item.get("is_cost"))
        type_id = str(item.get("id") or name)
    else:
        name = str(item or "").strip()
        is_tax = False
        is_cost = False
        type_id = name
    if not name:
        return None
    if is_tax:
        is_cost = False
    return {"id": type_id, "name": name, "is_tax": is_tax, "is_cost": is_cost}


def _product_price(value: Any) -> float:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return 0.0
    if number != number or number < 0:
        return 0.0
    return round(number * 100) / 100


def _product_entry(item: Any, default_unit: str) -> dict[str, Any] | None:
    if isinstance(item, dict):
        name = str(item.get("name") or "").strip()
        unit = str(item.get("unit") or "").strip() or default_unit
        price = _product_price(item.get("price"))
    else:
        name = str(item or "").strip()
        unit = default_unit
        price = 0.0
    if not name:
        return None
    return {"name": name, "unit": unit, "price": price}


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
        "order_types": [dict(item) for item in DEFAULT_ORDER_TYPES],
        "products": list(DEFAULT_PRODUCTS),
        "customers": [],
        "orders": [],
        "ui": {
            "sidebar_collapsed": False,
            "column_widths": {},
            "share_fields": [],
            "share_theme": "teal",
            "payment_terms": DEFAULT_PAYMENT_TERMS,
            "cash_horizon": DEFAULT_CASH_HORIZON,
            "cloud": {},
            "line_series": {},
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
        seen_types: set[str] = set()
        cleaned_types = []
        for item in order_types:
            entry = _order_type_entry(item)
            if not entry or entry["name"] in seen_types:
                continue
            seen_types.add(entry["name"])
            cleaned_types.append(entry)
        if cleaned_types:
            base["order_types"] = cleaned_types

    products = raw.get("products")
    default_unit = base["units"][0] if base["units"] else "шт."
    if isinstance(products, list):
        seen = set()
        cleaned_products = []
        for item in products:
            entry = _product_entry(item, default_unit)
            if not entry or entry["name"] in seen:
                continue
            seen.add(entry["name"])
            cleaned_products.append(entry)
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
                    unit = str(line.get("unit") or "").strip() or default_unit
                    price = _product_price(line.get("price"))
                    harvested.append({"name": name, "unit": unit, "price": price})
        if harvested:
            base["products"] = harvested

    ui = raw.get("ui")
    if isinstance(ui, dict):
        base["ui"] = {
            "sidebar_collapsed": bool(ui.get("sidebar_collapsed")),
            "column_widths": ui.get("column_widths") if isinstance(ui.get("column_widths"), dict) else {},
            "share_fields": ui.get("share_fields") if isinstance(ui.get("share_fields"), list) else [],
            "share_theme": str(ui.get("share_theme") or "teal"),
            "payment_terms": _int_in_range(ui.get("payment_terms"), DEFAULT_PAYMENT_TERMS, 0, 365),
            "cash_horizon": _int_in_range(ui.get("cash_horizon"), DEFAULT_CASH_HORIZON, 14, 90),
            "cloud": _cloud_ui(ui.get("cloud")),
            "line_series": _line_series_ui(ui.get("line_series")),
        }
        if base["ui"]["cash_horizon"] not in CASH_HORIZONS:
            base["ui"]["cash_horizon"] = DEFAULT_CASH_HORIZON

    return base
