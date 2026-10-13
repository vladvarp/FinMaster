  /* ==== Касса: платёжный календарь и дебиторка ==== */

  const DAY_MS = 86400000;
  const CASH_HORIZONS = [14, 30, 60, 90];
  const CASH_BUCKETS = [
    { id: "future", label: "Срок не наступил", color: "#0f766e" },
    { id: "d7", label: "Просрочка 1–7 дней", color: "#f59e0b" },
    { id: "d30", label: "Просрочка 8–30 дней", color: "#f97316" },
    { id: "d60", label: "Просрочка 31–60 дней", color: "#dc2626" },
    { id: "d60p", label: "Просрочка больше 60 дней", color: "#7f1d1d" },
    { id: "nodate", label: "Без даты заказа и оплаты", color: "#64748b" },
  ];
  const CASH_PIE_COLORS = ["#0f766e", "#2563eb", "#c9a227", "#7c3aed", "#0891b2", "#db2777", "#94a3b8"];
  const dayShortFmt = new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "short" });
  const dayLongFmt = new Intl.DateTimeFormat("ru-RU", { weekday: "short", day: "numeric", month: "short" });

  function cashState() {
    if (!state.cash) state.cash = { filter: "all", day: "", bucket: "", customer: "" };
    return state.cash;
  }

  function cashTerms() {
    const v = Number(ensureUi().payment_terms);
    if (!Number.isFinite(v) || v < 0) return 14;
    return Math.min(365, Math.round(v));
  }

  function cashHorizon() {
    const v = Number(ensureUi().cash_horizon);
    return CASH_HORIZONS.includes(v) ? v : 30;
  }

  function dayStart(d) {
    return new Date(d.getFullYear(), d.getMonth(), d.getDate());
  }

  function parseDay(iso) {
    if (!iso) return null;
    const m = String(iso).match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (m) return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? null : dayStart(d);
  }

  function addDays(d, n) {
    const x = new Date(d);
    x.setDate(x.getDate() + n);
    return x;
  }

  function dayDiff(from, to) {
    return Math.round((to.getTime() - from.getTime()) / DAY_MS);
  }

  function dayKey(d) {
    const p = (n) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  }

  let clockOffsetDays = 0;

  function clockNow() {
    const d = new Date();
    const n = Number(clockOffsetDays) || 0;
    if (n) d.setDate(d.getDate() + n);
    return d;
  }

  function clockToday() {
    return dayStart(clockNow());
  }

  function paintClockOffset() {
    const el = $("net-console-cal-day");
    if (!el) return;
    const n = Number(clockOffsetDays) || 0;
    if (!n) {
      el.textContent = "";
      el.removeAttribute("title");
      return;
    }
    el.textContent = clockToday().toLocaleDateString("ru-RU", { day: "2-digit", month: "2-digit", year: "numeric" });
    el.title = `Тестовая «сегодня»: +${n} дн.`;
  }

  function applyClockOffset(days) {
    clockOffsetDays = Math.max(0, Math.round(Number(days) || 0));
    paintClockOffset();
    if (state.doc) {
      goTimelineToday();
      renderCalendar();
    }
  }

  function keyToDay(key) {
    const [y, m, d] = String(key).split("-").map(Number);
    if (!y || !m || !d) return null;
    return new Date(y, m - 1, d);
  }

  function daysWord(n) {
    const abs = Math.abs(Math.round(n)) % 100;
    const tail = abs % 10;
    if (abs > 10 && abs < 20) return "дней";
    if (tail === 1) return "день";
    if (tail >= 2 && tail <= 4) return "дня";
    return "дней";
  }

  function posWord(n) {
    const abs = Math.abs(Math.round(n)) % 100;
    const tail = abs % 10;
    if (abs > 10 && abs < 20) return "позиций";
    if (tail === 1) return "позиция";
    if (tail >= 2 && tail <= 4) return "позиции";
    return "позиций";
  }

  function ordWord(n) {
    const abs = Math.abs(Math.round(n)) % 100;
    const tail = abs % 10;
    if (abs > 10 && abs < 20) return "заказов";
    if (tail === 1) return "заказ";
    if (tail >= 2 && tail <= 4) return "заказа";
    return "заказов";
  }

  function cashCancelled(line) {
    return /отмен|аннул|черн/i.test(line.status || "");
  }

  function cashDue(line, terms) {
    const planned = parseDay(line.payment_date);
    if (planned) return { day: planned, planned: true };
    const ordered = parseDay(line.order_date);
    if (!ordered) return { day: null, planned: false };
    return { day: addDays(ordered, terms), planned: false };
  }

  function cashDiscipline(terms) {
    const acc = new Map();
    let dsoSum = 0;
    let dsoWeight = 0;
    allRows().forEach(({ order, line, totals }) => {
      if (totals.paid <= 0.005) return;
      const ordered = parseDay(line.order_date);
      const paidDay = parseDay(line.payment_date);
      if (!ordered || !paidDay) return;
      const lead = Math.max(0, dayDiff(ordered, paidDay));
      dsoSum += lead * totals.paid;
      dsoWeight += totals.paid;
      const key = String(order.customer || "").trim() || "Без заказчика";
      const cur = acc.get(key) || { delaySum: 0, weight: 0, last: "" };
      cur.delaySum += (lead - terms) * totals.paid;
      cur.weight += totals.paid;
      if ((line.payment_date || "") > cur.last) cur.last = line.payment_date || "";
      acc.set(key, cur);
    });
    const delays = new Map();
    acc.forEach((cur, key) => delays.set(key, { delay: cur.weight ? cur.delaySum / cur.weight : 0, last: cur.last }));
    return { dso: dsoWeight ? dsoSum / dsoWeight : 0, known: dsoWeight > 0, delays };
  }

  function cashData() {
    const terms = cashTerms();
    const today = dayStart(new Date());
    const history = cashDiscipline(terms);
    const items = [];
    let receivable = 0;
    let after = 0;
    let paid = 0;
    let cancelledDebt = 0;
    allRows().forEach(({ order, line, totals }) => {
      after += totals.after;
      paid += totals.paid;
      if (totals.unpaid <= 0.005) return;
      if (cashCancelled(line)) {
        cancelledDebt += totals.unpaid;
        return;
      }
      const customer = String(order.customer || "").trim() || "Без заказчика";
      const due = cashDue(line, terms);
      const delay = Math.round(history.delays.get(customer)?.delay || 0);
      const overdue = due.day ? dayDiff(due.day, today) : null;
      const expected = due.day ? new Date(Math.max(addDays(due.day, Math.max(0, delay)).getTime(), today.getTime())) : null;
      items.push({ order, line, totals, customer, amount: totals.unpaid, due: due.day, planned: due.planned, overdue, expected, delay });
      receivable += totals.unpaid;
    });
    items.sort((a, b) => {
      if (!a.due && !b.due) return b.amount - a.amount;
      if (!a.due) return 1;
      if (!b.due) return -1;
      return a.due - b.due || b.amount - a.amount;
    });
    return { terms, today, items, receivable, after, paid, cancelledDebt, history };
  }

  function cashSum(items) {
    return items.reduce((acc, it) => acc + it.amount, 0);
  }

  function cashBucketId(item) {
    if (item.overdue === null) return "nodate";
    if (item.overdue <= 0) return "future";
    if (item.overdue <= 7) return "d7";
    if (item.overdue <= 30) return "d30";
    if (item.overdue <= 60) return "d60";
    return "d60p";
  }

  function cashDateText(day) {
    return day ? dayShortFmt.format(day) : "не задан";
  }

  function cashDelayText(delay, known) {
    if (!known) return "нет истории оплат";
    const d = Math.round(delay);
    if (d > 1) return `+${d} ${daysWord(d)} к сроку`;
    if (d < -1) return `${Math.abs(d)} ${daysWord(d)} раньше срока`;
    return "платит в срок";
  }

  function renderCashflow() {
    const data = cashData();
    const terms = $("cash-terms");
    if (terms && document.activeElement !== terms) terms.value = data.terms;
    $("cash-horizon").value = String(cashHorizon());
    $("cash-note").textContent =
      data.cancelledDebt > 0.005
        ? `Отменённые и аннулированные позиции на ${money(data.cancelledDebt)} в дебиторку не входят`
        : "В дебиторку входят неоплаченные позиции без отмен и аннулирований";
    renderCashKpi(data);
    renderCashForecast(data);
    renderCashPie(data);
    renderCashCalendar(data);
    renderCashAging(data);
    renderCashChips(data);
    renderCashTable(data);
    renderCashDebtors(data);
  }

  function renderCashKpi(data) {
    const soon = (n) => data.items.filter((it) => it.expected && dayDiff(data.today, it.expected) <= n);
    const week = soon(7);
    const month = soon(30);
    const overdue = data.items.filter((it) => it.overdue > 0);
    const worst = overdue.reduce((acc, it) => Math.max(acc, it.overdue), 0);
    const dso = Math.round(data.history.dso);
    const collect = data.after ? Math.round((data.paid / data.after) * 100) : 0;
    const orders = new Set(data.items.map((it) => it.order.id)).size;
    $("cash-kpi").innerHTML = `
      <div class="kpi ok">
        <div class="label">Поступит за 7 дней</div>
        <div class="value">${money(cashSum(week))}</div>
        <div class="sub">${week.length} ${posWord(week.length)} · за 30 дней ${money(cashSum(month))}</div>
      </div>
      <div class="kpi ${overdue.length ? "warn" : ""}">
        <div class="label">Просрочено</div>
        <div class="value">${money(cashSum(overdue))}</div>
        <div class="sub">${overdue.length ? `${overdue.length} ${posWord(overdue.length)} · максимум ${worst} ${daysWord(worst)}` : "просрочки нет"}</div>
      </div>
      <div class="kpi">
        <div class="label">Средний срок оплаты</div>
        <div class="value">${data.history.known ? `${dso} ${daysWord(dso)}` : "нет данных"}</div>
        <div class="sub">по договору ${data.terms} ${daysWord(data.terms)}${data.history.known && dso > data.terms ? ` · платят на ${dso - data.terms} ${daysWord(dso - data.terms)} позже` : ""}</div>
      </div>
      <div class="kpi">
        <div class="label">Дебиторка всего</div>
        <div class="value">${money(data.receivable)}</div>
        <div class="sub">${orders} ${ordWord(orders)} · собираемость ${collect}%</div>
      </div>
    `;
  }

  function renderCashForecast(data) {
    const horizon = cashHorizon();
    const step = horizon <= 30 ? 1 : 7;
    const marks = [];
    for (let i = 0; i <= horizon; i += step) marks.push(i);
    if (marks[marks.length - 1] !== horizon) marks.push(horizon);
    const labels = marks.map((i) => (i === 0 ? "сегодня" : dayShortFmt.format(addDays(data.today, i))));
    const plan = marks.map((i) => cashSum(data.items.filter((it) => it.due && dayDiff(data.today, it.due) <= i)));
    const real = marks.map((i) => cashSum(data.items.filter((it) => it.expected && dayDiff(data.today, it.expected) <= i)));
    FinCharts.line($("chart-cash-line"), {
      labels,
      datasets: [
        { values: plan, color: "#0f766e", label: "Если платят в срок", fill: true },
        { values: real, color: "#c9a227", label: "С учётом дисциплины", dashed: true },
      ],
    });
  }

  function renderCashPie(data) {
    const map = new Map();
    data.items.forEach((it) => map.set(it.customer, (map.get(it.customer) || 0) + it.amount));
    const sorted = [...map.entries()].sort((a, b) => b[1] - a[1]);
    const top = sorted.slice(0, 6).map(([label, value], i) => ({ label, value, color: CASH_PIE_COLORS[i] }));
    const rest = sorted.slice(6).reduce((acc, [, value]) => acc + value, 0);
    if (rest > 0.005) top.push({ label: "Прочие", value: rest, color: CASH_PIE_COLORS[6] });
    FinCharts.doughnut($("chart-cash-pie"), top);
  }

  function cashDayRow({ key, title, note, items, tone }) {
    const sum = cashSum(items);
    const names = unique(items.map((it) => it.customer)).slice(0, 3).join(", ");
    const active = cashState().day === key ? " active" : "";
    return `<button type="button" class="cash-day${tone ? ` ${tone}` : ""}${active}" data-cash-day="${esc(key)}">
      <span class="cash-day-main"><b>${esc(title)}</b><small>${esc(note)}${names ? ` · ${esc(names)}` : ""}</small></span>
      <span class="cash-day-sum">${esc(money(sum))}<small>${items.length} ${posWord(items.length)}</small></span>
    </button>`;
  }

  function renderCashCalendar(data) {
    const horizon = cashHorizon();
    const days = new Map();
    const overdue = [];
    const later = [];
    const nodate = [];
    data.items.forEach((it) => {
      if (!it.due) {
        nodate.push(it);
        return;
      }
      const diff = dayDiff(data.today, it.due);
      if (diff < 0) {
        overdue.push(it);
        return;
      }
      if (diff > horizon) {
        later.push(it);
        return;
      }
      const key = dayKey(it.due);
      if (!days.has(key)) days.set(key, { day: it.due, items: [] });
      days.get(key).items.push(it);
    });
    const rows = [];
    if (overdue.length) {
      const worst = overdue.reduce((acc, it) => Math.max(acc, it.overdue), 0);
      rows.push(cashDayRow({ key: "overdue", title: "Просрочено", note: `до ${worst} ${daysWord(worst)} задержки`, items: overdue, tone: "bad" }));
    }
    [...days.values()]
      .sort((a, b) => a.day - b.day)
      .forEach((g) => {
        const diff = dayDiff(data.today, g.day);
        const note = diff === 0 ? "сегодня" : diff === 1 ? "завтра" : `через ${diff} ${daysWord(diff)}`;
        rows.push(cashDayRow({ key: dayKey(g.day), title: dayLongFmt.format(g.day), note, items: g.items, tone: diff <= 3 ? "soon" : "" }));
      });
    if (later.length) rows.push(cashDayRow({ key: "later", title: `Дальше ${horizon} ${daysWord(horizon)}`, note: "за горизонтом прогноза", items: later, tone: "" }));
    if (nodate.length) rows.push(cashDayRow({ key: "nodate", title: "Срок не определён", note: "нет даты заказа и оплаты", items: nodate, tone: "" }));
    $("cash-calendar").innerHTML = rows.length
      ? `<div class="cash-days">${rows.join("")}</div>`
      : `<div class="empty">Долгов нет — платёжный календарь пуст.</div>`;
  }

  function renderCashAging(data) {
    const f = cashState();
    const groups = CASH_BUCKETS.map((b) => {
      const items = data.items.filter((it) => cashBucketId(it) === b.id);
      return { ...b, items, sum: cashSum(items) };
    });
    const total = data.receivable;
    if (total <= 0.005) {
      $("cash-aging").innerHTML = `<div class="empty">Вся дебиторка закрыта — старение считать не от чего.</div>`;
      return;
    }
    const stack = groups
      .filter((g) => g.sum > 0.005)
      .map((g) => `<span class="aging-seg" style="flex:${g.sum};background:${g.color}" title="${esc(g.label)}: ${esc(money(g.sum))}"></span>`)
      .join("");
    const rows = groups
      .map(
        (g) => `<button type="button" class="aging-row${f.bucket === g.id ? " active" : ""}${g.sum > 0.005 ? "" : " dim"}" data-cash-bucket="${g.id}">
          <i style="background:${g.color}"></i>
          <span class="aging-label">${esc(g.label)}</span>
          <span class="aging-share">${Math.round((g.sum / total) * 100)}%</span>
          <span class="aging-sum">${esc(money(g.sum))}</span>
        </button>`
      )
      .join("");
    const bad = groups.filter((g) => g.id === "d60" || g.id === "d60p").reduce((acc, g) => acc + g.sum, 0);
    const badShare = Math.round((bad / total) * 100);
    $("cash-aging").innerHTML = `<div class="aging-stack">${stack}</div><div class="aging-rows">${rows}</div>
      <p class="hint aging-hint">Безнадёжная зона (просрочка больше 30 дней): ${money(bad)} — ${badShare}% дебиторки.${badShare >= 20 ? " Портфель требует работы с должниками." : ""}</p>`;
  }

  function cashDayLabel(key) {
    if (key === "overdue") return "просрочка";
    if (key === "nodate") return "без срока";
    if (key === "later") return "за горизонтом";
    const day = keyToDay(key);
    return day ? dayShortFmt.format(day) : key;
  }

  function cashVisible(data) {
    const f = cashState();
    const horizon = cashHorizon();
    return data.items.filter((it) => {
      if (f.customer && it.customer !== f.customer) return false;
      if (f.bucket && cashBucketId(it) !== f.bucket) return false;
      if (f.day === "overdue" && !(it.overdue > 0)) return false;
      if (f.day === "nodate" && it.due) return false;
      if (f.day === "later" && !(it.due && dayDiff(data.today, it.due) > horizon)) return false;
      if (f.day && !["overdue", "nodate", "later"].includes(f.day) && (!it.due || dayKey(it.due) !== f.day)) return false;
      if (f.filter === "overdue" && !(it.overdue > 0)) return false;
      if (f.filter === "week" && !(it.due && dayDiff(data.today, it.due) <= 7)) return false;
      if (f.filter === "nodate" && it.due) return false;
      return true;
    });
  }

  function renderCashChips(data) {
    const f = cashState();
    const counts = {
      all: data.items.length,
      overdue: data.items.filter((it) => it.overdue > 0).length,
      week: data.items.filter((it) => it.due && dayDiff(data.today, it.due) <= 7).length,
      nodate: data.items.filter((it) => !it.due).length,
    };
    const chip = (id, label) =>
      `<button type="button" class="chip ${f.filter === id ? "active" : ""}" data-cash-filter="${id}">${label}<span class="chip-count">${counts[id]}</span></button>`;
    let html = chip("all", "Все") + chip("overdue", "Просрочено") + chip("week", "Срок ≤ 7 дней") + chip("nodate", "Без срока");
    if (f.day) html += `<button type="button" class="chip active" data-cash-clear="day" title="Убрать фильтр">День: ${esc(cashDayLabel(f.day))} ✕</button>`;
    if (f.bucket) {
      const bucket = CASH_BUCKETS.find((b) => b.id === f.bucket);
      html += `<button type="button" class="chip active" data-cash-clear="bucket" title="Убрать фильтр">${esc(bucket?.label || f.bucket)} ✕</button>`;
    }
    if (f.customer) html += `<button type="button" class="chip active" data-cash-clear="customer" title="Убрать фильтр">${esc(f.customer)} ✕</button>`;
    $("cash-chips").innerHTML = html;
  }

  function renderCashTable(data) {
    const rows = cashVisible(data);
    if (!rows.length) {
      $("cash-table").innerHTML = `<div class="empty">Под выбранный фильтр нет позиций.</div>`;
      return;
    }
    const body = rows
      .map((it) => {
        const bucket = CASH_BUCKETS.find((b) => b.id === cashBucketId(it));
        const overdueText = it.overdue === null ? "—" : it.overdue > 0 ? `${it.overdue} ${daysWord(it.overdue)}` : `в запасе ${Math.abs(it.overdue)} ${daysWord(it.overdue)}`;
        const dueHint = it.planned ? "дата оплаты указана в позиции" : `дата заказа + ${data.terms} ${daysWord(data.terms)}`;
        return `<tr data-cash-line="${esc(it.line.id)}" data-cash-order="${esc(it.order.id)}" data-cash-customer="${esc(it.customer)}">
          <td><button type="button" class="link-btn" data-cash-act="customer">${esc(it.customer)}</button></td>
          <td>${esc(it.order.number || "—")}${it.order.name ? `<small class="cash-sub">${esc(it.order.name)}</small>` : ""}</td>
          <td>${esc(it.line.product || "без продукта")}<small class="cash-sub">${esc(qtyValue(it.line))} ${esc(it.line.unit || "")}</small></td>
          <td class="num">${esc(money(it.amount))}<small class="cash-sub">из ${esc(money(it.totals.after))}</small></td>
          <td title="${esc(dueHint)}">${esc(cashDateText(it.due))}</td>
          <td><span class="pill" style="background:${bucket?.color || "#64748b"}">${esc(overdueText)}</span></td>
          <td>${it.expected ? esc(cashDateText(it.expected)) : "—"}${it.delay > 1 ? `<small class="cash-sub">клиент платит +${it.delay} ${daysWord(it.delay)}</small>` : ""}</td>
          <td><span class="pill" style="background:${statusMeta(it.line.status).color}">${esc(it.line.status)}</span></td>
          <td class="cash-acts">
            <button class="btn small" type="button" data-cash-act="open">Заказ</button>
            <button class="btn small" type="button" data-cash-act="remind">Напомнить</button>
            <button class="btn small primary" type="button" data-cash-act="pay">Оплата</button>
          </td>
        </tr>`;
      })
      .join("");
    $("cash-table").innerHTML = `<table class="data cash-table"><thead><tr>
        <th>Заказчик</th><th>Заказ</th><th>Позиция</th><th class="num">Долг</th><th>Срок оплаты</th><th>Просрочка</th><th>Прогноз оплаты</th><th>Статус</th><th></th>
      </tr></thead><tbody>${body}</tbody>
      <tfoot><tr>
        <td colspan="3">Итого ${rows.length} ${posWord(rows.length)}</td>
        <td class="num">${esc(money(cashSum(rows)))}</td>
        <td colspan="5"></td>
      </tr></tfoot></table>`;
  }

  function renderCashDebtors(data) {
    const map = new Map();
    data.items.forEach((it) => {
      const cur = map.get(it.customer) || { debt: 0, overdue: 0, count: 0, orders: new Set(), worst: 0, next: null };
      cur.debt += it.amount;
      cur.count += 1;
      cur.orders.add(it.order.id);
      if (it.overdue > 0) {
        cur.overdue += it.amount;
        cur.worst = Math.max(cur.worst, it.overdue);
      }
      if (it.due && (!cur.next || it.due < cur.next)) cur.next = it.due;
      map.set(it.customer, cur);
    });
    const list = [...map.entries()]
      .map(([name, v]) => {
        const hist = data.history.delays.get(name);
        return { name, ...v, delay: hist?.delay || 0, known: !!hist, last: hist?.last || "" };
      })
      .sort((a, b) => b.overdue - a.overdue || b.debt - a.debt);
    if (!list.length) {
      $("cash-debtors").innerHTML = `<div class="empty">Должников нет — все позиции оплачены.</div>`;
      return;
    }
    const body = list
      .map(
        (c) => `<tr data-cash-customer="${esc(c.name)}">
          <td><button type="button" class="link-btn" data-cash-dact="filter">${esc(c.name)}</button></td>
          <td class="num">${esc(money(c.debt))}</td>
          <td class="num">${c.overdue > 0.005 ? `<b class="cash-bad">${esc(money(c.overdue))}</b><small class="cash-sub">до ${c.worst} ${daysWord(c.worst)}</small>` : "—"}</td>
          <td class="num">${c.count} / ${c.orders.size}</td>
          <td>${esc(cashDateText(c.next))}</td>
          <td>${esc(cashDelayText(c.delay, c.known))}</td>
          <td>${c.last ? esc(c.last.slice(0, 10)) : "—"}</td>
          <td class="cash-acts"><button class="btn small" type="button" data-cash-dact="remind">Напомнить</button></td>
        </tr>`
      )
      .join("");
    $("cash-debtors").innerHTML = `<table class="data cash-table"><thead><tr>
        <th>Заказчик</th><th class="num">Долг</th><th class="num">Просрочено</th><th class="num">Поз. / зак.</th><th>Ближайший срок</th><th>Дисциплина</th><th>Последняя оплата</th><th></th>
      </tr></thead><tbody>${body}</tbody></table>`;
  }

  function cashReminderText(customer, items, data) {
    const total = cashSum(items);
    const out = [`Здравствуйте, ${customer}!`, "", `Напоминаем об оплате по ${items.length > 1 ? "заказам" : "заказу"}:`];
    const byOrder = new Map();
    items.forEach((it) => {
      if (!byOrder.has(it.order.id)) byOrder.set(it.order.id, { order: it.order, items: [] });
      byOrder.get(it.order.id).items.push(it);
    });
    byOrder.forEach(({ order, items: lines }) => {
      const sum = cashSum(lines);
      const due = lines.reduce((acc, it) => (it.due && (!acc || it.due < acc) ? it.due : acc), null);
      const worst = lines.reduce((acc, it) => Math.max(acc, it.overdue || 0), 0);
      const dueText = due ? ` · срок оплаты ${cashDateText(due)}${worst > 0 ? `, просрочка ${worst} ${daysWord(worst)}` : ""}` : "";
      out.push("", `Заказ ${order.number || ""}${order.name ? ` «${order.name}»` : ""} — остаток ${money(sum)}${dueText}`);
      lines.forEach((it) => {
        out.push(`  • ${it.line.product || "позиция"} — ${qtyValue(it.line)} ${it.line.unit || ""}: ${money(it.amount)}`.replace(/\s+:/, ":"));
      });
    });
    out.push("", `Итого к оплате: ${money(total)}`);
    if (data.terms) out.push(`Срок оплаты по договорённости — ${data.terms} ${daysWord(data.terms)} от даты заказа.`);
    return out.join("\n");
  }

  function cashSummaryText(data) {
    const soon = (n) => cashSum(data.items.filter((it) => it.expected && dayDiff(data.today, it.expected) <= n));
    const overdue = data.items.filter((it) => it.overdue > 0);
    const dso = Math.round(data.history.dso);
    const out = [
      `Касса и дебиторка — ${state.doc.title || "отчёт"}`,
      `На дату: ${dayLongFmt.format(data.today)}`,
      "",
      `Дебиторка: ${money(data.receivable)} (${data.items.length} ${posWord(data.items.length)} в ${new Set(data.items.map((it) => it.order.id)).size} ${ordWord(new Set(data.items.map((it) => it.order.id)).size)})`,
      `Просрочено: ${money(cashSum(overdue))} (${overdue.length} ${posWord(overdue.length)})`,
      `Ожидается за 7 дней: ${money(soon(7))}, за 30 дней: ${money(soon(30))}`,
      `Средний срок оплаты: ${data.history.known ? `${dso} ${daysWord(dso)}` : "нет данных"} (по договору ${data.terms} ${daysWord(data.terms)})`,
      "",
      "Старение дебиторки:",
    ];
    CASH_BUCKETS.forEach((b) => {
      const sum = cashSum(data.items.filter((it) => cashBucketId(it) === b.id));
      if (sum > 0.005) out.push(`  • ${b.label}: ${money(sum)}`);
    });
    const byCustomer = new Map();
    data.items.forEach((it) => byCustomer.set(it.customer, (byCustomer.get(it.customer) || 0) + it.amount));
    const top = [...byCustomer.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);
    if (top.length) {
      out.push("", "Крупнейшие должники:");
      top.forEach(([name, sum], i) => out.push(`  ${i + 1}. ${name} — ${money(sum)}`));
    }
    return out.join("\n");
  }

  async function cashCopy(text, okMessage) {
    try {
      if (state.desktop) await apiPost("/api/clipboard-text", { text });
      else if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(text);
      else throw new Error("clipboard");
      toast(okMessage);
    } catch {
      toast("Не удалось скопировать текст");
    }
  }

  function cashResetFilters() {
    const f = cashState();
    f.filter = "all";
    f.day = "";
    f.bucket = "";
    f.customer = "";
  }

  function cashMarkPaid(item) {
    historyCommit();
    const line = item.line;
    line.paid = item.totals.after;
    line.paid_expr = String(item.totals.after);
    if (!line.payment_date) line.payment_date = nowLocal();
    applyPaidIfCovered(line);
    markDirty();
    renderCashflow();
    undoToast(`Оплата ${money(item.amount)} по заказу ${item.order.number || ""}`.trim());
  }

  function onCashTableClick(e) {
    const btn = e.target.closest("[data-cash-act]");
    if (!btn) return;
    const tr = btn.closest("tr[data-cash-line]");
    if (!tr) return;
    const data = cashData();
    const item = data.items.find((it) => it.line.id === tr.dataset.cashLine);
    if (!item) return;
    const act = btn.dataset.cashAct;
    if (act === "open") {
      gotoOrder(item.order.id);
      return;
    }
    if (act === "customer") {
      const f = cashState();
      f.customer = f.customer === item.customer ? "" : item.customer;
      renderCashflow();
      return;
    }
    if (act === "remind") {
      const items = data.items.filter((it) => it.order.id === item.order.id);
      cashCopy(cashReminderText(item.customer, items, data), "Напоминание по заказу скопировано");
      return;
    }
    if (act === "pay") cashMarkPaid(item);
  }

  function onCashDebtorsClick(e) {
    const btn = e.target.closest("[data-cash-dact]");
    if (!btn) return;
    const tr = btn.closest("tr[data-cash-customer]");
    if (!tr) return;
    const customer = tr.dataset.cashCustomer;
    if (btn.dataset.cashDact === "filter") {
      const f = cashState();
      f.customer = f.customer === customer ? "" : customer;
      renderCashflow();
      return;
    }
    const data = cashData();
    const items = data.items.filter((it) => it.customer === customer);
    if (!items.length) return;
    cashCopy(cashReminderText(customer, items, data), `Напоминание для ${customer} скопировано`);
  }

  function bindCashflow() {
    $("cash-terms")?.addEventListener("change", (e) => {
      if (!state.doc) return;
      const v = Math.max(0, Math.min(365, Math.round(Number(e.target.value) || 0)));
      e.target.value = v;
      if (cashTerms() === v) return;
      ensureUi().payment_terms = v;
      markDirty();
      renderCashflow();
    });
    $("cash-horizon")?.addEventListener("change", (e) => {
      if (!state.doc) return;
      const v = Number(e.target.value) || 30;
      ensureUi().cash_horizon = CASH_HORIZONS.includes(v) ? v : 30;
      markDirty();
      renderCashflow();
    });
    $("cash-copy")?.addEventListener("click", () => {
      if (!state.doc) return;
      cashCopy(cashSummaryText(cashData()), "Сводка по кассе скопирована");
    });
    $("cash-calendar")?.addEventListener("click", (e) => {
      const btn = e.target.closest("[data-cash-day]");
      if (!btn) return;
      const f = cashState();
      f.day = f.day === btn.dataset.cashDay ? "" : btn.dataset.cashDay;
      renderCashflow();
    });
    $("cash-aging")?.addEventListener("click", (e) => {
      const btn = e.target.closest("[data-cash-bucket]");
      if (!btn) return;
      const f = cashState();
      f.bucket = f.bucket === btn.dataset.cashBucket ? "" : btn.dataset.cashBucket;
      renderCashflow();
    });
    $("cash-chips")?.addEventListener("click", (e) => {
      const f = cashState();
      const filter = e.target.closest("[data-cash-filter]");
      if (filter) {
        f.filter = filter.dataset.cashFilter;
        renderCashflow();
        return;
      }
      const clear = e.target.closest("[data-cash-clear]");
      if (!clear) return;
      f[clear.dataset.cashClear] = "";
      renderCashflow();
    });
    $("cash-table")?.addEventListener("click", onCashTableClick);
    $("cash-debtors")?.addEventListener("click", onCashDebtorsClick);
  }

