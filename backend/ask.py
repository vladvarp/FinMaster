"""Ответы Telegram-бота по открытому отчёту.

Просьба голосом или текстом режется на срез тех же сумм, что на экране:
долги и старение как в кассе, заказы, календарь работ, заказчики, расходы.
"""

from __future__ import annotations

import re
from datetime import date, timedelta
from typing import Any

from backend import dictionary
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
        hints: list[str] | None = None,
        suggestions: list[str] | None = None,
        template_source: str = "",
    ) -> None:
        self.html = html
        self.action = action
        self.target = target
        self.kind = kind
        self.order_ids = order_ids or []
        self.needs_report = needs_report
        self.hide_totals = hide_totals
        self.hints = hints or []
        self.suggestions = suggestions or []
        self.template_source = template_source


def help_text(surface: str = "bot") -> str:
    book, _status = dictionary.for_parse()
    return dictionary.help_html(book, "desk" if surface == "desk" else "bot")


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


_FILLER = {"весь", "вся", "все", "всего", "целиком", "полностью"}
_SLICE_ORDER = (
    "count",
    "rank",
    "summary",
    "money",
    "status",
    "discount",
    "debt",
    "overdue",
    "incoming",
    "orders",
    "lines",
    "work",
    "customers",
    "products",
    "expense",
    "notes",
    "frozen",
    "remind",
    "vault",
)


def blocks_order_search(text: str) -> bool:
    """«все», «весь», «весь отчёт» не становятся текстовым фильтром списка заказов."""
    low = _norm(text)
    if not low:
        return False
    return not [token for token in low.split() if token not in _STOP and token not in _FILLER]


def _loose_tokens(text: str, source: dict[str, Any], rows: list[dict[str, Any]]) -> list[str]:
    _period, _label, text = _take_period(text)
    _recent, text = _take_recent(text)
    _customers, text = _take_names(text, _customer_names(source, rows))
    _products, text = _take_names(text, _product_names(rows))
    _orders, text = _take_orders(text, source.get("orders") or [])
    _statuses, text = _take_statuses(text, source)
    _types, text = _take_names(text, _type_names(source))
    return [
        token
        for token in text.split()
        if token not in _STOP and token not in _FILLER and not token.isdigit() and len(token) >= 3
    ]


def _match_command(
    text: str,
    book: dict[str, Any],
    surface: str,
    source: dict[str, Any],
    rows: list[dict[str, Any]],
) -> tuple[dict[str, Any] | None, str]:
    """Самая длинная фраза. Остаток — срок, имя, продукт, номер, ключевое слово или пусто."""
    tokens = text.split()
    best: tuple[tuple[int, int, int, int], dict[str, Any], str] | None = None
    for cmd in dictionary.commands_for(book, surface):
        narrow = cmd.get("id") in {"count", "rank"}
        for phrase in cmd.get("phrases") or []:
            phrase_tokens = dictionary.normalize(phrase).split()
            size = len(phrase_tokens)
            if not size:
                continue
            for index in range(len(tokens) - size + 1):
                if tokens[index : index + size] != phrase_tokens:
                    continue
                rest = " ".join(tokens[:index] + tokens[index + size :])
                _delivery, _hide, cleaned = dictionary.take_keywords(rest, book, surface)
                probe = cleaned
                if "vault" in (cmd.get("slices") or []) or (
                    cmd.get("answer") == "template" and "slice:vault" in str(cmd.get("template") or "")
                ):
                    _vault_types, _vault_pages, probe = _take_vault_words(probe, source)
                if not narrow and _loose_tokens(probe, source, rows):
                    continue
                rank = (-size, 0 if narrow else 1, index, -len(" ".join(phrase_tokens)))
                if best is None or rank < best[0]:
                    best = (rank, cmd, rest)
    if not best:
        return None, ""
    return best[1], best[2]


def _read_filters(text: str, source: dict[str, Any], rows: list[dict[str, Any]]):
    period, period_label, text = _take_period(text)
    recent_n, text = _take_recent(text)
    customers, text = _take_names(text, _customer_names(source, rows))
    products, text = _take_names(text, _product_names(rows))
    order_ids, text = _take_orders(text, source.get("orders") or [])
    statuses, text = _take_statuses(text, source)
    types, text = _take_names(text, _type_names(source))
    return text, period, period_label, recent_n, customers, products, order_ids, statuses, types


def _expand_words(words: list[str], book: dict[str, Any]) -> tuple[list[str], list[list[str]]]:
    show: list[str] = []
    groups: list[list[str]] = []
    for word in words:
        if "\x1f" in word:
            left, right = word.split("\x1f", 1)
            pairs: list[str] = []
            seen: set[str] = set()
            for alt in dictionary.synonym_values(book, left):
                if not alt or " " in alt or not re.fullmatch(r"[a-zа-я]+", alt):
                    continue
                pair = f"{alt}\x1f{right}"
                if pair in seen:
                    continue
                seen.add(pair)
                pairs.append(pair)
            show.append(f"{left} {right}")
            groups.append(pairs or [word])
            continue
        show.append(word)
        groups.append(dictionary.synonym_values(book, word))
    return show, groups


def _hint_rows(
    text: str,
    doc: dict[str, Any] | None,
    surface: str = "desk",
    book: dict[str, Any] | None = None,
) -> list[dict[str, str]]:
    if book is None:
        book, _status = dictionary.for_parse()
    query = _norm(text)
    if not query:
        return []
    surface_key = "desk" if surface == "desk" else "bot"
    found: list[tuple[int, str, str]] = []

    def add(score: int, title: str, sub: str) -> None:
        if score <= 0 or not title:
            return
        found.append((score, title, sub))

    def score(phrase: str) -> int:
        mark = dictionary.normalize(phrase)
        if not mark:
            return 0
        if mark == query:
            return 50
        if mark.startswith(query):
            return 80 + min(len(query), 20)
        shared = 0
        for left, right in zip(query, mark):
            if left != right:
                break
            shared += 1
        if shared >= 3:
            return 20 + shared
        return 0

    for cmd in dictionary.commands_for(book, surface_key):
        if cmd.get("id") == "help":
            continue
        for phrase in cmd.get("phrases") or []:
            add(score(str(phrase)), str(phrase), "команда")
    action_title = {key: title for key, title in dictionary.ACTIONS}
    for row in book.get("keywords") or []:
        if not dictionary.surface_on(row, surface_key):
            continue
        add(score(str(row.get("word") or "")), str(row.get("word") or ""), action_title.get(str(row.get("action") or ""), "слово"))
    for row in book.get("synonyms") or []:
        if not row.get("enabled"):
            continue
        label = ", ".join(str(item) for item in (row.get("values") or [])[:4])
        for word in row.get("words") or []:
            add(score(str(word)), str(word), label or "синоним")
    source = doc if isinstance(doc, dict) else {}
    rows = _rows(source) if source else []
    for name in _customer_names(source, rows)[:80]:
        add(score(name), name, "заказчик")
    for name in _product_names(rows)[:80]:
        add(score(name), name, "продукт")
    seen_numbers: set[str] = set()
    for order in source.get("orders") or []:
        if not isinstance(order, dict):
            continue
        number = str(order.get("number") or "").strip()
        if number and number not in seen_numbers:
            seen_numbers.add(number)
            add(score(number), number, "номер")
    found.sort(key=lambda item: (-item[0], item[1]))
    out: list[dict[str, str]] = []
    seen: set[str] = set()
    for _score, title, sub in found:
        key = dictionary.normalize(title)
        if key in seen:
            continue
        seen.add(key)
        out.append({"title": title, "sub": sub})
        if len(out) >= 8:
            break
    return out


