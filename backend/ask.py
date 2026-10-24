"""Ответы Telegram-бота по открытому отчёту.

Просьба голосом или текстом режется на срез тех же сумм, что на экране:
долги и старение как в кассе, заказы, календарь работ, заказчики, расходы.
"""

from __future__ import annotations

import re
from datetime import date, timedelta
from typing import Any

from backend.document import DEFAULT_PAYMENT_TERMS
from backend.finance import (
    html_esc,
    is_frozen,
    line_totals,
    money,
    money_decimals,
    qty_text,
    type_index,
)

_CANCEL = re.compile(r"отмен|аннул|черн", re.I)
_ASK = re.compile(
    r"(покаж|скаж|расскаж|вывед|найд|пришл|сколько|какие|какой|какая|какое|кто\b|что по|что у|список|есть ли|дай |выдай|напомн)"
)
_HELP = (
    "что умеешь",
    "что ты умеешь",
    "что можешь",
    "что можно спросить",
    "примеры вопросов",
    "/ask",
    "ask",
)
_NAV = {
    "открой отчёты": "reports",
    "открой отчеты": "reports",
    "открыть отчёты": "reports",
    "открыть отчеты": "reports",
    "открой заказы": "orders",
    "открыть заказы": "orders",
    "открой снимок": "snap",
    "открыть снимок": "snap",
    "открой ссылку": "link",
    "открыть ссылку": "link",
    "пришли ссылку": "link",
    "дай ссылку": "link",
    "отправь ссылку": "link",
    "открой на компьютере": "pc",
    "открыть на компьютере": "pc",
    "покажи на компьютере": "pc",
}
_STATUS_SKIP = {
    "в работе",
    "закрыт",
    "закрыто",
    "закрыта",
    "запланирован",
    "запланировано",
    "готово",
    "завершен",
    "завершено",
    "завершён",
}
_BUCKETS = (
    ("future", "Срок не наступил"),
    ("d7", "Просрочка 1–7 дней"),
    ("d30", "Просрочка 8–30 дней"),
    ("d60", "Просрочка 31–60 дней"),
    ("d60p", "Просрочка больше 60 дней"),
    ("nodate", "Без даты заказа и оплаты"),
)
_STOP = {
    "мне",
    "мой",
    "моя",
    "мои",
    "про",
    "для",
    "это",
    "этот",
    "эта",
    "эти",
    "все",
    "всё",
    "всего",
    "есть",
    "нет",
    "или",
    "при",
    "над",
    "под",
    "как",
    "так",
    "уже",
    "ещё",
    "еще",
    "только",
    "просто",
    "пожалуйста",
    "бот",
    "финмастер",
    "finmaster",
    "отчёт",
    "отчет",
    "данные",
    "программе",
    "программа",
    "какие",
    "какой",
    "какая",
    "какое",
    "каких",
    "покажи",
    "покажите",
    "скажи",
    "скажите",
    "расскажи",
    "выведи",
    "найди",
    "пришли",
    "пришлите",
    "сколько",
    "список",
    "напомни",
    "напомните",
    "кто",
    "что",
    "когда",
    "где",
    "дай",
    "выдай",
    "сделай",
    "собери",
    "снимок",
    "снимка",
    "картинку",
    "картинка",
    "голосом",
    "текстом",
    "pdf",
    "png",
    "пдф",
    "открой",
    "открыть",
}


class Reply:
    def __init__(
        self,
        html: str = "",
        action: str = "",
        target: str = "",
        kind: str = "",
        order_ids: list[str] | None = None,
        needs_report: bool = False,
        hide_totals: bool = False,
    ) -> None:
        self.html = html
        self.action = action
        self.target = target
        self.kind = kind
        self.order_ids = order_ids or []
        self.needs_report = needs_report
        self.hide_totals = hide_totals


def help_text(surface: str = "bot") -> str:
    if surface == "desk":
        return (
            "<b>Что можно спросить</b> · Ответ берётся из отчёта, который сейчас открыт. Это окно — Shift+Enter, ассистент — Ctrl+Пробел.\n"
            "<b>Долги</b>\n"
            "• кто должен, просрочка, старение, ближайшие оплаты\n"
            "• сколько должен, топ, напоминание заказчику\n"
            "<b>Сводка</b>\n"
            "• выручка, оплачено, расходы, налоги, чистыми, средний чек\n"
            "• итоги за август, май 2025, 5 августа, 1 квартал, этот месяц, за 30 дней\n"
            "<b>Заказы</b>\n"
            "• номер, имя, продукт, статус, тип, скидки\n"
            "• последние 3 заказа, последний заказ, сколько заказов\n"
            "<b>Календарь</b>\n"
            "• в работе, запланировано, закрыто, без дат\n"
            "<b>Заказчики</b>\n"
            "• контакты, заметки, замороженные, весь отчёт"
        )
    return (
        "<b>Спросите по открытому отчёту</b> — голосом или текстом. Ответ собирается из файла, который сейчас открыт.\n"
        "• долги, кто должен, просрочка, старение, ближайшие оплаты, напоминание заказчику\n"
        "• сводка, выручка, оплаты, расходы, налоги, чистыми, средний чек\n"
        "• сколько заказов, сколько должен, топ, кто больше всех, скидки, статусы\n"
        "• заказы и позиции: по номеру, имени, продукту, статусу, типу, «последние 3 заказа»\n"
        "• период: сегодня, вчера, эта неделя, этот месяц, август, май 2025, 5 августа, 1 квартал, за 30 дней\n"
        "• календарь: в работе, запланировано, закрыто, без дат\n"
        "• заказчики и контакты, заметки, замороженные\n"
        "• «всё» или «весь отчёт» — сводка целиком\n"
        "• «открой отчёт …», «снимок заказа 12», «снимок заказа 12 без итогов», «открой на компьютере»\n"
        "Кнопки внизу по-прежнему открывают отчёты, заказы, снимок и ссылку."
    )


_SECTION_TITLES = {
    "Сводка",
    "Долги",
    "Заказы",
    "Календарь",
    "Заказчики",
    "Продукты",
    "Расходы",
    "Заметки",
    "Замороженные",
    "Напоминание",
    "Коротко",
    "Просрочено",
    "Крупные",
    "Статусы",
    "Скидки",
    "Ответ",
}


def _unesc(value: str) -> str:
    return str(value or "").replace("&amp;", "&").replace("&lt;", "<").replace("&gt;", ">")


