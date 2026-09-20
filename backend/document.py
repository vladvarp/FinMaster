from __future__ import annotations

from datetime import date, datetime, timedelta, timezone
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
CALENDAR_MODES = ("timeline", "classic", "extended")
CALENDAR_FILTERS = ("all", "now", "planned", "done", "overdue", "nodate")
DEFAULT_WEEKENDS = [5, 6]


def _day_iso(value: Any) -> str:
    text = str(value or "").strip()
    if len(text) >= 10 and text[4] == "-" and text[7] == "-":
        year, month, day = text[0:4], text[5:7], text[8:10]
        if year.isdigit() and month.isdigit() and day.isdigit():
            return f"{year}-{month}-{day}"
    return ""


def _iso_add(value: str, days: int) -> str:
    try:
        year, month, day = (int(part) for part in value.split("-"))
        return (date(year, month, day) + timedelta(days=days)).isoformat()
    except ValueError:
        return value


def _work_pauses(raw: Any, start: str, end: str) -> list[dict[str, Any]]:
    if not start and not end:
        return []
    if not isinstance(raw, list):
        return []
    today = date.today().isoformat()
    items: list[tuple[str, str, bool]] = []
    for item in raw:
        if not isinstance(item, dict):
            continue
        a = _day_iso(item.get("start"))
        b = _day_iso(item.get("end"))
        stored_end = b
        if a and b and b < a:
            a, b = b, a
        if not a and not b:
            continue
        a = a or b
        b = b or a
        was_open = bool(item.get("open")) or not stored_end
        open_pause = False
        if not end:
            if was_open or (b and b >= today):
                open_pause = bool(a)
                b = today
        elif was_open or not stored_end:
            b = today
        if start and a and a < start:
            a = start
        if open_pause:
            b = today
        elif end and b > end:
            b = end
        if start and b < start:
            continue
        if end and a > end:
            continue
        if not end and open_pause and a > today:
            continue
        if a and (open_pause or (b and a <= b)):
            items.append((a, "" if open_pause else b, open_pause))
    items.sort(key=lambda row: (row[0], row[1] or today))
    merged: list[dict[str, Any]] = []
    for a, b, open_pause in items:
        if merged:
            last = merged[-1]
            last_end = str(last.get("end") or today)
            nxt = _iso_add(last_end, 1)
            if nxt and a <= nxt:
                if open_pause or last.get("open"):
                    last["end"] = ""
                    last["open"] = True
                elif b and b > last_end:
                    last["end"] = b
                continue
        entry: dict[str, Any] = {"start": a, "end": b}
        if open_pause:
            entry["open"] = True
            entry["end"] = ""
        merged.append(entry)
    return merged


def _weekday_list(raw: Any) -> list[int]:
    out: list[int] = []
    seen: set[int] = set()
    if not isinstance(raw, list):
        return list(DEFAULT_WEEKENDS)
    for item in raw:
        try:
            number = int(item)
        except (TypeError, ValueError):
            continue
        if 0 <= number <= 6 and number not in seen:
            seen.add(number)
            out.append(number)
    out.sort()
    return out


def _iso_day_list(raw: Any) -> list[str]:
    out: list[str] = []
    seen: set[str] = set()
    if not isinstance(raw, list):
        return out
    for item in raw:
        day = _day_iso(item)
        if day and day not in seen:
            seen.add(day)
            out.append(day)
    out.sort()
    return out


def _day_notes(raw: Any) -> dict[str, str]:
    if not isinstance(raw, dict):
        return {}
    out: dict[str, str] = {}
    for key, val in raw.items():
        day = _day_iso(key)
        text = str(val or "").strip()
        if day and text:
            out[day] = text[:2000]
    return out


def _calendar_ui(raw: Any) -> dict[str, Any]:
    if not isinstance(raw, dict):
        return {}
    out: dict[str, Any] = {}
    if raw.get("mode") in CALENDAR_MODES:
        out["mode"] = raw["mode"]
    if raw.get("filter") in CALENDAR_FILTERS:
        out["filter"] = raw["filter"]
    if "weekends" in raw:
        out["weekends"] = _weekday_list(raw.get("weekends"))
    work_days = _iso_day_list(raw.get("work_days"))
    off_days = [day for day in _iso_day_list(raw.get("off_days")) if day not in set(work_days)]
    if off_days:
        out["off_days"] = off_days
    if work_days:
        out["work_days"] = work_days
    notes = _day_notes(raw.get("day_notes"))
    if notes:
        out["day_notes"] = notes
    return out


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


