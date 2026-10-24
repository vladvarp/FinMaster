"""Снимок заказа: текст и PNG — те же поля, темы и итоги, что на компьютере."""

from __future__ import annotations

import io
from datetime import datetime, timezone
from typing import Any

from backend.finance import (
    customer_org,
    fmt_date,
    is_frozen,
    line_kind,
    line_totals,
    lines_totals,
    money,
    money_decimals,
    num_expr,
    num_text,
    qty_text,
    type_index,
)


FIELDS = [
    {"id": "number", "label": "Номер заказа", "kind": "meta"},
    {"id": "customer", "label": "Имя заказчика", "kind": "meta"},
    {"id": "organization", "label": "Организация", "kind": "meta"},
    {"id": "name", "label": "Название заказа", "kind": "meta"},
    {"id": "order_type", "label": "Тип / работа", "kind": "col"},
    {"id": "product", "label": "Продукт", "kind": "col"},
    {"id": "quantity", "label": "Количество", "kind": "col"},
    {"id": "order_date", "label": "Дата заказа", "kind": "col"},
    {"id": "status", "label": "Статус", "kind": "col"},
    {"id": "price", "label": "Цена", "kind": "col"},
    {"id": "discount", "label": "Скидка", "kind": "col"},
    {"id": "total", "label": "Сумма позиции", "kind": "col"},
    {"id": "paid", "label": "Оплачено", "kind": "col"},
    {"id": "unpaid", "label": "Не оплачено", "kind": "col"},
    {"id": "payment_date", "label": "Дата оплаты", "kind": "col"},
    {"id": "totals", "label": "Итоги заказа", "kind": "meta"},
    {"id": "expenses", "label": "Налоги и затраты", "kind": "meta"},
]
FIELD_IDS = [item["id"] for item in FIELDS]
FIELD_BY_ID = {item["id"]: item for item in FIELDS}

PRESETS = {
    "work": ["number", "name", "order_type", "product", "quantity", "status", "order_date"],
    "invoice": [
        "number",
        "customer",
        "organization",
        "name",
        "order_type",
        "product",
        "quantity",
        "price",
        "discount",
        "total",
        "paid",
        "unpaid",
        "totals",
    ],
    "short": ["number", "customer", "product", "quantity", "total", "totals"],
    "full": list(FIELD_IDS),
}
PRESET_LABELS = {
    "work": "Для работы",
    "invoice": "Как счёт",
    "short": "Коротко",
    "full": "Все поля",
}

