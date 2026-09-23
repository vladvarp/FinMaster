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
CALC_NODE_TYPES = ("order", "math", "formula", "percent", "const", "result", "scheme", "group", "filter", "dashboard", "present")
CALC_MAX_BLUEPRINTS = 24
CALC_MAX_NODES = 120
CALC_MAX_LINKS = 400
CALC_MAX_PORTS = 20
PRES_MAX_PAGES = 24
PRES_MAX_BLOCKS = 80
PRES_BLOCK_TYPES = ("kpi", "metric", "compare", "delta", "progress", "bars", "share", "title", "note", "spacer")
PRES_STYLE_PRESETS = ("card", "glass", "solid", "outline", "ink", "neon", "soft", "bare")
PRES_STYLE_FILLS = ("auto", "solid", "gradient", "glass", "none")
PRES_STYLE_ALIGNS = ("start", "center", "end")
PRES_STYLE_WEIGHTS = ("normal", "bold", "black")
CALC_PERIODS = ("all", "today", "week", "month", "year", "range")
CALC_PAY_FILTERS = ("all", "debt", "paid", "month", "empty")
CALC_DASH_PORTS = (
    "orders",
    "lines",
    "after",
    "afterActive",
    "paid",
    "unpaid",
    "total",
    "cost",
    "costCount",
    "net",
    "paidShare",
    "avgCheck",
    "overdue",
    "overdueSum",
    "monthAfter",
    "monthCost",
    "forecast",
)
CALC_DASH_DEFAULT = ("orders", "after", "paid", "unpaid")


def _clip_text_list(raw: Any, limit: int, max_items: int = 48) -> list[str]:
    out: list[str] = []
    seen: set[str] = set()
    src = raw if isinstance(raw, list) else []
    for item in src[: max_items * 2]:
        text = _clip_text(item, limit)
        if not text or text in seen:
            continue
        seen.add(text)
        out.append(text)
        if len(out) >= max_items:
            break
    return out


def _calc_filter_fields(raw: dict[str, Any]) -> dict[str, Any]:
    period = str(raw.get("period") or "all")
    if period not in CALC_PERIODS:
        period = "all"
    customers = _clip_text_list(raw.get("customers"), 80)
    if not customers:
        legacy = _clip_text(raw.get("customer"), 80)
        if legacy:
            customers = [legacy]
    order_ids = _clip_text_list(raw.get("orderIds"), 80)
    if not order_ids:
        legacy_id = _clip_text(raw.get("orderId"), 80)
        if legacy_id:
            order_ids = [legacy_id]
    pay_filters = [item for item in _clip_text_list(raw.get("payFilters"), 24) if item in CALC_PAY_FILTERS and item != "all"]
    if not pay_filters:
        pay = str(raw.get("payFilter") or "all")
        if pay in CALC_PAY_FILTERS and pay != "all":
            pay_filters = [pay]
    statuses = _clip_text_list(raw.get("statuses"), 48)
    if not statuses:
        legacy_status = _clip_text(raw.get("status"), 48)
        if legacy_status:
            statuses = [legacy_status]
    order_types = _clip_text_list(raw.get("orderTypes"), 64)
    if not order_types:
        legacy_type = _clip_text(raw.get("orderType"), 64)
        if legacy_type:
            order_types = [legacy_type]
    products = _clip_text_list(raw.get("products"), 80)
    if not products:
        legacy_product = _clip_text(raw.get("product"), 80)
        if legacy_product:
            products = [legacy_product]
    return {
        "customers": customers,
        "orderIds": order_ids,
        "period": period,
        "payFilters": pay_filters,
        "statuses": statuses,
        "orderTypes": order_types,
        "products": products,
        "dateFrom": _clip_text(raw.get("dateFrom"), 10),
        "dateTo": _clip_text(raw.get("dateTo"), 10),
        "customer": "",
        "orderId": "",
        "payFilter": "all",
        "status": "",
        "orderType": "",
        "product": "",
    }