def present(html: str) -> dict[str, Any]:
    """Разметка ответа для окна ассистента: шапка, чипы и блоки, не сплошной текст."""
    raw = str(html or "").strip()
    lines = raw.split("\n")
    head = lines[0] if lines else ""
    title_match = re.search(r"<b>(.*?)</b>", head)
    title = _unesc(title_match.group(1)) if title_match else "Найти"
    tail = _unesc(re.sub(r"<[^>]+>", "", re.sub(r"<b>.*?</b>", "", head, count=1))).strip()
    chips = [bit.strip(" ·—-") for bit in tail.split("·") if bit.strip(" ·—-")]
    lead = ""
    if len(chips) == 1 and len(chips[0]) > 42:
        lead = chips[0]
        chips = []
    sections: list[dict[str, Any]] = []
    current: dict[str, Any] | None = None

    def ensure() -> dict[str, Any]:
        nonlocal current
        if current is None:
            current = {"title": "Найти", "rows": []}
            sections.append(current)
        return current

    index = 1
    while index < len(lines):
        line = lines[index]
        index += 1
        stripped = line.strip()
        if not stripped:
            continue
        if stripped == "<details>":
            label = "Показать ещё"
            inner: list[str] = []
            while index < len(lines):
                cur_line = lines[index]
                index += 1
                cur = cur_line.strip()
                if cur == "</details>":
                    break
                summary = re.fullmatch(r"<summary>(.*?)</summary>", cur)
                if summary:
                    label = _unesc(re.sub(r"<[^>]+>", "", summary.group(1))).strip() or label
                    continue
                inner.append(cur_line)
            body = "\n".join(inner).strip()
            if body:
                folded = present(f"<b>Скрыто</b>\n{body}")
                rows: list[dict[str, Any]] = []
                for section in folded["sections"]:
                    rows.extend(section["rows"])
                if rows:
                    ensure()["rows"].append({"kind": "fold", "label": label, "rows": rows})
            continue
        mixed = re.fullmatch(r"<b>(.*?)</b>\s*(.*)", stripped)
        if mixed:
            name = _unesc(mixed.group(1)).strip()
            meta = _unesc(re.sub(r"<[^>]+>", "", mixed.group(2))).strip(" ·—-")
            if name in _SECTION_TITLES:
                current = {"title": f"{name} · {meta}" if meta else name, "rows": []}
                sections.append(current)
                continue
            ensure()["rows"].append({"kind": "group", "title": name, "meta": meta})
            continue
        plain = _unesc(re.sub(r"<[^>]+>", "", stripped)).strip()
        if not plain:
            continue
        box = ensure()
        if line.startswith("  ") or plain.lower().startswith("заметка:"):
            label = ""
            text = plain
            if plain.lower().startswith("заметка:"):
                label = "Заметка"
                text = plain.split(":", 1)[1].strip()
            if text:
                box["rows"].append({"kind": "note", "text": text, "label": label})
            continue
        if plain.startswith("•"):
            body = plain[1:].strip()
            bits = [bit.strip() for bit in body.split("·") if bit.strip()]
            if len(bits) >= 2:
                box["rows"].append({"kind": "item", "text": bits[0], "meta": " · ".join(bits[1:])})
            else:
                box["rows"].append({"kind": "item", "text": body})
            continue
        if " · " in plain and not plain.startswith("№"):
            parts = [bit.strip() for bit in plain.split("·") if bit.strip()]
            if len(parts) >= 2 and all(len(bit) <= 80 for bit in parts):
                box["rows"].append({"kind": "metrics", "items": parts})
                continue
        box["rows"].append({"kind": "text", "text": plain})
    if not sections:
        plain = _unesc(re.sub(r"<[^>]+>", "", raw)).strip()
        if plain:
            sections.append({"title": "Найти", "rows": [{"kind": "text", "text": plain}]})
    return {"title": title, "lead": lead, "chips": chips, "sections": sections}


def parse(text: str, doc: dict[str, Any] | None, *, voice: bool = False, live: bool = False, surface: str = "bot") -> Reply | None:
    low = _norm(text)
    if not low:
        return Reply(html="Не разобрал речь. Скажите ещё раз или напишите вопрос.") if voice else None
    if low in _HELP:
        return Reply(html=help_text(surface))
    if low in _NAV:
        return Reply(action=_NAV[low], needs_report=_NAV[low] in {"orders", "snap", "pc"})
    opened = re.match(r"^(?:открой|открыть|выбери)\s+отч[её]т\s+(.+)$", low)
    if opened:
        return Reply(action="open_report", target=opened.group(1).strip())

    source = doc if isinstance(doc, dict) else {}
    today = date.today()
    rows = _rows(source)
    raw = low
    hide_totals = bool(re.search(r"без итог", raw))
    if hide_totals:
        raw = " ".join(re.sub(r"без итог\w*", " ", raw).split())
    period, period_label, raw = _take_period(raw)
    recent_n, raw = _take_recent(raw)
    customers, raw = _take_names(raw, _customer_names(source, rows))
    products, raw = _take_names(raw, _product_names(rows))
    order_ids, raw = _take_orders(raw, source.get("orders") or [])
    statuses, raw = _take_statuses(raw, source)
    types, raw = _take_names(raw, _type_names(source))
    topics, raw = _topics(raw)
    pay = _pay_mode(low)
    work_state = _work_mode(low)
    words = _words(raw)
    snap = bool(re.search(r"сним|картинк|\bpdf\b|\bpng\b|пдф", low))
    kind = "pdf" if re.search(r"\bpdf\b|пдф", low) else ("text" if snap and "текст" in low else "png")
    remind = bool(re.search(r"напомн", low))
    explicit = set(topics)
    if re.search(r"все данные|весь отч|целиком|полностью|покажи вс[её]$|вс[её] подряд", low):
        explicit.update({"summary", "debt", "orders", "work", "customers", "products", "expense", "notes", "frozen"})
    asked = bool(
        explicit
        or customers
        or products
        or order_ids
        or statuses
        or types
        or period != "all"
        or pay
        or work_state
        or snap
        or remind
        or recent_n
        or _ASK.search(low)
        or voice
    )
    if not asked and words and any(all(_hit(row["blob"], word) for word in words) for row in rows if not row["frozen"]):
        asked = True
    if not asked:
        return None

    if not explicit:
        if remind:
            explicit.add("remind")
        elif snap and not words:
            explicit.add("snap")
        elif order_ids and not (customers or products or words or statuses or types):
            explicit.add("orders")
        elif customers and not words:
            explicit.update({"customers", "debt"})
        elif products and not words:
            explicit.add("products")
        elif statuses:
            explicit.update({"status", "orders"})
        elif words or types or recent_n:
            explicit.add("orders")
        else:
            explicit.add("summary")
    if remind:
        explicit.add("remind")
    if pay:
        explicit.add("orders")
    if "lines" in explicit:
        explicit.add("orders")
    if "overdue" in explicit or "incoming" in explicit:
        explicit.add("debt")
    show_lines = bool(re.search(r"список|покаж|позиц|подроб|строк|какие", low))
    verbose = {"summary", "money", "orders", "debt", "products", "customers", "work", "notes", "expense", "frozen", "status"}
    if "count" in explicit and not show_lines and "incoming" not in explicit:
        overdue_only = "overdue" in explicit
        explicit -= verbose
        explicit.add("count")
        if overdue_only:
            explicit.add("overdue")
    elif "rank" in explicit and "count" not in explicit and not show_lines:
        explicit -= {"summary", "money", "orders", "debt", "products", "customers"}
        explicit.add("rank")
    if recent_n:
        explicit.add("orders")

    date_kind = "order"
    if "work" in explicit and not ({"debt", "money", "orders", "summary", "expense"} & explicit):
        date_kind = "work"
    if re.search(r"дата оплаты|по дате оплаты", low):
        date_kind = "pay"

    terms = _terms(source)
    delays = _delays(rows, terms)
    matched = [
        row
        for row in rows
        if _keep(
            row,
            customers=customers,
            products=products,
            order_ids=order_ids,
            statuses=statuses,
            types=types,
            pay=pay,
            work_state=work_state,
            period=period,
            today=today,
            date_kind=date_kind,
            words=words,
        )
    ]
    if words and not matched:
        loose = [
            row
            for row in rows
            if _keep(
                row,
                customers=customers,
                products=products,
                order_ids=order_ids,
                statuses=statuses,
                types=types,
                pay=pay,
                work_state=work_state,
                period=period,
                today=today,
                date_kind=date_kind,
                words=words,
                any_word=True,
            )
        ]
        if loose:
            matched = loose
    if recent_n and matched:
        matched = _latest_rows(matched, recent_n)

    title = str(source.get("title") or "Отчёт")
    recent_label = f"последние {recent_n}" if recent_n else ""
    head = _header(title, live, explicit, customers, products, order_ids, period_label, pay, work_state, words, recent_label)
    if not rows and "snap" not in explicit:
        return Reply(
            html=f"{head}\nВ отчёте пока нет позиций.",
            needs_report=True,
        )
    if not matched and explicit != {"snap"} and "snap" not in explicit:
        tail = f"За {html_esc(period_label)} в отчёте ничего нет." if period_label else "В отчёте по этой просьбе ничего нет."
        understood = bool(explicit or customers or products or order_ids or statuses or types or period != "all" or pay or work_state or recent_n)
        if (voice or _ASK.search(low)) and not understood:
            tail += "\n" + help_text(surface)
        return Reply(html=f"{head}\n{tail}", needs_report=True)

    parts = [head]
    cur = str(source.get("currency") or "₽")
    decimals = money_decimals(source.get("money_decimals"))

    def cash(value: float) -> str:
        return html_esc(money(value, cur, decimals))

    if "count" in explicit:
        parts.append(_count(matched, cash, overdue_only="overdue" in explicit and "debt" not in explicit))
    if "rank" in explicit:
        parts.append(_rank(matched, cash, by_debt=bool(re.search(r"долг|долж", low))))
    if "summary" in explicit or "money" in explicit:
        parts.append(_summary(source, matched, today, cash, terms, delays, period))
    if "status" in explicit:
        parts.append(_statuses(matched, cash))
    if "discount" in explicit:
        parts.append(_discounts(matched, cash))
    if "debt" in explicit:
        parts.append(_debts(matched, today, terms, delays, cash, overdue_only="overdue" in explicit, incoming="incoming" in explicit, period=period))
    if "orders" in explicit:
        parts.append(_orders(matched, cash))
    if "work" in explicit:
        parts.append(_work(matched if work_state or period != "all" else rows, today, work_state))
    if "customers" in explicit:
        parts.append(_customers(source, matched if customers or words or products else rows, cash))
    if "products" in explicit:
        parts.append(_products(matched, cash))
    if "expense" in explicit:
        parts.append(_expenses(rows, matched, customers, order_ids, cash))
    if "notes" in explicit:
        parts.append(_notes(matched))
    if "frozen" in explicit:
        parts.append(_frozen(rows, customers, products, order_ids))
    if "remind" in explicit:
        parts.append(_reminder(matched, source, terms, cash))

    ids: list[str] = []
    seen: set[str] = set()
    pool = matched or rows
    for row in pool:
        oid = str(row["order"].get("id") or "")
        if oid and oid not in seen:
            seen.add(oid)
            ids.append(oid)
    specific = bool(customers or products or order_ids or statuses or types or words or pay or period != "all" or work_state or "debt" in explicit)
    action = ""
    if snap and surface != "desk":
        action = "snap_send" if specific and ids else "snap"
        if action == "snap":
            parts = [head, "Открываю снимок. Отметьте заказы и нажмите PNG, PDF или текст."]
        elif explicit <= {"snap", "orders"}:
            who = ", ".join(customers) if customers else (f"{len(ids)} зак." if ids else "")
            bare = " без цен" if hide_totals else ""
            parts = [head, f"Собираю снимок{bare}{(' · ' + html_esc(who)) if who else ''}."]

    html = "\n".join(part for part in parts if part).strip()
    return Reply(
        html=html,
        action=action,
        kind=kind,
        order_ids=ids if action == "snap_send" else [],
        needs_report=True,
        hide_totals=hide_totals and action in {"snap", "snap_send"},
    )


