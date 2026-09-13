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


def qty_text(line: dict[str, Any]) -> str:
    qty = num_expr(line, "qty_expr", "quantity")
    if abs(qty - round(qty)) < 0.0005:
        shown = str(int(round(qty)))
    else:
        shown = f"{qty:.3f}".replace(".", ",").rstrip("0").rstrip(",")
    unit = str(line.get("unit") or "").strip()
    return f"{shown} {unit}".strip() or "—"


def line_totals(line: dict[str, Any]) -> dict[str, float]:
    qty = num_expr(line, "qty_expr", "quantity")
    price = max(0.0, num_expr(line, "price_expr", "price"))
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
    }


def lines_totals(lines: list[dict[str, Any]] | None) -> dict[str, float]:
    acc = {"total": 0.0, "after": 0.0, "paid": 0.0, "unpaid": 0.0}
    for line in lines or []:
        tot = line_totals(line)
        for key in acc:
            acc[key] += tot[key]
    return acc


def order_totals(order: dict[str, Any] | None) -> dict[str, float]:
    return lines_totals((order or {}).get("lines") or [])


def customer_org(doc: dict[str, Any] | None, name: str) -> str:
    for item in (doc or {}).get("customers") or []:
        if isinstance(item, dict) and str(item.get("name") or "") == name:
            return str(item.get("organization") or "")
    return ""


def fmt_date(value: Any) -> str:
    if not value:
        return "—"
    return str(value).replace("T", " ")[:16]


def order_stamp(order: dict[str, Any]) -> str:
    stamps = [str(order.get("created_at") or "")]
    for line in order.get("lines") or []:
        if isinstance(line, dict):
            stamps.append(str(line.get("order_date") or ""))
            stamps.append(str(line.get("payment_date") or ""))
    return max(stamps)


def html_esc(value: Any) -> str:
    return str(value or "").replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