THEMES = {
    "teal": {
        "label": "Изумруд",
        "head": ["#0f766e", "#115e59"],
        "headInk": "#ffffff",
        "accent": "#0f766e",
        "bg": "#ffffff",
        "ink": "#0f172a",
        "meta": "#334155",
        "line": "#e2e8f0",
        "thBg": "#f8fafc",
        "thInk": "#64748b",
        "zebra": "#f8fafc",
        "footBg": "#f1f5f9",
        "note": "#94a3b8",
    },
    "graphite": {
        "label": "Графит",
        "head": ["#1e293b", "#0f172a"],
        "headInk": "#ffffff",
        "accent": "#334155",
        "bg": "#ffffff",
        "ink": "#0f172a",
        "meta": "#334155",
        "line": "#e2e8f0",
        "thBg": "#f8fafc",
        "thInk": "#64748b",
        "zebra": "#f8fafc",
        "footBg": "#f1f5f9",
        "note": "#94a3b8",
    },
    "indigo": {
        "label": "Индиго",
        "head": ["#4f46e5", "#3730a3"],
        "headInk": "#ffffff",
        "accent": "#4f46e5",
        "bg": "#ffffff",
        "ink": "#111827",
        "meta": "#3f3f5a",
        "line": "#e4e7f5",
        "thBg": "#f5f6fd",
        "thInk": "#6366f1",
        "zebra": "#f9f9fe",
        "footBg": "#eef0fc",
        "note": "#a5b4fc",
    },
    "gold": {
        "label": "Золото",
        "head": ["#c9a227", "#8a6d0f"],
        "headInk": "#ffffff",
        "accent": "#c9a227",
        "bg": "#fffdf6",
        "ink": "#1c1917",
        "meta": "#44403c",
        "line": "#ece3cd",
        "thBg": "#faf5e6",
        "thInk": "#a16207",
        "zebra": "#fdfaf0",
        "footBg": "#f7efdc",
        "note": "#b8a67a",
    },
    "rose": {
        "label": "Вишня",
        "head": ["#be123c", "#881337"],
        "headInk": "#ffffff",
        "accent": "#be123c",
        "bg": "#ffffff",
        "ink": "#18181b",
        "meta": "#3f3f46",
        "line": "#f0dde2",
        "thBg": "#fdf2f5",
        "thInk": "#9f1239",
        "zebra": "#fdf8f9",
        "footBg": "#fbe8ed",
        "note": "#d4a4b3",
    },
    "mono": {
        "label": "Минимал",
        "head": ["#ffffff", "#ffffff"],
        "headInk": "#0f172a",
        "headLine": True,
        "accent": "#0f172a",
        "bg": "#ffffff",
        "ink": "#0f172a",
        "meta": "#475569",
        "line": "#e2e8f0",
        "thBg": "#ffffff",
        "thInk": "#94a3b8",
        "zebra": "#fafafa",
        "footBg": "#f8fafc",
        "note": "#94a3b8",
    },
    "night": {
        "label": "Ночь",
        "head": ["#1e293b", "#0b1220"],
        "headInk": "#ffffff",
        "accent": "#2dd4bf",
        "bg": "#0f172a",
        "ink": "#e7eef8",
        "meta": "#cbd5e1",
        "line": "#25324a",
        "thBg": "#16233b",
        "thInk": "#94a3b8",
        "zebra": "#131f36",
        "footBg": "#16233b",
        "note": "#64748b",
    },
}

MONEY_COLS = {"total", "paid", "unpaid"}

PDF_DEFAULTS = {
    "orient": "portrait",
    "margin": "normal",
    "headerEach": True,
    "pageNums": True,
    "crop": False,
    "orderTitles": False,
    "tableAlign": "stretch",
    "numAlign": "right",
    "headAlign": "auto",
    "grand": True,
    "font": "segoe",
    "scale": 100,
    "density": "normal",
    "zebra": True,
    "grid": False,
    "bold": True,
}
PDF_MARGINS = {"narrow": 22, "normal": 36, "wide": 56}


def normalize_pdf_opts(raw: Any = None) -> dict[str, Any]:
    src = raw if isinstance(raw, dict) else {}
    out: dict[str, Any] = {}
    for key, default in PDF_DEFAULTS.items():
        value = src.get(key, default)
        if isinstance(default, bool):
            out[key] = bool(value)
        elif key == "orient":
            out[key] = "landscape" if str(value) == "landscape" else "portrait"
        elif key == "margin":
            out[key] = str(value) if str(value) in PDF_MARGINS else "normal"
        elif key == "scale":
            try:
                out[key] = max(60, min(200, int(value)))
            except (TypeError, ValueError):
                out[key] = 100
        elif key in {"tableAlign", "numAlign", "headAlign", "font", "density"}:
            out[key] = str(value or default)
        else:
            out[key] = value if value is not None else default
    return out


def normalize_fields(fields: Any) -> list[str]:
    ids = [str(item) for item in (fields or []) if str(item) in FIELD_BY_ID]
    return ids or list(PRESETS["invoice"])


_PRICE_FIELDS = {"price", "discount", "total", "paid", "unpaid", "totals"}


def without_prices(fields: list[str]) -> list[str]:
    """Снимок без цен: колонки сумм и строка итога не попадают в таблицу."""
    kept = [item for item in normalize_fields(fields) if item not in _PRICE_FIELDS]
    if not any(FIELD_BY_ID[item]["kind"] == "col" for item in kept):
        for item in ("product", "quantity"):
            if item not in kept:
                kept.append(item)
    return kept