def _calc_dash_ports(raw: Any) -> list[str]:
    allowed = set(CALC_DASH_PORTS)
    items: list[str] = []
    seen: set[str] = set()
    src = raw if isinstance(raw, list) else list(CALC_DASH_DEFAULT)
    for item in src[:CALC_MAX_PORTS]:
        name = _clip_text(item, 24)
        if name not in allowed or name in seen:
            continue
        seen.add(name)
        items.append(name)
    return items or list(CALC_DASH_DEFAULT)


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
        open_fields: dict[str, list[str]] = {}
        raw_open = raw.get("openFields")
        allowed = {"qty", "price", "discount", "paid", "unpaid", "percent"}
        if isinstance(raw_open, dict):
            for key, fields in raw_open.items():
                line_id = _clip_text(key, 80)
                if not line_id or not isinstance(fields, list):
                    continue
                cleaned: list[str] = []
                seen_f: set[str] = set()
                for item in fields[:8]:
                    name = _clip_text(item, 16)
                    if name not in allowed or name in seen_f:
                        continue
                    seen_f.add(name)
                    cleaned.append(name)
                if cleaned:
                    open_fields[line_id] = cleaned
        if open_fields:
            node["openFields"] = open_fields
        open_types: list[str] = []
        seen_types: set[str] = set()
        raw_types = raw.get("openTypes")
        if isinstance(raw_types, list):
            for item in raw_types[:40]:
                name = _clip_text(item, 48) or "Без типа"
                if name in seen_types:
                    continue
                seen_types.add(name)
                open_types.append(name)
        if open_types:
            node["openTypes"] = open_types
        open_type_fields: dict[str, list[str]] = {}
        raw_type_fields = raw.get("openTypeFields")
        if isinstance(raw_type_fields, dict):
            for key, fields in raw_type_fields.items():
                type_name = _clip_text(key, 48) or "Без типа"
                if not isinstance(fields, list):
                    continue
                cleaned_tf: list[str] = []
                seen_tf: set[str] = set()
                for item in fields[:8]:
                    name = _clip_text(item, 16)
                    if name not in allowed or name in seen_tf:
                        continue
                    seen_tf.add(name)
                    cleaned_tf.append(name)
                if cleaned_tf:
                    open_type_fields[type_name] = cleaned_tf
        if open_type_fields:
            node["openTypeFields"] = open_type_fields
    elif kind == "math":
        op = str(raw.get("op") or "+")
        node["op"] = op if op in CALC_OPS else "+"
    elif kind == "result":
        node["name"] = _clip_text(raw.get("name"), 48, "Результат")
        node["priority"] = _int_in_range(raw.get("priority"), 1, 0, 9999)
        node["visible"] = False if raw.get("visible") is False else True
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
    elif kind == "filter":
        node.update(_calc_filter_fields(raw))
    elif kind == "dashboard":
        node.update(_calc_filter_fields(raw))
        node["openPorts"] = _calc_dash_ports(raw.get("openPorts"))
    elif kind == "present":
        node["pageId"] = _clip_text(raw.get("pageId"), 80)
        node["blockId"] = _clip_text(raw.get("blockId"), 80)
        node["blockType"] = _clip_text(raw.get("blockType"), 24, "metric")
        if node["blockType"] not in PRES_BLOCK_TYPES:
            node["blockType"] = "metric"
        node["title"] = _clip_text(raw.get("title"), 64, "Блок")
    elif kind == "group":
        node["name"] = _clip_text(raw.get("name"), 48, "Группа")
        color = str(raw.get("color") or "").strip().lower()
        if not (len(color) == 7 and color.startswith("#") and all(ch in "0123456789abcdef" for ch in color[1:])):
            color = "#14b8a6"
        node["color"] = color
        node["w"] = _int_in_range(raw.get("w"), 320, 160, 4000)
        node["h"] = _int_in_range(raw.get("h"), 220, 120, 4000)
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
        used = {str(port.get("name") or "") for port in node["inputs"]}
        outputs = _calc_ports(
            raw.get("outputs"),
            "out",
            [
                {"id": "c", "name": "C", "expr": "A+B"},
                {"id": "d", "name": "D", "expr": "(-40+A)*B"},
            ],
        )
        out_fixed: list[dict[str, Any]] = []
        default_exprs = ["A+B", "(-40+A)*B"]
        for i, port in enumerate(outputs[:CALC_MAX_PORTS]):
            name = str(port.get("name") or "").strip().upper()
            if len(name) != 1 or name not in letters or name in used:
                name = next((ch for ch in letters if ch not in used), "")
            if not name:
                break
            used.add(name)
            expr = str(port.get("expr") or "").strip()
            if "=" in expr:
                left, _, _right = expr.rpartition("=")
                if left.strip():
                    expr = left.strip()
            if not expr:
                expr = default_exprs[i] if i < len(default_exprs) else "0"
            out_fixed.append({"id": port.get("id") or name.lower(), "name": name, "expr": expr[:200] or "0"})
        node["outputs"] = out_fixed or [
            {"id": "c", "name": "C", "expr": "A+B"},
            {"id": "d", "name": "D", "expr": "(-40+A)*B"},
        ]
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
        return {"active": "", "blueprints": [], "folds": {"nodes": True, "schemes": True, "orders": True}}
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
    folds_raw = raw.get("folds") if isinstance(raw.get("folds"), dict) else {}
    folds = {
        "nodes": False if folds_raw.get("nodes") is False else True,
        "schemes": False if folds_raw.get("schemes") is False else True,
        "orders": False if folds_raw.get("orders") is False else True,
    }
    return {"active": active, "blueprints": blueprints, "folds": folds}