def parse(
    text: str,
    doc: dict[str, Any] | None,
    *,
    voice: bool = False,
    live: bool = False,
    surface: str = "bot",
    book: dict[str, Any] | None = None,
) -> Reply | None:
    low = _norm(text)
    if not low:
        return Reply(html="Не разобрал речь. Скажите ещё раз или напишите вопрос.") if voice else None
    surface_key = "desk" if surface == "desk" else "bot"
    if book is None:
        book, _dict_status = dictionary.for_parse()
    else:
        checked = dictionary.validate(book)
        book = checked if checked is not None else dictionary.for_parse()[0]
    opened = re.match(r"^(?:открой|открыть|выбери)\s+отч[её]т\s+(.+)$", low)
    if opened:
        return Reply(action="open_report", target=opened.group(1).strip())

    source = doc if isinstance(doc, dict) else {}
    today = date.today()
    rows = _rows(source)
    cmd, command_rest = _match_command(low, book, surface_key, source, rows)
    if cmd and cmd.get("answer") == "help":
        return Reply(html=dictionary.help_html(book, surface_key))
    if cmd and cmd.get("answer") == "action":
        action_name = str(cmd.get("action") or "")
        return Reply(action=action_name, needs_report=action_name in {"orders", "snap", "pc"})

    guided = cmd is not None
    template_source = str(cmd.get("template") or "") if cmd and cmd.get("answer") == "template" else ""
    cmd_answer = str(cmd.get("answer") or "") if cmd else ""
    if guided:
        delivery, hide_totals, raw = dictionary.take_keywords(command_rest, book, surface_key)
        if not delivery and cmd.get("delivery"):
            delivery = str(cmd.get("delivery") or "")
        if cmd_answer == "snap" and not delivery:
            delivery = {"pdf": "pdf", "text": "text"}.get(str(cmd.get("snapKind") or ""), "photo")
        if cmd_answer == "snap" and cmd.get("snapHide"):
            hide_totals = True
    else:
        delivery, hide_totals, raw = dictionary.take_keywords(low, book, surface_key)
    kind = {"pdf": "pdf", "text": "text", "photo": "png"}.get(delivery, "png")
    snap = delivery in {"pdf", "text", "photo"}
    raw, period, period_label, recent_n, customers, products, order_ids, statuses, types = _read_filters(raw, source, rows)
    if guided and cmd and cmd.get("id") in {"count", "rank"}:
        _ignored_topics, raw = _topics(raw)
    pay = _pay_mode(low)
    work_state = _work_mode(low)
    remind = bool(re.search(r"напомн", low)) and dictionary.enabled_command(book, "remind", surface_key)
    show_words, words = _expand_words(_words(raw, book), book)
    slice_order = list(_SLICE_ORDER)
    if guided:
        explicit = set(cmd.get("slices") or [])
        if cmd_answer == "slices":
            slice_order = [key for key in (cmd.get("slices") or []) if key in explicit]
        elif cmd_answer == "snap":
            explicit = set(cmd.get("slices") or []) or {"snap"}
            slice_order = list(cmd.get("slices") or [])
        else:
            explicit = set()
        asked = True
    else:
        topics, raw_left = _topics(raw)
        topics = {flag for flag in topics if dictionary.topic_allowed(book, flag, surface_key)}
        raw = raw_left
        show_words, words = _expand_words(_words(raw, book), book)
        explicit = set(topics)
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
        if not asked and words and any(
            all(any(_hit(row["blob"], part) for part in group) for group in words) for row in rows if not row["frozen"]
        ):
            asked = True
        if not asked:
            hints = [item["title"] for item in _hint_rows(low, source, surface_key)]
            if hints:
                return Reply(suggestions=hints[:6])
            return None
        if not explicit:
            if remind:
                explicit.add("remind")
            elif snap and not show_words:
                explicit.add("snap")
            elif order_ids and not (customers or products or show_words or statuses or types):
                explicit.add("orders")
            elif customers and not show_words:
                explicit.update({"customers", "debt"})
            elif products and not show_words:
                explicit.add("products")
            elif statuses:
                explicit.update({"status", "orders"})
            elif show_words or types or recent_n:
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

    vault_asked = "vault" in explicit or (guided and "slice:vault" in template_source)
    vault_types: set[str] = set()
    vault_pages: set[str] = set()
    if vault_asked:
        vault_types, vault_pages, raw = _take_vault_words(raw, source)
        saved_page = str(cmd.get("vaultPage") or "") if cmd else ""
        if saved_page:
            chosen = {_norm(name) for name in _vault_page_names(source, saved_page)}
            if chosen:
                vault_pages = chosen if not vault_pages else vault_pages & chosen
        show_words, words = _expand_words(_words(raw, book), book)
    vault_stats = [
        key
        for key, _title in dictionary.VAULT_STATS
        if cmd and key in set(cmd.get("vaultStats") or [])
    ]
    vault_totals_only = bool(cmd.get("vaultTotalsOnly")) if cmd else False

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
    head = _header(title, live, explicit, customers, products, order_ids, period_label, pay, work_state, show_words, recent_label)
    if not rows and "snap" not in explicit and not vault_asked:
        return Reply(
            html=f"{head}\nВ отчёте пока нет позиций.",
            needs_report=True,
        )
    if not matched and explicit != {"snap"} and "snap" not in explicit and not vault_asked:
        tail = f"За {html_esc(period_label)} в отчёте ничего нет." if period_label else "В отчёте по этой просьбе ничего нет."
        understood = bool(explicit or customers or products or order_ids or statuses or types or period != "all" or pay or work_state or recent_n)
        if (voice or _ASK.search(low)) and not understood:
            tail += "\n" + dictionary.help_html(book, surface_key)
        return Reply(html=f"{head}\n{tail}", needs_report=True)

    parts = [head]
    cur = str(source.get("currency") or "₽")
    decimals = money_decimals(source.get("money_decimals"))

    def cash(value: float) -> str:
        return html_esc(money(value, cur, decimals))

    if guided and cmd_answer == "metrics":
        label = str((cmd or {}).get("phrases", ["Показатели"])[0] or "Показатели")
        parts.append(_metrics_html(label, (cmd or {}).get("metrics") or [], source, matched, today, cash, terms, delays, period, markdown=delivery == "md"))
    elif guided and cmd_answer == "template":
        parts.append(_template_html(
            template_source, source, matched, rows, today, cash, terms, delays, period,
            customers, products, order_ids, work_state, hide_totals, vault_types, vault_pages,
            vault_stats, vault_totals_only,
            cmd.get("sliceOpts") if isinstance(cmd.get("sliceOpts"), dict) else None,
        ))
    else:
        def picks_for(key: str) -> set[str] | None:
            if not guided or not cmd:
                return None
            opts = cmd.get("sliceOpts")
            if not isinstance(opts, dict) or key not in opts:
                return None
            allowed = {fid for fid, _title in dictionary.SLICE_TOGGLES.get(key, ())}
            return {str(item) for item in (opts.get(key) or []) if str(item) in allowed}

        rendered: set[str] = set()
        for key in slice_order:
            if key == "money":
                key = "summary"
            if key in rendered:
                continue
            if key not in explicit and not (key == "summary" and "money" in explicit):
                continue
            rendered.add(key)
            if not guided and key in {"overdue", "incoming", "lines"}:
                continue
            if key == "count":
                parts.append(_count(matched, cash, overdue_only="overdue" in explicit and "debt" not in explicit and not guided, picks=picks_for(key)))
            elif key == "rank":
                parts.append(_rank(matched, cash, by_debt=bool(re.search(r"долг|долж", low)), picks=picks_for(key)))
            elif key == "summary":
                parts.append(_summary(source, matched, today, cash, terms, delays, period, picks_for(key)))
            elif key == "status":
                parts.append(_statuses(matched, cash, picks_for(key)))
            elif key == "discount":
                parts.append(_discounts(matched, cash, picks_for(key)))
            elif key == "debt":
                parts.append(
                    _debts(
                        matched,
                        today,
                        terms,
                        delays,
                        cash,
                        overdue_only=False if guided else "overdue" in explicit,
                        incoming=False if guided else "incoming" in explicit,
                        period=period,
                        picks=picks_for(key),
                    )
                )
            elif key == "overdue":
                parts.append(_debts(matched, today, terms, delays, cash, overdue_only=True, incoming=False, period=period, picks=picks_for(key)))
            elif key == "incoming":
                parts.append(_debts(matched, today, terms, delays, cash, overdue_only=False, incoming=True, period=period, picks=picks_for(key)))
            elif key == "orders":
                parts.append(_orders(matched, cash, picks_for(key)))
            elif key == "lines":
                parts.append(_orders(matched, cash, picks_for(key)).replace("<b>Заказы</b>", "<b>Позиции</b>", 1))
            elif key == "work":
                parts.append(_work(matched if work_state or period != "all" else rows, today, work_state, picks_for(key)))
            elif key == "customers":
                parts.append(_customers(source, matched if customers or words or products else rows, cash, picks_for(key)))
            elif key == "products":
                parts.append(_products(matched, cash, picks_for(key)))
            elif key == "expense":
                parts.append(_expenses(rows, matched, customers, order_ids, cash, picks_for(key)))
            elif key == "notes":
                parts.append(_notes(matched, picks_for(key)))
            elif key == "frozen":
                parts.append(_frozen(rows, customers, products, order_ids, picks_for(key)))
            elif key == "remind":
                parts.append(_reminder(matched, source, terms, cash, picks_for(key)))
            elif key == "vault":
                parts.append(_vault_html(source, cash, today, period, vault_types, vault_pages, hide_totals, stats=vault_stats, totals_only=vault_totals_only))

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
        if not guided and action == "snap":
            parts = [head, "Открываю снимок. Отметьте заказы и нажмите PNG, PDF или текст."]
        elif not guided and explicit <= {"snap", "orders"}:
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
        template_source=template_source,
    )