def _norm(text: str) -> str:
    low = str(text or "").lower().replace("ё", "е")
    low = re.sub(r"[«»\"'.,!?()\[\]{}:;/\\|]+", " ", low)
    return " ".join(low.split())


def _header(
    title: str,
    live: bool,
    topics: set[str],
    customers: list[str],
    products: list[str],
    order_ids: set[str],
    period_label: str,
    pay: str,
    work_state: str,
    words: list[str],
    recent_label: str = "",
) -> str:
    bits = [f"<b>{html_esc(title)}</b>"]
    if live:
        bits.append("правки с компьютера")
    names = {
        "summary": "сводка",
        "money": "деньги",
        "debt": "долги",
        "overdue": "просрочка",
        "incoming": "ожидаемые",
        "orders": "заказы",
        "lines": "позиции",
        "work": "календарь",
        "customers": "заказчики",
        "products": "продукты",
        "expense": "расходы",
        "notes": "заметки",
        "frozen": "замороженные",
        "remind": "напоминание",
        "snap": "снимок",
        "count": "коротко",
        "rank": "крупные",
        "discount": "скидки",
        "status": "статусы",
    }
    for key in ("summary", "money", "debt", "overdue", "orders", "work", "customers", "products", "expense", "notes", "frozen", "remind", "count", "rank", "discount", "status"):
        if key in topics and names.get(key):
            bits.append(names[key])
    if customers:
        bits.append(html_esc(", ".join(customers)))
    if products:
        bits.append(html_esc(", ".join(products)))
    if order_ids:
        bits.append(f"{len(order_ids)} зак.")
    if period_label:
        bits.append(period_label)
    if recent_label:
        bits.append(html_esc(recent_label))
    if pay == "debt":
        bits.append("только долг")
    elif pay == "paid":
        bits.append("оплаченные")
    if work_state:
        bits.append({"now": "в работе", "planned": "план", "done": "закрытые", "nodate": "без дат"}[work_state])
    if words:
        bits.append("поиск: " + html_esc(" ".join(words)))
    return " · ".join(bits)


def _topics(text: str) -> tuple[set[str], str]:
    found: set[str] = set()
    rules = (
        ("incoming", r"ожида\w*|поступ\w*|ближайш\w*"),
        ("overdue", r"просроч\w*"),
        ("expense", r"расход\w*|налог\w*|затрат\w*"),
        ("frozen", r"заморож\w*"),
        ("notes", r"заметк\w*|коммент\w*|примечан\w*"),
        ("work", r"календар\w*|в работе|ид[её]т|запланир\w*|закрыт\w*|без дат|финиш\w*|пауз\w*"),
        ("customers", r"заказчик\w*|клиент\w*|контакт\w*|телефон\w*|почт\w*|адрес\w*"),
        ("products", r"продукт\w*|товар\w*|услуг\w*|хит продаж\w*"),
        ("debt", r"долг\w*|долж\w*|дебитор\w*|неоплач\w*|не оплач\w*"),
        ("count", r"сколько"),
        ("rank", r"самы\w+|больше всех|\bтоп\b|крупн\w+"),
        ("discount", r"скидк\w*"),
        ("status", r"статус\w*"),
        ("money", r"выруч\w*|оборот\w*|оплат\w*|пришл\w*|касс\w*|чист\w*|прибыл\w*|средний чек|собираем\w*|сводк\w*|дашборд|как дела|что у меня|итог\w*"),
        ("orders", r"заказ(?!чик)\w*"),
        ("lines", r"позиц\w*|строк\w*"),
        ("summary", r"сводк\w*|обзор|что по отч"),
    )
    work = text
    for flag, pattern in rules:
        rx = re.compile(pattern)
        if rx.search(work):
            found.add(flag)
            work = rx.sub(" ", work)
    if "money" in found or "summary" in found:
        found.add("summary")
    return found, work


def _pay_mode(text: str) -> str:
    if re.search(r"неоплач|не оплач|с долг|только долг", text):
        return "debt"
    if re.search(r"оплаченн\w*|без долга|уже оплат", text):
        return "paid"
    return ""


def _work_mode(text: str) -> str:
    if re.search(r"без дат", text):
        return "nodate"
    if re.search(r"запланир", text):
        return "planned"
    if re.search(r"закрыт|заверш", text):
        return "done"
    if re.search(r"в работе|идет|идёт", text):
        return "now"
    return ""


_MONTHS = (
    (1, r"январ\w*", "январь"),
    (2, r"феврал\w*", "февраль"),
    (3, r"март\w*", "март"),
    (4, r"апрел\w*", "апрель"),
    (5, r"ма[йяе]", "май"),
    (6, r"июн\w*", "июнь"),
    (7, r"июл\w*", "июль"),
    (8, r"август\w*", "август"),
    (9, r"сентябр\w*", "сентябрь"),
    (10, r"октябр\w*", "октябрь"),
    (11, r"ноябр\w*", "ноябрь"),
    (12, r"декабр\w*", "декабрь"),
)


def _take_recent(text: str) -> tuple[int, str]:
    """«Последние 3 заказа» — срез по свежести, не поиск слова «последние»."""
    rules = (
        (r"(?:последн\w+|недавн\w+|свеж\w+)\s+(\d{1,2})", "n"),
        (r"(\d{1,2})\s+(?:последн\w+|недавн\w+|свеж\w+)", "n"),
        (r"последн(?:ий|яя|ее|его|юю)\b", "one"),
        (r"последн\w+|недавн\w+|свеж\w+", "few"),
    )
    for pattern, kind in rules:
        found = re.search(pattern, text)
        if not found:
            continue
        count = int(found.group(1)) if kind == "n" else (1 if kind == "one" else 5)
        count = max(1, min(30, count))
        cleaned = f"{text[:found.start()]} {text[found.end():]}"
        return count, cleaned
    return 0, text