def theme_key(name: str) -> str:
    return name if name in THEMES else "teal"


def line_value(
    line: dict[str, Any],
    field_id: str,
    currency: str,
    types: dict[str, str] | None = None,
    order: dict[str, Any] | None = None,
    decimals: int = 2,
) -> str:
    tot = line_totals(line, types, order)
    if tot["kind"]:
        # Расход в снимке — название, объём и сумма с минусом; скидок и оплат у него нет.
        if field_id == "order_type":
            label = "налог" if tot["kind"] == "tax" else "затрата"
            return f"{line.get('order_type') or '—'} · {label}"
        if field_id == "product":
            return str(line.get("product") or "—")
        if field_id == "quantity":
            return qty_text(line) if tot["mode"] == "amount" else f"{num_text(tot['percent'])} %"
        if field_id == "price":
            return (
                money(num_expr(line, "price_expr", "price"), currency, decimals)
                if tot["mode"] == "amount"
                else money(tot["base"], currency, decimals)
            )
        if field_id == "total":
            return f"−{money(tot['cost'], currency, decimals)}"
        if field_id == "order_date":
            return fmt_date(line.get("order_date"))
        return "—"
    if field_id == "order_type":
        return str(line.get("order_type") or "—")
    if field_id == "product":
        return str(line.get("product") or "—")
    if field_id == "quantity":
        return qty_text(line)
    if field_id == "price":
        return money(num_expr(line, "price_expr", "price"), currency, decimals)
    if field_id == "discount":
        return f"{num_text(num_expr(line, 'discount_expr', 'discount'))} %"
    if field_id == "total":
        return money(tot["after"], currency, decimals)
    if field_id == "paid":
        return money(tot["paid"], currency, decimals)
    if field_id == "unpaid":
        return money(tot["unpaid"], currency, decimals)
    if field_id == "order_date":
        return fmt_date(line.get("order_date"))
    if field_id == "payment_date":
        return fmt_date(line.get("payment_date"))
    if field_id == "status":
        return str(line.get("status") or "—")
    return "—"


def meta_items(order: dict[str, Any], doc: dict[str, Any], fields: list[str], hide_labels: bool) -> list[str]:
    pairs: list[tuple[str, str]] = []
    if "number" in fields:
        pairs.append(("Номер", str(order.get("number") or "—")))
    if "name" in fields:
        pairs.append(("Заказ", str(order.get("name") or "—")))
    if "customer" in fields:
        pairs.append(("Заказчик", str(order.get("customer") or "—")))
    if "organization" in fields:
        pairs.append(("Организация", customer_org(doc, str(order.get("customer") or "")) or "—"))
    out: list[str] = []
    for label, value in pairs:
        if hide_labels:
            out.append(value)
        else:
            out.append(f"{label}: {value}")
    return out


def cols_of(fields: list[str]) -> list[dict[str, str]]:
    return [item for item in FIELDS if item["kind"] == "col" and item["id"] in fields]


def needs_money_footer(cols: list[dict[str, str]]) -> bool:
    return any(item["id"] in MONEY_COLS for item in cols)


def footer_cells(
    cols: list[dict[str, str]],
    lines: list[dict[str, Any]],
    currency: str,
    types: dict[str, str] | None = None,
    order: dict[str, Any] | None = None,
    decimals: int = 2,
    hide_totals: bool = False,
) -> list[str] | None:
    if hide_totals or not needs_money_footer(cols):
        return None
    tot = lines_totals(lines, types, order)
    cells: list[str] = []
    for col in cols:
        if col["id"] == "total":
            cells.append(money(tot["net"] if tot["cost"] > 0.005 else tot["after"], currency, decimals))
        elif col["id"] == "paid":
            cells.append(money(tot["paid"], currency, decimals))
        elif col["id"] == "unpaid":
            cells.append(money(tot["unpaid"], currency, decimals))
        else:
            cells.append("")
    return cells