def _norm(text: str) -> str:
    return dictionary.normalize(text)


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
        "vault": "хранилище",
    }
    for key in ("summary", "money", "debt", "overdue", "orders", "work", "customers", "products", "expense", "notes", "frozen", "remind", "count", "rank", "discount", "status", "vault"):
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
        ("vault", r"хранилищ\w*"),
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


def _words(text: str, book: dict[str, Any] | None = None) -> list[str]:
    tokens = text.split()
    out: list[str] = []
    index = 0
    while index < len(tokens):
        token = tokens[index]
        nxt = tokens[index + 1] if index + 1 < len(tokens) else ""
        linked = bool(book) and dictionary.synonym_values(book, token) != [dictionary.normalize(token)]
        if nxt.isdigit() and re.fullmatch(r"[a-zа-я]+", token) and token not in _STOP and token not in _FILLER and (len(token) < 3 or linked):
            out.append(f"{token}\x1f{nxt}")
            index += 2
            continue
        if token in _STOP or token in _FILLER:
            index += 1
            continue
        if token.isdigit():
            if len(token) >= 2:
                out.append(token)
            index += 1
            continue
        if len(token) < 3 and not (book and dictionary.synonym_values(book, token) != [dictionary.normalize(token)]):
            index += 1
            continue
        out.append(token)
        index += 1
    return out[:8]


def _hit(blob: str, word: str) -> bool:
    tokens = blob.split()
    if "\x1f" in word:
        left, right = word.split("\x1f", 1)
        return any(tokens[pos] == left and tokens[pos + 1] == right for pos in range(len(tokens) - 1))
    if word.isdigit():
        return re.search(rf"(?<!\d){re.escape(word)}(?!\d)", blob) is not None
    if len(word) < 3:
        return word in tokens
    if word in blob:
        return True
    if " " in word:
        return False
    return len(word) >= 5 and word[:4] in blob


def _has_text(hay: str, needle: str) -> bool:
    """Вхождение фразы целиком. 9 не находится в 90, «плитка» не вырезается из «санплитка»."""
    if not needle:
        return False
    start = 0
    while True:
        index = hay.find(needle, start)
        if index < 0:
            return False
        after = index + len(needle)
        before = index - 1
        if after < len(hay) and needle[-1].isdigit() and hay[after].isdigit():
            start = index + 1
            continue
        if before >= 0 and needle[0].isdigit() and hay[before].isdigit():
            start = index + 1
            continue
        if after < len(hay) and needle[-1].isalpha() and hay[after].isalpha():
            start = index + 1
            continue
        if before >= 0 and needle[0].isalpha() and hay[before].isalpha():
            start = index + 1
            continue
        return True


_VAULT_WORD = {
    "пополнение": "in",
    "пополнения": "in",
    "снятие": "out",
    "снятия": "out",
    "копилка": "save",
    "копилки": "save",
}
_VAULT_LABEL = {"in": "Пополнение", "out": "Снятие", "save": "Копилка"}
_VAULT_FIELDS = (
    ("type", "Тип"),
    ("name", "Название"),
    ("amount", "Сумма"),
    ("date", "Дата"),
    ("page", "Страница"),
)


def _vault_pages(doc: dict[str, Any]) -> list[dict[str, Any]]:
    ui = doc.get("ui") if isinstance(doc.get("ui"), dict) else {}
    vault = ui.get("vault") if isinstance(ui.get("vault"), dict) else {}
    pages = vault.get("pages") if isinstance(vault.get("pages"), list) else []
    return [page for page in pages if isinstance(page, dict)]


def _vault_page_names(doc: dict[str, Any], page_id: str) -> list[str]:
    """Имя страницы по id, выбранному в срезе. Чужой id не режет список."""
    want = str(page_id or "").strip()
    if not want:
        return []
    for page in _vault_pages(doc):
        if str(page.get("id") or "") != want:
            continue
        name = str(page.get("name") or "").strip() or "Страница"
        return [name]
    return []


def _take_vault_words(text: str, source: dict[str, Any]) -> tuple[set[str], set[str], str]:
    """Тип строки и имя страницы — те же вычитания, что имя заказчика у других срезов."""
    types: set[str] = set()
    kept: list[str] = []
    for token in str(text or "").split():
        kind = _VAULT_WORD.get(token)
        if kind:
            types.add(kind)
        else:
            kept.append(token)
    work = " ".join(kept)
    names = [str(page.get("name") or "").strip() for page in _vault_pages(source)]
    hits, work = _take_names(work, names)
    pages = {_norm(name) for name in hits}
    pages.difference_update(_VAULT_WORD)
    return types, pages, work


def _take_names(text: str, names: list[str]) -> tuple[list[str], str]:
    hits: list[str] = []
    work = text
    for name in sorted(names, key=len, reverse=True):
        key = _norm(name)
        if len(key) < 3 or key in _STOP:
            continue
        if not _has_text(work, key):
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
        groups = [word if isinstance(word, list) else [word] for word in words]
        hits = [any(_hit(row["blob"], part) for part in group) for group in groups]
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


def _on(picks: set[str] | None, key: str) -> bool:
    return picks is None or key in picks


def _count(rows: list[dict[str, Any]], cash, *, overdue_only: bool = False, picks: set[str] | None = None) -> str:
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
    bits = []
    if _on(picks, "orders"):
        bits.append(f"• {_pieces(len(orders), 'заказ', 'заказа', 'заказов')}")
    if _on(picks, "lines"):
        bits.append(f"• {_pieces(len(income), 'позиция', 'позиции', 'позиций')}")
    if _on(picks, "due"):
        bits.append(f"• к оплате {cash(after)}")
    if _on(picks, "paid"):
        bits.append(f"• оплачено {cash(paid)}")
    if _on(picks, "debt"):
        bits.append(f"• долг {cash(unpaid)}")
    if _on(picks, "cost"):
        bits.append(f"• расходы {cash(cost)}")
    if _on(picks, "net"):
        bits.append(f"• чистыми {cash(after - cost)}")
    lines = [f"<b>{title}</b>", *bits]
    if not income and cost <= 0.005:
        lines.append("В этом срезе ничего нет.")
    return "\n".join(lines)


