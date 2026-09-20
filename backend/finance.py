"""Расчёт сумм заказа — тот же смысл, что lineTotals / orderTotals на экране."""

from __future__ import annotations

import ast
import re
from typing import Any


def round2(n: Any) -> float:
    try:
        return round(float(n or 0) * 100) / 100
    except (TypeError, ValueError):
        return 0.0


def eval_expr(raw: Any) -> float:
    text = str(raw or "").strip().replace("×", "*").replace(",", ".")
    text = re.sub(r"(\d)\s*[xX]\s*(\d)", r"\1*\2", text)
    if not text:
        return 0.0
    if not re.fullmatch(r"[\d+\-*/().\s]+", text):
        return float("nan")
    try:
        tree = ast.parse(text, mode="eval")
        return float(_safe_eval(tree.body))
    except (SyntaxError, TypeError, ValueError, ZeroDivisionError, RecursionError):
        return float("nan")


def _safe_eval(node: ast.AST) -> float:
    if isinstance(node, ast.Constant) and isinstance(node.value, (int, float)):
        return float(node.value)
    if isinstance(node, ast.UnaryOp) and isinstance(node.op, (ast.UAdd, ast.USub)):
        value = _safe_eval(node.operand)
        return value if isinstance(node.op, ast.UAdd) else -value
    if isinstance(node, ast.BinOp) and isinstance(node.op, (ast.Add, ast.Sub, ast.Mult, ast.Div)):
        left = _safe_eval(node.left)
        right = _safe_eval(node.right)
        if isinstance(node.op, ast.Add):
            return left + right
        if isinstance(node.op, ast.Sub):
            return left - right
        if isinstance(node.op, ast.Mult):
            return left * right
        if right == 0:
            raise ZeroDivisionError
        return left / right
    raise ValueError("unsupported")


def num(value: Any) -> float:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return 0.0
    return number if number == number else 0.0


def num_expr(line: dict[str, Any], expr_key: str, num_key: str) -> float:
    raw = line.get(expr_key)
    source = raw if raw is not None and str(raw).strip() != "" else line.get(num_key)
    value = eval_expr(source)
    if value == value:
        return value
    return num(line.get(num_key))


def money(n: Any, currency: str = "₽") -> str:
    value = round2(n)
    sign = "-" if value < 0 else ""
    text = f"{abs(value):,.2f}".replace(",", " ").replace(".", ",")
    return f"{sign}{text} {currency}"


def num_text(n: Any) -> str:
    """Число для снимка: целое как есть, иначе ровно до сотых."""
    value = round2(n)
    if abs(value - round(value)) < 0.0005:
        return str(int(round(value)))
    return f"{value:.2f}".replace(".", ",")


def qty_text(line: dict[str, Any]) -> str:
    shown = num_text(num_expr(line, "qty_expr", "quantity"))
    unit = str(line.get("unit") or "").strip()
    return f"{shown} {unit}".strip() or "—"


def type_index(doc: dict[str, Any] | None) -> dict[str, str]:
    """Имя типа заказа -> «tax», «cost» или пустая строка для обычной выручки."""
    index: dict[str, str] = {}
    for item in (doc or {}).get("order_types") or []:
        if isinstance(item, dict):
            name = str(item.get("name") or "").strip()
            kind = "tax" if item.get("is_tax") else ("cost" if item.get("is_cost") else "")
        else:
            name = str(item or "").strip()
            kind = ""
        if name:
            index[name] = kind
    return index


def line_kind(line: dict[str, Any] | None, types: dict[str, str] | None = None) -> str:
    return str((types or {}).get(str((line or {}).get("order_type") or "").strip()) or "")


def is_frozen(line: dict[str, Any] | None) -> bool:
    return bool((line or {}).get("frozen"))


def is_expense(line: dict[str, Any] | None, types: dict[str, str] | None = None) -> bool:
    return bool(line_kind(line, types))


def tax_mode(line: dict[str, Any] | None) -> str:
    """«amount» — своя сумма, «gross» — процент от выручки, «net» — процент от выручки без затрат."""
    mode = str((line or {}).get("tax_mode") or "amount")
    return mode if mode in ("gross", "net") else "amount"