def _latest_rows(rows: list[dict[str, Any]], count: int) -> list[dict[str, Any]]:
    groups: dict[str, list[dict[str, Any]]] = {}
    for row in rows:
        oid = str(row["order"].get("id") or id(row["order"]))
        groups.setdefault(oid, []).append(row)

    def freshness(oid: str) -> date:
        days = [row["order_day"] for row in groups[oid] if row["order_day"]]
        return max(days) if days else date.min

    chosen = sorted(groups, key=freshness, reverse=True)[:count]
    out: list[dict[str, Any]] = []
    for oid in chosen:
        out.extend(groups[oid])
    return out


def _take_period(text: str) -> tuple[str, str, str]:
    rules = (
        (r"прошл\w+\s+месяц\w*", "prev_month", "прошлый месяц"),
        (r"прошл\w+\s+год\w*", "prev_year", "прошлый год"),
        (r"этот месяц|за месяц|в этом месяце|текущ\w+\s+месяц\w*", "month", "этот месяц"),
        (r"этот год|за год|в этом году", "year", "этот год"),
        (r"эту неделю|на этой неделе|за неделю|на неделе", "week", "эта неделя"),
        (r"вчера", "yesterday", "вчера"),
        (r"сегодня", "today", "сегодня"),
    )
    for pattern, key, label in rules:
        rx = re.compile(pattern)
        if rx.search(text):
            return key, label, rx.sub(" ", text)
    days = re.search(r"за\s+(\d{1,3})\s+дн", text)
    if days:
        count = max(1, min(366, int(days.group(1))))
        return f"days:{count}", f"за {count} дн.", re.sub(r"за\s+\d{1,3}\s+дн\w*", " ", text, count=1)
    named = _named_period(text, date.today())
    if named:
        return named
    return "all", "", text


def _named_period(text: str, today: date) -> tuple[str, str, str] | None:
    quarter = _quarter_period(text, today)
    if quarter:
        return quarter
    best: tuple[int, str, str, tuple[int, int]] | None = None
    for num, stem, title in _MONTHS:
        rx = re.compile(
            rf"(?:(?P<day>\d{{1,2}})(?:-?(?:го|е))?\s+)?"
            rf"(?:(?P<pre>прошл\w+)\s+)?"
            rf"(?<![а-я])(?P<month>{stem})(?![а-я])"
            rf"(?:\s+(?P<year>20\d\d))?"
            rf"(?:\s+(?P<post>прошл\w+\s+года))?"
        )
        found = rx.search(text)
        if not found:
            continue
        span = found.end() - found.start()
        if best and span <= best[0]:
            continue
        year = int(found.group("year")) if found.group("year") else today.year
        if (found.group("pre") or found.group("post")) and not found.group("year"):
            year -= 1
        elif not found.group("year") and (year, num) > (today.year, today.month):
            year -= 1
        day_n = int(found.group("day") or 0)
        try:
            picked = date(year, num, day_n) if day_n else None
        except ValueError:
            picked = None
            day_n = 0
        if picked:
            gen = ("", "января", "февраля", "марта", "апреля", "мая", "июня", "июля", "августа", "сентября", "октября", "ноября", "декабря")[num]
            key = f"day:{picked.isoformat()}"
            label = f"{picked.day} {gen} {picked.year}"
        else:
            key = f"ym:{year:04d}-{num:02d}"
            label = f"{title} {year}"
        best = (span, key, label, found.span())
    if not best:
        return None
    _, key, label, span = best
    cleaned = f"{text[:span[0]]} {text[span[1]:]}"
    return key, label, cleaned