def _rank(rows: list[dict[str, Any]], cash, *, by_debt: bool = False, picks: set[str] | None = None) -> str:
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
    if _on(picks, "customers"):
        lines.append("Заказчики по долгу" if by_debt else "Заказчики по сумме")
        for name, (after, unpaid) in sorted(by_customer.items(), key=lambda pair: -pair[1][key_i])[:5]:
            lines.append(f"• {html_esc(name)} · {cash(after)} · долг {cash(unpaid)}")
    if _on(picks, "orders"):
        lines.append("Заказы по долгу" if by_debt else "Заказы по сумме")
        for item in sorted(by_order.values(), key=lambda bit: -(bit["unpaid"] if by_debt else bit["after"]))[:5]:
            lines.append(
                f"• {_order_ref(item['order'])} · {html_esc(item['customer'])} · {cash(item['after'])} · долг {cash(item['unpaid'])}"
            )
    return "\n".join(lines)


def _statuses(rows: list[dict[str, Any]], cash, picks: set[str] | None = None) -> str:
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
    status_lines = []
    for name, (count, after, unpaid) in ranked:
        parts = [html_esc(name)]
        if _on(picks, "count"):
            parts.append(_pieces(int(count), "позиция", "позиции", "позиций"))
        if _on(picks, "amount"):
            parts.append(cash(after))
        if _on(picks, "debt"):
            parts.append(f"долг {cash(unpaid)}")
        status_lines.append("• " + " · ".join(parts))
    lines.extend(status_lines[:24])
    _fold(lines, status_lines[24:], len(status_lines) - 24, "статус", "статуса", "статусов")
    if not ranked:
        lines.append("Статусов в этом срезе нет.")
    return "\n".join(lines)


def _discounts(rows: list[dict[str, Any]], cash, picks: set[str] | None = None) -> str:
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
        parts = []
        if _on(picks, "order"):
            parts.append(_order_ref(row["order"]))
        if _on(picks, "product"):
            parts.append(html_esc(str(row["line"].get("product") or "позиция")))
        if _on(picks, "percent"):
            parts.append(f"{percent} %")
        if _on(picks, "amount"):
            parts.append(cash(float(row["tot"]["after"])))
        if parts:
            lines.append("• " + " · ".join(parts))
    if not hits:
        lines.append("Скидок в этом срезе нет.")
    return "\n".join(lines)


def _summary(doc: dict[str, Any], rows: list[dict[str, Any]], today: date, cash, terms: int, delays: tuple[float, bool, dict[str, float]], period: str = "all", picks: set[str] | None = None) -> str:
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
    lines = ["<b>Сводка</b>"]
    if _on(picks, "count"):
        lines.append(f"{_pieces(len(orders), 'заказ', 'заказа', 'заказов')} · {_pieces(len(income), 'позиция', 'позиции', 'позиций')}")
    if _on(picks, "money"):
        lines.append(f"К оплате {cash(after)} · оплачено {cash(paid)} · долг {cash(unpaid)}")
    if _on(picks, "cost"):
        lines.append(f"Расходы {cash(cost)} · чистыми {cash(after - cost)}")
    if _on(picks, "avg"):
        lines.append(f"Средний чек {cash(avg)} · собираемость {html_esc(_share(paid, after))}")
    if _on(picks, "month") and period == "all":
        lines.append(f"Этот месяц {cash(month_after)} · прошлый {cash(prev_after)}")
    if _on(picks, "forecast") and period == "all" and today.day:
        dim = (today.replace(day=1) + timedelta(days=32)).replace(day=1) - timedelta(days=1)
        forecast = month_after / today.day * dim.day if today.day else 0
        lines.append(f"Прогноз месяца {cash(forecast)}")
    if _on(picks, "term"):
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


def _metric_pack(rows: list[dict[str, Any]], today: date, terms: int, delays: tuple[float, bool, dict[str, float]]) -> dict[str, tuple[Any, str]]:
    income = [row for row in rows if not row["tot"].get("kind")]
    live = [row for row in income if not row["cancelled"]]
    after = sum(float(row["tot"]["after"]) for row in income)
    after_live = sum(float(row["tot"]["after"]) for row in live)
    paid = sum(float(row["tot"]["paid"]) for row in income)
    unpaid = sum(float(row["tot"]["unpaid"]) for row in income)
    cost = sum(float(row["tot"]["cost"]) for row in rows if row["tot"].get("kind"))
    orders = {str(row["order"].get("id") or id(row["order"])) for row in income}
    checks = [float(row["tot"]["after"]) for row in income if float(row["tot"]["after"]) > 0.005]
    avg = sum(checks) / len(checks) if checks else 0.0
    month = [row for row in income if _in_period(row["order_day"], "month", today)]
    prev_day = today.replace(day=1) - timedelta(days=1)
    prev = [row for row in income if row["order_day"] and (row["order_day"].year, row["order_day"].month) == (prev_day.year, prev_day.month)]
    month_after = sum(float(row["tot"]["after"]) for row in month)
    prev_after = sum(float(row["tot"]["after"]) for row in prev)
    dim = (today.replace(day=1) + timedelta(days=32)).replace(day=1) - timedelta(days=1)
    forecast = month_after / today.day * dim.day if today.day else 0.0
    dso, known, _delay_map = delays
    dso_text = (
        f"{int(round(dso))} {_days(int(round(dso)))}"
        if known
        else f"{terms} {_days(terms)}, истории оплат ещё нет"
    )
    return {
        "orders": (len(orders), str(len(orders))),
        "lines": (len(income), str(len(income))),
        "due": (after, ""),
        "due_live": (after_live, ""),
        "paid": (paid, ""),
        "share": (paid / after if after > 0.005 else 0.0, _share(paid, after)),
        "unpaid": (unpaid, ""),
        "cost": (cost, ""),
        "net": (after - cost, ""),
        "avg": (avg, ""),
        "month": (month_after, ""),
        "prev": (prev_after, ""),
        "forecast": (forecast, ""),
        "dso": (dso if known else None, dso_text),
    }


def _metric_text(key: str, fmt: str, pack: dict[str, tuple[Any, str]], cash) -> tuple[Any, str]:
    raw, text = pack.get(key, (0, "—"))
    if fmt == "text":
        return raw, html_esc(text or "—")
    if fmt == "percent":
        return raw, html_esc(text or "—")
    if fmt == "number":
        try:
            number = int(raw)
        except (TypeError, ValueError):
            number = 0
        return number, html_esc(str(number))
    try:
        amount = float(raw or 0)
    except (TypeError, ValueError):
        amount = 0.0
    return amount, cash(amount)


def _metric_blank(raw: Any) -> bool:
    if raw is None:
        return True
    if isinstance(raw, (int, float)):
        return abs(float(raw)) < 0.005
    return str(raw).strip() in {"", "0", "—"}


def _metrics_html(title: str, tiles: list[dict[str, Any]], source: dict[str, Any], rows: list[dict[str, Any]], today: date, cash, terms: int, delays, period: str, *, markdown: bool) -> str:
    pack = _metric_pack(rows, today, terms, delays)
    known = {key: (label, fmt) for key, label, fmt in dictionary.METRICS}
    lines = [f"<b>{html_esc(title)}</b>"]
    for tile in tiles:
        key = str(tile.get("key") or "")
        if key not in known:
            continue
        fmt = str(tile.get("format") or known[key][1])
        raw, text = _metric_text(key, fmt, pack, cash)
        if tile.get("hideZero") and _metric_blank(raw):
            continue
        label = html_esc(str(tile.get("label") or known[key][0]))
        lines.append(f"<b>{label}</b> {text}" if markdown else f"{label} · {text}")
    if len(lines) == 1:
        lines.append("Показатели не выбраны.")
    return "\n".join(lines)


_ORDER_COL_TOGGLE = {
    "number": "head",
    "name": "head",
    "product": "product",
    "quantity": "qty",
    "order_type": "head",
    "status": "status",
    "total": "amount",
    "paid": "money",
    "unpaid": "debt",
    "order_date": "date",
    "expenses": "expense",
}


def _field_toggle(key: str, field: str) -> str | None:
    """Какой тумблер среза прячет это поле шаблона. None — поле от тумблеров не зависит."""
    if key in {"debt", "overdue", "incoming", "discount", "frozen", "expense"} and field in {"number", "name"}:
        return "order"
    if key == "notes" and field == "note":
        return "order"
    if key == "customers" and field == "amount":
        return "debt"
    if field == "quantity":
        return "qty"
    allowed = {fid for fid, _title in dictionary.SLICE_TOGGLES.get(key, ())}
    return field if field in allowed else None


