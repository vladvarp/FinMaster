  /* ==== Типы заказа: обычные, «налог» и «затрата» ==== */

  function typeEntry(item) {
    if (item && typeof item === "object" && !Array.isArray(item)) {
      const isTax = !!item.is_tax;
      return { name: String(item.name || "").trim(), is_tax: isTax, is_cost: !isTax && !!item.is_cost };
    }
    return { name: String(item || "").trim(), is_tax: false, is_cost: false };
  }

  function orderTypes() {
    return (state.doc?.order_types || []).map(typeEntry).filter((t) => t.name);
  }

  /** "tax" | "cost" | "" — пустая строка означает обычную доходную позицию. */
  function typeKind(name) {
    const key = String(name || "").trim();
    const meta = orderTypes().find((t) => t.name === key);
    return meta?.is_tax ? "tax" : meta?.is_cost ? "cost" : "";
  }

  function kindLabel(kind) {
    return kind === "tax" ? "налог" : kind === "cost" ? "затрата" : "";
  }

  function isExpenseLine(line) {
    return !!typeKind(line?.order_type);
  }

  function isFrozenLine(line) {
    return !!line?.frozen;
  }

  function typeNames(kind) {
    const list = orderTypes();
    if (kind === "expense") return list.filter((t) => t.is_tax || t.is_cost).map((t) => t.name);
    if (kind === "income") return list.filter((t) => !t.is_tax && !t.is_cost).map((t) => t.name);
    return list.map((t) => t.name);
  }

  function splitLines(lines) {
    const income = [];
    const expense = [];
    const frozen = [];
    (lines || []).forEach((line) => {
      if (isFrozenLine(line)) frozen.push(line);
      else if (isExpenseLine(line)) expense.push(line);
      else income.push(line);
    });
    return { income, expense, frozen };
  }

  /** Режим строки налога: «amount» — своя сумма, «gross» — % от выручки, «net» — % от выручки без затрат. */
  function taxMode(line) {
    const mode = String(line?.tax_mode || "amount");
    return mode === "gross" || mode === "net" ? mode : "amount";
  }

  function ownerOrder(line) {
    return (state.doc?.orders || []).find((o) => (o.lines || []).includes(line)) || null;
  }

  /** База процента налога: выручка заказа, в режиме «net» — минус затраты. Налог от налога не считается. */
  function orderTaxBase(order, mode) {
    let gross = 0;
    let costs = 0;
    for (const item of order?.lines || []) {
      if (isFrozenLine(item)) continue;
      const kind = typeKind(item.order_type);
      if (!kind) gross += lineTotals(item).after;
      else if (kind === "cost") costs += lineTotals(item).cost;
    }
    return round2(mode === "net" ? gross - costs : gross);
  }

  function lineTotals(line, order) {
    const qty = numExpr(line, "qty_expr", "quantity");
    const price = Math.max(0, numExpr(line, "price_expr", "price"));
    const kind = typeKind(line.order_type);
    if (kind) {
      const mode = kind === "tax" ? taxMode(line) : "amount";
      if (mode !== "amount") {
        const percent = Math.max(0, numExpr(line, "tax_percent_expr", "tax_percent"));
        const base = orderTaxBase(order || ownerOrder(line), mode);
        const cost = round2((base * percent) / 100);
        return { qty, price, discount: 0, total: cost, after: 0, paid: 0, unpaid: 0, cost, kind, expense: true, mode, percent, base };
      }
      const cost = round2(qty * price);
      return { qty, price, discount: 0, total: cost, after: 0, paid: 0, unpaid: 0, cost, kind, expense: true, mode: "amount", percent: 0, base: 0 };
    }
    const discount = Math.min(100, Math.max(0, numExpr(line, "discount_expr", "discount")));
    const total = round2(qty * price);
    const after = round2(total * (1 - discount / 100));
    const paid = Math.max(0, numExpr(line, "paid_expr", "paid"));
    return {
      qty,
      price,
      discount,
      total,
      after,
      paid,
      unpaid: round2(Math.max(0, after - paid)),
      cost: 0,
      kind: "",
      expense: false,
      mode: "amount",
      percent: 0,
      base: 0,
    };
  }

  function sumLines(lines, order) {
    const acc = (lines || []).reduce(
      (sum, line) => {
        if (isFrozenLine(line)) return sum;
        const t = lineTotals(line, order);
        if (t.expense) {
          sum.cost += t.cost;
          return sum;
        }
        sum.total += t.total;
        sum.after += t.after;
        sum.paid += t.paid;
        sum.unpaid += t.unpaid;
        return sum;
      },
      { total: 0, after: 0, paid: 0, unpaid: 0, cost: 0 }
    );
    acc.net = round2(acc.after - acc.cost);
    return acc;
  }

  function orderTotals(order) {
    return sumLines(order?.lines, order);
  }

  function money(n) {
    return `${moneyFmt.format(Number(n) || 0)} ${state.doc?.currency || "₽"}`;
  }

  function qtyText(line) {
    const t = lineTotals(line);
    const q = Math.round(t.qty * 1000) / 1000;
    return `${qtyFmt.format(q)} ${line.unit || ""}`.trim();
  }

  function compact(n) {
    const v = Number(n) || 0;
    if (Math.abs(v) >= 1e6) return `${(v / 1e6).toFixed(1).replace(".", ",")} млн`;
    if (Math.abs(v) >= 1e4) return `${Math.round(v / 1e3)} тыс`;
    return qtyFmt.format(v);
  }

  function statusMeta(name) {
    return (state.doc?.statuses || []).find((s) => s.name === name) || { name, color: "#94a3b8" };
  }

  function paidStatusName() {
    const list = state.doc?.statuses || [];
    const s = list.find((x) => x.is_paid) || list.find((x) => x.id === "paid");
    return s?.name || "";
  }

  function localStamp(d) {
    const p = (n) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  }

  function localDateTimeStamp(d) {
    const p = (n) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
  }

  function dateValue(v) {
    return String(v || "").slice(0, 10);
  }

  const DAY_MS = 86400000;
  const RU_MONTHS_GEN = ["января", "февраля", "марта", "апреля", "мая", "июня", "июля", "августа", "сентября", "октября", "ноября", "декабря"];
  const RU_MONTHS_NOM = ["Январь", "Февраль", "Март", "Апрель", "Май", "Июнь", "Июль", "Август", "Сентябрь", "Октябрь", "Ноябрь", "Декабрь"];
  const RU_WEEKDAYS = ["пн", "вт", "ср", "чт", "пт", "сб", "вс"];
  const DEFAULT_WEEKENDS = [5, 6];
  const WORK_STATUS = {
    nodate: { label: "без дат", tone: "mute", color: "#64748b" },
    planned: { label: "запланирован", tone: "wait", color: "#d97706" },
    now: { label: "идёт сейчас", tone: "now", color: "#0f766e" },
    done: { label: "завершён", tone: "ok", color: "#059669" },
    overdue: { label: "просрочен", tone: "warn", color: "#dc2626" },
    cancelled: { label: "снят", tone: "mute", color: "#64748b" },
    paused: { label: "На паузе", tone: "pause", color: "#7c3aed" },
  };

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

  function dayKey(d) {
    return localStamp(d);
  }

  function dayDiff(from, to) {
    return Math.round((to.getTime() - from.getTime()) / DAY_MS);
  }

  function mondayOf(d) {
    const x = dayStart(d);
    return addDays(x, -((x.getDay() + 6) % 7));
  }

  function weekdayIndex(d) {
    return (d.getDay() + 6) % 7;
  }

  function calendarOffSettings() {
    const saved = state.doc?.ui?.calendar || {};
    const weekends = Array.isArray(saved.weekends)
      ? [...new Set(saved.weekends.map(Number).filter((n) => Number.isInteger(n) && n >= 0 && n <= 6))].sort((a, b) => a - b)
      : DEFAULT_WEEKENDS.slice();
    const workDays = Array.isArray(saved.work_days) ? saved.work_days.map(String) : [];
    const offDays = Array.isArray(saved.off_days) ? saved.off_days.map(String) : [];
    return { weekends, offDays, workDays };
  }

  function isWeekend(d) {
    const tone = dayToneClass(d);
    return tone === "is-weekend" || tone === "is-off-day";
  }

  function isGlobalWeekend(d) {
    const off = calendarOffSettings();
    if (off.workDays.includes(dayKey(d))) return false;
    return off.weekends.includes(weekdayIndex(d));
  }

  function dayToneClass(d) {
    const key = dayKey(d);
    const off = calendarOffSettings();
    if (off.workDays.includes(key)) return "is-work-day";
    if (off.offDays.includes(key)) return "is-off-day";
    if (off.weekends.includes(weekdayIndex(d))) return "is-weekend";
    return "";
  }

  function calendarDayNotes() {
    const raw = state.doc?.ui?.calendar?.day_notes;
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
    const out = {};
    Object.keys(raw).forEach((key) => {
      const day = dateValue(key);
      const text = String(raw[key] || "").trim();
      if (/^\d{4}-\d{2}-\d{2}$/.test(day) && text) out[day] = text.slice(0, 2000);
    });
    return out;
  }

  function dayNote(d) {
    return calendarDayNotes()[typeof d === "string" ? d : dayKey(d)] || "";
  }

  function setDayNote(key, text) {
    if (!key || !state.doc) return;
    if (!state.doc.ui || typeof state.doc.ui !== "object") state.doc.ui = {};
    if (!state.doc.ui.calendar || typeof state.doc.ui.calendar !== "object") state.doc.ui.calendar = {};
    const notes = calendarDayNotes();
    const clean = String(text || "").trim().slice(0, 2000);
    if (clean) notes[key] = clean;
    else delete notes[key];
    state.doc.ui.calendar.day_notes = notes;
  }

  function calFmtDay(d) {
    return `${d.getDate()} ${RU_MONTHS_GEN[d.getMonth()]}`;
  }

  function orderIsOff(order) {
    const income = (order.lines || []).filter((line) => !isFrozenLine(line) && !isExpenseLine(line));
    if (!income.length) return false;
    return income.every((line) => /отмен|аннул|черн/i.test(line.status || ""));
  }

  function normalizeWorkDates(order) {
    const start = dateValue(order.work_start);
    const end = dateValue(order.work_end);
    order.work_start = start;
    order.work_end = end;
    if (start && end && end < start) {
      order.work_start = end;
      order.work_end = start;
    }
    if (!order.work_start && !order.work_end) order.work_pauses = [];
    else normalizeWorkPauses(order);
    return order;
  }

  function workPauses(order) {
    return Array.isArray(order?.work_pauses) ? order.work_pauses : [];
  }

  function pauseIsOpen(order, pause) {
    if (!pause || dateValue(order.work_end)) return false;
    if (pause.open) return true;
    const till = dateValue(pause.end);
    if (!till) return !!dateValue(pause.start);
    return till >= dayKey(dayStart(new Date()));
  }

  function pauseEndKey(order, pause, today = dayStart(new Date())) {
    if (pauseIsOpen(order, pause)) return dayKey(today);
    return dateValue(pause?.end);
  }

  function isPaused(order, day) {
    const key = typeof day === "string" ? String(day).slice(0, 10) : dayKey(dayStart(day));
    const today = dayStart(new Date());
    return workPauses(order).some((pause) => {
      const from = dateValue(pause.start);
      const till = pauseEndKey(order, pause, today);
      return from && till && key >= from && key <= till;
    });
  }

  function normalizeWorkPauses(order) {
    const start = dateValue(order.work_start);
    const end = dateValue(order.work_end);
    if (!start && !end) {
      order.work_pauses = [];
      return order;
    }
    const envStart = start;
    const envEnd = end || (start ? dayKey(dayStart(new Date())) : "");
    const items = [];
    workPauses(order).forEach((pause) => {
      if (!pause || typeof pause !== "object") return;
      let from = dateValue(pause.start);
      let till = dateValue(pause.end);
      const todayKey = envEnd && !end ? envEnd : dayKey(dayStart(new Date()));
      const wasOpen = !!(pause.open || !till);
      let open = !end && (wasOpen || (till && envEnd && till >= envEnd));
      if (from && till && till < from) [from, till] = [till, from];
      if (!from && !till && !wasOpen) return;
      from = from || till || envStart;
      if (envStart && from < envStart) from = envStart;
      if (open) till = envEnd;
      else {
        if (wasOpen) till = todayKey;
        till = till || from;
        if (envEnd && till > envEnd) till = envEnd;
      }
      if (envStart && till < envStart) return;
      if (envEnd && from > envEnd) return;
      if (from && till && from <= till) {
        items.push(open ? { start: from, end: "", open: true } : { start: from, end: till });
      }
    });
    items.sort((a, b) => a.start.localeCompare(b.start) || String(a.end || envEnd).localeCompare(String(b.end || envEnd)));
    const merged = [];
    items.forEach((pause) => {
      const last = merged[merged.length - 1];
      const lastEndKey = last ? (last.open ? envEnd : last.end) : "";
      const lastEnd = lastEndKey ? parseDay(lastEndKey) : null;
      const nextStart = parseDay(pause.start);
      if (last && lastEnd && nextStart && nextStart <= addDays(lastEnd, 1)) {
        if (pause.open || last.open) {
          last.end = "";
          last.open = true;
        } else if (pause.end > last.end) last.end = pause.end;
        return;
      }
      merged.push(pause.open ? { start: pause.start, end: "", open: true } : { start: pause.start, end: pause.end });
    });
    order.work_pauses = merged;
    return order;
  }

  function workStatus(order, today = dayStart(new Date())) {
    if (orderIsOff(order)) return "cancelled";
    const start = parseDay(order.work_start);
    const end = parseDay(order.work_end);
    if (!start && !end) return "nodate";
    if (start && !end) {
      if (start > today) return "planned";
      return "now";
    }
    if (!start && end) return end <= today ? "done" : "now";
    if (today < start) return "planned";
    if (end <= today) return "done";
    return "now";
  }

  function orderIsPausedNow(order, today = dayStart(new Date())) {
    const st = workStatus(order, today);
    if (st === "cancelled" || st === "nodate") return false;
    return isPaused(order, today);
  }

  function workStatusMeta(order, day) {
    const id = workStatus(order);
    const paused = day ? isPaused(order, day) : orderIsPausedNow(order);
    if (paused && id !== "cancelled" && id !== "nodate") return { id: "paused", ...WORK_STATUS.paused };
    return { id, ...(WORK_STATUS[id] || WORK_STATUS.nodate) };
  }

  function calendarRole(order, day) {
    if (isPaused(order, day)) return "На паузе";
    const key = dayKey(day);
    const start = dateValue(order.work_start);
    const end = dateValue(order.work_end);
    if (start === key && end === key) return "день";
    if (start === key) return "старт";
    if (end === key) return "финиш";
    return "в работе";
  }

  function workEndLabel(order) {
    const end = dateValue(order.work_end);
    if (end) return end;
    const id = workStatus(order);
    if (id === "planned") return "без дедлайна";
    if (id === "now") return "без дедлайна";
    return "нет конца";
  }

  function mcalDayTone(covering) {
    if (!covering.length) return "";
    const ids = covering.map((order) => workStatus(order));
    if (ids.includes("now")) return "has-now";
    if (ids.includes("planned")) return "has-planned";
    if (ids.includes("overdue")) return "has-overdue";
    return "has-done";
  }

  function firstWorkOnOrAfter(day, limit) {
    const cap = dayStart(limit || addDays(day, 16));
    for (let d = dayStart(day); d <= cap; d = addDays(d, 1)) {
      if (!isWeekend(d)) return d;
    }
    return null;
  }

  function orderCoversDay(order, day) {
    if (isWeekend(day) || isPaused(order, day)) return false;
    const start = parseDay(order.work_start);
    const end = parseDay(order.work_end);
    if (!start && !end) return false;
    const d = dayStart(day);
    const today = dayStart(new Date());
    if (start && !end) {
      if (start > today) {
        const shown = isWeekend(start) ? firstWorkOnOrAfter(start) : start;
        return shown && dayKey(d) === dayKey(shown);
      }
      return d >= start && d <= today;
    }
    if (!start && end) return d <= end;
    return d >= start && d <= end;
  }

  function orderMarksDay(order, day) {
    if (isWeekend(day)) return false;
    return isPaused(order, day) || orderCoversDay(order, day);
  }

  function setWorkToday(order, which) {
    const today = dayKey(dayStart(new Date()));
    if (which === "start") {
      order.work_start = today;
      if (order.work_end && order.work_end < today) order.work_end = "";
    } else {
      if (!order.work_start) order.work_start = today;
      order.work_end = today;
    }
    normalizeWorkDates(order);
  }

  function clearWorkDate(order, which) {
    if (which === "start") order.work_start = "";
    else order.work_end = "";
    normalizeWorkDates(order);
  }

  function workActButtons(order, forCalendar) {
    const start = dateValue(order.work_start);
    const end = dateValue(order.work_end);
    const idAttr = forCalendar ? ` data-cal-work="${esc(order.id)}"` : "";
    const startBtns = start
      ? `<label class="btn small mcal-datebtn">Сменить начальную дату<input type="date" value="${esc(start)}" data-cal-date="work_start"${idAttr}></label>
         <button type="button" class="btn small danger-ghost" data-work-act="clear-start"${idAttr}>Убрать начальную дату</button>`
      : `<button type="button" class="btn small" data-work-act="start"${idAttr}>Начать сегодня</button>`;
    const endBtns = end
      ? `<label class="btn small mcal-datebtn">Сменить конечную дату<input type="date" value="${esc(end)}" data-cal-date="work_end"${idAttr}></label>
         <button type="button" class="btn small danger-ghost" data-work-act="clear-end"${idAttr}>Убрать конечную дату</button>`
      : `<button type="button" class="btn small" data-work-act="end"${idAttr}>Закончить сегодня</button>`;
    return startBtns + endBtns;
  }

  function latestDaysFirst(from, to) {
    return rangeDays(from, to).slice().reverse();
  }

  function fmtDate(v) {
    if (!v) return "—";
    return dateValue(v) || "—";
  }

  function esc(s) {
    return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }

  function toast(text) {
    const el = $("toast");
    el.textContent = text;
    el.classList.add("show");
    clearTimeout(el._t);
    el._t = setTimeout(() => el.classList.remove("show"), 2400);
  }

  function setSync(kind, text) {
    const bar = $("sync-bar");
    $("sync-text").textContent = text;
    bar.className = `sync-bar show ${kind}`;
    clearTimeout(bar._t);
    if (kind === "ok") bar._t = setTimeout(() => bar.classList.remove("show"), 1600);
  }

  function noteOffline() {
    state.offline = true;
    setSync("err", "нет связи с компьютером");
  }

  function noteOnline() {
    if (!state.offline) return;
    state.offline = false;
    setSync("ok", "подключено");
    wakeSleep();
  }

  function isTyping() {
    const el = document.activeElement;
    return !!el && /^(INPUT|SELECT|TEXTAREA)$/.test(el.tagName);
  }