def totals_text(
    fields: list[str],
    cols: list[dict[str, str]],
    lines: list[dict[str, Any]],
    currency: str,
    types: dict[str, str] | None = None,
    order: dict[str, Any] | None = None,
    decimals: int = 2,
    hide_totals: bool = False,
) -> str:
    if hide_totals or "totals" not in fields or needs_money_footer(cols):
        return ""
    tot = lines_totals(lines, types, order)
    bits: list[str] = []
    if "total" in fields or "price" in fields or not cols:
        bits.append(f"Итого {money(tot['after'], currency, decimals)}")
    if tot["cost"] > 0.005:
        bits.append(f"расходы −{money(tot['cost'], currency, decimals)}")
        bits.append(f"к оплате {money(tot['net'], currency, decimals)}")
    if "paid" in fields:
        bits.append(f"оплачено {money(tot['paid'], currency, decimals)}")
    if "unpaid" in fields:
        bits.append(f"остаток {money(tot['unpaid'], currency, decimals)}")
    return " · ".join(bits) if bits else f"Позиций: {len(lines)}"


def income_blocks(
    doc: dict[str, Any], blocks: list[dict[str, Any]], fields: list[str] | None = None
) -> list[dict[str, Any]]:
    """Живые позиции для заказчика; расходы — только при поле «Налоги и затраты»."""
    types = type_index(doc)
    with_expenses = fields is not None and "expenses" in fields
    out: list[dict[str, Any]] = []
    for block in blocks or []:
        lines = [
            line
            for line in block.get("lines") or []
            if isinstance(line, dict) and not is_frozen(line) and (with_expenses or not line_kind(line, types))
        ]
        if lines:
            out.append({**block, "lines": lines})
    return out


def order_caption(order: dict[str, Any]) -> str:
    number = str(order.get("number") or "").strip()
    name = str(order.get("name") or "").strip()
    if number and name:
        return f"{number} · {name}"
    return number or name or "Заказ"


def default_title(blocks: list[dict[str, Any]], custom: str = "") -> str:
    typed = str(custom or "").strip()
    if typed:
        return typed
    if not blocks:
        return "Снимок заказа"
    if len(blocks) == 1:
        return order_caption(blocks[0]["order"])
    labels = [order_caption(block["order"]) for block in blocks]
    if len(labels) <= 3:
        return "; ".join(labels)
    return "; ".join(labels[:3]) + f" и ещё {len(labels) - 3}"


def stamp_text() -> str:
    now = datetime.now(timezone.utc).astimezone()
    return f"Сформировано {now.strftime('%d.%m.%Y, %H:%M:%S')}"


def _vis_len(text: str) -> int:
    return len(text)


def _pad(text: str, width: int) -> str:
    extra = max(0, width - _vis_len(text))
    return text + (" " * extra)


def render_text(
    doc: dict[str, Any],
    blocks: list[dict[str, Any]],
    fields: list[str],
    hide_labels: bool = False,
    hide_stamp: bool = False,
    title: str = "",
    hide_totals: bool = False,
) -> str:
    fields = normalize_fields(fields)
    blocks = income_blocks(doc, blocks, fields)
    if not blocks:
        raise ValueError("Выберите заказы и строки для снимка")
    currency = str(doc.get("currency") or "₽")
    decimals = money_decimals(doc.get("money_decimals"))
    types = type_index(doc)
    cols = cols_of(fields)
    out = [default_title(blocks, title)]
    for index, block in enumerate(blocks):
        if index:
            out.append("")
        order = block["order"]
        lines = block["lines"]
        meta = meta_items(order, doc, fields, hide_labels)
        if len(blocks) > 1:
            out.append("")
            out.append(order_caption(order))
        if meta:
            out.append("")
            out.extend(meta)
        if cols:
            foot = footer_cells(cols, lines, currency, types, block["order"], decimals, hide_totals)
            rows = [ [col["label"] for col in cols] ]
            rows.extend(
                [
                    [line_value(line, col["id"], currency, types, block["order"], decimals) or "—" for col in cols]
                    for line in lines
                ]
            )
            if foot and any(foot):
                rows.append([cell or "" for cell in foot])
            widths = [max(1, max(_vis_len(row[i]) for row in rows)) for i in range(len(cols))]
            out.append("")
            for row_i, row in enumerate(rows):
                out.append("  ".join(_pad(row[i], widths[i]) for i in range(len(cols))))
                if row_i == 0:
                    out.append("  ".join("─" * widths[i] for i in range(len(cols))))
        totals = totals_text(fields, cols, lines, currency, types, block["order"], decimals, hide_totals)
        if totals:
            out.append("")
            out.append(totals)
    if not hide_stamp:
        out.append("")
        out.append(stamp_text())
    return "\n".join(out).strip() + "\n"