def _order_slice_html(
    key: str,
    columns: list[str],
    source: dict[str, Any],
    matched: list[dict[str, Any]],
    hide_totals: bool,
    picks: set[str] | None = None,
) -> str:
    """Срез заказа в шаблоне: шапка из номера и названия, под ней выбранные колонки позиций."""
    from backend import snapshot as snapmod

    known = {item["id"] for item in snapmod.FIELDS}
    picked = [item for item in columns if item in known]
    if not picked:
        picked = [item for item in dictionary.ORDER_SLICE_COLUMNS if item in known]
    if hide_totals:
        picked = snapmod.without_prices(picked)
    if picks is not None:
        picked = [item for item in picked if item not in _ORDER_COL_TOGGLE or _on(picks, _ORDER_COL_TOGGLE[item])]
    types = type_index(source)
    currency = str(source.get("currency") or "₽")
    decimals = money_decimals(source.get("money_decimals"))
    grouped: list[dict[str, Any]] = []
    by_id: dict[str, dict[str, Any]] = {}
    for row in matched:
        if row.get("frozen"):
            continue
        oid = str(row["order"].get("id") or id(row["order"]))
        block = by_id.get(oid)
        if block is None:
            block = {"order": row["order"], "lines": []}
            by_id[oid] = block
            grouped.append(block)
        block["lines"].append(row)
    title = "Позиции" if key == "lines" else "Заказы"
    out = [f"<b>{title}</b> · {len(grouped)}"]
    if not grouped:
        out.append("Подходящих заказов нет.")
        return "\n".join(out)
    meta_ids = [item for item in picked if snapmod.FIELD_BY_ID[item]["kind"] == "meta" and item not in {"totals", "expenses"}]
    col_ids = [item for item in picked if snapmod.FIELD_BY_ID[item]["kind"] == "col"]
    show_expenses = "expenses" in picked and _on(picks, "expense")
    for block in grouped:
        order = block["order"]
        meta = snapmod.meta_items(order, source, meta_ids, False)
        out.append("\n<b>" + " · ".join(html_esc(bit) for bit in meta) + "</b>" if meta else "")
        visible = [
            row
            for row in block["lines"]
            if show_expenses or not row["tot"].get("kind")
        ]
        if col_ids and visible:
            out.append(" · ".join(html_esc(snapmod.FIELD_BY_ID[item]["label"]) for item in col_ids))
            for row in visible:
                cells = [
                    snapmod.line_value(row["line"], item, currency, types, order, decimals) or "—"
                    for item in col_ids
                ]
                out.append("• " + " · ".join(html_esc(cell) for cell in cells))
                comment = str(row["line"].get("notes") or "").strip()
                if comment and _on(picks, "comment"):
                    out.append("  " + html_esc(comment))
        if "totals" in picked and _on(picks, "money"):
            income = [row["line"] for row in block["lines"] if not row["tot"].get("kind")]
            text = snapmod.totals_text(
                picked, snapmod.cols_of(picked), income, currency, types, order, decimals, hide_totals
            )
            if text:
                out.append(html_esc(text))
    return "\n".join(line for line in out if line is not None)


def _slice_rows(key: str, rows: list[dict[str, Any]], today: date, delays, period: str) -> list[dict[str, Any]]:
    """Строки, которые этот срез вообще показывает, до выбора колонок."""
    _, _, delay_map = delays if isinstance(delays, tuple) and len(delays) == 3 else (0, False, {})
    horizon = 7
    if str(period).startswith("days:"):
        horizon = int(str(period).split(":", 1)[1] or 7)
    elif period == "month":
        horizon = 30
    kept: list[dict[str, Any]] = []
    for row in rows:
        kind = row["tot"].get("kind")
        frozen = bool(row.get("frozen"))
        if key == "frozen":
            if frozen and not kind:
                kept.append(row)
            continue
        if frozen:
            continue
        if key == "expense":
            if kind:
                kept.append(row)
            continue
        if kind:
            continue
        unpaid = float(row["tot"]["unpaid"])
        if key in {"debt", "remind"} and (unpaid <= 0.005 or row["cancelled"]):
            continue
        if key == "overdue" and ((row["overdue"] or 0) <= 0 or unpaid <= 0.005 or row["cancelled"]):
            continue
        if key == "incoming":
            if unpaid <= 0.005 or row["cancelled"]:
                continue
            due = row["due"]
            delay = int(round(delay_map.get(row["customer"]) or 0))
            expected = None
            if due:
                shifted = due + timedelta(days=max(0, delay))
                expected = shifted if shifted > today else today
            if not expected or (expected - today).days > horizon:
                continue
        if key == "discount" and float(row["tot"].get("discount") or 0) <= 0:
            continue
        if key == "notes" and not (
            str(row["order"].get("notes") or "").strip() or str(row["line"].get("notes") or "").strip()
        ):
            continue
        kept.append(row)
    return kept


def _picked_slice_html(
    key: str,
    columns: list[str],
    source: dict[str, Any],
    matched: list[dict[str, Any]],
    cash,
    hide_totals: bool,
    today: date,
    delays,
    period: str,
    picks: set[str] | None = None,
) -> str:
    """Срез с выбранными полями: шапка заказа и только отмеченные колонки."""
    labels = dict(dictionary.SLICE_PICKS.get(key) or ())
    chosen = [item for item in columns if item in labels]
    if hide_totals:
        chosen = [item for item in chosen if item not in {"amount"}]
    if picks is not None:
        chosen = [item for item in chosen if (toggle := _field_toggle(key, item)) is None or _on(picks, toggle)]
    title = dict(dictionary.SLICES).get(key, key)
    rows = _slice_rows(key, matched, today, delays, period)
    if not chosen:
        return f"<b>{html_esc(title)}</b>\nПодходящих строк нет."
    meta_ids = [item for item in chosen if item in {"number", "name", "customer", "organization", "phone", "note"}]
    line_ids = [item for item in chosen if item not in meta_ids]
    cards: dict[str, dict[str, Any]] = {}
    for item in source.get("customers") or []:
        if isinstance(item, dict) and str(item.get("name") or "").strip():
            cards[_norm(item.get("name"))] = item
    states = {"now": "в работе", "planned": "запланирован", "done": "закрыт", "nodate": "без дат"}

    def cell(row: dict[str, Any], field: str) -> str:
        order = row["order"]
        line = row["line"]
        card = cards.get(row["cust_key"], {})
        if field == "number":
            return str(order.get("number") or "—")
        if field == "name":
            return str(order.get("name") or "—")
        if field == "customer":
            return row["customer"]
        if field == "organization":
            return str(card.get("organization") or "—")
        if field == "phone":
            return str(card.get("phone") or "—")
        if field == "note":
            return str(order.get("notes") or "—")
        if field == "product":
            return str(line.get("product") or "—")
        if field == "quantity":
            return qty_text(line)
        if field == "status":
            return str(line.get("status") or "—")
        if field == "due":
            return _fmt(row["due"]) or "—"
        if field == "start":
            return _fmt(row["work_day"]) or "—"
        if field == "end":
            return _fmt(row["work_end"]) or "—"
        if field == "state":
            return states.get(row["state"], "—")
        if field == "mark":
            late = row["overdue"]
            if late is None:
                return "срок не задан"
            if late <= 0:
                return "срок ещё не вышел"
            return f"просрочка {late} {_days(late)}"
        if field == "comment":
            return str(line.get("notes") or "—")
        if field == "kind":
            return "налог" if row["tot"].get("kind") == "tax" else "затрата"
        if field == "percent":
            return f"{row['tot'].get('discount') or 0:g} %"
        if field == "amount":
            if row["tot"].get("kind"):
                value = float(row["tot"]["cost"])
            elif key in {"debt", "overdue", "incoming", "remind", "customers"}:
                value = float(row["tot"]["unpaid"])
            else:
                value = float(row["tot"]["after"])
            return cash(value)
        return "—"

    grouped: list[dict[str, Any]] = []
    by_id: dict[str, dict[str, Any]] = {}
    for row in rows:
        oid = str(row["order"].get("id") or id(row["order"]))
        block = by_id.get(oid)
        if block is None:
            block = {"rows": []}
            by_id[oid] = block
            grouped.append(block)
        block["rows"].append(row)
    out = [f"<b>{html_esc(title)}</b> · {len(grouped)}"]
    if not grouped:
        out.append("Подходящих строк нет.")
        return "\n".join(out)
    for block in grouped:
        head = block["rows"][0]
        bits = [f"{labels[item]}: {cell(head, item)}" for item in meta_ids]
        if bits:
            out.append("\n<b>" + " · ".join(html_esc(bit) if item != "amount" else bit for item, bit in zip(meta_ids, bits)) + "</b>")
        else:
            out.append("")
        if not line_ids:
            continue
        out.append(" · ".join(html_esc(labels[item]) for item in line_ids))
        for row in block["rows"]:
            values = []
            for item in line_ids:
                value = cell(row, item)
                values.append(value if item == "amount" else html_esc(value))
            out.append("• " + " · ".join(values))
    return "\n".join(line for line in out if line is not None)


