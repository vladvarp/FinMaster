"""Словарь запросов: один файл dictionary.fmwb в папке настроек.

Его читают разбор просьбы, бот и окно «Словари». В config.json и в отчёт он не пишется.
"""

from __future__ import annotations

import json
import os
import re
import secrets
from typing import Any

from backend import snapshot as snapmod
from backend import storage
from backend.finance import html_esc

KIND = "finmaster-dictionary"
VERSION = 1
FILE_NAME = "dictionary.fmwb"

_DEBT_PICKS = (
    ("customer", "Заказчик"),
    ("number", "Номер заказа"),
    ("name", "Название заказа"),
    ("product", "Продукт"),
    ("quantity", "Количество"),
    ("due", "Срок"),
    ("mark", "Просрочка"),
    ("amount", "Сумма"),
)
SLICE_PICKS = {
    "debt": _DEBT_PICKS,
    "overdue": _DEBT_PICKS,
    "incoming": _DEBT_PICKS,
    "work": (
        ("number", "Номер заказа"),
        ("name", "Название заказа"),
        ("customer", "Заказчик"),
        ("start", "Начало"),
        ("end", "Конец"),
        ("state", "Состояние"),
    ),
    "notes": (
        ("number", "Номер заказа"),
        ("name", "Название заказа"),
        ("note", "Заметка заказа"),
        ("product", "Продукт"),
        ("comment", "Комментарий"),
    ),
    "customers": (
        ("customer", "Заказчик"),
        ("organization", "Организация"),
        ("phone", "Телефон"),
        ("amount", "Долг"),
    ),
    "products": (
        ("product", "Продукт"),
        ("quantity", "Количество"),
        ("amount", "Сумма"),
    ),
    "expense": (
        ("number", "Номер заказа"),
        ("name", "Название заказа"),
        ("product", "Продукт"),
        ("kind", "Вид"),
        ("amount", "Сумма"),
    ),
    "frozen": (
        ("number", "Номер заказа"),
        ("name", "Название заказа"),
        ("customer", "Заказчик"),
        ("product", "Продукт"),
    ),
    "discount": (
        ("number", "Номер заказа"),
        ("name", "Название заказа"),
        ("product", "Продукт"),
        ("percent", "Скидка"),
        ("amount", "Сумма"),
    ),
    "status": (
        ("number", "Номер заказа"),
        ("name", "Название заказа"),
        ("product", "Продукт"),
        ("amount", "Сумма"),
    ),
    "remind": (
        ("number", "Номер заказа"),
        ("name", "Название заказа"),
        ("customer", "Заказчик"),
        ("amount", "Остаток"),
        ("due", "Срок"),
    ),
    "vault": (
        ("type", "Тип"),
        ("name", "Название"),
        ("amount", "Сумма"),
        ("date", "Дата"),
        ("page", "Страница"),
    ),
}
# Итоги шапки страницы. В ответ попадают только отмеченные в карточке среза.
VAULT_STATS = (
    ("hand", "На руках"),
    ("save", "В копилке"),
    ("inc", "Пополнено"),
    ("out", "Потрачено"),
    ("goal", "Цель"),
)
# Свои тумблеры ответа. Пустой набор в карточке прячет эти части, отсутствие ключа — всё включено.
SLICE_TOGGLES = {
    "summary": (
        ("count", "Заказы и позиции"),
        ("money", "К оплате, оплачено, долг"),
        ("cost", "Расходы и чистыми"),
        ("avg", "Средний чек и собираемость"),
        ("month", "Этот месяц и прошлый"),
        ("forecast", "Прогноз месяца"),
        ("term", "Срок оплаты"),
    ),
    "count": (
        ("orders", "Заказы"),
        ("lines", "Позиции"),
        ("due", "К оплате"),
        ("paid", "Оплачено"),
        ("debt", "Долг"),
        ("cost", "Расходы"),
        ("net", "Чистыми"),
    ),
    "rank": (
        ("customers", "Заказчики"),
        ("orders", "Заказы"),
    ),
    "debt": (
        ("total", "Дебиторка"),
        ("late", "Просрочено"),
        ("term", "Срок"),
        ("buckets", "Корзины просрочки"),
        ("customer", "Заказчик"),
        ("order", "Заказ"),
        ("product", "Продукт"),
        ("qty", "Количество"),
        ("due", "Дата срока"),
        ("mark", "Отметка срока"),
        ("amount", "Сумма"),
    ),
    "overdue": (
        ("late", "Просрочено"),
        ("term", "Срок"),
        ("buckets", "Корзины просрочки"),
        ("customer", "Заказчик"),
        ("order", "Заказ"),
        ("product", "Продукт"),
        ("qty", "Количество"),
        ("due", "Дата срока"),
        ("mark", "Отметка срока"),
        ("amount", "Сумма"),
    ),
    "incoming": (
        ("total", "Сумма ожидаемых"),
        ("term", "Срок"),
        ("customer", "Заказчик"),
        ("order", "Заказ"),
        ("product", "Продукт"),
        ("qty", "Количество"),
        ("due", "Дата срока"),
        ("mark", "Отметка срока"),
        ("amount", "Сумма"),
    ),
    "orders": (
        ("head", "Шапка заказа"),
        ("money", "Итоги заказа"),
        ("note", "Заметка заказа"),
        ("product", "Продукт"),
        ("qty", "Количество"),
        ("amount", "Сумма"),
        ("debt", "Долг"),
        ("date", "Дата"),
        ("status", "Статус"),
        ("comment", "Комментарий"),
        ("expense", "Налоги и затраты"),
    ),
    "lines": (
        ("order", "Заказ"),
        ("product", "Продукт"),
        ("qty", "Количество"),
        ("amount", "Сумма"),
        ("debt", "Долг"),
        ("date", "Дата"),
        ("status", "Статус"),
        ("comment", "Комментарий"),
        ("expense", "Налоги и затраты"),
    ),
    "work": (
        ("now", "В работе"),
        ("planned", "План"),
        ("done", "Закрыто"),
        ("nodate", "Без дат"),
        ("customer", "Заказчик"),
        ("start", "Начало"),
        ("end", "Конец"),
    ),
    "customers": (
        ("debt", "Долг"),
        ("orders", "Число заказов"),
        ("organization", "Организация"),
        ("phone", "Телефон"),
        ("email", "Почта"),
        ("address", "Адрес"),
    ),
    "products": (
        ("amount", "Сумма"),
        ("paid", "Оплачено"),
        ("debt", "Долг"),
    ),
    "expense": (
        ("total", "Итог"),
        ("order", "Заказ"),
        ("product", "Продукт"),
        ("kind", "Вид"),
        ("amount", "Сумма"),
    ),
    "notes": (
        ("order", "Заметка заказа"),
        ("comment", "Комментарий позиции"),
    ),
    "frozen": (
        ("order", "Заказ"),
        ("product", "Продукт"),
        ("customer", "Заказчик"),
    ),
    "discount": (
        ("order", "Заказ"),
        ("product", "Продукт"),
        ("percent", "Скидка"),
        ("amount", "Сумма"),
    ),
    "status": (
        ("count", "Число позиций"),
        ("amount", "Сумма"),
        ("debt", "Долг"),
    ),
    "remind": (
        ("hello", "Обращение"),
        ("due", "Срок и просрочка"),
        ("product", "Позиции"),
        ("total", "Итого"),
        ("term", "Срок оплаты"),
    ),
}
# Какие строки среза можно снять. Третье поле — включено, пока набор не сохранён.
SLICE_RULES = {
    "debt": (
        ("open", "Срок ещё не вышел", True),
        ("late", "Просроченные", True),
        ("nodue", "Без срока", True),
        ("cancelled", "Отменённые", False),
    ),
    "overdue": (
        ("d7", "1–7 дней", True),
        ("d30", "8–30 дней", True),
        ("d60", "31–60 дней", True),
        ("d60p", "Дольше 60 дней", True),
    ),
    "incoming": (
        ("ahead", "Срок впереди", True),
        ("due", "Ожидается сегодня", True),
    ),
    "orders": (
        ("debt", "С долгом", True),
        ("clear", "Без долга", True),
    ),
    "lines": (
        ("debt", "С долгом", True),
        ("clear", "Без долга", True),
    ),
    "customers": (
        ("debt", "С долгом", True),
        ("clear", "Без долга", True),
    ),
    "products": (
        ("debt", "С долгом", True),
        ("clear", "Без суммы", True),
    ),
    "expense": (
        ("tax", "Налоги", True),
        ("cost", "Затраты", True),
    ),
    "status": (
        ("named", "Со статусом", True),
        ("empty", "Без статуса", True),
    ),
    "vault": (
        ("in", "Пополнения", True),
        ("out", "Снятия", True),
        ("save", "Копилка", True),
    ),
    "work": (
        ("now", "В работе", True),
        ("planned", "Запланировано", True),
        ("done", "Закрыто", True),
        ("nodate", "Без дат", True),
    ),
}
# Тумблеры шапки. Колонки строки их не снимают.
HEADER_TOGGLES = {
    "debt": ("total", "late", "term", "buckets"),
    "overdue": ("late", "term", "buckets"),
    "incoming": ("total", "term"),
    "orders": ("head", "money", "note"),
    "summary": ("count", "money", "cost", "avg", "month", "forecast", "term"),
    "count": ("orders", "lines", "due", "paid", "debt", "cost", "net"),
    "rank": ("customers", "orders"),
    "work": ("now", "planned", "done", "nodate"),
    "expense": ("total",),
    "remind": ("hello", "due", "total", "term"),
}
# Колонка шаблона → тумблеры строки. Нет в карте — колонка шапку не трогает.
_DEBT_COLUMNS = {
    "customer": ("customer",),
    "number": ("order",),
    "name": ("order",),
    "product": ("product",),
    "quantity": ("qty",),
    "due": ("due",),
    "mark": ("mark",),
    "amount": ("amount",),
}
COLUMN_TO_TOGGLES = {
    "debt": _DEBT_COLUMNS,
    "overdue": _DEBT_COLUMNS,
    "incoming": _DEBT_COLUMNS,
    "orders": {
        "number": ("head",),
        "name": ("head",),
        "order_type": ("head",),
        "product": ("product",),
        "quantity": ("qty",),
        "status": ("status",),
        "total": ("amount",),
        "paid": ("money",),
        "totals": ("money",),
        "unpaid": ("debt",),
        "order_date": ("date",),
        "expenses": ("expense",),
    },
    "lines": {
        "number": ("order",),
        "name": ("order",),
        "order_type": ("order",),
        "product": ("product",),
        "quantity": ("qty",),
        "status": ("status",),
        "total": ("amount",),
        "unpaid": ("debt",),
        "order_date": ("date",),
        "expenses": ("expense",),
    },
}
COLUMN_SLICES = ("orders", "lines")
ORDER_SLICE_COLUMNS = (
    "number",
    "name",
    "product",
    "quantity",
    "order_type",
    "status",
    "total",
    "paid",
    "unpaid",
    "order_date",
)