def _hex(color: str) -> tuple[int, int, int]:
    raw = color.lstrip("#")
    return int(raw[0:2], 16), int(raw[2:4], 16), int(raw[4:6], 16)


def _fonts() -> tuple[Any, Any, Any, Any]:
    from PIL import ImageFont

    regular = bold = None
    for path, kind in (
        (r"C:\Windows\Fonts\segoeui.ttf", "regular"),
        (r"C:\Windows\Fonts\segoeuib.ttf", "bold"),
        ("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf", "regular"),
        ("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", "bold"),
    ):
        try:
            font = ImageFont.truetype(path, 13)
        except OSError:
            continue
        if kind == "regular" and regular is None:
            regular = path
        if kind == "bold" and bold is None:
            bold = path
    try:
        body = ImageFont.truetype(regular, 13) if regular else ImageFont.load_default()
        head = ImageFont.truetype(bold or regular, 20) if (bold or regular) else ImageFont.load_default()
        th = ImageFont.truetype(bold or regular, 11) if (bold or regular) else ImageFont.load_default()
        strong = ImageFont.truetype(bold or regular, 13) if (bold or regular) else ImageFont.load_default()
        return head, body, th, strong
    except OSError:
        fallback = ImageFont.load_default()
        return fallback, fallback, fallback, fallback


def _text_w(font: Any, text: str) -> float:
    if hasattr(font, "getlength"):
        return float(font.getlength(text))
    box = font.getbbox(text)
    return float(box[2] - box[0])


def _fit(font: Any, text: str, width: float) -> str:
    if _text_w(font, text) <= width:
        return text
    cut = text
    while cut and _text_w(font, cut + "…") > width:
        cut = cut[:-1]
    return (cut + "…") if cut else "…"