def _quarter_period(text: str, today: date) -> tuple[str, str, str] | None:
    rules = (
        (r"(?:4|четверт\w+|iv)\s+квартал\w*", 4),
        (r"(?:3|трет\w+|iii)\s+квартал\w*", 3),
        (r"(?:2|втор\w+|ii)\s+квартал\w*", 2),
        (r"(?:1|перв\w+|\bi\b)\s+квартал\w*", 1),
        (r"прошл\w+\s+квартал\w*", 0),
        (r"(?:этот|текущ\w+|за|в)\s+квартал\w*|квартал\w*", -1),
    )
    for pattern, num in rules:
        rx = re.compile(rf"{pattern}(?:\s+(20\d\d))?")
        found = rx.search(text)
        if not found:
            continue
        year = int(found.group(1)) if found.lastindex and found.group(1) and found.group(1).isdigit() else today.year
        quarter = (today.month - 1) // 3 + 1
        if num == 0:
            quarter -= 1
            if quarter < 1:
                quarter = 4
                year -= 1
        elif num == -1:
            pass
        else:
            quarter = num
            if not (found.lastindex and found.group(1) and found.group(1).isdigit()) and (year, quarter) > (today.year, (today.month - 1) // 3 + 1):
                year -= 1
        label = f"{quarter} квартал {year}"
        cleaned = rx.sub(" ", text, count=1)
        return f"q:{year:04d}-{quarter}", label, cleaned
    return None


def _in_period(day: date | None, period: str, today: date) -> bool:
    if period == "all":
        return True
    if day is None:
        return False
    if period == "today":
        return day == today
    if period == "yesterday":
        return day == today - timedelta(days=1)
    if period == "week":
        return day.isocalendar()[:2] == today.isocalendar()[:2]
    if period == "month":
        return (day.year, day.month) == (today.year, today.month)
    if period == "year":
        return day.year == today.year
    if period == "prev_month":
        first = today.replace(day=1)
        prev = first - timedelta(days=1)
        return (day.year, day.month) == (prev.year, prev.month)
    if period == "prev_year":
        return day.year == today.year - 1
    if period.startswith("days:"):
        count = int(period.split(":", 1)[1])
        return today - timedelta(days=count - 1) <= day <= today
    if period.startswith("ym:"):
        year_s, month_s = period[3:].split("-", 1)
        return (day.year, day.month) == (int(year_s), int(month_s))
    if period.startswith("day:"):
        return day.isoformat() == period[4:]
    if period.startswith("q:"):
        year_s, quarter_s = period[2:].split("-", 1)
        start = (int(quarter_s) - 1) * 3 + 1
        return day.year == int(year_s) and start <= day.month <= start + 2
    return True


def _words(text: str) -> list[str]:
    out: list[str] = []
    for token in text.split():
        if token in _STOP:
            continue
        if token.isdigit():
            if len(token) >= 2:
                out.append(token)
            continue
        if len(token) < 3:
            continue
        out.append(token)
    return out[:8]


def _hit(blob: str, word: str) -> bool:
    if word.isdigit():
        return re.search(rf"(?<!\d){re.escape(word)}(?!\d)", blob) is not None
    if word in blob:
        return True
    return len(word) >= 5 and word[:4] in blob


def _take_names(text: str, names: list[str]) -> tuple[list[str], str]:
    hits: list[str] = []
    work = text
    for name in sorted(names, key=len, reverse=True):
        key = _norm(name)
        if len(key) < 3 or key in _STOP:
            continue
        if key not in work:
            continue
        hits.append(name)
        work = work.replace(key, " ", 1)
    return hits, work


def _customer_names(doc: dict[str, Any], rows: list[dict[str, Any]]) -> list[str]:
    names: list[str] = []
    seen: set[str] = set()
    for item in doc.get("customers") or []:
        if not isinstance(item, dict):
            continue
        for key in ("name", "organization"):
            value = str(item.get(key) or "").strip()
            mark = _norm(value)
            if mark and mark not in seen:
                seen.add(mark)
                names.append(value)
    for row in rows:
        value = row["customer"]
        mark = _norm(value)
        if mark and mark not in seen and value != "Без заказчика":
            seen.add(mark)
            names.append(value)
    return names


def _product_names(rows: list[dict[str, Any]]) -> list[str]:
    names: list[str] = []
    seen: set[str] = set()
    for row in rows:
        value = str(row["line"].get("product") or "").strip()
        mark = _norm(value)
        if mark and mark not in seen:
            seen.add(mark)
            names.append(value)
    return names


def _type_names(doc: dict[str, Any]) -> list[str]:
    names: list[str] = []
    for item in doc.get("order_types") or []:
        value = str(item.get("name") or "").strip() if isinstance(item, dict) else str(item or "").strip()
        if value:
            names.append(value)
    return names


def _take_statuses(text: str, doc: dict[str, Any]) -> tuple[set[str], str]:
    forced = "статус" in text
    hits: set[str] = set()
    work = text
    for item in doc.get("statuses") or []:
        value = str(item.get("name") or "").strip() if isinstance(item, dict) else str(item or "").strip()
        key = _norm(value)
        if len(key) < 3 or key not in work:
            continue
        if not forced and key in _STATUS_SKIP:
            continue
        hits.add(key)
        work = work.replace(key, " ", 1)
    return hits, work


def _query_numbers(text: str) -> list[str]:
    found: list[str] = []
    for match in re.finditer(r"(?<!\d)(\d+)(?!\d)", text):
        token = match.group(1)
        explicit = re.search(r"(?:заказ|номер|№)\s*$", text[: match.start()])
        if len(token) < 2 and not explicit:
            continue
        if token not in found:
            found.append(token)
    return found


def _order_hay(order: dict[str, Any]) -> str:
    parts = [str(order.get("number") or ""), str(order.get("name") or ""), str(order.get("notes") or "")]
    for line in order.get("lines") or []:
        if isinstance(line, dict):
            parts.append(str(line.get("product") or ""))
            parts.append(str(line.get("notes") or ""))
    return _norm(" ".join(parts))


def _take_orders(text: str, orders: list[Any]) -> tuple[set[str], str]:
    """Все заказы с этим номером и все, где число есть в названии. Номер может повторяться."""
    tokens = _query_numbers(text)
    if not tokens:
        return set(), text
    hits: set[str] = set()
    for order in orders:
        if not isinstance(order, dict):
            continue
        oid = str(order.get("id") or "")
        if not oid:
            continue
        hay = _order_hay(order)
        if any(re.search(rf"(?<!\d){re.escape(token)}(?!\d)", hay) for token in tokens):
            hits.add(oid)
    if not hits:
        return set(), text
    work = text
    for token in tokens:
        work = re.sub(rf"(?:заказ|номер|№)?\s*(?<!\d){re.escape(token)}(?!\d)", " ", work)
    return hits, work


def _iso(value: Any) -> date | None:
    match = re.match(r"(\d{4})-(\d{2})-(\d{2})", str(value or ""))
    if not match:
        return None
    try:
        return date(int(match.group(1)), int(match.group(2)), int(match.group(3)))
    except ValueError:
        return None


def _fmt(day: date | None) -> str:
    if not day:
        return "—"
    return f"{day.day:02d}.{day.month:02d}.{day.year}"


def _days(count: int) -> str:
    number = abs(int(count))
    tail = number % 100
    last = tail % 10
    if 10 < tail < 20:
        return "дней"
    if last == 1:
        return "день"
    if 2 <= last <= 4:
        return "дня"
    return "дней"


def _pieces(count: int, one: str, few: str, many: str) -> str:
    number = abs(int(count))
    tail = number % 100
    last = tail % 10
    if 10 < tail < 20:
        word = many
    elif last == 1:
        word = one
    elif 2 <= last <= 4:
        word = few
    else:
        word = many
    return f"{number} {word}"


def _terms(doc: dict[str, Any]) -> int:
    ui = doc.get("ui") if isinstance(doc.get("ui"), dict) else {}
    try:
        value = int(ui.get("payment_terms"))
    except (TypeError, ValueError):
        value = DEFAULT_PAYMENT_TERMS
    return max(0, min(365, value))


def _work_state(start: date | None, end: date | None, today: date) -> str:
    if not start and not end:
        return "nodate"
    if start and start > today:
        return "planned"
    if end and end <= today:
        return "done"
    return "now"


def _rows(doc: dict[str, Any]) -> list[dict[str, Any]]:
    types = type_index(doc)
    cards: dict[str, dict[str, Any]] = {}
    for item in doc.get("customers") or []:
        if isinstance(item, dict) and str(item.get("name") or "").strip():
            cards[_norm(item.get("name"))] = item
    found: list[dict[str, Any]] = []
    for order in doc.get("orders") or []:
        if not isinstance(order, dict):
            continue
        customer = str(order.get("customer") or "").strip() or "Без заказчика"
        order_start = _iso(order.get("work_start"))
        order_end = _iso(order.get("work_end"))
        for line in order.get("lines") or []:
            if not isinstance(line, dict):
                continue
            tot = line_totals(line, types, order)
            start = _iso(line.get("work_start")) or order_start
            end = _iso(line.get("work_end")) or order_end
            ordered = _iso(line.get("order_date")) or _iso(order.get("created_at"))
            paid_day = _iso(line.get("payment_date"))
            due_day = paid_day or (ordered + timedelta(days=_terms(doc)) if ordered else None)
            overdue = (date.today() - due_day).days if due_day and not tot.get("kind") else None
            card = cards.get(_norm(customer), {})
            blob = _norm(
                " ".join(
                    [
                        str(order.get("number") or ""),
                        str(order.get("name") or ""),
                        customer,
                        str(card.get("organization") or ""),
                        str(card.get("phone") or ""),
                        str(card.get("email") or ""),
                        str(card.get("address") or ""),
                        str(order.get("notes") or ""),
                        str(line.get("product") or ""),
                        str(line.get("status") or ""),
                        str(line.get("order_type") or ""),
                        str(line.get("notes") or ""),
                        str(line.get("unit") or ""),
                    ]
                )
            )
            found.append(
                {
                    "order": order,
                    "line": line,
                    "tot": tot,
                    "customer": customer,
                    "cust_key": _norm(customer),
                    "prod_key": _norm(str(line.get("product") or "")),
                    "status_key": _norm(str(line.get("status") or "")),
                    "type_key": _norm(str(line.get("order_type") or "")),
                    "order_day": ordered,
                    "pay_day": paid_day,
                    "work_day": start,
                    "work_end": end,
                    "due": due_day,
                    "overdue": overdue,
                    "cancelled": bool(_CANCEL.search(str(line.get("status") or ""))),
                    "frozen": is_frozen(line),
                    "blob": blob,
                    "state": _work_state(start, end, date.today()),
                }
            )
    return found


def _keep(
    row: dict[str, Any],
    *,
    customers: list[str],
    products: list[str],
    order_ids: set[str],
    statuses: set[str],
    types: list[str],
    pay: str,
    work_state: str,
    period: str,
    today: date,
    date_kind: str,
    words: list[str],
    any_word: bool = False,
    allow_frozen: bool = False,
) -> bool:
    if row["frozen"] and not allow_frozen:
        return False
    if order_ids and str(row["order"].get("id") or "") not in order_ids:
        return False
    if customers and row["cust_key"] not in {_norm(name) for name in customers} and not any(
        _norm(name) in row["blob"] for name in customers
    ):
        return False
    if products and row["prod_key"] not in {_norm(name) for name in products}:
        return False
    if statuses and row["status_key"] not in statuses:
        return False
    if types and row["type_key"] not in {_norm(name) for name in types}:
        return False
    if pay == "debt" and (row["tot"].get("kind") or float(row["tot"]["unpaid"]) <= 0.005):
        return False
    if pay == "paid" and (row["tot"].get("kind") or float(row["tot"]["unpaid"]) > 0.005 or float(row["tot"]["after"]) <= 0.005):
        return False
    if work_state and row["state"] != work_state:
        return False
    if period != "all":
        day = {"work": row["work_day"], "pay": row["pay_day"]}.get(date_kind, row["order_day"])
        if not _in_period(day, period, today):
            return False
    if words:
        hits = [_hit(row["blob"], word) for word in words]
        if any_word:
            if not any(hits):
                return False
        elif not all(hits):
            return False
    return True


def _delays(rows: list[dict[str, Any]], terms: int) -> tuple[float, bool, dict[str, float]]:
    acc: dict[str, list[float]] = {}
    dso_sum = 0.0
    dso_weight = 0.0
    for row in rows:
        if row["frozen"] or float(row["tot"]["paid"]) <= 0.005:
            continue
        ordered = row["order_day"]
        paid_day = row["pay_day"]
        if not ordered or not paid_day:
            continue
        lead = max(0, (paid_day - ordered).days)
        paid = float(row["tot"]["paid"])
        dso_sum += lead * paid
        dso_weight += paid
        cur = acc.setdefault(row["customer"], [0.0, 0.0])
        cur[0] += (lead - terms) * paid
        cur[1] += paid
    delays = {key: (pair[0] / pair[1] if pair[1] else 0.0) for key, pair in acc.items()}
    return (dso_sum / dso_weight if dso_weight else 0.0), dso_weight > 0, delays


def _order_ref(order: dict[str, Any]) -> str:
    num = str(order.get("number") or "").strip()
    name = str(order.get("name") or "").strip()
    bits = []
    if num:
        bits.append(num)
    if name:
        bits.append(name)
    return html_esc(" ".join(bits) or "Заказ")


def _fold(lines: list[str], hidden: list[str], count: int, one: str, few: str, many: str) -> None:
    if count <= 0 or not any(str(line).strip() for line in hidden):
        return
    label = "Показать " + _pieces(count, one, few, many)
    lines.append("<details>")
    lines.append(f"<summary>{html_esc(label)}</summary>")
    lines.extend(hidden)
    lines.append("</details>")


def _count(rows: list[dict[str, Any]], cash, *, overdue_only: bool = False) -> str:
    picked = rows
    if overdue_only:
        picked = [row for row in rows if not row["tot"].get("kind") and (row["overdue"] or 0) > 0]
    income = [row for row in picked if not row["tot"].get("kind") and not row["frozen"]]
    after = sum(float(row["tot"]["after"]) for row in income)
    paid = sum(float(row["tot"]["paid"]) for row in income)
    unpaid = sum(float(row["tot"]["unpaid"]) for row in income if not row["cancelled"])
    cost = sum(float(row["tot"]["cost"]) for row in picked if row["tot"].get("kind") and not row["frozen"])
    orders = {str(row["order"].get("id") or id(row["order"])) for row in income}
    title = "Просрочено" if overdue_only else "Коротко"
    lines = [
        f"<b>{title}</b>",
        f"• {_pieces(len(orders), 'заказ', 'заказа', 'заказов')}",
        f"• {_pieces(len(income), 'позиция', 'позиции', 'позиций')}",
        f"• к оплате {cash(after)}",
        f"• оплачено {cash(paid)}",
        f"• долг {cash(unpaid)}",
        f"• расходы {cash(cost)}",
        f"• чистыми {cash(after - cost)}",
    ]
    if not income and cost <= 0.005:
        lines.append("В этом срезе ничего нет.")
    return "\n".join(lines)


def _rank(rows: list[dict[str, Any]], cash, *, by_debt: bool = False) -> str:
    income = [row for row in rows if not row["tot"].get("kind") and not row["frozen"]]
    by_customer: dict[str, list[float]] = {}
    by_order: dict[str, dict[str, Any]] = {}
    for row in income:
        cur = by_customer.setdefault(row["customer"], [0.0, 0.0])
        cur[0] += float(row["tot"]["after"])
        cur[1] += float(row["tot"]["unpaid"])
        oid = str(row["order"].get("id") or id(row["order"]))
        item = by_order.setdefault(
            oid,
            {"order": row["order"], "customer": row["customer"], "after": 0.0, "unpaid": 0.0},
        )
        item["after"] += float(row["tot"]["after"])
        item["unpaid"] += float(row["tot"]["unpaid"])
    lines = ["<b>Крупные</b>"]
    if not income:
        lines.append("В этом срезе сумм нет.")
        return "\n".join(lines)
    key_i = 1 if by_debt else 0
    lines.append("Заказчики по долгу" if by_debt else "Заказчики по сумме")
    for name, (after, unpaid) in sorted(by_customer.items(), key=lambda pair: -pair[1][key_i])[:5]:
        lines.append(f"• {html_esc(name)} · {cash(after)} · долг {cash(unpaid)}")
    lines.append("Заказы по долгу" if by_debt else "Заказы по сумме")
    for item in sorted(by_order.values(), key=lambda bit: -(bit["unpaid"] if by_debt else bit["after"]))[:5]:
        lines.append(
            f"• {_order_ref(item['order'])} · {html_esc(item['customer'])} · {cash(item['after'])} · долг {cash(item['unpaid'])}"
        )
    return "\n".join(lines)


def _statuses(rows: list[dict[str, Any]], cash) -> str:
    acc: dict[str, list[float]] = {}
    for row in rows:
        if row["frozen"] or row["tot"].get("kind"):
            continue
        name = str(row["line"].get("status") or "").strip() or "Без статуса"
        cur = acc.setdefault(name, [0.0, 0.0, 0.0])
        cur[0] += 1
        cur[1] += float(row["tot"]["after"])
        cur[2] += float(row["tot"]["unpaid"])
    ranked = sorted(acc.items(), key=lambda pair: -pair[1][0])
    lines = [f"<b>Статусы</b> · {len(ranked)}"]
    status_lines = [
        f"• {html_esc(name)} · {_pieces(int(count), 'позиция', 'позиции', 'позиций')} · {cash(after)} · долг {cash(unpaid)}"
        for name, (count, after, unpaid) in ranked
    ]
    lines.extend(status_lines[:24])
    _fold(lines, status_lines[24:], len(status_lines) - 24, "статус", "статуса", "статусов")
    if not ranked:
        lines.append("Статусов в этом срезе нет.")
    return "\n".join(lines)


def _discounts(rows: list[dict[str, Any]], cash) -> str:
    hits = [
        row
        for row in rows
        if not row["frozen"] and not row["tot"].get("kind") and float(row["tot"].get("discount") or 0) > 0.005
    ]
    hits.sort(key=lambda row: -float(row["tot"].get("discount") or 0))
    lines = [f"<b>Скидки</b> · {len(hits)}"]
    for row in hits:
        disc = float(row["tot"].get("discount") or 0)
        percent = f"{disc:.2f}".rstrip("0").rstrip(".")
        product = html_esc(str(row["line"].get("product") or "позиция"))
        lines.append(f"• {_order_ref(row['order'])} · {product} · {percent} % · {cash(float(row['tot']['after']))}")
    if not hits:
        lines.append("Скидок в этом срезе нет.")
    return "\n".join(lines)


def _summary(doc: dict[str, Any], rows: list[dict[str, Any]], today: date, cash, terms: int, delays: tuple[float, bool, dict[str, float]], period: str = "all") -> str:
    income = [row for row in rows if not row["tot"].get("kind")]
    after = sum(float(row["tot"]["after"]) for row in income)
    paid = sum(float(row["tot"]["paid"]) for row in income)
    unpaid = sum(float(row["tot"]["unpaid"]) for row in income)
    cost = sum(float(row["tot"]["cost"]) for row in rows if row["tot"].get("kind"))
    orders = {str(row["order"].get("id") or id(row["order"])) for row in income}
    checks = [float(row["tot"]["after"]) for row in income if float(row["tot"]["after"]) > 0.005]
    avg = sum(checks) / len(checks) if checks else 0.0
    month = [row for row in income if _in_period(row["order_day"], "month", today)]
    prev_key_day = today.replace(day=1) - timedelta(days=1)
    prev = [row for row in income if row["order_day"] and (row["order_day"].year, row["order_day"].month) == (prev_key_day.year, prev_key_day.month)]
    month_after = sum(float(row["tot"]["after"]) for row in month)
    prev_after = sum(float(row["tot"]["after"]) for row in prev)
    dso, known, _ = delays
    lines = [
        "<b>Сводка</b>",
        f"{_pieces(len(orders), 'заказ', 'заказа', 'заказов')} · {_pieces(len(income), 'позиция', 'позиции', 'позиций')}",
        f"К оплате {cash(after)} · оплачено {cash(paid)} · долг {cash(unpaid)}",
        f"Расходы {cash(cost)} · чистыми {cash(after - cost)}",
        f"Средний чек {cash(avg)} · собираемость {html_esc(_share(paid, after))}",
    ]
    if period == "all":
        lines.append(f"Этот месяц {cash(month_after)} · прошлый {cash(prev_after)}")
    if period == "all" and today.day:
        dim = (today.replace(day=1) + timedelta(days=32)).replace(day=1) - timedelta(days=1)
        forecast = month_after / today.day * dim.day if today.day else 0
        lines.append(f"Прогноз месяца {cash(forecast)}")
    lines.append(
        f"Средний срок оплаты {int(round(dso))} {_days(int(round(dso)))}"
        if known
        else f"Срок оплаты по договорённости {terms} {_days(terms)}, истории оплат ещё нет"
    )
    return "\n".join(lines)


def _share(part: float, whole: float) -> str:
    if whole <= 0.005:
        return "—"
    return f"{round(part / whole * 100)}%"


def _bucket(overdue: int | None) -> str:
    if overdue is None:
        return "nodate"
    if overdue <= 0:
        return "future"
    if overdue <= 7:
        return "d7"
    if overdue <= 30:
        return "d30"
    if overdue <= 60:
        return "d60"
    return "d60p"


def _debts(
    rows: list[dict[str, Any]],
    today: date,
    terms: int,
    delays: tuple[float, bool, dict[str, float]],
    cash,
    *,
    overdue_only: bool,
    incoming: bool,
    period: str,
) -> str:
    _, _, delay_map = delays
    items = []
    cancelled = 0.0
    for row in rows:
        if row["tot"].get("kind"):
            continue
        unpaid = float(row["tot"]["unpaid"])
        if unpaid <= 0.005:
            continue
        if row["cancelled"]:
            cancelled += unpaid
            continue
        delay = int(round(delay_map.get(row["customer"]) or 0))
        due = row["due"]
        expected = None
        if due:
            shifted = due + timedelta(days=max(0, delay))
            expected = shifted if shifted > today else today
        items.append((row, unpaid, expected, delay))
    if overdue_only:
        items = [item for item in items if (item[0]["overdue"] or 0) > 0]
    if incoming:
        horizon = 7
        if period.startswith("days:"):
            horizon = int(period.split(":", 1)[1])
        elif period == "month":
            horizon = 30
        items = [item for item in items if item[2] and (item[2] - today).days <= horizon]
    items.sort(key=lambda item: ((item[0]["due"] or date.max), -item[1]))
    total = sum(item[1] for item in items)
    overdue_sum = sum(item[1] for item in items if (item[0]["overdue"] or 0) > 0)
    overdue_n = sum(1 for item in items if (item[0]["overdue"] or 0) > 0)
    orders = {str(item[0]["order"].get("id") or id(item[0]["order"])) for item in items}
    lines = [
        "<b>Долги</b>",
        f"Дебиторка {cash(total)} · {_pieces(len(items), 'позиция', 'позиции', 'позиций')} в {_pieces(len(orders), 'заказе', 'заказах', 'заказах')}",
        f"Просрочено {cash(overdue_sum)} · {_pieces(overdue_n, 'позиция', 'позиции', 'позиций')}",
        f"Срок по договорённости {terms} {_days(terms)}",
    ]
    if cancelled > 0.005:
        lines.append(f"Отменённые {cash(cancelled)} в дебиторку не входят")
    for key, label in _BUCKETS:
        bucket_sum = sum(item[1] for item in items if _bucket(item[0]["overdue"]) == key)
        if bucket_sum > 0.005:
            lines.append(f"• {label}: {cash(bucket_sum)}")
    grouped: dict[str, list[tuple[dict[str, Any], float, date | None, int]]] = {}
    for item in items:
        grouped.setdefault(item[0]["customer"], []).append(item)
    ranked = sorted(grouped.items(), key=lambda pair: -sum(bit[1] for bit in pair[1]))

    def write_people(target: list[str], people: list) -> None:
        for customer, bits in people:
            target.append(f"\n<b>{html_esc(customer)}</b> — {cash(sum(bit[1] for bit in bits))}")
            for row, amount, _expected, _delay in bits:
                due = _fmt(row["due"])
                late = row["overdue"]
                mark = "срок не задан" if late is None else ("срок ещё не вышел" if late <= 0 else f"просрочка {late} {_days(late)}")
                product = html_esc(str(row["line"].get("product") or "позиция"))
                target.append(f"• {_order_ref(row['order'])} · {product} · {html_esc(qty_text(row['line']))} · {due} · {mark} · {cash(amount)}")

    write_people(lines, ranked[:12])
    hidden_people: list[str] = []
    write_people(hidden_people, ranked[12:])
    _fold(lines, hidden_people, max(0, len(ranked) - 12), "заказчик", "заказчика", "заказчиков")
    if not items:
        lines.append("Неоплаченных позиций нет.")
    return "\n".join(lines)


def _orders(rows: list[dict[str, Any]], cash) -> str:
    grouped: dict[str, list[dict[str, Any]]] = {}
    costs: dict[str, list[dict[str, Any]]] = {}
    order_of: dict[str, dict[str, Any]] = {}
    for row in rows:
        oid = str(row["order"].get("id") or id(row["order"]))
        order_of[oid] = row["order"]
        if row["tot"].get("kind"):
            costs.setdefault(oid, []).append(row)
            continue
        grouped.setdefault(oid, []).append(row)
    lines = [f"<b>Заказы</b> · {len(grouped)}"]
    if not grouped:
        lines.append("Подходящих заказов нет.")
        return "\n".join(lines)
    pairs = list(grouped.items())

    def write_orders(target: list[str], chunk: list) -> None:
        for oid, bits in chunk:
            order = order_of[oid]
            after = sum(float(row["tot"]["after"]) for row in bits)
            paid = sum(float(row["tot"]["paid"]) for row in bits)
            unpaid = sum(float(row["tot"]["unpaid"]) for row in bits)
            state = bits[0]["state"]
            state_label = {"now": "в работе", "planned": "запланирован", "done": "закрыт", "nodate": "без дат"}[state]
            target.append(
                f"\n<b>{_order_ref(order)}</b> · {html_esc(bits[0]['customer'])} · {state_label}\n"
                f"к оплате {cash(after)} · оплачено {cash(paid)} · долг {cash(unpaid)}"
            )
            note = str(order.get("notes") or "").strip()
            if note:
                target.append("заметка: " + html_esc(note))
            for row in bits:
                line = row["line"]
                status = str(line.get("status") or "").strip()
                extra = f" · {html_esc(status)}" if status else ""
                when = _fmt(row["order_day"])
                target.append(
                    f"• {html_esc(str(line.get('product') or 'позиция'))} · {html_esc(qty_text(line))} · "
                    f"{cash(float(row['tot']['after']))} · долг {cash(float(row['tot']['unpaid']))} · {when}{extra}"
                )
                comment = str(line.get("notes") or "").strip()
                if comment:
                    target.append("  " + html_esc(comment))
            for row in costs.get(oid) or []:
                kind = "налог" if row["tot"].get("kind") == "tax" else "затрата"
                target.append(
                    f"• {html_esc(str(row['line'].get('product') or kind))} · {kind} · {cash(float(row['tot']['cost']))}"
                )

    write_orders(lines, pairs[:12])
    hidden_orders: list[str] = []
    write_orders(hidden_orders, pairs[12:])
    _fold(lines, hidden_orders, max(0, len(pairs) - 12), "заказ", "заказа", "заказов")
    return "\n".join(lines)


def _work(rows: list[dict[str, Any]], today: date, only: str) -> str:
    orders: dict[str, dict[str, Any]] = {}
    for row in rows:
        if row["frozen"] or row["tot"].get("kind"):
            continue
        oid = str(row["order"].get("id") or id(row["order"]))
        start = _iso(row["order"].get("work_start")) or row["work_day"]
        end = _iso(row["order"].get("work_end")) or row["work_end"]
        state = _work_state(start, end, today)
        current = orders.get(oid)
        if current is None:
            orders[oid] = {"order": row["order"], "customer": row["customer"], "start": start, "end": end, "state": state}
    counts = {key: 0 for key in ("now", "planned", "done", "nodate")}
    for item in orders.values():
        counts[item["state"]] += 1
    lines = [
        "<b>Календарь</b>",
        f"В работе {counts['now']} · план {counts['planned']} · закрыто {counts['done']} · без дат {counts['nodate']}",
    ]
    labels = (("now", "В работе"), ("planned", "Запланировано"), ("done", "Закрыто"), ("nodate", "Без дат"))
    for key, label in labels:
        if only and key != only:
            continue
        chunk = [item for item in orders.values() if item["state"] == key]
        if not chunk:
            continue
        lines.append(f"\n<b>{label}</b>")
        for item in chunk:
            end = "без конца" if not item["end"] else f"до {_fmt(item['end'])}"
            start = "без старта" if not item["start"] else f"с {_fmt(item['start'])}"
            lines.append(f"• {_order_ref(item['order'])} · {html_esc(item['customer'])} · {start} · {end}")
    return "\n".join(lines)


def _customers(doc: dict[str, Any], rows: list[dict[str, Any]], cash) -> str:
    book: dict[str, dict[str, Any]] = {}
    for item in doc.get("customers") or []:
        if isinstance(item, dict) and str(item.get("name") or "").strip():
            book[_norm(item.get("name"))] = item
    grouped: dict[str, list[dict[str, Any]]] = {}
    for row in rows:
        if row["frozen"]:
            continue
        grouped.setdefault(row["customer"], []).append(row)
    lines = [f"<b>Заказчики</b> · {len(grouped)}"]
    ranked = sorted(
        grouped.items(),
        key=lambda pair: -sum(float(row["tot"]["unpaid"]) for row in pair[1] if not row["tot"].get("kind")),
    )
    def write_customers(target: list[str], people: list) -> None:
        for customer, bits in people:
            card = book.get(_norm(customer), {})
            unpaid = sum(float(row["tot"]["unpaid"]) for row in bits if not row["tot"].get("kind") and not row["cancelled"])
            orders = {str(row["order"].get("id") or id(row["order"])) for row in bits}
            target.append(f"\n<b>{html_esc(customer)}</b> · долг {cash(unpaid)} · {_pieces(len(orders), 'заказ', 'заказа', 'заказов')}")
            org = str(card.get("organization") or "").strip()
            phone = str(card.get("phone") or "").strip()
            email = str(card.get("email") or "").strip()
            address = str(card.get("address") or "").strip()
            extra = " · ".join(html_esc(bit) for bit in (org, phone, email, address) if bit)
            if extra:
                target.append(extra)

    write_customers(lines, ranked[:20])
    hidden_customers: list[str] = []
    write_customers(hidden_customers, ranked[20:])
    _fold(lines, hidden_customers, max(0, len(ranked) - 20), "заказчик", "заказчика", "заказчиков")
    if not grouped:
        lines.append("Заказчиков в этом срезе нет.")
    return "\n".join(lines)


def _products(rows: list[dict[str, Any]], cash) -> str:
    acc: dict[str, list[float]] = {}
    for row in rows:
        if row["frozen"] or row["tot"].get("kind"):
            continue
        name = str(row["line"].get("product") or "").strip() or "Без продукта"
        cur = acc.setdefault(name, [0.0, 0.0, 0.0])
        cur[0] += float(row["tot"]["after"])
        cur[1] += float(row["tot"]["paid"])
        cur[2] += float(row["tot"]["unpaid"])
    ranked = sorted(acc.items(), key=lambda pair: -pair[1][0])
    lines = [f"<b>Продукты</b> · {len(ranked)}"]
    product_lines = [
        f"• {html_esc(name)} · {cash(after)} · оплачено {cash(paid)} · долг {cash(unpaid)}"
        for name, (after, paid, unpaid) in ranked
    ]
    lines.extend(product_lines[:20])
    _fold(lines, product_lines[20:], len(product_lines) - 20, "продукт", "продукта", "продуктов")
    if not ranked:
        lines.append("Продуктов в этом срезе нет.")
    return "\n".join(lines)


def _expenses(rows: list[dict[str, Any]], matched: list[dict[str, Any]], customers: list[str], order_ids: set[str], cash) -> str:
    order_filter = {str(row["order"].get("id") or "") for row in matched}
    lines_out = ["<b>Расходы</b>"]
    total = 0.0
    kept: list[str] = []
    for row in rows:
        if row["frozen"] or not row["tot"].get("kind"):
            continue
        if customers and row["cust_key"] not in {_norm(name) for name in customers}:
            continue
        if order_ids and str(row["order"].get("id") or "") not in order_ids:
            continue
        if order_filter and str(row["order"].get("id") or "") not in order_filter and (customers or order_ids):
            continue
        amount = float(row["tot"]["cost"])
        total += amount
        kind = "налог" if row["tot"].get("kind") == "tax" else "затрата"
        kept.append(f"• {_order_ref(row['order'])} · {html_esc(str(row['line'].get('product') or kind))} · {kind} · {cash(amount)}")
    count = len(kept)
    lines_out.insert(1, f"{_pieces(count, 'строка', 'строки', 'строк')} · {cash(total)}")
    lines_out.extend(kept[:24])
    _fold(lines_out, kept[24:], count - 24, "строка", "строки", "строк")
    if count == 0:
        lines_out.append("Расходных строк нет.")
    return "\n".join(lines_out)


def _notes(rows: list[dict[str, Any]]) -> str:
    lines = ["<b>Заметки</b>"]
    seen: set[str] = set()
    for row in rows:
        oid = str(row["order"].get("id") or id(row["order"]))
        note = str(row["order"].get("notes") or "").strip()
        if note and oid not in seen:
            seen.add(oid)
            lines.append(f"• {_order_ref(row['order'])}: {html_esc(note)}")
        comment = str(row["line"].get("notes") or "").strip()
        if comment:
            lines.append(f"• {_order_ref(row['order'])} · {html_esc(str(row['line'].get('product') or 'позиция'))}: {html_esc(comment)}")
    if len(lines) == 1:
        lines.append("Заметок нет.")
    return "\n".join(lines)


def _frozen(rows: list[dict[str, Any]], customers: list[str], products: list[str], order_ids: set[str]) -> str:
    lines = ["<b>Замороженные</b>"]
    count = 0
    for row in rows:
        if not row["frozen"]:
            continue
        if customers and row["cust_key"] not in {_norm(name) for name in customers}:
            continue
        if products and row["prod_key"] not in {_norm(name) for name in products}:
            continue
        if order_ids and str(row["order"].get("id") or "") not in order_ids:
            continue
        count += 1
        lines.append(f"• {_order_ref(row['order'])} · {html_esc(str(row['line'].get('product') or 'позиция'))} · {html_esc(row['customer'])}")
    if count == 0:
        lines.append("Замороженных позиций нет.")
    else:
        lines.insert(1, f"{_pieces(count, 'позиция', 'позиции', 'позиций')} — в итоги не входят")
    return "\n".join(lines)


def _reminder(rows: list[dict[str, Any]], doc: dict[str, Any], terms: int, cash) -> str:
    items = [
        row
        for row in rows
        if not row["frozen"] and not row["tot"].get("kind") and not row["cancelled"] and float(row["tot"]["unpaid"]) > 0.005
    ]
    if not items:
        return "<b>Напоминание</b>\nНеоплаченных позиций для текста нет."
    by_customer: dict[str, list[dict[str, Any]]] = {}
    for row in items:
        by_customer.setdefault(row["customer"], []).append(row)
    blocks = ["<b>Напоминание</b>"]
    for customer, bits in by_customer.items():
        total = sum(float(row["tot"]["unpaid"]) for row in bits)
        blocks.append(f"\nЗдравствуйте, {html_esc(customer)}!")
        blocks.append("Напоминаем об оплате:")
        by_order: dict[str, list[dict[str, Any]]] = {}
        for row in bits:
            by_order.setdefault(str(row["order"].get("id") or id(row["order"])), []).append(row)
        for chunk in by_order.values():
            order = chunk[0]["order"]
            amount = sum(float(row["tot"]["unpaid"]) for row in chunk)
            due = min((row["due"] for row in chunk if row["due"]), default=None)
            worst = max((row["overdue"] or 0) for row in chunk)
            due_text = ""
            if due:
                due_text = f", срок {_fmt(due)}"
                if worst > 0:
                    due_text += f", просрочка {worst} {_days(worst)}"
            blocks.append(f"{_order_ref(order)} — остаток {cash(amount)}{due_text}")
            for row in chunk:
                blocks.append(f"  • {html_esc(str(row['line'].get('product') or 'позиция'))} — {cash(float(row['tot']['unpaid']))}")
        blocks.append(f"Итого к оплате: {cash(total)}")
        blocks.append(f"Срок оплаты — {terms} {_days(terms)} от даты заказа.")
    return "\n".join(blocks)