SLICES = (
    ("summary", "Сводка"),
    ("count", "Коротко"),
    ("rank", "Крупные"),
    ("debt", "Долги"),
    ("overdue", "Просрочка"),
    ("incoming", "Ожидаемые"),
    ("orders", "Заказы"),
    ("lines", "Позиции"),
    ("work", "Календарь"),
    ("customers", "Заказчики"),
    ("products", "Продукты"),
    ("expense", "Расходы"),
    ("notes", "Заметки"),
    ("frozen", "Замороженные"),
    ("discount", "Скидки"),
    ("status", "Статусы"),
    ("remind", "Напоминание"),
    ("vault", "Хранилище"),
)

METRICS = (
    ("orders", "Заказов", "number"),
    ("lines", "Позиций", "number"),
    ("due", "К оплате", "money"),
    ("due_live", "К оплате без отменённых", "money"),
    ("paid", "Оплачено", "money"),
    ("share", "Доля оплаченного", "percent"),
    ("unpaid", "Не оплачено", "money"),
    ("cost", "Расходы", "money"),
    ("net", "Чистыми", "money"),
    ("avg", "Средний чек", "money"),
    ("month", "Этот месяц", "money"),
    ("prev", "Прошлый месяц", "money"),
    ("forecast", "Прогноз месяца", "money"),
    ("dso", "Средний срок оплаты", "text"),
)