def _vault_totals(page: dict[str, Any]) -> dict[str, float]:
    """Те же итоги, что шапка страницы: все строки, без фильтра срока и типа."""
    inc = spent = saved = 0.0
    for row in page.get("rows") or []:
        if not isinstance(row, dict):
            continue
        kind = str(row.get("type") or "")
        try:
            amount = float(row.get("amount") or 0)
        except (TypeError, ValueError):
            amount = 0.0
        if kind == "in":
            inc += abs(amount)
        elif kind == "out":
            spent += abs(amount)
        elif kind == "save":
            saved += amount
    try:
        goal = float(page.get("goal") or 0)
    except (TypeError, ValueError):
        goal = 0.0
    if goal < 0:
        goal = 0.0
    return {
        "inc": round(inc, 2),
        "out": round(spent, 2),
        "save": round(saved, 2),
        "hand": round(inc - spent - saved, 2),
        "goal": round(goal, 2),
    }


def _vault_stat_lines(totals: dict[str, float], stat_ids: list[str], cash) -> list[str]:
    goal = totals["goal"]
    pct = int(max(0.0, min(100.0, totals["save"] / goal * 100)) + 0.5) if goal > 0 else 0
    left = max(0.0, goal - totals["save"]) if goal > 0 else 0.0
    lines: list[str] = []
    for fid in stat_ids:
        if fid == "hand":
            lines.append(f"На руках: {cash(totals['hand'])}")
        elif fid == "save":
            note = f"{pct}% от цели" if goal > 0 else "отложено всего"
            lines.append(f"В копилке: {cash(totals['save'])} · {note}")
        elif fid == "inc":
            lines.append(f"Пополнено: +{cash(totals['inc'])}")
        elif fid == "out":
            lines.append(f"Потрачено: −{cash(totals['out'])}")
        elif fid == "goal":
            if goal > 0:
                note = "цель достигнута" if left <= 0.005 else f"осталось отложить {cash(left)}"
                lines.append(f"Цель: {cash(goal)} · {note}")
            else:
                lines.append("Цель: не задана")
    return lines


def _vault_html(
    source: dict[str, Any],
    cash,
    today: date,
    period: str,
    type_keys: set[str],
    page_keys: set[str],
    hide_totals: bool,
    columns: list[str] | None = None,
    stats: list[str] | None = None,
    totals_only: bool = False,
) -> str:
    """Строки копилок. Это не выручка заказов."""
    labels = dict(_VAULT_FIELDS)
    chosen = [] if totals_only else [fid for fid, _title in _VAULT_FIELDS if columns is None or fid in set(columns)]
    stat_ids = [key for key, _title in dictionary.VAULT_STATS if key in set(stats or [])]
    if hide_totals:
        chosen = [fid for fid in chosen if fid != "amount"]
        stat_ids = []
    title = "Хранилище"
    if len(page_keys) == 1:
        shown = next(
            (
                str(page.get("name") or "").strip() or "Страница"
                for page in _vault_pages(source)
                if _norm(str(page.get("name") or "").strip() or "Страница") in page_keys
            ),
            "",
        )
        if shown:
            title = f"Хранилище · {shown}"
    if not chosen and not stat_ids:
        return f"<b>{html_esc(title)}</b>\nНе выручка заказов."
    items: list[tuple[date, int, str, str, dict[str, Any]]] = []
    for page in _vault_pages(source):
        page_name = str(page.get("name") or "Страница").strip() or "Страница"
        if page_keys and _norm(page_name) not in page_keys:
            continue
        for index, row in enumerate(page.get("rows") or []):
            if not isinstance(row, dict):
                continue
            kind = str(row.get("type") or "")
            if kind not in _VAULT_LABEL:
                continue
            if type_keys and kind not in type_keys:
                continue
            day = _iso(row.get("date"))
            if not _in_period(day, period, today):
                continue
            items.append((day or date.min, index, page_name, kind, row))
    items.sort(key=lambda item: (item[0], item[1]), reverse=True)
    head = f"<b>{html_esc(title)}</b>"
    if chosen:
        head += f" · {len(items)}"
    out = [head, "Не выручка заказов."]
    if stat_ids:
        shown_pages = [
            page
            for page in _vault_pages(source)
            if not page_keys or _norm(str(page.get("name") or "").strip() or "Страница") in page_keys
        ]
        many = len(shown_pages) != 1
        for page in shown_pages:
            if many:
                out.append(f"<b>{html_esc(str(page.get('name') or '').strip() or 'Страница')}</b>")
            out.extend(_vault_stat_lines(_vault_totals(page), stat_ids, cash))
    if not chosen:
        return "\n".join(out)
    if not items:
        out.append("Подходящих строк нет.")
        return "\n".join(out)
    out.append(" · ".join(html_esc(labels[fid]) for fid in chosen))
    for day, _index, page_name, kind, row in items:
        amount = float(row.get("amount") or 0)
        values: list[str] = []
        for fid in chosen:
            if fid == "type":
                values.append(html_esc(_VAULT_LABEL[kind]))
            elif fid == "name":
                values.append(html_esc(str(row.get("name") or "—")))
            elif fid == "amount":
                signed = abs(amount)
                if kind == "out":
                    signed = -abs(amount)
                elif kind == "save":
                    signed = amount
                values.append(cash(signed))
            elif fid == "date":
                values.append(html_esc(_fmt(day) if day != date.min else "—"))
            elif fid == "page":
                values.append(html_esc(page_name))
        out.append("• " + " · ".join(values))
    return "\n".join(out)