def order_tax_base(
    order: dict[str, Any] | None, mode: str, types: dict[str, str] | None = None
) -> float:
    """База процента налога. Считается по доходам и затратам, поэтому налог от налога не берётся."""
    gross = 0.0
    costs = 0.0
    for item in (order or {}).get("lines") or []:
        if not isinstance(item, dict) or is_frozen(item):
            continue
        kind = line_kind(item, types)
        if not kind:
            gross += float(line_totals(item, types)["after"])
        elif kind == "cost":
            costs += float(line_totals(item, types)["cost"])
    return round2(gross - costs if mode == "net" else gross)


def line_totals(
    line: dict[str, Any],
    types: dict[str, str] | None = None,
    order: dict[str, Any] | None = None,
) -> dict[str, Any]:
    qty = num_expr(line, "qty_expr", "quantity")
    price = max(0.0, num_expr(line, "price_expr", "price"))
    kind = line_kind(line, types)
    if kind:
        mode = tax_mode(line) if kind == "tax" else "amount"
        if mode != "amount":
            percent = max(0.0, num_expr(line, "tax_percent_expr", "tax_percent"))
            base = order_tax_base(order, mode, types)
            cost = round2(base * percent / 100)
        else:
            base = 0.0
            percent = 0.0
            cost = round2(qty * price)
        return {
            "qty": qty,
            "price": price,
            "discount": 0.0,
            "total": cost,
            "after": 0.0,
            "paid": 0.0,
            "unpaid": 0.0,
            "cost": cost,
            "kind": kind,
            "mode": mode,
            "percent": percent,
            "base": base,
        }
    discount = min(100.0, max(0.0, num_expr(line, "discount_expr", "discount")))
    total = round2(qty * price)
    after = round2(total * (1 - discount / 100))
    paid = max(0.0, num_expr(line, "paid_expr", "paid"))
    unpaid = round2(max(0.0, after - paid))
    return {
        "qty": qty,
        "price": price,
        "discount": discount,
        "total": total,
        "after": after,
        "paid": paid,
        "unpaid": unpaid,
        "cost": 0.0,
        "kind": "",
        "mode": "amount",
        "percent": 0.0,
        "base": 0.0,
    }


def lines_totals(
    lines: list[dict[str, Any]] | None,
    types: dict[str, str] | None = None,
    order: dict[str, Any] | None = None,
) -> dict[str, float]:
    acc = {"total": 0.0, "after": 0.0, "paid": 0.0, "unpaid": 0.0, "cost": 0.0}
    for line in lines or []:
        if is_frozen(line):
            continue
        tot = line_totals(line, types, order)
        if tot["kind"]:
            acc["cost"] += float(tot["cost"])
            continue
        for key in ("total", "after", "paid", "unpaid"):
            acc[key] += float(tot[key])
    acc["net"] = round2(acc["after"] - acc["cost"])
    return acc


def order_totals(order: dict[str, Any] | None, types: dict[str, str] | None = None) -> dict[str, float]:
    return lines_totals((order or {}).get("lines") or [], types, order)


def split_lines(
    lines: list[dict[str, Any]] | None, types: dict[str, str] | None = None
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    """Разделить позиции на доходные и расходные (налог / затрата)."""
    income: list[dict[str, Any]] = []
    expense: list[dict[str, Any]] = []
    for line in lines or []:
        if is_frozen(line):
            continue
        (expense if line_kind(line, types) else income).append(line)
    return income, expense


def customer_org(doc: dict[str, Any] | None, name: str) -> str:
    for item in (doc or {}).get("customers") or []:
        if isinstance(item, dict) and str(item.get("name") or "") == name:
            return str(item.get("organization") or "")
    return ""


def fmt_date(value: Any) -> str:
    if not value:
        return "—"
    text = str(value).replace("T", " ")
    return text[:10] if len(text) >= 10 else text


def order_stamp(order: dict[str, Any]) -> str:
    stamps = [str(order.get("created_at") or "")]
    for line in order.get("lines") or []:
        if isinstance(line, dict):
            stamps.append(str(line.get("order_date") or ""))
            stamps.append(str(line.get("payment_date") or ""))
    return max(stamps)


def html_esc(value: Any) -> str:
    return str(value or "").replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