ACTIONS = (
    ("pdf", "PDF"),
    ("text", "текст"),
    ("photo", "фото"),
    ("md", "Markdown"),
    ("hide", "без цен"),
)

ANSWERS = (
    ("slices", "Срезы"),
    ("metrics", "Показатели"),
    ("template", "Шаблон Markdown"),
    ("action", "Действие"),
    ("snap", "Снимок"),
    ("help", "Что умеешь"),
)

DELIVERIES = (
    ("", "Как в фразе"),
    ("md", "Всегда Markdown"),
    ("pdf", "Всегда PDF"),
    ("text", "Всегда текст"),
    ("photo", "Всегда фото"),
)

TOPIC_OWNER = {
    "incoming": "incoming",
    "overdue": "overdue",
    "expense": "expense",
    "frozen": "frozen",
    "notes": "notes",
    "work": "work",
    "customers": "customers",
    "products": "products",
    "debt": "debt",
    "count": "count",
    "rank": "rank",
    "discount": "discount",
    "status": "status",
    "money": "summary",
    "orders": "orders",
    "lines": "lines",
    "summary": "summary",
    "remind": "remind",
    "vault": "vault",
}

_ACTION_HELP = {
    "pdf": "прислать PDF",
    "text": "прислать текст",
    "photo": "прислать фото",
    "md": "ответ в Markdown",
    "hide": "скрыть цены и итоги",
}
_ACTION_HELP_DESK = {
    "pdf": "показать ответ, файл в чат не отправляется",
    "text": "показать ответ текстом",
    "photo": "показать ответ, фото в чат не отправляется",
    "md": "показать ответ в разметке",
    "hide": "скрыть цены и итоги",
}


def normalize(text: str) -> str:
    """Нижний регистр, ё→е, знак между буквой и цифрой — пробел, граница буква/цифра разрезана."""
    low = str(text or "").lower().replace("ё", "е")
    low = re.sub(r"(?<=[a-zа-я])[^0-9a-zа-я\s]+(?=\d)", " ", low)
    low = re.sub(r"(?<=\d)[^0-9a-zа-я\s]+(?=[a-zа-я])", " ", low)
    low = re.sub(r"(?<=[a-zа-я])(?=\d)", " ", low)
    low = re.sub(r"(?<=\d)(?=[a-zа-я])", " ", low)
    low = re.sub(r"[«»\"'.,!?()\[\]{}:;/\\|]+", " ", low)
    return " ".join(low.split())