def _template_html(
    template: str,
    source: dict[str, Any],
    matched: list[dict[str, Any]],
    rows: list[dict[str, Any]],
    today: date,
    cash,
    terms: int,
    delays,
    period: str,
    customers: list[str],
    products: list[str],
    order_ids: set[str],
    work_state: str,
    hide_totals: bool = False,
    vault_types: set[str] | None = None,
    vault_pages: set[str] | None = None,
    vault_stats: list[str] | None = None,
    vault_totals_only: bool = False,
    slice_opts: dict[str, Any] | None = None,
) -> str:
    pack = _metric_pack(matched, today, terms, delays)
    known = {key: fmt for key, _label, fmt in dictionary.METRICS}
    opts = slice_opts if isinstance(slice_opts, dict) else {}

    def picks_for(key: str) -> set[str] | None:
        if key not in opts:
            return None
        allowed = {fid for fid, _title in dictionary.SLICE_TOGGLES.get(key, ())}
        return {str(item) for item in (opts.get(key) or []) if str(item) in allowed}

    def slice_html(key: str) -> str:
        picks = picks_for(key)
        if key == "summary":
            return _summary(source, matched, today, cash, terms, delays, period, picks)
        if key == "count":
            return _count(matched, cash, picks=picks)
        if key == "rank":
            return _rank(matched, cash, picks=picks)
        if key == "debt":
            return _debts(matched, today, terms, delays, cash, overdue_only=False, incoming=False, period=period, picks=picks)
        if key == "overdue":
            return _debts(matched, today, terms, delays, cash, overdue_only=True, incoming=False, period=period, picks=picks)
        if key == "incoming":
            return _debts(matched, today, terms, delays, cash, overdue_only=False, incoming=True, period=period, picks=picks)
        if key == "orders":
            return _orders(matched, cash, picks)
        if key == "lines":
            return _orders(matched, cash, picks).replace("<b>Заказы</b>", "<b>Позиции</b>", 1)
        if key == "work":
            return _work(matched if work_state or period != "all" else rows, today, work_state, picks)
        if key == "customers":
            return _customers(source, matched, cash, picks)
        if key == "products":
            return _products(matched, cash, picks)
        if key == "expense":
            return _expenses(rows, matched, customers, order_ids, cash, picks)
        if key == "notes":
            return _notes(matched, picks)
        if key == "frozen":
            return _frozen(rows, customers, products, order_ids, picks)
        if key == "discount":
            return _discounts(matched, cash, picks)
        if key == "status":
            return _statuses(matched, cash, picks)
        if key == "remind":
            return _reminder(matched, source, terms, cash, picks)
        if key == "vault":
            return _vault_html(source, cash, today, period, vault_types or set(), vault_pages or set(), hide_totals, stats=vault_stats, totals_only=vault_totals_only)
        return ""

    opens = {
        "b": "<b>",
        "i": "<i>",
        "h": "\n<b>",
        "li": "• ",
        "q": "заметка: ",
        "code": "<code>",
        "table": "\n",
        "th": "<b>",
        "td": "",
    }
    closes = {
        "b": "</b>",
        "i": "</i>",
        "h": "</b>\n",
        "li": "\n",
        "q": "\n",
        "code": "</code>",
        "table": "\n",
        "th": "</b> · ",
        "td": " · ",
    }
    parts: list[str] = []
    rows: list[list[str]] = []
    cells: list[str] = []
    in_row = False

    def flush_rows() -> None:
        nonlocal rows
        if not rows:
            return
        width = max(len(row) for row in rows)
        html = ["<table>"]
        for row in rows:
            html.append("<tr>")
            for index in range(width):
                value = row[index].strip() if index < len(row) else ""
                html.append(f"<td>{value}</td>")
            html.append("</tr>")
        html.append("</table>")
        parts.append("".join(html))
        rows = []

    def add_outside(text: str) -> None:
        if text.strip():
            flush_rows()
            parts.append(text)
            return
        if rows and text.count("\n") >= 2:
            flush_rows()
        parts.append(text)

    def put(text: str) -> None:
        if in_row:
            cells[-1] += text
        else:
            add_outside(text)

    cursor = 0
    for match in re.finditer(r"\{\{([^}]+)\}\}", template or ""):
        put(html_esc(template[cursor : match.start()]))
        cursor = match.end()
        token = match.group(1).strip()
        if token == "table":
            if not in_row:
                in_row = True
                cells = [""]
            continue
        if token == "|":
            if in_row:
                cells.append("")
            else:
                put(" · ")
            continue
        if token == "/table":
            if in_row:
                rows.append(cells)
                cells = []
                in_row = False
            continue
        if token in {"/td", "/th"} and in_row:
            cells.append("")
            continue
        rendered = ""
        if token.startswith("metric:"):
            key = token.split(":", 1)[1].strip()
            _raw, text = _metric_text(key, known.get(key, "text"), pack, cash)
            rendered = text
        elif token.startswith("slice:"):
            rest = token.split(":", 1)[1].strip()
            key, sep, cols_raw = rest.partition(":")
            key = key.strip()
            columns = [bit.strip() for bit in cols_raw.split(",") if bit.strip()] if sep else []
            if key == "vault":
                rendered = _vault_html(
                    source,
                    cash,
                    today,
                    period,
                    vault_types or set(),
                    vault_pages or set(),
                    hide_totals,
                    columns if sep else None,
                    vault_stats,
                    vault_totals_only,
                )
            elif key in dictionary.COLUMN_SLICES and (sep or picks_for(key) is None):
                rendered = _order_slice_html(key, columns, source, matched, hide_totals, picks_for(key))
            elif columns and key in dictionary.SLICE_PICKS:
                rendered = _picked_slice_html(key, columns, source, matched, cash, hide_totals, today, delays, period, picks_for(key))
            else:
                rendered = slice_html(key)
        elif token.startswith("/"):
            rendered = closes.get(token[1:].strip(), "")
        else:
            name = token.split(":", 1)[0].strip()
            rendered = opens[name] if name in opens else html_esc(match.group(0))
        put(rendered)
    put(html_esc((template or "")[cursor:]))
    if in_row:
        rows.append(cells)
    flush_rows()
    body = "".join(parts).strip()
    return body or "Шаблон пуст."


def api_body(
    reply: Reply | None,
    query: str = "",
    doc: dict[str, Any] | None = None,
    surface: str = "desk",
    book: dict[str, Any] | None = None,
) -> dict[str, Any]:
    hints = _hint_rows(query, doc, surface, book) if str(query or "").strip() else []
    if reply is not None and reply.suggestions and not str(reply.html or "").strip():
        rows = [{"kind": "item", "text": item, "meta": "команда"} for item in reply.suggestions]
        return {
            "title": "Варианты",
            "lead": "Похожие запросы",
            "chips": [],
            "sections": [{"title": "Варианты", "rows": rows}],
            "hints": [{"title": item, "sub": "команда"} for item in reply.suggestions],
            "hintOnly": True,
            "template": "",
        }
    if reply is None or not str(reply.html or "").strip():
        return {
            "title": "Ответ",
            "lead": "",
            "chips": [],
            "sections": [{"title": "Ответ", "rows": [{"kind": "text", "text": "В отчёте по этому запросу ничего нет."}]}],
            "hints": hints,
            "hintOnly": False,
            "template": "",
        }
    body = present(reply.html)
    body["hints"] = hints
    body["hintOnly"] = False
    body["template"] = reply.template_source or ""
    if reply.action:
        body["action"] = reply.action
    return body


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
    picks: set[str] | None = None,
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
    lines = ["<b>Долги</b>"]
    if _on(picks, "total"):
        lines.append(f"Дебиторка {cash(total)} · {_pieces(len(items), 'позиция', 'позиции', 'позиций')} в {_pieces(len(orders), 'заказе', 'заказах', 'заказах')}")
    if _on(picks, "late"):
        lines.append(f"Просрочено {cash(overdue_sum)} · {_pieces(overdue_n, 'позиция', 'позиции', 'позиций')}")
    if _on(picks, "term"):
        lines.append(f"Срок по договорённости {terms} {_days(terms)}")
    if cancelled > 0.005 and _on(picks, "total"):
        lines.append(f"Отменённые {cash(cancelled)} в дебиторку не входят")
    if _on(picks, "buckets"):
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
            if _on(picks, "customer"):
                target.append(f"\n<b>{html_esc(customer)}</b> — {cash(sum(bit[1] for bit in bits))}")
            for row, amount, _expected, _delay in bits:
                due = _fmt(row["due"])
                late = row["overdue"]
                mark = "срок не задан" if late is None else ("срок ещё не вышел" if late <= 0 else f"просрочка {late} {_days(late)}")
                parts = []
                if _on(picks, "order"):
                    parts.append(_order_ref(row["order"]))
                if _on(picks, "product"):
                    parts.append(html_esc(str(row["line"].get("product") or "позиция")))
                if _on(picks, "qty"):
                    parts.append(html_esc(qty_text(row["line"])))
                if _on(picks, "due"):
                    parts.append(due)
                if _on(picks, "mark"):
                    parts.append(mark)
                if _on(picks, "amount"):
                    parts.append(cash(amount))
                if parts:
                    target.append("• " + " · ".join(parts))

    write_people(lines, ranked[:12])
    hidden_people: list[str] = []
    write_people(hidden_people, ranked[12:])
    _fold(lines, hidden_people, max(0, len(ranked) - 12), "заказчик", "заказчика", "заказчиков")
    if not items:
        lines.append("Неоплаченных позиций нет.")
    return "\n".join(lines)