def _snap10(value: int) -> int:
    return int(round(value / 10) * 10)


def _hex_color(value: Any, default: str = "") -> str:
    color = str(value or "").strip().lower()
    if len(color) == 7 and color.startswith("#") and all(ch in "0123456789abcdef" for ch in color[1:]):
        return color
    if len(color) == 4 and color.startswith("#") and all(ch in "0123456789abcdef" for ch in color[1:]):
        return "#" + "".join(ch * 2 for ch in color[1:])
    return default


def _float_in_range(value: Any, default: float, low: float, high: float) -> float:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return default
    if number != number:
        return default
    return max(low, min(high, number))


def _presentation_style(raw: Any) -> dict[str, Any]:
    s = raw if isinstance(raw, dict) else {}
    preset = str(s.get("preset") or "card")
    if preset not in PRES_STYLE_PRESETS:
        preset = "card"
    fill = str(s.get("fill") or "auto")
    if fill not in PRES_STYLE_FILLS:
        fill = "auto"
    align = str(s.get("align") or "start")
    if align not in PRES_STYLE_ALIGNS:
        align = "start"
    weight = str(s.get("weight") or "bold")
    if weight not in PRES_STYLE_WEIGHTS:
        weight = "bold"
    return {
        "preset": preset,
        "fill": fill,
        "bg": _hex_color(s.get("bg")),
        "bg2": _hex_color(s.get("bg2")),
        "fg": _hex_color(s.get("fg")),
        "muted": _hex_color(s.get("muted")),
        "accent": _hex_color(s.get("accent")),
        "border": _hex_color(s.get("border")),
        "borderW": _int_in_range(s.get("borderW"), -1, -1, 12),
        "radius": _int_in_range(s.get("radius"), -1, -1, 64),
        "shadow": _int_in_range(s.get("shadow"), -1, -1, 4),
        "align": align,
        "pad": _float_in_range(s.get("pad"), 1.0, 0.4, 2.4),
        "weight": weight,
        "label": bool(s.get("label", True)),
        "opacity": _float_in_range(s.get("opacity"), 1.0, 0.15, 1.0),
        "fs": _float_in_range(s.get("fs"), 1.0, 0.55, 2.2),
    }


def _presentation_block(raw: Any) -> dict[str, Any] | None:
    if not isinstance(raw, dict):
        return None
    block_id = _clip_text(raw.get("id"), 80)
    kind = str(raw.get("type") or "")
    if not block_id or kind not in PRES_BLOCK_TYPES:
        return None
    labels_raw = raw.get("labels") if isinstance(raw.get("labels"), dict) else {}
    labels = {
        "a": _clip_text(labels_raw.get("a"), 24, "A"),
        "b": _clip_text(labels_raw.get("b"), 24, "B"),
        "c": _clip_text(labels_raw.get("c"), 24, "C"),
        "d": _clip_text(labels_raw.get("d"), 24, "D"),
    }
    values_raw = raw.get("values") if isinstance(raw.get("values"), dict) else {}
    values: dict[str, float] = {}
    for key, item in values_raw.items():
        port = _clip_text(key, 24)
        if not port:
            continue
        try:
            number = float(item)
        except (TypeError, ValueError):
            continue
        if number != number:
            continue
        values[port] = number
    return {
        "id": block_id,
        "type": kind,
        "title": _clip_text(raw.get("title"), 64, kind),
        "text": _clip_text(raw.get("text"), 400),
        "x": _snap10(_int_in_range(raw.get("x"), 40, -8000, 8000)),
        "y": _snap10(_int_in_range(raw.get("y"), 40, -8000, 8000)),
        "w": max(80, _snap10(_int_in_range(raw.get("w"), 200, 40, 4000))),
        "h": max(40, _snap10(_int_in_range(raw.get("h"), 100, 24, 4000))),
        "z": _int_in_range(raw.get("z"), 1, 0, 9999),
        "labels": labels,
        "values": values,
        "style": _presentation_style(raw.get("style")),
    }


