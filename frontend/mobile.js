(() => {
  "use strict";

  const $ = (id) => document.getElementById(id);
  const LS_TOKEN = "finmaster.remote.token";
  const LS_THEME = "finmaster.mobile.theme";
  const LS_NAME = "finmaster.remote.name";
  const LS_CID = "finmaster.remote.cid";
  const LS_SNAP = "finmaster.mobile.snapshot";
  const moneyFmt = new Intl.NumberFormat("ru-RU", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  const state = {
    token: "",
    cid: "",
    doc: null,
    version: 0,
    docVersion: 0,
    path: "",
    dirty: false,
    recent: [],
    library: { path: "", items: [] },
    listsSig: "",
    clients: [],
    history: { undo: false, redo: false, index: -1, limit: 40, items: [] },
    view: "orders",
    orderId: null,
    ordersResume: null,
    scroll: { orders: 0, stats: 0, snapshot: 0, files: 0, calendar: 0, order: {} },
    editLineId: null,
    headOpen: false,
    cal: { mode: "extended", filter: "all", anchor: null },
    query: "",
    filter: "all",
    stats: { period: "all", filter: "all", status: "" },
    sort: "date-desc",
    pending: null,
    pushTimer: null,
    pushing: false,
    pinging: false,
    stopped: false,
    autosave: false,
    snap: {
      orderId: null,
      lines: null,
      fields: null,
      theme: "teal",
      hideLabels: false,
      hideStamp: false,
      title: "",
      fieldsOpen: false,
      linesOpen: false,
    },
    device: null,
    deviceFactsOpen: false,
    snapReturn: null,
    homeScreen: "",
    waitingForDoc: false,
    expectPath: "",
    offline: false,
    exprField: "",
    exprInput: null,
    exprSystemKb: false,
  };

  /* ================= утилиты ================= */

  let sleepWake = null;
  const sleep = (ms) => new Promise((resolve) => {
    const timer = setTimeout(() => {
      if (sleepWake === resolve) sleepWake = null;
      resolve();
    }, ms);
    sleepWake = () => {
      clearTimeout(timer);
      sleepWake = null;
      resolve();
    };
  });
  function wakeSleep() {
    sleepWake?.();
  }

  function sameFile(a, b) {
    const n = (p) => String(p || "").replace(/\//g, "\\").toLowerCase();
    return !!a && !!b && n(a) === n(b);
  }

  function uid() {
    if (crypto.randomUUID) return crypto.randomUUID();
    return `id-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  }

  function num(v) {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
  }

  const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
  const EXPR_MIRROR = {
    qty_expr: "quantity",
    price_expr: "price",
    discount_expr: "discount",
    paid_expr: "paid",
    tax_percent_expr: "tax_percent",
  };
  const TAX_MODES = [
    ["gross", "% от выручки"],
    ["net", "% от выручки − затраты"],
    ["amount", "Своя сумма"],
  ];

  function isFormula(expr) {
    return /[+\-*/()×xX÷]/.test(String(expr || ""));
  }

  function isBareZeroExpr(value) {
    return /^0([.,]0+)?$/.test(String(value || "").trim());
  }

  function stripLeadingZerosPlain(raw) {
    const text = String(raw ?? "").replaceAll(",", ".");
    if (!text || isFormula(text)) return String(raw ?? "");
    const m = /^(-?)0+(\d+(?:\.\d*)?)$/.exec(text);
    return m ? m[1] + m[2] : text;
  }

  function formatExprResult(n) {
    const r = round2(n);
    return Number.isInteger(r) ? String(r) : String(r);
  }

  function exprRaw(line, field) {
    const raw = line[field];
    if (raw != null && String(raw).trim() !== "") return String(raw);
    const numKey = EXPR_MIRROR[field];
    return String((numKey && line[numKey]) ?? "");
  }

  function shownExprValue(line, field) {
    const expr = exprRaw(line, field);
    const v = evalExpr(expr);
    if (isFormula(expr) && Number.isFinite(v)) return formatExprResult(v);
    return expr;
  }

  function evalExpr(raw) {
    const s = String(raw ?? "").trim().replaceAll("×", "*").replaceAll("÷", "/").replaceAll(",", ".");
    if (!s) return 0;
    const normalized = s.replace(/(\d)\s*[xX]\s*(\d)/g, "$1*$2");
    if (!/^[\d+\-*/().\s]+$/.test(normalized)) return NaN;
    try {
      const value = Function(`"use strict"; return (${normalized});`)();
      return typeof value === "number" && Number.isFinite(value) ? value : NaN;
    } catch {
      return NaN;
    }
  }

  function numExpr(line, exprKey, numKey) {
    const raw = line[exprKey] != null && String(line[exprKey]).trim() !== "" ? line[exprKey] : line[numKey];
    const v = evalExpr(raw);
    return Number.isFinite(v) ? v : num(line[numKey]);
  }

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
    return `${moneyFmt.format(q).replace(",000", "").replace(/,00$/, "")} ${line.unit || ""}`.trim();
  }

  function compact(n) {
    const v = Number(n) || 0;
    if (Math.abs(v) >= 1e6) return `${(v / 1e6).toFixed(1).replace(".", ",")} млн`;
    if (Math.abs(v) >= 1e4) return `${Math.round(v / 1e3)} тыс`;
    return moneyFmt.format(v).replace(",00", "");
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

  /* ================= сеть ================= */

  function guessDeviceName(profile) {
    const info = profile || state.device || {};
    if (info.model) return info.model;
    const ua = navigator.userAgent || "";
    if (/iPhone/.test(ua)) {
      const ios = ua.match(/OS (\d+)[_.](\d+)/);
      return ios ? `iPhone · iOS ${ios[1]}.${ios[2]}` : "iPhone";
    }
    if (/iPad/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1)) return "iPad";
    const android = ua.match(/Android[^;]*;\s*([^);]+)/);
    if (android) {
      const model = android[1].replace(/\s*Build\/.*$/i, "").replace(/^wv$/i, "").trim();
      if (model && !/^Android$/i.test(model)) return model;
    }
    if (/Android/i.test(ua)) return "Android";
    return "Телефон";
  }

  function customDeviceName() {
    const raw = (localStorage.getItem(LS_NAME) || "").trim();
    if (!raw || raw === "Телефон" || raw === "Android" || raw === "iPhone") return "";
    return raw;
  }

  function deviceName() {
    return customDeviceName() || guessDeviceName();
  }

  function devicePayload() {
    const info = state.device || {};
    return {
      name: deviceName(),
      model: info.model || "",
      platform: info.platform || "",
      platform_version: info.platformVersion || "",
      brands: info.brands || "",
      user_agent: navigator.userAgent || "",
      language: navigator.language || "",
      screen: `${window.screen?.width || 0}×${window.screen?.height || 0}`,
      viewport: `${window.innerWidth}×${window.innerHeight}`,
      pixel_ratio: String(window.devicePixelRatio || 1),
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "",
    };
  }

  async function detectDeviceProfile() {
    const ua = navigator.userAgent || "";
    const uaData = navigator.userAgentData;
    const info = {
      model: "",
      platform: navigator.platform || "",
      platformVersion: "",
      brands: "",
      mobile: /Mobi|Android|iPhone|iPad/i.test(ua),
    };
    try {
      if (uaData) {
        info.mobile = !!uaData.mobile;
        info.platform = uaData.platform || info.platform;
        info.brands = (uaData.brands || [])
          .map((b) => b.brand)
          .filter((b) => b && !/not.?a.?brand/i.test(b) && b !== "Chromium")
          .join(", ");
        if (uaData.getHighEntropyValues) {
          const high = await Promise.race([
            uaData.getHighEntropyValues(["model", "platform", "platformVersion"]),
            new Promise((resolve) => setTimeout(() => resolve({}), 700)),
          ]);
          info.model = String(high.model || "").trim();
          info.platform = high.platform || info.platform;
          info.platformVersion = String(high.platformVersion || "").trim();
        }
      }
    } catch {
      /* браузер не отдал модель */
    }
    if (!info.model) {
      const guessed = guessDeviceName(info);
      if (guessed !== "Телефон" && guessed !== "Android") info.model = guessed;
    }
    info.name = guessDeviceName(info);
    state.device = info;
    return info;
  }

  function deviceHeader() {
    try {
      const json = JSON.stringify(devicePayload());
      return btoa(unescape(encodeURIComponent(json)));
    } catch {
      return "";
    }
  }

  async function api(path, options = {}) {
    const sep = path.includes("?") ? "&" : "?";
    const extra = `t=${encodeURIComponent(state.token)}&cid=${encodeURIComponent(state.cid)}&name=${encodeURIComponent(deviceName())}`;
    const headers = {
      "Content-Type": "application/json",
      "X-FM-Token": state.token,
      "ngrok-skip-browser-warning": "1",
      ...(options.headers || {}),
    };
    const device = deviceHeader();
    if (device) headers["X-FM-Device"] = device;
    const res = await fetch(`${path}${sep}${extra}`, {
      ...options,
      headers,
    });
    const data = await res.json().catch(() => ({}));
    if (res.status === 401 || res.status === 403) {
      const reason = data.error || "Откройте на компьютере «Телефон» и отсканируйте QR-код заново.";
      blocked("Сессия закрыта", reason);
      throw new Error(reason);
    }
    if (!res.ok) {
      const err = new Error(data.error || res.statusText);
      err.code = data.code || "";
      err.suggested = data.suggested || "";
      throw err;
    }
    noteOnline();
    return data;
  }

  function blocked(title, text) {
    state.stopped = true;
    $("blocker-title").textContent = title;
    $("blocker-text").textContent = text;
    $("blocker").classList.add("is-on");
    $("blocker").hidden = false;
  }

  function unblocked() {
    state.stopped = false;
    $("blocker").classList.remove("is-on");
    $("blocker").hidden = true;
  }

  let telegramApp = null;

  function telegramColor(name, fallback) {
    return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;
  }

  function paintTelegram(tg) {
    if (!tg) return;
    const accent = telegramColor("--accent", "#0f766e");
    const bg = telegramColor("--bg", "#f1f5f9");
    try {
      tg.setHeaderColor(accent);
    } catch (_) {}
    try {
      tg.setBackgroundColor(bg);
    } catch (_) {}
    if (typeof tg.setBottomBarColor === "function") {
      try {
        tg.setBottomBarColor(bg);
      } catch (_) {}
    }
  }

  function enterTelegramFullscreen(tg) {
    if (!tg || typeof tg.requestFullscreen !== "function" || tg.isFullscreen) return;
    try {
      tg.requestFullscreen();
    } catch (_) {}
  }

  function refreshHomeScreenStatus() {
    const tg = telegramApp;
    if (!tg || typeof tg.checkHomeScreenStatus !== "function") {
      state.homeScreen = telegramApp ? "unsupported" : "";
      return;
    }
    try {
      tg.checkHomeScreenStatus((status) => {
        state.homeScreen = status || "unknown";
        if (state.view === "files") renderFiles();
        renderMenu();
      });
    } catch (_) {
      state.homeScreen = "unsupported";
    }
  }

  function addToHomeScreen() {
    const tg = telegramApp;
    if (!tg) {
      toast("Ярлык как у игр доступен только внутри Telegram");
      return;
    }
    if (typeof tg.addToHomeScreen !== "function") {
      toast("Обновите Telegram — эта версия не ставит ярлык на экран");
      return;
    }
    if (state.homeScreen === "added") {
      toast("Ярлык уже на экране телефона");
      return;
    }
    if (state.homeScreen === "unsupported") {
      toast("Телефон или Telegram не умеет ярлык Mini App. В @BotFather: Mini App → иконка.");
      return;
    }
    try {
      tg.addToHomeScreen();
    } catch (_) {
      toast("Не удалось показать запрос ярлыка");
    }
  }

  function initTelegram() {
    const tg = window.Telegram && window.Telegram.WebApp;
    if (!tg || !tg.initData) return;
    telegramApp = tg;
    document.documentElement.classList.add("in-telegram");
    document.documentElement.classList.toggle("tg-fullscreen", Boolean(tg.isFullscreen));
    try {
      tg.ready();
    } catch (_) {}
    try {
      tg.expand();
    } catch (_) {}
    if (typeof tg.disableVerticalSwipes === "function") {
      try {
        tg.disableVerticalSwipes();
      } catch (_) {}
    }
    paintTelegram(tg);
    enterTelegramFullscreen(tg);
    if (typeof tg.onEvent === "function") {
      tg.onEvent("fullscreenChanged", () => {
        document.documentElement.classList.toggle("tg-fullscreen", Boolean(tg.isFullscreen));
        paintTelegram(tg);
      });
      tg.onEvent("fullscreenFailed", (err) => {
        if (err && err.error === "ALREADY_FULLSCREEN") {
          document.documentElement.classList.add("tg-fullscreen");
        }
      });
      tg.onEvent("homeScreenAdded", () => {
        state.homeScreen = "added";
        toast("Ярлык добавлен на экран телефона");
        if (state.view === "files") renderFiles();
        renderMenu();
      });
      tg.onEvent("homeScreenChecked", (ev) => {
        if (ev && ev.status) state.homeScreen = ev.status;
      });
      tg.onEvent("homeScreenFailed", () => {
        toast("Ярлык не добавлен");
      });
    }
    refreshHomeScreenStatus();
    setTimeout(() => enterTelegramFullscreen(tg), 80);
    setTimeout(() => enterTelegramFullscreen(tg), 400);
  }

  async function boot() {
    const params = new URLSearchParams(location.search);
    const fromUrl = params.get("t");
    state.token = fromUrl || localStorage.getItem(LS_TOKEN) || "";
    state.stopped = false;
    state.cid = localStorage.getItem(LS_CID) || uid();
    localStorage.setItem(LS_CID, state.cid);
    try {
      await detectDeviceProfile();
    } catch {
      state.device = state.device || {};
    }
    if (fromUrl) {
      localStorage.setItem(LS_TOKEN, fromUrl);
      const url = new URL(location.href);
      if (url.searchParams.get("t") !== fromUrl) {
        url.searchParams.set("t", fromUrl);
        history.replaceState(null, "", url.pathname + url.search);
      }
    } else if (state.token && !params.get("t")) {
      const url = new URL(location.href);
      url.searchParams.set("t", state.token);
      history.replaceState(null, "", url.pathname + url.search);
    }
    if (!state.token) {
      blocked("Нет доступа", "Отсканируйте QR-код в окне «Телефон» на компьютере.");
      return;
    }
    try {
      const data = await api("/api/remote/session");
      unblocked();
      try {
        localStorage.setItem("finmaster.remote.url", location.href);
      } catch {
        /* ignore */
      }
      applySnapshot(data, true);
      state.recent = data.recent || [];
      if (data.library) state.library = data.library;
      if (!hasDocument()) {
        state.waitingForDoc = true;
        setView("files");
      } else {
        renderCurrent();
      }
      setSync("ok", "подключено");
      navReport();
      pollLoop();
    } catch (err) {
      if (!state.stopped) blocked("Нет связи", "Компьютер недоступен. Проверьте, что оба устройства в одной сети.");
    }
  }

  async function pollLoop() {
    while (!state.stopped) {
      const before = state.version;
      try {
        const data = await api(`/api/remote/pull?since=${state.version}&cid=${encodeURIComponent(state.cid)}&kind=mobile`);
        if (data.enabled === false) {
          blocked("Сессия завершена", "На компьютере выключили удалённый доступ.");
          return;
        }
        if (typeof data.version === "number") state.version = Math.max(state.version, data.version);
        if (typeof data.autosave === "boolean") applyAutosave(data.autosave);
        if (data.changed) applySnapshot(data);
        else {
          noteOnline();
          if (applyFileLists(data) && state.view === "files") renderFiles();
        }
        if (state.version <= before) await sleep(400);
      } catch (err) {
        if (state.stopped) return;
        noteOffline();
        await sleep(2000);
      }
    }
  }

  function hasDocument() {
    return !!(state.doc && typeof state.doc === "object");
  }

  function normalizeHistory(raw) {
    const items = Array.isArray(raw?.items) ? raw.items : [];
    return {
      undo: !!raw?.undo,
      redo: !!raw?.redo,
      index: Number.isInteger(raw?.index) ? raw.index : -1,
      limit: Math.max(5, Math.min(200, Number(raw?.limit) || 40)),
      items,
    };
  }

  function historyTime(iso) {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return "";
    return d.toLocaleString("ru-RU", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
  }

  function fileListsSig(library, recent) {
    const lib = (library?.items || []).map((item) => `${item.path}|${item.modified_at}|${item.bytes}`).join("\n");
    const rec = (recent || []).map((item) => `${item.path}|${item.exists}`).join("\n");
    return `${lib}#${rec}`;
  }

  function applyFileLists(data) {
    if (!data) return false;
    const hasLib = data.library && typeof data.library === "object";
    const hasRec = Array.isArray(data.recent);
    if (!hasLib && !hasRec) return false;
    const library = hasLib ? data.library : state.library;
    const recent = hasRec ? data.recent : state.recent;
    const sig = fileListsSig(library, recent);
    if (sig === state.listsSig) return false;
    state.listsSig = sig;
    if (hasLib) state.library = library;
    if (hasRec) state.recent = recent;
    return true;
  }

  function applySnapshot(data, initial = false) {
    if (typeof data.version === "number") state.version = Math.max(state.version, data.version);
    if (typeof data.autosave === "boolean") applyAutosave(data.autosave);
    const prevPath = state.path;
    const prevHadDoc = !!state.doc;
    const pathChanged = !!(data.path && prevPath && !sameFile(data.path, prevPath));
    const expectHit = !!(state.expectPath && data.path && sameFile(data.path, state.expectPath));
    if (typeof data.path === "string") state.path = data.path;
    if (typeof data.dirty === "boolean") state.dirty = data.dirty;
    if (Array.isArray(data.clients)) state.clients = data.clients;
    const listsChanged = applyFileLists(data);
    if (data.history && typeof data.history === "object") {
      state.history = normalizeHistory(data.history);
      if ($("sheet-title")?.textContent === "История" && !$("sheet").hidden) renderHistorySheet();
    }
    updateHead();
    if (!data.document) {
      if (state.doc) state.doc = null;
      state.waitingForDoc = true;
      if (!initial && state.view !== "files") setView("files");
      else if (!initial) renderCurrent();
      return;
    }
    const incomingVer = typeof data.doc_version === "number" ? data.doc_version : null;
    const fresh = incomingVer == null ? true : incomingVer > state.docVersion;
    if (!initial && !fresh && !pathChanged && !expectHit) {
      if (listsChanged && state.view === "files") renderFiles();
      return;
    }
    if (!initial && data.origin === state.cid && !pathChanged && !expectHit) {
      if (incomingVer != null) state.docVersion = Math.max(state.docVersion, incomingVer);
      if (listsChanged && state.view === "files") renderFiles();
      return;
    }
    if (!initial && (state.pushTimer || state.pushing || isTyping()) && !pathChanged && !expectHit) {
      if (data.document) state.pending = data.document;
      if (listsChanged && state.view === "files") renderFiles();
      return;
    }
    if (incomingVer != null) state.docVersion = Math.max(state.docVersion, incomingVer);
    state.doc = data.document;
    const opened = !initial && (!prevHadDoc || pathChanged || expectHit);
    if (expectHit) state.expectPath = "";
    if (!initial) {
      state.offline = false;
      setSync("ok", opened ? "отчёт открыт" : "обновлено с компьютера");
    }
    if (opened && (state.view === "files" || state.waitingForDoc)) {
      state.waitingForDoc = false;
      setView("orders");
      return;
    }
    renderCurrent();
  }

  function flushPending() {
    if (!state.pending || isTyping()) return;
    state.doc = state.pending;
    state.pending = null;
    renderCurrent();
    setSync("ok", "обновлено с компьютера");
  }

  function pushSoon() {
    state.dirty = true;
    updateHead();
    clearTimeout(state.pushTimer);
    state.pushTimer = setTimeout(push, 350);
  }

  async function push() {
    clearTimeout(state.pushTimer);
    state.pushTimer = null;
    if (!state.doc || state.stopped) return;
    state.pushing = true;
    try {
      const res = await api("/api/remote/push", {
        method: "POST",
        body: JSON.stringify({ document: state.doc, cid: state.cid }),
      });
      state.version = res.version;
      setSync("ok", "передано на компьютер");
    } catch {
      setSync("err", "изменения не отправлены");
    } finally {
      state.pushing = false;
      flushPending();
    }
  }

  async function command(type, extra = {}) {
    try {
      const res = await api("/api/remote/command", { method: "POST", body: JSON.stringify({ type, ...extra }) });
      state.version = res.version;
      return true;
    } catch (err) {
      toast(`Не удалось: ${err.message || err}`);
      return false;
    }
  }

  async function waitForOpenedReport(path) {
    state.expectPath = path;
    wakeSleep();
    for (let i = 0; i < 24; i += 1) {
      try {
        const data = await api("/api/remote/session");
        if (data.document && data.path && sameFile(data.path, path)) {
          applySnapshot(data);
          if (state.view === "files") setView("orders");
          return;
        }
      } catch {
        /* компьютер ещё поднимается */
      }
      await sleep(160);
    }
  }

  async function createNewReport() {
    if (state.dirty && !confirm("Создать новый отчёт? Несохранённые правки нужно сохранить заранее.")) return;
    const typed = prompt("Название нового отчёта:", "Новый отчёт");
    if (typed == null) return;
    let title = typed.trim() || "Новый отчёт";
    for (;;) {
      try {
        const res = await api("/api/remote/command", {
          method: "POST",
          body: JSON.stringify({ type: "new", title }),
        });
        state.version = res.version;
        toast(`Создаю «${res.title || title}»…`);
        return;
      } catch (err) {
        if (err.code === "exists") {
          const next = prompt(`Файл «${title}» уже есть в Документы\\FinMaster.\nВведите другое имя:`, err.suggested || `${title} 2`);
          if (next == null) return;
          title = next.trim();
          if (!title) return;
          continue;
        }
        toast(`Не удалось: ${err.message || err}`);
        return;
      }
    }
  }

  function applyAutosave(enabled) {
    if (typeof enabled !== "boolean") return;
    state.autosave = enabled;
    const el = $("m-autosave");
    if (el) el.checked = enabled;
  }

  function navReport() {
    if (state.stopped || !state.token) return;
    const view = state.view;
    const orderId = view === "order" ? state.orderId || "" : "";
    const payload = { view, order_id: orderId, cid: state.cid };
    if (view === "order" && state.editLineId) payload.line_id = state.editLineId;
    if (view === "stats") {
      payload.period = state.stats.period || "all";
      payload.filter = state.stats.filter || "all";
      payload.status = state.stats.status || "";
    }
    api("/api/remote/nav", { method: "POST", body: JSON.stringify(payload) }).catch(() => {});
  }

  /* ================= модель ================= */

  function orders() {
    return state.doc?.orders || [];
  }

  function currentOrder() {
    return orders().find((o) => o.id === state.orderId) || null;
  }

  function findLine(order, id) {
    return (order?.lines || []).find((l) => l.id === id) || null;
  }

  function emptyLine() {
    return {
      id: uid(),
      order_type: typeNames("income")[0] || typeNames()[0] || "",
      product: "",
      quantity: 1,
      qty_expr: "1",
      unit: state.doc.units?.[0] || "шт.",
      price: 0,
      price_expr: "0",
      discount: 0,
      discount_expr: "0",
      order_date: localStamp(new Date()),
      paid: 0,
      paid_expr: "0",
      payment_date: "",
      status: state.doc.statuses?.[0]?.name || "Новый заказ",
      tax_mode: "gross",
      tax_percent: 0,
      tax_percent_expr: "0",
      work_start: "",
      work_end: "",
      work_pauses: [],
      frozen: false,
    };
  }

  function nextOrderNumber() {
    const nums = orders()
      .map((o) => parseInt(String(o.number || "").replace(/\D/g, ""), 10))
      .filter((n) => Number.isFinite(n));
    const next = (nums.length ? Math.max(...nums) : 0) + 1;
    return String(next).padStart(4, "0");
  }

  function emptyOrder() {
    return {
      id: uid(),
      number: nextOrderNumber(),
      customer: "",
      name: "",
      notes: "",
      created_at: localStamp(new Date()),
      work_start: "",
      work_end: "",
      work_pauses: [],
      lines: [emptyLine()],
    };
  }

  function matchesQuery(order, q) {
    if (!q) return true;
    const hay = [order.number, order.customer, order.name, order.notes]
      .concat((order.lines || []).map((l) => `${l.product} ${l.status} ${l.order_type}`))
      .join(" ")
      .toLowerCase();
    return hay.includes(q);
  }

  function matchesFilter(order, filter) {
    const t = orderTotals(order);
    if (filter === "debt") return t.unpaid > 0.005;
    if (filter === "paid") return t.after > 0 && t.unpaid <= 0.005;
    if (filter === "month") {
      const now = new Date();
      const key = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
      return (order.lines || []).some((l) => String(l.order_date || "").startsWith(key));
    }
    return true;
  }

  function orderNewestStamp(order) {
    let best = "";
    for (const line of order.lines || []) {
      const d = String(line.order_date || "").slice(0, 10);
      if (d.length >= 10 && d > best) best = d;
    }
    if (best) return best;
    return String(order.created_at || "").slice(0, 10);
  }

  const SORT_OPTIONS = [
    { value: "date-desc", label: "Сначала новые" },
    { value: "date-asc", label: "Сначала старые" },
    { value: "number", label: "По номеру" },
    { value: "customer", label: "По заказчику" },
    { value: "amount-desc", label: "По сумме" },
  ];

  function compareOrders(a, b, sort) {
    if (sort === "date-asc") return orderNewestStamp(a).localeCompare(orderNewestStamp(b));
    if (sort === "number") return String(a.number || "").localeCompare(String(b.number || ""), "ru", { numeric: true });
    if (sort === "customer") return String(a.customer || "").localeCompare(String(b.customer || ""), "ru");
    if (sort === "amount-desc") return orderTotals(b).after - orderTotals(a).after;
    return orderNewestStamp(b).localeCompare(orderNewestStamp(a));
  }

  function visibleOrders() {
    const q = state.query.trim().toLowerCase();
    return orders()
      .filter((o) => matchesQuery(o, q) && matchesFilter(o, state.filter))
      .sort((a, b) => compareOrders(a, b, state.sort));
  }

  function orderQueue(orderId = state.orderId) {
    const shown = visibleOrders();
    if (shown.some((o) => o.id === orderId)) return shown;
    return orders()
      .slice()
      .sort((a, b) => compareOrders(a, b, state.sort));
  }

  function neighborOrder(dir, orderId = state.orderId) {
    const list = orderQueue(orderId);
    const i = list.findIndex((o) => o.id === orderId);
    if (i < 0) return null;
    return list[i + dir] || null;
  }

  function flashSwipe(screen, dir) {
    if (!screen) return;
    screen.classList.remove("swipe-next", "swipe-prev");
    void screen.offsetWidth;
    screen.classList.add(dir > 0 ? "swipe-next" : "swipe-prev");
  }

  function showNeighborOrder(dir) {
    if (state.view !== "order") return false;
    if (!$("editor").hidden || !$("sheet").hidden) return false;
    const next = neighborOrder(dir);
    if (!next) return false;
    state.headOpen = false;
    setView("order", next.id);
    flashSwipe($("screen-order"), dir);
    try {
      navigator.vibrate?.(10);
    } catch (_) {}
    return true;
  }

  function showNeighborSnap(dir) {
    if (state.view !== "snapshot") return false;
    if (!$("sheet").hidden) return false;
    const current = snapOrder();
    if (!current) return false;
    const next = neighborOrder(dir, current.id);
    if (!next) return false;
    state.snap.orderId = next.id;
    state.snap.lines = null;
    state.snap.linesOpen = false;
    renderSnapshot();
    flashSwipe($("screen-snapshot"), dir);
    try {
      navigator.vibrate?.(10);
    } catch (_) {}
    return true;
  }

  function updateSortBtn() {
    const btn = $("btn-sort");
    if (!btn) return;
    const cur = SORT_OPTIONS.find((x) => x.value === state.sort) || SORT_OPTIONS[0];
    btn.textContent =
      state.sort === "date-asc"
        ? "↑ старые"
        : state.sort === "amount-desc"
          ? "Σ сумма"
          : state.sort === "number"
            ? "номер"
            : state.sort === "customer"
              ? "Ая клиент"
              : "↓ новые";
    btn.title = cur.label;
  }

  function touchDoc() {
    if (state.doc) state.doc.modified_at = new Date().toISOString();
  }

  /* ================= общая отрисовка ================= */

  function updateHead() {
    $("head-title").textContent = hasDocument() ? state.doc.title || "FinMaster" : "Недавние отчёты";
    const file = hasDocument()
      ? state.path
        ? state.path.split(/[\\/]/).pop()
        : "файл не сохранён"
      : "на компьютере ничего не открыто";
    const phones = state.clients.filter((c) => c.kind === "mobile").length;
    $("head-sub").textContent = `${state.dirty ? "• " : ""}${file}${phones > 1 ? ` · ${phones} телефона` : ""}`;
    $("btn-back").hidden = !(state.view === "order" || (state.view === "snapshot" && state.snapReturn));
    const undo = $("btn-undo");
    const redo = $("btn-redo");
    if (undo) undo.disabled = !state.history.undo;
    if (redo) redo.disabled = !state.history.redo;
  }

  const SCREENS = ["orders", "order", "stats", "snapshot", "files", "calendar"];

  function rememberSnapReturn() {
    if (state.view === "snapshot") return;
    state.snapReturn = { view: state.view, orderId: state.orderId };
  }

  function openSnapshot() {
    rememberSnapReturn();
    setView("snapshot");
  }

  function goBack() {
    if (state.view === "snapshot" && state.snapReturn) {
      const ret = state.snapReturn;
      state.snapReturn = null;
      setView(ret.view, ret.orderId);
      return;
    }
    setView("orders");
  }

  function pageScrollY() {
    return window.scrollY || document.documentElement.scrollTop || 0;
  }

  function savePageScroll() {
    const y = pageScrollY();
    if (state.view === "order") {
      if (state.orderId) state.scroll.order[state.orderId] = y;
      return;
    }
    if (state.view in state.scroll && state.view !== "order") state.scroll[state.view] = y;
  }

  function restorePageScroll() {
    const y =
      state.view === "order"
        ? state.scroll.order[state.orderId] || 0
        : Number(state.scroll[state.view]) || 0;
    const go = () => window.scrollTo(0, y);
    go();
    requestAnimationFrame(() => requestAnimationFrame(go));
  }

  function setView(view, orderId) {
    const changed = view !== state.view || (orderId !== undefined && orderId !== state.orderId);
    if (changed) savePageScroll();
    state.view = view;
    if (orderId !== undefined) state.orderId = orderId;
    if (view === "order") state.ordersResume = state.orderId || null;
    else if (view === "orders") state.ordersResume = null;
    SCREENS.forEach((v) => {
      $(`screen-${v}`).hidden = v !== view;
    });
    document.querySelectorAll("#tabbar button").forEach((b) => {
      const tab = b.dataset.tab;
      b.classList.toggle("active", tab === view || (view === "order" && tab === "orders"));
    });
    renderCurrent();
    restorePageScroll();
    if (changed) navReport();
  }

  function resumeOrdersTab() {
    const id = state.ordersResume;
    if (id && orders().some((o) => o.id === id)) {
      setView("order", id);
      return true;
    }
    setView("orders");
    return false;
  }

  function requireDocument() {
    if (hasDocument()) return true;
    state.waitingForDoc = true;
    if (state.view !== "files") setView("files");
    else renderFiles();
    return false;
  }

  function renderCurrent() {
    updateHead();
    if (state.view === "orders") renderOrders();
    else if (state.view === "order") renderOrder();
    else if (state.view === "stats") renderStats();
    else if (state.view === "calendar") renderCalendar();
    else if (state.view === "snapshot") renderSnapshot();
    else renderFiles();
    if (state.editLineId && !$("editor").hidden) renderEditor();
  }

  /* ================= список заказов ================= */

  const ORDER_FILTERS = [
    ["all", "Все"],
    ["debt", "С долгом"],
    ["paid", "Оплачены"],
    ["month", "Этот месяц"],
  ];

  function renderChips() {
    const btn = $("btn-m-order-filter");
    const menu = $("m-order-filter-menu");
    const label = $("m-order-filter-label");
    if (!btn || !menu) return;
    const list = orders();
    const meta = ORDER_FILTERS.find(([id]) => id === state.filter) || ORDER_FILTERS[0];
    const n = meta[0] === "all" ? list.length : list.filter((o) => matchesFilter(o, meta[0])).length;
    if (label) label.textContent = meta[1];
    btn.title = `Фильтр заказов: ${meta[1]} · ${n}`;
    btn.classList.toggle("active", state.filter !== "all");
    btn.setAttribute("aria-expanded", "false");
    menu.hidden = true;
    menu.innerHTML = ORDER_FILTERS.map(([id, name]) => {
      const count = id === "all" ? list.length : list.filter((o) => matchesFilter(o, id)).length;
      return `<button type="button" class="btn ${state.filter === id ? "active" : ""}" data-chip="${id}" role="menuitem">${esc(name)}<span>${count}</span></button>`;
    }).join("");
  }

  function statusDotsHtml(lines) {
    const items = (lines || []).map((l) => `<i class="dot" style="background:${esc(statusMeta(l.status).color)}"></i>`);
    if (!items.length) return "";
    const inner = items.join("");
    if (items.length <= 10) return `<span class="dots">${inner}</span>`;
    return `<span class="dots dots-marquee" style="--dot-n:${items.length}"><span class="dots-track">${inner}</span></span>`;
  }

  function tuneStatusDots() {
    document.querySelectorAll(".dots-marquee").forEach((box) => {
      const track = box.querySelector(".dots-track");
      if (!track) return;
      track.style.animation = "none";
      const shift = Math.max(0, Math.ceil(track.scrollWidth - box.clientWidth));
      box.style.setProperty("--dot-shift", `${shift}px`);
      box.style.setProperty("--dot-dur", `${Math.max(2.4, 1.4 + shift / 22)}s`);
      box.classList.toggle("is-moving", shift > 1);
      track.style.animation = "";
    });
  }

  function renderOrders() {
    if (!requireDocument()) return;
    renderChips();
    updateSortBtn();
    const list = visibleOrders();
    const box = $("orders-list");
    if (!list.length) {
      box.innerHTML = `<div class="empty">${
        orders().length ? "Ничего не найдено.<br>Измените поиск или фильтр." : "Заказов пока нет.<br>Нажмите «+», чтобы создать первый."
      }</div>`;
      return;
    }
    box.innerHTML = list
      .map((order) => {
        const t = orderTotals(order);
        const tint = statusMeta(order.lines?.[0]?.status).color;
        const debt = t.unpaid > 0.005;
        return `<article class="card order-item" data-open="${esc(order.id)}" style="--tint:${esc(tint)}">
          <div class="oi-top">
            <span class="oi-num">${esc(order.number || "—")}</span>
            <span class="oi-sep">—</span>
            <span class="oi-customer">${esc(order.name || "без названия")}</span>
          </div>
          <div class="oi-name">${esc(order.customer || "Без заказчика")} · ${(order.lines || []).length} поз.</div>
          <div class="oi-foot">
            <span class="sum">${esc(money(t.after))}</span>
            ${debt ? `<span class="sum debt">долг ${esc(money(t.unpaid))}</span>` : `<span class="sum paid">оплачено</span>`}
            ${statusDotsHtml(order.lines)}
          </div>
        </article>`;
      })
      .join("");
    requestAnimationFrame(tuneStatusDots);
  }

  /* ================= карточка заказа ================= */

  function selectHtml(values, selected, attrs) {
    const opts = (values || [])
      .map((v) => `<option value="${esc(v)}" ${v === selected ? "selected" : ""}>${esc(v)}</option>`)
      .join("");
    const extra = selected && !(values || []).includes(selected) ? `<option value="${esc(selected)}" selected>${esc(selected)}</option>` : "";
    return `<select ${attrs}>${extra}${opts}</select>`;
  }

  function lineRowHtml(line, index) {
    const t = lineTotals(line);
    if (t.expense) return costRowHtml(line, index);
    const meta = statusMeta(line.status);
    const parts = [line.order_type, `${qtyText(line)} × ${money(t.price)}`];
    if (t.discount > 0) parts.push(`−${Math.round(t.discount)}%`);
    return `<article class="line-row${isFrozenLine(line) ? " is-frozen" : ""}" data-edit="${esc(line.id)}" style="--tint:${esc(meta.color)}">
      <button type="button" class="lr-drag" aria-label="Перетащить" title="Перетащить"><span></span></button>
      <span class="lr-index">${index + 1}</span>
      <div class="lr-main">
        <strong>${esc(line.product || "Без названия")}</strong>
        <small>${esc(parts.filter(Boolean).join(" · "))}</small>
        <span class="lr-status" style="background:${esc(meta.color)}">${esc(line.status || "—")}</span>
      </div>
      <div class="lr-right">
        <b>${esc(money(t.after))}</b>
        ${t.unpaid > 0.005 ? `<small class="debt">долг ${esc(money(t.unpaid))}</small>` : `<small class="paid">оплачено</small>`}
        <span class="lr-go">›</span>
      </div>
    </article>`;
  }

  function costRowHtml(line, index) {
    const t = lineTotals(line);
    const calc =
      t.mode === "amount"
        ? `${qtyText(line)} × ${money(t.price)}`
        : `${moneyFmt.format(t.percent).replace(",00", "")} % от ${money(t.base)}${t.mode === "net" ? " (без затрат)" : ""}`;
    return `<article class="line-row cost-row${isFrozenLine(line) ? " is-frozen" : ""}" data-edit="${esc(line.id)}">
      <button type="button" class="lr-drag" aria-label="Перетащить" title="Перетащить"><span></span></button>
      <span class="lr-index">${index + 1}</span>
      <div class="lr-main">
        <strong>${esc(line.product || line.order_type || "Расход")}</strong>
        <small>${esc([line.order_type, calc].filter(Boolean).join(" · "))}</small>
        <span class="lr-status cost-kind ${esc(t.kind)}">${esc(kindLabel(t.kind))}</span>
      </div>
      <div class="lr-right">
        <b class="cost">−${esc(money(t.cost))}</b>
        <span class="lr-go">›</span>
      </div>
    </article>`;
  }

  function renderOrder() {
    if (!requireDocument()) return;
    const order = currentOrder();
    if (!order) {
      setView("orders");
      return;
    }
    const t = orderTotals(order);
    const lines = order.lines || [];
    const { income, expense, frozen } = splitLines(lines);
    const a = (f) => `data-o="${esc(order.id)}" data-f="${f}"`;

    $("order-top").innerHTML = `
      <div class="ot-line">
        <span class="ot-num">${esc(order.number || "—")}</span>
        <span class="ot-name">${esc(order.name || "без названия")}</span>
      </div>
      <div class="ot-sums">
        <div class="ot-sum"><span>Итого</span><b>${esc(money(t.after))}</b></div>
        <div class="ot-sum ${t.unpaid > 0.005 ? "debt" : "paid"}"><span>${t.unpaid > 0.005 ? "Долг" : "Оплачено"}</span><b>${esc(
          money(t.unpaid > 0.005 ? t.unpaid : t.paid)
        )}</b></div>
        <div class="ot-sum"><span>Позиций</span><b>${income.length}</b></div>
        ${
          t.cost > 0.005
            ? `<div class="ot-sum cost"><span>Расход</span><b>−${esc(money(t.cost))}</b></div>
        <div class="ot-sum ${t.net >= 0 ? "paid" : "debt"}"><span>Чистыми</span><b>${esc(money(t.net))}</b></div>`
            : ""
        }
      </div>`;

    $("order-head").innerHTML = `<article class="card fold ${state.headOpen ? "" : "closed"}">
      <button type="button" class="fold-head" id="order-fold">
        <span>Данные заказа</span>
        <span class="fold-ico">▾</span>
      </button>
      <div class="fold-body">
        <div class="grid-2">
          <div class="field"><label>Номер</label><input type="text" inputmode="numeric" value="${esc(order.number || "")}" ${a("number")} /></div>
          <div class="field"><label>Создан</label><input type="date" value="${esc(dateValue(order.created_at))}" ${a("created_at")} /></div>
        </div>
        <div class="field"><label>Заказчик</label><input type="text" list="customers-list" value="${esc(order.customer || "")}" ${a("customer")} /></div>
        <div class="field"><label>Название</label><input type="text" value="${esc(order.name || "")}" ${a("name")} /></div>
        <div class="grid-2">
          <div class="field"><label>Начало работ</label><input type="date" value="${esc(dateValue(order.work_start))}" ${a("work_start")} /></div>
          <div class="field"><label>Конец работ</label><input type="date" value="${esc(dateValue(order.work_end))}" ${a("work_end")} /></div>
        </div>
        <div class="work-row">
          <span class="work-pill work-pill-${esc(workStatusMeta(order).id)}">${esc(workStatusMeta(order).label)}</span>
          ${workActButtons(order, false)}
        </div>
        <div class="field last"><label>Заметки</label><textarea rows="3" ${a("notes")}>${esc(order.notes || "")}</textarea></div>
      </div>
    </article>
    <datalist id="customers-list">${(state.doc.customers || []).map((c) => `<option value="${esc(c.name || "")}"></option>`).join("")}</datalist>`;

    $("lines-title").textContent = `Позиции · ${income.length}`;
    $("lines-list").innerHTML = income.length
      ? income.map((line, i) => lineRowHtml(line, i)).join("")
      : `<div class="empty">Позиций нет. Нажмите «+ Позиция».</div>`;

    const costsRow = $("costs-row");
    const costsList = $("costs-list");
    const addCost = $("btn-add-cost");
    if (costsRow && costsList) {
      costsRow.hidden = !expense.length;
      costsList.hidden = !expense.length;
      $("costs-title").textContent = `Расходы · ${expense.length}`;
      $("costs-sum").textContent = expense.length ? `−${money(t.cost)}` : "";
      costsList.innerHTML = expense.map((line, i) => costRowHtml(line, i)).join("");
    }
    if (addCost) addCost.hidden = !typeNames("expense").length;

    const frozenRow = $("frozen-row");
    const frozenList = $("frozen-list");
    if (frozenRow && frozenList) {
      frozenRow.hidden = !frozen.length;
      frozenList.hidden = !frozen.length;
      $("frozen-title").textContent = `Замороженные · ${frozen.length}`;
      frozenList.innerHTML = frozen.map((line, i) => (isExpenseLine(line) ? costRowHtml(line, i) : lineRowHtml(line, i))).join("");
    }
  }

  function bindSortable(container, { handle, item, onCommit }) {
    if (!container || container.dataset.sortable === "1") return;
    container.dataset.sortable = "1";
    container.addEventListener(
      "pointerdown",
      (e) => {
      if (e.button !== 0) return;
      const grip = e.target.closest(handle);
      if (!grip || !container.contains(grip)) return;
      const row = grip.closest(item);
      if (!row) return;
      e.preventDefault();
      row.classList.add("is-dragging");
      const parent = row.parentNode;
      let moved = false;
      const move = (ev) => {
        const el = document.elementFromPoint(ev.clientX, ev.clientY);
        const over = el?.closest(item);
        if (!over || over === row || over.parentNode !== parent) return;
        const rect = over.getBoundingClientRect();
        parent.insertBefore(row, ev.clientY > rect.top + rect.height / 2 ? over.nextSibling : over);
        moved = true;
      };
      const up = () => {
        row.classList.remove("is-dragging");
        document.removeEventListener("pointermove", move);
        document.removeEventListener("pointerup", up);
        document.removeEventListener("pointercancel", up);
        if (moved) onCommit(row);
      };
      document.addEventListener("pointermove", move);
      document.addEventListener("pointerup", up);
      document.addEventListener("pointercancel", up);
    },
      { passive: false }
    );
  }

  function commitLineOrder(listEl, expense) {
    const order = currentOrder();
    if (!order || !listEl) return;
    const ids = [...listEl.querySelectorAll(".line-row[data-edit]")].map((el) => el.dataset.edit);
    const group = (order.lines || []).filter((line) => !isFrozenLine(line) && (expense ? isExpenseLine(line) : !isExpenseLine(line)));
    if (ids.length !== group.length) return;
    const byId = new Map(group.map((line) => [line.id, line]));
    const nextGroup = ids.map((id) => byId.get(id)).filter(Boolean);
    if (nextGroup.length !== group.length) return;
    let i = 0;
    order.lines = (order.lines || []).map((line) => {
      if (isFrozenLine(line) || isExpenseLine(line) !== expense) return line;
      return nextGroup[i++] || line;
    });
    touchDoc();
    pushSoon();
    renderOrder();
  }

  function refreshOrderRow(lineId) {
    const order = currentOrder();
    if (!order) return;
    const row = document.querySelector(`.line-row[data-edit="${CSS.escape(lineId)}"]`);
    const { income, expense, frozen } = splitLines(order.lines);
    const wasCost = !!row?.classList.contains("cost-row");
    const index = income.findIndex((l) => l.id === lineId);
    const costIndex = expense.findIndex((l) => l.id === lineId);
    const frozenIndex = frozen.findIndex((l) => l.id === lineId);
    const line = index >= 0 ? income[index] : costIndex >= 0 ? expense[costIndex] : frozen[frozenIndex];
    if (!line) return;
    if (frozenIndex >= 0) {
      renderOrder();
      return;
    }
    // Смена типа переносит строку между списками — проще перерисовать заказ целиком.
    // Налог в процентах зависит от других строк, поэтому его тоже проще пересобрать вместе с заказом.
    const hasPercentTax = expense.some((l) => taxMode(l) !== "amount" && typeKind(l.order_type) === "tax");
    if (!row || wasCost !== (costIndex >= 0) || (hasPercentTax && costIndex < 0)) {
      renderOrder();
      return;
    }
    row.outerHTML = costIndex >= 0 ? costRowHtml(line, costIndex) : lineRowHtml(line, index);
    const t = orderTotals(order);
    const sum = $("costs-sum");
    if (sum && expense.length) sum.textContent = `−${money(t.cost)}`;
    const top = $("order-top");
    if (!top) return;
    const cells = top.querySelectorAll(".ot-sum");
    const set = (cell, label, value, cls) => {
      if (!cell) return;
      cell.className = `ot-sum${cls ? ` ${cls}` : ""}`;
      cell.querySelector("span").textContent = label;
      cell.querySelector("b").textContent = value;
    };
    set(cells[0], "Итого", money(t.after));
    set(
      cells[1],
      t.unpaid > 0.005 ? "Долг" : "Оплачено",
      money(t.unpaid > 0.005 ? t.unpaid : t.paid),
      t.unpaid > 0.005 ? "debt" : "paid"
    );
    set(cells[2], "Позиций", String(income.length));
    if (cells.length >= 5) {
      set(cells[3], "Расход", `−${money(t.cost)}`, "cost");
      set(cells[4], "Чистыми", money(t.net), t.net >= 0 ? "paid" : "debt");
    }
  }

  /* ================= редактор позиции ================= */

  const DISCOUNTS = [0, 5, 10, 15, 20, 25, 50];

  function openEditor(lineId) {
    const order = currentOrder();
    if (!findLine(order, lineId)) return;
    state.editLineId = lineId;
    $("editor").hidden = false;
    $("editor").classList.add("is-on");
    document.body.classList.add("locked");
    renderEditor();
    $("editor-body").scrollTop = 0;
    navReport();
  }

  function closeEditor() {
    state.editLineId = null;
    hideExprPad();
    state.exprField = "";
    state.exprInput = null;
    state.exprSystemKb = false;
    $("editor").hidden = true;
    $("editor").classList.remove("is-on");
    const card = $("editor").querySelector(".sheet-card");
    if (card) card.style.bottom = "";
    document.body.classList.remove("locked");
    if (state.view === "order") renderOrder();
    flushPending();
    navReport();
  }

  function catalogProductNames() {
    return (state.doc.products || []).map((p) => String(p.name || p || "").trim()).filter(Boolean);
  }

  function closeEdProductSuggest() {
    const box = $("ed-product-suggest");
    if (box) box.innerHTML = "";
  }

  function edProductSuggestHtml(query) {
    const q = String(query || "").trim().toLocaleLowerCase("ru");
    const items = catalogProductNames().filter((name) => !q || name.toLocaleLowerCase("ru").includes(q));
    if (!items.length) return "";
    return items
      .map((name) => {
        const current = q && name.toLocaleLowerCase("ru") === q;
        return `<button type="button" class="suggest-item${current ? " current" : ""}" data-pick-product>${esc(name)}</button>`;
      })
      .join("");
  }

  function fillEdProductSuggest(query) {
    const box = $("ed-product-suggest");
    if (!box) return;
    const field = document.querySelector('#editor-body [data-f="product"]');
    if (document.activeElement !== field) {
      box.innerHTML = "";
      return;
    }
    box.innerHTML = edProductSuggestHtml(query);
  }

  function renderEditor() {
    const order = currentOrder();
    const line = findLine(order, state.editLineId);
    if (!line) {
      closeEditor();
      return;
    }
    const lines = order.lines || [];
    const index = lines.findIndex((l) => l.id === line.id);
    const t = lineTotals(line);
    const a = (f) => `data-l="${esc(line.id)}" data-f="${f}"`;
    const { income } = splitLines(lines);
    $("ed-title").textContent = line.frozen
      ? `Заморожена${t.expense ? ` · ${kindLabel(t.kind)}` : ""}`
      : t.expense
      ? `Расход · ${kindLabel(t.kind)}`
      : `Позиция ${income.findIndex((l) => l.id === line.id) + 1} из ${income.length}`;
    $("ed-prev").disabled = index <= 0;
    $("ed-next").disabled = index >= lines.length - 1;

    const head = `
      <div class="field">
        <label>${t.expense ? "За что" : "Позиция"}</label>
        <input type="text" autocomplete="off" spellcheck="false" placeholder="${
          t.expense ? "Налог, аренда, материалы…" : "Название работы или товара"
        }" value="${esc(line.product || "")}" ${a("product")} />
        <div class="suggest-inline" id="ed-product-suggest"></div>
      </div>
      <div class="field">
        <label>Тип заказа</label>
        ${selectHtml(typeNames(), line.order_type, a("order_type"))}
      </div>
      ${
        t.kind === "tax"
          ? `<label class="big-label">Как считать</label>
      <div class="chips inline">${TAX_MODES.map(
        ([id, label]) =>
          `<button type="button" class="chip ${t.mode === id ? "active" : ""}" data-tax-mode="${id}">${esc(label)}</button>`
      ).join("")}</div>`
          : ""
      }
      ${
        t.mode === "amount"
          ? `<label class="big-label">Количество</label>
      <div class="qty-row">
        ${exprFieldHtml(line, "qty_expr", a("qty_expr"), "1+2×6")}
        ${selectHtml(state.doc.units, line.unit, `${a("unit")} class="unit-select"`)}
      </div>
      <div class="hint">Можно 2×6+1 — цифры и знаки на панели внизу</div>

      <label class="big-label">${t.expense ? "Сумма за единицу" : "Цена за единицу"}</label>
      ${exprFieldHtml(line, "price_expr", a("price_expr"), "2×350")}
      <div class="hint">После ввода видно сумму, при нажатии снова — выражение</div>`
          : `<label class="big-label">Процент, %</label>
      ${exprFieldHtml(line, "tax_percent_expr", a("tax_percent_expr"), "20")}
      <div class="hint">${
        t.mode === "net" ? "Считается от выручки заказа за вычетом затрат" : "Считается от всей выручки заказа"
      } — сейчас это ${esc(money(t.base))}</div>`
      }`;

    const money_ = `
      <label class="big-label">Скидка, %</label>
      ${exprFieldHtml(line, "discount_expr", a("discount_expr"), "0")}
      <div class="chips inline">${DISCOUNTS.map(
        (d) => `<button type="button" class="chip ${Math.round(t.discount) === d ? "active" : ""}" data-discount="${d}">${d}%</button>`
      ).join("")}</div>

      <label class="big-label">Оплачено</label>
      ${exprFieldHtml(line, "paid_expr", a("paid_expr"), "0")}
      <div class="chips inline">
        <button type="button" class="chip" data-paid="full">Оплачено полностью</button>
        <button type="button" class="chip" data-paid="half">Половина</button>
        <button type="button" class="chip" data-paid="none">Сбросить</button>
      </div>

      <label class="big-label">Статус</label>
      <div class="status-grid">${(state.doc.statuses || [])
        .map(
          (s) =>
            `<button type="button" class="status-pick ${s.name === line.status ? "active" : ""}" data-pick-status="${esc(s.name)}">
              <i class="dot" style="background:${esc(s.color)}"></i><span>${esc(s.name)}</span>
            </button>`
        )
        .join("")}</div>

      <div class="grid-2 dates">
        <div class="field"><label>Дата заказа</label><input type="date" value="${esc(dateValue(line.order_date))}" ${a("order_date")} /></div>
        <div class="field"><label>Дата оплаты</label><input type="date" value="${esc(dateValue(line.payment_date))}" ${a("payment_date")} /></div>
      </div>
      <div class="chips inline">
        <button type="button" class="chip" data-now="order_date">Заказ — сегодня</button>
        <button type="button" class="chip" data-now="payment_date">Оплата — сегодня</button>
      </div>`;

    const costOnly = `
      <div class="field"><label>Дата</label><input type="date" value="${esc(dateValue(line.order_date))}" ${a("order_date")} /></div>
      <div class="chips inline">
        <button type="button" class="chip" data-now="order_date">Сегодня</button>
      </div>
      <div class="hint">Расход вычитается из заказа: скидки, оплаты и статуса у него нет.</div>`;

    $("editor-body").innerHTML = `
      ${t.expense ? `<div class="cost-banner ${esc(t.kind)}">Это расход — ${esc(kindLabel(t.kind))}</div>` : ""}
      ${line.frozen ? `<div class="frozen-banner">Заморожена — не учитывается в итогах, кассе и календаре</div>` : ""}
      ${head}
      ${t.expense ? costOnly : money_}

      <div class="ed-sums" id="ed-sums">${editorSumsHtml(t)}</div>

      <div class="stack">
        <button type="button" class="btn wide" id="ed-freeze">${line.frozen ? "Вернуть в заказ" : "Заморозить позицию"}</button>
        <button type="button" class="btn wide" id="ed-dup">Дублировать позицию</button>
        <button type="button" class="btn wide danger-ghost" id="ed-del">Удалить позицию</button>
      </div>`;
    if (state.exprField && !$("expr-pad")?.hidden) {
      state.exprInput = document.querySelector(`#editor-body input[data-f="${state.exprField}"]`);
      refreshExprPadResult();
    }
  }

  function editorSumsHtml(t) {
    if (t.expense) {
      return `
      <div class="ed-sum"><span>Вид</span><b>${esc(
        t.mode === "amount" ? kindLabel(t.kind) : `${moneyFmt.format(t.percent).replace(",00", "")} %`
      )}</b></div>
      ${t.mode === "amount" ? "" : `<div class="ed-sum"><span>База</span><b>${esc(money(t.base))}</b></div>`}
      <div class="ed-sum cost"><span>Вычитается</span><b>−${esc(money(t.cost))}</b></div>`;
    }
    return `
      <div class="ed-sum"><span>Сумма</span><b>${esc(money(t.total))}</b></div>
      <div class="ed-sum"><span>После скидки</span><b>${esc(money(t.after))}</b></div>
      <div class="ed-sum ${t.unpaid > 0.005 ? "debt" : "paid"}"><span>${t.unpaid > 0.005 ? "Осталось" : "Оплачено"}</span><b>${esc(
        money(t.unpaid > 0.005 ? t.unpaid : t.paid)
      )}</b></div>`;
  }

  function refreshEditorSums() {
    const line = findLine(currentOrder(), state.editLineId);
    const box = $("ed-sums");
    if (!line || !box) return;
    box.innerHTML = editorSumsHtml(lineTotals(line));
    refreshExprPadResult();
  }

  function setLineNumber(line, exprKey, value) {
    line[exprKey] = String(value);
    const mirror = EXPR_MIRROR[exprKey];
    if (mirror) {
      const v = evalExpr(line[exprKey]);
      line[mirror] = Number.isFinite(v) ? round2(v) : 0;
    }
  }

  const EXPR_KEYS = [
    ["1", "1", ""],
    ["2", "2", ""],
    ["3", "3", ""],
    ["+", "+", "op"],
    ["(", "(", "op"],
    ["4", "4", ""],
    ["5", "5", ""],
    ["6", "6", ""],
    ["−", "-", "op"],
    [")", ")", "op"],
    ["7", "7", ""],
    ["8", "8", ""],
    ["9", "9", ""],
    ["×", "*", "op"],
    ["⌫", "back", "util"],
    ["0", "0", ""],
    [".", ".", ""],
    ["00", "00", ""],
    ["÷", "/", "op"],
    ["C", "clear", "util"],
  ];

  function fillExprPad() {
    const grid = $("expr-pad-grid");
    if (!grid || grid.childElementCount) return;
    grid.innerHTML = EXPR_KEYS.map(
      ([label, op, kind]) =>
        `<button type="button" class="expr-pad-key ${kind}" data-expr-op="${op}">${label}</button>`
    ).join("");
  }

  function exprTargetInput() {
    if (state.exprInput?.isConnected) return state.exprInput;
    if (!state.exprField) return null;
    state.exprInput = document.querySelector(`#editor-body input[data-f="${state.exprField}"]`);
    return state.exprInput;
  }

  function exprResultText(field, raw, line) {
    const s = String(raw ?? "").trim();
    if (!s) return "2 × 6 + 1";
    const v = evalExpr(s);
    if (!Number.isFinite(v)) return "неверное выражение";
    if (field === "qty_expr") {
      const q = Math.round(v * 1000) / 1000;
      return `= ${q} ${line?.unit || ""}`.trim();
    }
    if (field === "discount_expr") return `= ${round2(v)}%`;
    return `= ${money(v)}`;
  }

  function refreshExprPadResult() {
    const box = $("expr-pad-result");
    if (!box) return;
    const input = exprTargetInput();
    const line = findLine(currentOrder(), state.editLineId);
    const field = input?.dataset?.f || state.exprField;
    const raw = input?.value ?? line?.[field] ?? "";
    const text = exprResultText(field, raw, line);
    box.textContent = text;
    box.classList.toggle("bad", text === "неверное выражение");
  }

  function exprFieldHtml(line, field, attrs, placeholder) {
    const raw = exprRaw(line, field);
    const formula = isFormula(raw) && Number.isFinite(evalExpr(raw));
    return `<input type="text" inputmode="none" autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false" class="big-input expr-input${formula ? " is-result" : ""}" placeholder="${esc(placeholder)}" value="${esc(formula ? shownExprValue(line, field) : raw)}" data-expr="${esc(raw)}" data-showing="${formula ? "result" : "expr"}" ${attrs} />`;
  }

  function markExprValidity(input) {
    if (!input) return;
    const raw = String(input.dataset.showing === "result" ? input.dataset.expr ?? "" : input.value ?? "").trim();
    input.classList.toggle("invalid", raw !== "" && !Number.isFinite(evalExpr(raw)));
  }

  function revealExpr(input) {
    if (!input || input.dataset.showing !== "result") return;
    input.dataset.showing = "expr";
    input.value = input.dataset.expr || "";
    input.classList.remove("is-result");
    markExprValidity(input);
  }

  function collapseExpr(input) {
    if (!input?.dataset?.f) return;
    const raw = String(input.dataset.showing === "result" ? input.dataset.expr ?? "" : input.value ?? "").replaceAll(",", ".");
    if (input.dataset.showing !== "result") input.dataset.expr = raw;
    const v = evalExpr(raw);
    markExprValidity(input);
    if (Number.isFinite(v) && isFormula(raw)) {
      input.dataset.showing = "result";
      input.value = formatExprResult(v);
      input.classList.add("is-result");
    } else {
      input.dataset.showing = "expr";
      if (input.value !== raw) input.value = raw;
      input.classList.remove("is-result");
    }
  }

  function applyExprToken(input, token) {
    if (!input || !token) return;
    revealExpr(input);
    input.dataset.showing = "expr";
    input.classList.remove("is-result");
    const value = String(input.value ?? "");
    const start = input.selectionStart ?? value.length;
    const end = input.selectionEnd ?? start;
    let next = value;
    let pos = start;
    if (token === "clear") {
      next = "";
      pos = 0;
    } else if (token === "back") {
      if (start !== end) {
        next = value.slice(0, start) + value.slice(end);
        pos = start;
      } else if (start > 0) {
        next = value.slice(0, start - 1) + value.slice(end);
        pos = start - 1;
      } else {
        return;
      }
    } else if (
      input.dataset.f === "price_expr" &&
      /^\d+$/.test(token) &&
      start === end &&
      isBareZeroExpr(value)
    ) {
      next = token === "00" || token === "0" ? "0" : token.replace(/^0+/, "") || "0";
      pos = next.length;
    } else {
      next = value.slice(0, start) + token + value.slice(end);
      pos = start + token.length;
    }
    if (input.dataset.f === "price_expr") {
      const stripped = stripLeadingZerosPlain(next);
      pos = Math.max(0, pos - (next.length - stripped.length));
      next = stripped;
    }
    input.value = next;
    input.dataset.expr = next;
    input.focus();
    try {
      input.setSelectionRange(pos, pos);
    } catch {
      /* some mobile browsers ignore selection on unfocused inputs */
    }
    input.dispatchEvent(new Event("input", { bubbles: true }));
    markExprValidity(input);
  }

  function showExprPad(input) {
    if (!input) return;
    revealExpr(input);
    state.exprInput = input;
    state.exprField = input.dataset.f || "";
    if (state.exprSystemKb) {
      input.setAttribute("inputmode", "text");
      input.removeAttribute("readonly");
      return;
    }
    fillExprPad();
    const pad = $("expr-pad");
    if (pad) pad.hidden = false;
    $("editor")?.classList.add("expr-open");
    input.setAttribute("inputmode", "none");
    refreshExprPadResult();
    requestAnimationFrame(() => {
      input.scrollIntoView({ block: "center", behavior: "smooth" });
    });
  }

  function hideExprPad() {
    const pad = $("expr-pad");
    if (pad) pad.hidden = true;
    $("editor")?.classList.remove("expr-open");
  }

  function useSystemExprKeyboard() {
    state.exprSystemKb = true;
    hideExprPad();
    const input = exprTargetInput();
    if (!input) return;
    input.setAttribute("inputmode", "text");
    input.removeAttribute("readonly");
    input.focus();
  }

  function editorJump(step) {
    const order = currentOrder();
    const lines = order?.lines || [];
    const index = lines.findIndex((l) => l.id === state.editLineId);
    const next = lines[index + step];
    if (!next) return false;
    hideExprPad();
    state.exprField = "";
    state.exprInput = null;
    document.activeElement?.blur?.();
    state.editLineId = next.id;
    renderEditor();
    $("editor-body").scrollTop = 0;
    navReport();
    flashSwipe($("editor-body"), step);
    try {
      navigator.vibrate?.(10);
    } catch (_) {}
    return true;
  }

  /* ================= сводка ================= */

  function dayKeyOf(d) {
    const p = (n) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  }

  function matchesStatsPeriod(iso, period) {
    if (!period || period === "all") return true;
    const stamp = String(iso || "");
    if (!stamp) return false;
    const now = new Date();
    if (period === "today") return stamp.slice(0, 10) === dayKeyOf(now);
    if (period === "week") {
      const from = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 6);
      return dateValue(stamp) >= dayKeyOf(from);
    }
    if (period === "month") return stamp.startsWith(`${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`);
    if (period === "year") return stamp.startsWith(String(now.getFullYear()));
    return true;
  }

  const STATS_PERIODS = [
    ["all", "Все даты"],
    ["today", "Сегодня"],
    ["week", "7 дней"],
    ["month", "Месяц"],
    ["year", "Год"],
  ];
  const STATS_FILTERS = [
    ["all", "Все заказы"],
    ["debt", "С долгом"],
    ["paid", "Оплачены"],
  ];

  function statsPeriodLabel() {
    return (STATS_PERIODS.find(([id]) => id === state.stats.period) || STATS_PERIODS[0])[1];
  }

  function statsFilterLabel() {
    return (STATS_FILTERS.find(([id]) => id === state.stats.filter) || STATS_FILTERS[0])[1];
  }

  function statsStatusLabel() {
    return state.stats.status || "Все статусы";
  }

  function statsPickHtml(label, on) {
    return `<span class="${on ? "on" : ""}">${esc(label)}</span><span class="picker-ico">▾</span>`;
  }

  function renderStatsChips(rows, list) {
    const periodEl = $("stats-period");
    const filterEl = $("stats-filter");
    const statusEl = $("stats-status");
    if (!periodEl || !filterEl || !statusEl) return;
    periodEl.innerHTML = statsPickHtml(statsPeriodLabel(), state.stats.period !== "all");
    filterEl.innerHTML = statsPickHtml(statsFilterLabel(), state.stats.filter !== "all");
    statusEl.innerHTML = statsPickHtml(statsStatusLabel(), !!state.stats.status);
    periodEl._rows = rows;
    filterEl._list = list;
    statusEl._rows = rows;
  }

  function openStatsPeriod() {
    const rows = $("stats-period")?._rows || [];
    openSheet(
      "Период",
      STATS_PERIODS.map(([id, label]) => ({
        value: id,
        label,
        hint: `${rows.filter(({ line }) => matchesStatsPeriod(line.order_date, id)).length} поз.`,
      })),
      state.stats.period,
      (item) => {
        state.stats.period = item.value;
        renderStats();
        navReport();
      }
    );
  }

  function openStatsFilter() {
    const list = $("stats-filter")?._list || orders();
    openSheet(
      "Заказы",
      STATS_FILTERS.map(([id, label]) => ({
        value: id,
        label,
        hint: `${id === "all" ? list.length : list.filter((o) => matchesFilter(o, id)).length}`,
      })),
      state.stats.filter,
      (item) => {
        state.stats.filter = item.value;
        renderStats();
        navReport();
      }
    );
  }

  function openStatsStatus() {
    const rows = $("stats-status")?._rows || [];
    const statuses = state.doc?.statuses || [];
    openSheet(
      "Статус",
      [{ value: "", label: "Все статусы", hint: `${rows.length} поз.`, color: "" }].concat(
        statuses.map((s) => ({
          value: s.name,
          label: s.name,
          hint: `${rows.filter(({ line }) => line.status === s.name).length} поз.`,
          color: s.color || "",
        }))
      ),
      state.stats.status,
      (item) => {
        state.stats.status = item.value;
        renderStats();
        navReport();
      }
    );
  }

  function statsRows() {
    const list = orders().filter((o) => matchesFilter(o, state.stats.filter));
    return list
      .flatMap((order) => (order.lines || []).map((line) => ({ order, line })))
      .filter(({ line }) => {
        if (state.stats.status && line.status !== state.stats.status) return false;
        return matchesStatsPeriod(line.order_date, state.stats.period);
      });
  }

  function renderCalendar() {
    if (!requireDocument()) return;
    const cal = state.cal;
    if (!cal.anchor) cal.anchor = dayStart(new Date());
    if (cal.mode !== "classic") cal.mode = "extended";
    const today = dayStart(new Date());
    const all = orders();
    const list = cal.filter === "all" ? all : all.filter((order) => workStatus(order) === cal.filter);
    const now = all.filter((order) => workStatus(order) === "now");
    const nodate = all.filter((order) => workStatus(order) === "nodate");
    const modes = [
      ["classic", "Классический — сетка месяца"],
      ["extended", "Неделя — старты, в работе и финиши"],
    ];
    const filters = [
      ["all", "Все"],
      ["now", "Сейчас"],
      ["planned", "План"],
      ["done", "Готово"],
      ["nodate", "Без дат"],
    ];
    const modeIcon = (id) =>
      id === "classic"
        ? `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true"><rect x="4" y="5" width="16" height="15" rx="2" stroke="currentColor" stroke-width="1.8"/><path d="M4 9.5h16M8 5v3M16 5v3M8 13h.01M12 13h.01M16 13h.01M8 16.5h.01M12 16.5h.01" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>`
        : `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M5 9v8M8.5 6v11M12 8v9M15.5 7v10M19 10v7" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>`;
    const filterMeta = filters.find(([id]) => id === cal.filter) || filters[0];
    let title = "";
    let board = "";
    if (cal.filter === "nodate") {
      title = "Без дат";
      board = nodate.length
        ? nodate.map((order) => mcalOrderCard(order)).join("")
        : `<div class="empty">Нет заказов без дат.</div>`;
    } else if (cal.mode === "classic") {
      const from = new Date(cal.anchor.getFullYear(), cal.anchor.getMonth(), 1);
      const to = new Date(cal.anchor.getFullYear(), cal.anchor.getMonth() + 1, 0);
      title = `${RU_MONTHS_NOM[from.getMonth()]} ${from.getFullYear()}`;
      const gridFrom = mondayOf(from);
      let gridTo = addDays(gridFrom, 41);
      while (gridTo < to) gridTo = addDays(gridTo, 7);
      const cells = [];
      for (let d = gridFrom; d <= gridTo; d = addDays(d, 1)) {
        const key = dayKey(d);
        const covering = list.filter((order) => orderMarksDay(order, d));
        const n = covering.length;
        const inMonth = d.getMonth() === from.getMonth();
        const note = dayNote(key);
        cells.push(`<button type="button" class="mcal-cell ${inMonth ? "" : "is-out"} ${dayToneClass(d)} ${note ? "has-note" : ""} ${key === dayKey(today) ? "is-today" : ""} ${cal.pick === key ? "is-pick" : ""} ${mcalDayTone(covering)}" data-cal-day="${key}">
          <b>${d.getDate()}</b>${n ? `<i>${n}</i>` : ""}${note ? `<em class="mcal-memo">${esc(note)}</em>` : ""}
        </button>`);
      }
      board = `<div class="mcal-weekdays">${RU_WEEKDAYS.map((w, i) => `<span class="${calendarOffSettings().weekends.includes(i) ? "is-weekend" : ""}">${w}</span>`).join("")}</div>
        <div class="mcal-month">${cells.join("")}</div>`;
      if (cal.pick) {
        const pick = parseDay(cal.pick);
        const items = list.filter((order) => orderMarksDay(order, pick));
        const pickKey = dayKey(pick);
        board += `<div class="mcal-daylist"><h3>${esc(calFmtDay(pick))}</h3>
          <label class="mcal-note">Заметка<textarea rows="2" data-cal-note="${esc(pickKey)}" placeholder="Что в этот день">${esc(dayNote(pickKey))}</textarea></label>
          ${items.length ? items.map((order) => mcalOrderCard(order, pick)).join("") : `<div class="empty">В этот день никто не отмечен.</div>`}
        </div>`;
      }
    } else if (cal.mode === "extended") {
      const from = mondayOf(cal.anchor);
      const to = addDays(from, 6);
      title = `${from.getDate()}–${calFmtDay(to)}`;
      const weekDays = latestDaysFirst(from, to).filter((day) => !isGlobalWeekend(day));
      board = weekDays.length
        ? `<div class="mcal-week">${weekDays
        .map((day) => {
          const key = dayKey(day);
          const items = list.filter((order) => orderMarksDay(order, day));
          const starts = items.filter((order) => dateValue(order.work_start) === key && !isPaused(order, day));
          const ends = items.filter((order) => dateValue(order.work_end) === key && !isPaused(order, day));
          const paused = items.filter((order) => isPaused(order, day));
          const running = items.filter((order) => !isPaused(order, day) && dateValue(order.work_start) !== key && dateValue(order.work_end) !== key);
          const note = dayNote(key);
          const block = (title, rows) =>
            rows.length ? `<div class="mcal-sec">${esc(title)}</div>${rows.map((order) => mcalOrderCard(order, day)).join("")}` : "";
          return `<div class="mcal-col ${dayToneClass(day)} ${key === dayKey(today) ? "is-today" : ""} ${cal.pick === key ? "is-pick" : ""} ${mcalDayTone(items)}" data-cal-day="${key}">
            <div class="mcal-col-h"><b>${RU_WEEKDAYS[(day.getDay() + 6) % 7]}</b><span>${day.getDate()}</span><i>${items.length}</i></div>
            ${note && cal.pick !== key ? `<div class="mcal-memo">${esc(note)}</div>` : ""}
            ${cal.pick === key ? `<label class="mcal-note">Заметка<textarea rows="2" data-cal-note="${esc(key)}" placeholder="Что в этот день">${esc(note)}</textarea></label>` : ""}
            ${block("Старт", starts)}${block("В работе", running)}${block("На паузе", paused)}${block("Финиш", ends)}
            ${items.length ? "" : `<div class="empty">пусто</div>`}
          </div>`;
        })
        .join("")}</div>`
        : `<div class="empty">На этой неделе нет рабочих дней.</div>`;
    }
    const year = cal.anchor.getFullYear();
    const month = cal.anchor.getMonth();
    const y0 = Math.min(year, today.getFullYear()) - 15;
    const y1 = Math.max(year, today.getFullYear()) + 10;
    let yearOpts = "";
    for (let y = y0; y <= y1; y++) yearOpts += `<option value="${y}" ${y === year ? "selected" : ""}>${y}</option>`;
    const titleHtml =
      cal.mode === "classic"
        ? `<select class="mcal-pick" data-cal-month aria-label="Месяц">${RU_MONTHS_NOM.map((name, i) => `<option value="${i}" ${i === month ? "selected" : ""}>${esc(name)}</option>`).join("")}</select>
           <select class="mcal-pick" data-cal-year aria-label="Год">${yearOpts}</select>`
        : `<strong>${esc(title)}</strong>`;
    const todayIcon = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true"><rect x="4" y="5" width="16" height="15" rx="2" stroke="currentColor" stroke-width="1.8"/><path d="M4 9.5h16M8 5v3M16 5v3" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><circle cx="12" cy="15" r="2.3" fill="currentColor"/></svg>`;
    $("calendar-body").innerHTML = `
      <div class="mcal-kpis">
        <div><span>Идёт</span><b>${now.length}</b></div>
        <div><span>Без дат</span><b>${nodate.length}</b></div>
      </div>
      <div class="mcal-top">
        <div class="mcal-modes">${modes
          .map(
            ([id, label]) =>
              `<button type="button" class="chip ${cal.mode === id ? "active" : ""}" data-cal-mode="${id}" title="${esc(label)}" aria-label="${esc(label)}">${modeIcon(id)}</button>`
          )
          .join("")}</div>
        <div class="mcal-filter">
          <button type="button" class="btn ${cal.filter !== "all" ? "active" : ""}" id="btn-mcal-filter" title="Фильтр заказов: ${esc(filterMeta[1])}" aria-haspopup="menu" aria-expanded="false" aria-controls="mcal-filter-menu">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path d="M4 5h16l-6.2 7.4v5.1L10.2 19v-6.6L4 5Z" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/>
            </svg>
            <span>${esc(filterMeta[1])}</span>
          </button>
          <div class="mcal-filter-menu" id="mcal-filter-menu" hidden role="menu">${filters
            .map(
              ([id, label]) =>
                `<button type="button" class="btn ${cal.filter === id ? "active" : ""}" data-cal-filter="${id}" role="menuitem">${esc(label)}<span>${id === "all" ? all.length : all.filter((order) => workStatus(order) === id).length}</span></button>`
            )
            .join("")}</div>
        </div>
      </div>
      <div class="mcal-nav">
        <button type="button" class="btn mcal-ico" data-cal-nav="0" title="Сегодня" aria-label="Сегодня">${todayIcon}</button>
        ${
          cal.filter === "nodate"
            ? ""
            : `<div class="mcal-nav-dates">
          <button type="button" class="btn" data-cal-nav="-1">‹</button>
          ${titleHtml}
          <button type="button" class="btn" data-cal-nav="1">›</button>
        </div>`
        }
      </div>
      ${board}
    `;
  }

  function rangeDays(from, to) {
    const days = [];
    for (let d = dayStart(from); d <= to; d = addDays(d, 1)) days.push(d);
    return days;
  }

  function mcalOrderCard(order, day) {
    const meta = workStatusMeta(order, day);
    const t = orderTotals(order);
    const role = day ? calendarRole(order, day) : "";
    return `<article class="card order-item mcal-order tone-${esc(meta.tone)}" data-open="${esc(order.id)}" style="--tint:${esc(meta.color)}">
      <div class="oi-top"><span class="oi-num">${esc(order.number || "—")}</span><span class="oi-sep">—</span><span class="oi-customer">${esc(order.name || "без названия")}</span></div>
      <div class="oi-name">${esc(order.customer || "Без заказчика")} · ${esc(dateValue(order.work_start) || "нет старта")} → ${esc(workEndLabel(order))}</div>
      <div class="oi-foot">
        <span class="work-pill work-pill-${esc(meta.id)}">${esc(meta.label)}</span>
        ${role ? `<span class="mcal-role">${esc(role)}</span>` : ""}
        <span class="sum">${esc(money(t.after))}</span>
      </div>
      <div class="mcal-acts">${workActButtons(order, true)}</div>
    </article>`;
  }

  function renderStats() {
    if (!requireDocument()) return;
    const all = statsRows();
    renderStatsChips(
      orders().flatMap((order) => (order.lines || []).map((line) => ({ order, line }))),
      orders()
    );
    const list = [...new Set(all.map((r) => r.order))];
    const agg = all.reduce(
      (acc, { line }) => {
        const t = lineTotals(line);
        acc.after += t.after;
        acc.paid += t.paid;
        acc.unpaid += t.unpaid;
        acc.cost += t.cost;
        if (t.expense) acc.costCount += 1;
        else acc.count += 1;
        return acc;
      },
      { after: 0, paid: 0, unpaid: 0, cost: 0, count: 0, costCount: 0 }
    );
    agg.net = round2(agg.after - agg.cost);

    const byStatus = {};
    all.forEach(({ line }) => {
      const t = lineTotals(line);
      byStatus[line.status] = (byStatus[line.status] || 0) + t.after;
    });
    const maxStatus = Math.max(1, ...Object.values(byStatus));

    const byCustomer = {};
    list.forEach((o) => {
      const t = all
        .filter((r) => r.order.id === o.id)
        .reduce((acc, { line }) => acc + lineTotals(line).after, 0);
      const key = o.customer || "Без заказчика";
      byCustomer[key] = (byCustomer[key] || 0) + t;
    });
    const top = Object.entries(byCustomer)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5);
    const maxCustomer = Math.max(1, ...top.map(([, v]) => v));

    const monthKey = (() => {
      const now = new Date();
      return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
    })();
    let monthSum = 0;
    all.forEach(({ line }) => {
      if (String(line.order_date || "").startsWith(monthKey)) monthSum += lineTotals(line).after;
    });

    const debtMap = new Map();
    all.forEach(({ order, line }) => {
      const unpaid = lineTotals(line).unpaid;
      if (unpaid <= 0.005) return;
      const cur = debtMap.get(order.id) || { order, unpaid: 0 };
      cur.unpaid += unpaid;
      debtMap.set(order.id, cur);
    });
    const debtors = [...debtMap.values()].sort((a, b) => b.unpaid - a.unpaid).slice(0, 8);

    $("stats-body").innerHTML = `
      <div class="kpis">
        <div class="kpi"><span>Заказов</span><strong>${list.length}</strong></div>
        <div class="kpi"><span>Позиций</span><strong>${agg.count}</strong></div>
        <div class="kpi"><span>Выручка</span><strong>${esc(compact(agg.after))}</strong></div>
        <div class="kpi ${agg.unpaid > 0.005 ? "debt" : "ok"}"><span>Долг</span><strong>${esc(compact(agg.unpaid))}</strong></div>
        ${
          agg.cost > 0.005
            ? `<div class="kpi cost"><span>Расход</span><strong>−${esc(compact(agg.cost))}</strong></div>
        <div class="kpi ${agg.net >= 0 ? "ok" : "debt"}"><span>Чистыми</span><strong>${esc(compact(agg.net))}</strong></div>`
            : ""
        }
      </div>
      <article class="card">
        <div class="bar-row"><span>За этот месяц</span><b>${esc(money(monthSum))}</b>
          <div class="bar-track"><div class="bar-fill" style="background:var(--accent-2);width:${
            agg.after ? Math.min(100, (monthSum / agg.after) * 100) : 0
          }%"></div></div>
        </div>
        <div style="height:12px"></div>
        <div class="bar-row"><span>Оплачено</span><b>${esc(money(agg.paid))}</b>
          <div class="bar-track"><div class="bar-fill" style="background:var(--ok);width:${
            agg.after ? Math.min(100, (agg.paid / agg.after) * 100) : 0
          }%"></div></div>
        </div>
        <div style="height:12px"></div>
        <div class="bar-row"><span>Осталось получить</span><b>${esc(money(agg.unpaid))}</b>
          <div class="bar-track"><div class="bar-fill" style="background:var(--danger);width:${
            agg.after ? Math.min(100, (agg.unpaid / agg.after) * 100) : 0
          }%"></div></div>
        </div>
        ${
          agg.cost > 0.005
            ? `<div style="height:12px"></div>
        <div class="bar-row"><span>Налоги и затраты</span><b>−${esc(money(agg.cost))}</b>
          <div class="bar-track"><div class="bar-fill" style="background:var(--warn, #d97706);width:${
            agg.after ? Math.min(100, (agg.cost / agg.after) * 100) : 100
          }%"></div></div>
        </div>
        <div style="height:12px"></div>
        <div class="bar-row"><span>Чистыми</span><b>${esc(money(agg.net))}</b>
          <div class="bar-track"><div class="bar-fill" style="background:var(--accent);width:${
            agg.after ? Math.max(0, Math.min(100, (agg.net / agg.after) * 100)) : 0
          }%"></div></div>
        </div>`
            : ""
        }
      </article>
      <h3 class="section">По статусам</h3>
      <article class="card"><div class="bars">${
        Object.keys(byStatus).length
          ? Object.entries(byStatus)
              .sort((a, b) => b[1] - a[1])
              .map(
                ([name, value]) => `<div class="bar-row"><span>${esc(name)}</span><b>${esc(compact(value))}</b>
                  <div class="bar-track"><div class="bar-fill" style="background:${esc(statusMeta(name).color)};width:${
                    (value / maxStatus) * 100
                  }%"></div></div></div>`
              )
              .join("")
          : '<div class="muted">Нет данных</div>'
      }</div></article>
      <h3 class="section">Топ заказчиков</h3>
      <article class="card"><div class="bars">${
        top.length
          ? top
              .map(
                ([name, value]) => `<div class="bar-row"><span>${esc(name)}</span><b>${esc(compact(value))}</b>
                  <div class="bar-track"><div class="bar-fill" style="background:var(--accent-2);width:${
                    (value / maxCustomer) * 100
                  }%"></div></div></div>`
              )
              .join("")
          : '<div class="muted">Нет данных</div>'
      }</div></article>
      <h3 class="section">Кто должен</h3>
      <div class="list tight">${
        debtors.length
          ? debtors
              .map(
                ({ order, unpaid }) => `<article class="card order-item" data-open="${esc(order.id)}" style="--tint:var(--danger)">
                  <div class="oi-top">
                    <span class="oi-num">${esc(order.number || "—")}</span>
                    <span class="oi-sep">—</span>
                    <span class="oi-customer">${esc(order.name || "без названия")}</span>
                  </div>
                  <div class="oi-name">${esc(order.customer || "Без заказчика")}</div>
                  <div class="oi-foot">
                    <span class="sum debt">долг ${esc(money(unpaid))}</span>
                  </div>
                </article>`
              )
              .join("")
          : '<div class="empty">Долгов нет</div>'
      }</div>`;

    requestAnimationFrame(() => {
      document.querySelectorAll("#stats-body .bar-fill").forEach((el) => {
        const w = el.style.width;
        el.style.width = "0";
        requestAnimationFrame(() => {
          el.style.width = w;
        });
      });
    });
  }

  /* ================= снимок для заказчика ================= */

  const SNAP_FIELDS = [
    { id: "number", label: "Номер", kind: "meta" },
    { id: "customer", label: "Заказчик", kind: "meta" },
    { id: "organization", label: "Организация", kind: "meta" },
    { id: "name", label: "Название", kind: "meta" },
    { id: "order_type", label: "Тип", kind: "col" },
    { id: "product", label: "Позиция", kind: "col" },
    { id: "quantity", label: "Кол-во", kind: "col" },
    { id: "order_date", label: "Дата заказа", kind: "col" },
    { id: "status", label: "Статус", kind: "col" },
    { id: "price", label: "Цена", kind: "col" },
    { id: "discount", label: "Скидка", kind: "col" },
    { id: "total", label: "Сумма", kind: "col" },
    { id: "paid", label: "Оплачено", kind: "col" },
    { id: "unpaid", label: "Долг", kind: "col" },
    { id: "payment_date", label: "Дата оплаты", kind: "col" },
    { id: "totals", label: "Итоги заказа", kind: "meta" },
    { id: "expenses", label: "Налоги и затраты", kind: "meta" },
  ];

  const SNAP_PRESETS = {
    work: ["number", "name", "order_type", "product", "quantity", "status", "order_date"],
    invoice: ["number", "customer", "organization", "name", "order_type", "product", "quantity", "price", "discount", "total", "paid", "unpaid", "totals"],
    short: ["number", "customer", "product", "quantity", "total", "totals"],
    full: SNAP_FIELDS.map((f) => f.id),
  };

  const SNAP_THEMES = {
    teal: {
      label: "Бирюза",
      head: ["#0f766e", "#115e59"],
      headInk: "#ffffff",
      accent: "#14b8a6",
      bg: "#ffffff",
      ink: "#0f172a",
      meta: "#475569",
      line: "#e2e8f0",
      thBg: "#f1f5f9",
      thInk: "#64748b",
      zebra: "#f8fafc",
      footBg: "#f1f5f9",
      note: "#94a3b8",
    },
    gold: {
      label: "Золото",
      head: ["#c9a227", "#8a6d0f"],
      headInk: "#ffffff",
      accent: "#c9a227",
      bg: "#fffdf6",
      ink: "#1c1917",
      meta: "#44403c",
      line: "#ece3cd",
      thBg: "#faf5e6",
      thInk: "#a16207",
      zebra: "#fdfaf0",
      footBg: "#f7efdc",
      note: "#b8a67a",
    },
    mono: {
      label: "Минимал",
      head: ["#ffffff", "#ffffff"],
      headInk: "#0f172a",
      headLine: true,
      accent: "#0f172a",
      bg: "#ffffff",
      ink: "#0f172a",
      meta: "#475569",
      line: "#e2e8f0",
      thBg: "#ffffff",
      thInk: "#94a3b8",
      zebra: "#fafafa",
      footBg: "#f8fafc",
      note: "#94a3b8",
    },
    night: {
      label: "Ночь",
      head: ["#1e293b", "#0b1220"],
      headInk: "#ffffff",
      accent: "#2dd4bf",
      bg: "#0f172a",
      ink: "#e7eef8",
      meta: "#cbd5e1",
      line: "#25324a",
      thBg: "#16233b",
      thInk: "#94a3b8",
      zebra: "#131f36",
      footBg: "#16233b",
      note: "#64748b",
    },
  };

  const SNAP_MONEY_COLS = new Set(["price", "total", "paid", "unpaid"]);

  function loadSnapPrefs() {
    try {
      const saved = JSON.parse(localStorage.getItem(LS_SNAP) || "null");
      if (saved && typeof saved === "object") {
        if (Array.isArray(saved.fields)) state.snap.fields = saved.fields;
        if (SNAP_THEMES[saved.theme]) state.snap.theme = saved.theme;
        state.snap.hideLabels = !!saved.hideLabels;
        state.snap.hideStamp = !!saved.hideStamp;
      }
    } catch {
      /* ignore */
    }
    if (!state.snap.fields) state.snap.fields = SNAP_PRESETS.invoice.slice();
  }

  function saveSnapPrefs() {
    try {
      localStorage.setItem(
        LS_SNAP,
        JSON.stringify({
          fields: state.snap.fields,
          theme: state.snap.theme,
          hideLabels: state.snap.hideLabels,
          hideStamp: state.snap.hideStamp,
        })
      );
    } catch {
      /* ignore */
    }
  }

  function snapOrder() {
    const list = orders();
    if (!list.length) return null;
    return list.find((o) => o.id === state.snap.orderId) || list.find((o) => o.id === state.orderId) || list[list.length - 1];
  }

  /** Снимок уходит заказчику — налоги и затраты в него не попадают. */
  /** Расходы попадают в снимок только при включённом поле «Налоги и затраты». */
  function snapShowsExpenses() {
    return state.snap.fields.includes("expenses");
  }

  function snapCandidates(order) {
    const withExpenses = snapShowsExpenses();
    return (order?.lines || []).filter((l) => !isFrozenLine(l) && (withExpenses || !isExpenseLine(l)));
  }

  function snapLines(order) {
    const all = snapCandidates(order);
    if (!state.snap.lines) return all;
    const picked = all.filter((l) => state.snap.lines.has(l.id));
    return picked.length ? picked : all;
  }

  function snapCols() {
    return SNAP_FIELDS.filter((f) => f.kind === "col" && state.snap.fields.includes(f.id));
  }

  function customerOrg(name) {
    return (state.doc?.customers || []).find((c) => c.name === name)?.organization || "";
  }

  function snapNumber(n) {
    const r = round2(n);
    if (Number.isInteger(r)) return String(r);
    return r.toFixed(2).replace(".", ",");
  }

  function snapValue(line, id) {
    const t = lineTotals(line);
    if (t.expense) {
      // Расход в снимке — название, объём и сумма с минусом; скидок и оплат у него нет.
      if (id === "order_type") return `${line.order_type || "—"} · ${kindLabel(t.kind)}`;
      if (id === "product") return line.product || "—";
      if (id === "quantity")
        return t.mode === "amount" ? `${snapNumber(t.qty)} ${line.unit || ""}`.trim() : `${snapNumber(t.percent)} %`;
      if (id === "price") return t.mode === "amount" ? money(t.price) : money(t.base);
      if (id === "total") return `−${money(t.cost)}`;
      if (id === "order_date") return fmtDate(line.order_date);
      return "—";
    }
    if (id === "order_type") return line.order_type || "—";
    if (id === "product") return line.product || "—";
    if (id === "quantity") return `${snapNumber(t.qty)} ${line.unit || ""}`.trim();
    if (id === "price") return money(t.price);
    if (id === "discount") return `${snapNumber(t.discount)} %`;
    if (id === "total") return money(t.after);
    if (id === "paid") return money(t.paid);
    if (id === "unpaid") return money(t.unpaid);
    if (id === "order_date") return fmtDate(line.order_date);
    if (id === "payment_date") return fmtDate(line.payment_date);
    if (id === "status") return line.status || "—";
    return "";
  }

  function orderNumberText(order) {
    return String(order?.number || "").replace(/^№\s*/, "").trim();
  }

  function snapMetaPairs(order) {
    const f = state.snap.fields;
    const items = [];
    if (f.includes("number")) items.push(["Номер", orderNumberText(order)]);
    if (f.includes("name")) items.push(["Заказ", order.name]);
    if (f.includes("customer")) items.push(["Заказчик", order.customer]);
    if (f.includes("organization")) items.push(["Организация", customerOrg(order.customer)]);
    return items;
  }

  function snapMetaItems(order) {
    return snapMetaPairs(order).map(([label, value]) => {
      const v = value || "—";
      if (state.snap.hideLabels) return v;
      return `${label}: ${v}`;
    });
  }

  function snapTitle(order) {
    const typed = String(state.snap.title || "").trim();
    if (typed) return typed;
    return [orderNumberText(order), order?.name].filter(Boolean).join(" · ") || "Снимок заказа";
  }

  function snapNeedsFooter(cols) {
    return (cols || []).some((c) => SNAP_MONEY_COLS.has(c.id));
  }

  function snapFooterValue(colId, lines) {
    const tot = sumLines(lines);
    if (colId === "total") return money(tot.cost > 0.005 ? tot.net : tot.after);
    if (colId === "paid") return money(tot.paid);
    if (colId === "unpaid") return money(tot.unpaid);
    if (colId === "price") return "Итого";
    return "";
  }

  function snapFooterCells(cols, lines) {
    if (!snapNeedsFooter(cols)) return null;
    return cols.map((c) => (SNAP_MONEY_COLS.has(c.id) ? snapFooterValue(c.id, lines) : ""));
  }

  function snapTotalsText(cols, lines) {
    if (!state.snap.fields.includes("totals") || snapNeedsFooter(cols)) return "";
    const tot = sumLines(lines);
    const bits = [`Итого ${money(tot.after)}`];
    if (tot.cost > 0.005) {
      bits.push(`расходы −${money(tot.cost)}`);
      bits.push(`к оплате ${money(tot.net)}`);
    }
    if (state.snap.fields.includes("paid")) bits.push(`оплачено ${money(tot.paid)}`);
    if (state.snap.fields.includes("unpaid")) bits.push(`остаток ${money(tot.unpaid)}`);
    return bits.join(" · ");
  }

  function renderSnapshot() {
    if (!requireDocument()) return;
    const box = $("snapshot-body");
    const list = orders();
    if (!list.length) {
      box.innerHTML = `<div class="empty">Сначала создайте заказ — потом можно отправить снимок заказчику.</div>`;
      return;
    }
    const order = snapOrder();
    const lines = snapCandidates(order);
    const picked = snapLines(order);
    const theme = SNAP_THEMES[state.snap.theme] || SNAP_THEMES.teal;

    box.innerHTML = `
      <article class="card">
        <div class="field last">
          <label>Заказ</label>
          <button type="button" class="picker" id="snap-order">
            <span>${esc(order.number || "—")} · ${esc(order.name || "без названия")}</span><span class="picker-ico">▾</span>
          </button>
        </div>
      </article>

      <article class="card fold ${state.snap.linesOpen ? "" : "closed"}">
        <button type="button" class="fold-head" id="snap-lines-fold">
          <span>Позиции в снимке</span>
          <span class="fold-side"><small id="snap-lines-meta">${picked.length} из ${lines.length}</small><span class="fold-ico">▾</span></span>
        </button>
        <div class="fold-body">
          <div class="list tight">${lines
            .map((line, i) => {
              const on = picked.includes(line);
              const t = lineTotals(line);
              return `<label class="pick-row ${on ? "on" : ""} ${t.expense ? "cost" : ""}">
            <input type="checkbox" data-snap-line="${esc(line.id)}" ${on ? "checked" : ""} />
            <span class="pr-main"><strong>${i + 1}. ${esc(line.product || line.order_type || "Без названия")}</strong>
            <small>${esc(
              [line.order_type, t.expense ? kindLabel(t.kind) : "", t.mode === "amount" ? qtyText(line) : `${t.percent} %`]
                .filter(Boolean)
                .join(" · ")
            )}</small></span>
            <b>${t.expense ? `−${esc(money(t.cost))}` : esc(money(t.after))}</b>
          </label>`;
            })
            .join("")}</div>
        </div>
      </article>

      <article class="card fold ${state.snap.fieldsOpen ? "" : "closed"}">
        <button type="button" class="fold-head" id="snap-fields-fold">
          <span>Что показать заказчику</span>
          <span class="fold-ico">▾</span>
        </button>
        <div class="fold-body">
          <div class="chips inline">
            <button type="button" class="chip" data-preset="short">Коротко</button>
            <button type="button" class="chip" data-preset="work">Для работы</button>
            <button type="button" class="chip" data-preset="invoice">Как счёт</button>
            <button type="button" class="chip" data-preset="full">Всё</button>
          </div>
          <div class="chips wrap">${SNAP_FIELDS.map(
            (f) =>
              `<button type="button" class="chip ${state.snap.fields.includes(f.id) ? "active" : ""}" data-field="${f.id}">${esc(f.label)}</button>`
          ).join("")}</div>
          <div class="field" style="margin-top:12px">
            <label>Заголовок</label>
            <input type="text" id="snap-title" placeholder="${esc(snapTitle(order))}" value="${esc(state.snap.title || "")}" />
          </div>
          <label class="check"><input type="checkbox" id="snap-hide-labels" ${state.snap.hideLabels ? "checked" : ""} /> Без подписей полей</label>
          <label class="check"><input type="checkbox" id="snap-hide-stamp" ${state.snap.hideStamp ? "checked" : ""} /> Без даты формирования</label>
        </div>
      </article>

      <h3 class="section">Оформление</h3>
      <div class="chips inline">${Object.entries(SNAP_THEMES)
        .map(
          ([key, t]) =>
            `<button type="button" class="chip theme-chip ${key === state.snap.theme ? "active" : ""}" data-snap-theme="${key}">
              <i class="sw" style="background:linear-gradient(135deg,${t.head[0]},${t.head[1]})"></i>${esc(t.label)}
            </button>`
        )
        .join("")}</div>

      <h3 class="section">Предпросмотр</h3>
      <div class="preview-wrap"><div class="preview" id="snap-preview" style="background:${theme.bg};color:${theme.ink}"></div></div>

      <div class="stack">
        <button type="button" class="btn primary wide" id="snap-share">${telegramApp ? "Поделиться в Telegram" : "Поделиться картинкой"}</button>
        <button type="button" class="btn wide" id="snap-download">${telegramApp ? "Прислать PNG в чат" : "Сохранить PNG в телефон"}</button>
        <button type="button" class="btn wide" id="snap-text">Скопировать текстом</button>
      </div>`;

    renderSnapPreview();
  }

  function renderSnapPreview() {
    const box = $("snap-preview");
    if (!box) return;
    const order = snapOrder();
    if (!order) return;
    const lines = snapLines(order);
    const cols = snapCols();
    const t = SNAP_THEMES[state.snap.theme] || SNAP_THEMES.teal;
    const meta = snapMetaItems(order);
    const foot = snapFooterCells(cols, lines);
    const totals = snapTotalsText(cols, lines);
    box.style.background = t.bg;
    box.style.color = t.ink;
    box.innerHTML = `
      <div style="background:linear-gradient(90deg,${t.head[0]},${t.head[1]});color:${t.headInk};padding:14px 16px;${
        t.headLine ? `border-bottom:2px solid ${t.accent};` : ""
      }"><b style="font-size:16px">${esc(snapTitle(order))}</b></div>
      <div style="padding:12px 16px 16px">
        ${meta.length ? `<div style="display:grid;gap:3px;font-size:12px;color:${t.meta};margin-bottom:10px">${meta.map((m) => `<div>${esc(m)}</div>`).join("")}</div>` : ""}
        ${
          cols.length
            ? `<table style="border-collapse:collapse;font-size:12px;width:max-content;min-width:100%">
                <thead><tr>${cols
                  .map(
                    (c) =>
                      `<th style="text-align:left;padding:7px 9px;font-size:10px;text-transform:uppercase;letter-spacing:.04em;color:${t.thInk};background:${t.thBg};white-space:nowrap">${esc(
                        c.label
                      )}</th>`
                  )
                  .join("")}</tr></thead>
                <tbody>${lines
                  .map(
                    (line, ri) =>
                      `<tr style="background:${ri % 2 ? t.zebra : "transparent"}">${cols
                        .map(
                          (c) =>
                            `<td style="padding:7px 9px;border-top:1px solid ${t.line};color:${t.ink};white-space:nowrap">${esc(
                              snapValue(line, c.id)
                            )}</td>`
                        )
                        .join("")}</tr>`
                  )
                  .join("")}</tbody>
                ${
                  foot
                    ? `<tfoot><tr>${foot
                        .map(
                          (v) =>
                            `<td style="padding:8px 9px;border-top:2px solid ${t.accent};background:${t.footBg};font-weight:700;color:${t.ink};white-space:nowrap">${esc(
                              v
                            )}</td>`
                        )
                        .join("")}</tr></tfoot>`
                    : ""
                }
              </table>`
            : `<div style="font-size:12px;color:${t.note}">Включите колонки — появится таблица работ.</div>`
        }
        ${totals ? `<div style="margin-top:10px;font-size:13px;font-weight:700">${esc(totals)}</div>` : ""}
        ${
          state.snap.hideStamp
            ? ""
            : `<div style="margin-top:10px;font-size:10px;color:${t.note}">Сформировано ${esc(new Date().toLocaleString("ru-RU"))}</div>`
        }
      </div>`;
  }

  function fitText(ctx, text, maxW) {
    const s = String(text ?? "");
    if (ctx.measureText(s).width <= maxW) return s;
    let t = s;
    while (t.length && ctx.measureText(`${t}…`).width > maxW) t = t.slice(0, -1);
    return `${t}…`;
  }

  function snapColWidths(cols, lines) {
    const ctx = document.createElement("canvas").getContext("2d");
    const foot = snapFooterCells(cols, lines);
    return cols.map((col, i) => {
      ctx.font = "600 11px Segoe UI, sans-serif";
      let w = ctx.measureText(col.label.toUpperCase()).width;
      ctx.font = "13px Segoe UI, sans-serif";
      lines.forEach((line) => {
        w = Math.max(w, ctx.measureText(String(snapValue(line, col.id) || "—")).width);
      });
      if (foot && foot[i]) {
        ctx.font = "700 13px Segoe UI, sans-serif";
        w = Math.max(w, ctx.measureText(foot[i]).width);
      }
      return Math.min(280, Math.ceil(w) + 22);
    });
  }

  function snapToCanvas() {
    const order = snapOrder();
    if (!order) throw new Error("Нет заказа для снимка");
    const lines = snapLines(order);
    if (!lines.length) throw new Error("Выберите хотя бы одну позицию");
    const cols = snapCols();
    const theme = SNAP_THEMES[state.snap.theme] || SNAP_THEMES.teal;
    const title = snapTitle(order);
    const meta = snapMetaItems(order);
    const foot = snapFooterCells(cols, lines);
    const totals = snapTotalsText(cols, lines);
    const stamp = `Сформировано ${new Date().toLocaleString("ru-RU")}`;
    const widths = cols.length ? snapColWidths(cols, lines) : [];
    const tableW = widths.reduce((s, w) => s + w, 0);
    const pad = 20;
    const rowH = 34;

    const measure = document.createElement("canvas").getContext("2d");
    let inner = tableW;
    measure.font = "700 20px Segoe UI, sans-serif";
    inner = Math.max(inner, measure.measureText(title).width);
    measure.font = "13px Segoe UI, sans-serif";
    meta.forEach((m) => {
      inner = Math.max(inner, measure.measureText(m).width);
    });
    if (totals) {
      measure.font = "700 14px Segoe UI, sans-serif";
      inner = Math.max(inner, measure.measureText(totals).width);
    }
    if (!state.snap.hideStamp) {
      measure.font = "11px Segoe UI, sans-serif";
      inner = Math.max(inner, measure.measureText(stamp).width);
    }

    const width = Math.ceil(pad * 2 + Math.max(inner, 120));
    const headerH = 64;
    const bodyH =
      16 +
      (meta.length ? meta.length * 22 + 10 : 0) +
      (cols.length ? 32 + lines.length * rowH + (foot ? rowH : 0) : 28) +
      (totals ? 36 : 0) +
      16;
    const height = headerH + bodyH + (state.snap.hideStamp ? 12 : 34);

    const scale = Math.min(3, Math.max(2, Math.round(window.devicePixelRatio || 2)));
    const canvas = document.createElement("canvas");
    canvas.width = width * scale;
    canvas.height = height * scale;
    const ctx = canvas.getContext("2d");
    ctx.scale(scale, scale);
    ctx.textBaseline = "alphabetic";
    ctx.fillStyle = theme.bg;
    ctx.fillRect(0, 0, width, height);

    const grad = ctx.createLinearGradient(0, 0, width, 0);
    grad.addColorStop(0, theme.head[0]);
    grad.addColorStop(1, theme.head[1]);
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, width, headerH);
    if (theme.headLine) {
      ctx.strokeStyle = theme.accent;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(0, headerH - 1);
      ctx.lineTo(width, headerH - 1);
      ctx.stroke();
      ctx.lineWidth = 1;
    }
    ctx.fillStyle = theme.headInk;
    ctx.font = "700 20px Segoe UI, sans-serif";
    ctx.fillText(fitText(ctx, title, width - pad * 2), pad, 40);

    let y = headerH + 16;
    ctx.fillStyle = theme.meta;
    ctx.font = "13px Segoe UI, sans-serif";
    meta.forEach((m) => {
      ctx.fillText(m, pad, y + 14);
      y += 22;
    });
    if (meta.length) y += 10;

    if (cols.length) {
      const xs = [];
      let acc = pad;
      widths.forEach((w) => {
        xs.push(acc);
        acc += w;
      });
      ctx.fillStyle = theme.thBg;
      ctx.fillRect(pad, y, tableW, 32);
      ctx.fillStyle = theme.thInk;
      ctx.font = "600 11px Segoe UI, sans-serif";
      cols.forEach((col, i) => {
        ctx.fillText(fitText(ctx, col.label.toUpperCase(), widths[i] - 14), xs[i] + 8, y + 21);
      });
      y += 32;
      ctx.font = "13px Segoe UI, sans-serif";
      lines.forEach((line, ri) => {
        if (ri % 2) {
          ctx.fillStyle = theme.zebra;
          ctx.fillRect(pad, y, tableW, rowH);
        }
        ctx.strokeStyle = theme.line;
        ctx.beginPath();
        ctx.moveTo(pad, y);
        ctx.lineTo(pad + tableW, y);
        ctx.stroke();
        ctx.fillStyle = theme.ink;
        cols.forEach((col, i) => {
          ctx.fillText(fitText(ctx, String(snapValue(line, col.id) || "—"), widths[i] - 14), xs[i] + 8, y + 22);
        });
        y += rowH;
      });
      if (foot) {
        ctx.fillStyle = theme.footBg;
        ctx.fillRect(pad, y, tableW, rowH);
        ctx.strokeStyle = theme.accent;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(pad, y);
        ctx.lineTo(pad + tableW, y);
        ctx.stroke();
        ctx.lineWidth = 1;
        ctx.fillStyle = theme.ink;
        ctx.font = "700 13px Segoe UI, sans-serif";
        foot.forEach((v, i) => {
          if (!v) return;
          ctx.fillText(fitText(ctx, v, widths[i] - 14), xs[i] + 8, y + 22);
        });
        y += rowH;
      }
    }

    if (totals) {
      y += 14;
      ctx.fillStyle = theme.ink;
      ctx.font = "700 14px Segoe UI, sans-serif";
      ctx.fillText(totals, pad, y + 14);
      y += 22;
    }
    if (!state.snap.hideStamp) {
      ctx.fillStyle = theme.note;
      ctx.font = "11px Segoe UI, sans-serif";
      ctx.fillText(stamp, pad, height - 14);
    }
    return canvas;
  }

  function visLen(s) {
    return [...String(s ?? "")].length;
  }

  function padVis(s, n) {
    const str = String(s ?? "");
    return `${str}${" ".repeat(Math.max(0, n - visLen(str)))}`;
  }

  function snapToText() {
    const order = snapOrder();
    if (!order) throw new Error("Нет заказа для снимка");
    const lines = snapLines(order);
    if (!lines.length) throw new Error("Выберите хотя бы одну позицию");
    const cols = snapCols();
    const out = [snapTitle(order)];
    const meta = snapMetaItems(order);
    if (meta.length) {
      out.push("");
      meta.forEach((m) => out.push(m));
    }
    if (cols.length) {
      const foot = snapFooterCells(cols, lines);
      const rows = [
        cols.map((c) => c.label),
        ...lines.map((line) => cols.map((c) => String(snapValue(line, c.id) || "—"))),
      ];
      if (foot && foot.some(Boolean)) rows.push(foot.map((v) => v || ""));
      const widths = cols.map((_, i) => Math.max(1, ...rows.map((row) => visLen(row[i]))));
      out.push("");
      rows.forEach((row, ri) => {
        out.push(row.map((cell, i) => padVis(cell, widths[i])).join("  "));
        if (ri === 0) out.push(widths.map((w) => "─".repeat(w)).join("  "));
      });
    }
    const totals = snapTotalsText(cols, lines);
    if (totals) {
      out.push("");
      out.push(totals);
    }
    if (!state.snap.hideStamp) {
      out.push("");
      out.push(`Сформировано ${new Date().toLocaleString("ru-RU")}`);
    }
    return `${out.join("\n").trim()}\n`;
  }

  function snapFileName() {
    const order = snapOrder();
    const base = [order?.number ? `zakaz-${order.number}` : "snimok", order?.name]
      .filter(Boolean)
      .join("-")
      .replace(/[^\wа-яё\-]+/gi, "-")
      .slice(0, 60);
    return `${base || "snimok"}.png`;
  }

  function canvasBlob(canvas) {
    return new Promise((resolve) => canvas.toBlob((b) => resolve(b), "image/png"));
  }

  function blobToBase64(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const s = String(reader.result || "");
        const i = s.indexOf(",");
        resolve(i >= 0 ? s.slice(i + 1) : s);
      };
      reader.onerror = () => reject(new Error("Не удалось прочитать картинку"));
      reader.readAsDataURL(blob);
    });
  }

  function telegramUserId() {
    const user = telegramApp && telegramApp.initDataUnsafe && telegramApp.initDataUnsafe.user;
    const id = user && user.id;
    return Number(id) || 0;
  }

  async function sendSnapshotToTelegram(mode) {
    const canvas = snapToCanvas();
    const blob = await canvasBlob(canvas);
    if (!blob) throw new Error("Не удалось создать картинку");
    return api("/api/remote/snapshot-png", {
      method: "POST",
      body: JSON.stringify({
        png: await blobToBase64(blob),
        filename: snapFileName(),
        caption: snapTitle(snapOrder()),
        mode,
        user_id: telegramUserId(),
      }),
    });
  }

  async function snapShare() {
    try {
      if (telegramApp) {
        const res = await sendSnapshotToTelegram("share");
        if (res.share_id && typeof telegramApp.shareMessage === "function") {
          telegramApp.shareMessage(res.share_id, (ok) => {
            if (ok) toast("Снимок отправлен");
          });
          toast("Выберите чат — если окно не открылось, снимок уже у бота");
          return;
        }
        toast("Снимок в чате с ботом — перешлите заказчику");
        return;
      }
      const canvas = snapToCanvas();
      const blob = await canvasBlob(canvas);
      if (!blob) throw new Error("Не удалось создать картинку");
      const file = new File([blob], snapFileName(), { type: "image/png" });
      if (navigator.canShare?.({ files: [file] })) {
        await navigator.share({ files: [file], title: snapTitle(snapOrder()) });
        return;
      }
      if (navigator.share) {
        await navigator.share({ title: snapTitle(snapOrder()), text: snapToText() });
        toast("Картинку телефон не отдаёт — отправлен текст");
        return;
      }
      snapDownload();
    } catch (err) {
      if (String(err?.name) === "AbortError") return;
      toast(`Не получилось: ${err.message || err}`);
    }
  }

  async function snapDownload() {
    try {
      if (telegramApp) {
        await sendSnapshotToTelegram("save");
        toast("PNG в чате с ботом — откройте файл и сохраните");
        return;
      }
      const canvas = snapToCanvas();
      const blob = await canvasBlob(canvas);
      if (!blob) throw new Error("Не удалось создать картинку");
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = snapFileName();
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 4000);
      toast("Снимок сохранён в загрузки");
    } catch (err) {
      toast(`Не получилось: ${err.message || err}`);
    }
  }

  async function snapCopyText() {
    try {
      const text = snapToText();
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
        toast("Текст скопирован — вставьте в чат");
        return;
      }
      if (navigator.share) {
        await navigator.share({ text });
        return;
      }
      throw new Error("буфер обмена недоступен");
    } catch (err) {
      if (String(err?.name) === "AbortError") return;
      toast(`Не получилось: ${err.message || err}`);
    }
  }

  /* ================= отчёты и устройство ================= */

  function fileCardHtml(item, canDelete = false) {
    let actions = "";
    if (item.path === state.path) actions += '<span class="pill" style="background:var(--accent-2)">открыт</span>';
    else if (item.exists === false) actions += '<span class="pill" style="background:var(--muted)">нет файла</span>';
    else actions += `<button type="button" class="btn small" data-open-file="${esc(item.path)}">Открыть</button>`;
    if (canDelete) {
      actions += `<button type="button" class="btn small danger-ghost" data-delete-file="${esc(item.path)}">Удалить</button>`;
    }
    return `<article class="card file-item ${item.path === state.path ? "current" : ""}">
          <div class="fi-body">
            <strong>${esc(item.title || item.name || item.path.split(/[\\/]/).pop())}</strong>
            <small>${esc(item.name || item.path)}</small>
          </div>
          <div class="fi-actions">${actions}</div>
        </article>`;
  }

  function recentListHtml() {
    const recent = state.recent || [];
    if (!recent.length) return '<div class="empty">Недавних отчётов нет — создайте новый или откройте файл на компьютере.</div>';
    return recent.map((item) => fileCardHtml(item)).join("");
  }

  function libraryListHtml() {
    const lib = state.library || {};
    const items = lib.items || [];
    const path = lib.path ? `<small class="muted" style="display:block;margin:-4px 0 10px;word-break:break-all">${esc(lib.path)}</small>` : "";
    if (!items.length) {
      return `${path}<div class="empty">Пока пусто — новые отчёты появятся здесь</div>`;
    }
    return path + items.map((item) => fileCardHtml(item, true)).join("");
  }

  function renderFiles() {
    const file = state.path ? state.path.split(/[\\/]/).pop() : "";
    const openCard = hasDocument()
      ? `<article class="card">
        <div class="muted" style="margin-bottom:8px">Открыто на компьютере</div>
        <div class="grid-2">
          <div class="field"><label>Название отчёта</label><input type="text" data-d="title" value="${esc(state.doc?.title || "")}" /></div>
          <div class="field"><label>Валюта</label><input type="text" data-d="currency" value="${esc(state.doc?.currency || "₽")}" /></div>
        </div>
        <small class="muted" style="word-break:break-all">${esc(state.path || "файл ещё не сохранён")}</small>
        <div class="stack">
          <button type="button" class="btn primary wide" id="cmd-save">${state.dirty ? "Сохранить изменения" : "Сохранить"}${
            file ? ` — ${esc(file)}` : ""
          }</button>
          <button type="button" class="btn wide" id="cmd-new">Создать новый отчёт</button>
        </div>
      </article>`
      : `<article class="card">
        <strong>На компьютере нет открытого отчёта</strong>
        <p class="muted" style="margin:8px 0 12px">Выберите недавний файл — он откроется в программе. Или создайте новый.</p>
        <button type="button" class="btn primary wide" id="cmd-new">Создать новый отчёт</button>
      </article>`;
    $("files-body").innerHTML = `
      ${openCard}
      <h3 class="section">Папка FinMaster</h3>
      <div class="list">${libraryListHtml()}</div>
      <h3 class="section">Недавние отчёты</h3>
      <div class="list">${recentListHtml()}</div>
      <h3 class="section">Это устройство</h3>
      <article class="card">
        <div class="field last">
          <label>Имя на компьютере</label>
          <div class="name-row">
            <input type="text" id="device-name" value="${esc(deviceName())}" placeholder="${esc(guessDeviceName())}" />
            <button type="button" class="icon-btn ghost" id="device-info" aria-label="О устройстве" title="О устройстве">i</button>
          </div>
        </div>
        <div class="device-facts" id="device-facts" ${state.deviceFactsOpen ? "" : "hidden"}>${deviceFactsHtml()}</div>
        <div class="muted" style="margin:10px 0 0">Если имя не задано, компьютер берёт его из браузера. Добавьте страницу в закладки — QR больше не нужен.</div>
        <div class="stack">
          ${
            telegramApp
              ? `<button type="button" class="btn wide" id="cmd-homescreen">${
                  state.homeScreen === "added" ? "Ярлык уже на экране" : "Добавить иконку на экран"
                }</button>`
              : `<button type="button" class="btn wide" id="cmd-fullscreen">${document.fullscreenElement ? "Выйти из полного экрана" : "Полный экран"}</button>`
          }
          <button type="button" class="btn wide" id="cmd-copy-link">Скопировать постоянную ссылку</button>
          <button type="button" class="btn wide danger-ghost" id="cmd-leave">Отключиться от компьютера</button>
        </div>
      </article>`;
  }

  function deviceFactsHtml() {
    const p = devicePayload();
    const rows = [
      ["Имя", p.name],
      ["Модель", p.model],
      ["Система", [p.platform, p.platform_version].filter(Boolean).join(" ")],
      ["Браузер", p.brands],
      ["Язык", p.language],
      ["Экран", p.screen],
      ["Окно", p.viewport],
      ["Плотность", p.pixel_ratio],
      ["Часовой пояс", p.timezone],
      ["User-Agent", p.user_agent],
    ].filter(([, value]) => value);
    return rows
      .map(([label, value]) => `<div class="fact"><span>${esc(label)}</span><b>${esc(value)}</b></div>`)
      .join("");
  }

  async function refreshRecent() {
    try {
      const data = await api("/api/remote/session");
      state.recent = data.recent || [];
      if (data.library) state.library = data.library;
      applySnapshot(data);
      if (state.view === "files") renderFiles();
    } catch {
      /* полл покажет ошибку */
    }
  }

  /* ================= полный экран ================= */

  function fullscreenOn() {
    return !!(document.fullscreenElement || document.webkitFullscreenElement);
  }

  async function toggleFullscreen() {
    try {
      if (fullscreenOn()) {
        await (document.exitFullscreen?.() || document.webkitExitFullscreen?.());
        return;
      }
      const el = document.documentElement;
      const req = el.requestFullscreen || el.webkitRequestFullscreen;
      if (!req) {
        toast("Браузер не умеет полный экран. В Safari: «Поделиться» → «На экран Домой»");
        return;
      }
      await req.call(el, { navigationUI: "hide" });
    } catch {
      toast("Полный экран недоступен в этом браузере");
    }
  }

  /* ================= шторки ================= */

  function openSheet(title, items, current, onPick) {
    $("sheet").classList.remove("is-menu");
    $("sheet-title").hidden = false;
    $("sheet-title").textContent = title;
    $("sheet-list").innerHTML = items
      .map(
        (item, i) =>
          `<button type="button" data-pick="${i}" class="${item.value === current ? "active" : ""}">
            ${item.color ? `<i class="dot" style="width:14px;height:14px;background:${esc(item.color)}"></i>` : ""}
            <span>${esc(item.label)}</span>
            ${item.hint ? `<small>${esc(item.hint)}</small>` : ""}
          </button>`
      )
      .join("");
    $("sheet").hidden = false;
    $("sheet").classList.add("is-on");
    $("sheet")._pick = (i) => {
      closeSheet();
      onPick(items[i]);
    };
  }

  function renderHistorySheet() {
    const items = state.history.items || [];
    const index = state.history.index;
    $("sheet-list").innerHTML = `
      <div class="empty" style="margin-bottom:8px">Только просмотр: отмена и повтор — стрелками сверху.</div>
      ${
        items.length
          ? items
              .slice()
              .reverse()
              .map((item) => {
                const i = items.indexOf(item);
                return `<div class="hist-info ${i === index ? "active" : ""}">
                  <span>${esc(item.label || "Правка")}</span>
                  <small>${esc([historyTime(item.at), item.device || (item.source === "mobile" ? "Телефон" : "ПК")].filter(Boolean).join(" · "))}</small>
                </div>`;
              })
              .join("")
          : `<div class="empty">Пока нет снимков</div>`
      }`;
  }

  function openHistorySheet() {
    $("sheet").classList.remove("is-menu");
    $("sheet-title").hidden = false;
    $("sheet-title").textContent = "История";
    $("sheet").hidden = false;
    $("sheet").classList.add("is-on");
    $("sheet")._menu = null;
    renderHistorySheet();
  }

  function closeSheet() {
    $("sheet").hidden = true;
    $("sheet").classList.remove("is-on", "is-menu");
    $("sheet-title").hidden = false;
    $("sheet")._menu = null;
  }

  function menuHtml() {
    const dark = document.documentElement.getAttribute("data-theme") === "dark";
    const full = fullscreenOn();
    const tiles = [
      ["snapshot", "◨", "Снимок"],
      ["new", "+", "Новый отчёт"],
      ["link", "↗", "Ссылка"],
      ["device", "◈", "Отчёты"],
    ];
    const homeAdded = state.homeScreen === "added";
    const toolBtn = telegramApp
      ? `<button type="button" class="menu-sq ${homeAdded ? "on" : ""}" data-menu="homescreen" aria-label="${homeAdded ? "Ярлык уже на экране" : "Добавить иконку на экран"}">
              <b>⌂</b>
            </button>`
      : `<button type="button" class="menu-sq ${full ? "on" : ""}" data-menu="fullscreen" aria-label="${full ? "Выйти из полного экрана" : "Полный экран"}">
              <b>${full ? "↙" : "⛶"}</b>
            </button>`;
    return `
      <div class="menu-panel">
        <div class="menu-head">
          <div class="menu-title">Меню</div>
          <div class="menu-tools">
            ${toolBtn}
            <button type="button" class="menu-sq" data-menu="theme" aria-label="${dark ? "Светлая тема" : "Тёмная тема"}">
              <b>${dark ? "☀" : "☾"}</b>
            </button>
            <button type="button" class="menu-sq ${state.pinging ? "busy" : ""}" data-menu="ping" aria-label="Проверить подключение">
              <b>↻</b>
            </button>
          </div>
        </div>
        <button type="button" class="menu-save ${state.dirty ? "dirty" : ""}" data-menu="save">
          <strong>${state.dirty ? "Сохранить изменения" : "Сохранить"}</strong>
          ${state.dirty ? "<small>есть несохранённые правки</small>" : "<small>на компьютере</small>"}
        </button>
        <label class="menu-autosave">
          <input type="checkbox" id="m-autosave" ${state.autosave ? "checked" : ""} />
          <span>
            <strong>Автосохранение</strong>
            <small>синхронно с компьютером</small>
          </span>
        </label>
        <button type="button" class="menu-history" data-menu="history">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <circle cx="12" cy="12" r="8" stroke="currentColor" stroke-width="1.8"/>
            <path d="M12 8v4.2L15 15" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
          <span>
            <strong>История</strong>
            <small>${(state.history.items || []).length ? `${state.history.items.length} снимков` : "только просмотр"}</small>
          </span>
        </button>
        <div class="menu-grid">
          ${tiles
            .map(
              ([id, ico, label]) =>
                `<button type="button" class="menu-tile" data-menu="${id}"><b>${ico}</b><span>${label}</span></button>`
            )
            .join("")}
        </div>
      </div>`;
  }

  function renderMenu() {
    if (!$("sheet").classList.contains("is-menu")) return;
    $("sheet-list").innerHTML = menuHtml();
    bindMenuAutosave();
  }

  function openMenu() {
    $("sheet-title").hidden = true;
    $("sheet").classList.add("is-on", "is-menu");
    $("sheet").hidden = false;
    $("sheet-list").innerHTML = menuHtml();
    $("sheet")._menu = onMenuAction;
    bindMenuAutosave();
  }

  function bindMenuAutosave() {
    $("m-autosave")?.addEventListener("change", onAutosaveChange);
  }

  async function onAutosaveChange(e) {
    const enabled = !!e.target.checked;
    const previous = state.autosave;
    state.autosave = enabled;
    try {
      const res = await api("/api/remote/autosave", { method: "POST", body: JSON.stringify({ enabled }) });
      if (typeof res.version === "number") state.version = res.version;
      toast(enabled ? "Автосохранение включено" : "Автосохранение выключено");
    } catch (err) {
      state.autosave = previous;
      e.target.checked = previous;
      toast(`Не удалось: ${err.message || err}`);
    }
  }

  async function onMenuAction(value) {
    if (value === "theme") {
      toggleTheme();
      renderMenu();
      return;
    }
    if (value === "ping") {
      await checkConnection();
      return;
    }
    if (value === "fullscreen") {
      await toggleFullscreen();
      renderMenu();
      return;
    }
    if (value === "homescreen") {
      addToHomeScreen();
      if (state.homeScreen === "added") renderMenu();
      else closeSheet();
      return;
    }
    if (value === "history") {
      openHistorySheet();
      return;
    }
    closeSheet();
    if (value === "save") {
      await push();
      if (await command("save")) toast("Отчёт сохраняется на компьютере");
    } else if (value === "snapshot") openSnapshot();
    else if (value === "new") await createNewReport();
    else if (value === "link") copyLink();
    else if (value === "device") setView("files");
  }

  function toggleTheme() {
    const next = document.documentElement.getAttribute("data-theme") === "dark" ? "light" : "dark";
    document.documentElement.setAttribute("data-theme", next);
    localStorage.setItem(LS_THEME, next);
    paintTelegram(telegramApp);
  }

  async function checkConnection() {
    if (state.pinging) return;
    state.pinging = true;
    document.querySelector('[data-menu="ping"]')?.classList.add("busy");
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 8000);
    try {
      await api("/api/remote/info", { signal: ctrl.signal });
      toast("Связь с компьютером есть");
      setSync("ok", "подключено");
    } catch (err) {
      if (state.stopped) return;
      const timedOut = err?.name === "AbortError";
      toast(timedOut ? "Нет ответа от компьютера" : "Нет связи с компьютером");
      noteOffline();
    } finally {
      clearTimeout(timer);
      state.pinging = false;
      document.querySelector('[data-menu="ping"]')?.classList.remove("busy");
    }
  }

  function copyLink() {
    const link = location.href;
    navigator.clipboard?.writeText(link).then(
      () => toast("Ссылка скопирована — сохраните в закладки"),
      () => toast(link)
    );
  }

  /* ================= редактирование ================= */

  const DECIMAL_FIELDS = new Set(["qty_expr", "price_expr", "discount_expr", "paid_expr", "tax_percent_expr"]);
  const MIRROR = EXPR_MIRROR;

  function onEdit(e) {
    const el = e.target;
    const docField = el.dataset?.d;
    if (docField && state.doc) {
      state.doc[docField] = el.value;
      touchDoc();
      pushSoon();
      updateHead();
      return;
    }
    const field = el.dataset?.f;
    if (!field) return;
    const order = el.dataset.o ? orders().find((o) => o.id === el.dataset.o) : currentOrder();
    if (!order) return;

    if (el.dataset.l) {
      const line = findLine(order, el.dataset.l);
      if (!line) return;
      if (DECIMAL_FIELDS.has(field) && el.dataset.showing === "result") return;
      let value = el.value;
      if (DECIMAL_FIELDS.has(field) && value.includes(",")) {
        const pos = el.selectionStart;
        value = value.replaceAll(",", ".");
        el.value = value;
        if (pos != null) el.setSelectionRange(pos, pos);
      }
      if (field === "price_expr") {
        const cleaned = stripLeadingZerosPlain(value);
        if (cleaned !== value) {
          const pos = el.selectionStart;
          const diff = value.length - cleaned.length;
          value = cleaned;
          el.value = cleaned;
          if (pos != null) {
            try {
              el.setSelectionRange(Math.max(0, pos - diff), Math.max(0, pos - diff));
            } catch (_) {}
          }
        }
      }
      const prevKind = field === "order_type" ? typeKind(line.order_type) : "";
      line[field] = value;
      if (DECIMAL_FIELDS.has(field)) el.dataset.expr = value;
      if (MIRROR[field]) {
        const v = evalExpr(value);
        line[MIRROR[field]] = Number.isFinite(v) ? round2(v) : 0;
      }
      if (field === "product") {
        fillEdProductSuggest(value);
        const found = (state.doc.products || []).find((p) => (p.name || p) === value);
        if (found?.unit) {
          line.unit = found.unit;
          const sel = document.querySelector(`select[data-l="${CSS.escape(line.id)}"][data-f="unit"]`);
          if (sel) sel.value = found.unit;
        }
        if (found?.price != null && num(found.price) > 0 && !(num(line.price) > 0)) {
          setLineNumber(line, "price_expr", found.price);
          const inp = document.querySelector(`input[data-l="${CSS.escape(line.id)}"][data-f="price_expr"]`);
          if (inp) {
            inp.value = String(found.price);
            inp.dataset.expr = String(found.price);
            inp.dataset.showing = "expr";
            inp.classList.remove("is-result");
          }
        }
      }
      // Смена вида (доход / налог / затрата) меняет форму редактора — пересобираем экран.
      if (field === "order_type" && typeKind(line.order_type) !== prevKind) {
        const nextKind = typeKind(line.order_type);
        if (nextKind && !prevKind) resetExpenseLine(line);
        line.tax_mode = nextKind === "tax" ? "gross" : "amount";
        touchDoc();
        pushSoon();
        renderOrder();
        renderEditor();
        return;
      }
      if (field === "tax_percent_expr") {
        markExprValidity(el);
        refreshEditorSums();
        renderOrder();
        touchDoc();
        pushSoon();
        return;
      }
      if (field === "paid_expr") autoPaidStatus(line);
      if (DECIMAL_FIELDS.has(field)) markExprValidity(el);
      refreshEditorSums();
      refreshOrderRow(line.id);
    } else {
      order[field] = el.value;
      if (field === "work_start" || field === "work_end") {
        normalizeWorkDates(order);
        touchDoc();
        pushSoon();
        renderOrder();
        return;
      }
      if (field === "number" || field === "name") renderOrderTopOnly(order);
    }
    touchDoc();
    pushSoon();
  }

  function renderOrderTopOnly(order) {
    const top = $("order-top");
    if (!top) return;
    const numEl = top.querySelector(".ot-num");
    const nameEl = top.querySelector(".ot-name");
    if (numEl) numEl.textContent = order.number || "—";
    if (nameEl) nameEl.textContent = order.name || "без названия";
  }

  /** У расхода нет скидки, оплаты и даты оплаты — очищаем, чтобы цифры не всплыли при возврате к обычному типу. */
  function resetExpenseLine(line) {
    line.discount = 0;
    line.discount_expr = "0";
    line.paid = 0;
    line.paid_expr = "0";
    line.payment_date = "";
    if (line.tax_mode == null) line.tax_mode = typeKind(line.order_type) === "tax" ? "gross" : "amount";
    if (line.tax_percent_expr == null) {
      line.tax_percent = num(line.tax_percent);
      line.tax_percent_expr = String(line.tax_percent || 0);
    }
    return line;
  }

  function autoPaidStatus(line) {
    const name = paidStatusName();
    if (!name || isExpenseLine(line)) return;
    const t = lineTotals(line);
    if (t.after > 0 && t.paid + 0.005 >= t.after && line.status !== name) {
      line.status = name;
      document.querySelectorAll("[data-pick-status]").forEach((b) => {
        b.classList.toggle("active", b.dataset.pickStatus === name);
      });
    }
  }

  /* ================= события ================= */

  function bind() {
    fillExprPad();
    let skipLineClick = false;
    bindSortable($("lines-list"), {
      handle: ".lr-drag",
      item: ".line-row",
      onCommit: () => {
        skipLineClick = true;
        commitLineOrder($("lines-list"), false);
      },
    });
    bindSortable($("costs-list"), {
      handle: ".lr-drag",
      item: ".line-row",
      onCommit: () => {
        skipLineClick = true;
        commitLineOrder($("costs-list"), true);
      },
    });

    const dockEditorToViewport = () => {
      const editor = $("editor");
      const card = editor?.querySelector(".sheet-card");
      if (!card) return;
      if (editor.hidden) {
        card.style.bottom = "";
        return;
      }
      const vv = window.visualViewport;
      if (!vv) return;
      const overlap = Math.max(0, window.innerHeight - vv.height - vv.offsetTop);
      card.style.bottom = overlap ? `${overlap}px` : "";
    };
    window.visualViewport?.addEventListener("resize", dockEditorToViewport);
    window.visualViewport?.addEventListener("scroll", dockEditorToViewport);

    const orderScreen = $("screen-order");
    const snapScreen = $("screen-snapshot");
    const swipeIgnore = (el) => el.closest("input, textarea, select, button, a, .sheet, .editor, .preview-wrap");
    const editorSwipeIgnore = (el) => el.closest("input, textarea, select, button, a, .expr-pad, #ed-product-suggest");
    const bindSwipeNav = (screen, active, go, ignore = swipeIgnore) => {
      if (!screen) return;
      let swipe = null;
      screen.addEventListener(
        "touchstart",
        (e) => {
          if (!active() || e.touches.length !== 1 || ignore(e.target)) {
            swipe = null;
            return;
          }
          const t = e.touches[0];
          swipe = { x: t.clientX, y: t.clientY, at: Date.now() };
        },
        { passive: true }
      );
      screen.addEventListener(
        "touchmove",
        (e) => {
          if (!swipe || e.touches.length !== 1) {
            swipe = null;
            return;
          }
          const t = e.touches[0];
          const dx = t.clientX - swipe.x;
          const dy = t.clientY - swipe.y;
          if (Math.abs(dy) > 28 && Math.abs(dy) >= Math.abs(dx)) swipe = null;
        },
        { passive: true }
      );
      screen.addEventListener(
        "touchend",
        (e) => {
          if (!swipe) return;
          const t = e.changedTouches[0];
          const dx = t.clientX - swipe.x;
          const dy = t.clientY - swipe.y;
          const dt = Date.now() - swipe.at;
          swipe = null;
          if (dt > 650 || Math.abs(dx) < 56 || Math.abs(dx) < Math.abs(dy) * 1.5) return;
          go(dx < 0 ? 1 : -1);
        },
        { passive: true }
      );
      screen.addEventListener("touchcancel", () => {
        swipe = null;
      });
      screen.addEventListener("animationend", (e) => {
        if (e.target === screen) screen.classList.remove("swipe-next", "swipe-prev");
      });
    };
    bindSwipeNav(
      orderScreen,
      () => state.view === "order" && $("editor").hidden && $("sheet").hidden,
      showNeighborOrder
    );
    bindSwipeNav(
      snapScreen,
      () => state.view === "snapshot" && $("sheet").hidden,
      showNeighborSnap
    );
    bindSwipeNav(
      $("editor-body"),
      () => !$("editor").hidden && !!$("expr-pad")?.hidden,
      editorJump,
      editorSwipeIgnore
    );

    document.addEventListener("touchstart", (e) => {
      const input = e.target.closest("#editor-body input.expr-input");
      if (!input || state.exprSystemKb || document.activeElement === input) return;
      input.setAttribute("readonly", "readonly");
    }, true);

    document.addEventListener("focusin", (e) => {
      const product = e.target.closest('#editor-body [data-f="product"]');
      if (product) {
        fillEdProductSuggest(product.value);
        hideExprPad();
        return;
      }
      if (!e.target.closest("#ed-product-suggest")) closeEdProductSuggest();
      const input = e.target.closest("#editor-body input.expr-input");
      if (input) {
        if (state.exprField && state.exprField !== input.dataset.f) state.exprSystemKb = false;
        showExprPad(input);
        if (!state.exprSystemKb) {
          requestAnimationFrame(() => input.removeAttribute("readonly"));
        }
        return;
      }
      if (e.target.closest("#expr-pad")) return;
      if (e.target.closest("#editor") && !e.target.closest("input, select, textarea")) return;
      hideExprPad();
    });

    $("expr-pad")?.addEventListener("pointerdown", (e) => {
      const key = e.target.closest("[data-expr-op]");
      if (!key) return;
      e.preventDefault();
      applyExprToken(exprTargetInput(), key.dataset.exprOp);
    });

    $("expr-pad-hide")?.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      useSystemExprKeyboard();
    });

    document.addEventListener("input", (e) => {
      if (e.target.id === "device-name") {
        const value = e.target.value.trim();
        if (value) localStorage.setItem(LS_NAME, value);
        else localStorage.removeItem(LS_NAME);
        return;
      }
      if (e.target.id === "snap-title") {
        state.snap.title = e.target.value;
        renderSnapPreview();
        return;
      }
      if (e.target.id === "search") {
        state.query = e.target.value;
        renderOrders();
        return;
      }
      onEdit(e);
    });

    document.addEventListener("change", (e) => {
      if (e.target.id === "device-name" || e.target.id === "snap-title" || e.target.id === "search") return;
      if (e.target.dataset.calMonth != null || e.target.dataset.calYear != null) {
        if (!state.cal.anchor) state.cal.anchor = dayStart(new Date());
        const monthEl = document.querySelector("[data-cal-month]");
        const yearEl = document.querySelector("[data-cal-year]");
        const month = monthEl ? Number(monthEl.value) : state.cal.anchor.getMonth();
        const year = yearEl ? Number(yearEl.value) : state.cal.anchor.getFullYear();
        state.cal.anchor = new Date(year, month, 1);
        renderCalendar();
        return;
      }
      if (e.target.dataset.calNote != null) {
        setDayNote(e.target.dataset.calNote, e.target.value);
        touchDoc();
        pushSoon();
        if (state.view === "calendar") renderCalendar();
        return;
      }
      if (e.target.dataset.calDate) {
        const id = e.target.dataset.calWork || state.orderId;
        const order = orders().find((o) => o.id === id) || currentOrder();
        if (!order) return;
        order[e.target.dataset.calDate] = e.target.value;
        normalizeWorkDates(order);
        touchDoc();
        pushSoon();
        if (state.view === "calendar") renderCalendar();
        else renderOrder();
        toast(e.target.dataset.calDate === "work_start" ? "Начало обновлено" : "Конец обновлён");
        return;
      }
      if (e.target.id === "snap-hide-labels") {
        state.snap.hideLabels = e.target.checked;
        saveSnapPrefs();
        renderSnapPreview();
        return;
      }
      if (e.target.id === "snap-hide-stamp") {
        state.snap.hideStamp = e.target.checked;
        saveSnapPrefs();
        renderSnapPreview();
        return;
      }
      const snapLine = e.target.dataset?.snapLine;
      if (snapLine) {
        const order = snapOrder();
        if (!state.snap.lines) state.snap.lines = new Set((order?.lines || []).map((l) => l.id));
        if (e.target.checked) state.snap.lines.add(snapLine);
        else state.snap.lines.delete(snapLine);
        e.target.closest(".pick-row")?.classList.toggle("on", e.target.checked);
        const meta = $("snap-lines-meta");
        if (meta) {
          const all = snapCandidates(order);
          meta.textContent = `${snapLines(order).length} из ${all.length}`;
        }
        renderSnapPreview();
        return;
      }
      onEdit(e);
    });

    document.addEventListener("focusout", (e) => {
      const input = e.target.closest?.("#editor-body input.expr-input");
      if (input) {
        const next = e.relatedTarget;
        if (!next?.closest?.("#expr-pad")) {
          setTimeout(() => {
            if (document.activeElement === input) return;
            if (document.activeElement?.closest?.("#expr-pad")) return;
            collapseExpr(input);
          }, 0);
        }
      }
      setTimeout(flushPending, 150);
    });

    $("main").addEventListener("click", async (e) => {
      const workBtn = e.target.closest("[data-work-act]");
      if (workBtn) {
        const id = workBtn.dataset.calWork || state.orderId;
        const order = orders().find((o) => o.id === id) || currentOrder();
        if (!order) return;
        const act = workBtn.dataset.workAct;
        if (act === "clear-start" || act === "clear-end") {
          clearWorkDate(order, act === "clear-start" ? "start" : "end");
          toast(act === "clear-start" ? "Начало убрано" : "Конец убран");
        } else {
          setWorkToday(order, act);
          toast(act === "start" ? "Старт — сегодня" : "Финиш — сегодня");
        }
        touchDoc();
        pushSoon();
        if (state.view === "calendar") renderCalendar();
        else renderOrder();
        return;
      }
      const calMode = e.target.closest("[data-cal-mode]");
      if (calMode) {
        state.cal.mode = calMode.dataset.calMode;
        renderCalendar();
        return;
      }
      if (e.target.closest("#btn-mcal-filter")) {
        const menu = $("mcal-filter-menu");
        const btn = $("btn-mcal-filter");
        if (!menu) return;
        const open = menu.hidden;
        menu.hidden = !open;
        btn?.setAttribute("aria-expanded", String(open));
        return;
      }
      const calFilter = e.target.closest("[data-cal-filter]");
      if (calFilter) {
        state.cal.filter = calFilter.dataset.calFilter;
        renderCalendar();
        return;
      }
      const filterMenu = $("mcal-filter-menu");
      if (filterMenu && !filterMenu.hidden && !e.target.closest(".mcal-filter")) {
        filterMenu.hidden = true;
        $("btn-mcal-filter")?.setAttribute("aria-expanded", "false");
      }
      const calNav = e.target.closest("[data-cal-nav]");
      if (calNav) {
        const dir = Number(calNav.dataset.calNav);
        if (!state.cal.anchor) state.cal.anchor = dayStart(new Date());
        if (dir === 0) state.cal.anchor = dayStart(new Date());
        else if (state.cal.mode === "classic") state.cal.anchor = new Date(state.cal.anchor.getFullYear(), state.cal.anchor.getMonth() + dir, 1);
        else state.cal.anchor = addDays(mondayOf(state.cal.anchor), dir * 7);
        renderCalendar();
        return;
      }
      const calDay = e.target.closest("[data-cal-day]");
      if (calDay && !e.target.closest("[data-open], textarea, .mcal-acts")) {
        state.cal.pick = state.cal.pick === calDay.dataset.calDay ? "" : calDay.dataset.calDay;
        renderCalendar();
        return;
      }
      const open = e.target.closest("[data-open]");
      if (open) {
        if (e.target.closest("button, input, label, select, textarea, a, .mcal-acts")) return;
        setView("order", open.dataset.open);
        return;
      }
      const editRow = e.target.closest("[data-edit]");
      if (editRow) {
        if (skipLineClick) {
          skipLineClick = false;
          return;
        }
        if (e.target.closest(".lr-drag")) return;
        openEditor(editRow.dataset.edit);
        return;
      }
      if (e.target.closest("#btn-m-order-filter")) {
        const menu = $("m-order-filter-menu");
        const btn = $("btn-m-order-filter");
        if (!menu) return;
        const open = menu.hidden;
        menu.hidden = !open;
        btn?.setAttribute("aria-expanded", String(open));
        return;
      }
      const chip = e.target.closest("[data-chip]");
      if (chip) {
        state.filter = chip.dataset.chip;
        renderOrders();
        return;
      }
      const orderFilterMenu = $("m-order-filter-menu");
      if (orderFilterMenu && !orderFilterMenu.hidden && !e.target.closest("#m-order-filter")) {
        orderFilterMenu.hidden = true;
        $("btn-m-order-filter")?.setAttribute("aria-expanded", "false");
      }
      const statsPeriod = e.target.closest("#stats-period");
      if (statsPeriod) {
        openStatsPeriod();
        return;
      }
      const statsFilter = e.target.closest("#stats-filter");
      if (statsFilter) {
        openStatsFilter();
        return;
      }
      const statsStatus = e.target.closest("#stats-status");
      if (statsStatus) {
        openStatsStatus();
        return;
      }
      if (e.target.closest("#order-fold")) {
        state.headOpen = !state.headOpen;
        document.querySelector("#order-head .fold")?.classList.toggle("closed", !state.headOpen);
        return;
      }
      if (e.target.closest("#snap-fields-fold")) {
        state.snap.fieldsOpen = !state.snap.fieldsOpen;
        e.target.closest(".fold")?.classList.toggle("closed", !state.snap.fieldsOpen);
        return;
      }
      if (e.target.closest("#snap-lines-fold")) {
        state.snap.linesOpen = !state.snap.linesOpen;
        e.target.closest(".fold")?.classList.toggle("closed", !state.snap.linesOpen);
        return;
      }
      const preset = e.target.closest("[data-preset]");
      if (preset) {
        state.snap.fields = (SNAP_PRESETS[preset.dataset.preset] || SNAP_PRESETS.invoice).slice();
        saveSnapPrefs();
        renderSnapshot();
        return;
      }
      const field = e.target.closest("[data-field]");
      if (field) {
        const id = field.dataset.field;
        state.snap.fields = state.snap.fields.includes(id)
          ? state.snap.fields.filter((f) => f !== id)
          : state.snap.fields.concat([id]);
        field.classList.toggle("active");
        saveSnapPrefs();
        // Список позиций зависит от поля «Налоги и затраты» — его нужно пересобрать.
        if (id === "expenses") renderSnapshot();
        else renderSnapPreview();
        return;
      }
      const themeBtn = e.target.closest("[data-snap-theme]");
      if (themeBtn) {
        state.snap.theme = themeBtn.dataset.snapTheme;
        saveSnapPrefs();
        renderSnapshot();
        return;
      }
      if (e.target.closest("#snap-order")) {
        openSheet(
          "Какой заказ показать",
          orders()
            .slice()
            .reverse()
            .map((o) => ({
              label: `${o.number || "—"} · ${o.name || "без названия"}`,
              hint: `${o.customer || "без заказчика"} · ${money(orderTotals(o).after)}`,
              value: o.id,
            })),
          snapOrder()?.id,
          (item) => {
            state.snap.orderId = item.value;
            state.snap.lines = null;
            state.snap.linesOpen = false;
            renderSnapshot();
          }
        );
        return;
      }
      if (e.target.closest("#snap-share")) {
        snapShare();
        return;
      }
      if (e.target.closest("#snap-download")) {
        snapDownload();
        return;
      }
      if (e.target.closest("#snap-text")) {
        snapCopyText();
        return;
      }
      const openFile = e.target.closest("[data-open-file]");
      if (openFile) {
        const path = openFile.dataset.openFile;
        if (await command("open", { path })) {
          toast("Открываю на компьютере…");
          await waitForOpenedReport(path);
        }
        return;
      }
      const delFile = e.target.closest("[data-delete-file]");
      if (delFile) {
        const path = delFile.dataset.deleteFile;
        const name = String(path || "").split(/[\\/]/).pop() || "отчёт";
        if (!confirm(`Удалить «${name}» из папки FinMaster? Файл попадёт в корзину на компьютере.`)) return;
        try {
          const res = await api("/api/remote/command", {
            method: "POST",
            body: JSON.stringify({ type: "delete", path }),
          });
          if (typeof res.version === "number") state.version = res.version;
          if (res.library) state.library = res.library;
          if (res.recent) state.recent = res.recent;
          if (res.closed) {
            state.doc = null;
            state.path = "";
            state.waitingForDoc = true;
          }
          renderFiles();
          toast("Отчёт удалён");
        } catch (err) {
          toast(`Не удалось: ${err.message || err}`);
        }
        return;
      }
      if (e.target.closest("#cmd-save")) {
        await push();
        if (await command("save")) toast("Компьютер сохраняет отчёт…");
        return;
      }
      if (e.target.closest("#cmd-new")) {
        await createNewReport();
        return;
      }
      if (e.target.closest("#device-info")) {
        state.deviceFactsOpen = !state.deviceFactsOpen;
        const box = $("device-facts");
        if (box) {
          box.hidden = !state.deviceFactsOpen;
          box.innerHTML = deviceFactsHtml();
        }
        return;
      }
      if (e.target.closest("#cmd-fullscreen")) {
        await toggleFullscreen();
        renderFiles();
        return;
      }
      if (e.target.closest("#cmd-homescreen")) {
        addToHomeScreen();
        return;
      }
      if (e.target.closest("#cmd-copy-link")) {
        copyLink();
        return;
      }
      if (e.target.closest("#cmd-leave")) {
        state.stopped = true;
        api("/api/remote/leave", { method: "POST", body: JSON.stringify({ cid: state.cid }) }).catch(() => {});
        localStorage.removeItem(LS_TOKEN);
        blocked("Отключено", "Чтобы подключиться снова, откройте закладку или отсканируйте QR-код.");
      }
    });

    $("editor").addEventListener("pointerdown", (e) => {
      const pickProduct = e.target.closest("[data-pick-product]");
      if (pickProduct) {
        e.preventDefault();
        const inp = document.querySelector('#editor-body [data-f="product"]');
        if (inp) {
          inp.value = pickProduct.textContent;
          inp.dispatchEvent(new Event("input", { bubbles: true }));
          inp.dispatchEvent(new Event("change", { bubbles: true }));
        }
        closeEdProductSuggest();
        return;
      }
      if (!e.target.closest('#editor-body [data-f="product"]') && !e.target.closest("#ed-product-suggest")) {
        closeEdProductSuggest();
      }
    });

    document.addEventListener("focusout", (e) => {
      if (!e.target.closest?.('#editor-body [data-f="product"]')) return;
      requestAnimationFrame(() => {
        if (document.activeElement?.closest?.("#ed-product-suggest, #editor-body [data-f='product']")) return;
        closeEdProductSuggest();
      });
    });

    $("editor").addEventListener("click", (e) => {
      if (e.target.closest("[data-close-editor]") || e.target.closest("#ed-done")) {
        closeEditor();
        return;
      }
      const order = currentOrder();
      const line = findLine(order, state.editLineId);
      if (!line) return;

      const taxMode_ = e.target.closest("[data-tax-mode]");
      if (taxMode_) {
        line.tax_mode = taxMode_.dataset.taxMode;
        if (line.tax_percent_expr == null) {
          line.tax_percent = 0;
          line.tax_percent_expr = "0";
        }
        touchDoc();
        pushSoon();
        renderEditor();
        renderOrder();
        return;
      }
      const disc = e.target.closest("[data-discount]");
      if (disc) {
        setLineNumber(line, "discount_expr", Number(disc.dataset.discount));
        touchDoc();
        pushSoon();
        renderEditor();
        refreshOrderRow(line.id);
        return;
      }
      const paid = e.target.closest("[data-paid]");
      if (paid) {
        const t = lineTotals(line);
        const value = paid.dataset.paid === "full" ? t.after : paid.dataset.paid === "half" ? round2(t.after / 2) : 0;
        setLineNumber(line, "paid_expr", value);
        if (paid.dataset.paid === "full") autoPaidStatus(line);
        touchDoc();
        pushSoon();
        renderEditor();
        refreshOrderRow(line.id);
        return;
      }
      const status = e.target.closest("[data-pick-status]");
      if (status) {
        line.status = status.dataset.pickStatus;
        document.querySelectorAll("[data-pick-status]").forEach((b) => b.classList.toggle("active", b === status));
        touchDoc();
        pushSoon();
        refreshOrderRow(line.id);
        return;
      }
      const now = e.target.closest("[data-now]");
      if (now) {
        line[now.dataset.now] = localStamp(new Date());
        const inp = document.querySelector(`input[data-l="${CSS.escape(line.id)}"][data-f="${now.dataset.now}"]`);
        if (inp) inp.value = line[now.dataset.now];
        touchDoc();
        pushSoon();
        return;
      }
      if (e.target.closest("#ed-prev")) {
        editorJump(-1);
        return;
      }
      if (e.target.closest("#ed-next")) {
        editorJump(1);
        return;
      }
      if (e.target.closest("#ed-freeze")) {
        line.frozen = !isFrozenLine(line);
        touchDoc();
        pushSoon();
        closeEditor();
        toast(line.frozen ? "Позиция заморожена" : "Позиция снова в заказе");
        return;
      }
      if (e.target.closest("#ed-dup")) {
        const copy = { ...line, id: uid(), frozen: false };
        const index = order.lines.findIndex((l) => l.id === line.id);
        order.lines.splice(index + 1, 0, copy);
        touchDoc();
        pushSoon();
        state.editLineId = copy.id;
        renderOrder();
        renderEditor();
        toast("Позиция продублирована");
        return;
      }
      if (e.target.closest("#ed-del")) {
        if ((order.lines || []).length <= 1) {
          toast("В заказе должна остаться хотя бы одна позиция");
          return;
        }
        if (!confirm("Удалить эту позицию?")) return;
        order.lines = order.lines.filter((l) => l.id !== line.id);
        touchDoc();
        pushSoon();
        closeEditor();
        toast("Позиция удалена");
      }
    });

    $("btn-add-order").addEventListener("click", () => {
      if (!state.doc) return;
      const order = emptyOrder();
      state.doc.orders = orders().concat([order]);
      touchDoc();
      pushSoon();
      state.headOpen = true;
      setView("order", order.id);
      toast("Заказ создан");
    });

    $("btn-add-line").addEventListener("click", () => {
      const order = currentOrder();
      if (!order) return;
      const line = emptyLine();
      order.lines = (order.lines || []).concat([line]);
      touchDoc();
      pushSoon();
      renderOrder();
      openEditor(line.id);
    });

    $("btn-add-cost")?.addEventListener("click", () => {
      const order = currentOrder();
      const type = typeNames("expense")[0];
      if (!order) return;
      if (!type) {
        toast("Отметьте тип заказа как налог или затрату на компьютере");
        return;
      }
      const line = resetExpenseLine(emptyLine());
      line.order_type = type;
      line.tax_mode = typeKind(type) === "tax" ? "gross" : "amount";
      line.price = 0;
      line.price_expr = "0";
      order.lines = (order.lines || []).concat([line]);
      touchDoc();
      pushSoon();
      renderOrder();
      openEditor(line.id);
    });

    $("btn-dup-order").addEventListener("click", () => {
      const order = currentOrder();
      if (!order) return;
      const copy = {
        ...JSON.parse(JSON.stringify(order)),
        id: uid(),
        number: nextOrderNumber(),
        created_at: localStamp(new Date()),
      };
      copy.lines = (copy.lines || []).map((l) => ({ ...l, id: uid() }));
      state.doc.orders = orders().concat([copy]);
      touchDoc();
      pushSoon();
      setView("order", copy.id);
      toast("Заказ скопирован");
    });

    $("btn-order-snapshot").addEventListener("click", () => {
      state.snap.orderId = state.orderId;
      state.snap.lines = null;
      state.snap.linesOpen = false;
      openSnapshot();
    });

    $("btn-del-order").addEventListener("click", () => {
      const order = currentOrder();
      if (!order) return;
      if (!confirm(`Удалить заказ ${order.number}?`)) return;
      state.doc.orders = orders().filter((o) => o.id !== order.id);
      touchDoc();
      pushSoon();
      setView("orders");
      toast("Заказ удалён");
    });

    $("btn-back").addEventListener("click", goBack);

    $("btn-sort").addEventListener("click", () => {
      openSheet("Сортировка заказов", SORT_OPTIONS, state.sort, (item) => {
        state.sort = item.value;
        renderOrders();
      });
    });

    $("btn-undo").addEventListener("click", async () => {
      setSync("warn", "отменяю на компьютере…");
      if (await command("undo")) state.history = { ...state.history, undo: false };
      updateHead();
    });

    $("btn-redo").addEventListener("click", async () => {
      setSync("warn", "возвращаю действие…");
      if (await command("redo")) state.history = { ...state.history, redo: false };
      updateHead();
    });

    $("btn-menu").addEventListener("click", openMenu);

    $("tabbar").addEventListener("click", (e) => {
      const btn = e.target.closest("[data-tab]");
      if (!btn) return;
      const tab = btn.dataset.tab;
      if (tab === "orders" && state.view === "order") return;
      if (tab === "files") refreshRecent();
      if (tab === "snapshot") rememberSnapReturn();
      else state.snapReturn = null;
      if (tab === "orders") {
        resumeOrdersTab();
        return;
      }
      setView(tab);
    });

    $("btn-retry").addEventListener("click", () => {
      unblocked();
      boot();
    });

    $("sheet").addEventListener("click", (e) => {
      if (e.target.closest("[data-close-sheet]")) {
        closeSheet();
        return;
      }
      const hist = e.target.closest("[data-history-id]");
      if (hist) {
        command("history_jump", { id: hist.dataset.historyId });
        return;
      }
      const menu = e.target.closest("[data-menu]");
      if (menu) {
        $("sheet")._menu?.(menu.dataset.menu);
        return;
      }
      const pick = e.target.closest("[data-pick]");
      if (pick) $("sheet")._pick?.(Number(pick.dataset.pick));
    });

    const onFullscreen = () => {
      if (state.view === "files") renderFiles();
      renderMenu();
    };
    document.addEventListener("fullscreenchange", onFullscreen);
    document.addEventListener("webkitfullscreenchange", onFullscreen);

    window.addEventListener("beforeunload", () => {
      if (state.pushTimer) {
        navigator.sendBeacon?.(
          `/api/remote/push?t=${encodeURIComponent(state.token)}`,
          new Blob([JSON.stringify({ document: state.doc, cid: state.cid })], { type: "application/json" })
        );
      }
    });
    window.addEventListener("pagehide", () => {
      if (!state.token || !state.cid || !state.stopped) return;
      navigator.sendBeacon?.(
        `/api/remote/leave?t=${encodeURIComponent(state.token)}`,
        new Blob([JSON.stringify({ cid: state.cid })], { type: "application/json" })
      );
    });

    window.addEventListener("resize", () => {
      if (state.view === "orders") tuneStatusDots();
    });

    document.addEventListener("visibilitychange", () => {
      if (!document.hidden && !state.stopped) {
        refreshRecent();
        navReport();
      }
    });
  }

  const savedTheme = localStorage.getItem(LS_THEME);
  document.documentElement.setAttribute(
    "data-theme",
    savedTheme || (window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light")
  );

  loadSnapPrefs();
  initTelegram();
  bind();
  boot();
})();