CALC_OPS = ("+", "-", "*", "/")
CALC_NODE_TYPES = ("order", "math", "formula", "percent", "const", "result", "scheme")
CALC_MAX_BLUEPRINTS = 24
CALC_MAX_NODES = 120
CALC_MAX_LINKS = 400
CALC_MAX_PORTS = 20


def _clip_text(value: Any, limit: int, fallback: str = "") -> str:
    text = str(value or "").strip()
    return (text[:limit] if text else fallback)


def _calc_port(raw: Any, fallback: str, with_expr: bool) -> dict[str, Any] | None:
    if isinstance(raw, dict):
        port_id = _clip_text(raw.get("id"), 80)
        name = _clip_text(raw.get("name"), 24, fallback)
        expr = _clip_text(raw.get("expr"), 200) if with_expr else ""
    else:
        port_id = ""
        name = _clip_text(raw, 24, fallback)
        expr = ""
    if not name:
        return None
    port: dict[str, Any] = {"id": port_id or name, "name": name}
    if with_expr:
        port["expr"] = expr
    return port


def _calc_ports(raw: Any, kind: str, defaults: list[dict[str, Any]]) -> list[dict[str, Any]]:
    with_expr = kind == "out"
    items: list[dict[str, Any]] = []
    seen: set[str] = set()
    src = raw if isinstance(raw, list) else defaults
    for i, item in enumerate(src[:CALC_MAX_PORTS]):
        fallback = defaults[i]["name"] if i < len(defaults) else ("ABCDEFGHIJKLMNOPQRSTUVWXYZ"[i] if i < 26 else f"P{i + 1}")
        port = _calc_port(item, fallback, with_expr)
        if not port:
            continue
        key = port["id"]
        if key in seen:
            continue
        seen.add(key)
        if with_expr and not str(port.get("expr") or "").strip():
            port["expr"] = defaults[i]["expr"] if i < len(defaults) and defaults[i].get("expr") else port["name"]
        items.append(port)
    return items or [dict(item) for item in defaults]


def _calc_node(raw: Any) -> dict[str, Any] | None:
    if not isinstance(raw, dict):
        return None
    node_id = _clip_text(raw.get("id"), 80)
    kind = str(raw.get("type") or "")
    if not node_id or kind not in CALC_NODE_TYPES:
        return None
    node: dict[str, Any] = {
        "id": node_id,
        "type": kind,
        "x": _int_in_range(raw.get("x"), 80, -8000, 8000),
        "y": _int_in_range(raw.get("y"), 80, -8000, 8000),
    }
    if kind == "order":
        node["orderId"] = _clip_text(raw.get("orderId"), 80)
    elif kind == "math":
        op = str(raw.get("op") or "+")
        node["op"] = op if op in CALC_OPS else "+"
    elif kind == "result":
        node["name"] = _clip_text(raw.get("name"), 48, "Результат")
    elif kind == "const":
        try:
            value = float(raw.get("value"))
        except (TypeError, ValueError):
            value = 0.0
        if value != value:
            value = 0.0
        node["value"] = value
    elif kind == "scheme":
        node["blueprintId"] = _clip_text(raw.get("blueprintId"), 80)
    elif kind == "formula":
        letters = "ABCDEFGHIJKLMNOPQRSTUVWXYZ"
        inputs = _calc_ports(
            raw.get("inputs"),
            "in",
            [{"id": "a", "name": "A"}, {"id": "b", "name": "B"}],
        )
        used: set[str] = set()
        fixed: list[dict[str, Any]] = []
        for i, port in enumerate(inputs[:26]):
            name = str(port.get("name") or "").strip().upper()
            if len(name) != 1 or name not in letters or name in used:
                name = next((ch for ch in letters if ch not in used), letters[i % 26])
            used.add(name)
            fixed.append({"id": port.get("id") or name.lower(), "name": name})
        node["inputs"] = fixed or [{"id": "a", "name": "A"}, {"id": "b", "name": "B"}]
        node["outputs"] = _calc_ports(
            raw.get("outputs"),
            "out",
            [
                {"id": "c", "name": "C", "expr": "A+B"},
                {"id": "d", "name": "D", "expr": "(-40+A)*B"},
            ],
        )
    return node


def _calc_link(raw: Any) -> dict[str, Any] | None:
    if not isinstance(raw, dict):
        return None
    link_id = _clip_text(raw.get("id"), 80)
    src = _clip_text(raw.get("from"), 80)
    dst = _clip_text(raw.get("to"), 80)
    if not link_id or not src or not dst or src == dst:
        return None
    return {
        "id": link_id,
        "from": src,
        "fromPort": _clip_text(raw.get("fromPort"), 80, "out"),
        "to": dst,
        "toPort": _clip_text(raw.get("toPort"), 80, "in1"),
    }