def render_png(
    doc: dict[str, Any],
    blocks: list[dict[str, Any]],
    fields: list[str],
    theme_name: str = "teal",
    hide_labels: bool = False,
    hide_stamp: bool = False,
    title: str = "",
    hide_totals: bool = False,
) -> bytes:
    try:
        from PIL import Image, ImageDraw
    except ImportError as exc:
        raise RuntimeError("Для картинки нужна библиотека Pillow. Перезапустите FinMaster — она установится сама.") from exc
    fields = normalize_fields(fields)
    blocks = income_blocks(doc, blocks, fields)
    if not blocks:
        raise ValueError("Выберите заказы и строки для снимка")
    currency = str(doc.get("currency") or "₽")
    decimals = money_decimals(doc.get("money_decimals"))
    types = type_index(doc)
    cols = cols_of(fields)
    theme = THEMES[theme_key(theme_name)]
    heading = default_title(blocks, title)
    stamp = stamp_text()
    head_font, body_font, th_font, strong_font = _fonts()
    pad = 20
    row_h = 34
    header_h = 64

    def col_widths(lines: list[dict[str, Any]], order: dict[str, Any] | None = None) -> list[int]:
        widths: list[int] = []
        foot = footer_cells(cols, lines, currency, types, order, decimals, hide_totals)
        for index, col in enumerate(cols):
            width = _text_w(th_font, col["label"].upper())
            for line in lines:
                width = max(width, _text_w(body_font, line_value(line, col["id"], currency, types, order, decimals) or "—"))
            if foot:
                width = max(width, _text_w(strong_font, foot[index] or ""))
            widths.append(max(52, int(width + 24)))
        return widths

    layouts = []
    inner = _text_w(head_font, heading)
    for block in blocks:
        widths = col_widths(block["lines"], block["order"]) if cols else []
        table_w = sum(widths)
        layouts.append({**block, "widths": widths, "table_w": table_w})
        inner = max(inner, table_w)
        if len(blocks) > 1:
            inner = max(inner, _text_w(strong_font, order_caption(block["order"])))
        for line in meta_items(block["order"], doc, fields, hide_labels):
            inner = max(inner, _text_w(body_font, line))
        totals = totals_text(fields, cols, block["lines"], currency, types, block["order"], decimals, hide_totals)
        if totals:
            inner = max(inner, _text_w(strong_font, totals))
    if not hide_stamp:
        inner = max(inner, _text_w(th_font, stamp))
    width = min(1600, max(80, int(pad * 2 + inner)))
    body_h = 16
    for index, block in enumerate(layouts):
        meta = meta_items(block["order"], doc, fields, hide_labels)
        foot = footer_cells(cols, block["lines"], currency, types, block["order"], decimals, hide_totals)
        body_h += (36 if index else 0)
        body_h += 28 if len(layouts) > 1 else 0
        body_h += (len(meta) * 22 + 10) if meta else 0
        body_h += (32 + len(block["lines"]) * row_h + (row_h if foot else 0)) if cols else 28
        body_h += 36 if totals_text(fields, cols, block["lines"], currency, types, block["order"], decimals, hide_totals) else 0
        body_h += 16
    height = header_h + body_h + (16 if hide_stamp else 36)
    image = Image.new("RGB", (width, height), _hex(theme["bg"]))
    draw = ImageDraw.Draw(image)

    def fill(x: float, y: float, w: float, h: float, color: str) -> None:
        draw.rectangle([x, y, x + w, y + h], fill=_hex(color))

    def line(x1: float, y1: float, x2: float, y2: float, color: str, thick: float = 1) -> None:
        draw.line([(x1, y1), (x2, y2)], fill=_hex(color), width=max(1, int(thick)))

    def text(x: float, y: float, value: str, font: Any, color: str) -> None:
        draw.text((x, y), value, font=font, fill=_hex(color))

    start, end = _hex(theme["head"][0]), _hex(theme["head"][1])
    for x in range(width):
        t = x / max(1, width - 1)
        color = tuple(int(start[i] + (end[i] - start[i]) * t) for i in range(3))
        draw.line([(x, 0), (x, header_h)], fill=color)
    if theme.get("headLine"):
        line(0, header_h - 1, width, header_h - 1, theme["accent"], 2)
    text(pad, 24, heading, head_font, theme["headInk"])

    y = header_h + 16
    for index, block in enumerate(layouts):
        if index:
            y += 16
            line(pad, y, width - pad, y, theme["accent"], 2)
            y += 20
        if len(layouts) > 1:
            text(pad, y, order_caption(block["order"]), strong_font, theme["ink"])
            y += 28
        meta = meta_items(block["order"], doc, fields, hide_labels)
        for item in meta:
            text(pad, y, item, body_font, theme["meta"])
            y += 22
        if meta:
            y += 10
        if cols:
            xs: list[int] = []
            cursor = pad
            for w in block["widths"]:
                xs.append(cursor)
                cursor += w
            table_w = block["table_w"]
            fill(pad, y, table_w, 32, theme["thBg"])
            for i, col in enumerate(cols):
                label = _fit(th_font, col["label"].upper(), block["widths"][i] - 12)
                text(xs[i] + 8, y + 8, label, th_font, theme["thInk"])
            y += 32
            for row_i, row in enumerate(block["lines"]):
                if row_i % 2:
                    fill(pad, y, table_w, row_h, theme["zebra"])
                line(pad, y, pad + table_w, y, theme["line"])
                for i, col in enumerate(cols):
                    cell = _fit(
                        body_font,
                        line_value(row, col["id"], currency, types, block["order"], decimals) or "—",
                        block["widths"][i] - 12,
                    )
                    text(xs[i] + 8, y + 8, cell, body_font, theme["ink"])
                y += row_h
            foot = footer_cells(cols, block["lines"], currency, types, block["order"], decimals, hide_totals)
            if foot:
                fill(pad, y, table_w, row_h, theme["footBg"])
                line(pad, y, pad + table_w, y, theme["accent"])
                for i, cell in enumerate(foot):
                    if not cell:
                        continue
                    text(xs[i] + 8, y + 8, _fit(strong_font, cell, block["widths"][i] - 12), strong_font, theme["ink"])
                y += row_h
        totals = totals_text(fields, cols, block["lines"], currency, types, block["order"], decimals, hide_totals)
        if totals:
            y += 14
            text(pad, y, totals, strong_font, theme["ink"])
            y += 22
        y += 16
    if not hide_stamp:
        text(pad, height - 22, stamp, th_font, theme["note"])

    image = image.resize((width * 2, height * 2), Image.Resampling.LANCZOS)
    buf = io.BytesIO()
    image.save(buf, format="PNG")
    return buf.getvalue()