def working_path() -> str:
    return os.path.join(storage.config_dir(), FILE_NAME)


def is_dictionary_path(path: str) -> bool:
    return str(path or "").lower().endswith(".fmwb")


def same_working(path: str) -> bool:
    if not path:
        return False
    try:
        return os.path.normcase(os.path.abspath(path)) == os.path.normcase(os.path.abspath(working_path()))
    except OSError:
        return False


def _cmd(
    cmd_id: str,
    phrases: list[str],
    *,
    answer: str = "slices",
    slices: list[str] | None = None,
    action: str = "",
    bot: bool = True,
    desk: bool = True,
    delivery: str = "",
    snap_kind: str = "png",
    snap_hide: bool = False,
) -> dict[str, Any]:
    return {
        "id": cmd_id,
        "phrases": list(phrases),
        "enabled": True,
        "builtin": True,
        "bot": bot,
        "desk": desk,
        "answer": answer,
        "slices": list(slices or []),
        "metrics": [],
        "template": "",
        "action": action,
        "snapKind": snap_kind,
        "snapHide": snap_hide,
        "delivery": delivery,
        "deliveryBot": delivery,
        "deliveryDesk": delivery,
        "vaultPage": "",
        "vaultStats": [],
        "vaultTotalsOnly": False,
        "sliceOpts": {},
        "sliceRules": {},
    }


def _kw(action: str, words: list[str], *, bot: bool, desk: bool) -> dict[str, Any]:
    return {
        "id": f"kw-{action}",
        "action": action,
        "words": list(words),
        "enabled": True,
        "builtin": True,
        "bot": bot,
        "desk": desk,
    }


def factory() -> dict[str, Any]:
    """Заводской словарь. Синонимов в нём нет: ё/е — общая нормализация."""
    commands = [
        _cmd(
            "full",
            ["весь отчёт", "все", "всё", "весь", "вся", "целиком", "полностью", "все данные", "всё подряд", "покажи всё", "покажи все"],
            slices=["summary", "debt", "orders", "work", "customers", "products", "expense", "notes", "frozen"],
        ),
        _cmd("debt", ["долги", "кто должен", "дебиторка", "неоплачено"], slices=["debt"]),
        _cmd("overdue", ["просрочка"], slices=["overdue"]),
        _cmd("incoming", ["ожидаемые оплаты", "ближайшие оплаты"], slices=["incoming"]),
        _cmd(
            "summary",
            ["сводка", "выручка", "касса", "итоги", "дашборд", "как дела", "что у меня"],
            slices=["summary"],
        ),
        _cmd("count", ["сколько"], slices=["count"]),
        _cmd("rank", ["топ", "кто больше всех", "крупные"], slices=["rank"]),
        _cmd("orders", ["заказы"], slices=["orders"]),
        _cmd("lines", ["позиции"], slices=["lines"]),
        _cmd(
            "work",
            ["календарь", "в работе", "запланировано", "закрыто", "без дат"],
            slices=["work"],
        ),
        _cmd("customers", ["заказчики", "клиенты", "контакты"], slices=["customers"]),
        _cmd("products", ["продукты"], slices=["products"]),
        _cmd("expense", ["расходы", "налоги", "затраты"], slices=["expense"]),
        _cmd("notes", ["заметки"], slices=["notes"]),
        _cmd("frozen", ["замороженные"], slices=["frozen"]),
        _cmd("discount", ["скидки"], slices=["discount"]),
        _cmd("status", ["статусы"], slices=["status"]),
        _cmd("remind", ["напомни"], slices=["remind"]),
        _cmd("vault", ["строки хранилища", "операции хранилища", "что в хранилище"], slices=["vault"]),
        _cmd("nav-reports", ["открой отчёты", "открой отчеты", "открыть отчёты", "открыть отчеты"], answer="action", action="reports", desk=False),
        _cmd("nav-orders", ["открой заказы", "открыть заказы"], answer="action", action="orders", desk=False),
        _cmd("nav-snap", ["открой снимок", "открыть снимок"], answer="action", action="snap", desk=False),
        _cmd(
            "nav-link",
            ["ссылка", "открой ссылку", "открыть ссылку", "пришли ссылку", "дай ссылку", "отправь ссылку"],
            answer="action",
            action="link",
            desk=False,
        ),
        _cmd(
            "nav-bank",
            ["хранилище", "/bank", "открой хранилище", "открыть хранилище", "открой копилку", "открыть копилку"],
            answer="action",
            action="bank",
            desk=False,
        ),
        _cmd(
            "nav-pc",
            ["открой на компьютере", "открыть на компьютере", "покажи на компьютере"],
            answer="action",
            action="pc",
            desk=False,
        ),
        _cmd(
            "help",
            ["что умеешь", "что ты умеешь", "что можешь", "что можно спросить", "примеры вопросов", "/ask", "ask"],
            answer="help",
        ),
    ]
    keywords = [
        _kw("pdf", ["pdf", "пдф"], bot=True, desk=False),
        _kw("text", ["текст", "текстом"], bot=True, desk=False),
        _kw("photo", ["фото", "png", "картинка", "снимок"], bot=True, desk=False),
        _kw("hide", ["без цен", "без итогов"], bot=True, desk=False),
        _kw("md", ["md", "мд"], bot=True, desk=False),
    ]
    return {"kind": KIND, "version": VERSION, "synonyms": [], "commands": commands, "keywords": keywords}