def _calc_blueprint(raw: Any, index: int) -> dict[str, Any] | None:
    if not isinstance(raw, dict):
        return None
    bp_id = _clip_text(raw.get("id"), 80)
    if not bp_id:
        return None
    nodes: list[dict[str, Any]] = []
    seen_nodes: set[str] = set()
    for item in raw.get("nodes") if isinstance(raw.get("nodes"), list) else []:
        node = _calc_node(item)
        if not node or node["id"] in seen_nodes:
            continue
        seen_nodes.add(node["id"])
        nodes.append(node)
        if len(nodes) >= CALC_MAX_NODES:
            break
    node_ids = {node["id"] for node in nodes}
    links: list[dict[str, Any]] = []
    seen_links: set[str] = set()
    for item in raw.get("links") if isinstance(raw.get("links"), list) else []:
        link = _calc_link(item)
        if not link or link["id"] in seen_links:
            continue
        if link["from"] not in node_ids or link["to"] not in node_ids:
            continue
        seen_links.add(link["id"])
        links.append(link)
        if len(links) >= CALC_MAX_LINKS:
            break
    zoom = 1.0
    try:
        zoom = float(raw.get("zoom") or 1)
    except (TypeError, ValueError):
        zoom = 1.0
    if zoom != zoom:
        zoom = 1.0
    zoom = max(0.35, min(2.5, zoom))
    return {
        "id": bp_id,
        "name": _clip_text(raw.get("name"), 48, f"Схема {index + 1}"),
        "x": _int_in_range(raw.get("x"), 0, -20000, 20000),
        "y": _int_in_range(raw.get("y"), 0, -20000, 20000),
        "zoom": zoom,
        "nodes": nodes,
        "links": links,
    }


def _calculator_ui(raw: Any) -> dict[str, Any]:
    if not isinstance(raw, dict):
        return {"active": "", "blueprints": []}
    blueprints: list[dict[str, Any]] = []
    seen: set[str] = set()
    for i, item in enumerate(raw.get("blueprints") if isinstance(raw.get("blueprints"), list) else []):
        bp = _calc_blueprint(item, i)
        if not bp or bp["id"] in seen:
            continue
        seen.add(bp["id"])
        blueprints.append(bp)
        if len(blueprints) >= CALC_MAX_BLUEPRINTS:
            break
    active = _clip_text(raw.get("active"), 80)
    if active and active not in seen:
        active = blueprints[0]["id"] if blueprints else ""
    elif not active and blueprints:
        active = blueprints[0]["id"]
    return {"active": active, "blueprints": blueprints}


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
            "calculator": {"active": "", "blueprints": []},
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
        cleaned_orders = []
        for order in orders:
            if not isinstance(order, dict):
                continue
            start = _day_iso(order.get("work_start"))
            end = _day_iso(order.get("work_end"))
            if start and end and end < start:
                start, end = end, start
            order["work_start"] = start
            order["work_end"] = end
            order["work_pauses"] = _work_pauses(order.get("work_pauses"), start, end)
            lines = order.get("lines")
            if isinstance(lines, list):
                for line in lines:
                    if not isinstance(line, dict):
                        continue
                    ls = _day_iso(line.get("work_start"))
                    le = _day_iso(line.get("work_end"))
                    if ls and le and le < ls:
                        ls, le = le, ls
                    if start and ls and ls < start:
                        ls = start
                    if end and ls and ls > end:
                        ls = end
                    if start and le and le < start:
                        le = start
                    if end and le and le > end:
                        le = end
                    line["work_start"] = ls
                    line["work_end"] = le
                    line["frozen"] = bool(line.get("frozen"))
                    env_s, env_e = ls or start, le or end
                    line["work_pauses"] = _work_pauses(line.get("work_pauses"), env_s, env_e) if (env_s or env_e) else []
            cleaned_orders.append(order)
        base["orders"] = cleaned_orders

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
            "calendar": _calendar_ui(ui.get("calendar")),
            "line_series": _line_series_ui(ui.get("line_series")),
            "calculator": _calculator_ui(ui.get("calculator")),
        }
        if base["ui"]["cash_horizon"] not in CASH_HORIZONS:
            base["ui"]["cash_horizon"] = DEFAULT_CASH_HORIZON

    return base