def _presentation_page(raw: Any, index: int) -> dict[str, Any] | None:
    if not isinstance(raw, dict):
        return None
    page_id = _clip_text(raw.get("id"), 80)
    if not page_id:
        return None
    blocks: list[dict[str, Any]] = []
    seen: set[str] = set()
    for item in raw.get("blocks") if isinstance(raw.get("blocks"), list) else []:
        block = _presentation_block(item)
        if not block or block["id"] in seen:
            continue
        seen.add(block["id"])
        blocks.append(block)
        if len(blocks) >= PRES_MAX_BLOCKS:
            break
    return {
        "id": page_id,
        "name": _clip_text(raw.get("name"), 48, f"Страница {index + 1}"),
        "w": max(400, _snap10(_int_in_range(raw.get("w"), 1200, 400, 8000))),
        "h": max(300, _snap10(_int_in_range(raw.get("h"), 800, 300, 8000))),
        "bg": _hex_color(raw.get("bg")),
        "showGrid": bool(raw.get("showGrid", False)),
        "blocks": blocks,
    }


def _presentation_ui(raw: Any) -> dict[str, Any]:
    if not isinstance(raw, dict):
        return {"active": "", "pages": [], "inspectorOpen": True, "canvasLocked": False}
    pages: list[dict[str, Any]] = []
    seen: set[str] = set()
    for i, item in enumerate(raw.get("pages") if isinstance(raw.get("pages"), list) else []):
        page = _presentation_page(item, i)
        if not page or page["id"] in seen:
            continue
        seen.add(page["id"])
        pages.append(page)
        if len(pages) >= PRES_MAX_PAGES:
            break
    active = _clip_text(raw.get("active"), 80)
    if active and active not in seen:
        active = pages[0]["id"] if pages else ""
    elif not active and pages:
        active = pages[0]["id"]
    return {
        "active": active,
        "pages": pages,
        "inspectorOpen": raw.get("inspectorOpen") is not False,
        "canvasLocked": bool(raw.get("canvasLocked")),
    }


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
        kind = str(item.get("kind") or "order").strip().lower()
        if kind not in {"order", "cost", "tax"}:
            kind = "order"
        tax_percent = _product_price(item.get("tax_percent")) if kind == "tax" else 0.0
    else:
        name = str(item or "").strip()
        unit = default_unit
        price = 0.0
        kind = "order"
        tax_percent = 0.0
    if not name:
        return None
    return {"name": name, "unit": unit, "price": price, "kind": kind, "tax_percent": tax_percent}


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
        "money_decimals": 2,
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
            "calculator": {"active": "", "blueprints": [], "folds": {"nodes": True, "schemes": True, "orders": True}},
            "presentation": {"active": "", "pages": [], "inspectorOpen": True, "canvasLocked": False},
        },
    }


def normalize_document(raw: Any) -> dict[str, Any]:
    if not isinstance(raw, dict):
        raise ValueError("Файл отчёта повреждён: ожидался объект JSON.")

    base = empty_document(str(raw.get("title") or "Отчёт"))
    base["version"] = SCHEMA_VERSION
    base["created_at"] = str(raw.get("created_at") or base["created_at"])
    base["modified_at"] = str(raw.get("modified_at") or now_iso())
    base["currency"] = str(raw.get("currency") or "₽").strip()[:8] or "₽"
    try:
        decimals = int(raw.get("money_decimals", 2))
    except (TypeError, ValueError):
        decimals = 2
    base["money_decimals"] = max(0, min(4, decimals))

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
            if not entry:
                continue
            key = (entry["kind"], entry["name"].casefold())
            if key in seen:
                continue
            seen.add(key)
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
                    harvested.append({"name": name, "unit": unit, "price": price, "kind": "order", "tax_percent": 0.0})
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
            "presentation": _presentation_ui(ui.get("presentation")),
        }
        if base["ui"]["cash_horizon"] not in CASH_HORIZONS:
            base["ui"]["cash_horizon"] = DEFAULT_CASH_HORIZON

    return base