def _factory_index() -> dict[str, dict[str, Any]]:
    book = factory()
    found: dict[str, dict[str, Any]] = {}
    for item in book["commands"]:
        found["command:" + item["id"]] = item
    for item in book["keywords"]:
        found["keyword:" + item["id"]] = item
        found["keyword:" + item["action"]] = item
    return found


def _clean_phrases(value: Any) -> list[str]:
    out: list[str] = []
    seen: set[str] = set()
    for item in value or []:
        text = " ".join(str(item or "").split())
        key = normalize(text)
        if not key or key in seen:
            continue
        seen.add(key)
        out.append(text)
    return out


def _clean_command(raw: Any) -> dict[str, Any] | None:
    if not isinstance(raw, dict):
        return None
    cmd_id = str(raw.get("id") or "").strip() or "c-" + secrets.token_hex(4)
    answer = str(raw.get("answer") or "slices")
    if answer not in {key for key, _title in ANSWERS}:
        answer = "slices"
    slices = [key for key in (raw.get("slices") or []) if key in {item[0] for item in SLICES}]
    metrics = []
    known = {item[0]: item for item in METRICS}
    for tile in raw.get("metrics") or []:
        if not isinstance(tile, dict):
            continue
        key = str(tile.get("key") or "")
        if key not in known:
            continue
        fmt = str(tile.get("format") or known[key][2])
        if fmt not in {"money", "number", "percent", "text"}:
            fmt = known[key][2]
        metrics.append(
            {
                "key": key,
                "label": str(tile.get("label") or known[key][1])[:80],
                "format": fmt,
                "hideZero": bool(tile.get("hideZero")),
            }
        )
    action = str(raw.get("action") or "")
    if action not in {"reports", "orders", "snap", "link", "bank", "pc"}:
        action = ""
    snap_kind = str(raw.get("snapKind") or "png")
    if snap_kind not in {"png", "pdf", "text"}:
        snap_kind = "png"
    known_delivery = {key for key, _title in DELIVERIES}

    def one_delivery(value: Any) -> str:
        text = str(value or "")
        return text if text in known_delivery else ""

    delivery = one_delivery(raw.get("delivery"))
    delivery_bot = one_delivery(raw.get("deliveryBot")) if "deliveryBot" in raw else delivery
    delivery_desk = one_delivery(raw.get("deliveryDesk")) if "deliveryDesk" in raw else delivery
    if delivery_desk not in {"", "md"}:
        delivery_desk = ""
    vault_page = " ".join(str(raw.get("vaultPage") or "").split())[:80]
    raw_stats = raw.get("vaultStats") if isinstance(raw.get("vaultStats"), list) else []
    picked_stats = {str(item or "") for item in raw_stats}
    vault_stats = [key for key, _title in VAULT_STATS if key in picked_stats]
    vault_totals_only = bool(raw.get("vaultTotalsOnly"))
    slice_opts = _clean_slice_opts(raw.get("sliceOpts"))
    slice_rules = _clean_slice_rules(raw.get("sliceRules"))
    bot = bool(raw.get("bot", True))
    desk = bool(raw.get("desk", True))
    enabled = bool(raw.get("enabled", bot or desk))
    if not bot and not desk:
        enabled = False
    return {
        "id": cmd_id,
        "phrases": _clean_phrases(raw.get("phrases")),
        "enabled": enabled,
        "builtin": bool(raw.get("builtin")),
        "bot": bot,
        "desk": desk,
        "answer": answer,
        "slices": slices,
        "metrics": metrics,
        "template": str(raw.get("template") or "")[:20000],
        "action": action,
        "snapKind": snap_kind,
        "snapHide": bool(raw.get("snapHide")),
        "delivery": delivery,
        "deliveryBot": delivery_bot,
        "deliveryDesk": delivery_desk,
        "vaultPage": vault_page,
        "vaultStats": vault_stats,
        "vaultTotalsOnly": vault_totals_only,
        "sliceOpts": slice_opts,
        "sliceRules": slice_rules,
    }


def _clean_named(raw: Any, spec: dict[str, tuple]) -> dict[str, list[str]]:
    if not isinstance(raw, dict):
        return {}
    out: dict[str, list[str]] = {}
    for key, fields in spec.items():
        if key not in raw or not isinstance(raw.get(key), list):
            continue
        picked = {str(item or "") for item in raw.get(key) or []}
        out[key] = [fid for fid, *_rest in fields if fid in picked]
    return out


def _clean_slice_rules(raw: Any) -> dict[str, list[str]]:
    return _clean_named(raw, SLICE_RULES)