def _orders(rows: list[dict[str, Any]], cash, picks: set[str] | None = None) -> str:
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
            if _on(picks, "head"):
                target.append(f"\n<b>{_order_ref(order)}</b> · {html_esc(bits[0]['customer'])} · {state_label}")
            if _on(picks, "money"):
                target.append(f"к оплате {cash(after)} · оплачено {cash(paid)} · долг {cash(unpaid)}")
            note = str(order.get("notes") or "").strip()
            if note and _on(picks, "note"):
                target.append("заметка: " + html_esc(note))
            for row in bits:
                line = row["line"]
                status = str(line.get("status") or "").strip()
                cells = []
                if _on(picks, "product"):
                    cells.append(html_esc(str(line.get("product") or "позиция")))
                if _on(picks, "qty"):
                    cells.append(html_esc(qty_text(line)))
                if _on(picks, "amount"):
                    cells.append(cash(float(row["tot"]["after"])))
                if _on(picks, "debt"):
                    cells.append(f"долг {cash(float(row['tot']['unpaid']))}")
                if _on(picks, "date"):
                    cells.append(_fmt(row["order_day"]))
                if status and _on(picks, "status"):
                    cells.append(html_esc(status))
                if cells:
                    target.append("• " + " · ".join(cells))
                comment = str(line.get("notes") or "").strip()
                if comment and _on(picks, "comment"):
                    target.append("  " + html_esc(comment))
            if not _on(picks, "expense"):
                continue
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


def _work(rows: list[dict[str, Any]], today: date, only: str, picks: set[str] | None = None) -> str:
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
    lines = ["<b>Календарь</b>"]
    if _on(picks, "counts"):
        lines.append(f"В работе {counts['now']} · план {counts['planned']} · закрыто {counts['done']} · без дат {counts['nodate']}")
    labels = (("now", "В работе"), ("planned", "Запланировано"), ("done", "Закрыто"), ("nodate", "Без дат"))
    for key, label in labels:
        if not _on(picks, key):
            continue
        if only and key != only:
            continue
        chunk = [item for item in orders.values() if item["state"] == key]
        if not chunk:
            continue
        lines.append(f"\n<b>{label}</b>")
        for item in chunk:
            cells = [_order_ref(item["order"])]
            if _on(picks, "customer"):
                cells.append(html_esc(item["customer"]))
            if _on(picks, "start"):
                cells.append("без старта" if not item["start"] else f"с {_fmt(item['start'])}")
            if _on(picks, "end"):
                cells.append("без конца" if not item["end"] else f"до {_fmt(item['end'])}")
            lines.append("• " + " · ".join(cells))
    return "\n".join(lines)


def _customers(doc: dict[str, Any], rows: list[dict[str, Any]], cash, picks: set[str] | None = None) -> str:
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
            head = [f"\n<b>{html_esc(customer)}</b>"]
            if _on(picks, "debt"):
                head.append(f"долг {cash(unpaid)}")
            if _on(picks, "orders"):
                head.append(_pieces(len(orders), "заказ", "заказа", "заказов"))
            target.append(" · ".join(head))
            org = str(card.get("organization") or "").strip() if _on(picks, "organization") else ""
            phone = str(card.get("phone") or "").strip() if _on(picks, "phone") else ""
            email = str(card.get("email") or "").strip() if _on(picks, "email") else ""
            address = str(card.get("address") or "").strip() if _on(picks, "address") else ""
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


def _products(rows: list[dict[str, Any]], cash, picks: set[str] | None = None) -> str:
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
    product_lines = []
    for name, (after, paid, unpaid) in ranked:
        parts = [html_esc(name)]
        if _on(picks, "amount"):
            parts.append(cash(after))
        if _on(picks, "paid"):
            parts.append(f"оплачено {cash(paid)}")
        if _on(picks, "debt"):
            parts.append(f"долг {cash(unpaid)}")
        product_lines.append("• " + " · ".join(parts))
    lines.extend(product_lines[:20])
    _fold(lines, product_lines[20:], len(product_lines) - 20, "продукт", "продукта", "продуктов")
    if not ranked:
        lines.append("Продуктов в этом срезе нет.")
    return "\n".join(lines)


def _expenses(rows: list[dict[str, Any]], matched: list[dict[str, Any]], customers: list[str], order_ids: set[str], cash, picks: set[str] | None = None) -> str:
    order_filter = {str(row["order"].get("id") or "") for row in matched}
    lines_out = ["<b>Расходы</b>"]
    total = 0.0
    seen = 0
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
        seen += 1
        kind = "налог" if row["tot"].get("kind") == "tax" else "затрата"
        parts = []
        if _on(picks, "order"):
            parts.append(_order_ref(row["order"]))
        if _on(picks, "product"):
            parts.append(html_esc(str(row["line"].get("product") or kind)))
        if _on(picks, "kind"):
            parts.append(kind)
        if _on(picks, "amount"):
            parts.append(cash(amount))
        if parts:
            kept.append("• " + " · ".join(parts))
    if _on(picks, "total"):
        lines_out.insert(1, f"{_pieces(seen, 'строка', 'строки', 'строк')} · {cash(total)}")
    lines_out.extend(kept[:24])
    _fold(lines_out, kept[24:], len(kept) - 24, "строка", "строки", "строк")
    if seen == 0:
        lines_out.append("Расходных строк нет.")
    return "\n".join(lines_out)


def _notes(rows: list[dict[str, Any]], picks: set[str] | None = None) -> str:
    lines = ["<b>Заметки</b>"]
    seen: set[str] = set()
    for row in rows:
        oid = str(row["order"].get("id") or id(row["order"]))
        note = str(row["order"].get("notes") or "").strip()
        if note and oid not in seen and _on(picks, "order"):
            seen.add(oid)
            lines.append(f"• {_order_ref(row['order'])}: {html_esc(note)}")
        comment = str(row["line"].get("notes") or "").strip()
        if comment and _on(picks, "comment"):
            lines.append(f"• {_order_ref(row['order'])} · {html_esc(str(row['line'].get('product') or 'позиция'))}: {html_esc(comment)}")
    if len(lines) == 1:
        lines.append("Заметок нет.")
    return "\n".join(lines)


def _frozen(rows: list[dict[str, Any]], customers: list[str], products: list[str], order_ids: set[str], picks: set[str] | None = None) -> str:
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
        parts = []
        if _on(picks, "order"):
            parts.append(_order_ref(row["order"]))
        if _on(picks, "product"):
            parts.append(html_esc(str(row["line"].get("product") or "позиция")))
        if _on(picks, "customer"):
            parts.append(html_esc(row["customer"]))
        if parts:
            lines.append("• " + " · ".join(parts))
    if count == 0:
        lines.append("Замороженных позиций нет.")
    else:
        lines.insert(1, f"{_pieces(count, 'позиция', 'позиции', 'позиций')} — в итоги не входят")
    return "\n".join(lines)


def _reminder(rows: list[dict[str, Any]], doc: dict[str, Any], terms: int, cash, picks: set[str] | None = None) -> str:
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
        if _on(picks, "hello"):
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
            if due and _on(picks, "due"):
                due_text = f", срок {_fmt(due)}"
                if worst > 0:
                    due_text += f", просрочка {worst} {_days(worst)}"
            blocks.append(f"{_order_ref(order)} — остаток {cash(amount)}{due_text}")
            if _on(picks, "product"):
                for row in chunk:
                    blocks.append(f"  • {html_esc(str(row['line'].get('product') or 'позиция'))} — {cash(float(row['tot']['unpaid']))}")
        if _on(picks, "total"):
            blocks.append(f"Итого к оплате: {cash(total)}")
        if _on(picks, "term"):
            blocks.append(f"Срок оплаты — {terms} {_days(terms)} от даты заказа.")
    return "\n".join(blocks)
