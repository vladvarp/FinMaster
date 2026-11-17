(() => {
  "use strict";

  const MATH_MAX = 20;
  const LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  const OPS = [
    { id: "+", label: "+" },
    { id: "-", label: "−" },
    { id: "*", label: "×" },
    { id: "/", label: "÷" },
  ];

  const GROUP_COLORS = ["#14b8a6", "#0ea5e9", "#8b5cf6", "#f59e0b", "#f43f5e", "#22c55e", "#06b6d4", "#eab308", "#a855f7", "#fb7185", "#64748b", "#d946ef"];
  const DASH_PERIODS = [
    ["all", "Весь период"],
    ["today", "Сегодня"],
    ["week", "7 дней"],
    ["month", "Этот месяц"],
    ["year", "Этот год"],
    ["range", "Диапазон"],
  ];
  const DASH_PAY_FILTERS = [
    ["all", "Все"],
    ["debt", "С долгом"],
    ["paid", "Оплаченные"],
    ["month", "Этот месяц"],
    ["empty", "Без цены"],
  ];
  const DASH_PORTS = [
    { id: "orders", name: "Заказов" },
    { id: "lines", name: "Позиций" },
    { id: "quantity", name: "Количество" },
    { id: "after", name: "К оплате" },
    { id: "afterActive", name: "Без отмен" },
    { id: "paid", name: "Оплачено" },
    { id: "unpaid", name: "Долг" },
    { id: "total", name: "До скидки" },
    { id: "cost", name: "Расходы" },
    { id: "costCount", name: "Строк расхода" },
    { id: "net", name: "Чистыми" },
    { id: "paidShare", name: "% оплаты" },
    { id: "avgCheck", name: "Средний чек" },
    { id: "overdue", name: "Просрочено поз." },
    { id: "overdueSum", name: "Просроченный долг" },
    { id: "monthAfter", name: "Выручка месяца" },
    { id: "monthCost", name: "Расход месяца" },
    { id: "forecast", name: "Прогноз месяца" },
  ];
  const DASH_DEFAULT = ["orders", "quantity", "after", "paid", "unpaid"];
  const DASH_LEGACY_DEFAULT = ["orders", "after", "paid", "unpaid"];
  const FILTER_PORTS = ["orders", "lines", "quantity", "after", "paid", "unpaid", "cost", "net"];
  const presentValues = new Map();

  let api = null;
  const session = {
    bound: false,
    busy: false,
    selected: "",
    picked: null,
    selectedLink: "",
    linking: null,
    search: "",
    place: 0,
    connectAt: 0,
    tabDrag: "",
    tabMoved: false,
    moveChain: false,
    wireRoute: "curve",
    wireAvoid: false,
    wireSnap: false,
    mini: null,
    miniDrag: null,
    miniHidden: false,
    resize: null,
    folds: null,
    presentPanel: false,
    presentDrag: null,
    presentHover: "",
    teleportHover: "",
    searchOpen: false,
    jump: null,
    pendingFocus: null,
    presentListScroll: 0,
    filterMultiOpen: null,
    filterMultiLock: false,
    filterMultiScroll: 0,
    orderWritePending: false,
    planner: null,
  };

  function $(id) {
    return document.getElementById(id);
  }

  function esc(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function cssEsc(value) {
    const text = String(value ?? "");
    if (window.CSS && typeof window.CSS.escape === "function") return window.CSS.escape(text);
    return text.replace(/[^a-zA-Z0-9_-]/g, "\\$&");
  }

  function uid() {
    return api?.uid ? api.uid() : `id-${Date.now().toString(16)}-${Math.random().toString(16).slice(2)}`;
  }

  function ensureState() {
    const doc = api?.doc?.();
    if (!doc) return null;
    if (!doc.ui || typeof doc.ui !== "object") doc.ui = {};
    if (!doc.ui.calculator || typeof doc.ui.calculator !== "object") {
      doc.ui.calculator = { active: "", blueprints: [], folds: { nodes: true, schemes: true, orders: true } };
    }
    const calc = doc.ui.calculator;
    if (!Array.isArray(calc.blueprints)) calc.blueprints = [];
    if (!calc.folds || typeof calc.folds !== "object") calc.folds = { nodes: true, schemes: true, orders: true };
    if (!calc.blueprints.length) {
      const first = emptyBlueprint("Схема 1");
      calc.blueprints.push(first);
      calc.active = first.id;
    }
    if (!calc.blueprints.some((bp) => bp.id === calc.active)) calc.active = calc.blueprints[0].id;
    return calc;
  }

  function emptyBlueprint(name) {
    return { id: uid(), name: name || "Схема", x: 0, y: 0, zoom: 1, nodes: [], links: [] };
  }

  function activeBlueprint() {
    const calc = ensureState();
    if (!calc) return null;
    return calc.blueprints.find((bp) => bp.id === calc.active) || calc.blueprints[0] || null;
  }

  function dirty() {
    api?.markDirty?.("Калькулятор");
  }

  function dirtyLive() {
    api?.markDirty?.("Калькулятор", { history: false });
  }

  function fmt(value) {
    if (value == null || !Number.isFinite(value)) return "—";
    return api?.money ? api.money(value) : String(value);
  }

  function fmtShort(value) {
    if (value == null || !Number.isFinite(value)) return "—";
    return Number(value).toLocaleString("ru-RU", { maximumFractionDigits: 2 });
  }

  function fmtCopy(value) {
    if (value == null || !Number.isFinite(value)) return "";
    const n = Number(value);
    if (Number.isInteger(n)) return String(n);
    return String(Math.round(n * 100) / 100);
  }

  async function copyScreenText(text) {
    const raw = String(text || "").trim();
    if (!raw || raw === "—") return false;
    try {
      if (api?.copyText) await api.copyText(raw);
      else if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(raw);
      else {
        await fetch("/api/clipboard-text", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text: raw }),
        });
      }
      return true;
    } catch {
      return false;
    }
  }

  function screenHtml(value, tip) {
    const shown = fmtShort(value);
    const copy = fmtCopy(value);
    const canCopy = !!copy;
    return `<div class="calc-screen" title="${esc(tip || "Результат")}">
      <span class="calc-screen-val">${esc(shown)}</span>
      <button type="button" class="calc-screen-copy${canCopy ? "" : " is-off"}" data-copy="${esc(copy)}" title="Копировать" aria-label="Копировать"${canCopy ? "" : " disabled"}>
        <svg class="calc-screen-ico calc-screen-ico-copy" width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <rect x="8" y="8" width="12" height="12" rx="2" stroke="currentColor" stroke-width="1.8"/>
          <path d="M6 16V6a2 2 0 0 1 2-2h10" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
        </svg>
        <svg class="calc-screen-ico calc-screen-ico-ok" width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path d="M5 12.5 10 17.5 19 7" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
        <span class="calc-screen-copied">Скопировано</span>
      </button>
    </div>`;
  }

  function sanitizeFormulaExpr(raw) {
    let out = "";
    for (const ch of String(raw ?? "")) {
      if (ch >= "a" && ch <= "z") out += ch.toUpperCase();
      else if ((ch >= "A" && ch <= "Z") || (ch >= "0" && ch <= "9") || "+-*/().,= \t".includes(ch)) out += ch;
    }
    return out;
  }

  function tokenize(src) {
    const text = String(src || "").replace(/,/g, ".").replace(/\s+/g, "");
    const tokens = [];
    let i = 0;
    while (i < text.length) {
      const ch = text[i];
      if ("+-*/()=".includes(ch)) {
        tokens.push(ch);
        i += 1;
        continue;
      }
      if (/[0-9.]/.test(ch)) {
        let raw = "";
        while (i < text.length && /[0-9.]/.test(text[i])) raw += text[i++];
        const num = Number(raw);
        if (!Number.isFinite(num)) throw new Error("число");
        tokens.push({ n: num });
        continue;
      }
      if (/[A-Za-zА-Яа-я_]/.test(ch)) {
        let raw = "";
        while (i < text.length && /[A-Za-zА-Яа-я0-9_]/.test(text[i])) raw += text[i++];
        tokens.push({ id: raw });
        continue;
      }
      throw new Error("символ");
    }
    return tokens;
  }

  function splitAssign(src) {
    const text = String(src || "").trim();
    const eq = text.lastIndexOf("=");
    if (eq <= 0) return { expr: text, out: "" };
    return { expr: text.slice(0, eq).trim(), out: text.slice(eq + 1).trim() };
  }

  function evalExpr(src, vars) {
    const tokens = tokenize(src);
    let i = 0;
    const peek = () => tokens[i];
    const eat = (want) => {
      const tok = tokens[i];
      if (want && tok !== want) throw new Error("формула");
      i += 1;
      return tok;
    };
    function parsePrimary() {
      const tok = peek();
      if (!tok) throw new Error("формула");
      if (tok === "(") {
        eat("(");
        const value = parseAdd();
        eat(")");
        return value;
      }
      if (tok === "-") {
        eat("-");
        return -parsePrimary();
      }
      if (tok && typeof tok === "object" && "n" in tok) {
        eat();
        return tok.n;
      }
      if (tok && typeof tok === "object" && tok.id) {
        eat();
        const value = vars[tok.id];
        if (value == null || !Number.isFinite(value)) return 0;
        return value;
      }
      throw new Error("формула");
    }
    function parseMul() {
      let value = parsePrimary();
      while (peek() === "*" || peek() === "/") {
        const op = eat();
        const rhs = parsePrimary();
        value = op === "*" ? value * rhs : rhs === 0 ? NaN : value / rhs;
      }
      return value;
    }
    function parseAdd() {
      let value = parseMul();
      while (peek() === "+" || peek() === "-") {
        const op = eat();
        const rhs = parseMul();
        value = op === "+" ? value + rhs : value - rhs;
      }
      return value;
    }
    if (!tokens.length) return 0;
    const value = parseAdd();
    if (i !== tokens.length) throw new Error("формула");
    return value;
  }

  function mathShown(node, links) {
    const used = new Set((links || []).filter((link) => link.to === node.id).map((link) => link.toPort));
    let last = 0;
    for (let i = 1; i <= MATH_MAX; i += 1) {
      if (used.has(`in${i}`)) last = i;
    }
    if (!last) return 2;
    return Math.min(MATH_MAX, last < MATH_MAX ? last + 1 : MATH_MAX);
  }

  function orderLines(order) {
    return order?.lines || [];
  }

  function lineAmount(line, order) {
    const totals = api.lineTotals(line, order);
    if (!totals) return 0;
    return totals.expense ? totals.cost : totals.after;
  }

  function lineTone(line, order) {
    if (api.isFrozen?.(line)) return "frozen";
    const totals = api.lineTotals(line, order);
    if (totals?.kind === "tax") return "tax";
    if (totals?.kind === "cost") return "cost";
    return "income";
  }

  function lineFieldOptions(line, order) {
    if (!line) {
      return [
        { id: "qty", name: "количество" },
        { id: "price", name: "цена" },
        { id: "discount", name: "скидка" },
        { id: "paid", name: "оплачено" },
        { id: "unpaid", name: "не оплачено" },
      ];
    }
    const totals = api.lineTotals?.(line, order);
    if (totals?.expense) {
      if (totals.kind === "tax" && totals.mode && totals.mode !== "amount") {
        return [{ id: "percent", name: "процент" }];
      }
      return [
        { id: "qty", name: "количество" },
        { id: "price", name: "сумма за единицу" },
      ];
    }
    return [
      { id: "qty", name: "количество" },
      { id: "price", name: "цена" },
      { id: "discount", name: "скидка" },
      { id: "paid", name: "оплачено" },
      { id: "unpaid", name: "не оплачено" },
    ];
  }

  /** Поля, которые можно подать на вход ноды заказа (запись в строку). */
  function lineInputFieldOptions(line, order) {
    if (!line) {
      return [
        { id: "qty", name: "количество" },
        { id: "price", name: "цена" },
        { id: "discount", name: "скидка" },
        { id: "paid", name: "оплачено" },
      ];
    }
    const totals = api.lineTotals?.(line, order);
    if (totals?.expense) {
      if (totals.kind === "tax" && totals.mode && totals.mode !== "amount") {
        return [{ id: "percent", name: "процент" }];
      }
      return [
        { id: "qty", name: "количество" },
        { id: "price", name: "сумма за единицу" },
      ];
    }
    return [
      { id: "qty", name: "количество" },
      { id: "price", name: "цена" },
      { id: "discount", name: "скидка" },
      { id: "paid", name: "оплачено" },
    ];
  }

  function lineFieldLabel(line, order, fieldId) {
    const all = [...lineInputFieldOptions(line, order), ...lineFieldOptions(line, order)];
    return all.find((item) => item.id === fieldId)?.name || fieldId;
  }

  function lineFieldValue(line, order, field) {
    const totals = api.lineTotals(line, order) || {};
    if (field === "qty") return Number(api.qtyValue?.(line) ?? line.quantity) || 0;
    if (field === "price") return Number(api.lineUnitPrice?.(line) ?? line.price) || 0;
    if (field === "discount") return Number(totals.discount) || 0;
    if (field === "paid") return Number(totals.paid) || 0;
    if (field === "unpaid") return Number(totals.unpaid) || 0;
    if (field === "percent") return Number(totals.percent) || 0;
    return 0;
  }

  function lineInPortId(lineId, field) {
    return `in:line:${lineId}:${field}`;
  }

  function parseLinePort(portId) {
    const text = String(portId || "");
    const inn = text.match(/^in:line:([^:]+):([a-z]+)$/);
    if (inn) return { lineId: inn[1], field: inn[2] || "", input: true };
    const m = text.match(/^line:([^:]+)(?::([a-z]+))?$/);
    if (!m) return null;
    return { lineId: m[1], field: m[2] || "", input: false };
  }

  function fieldToExprKey(field) {
    if (field === "qty") return "qty_expr";
    if (field === "price") return "price_expr";
    if (field === "discount") return "discount_expr";
    if (field === "paid") return "paid_expr";
    if (field === "percent") return "tax_percent_expr";
    return "";
  }

  function exprKeyToField(fieldOrExpr) {
    if (fieldOrExpr === "qty_expr") return "qty";
    if (fieldOrExpr === "price_expr") return "price";
    if (fieldOrExpr === "discount_expr") return "discount";
    if (fieldOrExpr === "paid_expr") return "paid";
    if (fieldOrExpr === "tax_percent_expr") return "percent";
    return fieldOrExpr || "";
  }

  function formatCalcNumber(value) {
    if (!Number.isFinite(value)) return "";
    return value.toFixed(2).replace(/\.00$/, "").replace(/(\.\d)0$/, "$1");
  }

  /** Владелец входа поля заказа (по всем схемам). */
  function orderFieldOwner(orderId, lineId, field, exceptBpId, exceptNodeId) {
    const calc = ensureState();
    if (!calc || !orderId || !lineId || !field) return null;
    const want = lineInPortId(lineId, field);
    for (const bp of calc.blueprints || []) {
      if (exceptBpId && bp.id === exceptBpId) continue;
      const nodes = bp.nodes || [];
      for (const link of bp.links || []) {
        if (link.toPort !== want) continue;
        const dst = nodes.find((item) => item.id === link.to);
        if (!dst || dst.type !== "order" || dst.orderId !== orderId) continue;
        if (exceptNodeId && dst.id === exceptNodeId) continue;
        const src = nodes.find((item) => item.id === link.from);
        return { blueprint: bp, node: dst, link, source: src };
      }
    }
    return null;
  }

  function orderFieldOwnerReason(owner, line, order, field) {
    if (!owner) return "";
    const scheme = owner.blueprint?.name || "Схема";
    const fieldName = lineFieldLabel(line, order, field);
    const orderLabel = order?.number || order?.name || "заказ";
    let src = "связь";
    if (owner.source) {
      if (owner.source.type === "const") src = owner.source.note ? `Константа «${String(owner.source.note).split("\n")[0].slice(0, 40)}»` : "Константа";
      else if (owner.source.type === "math") src = `Оператор ${owner.source.op || ""}`.trim();
      else if (owner.source.type === "formula") src = "Формула";
      else if (owner.source.type === "percent") src = "Процент";
      else if (owner.source.type === "result") src = owner.source.name || "Результат";
      else if (owner.source.type === "order") {
        const other = api.findOrder(owner.source.orderId);
        src = `Заказ ${other?.number || "—"}`;
      } else if (owner.source.type === "filter") src = "Фильтр";
      else if (owner.source.type === "dashboard") src = "Дашборд";
      else if (owner.source.type === "planner") src = "Планировщик";
      else if (owner.source.type === "openings") src = "Проёмы";
      else if (owner.source.type === "electrics") src = "Электрика";
      else if (owner.source.type === "scheme") src = "Схема";
      else src = owner.source.type || "нода";
    }
    return `Поле «${fieldName}» занято схемой «${scheme}» · ${orderLabel} ← ${src}`;
  }

  /** Все занятые входы полей заказов — для блокировки ячеек в таблице. */
  function collectOrderFieldLocks() {
    const calc = ensureState();
    if (!calc) return [];
    const locks = [];
    for (const bp of calc.blueprints || []) {
      const nodes = bp.nodes || [];
      for (const link of bp.links || []) {
        const parsed = parseLinePort(link.toPort);
        if (!parsed?.input || !parsed.field) continue;
        const dst = nodes.find((item) => item.id === link.to);
        if (!dst || dst.type !== "order" || !dst.orderId) continue;
        const order = api.findOrder?.(dst.orderId);
        if (!order) continue;
        const line = (order.lines || []).find((item) => item.id === parsed.lineId);
        if (!line) continue;
        const src = nodes.find((item) => item.id === link.from);
        const owner = { blueprint: bp, node: dst, link, source: src };
        locks.push({
          orderId: dst.orderId,
          lineId: parsed.lineId,
          field: parsed.field,
          exprKey: fieldToExprKey(parsed.field),
          schemeId: bp.id,
          schemeName: bp.name || "Схема",
          reason: orderFieldOwnerReason(owner, line, order, parsed.field),
        });
      }
    }
    return locks;
  }

  /** Удалить ноды/связи калькулятора на заказ или одну позицию. */
  function pruneOrderCalcLinks(orderId, lineId) {
    const calc = ensureState();
    if (!calc || !orderId) return false;
    let changed = false;
    (calc.blueprints || []).forEach((bp) => {
      const orderNodeIds = new Set(
        (bp.nodes || []).filter((node) => node.type === "order" && node.orderId === orderId).map((node) => node.id)
      );
      if (!orderNodeIds.size) return;
      if (!lineId) {
        const beforeNodes = (bp.nodes || []).length;
        bp.nodes = (bp.nodes || []).filter((node) => !orderNodeIds.has(node.id));
        if (bp.nodes.length !== beforeNodes) changed = true;
        const beforeLinks = (bp.links || []).length;
        bp.links = (bp.links || []).filter((link) => !orderNodeIds.has(link.from) && !orderNodeIds.has(link.to));
        if ((bp.links || []).length !== beforeLinks) changed = true;
        return;
      }
      (bp.nodes || []).forEach((node) => {
        if (!orderNodeIds.has(node.id) || !node.openFields?.[lineId]) return;
        delete node.openFields[lineId];
        changed = true;
      });
      const beforeLinks = (bp.links || []).length;
      bp.links = (bp.links || []).filter((link) => {
        const touchesOrder = orderNodeIds.has(link.from) || orderNodeIds.has(link.to);
        if (!touchesOrder) return true;
        const to = parseLinePort(link.toPort);
        const from = parseLinePort(link.fromPort);
        if (to?.lineId === lineId || from?.lineId === lineId) return false;
        return true;
      });
      if ((bp.links || []).length !== beforeLinks) changed = true;
    });
    if (changed) dirty();
    return changed;
  }

  function typeLabel(name) {
    const text = String(name || "").trim();
    return text || "Без типа";
  }

  function typePortKey(name) {
    return encodeURIComponent(typeLabel(name));
  }

  function typePortId(name, field) {
    const key = typePortKey(name);
    return field ? `type:${key}:${field}` : `type:${key}`;
  }

  function parseTypePort(portId) {
    const text = String(portId || "");
    const m = text.match(/^type:([^:]+)(?::([a-z]+))?$/);
    if (!m) return null;
    let typeName = m[1];
    try {
      typeName = decodeURIComponent(m[1]);
    } catch {
      /* keep raw */
    }
    return { typeName, field: m[2] || "" };
  }

  function orderTypeNames(order) {
    const names = [];
    const seen = new Set();
    orderLines(order).forEach((line) => {
      const name = typeLabel(line.order_type);
      if (seen.has(name)) return;
      seen.add(name);
      names.push(name);
    });
    return names;
  }

  function linesOfType(order, typeName) {
    const want = typeLabel(typeName);
    return orderLines(order).filter((line) => typeLabel(line.order_type) === want);
  }

  function typeTone(order, typeName) {
    const lines = linesOfType(order, typeName);
    if (!lines.length) return "income";
    return lineTone(lines[0], order);
  }

  function typeAmount(order, typeName) {
    return linesOfType(order, typeName).reduce((sum, line) => sum + lineAmount(line, order), 0);
  }

  function typeFieldOptions(order, typeName) {
    const lines = linesOfType(order, typeName);
    if (!lines.length) return [];
    return lineFieldOptions(lines[0], order);
  }

  function typeFieldValue(order, typeName, field) {
    return linesOfType(order, typeName).reduce((sum, line) => sum + lineFieldValue(line, order, field), 0);
  }

  function openFieldsFor(node, lineId) {
    const map = node.openFields && typeof node.openFields === "object" ? node.openFields : {};
    return Array.isArray(map[lineId]) ? map[lineId].slice() : [];
  }

  function ensureOpenField(node, lineId, field) {
    if (!node.openFields || typeof node.openFields !== "object") node.openFields = {};
    const list = Array.isArray(node.openFields[lineId]) ? node.openFields[lineId] : [];
    if (!list.includes(field)) list.push(field);
    node.openFields[lineId] = list;
  }

  function dropOpenField(node, lineId, field) {
    if (!node?.openFields || !Array.isArray(node.openFields[lineId])) return;
    node.openFields[lineId] = node.openFields[lineId].filter((item) => item !== field);
    if (!node.openFields[lineId].length) delete node.openFields[lineId];
  }

  function openTypesFor(node) {
    const list = Array.isArray(node?.openTypes) ? node.openTypes : [];
    const out = [];
    const seen = new Set();
    list.forEach((item) => {
      const name = typeLabel(item);
      if (seen.has(name)) return;
      seen.add(name);
      out.push(name);
    });
    return out;
  }

  function ensureOpenType(node, typeName) {
    const name = typeLabel(typeName);
    const list = openTypesFor(node);
    if (!list.includes(name)) list.push(name);
    node.openTypes = list;
  }

  function dropOpenType(node, typeName) {
    const name = typeLabel(typeName);
    node.openTypes = openTypesFor(node).filter((item) => item !== name);
    if (node.openTypeFields && typeof node.openTypeFields === "object") delete node.openTypeFields[name];
  }

  function openTypeFieldsFor(node, typeName) {
    const map = node.openTypeFields && typeof node.openTypeFields === "object" ? node.openTypeFields : {};
    const list = map[typeLabel(typeName)];
    return Array.isArray(list) ? list.slice() : [];
  }

  function ensureOpenTypeField(node, typeName, field) {
    const name = typeLabel(typeName);
    if (!node.openTypeFields || typeof node.openTypeFields !== "object") node.openTypeFields = {};
    const list = Array.isArray(node.openTypeFields[name]) ? node.openTypeFields[name] : [];
    if (!list.includes(field)) list.push(field);
    node.openTypeFields[name] = list;
  }

  function dropOpenTypeField(node, typeName, field) {
    const name = typeLabel(typeName);
    if (!node?.openTypeFields || !Array.isArray(node.openTypeFields[name])) return;
    node.openTypeFields[name] = node.openTypeFields[name].filter((item) => item !== field);
    if (!node.openTypeFields[name].length) delete node.openTypeFields[name];
  }

  function linkedFromPorts(nodeId, links) {
    const set = new Set();
    (links || []).forEach((link) => {
      if (link.from === nodeId) set.add(link.fromPort);
    });
    return set;
  }

  function dashPortMeta(id) {
    return DASH_PORTS.find((item) => item.id === id) || { id, name: id };
  }

  function normalizeDashPorts(list) {
    const allowed = new Set(DASH_PORTS.map((item) => item.id));
    const source = Array.isArray(list) && list.length
      ? list
      : DASH_DEFAULT;
    const isLegacyDefault = source.length === DASH_LEGACY_DEFAULT.length
      && DASH_LEGACY_DEFAULT.every((id) => source.includes(id));
    const out = [];
    const seen = new Set();
    (isLegacyDefault ? DASH_DEFAULT : source).forEach((id) => {
      const key = String(id || "");
      if (!allowed.has(key) || seen.has(key)) return;
      seen.add(key);
      out.push(key);
    });
    return out.length ? out : DASH_DEFAULT.slice();
  }

  function openDashPorts(node) {
    return normalizeDashPorts(node?.openPorts);
  }

  function ensureDashPort(node, portId) {
    const list = openDashPorts(node);
    if (!list.includes(portId)) list.push(portId);
    node.openPorts = normalizeDashPorts(list);
  }

  function dropDashPort(node, portId) {
    node.openPorts = openDashPorts(node).filter((id) => id !== portId);
    if (!node.openPorts.length) node.openPorts = DASH_DEFAULT.slice();
  }

  const FILTER_MULTI_MAX = 48;
  const DASH_PAY_MULTI = DASH_PAY_FILTERS.filter(([id]) => id !== "all");

  function uniqueStrings(items) {
    const seen = new Set();
    const out = [];
    (items || []).forEach((item) => {
      const text = String(item || "").trim();
      if (!text || seen.has(text)) return;
      seen.add(text);
      out.push(text);
    });
    return out;
  }

  function filterList(node, key, legacyKey = "", { allowAll = false } = {}) {
    const raw = node?.[key];
    if (Array.isArray(raw)) {
      return uniqueStrings(raw)
        .filter((item) => allowAll || item !== "all")
        .slice(0, FILTER_MULTI_MAX);
    }
    const legacy = legacyKey ? node?.[legacyKey] : null;
    const text = String(legacy ?? "").trim();
    if (!text || (!allowAll && text === "all")) return [];
    return [text];
  }

  function normalizeFilterNode(node) {
    if (!node || (node.type !== "filter" && node.type !== "dashboard")) return node;
    node.customers = filterList(node, "customers", "customer");
    node.orderIds = filterList(node, "orderIds", "orderId");
    node.payFilters = filterList(node, "payFilters", "payFilter");
    node.payStatusFilters = filterList(node, "payStatusFilters");
    node.orderTypes = filterList(node, "orderTypes", "orderType");
    node.products = filterList(node, "products", "product");
    node.statuses = filterList(node, "statuses", "status");
    node.customer = "";
    node.orderId = "";
    node.payFilter = "all";
    node.status = "";
    node.orderType = "";
    node.product = "";
    return node;
  }

  function emptyFilterOpts() {
    return {
      customers: [],
      orderIds: [],
      period: "all",
      payFilters: [],
      payStatusFilters: [],
      statuses: [],
      orderTypes: [],
      products: [],
      dateFrom: "",
      dateTo: "",
    };
  }

  function filterOpts(node) {
    try {
      normalizeFilterNode(node);
      return {
        customers: Array.isArray(node.customers) ? node.customers.slice() : [],
        orderIds: Array.isArray(node.orderIds) ? node.orderIds.slice() : [],
        period: node?.period || "all",
        payFilters: Array.isArray(node.payFilters) ? node.payFilters.slice() : [],
        payStatusFilters: Array.isArray(node.payStatusFilters) ? node.payStatusFilters.slice() : [],
        statuses: Array.isArray(node.statuses) ? node.statuses.slice() : [],
        orderTypes: Array.isArray(node.orderTypes) ? node.orderTypes.slice() : [],
        products: Array.isArray(node.products) ? node.products.slice() : [],
        dateFrom: node?.dateFrom || "",
        dateTo: node?.dateTo || "",
      };
    } catch {
      return emptyFilterOpts();
    }
  }

  function dashStats(node) {
    try {
      return api?.calcStats?.(filterOpts(node)) || {};
    } catch (err) {
      console.warn("calc filter stats", err);
      return {};
    }
  }

  function loadFolds() {
    if (session.folds) return session.folds;
    const merged = {};
    const calc = ensureState();
    if (calc?.folds && typeof calc.folds === "object") {
      ["nodes", "schemes", "orders", "side"].forEach((key) => {
        if (typeof calc.folds[key] === "boolean") merged[key] = calc.folds[key];
      });
    }
    try {
      const raw = JSON.parse(localStorage.getItem("finmaster.calc.folds") || "{}") || {};
      ["nodes", "schemes", "orders", "side"].forEach((key) => {
        if (typeof raw[key] === "boolean") merged[key] = raw[key];
      });
    } catch {
      /* ignore */
    }
    session.folds = merged;
    return session.folds;
  }

  function foldOpen(key) {
    const folds = loadFolds();
    return folds[key] !== false;
  }

  function sideOpen() {
    try {
      const rail = localStorage.getItem("finmaster.calc.rail");
      if (rail === "0" || rail === "1") return rail === "1";
    } catch {
      /* ignore */
    }
    return foldOpen("side");
  }

  function setFold(key, open) {
    if (!key) return;
    const folds = loadFolds();
    folds[key] = !!open;
    session.folds = folds;
    try {
      localStorage.setItem("finmaster.calc.folds", JSON.stringify(folds));
      if (key === "side") localStorage.setItem("finmaster.calc.rail", open ? "1" : "0");
    } catch {
      /* ignore */
    }
    const calc = ensureState();
    if (calc) {
      calc.folds = {
        nodes: folds.nodes !== false,
        schemes: folds.schemes !== false,
        orders: folds.orders !== false,
        side: folds.side !== false,
      };
    }
  }

  function selectionIds() {
    if (!session.selected) return new Set();
    if (session.picked?.size && session.picked.has(session.selected)) return session.picked;
    return new Set([session.selected]);
  }

  function nodeSelected(id) {
    return !!id && selectionIds().has(id);
  }

  function selectNodes(ids, anchor) {
    const list = [...new Set((ids || []).filter(Boolean))];
    session.picked = new Set(list);
    session.selected = list.includes(anchor) ? anchor : list[0] || "";
    document.querySelectorAll("#calc-nodes .calc-node, #calc-groups .calc-node, #calc-group-ui .calc-group-chrome").forEach((el) => {
      el.classList.toggle("is-on", nodeSelected(el.dataset.node));
    });
  }

  function selectOnly(id) {
    selectNodes(id ? [id] : [], id || "");
  }

  function multiSummary(selected, emptyLabel = "Все") {
    if (!selected.length) return emptyLabel;
    if (selected.length === 1) return selected[0];
    return `${selected.length} выбр.`;
  }

  function multiPickHtml(nodeId, field, label, options, selected, opts = {}) {
    // Avoid destructuring `valueOf`/`toString` — they inherit from Object.prototype and break defaults.
    const getValue = typeof opts.getValue === "function" ? opts.getValue : (item) => item;
    const getLabel = typeof opts.getLabel === "function" ? opts.getLabel : (item) => item;
    const title = opts.title || "";
    const open = session.filterMultiOpen?.field === field && session.filterMultiOpen?.nodeId === nodeId;
    const list = Array.isArray(options) ? options : [];
    const picked = Array.isArray(selected) ? selected : [];
    const selectedSet = new Set(picked);
    const canClear = picked.length > 1;
    const summary = multiSummary(
      picked.map((id) => {
        const hit = list.find((item) => getValue(item) === id);
        return hit ? getLabel(hit) : id;
      })
    );
    return `<div class="calc-filter-row">
      <span>${esc(label)}</span>
      <div class="calc-multi-wrap${canClear ? " has-value" : ""}">
        <details class="calc-multi" data-filter-multi-field="${esc(field)}" ${open ? "open" : ""} title="${esc(title || label)}">
          <summary class="calc-multi-sum calc-filter-input">${esc(summary)}</summary>
          <div class="calc-multi-list">
            ${
              list.length
                ? list
                    .map((item) => {
                      const value = getValue(item);
                      const text = getLabel(item);
                      const on = selectedSet.has(value);
                      return `<label class="calc-multi-opt"><input type="checkbox" data-filter-multi="${esc(field)}" value="${esc(value)}" ${on ? "checked" : ""} /><span>${esc(text)}</span></label>`;
                    })
                    .join("")
                : `<div class="calc-multi-empty">Нет вариантов</div>`
            }
          </div>
        </details>
        ${
          canClear
            ? `<button type="button" class="search-clear" data-filter-multi-clear="${esc(field)}" title="Сбросить" aria-label="Сбросить выбор">×</button>`
            : ""
        }
      </div>
    </div>`;
  }

  function filterFieldsHtml(node) {
    try {
      normalizeFilterNode(node);
      const statuses = Array.isArray(api?.statuses?.()) ? api.statuses() : [];
      const types = Array.isArray(api?.orderTypes?.()) ? api.orderTypes() : [];
      const products = Array.isArray(api?.products?.()) ? api.products() : [];
      const customers = Array.isArray(api?.customers?.()) ? api.customers() : [];
      const selectedCustomers = Array.isArray(node.customers) ? node.customers : [];
      const customerKeys = new Set(selectedCustomers.map((name) => String(name || "").toLowerCase()));
      const orders = (api?.orders?.() || [])
        .map((order, index) => ({ order, index }))
        .filter(({ order }) => {
          if (!customerKeys.size) return true;
          return customerKeys.has(String(order.customer || "").toLowerCase());
        })
        .sort((a, b) => {
          const da = orderStamp(a.order);
          const db = orderStamp(b.order);
          if (db !== da) return db.localeCompare(da);
          return b.index - a.index;
        })
        .map((item) => item.order);
      const orderIds = (Array.isArray(node.orderIds) ? node.orderIds : []).filter((id) => orders.some((order) => order.id === id));
      if (orderIds.length !== (node.orderIds || []).length) node.orderIds = orderIds;
      const period = node.period || "all";
      const range = period === "range";
      const nid = node.id;
      return `<div class="calc-filter-fields">
      ${multiPickHtml(nid, "customers", "Заказчик", customers, selectedCustomers, { title: "Несколько заказчиков" })}
      ${multiPickHtml(nid, "orderIds", "Заказ", orders, orderIds, {
        getValue: (order) => order.id,
        getLabel: (order) => `${order.number || "—"} — ${order.name || order.customer || "Без названия"}`,
        title: "Несколько заказов",
      })}
      <label class="calc-filter-row">
        <span>Период</span>
        <select class="calc-filter-input" data-filter-field="period">
          ${DASH_PERIODS.map(([id, label]) => `<option value="${id}" ${period === id ? "selected" : ""}>${esc(label)}</option>`).join("")}
        </select>
      </label>
      <label class="calc-filter-row${range ? "" : " is-off"}">
        <span>С</span>
        <input class="calc-filter-input" type="date" data-filter-field="dateFrom" value="${esc(node.dateFrom || "")}" />
      </label>
      <label class="calc-filter-row${range ? "" : " is-off"}">
        <span>По</span>
        <input class="calc-filter-input" type="date" data-filter-field="dateTo" value="${esc(node.dateTo || "")}" />
      </label>
      ${multiPickHtml(
        nid,
        "payFilters",
        "Оплата заказа",
        DASH_PAY_MULTI.map(([id, label]) => ({ id, label })),
        Array.isArray(node.payFilters) ? node.payFilters : [],
        {
          getValue: (item) => item.id,
          getLabel: (item) => item.label,
          title: "Несколько фильтров оплаты",
        }
      )}
      ${node.type === "filter" ? multiPickHtml(nid, "payStatusFilters", "Статус оплаты", [
        { id: "paid", label: "Оплаченные" },
        { id: "unpaid", label: "Не оплаченные" },
      ], Array.isArray(node.payStatusFilters) ? node.payStatusFilters : [], {
        getValue: (item) => item.id,
        getLabel: (item) => item.label,
        title: "Оплаченные и неоплаченные единицы количества",
      }) : ""}
      ${multiPickHtml(nid, "orderTypes", "Тип", types, Array.isArray(node.orderTypes) ? node.orderTypes : [], { title: "Несколько типов" })}
      ${multiPickHtml(nid, "products", "Продукт", products, Array.isArray(node.products) ? node.products : [], { title: "Несколько продуктов" })}
      ${multiPickHtml(nid, "statuses", "Статус", statuses, Array.isArray(node.statuses) ? node.statuses : [], { title: "Несколько статусов" })}
    </div>`;
    } catch (err) {
      console.warn("calc filter fields", err);
      return `<div class="calc-filter-fields"><div class="calc-multi-empty">Не удалось показать фильтры</div></div>`;
    }
  }

  function statsPortsHtml(node, portIds, graph, tip) {
    const stats = dashStats(node);
    return portIds
      .map((id) => {
        const meta = dashPortMeta(id);
        const value = graph.values[`${node.id}:${id}`];
        const shown = value != null && Number.isFinite(value) ? value : stats[id];
        return `<div class="calc-row out">
          <span class="calc-row-name" title="${esc(tip || meta.name)}">${esc(meta.name)}</span>
          <b>${esc(fmtShort(shown))}</b>
          <i class="calc-port out" data-port="${esc(id)}" data-io="out" title="${esc(meta.name)}"></i>
        </div>`;
      })
      .join("");
  }

  function findBlueprint(id) {
    return (ensureState()?.blueprints || []).find((bp) => bp.id === id) || null;
  }

  function resultName(node) {
    return String(node?.name || "").trim() || "Результат";
  }

  function plannerName(node) {
    return String(node?.name || "").trim().slice(0, 48) || "Планировщик";
  }

  function resultPriority(node) {
    const n = Number(node?.priority);
    return Number.isFinite(n) ? n : 9999;
  }

  function resultVisible(node) {
    return node?.visible !== false;
  }

  function nextResultPriority(bp) {
    let max = 0;
    (bp?.nodes || []).forEach((node) => {
      if (node.type !== "result") return;
      const n = Number(node.priority);
      if (Number.isFinite(n) && n > max) max = n;
    });
    return max + 1;
  }

  function schemeOutputs(bp) {
    return (bp?.nodes || [])
      .filter((node) => node.type === "result" && resultVisible(node))
      .sort((a, b) => resultPriority(a) - resultPriority(b) || resultName(a).localeCompare(resultName(b), "ru"))
      .map((node) => ({
        id: `result:${node.id}`,
        name: resultName(node),
        resultId: node.id,
      }));
  }

  function pruneHiddenResultLinks(resultId) {
    const portId = `result:${resultId}`;
    (ensureState()?.blueprints || []).forEach((bp) => {
      bp.links = (bp.links || []).filter((link) => link.fromPort !== portId);
    });
  }

  function resultEyeIcon(on) {
    if (on) {
      return `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path d="M2.5 12s3.5-7 9.5-7 9.5 7 9.5 7-3.5 7-9.5 7-9.5-7-9.5-7z" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/>
        <circle cx="12" cy="12" r="3" stroke="currentColor" stroke-width="1.8"/>
      </svg>`;
    }
    return `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M3 3l18 18M10.6 10.7a2.8 2.8 0 0 0 3.7 3.7M9.5 5.3A10.7 10.7 0 0 1 12 5c6 0 9.5 7 9.5 7a16.6 16.6 0 0 1-3.2 3.8M6.2 6.3C4.1 7.8 2.5 12 2.5 12s3.5 7 9.5 7c1.2 0 2.3-.2 3.3-.6" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
    </svg>`;
  }

  function nodeInputs(node, links) {
    if (node.type === "math") {
      const n = mathShown(node, links);
      return Array.from({ length: n }, (_, i) => ({ id: `in${i + 1}`, name: String(i + 1) }));
    }
    if (node.type === "result") return [{ id: "in", name: "вход" }];
    if (node.type === "joint") return [{ id: "in", name: "вход" }];
    if (node.type === "teleport") return teleportEntries(node).map((port) => ({ id: teleportInId(node, port), name: "вход" }));
    if (node.type === "bus") return busLanes(node).map((lane) => ({ id: `in:${lane.id}`, name: "" }));
    if (node.type === "percent") return [
      { id: "in1", name: "число" },
      { id: "in2", name: "%" },
    ];
    if (node.type === "formula") return node.inputs || [];
    if (node.type === "present") return presentPorts(node);
    if (node.type === "openings") return openingInputs(node);
    if (node.type === "electrics") return electricInputs(node);
    if (node.type === "order") {
      const order = api.findOrder(node.orderId);
      const linkedIn = usedInputPorts(node.id, links || []);
      const linkedOut = linkedFromPorts(node.id, links || []);
      const ports = [];
      orderLines(order).forEach((line) => {
        const open = new Set(openFieldsFor(node, line.id));
        lineInputFieldOptions(line, order).forEach((field) => {
          const inId = lineInPortId(line.id, field.id);
          const outId = `line:${line.id}:${field.id}`;
          if (open.has(field.id) || linkedIn.has(inId) || linkedOut.has(outId)) {
            ports.push({
              id: inId,
              name: field.name,
              lineId: line.id,
              field: field.id,
            });
          }
        });
      });
      return ports;
    }
    return [];
  }

  function presentPorts(node) {
    const meta = window.FinPresent?.blockMeta?.(node.blockType || "metric");
    return (meta?.ports || []).map((port) => ({ id: port.id, name: port.name }));
  }

  function presentOwner(blockId, portId, exceptBpId) {
    const calc = ensureState();
    for (const bp of calc.blueprints || []) {
      if (exceptBpId && bp.id === exceptBpId) continue;
      const nodes = bp.nodes || [];
      for (const link of bp.links || []) {
        const dst = nodes.find((item) => item.id === link.to);
        if (!dst || dst.type !== "present" || dst.blockId !== blockId) continue;
        if (link.toPort !== portId) continue;
        return { blueprint: bp, node: dst, link };
      }
    }
    return null;
  }

  function presentUsage(blockId) {
    const calc = ensureState();
    const activeId = activeBlueprint()?.id || "";
    let onActive = 0;
    let onOther = 0;
    const otherNames = [];
    for (const bp of calc.blueprints || []) {
      const count = (bp.nodes || []).filter((node) => node.type === "present" && node.blockId === blockId).length;
      if (!count) continue;
      if (bp.id === activeId) onActive += count;
      else {
        onOther += count;
        if (bp.name) otherNames.push(bp.name);
      }
    }
    return { onActive, onOther, otherNames };
  }

  function setPresentHover(blockId) {
    session.presentHover = blockId || "";
    const host = nodesRoot();
    if (!host) return;
    host.querySelectorAll(".calc-node.is-present").forEach((el) => {
      const match = !!session.presentHover && el.dataset.presentBlockId === session.presentHover;
      el.classList.toggle("is-present-hl", match);
    });
  }

  function freePresentPort(blockId, portId) {
    const calc = ensureState();
    let changed = false;
    (calc.blueprints || []).forEach((bp) => {
      const before = (bp.links || []).length;
      bp.links = (bp.links || []).filter((link) => {
        const dst = (bp.nodes || []).find((item) => item.id === link.to);
        if (!dst || dst.type !== "present") return true;
        if (dst.blockId !== blockId || link.toPort !== portId) return true;
        return false;
      });
      if (bp.links.length !== before) changed = true;
    });
    if (changed) {
      dirty();
      render();
      renderPresentPanel();
    }
    return changed;
  }

  function removePresentBlockNodes(blockId) {
    if (!blockId) return false;
    const calc = ensureState();
    if (!calc) return false;
    let changed = false;
    (calc.blueprints || []).forEach((bp) => {
      const drop = new Set(
        (bp.nodes || []).filter((node) => node.type === "present" && node.blockId === blockId).map((node) => node.id)
      );
      if (!drop.size) return;
      bp.nodes = (bp.nodes || []).filter((node) => !drop.has(node.id));
      bp.links = (bp.links || []).filter((link) => !drop.has(link.from) && !drop.has(link.to));
      if (session.picked) drop.forEach((nid) => session.picked.delete(nid));
      if (session.selected && drop.has(session.selected)) session.selected = [...(session.picked || [])][0] || "";
      changed = true;
    });
    [...presentValues.keys()].forEach((key) => {
      if (key.startsWith(`${blockId}:`)) presentValues.delete(key);
    });
    if (changed) {
      dirty();
      if (api?.view?.() === "calculator") render();
      else renderPresentPanel();
    }
    return changed;
  }

  function nodeOutputs(node, order, links) {
    if (node.type === "math" || node.type === "result" || node.type === "percent" || node.type === "const" || node.type === "joint") return [{ id: "out", name: "out" }];
    if (node.type === "teleout") return (node.ports || []).map((port) => ({ id: `out:${port.id}`, name: "" }));
    if (node.type === "bus") return busLanes(node).map((lane) => ({ id: `out:${lane.id}`, name: "" }));
    if (node.type === "formula") return node.outputs || [];
    if (node.type === "scheme") return schemeOutputs(findBlueprint(node.blueprintId));
    if (node.type === "filter") {
      return FILTER_PORTS.map((id) => ({ id, name: dashPortMeta(id).name }));
    }
    if (node.type === "dashboard") {
      const open = new Set(openDashPorts(node));
      const linked = linkedFromPorts(node.id, links || []);
      return DASH_PORTS.filter((port) => open.has(port.id) || linked.has(port.id)).map((port) => ({
        id: port.id,
        name: port.name,
      }));
    }
    if (node.type === "planner") return plannerOutputs(node, links).map((port) => ({ id: port.id, name: port.name, signal: port.signal || "" }));
    if (node.type === "openings") return openingOutputs(node, activeBlueprint(), null, links);
    if (node.type === "electrics") return electricOutputs(node, activeBlueprint(), null, links);
    if (node.type === "order") {
      const found = order || api.findOrder(node.orderId);
      const lines = orderLines(found);
      const linked = linkedFromPorts(node.id, links);
      const linkedIn = usedInputPorts(node.id, links || []);
      const ports = [];
      lines.forEach((line) => {
        const tone = lineTone(line, found);
        ports.push({
          id: `line:${line.id}`,
          name: line.product || "Позиция",
          line,
          tone,
          child: false,
        });
        const fields = new Set(openFieldsFor(node, line.id));
        const shown = new Map();
        lineFieldOptions(line, found).forEach((field) => shown.set(field.id, field));
        lineInputFieldOptions(line, found).forEach((field) => {
          if (!shown.has(field.id)) shown.set(field.id, field);
        });
        shown.forEach((field, fieldId) => {
          const outId = `line:${line.id}:${fieldId}`;
          const inId = lineInPortId(line.id, fieldId);
          if (fields.has(fieldId) || linked.has(outId) || linkedIn.has(inId)) {
            ports.push({
              id: outId,
              name: field.name,
              line,
              tone,
              child: true,
              field: fieldId,
              hasInput: lineInputFieldOptions(line, found).some((item) => item.id === fieldId),
            });
          }
        });
      });
      const openTypes = new Set(openTypesFor(node));
      orderTypeNames(found).forEach((typeName) => {
        const portId = typePortId(typeName);
        const childLinked = typeFieldOptions(found, typeName).some((field) => linked.has(typePortId(typeName, field.id)));
        if (!openTypes.has(typeName) && !linked.has(portId) && !childLinked) return;
        const tone = typeTone(found, typeName);
        ports.push({
          id: portId,
          name: `Σ ${typeName}`,
          typeName,
          tone,
          child: false,
          kind: "type",
        });
        const typeFields = new Set(openTypeFieldsFor(node, typeName));
        typeFieldOptions(found, typeName).forEach((field) => {
          const fieldId = typePortId(typeName, field.id);
          if (typeFields.has(field.id) || linked.has(fieldId)) {
            ports.push({
              id: fieldId,
              name: field.name,
              typeName,
              tone,
              child: true,
              field: field.id,
              kind: "type",
            });
          }
        });
      });
      ports.push({ id: "total", name: "Итого", tone: "total", child: false });
      return ports;
    }
    return [];
  }

  function formulaFieldErrors(node) {
    const bad = new Set();
    const seen = new Map();
    const take = (letter, key) => {
      const name = String(letter || "").trim();
      if (!/^[A-Z]$/.test(name)) {
        bad.add(key);
        return;
      }
      if (seen.has(name)) {
        bad.add(key);
        bad.add(seen.get(name));
      } else seen.set(name, key);
    };
    for (const port of node.inputs || []) take(port.name, `in:${port.id}`);
    for (const port of node.outputs || []) {
      const name = String(port.name || "").trim();
      take(name, `out:${port.id}`);
      const raw = String(port.expr || "");
      const body = raw.includes("=") ? splitAssign(raw).expr : raw;
      const expr = sanitizeFormulaExpr(body);
      const parsed = splitAssign(raw.includes("=") ? raw : `${expr}=${name}`);
      if (parsed.out && parsed.out !== name) bad.add(`expr:${port.id}`);
      try {
        evalExpr(expr || "0", {});
      } catch {
        bad.add(`expr:${port.id}`);
      }
    }
    return bad;
  }

  function formulaConflict(node) {
    return formulaFieldErrors(node).size > 0;
  }

  function computeGraph(bp, stack) {
    const values = {};
    const errors = new Set();
    const fields = {};
    const nodes = bp.nodes || [];
    const links = bp.links || [];
    if ((stack || []).includes(bp.id)) {
      nodes.forEach((node) => errors.add(node.id));
      return { values, errors, fields };
    }
    const byId = Object.fromEntries(nodes.map((node) => [node.id, node]));
    const incoming = {};
    links.forEach((link) => {
      if (!incoming[link.to]) incoming[link.to] = [];
      incoming[link.to].push(link);
    });

    function setVal(nodeId, port, value) {
      values[`${nodeId}:${port}`] = Number.isFinite(value) ? value : null;
    }

    const visiting = new Set();
    const done = new Set();

    function walk(nodeId) {
      if (done.has(nodeId)) return;
      if (visiting.has(nodeId)) {
        errors.add(nodeId);
        return;
      }
      const node = byId[nodeId];
      if (!node) return;
      visiting.add(nodeId);
      (incoming[nodeId] || []).forEach((link) => walk(link.from));
      if (node.type === "order") {
        const order = api.findOrder(node.orderId);
        if (!order) errors.add(nodeId);
        else {
          // Сначала принимаем входы → пишем в строки заказа
          (incoming[nodeId] || []).forEach((link) => {
            const parsed = parseLinePort(link.toPort);
            if (!parsed?.input || !parsed.field) return;
            walk(link.from);
            const raw = values[`${link.from}:${link.fromPort}`];
            if (raw == null || !Number.isFinite(raw)) return;
            const line = orderLines(order).find((item) => item.id === parsed.lineId);
            if (!line) return;
            const inputMeta = lineInputFieldOptions(line, order).find((item) => item.id === parsed.field);
            if (!inputMeta) return;
            const exprKey = fieldToExprKey(parsed.field);
            if (!exprKey) return;
            const next = formatCalcNumber(raw);
            if (!next && next !== "0") return;
            const prev = line[exprKey] != null ? String(line[exprKey]).trim() : "";
            if (prev === next) return;
            line[exprKey] = next;
            const stored = Number(next) || 0;
            if (parsed.field === "qty") line.quantity = stored;
            if (parsed.field === "price") line.price = stored;
            if (parsed.field === "discount") line.discount = stored;
            if (parsed.field === "paid") line.paid = stored;
            if (parsed.field === "percent") line.tax_percent = stored;
            session.orderWritePending = true;
          });

          let total = 0;
          orderLines(order).forEach((line) => {
            const amount = lineAmount(line, order);
            setVal(nodeId, `line:${line.id}`, amount);
            total += amount;
            const shown = new Map();
            lineFieldOptions(line, order).forEach((field) => shown.set(field.id, field));
            lineInputFieldOptions(line, order).forEach((field) => {
              if (!shown.has(field.id)) shown.set(field.id, field);
            });
            shown.forEach((field, fieldId) => {
              setVal(nodeId, `line:${line.id}:${fieldId}`, lineFieldValue(line, order, fieldId));
              setVal(nodeId, lineInPortId(line.id, fieldId), lineFieldValue(line, order, fieldId));
            });
          });
          orderTypeNames(order).forEach((typeName) => {
            setVal(nodeId, typePortId(typeName), typeAmount(order, typeName));
            typeFieldOptions(order, typeName).forEach((field) => {
              setVal(nodeId, typePortId(typeName, field.id), typeFieldValue(order, typeName, field.id));
            });
          });
          const totals = api.orderTotals(order);
          setVal(nodeId, "total", totals?.after ?? total);
        }
      } else if (node.type === "math") {
        const ports = nodeInputs(node, links);
        const nums = [];
        ports.forEach((port) => {
          const link = (incoming[nodeId] || []).find((item) => item.toPort === port.id);
          if (!link) return;
          walk(link.from);
          const value = values[`${link.from}:${link.fromPort}`];
          if (value != null && Number.isFinite(value)) nums.push(value);
        });
        let result = null;
        if (nums.length) {
          if (node.op === "+") result = nums.reduce((a, b) => a + b, 0);
          else if (node.op === "-") result = nums.slice(1).reduce((a, b) => a - b, nums[0]);
          else if (node.op === "*") result = nums.reduce((a, b) => a * b, 1);
          else if (node.op === "/") {
            result = nums[0];
            for (let i = 1; i < nums.length; i += 1) {
              if (!nums[i]) {
                result = NaN;
                break;
              }
              result /= nums[i];
            }
          }
        } else result = 0;
        setVal(nodeId, "out", result);
      } else if (node.type === "percent") {
        const read = (portId) => {
          const link = (incoming[nodeId] || []).find((item) => item.toPort === portId);
          if (!link) return 0;
          walk(link.from);
          const found = values[`${link.from}:${link.fromPort}`];
          return found != null && Number.isFinite(found) ? found : 0;
        };
        setVal(nodeId, "out", (read("in1") * read("in2")) / 100);
      } else if (node.type === "const") {
        const value = Number(node.value);
        setVal(nodeId, "out", Number.isFinite(value) ? value : 0);
      } else if (node.type === "result") {
        const link = (incoming[nodeId] || []).find((item) => item.toPort === "in");
        let value = null;
        if (link) {
          walk(link.from);
          const found = values[`${link.from}:${link.fromPort}`];
          if (found != null && Number.isFinite(found)) value = found;
        }
        setVal(nodeId, "in", value);
        setVal(nodeId, "out", value);
      } else if (node.type === "joint") {
        const link = (incoming[nodeId] || []).find((item) => item.toPort === "in");
        if (link) {
          walk(link.from);
          const found = values[`${link.from}:${link.fromPort}`];
          setVal(nodeId, "in", found);
          setVal(nodeId, "out", found);
        }
      } else if (node.type === "teleport") {
        teleportEntries(node).forEach((port) => {
          const link = (incoming[nodeId] || []).find((item) => teleportLinkHits(node, port, item.toPort));
          if (!link) return;
          walk(link.from);
          const found = values[`${link.from}:${link.fromPort}`];
          setVal(nodeId, teleportInId(node, port), found);
          values[`${port.id}:out`] = found;
          if (port.id === node.id) setVal(nodeId, "out", found);
        });
      } else if (node.type === "teleout") {
        (node.ports || []).forEach((port) => {
          const host = teleportHost(bp, port.source);
          if (host) walk(host.id);
          setVal(nodeId, `out:${port.id}`, values[`${port.source}:out`]);
        });
      } else if (node.type === "bus") {
        busLanes(node).forEach((lane) => {
          const link = (incoming[nodeId] || []).find((item) => item.toPort === `in:${lane.id}`);
          if (!link) return;
          walk(link.from);
          const found = values[`${link.from}:${link.fromPort}`];
          setVal(nodeId, `in:${lane.id}`, found);
          setVal(nodeId, `out:${lane.id}`, found);
        });
      } else if (node.type === "formula") {
        const badFields = formulaFieldErrors(node);
        if (badFields.size) {
          errors.add(nodeId);
          fields[nodeId] = [...badFields];
        }
        const vars = {};
        (node.inputs || []).forEach((port) => {
          const link = (incoming[nodeId] || []).find((item) => item.toPort === port.id);
          let value = 0;
          if (link) {
            walk(link.from);
            const found = values[`${link.from}:${link.fromPort}`];
            if (found != null && Number.isFinite(found)) value = found;
          }
          vars[port.name] = value;
          vars[port.id] = value;
          setVal(nodeId, port.id, value);
        });
        (node.outputs || []).forEach((port) => {
          const raw = String(port.expr || "");
          const body = raw.includes("=") ? splitAssign(raw).expr : raw;
          const expr = sanitizeFormulaExpr(body);
          const outName = String(port.name || "").trim();
          try {
            const value = evalExpr(expr || "0", vars);
            setVal(nodeId, port.id, value);
            if (/^[A-Z]$/.test(outName) && value != null && Number.isFinite(value)) {
              vars[outName] = value;
            }
          } catch {
            errors.add(nodeId);
            if (!fields[nodeId]) fields[nodeId] = [];
            if (!fields[nodeId].includes(`expr:${port.id}`)) fields[nodeId].push(`expr:${port.id}`);
            setVal(nodeId, port.id, null);
          }
        });
      } else if (node.type === "scheme") {
        const other = findBlueprint(node.blueprintId);
        if (!other || other.id === bp.id || (stack || []).includes(other.id)) errors.add(nodeId);
        else {
          const inner = computeGraph(other, (stack || []).concat(bp.id));
          schemeOutputs(other).forEach((port) => {
            const value = inner.values[`${port.resultId}:out`];
            setVal(nodeId, port.id, value);
            if (inner.errors.has(port.resultId)) errors.add(nodeId);
          });
        }
      } else if (node.type === "filter" || node.type === "dashboard") {
        const stats = dashStats(node);
        const ports = node.type === "filter" ? FILTER_PORTS : openDashPorts(node);
        const linked = linkedFromPorts(nodeId, links);
        const ids = new Set(ports.concat([...linked].filter((id) => DASH_PORTS.some((p) => p.id === id))));
        ids.forEach((id) => {
          const value = Number(stats[id]);
          setVal(nodeId, id, Number.isFinite(value) ? value : 0);
        });
      } else if (node.type === "planner") {
        plannerOutputs(node, links).forEach((port) => {
          if (port.signal === "plan") return;
          setVal(nodeId, port.id, port.value ?? port.area);
        });
      } else if (node.type === "openings") {
        openingInputs(node).forEach((port) => {
          if (port.signal === "plan") return;
          const link = (incoming[nodeId] || []).find((item) => item.toPort === port.id);
          let value = null;
          if (link) {
            const found = values[`${link.from}:${link.fromPort}`];
            if (found != null && Number.isFinite(found)) value = found;
          }
          setVal(nodeId, port.id, value);
        });
        openingOutputs(node, bp, values, links).forEach((port) => {
          if (port.signal === "plan") return;
          setVal(nodeId, port.id, port.value);
        });
      } else if (node.type === "electrics") {
        electricOutputs(node, bp, values, links).forEach((port) => setVal(nodeId, port.id, port.value));
      } else if (node.type === "present") {
        presentPorts(node).forEach((port) => {
          const link = (incoming[nodeId] || []).find((item) => item.toPort === port.id);
          let value = null;
          if (link) {
            walk(link.from);
            const found = values[`${link.from}:${link.fromPort}`];
            if (found != null && Number.isFinite(found)) value = found;
          }
          setVal(nodeId, port.id, value);
          // Пишем только при наличии связи: иначе активная схема затирает значения других схем.
          if (node.blockId && link && value != null && Number.isFinite(value)) {
            const key = `${node.blockId}:${port.id}`;
            presentValues.set(key, value);
            const found = window.FinPresent?.findBlock?.(node.blockId);
            if (found?.block) {
              if (!found.block.values || typeof found.block.values !== "object") found.block.values = {};
              found.block.values[port.id] = value;
            }
          }
        });
      }
      visiting.delete(nodeId);
      done.add(nodeId);
    }

    nodes.forEach((node) => walk(node.id));
    return { values, errors, fields };
  }

  function worldPoint(bp, clientX, clientY) {
    return screenToWorld(clientX, clientY, bp);
  }

  function applyWorld(bp) {
    const world = $("calc-world");
    if (!world || !bp) return;
    world.style.transform = `translate(${bp.x || 0}px, ${bp.y || 0}px) scale(${bp.zoom || 1})`;
    syncSnapGrid(bp);
  }

  function frameBlueprintPoint(bp, x, y) {
    const board = $("calc-board");
    if (!board || !bp) return false;
    const rect = board.getBoundingClientRect();
    if (rect.width < 80 || rect.height < 80) return false;
    const zoom = bp.zoom || 1;
    bp.x = Math.round(rect.width / 2 - x * zoom);
    bp.y = Math.round(rect.height / 2 - y * zoom);
    applyWorld(bp);
    return true;
  }

  function revealPendingFocus(bp) {
    const pending = session.pendingFocus;
    if (!pending || !bp) return;
    const node = (bp.nodes || []).find((item) => item.id === pending.nodeId);
    if (!node) {
      session.pendingFocus = null;
      return;
    }
    const el = findNodeEl(node.id);
    const at = el && pending.portId ? portWorld(el, pending.portId, "in", bp) : null;
    const size = nodeFootprint(node);
    const x = (node.x || 0) + size.w / 2;
    const y = at ? at.y : (node.y || 0) + size.h / 2;
    if (!frameBlueprintPoint(bp, x, y)) return;
    session.pendingFocus = null;
  }

  function formulaWidth(node) {
    const n = Number(node?.w);
    const raw = Number.isFinite(n) && n > 0 ? n : 360;
    return Math.max(280, Math.min(1200, Math.round(raw)));
  }

  function nodeFootprint(node) {
    const el = findNodeEl(node.id);
    if (el) return { w: Math.max(40, el.offsetWidth), h: Math.max(28, el.offsetHeight) };
    if (node.type === "formula") return { w: formulaWidth(node), h: 160 };
    if (node.type === "comment") return { w: 260, h: 150 };
    if (node.type === "joint") return { w: 36, h: 36 };
    if (node.type === "teleport") return { w: 220, h: 46 + Math.max(1, teleportEntries(node).length) * 28 };
    if (node.type === "teleout") return { w: 220, h: 46 + Math.max(1, (node.ports || []).length) * 28 };
    if (node.type === "bus") return { w: 220, h: 46 + busLanes(node).length * 28 };
    if (node.type === "order") return { w: 230, h: 140 };
    if (node.type === "scheme") return { w: 220, h: 100 };
    if (node.type === "result") return { w: 376, h: 120 };
    if (node.type === "filter" || node.type === "dashboard") return { w: 384, h: 420 };
    if (node.type === "planner") {
      const layouts = Array.isArray(node.layouts) && node.layouts.length ? node.layouts : [node];
      let n = layouts.length;
      layouts.forEach((layout) => {
        n += Array.isArray(layout.outs) ? layout.outs.filter((item) => item && item.on).length : 1;
        if (layout.heightOut) n += 1;
      });
      return { w: 300, h: 168 + n * 28 };
    }
    if (node.type === "openings" || node.type === "electrics") return { w: 300, h: 460 };
    if (node.type === "present") return { w: 220, h: 160 };
    if (node.type === "group") return { w: Math.max(160, node.w || 320), h: Math.max(120, node.h || 220) };
    return { w: 188, h: 120 };
  }

  function groupRect(node) {
    return {
      x: node.x || 0,
      y: node.y || 0,
      w: Math.max(160, Number(node.w) || 320),
      h: Math.max(120, Number(node.h) || 220),
    };
  }

  function nodeRect(node) {
    const size = nodeFootprint(node);
    return { x: node.x || 0, y: node.y || 0, w: size.w, h: size.h };
  }

  function overlapArea(a, b) {
    const x1 = Math.max(a.x, b.x);
    const y1 = Math.max(a.y, b.y);
    const x2 = Math.min(a.x + a.w, b.x + b.w);
    const y2 = Math.min(a.y + a.h, b.y + b.h);
    if (x2 <= x1 || y2 <= y1) return 0;
    return (x2 - x1) * (y2 - y1);
  }

  function nodesInsideGroup(bp, group, seen) {
    const visited = seen || new Set();
    if (!group || visited.has(group.id)) return [];
    visited.add(group.id);
    const gr = groupRect(group);
    const selfArea = gr.w * gr.h;
    const direct = (bp.nodes || []).filter((node) => {
      if (visited.has(node.id)) return false;
      // Не тянуть родительские/более крупные группы (их центр часто попадает внутрь вложенной)
      if (node.type === "group" && groupArea(node) >= selfArea) return false;
      const nr = nodeRect(node);
      const cx = nr.x + nr.w / 2;
      const cy = nr.y + nr.h / 2;
      return cx >= gr.x && cx <= gr.x + gr.w && cy >= gr.y && cy <= gr.y + gr.h;
    });
    const all = new Map();
    direct.forEach((node) => {
      all.set(node.id, node);
      if (node.type === "group") {
        nodesInsideGroup(bp, node, visited).forEach((child) => all.set(child.id, child));
      }
    });
    return [...all.values()];
  }

  function groupArea(node) {
    const gr = groupRect(node);
    return gr.w * gr.h;
  }

  function sortGroupsByArea(groups) {
    return [...groups].sort((a, b) => groupArea(b) - groupArea(a));
  }

  function containNodeInGroup(node, group) {
    const gr = groupRect(group);
    const size = nodeFootprint(node);
    const maxX = gr.x + Math.max(0, gr.w - size.w);
    const maxY = gr.y + Math.max(0, gr.h - size.h);
    node.x = Math.min(Math.max(node.x || 0, gr.x), maxX);
    node.y = Math.min(Math.max(node.y || 0, gr.y), maxY);
  }

  function pushNodeOutOfGroup(node, group) {
    const gr = groupRect(group);
    const nr = nodeRect(node);
    const overlap = overlapArea(nr, gr);
    if (overlap <= 0) return;
    const left = nr.x + nr.w - gr.x;
    const right = gr.x + gr.w - nr.x;
    const top = nr.y + nr.h - gr.y;
    const bottom = gr.y + gr.h - nr.y;
    const options = [
      { axis: "x", delta: -left },
      { axis: "x", delta: right },
      { axis: "y", delta: -top },
      { axis: "y", delta: bottom },
    ];
    options.sort((a, b) => Math.abs(a.delta) - Math.abs(b.delta));
    const best = options[0];
    if (best.axis === "x") node.x = (node.x || 0) + best.delta;
    else node.y = (node.y || 0) + best.delta;
  }

  function snapNodeToGroups(bp, node) {
    if (!bp || !node || node.type === "group") return false;
    const nr = nodeRect(node);
    const area = Math.max(1, nr.w * nr.h);
    let best = null;
    (bp.nodes || []).forEach((group) => {
      if (group.type !== "group") return;
      const gr = groupRect(group);
      const overlap = overlapArea(nr, gr);
      if (overlap <= 0) return;
      if (!best || overlap > best.overlap) best = { group, overlap, ratio: overlap / area };
    });
    if (!best) return false;
    if (best.ratio >= 0.5) containNodeInGroup(node, best.group);
    else pushNodeOutOfGroup(node, best.group);
    return true;
  }

  function nodesRoot() {
    return $("calc-nodes") || $("calc-world");
  }

  function groupsRoot() {
    return $("calc-groups");
  }

  function groupUiRoot() {
    return $("calc-group-ui");
  }

  function wireUiRoot() {
    return $("calc-wire-ui");
  }

  function findNodeEl(id) {
    const key = cssEsc(id);
    return (
      nodesRoot()?.querySelector(`[data-node="${key}"]`) ||
      groupsRoot()?.querySelector(`[data-node="${key}"]`) ||
      groupUiRoot()?.querySelector(`[data-node="${key}"]`) ||
      null
    );
  }

  function findGroupChrome(id) {
    return groupUiRoot()?.querySelector(`.calc-group-chrome[data-node="${cssEsc(id)}"]`) || null;
  }

  function applyNodeEl(node) {
    const el = groupsRoot()?.querySelector(`[data-node="${cssEsc(node.id)}"]`) || nodesRoot()?.querySelector(`[data-node="${cssEsc(node.id)}"]`);
    const chrome = node.type === "group" ? findGroupChrome(node.id) : null;
    if (el) {
      el.style.left = `${node.x || 0}px`;
      el.style.top = `${node.y || 0}px`;
      if (node.type === "group") {
        el.style.width = `${Math.max(160, node.w || 320)}px`;
        el.style.height = `${Math.max(120, node.h || 220)}px`;
      }
      if (node.type === "formula") el.style.width = `${formulaWidth(node)}px`;
    }
    if (chrome) {
      chrome.style.left = `${node.x || 0}px`;
      chrome.style.top = `${node.y || 0}px`;
      chrome.style.width = `${Math.max(160, node.w || 320)}px`;
      chrome.style.height = `${Math.max(120, node.h || 220)}px`;
    }
  }

  function miniNodeColor(node) {
    if (node?.type === "group") return String(node.color || "#14b8a6");
    const kind = wireKind(node);
    const map = {
      order: "#0d9488",
      math: "#f97316",
      formula: "#a855f7",
      percent: "#f43f5e",
      const: "#64748b",
      result: "#06b6d4",
      scheme: "#eab308",
      filter: "#0ea5e9",
      dashboard: "#14b8a6",
      planner: "#65a30d",
      present: "#8b5cf6",
      group: "#94a3b8",
      comment: "#d4a017",
    };
    return map[kind] || "#0d9488";
  }

  function blueprintBounds(bp) {
    const nodes = bp?.nodes || [];
    if (!nodes.length) return { minX: -80, minY: -60, maxX: 320, maxY: 220, width: 400, height: 280 };
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    nodes.forEach((node) => {
      const size = nodeFootprint(node);
      minX = Math.min(minX, node.x || 0);
      minY = Math.min(minY, node.y || 0);
      maxX = Math.max(maxX, (node.x || 0) + size.w);
      maxY = Math.max(maxY, (node.y || 0) + size.h);
    });
    const pad = 80;
    minX -= pad;
    minY -= pad;
    maxX += pad;
    maxY += pad;
    return { minX, minY, maxX, maxY, width: Math.max(1, maxX - minX), height: Math.max(1, maxY - minY) };
  }

  function drawMinimap(bp) {
    const canvas = $("calc-minimap");
    const board = $("calc-board");
    const wrap = $("calc-mini-wrap");
    if (!canvas || !board || !bp) return;
    if (session.miniHidden) {
      wrap?.classList.add("is-hidden");
      board.classList.add("is-mini-hidden");
      return;
    }
    wrap?.classList.remove("is-hidden");
    board.classList.remove("is-mini-hidden");
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const cssW = 200;
    const cssH = 128;
    if (canvas.width !== Math.round(cssW * dpr) || canvas.height !== Math.round(cssH * dpr)) {
      canvas.width = Math.round(cssW * dpr);
      canvas.height = Math.round(cssH * dpr);
      canvas.style.width = `${cssW}px`;
      canvas.style.height = `${cssH}px`;
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const w = cssW;
    const h = cssH;
    const box = blueprintBounds(bp);
    const boardRect = board.getBoundingClientRect();
    const zoom = bp.zoom || 1;
    const view = {
      x: -(bp.x || 0) / zoom,
      y: -(bp.y || 0) / zoom,
      w: boardRect.width / zoom,
      h: boardRect.height / zoom,
    };
    const inset = 10;
    const scale = Math.min((w - inset * 2) / box.width, (h - inset * 2) / box.height);
    const ox = (w - box.width * scale) / 2 - box.minX * scale;
    const oy = (h - box.height * scale) / 2 - box.minY * scale;
    session.mini = { scale, ox, oy, w, h };

    const dark = document.documentElement.getAttribute("data-theme") === "dark";
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = dark ? "#0b1220" : "#eef3f8";
    ctx.fillRect(0, 0, w, h);

    const byId = Object.fromEntries((bp.nodes || []).map((node) => [node.id, node]));
    (bp.links || []).forEach((link) => {
      const a = byId[link.from];
      const b = byId[link.to];
      if (!a || !b) return;
      const as = nodeFootprint(a);
      const bs = nodeFootprint(b);
      ctx.strokeStyle = dark ? "rgba(148,163,184,0.35)" : "rgba(100,116,139,0.35)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo((a.x || 0) * scale + ox + (as.w * scale) / 2, (a.y || 0) * scale + oy + (as.h * scale) / 2);
      ctx.lineTo((b.x || 0) * scale + ox + (bs.w * scale) / 2, (b.y || 0) * scale + oy + (bs.h * scale) / 2);
      ctx.stroke();
    });

    (bp.nodes || [])
      .filter((node) => node.type === "group")
      .forEach((node) => {
        const gr = groupRect(node);
        const x = gr.x * scale + ox;
        const y = gr.y * scale + oy;
        const rw = Math.max(6, gr.w * scale);
        const rh = Math.max(5, gr.h * scale);
        ctx.fillStyle = miniNodeColor(node);
        ctx.globalAlpha = 0.22;
        ctx.fillRect(x, y, rw, rh);
        ctx.globalAlpha = 0.7;
        ctx.strokeStyle = miniNodeColor(node);
        ctx.lineWidth = 1;
        ctx.strokeRect(x, y, rw, rh);
        ctx.globalAlpha = 1;
      });

    (bp.nodes || [])
      .filter((node) => node.type !== "group")
      .forEach((node) => {
      const size = nodeFootprint(node);
      const x = (node.x || 0) * scale + ox;
      const y = (node.y || 0) * scale + oy;
      const rw = Math.max(4, size.w * scale);
      const rh = Math.max(3, size.h * scale);
      ctx.fillStyle = miniNodeColor(node);
      ctx.globalAlpha = nodeSelected(node.id) ? 1 : 0.85;
      ctx.beginPath();
      const r = 2;
      ctx.moveTo(x + r, y);
      ctx.arcTo(x + rw, y, x + rw, y + rh, r);
      ctx.arcTo(x + rw, y + rh, x, y + rh, r);
      ctx.arcTo(x, y + rh, x, y, r);
      ctx.arcTo(x, y, x + rw, y, r);
      ctx.closePath();
      ctx.fill();
      if (nodeSelected(node.id)) {
        ctx.strokeStyle = dark ? "#f8fafc" : "#0f172a";
        ctx.lineWidth = 1.2;
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
    });

    ctx.strokeStyle = "#14b8a6";
    ctx.lineWidth = 1.4;
    ctx.strokeRect(view.x * scale + ox, view.y * scale + oy, Math.max(8, view.w * scale), Math.max(8, view.h * scale));
    ctx.fillStyle = "rgba(20, 184, 166, 0.12)";
    ctx.fillRect(view.x * scale + ox, view.y * scale + oy, Math.max(8, view.w * scale), Math.max(8, view.h * scale));
  }

  function miniWorldPoint(clientX, clientY) {
    const canvas = $("calc-minimap");
    const map = session.mini;
    if (!canvas || !map) return null;
    const rect = canvas.getBoundingClientRect();
    const sx = ((clientX - rect.left) / rect.width) * map.w;
    const sy = ((clientY - rect.top) / rect.height) * map.h;
    return {
      x: (sx - map.ox) / map.scale,
      y: (sy - map.oy) / map.scale,
    };
  }

  function centerViewOn(bp, worldX, worldY) {
    const board = $("calc-board");
    if (!board || !bp) return;
    const rect = board.getBoundingClientRect();
    const zoom = bp.zoom || 1;
    bp.x = rect.width / 2 - worldX * zoom;
    bp.y = rect.height / 2 - worldY * zoom;
    applyWorld(bp);
    drawMinimap(bp);
  }

  function nextLetter(used) {
    for (const letter of LETTERS) {
      if (!used.has(letter)) return letter;
    }
    return "";
  }

  function nextName(used) {
    for (const letter of LETTERS) {
      if (!used.has(letter)) return letter;
    }
    let i = used.size + 1;
    while (used.has(`P${i}`)) i += 1;
    return `P${i}`;
  }

  function formulaLetterSet(node, exceptId) {
    const used = new Set();
    for (const port of node.inputs || []) {
      if (exceptId && port.id === exceptId) continue;
      const name = String(port.name || "").trim();
      if (name) used.add(name);
    }
    for (const port of node.outputs || []) {
      if (exceptId && port.id === exceptId) continue;
      const name = String(port.name || "").trim();
      if (name) used.add(name);
    }
    return used;
  }

  function sanitizeFormulaInput(raw, used, fallback) {
    const letter = String(raw || "")
      .trim()
      .toUpperCase()
      .replace(/[^A-Z]/g, "")
      .slice(0, 1);
    if (letter && !used.has(letter)) return letter;
    return fallback || nextLetter(used) || "A";
  }

  function parseConstValue(raw) {
    const text = String(raw ?? "").replace(",", ".").trim();
    if (!text) return 0;
    const value = Number(text);
    return Number.isFinite(value) ? value : 0;
  }


/* bundle-seam */
})();