def _clean_slice_opts(raw: Any) -> dict[str, list[str]]:
    if not isinstance(raw, dict):
        return {}
    out: dict[str, list[str]] = {}
    for key, fields in SLICE_TOGGLES.items():
        if key not in raw or not isinstance(raw.get(key), list):
            continue
        picked = {str(item or "") for item in raw.get(key) or []}
        out[key] = [fid for fid, _title in fields if fid in picked]
    return out


def _clean_keyword(raw: Any) -> dict[str, Any] | None:
    if not isinstance(raw, dict):
        return None
    action = str(raw.get("action") or "")
    if action not in {key for key, _title in ACTIONS}:
        return None
    words = _clean_phrases(raw.get("words"))
    if not words and raw.get("word"):
        words = _clean_phrases([raw.get("word")])
    return {
        "id": f"kw-{action}",
        "action": action,
        "words": words,
        "enabled": True,
        "builtin": True,
        "bot": True,
        "desk": False,
    }


def _merge_keywords(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Одно действие — одна карточка: pdf и пдф живут вместе, а не двумя записями."""
    order: list[str] = []
    merged: dict[str, dict[str, Any]] = {}
    for item in rows:
        action = item["action"]
        if action not in merged:
            order.append(action)
            merged[action] = item
            continue
        prev = merged[action]
        seen = {normalize(word) for word in prev["words"]}
        for word in item["words"]:
            key = normalize(word)
            if key and key not in seen:
                seen.add(key)
                prev["words"].append(word)
        prev["bot"] = True
        prev["desk"] = False
        prev["enabled"] = True
        prev["builtin"] = True
    return [merged[key] for key in order]


def _pin_commands(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Заводскую команду нельзя удалить. Порядок списка сохраняется, пропавшая заводская встаёт в конец."""
    pinned: list[dict[str, Any]] = []
    seen: set[str] = set()
    for item in rows:
        if item["id"] in seen:
            continue
        pinned.append(item)
        seen.add(item["id"])
    for sample in factory()["commands"]:
        if sample["id"] not in seen:
            pinned.append(json.loads(json.dumps(sample)))
    samples = {sample["id"]: [normalize(phrase) for phrase in sample["phrases"]] for sample in factory()["commands"]}
    claimed: set[str] = set()

    def take(phrases: list[str]) -> list[str]:
        fresh: list[str] = []
        for phrase in phrases:
            key = normalize(phrase)
            if not key or key in claimed:
                continue
            claimed.add(key)
            fresh.append(phrase)
        return fresh

    owned: dict[int, list[str]] = {}
    for item in pinned:
        original = set(samples.get(item["id"]) or [])
        owned[id(item)] = take([phrase for phrase in item.get("phrases") or [] if normalize(phrase) in original])
    for item in pinned:
        original = set(samples.get(item["id"]) or [])
        extra = take([phrase for phrase in item.get("phrases") or [] if normalize(phrase) not in original])
        item["phrases"] = owned[id(item)] + extra
    return [item for item in pinned if item.get("phrases") or item["id"] in samples]


def _pin_keywords(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Пять действий всегда на месте и только у бота. Удалить карточку нельзя, можно дописать слова."""
    merged = {item["action"]: item for item in _merge_keywords(rows)}
    pinned: list[dict[str, Any]] = []
    for sample in factory()["keywords"]:
        item = merged.get(sample["action"])
        if item is None:
            item = {**sample, "words": list(sample["words"])}
        item["bot"] = True
        item["desk"] = False
        item["enabled"] = True
        item["builtin"] = True
        pinned.append(item)
    seen: set[str] = set()
    for item in pinned:
        fresh: list[str] = []
        for word in item["words"]:
            key = normalize(word)
            if not key or key in seen:
                continue
            seen.add(key)
            fresh.append(word)
        item["words"] = fresh
    return pinned


def _clean_synonym(raw: Any) -> dict[str, Any] | None:
    if not isinstance(raw, dict):
        return None
    words = _clean_phrases(raw.get("words"))
    values = _clean_phrases(raw.get("values"))
    if not words or not values:
        return None
    return {
        "id": str(raw.get("id") or "").strip() or "s-" + secrets.token_hex(4),
        "words": words,
        "values": values,
        "enabled": bool(raw.get("enabled", True)),
        "builtin": bool(raw.get("builtin")),
    }


def normalize_book(raw: Any) -> dict[str, Any]:
    data = raw if isinstance(raw, dict) else {}
    commands = _pin_commands([item for item in (_clean_command(row) for row in data.get("commands") or []) if item and item["phrases"]])
    keywords = _pin_keywords([item for item in (_clean_keyword(row) for row in data.get("keywords") or []) if item])
    synonyms = [item for item in (_clean_synonym(row) for row in data.get("synonyms") or []) if item]
    return {"kind": KIND, "version": VERSION, "synonyms": synonyms, "commands": commands, "keywords": keywords}


def _read_json(path: str) -> Any:
    with open(path, encoding="utf-8") as handle:
        return json.load(handle)


def validate(raw: Any) -> dict[str, Any] | None:
    if not isinstance(raw, dict) or raw.get("kind") != KIND:
        return None
    return normalize_book(raw)


def load() -> tuple[dict[str, Any], str]:
    """Книга и статус: ok, missing, broken. Битый файл не подменяется и не удаляется."""
    path = working_path()
    if not os.path.isfile(path):
        return factory(), "missing"
    try:
        raw = _read_json(path)
    except (OSError, json.JSONDecodeError, UnicodeError):
        return factory(), "broken"
    book = validate(raw)
    if book is None:
        return factory(), "broken"
    return book, "ok"


def for_parse() -> tuple[dict[str, Any], str]:
    """Один раз на запрос. Если файл битый или его нет — заводской словарь в памяти."""
    return load()


def save(book: dict[str, Any], path: str | None = None) -> str:
    target = path or working_path()
    folder = os.path.dirname(target)
    if folder:
        os.makedirs(folder, exist_ok=True)
    payload = normalize_book(book)
    payload["kind"] = KIND
    payload["version"] = VERSION
    temporary = target + ".tmp"
    with open(temporary, "w", encoding="utf-8") as handle:
        json.dump(payload, handle, ensure_ascii=False, indent=2)
    os.replace(temporary, target)
    return target


def ensure() -> None:
    """Создать заводской файл, только если его ещё нет."""
    path = working_path()
    if os.path.isfile(path):
        return
    save(factory(), path)


def read_import(path: str) -> tuple[dict[str, Any] | None, str]:
    try:
        raw = _read_json(path)
    except (OSError, json.JSONDecodeError, UnicodeError):
        return None, "Файл не читается."
    book = validate(raw)
    if book is None:
        return None, "Это не словарь FinMaster."
    return book, ""


def restore_all() -> dict[str, Any]:
    book = factory()
    save(book)
    return book


def restore_entry(book: dict[str, Any], kind: str, entry_id: str) -> dict[str, Any]:
    """Вернуть одну заводскую запись. Чужую запись не трогает."""
    current = normalize_book(book)
    index = _factory_index()
    if kind == "command":
        sample = index.get("command:" + entry_id)
        if not sample:
            return current
        replaced = False
        commands = []
        for item in current["commands"]:
            if item["id"] == entry_id:
                commands.append(json.loads(json.dumps(sample)))
                replaced = True
            else:
                commands.append(item)
        if not replaced:
            commands.append(json.loads(json.dumps(sample)))
        current["commands"] = commands
        return current
    if kind == "keyword":
        sample = index.get("keyword:" + entry_id)
        if sample is None:
            return current
        keywords = []
        replaced = False
        for item in current["keywords"]:
            if item["id"] == sample["id"] or item["action"] == sample["action"]:
                keywords.append(json.loads(json.dumps(sample)))
                replaced = True
            else:
                keywords.append(item)
        if not replaced:
            keywords.append(json.loads(json.dumps(sample)))
        current["keywords"] = keywords
    return current


def surface_on(item: dict[str, Any], surface: str) -> bool:
    if not item.get("enabled"):
        return False
    return bool(item.get("desk" if surface == "desk" else "bot"))


def enabled_command(book: dict[str, Any], cmd_id: str, surface: str) -> bool:
    for item in book.get("commands") or []:
        if item.get("id") == cmd_id:
            return surface_on(item, surface)
    return False


def topic_allowed(book: dict[str, Any], flag: str, surface: str) -> bool:
    owner = TOPIC_OWNER.get(flag)
    if not owner:
        return True
    return enabled_command(book, owner, surface)


def take_keywords(text: str, book: dict[str, Any], surface: str) -> tuple[str, bool, str]:
    """Снять ключевые слова. Последнее слово доставки в фразе побеждает, «без цен» сочетается с ним."""
    items: list[tuple[list[str], str]] = []
    for row in book.get("keywords") or []:
        if not surface_on(row, surface):
            continue
        action = str(row.get("action") or "")
        for word in row.get("words") or []:
            phrase = normalize(word).split()
            if phrase:
                items.append((phrase, action))
    items.sort(key=lambda item: -len(item[0]))
    tokens = text.split()
    occupied = [False] * len(tokens)
    hits: list[tuple[int, str]] = []
    for phrase, action in items:
        size = len(phrase)
        index = 0
        while index <= len(tokens) - size:
            if any(occupied[index : index + size]) or tokens[index : index + size] != phrase:
                index += 1
                continue
            hits.append((index, action))
            for cursor in range(index, index + size):
                occupied[cursor] = True
            index += size
    hits.sort()
    delivery = ""
    hide = False
    for _index, action in hits:
        if action == "hide":
            hide = True
        elif action in {"pdf", "text", "photo", "md"}:
            delivery = action
    kept = [token for index, token in enumerate(tokens) if not occupied[index]]
    return delivery, hide, " ".join(kept)


def synonym_values(book: dict[str, Any], word: str) -> list[str]:
    """Слова и значения одной карточки. «эт» и «этаж» ищутся одинаково. Если карточки нет — само слово."""
    key = normalize(word)
    found: list[str] = []
    seen: set[str] = set()

    def add(text: str) -> None:
        mark = normalize(text)
        if mark and mark not in seen:
            seen.add(mark)
            found.append(mark)

    for row in book.get("synonyms") or []:
        if not row.get("enabled"):
            continue
        words = [normalize(item) for item in row.get("words") or []]
        values = [normalize(item) for item in row.get("values") or []]
        if key not in words and key not in values:
            continue
        for item in list(row.get("words") or []) + list(row.get("values") or []):
            add(str(item))
    return found or [key]


def commands_for(book: dict[str, Any], surface: str) -> list[dict[str, Any]]:
    return [item for item in book.get("commands") or [] if surface_on(item, surface) and item.get("phrases")]


def _help_block(title: str, rows: list[str]) -> list[str]:
    if not rows:
        return []
    return [f"<b>{title}</b>", *rows, ""]


def help_html(book: dict[str, Any], surface: str) -> str:
    """Справка стороны, которая спросила. Выключенное и чужая галочка в список не входят."""
    desk = surface == "desk"
    if desk:
        lines = ["<b>Что можно спросить</b>", "Ответ берётся из отчёта, который сейчас открыт. Это окно поиска, без голоса и без кнопок чата.", ""]
    else:
        lines = ["<b>Спросите по открытому отчёту</b>", "Голосом или текстом. Ответ собирается из файла, который сейчас открыт.", ""]
    synonyms: list[str] = []
    for row in book.get("synonyms") or []:
        if not row.get("enabled"):
            continue
        words = [str(word).strip() for word in (row.get("words") or []) if str(word).strip()]
        values = [str(word).strip() for word in (row.get("values") or []) if str(word).strip()]
        if not words and not values:
            continue
        left = ", ".join(html_esc(word) for word in words)
        right = ", ".join(html_esc(word) for word in values)
        synonyms.append("• " + (f"{left} — {right}" if left and right else left or right))
    commands: list[str] = []
    for item in commands_for(book, surface):
        if item.get("answer") == "help" or item.get("id") == "help":
            continue
        phrases = ", ".join(html_esc(str(phrase)) for phrase in item.get("phrases") or [] if str(phrase).strip())
        if phrases:
            commands.append("• " + phrases)
    lines.extend(_help_block("Синонимы", synonyms))
    lines.extend(_help_block("Команды", commands))
    if not desk:
        labels = _ACTION_HELP
        seen: set[str] = set()
        keywords: list[str] = []
        for row in book.get("keywords") or []:
            if not surface_on(row, "bot"):
                continue
            action = str(row.get("action") or "")
            words = [str(word).strip() for word in (row.get("words") or []) if str(word).strip()]
            fresh = [word for word in words if normalize(word) not in seen]
            if not fresh:
                continue
            for word in fresh:
                seen.add(normalize(word))
            keywords.append("• " + html_esc(", ".join(fresh)) + " — " + labels.get(action, action))
        lines.extend(_help_block("Ключевые слова", keywords))
        lines.append("Кнопки внизу по-прежнему открывают отчёты, заказы, снимок, хранилище и ссылку.")
    return "\n".join(lines).strip()


def catalog() -> dict[str, Any]:
    return {
        "slices": [{"id": key, "title": title} for key, title in SLICES],
        "columns": [{"id": item["id"], "title": item["label"], "kind": item["kind"]} for item in snapmod.FIELDS],
        "columnSlices": list(COLUMN_SLICES),
        "sliceColumns": list(ORDER_SLICE_COLUMNS),
        "slicePicks": {
            key: [{"id": fid, "title": title} for fid, title in fields]
            for key, fields in SLICE_PICKS.items()
        },
        "vaultStats": [{"id": fid, "title": title} for fid, title in VAULT_STATS],
        "sliceToggles": {
            key: [{"id": fid, "title": title} for fid, title in fields]
            for key, fields in SLICE_TOGGLES.items()
        },
        "sliceRules": {
            key: [{"id": fid, "title": title, "on": flag} for fid, title, flag in fields]
            for key, fields in SLICE_RULES.items()
        },
        "metrics": [{"id": key, "title": title, "format": fmt} for key, title, fmt in METRICS],
        "actions": [{"id": key, "title": title} for key, title in ACTIONS],
        "answers": [{"id": key, "title": title} for key, title in ANSWERS],
        "deliveries": [{"id": key, "title": title} for key, title in DELIVERIES],
        "nav": [
            {"id": "reports", "title": "Открыть отчёты"},
            {"id": "orders", "title": "Открыть заказы"},
            {"id": "snap", "title": "Открыть снимок"},
            {"id": "link", "title": "Ссылка"},
            {"id": "bank", "title": "Открыть хранилище"},
            {"id": "pc", "title": "Открыть на компьютере"},
        ],
        "factory": {
            "commands": factory()["commands"],
            "keywords": factory()["keywords"],
        },
    }