def render_pdf(
    doc: dict[str, Any],
    blocks: list[dict[str, Any]],
    fields: list[str],
    theme_name: str = "teal",
    hide_labels: bool = False,
    hide_stamp: bool = False,
    title: str = "",
    opts: dict[str, Any] | None = None,
    hide_totals: bool = False,
) -> bytes:
    """PDF по снимку: учитывает шаблон (ориентация, поля, масштаб, обрезка)."""
    png = render_png(doc, blocks, fields, theme_name, hide_labels, hide_stamp, title, hide_totals)
    try:
        from PIL import Image
    except ImportError as exc:
        raise RuntimeError("Для PDF нужна библиотека Pillow. Перезапустите FinMaster — она установится сама.") from exc
    image = Image.open(io.BytesIO(png)).convert("RGB")
    cfg = normalize_pdf_opts(opts)
    dpi = 150.0
    if cfg.get("crop"):
        buf = io.BytesIO()
        image.save(buf, format="PDF", resolution=dpi)
        return buf.getvalue()

    portrait = cfg.get("orient") != "landscape"
    page_w_pt = 595.28 if portrait else 841.89
    page_h_pt = 841.89 if portrait else 595.28
    page_w = max(1, int(round(page_w_pt * dpi / 72.0)))
    page_h = max(1, int(round(page_h_pt * dpi / 72.0)))
    margin_pt = PDF_MARGINS.get(str(cfg.get("margin") or "normal"), 36)
    margin = max(0, int(round(margin_pt * dpi / 72.0)))
    scale = max(0.6, min(2.0, float(cfg.get("scale") or 100) / 100.0))
    avail_w = max(1, page_w - margin * 2)
    avail_h = max(1, page_h - margin * 2)
    fit = min(avail_w / image.width, avail_h / image.height) * scale
    fit = min(fit, 4.0)
    new_w = max(1, int(round(image.width * fit)))
    new_h = max(1, int(round(image.height * fit)))
    if new_w > avail_w or new_h > avail_h:
        shrink = min(avail_w / new_w, avail_h / new_h)
        new_w = max(1, int(round(new_w * shrink)))
        new_h = max(1, int(round(new_h * shrink)))
    resized = image.resize((new_w, new_h), Image.Resampling.LANCZOS)
    page = Image.new("RGB", (page_w, page_h), (255, 255, 255))
    page.paste(resized, (margin + (avail_w - new_w) // 2, margin + (avail_h - new_h) // 2))
    buf = io.BytesIO()
    page.save(buf, format="PDF", resolution=dpi)
    return buf.getvalue()
