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
    selectedLink: "",
    linking: null,
    search: "",
    place: 0,
    connectAt: 0,
    tabDrag: "",
    tabMoved: false,
    moveChain: false,
    mini: null,
    miniDrag: null,
    miniHidden: false,
    resize: null,
    folds: null,
    presentPanel: false,
    presentDrag: null,
    presentHover: "",
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
    const rounded = Math.round(value * 1e6) / 1e6;
    if (Number.isInteger(rounded)) return String(rounded);
    return String(rounded).replace(/\.?0+$/, "");
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
      ["nodes", "schemes", "orders"].forEach((key) => {
        if (typeof calc.folds[key] === "boolean") merged[key] = calc.folds[key];
      });
    }
    try {
      const raw = JSON.parse(localStorage.getItem("finmaster.calc.folds") || "{}") || {};
      ["nodes", "schemes", "orders"].forEach((key) => {
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

  function setFold(key, open) {
    if (!key) return;
    const folds = loadFolds();
    folds[key] = !!open;
    session.folds = folds;
    try {
      localStorage.setItem("finmaster.calc.folds", JSON.stringify(folds));
    } catch {
      /* ignore */
    }
    const calc = ensureState();
    if (calc) {
      calc.folds = {
        nodes: folds.nodes !== false,
        schemes: folds.schemes !== false,
        orders: folds.orders !== false,
      };
    }
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
    if (node.type === "percent") return [
      { id: "in1", name: "число" },
      { id: "in2", name: "%" },
    ];
    if (node.type === "formula") return node.inputs || [];
    if (node.type === "present") return presentPorts(node);
    if (node.type === "openings") return openingInputs(node);
    if (node.type === "electrics") return [{ id: "plan", name: "Чертёж", signal: "plan" }];
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
      if (session.selected && drop.has(session.selected)) session.selected = "";
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
    if (node.type === "math" || node.type === "result" || node.type === "percent" || node.type === "const") return [{ id: "out", name: "out" }];
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
            if (parsed.field === "qty") line.quantity = Number(raw) || 0;
            if (parsed.field === "price") line.price = Number(raw) || 0;
            if (parsed.field === "discount") line.discount = Number(raw) || 0;
            if (parsed.field === "paid") line.paid = Number(raw) || 0;
            if (parsed.field === "percent") line.tax_percent = Number(raw) || 0;
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
      ctx.globalAlpha = session.selected === node.id ? 1 : 0.85;
      ctx.beginPath();
      const r = 2;
      ctx.moveTo(x + r, y);
      ctx.arcTo(x + rw, y, x + rw, y + rh, r);
      ctx.arcTo(x + rw, y + rh, x, y + rh, r);
      ctx.arcTo(x, y + rh, x, y, r);
      ctx.arcTo(x, y, x + rw, y, r);
      ctx.closePath();
      ctx.fill();
      if (session.selected === node.id) {
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

  const PLANNER_MAX_PTS = 24;
  const PLANNER_MAX_SUMS = 8;
  const PLANNER_MAX_LAYOUTS = 12;
  let plannerClip = null;

  function plannerRound(n) {
    return Math.round(Number(n) * 10000) / 10000;
  }

  function plannerNum(value, fallback) {
    const n = typeof value === "number" ? value : Number(String(value ?? "").replace(",", ".").trim());
    return Number.isFinite(n) ? n : fallback;
  }

  function plannerClamp(n, lo, hi) {
    return Math.max(lo, Math.min(hi, n));
  }

  function plannerDraft(text) {
    const raw = String(text ?? "").trim().replace(",", ".");
    if (!raw || raw === "-" || raw.endsWith(".")) return null;
    const n = Number(raw);
    return Number.isFinite(n) ? n : null;
  }

  function plannerInput(n) {
    const r = plannerRound(n);
    if (!Number.isFinite(r)) return "";
    if (Number.isInteger(r)) return String(r);
    return String(r).replace(".", ",");
  }

  function plannerArea(points) {
    let sum = 0;
    for (let i = 0; i < points.length; i += 1) {
      const a = points[i];
      const b = points[(i + 1) % points.length];
      sum += a.x * b.y - b.x * a.y;
    }
    return Math.abs(sum) / 2;
  }

  function plannerCentroid(points) {
    let x = 0;
    let y = 0;
    let a = 0;
    for (let i = 0; i < points.length; i += 1) {
      const p = points[i];
      const q = points[(i + 1) % points.length];
      const cross = p.x * q.y - q.x * p.y;
      a += cross;
      x += (p.x + q.x) * cross;
      y += (p.y + q.y) * cross;
    }
    if (Math.abs(a) < 1e-8) {
      return {
        x: points.reduce((s, p) => s + p.x, 0) / points.length,
        y: points.reduce((s, p) => s + p.y, 0) / points.length,
      };
    }
    return { x: x / (3 * a), y: y / (3 * a) };
  }

  function plannerWalls(node) {
    const pts = node.points || [];
    return pts.map((p, i) => {
      const q = pts[(i + 1) % pts.length];
      return { id: `w:${p.id}`, index: i, a: p, b: q, len: Math.hypot(q.x - p.x, q.y - p.y) };
    });
  }

  function plannerAutoName(name) {
    return /^Стена \d+$/.test(String(name || "").trim());
  }

  function plannerWallName(out, index) {
    const name = String(out?.name || "").trim();
    if (!name || plannerAutoName(name)) return `Стена ${index + 1}`;
    return name;
  }

  function plannerRect(points) {
    if (!points || points.length !== 4) return null;
    const eps = 0.001;
    for (let i = 0; i < 4; i += 1) {
      const a = points[i];
      const b = points[(i + 1) % 4];
      const dx = Math.abs(b.x - a.x);
      const dy = Math.abs(b.y - a.y);
      if ((dx > eps && dy > eps) || (dx <= eps && dy <= eps)) return null;
    }
    const xs = points.map((p) => p.x);
    const ys = points.map((p) => p.y);
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys);
    if (maxX - minX < 0.05 || maxY - minY < 0.05) return null;
    return { w: maxX - minX, d: maxY - minY, minX, maxX, minY, maxY };
  }

  function plannerLayoutColor(layouts) {
    const used = new Set((layouts || []).map((item) => String(item?.color || "").toLowerCase()));
    const start = (layouts || []).length % GROUP_COLORS.length;
    for (let i = 0; i < GROUP_COLORS.length; i += 1) {
      const color = GROUP_COLORS[(start + i) % GROUP_COLORS.length];
      if (!used.has(color)) return color;
    }
    return GROUP_COLORS[Math.floor(Math.random() * GROUP_COLORS.length)];
  }

  function plannerPort(layout, kind) {
    if (layout?.legacy) return kind === "plan" ? "plan" : kind === "floor" ? "floor" : "height";
    return `${kind}:${layout?.id || ""}`;
  }

  function plannerLayoutName(layout, index) {
    const name = String(layout?.name || "").trim().slice(0, 48);
    return name || `Планировка ${(index || 0) + 1}`;
  }

  function plannerActive(node) {
    return (node?.layouts || []).find((item) => item.id === node.layoutId) || node?.layouts?.[0] || null;
  }

  function plannerRemember(node) {
    const layout = plannerActive(node);
    if (!layout) return;
    layout.points = node.points;
    layout.outs = node.outs;
    layout.height = node.height;
    layout.heightOut = !!node.heightOut;
    layout.color = node.color;
  }

  function plannerApply(node, layout) {
    if (!layout) return;
    node.layoutId = layout.id;
    node.points = layout.points;
    node.outs = layout.outs;
    node.height = layout.height;
    node.heightOut = !!layout.heightOut;
    node.color = layout.color;
  }

  function plannerNormalize(layout, index) {
    if (!layout) return layout;
    if (!Array.isArray(layout.points)) layout.points = [];
    const seen = new Set();
    const points = [];
    layout.points.forEach((p) => {
      if (!p || typeof p !== "object" || points.length >= PLANNER_MAX_PTS) return;
      let id = String(p.id || "").trim();
      if (!id || seen.has(id)) id = uid();
      const x = plannerNum(p.x, NaN);
      const y = plannerNum(p.y, NaN);
      if (!Number.isFinite(x) || !Number.isFinite(y)) return;
      seen.add(id);
      p.id = id;
      p.x = plannerRound(plannerClamp(x, -500, 500));
      p.y = plannerRound(plannerClamp(y, -500, 500));
      points.push(p);
    });
    if (points.length < 3) {
      layout.points = [
        { id: uid(), x: 0, y: 0 },
        { id: uid(), x: 4, y: 0 },
        { id: uid(), x: 4, y: 3 },
        { id: uid(), x: 0, y: 3 },
      ];
    } else layout.points = points;
    layout.height = plannerRound(plannerClamp(plannerNum(layout.height, 2.7), 0.2, 30));
    layout.heightOut = !!layout.heightOut;
    const rawColor = String(layout.color || "").trim().toLowerCase();
    layout.color = /^#[0-9a-f]{6}$/.test(rawColor) ? rawColor : plannerLayoutColor([]);
    layout.name = plannerLayoutName(layout, index);
    const floorId = plannerPort(layout, "floor");
    const fresh = !Array.isArray(layout.outs);
    const prev = fresh ? [] : layout.outs;
    const byId = new Map(prev.filter((item) => item && item.id).map((item) => [String(item.id), item]));
    const walls = plannerWalls(layout);
    const wallIds = new Set(walls.map((wall) => wall.id));
    const floor = byId.get(floorId) || prev.find((item) => item && item.kind === "floor");
    const outs = [{ id: floorId, kind: "floor", name: "Пол", on: floor ? floor.on !== false : true }];
    walls.forEach((wall) => {
      const old = byId.get(wall.id);
      const name = String(old?.name || "").trim();
      outs.push({
        id: wall.id,
        kind: "wall",
        name: name && !plannerAutoName(name) ? name.slice(0, 48) : "",
        on: old ? !!old.on : false,
        pogonazh: !!old?.pogonazh,
        pogonazhAxis: old?.pogonazhAxis === "length" ? "length" : "height",
      });
    });
    const sums = prev.filter((item) => item && item.kind === "sum").slice(0, PLANNER_MAX_SUMS);
    if (fresh) {
      sums.push({ id: uid(), kind: "sum", name: "Стены", on: true, parts: walls.map((wall) => wall.id) });
    }
    const used = new Set(outs.map((item) => item.id));
    sums.forEach((item) => {
      let id = String(item.id || "").trim();
      if (!id || used.has(id)) id = uid();
      used.add(id);
      const parts = [];
      const seenParts = new Set();
      (Array.isArray(item.parts) ? item.parts : []).forEach((part) => {
        let key = String(part || "");
        if (key === "floor" || key.startsWith("floor:")) key = floorId;
        if (seenParts.has(key) || (key !== floorId && !wallIds.has(key))) return;
        seenParts.add(key);
        parts.push(key);
      });
      outs.push({
        id,
        kind: "sum",
        name: String(item.name || "").trim().slice(0, 48) || "Сумма",
        on: !!item.on,
        parts,
      });
    });
    layout.outs = outs;
    return layout;
  }

  function ensurePlanner(node) {
    if (!node || node.type !== "planner") return node;
    if (!Array.isArray(node.layouts) || !node.layouts.length) {
      const id = uid();
      const named = plannerName(node);
      node.layouts = [{
        id,
        legacy: true,
        name: named === "Планировщик" ? "Планировка 1" : named,
        color: node.color,
        points: node.points,
        outs: node.outs,
        height: node.height,
        heightOut: node.heightOut,
      }];
      node.layoutId = id;
    } else plannerRemember(node);
    node.layouts.forEach((layout, index) => plannerNormalize(layout, index));
    plannerApply(node, plannerActive(node));
    return node;
  }

  function plannerUseLayout(node, id) {
    ensurePlanner(node);
    const layout = (node.layouts || []).find((item) => item.id === id);
    if (!layout || layout.id === node.layoutId) return false;
    plannerRemember(node);
    plannerApply(node, layout);
    return true;
  }

  function plannerRemoveLayout(node, id) {
    ensurePlanner(node);
    if (node.layouts.length <= 1) {
      api?.toast?.("Нельзя удалить последнюю планировку");
      return false;
    }
    const index = node.layouts.findIndex((item) => item.id === id);
    if (index < 0) return false;
    plannerRemember(node);
    const [removed] = node.layouts.splice(index, 1);
    const outputIds = new Set([
      plannerPort(removed, "plan"),
      plannerPort(removed, "floor"),
      plannerPort(removed, "height"),
      ...(removed.outs || []).map((item) => item.id),
    ]);
    const bp = activeBlueprint();
    if (bp) {
      bp.links = (bp.links || []).filter(
        (link) => !(link.from === node.id && outputIds.has(link.fromPort))
      );
    }
    if (node.layoutId === id) {
      const next = node.layouts[Math.min(index, node.layouts.length - 1)] || node.layouts[0];
      plannerApply(node, next);
    }
    return true;
  }

  function plannerAddLayout(node) {
    ensurePlanner(node);
    if (node.layouts.length >= PLANNER_MAX_LAYOUTS) return null;
    const ids = [uid(), uid(), uid(), uid()];
    const layout = {
      id: uid(),
      legacy: false,
      name: `Планировка ${node.layouts.length + 1}`,
      color: plannerLayoutColor(node.layouts),
      height: 2.7,
      heightOut: false,
      points: [
        { id: ids[0], x: 0, y: 0 },
        { id: ids[1], x: 4, y: 0 },
        { id: ids[2], x: 4, y: 3 },
        { id: ids[3], x: 0, y: 3 },
      ],
    };
    node.layouts.push(layout);
    plannerNormalize(layout, node.layouts.length - 1);
    plannerApply(node, layout);
    return layout;
  }

  function plannerModel(node) {
    if (node?.type === "planner") ensurePlanner(node);
    const walls = plannerWalls(node);
    const floor = plannerArea(node.points);
    const height = node.height;
    const outById = Object.fromEntries((node.outs || []).map((item) => [item.id, item]));
    const floorOut = (node.outs || []).find((item) => item.kind === "floor");
    const floorId = floorOut?.id || "floor";
    const rows = [{ id: floorId, kind: "floor", name: "Пол", area: floor, on: !!outById[floorId]?.on }];
    walls.forEach((wall, index) => {
      const out = outById[wall.id];
      rows.push({
        id: wall.id,
        kind: "wall",
        name: plannerWallName(out, index),
        len: wall.len,
        area: wall.len * height,
        value: out?.pogonazh ? (out.pogonazhAxis === "length" ? wall.len : height) : wall.len * height,
        unit: out?.pogonazh ? "м" : "м²",
        pogonazh: !!out?.pogonazh,
        pogonazhAxis: out?.pogonazhAxis === "length" ? "length" : "height",
        on: !!out?.on,
        index,
      });
    });
    const rowById = new Map(rows.map((row) => [row.id, row]));
    const sums = (node.outs || [])
      .filter((item) => item.kind === "sum")
      .map((item) => {
        const selected = (item.parts || []).map((id) => rowById.get(id)).filter(Boolean);
        const units = [...new Set(selected.map((row) => row.unit || "м²"))];
        return {
          id: item.id,
          kind: "sum",
          name: item.name || "Сумма",
          on: !!item.on,
          parts: item.parts || [],
          area: selected.reduce((sum, row) => sum + row.area, 0),
          value: selected.reduce((sum, row) => sum + (row.value ?? row.area), 0),
          unit: units.length > 1 ? units.join(" / ") : (units[0] || "м²"),
        };
      });
    return { floor, height, walls, rows, sums, peri: walls.reduce((sum, wall) => sum + wall.len, 0) };
  }

  function plannerOutputs(node, links) {
    ensurePlanner(node);
    const linked = linkedFromPorts(node.id, links || []);
    const ports = [];
    (node.layouts || []).forEach((layout) => {
      const model = plannerModel(layout);
      ports.push({ id: plannerPort(layout, "plan"), name: layout.name, signal: "plan", layoutId: layout.id });
      model.rows.concat(model.sums).forEach((row) => {
        if (row.on || linked.has(row.id)) ports.push({ id: row.id, name: row.name, value: row.value ?? row.area, unit: row.unit || "м²", layoutId: layout.id });
      });
      const heightId = plannerPort(layout, "height");
      if (layout.heightOut || linked.has(heightId)) ports.push({ id: heightId, name: "Высота стен", value: model.height, unit: "м", layoutId: layout.id });
    });
    return ports;
  }

  function plannerDropPorts(node, ids) {
    const bp = activeBlueprint();
    if (!bp || !ids?.length) return;
    const drop = new Set(ids);
    bp.links = (bp.links || []).filter((link) => !(link.from === node.id && drop.has(link.fromPort)));
  }

  function plannerSumNote(parts, wallCount) {
    const floor = (parts || []).some((id) => id === "floor" || String(id).startsWith("floor:"));
    const walls = parts.filter((id) => String(id).startsWith("w:")).length;
    const bits = [];
    if (floor) bits.push("пол");
    if (walls) bits.push(`${walls} из ${wallCount} стен`);
    return bits.length ? bits.join(" + ") : "ничего не выбрано";
  }

  function plannerSetRect(node, w, d) {
    const box = plannerRect(node.points);
    if (!box) return false;
    const width = plannerClamp(w, 0.05, 500);
    const depth = plannerClamp(d, 0.05, 500);
    node.points.forEach((p) => {
      const onMaxX = Math.abs(p.x - box.maxX) < Math.abs(p.x - box.minX);
      const onMaxY = Math.abs(p.y - box.maxY) < Math.abs(p.y - box.minY);
      p.x = plannerRound(onMaxX ? box.minX + width : box.minX);
      p.y = plannerRound(onMaxY ? box.minY + depth : box.minY);
    });
    return true;
  }

  function plannerMakeRect(node, w, d) {
    const width = plannerRound(plannerClamp(plannerNum(w, 4), 0.05, 500));
    const depth = plannerRound(plannerClamp(plannerNum(d, 3), 0.05, 500));
    const origin = node.points[0] || { x: 0, y: 0 };
    const keep = node.points.slice(0, 4);
    while (keep.length < 4) keep.push({ id: uid(), x: 0, y: 0 });
    const drop = node.points.slice(4).map((p) => `w:${p.id}`);
    keep[0].x = plannerRound(origin.x);
    keep[0].y = plannerRound(origin.y);
    keep[1].x = plannerRound(origin.x + width);
    keep[1].y = plannerRound(origin.y);
    keep[2].x = plannerRound(origin.x + width);
    keep[2].y = plannerRound(origin.y + depth);
    keep[3].x = plannerRound(origin.x);
    keep[3].y = plannerRound(origin.y + depth);
    node.points = keep;
    if (drop.length) {
      const gone = new Set(drop);
      node.outs = (node.outs || []).filter((item) => !gone.has(item.id));
      (node.outs || []).forEach((item) => {
        if (item.kind === "sum" && Array.isArray(item.parts)) item.parts = item.parts.filter((id) => !gone.has(id));
      });
      plannerDropPorts(node, drop);
    }
    ensurePlanner(node);
  }

  function plannerProject(wall, at) {
    const dx = wall.b.x - wall.a.x;
    const dy = wall.b.y - wall.a.y;
    const l2 = dx * dx + dy * dy || 1;
    let t = ((at.x - wall.a.x) * dx + (at.y - wall.a.y) * dy) / l2;
    t = Math.max(0.08, Math.min(0.92, t));
    return { x: plannerRound(wall.a.x + dx * t), y: plannerRound(wall.a.y + dy * t) };
  }

  function plannerInsertCorner(node, wallId, at) {
    if (node.points.length >= PLANNER_MAX_PTS) return "";
    const wall = plannerWalls(node).find((item) => item.id === wallId);
    if (!wall) return "";
    const spot = at ? plannerProject(wall, at) : plannerProject(wall, { x: (wall.a.x + wall.b.x) / 2, y: (wall.a.y + wall.b.y) / 2 });
    const id = uid();
    node.points.splice(wall.index + 1, 0, { id, x: spot.x, y: spot.y });
    ensurePlanner(node);
    return id;
  }

  function plannerDeleteCorner(node, pointId) {
    if (!pointId || node.points.length <= 3) return false;
    const wallId = `w:${pointId}`;
    node.points = node.points.filter((p) => p.id !== pointId);
    node.outs = (node.outs || []).filter((item) => item.id !== wallId);
    (node.outs || []).forEach((item) => {
      if (item.kind === "sum" && Array.isArray(item.parts)) item.parts = item.parts.filter((id) => id !== wallId);
    });
    plannerDropPorts(node, [wallId]);
    ensurePlanner(node);
    return true;
  }

  function plannerSetLength(node, wallId, len) {
    const wall = plannerWalls(node).find((item) => item.id === wallId);
    if (!wall) return;
    const length = plannerClamp(len, 0.05, 500);
    const dx = wall.b.x - wall.a.x;
    const dy = wall.b.y - wall.a.y;
    const cur = Math.hypot(dx, dy) || 1;
    wall.b.x = plannerRound(plannerClamp(wall.a.x + (dx / cur) * length, -500, 500));
    wall.b.y = plannerRound(plannerClamp(wall.a.y + (dy / cur) * length, -500, 500));
  }

  function plannerSnap(node, pointId, x, y, shift, origin) {
    let nx = Math.round(x * 20) / 20;
    let ny = Math.round(y * 20) / 20;
    if (shift && origin) {
      if (Math.abs(x - origin.x) >= Math.abs(y - origin.y)) ny = origin.y;
      else nx = origin.x;
    }
    let bestX = null;
    let bestY = null;
    let bestDx = 0.12;
    let bestDy = 0.12;
    node.points.forEach((p) => {
      if (p.id === pointId) return;
      const dx = Math.abs(nx - p.x);
      const dy = Math.abs(ny - p.y);
      if (dx < bestDx) {
        bestDx = dx;
        bestX = p.x;
      }
      if (dy < bestDy) {
        bestDy = dy;
        bestY = p.y;
      }
    });
    if (bestX != null) nx = bestX;
    if (bestY != null) ny = bestY;
    nx = plannerClamp(nx, -500, 500);
    ny = plannerClamp(ny, -500, 500);
    const i = node.points.findIndex((p) => p.id === pointId);
    if (i < 0) return null;
    const prev = node.points[(i - 1 + node.points.length) % node.points.length];
    const next = node.points[(i + 1) % node.points.length];
    if (Math.hypot(nx - prev.x, ny - prev.y) < 0.05 || Math.hypot(nx - next.x, ny - next.y) < 0.05) return null;
    return { x: plannerRound(nx), y: plannerRound(ny) };
  }

  const PLANNER_NUDGE_DIRS = {
    n: [0, -1],
    ne: [1, -1],
    e: [1, 0],
    se: [1, 1],
    s: [0, 1],
    sw: [-1, 1],
    w: [-1, 0],
    nw: [-1, -1],
  };

  function plannerShift(node, nudge, dist) {
    const vec = PLANNER_NUDGE_DIRS[nudge?.dir];
    if (!vec || !(dist > 0)) return false;
    const len = Math.hypot(vec[0], vec[1]) || 1;
    const dx = (vec[0] / len) * dist;
    const dy = (vec[1] / len) * dist;
    const pts = node.points || [];
    const near = (x, y, other) => other && Math.hypot(x - other.x, y - other.y) < 0.05;
    if (nudge.kind === "point") {
      const i = pts.findIndex((p) => p.id === nudge.id);
      if (i < 0) return false;
      const p = pts[i];
      const prev = pts[(i - 1 + pts.length) % pts.length];
      const next = pts[(i + 1) % pts.length];
      const x = plannerClamp(p.x + dx, -500, 500);
      const y = plannerClamp(p.y + dy, -500, 500);
      if (near(x, y, prev) || near(x, y, next)) return false;
      p.x = plannerRound(x);
      p.y = plannerRound(y);
      return true;
    }
    const wall = plannerWalls(node).find((item) => item.id === nudge.id);
    if (!wall) return false;
    const before = pts[(wall.index - 1 + pts.length) % pts.length];
    const after = pts[(wall.index + 2) % pts.length];
    const ax = plannerClamp(wall.a.x + dx, -500, 500);
    const ay = plannerClamp(wall.a.y + dy, -500, 500);
    const bx = plannerClamp(wall.b.x + dx, -500, 500);
    const by = plannerClamp(wall.b.y + dy, -500, 500);
    if (near(ax, ay, before) || near(bx, by, after) || Math.hypot(ax - bx, ay - by) < 0.05) return false;
    wall.a.x = plannerRound(ax);
    wall.a.y = plannerRound(ay);
    wall.b.x = plannerRound(bx);
    wall.b.y = plannerRound(by);
    return true;
  }

  function plannerHideNudge() {
    const el = $("planner-nudge");
    if (el) el.hidden = true;
    const box = el?.querySelector(".planner-nudge-box");
    if (box) {
      box.hidden = true;
      box.classList.remove("is-bad");
    }
    if (session.planner) session.planner.nudge = null;
  }

  function plannerPlaceNudge() {
    const el = $("planner-nudge");
    const plan = $("planner-plan");
    const node = plannerNode();
    const nudge = session.planner?.nudge;
    if (!el || !plan || !node || !nudge) return;
    let world = null;
    if (nudge.kind === "point") world = node.points.find((p) => p.id === nudge.id) || null;
    else {
      const wall = plannerWalls(node).find((item) => item.id === nudge.id);
      if (wall) world = { x: (wall.a.x + wall.b.x) / 2, y: (wall.a.y + wall.b.y) / 2 };
    }
    if (!world) {
      plannerHideNudge();
      return;
    }
    const view = plannerView(plan, node.points, session.planner.viewLock);
    const spot = view.to(world);
    el.hidden = false;
    el.style.left = `${spot.x}px`;
    el.style.top = `${spot.y}px`;
    el.querySelectorAll("[data-dir]").forEach((btn) => btn.classList.toggle("is-on", btn.dataset.dir === nudge.dir));
    const box = el.querySelector(".planner-nudge-box");
    if (box) {
      box.hidden = !nudge.dir;
      const below = spot.y + 116 <= plan.clientHeight;
      box.style.top = below ? "68px" : "-68px";
      box.style.transform = below ? "translate(-50%, 0)" : "translate(-50%, -100%)";
    }
  }

  function plannerNudgeSubmit() {
    const node = plannerNode();
    const nudge = session.planner?.nudge;
    const input = $("planner-nudge-input");
    const box = document.querySelector("#planner-nudge .planner-nudge-box");
    if (!node || !nudge?.dir || !input) return;
    const value = plannerDraft(input.value);
    const ok = value != null && plannerShift(node, nudge, value);
    box?.classList.toggle("is-bad", !ok);
    if (!ok) {
      input.focus();
      return;
    }
    plannerCommit(false);
    input.focus();
    input.select();
  }

  function plannerNode() {
    const id = session.planner?.id;
    if (!id) return null;
    const node = (activeBlueprint()?.nodes || []).find((item) => item.id === id && item.type === "planner") || null;
    if (!node) {
      session.planner = null;
      $("planner-modal")?.classList.remove("open");
    }
    return node;
  }

  function plannerSelWall(node) {
    const sel = session.planner?.sel;
    if (!node || !sel) return null;
    const walls = plannerWalls(node);
    if (sel.kind === "wall") return walls.find((wall) => wall.id === sel.id) || null;
    if (sel.kind === "point") return walls.find((wall) => wall.id === `w:${sel.id}`) || null;
    return null;
  }

  function plannerColors() {
    const css = getComputedStyle(document.documentElement);
    const pick = (name, fallback) => css.getPropertyValue(name).trim() || fallback;
    return {
      ink: pick("--ink", "#0f172a"),
      muted: pick("--muted", "#64748b"),
      line: pick("--line", "#dbe3ec"),
      card: pick("--card", "#fff"),
      bg: pick("--bg-2", "#f7fafc"),
    };
  }

  function plannerFitCanvas(canvas) {
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    if (w < 8 || h < 8) return null;
    const dpr = window.devicePixelRatio || 1;
    const bw = Math.max(1, Math.round(w * dpr));
    const bh = Math.max(1, Math.round(h * dpr));
    if (canvas.width !== bw || canvas.height !== bh) {
      canvas.width = bw;
      canvas.height = bh;
    }
    const ctx = canvas.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return { ctx, w, h };
  }

  function plannerFit(canvas, points) {
    const pad = 36;
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    points.forEach((p) => {
      minX = Math.min(minX, p.x);
      minY = Math.min(minY, p.y);
      maxX = Math.max(maxX, p.x);
      maxY = Math.max(maxY, p.y);
    });
    const spanX = Math.max(0.5, maxX - minX);
    const spanY = Math.max(0.5, maxY - minY);
    const scale = Math.min((canvas.clientWidth - pad * 2) / spanX, (canvas.clientHeight - pad * 2) / spanY);
    return {
      scale,
      ox: (canvas.clientWidth - spanX * scale) / 2 - minX * scale,
      oy: (canvas.clientHeight - spanY * scale) / 2 - minY * scale,
      minX,
      minY,
      spanX,
      spanY,
    };
  }

  function plannerCam() {
    if (!session.planner) return { k: 1, x: 0, y: 0 };
    if (!session.planner.cam) session.planner.cam = { k: 1, x: 0, y: 0 };
    return session.planner.cam;
  }

  function plannerView(canvas, points, lock) {
    if (lock) return lock;
    const fit = plannerFit(canvas, points);
    const cam = session.planner?.cam || { k: 1, x: 0, y: 0 };
    const k = cam.k || 1;
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    const scale = fit.scale * k;
    const ox = (fit.ox - w / 2) * k + w / 2 + (cam.x || 0);
    const oy = (fit.oy - h / 2) * k + h / 2 + (cam.y || 0);
    return {
      scale,
      to(p) {
        return { x: ox + p.x * scale, y: oy + p.y * scale };
      },
      from(x, y) {
        return { x: (x - ox) / scale, y: (y - oy) / scale };
      },
    };
  }

  function plannerDistSeg(px, py, ax, ay, bx, by) {
    const dx = bx - ax;
    const dy = by - ay;
    const l2 = dx * dx + dy * dy || 1;
    let t = ((px - ax) * dx + (py - ay) * dy) / l2;
    t = Math.max(0, Math.min(1, t));
    return Math.hypot(px - (ax + dx * t), py - (ay + dy * t));
  }

  function plannerRoundPath(ctx, x, y, w, h, r) {
    if (typeof ctx.roundRect === "function") ctx.roundRect(x, y, w, h, r);
    else ctx.rect(x, y, w, h);
  }

  function plannerPill(ctx, text, x, y, colors) {
    ctx.save();
    ctx.font = "12px Segoe UI, sans-serif";
    const w = ctx.measureText(text).width + 12;
    const h = 18;
    const left = x - w / 2;
    const top = y - h / 2;
    ctx.fillStyle = colors.card;
    ctx.strokeStyle = colors.line;
    ctx.lineWidth = 1;
    ctx.beginPath();
    plannerRoundPath(ctx, left, top, w, h, 6);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = colors.ink;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(text, x, y + 0.5);
    ctx.restore();
  }

  function plannerHit(canvas, node, clientX, clientY) {
    const view = session.planner?.viewLock || plannerView(canvas, node.points);
    const rect = canvas.getBoundingClientRect();
    const x = clientX - rect.left;
    const y = clientY - rect.top;
    let pointId = "";
    let best = 12;
    node.points.forEach((p) => {
      const s = view.to(p);
      const d = Math.hypot(s.x - x, s.y - y);
      if (d <= best) {
        best = d;
        pointId = p.id;
      }
    });
    if (pointId) return { pointId, wallId: "", world: view.from(x, y) };
    let wallId = "";
    let bestW = 8;
    plannerWalls(node).forEach((wall) => {
      const a = view.to(wall.a);
      const b = view.to(wall.b);
      const d = plannerDistSeg(x, y, a.x, a.y, b.x, b.y);
      if (d <= bestW) {
        bestW = d;
        wallId = wall.id;
      }
    });
    return { pointId: "", wallId, world: view.from(x, y) };
  }

  function plannerDraw() {
    const node = plannerNode();
    const plan = $("planner-plan");
    const unfold = $("planner-unfold");
    if (!node || !plan || !unfold || !session.planner) return;
    const colors = plannerColors();
    const model = plannerModel(node);
    const selWall = plannerSelWall(node);
    const selPoint = session.planner.sel?.kind === "point" ? session.planner.sel.id : "";
    const fitted = plannerFitCanvas(plan);
    if (fitted) {
      const { ctx, w, h } = fitted;
      const view = plannerView(plan, node.points, session.planner.viewLock);
      ctx.clearRect(0, 0, w, h);
      ctx.fillStyle = colors.bg;
      ctx.fillRect(0, 0, w, h);
      const step = view.scale >= 70 ? 0.5 : 1;
      ctx.save();
      ctx.beginPath();
      ctx.strokeStyle = colors.line;
      ctx.globalAlpha = 0.85;
      ctx.lineWidth = 1;
      const topLeft = view.from(0, 0);
      const botRight = view.from(w, h);
      const x0 = Math.floor(Math.min(topLeft.x, botRight.x) / step) * step;
      const x1 = Math.ceil(Math.max(topLeft.x, botRight.x) / step) * step;
      const y0 = Math.floor(Math.min(topLeft.y, botRight.y) / step) * step;
      const y1 = Math.ceil(Math.max(topLeft.y, botRight.y) / step) * step;
      for (let x = x0; x <= x1; x += step) {
        const s = view.to({ x, y: 0 });
        ctx.moveTo(s.x, 0);
        ctx.lineTo(s.x, h);
      }
      for (let y = y0; y <= y1; y += step) {
        const s = view.to({ x: 0, y });
        ctx.moveTo(0, s.y);
        ctx.lineTo(w, s.y);
      }
      ctx.stroke();
      ctx.restore();
      ctx.beginPath();
      node.points.forEach((p, i) => {
        const s = view.to(p);
        if (i) ctx.lineTo(s.x, s.y);
        else ctx.moveTo(s.x, s.y);
      });
      ctx.closePath();
      ctx.fillStyle = "rgba(101, 163, 13, 0.16)";
      ctx.fill();
      const center = plannerCentroid(node.points);
      const mid = view.to(center);
      plannerWalls(node).forEach((wall) => {
        const a = view.to(wall.a);
        const b = view.to(wall.b);
        const on = selWall && selWall.id === wall.id;
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.strokeStyle = on ? "#65a30d" : "#3f6212";
        ctx.lineWidth = on ? 3.5 : 2;
        ctx.stroke();
        if (Math.hypot(b.x - a.x, b.y - a.y) < 36) return;
        let nx = -(wall.b.y - wall.a.y);
        let ny = wall.b.x - wall.a.x;
        const len = Math.hypot(nx, ny) || 1;
        nx /= len;
        ny /= len;
        const mx = (wall.a.x + wall.b.x) / 2;
        const my = (wall.a.y + wall.b.y) / 2;
        if ((mx - center.x) * nx + (my - center.y) * ny < 0) {
          nx = -nx;
          ny = -ny;
        }
        const label = view.to({ x: mx, y: my });
        plannerPill(ctx, `${fmtShort(wall.len)} м`, Math.max(28, Math.min(w - 28, label.x + nx * 18)), Math.max(14, Math.min(h - 14, label.y + ny * 18)), colors);
      });
      node.points.forEach((p) => {
        const s = view.to(p);
        ctx.beginPath();
        ctx.arc(s.x, s.y, p.id === selPoint ? 7 : 5.5, 0, Math.PI * 2);
        ctx.fillStyle = colors.card;
        ctx.fill();
        ctx.lineWidth = 2;
        ctx.strokeStyle = p.id === selPoint ? "#65a30d" : "#3f6212";
        ctx.stroke();
      });
      ctx.fillStyle = colors.ink;
      ctx.font = "700 14px Segoe UI, sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(`${fmtShort(model.floor)} м²`, mid.x, mid.y);
    }
    const strip = plannerFitCanvas(unfold);
    session.planner.hits = [];
    if (strip) {
      const { ctx, w, h } = strip;
      ctx.clearRect(0, 0, w, h);
      ctx.fillStyle = colors.bg;
      ctx.fillRect(0, 0, w, h);
      const walls = model.walls;
      const total = walls.reduce((sum, wall) => sum + wall.len, 0) || 1;
      const gap = walls.length > 1 ? 8 : 0;
      const scale = Math.min((w - 24 - gap * (walls.length - 1)) / total, (h - 46) / Math.max(0.2, model.height));
      let x = 12;
      const rh = model.height * scale;
      const top = Math.max(22, (h - 18 - rh) / 2);
      walls.forEach((wall, index) => {
        const rw = Math.max(1, wall.len * scale);
        const on = selWall && selWall.id === wall.id;
        ctx.fillStyle = on ? "rgba(101, 163, 13, 0.28)" : "rgba(101, 163, 13, 0.12)";
        ctx.strokeStyle = on ? "#65a30d" : "#4d7c0f";
        ctx.lineWidth = on ? 2.5 : 1.25;
        ctx.beginPath();
        plannerRoundPath(ctx, x, top, rw, rh, 4);
        ctx.fill();
        ctx.stroke();
        const row = model.rows[index + 1];
        ctx.fillStyle = colors.ink;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.font = "700 12px Segoe UI, sans-serif";
        if (rw >= 54) {
          ctx.fillText(String(index + 1), x + rw / 2, top + Math.min(rh / 2, 16));
          ctx.font = "11px Segoe UI, sans-serif";
          ctx.fillStyle = colors.muted;
          if (rh > 36) ctx.fillText(`${fmtShort(row?.area || 0)} м²`, x + rw / 2, top + rh / 2 + 12);
        } else {
          ctx.fillText(String(index + 1), x + rw / 2, top - 10);
        }
        session.planner.hits.push({ id: wall.id, x, y: top, w: rw, h: rh });
        x += rw + gap;
      });
    }
    plannerSyncFields(model);
    plannerPlaceNudge();
    plannerMini();
  }

  function plannerMini() {
    const canvas = $("planner-minimap");
    const wrap = $("planner-mini-wrap");
    const plan = $("planner-plan");
    const node = plannerNode();
    if (!canvas || !plan || !node || !session.planner) return;
    wrap?.classList.toggle("is-hidden", !!session.planner.miniHidden);
    if (session.planner.miniHidden) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const cssW = 200;
    const cssH = 128;
    if (canvas.width !== Math.round(cssW * dpr)) {
      canvas.width = Math.round(cssW * dpr);
      canvas.height = Math.round(cssH * dpr);
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const dark = document.documentElement.getAttribute("data-theme") === "dark";
    ctx.clearRect(0, 0, cssW, cssH);
    ctx.fillStyle = dark ? "#0b1220" : "#eef3f8";
    ctx.fillRect(0, 0, cssW, cssH);
    const fit = plannerFit(plan, node.points);
    const inset = 10;
    const scale = Math.min((cssW - inset * 2) / fit.spanX, (cssH - inset * 2) / fit.spanY);
    const ox = (cssW - fit.spanX * scale) / 2 - fit.minX * scale;
    const oy = (cssH - fit.spanY * scale) / 2 - fit.minY * scale;
    session.planner.mini = { scale, ox, oy, w: cssW, h: cssH };
    ctx.beginPath();
    node.points.forEach((p, i) => {
      const x = ox + p.x * scale;
      const y = oy + p.y * scale;
      if (i) ctx.lineTo(x, y);
      else ctx.moveTo(x, y);
    });
    ctx.closePath();
    ctx.fillStyle = node.color || "#65a30d";
    ctx.globalAlpha = 0.28;
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.strokeStyle = node.color || "#65a30d";
    ctx.lineWidth = 1.5;
    ctx.stroke();
    const view = plannerView(plan, node.points);
    const a = view.from(0, 0);
    const b = view.from(plan.clientWidth, plan.clientHeight);
    const vx = ox + Math.min(a.x, b.x) * scale;
    const vy = oy + Math.min(a.y, b.y) * scale;
    const vw = Math.abs(b.x - a.x) * scale;
    const vh = Math.abs(b.y - a.y) * scale;
    ctx.strokeStyle = "#14b8a6";
    ctx.lineWidth = 1.4;
    ctx.strokeRect(vx, vy, Math.max(8, vw), Math.max(8, vh));
    ctx.fillStyle = "rgba(20, 184, 166, 0.12)";
    ctx.fillRect(vx, vy, Math.max(8, vw), Math.max(8, vh));
  }

  function plannerSyncFields(model) {
    const node = plannerNode();
    if (!node || !model || !session.planner) return;
    const linked = linkedFromPorts(node.id, activeBlueprint()?.links || []);
    const setVal = (id, text) => {
      const el = document.querySelector(`#planner-side [data-planner-val="${cssEsc(id)}"]`);
      if (el) el.textContent = text;
    };
    const setNote = (id, text) => {
      const el = document.querySelector(`#planner-side [data-planner-note="${cssEsc(id)}"]`);
      if (el) el.textContent = text;
    };
    model.rows.forEach((row) => {
      setVal(row.id, `${fmtShort(row.value ?? row.area)} ${row.unit || "м²"}`);
      const pogonazh = document.querySelector(`#planner-side [data-planner-pogonazh="${cssEsc(row.id)}"]`);
      if (pogonazh) pogonazh.checked = !!row.pogonazh;
      const axis = document.querySelector(`#planner-side [data-planner-axis="${cssEsc(row.id)}"]`);
      if (axis) axis.checked = row.pogonazhAxis === "length";
      const axisWrap = document.querySelector(`#planner-side [data-planner-axis-wrap="${cssEsc(row.id)}"]`);
      if (axisWrap) axisWrap.hidden = !row.pogonazh;
      const len = document.querySelector(`#planner-side [data-planner-len="${cssEsc(row.id)}"]`);
      if (len && document.activeElement !== len) len.value = plannerInput(row.len);
      const name = document.querySelector(`#planner-side [data-planner-name="${cssEsc(row.id)}"]`);
      if (name && document.activeElement !== name) name.value = row.name;
    });
    model.sums.forEach((row) => {
      setVal(row.id, `${fmtShort(row.value ?? row.area)} ${row.unit || "м²"}`);
      setNote(row.id, plannerSumNote(row.parts, model.walls.length));
      const name = document.querySelector(`#planner-side [data-planner-sum-name="${cssEsc(row.id)}"]`);
      if (name && document.activeElement !== name) name.value = row.name;
    });
    document.querySelectorAll("#planner-side .planner-part").forEach((label) => {
      const row = model.rows.find((item) => item.id === label.querySelector("[data-part]")?.dataset.part);
      if (!row) return;
      const span = label.querySelector("span");
      const em = label.querySelector("em");
      if (span) span.textContent = row.name;
      if (em) em.textContent = `${fmtShort(row.value ?? row.area)} ${row.unit || "м²"}`;
    });
    document.querySelectorAll("#planner-side [data-planner-on]").forEach((el) => {
      const id = el.dataset.plannerOn;
      const row = model.rows.concat(model.sums).find((item) => item.id === id);
      if (!row || document.activeElement === el) return;
      el.checked = !!(row.on || linked.has(id));
      el.disabled = linked.has(id);
      el.title = linked.has(id) ? "Сначала снимите связь на схеме" : "Вывести число на ноду";
    });
    const heightOut = document.querySelector('#planner-side [data-planner-height-on]');
    if (heightOut) {
      const heightId = plannerPort(plannerActive(node), "height");
      heightOut.checked = !!(node.heightOut || linked.has(heightId));
      heightOut.disabled = linked.has(heightId);
      heightOut.title = linked.has(heightId) ? "Сначала снимите связь на схеме" : "Вывести высоту стен на ноду";
    }
    document.querySelectorAll("#planner-side [data-planner-row]").forEach((el) => {
      const wall = plannerSelWall(node);
      el.classList.toggle("is-sel", !!wall && el.dataset.plannerRow === wall.id);
    });
    const rect = plannerRect(node.points);
    const width = $("planner-width");
    const depth = $("planner-depth");
    const height = $("planner-height");
    if (rect && width && document.activeElement !== width) width.value = plannerInput(rect.w);
    if (rect && depth && document.activeElement !== depth) depth.value = plannerInput(rect.d);
    if (height && document.activeElement !== height) height.value = plannerInput(model.height);
    const make = $("planner-make-rect");
    if (make) make.hidden = !!rect;
    if (width) width.title = rect ? "Ширина комнаты" : "Ширина прямоугольника, который заменит план";
    if (depth) depth.title = rect ? "Глубина комнаты" : "Глубина прямоугольника, который заменит план";
    const add = $("planner-add-corner");
    const del = $("planner-del-corner");
    if (add) add.disabled = !plannerSelWall(node) || node.points.length >= PLANNER_MAX_PTS;
    if (del) del.disabled = session.planner.sel?.kind !== "point" || node.points.length <= 3;
    const peri = document.querySelector("#planner-side [data-planner-peri]");
    if (peri) peri.textContent = `периметр ${fmtShort(model.peri)} м`;
  }

  function plannerSideHtml(node) {
    const model = plannerModel(node);
    const linked = linkedFromPorts(node.id, activeBlueprint()?.links || []);
    const onBox = (id, on) => {
      const lock = linked.has(id);
      return `<label class="planner-on" title="${lock ? "Сначала снимите связь на схеме" : "Вывести число на ноду"}"><input type="checkbox" data-planner-on="${esc(id)}" ${on || lock ? "checked" : ""} ${lock ? "disabled" : ""} /> На ноду</label>`;
    };
    const rows = model.rows
      .map((row) => {
        if (row.kind === "floor") {
          return `<div class="planner-metric" data-planner-row="${esc(row.id)}">
            ${onBox(row.id, row.on)}
            <span class="planner-label">Пол</span>
            <b data-planner-val="${esc(row.id)}">${esc(fmtShort(row.area))} м²</b>
          </div>`;
        }
        return `<div class="planner-metric" data-planner-row="${esc(row.id)}">
          ${onBox(row.id, row.on)}
          <input class="planner-name" data-planner-name="${esc(row.id)}" value="${esc(row.name)}" maxlength="48" aria-label="Имя стены" />
          <label class="planner-len">длина <input data-planner-len="${esc(row.id)}" value="${esc(plannerInput(row.len))}" inputmode="decimal" aria-label="Длина стены" /> м</label>
          <b data-planner-val="${esc(row.id)}">${esc(fmtShort(row.value ?? row.area))} ${row.unit || "м²"}</b>
          <div class="planner-wall-tools">
            <label class="planner-on" title="Вместо площади выводить погонаж"><input type="checkbox" data-planner-pogonazh="${esc(row.id)}" ${row.pogonazh ? "checked" : ""} /> Погонаж</label>
            <label class="planner-axis-switch" data-planner-axis-wrap="${esc(row.id)}" ${row.pogonazh ? "" : "hidden"}>
              <span>Высота</span>
              <input type="checkbox" role="switch" data-planner-axis="${esc(row.id)}" ${row.pogonazhAxis === "length" ? "checked" : ""} aria-label="Переключить на длину стены" />
              <span>Длина</span>
            </label>
          </div>
        </div>`;
      })
      .join("");
    const sums = model.sums
      .map((sum) => {
        const parts = model.rows
          .map((row) => {
            const checked = sum.parts.includes(row.id) ? "checked" : "";
            return `<label class="planner-part"><input type="checkbox" data-planner-part="${esc(sum.id)}" data-part="${esc(row.id)}" ${checked} /> <span>${esc(row.name)}</span> <em>${esc(fmtShort(row.value ?? row.area))} ${row.unit || "м²"}</em></label>`;
          })
          .join("");
        return `<div class="planner-sum" data-planner-row="${esc(sum.id)}">
          <div class="planner-sum-h">
            ${onBox(sum.id, sum.on)}
            <input class="planner-name" data-planner-sum-name="${esc(sum.id)}" value="${esc(sum.name)}" maxlength="48" aria-label="Имя суммы" />
            <b data-planner-val="${esc(sum.id)}">${esc(fmtShort(sum.value ?? sum.area))} ${sum.unit || "м²"}</b>
            <button type="button" class="calc-x" data-planner-del-sum="${esc(sum.id)}" title="Удалить сумму">×</button>
          </div>
          <div class="planner-sum-tools">
            <p data-planner-note="${esc(sum.id)}">${esc(plannerSumNote(sum.parts, model.walls.length))}</p>
            <button type="button" data-planner-sum-walls="${esc(sum.id)}">Все стены</button>
            <button type="button" data-planner-sum-clear="${esc(sum.id)}">Снять</button>
          </div>
          <div class="planner-parts">${parts}</div>
        </div>`;
      })
      .join("");
    const addSum = model.sums.length >= PLANNER_MAX_SUMS ? "" : `<button type="button" class="btn planner-add-sum" data-planner-add-sum>+ Сумма</button>`;
    return `<div class="planner-block">
        <div class="planner-block-h">Площади <span data-planner-peri>периметр ${esc(fmtShort(model.peri))} м</span></div>
        ${rows}
      </div>
      <div class="planner-block">
        <div class="planner-block-h">Параметры</div>
        <div class="planner-metric">
          <label class="planner-on" title="Вывести высоту стен на ноду"><input type="checkbox" data-planner-height-on ${node.heightOut ? "checked" : ""} /> На ноду</label>
          <span class="planner-label">Высота стен</span>
          <b>${esc(fmtShort(model.height))} м</b>
        </div>
      </div>
      <div class="planner-block">
        <div class="planner-block-h">Сумма выбранных ${addSum}</div>
        <p class="planner-lead">Отметьте пол и стены, которые нужно сложить. На ноду выйдет одно число.</p>
        ${sums || `<div class="calc-empty">Сумм пока нет</div>`}
      </div>`;
  }

  function plannerFill() {
    const node = plannerNode();
    const side = $("planner-side");
    if (!node || !side) return;
    const scroll = side.scrollTop;
    side.innerHTML = plannerSideHtml(node);
    side.scrollTop = scroll;
    const rect = plannerRect(node.points);
    const boxW = rect ? rect.w : Math.max(...node.points.map((p) => p.x)) - Math.min(...node.points.map((p) => p.x));
    const boxD = rect ? rect.d : Math.max(...node.points.map((p) => p.y)) - Math.min(...node.points.map((p) => p.y));
    const width = $("planner-width");
    const depth = $("planner-depth");
    const height = $("planner-height");
    if (width && document.activeElement !== width) width.value = plannerInput(boxW || 4);
    if (depth && document.activeElement !== depth) depth.value = plannerInput(boxD || 3);
    if (height && document.activeElement !== height) height.value = plannerInput(node.height);
    const title = $("planner-title");
    const layout = plannerActive(node);
    if (title && document.activeElement !== title) title.value = layout?.name || "Планировка 1";
    const picker = $("planner-layout-trigger");
    const menu = $("planner-layout-menu");
    if (picker && menu) {
      picker.textContent = layout?.name || "Планировка";
      menu.innerHTML = `${(node.layouts || []).map((item) => `<button type="button" class="planner-layout-option ${item.id === node.layoutId ? "is-active" : ""}" role="menuitem" data-planner-layout-choice="${esc(item.id)}">${esc(item.name)}</button>`).join("")}<div class="planner-layout-menu-sep"></div><button type="button" class="planner-layout-option is-create" role="menuitem" data-planner-layout-choice="__new">＋ Создать планировку</button>`;
    }
    const paste = $("planner-paste");
    if (paste) paste.hidden = !plannerClip;
    plannerDraw();
  }

  async function plannerPasteLayout() {
    const node = plannerNode();
    const layout = node && plannerActive(node);
    if (!node || !layout || !plannerClip) return;
    const ok = api?.confirm
      ? await api.confirm({
          title: "Заменить планировку?",
          text: "Текущая планировка будет заменена копией.",
          ok: "Заменить",
          danger: true,
        })
      : true;
    if (!ok || !plannerNode()) return;
    const src = JSON.parse(JSON.stringify(plannerClip));
    const map = new Map();
    (src.points || []).forEach((p) => {
      const next = uid();
      map.set(p.id, next);
      p.id = next;
    });
    const floorId = plannerPort(layout, "floor");
    const oldIds = new Set((layout.outs || []).map((item) => item.id).concat(plannerPort(layout, "height")));
    (src.outs || []).forEach((out) => {
      if (out.kind === "wall") {
        const next = map.get(String(out.id || "").slice(2));
        out.id = next ? `w:${next}` : `w:${uid()}`;
      } else if (out.kind === "floor") out.id = floorId;
      else if (out.kind === "sum") {
        out.id = uid();
        out.parts = (out.parts || []).map((part) => {
          const key = String(part || "");
          if (key === "floor" || key.startsWith("floor:")) return floorId;
          if (key.startsWith("w:")) {
            const next = map.get(key.slice(2));
            return next ? `w:${next}` : "";
          }
          return "";
        }).filter(Boolean);
      }
    });
    layout.name = plannerLayoutName({ name: src.name }, Math.max(0, node.layouts.indexOf(layout)));
    layout.color = src.color;
    layout.height = src.height;
    layout.heightOut = !!src.heightOut;
    layout.points = src.points;
    layout.outs = src.outs;
    plannerApply(node, layout);
    ensurePlanner(node);
    const keep = new Set((node.outs || []).map((item) => item.id).concat(plannerPort(layout, "height"), plannerPort(layout, "plan")));
    plannerDropPorts(node, [...oldIds].filter((id) => !keep.has(id)));
    if (session.planner) session.planner.sel = null;
    plannerCommit(true);
  }

  const editorHist = { on: false, stack: [], index: -1 };

  function editorBundle() {
    const plannerOpen = $("planner-modal")?.classList.contains("open");
    const markOpen = $("mark-modal")?.classList.contains("open");
    const node = plannerOpen ? plannerNode() : markOpen ? markNode() : null;
    const bp = activeBlueprint();
    const calc = ensureState();
    if (!node || !bp || !calc) return "";
    const links = (bp.links || []).filter((link) => link.from === node.id || link.to === node.id);
    const catalog = node.type === "electrics"
      ? {
          socketTypes: calc.socketTypes || [],
          lightTypes: calc.lightTypes || [],
          labels: calc.labels || {},
          typeOff: calc.typeOff || [],
        }
      : null;
    return JSON.stringify({ node, links, catalog });
  }

  function editorBegin() {
    editorHist.on = true;
    editorHist.stack = [];
    editorHist.index = -1;
    const snap = editorBundle();
    if (!snap) return;
    editorHist.stack.push(snap);
    editorHist.index = 0;
  }

  function editorEnd() {
    const base = editorHist.stack[0] || "";
    const now = editorHist.on ? editorBundle() : "";
    const changed = !!(editorHist.on && base && now && base !== now);
    editorHist.on = false;
    editorHist.stack = [];
    editorHist.index = -1;
    if (changed) dirty();
  }

  function editorPush() {
    if (!editorHist.on) return;
    const snap = editorBundle();
    if (!snap || editorHist.stack[editorHist.index] === snap) return;
    editorHist.stack = editorHist.stack.slice(0, editorHist.index + 1);
    editorHist.stack.push(snap);
    if (editorHist.stack.length > 80) editorHist.stack.shift();
    editorHist.index = editorHist.stack.length - 1;
    dirtyLive();
  }

  function editorApply(snap) {
    const data = JSON.parse(snap);
    const bp = activeBlueprint();
    const calc = ensureState();
    if (!bp || !data?.node) return;
    const at = (bp.nodes || []).findIndex((item) => item.id === data.node.id);
    if (at < 0) return;
    bp.nodes[at] = data.node;
    bp.links = (bp.links || []).filter((link) => link.from !== data.node.id && link.to !== data.node.id).concat(data.links || []);
    if (data.catalog && calc) {
      calc.socketTypes = data.catalog.socketTypes || [];
      calc.lightTypes = data.catalog.lightTypes || [];
      calc.labels = data.catalog.labels || {};
      calc.typeOff = data.catalog.typeOff || [];
    }
    if (session.planner) session.planner.drag = null;
    if (session.mark) session.mark.drag = null;
    render();
    if ($("planner-modal")?.classList.contains("open")) plannerFill();
    if ($("mark-modal")?.classList.contains("open")) {
      markFill();
      const body = $("mark-preset-body");
      if (body && $("mark-preset-modal")?.classList.contains("open")) body.innerHTML = markPresetHtml();
    }
    dirtyLive();
  }

  function editorUndo() {
    if (!editorHist.on || editorHist.index <= 0) return false;
    editorHist.index -= 1;
    editorApply(editorHist.stack[editorHist.index]);
    return true;
  }

  function editorRedo() {
    if (!editorHist.on || editorHist.index >= editorHist.stack.length - 1) return false;
    editorHist.index += 1;
    editorApply(editorHist.stack[editorHist.index]);
    return true;
  }

  function refreshEditors() {
    if (editorHist.on) editorBegin();
    if (session.planner) session.planner.drag = null;
    if (session.mark) session.mark.drag = null;
    if ($("planner-modal")?.classList.contains("open")) plannerFill();
    if ($("mark-modal")?.classList.contains("open")) {
      markFill();
      const body = $("mark-preset-body");
      if (body && $("mark-preset-modal")?.classList.contains("open")) body.innerHTML = markPresetHtml();
    } else $("mark-preset-modal")?.classList.remove("open");
  }

  function plannerCommit(rebuild) {
    const node = plannerNode();
    if (!node) return;
    ensurePlanner(node);
    if ($("planner-modal")?.classList.contains("open")) editorPush();
    else dirty();
    render();
    if (!$("planner-modal")?.classList.contains("open")) return;
    if (rebuild) plannerFill();
    else plannerDraw();
  }

  function plannerSelect(sel, scroll) {
    if (!session.planner) return;
    session.planner.sel = sel;
    plannerDraw();
    if (!scroll || !sel) return;
    const wallId = sel.kind === "wall" ? sel.id : `w:${sel.id}`;
    document.querySelector(`#planner-side [data-planner-row="${cssEsc(wallId)}"]`)?.scrollIntoView({ block: "nearest" });
  }

  function ensurePlannerModal() {
    if ($("planner-modal")) return;
    const modal = document.createElement("div");
    modal.className = "modal";
    modal.id = "planner-modal";
    modal.innerHTML = `<div class="modal-card planner-modal" role="dialog" aria-label="Планировщик">
      <div class="planner-head">
        <div class="planner-layout-control" id="planner-layout-control">
          <button type="button" class="planner-layout-trigger" id="planner-layout-trigger" aria-haspopup="true" aria-expanded="false">Планировка</button>
          <div class="planner-layout-menu" id="planner-layout-menu" role="menu" hidden></div>
        </div>
        <input id="planner-title" class="planner-title" maxlength="48" spellcheck="false" aria-label="Имя планировки" />
        <label>Высота <input id="planner-height" inputmode="decimal" aria-label="Высота стен, метры" /> м</label>
        <label>Ширина <input id="planner-width" inputmode="decimal" aria-label="Ширина, метры" /> м</label>
        <label>Глубина <input id="planner-depth" inputmode="decimal" aria-label="Глубина, метры" /> м</label>
        <button type="button" class="btn" id="planner-make-rect">Прямоугольник</button>
        <button type="button" class="btn primary" id="planner-close">Готово</button>
      </div>
      <div class="planner-body">
        <div class="planner-stage">
          <div class="planner-cap">План пола</div>
          <div class="planner-plan-wrap">
            <canvas id="planner-plan"></canvas>
            <div class="planner-clip">
              <button type="button" class="planner-clip-btn" id="planner-paste" title="Вставить планировку" aria-label="Вставить планировку" hidden><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5h8v2h2a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2h2V5z" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M9 5.5h6V7H9z" fill="none" stroke="currentColor" stroke-width="1.8"/></svg></button>
              <button type="button" class="planner-clip-btn" id="planner-copy" title="Копировать планировку" aria-label="Копировать планировку"><svg viewBox="0 0 24 24" aria-hidden="true"><rect x="8" y="8" width="11" height="11" rx="2" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M5 15V5.5A1.5 1.5 0 0 1 6.5 4H16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg></button>
            </div>
            <div class="calc-mini-wrap planner-mini" id="planner-mini-wrap">
              <canvas id="planner-minimap" class="calc-minimap" width="200" height="128" aria-label="Карта плана"></canvas>
              <button type="button" class="calc-mini-toggle" id="planner-mini-toggle" title="Скрыть карту" aria-label="Показать или скрыть карту"><svg class="calc-mini-eye-on" width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M2.5 12s3.5-7 9.5-7 9.5 7 9.5 7-3.5 7-9.5 7-9.5-7-9.5-7z" stroke="currentColor" stroke-width="1.8"/><circle cx="12" cy="12" r="3" stroke="currentColor" stroke-width="1.8"/></svg><svg class="calc-mini-eye-off" width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M3 3l18 18M10.6 10.7a2.8 2.8 0 0 0 3.7 3.7M6.2 6.3C4.1 7.8 2.5 12 2.5 12s3.5 7 9.5 7c1.2 0 2.3-.2 3.3-.6" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg></button>
            </div>
            <div id="planner-nudge" class="planner-nudge" hidden>
              <button type="button" class="planner-nudge-dir" data-dir="nw" aria-label="Вверх-влево"><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 3.2 12.4 11.2H3.6z"/></svg></button>
              <button type="button" class="planner-nudge-dir" data-dir="n" aria-label="Вверх"><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 3.2 12.4 11.2H3.6z"/></svg></button>
              <button type="button" class="planner-nudge-dir" data-dir="ne" aria-label="Вверх-вправо"><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 3.2 12.4 11.2H3.6z"/></svg></button>
              <button type="button" class="planner-nudge-dir" data-dir="w" aria-label="Влево"><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 3.2 12.4 11.2H3.6z"/></svg></button>
              <button type="button" class="planner-nudge-dir" data-dir="e" aria-label="Вправо"><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 3.2 12.4 11.2H3.6z"/></svg></button>
              <button type="button" class="planner-nudge-dir" data-dir="sw" aria-label="Вниз-влево"><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 3.2 12.4 11.2H3.6z"/></svg></button>
              <button type="button" class="planner-nudge-dir" data-dir="s" aria-label="Вниз"><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 3.2 12.4 11.2H3.6z"/></svg></button>
              <button type="button" class="planner-nudge-dir" data-dir="se" aria-label="Вниз-вправо"><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 3.2 12.4 11.2H3.6z"/></svg></button>
              <form class="planner-nudge-box" hidden>
                <input id="planner-nudge-input" inputmode="decimal" autocomplete="off" placeholder="0" aria-label="Сдвиг, метры" />
                <span>м</span>
                <button type="submit" aria-label="Сдвинуть"><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3.2 8.2 6.4 11.4 12.8 4.6"/></svg></button>
              </form>
            </div>
          </div>
          <div class="planner-hint">
            <span>Тяните угол. Клик по стене — длина справа. Двойной клик по стене добавляет угол. Правый клик по углу или стене сдвигает их стрелками. Shift держит линию прямой.</span>
            <span class="planner-hint-btns">
              <button type="button" class="btn" id="planner-add-corner">Добавить угол</button>
              <button type="button" class="btn" id="planner-del-corner">Удалить угол</button>
            </span>
          </div>
          <div class="planner-cap">Развертка стен</div>
          <canvas id="planner-unfold"></canvas>
        </div>
        <div class="planner-side" id="planner-side"></div>
      </div>
    </div>`;
    document.body.appendChild(modal);
    modal.addEventListener("click", (e) => {
      if (e.target === modal) closePlanner();
    });
    $("planner-close")?.addEventListener("click", () => closePlanner());
    $("planner-layout-trigger")?.addEventListener("click", (e) => {
      e.stopPropagation();
      const menu = $("planner-layout-menu");
      if (!menu) return;
      const opening = menu.hidden;
      menu.hidden = !opening;
      $("planner-layout-trigger")?.setAttribute("aria-expanded", String(opening));
    });
    $("planner-layout-menu")?.addEventListener("click", (e) => {
      const option = e.target.closest("[data-planner-layout-choice]");
      if (!option) return;
      const node = plannerNode();
      if (!node) return;
      const value = option.dataset.plannerLayoutChoice;
      if (value === "__new") {
        const created = plannerAddLayout(node);
        if (!created) {
          api?.toast?.("Достигнут лимит планировок");
          return;
        }
      } else plannerUseLayout(node, value);
      $("planner-layout-menu").hidden = true;
      $("planner-layout-trigger")?.setAttribute("aria-expanded", "false");
      if (session.planner) session.planner.sel = null;
      plannerCommit(true);
    });
    $("planner-modal")?.addEventListener("click", (e) => {
      if (e.target.closest("#planner-layout-control")) return;
      const menu = $("planner-layout-menu");
      if (menu) menu.hidden = true;
      $("planner-layout-trigger")?.setAttribute("aria-expanded", "false");
    });
    $("planner-title")?.addEventListener("input", (e) => {
      const node = plannerNode();
      const layout = node && plannerActive(node);
      if (!layout || !session.planner) return;
      layout.name = String(e.target.value || "").trim().slice(0, 48);
      const index = Math.max(0, (node.layouts || []).indexOf(layout));
      const shownName = plannerLayoutName(layout, index);
      const picker = $("planner-layout-trigger");
      const menuItem = $("planner-layout-menu")?.querySelector(`[data-planner-layout-choice="${cssEsc(layout.id)}"]`);
      if (picker) picker.textContent = shownName;
      if (menuItem) menuItem.textContent = shownName;
      session.planner.touched = true;
    });
    $("planner-title")?.addEventListener("change", (e) => {
      const node = plannerNode();
      const layout = node && plannerActive(node);
      if (!layout) return;
      const index = Math.max(0, (node.layouts || []).indexOf(layout));
      layout.name = plannerLayoutName(layout, index);
      e.target.value = layout.name;
      if (session.planner) session.planner.touched = false;
      plannerCommit(false);
    });
    $("planner-copy")?.addEventListener("click", () => {
      const node = plannerNode();
      const layout = node && plannerActive(node);
      if (!layout) return;
      plannerClip = JSON.parse(JSON.stringify({
        name: layout.name,
        color: layout.color,
        height: layout.height,
        heightOut: !!layout.heightOut,
        points: layout.points,
        outs: layout.outs,
      }));
      const paste = $("planner-paste");
      if (paste) paste.hidden = false;
    });
    $("planner-paste")?.addEventListener("click", () => plannerPasteLayout());
    $("planner-make-rect")?.addEventListener("click", () => plannerAskRect());
    $("planner-add-corner")?.addEventListener("click", () => {
      const node = plannerNode();
      const wall = node && plannerSelWall(node);
      if (!node || !wall) return;
      const id = plannerInsertCorner(node, wall.id);
      if (!id) return;
      session.planner.sel = { kind: "point", id };
      plannerCommit(true);
    });
    $("planner-del-corner")?.addEventListener("click", () => plannerDeleteSelected());
    $("planner-height")?.addEventListener("input", (e) => {
      const node = plannerNode();
      const value = plannerDraft(e.target.value);
      if (!node || value == null) return;
      node.height = plannerRound(plannerClamp(value, 0.2, 30));
      plannerCommit(false);
    });
    const liveSize = () => {
      const node = plannerNode();
      if (!node || !plannerRect(node.points)) return;
      const w = plannerDraft($("planner-width")?.value);
      const d = plannerDraft($("planner-depth")?.value);
      if (w == null || d == null) return;
      plannerSetRect(node, w, d);
      plannerCommit(false);
    };
    $("planner-width")?.addEventListener("input", liveSize);
    $("planner-depth")?.addEventListener("input", liveSize);
    $("planner-side")?.addEventListener("input", (e) => {
      const node = plannerNode();
      if (!node) return;
      if (e.target.matches("[data-planner-height-on]")) {
        const linked = linkedFromPorts(node.id, activeBlueprint()?.links || []);
        const heightId = plannerPort(plannerActive(node), "height");
        if (linked.has(heightId)) {
          e.target.checked = true;
          return;
        }
        node.heightOut = !!e.target.checked;
        const layout = plannerActive(node);
        if (layout) layout.heightOut = node.heightOut;
        plannerCommit(false);
        return;
      }
      const on = e.target.dataset?.plannerOn;
      if (on) {
        const out = (node.outs || []).find((item) => item.id === on);
        const linked = linkedFromPorts(node.id, activeBlueprint()?.links || []);
        if (!out || linked.has(on)) {
          e.target.checked = true;
          return;
        }
        out.on = !!e.target.checked;
        plannerCommit(false);
        return;
      }
      const nameId = e.target.dataset?.plannerName;
      if (nameId) {
        const out = (node.outs || []).find((item) => item.id === nameId);
        if (!out) return;
        const text = String(e.target.value || "").trim();
        out.name = plannerAutoName(text) ? "" : text.slice(0, 48);
        session.planner.touched = true;
        return;
      }
      const sumName = e.target.dataset?.plannerSumName;
      if (sumName) {
        const out = (node.outs || []).find((item) => item.id === sumName);
        if (!out) return;
        out.name = String(e.target.value || "").trim().slice(0, 48) || "Сумма";
        session.planner.touched = true;
        return;
      }
      const lenId = e.target.dataset?.plannerLen;
      if (lenId) {
        const value = plannerDraft(e.target.value);
        if (value == null) return;
        plannerSetLength(node, lenId, value);
        plannerCommit(false);
        return;
      }
      const sumId = e.target.dataset?.plannerPart;
      if (sumId) {
        const out = (node.outs || []).find((item) => item.id === sumId && item.kind === "sum");
        if (!out) return;
        const part = e.target.dataset.part || "";
        const parts = new Set(out.parts || []);
        if (e.target.checked) parts.add(part);
        else parts.delete(part);
        const order = ["floor"].concat(plannerWalls(node).map((wall) => wall.id));
        out.parts = order.filter((id) => parts.has(id));
        plannerCommit(false);
      }
    });
    $("planner-side")?.addEventListener("change", (e) => {
      const node = plannerNode();
      if (!node) return;
      const pogonazhId = e.target.dataset?.plannerPogonazh;
      if (pogonazhId) {
        const out = (node.outs || []).find((item) => item.id === pogonazhId && item.kind === "wall");
        if (!out) return;
        out.pogonazh = e.target.checked;
        plannerCommit(false);
        return;
      }
      const axisId = e.target.dataset?.plannerAxis;
      if (axisId) {
        const out = (node.outs || []).find((item) => item.id === axisId && item.kind === "wall");
        if (!out) return;
        out.pogonazhAxis = e.target.checked ? "length" : "height";
        plannerCommit(false);
        return;
      }
      if (e.target.dataset?.plannerName || e.target.dataset?.plannerSumName) {
        if (session.planner) session.planner.touched = false;
        plannerCommit(false);
      }
    });
    $("planner-side")?.addEventListener("click", (e) => {
      const node = plannerNode();
      if (!node || !session.planner) return;
      const add = e.target.closest("[data-planner-add-sum]");
      if (add) {
        if ((node.outs || []).filter((item) => item.kind === "sum").length >= PLANNER_MAX_SUMS) return;
        const names = new Set((node.outs || []).filter((item) => item.kind === "sum").map((item) => item.name));
        let name = "Сумма";
        let n = 2;
        while (names.has(name)) {
          name = `Сумма ${n}`;
          n += 1;
        }
        node.outs.push({ id: uid(), kind: "sum", name, on: true, parts: [] });
        plannerCommit(true);
        return;
      }
      const del = e.target.closest("[data-planner-del-sum]");
      if (del) {
        const id = del.dataset.plannerDelSum;
        node.outs = (node.outs || []).filter((item) => item.id !== id);
        plannerDropPorts(node, [id]);
        plannerCommit(true);
        return;
      }
      const all = e.target.closest("[data-planner-sum-walls]");
      if (all) {
        const out = (node.outs || []).find((item) => item.id === all.dataset.plannerSumWalls);
        if (!out) return;
        const walls = plannerWalls(node).map((wall) => wall.id);
        const floor = (out.parts || []).includes("floor") ? ["floor"] : [];
        out.parts = floor.concat(walls);
        plannerCommit(true);
        return;
      }
      const clear = e.target.closest("[data-planner-sum-clear]");
      if (clear) {
        const out = (node.outs || []).find((item) => item.id === clear.dataset.plannerSumClear);
        if (!out) return;
        out.parts = [];
        plannerCommit(true);
        return;
      }
      const row = e.target.closest(".planner-metric[data-planner-row]");
      if (!row || e.target.closest("button, .planner-on, .planner-axis-switch")) return;
      const id = row.dataset.plannerRow || "";
      if (!id.startsWith("w:")) return;
      plannerSelect({ kind: "wall", id }, false);
    });
    $("planner-side")?.addEventListener("focusin", (e) => {
      const row = e.target.closest(".planner-metric[data-planner-row]");
      const id = row?.dataset.plannerRow || "";
      if (!id.startsWith("w:")) return;
      plannerSelect({ kind: "wall", id }, false);
    });
    const plan = $("planner-plan");
    $("planner-mini-toggle")?.addEventListener("click", () => {
      if (!session.planner) return;
      session.planner.miniHidden = !session.planner.miniHidden;
      plannerMini();
    });
    $("planner-minimap")?.addEventListener("pointerdown", (e) => {
      const node = plannerNode();
      const map = session.planner?.mini;
      const mini = $("planner-minimap");
      if (!node || !map || !mini || !session.planner) return;
      const place = (ev) => {
        const rect = mini.getBoundingClientRect();
        const sx = ((ev.clientX - rect.left) / rect.width) * map.w;
        const sy = ((ev.clientY - rect.top) / rect.height) * map.h;
        const worldX = (sx - map.ox) / map.scale;
        const worldY = (sy - map.oy) / map.scale;
        const plan = $("planner-plan");
        const fit = plannerFit(plan, node.points);
        const cam = plannerCam();
        const k = cam.k || 1;
        const w = plan.clientWidth;
        const h = plan.clientHeight;
        cam.x = w / 2 - worldX * fit.scale * k - ((fit.ox - w / 2) * k + w / 2);
        cam.y = h / 2 - worldY * fit.scale * k - ((fit.oy - h / 2) * k + h / 2);
        plannerDraw();
      };
      place(e);
      mini.setPointerCapture(e.pointerId);
      const move = (ev) => place(ev);
      const up = () => {
        mini.removeEventListener("pointermove", move);
        mini.removeEventListener("pointerup", up);
      };
      mini.addEventListener("pointermove", move);
      mini.addEventListener("pointerup", up);
    });
    plan?.addEventListener("wheel", (e) => {
      const node = plannerNode();
      if (!node || !session.planner) return;
      e.preventDefault();
      const cam = plannerCam();
      const rect = plan.getBoundingClientRect();
      const sx = e.clientX - rect.left;
      const sy = e.clientY - rect.top;
      const world = plannerView(plan, node.points).from(sx, sy);
      cam.k = Math.max(0.2, Math.min(12, cam.k * (e.deltaY > 0 ? 1 / 1.12 : 1.12)));
      const fit = plannerFit(plan, node.points);
      const k = cam.k;
      cam.x = sx - ((fit.ox - rect.width / 2) * k + rect.width / 2) - world.x * fit.scale * k;
      cam.y = sy - ((fit.oy - rect.height / 2) * k + rect.height / 2) - world.y * fit.scale * k;
      plannerDraw();
    }, { passive: false });
    plan?.addEventListener("pointerdown", (e) => {
      if (e.button !== 0 && e.button !== 1) return;
      const node = plannerNode();
      if (!node || !session.planner) return;
      const hit = plannerHit(plan, node, e.clientX, e.clientY);
      const cam = plannerCam();
      if (e.button === 1 || (!hit.pointId && !hit.wallId)) {
        session.planner.viewLock = null;
        session.planner.drag = { pan: true, x: e.clientX, y: e.clientY, ox: cam.x, oy: cam.y };
        plan.setPointerCapture(e.pointerId);
        return;
      }
      if (e.button !== 0) return;
      session.planner.viewLock = plannerView(plan, node.points);
      if (hit.pointId) {
        const point = node.points.find((p) => p.id === hit.pointId);
        session.planner.drag = {
          id: hit.pointId,
          x: e.clientX,
          y: e.clientY,
          ox: point?.x || 0,
          oy: point?.y || 0,
          moved: false,
        };
        session.planner.sel = { kind: "point", id: hit.pointId };
      } else if (hit.wallId) {
        session.planner.drag = null;
        session.planner.sel = { kind: "wall", id: hit.wallId };
      } else session.planner.drag = null;
      plan.setPointerCapture(e.pointerId);
      plannerDraw();
    });
    plan?.addEventListener("pointermove", (e) => {
      const node = plannerNode();
      const drag = session.planner?.drag;
      if (drag?.pan && session.planner) {
        const cam = plannerCam();
        cam.x = drag.ox + (e.clientX - drag.x);
        cam.y = drag.oy + (e.clientY - drag.y);
        plannerDraw();
        return;
      }
      if (!node || !drag) {
        const hit = node ? plannerHit(plan, node, e.clientX, e.clientY) : null;
        if (plan) plan.style.cursor = hit?.pointId ? "grab" : hit?.wallId ? "pointer" : "default";
        return;
      }
      if (!drag.moved && Math.hypot(e.clientX - drag.x, e.clientY - drag.y) < 4) return;
      drag.moved = true;
      const view = session.planner.viewLock || plannerView(plan, node.points);
      const rect = plan.getBoundingClientRect();
      const world = view.from(e.clientX - rect.left, e.clientY - rect.top);
      const next = plannerSnap(node, drag.id, world.x, world.y, e.shiftKey, { x: drag.ox, y: drag.oy });
      if (!next) return;
      const point = node.points.find((p) => p.id === drag.id);
      if (!point) return;
      point.x = next.x;
      point.y = next.y;
      plannerDraw();
    });
    const endDrag = () => {
      const drag = session.planner?.drag;
      if (!session.planner) return;
      session.planner.drag = null;
      session.planner.viewLock = null;
      if (drag?.pan) plannerDraw();
      else if (drag?.moved) plannerCommit(false);
      else plannerDraw();
    };
    plan?.addEventListener("pointerup", endDrag);
    plan?.addEventListener("pointercancel", endDrag);
    plan?.addEventListener("dblclick", (e) => {
      const node = plannerNode();
      if (!node || node.points.length >= PLANNER_MAX_PTS) return;
      const hit = plannerHit(plan, node, e.clientX, e.clientY);
      if (!hit.wallId) return;
      const id = plannerInsertCorner(node, hit.wallId, hit.world);
      if (!id) return;
      session.planner.sel = { kind: "point", id };
      plannerCommit(true);
    });
    plan?.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      const node = plannerNode();
      if (!node || !session.planner) return;
      const hit = plannerHit(plan, node, e.clientX, e.clientY);
      if (!hit.pointId && !hit.wallId) {
        plannerHideNudge();
        plannerDraw();
        return;
      }
      session.planner.sel = hit.pointId ? { kind: "point", id: hit.pointId } : { kind: "wall", id: hit.wallId };
      session.planner.nudge = {
        kind: hit.pointId ? "point" : "wall",
        id: hit.pointId || hit.wallId,
        dir: "",
      };
      const box = document.querySelector("#planner-nudge .planner-nudge-box");
      const input = $("planner-nudge-input");
      if (box) {
        box.hidden = true;
        box.classList.remove("is-bad");
      }
      if (input) input.value = "";
      plannerDraw();
    });
    const nudge = $("planner-nudge");
    nudge?.addEventListener("contextmenu", (e) => e.preventDefault());
    nudge?.addEventListener("pointerdown", (e) => e.stopPropagation());
    nudge?.addEventListener("click", (e) => {
      const dir = e.target.closest("[data-dir]")?.dataset.dir || "";
      const current = session.planner?.nudge;
      if (!dir || !current || !PLANNER_NUDGE_DIRS[dir]) return;
      current.dir = dir;
      const box = nudge.querySelector(".planner-nudge-box");
      if (box) {
        box.hidden = false;
        box.classList.remove("is-bad");
      }
      plannerPlaceNudge();
      const input = $("planner-nudge-input");
      input?.focus();
      input?.select();
    });
    nudge?.querySelector("form")?.addEventListener("submit", (e) => {
      e.preventDefault();
      plannerNudgeSubmit();
    });
    modal.addEventListener("pointerdown", (e) => {
      if (!session.planner?.nudge || e.target.closest("#planner-nudge")) return;
      plannerHideNudge();
    });
    unfoldHit(modal);
    if (window.ResizeObserver) {
      const stage = modal.querySelector(".planner-stage");
      if (stage) new ResizeObserver(() => {
        if (session.planner?.id && modal.classList.contains("open") && !session.planner.drag) plannerDraw();
      }).observe(stage);
    }
  }

  function unfoldHit(modal) {
    const unfold = modal.querySelector("#planner-unfold");
    unfold?.addEventListener("pointerdown", (e) => {
      const node = plannerNode();
      if (!node || !session.planner || e.button !== 0) return;
      const rect = unfold.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      const hit = (session.planner.hits || []).find((item) => x >= item.x && x <= item.x + item.w && y >= item.y && y <= item.y + item.h);
      if (!hit) return;
      plannerSelect({ kind: "wall", id: hit.id }, true);
    });
  }

  function plannerDeleteSelected() {
    const node = plannerNode();
    const sel = session.planner?.sel;
    if (!node || sel?.kind !== "point") return;
    if (!plannerDeleteCorner(node, sel.id)) return;
    session.planner.sel = null;
    plannerCommit(true);
  }

  async function plannerAskRect() {
    const node = plannerNode();
    if (!node || plannerRect(node.points)) return;
    const ok = api?.confirm
      ? await api.confirm({
          title: "Сделать прямоугольником?",
          text: "Текущий план заменится прямоугольником с шириной и глубиной из полей. Лишние углы пропадут.",
          ok: "Заменить",
          danger: true,
        })
      : true;
    if (!ok || !plannerNode()) return;
    plannerMakeRect(node, plannerDraft($("planner-width")?.value) ?? 4, plannerDraft($("planner-depth")?.value) ?? 3);
    if (session.planner) session.planner.sel = null;
    plannerCommit(true);
  }

  function openPlanner(nodeId) {
    const bp = activeBlueprint();
    const node = bp?.nodes.find((item) => item.id === nodeId && item.type === "planner");
    if (!node) return;
    ensurePlannerModal();
    ensurePlanner(node);
    session.planner = { id: nodeId, sel: null, drag: null, viewLock: null, hits: [], touched: false, nudge: null };
    plannerHideNudge();
    session.selected = nodeId;
    hidePortMenu();
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
    $("planner-modal")?.classList.add("open");
    editorBegin();
    requestAnimationFrame(() => plannerFill());
  }

  function closePlanner() {
    const node = plannerNode();
    if (node) node.name = plannerName(node);
    editorEnd();
    plannerHideNudge();
    session.planner = null;
    $("planner-modal")?.classList.remove("open");
    if (api?.view?.() === "calculator") render();
  }

  const PLAN_PORT = "plan";
  const PIPE_MM = [16, 20, 25, 32, 40, 50, 63, 75, 90, 110, 125, 160];
  const SOCKET_BUILTIN = [
    { id: "socket", name: "Розетка", letters: "Р", color: "#f59e0b", size: 80 },
    { id: "switch", name: "Выключатель", letters: "В", color: "#38bdf8", size: 80 },
    { id: "switch2", name: "Двойной выключатель", letters: "ДВ", color: "#22d3ee", size: 80 },
    { id: "pass", name: "Проходной выключатель", letters: "ПВ", color: "#818cf8", size: 80 },
    { id: "lan", name: "Интернет", letters: "И", color: "#34d399", size: 80 },
    { id: "tv", name: "ТВ", letters: "ТВ", color: "#fb7185", size: 80 },
  ];
  const LIGHT_BUILTIN = [
    { id: "chandelier", name: "Люстра", shape: "diamond", color: "#facc15", size: 180 },
    { id: "spot", name: "Спот", shape: "circle", color: "#fde68a", size: 60 },
    { id: "rect", name: "Прямоугольник", shape: "rect", color: "#fde68a", size: 120 },
    { id: "line", name: "Линейный", shape: "line", color: "#fef08a", size: 40 },
  ];

  function portSignal(node, portId) {
    if (!node) return "num";
    const id = String(portId || "");
    if (node.type === "planner" && (id === "plan" || id.startsWith("plan:"))) return "plan";
    if ((node.type === "openings" || node.type === "electrics") && id === PLAN_PORT) return "plan";
    return "num";
  }

  function markHex(value, fallback) {
    const color = String(value || "").trim().toLowerCase();
    return /^#[0-9a-f]{6}$/.test(color) ? color : fallback;
  }

  function markLetters(value) {
    return String(value || "").trim().slice(0, 3);
  }

  function customTypeList(kind) {
    const calc = ensureState();
    const key = kind === "light" ? "lightTypes" : "socketTypes";
    if (!calc) return [];
    if (!Array.isArray(calc[key])) calc[key] = [];
    const list = [];
    calc[key].forEach((raw) => {
      if (!raw || typeof raw !== "object" || list.length >= 40) return;
      let id = String(raw.id || "").trim();
      if (!id || list.some((item) => item.id === id)) id = `c-${uid()}`;
      const name = String(raw.name || "").trim().slice(0, 32);
      if (!name) return;
      if (kind === "light") {
        const shape = ["square", "diamond", "rect", "line"].includes(raw.shape) ? raw.shape : "circle";
        list.push({
          id,
          name,
          shape,
          color: markHex(raw.color, "#facc15"),
          size: Math.round(plannerClamp(plannerNum(raw.size, 120), 20, 800)),
        });
        return;
      }
      const letters = markLetters(raw.letters);
      if (!letters) return;
      list.push({
        id,
        name,
        letters,
        color: markHex(raw.color, "#a78bfa"),
        size: Math.round(plannerClamp(plannerNum(raw.size, 80), 20, 400)),
      });
    });
    calc[key] = list;
    return list;
  }

  function markLabels() {
    const calc = ensureState();
    if (!calc) return {};
    if (!calc.labels || typeof calc.labels !== "object") calc.labels = {};
    return calc.labels;
  }

  function markLabel(key, fallback) {
    const value = String(markLabels()[key] || "").trim();
    return value || fallback;
  }

  function openingCounterLabel(node, key, fallback) {
    const custom = String(node?.counterNames?.[key] || "").trim();
    return custom || markLabel(key, fallback);
  }

  function cardNameInput(id, kind, current, fallback) {
    return `<input class="mark-inline-name" data-card-name="${esc(id)}" data-card-kind="${kind}" data-label-fallback="${esc(fallback)}" maxlength="48" value="${esc(current || fallback)}" aria-label="Имя карточки" />`;
  }

  function typeOff() {
    const calc = ensureState();
    if (!calc) return [];
    if (!Array.isArray(calc.typeOff)) calc.typeOff = [];
    const allowed = new Set([
      ...SOCKET_BUILTIN.map((type) => `socket:${type.id}`),
      ...LIGHT_BUILTIN.map((type) => `light:${type.id}`),
    ]);
    calc.typeOff = calc.typeOff.filter((key, index) => allowed.has(key) && calc.typeOff.indexOf(key) === index).slice(0, 20);
    return calc.typeOff;
  }

  function presetCatalog(kind) {
    const builtins = kind === "light" ? LIGHT_BUILTIN : SOCKET_BUILTIN;
    const prefix = kind === "light" ? "light:" : "socket:";
    const off = new Set(typeOff());
    const stored = customTypeList(kind);
    const builtinIds = new Set(builtins.map((item) => item.id));
    const seeded = stored.some((item) => builtinIds.has(item.id));
    const out = [];
    const addBuiltin = (item) => {
      if (off.has(prefix + item.id) || out.some((row) => row.id === item.id)) return;
      out.push({ ...item, name: markLabel(prefix + item.id, item.name) });
    };
    if (seeded) {
      stored.forEach((item) => {
        if (off.has(prefix + item.id)) return;
        const builtin = builtins.find((row) => row.id === item.id);
        out.push(builtin ? { ...builtin, ...item, name: item.name || markLabel(prefix + item.id, builtin.name) } : item);
      });
      builtins.forEach(addBuiltin);
    } else {
      builtins.forEach(addBuiltin);
      stored.forEach((item) => {
        if (!builtinIds.has(item.id)) out.push(item);
      });
    }
    return out;
  }

  function savePresetList(kind, list) {
    const calc = ensureState();
    if (!calc) return;
    const key = kind === "light" ? "lightTypes" : "socketTypes";
    calc[key] = list.slice(0, 40).map((item) => (
      kind === "light"
        ? {
          id: item.id,
          name: String(item.name || "").trim().slice(0, 32),
          shape: ["square", "diamond", "rect", "line", "circle"].includes(item.shape) ? item.shape : "circle",
          color: markHex(item.color, "#facc15"),
          size: Math.round(plannerClamp(plannerNum(item.size, 120), 20, 800)),
        }
        : {
          id: item.id,
          name: String(item.name || "").trim().slice(0, 32),
          letters: markLetters(item.letters),
          color: markHex(item.color, "#a78bfa"),
          size: Math.round(plannerClamp(plannerNum(item.size, 80), 20, 400)),
        }
    )).filter((item) => item.id && item.name && (kind === "light" || item.letters));
  }

  function patchPreset(kind, id, patch) {
    const list = presetCatalog(kind).map((item) => (item.id === id ? { ...item, ...patch } : item));
    savePresetList(kind, list);
  }

  function movePreset(kind, id, targetId, before) {
    const list = presetCatalog(kind);
    const from = list.findIndex((item) => item.id === id);
    if (from < 0 || id === targetId) return;
    const [item] = list.splice(from, 1);
    let to = list.findIndex((row) => row.id === targetId);
    if (to < 0) to = list.length;
    else if (!before) to += 1;
    list.splice(to, 0, item);
    savePresetList(kind, list);
  }

  function socketCatalog() {
    return presetCatalog("socket");
  }

  function lightCatalog() {
    return presetCatalog("light");
  }

  function socketById(id) {
    return socketCatalog().find((item) => item.id === id) || SOCKET_BUILTIN.find((item) => item.id === id) || null;
  }

  function lightById(id) {
    return lightCatalog().find((item) => item.id === id) || LIGHT_BUILTIN.find((item) => item.id === id) || null;
  }

  function dropPreset(kind, id) {
    const calc = ensureState();
    if (!calc || !id) return;
    const key = kind === "light" ? "lightTypes" : "socketTypes";
    calc[key] = (calc[key] || []).filter((item) => item && item.id !== id);
    const builtins = kind === "light" ? LIGHT_BUILTIN : SOCKET_BUILTIN;
    if (builtins.some((item) => item.id === id)) {
      const mark = `${kind}:${id}`;
      if (!typeOff().includes(mark)) calc.typeOff.push(mark);
    }
  }

  function blueprintOf(node) {
    const calc = ensureState();
    return (calc?.blueprints || []).find((bp) => (bp.nodes || []).some((item) => item.id === node?.id)) || activeBlueprint();
  }

  function planWallName(plan, wall, index) {
    return plan?.wallNames?.[wall.id] || `Стена ${index + 1}`;
  }

  function emitPlan(node, bp, stack, values, fromPort) {
    if (!node || !bp) return null;
    const chain = stack || [];
    if (chain.includes(node.id)) return null;
    const next = chain.concat(node.id);
    if (node.type === "planner") {
      ensurePlanner(node);
      const layout = (node.layouts || []).find((item) => plannerPort(item, "plan") === fromPort) || plannerActive(node);
      if (!layout) return null;
      const walls = plannerWalls(layout);
      const wallNames = {};
      walls.forEach((wall, index) => {
        const out = (layout.outs || []).find((item) => item.id === wall.id);
        wallNames[wall.id] = plannerWallName(out, index);
      });
      return {
        height: layout.height,
        color: markHex(layout.color || node.color, "#65a30d"),
        points: layout.points.map((p) => ({ id: p.id, x: p.x, y: p.y })),
        wallNames,
        openings: [],
      };
    }
    if (node.type === "openings") {
      ensureOpenings(node);
      const base = upstreamPlan(node, bp, next, values);
      if (!base) return null;
      const holes = node.holes.map((hole) => resolveHole(hole, base, node, values));
      return {
        height: base.height,
        color: base.color,
        points: base.points.map((p) => ({ id: p.id, x: p.x, y: p.y })),
        wallNames: base.wallNames,
        openings: (base.openings || []).concat(holes),
      };
    }
    return null;
  }

  function upstreamPlan(node, bp, stack, values) {
    const link = (bp?.links || []).find((item) => item.to === node?.id && item.toPort === PLAN_PORT);
    if (!link) return null;
    const src = (bp.nodes || []).find((item) => item.id === link.from);
    if (!src || portSignal(src, link.fromPort) !== "plan") return null;
    return emitPlan(src, bp, stack || [], values || {}, link.fromPort);
  }

  function resolveHole(raw, plan, node, values) {
    const hole = {
      id: raw.id,
      name: String(raw.name || "").trim().slice(0, 48),
      surface: raw.surface === "floor" || raw.surface === "ceiling" ? raw.surface : "wall",
      wallId: String(raw.wallId || ""),
      along: plannerNum(raw.along, 0),
      rise: plannerNum(raw.rise, 0),
      x: plannerNum(raw.x, 0),
      y: plannerNum(raw.y, 0),
      w: plannerNum(raw.w, 0.9),
      h: plannerNum(raw.h, 2.1),
      d: plannerNum(raw.d, 0.11),
      picked: raw.picked !== false,
      shape: raw.shape === "circle" ? "circle" : "rect",
      local: true,
    };
    const read = (field) => {
      if (!raw.bind?.[field] || !node) return null;
      const value = values?.[`${node.id}:b:${raw.id}:${field}`];
      return Number.isFinite(value) ? value : null;
    };
    if (hole.shape === "circle") {
      const mm = read("d");
      if (mm != null) hole.d = plannerClamp(mm / 1000, 0.005, 5);
    } else {
      const width = read("w");
      const height = read("h");
      if (width != null) hole.w = plannerClamp(width, 0.05, 500);
      if (height != null) hole.h = plannerClamp(height, 0.05, 30);
    }
    const walls = plan ? plannerWalls(plan) : [];
    const wall = walls.find((item) => item.id === hole.wallId) || null;
    const roomH = plan?.height || 2.7;
    if (hole.surface === "wall" && wall) {
      if (hole.shape === "circle") {
        hole.along = plannerClamp(hole.along, 0, wall.len);
        hole.rise = plannerClamp(hole.rise, 0, roomH);
      } else {
        hole.w = plannerClamp(hole.w, 0.05, wall.len);
        hole.h = plannerClamp(hole.h, 0.05, roomH);
        if (hole.along < 0) hole.along = 0;
        if (hole.rise < 0) hole.rise = 0;
        if (hole.along + hole.w > wall.len + 0.0001) hole.along = Math.max(0, wall.len - hole.w);
        if (hole.rise + hole.h > roomH + 0.0001) hole.rise = Math.max(0, roomH - hole.h);
        if (hole.rise <= 0.02) hole.rise = 0;
      }
    }
    hole.along = plannerRound(hole.along);
    hole.rise = plannerRound(hole.rise);
    hole.x = plannerRound(hole.x);
    hole.y = plannerRound(hole.y);
    hole.w = plannerRound(hole.w);
    hole.h = plannerRound(hole.h);
    hole.d = plannerRound(hole.d);
    if (hole.shape === "circle") hole.role = "pipe";
    else if (hole.surface === "wall" && hole.rise <= 0.02) hole.role = "door";
    else if (hole.surface === "wall") hole.role = "window";
    else hole.role = "hatch";
    return hole;
  }

  function rectOverlap(ax, ay, aw, ah, bx, by, bw, bh) {
    const x0 = Math.max(ax, bx);
    const y0 = Math.max(ay, by);
    const x1 = Math.min(ax + aw, bx + bw);
    const y1 = Math.min(ay + ah, by + bh);
    if (x1 <= x0 || y1 <= y0) return 0;
    return (x1 - x0) * (y1 - y0);
  }

  function circleInRect(cx, cy, r, x0, y0, x1, y1) {
    if (!(r > 0)) return 0;
    const n = 24;
    const step = (r * 2) / n;
    let hit = 0;
    for (let i = 0; i < n; i += 1) {
      for (let j = 0; j < n; j += 1) {
        const x = cx - r + (i + 0.5) * step;
        const y = cy - r + (j + 0.5) * step;
        if ((x - cx) * (x - cx) + (y - cy) * (y - cy) > r * r) continue;
        if (x >= x0 && x <= x1 && y >= y0 && y <= y1) hit += 1;
      }
    }
    return hit * step * step;
  }

  function wallRemain(wall, height, holes) {
    const mine = (holes || []).filter((hole) => hole.surface === "wall" && hole.wallId === wall.id);
    const full = mine.filter((hole) => hole.role === "door" && hole.along <= 0.03 && hole.w >= wall.len - 0.03);
    const cut = (hole, y0, y1) => {
      if (hole.shape === "circle") return circleInRect(hole.along, hole.rise, hole.d / 2, 0, y0, wall.len, y1);
      return rectOverlap(hole.along, hole.rise, hole.w, hole.h, 0, y0, wall.len, y1 - y0);
    };
    if (full.length) {
      const top = Math.max(...full.map((hole) => Math.min(height, hole.rise + hole.h)));
      let area = wall.len * Math.max(0, height - top);
      mine.forEach((hole) => {
        if (full.includes(hole)) return;
        area -= cut(hole, top, height);
      });
      return Math.max(0, plannerRound(area));
    }
    let area = wall.len * height;
    mine.forEach((hole) => {
      area -= cut(hole, 0, height);
    });
    return Math.max(0, plannerRound(area));
  }

  function markToneInputs() {
    return "";
  }

  function markRotateHue(value, shift) {
    const hex = markHex(value, "#65a30d");
    const r = parseInt(hex.slice(1, 3), 16) / 255;
    const g = parseInt(hex.slice(3, 5), 16) / 255;
    const b = parseInt(hex.slice(5, 7), 16) / 255;
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const delta = max - min;
    let h = 0;
    if (delta) {
      if (max === r) h = 60 * (((g - b) / delta) % 6);
      else if (max === g) h = 60 * ((b - r) / delta + 2);
      else h = 60 * ((r - g) / delta + 4);
    }
    h = (h + shift + 360) % 360;
    const l = (max + min) / 2;
    const sat = delta ? delta / (1 - Math.abs(2 * l - 1)) : 0;
    const c = (1 - Math.abs(2 * l - 1)) * sat;
    const x = c * (1 - Math.abs((h / 60) % 2 - 1));
    const m = l - c / 2;
    const rgb = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
    return "#" + rgb.map((v) => Math.round((v + m) * 255).toString(16).padStart(2, "0")).join("");
  }

  function markTones(node, plannerColor) {
    const floor = markHex(plannerColor, "#65a30d");
    return { floor, ceiling: markRotateHue(floor, 120), wall: markRotateHue(floor, 240) };
  }

  function ensureOpenings(node) {
    delete node.tones;
    delete node.color;
    if (!Array.isArray(node.holes)) node.holes = [];
    const holes = [];
    node.holes.forEach((raw) => {
      if (!raw || typeof raw !== "object" || holes.length >= 80) return;
      let id = String(raw.id || "").trim();
      if (!id || holes.some((item) => item.id === id)) id = uid();
      const shape = raw.shape === "circle" ? "circle" : "rect";
      const surface = raw.surface === "floor" || raw.surface === "ceiling" ? raw.surface : "wall";
      holes.push({
        id,
        surface,
        wallId: String(raw.wallId || ""),
        along: plannerRound(plannerClamp(plannerNum(raw.along, 0.4), -500, 500)),
        rise: plannerRound(plannerClamp(plannerNum(raw.rise, 0), -500, 500)),
        x: plannerRound(plannerClamp(plannerNum(raw.x, 0), -500, 500)),
        y: plannerRound(plannerClamp(plannerNum(raw.y, 0), -500, 500)),
        w: plannerRound(plannerClamp(plannerNum(raw.w, 0.9), 0.05, 500)),
        h: plannerRound(plannerClamp(plannerNum(raw.h, 2.1), 0.05, 30)),
        d: plannerRound(plannerClamp(plannerNum(raw.d, 0.11), 0.005, 5)),
        shape,
        bind: { w: !!raw.bind?.w, h: !!raw.bind?.h, d: !!raw.bind?.d },
        picked: raw.picked !== false,
        name: String(raw.name || "").trim().slice(0, 48),
      });
    });
    node.holes = holes;
    if (!node.counterNames || typeof node.counterNames !== "object" || Array.isArray(node.counterNames)) node.counterNames = {};
    if (!Array.isArray(node.owns)) node.owns = [];
    if (!node.outOn || typeof node.outOn !== "object") {
      node.outOn = { "count:pick": true, "count:door": true, "count:window": true, "count:pipe": true, "count:hatch": true };
    }
    node.name = String(node.name || "").trim().slice(0, 48) || "Проёмы";
    return node;
  }

  function ensureElectrics(node) {
    delete node.tones;
    delete node.color;
    if (!Array.isArray(node.fixtures)) node.fixtures = [];
    const list = [];
    node.fixtures.forEach((raw) => {
      if (!raw || typeof raw !== "object" || list.length >= 120) return;
      let id = String(raw.id || "").trim();
      if (!id || list.some((item) => item.id === id)) id = uid();
      const kind = raw.kind === "light" ? "light" : "socket";
      const surface = raw.surface === "floor" || raw.surface === "ceiling" ? raw.surface : "wall";
      const cells = [];
      (Array.isArray(raw.cells) ? raw.cells : ["socket"]).forEach((cell) => {
        const key = String(cell || "").trim();
        if (key && cells.length < 6) cells.push(key);
      });
      if (!cells.length) cells.push("socket");
      list.push({
        id,
        kind,
        surface,
        wallId: String(raw.wallId || ""),
        along: plannerRound(plannerClamp(plannerNum(raw.along, 0.5), -500, 500)),
        rise: plannerRound(plannerClamp(plannerNum(raw.rise, 0.3), -500, 500)),
        x: plannerRound(plannerClamp(plannerNum(raw.x, 0), -500, 500)),
        y: plannerRound(plannerClamp(plannerNum(raw.y, 0), -500, 500)),
        orient: raw.orient === "v" ? "v" : "h",
        cells,
        light: String(raw.light || "chandelier"),
        name: String(raw.name || "").trim().slice(0, 48),
        lw: plannerRound(plannerClamp(plannerNum(raw.lw, 0.6), 0.05, 8)),
        ll: plannerRound(plannerClamp(plannerNum(raw.ll, 1.2), 0.05, 12)),
        angle: lightAngle(raw),
      });
    });
    node.fixtures = list;
    if (!node.outOn || typeof node.outOn !== "object") node.outOn = {};
    node.name = String(node.name || "").trim().slice(0, 48) || "Электрика";
    return node;
  }

  function markShown(node, id, linked, present) {
    if (linked?.has(id)) return true;
    if (node.outOn && Object.prototype.hasOwnProperty.call(node.outOn, id)) return !!node.outOn[id];
    return !!present;
  }

  function markChecked(node, id, fallback) {
    if (node.outOn && Object.prototype.hasOwnProperty.call(node.outOn, id)) return !!node.outOn[id];
    return !!fallback;
  }

  function holeLabel(hole, index) {
    const custom = String(hole.name || "").trim();
    if (custom) return custom;
    const role = hole.shape === "circle" || hole.role === "pipe" ? "Труба" : hole.rise <= 0.02 && hole.surface !== "floor" && hole.surface !== "ceiling" ? "Дверь" : hole.surface === "wall" ? "Окно" : "Люк";
    return `${role} ${index + 1}`;
  }

  function openingInputs(node) {
    ensureOpenings(node);
    const ports = [{ id: PLAN_PORT, name: "Чертёж", signal: "plan" }];
    node.holes.forEach((hole, index) => {
      const fields = hole.shape === "circle" ? [["d", "диаметр, мм"]] : [["w", "ширина, м"], ["h", "высота, м"]];
      fields.forEach(([field, title]) => {
        if (!hole.bind?.[field]) return;
        ports.push({ id: `b:${hole.id}:${field}`, name: `${holeLabel(hole, index)} · ${title}` });
      });
    });
    return ports;
  }

  function openingOutputs(node, bp, values, links) {
    ensureOpenings(node);
    const host = bp || blueprintOf(node);
    const plan = host ? emitPlan(node, host, [], values || {}) : null;
    const linked = linkedFromPorts(node.id, links || host?.links || []);
    const ports = [{ id: PLAN_PORT, name: "Чертёж", signal: "plan" }];
    const walls = plan ? plannerWalls(plan) : [];
    walls.forEach((wall, index) => {
      const id = `wall:${wall.id}`;
      if (!markShown(node, id, linked, false)) return;
      ports.push({
        id,
        name: planWallName(plan, wall, index),
        value: wallRemain(wall, plan.height, plan.openings),
        unit: "м²",
      });
    });
    const holes = plan?.openings || [];
    [
      ["count:pick", openingCounterLabel(node, "pick", "Проёмы"), holes.filter((hole) => hole.picked !== false).length, true],
      ["count:door", openingCounterLabel(node, "doors", "Двери"), holes.filter((hole) => hole.role === "door").length, true],
      ["count:window", openingCounterLabel(node, "windows", "Окна"), holes.filter((hole) => hole.role === "window").length, true],
      ["count:pipe", openingCounterLabel(node, "pipes", "Трубы"), holes.filter((hole) => hole.role === "pipe").length, true],
      ["count:hatch", openingCounterLabel(node, "hatches", "Люки"), holes.filter((hole) => hole.role === "hatch").length, true],
    ].forEach(([id, name, value, present]) => {
      if (!markShown(node, id, linked, present)) return;
      ports.push({ id, name, value, unit: "шт" });
    });
    (node.owns || []).forEach((own) => {
      const id = `own:${own.id}`;
      const have = new Set((node.holes || []).map((hole) => hole.id));
      const value = (own.holes || []).filter((holeId) => have.has(holeId)).length;
      if (!markShown(node, id, linked, true)) return;
      ports.push({ id, name: String(own.name || "Свой").slice(0, 48), value, unit: "шт" });
    });
    return ports;
  }

  function frameKey(fix) {
    return String(Math.max(1, (fix.cells || []).length));
  }

  function frameLabel(fix) {
    return `${markLabel("frame", "Рамка")} · ${frameKey(fix)}`;
  }

  function electricOutputs(node, bp, values, links) {
    ensureElectrics(node);
    const host = bp || blueprintOf(node);
    const linked = linkedFromPorts(node.id, links || host?.links || []);
    const ports = [];
    const counts = new Map();
    const frames = new Map();
    node.fixtures.forEach((fix) => {
      if (fix.kind === "light") return;
      const key = frameKey(fix);
      if (!frames.has(key)) frames.set(key, { id: `frame:${key}`, name: frameLabel(fix), value: 0 });
      frames.get(key).value += 1;
      (fix.cells || []).forEach((typeId) => {
        const type = socketById(typeId);
        const id = `type:${typeId}`;
        if (!counts.has(id)) counts.set(id, { id, name: type?.name || "Розетка", value: 0 });
        counts.get(id).value += 1;
      });
    });
    counts.forEach((row) => {
      if (markShown(node, row.id, linked, row.value > 0)) ports.push({ ...row, unit: "шт" });
    });
    [...frames.values()]
      .sort((a, b) => Number(a.id.slice(6)) - Number(b.id.slice(6)))
      .forEach((row) => {
        if (markShown(node, row.id, linked, row.value > 0)) ports.push({ ...row, unit: "шт" });
      });
    return ports;
  }

  function markNodeTitle(node) {
    if (!node) return "Нода";
    if (node.type === "planner") return plannerName(node);
    if (node.type === "openings") return node.name || "Проёмы";
    if (node.type === "electrics") return node.name || "Электрика";
    if (node.type === "const") return "Константа";
    if (node.type === "result") return node.name || "Результат";
    if (node.type === "math") return "Оператор";
    if (node.type === "formula") return "Формула";
    if (node.type === "percent") return "Процент";
    if (node.type === "filter") return "Фильтр";
    if (node.type === "dashboard") return "Дашборд";
    if (node.type === "order") return "Заказ";
    if (node.type === "scheme") return "Схема";
    return "Нода";
  }

  function planPortRow(io) {
    const side = io === "in" ? "in" : "out";
    return `<div class="calc-row ${side}">
      ${side === "in" ? `<i class="calc-port in" data-port="plan" data-io="in" data-signal="plan" title="Чертёж"></i>` : ""}
      <span class="calc-row-name">Чертёж</span>
      ${side === "out" ? `<b class="calc-plan-tag">план</b><i class="calc-port out" data-port="plan" data-io="out" data-signal="plan" title="Чертёж"></i>` : ""}
    </div>`;
  }

  function countRows(node, ports, graph) {
    return (ports || [])
      .filter((port) => port.signal !== "plan")
      .map((port) => {
        const value = graph?.values?.[`${node.id}:${port.id}`];
        const shown = value != null && Number.isFinite(value) ? value : port.value;
        const unit = port.unit || "";
        return `<div class="calc-row out">
          <span class="calc-row-name" title="${esc(port.name)}">${esc(port.name)}</span>
          <b>${esc(fmtShort(shown))}${unit ? ` <small>${esc(unit)}</small>` : ""}</b>
          <i class="calc-port out" data-port="${esc(port.id)}" data-io="out" title="${esc(port.name)}"></i>
        </div>`;
      })
      .join("");
  }

  function filmItems(plan) {
    const walls = plannerWalls(plan);
    return [{ id: "floor", name: "Пол" }, { id: "ceiling", name: "Потолок" }].concat(
      walls.map((wall, index) => ({ id: wall.id, name: planWallName(plan, wall, index), wall }))
    );
  }

  function surfaceThumb(plan, item, holes, fixtures, tones) {
    const vw = 64;
    const vh = 46;
    const pad = 3;
    if (!plan?.points?.length) return "";
    if (item.id === "floor" || item.id === "ceiling") {
      let minX = Infinity;
      let minY = Infinity;
      let maxX = -Infinity;
      let maxY = -Infinity;
      plan.points.forEach((p) => {
        minX = Math.min(minX, p.x);
        minY = Math.min(minY, p.y);
        maxX = Math.max(maxX, p.x);
        maxY = Math.max(maxY, p.y);
      });
      const spanX = Math.max(0.05, maxX - minX);
      const spanY = Math.max(0.05, maxY - minY);
      const scale = Math.min((vw - pad * 2) / spanX, (vh - pad * 2) / spanY);
      const ox = (vw - spanX * scale) / 2 - minX * scale;
      const oy = (vh - spanY * scale) / 2 - minY * scale;
      const d = plan.points
        .map((p, i) => `${i ? "L" : "M"}${(ox + p.x * scale).toFixed(1)} ${(oy + p.y * scale).toFixed(1)}`)
        .join("") + "Z";
      const marks = (holes || [])
        .filter((hole) => hole.surface === item.id)
        .map((hole) => {
          const x = ox + (hole.x + (hole.shape === "circle" ? 0 : hole.w / 2)) * scale;
          const y = oy + (hole.y + (hole.shape === "circle" ? 0 : hole.h / 2)) * scale;
          return `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="2.2"/>`;
        })
        .join("");
      const lights = (fixtures || [])
        .filter((fix) => fix.surface === item.id)
        .map((fix) => `<circle cx="${(ox + fix.x * scale).toFixed(1)}" cy="${(oy + fix.y * scale).toFixed(1)}" r="2.4"/>`)
        .join("");
      const tone = item.id === "ceiling" ? (tones?.ceiling || "var(--mark-ceiling, #eab308)") : (tones?.floor || "var(--mark-floor, #38bdf8)");
      return `<svg class="calc-film-thumb" style="--film-tone:${tone}" viewBox="0 0 ${vw} ${vh}" preserveAspectRatio="xMidYMid meet" aria-hidden="true"><path d="${d}"/>${marks}${lights}</svg>`;
    }
    const wall = item.wall;
    if (!wall) return "";
    const len = Math.max(wall.len, 0.2);
    const height = Math.max(plan.height || 2.7, 0.2);
    const scale = Math.min((vw - pad * 2) / len, (vh - pad * 2) / height);
    const ox = (vw - len * scale) / 2;
    const oy = (vh - height * scale) / 2;
    const at = (along, rise) => ({ x: ox + along * scale, y: oy + (height - rise) * scale });
    const cuts = (holes || [])
      .filter((hole) => hole.surface === "wall" && hole.wallId === wall.id)
      .map((hole) => {
        if (hole.shape === "circle") {
          const c = at(hole.along, hole.rise);
          return `<circle cx="${c.x.toFixed(1)}" cy="${c.y.toFixed(1)}" r="${Math.max(1.6, (hole.d / 2) * scale).toFixed(1)}"/>`;
        }
        const p = at(hole.along, hole.rise + hole.h);
        const q = at(hole.along + hole.w, hole.rise);
        return `<rect x="${p.x.toFixed(1)}" y="${p.y.toFixed(1)}" width="${Math.max(1, q.x - p.x).toFixed(1)}" height="${Math.max(1, q.y - p.y).toFixed(1)}"/>`;
      })
      .join("");
    const dots = (fixtures || [])
      .filter((fix) => fix.surface === "wall" && fix.wallId === wall.id)
      .map((fix) => {
        const c = at(fix.along, fix.rise);
        return `<rect x="${(c.x - 2).toFixed(1)}" y="${(c.y - 2).toFixed(1)}" width="4" height="4"/>`;
      })
      .join("");
    const box = at(0, height);
    const wallTone = tones?.wall || "var(--mark-wall, #94a3b8)";
    return `<svg class="calc-film-thumb is-wall" style="--film-tone:${wallTone}" viewBox="0 0 ${vw} ${vh}" preserveAspectRatio="xMidYMid meet" aria-hidden="true"><rect class="calc-film-wall" x="${box.x.toFixed(1)}" y="${box.y.toFixed(1)}" width="${(len * scale).toFixed(1)}" height="${(height * scale).toFixed(1)}"/>${cuts}${dots}</svg>`;
  }

  function planLocateSvg(plan, wallId) {
    const walls = plannerWalls(plan);
    if (!plan?.points?.length || !walls.length) return "";
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    plan.points.forEach((p) => {
      minX = Math.min(minX, p.x);
      minY = Math.min(minY, p.y);
      maxX = Math.max(maxX, p.x);
      maxY = Math.max(maxY, p.y);
    });
    const vw = 160;
    const vh = 120;
    const pad = 12;
    const spanX = Math.max(0.05, maxX - minX);
    const spanY = Math.max(0.05, maxY - minY);
    const scale = Math.min((vw - pad * 2) / spanX, (vh - pad * 2) / spanY);
    const ox = (vw - spanX * scale) / 2 - minX * scale;
    const oy = (vh - spanY * scale) / 2 - minY * scale;
    const d = plan.points.map((p, i) => `${i ? "L" : "M"}${(ox + p.x * scale).toFixed(1)} ${(oy + p.y * scale).toFixed(1)}`).join("") + "Z";
    const lines = walls
      .map((wall) => {
        const x1 = ox + wall.a.x * scale;
        const y1 = oy + wall.a.y * scale;
        const x2 = ox + wall.b.x * scale;
        const y2 = oy + wall.b.y * scale;
        return `<line data-locate-wall="${esc(wall.id)}" class="${wall.id === wallId ? "is-on" : ""}" x1="${x1.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}"/>`;
      })
      .join("");
    return `<svg viewBox="0 0 ${vw} ${vh}" aria-hidden="true"><path d="${d}"/>${lines}</svg>`;
  }

  function filmStrip(plan, nodeId, active, holes, fixtures, tones) {
    if (!plan?.points?.length) return `<div class="calc-empty">Нет чертежа</div>`;
    return filmItems(plan)
      .map((item) => {
        const open = nodeId ? ` data-mark-open="${esc(nodeId)}"` : "";
        return `<button type="button" class="calc-film-card ${item.id === active ? "is-on" : ""}"${open} data-mark-surface="${esc(item.id)}"><span class="calc-film-name">${esc(item.name)}</span>${surfaceThumb(plan, item, holes, fixtures, tones)}</button>`;
      })
      .join("");
  }

  function openingsNodeHtml(node, bp, graph) {
    ensureOpenings(node);
    const plan = upstreamPlan(node, bp, [], graph.values);
    const outPlan = plan ? emitPlan(node, bp, [], graph.values) : null;
    const inputs = openingInputs(node);
    const outputs = openingOutputs(node, bp, graph.values, bp.links);
    const sub = plan ? `${plannerWalls(plan).length} стен · ${(outPlan?.openings || []).length} проёмов` : "нет чертежа";
    const binds = inputs.filter((port) => port.id !== PLAN_PORT);
    const tones = markTones(node, plan?.color);
    return `<article class="calc-node is-openings ${session.selected === node.id ? "is-on" : ""}" data-node="${esc(node.id)}" style="left:${node.x}px;top:${node.y}px;--planner-color:${esc(tones.floor)};--mark-floor:${esc(tones.floor)};--mark-ceiling:${esc(tones.ceiling)};--mark-wall:${esc(tones.wall)}">
      <i class="calc-grip" data-drag-node="${esc(node.id)}" title="Перетащить"></i>
      <header class="calc-node-h">
        <input class="calc-pname calc-planner-name" data-mark-title="${esc(node.id)}" value="${esc(node.name)}" maxlength="48" spellcheck="false" title="Имя проёмов" aria-label="Имя проёмов" />
        ${markToneInputs(node)}
        <button type="button" class="calc-text-btn" data-mark-edit="${esc(node.id)}" title="Проёмы на чертеже">Редактор</button>
        <button type="button" class="calc-x" data-del-node="${esc(node.id)}" title="Удалить">×</button>
      </header>
      ${plan ? `<div class="calc-film calc-film-top">${filmStrip(plan, node.id, "", outPlan?.openings || [], [], tones)}</div>` : ""}
      <div class="calc-node-sub">${esc(sub)}</div>
      <div class="calc-ports">
        ${planPortRow("in")}
        ${binds
          .map((port) => {
            const value = graph.values[`${node.id}:${port.id}`];
            const linked = (bp.links || []).some((link) => link.to === node.id && link.toPort === port.id);
            return `<div class="calc-row in">
              <i class="calc-port in" data-port="${esc(port.id)}" data-io="in" title="${esc(port.name)}"></i>
              <span>${esc(port.name)}</span>
              <b>${esc(fmtShort(value))}</b>
              ${linked ? `<button type="button" class="calc-mini" data-del-in-link="${esc(port.id)}" title="Удалить связь">×</button>` : ""}
            </div>`;
          })
          .join("")}
        ${planPortRow("out")}
        ${countRows(node, outputs, graph)}
      </div>
    </article>`;
  }

  function electricsNodeHtml(node, bp, graph) {
    ensureElectrics(node);
    const plan = upstreamPlan(node, bp, [], graph.values);
    const outputs = electricOutputs(node, bp, graph.values, bp.links);
    const sockets = node.fixtures.filter((item) => item.kind !== "light").reduce((sum, item) => sum + (item.cells || []).length, 0);
    const frames = node.fixtures.filter((item) => item.kind !== "light").length;
    const sub = plan ? `${sockets} шт. · ${frames} рамок` : "нет чертежа";
    const linked = (bp.links || []).some((link) => link.to === node.id && link.toPort === PLAN_PORT);
    const tones = markTones(node, plan?.color);
    return `<article class="calc-node is-electrics ${session.selected === node.id ? "is-on" : ""}" data-node="${esc(node.id)}" style="left:${node.x}px;top:${node.y}px;--planner-color:${esc(tones.floor)};--mark-floor:${esc(tones.floor)};--mark-ceiling:${esc(tones.ceiling)};--mark-wall:${esc(tones.wall)}">
      <i class="calc-grip" data-drag-node="${esc(node.id)}" title="Перетащить"></i>
      <header class="calc-node-h">
        <input class="calc-pname calc-planner-name" data-mark-title="${esc(node.id)}" value="${esc(node.name)}" maxlength="48" spellcheck="false" title="Имя электрики" aria-label="Имя электрики" />
        ${markToneInputs(node)}
        <button type="button" class="calc-text-btn" data-mark-edit="${esc(node.id)}" title="Розетки и свет">Редактор</button>
        <button type="button" class="calc-x" data-del-node="${esc(node.id)}" title="Удалить">×</button>
      </header>
      ${plan ? `<div class="calc-film calc-film-top">${filmStrip(plan, node.id, "", plan?.openings || [], node.fixtures, markTones(node, plan?.color))}</div>` : ""}
      <div class="calc-node-sub">${esc(sub)}</div>
      <div class="calc-ports">
        <div class="calc-row in">
          <i class="calc-port in" data-port="plan" data-io="in" data-signal="plan" title="Чертёж"></i>
          <span>Чертёж</span>
          <b class="calc-plan-tag">план</b>
          ${linked ? `<button type="button" class="calc-mini" data-del-in-link="plan" title="Удалить связь">×</button>` : ""}
        </div>
        ${outputs.length ? countRows(node, outputs, graph) : `<div class="calc-empty">Поставьте точки — выходы появятся здесь</div>`}
      </div>
    </article>`;
  }

  function markNode() {
    const id = session.mark?.id;
    if (!id) return null;
    const node = (activeBlueprint()?.nodes || []).find((item) => item.id === id && (item.type === "openings" || item.type === "electrics")) || null;
    if (!node) {
      session.mark = null;
      $("mark-modal")?.classList.remove("open");
    }
    return node;
  }

  function markContext() {
    const node = markNode();
    const bp = activeBlueprint();
    if (!node || !bp) return null;
    const graph = computeGraph(bp);
    const base = upstreamPlan(node, bp, [], graph.values);
    const full = node.type === "openings" ? emitPlan(node, bp, [], graph.values) : base;
    return { node, bp, graph, base, full };
  }

  function markSurfaceOk(plan, surface) {
    if (surface === "floor" || surface === "ceiling") return surface;
    if (plan && plannerWalls(plan).some((wall) => wall.id === surface)) return surface;
    return "floor";
  }

  function openMark(nodeId, surface) {
    const bp = activeBlueprint();
    const node = bp?.nodes.find((item) => item.id === nodeId && (item.type === "openings" || item.type === "electrics"));
    if (!node) return;
    if (session.planner?.id) closePlanner();
    ensureMarkModal();
    if (node.type === "openings") ensureOpenings(node);
    else ensureElectrics(node);
    const plan = upstreamPlan(node, bp, [], computeGraph(bp).values);
    session.mark = {
      id: nodeId,
      surface: markSurfaceOk(plan, surface || node.view || "floor"),
      sel: "",
      orient: "h",
      section: 1,
      drag: null,
    };
    session.selected = nodeId;
    hidePortMenu();
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
    $("mark-modal")?.classList.add("open");
    markHideMenu();
    editorBegin();
    requestAnimationFrame(() => markFill());
  }

  function closeMark() {
    const node = markNode();
    if (node) node.name = node.type === "electrics" ? ensureElectrics(node).name : ensureOpenings(node).name;
    editorEnd();
    session.mark = null;
    markHideMenu();
    $("mark-preset-modal")?.classList.remove("open");
    $("mark-modal")?.classList.remove("open");
    if (api?.view?.() === "calculator") render();
  }

  function markHideMenu() {
    const menu = $("mark-menu");
    if (menu) menu.hidden = true;
    const box = $("mark-nudge-box");
    if (box) box.hidden = true;
    if (session.mark) session.mark.menu = null;
  }

  function pruneMarkLinks(node) {
    const bp = activeBlueprint();
    if (!bp || !node) return;
    const graph = computeGraph(bp);
    const ports = node.type === "openings" ? openingOutputs(node, bp, graph.values, bp.links) : electricOutputs(node, bp, graph.values, bp.links);
    const ids = new Set(ports.map((port) => port.id));
    bp.links = (bp.links || []).filter((link) => link.from !== node.id || ids.has(link.fromPort));
    const inputs = new Set((node.type === "openings" ? openingInputs(node) : [{ id: PLAN_PORT }]).map((port) => port.id));
    bp.links = bp.links.filter((link) => link.to !== node.id || inputs.has(link.toPort));
  }

  function fitOpenings(node) {
    const bp = activeBlueprint();
    if (!bp) return;
    const graph = computeGraph(bp);
    const plan = upstreamPlan(node, bp, [], graph.values);
    if (!plan) return;
    node.holes.forEach((hole) => {
      const live = resolveHole(hole, plan, node, graph.values);
      hole.along = live.along;
      hole.rise = live.rise;
      hole.x = live.x;
      hole.y = live.y;
      if (!hole.bind?.w) hole.w = live.w;
      if (!hole.bind?.h) hole.h = live.h;
      if (!hole.bind?.d) hole.d = live.d;
    });
  }

  function markCommit(rebuild) {
    const node = markNode();
    if (!node) return;
    if (node.type === "openings") {
      ensureOpenings(node);
      fitOpenings(node);
    } else ensureElectrics(node);
    pruneMarkLinks(node);
    if ($("mark-modal")?.classList.contains("open")) editorPush();
    else dirty();
    render();
    if (!$("mark-modal")?.classList.contains("open")) return;
    if (rebuild) markFill();
    else markDraw();
  }

  function numericFeeds(exceptId, graph, bp) {
    const rows = [];
    (bp?.nodes || []).forEach((node) => {
      if (node.id === exceptId) return;
      const order = node.type === "order" ? api.findOrder(node.orderId) : null;
      nodeOutputs(node, order, bp.links).forEach((port) => {
        if (portSignal(node, port.id) === "plan") return;
        const value = graph?.values?.[`${node.id}:${port.id}`];
        rows.push({
          key: `${node.id}\t${port.id}`,
          label: `${markNodeTitle(node)} · ${port.name || port.id}${Number.isFinite(value) ? ` · ${fmtShort(value)}` : ""}`,
        });
      });
    });
    return rows;
  }

  function markSelect(attrs, name, options, current) {
    const label = options.find((item) => item.value === current)?.label || options[0]?.label || "—";
    const hidden = name ? `<input type="hidden" name="${esc(name)}" value="${esc(current)}" />` : "";
    const list = options
      .map((item) => `<button type="button" class="mark-opt ${item.value === current ? "is-on" : ""}" data-opt="${esc(item.value)}" ${attrs}>${esc(item.label)}</button>`)
      .join("");
    return `<div class="mark-select">${hidden}<button type="button" class="mark-select-btn" ${attrs}>${esc(label)}</button><div class="mark-select-list" hidden>${list}</div></div>`;
  }

  function placeMarkList(btn) {
    const list = btn.parentElement?.querySelector(".mark-select-list");
    const willOpen = !!list?.hidden;
    document.querySelectorAll(".mark-select-list").forEach((el) => { el.hidden = true; });
    if (!willOpen || !list) return;
    const rect = btn.getBoundingClientRect();
    const below = window.innerHeight - rect.bottom;
    list.hidden = false;
    list.style.left = `${Math.max(8, Math.min(rect.left, window.innerWidth - 228))}px`;
    list.style.width = `${Math.max(rect.width, 180)}px`;
    if (below < 200) {
      list.style.top = "auto";
      list.style.bottom = `${window.innerHeight - rect.top + 4}px`;
    } else {
      list.style.bottom = "auto";
      list.style.top = `${rect.bottom + 4}px`;
    }
  }

  function markOnSurface(item, surface) {
    if (surface === "floor" || surface === "ceiling") return item.surface === surface;
    return item.surface === "wall" && item.wallId === surface;
  }

  function markSideHtml(ctx) {
    const { node, bp, graph, base, full } = ctx;
    const feeds = numericFeeds(node.id, graph, bp);
    const feedOpts = [{ value: "", label: "не назначено" }].concat(feeds.map((row) => ({ value: row.key, label: row.label })));
    const linkKey = (portId) => {
      const link = (bp.links || []).find((item) => item.to === node.id && item.toPort === portId);
      return link ? `${link.from}\t${link.fromPort}` : "";
    };
    const surface = session.mark?.surface || "floor";
    if (!base) {
      return `<div class="planner-block"><div class="planner-block-h">${node.type === "electrics" ? "Электрика" : "Проёмы"}</div><p class="planner-lead">Соедините вход «Чертёж» с выходом «Чертёж» планировщика${node.type === "electrics" ? " или проёмов" : ""}.</p></div>`;
    }
    if (node.type === "openings") {
      const walls = plannerWalls(base);
      const inherited = (base.openings || []).length;
      const holes = node.holes
        .map((hole, index) => ({ hole, index, live: resolveHole(hole, base, node, graph.values) }))
        .filter((item) => markOnSurface(item.live, surface))
        .map(({ hole, index, live }) => {
          const place = live.surface === "floor" ? "Пол" : live.surface === "ceiling" ? "Потолок" : planWallName(base, walls.find((wall) => wall.id === live.wallId) || { id: live.wallId }, Math.max(0, walls.findIndex((wall) => wall.id === live.wallId)));
          const bindPick = (field) => (hole.bind?.[field] ? markSelect(`data-hole-var="${esc(hole.id)}" data-bind="${field}"`, "", feedOpts, linkKey(`b:${hole.id}:${field}`)) : "");
          const dims = live.shape === "circle"
            ? `<label class="planner-len">диаметр <input data-hole-d="${esc(hole.id)}" inputmode="decimal" value="${esc(plannerInput(hole.d * 1000))}" ${hole.bind?.d ? "readonly" : ""} /> мм</label>
               <div class="mark-dias">${PIPE_MM.map((mm) => `<button type="button" data-hole-mm="${esc(hole.id)}" data-mm="${mm}">${mm}</button>`).join("")}</div>
               <label class="planner-on"><input type="checkbox" data-hole-bind="${esc(hole.id)}" data-bind="d" ${hole.bind?.d ? "checked" : ""} /> С входа</label>
               ${bindPick("d")}`
            : `<label class="planner-len">ширина <input data-hole-w="${esc(hole.id)}" inputmode="decimal" value="${esc(plannerInput(hole.w))}" ${hole.bind?.w ? "readonly" : ""} /> м</label>
               <label class="planner-on"><input type="checkbox" data-hole-bind="${esc(hole.id)}" data-bind="w" ${hole.bind?.w ? "checked" : ""} /> С входа</label>
               ${bindPick("w")}
               <label class="planner-len">высота <input data-hole-h="${esc(hole.id)}" inputmode="decimal" value="${esc(plannerInput(hole.h))}" ${hole.bind?.h ? "readonly" : ""} /> м</label>
               <label class="planner-on"><input type="checkbox" data-hole-bind="${esc(hole.id)}" data-bind="h" ${hole.bind?.h ? "checked" : ""} /> С входа</label>
               ${bindPick("h")}
               ${live.role === "door" ? `<button type="button" class="btn" data-hole-full="${esc(hole.id)}">Во всю стену</button>` : ""}`;
          const fallback = holeLabel({ ...hole, name: "" }, index);
          return `<div class="planner-metric ${session.mark?.sel === hole.id ? "is-sel" : ""}">
            <span class="planner-label">${cardNameInput(hole.id, "hole", hole.name, fallback)} · ${esc(place)}</span>
            ${dims}
            <label class="planner-on"><input type="checkbox" data-hole-pick="${esc(hole.id)}" ${hole.picked !== false ? "checked" : ""} /> В счёт</label>
            <button type="button" class="calc-mini" data-hole-del="${esc(hole.id)}" title="Удалить">×</button>
          </div>`;
        })
        .join("");
      const wallRows = walls
        .map((wall, index) => {
          const id = `wall:${wall.id}`;
          const area = full ? wallRemain(wall, full.height, full.openings) : 0;
          const linked = linkedFromPorts(node.id, bp.links).has(id);
          return `<label class="planner-part"><input type="checkbox" data-mark-out="${esc(id)}" ${markChecked(node, id, false) || linked ? "checked" : ""} ${linked ? "disabled" : ""} /> <span>${esc(planWallName(base, wall, index))}</span> <em>${esc(fmtShort(area))} м²</em></label>`;
        })
        .join("");
      const counts = [
        ["count:pick", "pick", "Проёмы", (full?.openings || []).filter((hole) => hole.picked !== false).length],
        ["count:door", "doors", "Двери", (full?.openings || []).filter((hole) => hole.role === "door").length],
        ["count:window", "windows", "Окна", (full?.openings || []).filter((hole) => hole.role === "window").length],
        ["count:pipe", "pipes", "Трубы", (full?.openings || []).filter((hole) => hole.role === "pipe").length],
        ["count:hatch", "hatches", "Люки", (full?.openings || []).filter((hole) => hole.role === "hatch").length],
      ]
        .map(([id, key, fallback, value]) => {
          const name = openingCounterLabel(node, key, fallback);
          const linked = linkedFromPorts(node.id, bp.links).has(id);
          return `<label class="planner-part"><input type="checkbox" data-mark-out="${esc(id)}" ${markChecked(node, id, true) || linked ? "checked" : ""} ${linked ? "disabled" : ""} /> <input class="planner-name planner-counter-name" data-counter-name="${esc(key)}" value="${esc(name)}" maxlength="48" aria-label="Название счётчика" /> <em>${value}</em></label>`;
        })
        .join("");
      const ownRows = (node.owns || []).map((own) => {
        const groups = new Map();
        node.holes.forEach((hole, index) => {
          const live = resolveHole(hole, base, node, graph.values);
          const key = live.surface === "wall" ? `wall:${live.wallId}` : live.surface;
          const wallIndex = walls.findIndex((wall) => wall.id === live.wallId);
          const place = live.surface === "floor" ? "Пол" : live.surface === "ceiling" ? "Потолок" : planWallName(base, walls[wallIndex] || { id: live.wallId }, Math.max(0, wallIndex));
          if (!groups.has(key)) groups.set(key, { name: place, items: [] });
          groups.get(key).items.push({ hole, index });
        });
        const ordered = walls.map((wall) => `wall:${wall.id}`).concat(["floor", "ceiling"]);
        const keys = ordered.concat([...groups.keys()].filter((key) => !ordered.includes(key)));
        const toggles = keys.filter((key) => groups.has(key)).map((key) => {
          const group = groups.get(key);
          const items = group.items.map(({ hole, index }) => {
            const fallback = holeLabel(hole, index);
            return `<label class="planner-part"><input type="checkbox" data-own="${esc(own.id)}" data-own-hole="${esc(hole.id)}" ${(own.holes || []).includes(hole.id) ? "checked" : ""} /> <span data-own-title="${esc(hole.id)}">${esc(hole.name || fallback)}</span></label>`;
          }).join("");
          const groupIds = group.items.map(({ hole }) => hole.id);
          const hasAny = groupIds.some((id) => (own.holes || []).includes(id));
          return `<div class="planner-own-group-title"><span>${esc(group.name)}</span><button type="button" class="calc-mini planner-own-group-toggle" data-own-group-toggle data-own-group-own="${esc(own.id)}" data-own-group-key="${esc(key)}" title="${hasAny ? "Снять все отметки" : "Отметить все"}" aria-label="${hasAny ? "Снять все отметки" : "Отметить все"}">${hasAny ? "−" : "+"}</button></div>${items}`;
        }).join("");
        return `<div class="planner-metric"><input class="planner-name" data-own-name="${esc(own.id)}" value="${esc(own.name || "Свой")}" maxlength="48" aria-label="Имя своего счётчика" /><button type="button" class="calc-mini" data-own-del="${esc(own.id)}" title="Удалить">×</button>${toggles || `<div class="calc-empty">Нет карточек для подсчёта</div>`}</div>`;
      }).join("");
      return `<div class="planner-block"><div class="planner-block-h">Проёмы</div>
        <p class="planner-lead">Прямоугольник у пола — дверь. Ширина двери на всю стену оставляет только верх. Диаметр с входа приходит в миллиметрах, ширина и высота — в метрах.${inherited ? ` С чертежа уже пришло ${inherited}.` : ""}</p>
        ${holes || `<div class="calc-empty">На этой поверхности проёмов нет</div>`}
      </div>
      <div class="planner-block"><div class="planner-block-h">На ноду</div>
        <p class="planner-lead">Стены выходят уже с вырезами. «В счёт» меняет только число «Проёмы»: включённый проём прибавляется, выключенный на чертеже бледнеет. Двери, окна, трубы и люки считаются сами.</p>
        <div class="mark-bulk">
          <button type="button" class="btn" data-mark-bulk="walls-on">Все стены</button>
          <button type="button" class="btn" data-mark-bulk="walls-off">Снять стены</button>
          <button type="button" class="btn" data-mark-bulk="counts-on">Все счётчики</button>
          <button type="button" class="btn" data-mark-bulk="counts-off">Снять счётчики</button>
        </div>
        <div class="planner-parts">${wallRows}${counts}</div>
        <div class="planner-block-h">Свой счётчик <button type="button" class="btn" data-own-add>+ Свой</button></div>
        ${ownRows}
      </div>`;
    }
    const socketOpts = socketCatalog().map((type) => ({ value: type.id, label: type.name }));
    const fixtures = node.fixtures
      .filter((fix) => markOnSurface(fix, surface))
      .map((fix) => {
        if (fix.kind === "light") {
          const lightName = lightById(fix.light)?.name || "Свет";
          const shape = lightById(fix.light)?.shape;
          const spin = lightRotates(shape)
            ? `<button type="button" class="btn" data-light-spin="${esc(fix.id)}">+45°</button><label class="planner-len">угол <input data-light-angle="${esc(fix.id)}" inputmode="decimal" value="${esc(String(lightAngle(fix)))}" /> °</label>`
            : "";
          const dims = shape === "rect"
            ? `<label class="planner-len">ширина <input data-light-w="${esc(fix.id)}" inputmode="decimal" value="${esc(plannerInput(fix.lw || 0.6))}" /> м</label><label class="planner-len">длина <input data-light-l="${esc(fix.id)}" inputmode="decimal" value="${esc(plannerInput(fix.ll || 0.3))}" /> м</label>${spin}`
            : shape === "line"
              ? `<label class="planner-len">длина <input data-light-l="${esc(fix.id)}" inputmode="decimal" value="${esc(plannerInput(fix.ll || 1.2))}" /> м</label>${spin}`
              : "";
          return `<div class="planner-metric ${session.mark?.sel === fix.id ? "is-sel" : ""}">
            <span class="planner-label">${cardNameInput(fix.id, "fix", fix.name, lightName)}</span>
            ${markSelect(`data-light="${esc(fix.id)}"`, "", lightCatalog().map((type) => ({ value: type.id, label: type.name })), fix.light || "")}
            ${dims}
            <button type="button" class="calc-mini" data-fix-del="${esc(fix.id)}" title="Удалить">×</button>
          </div>`;
        }
        const cells = (fix.cells || [])
          .map((cell, index) => `<label class="planner-len">${index + 1} ${markSelect(`data-cell="${esc(fix.id)}" data-cell-i="${index}"`, "", socketOpts, cell)}</label>`)
          .join("");
        return `<div class="planner-metric ${session.mark?.sel === fix.id ? "is-sel" : ""}">
          <span class="planner-label">${cardNameInput(fix.id, "fix", fix.name, frameLabel({ ...fix, name: "" }))}</span>
          <label class="planner-len">рамка ${markSelect(`data-orient="${esc(fix.id)}"`, "", [{ value: "h", label: "горизонтально" }, { value: "v", label: "вертикально" }], fix.orient === "v" ? "v" : "h")}</label>
          ${cells}
          ${(fix.cells || []).length < 6 ? `<button type="button" class="btn" data-cell-add="${esc(fix.id)}">Ещё секция</button>` : ""}
          <button type="button" class="calc-mini" data-fix-del="${esc(fix.id)}" title="Удалить">×</button>
        </div>`;
      })
      .join("");
    const typeRows = [];
    const frameRows = [];
    const seenType = new Set();
    const seenFrame = new Set();
    node.fixtures.forEach((fix) => {
      if (fix.kind === "light") return;
      const key = frameKey(fix);
      if (!seenFrame.has(key)) {
        seenFrame.add(key);
        const id = `frame:${key}`;
        const value = node.fixtures.filter((item) => item.kind !== "light" && frameKey(item) === key).length;
        const linked = linkedFromPorts(node.id, bp.links).has(id);
        frameRows.push({ n: Number(key), html: `<label class="planner-part"><input type="checkbox" data-mark-out="${esc(id)}" ${markChecked(node, id, true) || linked ? "checked" : ""} ${linked ? "disabled" : ""} /> <span>${esc(frameLabel(fix))}</span> <em>${value}</em></label>` });
      }
      (fix.cells || []).forEach((typeId) => {
        if (seenType.has(typeId)) return;
        seenType.add(typeId);
        const id = `type:${typeId}`;
        const value = node.fixtures.filter((item) => item.kind !== "light").reduce((sum, item) => sum + (item.cells || []).filter((cell) => cell === typeId).length, 0);
        const linked = linkedFromPorts(node.id, bp.links).has(id);
        const name = socketById(typeId)?.name || "Розетка";
        typeRows.push(`<label class="planner-part"><input type="checkbox" data-mark-out="${esc(id)}" ${markChecked(node, id, true) || linked ? "checked" : ""} ${linked ? "disabled" : ""} /> <span>${esc(name)}</span> <em>${value}</em></label>`);
      });
    });
    frameRows.sort((a, b) => a.n - b.n);
    return `<div class="planner-block"><div class="planner-block-h">Точки</div>
      <p class="planner-lead">Правый клик ставит розетку или свет в эту точку. Рамка собирает несколько типов, горизонтально или вертикально.</p>
      ${fixtures || `<div class="calc-empty">На этой поверхности точек нет</div>`}
    </div>
    <div class="planner-block"><div class="planner-block-h">На ноду</div>
      <div class="planner-parts">${typeRows.join("")}${frameRows.map((row) => row.html).join("") || `<div class="calc-empty">Пока нечего считать</div>`}</div>
    </div>`;
  }

  function markFill() {
    const ctx = markContext();
    const side = $("mark-side");
    const title = $("mark-title");
    const hint = $("mark-hint");
    const cap = $("mark-cap");
    if (!ctx || !side) return;
    const scroll = side.scrollTop;
    side.innerHTML = markSideHtml(ctx);
    side.scrollTop = scroll;
    if (title && document.activeElement !== title) title.value = ctx.node.name || "";
    const surface = session.mark?.surface || "floor";
    const walls = ctx.base ? plannerWalls(ctx.base) : [];
    const wallIndex = walls.findIndex((wall) => wall.id === surface);
    if (cap) {
      cap.textContent = surface === "ceiling" ? "Потолок" : surface === "floor" ? "Пол" : wallIndex >= 0 ? planWallName(ctx.base, walls[wallIndex], wallIndex) : "План";
    }
    if (hint) {
      hint.textContent = ctx.node.type === "electrics"
        ? "Правый клик: розетка, ориентация и число секций. Точка встаёт туда, куда нажали. Стрелки двигают уже стоящую."
        : "Правый клик: прямоугольник, круг или диаметр. У пола прямоугольник становится дверью. Стрелки двигают выбранный проём.";
    }
    const film = $("mark-film");
    if (film) {
      const holes = ctx.node.type === "openings" ? ctx.full?.openings || [] : ctx.base?.openings || [];
      const fixtures = ctx.node.type === "electrics" ? ctx.node.fixtures : [];
      film.innerHTML = ctx.base ? filmStrip(ctx.base, "", surface, holes, fixtures, markTones(ctx.node, ctx.base.color)) : `<div class="calc-empty">Нет чертежа</div>`;
    }
    let locate = $("mark-locate");
    const wrap = $("mark-canvas")?.parentElement;
    if (!locate && wrap) {
      locate = document.createElement("div");
      locate.id = "mark-locate";
      locate.className = "mark-locate";
      wrap.appendChild(locate);
    }
    if (locate) {
      if (!locate.dataset.bound) {
        locate.dataset.bound = "1";
        locate.addEventListener("pointermove", (e) => {
          if (!session.mark?.locateBig) return;
          const wall = e.target.closest?.("[data-locate-wall]") || null;
          locate.querySelectorAll("[data-locate-wall]").forEach((el) => el.classList.toggle("is-hot", el === wall));
        });
        locate.addEventListener("pointerleave", () => {
          locate.querySelectorAll(".is-hot").forEach((el) => el.classList.remove("is-hot"));
        });
        locate.addEventListener("click", (e) => {
          if (!session.mark) return;
          if (e.target.closest("[data-locate-eye]")) {
            session.mark.locateHide = !session.mark.locateHide;
            markFill();
            return;
          }
          const wall = e.target.closest("[data-locate-wall]");
          if (session.mark.locateBig && wall) {
            const node = markNode();
            session.mark.surface = wall.dataset.locateWall;
            if (node) node.view = session.mark.surface;
            session.mark.locateBig = false;
            session.mark.sel = "";
            markCommit(true);
            return;
          }
          session.mark.locateBig = !session.mark.locateBig;
          markFill();
        });
      }
      const eye = `<button type="button" class="calc-mini-toggle mark-locate-eye" data-locate-eye title="${session.mark?.locateHide ? "Показать план" : "Скрыть план"}" aria-label="Показать или скрыть план"><svg class="calc-mini-eye-on" width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M2.5 12s3.5-7 9.5-7 9.5 7 9.5 7-3.5 7-9.5 7-9.5-7-9.5-7z" stroke="currentColor" stroke-width="1.8"/><circle cx="12" cy="12" r="3" stroke="currentColor" stroke-width="1.8"/></svg><svg class="calc-mini-eye-off" width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M3 3l18 18M10.6 10.7a2.8 2.8 0 0 0 3.7 3.7M6.2 6.3C4.1 7.8 2.5 12 2.5 12s3.5 7 9.5 7c1.2 0 2.3-.2 3.3-.6" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg></button>`;
      locate.hidden = !ctx.base;
      locate.classList.toggle("is-big", !!session.mark?.locateBig && !session.mark?.locateHide);
      locate.classList.toggle("is-hidden", !!session.mark?.locateHide);
      locate.innerHTML = `${ctx.base ? `<div class="mark-locate-map">${planLocateSvg(ctx.base, surface)}</div>` : ""}${eye}`;
    }
    markDraw();
  }

  function markViewOf(canvas, ctx) {
    const surface = session.mark?.surface || "floor";
    if (!ctx.base) return null;
    if (surface === "floor" || surface === "ceiling") return { kind: "plan", view: plannerView(canvas, ctx.base.points, null), plan: ctx.base };
    const walls = plannerWalls(ctx.base);
    const wall = walls.find((item) => item.id === surface);
    if (!wall) return { kind: "plan", view: plannerView(canvas, ctx.base.points, null), plan: ctx.base };
    const pad = 28;
    const len = Math.max(wall.len, 0.2);
    const height = Math.max(ctx.base.height, 0.2);
    const scale = Math.min((canvas.clientWidth - pad * 2) / len, (canvas.clientHeight - pad * 2) / height);
    const ox = (canvas.clientWidth - len * scale) / 2;
    const oy = (canvas.clientHeight - height * scale) / 2;
    return {
      kind: "wall",
      wall,
      height: ctx.base.height,
      scale,
      toAlong(along, rise) {
        return { x: ox + along * scale, y: oy + (height - rise) * scale };
      },
      from(x, y) {
        return { along: (x - ox) / scale, rise: height - (y - oy) / scale };
      },
    };
  }

  function markLocals(ctx) {
    if (ctx.node.type !== "openings") return [];
    return ctx.node.holes.map((hole) => resolveHole(hole, ctx.base, ctx.node, ctx.graph.values));
  }

  function frameBoxes(fix) {
    const cells = (fix.cells || []).slice(0, 6);
    const gap = 0.012;
    const sizes = cells.map((id) => plannerClamp((socketById(id)?.size || 80) / 1000, 0.02, 0.4));
    const horiz = fix.orient !== "v";
    const total = sizes.reduce((sum, size) => sum + size, 0) + gap * Math.max(0, sizes.length - 1);
    let cursor = -total / 2;
    return cells.map((id, index) => {
      const size = sizes[index];
      const box = horiz
        ? { x: cursor, y: -size / 2, w: size, h: size, id }
        : { x: -size / 2, y: cursor, w: size, h: size, id };
      cursor += size + gap;
      return box;
    });
  }

  function markDraw() {
    const ctx = markContext();
    const canvas = $("mark-canvas");
    if (!ctx || !canvas || !session.mark) return;
    const fitted = plannerFitCanvas(canvas);
    if (!fitted) return;
    const { ctx: g, w, h } = fitted;
    const colors = plannerColors();
    g.clearRect(0, 0, w, h);
    g.fillStyle = colors.bg;
    g.fillRect(0, 0, w, h);
    const view = markViewOf(canvas, ctx);
    session.mark.view = view;
    if (!view || !ctx.base) {
      g.fillStyle = colors.muted;
      g.font = "14px sans-serif";
      g.fillText("Подключите чертёж", 24, 36);
      return;
    }
    const surface = session.mark.surface;
    const tones = markTones(ctx.node, ctx.base.color);
    if (view.kind === "plan") {
      g.beginPath();
      ctx.base.points.forEach((p, index) => {
        const spot = view.view.to(p);
        if (index) g.lineTo(spot.x, spot.y);
        else g.moveTo(spot.x, spot.y);
      });
      g.closePath();
      g.fillStyle = surface === "ceiling" ? tones.ceiling : tones.floor;
      g.globalAlpha = 0.22;
      g.fill();
      g.globalAlpha = 1;
      g.lineWidth = 2;
      g.strokeStyle = surface === "ceiling" ? tones.ceiling : tones.floor;
      g.stroke();
    } else {
      const a = view.toAlong(0, 0);
      const b = view.toAlong(view.wall.len, view.height);
      g.fillStyle = tones.wall;
      g.globalAlpha = 0.34;
      g.fillRect(a.x, b.y, b.x - a.x, a.y - b.y);
      g.globalAlpha = 1;
      g.strokeStyle = tones.wall;
      g.lineWidth = 2;
      g.strokeRect(a.x, b.y, b.x - a.x, a.y - b.y);
    }
    const drawHole = (hole, ghost) => {
      const onWall = view.kind === "wall" && hole.surface === "wall" && hole.wallId === view.wall.id;
      const onPlan = view.kind === "plan" && hole.surface === surface;
      if (!onWall && !onPlan) return;
      g.save();
      g.globalAlpha = ghost ? 0.45 : hole.picked === false ? 0.28 : 1;
      if (hole.picked === false) g.setLineDash([5, 4]);
      g.fillStyle = colors.bg;
      g.strokeStyle = hole.role === "door" ? "#b45309" : hole.role === "pipe" ? "#0369a1" : "#0f766e";
      g.lineWidth = session.mark.sel === hole.id ? 3 : 1.5;
      if (view.kind === "wall") {
        if (hole.shape === "circle") {
          const c = view.toAlong(hole.along, hole.rise);
          g.beginPath();
          g.arc(c.x, c.y, Math.max(3, (hole.d / 2) * view.scale), 0, Math.PI * 2);
          g.fill();
          g.stroke();
        } else {
          const p = view.toAlong(hole.along, hole.rise + hole.h);
          const q = view.toAlong(hole.along + hole.w, hole.rise);
          g.fillRect(p.x, p.y, q.x - p.x, q.y - p.y);
          g.strokeRect(p.x, p.y, q.x - p.x, q.y - p.y);
        }
      } else if (hole.shape === "circle") {
        const c = view.view.to({ x: hole.x, y: hole.y });
        g.beginPath();
        g.arc(c.x, c.y, Math.max(3, (hole.d / 2) * view.view.scale), 0, Math.PI * 2);
        g.fill();
        g.stroke();
      } else {
        const p = view.view.to({ x: hole.x, y: hole.y });
        const q = view.view.to({ x: hole.x + hole.w, y: hole.y + hole.h });
        g.fillRect(p.x, p.y, q.x - p.x, q.y - p.y);
        g.strokeRect(p.x, p.y, q.x - p.x, q.y - p.y);
      }
      g.restore();
    };
    (ctx.base.openings || []).forEach((hole) => drawHole(hole, true));
    if (ctx.node.type === "openings") markLocals(ctx).forEach((hole) => drawHole(hole, false));
    if (ctx.node.type === "electrics") {
      ctx.node.fixtures.forEach((fix) => {
        const here = view.kind === "wall" ? fix.surface === "wall" && fix.wallId === view.wall.id : fix.surface === surface;
        if (!here) return;
        if (fix.kind === "light") {
          lightPaint(g, view, fix, session.mark.sel === fix.id, colors.ink);
          return;
        }
        frameBoxes(fix).forEach((box) => {
          const type = socketById(box.id) || SOCKET_BUILTIN[0];
          let x = 0;
          let y = 0;
          let bw = 8;
          let bh = 8;
          if (view.kind === "wall") {
            const p = view.toAlong(fix.along + box.x, fix.rise + box.y + box.h);
            const q = view.toAlong(fix.along + box.x + box.w, fix.rise + box.y);
            x = p.x;
            y = p.y;
            bw = q.x - p.x;
            bh = q.y - p.y;
          } else {
            const p = view.view.to({ x: fix.x + box.x, y: fix.y + box.y });
            const q = view.view.to({ x: fix.x + box.x + box.w, y: fix.y + box.y + box.h });
            x = p.x;
            y = p.y;
            bw = q.x - p.x;
            bh = q.y - p.y;
          }
          g.fillStyle = type.color;
          g.strokeStyle = session.mark.sel === fix.id ? colors.ink : "#1e293b";
          g.lineWidth = session.mark.sel === fix.id ? 2.5 : 1;
          g.fillRect(x, y, bw, bh);
          g.strokeRect(x, y, bw, bh);
          g.fillStyle = markInk(type.color);
          g.font = `700 ${Math.max(9, Math.min(bw, bh) * 0.42)}px sans-serif`;
          g.textAlign = "center";
          g.textBaseline = "middle";
          g.fillText(type.letters || "?", x + bw / 2, y + bh / 2);
        });
      });
    }
  }

  function lightBox(fix) {
    const type = lightById(fix.light) || LIGHT_BUILTIN[0];
    const shape = type.shape || "circle";
    let w = plannerClamp((type.size || 120) / 1000, 0.03, 0.8);
    let h = w;
    if (shape === "rect") {
      w = plannerClamp(plannerNum(fix.lw, 0.6), 0.05, 8);
      h = plannerClamp(plannerNum(fix.ll, 0.3), 0.05, 8);
    } else if (shape === "line") {
      w = plannerClamp(plannerNum(fix.ll, 1.2), 0.1, 12);
      h = 0.02;
    }
    return { w, h, shape, type };
  }

  function lightAngle(fix) {
    const raw = fix?.angle;
    const fallback = fix?.orient === "v" ? 90 : 0;
    const value = raw == null || raw === "" ? fallback : plannerNum(raw, fallback);
    return Math.round(((((value % 360) + 360) % 360) * 10)) / 10;
  }

  function lightRotates(shape) {
    return shape === "rect" || shape === "line";
  }

  function lightPaint(g, view, fix, selected, ink) {
    const box = lightBox(fix);
    const p = view.kind === "wall" ? view.toAlong(fix.along - box.w / 2, fix.rise + box.h / 2) : view.view.to({ x: fix.x - box.w / 2, y: fix.y - box.h / 2 });
    const q = view.kind === "wall" ? view.toAlong(fix.along + box.w / 2, fix.rise - box.h / 2) : view.view.to({ x: fix.x + box.w / 2, y: fix.y + box.h / 2 });
    const sw = Math.abs(q.x - p.x);
    const sh = Math.abs(q.y - p.y);
    const cx = (p.x + q.x) / 2;
    const cy = (p.y + q.y) / 2;
    g.save();
    g.translate(cx, cy);
    if (lightRotates(box.shape)) g.rotate((lightAngle(fix) * Math.PI) / 180);
    g.fillStyle = box.type.color;
    g.strokeStyle = selected ? ink : box.type.color;
    g.lineWidth = 2;
    const draw = box.shape === "line" || box.shape === "rect" ? "square" : box.shape;
    markShape(g, draw, -sw / 2, -sh / 2, sw, sh);
    g.restore();
    return { cx, cy, sw, sh, angle: lightRotates(box.shape) ? lightAngle(fix) : 0 };
  }

  function markShape(g, shape, x, y, w, h) {
    g.beginPath();
    if (shape === "diamond") {
      g.moveTo(x + w / 2, y);
      g.lineTo(x + w, y + h / 2);
      g.lineTo(x + w / 2, y + h);
      g.lineTo(x, y + h / 2);
      g.closePath();
    } else if (shape === "square") g.rect(x, y, w, h);
    else g.arc(x + w / 2, y + h / 2, Math.min(Math.abs(w), Math.abs(h)) / 2, 0, Math.PI * 2);
    g.fill();
    g.stroke();
  }

  function markInk(hex) {
    const n = Number.parseInt(String(hex || "").slice(1), 16);
    if (!Number.isFinite(n)) return "#fff";
    const r = (n >> 16) & 255;
    const gv = (n >> 8) & 255;
    const b = n & 255;
    return r * 0.3 + gv * 0.59 + b * 0.11 > 160 ? "#1e293b" : "#fff";
  }

  function markHoleScreen(hole, view) {
    if (!view) return null;
    if (view.kind === "wall") {
      if (hole.shape === "circle") {
        const c = view.toAlong(hole.along, hole.rise);
        const r = Math.max(4, (hole.d / 2) * view.scale);
        return { x: c.x - r, y: c.y - r, w: r * 2, h: r * 2, circle: true };
      }
      const p = view.toAlong(hole.along, hole.rise + hole.h);
      const q = view.toAlong(hole.along + hole.w, hole.rise);
      return { x: Math.min(p.x, q.x), y: Math.min(p.y, q.y), w: Math.abs(q.x - p.x), h: Math.abs(q.y - p.y) };
    }
    if (hole.shape === "circle") {
      const c = view.view.to({ x: hole.x, y: hole.y });
      const edge = view.view.to({ x: hole.x + hole.d / 2, y: hole.y });
      const r = Math.max(4, Math.hypot(edge.x - c.x, edge.y - c.y));
      return { x: c.x - r, y: c.y - r, w: r * 2, h: r * 2, circle: true };
    }
    const p = view.view.to({ x: hole.x, y: hole.y });
    const q = view.view.to({ x: hole.x + hole.w, y: hole.y + hole.h });
    return { x: Math.min(p.x, q.x), y: Math.min(p.y, q.y), w: Math.abs(q.x - p.x), h: Math.abs(q.y - p.y) };
  }

  function markEdgeAt(box, x, y) {
    const t = 8;
    if (x < box.x - t || x > box.x + box.w + t || y < box.y - t || y > box.y + box.h + t) return "";
    const left = Math.abs(x - box.x) <= t;
    const right = Math.abs(x - (box.x + box.w)) <= t;
    const top = Math.abs(y - box.y) <= t;
    const bottom = Math.abs(y - (box.y + box.h)) <= t;
    if (box.circle) return "";
    let edge = "";
    if (top) edge += "n";
    if (bottom) edge += "s";
    if (left) edge += "w";
    if (right) edge += "e";
    return edge;
  }

  function markResize(hole, drag, world) {
    const wall = hole.surface === "wall";
    const dx = wall ? world.along - drag.pointer.along : world.x - drag.pointer.x;
    const dy = wall ? world.rise - drag.pointer.rise : world.y - drag.pointer.y;
    if (hole.shape === "circle") return;
    if (wall) {
      let along = drag.along;
      let rise = drag.rise;
      let w = drag.w;
      let h = drag.h;
      if (drag.mode.includes("e")) w = drag.w + dx;
      if (drag.mode.includes("w")) {
        along = drag.along + dx;
        w = drag.w - dx;
      }
      if (drag.mode.includes("n")) h = drag.h + dy;
      if (drag.mode.includes("s")) {
        rise = drag.rise + dy;
        h = drag.h - dy;
      }
      hole.w = plannerRound(Math.max(0.05, w));
      hole.h = plannerRound(Math.max(0.05, h));
      hole.along = plannerRound(along);
      hole.rise = plannerRound(rise);
      return;
    }
    let x = drag.x;
    let y = drag.y;
    let w = drag.w;
    let h = drag.h;
    if (drag.mode.includes("e")) w = drag.w + dx;
    if (drag.mode.includes("w")) {
      x = drag.x + dx;
      w = drag.w - dx;
    }
    if (drag.mode.includes("s")) h = drag.h + dy;
    if (drag.mode.includes("n")) {
      y = drag.y + dy;
      h = drag.h - dy;
    }
    hole.w = plannerRound(Math.max(0.05, w));
    hole.h = plannerRound(Math.max(0.05, h));
    hole.x = plannerRound(x);
    hole.y = plannerRound(y);
  }

  function markHit(ctx, x, y) {
    const view = session.mark?.view;
    if (!view) return "";
    const surface = session.mark.surface;
    if (ctx.node.type === "openings") {
      const holes = markLocals(ctx);
      for (let i = holes.length - 1; i >= 0; i -= 1) {
        const hole = holes[i];
        if (view.kind === "wall") {
          if (hole.surface !== "wall" || hole.wallId !== view.wall.id) continue;
          const spot = hole.shape === "circle" ? view.toAlong(hole.along, hole.rise) : view.toAlong(hole.along + hole.w / 2, hole.rise + hole.h / 2);
          const reach = hole.shape === "circle" ? Math.max(10, (hole.d / 2) * view.scale + 6) : Math.max(12, Math.hypot((hole.w * view.scale) / 2, (hole.h * view.scale) / 2));
          if (Math.hypot(x - spot.x, y - spot.y) <= reach) return hole.id;
        } else if (hole.surface === surface) {
          if (hole.shape === "circle") {
            const spot = view.view.to({ x: hole.x, y: hole.y });
            const edge = view.view.to({ x: hole.x + hole.d / 2, y: hole.y });
            if (Math.hypot(x - spot.x, y - spot.y) <= Math.hypot(edge.x - spot.x, edge.y - spot.y) + 8) return hole.id;
          } else {
            const p = view.view.to({ x: hole.x, y: hole.y });
            const q = view.view.to({ x: hole.x + hole.w, y: hole.y + hole.h });
            const pad = 6;
            if (x >= Math.min(p.x, q.x) - pad && x <= Math.max(p.x, q.x) + pad && y >= Math.min(p.y, q.y) - pad && y <= Math.max(p.y, q.y) + pad) return hole.id;
          }
        }
      }
      return "";
    }
    for (let i = ctx.node.fixtures.length - 1; i >= 0; i -= 1) {
      const fix = ctx.node.fixtures[i];
      const here = view.kind === "wall" ? fix.surface === "wall" && fix.wallId === view.wall.id : fix.surface === surface;
      if (!here) continue;
      if (fix.kind === "light") {
        const box = lightBox(fix);
        const p = view.kind === "wall" ? view.toAlong(fix.along - box.w / 2, fix.rise + box.h / 2) : view.view.to({ x: fix.x - box.w / 2, y: fix.y - box.h / 2 });
        const q = view.kind === "wall" ? view.toAlong(fix.along + box.w / 2, fix.rise - box.h / 2) : view.view.to({ x: fix.x + box.w / 2, y: fix.y + box.h / 2 });
        const cx = (p.x + q.x) / 2;
        const cy = (p.y + q.y) / 2;
        const ang = lightRotates(box.shape) ? (-lightAngle(fix) * Math.PI) / 180 : 0;
        const dx = x - cx;
        const dy = y - cy;
        const rx = dx * Math.cos(ang) - dy * Math.sin(ang);
        const ry = dx * Math.sin(ang) + dy * Math.cos(ang);
        const pad = 6;
        if (Math.abs(rx) <= Math.abs(q.x - p.x) / 2 + pad && Math.abs(ry) <= Math.abs(q.y - p.y) / 2 + pad) {
          session.mark.hitCell = null;
          return fix.id;
        }
        continue;
      }
      const boxes = frameBoxes(fix);
      const hitIndex = boxes.findIndex((box) => {
        const p = view.kind === "wall" ? view.toAlong(fix.along + box.x, fix.rise + box.y) : view.view.to({ x: fix.x + box.x, y: fix.y + box.y });
        const q = view.kind === "wall" ? view.toAlong(fix.along + box.x + box.w, fix.rise + box.y + box.h) : view.view.to({ x: fix.x + box.x + box.w, y: fix.y + box.y + box.h });
        return x >= Math.min(p.x, q.x) - 6 && x <= Math.max(p.x, q.x) + 6 && y >= Math.min(p.y, q.y) - 6 && y <= Math.max(p.y, q.y) + 6;
      });
      if (hitIndex >= 0) {
        session.mark.hitCell = hitIndex;
        return fix.id;
      }
      const spot = view.kind === "wall" ? view.toAlong(fix.along, fix.rise) : view.view.to({ x: fix.x, y: fix.y });
      if (Math.hypot(x - spot.x, y - spot.y) <= 18) {
        session.mark.hitCell = null;
        return fix.id;
      }
    }
    return "";
  }

  function markWorld(x, y) {
    const view = session.mark?.view;
    if (!view) return null;
    if (view.kind === "wall") return view.from(x, y);
    const point = view.view.from(x, y);
    return { x: point.x, y: point.y };
  }

  function markPlace(node, world, extra) {
    const surface = session.mark?.surface || "floor";
    const spot = {
      surface,
      wallId: surface !== "floor" && surface !== "ceiling" ? surface : "",
      along: world.along || 0,
      rise: world.rise || 0,
      x: world.x || 0,
      y: world.y || 0,
    };
    if (node.type === "openings") {
      const hole = {
        id: uid(),
        ...spot,
        shape: extra.shape || "rect",
        w: extra.w || 0.9,
        h: extra.h || 2.1,
        d: extra.d || 0.11,
        bind: { w: false, h: false, d: false },
        picked: true,
      };
      if (hole.shape === "rect" && hole.surface === "wall" && hole.rise < 0.15) {
        hole.rise = 0;
        hole.w = extra.w || 0.9;
        hole.h = extra.h || 2.1;
        hole.along = (world.along || 0) - hole.w / 2;
      } else if (hole.shape === "rect") {
        hole.w = extra.w || 1.2;
        hole.h = extra.h || 1.2;
        hole.along = (world.along || 0) - hole.w / 2;
        hole.rise = (world.rise || 0) - hole.h / 2;
        if (hole.surface !== "wall") {
          hole.x = (world.x || 0) - hole.w / 2;
          hole.y = (world.y || 0) - hole.h / 2;
        }
      }
      node.holes.push(hole);
      session.mark.sel = hole.id;
      return hole.id;
    }
    if (extra.kind === "light") {
      const lightId = extra.light || "chandelier";
      const shape = lightById(lightId)?.shape;
      const fix = { id: uid(), kind: "light", ...spot, orient: "h", cells: ["socket"], light: lightId, lw: shape === "rect" ? 0.6 : 0.6, ll: shape === "line" ? 1.2 : 0.3 };
      node.fixtures.push(fix);
      session.mark.sel = fix.id;
      return fix.id;
    }
    const count = plannerClamp(session.mark?.section || 1, 1, 6);
    const cells = Array.from({ length: count }, () => extra.type || "socket");
    const fix = { id: uid(), kind: "socket", ...spot, orient: session.mark?.orient === "v" ? "v" : "h", cells, light: "chandelier" };
    node.fixtures.push(fix);
    session.mark.sel = fix.id;
    return fix.id;
  }

  function presetSwatch(kind, type) {
    const color = markHex(type?.color, kind === "light" ? "#facc15" : "#a78bfa");
    const ink = markInk(color);
    const px = Math.max(22, Math.min(46, Math.round(plannerNum(type?.size, kind === "light" ? 120 : 80) * 46 / 200)));
    const shape = type?.shape || "circle";
    let glyph = "";
    if (kind !== "light") {
      const x = (50 - px) / 2;
      glyph = `<rect x="${x}" y="${x}" width="${px}" height="${px}" rx="5" fill="${color}"/><text x="25" y="26" text-anchor="middle" fill="${ink}" font-size="${Math.max(10, Math.round(px * 0.36))}" font-weight="700">${esc(type?.letters || "")}</text>`;
    } else if (shape === "line") {
      const w = Math.min(46, Math.max(28, px));
      glyph = `<rect x="${(50 - w) / 2}" y="24" width="${w}" height="2" rx="1" fill="${color}"/>`;
    } else if (shape === "rect") {
      const w = Math.min(46, Math.max(30, px));
      const h = Math.max(12, Math.round(w * 0.4));
      glyph = `<rect x="${(50 - w) / 2}" y="${(50 - h) / 2}" width="${w}" height="${h}" rx="3" fill="${color}"/>`;
    } else if (shape === "diamond") {
      const s = px / 2;
      glyph = `<polygon points="25,${25 - s} ${25 + s},25 25,${25 + s} ${25 - s},25" fill="${color}"/>`;
    } else if (shape === "square") {
      const x = (50 - px) / 2;
      glyph = `<rect x="${x}" y="${x}" width="${px}" height="${px}" rx="3" fill="${color}"/>`;
    } else {
      glyph = `<circle cx="25" cy="25" r="${px / 2}" fill="${color}"/>`;
    }
    return `<span class="mark-swatch"><svg viewBox="0 0 50 50" width="50" height="50" aria-hidden="true">${glyph}</svg></span>`;
  }

  const PRESET_SHAPES = [
    { value: "circle", label: "круг" },
    { value: "square", label: "квадрат" },
    { value: "diamond", label: "ромб" },
    { value: "rect", label: "прямоугольник" },
    { value: "line", label: "линейный" },
  ];

  function presetRow(kind, type) {
    const id = esc(type.id);
    const extra = kind === "light"
      ? markSelect(`data-preset-shape="${id}"`, "", PRESET_SHAPES, type.shape || "circle")
      : `<input data-preset-letters="${id}" data-preset-kind="socket" maxlength="3" value="${esc(type.letters || "")}" aria-label="Буквы" />`;
    return `<div class="mark-preset-row" data-preset-id="${id}" data-preset-kind="${kind}"><span class="mark-drag" draggable="true" title="Перетащить" aria-label="Порядок"></span>${presetSwatch(kind, type)}<input data-preset-name="${id}" data-preset-kind="${kind}" maxlength="32" value="${esc(type.name)}" aria-label="Имя" />${extra}<input type="color" data-preset-color="${id}" data-preset-kind="${kind}" value="${esc(markHex(type.color, kind === "light" ? "#facc15" : "#a78bfa"))}" aria-label="Цвет" /><input data-preset-size="${id}" data-preset-kind="${kind}" inputmode="decimal" value="${esc(String(type.size || ""))}" aria-label="Размер, миллиметры" /><button type="button" class="calc-mini" data-del-custom="${kind}" data-custom-id="${id}" title="Удалить">×</button></div>`;
  }

  function refreshPresetRow(row) {
    if (!row) return;
    const kind = row.dataset.presetKind === "light" ? "light" : "socket";
    const type = presetCatalog(kind).find((item) => item.id === row.dataset.presetId);
    const slot = row.querySelector(".mark-swatch");
    if (type && slot) slot.outerHTML = presetSwatch(kind, type);
  }

  function markPresetHtml() {
    const socketForm = `<form class="mark-custom" data-custom="socket">${presetSwatch("socket", { letters: "Р", color: "#a78bfa", size: 80 })}<input name="name" maxlength="32" placeholder="Имя" aria-label="Имя розетки" /><input name="letters" maxlength="3" placeholder="Буквы" aria-label="Буквы, до трёх" /><input name="color" type="color" value="#a78bfa" aria-label="Цвет" /><input name="size" inputmode="decimal" value="80" aria-label="Размер, миллиметры" /><button type="submit" class="btn">Добавить</button></form>`;
    const lightForm = `<form class="mark-custom" data-custom="light">${presetSwatch("light", { shape: "circle", color: "#facc15", size: 120 })}<input name="name" maxlength="32" placeholder="Имя" aria-label="Имя света" />${markSelect("", "shape", [{ value: "circle", label: "круг" }, { value: "square", label: "квадрат" }, { value: "diamond", label: "ромб" }, { value: "rect", label: "прямоугольник" }, { value: "line", label: "линейный" }], "circle")}<input name="color" type="color" value="#facc15" aria-label="Цвет" /><input name="size" inputmode="decimal" value="120" aria-label="Размер, миллиметры" /><button type="submit" class="btn">Добавить</button></form>`;
    return `<div class="mark-presets" data-presets><section><h4>Розетки</h4>${socketForm}${socketCatalog().map((type) => presetRow("socket", type)).join("")}</section><section><h4>Свет</h4>${lightForm}${lightCatalog().map((type) => presetRow("light", type)).join("")}</section></div>`;
  }

  function refreshPresetDraft(form) {
    const slot = form?.querySelector(".mark-swatch");
    if (!slot) return;
    const data = new FormData(form);
    const next = form.dataset.custom === "light"
      ? presetSwatch("light", { shape: String(data.get("shape") || "circle"), color: data.get("color"), size: data.get("size") })
      : presetSwatch("socket", { letters: String(data.get("letters") || ""), color: data.get("color"), size: data.get("size") });
    slot.outerHTML = next;
  }

  function markShowMenu(clientX, clientY, hitId) {
    const canvas = $("mark-canvas");
    const menu = $("mark-menu");
    const card = $("mark-menu-card");
    const node = markNode();
    if (!canvas || !menu || !card || !node || !session.mark) return;
    const rect = canvas.getBoundingClientRect();
    const x = clientX - rect.left;
    const y = clientY - rect.top;
    const world = markWorld(x, y);
    if (!world) return;
    session.mark.menu = { x, y, world, hitId: hitId || "" };
    if (hitId) session.mark.sel = hitId;
    menu.hidden = false;
    menu.style.left = `${x}px`;
    menu.style.top = `${y}px`;
    menu.classList.toggle("is-plain", !hitId);
    const arrows = $("mark-arrows");
    if (arrows) arrows.hidden = !hitId;
    const surface = session.mark.surface;
    if (node.type === "openings") {
      card.innerHTML = `<button type="button" data-mark-act="rect">Прямоугольник</button><button type="button" data-mark-act="circle">Круг</button><div class="mark-dias">${PIPE_MM.map((mm) => `<button type="button" data-mark-act="dia" data-mm="${mm}">${mm}</button>`).join("")}</div>`;
    } else {
      const fix = hitId ? node.fixtures.find((item) => item.id === hitId) : null;
      const onSocket = fix && fix.kind !== "light" && session.mark.hitCell != null;
      if (fix && fix.kind === "light") {
        const swap = lightCatalog()
          .map((type) => `<button type="button" data-mark-act="swap-light" data-type="${esc(type.id)}" class="${type.id === fix.light ? "is-on" : ""}">${esc(type.name)}</button>`)
          .join("");
        const shape = lightById(fix.light)?.shape;
        const spin = lightRotates(shape)
          ? `<button type="button" data-mark-act="spin">+45°</button><div class="mark-angle"><input data-menu-angle inputmode="decimal" value="${esc(String(lightAngle(fix)))}" aria-label="Угол, градусы" /><button type="button" data-mark-act="angle">Угол</button></div>`
          : "";
        card.innerHTML = `${spin}<div class="mark-types"><b>Свет</b>${swap}</div>`;
      } else if (onSocket) {
        const current = fix.cells[session.mark.hitCell] || "";
        const swap = socketCatalog()
          .map((type) => `<button type="button" data-mark-act="swap" data-type="${esc(type.id)}" class="${type.id === current ? "is-on" : ""}">${esc(type.letters)} · ${esc(type.name)}</button>`)
          .join("");
        const flip = fix.orient === "v" ? "Горизонтально" : "Вертикально";
        card.innerHTML = `<button type="button" data-mark-act="flip">${flip}</button><div class="mark-sec"><span>Ячейки</span><button type="button" data-mark-act="sec" data-step="-1">−</button><b>${fix.cells.length}</b><button type="button" data-mark-act="sec" data-step="1">+</button></div><div class="mark-types"><b>Эта секция</b>${swap}</div>`;
      } else {
        const sockets = socketCatalog()
          .map((type) => `<button type="button" data-mark-act="socket" data-type="${esc(type.id)}">${esc(type.letters)} · ${esc(type.name)}</button>`)
          .join("");
        const lights = lightCatalog()
          .map((type) => `<button type="button" data-mark-act="light" data-type="${esc(type.id)}">${esc(type.name)}</button>`)
          .join("");
        card.innerHTML = `<div class="mark-orient">
          <button type="button" data-mark-act="orient" data-orient="h" class="${session.mark.orient !== "v" ? "is-on" : ""}">Горизонтально</button>
          <button type="button" data-mark-act="orient" data-orient="v" class="${session.mark.orient === "v" ? "is-on" : ""}">Вертикально</button>
        </div>
        <div class="mark-sec"><span>В секции</span><button type="button" data-mark-act="sec" data-step="-1">−</button><b>${session.mark.section || 1}</b><button type="button" data-mark-act="sec" data-step="1">+</button></div>
        <div class="mark-types"><b>Розетки</b>${sockets}<b>Свет</b>${lights}</div>
        <div class="mark-split"></div>
        <button type="button" data-mark-act="presets">Предустановки</button>`;
      }
    }
    const box = $("mark-nudge-box");
    if (box) box.hidden = true;
  }

  function markShift(node, hitId, dir, dist) {
    const vec = PLANNER_NUDGE_DIRS[dir];
    if (!vec || !(dist > 0)) return false;
    const len = Math.hypot(vec[0], vec[1]) || 1;
    const dx = (vec[0] / len) * dist;
    const dy = (vec[1] / len) * dist;
    if (node.type === "openings") {
      const hole = node.holes.find((item) => item.id === hitId);
      if (!hole) return false;
      if (hole.surface === "wall") {
        hole.along = plannerRound(hole.along + dx);
        hole.rise = plannerRound(hole.rise - dy);
      } else {
        hole.x = plannerRound(hole.x + dx);
        hole.y = plannerRound(hole.y + dy);
      }
      return true;
    }
    const fix = node.fixtures.find((item) => item.id === hitId);
    if (!fix) return false;
    if (fix.surface === "wall") {
      fix.along = plannerRound(fix.along + dx);
      fix.rise = plannerRound(fix.rise - dy);
    } else {
      fix.x = plannerRound(fix.x + dx);
      fix.y = plannerRound(fix.y + dy);
    }
    return true;
  }

  function ensureMarkModal() {
    if ($("mark-modal")) return;
    const modal = document.createElement("div");
    modal.className = "modal";
    modal.id = "mark-modal";
    modal.innerHTML = `<div class="modal-card planner-modal mark-modal" role="dialog" aria-label="Чертёж">
      <div class="planner-head">
        <input id="mark-title" class="planner-title" maxlength="48" spellcheck="false" aria-label="Имя" />
        <button type="button" class="btn primary" id="mark-close">Готово</button>
      </div>
      <div class="planner-body">
        <div class="planner-stage">
          <div class="planner-cap" id="mark-cap">Пол</div>
          <div class="planner-plan-wrap">
            <canvas id="mark-canvas"></canvas>
            <div id="mark-menu" class="mark-menu" hidden>
              <div id="mark-arrows" class="planner-nudge">
                <button type="button" class="planner-nudge-dir" data-dir="nw" aria-label="Вверх-влево"><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 3.2 12.4 11.2H3.6z"/></svg></button>
                <button type="button" class="planner-nudge-dir" data-dir="n" aria-label="Вверх"><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 3.2 12.4 11.2H3.6z"/></svg></button>
                <button type="button" class="planner-nudge-dir" data-dir="ne" aria-label="Вверх-вправо"><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 3.2 12.4 11.2H3.6z"/></svg></button>
                <button type="button" class="planner-nudge-dir" data-dir="w" aria-label="Влево"><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 3.2 12.4 11.2H3.6z"/></svg></button>
                <button type="button" class="planner-nudge-dir" data-dir="e" aria-label="Вправо"><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 3.2 12.4 11.2H3.6z"/></svg></button>
                <button type="button" class="planner-nudge-dir" data-dir="sw" aria-label="Вниз-влево"><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 3.2 12.4 11.2H3.6z"/></svg></button>
                <button type="button" class="planner-nudge-dir" data-dir="s" aria-label="Вниз"><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 3.2 12.4 11.2H3.6z"/></svg></button>
                <button type="button" class="planner-nudge-dir" data-dir="se" aria-label="Вниз-вправо"><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 3.2 12.4 11.2H3.6z"/></svg></button>
              </div>
              <form id="mark-nudge-box" class="planner-nudge-box" hidden>
                <input id="mark-nudge-input" inputmode="decimal" autocomplete="off" placeholder="0" aria-label="Сдвиг, метры" />
                <span>м</span>
                <button type="submit" aria-label="Сдвинуть"><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3.2 8.2 6.4 11.4 12.8 4.6"/></svg></button>
              </form>
              <div id="mark-menu-card" class="mark-menu-card"></div>
            </div>
          </div>
          <div class="planner-hint" id="mark-hint"></div>
          <div class="mark-film" id="mark-film"></div>
        </div>
        <div class="planner-side" id="mark-side"></div>
      </div>
    </div>`;
    document.body.appendChild(modal);
    const preset = document.createElement("div");
    preset.className = "modal";
    preset.id = "mark-preset-modal";
    preset.innerHTML = `<div class="modal-card mark-preset-card" role="dialog" aria-label="Предустановки"><div class="planner-head"><strong>Предустановки</strong><button type="button" class="btn primary" id="mark-preset-close">Готово</button></div><div id="mark-preset-body"></div></div>`;
    document.body.appendChild(preset);
    preset.addEventListener("click", (e) => {
      const pickBtn = e.target.closest(".mark-select-btn");
      if (pickBtn) {
        e.preventDefault();
        placeMarkList(pickBtn);
        return;
      }
      const opt = e.target.closest(".mark-opt");
      if (opt) {
        const box = opt.closest(".mark-select");
        const hidden = box?.querySelector('input[type="hidden"]');
        if (hidden) hidden.value = opt.dataset.opt || "";
        const face = box?.querySelector(".mark-select-btn");
        if (face) face.textContent = opt.textContent || "";
        box?.querySelectorAll(".mark-select-list").forEach((el) => { el.hidden = true; });
        const form = opt.closest("form");
        if (form) refreshPresetDraft(form);
        const shapeId = opt.dataset.presetShape;
        if (shapeId) {
          patchPreset("light", shapeId, { shape: opt.dataset.opt || "circle" });
          refreshPresetRow(opt.closest(".mark-preset-row"));
          markCommit(false);
        }
        return;
      }
      const delCustom = e.target.closest("[data-del-custom]");
      if (delCustom) {
        dropPreset(delCustom.dataset.delCustom === "light" ? "light" : "socket", delCustom.dataset.customId);
        const body = $("mark-preset-body");
        if (body) body.innerHTML = markPresetHtml();
        markCommit(true);
        return;
      }
      if (!e.target.closest(".mark-select")) document.querySelectorAll("#mark-preset-modal .mark-select-list").forEach((el) => { el.hidden = true; });
      if (e.target === preset || e.target.closest("#mark-preset-close")) preset.classList.remove("open");
    });
    preset.addEventListener("input", (e) => {
      const form = e.target.closest?.("form.mark-custom");
      if (form) refreshPresetDraft(form);
      const kind = e.target.dataset?.presetKind === "light" ? "light" : "socket";
      const nameId = e.target.dataset?.presetName;
      if (nameId) {
        const name = String(e.target.value || "").trim().slice(0, 32);
        if (name) patchPreset(kind, nameId, { name });
        markCommit(false);
        return;
      }
      const lettersId = e.target.dataset?.presetLetters;
      if (lettersId) {
        const letters = markLetters(e.target.value);
        if (letters) {
          patchPreset("socket", lettersId, { letters });
          refreshPresetRow(e.target.closest(".mark-preset-row"));
          markCommit(false);
        }
        return;
      }
      const colorId = e.target.dataset?.presetColor;
      if (colorId) {
        patchPreset(kind, colorId, { color: e.target.value });
        refreshPresetRow(e.target.closest(".mark-preset-row"));
        markCommit(false);
        return;
      }
      const sizeId = e.target.dataset?.presetSize;
      if (sizeId) {
        const size = plannerDraft(e.target.value);
        if (size == null) return;
        patchPreset(kind, sizeId, { size });
        refreshPresetRow(e.target.closest(".mark-preset-row"));
        markCommit(false);
      }
    });
    preset.addEventListener("dragstart", (e) => {
      const handle = e.target.closest?.(".mark-drag");
      const row = handle?.closest(".mark-preset-row");
      if (!handle || !row) {
        e.preventDefault();
        return;
      }
      preset.dataset.dragId = row.dataset.presetId || "";
      preset.dataset.dragKind = row.dataset.presetKind || "";
      e.dataTransfer.effectAllowed = "move";
      e.dataTransfer.setData("text/plain", preset.dataset.dragId);
      row.classList.add("is-drag");
    });
    preset.addEventListener("dragover", (e) => {
      const row = e.target.closest?.(".mark-preset-row");
      if (!row || !preset.dataset.dragId || row.dataset.presetKind !== preset.dataset.dragKind) return;
      e.preventDefault();
      const box = row.getBoundingClientRect();
      const before = e.clientY < box.top + box.height / 2;
      preset.querySelectorAll(".mark-preset-row").forEach((el) => el.classList.remove("is-before", "is-after"));
      row.classList.add(before ? "is-before" : "is-after");
      preset.dataset.dragBefore = before ? "1" : "0";
      preset.dataset.dragOver = row.dataset.presetId || "";
    });
    preset.addEventListener("drop", (e) => {
      const kind = preset.dataset.dragKind === "light" ? "light" : "socket";
      const id = preset.dataset.dragId;
      const target = preset.dataset.dragOver;
      if (id && target) movePreset(kind, id, target, preset.dataset.dragBefore !== "0");
      preset.querySelectorAll(".mark-preset-row").forEach((el) => el.classList.remove("is-drag", "is-before", "is-after"));
      delete preset.dataset.dragId;
      delete preset.dataset.dragKind;
      delete preset.dataset.dragOver;
      const body = $("mark-preset-body");
      if (body) body.innerHTML = markPresetHtml();
      markCommit(false);
      e.preventDefault();
    });
    preset.addEventListener("dragend", () => {
      preset.querySelectorAll(".mark-preset-row").forEach((el) => el.classList.remove("is-drag", "is-before", "is-after"));
      delete preset.dataset.dragId;
      delete preset.dataset.dragKind;
    });
    preset.addEventListener("submit", (e) => onMarkCustom(e));
    modal.addEventListener("click", (e) => {
      if (e.target === modal) closeMark();
    });
    $("mark-close")?.addEventListener("click", () => closeMark());
    $("mark-title")?.addEventListener("input", (e) => {
      const node = markNode();
      if (!node) return;
      node.name = String(e.target.value || "").trim().slice(0, 48);
      const card = document.querySelector(`[data-mark-title="${cssEsc(node.id)}"]`);
      if (card) card.value = node.name;
    });
    $("mark-title")?.addEventListener("change", () => markCommit(false));
    $("mark-canvas")?.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      const ctx = markContext();
      const canvas = $("mark-canvas");
      if (!ctx || !canvas) return;
      const rect = canvas.getBoundingClientRect();
      const hit = markHit(ctx, e.clientX - rect.left, e.clientY - rect.top);
      markShowMenu(e.clientX, e.clientY, hit);
    });
    $("mark-canvas")?.addEventListener("pointerdown", (e) => {
      if (e.button !== 0) return;
      const ctx = markContext();
      const canvas = $("mark-canvas");
      if (!ctx || !canvas) return;
      markHideMenu();
      const rect = canvas.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      const hit = markHit(ctx, x, y);
      session.mark.sel = hit || "";
      if (hit && ctx.node.type === "openings") {
        const hole = ctx.node.holes.find((item) => item.id === hit);
        const live = hole ? resolveHole(hole, ctx.base, ctx.node, ctx.graph.values) : null;
        const box = live ? markHoleScreen(live, session.mark.view) : null;
        const edge = box ? markEdgeAt(box, x, y) : "";
        const world = markWorld(x, y);
        if (edge && world && hole) {
          session.mark.drag = {
            id: hit,
            mode: edge,
            pointer: world,
            along: hole.along,
            rise: hole.rise,
            w: hole.w,
            h: hole.h,
            x: hole.x,
            y: hole.y,
            d: hole.d,
          };
          markDraw();
          return;
        }
      }
      if (hit) {
        session.mark.drag = { id: hit, x: e.clientX, y: e.clientY };
        markDraw();
      } else markFill();
    });
    $("mark-canvas")?.addEventListener("pointermove", (e) => {
      const drag = session.mark?.drag;
      const node = markNode();
      if (!drag || !node) return;
      const canvas = $("mark-canvas");
      const rect = canvas.getBoundingClientRect();
      const world = markWorld(e.clientX - rect.left, e.clientY - rect.top);
      if (!world) return;
      if (node.type === "openings") {
        const hole = node.holes.find((item) => item.id === drag.id);
        if (!hole) return;
        if (drag.mode) {
          markResize(hole, drag, world);
          markDraw();
          return;
        }
        if (hole.surface === "wall") {
          if (hole.shape === "circle") {
            hole.along = world.along;
            hole.rise = world.rise;
          } else {
            hole.along = world.along - hole.w / 2;
            hole.rise = world.rise - hole.h / 2;
          }
        } else if (hole.shape === "circle") {
          hole.x = world.x;
          hole.y = world.y;
        } else {
          hole.x = world.x - hole.w / 2;
          hole.y = world.y - hole.h / 2;
        }
      } else {
        const fix = node.fixtures.find((item) => item.id === drag.id);
        if (!fix) return;
        if (fix.surface === "wall") {
          fix.along = world.along;
          fix.rise = world.rise;
        } else {
          fix.x = world.x;
          fix.y = world.y;
        }
      }
      markDraw();
    });
    window.addEventListener("pointerup", () => {
      if (!session.mark?.drag) return;
      session.mark.drag = null;
      markCommit(true);
    });
    $("mark-menu")?.addEventListener("contextmenu", (e) => e.preventDefault());
    $("mark-arrows")?.addEventListener("click", (e) => {
      const btn = e.target.closest("[data-dir]");
      const menu = session.mark?.menu;
      if (!btn || !menu?.hitId || !session.mark) return;
      session.mark.nudgeDir = btn.dataset.dir;
      $("mark-arrows")?.querySelectorAll("[data-dir]").forEach((el) => el.classList.toggle("is-on", el === btn));
      const box = $("mark-nudge-box");
      if (box) {
        box.hidden = false;
        $("mark-nudge-input")?.focus();
      }
    });
    $("mark-nudge-box")?.addEventListener("submit", (e) => {
      e.preventDefault();
      const node = markNode();
      const menu = session.mark?.menu;
      const dir = session.mark?.nudgeDir;
      const value = plannerDraft($("mark-nudge-input")?.value);
      const ok = !!(node && menu?.hitId && dir && value != null && markShift(node, menu.hitId, dir, value));
      $("mark-nudge-box")?.classList.toggle("is-bad", !ok);
      if (ok) markCommit(true);
    });
    $("mark-menu-card")?.addEventListener("click", (e) => {
      const delCustom = e.target.closest("[data-del-custom]");
      if (delCustom) {
        dropPreset(delCustom.dataset.delCustom === "light" ? "light" : "socket", delCustom.dataset.customId);
        markCommit(true);
        return;
      }
      const btn = e.target.closest("[data-mark-act]");
      const node = markNode();
      const menu = session.mark?.menu;
      if (!btn || !node || !menu) return;
      const act = btn.dataset.markAct;
      if (act === "flip") {
        const fix = node.fixtures.find((item) => item.id === menu.hitId);
        if (fix && fix.kind !== "light") fix.orient = fix.orient === "v" ? "h" : "v";
        markShowMenu(menu.x + $("mark-canvas").getBoundingClientRect().left, menu.y + $("mark-canvas").getBoundingClientRect().top, menu.hitId);
        markCommit(true);
        return;
      }
      if (act === "spin" || act === "angle") {
        const fix = node.fixtures.find((item) => item.id === menu.hitId);
        if (fix && lightRotates(lightById(fix.light)?.shape)) {
          if (act === "spin") fix.angle = (lightAngle(fix) + 45) % 360;
          else {
            const value = plannerDraft(btn.parentElement?.querySelector("[data-menu-angle]")?.value);
            if (value == null) return;
            fix.angle = lightAngle({ angle: value });
          }
        }
        markShowMenu(menu.x + $("mark-canvas").getBoundingClientRect().left, menu.y + $("mark-canvas").getBoundingClientRect().top, menu.hitId);
        markCommit(true);
        return;
      }
      if (act === "orient") {
        session.mark.orient = btn.dataset.orient === "v" ? "v" : "h";
        if (menu.hitId) {
          const fix = node.fixtures.find((item) => item.id === menu.hitId);
          if (fix && fix.kind !== "light") fix.orient = session.mark.orient;
        }
        markShowMenu(menu.x + $("mark-canvas").getBoundingClientRect().left, menu.y + $("mark-canvas").getBoundingClientRect().top, menu.hitId);
        if (menu.hitId) markCommit(true);
        return;
      }
      if (act === "sec") {
        const fix = menu.hitId ? node.fixtures.find((item) => item.id === menu.hitId) : null;
        const step = Number(btn.dataset.step || 0);
        if (fix && fix.kind !== "light" && session.mark.hitCell != null) {
          const next = plannerClamp(fix.cells.length + step, 1, 6);
          while (fix.cells.length < next) fix.cells.push(fix.cells[fix.cells.length - 1] || "socket");
          while (fix.cells.length > next) fix.cells.pop();
          if (session.mark.hitCell >= fix.cells.length) session.mark.hitCell = fix.cells.length - 1;
          markShowMenu(menu.x + $("mark-canvas").getBoundingClientRect().left, menu.y + $("mark-canvas").getBoundingClientRect().top, menu.hitId);
          markCommit(true);
          return;
        }
        session.mark.section = plannerClamp((session.mark.section || 1) + step, 1, 6);
        markShowMenu(menu.x + $("mark-canvas").getBoundingClientRect().left, menu.y + $("mark-canvas").getBoundingClientRect().top, menu.hitId);
        return;
      }
      if (act === "swap") {
        const fix = node.fixtures.find((item) => item.id === menu.hitId);
        const index = session.mark.hitCell;
        if (fix && index != null && fix.cells[index] != null) fix.cells[index] = btn.dataset.type;
        markHideMenu();
        markCommit(true);
        return;
      }
      if (act === "swap-light") {
        const fix = node.fixtures.find((item) => item.id === menu.hitId);
        if (fix) {
          fix.light = btn.dataset.type || fix.light;
          const shape = lightById(fix.light)?.shape;
          if (shape === "rect" && !(fix.lw > 0)) fix.lw = 0.6;
          if (shape === "line" && !(fix.ll > 0.2)) fix.ll = 1.2;
        }
        markHideMenu();
        markCommit(true);
        return;
      }
      if (act === "presets") {
        const body = $("mark-preset-body");
        if (body) body.innerHTML = markPresetHtml();
        $("mark-preset-modal")?.classList.add("open");
        markHideMenu();
        return;
      }
      if (act === "rect") markPlace(node, menu.world, { shape: "rect" });
      else if (act === "circle") markPlace(node, menu.world, { shape: "circle", d: 0.11 });
      else if (act === "dia") markPlace(node, menu.world, { shape: "circle", d: Number(btn.dataset.mm) / 1000 });
      else if (act === "socket") markPlace(node, menu.world, { kind: "socket", type: btn.dataset.type });
      else if (act === "light") markPlace(node, menu.world, { kind: "light", light: btn.dataset.type });
      markHideMenu();
      markCommit(true);
    });
    $("mark-film")?.addEventListener("wheel", (e) => {
      const film = e.currentTarget;
      if (!(film instanceof HTMLElement) || film.scrollWidth <= film.clientWidth + 4) return;
      e.preventDefault();
      film.scrollLeft += e.deltaY + e.deltaX;
    }, { passive: false });
    $("mark-film")?.addEventListener("click", (e) => {
      const btn = e.target.closest("[data-mark-surface]");
      const node = markNode();
      if (!btn || !node || !session.mark) return;
      const ctx = markContext();
      session.mark.surface = markSurfaceOk(ctx?.base, btn.dataset.markSurface);
      node.view = session.mark.surface;
      session.mark.sel = "";
      markHideMenu();
      markCommit(true);
    });
    $("mark-side")?.addEventListener("click", (e) => {
      const node = markNode();
      if (!node) return;
      const pickBtn = e.target.closest(".mark-select-btn");
      if (pickBtn) {
        e.preventDefault();
        placeMarkList(pickBtn);
        return;
      }
      const opt = e.target.closest(".mark-opt");
      if (opt) {
        const box = opt.closest(".mark-select");
        const hidden = box?.querySelector('input[type="hidden"]');
        const value = opt.dataset.opt || "";
        if (hidden) hidden.value = value;
        box?.querySelectorAll(".mark-select-list").forEach((el) => {
          el.hidden = true;
        });
        const variable = opt.dataset.holeVar;
        if (variable && node.type === "openings") {
          const field = opt.dataset.bind;
          const port = `b:${variable}:${field}`;
          if (!value) disconnectInput(node.id, port);
          else {
            const [from, fromPort] = value.split("\t");
            connect(from, fromPort, node.id, port);
          }
          markFill();
          return;
        }
        const orient = opt.dataset.orient;
        if (orient) {
          const fix = node.fixtures.find((item) => item.id === orient);
          if (fix) fix.orient = value === "v" ? "v" : "h";
          markCommit(true);
          return;
        }
        const cell = opt.dataset.cell;
        if (cell) {
          const fix = node.fixtures.find((item) => item.id === cell);
          const index = Number(opt.dataset.cellI);
          if (fix && fix.cells[index] != null) fix.cells[index] = value;
          markCommit(true);
          return;
        }
        const light = opt.dataset.light;
        if (light) {
          const fix = node.fixtures.find((item) => item.id === light);
          if (fix) fix.light = value;
          markCommit(true);
        }
        return;
      }
      if (!e.target.closest(".mark-select")) {
        document.querySelectorAll("#mark-side .mark-select-list").forEach((el) => {
          el.hidden = true;
        });
      }
      const bulk = e.target.closest("[data-mark-bulk]");
      if (bulk && node.type === "openings") {
        const plan = markContext()?.base;
        const walls = plan ? plannerWalls(plan) : [];
        const on = bulk.dataset.markBulk.endsWith("on");
        if (!node.outOn) node.outOn = {};
        if (bulk.dataset.markBulk.startsWith("walls")) walls.forEach((wall) => { node.outOn[`wall:${wall.id}`] = on; });
        else ["count:pick", "count:door", "count:window", "count:pipe", "count:hatch"].forEach((id) => { node.outOn[id] = on; });
        markCommit(true);
        return;
      }
      const ownAdd = e.target.closest("[data-own-add]");
      if (ownAdd && node.type === "openings") {
        if (!Array.isArray(node.owns)) node.owns = [];
        node.owns.push({ id: uid(), name: "Свой", holes: [] });
        markCommit(true);
        return;
      }
      const ownDel = e.target.closest("[data-own-del]");
      if (ownDel && node.type === "openings") {
        node.owns = (node.owns || []).filter((own) => own.id !== ownDel.dataset.ownDel);
        markCommit(true);
        return;
      }
      const ownGroupToggle = e.target.closest("[data-own-group-toggle]");
      if (ownGroupToggle && node.type === "openings") {
        const own = (node.owns || []).find((item) => item.id === ownGroupToggle.dataset.ownGroupOwn);
        if (!own) return;
        if (!Array.isArray(own.holes)) own.holes = [];
        const groupKey = ownGroupToggle.dataset.ownGroupKey;
        const ctx = markContext();
        if (!ctx?.base || !ctx.graph) return;
        const groupIds = node.holes.filter((hole) => {
          const live = resolveHole(hole, ctx.base, node, ctx.graph.values);
          const key = live.surface === "wall" ? `wall:${live.wallId}` : live.surface;
          return key === groupKey;
        }).map((hole) => hole.id);
        const hasAny = groupIds.some((id) => own.holes.includes(id));
        own.holes = hasAny
          ? own.holes.filter((id) => !groupIds.includes(id))
          : [...new Set(own.holes.concat(groupIds))];
        markCommit(true);
        return;
      }
      const ownBox = e.target.closest("[data-own-hole]");
      if (ownBox && node.type === "openings") {
        const own = (node.owns || []).find((item) => item.id === ownBox.dataset.own);
        if (!own) return;
        if (!Array.isArray(own.holes)) own.holes = [];
        const id = ownBox.dataset.ownHole;
        own.holes = ownBox.checked ? own.holes.concat(own.holes.includes(id) ? [] : [id]) : own.holes.filter((item) => item !== id);
        markCommit(true);
        return;
      }
      const mmBtn = e.target.closest("[data-hole-mm]");
      if (mmBtn && node.type === "openings") {
        const hole = node.holes.find((item) => item.id === mmBtn.dataset.holeMm);
        if (hole && !hole.bind?.d) {
          hole.d = plannerRound(Number(mmBtn.dataset.mm) / 1000);
          hole.shape = "circle";
          markCommit(true);
        }
        return;
      }
      const delHole = e.target.closest("[data-hole-del]");
      if (delHole && node.type === "openings") {
        const id = delHole.dataset.holeDel;
        node.holes = node.holes.filter((hole) => hole.id !== id);
        const bp = activeBlueprint();
        if (bp) bp.links = (bp.links || []).filter((link) => !(link.to === node.id && String(link.toPort || "").startsWith(`b:${id}:`)));
        markCommit(true);
        return;
      }
      const full = e.target.closest("[data-hole-full]");
      if (full && node.type === "openings") {
        const ctx = markContext();
        const hole = node.holes.find((item) => item.id === full.dataset.holeFull);
        const wall = ctx?.base ? plannerWalls(ctx.base).find((item) => item.id === hole?.wallId) : null;
        if (hole && wall) {
          hole.along = 0;
          hole.rise = 0;
          hole.w = plannerRound(wall.len);
          hole.shape = "rect";
          markCommit(true);
        }
        return;
      }
      const spin = e.target.closest("[data-light-spin]");
      if (spin && node.type === "electrics") {
        const fix = node.fixtures.find((item) => item.id === spin.dataset.lightSpin);
        if (fix) fix.angle = (lightAngle(fix) + 45) % 360;
        markCommit(true);
        return;
      }
      const delFix = e.target.closest("[data-fix-del]");
      if (delFix) {
        node.fixtures = node.fixtures.filter((item) => item.id !== delFix.dataset.fixDel);
        markCommit(true);
        return;
      }
      const addCell = e.target.closest("[data-cell-add]");
      if (addCell) {
        const fix = node.fixtures.find((item) => item.id === addCell.dataset.cellAdd);
        if (fix && fix.cells.length < 6) {
          fix.cells.push(fix.cells[fix.cells.length - 1] || "socket");
          markCommit(true);
        }
        return;
      }
      const delCustom = e.target.closest("[data-del-custom]");
      if (delCustom) {
        dropPreset(delCustom.dataset.delCustom === "light" ? "light" : "socket", delCustom.dataset.customId);
        markCommit(true);
      }
    });
    $("mark-side")?.addEventListener("change", (e) => {
      const node = markNode();
      const bp = activeBlueprint();
      if (!node || !bp) return;
      const out = e.target.dataset?.markOut;
      if (out) {
        const linked = linkedFromPorts(node.id, bp.links);
        if (linked.has(out)) {
          e.target.checked = true;
          return;
        }
        node.outOn[out] = !!e.target.checked;
        markCommit(false);
        return;
      }
      const bind = e.target.dataset?.holeBind;
      if (bind && node.type === "openings") {
        const hole = node.holes.find((item) => item.id === bind);
        const field = e.target.dataset.bind;
        if (!hole || !field) return;
        if (!hole.bind) hole.bind = { w: false, h: false, d: false };
        hole.bind[field] = !!e.target.checked;
        if (!e.target.checked) bp.links = bp.links.filter((link) => !(link.to === node.id && link.toPort === `b:${hole.id}:${field}`));
        markCommit(true);
        return;
      }
      const variable = e.target.dataset?.holeVar;
      if (variable && node.type === "openings") {
        const field = e.target.dataset.bind;
        const port = `b:${variable}:${field}`;
        const raw = String(e.target.value || "");
        if (!raw) disconnectInput(node.id, port);
        else {
          const [from, fromPort] = raw.split("\t");
          connect(from, fromPort, node.id, port);
        }
        markFill();
        return;
      }
      const orient = e.target.dataset?.orient;
      if (orient) {
        const fix = node.fixtures.find((item) => item.id === orient);
        if (fix) fix.orient = e.target.value === "v" ? "v" : "h";
        markCommit(true);
        return;
      }
      const cell = e.target.dataset?.cell;
      if (cell) {
        const fix = node.fixtures.find((item) => item.id === cell);
        const index = Number(e.target.dataset.cellI);
        if (fix && fix.cells[index] != null) fix.cells[index] = e.target.value;
        markCommit(true);
        return;
      }
      const light = e.target.dataset?.light;
      if (light) {
        const fix = node.fixtures.find((item) => item.id === light);
        if (fix) fix.light = e.target.value;
        markCommit(true);
      }
    });
    $("mark-side")?.addEventListener("input", (e) => {
      if (e.target.dataset?.counterName) {
        const node = markNode();
        if (!node || node.type !== "openings") return;
        if (!node.counterNames || typeof node.counterNames !== "object" || Array.isArray(node.counterNames)) node.counterNames = {};
        const key = e.target.dataset.counterName;
        const allowed = new Set(["pick", "doors", "windows", "pipes", "hatches"]);
        if (!allowed.has(key)) return;
        node.counterNames[key] = String(e.target.value || "").trim().slice(0, 48);
        markCommit(false);
        return;
      }
      if (e.target.dataset?.cardName) {
        const node = markNode();
        if (!node) return;
        const id = e.target.dataset.cardName;
        const fallback = e.target.dataset.labelFallback || "";
        const value = String(e.target.value || "").trim().slice(0, 48);
        const list = e.target.dataset.cardKind === "hole" ? node.holes : node.fixtures;
        const item = (list || []).find((row) => row.id === id);
        if (item) item.name = !value || value === fallback ? "" : value;
        if (item && e.target.dataset.cardKind === "hole") {
          const title = item.name || fallback;
          $("mark-side")?.querySelectorAll(`[data-own-title="${cssEsc(id)}"]`).forEach((el) => { el.textContent = title; });
        }
        markCommit(false);
        return;
      }
      const lightAngleId = e.target.dataset?.lightAngle;
      if (lightAngleId) {
        const node = markNode();
        const fix = node?.fixtures?.find((item) => item.id === lightAngleId);
        const value = plannerDraft(e.target.value);
        if (fix && value != null) {
          fix.angle = lightAngle({ angle: value });
          markCommit(false);
        }
        return;
      }
      const lightW = e.target.dataset?.lightW;
      const lightL = e.target.dataset?.lightL;
      if (lightW || lightL) {
        const node = markNode();
        const fix = node?.fixtures?.find((item) => item.id === (lightW || lightL));
        const value = plannerDraft(e.target.value);
        if (fix && value != null) {
          if (lightW) fix.lw = plannerRound(plannerClamp(value, 0.05, 8));
          else fix.ll = plannerRound(plannerClamp(value, 0.05, 12));
          markCommit(false);
        }
        return;
      }
      const node = markNode();
      if (!node || node.type !== "openings") return;
      const map = [
        ["holeW", "w", 0.05, 500],
        ["holeH", "h", 0.05, 30],
        ["holeD", "d", 5, 2000],
      ];
      for (const [data, field, lo, hi] of map) {
        const id = e.target.dataset?.[data];
        if (!id) continue;
        const hole = node.holes.find((item) => item.id === id);
        const value = plannerDraft(e.target.value);
        if (!hole || value == null || hole.bind?.[field]) return;
        if (field === "d") hole.d = plannerRound(plannerClamp(value / 1000, 0.005, 2));
        else hole[field] = plannerRound(plannerClamp(value, lo, hi));
        markCommit(false);
        return;
      }
      const ownName = e.target.dataset?.ownName;
      if (ownName) {
        const own = (node.owns || []).find((item) => item.id === ownName);
        if (own) own.name = String(e.target.value || "").trim().slice(0, 48) || "Свой";
        markCommit(false);
        return;
      }
      const pick = e.target.dataset?.holePick;
      if (pick) {
        const hole = node.holes.find((item) => item.id === pick);
        if (hole) hole.picked = !!e.target.checked;
        markCommit(true);
      }
    });
    $("mark-menu-card")?.addEventListener("submit", onMarkCustom);
    $("mark-side")?.addEventListener("submit", onMarkCustom);
    function onMarkCustom(e) {
      const form = e.target.closest?.("[data-custom]") || (e.target.dataset?.custom ? e.target : null);
      if (!form) return;
      e.preventDefault();
      const calc = ensureState();
      if (!calc) return;
      const data = new FormData(form);
      const name = String(data.get("name") || "").trim().slice(0, 32);
      if (!name) return;
      if (form.dataset.custom === "light") {
        if (!Array.isArray(calc.lightTypes)) calc.lightTypes = [];
        calc.lightTypes.push({
          id: `c-${uid()}`,
          name,
          shape: ["square", "diamond", "rect", "line", "circle"].includes(String(data.get("shape"))) ? String(data.get("shape")) : "circle",
          color: markHex(data.get("color"), "#facc15"),
          size: Math.round(plannerClamp(plannerNum(data.get("size"), 120), 20, 800)),
        });
      } else {
        const letters = markLetters(data.get("letters"));
        if (!letters) {
          api?.toast?.("Нужны буквы, от одной до трёх");
          return;
        }
        if (!Array.isArray(calc.socketTypes)) calc.socketTypes = [];
        calc.socketTypes.push({
          id: `c-${uid()}`,
          name,
          letters,
          color: markHex(data.get("color"), "#a78bfa"),
          size: Math.round(plannerClamp(plannerNum(data.get("size"), 80), 20, 400)),
        });
      }
      const old = form.closest("#mark-menu-card")?.querySelector("[data-presets]");
      if (old) old.outerHTML = markPresetHtml();
      const body = $("mark-preset-body");
      if (body && $("mark-preset-modal")?.classList.contains("open")) body.innerHTML = markPresetHtml();
      markCommit(true);
    }
    window.addEventListener("resize", () => {
      if (session.mark?.id) markDraw();
    });
  }

  function addNode(type, point, extra) {
    const bp = activeBlueprint();
    if (!bp) return;
    const at = point || viewCenter(bp);
    session.place += 1;
    const node = { id: uid(), type, x: at.x, y: at.y };
    if (type === "math") node.op = "+";
    if (type === "result") {
      node.op = "result";
      node.name = "Результат";
      node.priority = nextResultPriority(bp);
      node.visible = true;
    }
    if (type === "percent") node.op = "percent";
    if (type === "const") node.value = 0;
    if (type === "scheme") node.blueprintId = extra?.blueprintId || "";
    if (type === "formula") {
      node.inputs = [
        { id: uid(), name: "A" },
        { id: uid(), name: "B" },
      ];
      node.outputs = [
        { id: uid(), name: "C", expr: "A+B" },
        { id: uid(), name: "D", expr: "(-40+A)*B" },
      ];
    }
    if (type === "order") node.orderId = extra?.orderId || "";
    if (type === "filter") {
      node.customers = [];
      node.orderIds = [];
      node.period = "all";
      node.payFilters = [];
      node.payStatusFilters = [];
      node.statuses = [];
      node.orderTypes = [];
      node.products = [];
      node.dateFrom = "";
      node.dateTo = "";
    }
    if (type === "dashboard") {
      node.customers = [];
      node.orderIds = [];
      node.period = "all";
      node.payFilters = [];
      node.payStatusFilters = [];
      node.statuses = [];
      node.orderTypes = [];
      node.products = [];
      node.dateFrom = "";
      node.dateTo = "";
      node.openPorts = DASH_DEFAULT.slice();
    }
    if (type === "planner") {
      const ids = [uid(), uid(), uid(), uid()];
      node.name = "Планировщик";
      node.color = GROUP_COLORS[Math.floor(Math.random() * GROUP_COLORS.length)];
      node.height = 2.7;
      node.heightOut = false;
      node.points = [
        { id: ids[0], x: 0, y: 0 },
        { id: ids[1], x: 4, y: 0 },
        { id: ids[2], x: 4, y: 3 },
        { id: ids[3], x: 0, y: 3 },
      ];
      node.outs = [
        { id: "floor", kind: "floor", name: "Пол", on: true },
        ...ids.map((id) => ({ id: `w:${id}`, kind: "wall", name: "", on: false })),
        { id: uid(), kind: "sum", name: "Стены", on: true, parts: ids.map((id) => `w:${id}`) },
      ];
    }
    if (type === "openings") {
      node.name = "Проёмы";
      node.color = GROUP_COLORS[Math.floor(Math.random() * GROUP_COLORS.length)];
      node.holes = [];
      node.outOn = { "count:pick": true, "count:door": true, "count:window": true, "count:pipe": true, "count:hatch": true };
      node.owns = [];
      node.view = "floor";
    }
    if (type === "electrics") {
      node.name = "Электрика";
      node.color = GROUP_COLORS[Math.floor(Math.random() * GROUP_COLORS.length)];
      node.fixtures = [];
      node.outOn = {};
      node.view = "floor";
    }
    if (type === "present") {
      node.pageId = extra?.pageId || "";
      node.blockId = extra?.blockId || "";
      node.blockType = extra?.blockType || "metric";
      node.title = extra?.title || "Блок";
    }
    if (type === "group") {
      node.name = "Группа";
      node.color = GROUP_COLORS[Math.floor(Math.random() * GROUP_COLORS.length)];
      node.w = 320;
      node.h = 220;
    }
    if (type === "comment") node.text = "";
    bp.nodes.push(node);
    session.selected = node.id;
    dirty();
    render();
  }

  function removeNode(id) {
    const bp = activeBlueprint();
    if (!bp) return;
    bp.nodes = bp.nodes.filter((node) => node.id !== id);
    bp.links = bp.links.filter((link) => link.from !== id && link.to !== id);
    if (session.selected === id) session.selected = "";
    dirty();
    render();
  }

  function duplicateNode(id) {
    const bp = activeBlueprint();
    if (!bp || !id) return;
    const src = (bp.nodes || []).find((node) => node.id === id);
    if (!src) return;
    let clone;
    try {
      clone = JSON.parse(JSON.stringify(src));
    } catch {
      return;
    }
    clone.id = uid();
    clone.x = (Number(src.x) || 0) + 48;
    clone.y = (Number(src.y) || 0) + 48;
    if (clone.type === "formula") {
      (clone.inputs || []).forEach((port) => {
        port.id = uid();
      });
      (clone.outputs || []).forEach((port) => {
        port.id = uid();
      });
    }
    if (clone.type === "result") {
      clone.priority = nextResultPriority(bp);
    }
    bp.nodes.push(clone);
    session.selected = clone.id;
    dirty();
    render();
  }

  function pruneOrphanNodes() {
    const bp = activeBlueprint();
    if (!bp) return 0;
    const linked = new Set();
    (bp.links || []).forEach((link) => {
      if (link.from) linked.add(link.from);
      if (link.to) linked.add(link.to);
    });
    const before = (bp.nodes || []).length;
    bp.nodes = (bp.nodes || []).filter((node) => node.type === "scheme" || node.type === "group" || node.type === "comment" || linked.has(node.id));
    const removed = before - bp.nodes.length;
    if (!removed) return 0;
    const keep = new Set(bp.nodes.map((node) => node.id));
    bp.links = (bp.links || []).filter((link) => keep.has(link.from) && keep.has(link.to));
    if (session.selected && !keep.has(session.selected)) session.selected = "";
    dirty();
    render();
    return removed;
  }

  function usedInputPorts(nodeId, links) {
    const used = new Set();
    (links || []).forEach((link) => {
      if (link.to === nodeId) used.add(link.toPort);
    });
    return used;
  }

  function firstFreeMathPort(nodeId, links) {
    const used = usedInputPorts(nodeId, links);
    for (let i = 1; i <= MATH_MAX; i += 1) {
      if (!used.has(`in${i}`)) return `in${i}`;
    }
    return "";
  }

  function resolveToPort(dst, requested, links) {
    if (dst.type === "math") {
      if (/^in([1-9]|1[0-9]|20)$/.test(requested || "")) return requested;
      return firstFreeMathPort(dst.id, links);
    }
    if (dst.type === "order") {
      const parsed = parseLinePort(requested);
      if (parsed?.input && parsed.field) {
        const order = api.findOrder(dst.orderId);
        const line = (order?.lines || []).find((item) => item.id === parsed.lineId);
        if (lineInputFieldOptions(line, order).some((item) => item.id === parsed.field)) {
          ensureOpenField(dst, parsed.lineId, parsed.field);
          return lineInPortId(parsed.lineId, parsed.field);
        }
        return "";
      }
    }
    const inputs = nodeInputs(dst, links);
    if (requested && inputs.some((port) => port.id === requested)) return requested;
    return inputs[0]?.id || "";
  }

  function matchPortId(wanted, ids) {
    if (!wanted) return "";
    if (ids.includes(wanted)) return wanted;
    const hits = ids.filter((id) => id.startsWith(wanted) || wanted.startsWith(id));
    return hits.length === 1 ? hits[0] : "";
  }

  function healLinks(bp) {
    if (!bp) return false;
    let changed = false;
    // Убрать устаревшие текстовые порты «за что» / product
    (bp.nodes || []).forEach((node) => {
      if (node.type !== "order" || !node.openFields) return;
      Object.keys(node.openFields).forEach((lineId) => {
        const list = node.openFields[lineId] || [];
        const next = list.filter((f) => f !== "product");
        if (next.length === list.length) return;
        changed = true;
        if (next.length) node.openFields[lineId] = next;
        else delete node.openFields[lineId];
      });
    });
    const beforeLinks = (bp.links || []).length;
    bp.links = (bp.links || []).filter((link) => {
      const to = parseLinePort(link.toPort);
      const from = parseLinePort(link.fromPort);
      if (to?.field === "product" || from?.field === "product") return false;
      return true;
    });
    if ((bp.links || []).length !== beforeLinks) changed = true;
    (bp.links || []).forEach((link) => {
      const src = (bp.nodes || []).find((node) => node.id === link.from);
      const dst = (bp.nodes || []).find((node) => node.id === link.to);
      if (src?.type === "order") {
        const ids = nodeOutputs(src, api.findOrder(src.orderId), bp.links).map((port) => port.id);
        const hit = matchPortId(link.fromPort, ids);
        if (hit && hit !== link.fromPort) {
          link.fromPort = hit;
          changed = true;
        }
      }
      if (dst?.type === "order") {
        const ids = nodeInputs(dst, bp.links).map((port) => port.id);
        const hit = matchPortId(link.toPort, ids);
        if (hit && hit !== link.toPort) {
          link.toPort = hit;
          changed = true;
        }
      }
    });
    return changed;
  }

  function connect(from, fromPort, to, toPort) {
    const bp = activeBlueprint();
    if (!bp || from === to) return false;
    const src = bp.nodes.find((node) => node.id === from);
    const dst = bp.nodes.find((node) => node.id === to);
    if (!src || !dst) return false;
    const srcIds = nodeOutputs(src, api.findOrder(src.orderId), bp.links).map((port) => port.id);
    const fromHit = matchPortId(fromPort, srcIds);
    if (!fromHit) return false;
    const port = resolveToPort(dst, toPort, bp.links);
    if (!port) return false;
    if (portSignal(src, fromHit) !== portSignal(dst, port)) {
      api?.toast?.("Чертёж соединяется только с чертежом");
      return false;
    }
    if (dst.type === "present" && dst.blockId) {
      const owner = presentOwner(dst.blockId, port, bp.id);
      if (owner) {
        api?.toast?.(`Вход занят схемой «${owner.blueprint.name || "Схема"}»`);
        return false;
      }
    }
    if (dst.type === "order") {
      const parsed = parseLinePort(port);
      if (parsed?.input && parsed.field) {
        const order = api.findOrder(dst.orderId);
        const line = (order?.lines || []).find((item) => item.id === parsed.lineId);
        const allowed = lineInputFieldOptions(line, order).some((item) => item.id === parsed.field);
        if (!allowed) {
          api?.toast?.("Это поле нельзя подать на вход этой позиции");
          return false;
        }
        const owner = orderFieldOwner(dst.orderId, parsed.lineId, parsed.field);
        // Разрешаем только замену связи на том же порту той же ноды
        if (owner && !(owner.blueprint.id === bp.id && owner.node.id === dst.id && owner.link.toPort === port)) {
          api?.toast?.(orderFieldOwnerReason(owner, line, order, parsed.field));
          return false;
        }
        ensureOpenField(dst, parsed.lineId, parsed.field);
      }
    }
    const replaced = (bp.links || []).filter((link) => link.to === to && link.toPort === port);
    bp.links = bp.links.filter((link) => !(link.to === to && link.toPort === port));
    bp.links.push({ id: uid(), from, fromPort: fromHit, to, toPort: port });
    replaced.forEach((link) => releaseOrderField(bp, link.from, link.fromPort));
    dirty();
    render();
    if (dst.type === "order") api?.refreshOrders?.();
    return true;
  }

  function releaseOrderField(bp, nodeId, fromPort) {
    const parsed = parseLinePort(fromPort);
    if (parsed?.field && !parsed.input) {
      const still = (bp.links || []).some((link) => link.from === nodeId && link.fromPort === fromPort);
      if (still) return;
      const inStill = (bp.links || []).some(
        (link) => link.to === nodeId && link.toPort === lineInPortId(parsed.lineId, parsed.field)
      );
      if (inStill) return;
      const node = (bp.nodes || []).find((item) => item.id === nodeId && item.type === "order");
      if (node) dropOpenField(node, parsed.lineId, parsed.field);
      return;
    }
    const typed = parseTypePort(fromPort);
    if (!typed?.field) return;
    const stillType = (bp.links || []).some((link) => link.from === nodeId && link.fromPort === fromPort);
    if (stillType) return;
    const orderNode = (bp.nodes || []).find((item) => item.id === nodeId && item.type === "order");
    if (orderNode) dropOpenTypeField(orderNode, typed.typeName, typed.field);
  }

  function releaseOrderInputField(bp, nodeId, toPort) {
    const parsed = parseLinePort(toPort);
    if (!parsed?.input || !parsed.field) return;
    const stillIn = (bp.links || []).some((link) => link.to === nodeId && link.toPort === toPort);
    if (stillIn) return;
    const stillOut = (bp.links || []).some(
      (link) => link.from === nodeId && link.fromPort === `line:${parsed.lineId}:${parsed.field}`
    );
    if (stillOut) return;
    const node = (bp.nodes || []).find((item) => item.id === nodeId && item.type === "order");
    if (!node) return;
    const open = openFieldsFor(node, parsed.lineId);
    // Не снимаем поле с ноды автоматически при обрыве только входа — оставляем, если явно открыто.
    if (!open.includes(parsed.field)) return;
  }

  function removeLink(id) {
    const bp = activeBlueprint();
    if (!bp || !id) return;
    const gone = bp.links.find((link) => link.id === id);
    const before = bp.links.length;
    bp.links = bp.links.filter((link) => link.id !== id);
    if (bp.links.length !== before) {
      if (session.selectedLink === id) session.selectedLink = "";
      if (gone) {
        releaseOrderField(bp, gone.from, gone.fromPort);
        releaseOrderInputField(bp, gone.to, gone.toPort);
      }
      dirty();
      render();
      api?.refreshOrders?.();
    }
  }

  function finishLink(from, fromPort, to, toPort) {
    session.linking = null;
    setLinkingClass();
    return connect(from, fromPort, to, toPort);
  }

  function disconnectInput(nodeId, portId) {
    const bp = activeBlueprint();
    if (!bp) return;
    const gone = (bp.links || []).filter((link) => link.to === nodeId && link.toPort === portId);
    const before = bp.links.length;
    bp.links = bp.links.filter((link) => !(link.to === nodeId && link.toPort === portId));
    if (bp.links.length !== before) {
      gone.forEach((link) => {
        releaseOrderField(bp, link.from, link.fromPort);
        releaseOrderInputField(bp, link.to, link.toPort);
      });
      dirty();
      render();
      api?.refreshOrders?.();
    }
  }

  function renderTabs(calc) {
    const host = $("calc-tabs");
    if (!host) return;
    const left = host.scrollLeft;
    host.innerHTML = calc.blueprints
      .map(
        (bp) => `<div class="calc-tab ${bp.id === calc.active ? "active" : ""}" data-bp="${esc(bp.id)}" draggable="true" title="${esc(bp.name)}">
          <span class="calc-tab-label">${esc(bp.name)}</span>
          ${calc.blueprints.length > 1 ? `<button type="button" class="calc-tab-x" data-del-bp="${esc(bp.id)}" title="Закрыть схему" draggable="false">×</button>` : ""}
        </div>`
      )
      .join("");
    host.scrollLeft = left;
    const on = host.querySelector(".calc-tab.active");
    if (on) on.scrollIntoView({ inline: "nearest", block: "nearest" });
  }

  function reorderBlueprint(fromId, toId, placeAfter) {
    const calc = ensureState();
    if (!calc || !fromId || !toId || fromId === toId) return false;
    const from = calc.blueprints.findIndex((bp) => bp.id === fromId);
    let to = calc.blueprints.findIndex((bp) => bp.id === toId);
    if (from < 0 || to < 0) return false;
    const [item] = calc.blueprints.splice(from, 1);
    to = calc.blueprints.findIndex((bp) => bp.id === toId);
    if (to < 0) {
      calc.blueprints.push(item);
    } else {
      calc.blueprints.splice(placeAfter ? to + 1 : to, 0, item);
    }
    dirty();
    render();
    return true;
  }

  function renderTitle(bp) {
    const field = $("calc-bp-name");
    if (!field || !bp) return;
    if (document.activeElement === field) return;
    field.value = bp.name || "Схема";
  }

  function orderStamp(order) {
    let best = "";
    for (const line of order?.lines || []) {
      const day = String(line.order_date || "").slice(0, 10);
      if (day.length >= 10 && day > best) best = day;
    }
    if (best) return best;
    return String(order?.created_at || "").slice(0, 10);
  }

  function calcToolButton(type, label, icon) {
    return `<button type="button" class="btn calc-tool" data-add-node="${type}" draggable="true"><svg class="calc-tool-ico" viewBox="0 0 16 16" aria-hidden="true">${icon}</svg>${label}</button>`;
  }

  function renderSide(bp) {
    const host = $("calc-side");
    if (!host) return;
    const calc = ensureState();
    const q = session.search.trim().toLowerCase();
    const src = api.orders() || [];
    const orders = src
      .map((order, index) => ({ order, index }))
      .filter(({ order }) => {
        if (!q) return true;
        const blob = `${order.number || ""} ${order.name || ""} ${order.customer || ""}`.toLowerCase();
        return blob.includes(q);
      })
      .sort((a, b) => {
        const da = orderStamp(a.order);
        const db = orderStamp(b.order);
        if (db !== da) return db.localeCompare(da);
        return b.index - a.index;
      })
      .map((item) => item.order);
    const usedOrders = new Set(
      (bp?.nodes || []).filter((node) => node.type === "order" && node.orderId).map((node) => node.orderId)
    );
    const schemes = (calc?.blueprints || []).filter((item) => item.id !== bp?.id);
    host.innerHTML = `
      <details class="calc-fold" data-fold="nodes" ${foldOpen("nodes") ? "open" : ""}>
        <summary class="calc-tools-label">Ноды</summary>
        <div class="calc-tools">
          ${calcToolButton("math", "Оператор", `<path d="M8 3.2v9.6M3.2 8h9.6"/>`)}
          ${calcToolButton("formula", "Формула", `<path d="M5.6 3.2c-1.7.3-2.4 1.3-2.4 2.3 0 1.5 1.1 2.1 2.3 2.3-1.5.5-2.5 1.5-2.5 3 0 1.4 1.1 2.2 2.6 2.2M9.1 4.4l3.8 7.2M9.4 8.2h3.2"/>`)}
          ${calcToolButton("percent", "Процент", `<circle cx="5" cy="4.8" r="1.45" fill="currentColor" stroke="none"/><circle cx="11" cy="11.2" r="1.45" fill="currentColor" stroke="none"/><path d="M12.3 3.4 3.7 12.6"/>`)}
          ${calcToolButton("const", "Константа", `<rect x="3" y="3" width="10" height="10" rx="2"/><path d="M8 5.4v5.2"/>`)}
          ${calcToolButton("filter", "Фильтр", `<path d="M2.6 3.2h10.8L9.4 8.2v4.2l-2.8 1.2V8.2z"/>`)}
          ${calcToolButton("dashboard", "Дашборд", `<path d="M3 13V8.4M8 13V3.6M13 13V6.4M2.2 13h11.6"/>`)}
          ${calcToolButton("planner", "Планировщик", `<path d="M3 3.2h10v9.6H3zM3 7.4h4.2"/>`)}
          ${calcToolButton("openings", "Проёмы", `<path d="M3 3.2h10v9.6H3zM6.2 12.8V7.2h3.6v5.6M4.2 6.2h2.2v2.4H4.2z"/>`)}
          ${calcToolButton("electrics", "Электрика", `<path d="M8 2.8v3.2M6.2 6h3.6v2.4L8 13.2 6.2 8.4V6z"/>`)}
          ${calcToolButton("result", "Результат", `<path d="M2.6 5.2h6.4M2.6 10.8h6.4M10.2 8h3.4M11.6 6.2 13.8 8l-2.2 1.8"/>`)}
          ${calcToolButton("group", "Группа", `<rect x="3" y="3" width="10" height="10" rx="1.5" stroke-dasharray="2.2 1.5"/>`)}
          ${calcToolButton("comment", "Комментарий", `<path d="M3 2.8h6.6L13 6.2v7H3zM9.4 2.9V6h3.2M5 8.2h6M5 10.6h4"/>`)}
        </div>
      </details>
      <details class="calc-fold" data-fold="schemes" ${foldOpen("schemes") ? "open" : ""}>
        <summary class="calc-tools-label">Схемы</summary>
        <div class="calc-orders calc-schemes">
          <div class="calc-order-list calc-scheme-list">
            ${
              schemes.length
                ? schemes
                    .map((item) => {
                      const n = (item.nodes || []).filter((node) => node.type === "result" && resultVisible(node)).length;
                      return `<button type="button" class="calc-order" draggable="true" data-blueprint="${esc(item.id)}">
                        <b>${esc(item.name || "Схема")}</b>
                        <span>${n ? `${n} рез.` : "нет результатов"}</span>
                      </button>`;
                    })
                    .join("")
                : `<div class="calc-empty">Другая схема станет нодой: её выходы — ноды «Результат»</div>`
            }
          </div>
        </div>
      </details>
      <details class="calc-fold" data-fold="orders" ${foldOpen("orders") ? "open" : ""}>
        <summary class="calc-tools-label">Заказы</summary>
        <div class="calc-orders">
          <div class="calc-search${session.search ? " has-value" : ""}">
            <input type="search" id="calc-order-search" placeholder="Номер, название…" value="${esc(session.search)}" autocomplete="off" />
            <button type="button" class="search-clear" data-search-clear="calc-order-search" title="Очистить" aria-label="Очистить поиск">×</button>
          </div>
          <div class="calc-order-list">
            ${
              orders.length
                ? orders
                    .map((order) => {
                      const n = orderLines(order).length;
                      const used = usedOrders.has(order.id);
                      const label = `${order.number || "—"} — ${order.name || order.customer || "Без названия"}`;
                      const tip = used ? `${label} · на схеме` : label;
                      return `<button type="button" class="calc-order${used ? " is-used" : ""}" draggable="true" data-order="${esc(order.id)}" title="${esc(tip)}">
                        <b>${esc(order.number || "—")}</b>
                        <span>${esc(order.name || order.customer || "Без названия")}</span>
                        <small>${used ? "на схеме" : `${n} поз.`}</small>
                      </button>`;
                    })
                    .join("")
                : `<div class="calc-empty">Нет заказов</div>`
            }
          </div>
        </div>
      </details>`;
  }

  function hidePortMenu() {
    document.querySelectorAll(".calc-port-menu").forEach((el) => el.remove());
  }

  function showDashPortMenu(clientX, clientY, nodeId) {
    hidePortMenu();
    const bp = activeBlueprint();
    const node = bp?.nodes.find((item) => item.id === nodeId && item.type === "dashboard");
    if (!bp || !node) return;
    const open = new Set(openDashPorts(node));
    const linked = linkedFromPorts(node.id, bp.links);
    const menu = document.createElement("div");
    menu.className = "calc-port-menu";
    menu.style.left = `${clientX}px`;
    menu.style.top = `${clientY}px`;
    DASH_PORTS.forEach((port) => {
      const shown = open.has(port.id) || linked.has(port.id);
      const locked = linked.has(port.id);
      const btn = document.createElement("button");
      btn.type = "button";
      btn.textContent = port.name;
      if (shown) {
        btn.className = "is-shown";
        btn.title = locked ? "Порт занят связью" : "Убрать с ноды";
      } else {
        btn.title = "Добавить на ноду";
      }
      btn.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (locked) return;
        if (shown) dropDashPort(node, port.id);
        else ensureDashPort(node, port.id);
        hidePortMenu();
        dirty();
        render();
      });
      menu.appendChild(btn);
    });
    document.body.appendChild(menu);
    const place = () => {
      const rect = menu.getBoundingClientRect();
      let left = clientX;
      let top = clientY;
      if (left + rect.width > window.innerWidth - 8) left = Math.max(8, window.innerWidth - rect.width - 8);
      if (top + rect.height > window.innerHeight - 8) top = Math.max(8, window.innerHeight - rect.height - 8);
      menu.style.left = `${left}px`;
      menu.style.top = `${top}px`;
    };
    place();
    const close = (e) => {
      if (e.target.closest?.(".calc-port-menu")) return;
      hidePortMenu();
      document.removeEventListener("pointerdown", close, true);
    };
    setTimeout(() => document.addEventListener("pointerdown", close, true), 0);
  }

  function showLinePortMenu(clientX, clientY, nodeId, lineId) {
    hidePortMenu();
    const bp = activeBlueprint();
    const node = bp?.nodes.find((item) => item.id === nodeId && item.type === "order");
    const order = api.findOrder(node?.orderId);
    const line = (order?.lines || []).find((item) => item.id === lineId);
    if (!bp || !node || !line) return;
    const byId = new Map();
    lineFieldOptions(line, order).forEach((field) => byId.set(field.id, { ...field, canOut: true, canIn: false }));
    lineInputFieldOptions(line, order).forEach((field) => {
      const prev = byId.get(field.id) || { id: field.id, name: field.name, canOut: false, canIn: false };
      prev.canIn = true;
      prev.name = field.name;
      byId.set(field.id, prev);
    });
    const options = [...byId.values()];
    if (!options.length) return;
    const open = new Set(openFieldsFor(node, lineId));
    const linkedOut = linkedFromPorts(node.id, bp.links);
    const linkedIn = usedInputPorts(node.id, bp.links);
    const menu = document.createElement("div");
    menu.className = "calc-port-menu";
    menu.style.left = `${clientX}px`;
    menu.style.top = `${clientY}px`;
    options.forEach((field) => {
      const outId = `line:${lineId}:${field.id}`;
      const inId = lineInPortId(lineId, field.id);
      const shown = open.has(field.id) || linkedOut.has(outId) || linkedIn.has(inId);
      const lockedElsewhere = field.canIn && !!orderFieldOwner(node.orderId, lineId, field.id, null, node.id);
      const btn = document.createElement("button");
      btn.type = "button";
      btn.textContent = field.name + (field.canIn ? " ↔" : " →");
      if (lockedElsewhere && !shown) {
        btn.className = "is-locked";
        btn.title = orderFieldOwnerReason(
          orderFieldOwner(node.orderId, lineId, field.id),
          line,
          order,
          field.id
        );
        btn.addEventListener("click", (e) => {
          e.preventDefault();
          e.stopPropagation();
          api?.toast?.(btn.title);
        });
      } else if (shown) {
        btn.className = "is-shown";
        btn.title = linkedOut.has(outId) || linkedIn.has(inId) ? "Порт занят связью" : "Убрать с ноды";
        btn.addEventListener("click", (e) => {
          e.preventDefault();
          e.stopPropagation();
          if (linkedOut.has(outId) || linkedIn.has(inId)) {
            api?.toast?.("Сначала удалите связь");
            return;
          }
          dropOpenField(node, lineId, field.id);
          hidePortMenu();
          dirty();
          render();
        });
      } else {
        btn.title = field.canIn ? "Показать вход и выход" : "Показать выход";
        btn.addEventListener("click", (e) => {
          e.preventDefault();
          e.stopPropagation();
          ensureOpenField(node, lineId, field.id);
          hidePortMenu();
          dirty();
          render();
        });
      }
      menu.appendChild(btn);
    });
    document.body.appendChild(menu);
    const onDoc = (e) => {
      if (e.target.closest?.(".calc-port-menu")) return;
      hidePortMenu();
      document.removeEventListener("pointerdown", onDoc, true);
    };
    setTimeout(() => document.addEventListener("pointerdown", onDoc, true), 0);
  }

  function freeOrderFieldPort(orderId, lineId, field) {
    const calc = ensureState();
    const want = lineInPortId(lineId, field);
    let changed = false;
    (calc.blueprints || []).forEach((bp) => {
      const before = (bp.links || []).length;
      bp.links = (bp.links || []).filter((link) => {
        if (link.toPort !== want) return true;
        const dst = (bp.nodes || []).find((item) => item.id === link.to);
        if (!dst || dst.type !== "order" || dst.orderId !== orderId) return true;
        return false;
      });
      if (bp.links.length !== before) changed = true;
    });
    if (changed) {
      dirty();
      render();
      api?.refreshOrders?.();
    }
    return changed;
  }

  function showOrderInputPortMenu(clientX, clientY, nodeId, portId) {
    hidePortMenu();
    const bp = activeBlueprint();
    const node = bp?.nodes.find((item) => item.id === nodeId && item.type === "order");
    const parsed = parseLinePort(portId);
    if (!bp || !node || !parsed?.input || !parsed.field) return;
    const owner = orderFieldOwner(node.orderId, parsed.lineId, parsed.field);
    if (!owner || owner.node.id === node.id) return;
    const order = api.findOrder(node.orderId);
    const line = (order?.lines || []).find((item) => item.id === parsed.lineId);
    const menu = document.createElement("div");
    menu.className = "calc-port-menu";
    menu.style.left = `${clientX}px`;
    menu.style.top = `${clientY}px`;
    const info = document.createElement("div");
    info.className = "calc-port-menu-empty";
    info.textContent = orderFieldOwnerReason(owner, line, order, parsed.field);
    menu.appendChild(info);
    const btn = document.createElement("button");
    btn.type = "button";
    btn.textContent = "Освободить порт";
    btn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      freeOrderFieldPort(node.orderId, parsed.lineId, parsed.field);
      hidePortMenu();
    });
    menu.appendChild(btn);
    document.body.appendChild(menu);
    placePortMenu(menu, clientX, clientY);
    bindPortMenuClose(menu);
  }

  function placePortMenu(menu, clientX, clientY) {
    const rect = menu.getBoundingClientRect();
    let left = clientX;
    let top = clientY;
    if (left + rect.width > window.innerWidth - 8) left = Math.max(8, window.innerWidth - rect.width - 8);
    if (top + rect.height > window.innerHeight - 8) top = Math.max(8, window.innerHeight - rect.height - 8);
    menu.style.left = `${left}px`;
    menu.style.top = `${top}px`;
  }

  function bindPortMenuClose(menu) {
    const onDoc = (e) => {
      if (e.target.closest?.(".calc-port-menu")) return;
      hidePortMenu();
      document.removeEventListener("pointerdown", onDoc, true);
    };
    setTimeout(() => document.addEventListener("pointerdown", onDoc, true), 0);
  }

  function showOrderTypeMenu(clientX, clientY, nodeId) {
    hidePortMenu();
    const bp = activeBlueprint();
    const node = bp?.nodes.find((item) => item.id === nodeId && item.type === "order");
    const order = api.findOrder(node?.orderId);
    if (!bp || !node || !order) return;
    const names = orderTypeNames(order);
    const open = new Set(openTypesFor(node));
    const linked = linkedFromPorts(node.id, bp.links);
    const menu = document.createElement("div");
    menu.className = "calc-port-menu";
    menu.style.left = `${clientX}px`;
    menu.style.top = `${clientY}px`;
    if (!names.length) {
      const empty = document.createElement("div");
      empty.className = "calc-port-menu-empty";
      empty.textContent = "Нет типов в заказе";
      menu.appendChild(empty);
    }
    names.forEach((typeName) => {
      const portId = typePortId(typeName);
      const childLinked = typeFieldOptions(order, typeName).some((field) => linked.has(typePortId(typeName, field.id)));
      const shown = open.has(typeName) || linked.has(portId) || childLinked;
      const locked = linked.has(portId) || childLinked;
      const btn = document.createElement("button");
      btn.type = "button";
      btn.textContent = typeName;
      if (shown) {
        btn.className = "is-shown";
        btn.title = locked ? "Порт занят связью" : "Убрать с ноды";
      } else {
        btn.title = "Добавить сумму типа";
      }
      btn.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (locked) return;
        if (shown) dropOpenType(node, typeName);
        else ensureOpenType(node, typeName);
        hidePortMenu();
        dirty();
        render();
      });
      menu.appendChild(btn);
    });
    document.body.appendChild(menu);
    placePortMenu(menu, clientX, clientY);
    bindPortMenuClose(menu);
  }

  function showTypePortMenu(clientX, clientY, nodeId, typeName) {
    hidePortMenu();
    const bp = activeBlueprint();
    const node = bp?.nodes.find((item) => item.id === nodeId && item.type === "order");
    const order = api.findOrder(node?.orderId);
    if (!bp || !node || !order) return;
    const options = typeFieldOptions(order, typeName);
    if (!options.length) return;
    const open = new Set(openTypeFieldsFor(node, typeName));
    const linked = linkedFromPorts(node.id, bp.links);
    const menu = document.createElement("div");
    menu.className = "calc-port-menu";
    menu.style.left = `${clientX}px`;
    menu.style.top = `${clientY}px`;
    options.forEach((field) => {
      const portId = typePortId(typeName, field.id);
      const shown = open.has(field.id) || linked.has(portId);
      const btn = document.createElement("button");
      btn.type = "button";
      btn.textContent = field.name;
      if (shown) {
        btn.className = "is-shown";
        btn.title = "Убрать с ноды";
        btn.addEventListener("click", (e) => {
          e.preventDefault();
          e.stopPropagation();
          dropOpenTypeField(node, typeName, field.id);
          bp.links = (bp.links || []).filter((link) => !(link.from === nodeId && link.fromPort === portId));
          hidePortMenu();
          dirty();
          render();
        });
      } else {
        btn.addEventListener("click", (e) => {
          e.preventDefault();
          e.stopPropagation();
          ensureOpenType(node, typeName);
          ensureOpenTypeField(node, typeName, field.id);
          hidePortMenu();
          dirty();
          render();
        });
      }
      menu.appendChild(btn);
    });
    document.body.appendChild(menu);
    placePortMenu(menu, clientX, clientY);
    bindPortMenuClose(menu);
  }

  function orderNodeHtml(node, order, graph, bp) {
    const missing = !order;
    const ports = nodeOutputs(node, order, bp?.links);
    const linkedIn = usedInputPorts(node.id, bp?.links || []);
    return `<article class="calc-node is-order ${missing ? "is-error" : ""} ${session.selected === node.id ? "is-on" : ""}" data-node="${esc(node.id)}" style="left:${node.x}px;top:${node.y}px">
      <i class="calc-grip" data-drag-node="${esc(node.id)}" title="Перетащить"></i>
      <header class="calc-node-h">
        <span>${missing ? "Заказ удалён" : esc(order.number || "—")}</span>
        <button type="button" class="calc-mini calc-order-types" data-order-types="${esc(node.id)}" title="Суммы по типам" ${missing ? "disabled" : ""}>Σ</button>
        <button type="button" class="calc-x" data-del-node="${esc(node.id)}" title="Удалить">×</button>
      </header>
      <div class="calc-node-sub">${missing ? "" : esc(order.name || order.customer || "")}</div>
      <div class="calc-ports">
        ${ports
          .map((port) => {
            const value = graph.values[`${node.id}:${port.id}`];
            const tone = port.tone || "income";
            const child = port.child ? " is-child" : "";
            const fieldCls = port.child && port.field ? ` is-field-${port.field}` : "";
            const isType = port.kind === "type";
            if (port.child && port.hasInput && port.field && port.line) {
              const inId = lineInPortId(port.line.id, port.field);
              const owner = orderFieldOwner(node.orderId, port.line.id, port.field);
              const locked = !!owner && owner.node.id !== node.id;
              const linked = linkedIn.has(inId);
              const tip = locked
                ? `${orderFieldOwnerReason(owner, port.line, order, port.field)} · ПКМ — освободить`
                : `${esc(port.name)} · вход задаёт значение в заказе`;
              const jumped = session.jump?.nodeId === node.id && session.jump?.portId === inId;
              return `<div class="calc-row both is-${tone}${child}${fieldCls}${locked ? " is-locked" : ""}${jumped ? " is-jump" : ""}" title="${esc(tip)}">
              <i class="calc-port in ${locked ? "is-locked" : ""}" data-port="${esc(inId)}" data-io="in" data-line="${esc(port.line.id)}" data-field="${esc(port.field)}" data-order-lock="${locked ? "1" : ""}" title="${esc(tip)}"></i>
              <span class="calc-row-name" title="${esc(tip)}">${esc(port.name)}</span>
              <b>${esc(fmtShort(value))}</b>
              ${linked ? `<button type="button" class="calc-mini" data-del-in-link="${esc(inId)}" title="Удалить связь">×</button>` : ""}
              <i class="calc-port out" data-port="${esc(port.id)}" data-io="out" data-line="${esc(port.line.id)}" data-child="1" title="${esc(port.name)}"></i>
            </div>`;
            }
            const kindTip =
              tone === "tax" ? "Налог" : tone === "cost" ? "Затрата" : tone === "frozen" ? "Заморожено" : "";
            const tip = port.child
              ? esc(port.name)
              : isType
                ? `${esc(port.name)}${kindTip ? ` · ${kindTip}` : ""} · ПКМ — поля типа`
                : port.id === "total"
                  ? esc(port.name)
                  : `${esc(port.name)}${kindTip ? ` · ${kindTip}` : ""} · ПКМ — поля позиции`;
            return `<div class="calc-row out is-${tone}${child}${fieldCls}${isType ? " is-type-sum" : ""}">
              <span class="calc-row-name" title="${tip}">${esc(port.name)}</span>
              <b>${esc(fmtShort(value))}</b>
              <i class="calc-port out" data-port="${esc(port.id)}" data-io="out" data-line="${esc(port.line?.id || "")}" data-type="${esc(port.typeName || "")}" data-child="${port.child ? "1" : "0"}" title="${tip}"></i>
            </div>`;
          })
          .join("")}
      </div>
    </article>`;
  }

  function mathNodeHtml(node, bp, graph) {
    const ports = nodeInputs(node, bp.links);
    const linked = usedInputPorts(node.id, bp.links);
    const value = graph.values[`${node.id}:out`];
    return `<article class="calc-node is-math ${session.selected === node.id ? "is-on" : ""}" data-node="${esc(node.id)}" style="left:${node.x}px;top:${node.y}px">
      <i class="calc-grip" data-drag-node="${esc(node.id)}" title="Перетащить"></i>
      <header class="calc-node-h">
        <span>Оператор</span>
        <button type="button" class="calc-x" data-del-node="${esc(node.id)}" title="Удалить">×</button>
      </header>
      <div class="calc-ops">
        ${OPS.map((op) => `<button type="button" class="calc-op ${node.op === op.id ? "on" : ""}" data-op="${op.id}">${op.label}</button>`).join("")}
      </div>
      ${screenHtml(value, "Выход")}
      <div class="calc-ports">
        ${ports
          .map(
            (port) => `<div class="calc-row in">
              <i class="calc-port in" data-port="${esc(port.id)}" data-io="in"></i>
              <span>вход ${esc(port.name)}</span>
              ${linked.has(port.id) ? `<button type="button" class="calc-mini" data-del-in-link="${esc(port.id)}" title="Удалить связь">×</button>` : ""}
            </div>`
          )
          .join("")}
        <div class="calc-row out">
          <span>выход</span>
          <i class="calc-port out" data-port="out" data-io="out"></i>
        </div>
      </div>
    </article>`;
  }

  const LS_FORMULA_PROFILES = "finmaster.formulaProfiles";
  let formulaProfilesMem = null;
  let formulaProfileNodeId = "";

  function loadFormulaProfiles() {
    if (formulaProfilesMem) return formulaProfilesMem;
    const fromApi = api?.formulaProfiles?.();
    const raw = Array.isArray(fromApi) ? fromApi : [];
    const cleaned = raw
      .map((item) => {
        const name = String(item?.name || "").trim().replace(/\s+/g, " ").slice(0, 40);
        const inputs = (Array.isArray(item?.inputs) ? item.inputs : [])
          .map((letter) => String(letter || "").trim().toUpperCase().replace(/[^A-Z]/g, "").slice(0, 1))
          .filter(Boolean)
          .slice(0, 26);
        const outputs = (Array.isArray(item?.outputs) ? item.outputs : [])
          .map((out) => ({
            name: String(out?.name || "").trim().toUpperCase().replace(/[^A-Z]/g, "").slice(0, 1),
            expr: String(out?.expr || "0").slice(0, 200),
          }))
          .filter((out) => out.name)
          .slice(0, MATH_MAX);
        if (!name || !inputs.length || !outputs.length) return null;
        return { name, inputs, outputs };
      })
      .filter(Boolean)
      .slice(0, 40);
    formulaProfilesMem = cleaned;
    return cleaned;
  }

  function storeFormulaProfiles(list) {
    formulaProfilesMem = list.slice();
    try {
      localStorage.setItem(LS_FORMULA_PROFILES, JSON.stringify(formulaProfilesMem));
    } catch {
      /* ignore */
    }
    api?.saveFormulaProfiles?.(formulaProfilesMem);
  }

  function formulaSnapshot(node) {
    return {
      inputs: (node.inputs || []).map((port) => String(port.name || "").trim()),
      outputs: (node.outputs || []).map((port) => ({
        name: String(port.name || "").trim(),
        expr: String(port.expr || "0"),
      })),
    };
  }

  function formulaProfileKey(profile) {
    return JSON.stringify({
      inputs: profile.inputs,
      outputs: profile.outputs.map((out) => ({ name: out.name, expr: out.expr })),
    });
  }

  function formulaProfilesHtml(node) {
    const list = loadFormulaProfiles();
    const current = formulaProfileKey(formulaSnapshot(node));
    const selected = list.findIndex((profile) => formulaProfileKey(profile) === current);
    const empty = !list.length;
    const options = empty
      ? `<option value="">Создайте профиль</option>`
      : `<option value="" hidden ${selected < 0 ? "selected" : ""}></option>${list
          .map(
            (profile, i) =>
              `<option value="${i}" ${i === selected ? "selected" : ""}>${esc(profile.name)}</option>`
          )
          .join("")}`;
    return `<div class="calc-fprof">
      <select data-formula-profile aria-label="Профили формулы" title="${empty ? "Профилей пока нет. Создайте новый кнопкой +" : "Подставить сохранённую формулу"}"${empty ? " disabled" : ""}>
        ${options}
      </select>
      <button type="button" class="calc-mini" data-formula-profile-save title="Сохранить текущую формулу как профиль">+</button>
      <button type="button" class="calc-mini" data-formula-profile-del title="Удалить профили">×</button>
    </div>`;
  }

  function applyFormulaProfile(node, bp, profile) {
    const oldIn = new Set((node.inputs || []).map((port) => port.id));
    const oldOut = new Set((node.outputs || []).map((port) => port.id));
    bp.links = (bp.links || []).filter((link) => {
      if (link.to === node.id && oldIn.has(link.toPort)) return false;
      if (link.from === node.id && oldOut.has(link.fromPort)) return false;
      return true;
    });
    const used = new Set();
    const take = (raw) => {
      let letter = String(raw || "")
        .trim()
        .toUpperCase()
        .replace(/[^A-Z]/g, "")
        .slice(0, 1);
      if (!letter || used.has(letter)) letter = nextLetter(used) || "A";
      used.add(letter);
      return letter;
    };
    node.inputs = profile.inputs.slice(0, 26).map((name) => ({ id: uid(), name: take(name) }));
    if (!node.inputs.length) node.inputs = [{ id: uid(), name: take("A") }];
    node.outputs = profile.outputs.slice(0, MATH_MAX).map((out) => ({
      id: uid(),
      name: take(out.name),
      expr: sanitizeFormulaExpr(String(out.expr || "0")).slice(0, 200) || "0",
    }));
    if (!node.outputs.length) node.outputs = [{ id: uid(), name: take("C"), expr: "0" }];
  }

  function openFormulaProfileSave(node) {
    formulaProfileNodeId = node.id;
    const modal = $("formula-profile-modal");
    const input = $("formula-profile-name");
    if (!modal || !input) return;
    input.value = "";
    modal.classList.add("open");
    setTimeout(() => input.focus(), 30);
  }

  function closeFormulaProfileSave() {
    $("formula-profile-modal")?.classList.remove("open");
    formulaProfileNodeId = "";
  }

  function commitFormulaProfileSave() {
    const node = formulaNode(formulaProfileNodeId);
    const input = $("formula-profile-name");
    const name = String(input?.value || "").trim().replace(/\s+/g, " ").slice(0, 40);
    if (!node) {
      closeFormulaProfileSave();
      return;
    }
    if (!name) {
      api?.toast?.("Введите название профиля");
      input?.focus();
      return;
    }
    const list = loadFormulaProfiles().slice();
    const key = name.toLocaleLowerCase("ru");
    const idx = list.findIndex((profile) => profile.name.toLocaleLowerCase("ru") === key);
    const entry = { name, ...formulaSnapshot(node) };
    if (idx >= 0) list[idx] = entry;
    else list.push(entry);
    storeFormulaProfiles(list);
    closeFormulaProfileSave();
    render();
    api?.toast?.(idx >= 0 ? `Профиль «${name}» обновлён` : `Профиль «${name}» сохранён`);
  }

  function openFormulaProfileDelete() {
    const modal = $("formula-profile-del-modal");
    const box = $("formula-profile-del-list");
    if (!modal || !box) return;
    const list = loadFormulaProfiles();
    box.innerHTML = list.length
      ? list
          .map(
            (profile, i) =>
              `<label class="formula-profile-pick"><input type="checkbox" data-formula-del="${i}" /> <span>${esc(profile.name)}</span></label>`
          )
          .join("")
      : `<p class="formula-profile-empty">Сохранённых профилей пока нет.</p>`;
    const ok = $("formula-profile-del-ok");
    if (ok) ok.disabled = !list.length;
    modal.classList.add("open");
  }

  function closeFormulaProfileDelete() {
    $("formula-profile-del-modal")?.classList.remove("open");
  }

  async function commitFormulaProfileDelete() {
    const picked = [...document.querySelectorAll("#formula-profile-del-list [data-formula-del]:checked")].map((el) =>
      Number(el.dataset.formulaDel)
    );
    if (!picked.length) {
      api?.toast?.("Отметьте профили, которые нужно удалить");
      return;
    }
    const list = loadFormulaProfiles();
    const names = picked.map((i) => list[i]?.name).filter(Boolean);
    const ok = api?.askConfirm
      ? await api.askConfirm({
          title: names.length === 1 ? "Удалить профиль?" : "Удалить профили?",
          text:
            names.length === 1
              ? `Профиль «${names[0]}» будет удалён. Текущая формула не изменится.`
              : `Будут удалены: ${names.map((name) => `«${name}»`).join(", ")}. Текущая формула не изменится.`,
          ok: "Удалить",
          danger: true,
        })
      : false;
    if (!ok) return;
    const drop = new Set(picked);
    storeFormulaProfiles(list.filter((_, i) => !drop.has(i)));
    closeFormulaProfileDelete();
    render();
    api?.toast?.(names.length === 1 ? `Профиль «${names[0]}» удалён` : `Удалено профилей: ${names.length}`);
  }

  function bindFormulaProfileModals() {
    $("formula-profile-cancel")?.addEventListener("click", closeFormulaProfileSave);
    $("formula-profile-ok")?.addEventListener("click", commitFormulaProfileSave);
    $("formula-profile-name")?.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        commitFormulaProfileSave();
      } else if (e.key === "Escape") {
        e.preventDefault();
        closeFormulaProfileSave();
      }
    });
    $("formula-profile-modal")?.addEventListener("click", (e) => {
      if (e.target === $("formula-profile-modal")) closeFormulaProfileSave();
    });
    $("formula-profile-del-cancel")?.addEventListener("click", closeFormulaProfileDelete);
    $("formula-profile-del-ok")?.addEventListener("click", () => {
      commitFormulaProfileDelete();
    });
    $("formula-profile-del-modal")?.addEventListener("click", (e) => {
      if (e.target === $("formula-profile-del-modal")) closeFormulaProfileDelete();
    });
  }

  function formulaBadTitle(kind, bad) {
    if (kind === "expr") return bad ? "Ошибка в этом выражении" : "Цифры, знаки и заглавные латинские буквы";
    return bad ? "Ошибка: буква неверная или уже занята" : "Одна заглавная латинская буква";
  }

  function paintFormulaErrors(host, graph) {
    if (!host) return;
    host.querySelectorAll(".calc-node.is-formula").forEach((el) => {
      const nodeId = el.dataset.node;
      if (!nodeId) return;
      const fields = new Set((graph.fields && graph.fields[nodeId]) || []);
      el.classList.toggle("is-error", !!graph.errors?.has(nodeId));
      el.querySelectorAll("[data-in-name]").forEach((input) => {
        const on = fields.has(`in:${input.dataset.inName}`);
        input.classList.toggle("is-bad", on);
        input.title = formulaBadTitle("letter", on);
      });
      el.querySelectorAll("[data-out-name]").forEach((input) => {
        const on = fields.has(`out:${input.dataset.outName}`);
        input.classList.toggle("is-bad", on);
        input.title = formulaBadTitle("letter", on);
      });
      el.querySelectorAll("[data-out-expr]").forEach((input) => {
        const on = fields.has(`expr:${input.dataset.outExpr}`);
        input.classList.toggle("is-bad", on);
        input.title = formulaBadTitle("expr", on);
      });
    });
  }

  function formulaNodeHtml(node, bp, graph) {
    const bad = graph.errors.has(node.id);
    const badFields = new Set((graph.fields && graph.fields[node.id]) || []);
    const linked = usedInputPorts(node.id, bp.links);
    const w = formulaWidth(node);
    const mark = (key) => (badFields.has(key) ? " is-bad" : "");
    return `<article class="calc-node is-formula ${bad ? "is-error" : ""} ${session.selected === node.id ? "is-on" : ""}" data-node="${esc(node.id)}" style="left:${node.x}px;top:${node.y}px;width:${w}px">
      <i class="calc-grip" data-drag-node="${esc(node.id)}" title="Перетащить"></i>
      <header class="calc-node-h">
        <span>Формула</span>
        <button type="button" class="calc-x" data-del-node="${esc(node.id)}" title="Удалить">×</button>
      </header>
      ${formulaProfilesHtml(node)}
      <div class="calc-ports">
        <div class="calc-sec">Входы</div>
        ${(node.inputs || [])
          .map(
            (port) => `<div class="calc-row in">
              <i class="calc-port in" data-port="${esc(port.id)}" data-io="in"></i>
              <input class="calc-pname${mark(`in:${port.id}`)}" data-in-name="${esc(port.id)}" value="${esc(port.name)}" maxlength="1" spellcheck="false" title="${esc(formulaBadTitle("letter", badFields.has(`in:${port.id}`)))}" />
              ${linked.has(port.id) ? `<button type="button" class="calc-mini" data-del-in-link="${esc(port.id)}" title="Удалить связь">×</button>` : ""}
              <button type="button" class="calc-mini" data-del-in="${esc(port.id)}" title="Убрать вход">−</button>
            </div>`
          )
          .join("")}
        <button type="button" class="btn small calc-add" data-add-in="1">+ вход</button>
        <div class="calc-sec">Выходы</div>
        ${(node.outputs || [])
          .map((port) => {
            const value = graph.values[`${node.id}:${port.id}`];
            const raw = String(port.expr || "");
            const expr = sanitizeFormulaExpr(raw.includes("=") ? splitAssign(raw).expr : raw);
            const exprBad = badFields.has(`expr:${port.id}`);
            const nameBad = badFields.has(`out:${port.id}`);
            return `<div class="calc-row out formula">
              <input class="calc-expr${mark(`expr:${port.id}`)}" data-out-expr="${esc(port.id)}" value="${esc(expr)}" spellcheck="false" title="${esc(formulaBadTitle("expr", exprBad))}" />
              <span class="calc-eq">=</span>
              <input class="calc-pname${mark(`out:${port.id}`)}" data-out-name="${esc(port.id)}" value="${esc(port.name)}" maxlength="1" spellcheck="false" title="${esc(formulaBadTitle("letter", nameBad))}" />
              <b class="calc-out-val">${esc(fmtShort(value))}</b>
              <i class="calc-port out" data-port="${esc(port.id)}" data-io="out"></i>
              <button type="button" class="calc-mini" data-del-out="${esc(port.id)}" title="Убрать выход">−</button>
            </div>`;
          })
          .join("")}
        <button type="button" class="btn small calc-add" data-add-out="1">+ выход</button>
      </div>
      <i class="calc-resize calc-resize-w" data-resize-formula="${esc(node.id)}" title="Ширина"></i>
    </article>`;
  }

  function constNodeHtml(node, graph) {
    const value = graph.values[`${node.id}:out`];
    const raw = Number.isFinite(Number(node.value)) ? String(node.value) : "0";
    return `<article class="calc-node is-const ${session.selected === node.id ? "is-on" : ""}" data-node="${esc(node.id)}" style="left:${node.x}px;top:${node.y}px">
      <i class="calc-grip" data-drag-node="${esc(node.id)}" title="Перетащить"></i>
      <header class="calc-node-h">
        <span>Константа</span>
        <button type="button" class="calc-x" data-del-node="${esc(node.id)}" title="Удалить">×</button>
      </header>
      <input class="calc-const-val" data-const-value="${esc(node.id)}" value="${esc(raw)}" inputmode="decimal" spellcheck="false" title="Число" />
      <textarea class="calc-const-note" data-const-note="${esc(node.id)}" rows="1" maxlength="500" placeholder="Комментарий…" title="Комментарий: что это за число и откуда оно">${esc(node.note || "")}</textarea>
      <div class="calc-ports">
        <div class="calc-row out">
          <span>${esc(fmtShort(value))}</span>
          <i class="calc-port out" data-port="out" data-io="out" title="Выход"></i>
        </div>
      </div>
    </article>`;
  }

  function resultNodeHtml(node, bp, graph) {
    const value = graph.values[`${node.id}:out`];
    const linked = usedInputPorts(node.id, bp.links);
    const prio = Number.isFinite(Number(node.priority)) ? Number(node.priority) : nextResultPriority(bp);
    const shown = resultVisible(node);
    return `<article class="calc-node is-result ${shown ? "" : "is-scheme-off"} ${session.selected === node.id ? "is-on" : ""}" data-node="${esc(node.id)}" style="left:${node.x}px;top:${node.y}px">
      <i class="calc-grip" data-drag-node="${esc(node.id)}" title="Перетащить"></i>
      <header class="calc-node-h">
        <input class="calc-result-prio" data-result-prio="${esc(node.id)}" type="number" min="0" max="9999" step="1" value="${prio}" title="Приоритет на схеме (меньше — выше)" aria-label="Приоритет" />
        <input class="calc-pname calc-result-name" data-result-name="${esc(node.id)}" value="${esc(resultName(node))}" maxlength="48" spellcheck="false" title="Имя результата" />
        <button type="button" class="calc-eye ${shown ? "" : "is-off"}" data-result-eye="${esc(node.id)}" title="${shown ? "Скрыть из ноды схемы" : "Показать в ноде схемы"}" aria-label="${shown ? "Скрыть из ноды схемы" : "Показать в ноде схемы"}" aria-pressed="${shown ? "true" : "false"}">${resultEyeIcon(shown)}</button>
        <button type="button" class="calc-x" data-del-node="${esc(node.id)}" title="Удалить">×</button>
      </header>
      ${screenHtml(value, "Значение связи")}
      <div class="calc-ports">
        <div class="calc-row in">
          <i class="calc-port in" data-port="in" data-io="in"></i>
          <span>вход</span>
          ${linked.has("in") ? `<button type="button" class="calc-mini" data-del-in-link="in" title="Удалить связь">×</button>` : ""}
        </div>
        <div class="calc-row out">
          <span>выход</span>
          <i class="calc-port out" data-port="out" data-io="out" title="Выход"></i>
        </div>
      </div>
    </article>`;
  }

  function percentNodeHtml(node, bp, graph) {
    const value = graph.values[`${node.id}:out`];
    const linked = usedInputPorts(node.id, bp.links);
    return `<article class="calc-node is-percent ${session.selected === node.id ? "is-on" : ""}" data-node="${esc(node.id)}" style="left:${node.x}px;top:${node.y}px">
      <i class="calc-grip" data-drag-node="${esc(node.id)}" title="Перетащить"></i>
      <header class="calc-node-h">
        <span>Процент</span>
        <button type="button" class="calc-x" data-del-node="${esc(node.id)}" title="Удалить">×</button>
      </header>
      ${screenHtml(value, "Число × % / 100")}
      <div class="calc-ports">
        ${nodeInputs(node)
          .map(
            (port) => `<div class="calc-row in">
              <i class="calc-port in" data-port="${esc(port.id)}" data-io="in" title="Вход"></i>
              <span>${esc(port.name)}</span>
              ${linked.has(port.id) ? `<button type="button" class="calc-mini" data-del-in-link="${esc(port.id)}" title="Удалить связь">×</button>` : ""}
            </div>`
          )
          .join("")}
        <div class="calc-row out">
          <span>выход</span>
          <i class="calc-port out" data-port="out" data-io="out" title="Выход"></i>
        </div>
      </div>
    </article>`;
  }

  function schemeNodeHtml(node, graph) {
    const other = findBlueprint(node.blueprintId);
    const missing = !other;
    const ports = nodeOutputs(node);
    return `<article class="calc-node is-scheme ${missing ? "is-error" : ""} ${session.selected === node.id ? "is-on" : ""}" data-node="${esc(node.id)}" style="left:${node.x}px;top:${node.y}px">
      <i class="calc-grip" data-drag-node="${esc(node.id)}" title="Перетащить"></i>
      <header class="calc-node-h">
        <span>${missing ? "Схема удалена" : esc(other.name || "Схема")}</span>
        <button type="button" class="calc-x" data-del-node="${esc(node.id)}" title="Удалить">×</button>
      </header>
      <div class="calc-ports">
        ${
          ports.length
            ? ports
                .map((port) => {
                  const value = graph.values[`${node.id}:${port.id}`];
                  return `<div class="calc-row">
                    <span class="calc-row-name" title="${esc(port.name)}">${esc(port.name)}</span>
                    <b>${esc(fmtShort(value))}</b>
                    <i class="calc-port out" data-port="${esc(port.id)}" data-io="out" title="Выход"></i>
                  </div>`;
                })
                .join("")
            : `<div class="calc-empty">Нет нод «Результат»</div>`
        }
      </div>
    </article>`;
  }

  function groupNodeHtml(node, zIndex) {
    const w = Math.max(160, node.w || 320);
    const h = Math.max(120, node.h || 220);
    const color = String(node.color || "#14b8a6");
    const z = Number.isFinite(zIndex) ? zIndex : 0;
    return `<article class="calc-node is-group ${session.selected === node.id ? "is-on" : ""}" data-node="${esc(node.id)}" style="left:${node.x}px;top:${node.y}px;width:${w}px;height:${h}px;z-index:${z};--group-color:${esc(color)}"></article>`;
  }

  function groupChromeHtml(node, zIndex) {
    const w = Math.max(160, node.w || 320);
    const h = Math.max(120, node.h || 220);
    const color = String(node.color || "#14b8a6");
    const name = String(node.name || "").trim() || "Группа";
    const z = Number.isFinite(zIndex) ? zIndex : 0;
    return `<div class="calc-group-chrome ${session.selected === node.id ? "is-on" : ""}" data-node="${esc(node.id)}" style="left:${node.x}px;top:${node.y}px;width:${w}px;height:${h}px;z-index:${z};--group-color:${esc(color)}">
      <i class="calc-grip" data-drag-node="${esc(node.id)}" title="Перетащить группу · Shift — только рамка"></i>
      <header class="calc-node-h calc-group-h">
        <input class="calc-pname calc-group-name" data-group-name="${esc(node.id)}" value="${esc(name)}" maxlength="48" spellcheck="false" title="Имя группы" />
        <input class="calc-group-color" data-group-color="${esc(node.id)}" type="color" value="${esc(color)}" title="Цвет группы" />
        <button type="button" class="calc-x" data-del-node="${esc(node.id)}" title="Удалить">×</button>
      </header>
      <i class="calc-resize" data-resize-group="${esc(node.id)}" title="Изменить размер"></i>
    </div>`;
  }

  function commentNodeHtml(node) {
    return `<article class="calc-node is-comment ${session.selected === node.id ? "is-on" : ""}" data-node="${esc(node.id)}" style="left:${node.x}px;top:${node.y}px">
      <i class="calc-grip" data-drag-node="${esc(node.id)}" title="Перетащить"></i>
      <header class="calc-node-h">
        <span>Комментарий</span>
        <button type="button" class="calc-x" data-del-node="${esc(node.id)}" title="Удалить">×</button>
      </header>
      <textarea class="calc-comment" data-comment-text="${esc(node.id)}" rows="4" maxlength="2000" placeholder="Напишите комментарий…" spellcheck="true">${esc(node.text || "")}</textarea>
    </article>`;
  }

  function filterNodeHtml(node, graph) {
    return `<article class="calc-node is-filter ${session.selected === node.id ? "is-on" : ""}" data-node="${esc(node.id)}" style="left:${node.x}px;top:${node.y}px">
      <i class="calc-grip" data-drag-node="${esc(node.id)}" title="Перетащить"></i>
      <header class="calc-node-h">
        <span>Фильтр</span>
        <button type="button" class="calc-x" data-del-node="${esc(node.id)}" title="Удалить">×</button>
      </header>
      ${filterFieldsHtml(node)}
      <div class="calc-ports">
        ${statsPortsHtml(node, FILTER_PORTS, graph)}
      </div>
    </article>`;
  }

  function plannerThumb(points, film, color) {
    const pts = Array.isArray(points) ? points : [];
    if (pts.length < 3) return "";
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    pts.forEach((p) => {
      minX = Math.min(minX, p.x);
      minY = Math.min(minY, p.y);
      maxX = Math.max(maxX, p.x);
      maxY = Math.max(maxY, p.y);
    });
    const spanX = Math.max(0.05, maxX - minX);
    const spanY = Math.max(0.05, maxY - minY);
    const size = 64;
    const pad = 3;
    const scale = Math.min((size - pad * 2) / spanX, (size - pad * 2) / spanY);
    const ox = (size - spanX * scale) / 2 - minX * scale;
    const oy = (size - spanY * scale) / 2 - minY * scale;
    const d = pts
      .map((p, i) => `${i ? "L" : "M"}${(ox + p.x * scale).toFixed(1)} ${(oy + p.y * scale).toFixed(1)}`)
      .join("") + "Z";
    const cls = film ? "calc-film-thumb" : "calc-planner-thumb";
    const tone = film && color ? ` style="--film-tone:${esc(color)}"` : "";
    return `<svg class="${cls}"${tone} viewBox="0 0 ${size} ${size}" preserveAspectRatio="xMidYMid meet" aria-hidden="true"><path d="${d}"/></svg>`;
  }

  function plannerPortRow(node, port, graph) {
    if (port.signal === "plan") {
      return `<div class="calc-row out calc-plan-head">
        <span class="calc-row-name">${esc(port.name)}</span>
        <b class="calc-plan-tag">чертёж</b>
        <i class="calc-port out" data-port="${esc(port.id)}" data-io="out" data-signal="plan" title="${esc(port.name)}"></i>
      </div>`;
    }
    const value = graph.values[`${node.id}:${port.id}`];
    const shown = value != null && Number.isFinite(value) ? value : (port.value ?? port.area);
    const unit = port.unit || "м²";
    const tip = `${port.name} · ${fmtShort(shown)} ${unit}`;
    return `<div class="calc-row out">
      <span class="calc-row-name" title="${esc(tip)}">${esc(port.name)}</span>
      <b>${esc(fmtShort(shown))} <small>${esc(unit)}</small></b>
      <i class="calc-port out" data-port="${esc(port.id)}" data-io="out" title="${esc(tip)}"></i>
    </div>`;
  }

  function plannerNodeHtml(node, bp, graph) {
    ensurePlanner(node);
    const model = plannerModel(node);
    const ports = plannerOutputs(node, bp.links);
    const sub = `пол ${fmtShort(model.floor)} м² · ${model.walls.length} стен · h ${fmtShort(model.height)} м`;

    const film = node.layouts.map((layout) => `<div class="calc-film-card ${layout.id === node.layoutId ? "is-on" : ""}" data-planner-layout="${esc(layout.id)}" title="${esc(layout.name)}"><span class="calc-film-name">${esc(layout.name)}</span>${plannerThumb(layout.points, true, layout.color)}<button type="button" class="calc-film-delete" data-del-planner-layout="${esc(layout.id)}" title="Удалить планировку" aria-label="Удалить планировку ${esc(layout.name)}" ${node.layouts.length <= 1 ? "disabled" : ""}>×</button></div>`).join("");
    const groups = node.layouts.map((layout) => {
      const rows = ports.filter((port) => port.layoutId === layout.id);
      return `<div class="calc-plan-group" style="--planner-color:${esc(layout.color)}">${rows.map((port) => plannerPortRow(node, port, graph)).join("")}</div>`;
    }).join("");
    return `<article class="calc-node is-planner ${session.selected === node.id ? "is-on" : ""}" data-node="${esc(node.id)}" style="left:${node.x}px;top:${node.y}px;--planner-color:${esc(node.color || "#65a30d")}">
      <i class="calc-grip" data-drag-node="${esc(node.id)}" title="Перетащить"></i>
      <header class="calc-node-h">
        <input class="calc-pname calc-planner-name" data-planner-title="${esc(node.id)}" value="${esc(plannerName(node))}" maxlength="48" spellcheck="false" title="Имя планировщика" aria-label="Имя планировщика" />
        <input class="calc-planner-color" type="color" data-planner-color="${esc(node.id)}" value="${esc(node.color || "#65a30d")}" title="Цвет текущей планировки" aria-label="Цвет текущей планировки" />
        <button type="button" class="calc-text-btn" data-planner-edit="${esc(node.id)}" title="План пола и площади">Редактор</button>
        <button type="button" class="calc-x" data-del-node="${esc(node.id)}" title="Удалить">×</button>
      </header>
      <div class="calc-film calc-film-top">${film}</div>
      <div class="calc-node-sub">${esc(sub)}</div>
      <div class="calc-ports">${groups || `<div class="calc-empty">Включите выходы в редакторе</div>`}</div>
    </article>`;
  }

  function dashboardNodeHtml(node, bp, graph) {
    const ports = nodeOutputs(node, null, bp.links).map((port) => port.id);
    return `<article class="calc-node is-dashboard ${session.selected === node.id ? "is-on" : ""}" data-node="${esc(node.id)}" style="left:${node.x}px;top:${node.y}px">
      <i class="calc-grip" data-drag-node="${esc(node.id)}" title="Перетащить"></i>
      <header class="calc-node-h">
        <span>Дашборд</span>
        <button type="button" class="calc-mini calc-dash-ports" data-dash-ports="${esc(node.id)}" title="Порты метрик">+</button>
        <button type="button" class="calc-x" data-del-node="${esc(node.id)}" title="Удалить">×</button>
      </header>
      ${filterFieldsHtml(node)}
      <div class="calc-ports">
        ${statsPortsHtml(node, ports, graph, "ПКМ / + — выбрать порты")}
      </div>
    </article>`;
  }

  function presentNodeHtml(node, bp, graph) {
    const found = window.FinPresent?.findBlock?.(node.blockId);
    const title = found?.block?.title || node.title || "Блок";
    const pageName = found?.page?.name || "Страница";
    const meta = window.FinPresent?.blockMeta?.(node.blockType || found?.block?.type || "metric");
    const linked = usedInputPorts(node.id, bp.links);
    const ports = presentPorts(node);
    return `<article class="calc-node is-present ${session.selected === node.id ? "is-on" : ""} ${session.presentHover && session.presentHover === node.blockId ? "is-present-hl" : ""}" data-node="${esc(node.id)}" data-present-block-id="${esc(node.blockId || "")}" style="left:${node.x}px;top:${node.y}px">
      <i class="calc-grip" data-drag-node="${esc(node.id)}" title="Перетащить"></i>
      <header class="calc-node-h">
        <span title="${esc(pageName)} · ${esc(title)}"><span class="pres-tool-ico" aria-hidden="true">${esc(meta?.ico || "▣")}</span><span class="pres-tool-name">${esc(title)}</span></span>
        <button type="button" class="calc-x" data-del-node="${esc(node.id)}" title="Удалить">×</button>
      </header>
      <div class="calc-node-sub">${esc(pageName)} · ${esc(meta?.name || node.blockType || "")}</div>
      <div class="calc-ports">
        ${
          ports.length
            ? ports
                .map((port) => {
                  const value = graph.values[`${node.id}:${port.id}`];
                  const owner = presentOwner(node.blockId, port.id, bp.id);
                  const locked = !!owner && !linked.has(port.id);
                  const tip = locked
                    ? `Занято схемой «${owner.blueprint.name || "Схема"}». ПКМ — освободить.`
                    : port.name;
                  return `<div class="calc-row in ${locked ? "is-locked" : ""}" title="${esc(tip)}">
                    <i class="calc-port in ${locked ? "is-locked" : ""}" data-port="${esc(port.id)}" data-io="in" data-present-lock="${locked ? "1" : ""}" title="${esc(tip)}"></i>
                    <span>${esc(port.name)}</span>
                    <b>${esc(fmtShort(value))}</b>
                    ${linked.has(port.id) ? `<button type="button" class="calc-mini" data-del-in-link="${esc(port.id)}" title="Удалить связь">×</button>` : ""}
                  </div>`;
                })
                .join("")
            : `<div class="calc-empty">Нет входов</div>`
        }
      </div>
    </article>`;
  }

  function fitScreenNodes() {
    const host = nodesRoot();
    if (!host) return;
    host.querySelectorAll(".calc-node.is-math, .calc-node.is-result, .calc-node.is-percent, .calc-node.is-const").forEach((el) => {
      el.style.width = "";
      const screen = el.querySelector(".calc-screen-val, .calc-const-val");
      if (!screen) return;
      const btn = el.querySelector(".calc-screen-copy");
      const pad = 16 + (btn ? btn.offsetWidth + 8 : 0);
      const need = Math.ceil(Math.max(screen.scrollWidth, screen.offsetWidth) + pad);
      const isResult = el.classList.contains("is-result");
      const minW = isResult ? 376 : 188;
      const maxW = isResult ? 1040 : 520;
      const width = Math.min(maxW, Math.max(minW, need));
      el.style.width = `${width}px`;
    });
  }

  function patchGraphLive() {
    const bp = activeBlueprint();
    if (!bp || session.busy) return;
    rebuildPresentValues();
    const graph = computeGraph(bp);
    flushOrderWrites();
    const host = nodesRoot();
    if (!host) return;
    host.querySelectorAll(".calc-node").forEach((el) => {
      const nodeId = el.dataset.node;
      if (!nodeId) return;
      el.querySelectorAll(".calc-out-val").forEach((box) => {
        const expr = box.closest(".calc-row")?.querySelector("[data-out-expr]");
        if (!expr) return;
        box.textContent = fmtShort(graph.values[`${nodeId}:${expr.dataset.outExpr}`]);
      });
      el.querySelectorAll(".calc-row.out > b:not(.calc-out-val), .calc-row.both > b:not(.calc-out-val), .calc-row.in > b:not(.calc-out-val)").forEach((box) => {
        const row = box.closest(".calc-row");
        if (!row) return;
        const outPort = row.querySelector(".calc-port.out");
        const inPort = row.querySelector(".calc-port.in");
        const portId = outPort?.dataset.port || inPort?.dataset.port;
        if (!portId) return;
        const value = graph.values[`${nodeId}:${portId}`];
        box.textContent = fmtShort(value);
      });
      el.querySelectorAll(".calc-row.out > span").forEach((box) => {
        if (box.classList.contains("calc-row-name")) return;
        const port = box.closest(".calc-row")?.querySelector(".calc-port.out");
        if (!port) return;
        box.textContent = fmtShort(graph.values[`${nodeId}:${port.dataset.port}`]);
      });
      const screen = el.querySelector(".calc-screen-val");
      if (screen) {
        const value = graph.values[`${nodeId}:out`];
        screen.textContent = fmtShort(value);
        const btn = el.querySelector(".calc-screen-copy");
        if (btn) {
          const copy = fmtCopy(value);
          btn.dataset.copy = copy || "";
          btn.classList.toggle("is-off", !copy);
          btn.disabled = !copy;
        }
      }
    });
    paintFormulaErrors(host, graph);
    fitScreenNodes();
    requestAnimationFrame(() => {
      drawWires(bp, graph);
      drawMinimap(bp);
    });
  }

  function renderNodes(bp, graph) {
    const host = nodesRoot();
    const groups = groupsRoot();
    const groupUi = groupUiRoot();
    if (!host) return;
    const focus = document.activeElement;
    const focusHost = host.contains(focus) || groups?.contains(focus) || groupUi?.contains(focus) ? focus : null;
    const keep = focusHost
      ? {
          name: focus.dataset.inName || focus.dataset.outName || focus.dataset.outExpr || focus.dataset.resultName || focus.dataset.resultPrio || focus.dataset.constValue || focus.dataset.groupName || focus.dataset.plannerTitle || focus.dataset.markTitle || focus.dataset.filterField,
          start: focus.selectionStart,
          end: focus.selectionEnd,
          filterField: focus.dataset.filterField || "",
          nodeId: focus.closest?.("[data-node]")?.dataset?.node || "",
        }
      : null;
    const groupNodes = sortGroupsByArea((bp.nodes || []).filter((node) => node.type === "group"));
    const plainNodes = (bp.nodes || []).filter((node) => node.type !== "group");
    const multiOpen = session.filterMultiOpen;
    if (multiOpen?.nodeId && multiOpen?.field) {
      const prevList = host.querySelector(
        `[data-node="${cssEsc(multiOpen.nodeId)}"] .calc-multi[data-filter-multi-field="${cssEsc(multiOpen.field)}"] .calc-multi-list`
      );
      if (prevList) session.filterMultiScroll = prevList.scrollTop;
    }
    if (groups) {
      groups.innerHTML = groupNodes.map((node, i) => groupNodeHtml(node, i)).join("");
    }
    if (groupUi) {
      groupUi.innerHTML = groupNodes.map((node, i) => groupChromeHtml(node, i)).join("");
    }
    host.innerHTML = plainNodes
      .map((node) => {
        if (node.type === "math") return mathNodeHtml(node, bp, graph);
        if (node.type === "percent") return percentNodeHtml(node, bp, graph);
        if (node.type === "const") return constNodeHtml(node, graph);
        if (node.type === "result") return resultNodeHtml(node, bp, graph);
        if (node.type === "formula") return formulaNodeHtml(node, bp, graph);
        if (node.type === "comment") return commentNodeHtml(node);
        if (node.type === "scheme") return schemeNodeHtml(node, graph);
        if (node.type === "filter") return filterNodeHtml(node, graph);
        if (node.type === "dashboard") return dashboardNodeHtml(node, bp, graph);
        if (node.type === "planner") return plannerNodeHtml(node, bp, graph);
        if (node.type === "openings") return openingsNodeHtml(node, bp, graph);
        if (node.type === "electrics") return electricsNodeHtml(node, bp, graph);
        if (node.type === "present") return presentNodeHtml(node, bp, graph);
        return orderNodeHtml(node, api.findOrder(node.orderId), graph, bp);
      })
      .join("");
    fitScreenNodes();
    applyWorld(bp);
    if (multiOpen?.nodeId && multiOpen?.field) {
      const nextList = host.querySelector(
        `[data-node="${cssEsc(multiOpen.nodeId)}"] .calc-multi[data-filter-multi-field="${cssEsc(multiOpen.field)}"] .calc-multi-list`
      );
      if (nextList) nextList.scrollTop = session.filterMultiScroll || 0;
    }
    if (keep?.name || keep?.filterField) {
      const again = keep.filterField && keep.nodeId
        ? host.querySelector(`[data-node="${cssEsc(keep.nodeId)}"] [data-filter-field="${cssEsc(keep.filterField)}"]`)
          : host.querySelector(`[data-in-name="${cssEsc(keep.name)}"], [data-out-name="${cssEsc(keep.name)}"], [data-out-expr="${cssEsc(keep.name)}"], [data-result-name="${cssEsc(keep.name)}"], [data-result-prio="${cssEsc(keep.name)}"], [data-const-value="${cssEsc(keep.name)}"], [data-planner-title="${cssEsc(keep.name)}"], [data-mark-title="${cssEsc(keep.name)}"]`) ||
          groupUi?.querySelector(`[data-group-name="${cssEsc(keep.name)}"]`);
      if (again) {
        again.focus({ preventScroll: true });
        try {
          again.setSelectionRange(keep.start, keep.end);
        } catch {
          /* ignore */
        }
      }
    }
  }

  function screenToWorld(clientX, clientY, bp) {
    const world = $("calc-world");
    const zoom = bp?.zoom || 1;
    if (world) {
      const rect = world.getBoundingClientRect();
      return {
        x: (clientX - rect.left) / zoom,
        y: (clientY - rect.top) / zoom,
      };
    }
    const board = $("calc-board");
    const rect = board.getBoundingClientRect();
    return {
      x: (clientX - rect.left - (bp?.x || 0)) / zoom,
      y: (clientY - rect.top - (bp?.y || 0)) / zoom,
    };
  }

  function viewCenter(bp) {
    const board = $("calc-board");
    if (!board || !bp) return { x: 120, y: 80 };
    const rect = board.getBoundingClientRect();
    const mid = screenToWorld(rect.left + rect.width / 2, rect.top + rect.height / 2, bp);
    const n = session.place % 6;
    return {
      x: mid.x - 115 + n * 24,
      y: mid.y - 50 + n * 24,
    };
  }

  function findPortEl(nodeEl, portId, io) {
    if (!nodeEl) return null;
    const ports = [...nodeEl.querySelectorAll(`.calc-port[data-io="${io}"]`)];
    const exact = ports.find((el) => el.dataset.port === portId);
    if (exact) return exact;
    const hit = matchPortId(portId, ports.map((el) => el.dataset.port || ""));
    return hit ? ports.find((el) => el.dataset.port === hit) : null;
  }

  function portWorld(nodeEl, portId, io, bp) {
    const port = findPortEl(nodeEl, portId, io);
    if (!port) return null;
    const world = $("calc-world");
    const zoom = bp?.zoom || 1;
    if (!world) {
      const rect = port.getBoundingClientRect();
      return screenToWorld(rect.left + rect.width / 2, rect.top + rect.height / 2, bp);
    }
    const wr = world.getBoundingClientRect();
    const pr = port.getBoundingClientRect();
    const nr = nodeEl.getBoundingClientRect();
    const cy = (pr.top + pr.height / 2 - wr.top) / zoom;
    // Конец линии — на внешнем краю ноды (порт висит снаружи), чтобы провод не уходил под карточку.
    if (io === "in") {
      const edge = (nr.left - wr.left) / zoom;
      const portOuter = (pr.left - wr.left) / zoom;
      return { x: Math.min(edge, portOuter), y: cy };
    }
    if (io === "out") {
      const edge = (nr.right - wr.left) / zoom;
      const portOuter = (pr.right - wr.left) / zoom;
      return { x: Math.max(edge, portOuter), y: cy };
    }
    return {
      x: (pr.left + pr.width / 2 - wr.left) / zoom,
      y: cy,
    };
  }

  function bezierMid(a, b) {
    const dx = Math.max(40, Math.abs(b.x - a.x) * 0.45);
    return {
      x: 0.125 * a.x + 0.375 * (a.x + dx) + 0.375 * (b.x - dx) + 0.125 * b.x,
      y: 0.125 * a.y + 0.375 * a.y + 0.375 * b.y + 0.125 * b.y,
    };
  }

  function wireKind(node, fromPort) {
    if (fromPort === "plan") return "plan";
    const type = node?.type || "";
    if (type === "order") {
      if (fromPort === "total") return "order";
      const parsed = parseLinePort(fromPort);
      if (parsed?.field) return `field-${parsed.field}`;
      if (parsed) {
        const order = api.findOrder(node.orderId);
        const line = (order?.lines || []).find((item) => item.id === parsed.lineId);
        if (line) return lineTone(line, order);
      }
      const typed = parseTypePort(fromPort);
      if (typed?.field) return `field-${typed.field}`;
      if (typed) {
        const order = api.findOrder(node.orderId);
        if (order) return typeTone(order, typed.typeName);
      }
      return "order";
    }
    if (type === "math" || type === "formula" || type === "percent" || type === "const" || type === "result" || type === "scheme" || type === "group" || type === "filter" || type === "dashboard" || type === "planner" || type === "openings" || type === "electrics" || type === "present" || type === "comment") return type;
    return "order";
  }

  function upstreamFlow(bp, nodeId) {
    const linkIds = new Set();
    const outPorts = new Set();
    const inPorts = new Set();
    const nodeIds = new Set();
    if (!bp || !nodeId) return { linkIds, outPorts, inPorts, nodeIds };
    const incoming = {};
    (bp.links || []).forEach((link) => {
      if (!incoming[link.to]) incoming[link.to] = [];
      incoming[link.to].push(link);
    });
    const seen = new Set();
    function walk(id) {
      if (!id || seen.has(id)) return;
      seen.add(id);
      (incoming[id] || []).forEach((link) => {
        linkIds.add(link.id);
        outPorts.add(`${link.from}:${link.fromPort}`);
        inPorts.add(`${link.to}:${link.toPort}`);
        nodeIds.add(link.from);
        nodeIds.add(link.to);
        walk(link.from);
      });
    }
    walk(nodeId);
    return { linkIds, outPorts, inPorts, nodeIds };
  }

  function upstreamNodeIds(bp, nodeId) {
    const ids = new Set();
    if (!bp || !nodeId) return ids;
    const incoming = {};
    (bp.links || []).forEach((link) => {
      if (!incoming[link.to]) incoming[link.to] = [];
      incoming[link.to].push(link.from);
    });
    function walk(id) {
      (incoming[id] || []).forEach((from) => {
        if (!from || ids.has(from)) return;
        ids.add(from);
        walk(from);
      });
    }
    walk(nodeId);
    return ids;
  }

  function syncChainMoveBtn() {
    const btn = $("calc-chain-move");
    if (!btn) return;
    btn.classList.toggle("is-on", !!session.moveChain);
    btn.setAttribute("aria-pressed", session.moveChain ? "true" : "false");
    btn.title = session.moveChain ? "Цепочка входов: вкл" : "Тянуть цепочку входов";
  }

  function syncMiniToggle() {
    const btn = $("calc-mini-toggle");
    const wrap = $("calc-mini-wrap");
    const board = $("calc-board");
    if (!btn) return;
    const on = !session.miniHidden;
    btn.setAttribute("aria-pressed", on ? "true" : "false");
    btn.title = on ? "Скрыть навигатор" : "Показать навигатор";
    wrap?.classList.toggle("is-hidden", !on);
    board?.classList.toggle("is-mini-hidden", !on);
  }

  function setLinkingClass() {
    const board = $("calc-board");
    if (!board) return;
    const link = session.linking;
    board.classList.toggle("is-link-out", !!(link && !link.reverse));
    board.classList.toggle("is-link-in", !!(link && link.reverse));
    const ownerId = link ? (link.reverse ? link.to : link.from) : "";
    const portId = link ? (link.reverse ? link.toPort : link.fromPort) : "";
    const owner = ownerId ? (activeBlueprint()?.nodes || []).find((item) => item.id === ownerId) : null;
    const signal = link ? portSignal(owner, portId) : "";
    board.classList.toggle("is-link-plan", signal === "plan");
    board.classList.toggle("is-link-num", !!link && signal !== "plan");
  }

  function drawWires(bp, graph) {
    const svg = $("calc-wires");
    const host = nodesRoot();
    const ui = wireUiRoot() || host;
    if (!svg || !host || !bp) return;
    const ns = "http://www.w3.org/2000/svg";
    while (svg.firstChild) svg.removeChild(svg.firstChild);
    const addPath = (d, cls, attrs) => {
      const el = document.createElementNS(ns, "path");
      el.setAttribute("d", d);
      el.setAttribute("class", cls);
      if (attrs) Object.entries(attrs).forEach(([key, value]) => el.setAttribute(key, value));
      svg.appendChild(el);
      return el;
    };
    const hostButtons = [];
    const byId = Object.fromEntries((bp.nodes || []).map((node) => [node.id, node]));
    const flow = upstreamFlow(bp, session.selected);
    const picked = session.selectedLink
      ? (bp.links || []).find((link) => link.id === session.selectedLink) || null
      : null;
    if (session.selectedLink && !picked) session.selectedLink = "";

    const clearPickClass = (root) => {
      root?.querySelectorAll(".is-link-pick").forEach((el) => el.classList.remove("is-link-pick"));
    };
    clearPickClass(host);
    clearPickClass(groupsRoot());
    clearPickClass(groupUiRoot());

    host.querySelectorAll(".calc-port.is-flow").forEach((el) => el.classList.remove("is-flow"));
    groupsRoot()?.querySelectorAll(".calc-port.is-flow").forEach((el) => el.classList.remove("is-flow"));
    host.querySelectorAll(".calc-node.is-flow").forEach((el) => el.classList.remove("is-flow"));
    groupsRoot()?.querySelectorAll(".calc-node.is-flow").forEach((el) => el.classList.remove("is-flow"));
    groupUiRoot()?.querySelectorAll(".calc-group-chrome.is-flow").forEach((el) => el.classList.remove("is-flow"));
    flow.nodeIds.forEach((id) => {
      const el = findNodeEl(id);
      el?.classList.add("is-flow");
      if (el?.classList.contains("calc-group-chrome") || byId[id]?.type === "group") {
        findGroupChrome(id)?.classList.add("is-flow");
      }
    });
    if (picked) {
      const fromEl = findNodeEl(picked.from);
      const toEl = findNodeEl(picked.to);
      fromEl?.classList.add("is-link-pick");
      toEl?.classList.add("is-link-pick");
      if (byId[picked.from]?.type === "group") findGroupChrome(picked.from)?.classList.add("is-link-pick");
      if (byId[picked.to]?.type === "group") findGroupChrome(picked.to)?.classList.add("is-link-pick");
      findPortEl(fromEl, picked.fromPort, "out")?.classList.add("is-link-pick");
      findPortEl(toEl, picked.toPort, "in")?.classList.add("is-link-pick");
    }
    (bp.links || []).forEach((link) => {
      const fromEl = findNodeEl(link.from);
      const toEl = findNodeEl(link.to);
      if (!fromEl || !toEl) return;
      const a = portWorld(fromEl, link.fromPort, "out", bp);
      const b = portWorld(toEl, link.toPort, "in", bp);
      if (!a || !b) return;
      const dx = Math.max(40, Math.abs(b.x - a.x) * 0.45);
      const d = `M${a.x},${a.y} C${a.x + dx},${a.y} ${b.x - dx},${b.y} ${b.x},${b.y}`;
      const src = byId[link.from];
      const onFlow = flow.linkIds.has(link.id);
      const onPick = !!(picked && picked.id === link.id);
      const err = graph.errors.has(link.from) || graph.errors.has(link.to);
      const wire = addPath(
        d,
        `calc-wire is-${wireKind(src, link.fromPort)}${onFlow ? " is-flow" : ""}${onPick ? " is-pick" : ""}${err ? " is-error" : ""}`,
        {
          "pointer-events": "none",
          "data-link": link.id,
        }
      );
      if (onFlow) {
        findPortEl(fromEl, link.fromPort, "out")?.classList.add("is-flow");
        findPortEl(toEl, link.toPort, "in")?.classList.add("is-flow");
      }
      if (!session.linking && !session.drag && !session.pan) {
        const hit = addPath(d, "calc-wire-hit", { "data-link": link.id });
        const mid = bezierMid(a, b);
        hostButtons.push({ id: link.id, x: mid.x, y: mid.y, wire, hit });
      }
    });
    ui.querySelectorAll(".calc-unlink-wire").forEach((el) => el.remove());
    hostButtons.forEach((item) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "calc-unlink-wire";
      btn.dataset.delLink = item.id;
      btn.title = "Удалить связь";
      btn.textContent = "×";
      btn.style.left = `${item.x}px`;
      btn.style.top = `${item.y}px`;
      const show = () => {
        item.wire.classList.add("is-hot");
        btn.classList.add("is-show");
      };
      const hide = () => {
        if (session.selectedLink === item.id) return;
        item.wire.classList.remove("is-hot");
        btn.classList.remove("is-show");
      };
      item.hit.addEventListener("pointerenter", show);
      item.hit.addEventListener("pointerleave", (e) => {
        if (e.relatedTarget === btn || btn.contains(e.relatedTarget)) return;
        hide();
      });
      btn.addEventListener("pointerenter", show);
      btn.addEventListener("pointerleave", (e) => {
        if (e.relatedTarget === item.hit) return;
        hide();
      });
      item.hit.addEventListener("pointerdown", (e) => {
        if (e.button !== 0) return;
        e.preventDefault();
        e.stopPropagation();
        session.selectedLink = item.id;
        session.selected = "";
        document.querySelectorAll(".calc-node.is-on, .calc-group-chrome.is-on").forEach((el) => el.classList.remove("is-on"));
        drawWires(bp, computeGraph(bp));
      });
      if (session.selectedLink === item.id) {
        item.wire.classList.add("is-hot");
        btn.classList.add("is-show");
      }
      ui.appendChild(btn);
    });
    if (session.linking?.x != null) {
      const L = session.linking;
      let a = null;
      let b = null;
      let kind = "order";
      if (L.reverse) {
        const toEl = findNodeEl(L.to);
        a = { x: L.x, y: L.y };
        b = toEl ? portWorld(toEl, L.toPort, "in", bp) : null;
        kind = wireKind(byId[L.to]);
      } else {
        const fromEl = findNodeEl(L.from);
        a = fromEl ? portWorld(fromEl, L.fromPort, "out", bp) : null;
        b = { x: L.x, y: L.y };
        kind = wireKind(byId[L.from], L.fromPort);
      }
      if (a && b) {
        const dx = Math.max(40, Math.abs(b.x - a.x) * 0.45);
        addPath(`M${a.x},${a.y} C${a.x + dx},${a.y} ${b.x - dx},${b.y} ${b.x},${b.y}`, `calc-wire is-temp is-${kind}`, { "pointer-events": "none" });
      }
    }
    setLinkingClass();
    drawMinimap(bp);
  }

  function rebuildPresentValues() {
    presentValues.clear();
    try {
      (window.FinPresent?.pages?.() || []).forEach((page) => {
        (page.blocks || []).forEach((block) => {
          block.values = {};
        });
      });
    } catch {
      /* ignore */
    }
    const calc = ensureState();
    if (!calc) return;
    (calc.blueprints || []).forEach((bp) => {
      try {
        computeGraph(bp);
      } catch (err) {
        console.warn("calc graph", bp?.id, err);
      }
    });
    flushOrderWrites();
  }

  function hidePresentPanel() {
    session.presentPanel = false;
    session.presentDrag = null;
    setPresentHover("");
    const btn = $("calc-present-btn");
    btn?.classList.remove("is-on");
    btn?.setAttribute("aria-pressed", "false");
    const el = $("calc-present-panel");
    if (el) el.hidden = true;
  }

  function flushOrderWrites() {
    if (!session.orderWritePending) return;
    session.orderWritePending = false;
    api?.markDirty?.("Калькулятор → заказ");
    api?.refreshOrders?.();
  }

  function render() {
    if (!api || api.view() !== "calculator") {
      const panel = $("calc-present-panel");
      if (panel) panel.hidden = true;
      return;
    }
    const calc = ensureState();
    const bp = activeBlueprint();
    if (!calc || !bp) return;
    if (healLinks(bp)) dirty();
    if (session.busy) {
      applyWorld(bp);
      drawWires(bp, computeGraph(bp));
      flushOrderWrites();
      drawMinimap(bp);
      return;
    }
    rebuildPresentValues();
    let graph;
    try {
      graph = computeGraph(bp);
    } catch (err) {
      console.warn("calc render graph", err);
      graph = { values: {}, errors: new Set() };
    }
    flushOrderWrites();
    renderTabs(calc);
    renderTitle(bp);
    renderSide(bp);
    renderNodes(bp, graph);
    if (session.presentHover) setPresentHover(session.presentHover);
    const btn = $("calc-present-btn");
    btn?.classList.toggle("is-on", session.presentPanel);
    btn?.setAttribute("aria-pressed", session.presentPanel ? "true" : "false");
    renderPresentPanel();
    requestAnimationFrame(() => {
      drawWires(bp, graph);
      revealPendingFocus(bp);
      drawMinimap(bp);
    });
  }

  function presentPanelEl() {
    let el = $("calc-present-panel");
    if (el) return el;
    el = document.createElement("div");
    el.id = "calc-present-panel";
    el.className = "calc-present-panel";
    el.hidden = true;
    document.body.appendChild(el);
    el.addEventListener("pointerdown", (e) => {
      const handle = e.target.closest("[data-present-drag]");
      if (!handle || e.button !== 0) return;
      if (e.target.closest("button, details, summary, .calc-present-block")) return;
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      session.presentDrag = {
        dx: e.clientX - rect.left,
        dy: e.clientY - rect.top,
      };
      el.setPointerCapture(e.pointerId);
    });
    el.addEventListener("pointermove", (e) => {
      if (!session.presentDrag) return;
      const x = Math.max(8, Math.min(window.innerWidth - 80, e.clientX - session.presentDrag.dx));
      const y = Math.max(8, Math.min(window.innerHeight - 80, e.clientY - session.presentDrag.dy));
      el.style.left = `${x}px`;
      el.style.top = `${y}px`;
      el.style.right = "auto";
      el.dataset.moved = "1";
    });
    el.addEventListener("pointerup", () => {
      session.presentDrag = null;
    });
    el.addEventListener("pointercancel", () => {
      session.presentDrag = null;
    });
    el.addEventListener("pointerover", (e) => {
      const item = e.target.closest("[data-present-block]");
      if (!item || !el.contains(item)) return;
      if (item.dataset.presentUsed !== "1") {
        if (session.presentHover) setPresentHover("");
        return;
      }
      const blockId = item.dataset.presentBlock || "";
      if (session.presentHover === blockId) return;
      setPresentHover(blockId);
    });
    el.addEventListener("pointerout", (e) => {
      const item = e.target.closest("[data-present-block]");
      if (!item || !el.contains(item)) return;
      if (e.relatedTarget && item.contains(e.relatedTarget)) return;
      if (session.presentHover && session.presentHover === item.dataset.presentBlock) {
        setPresentHover("");
      }
    });
    el.addEventListener(
      "scroll",
      (e) => {
        if (e.target?.classList?.contains("calc-present-list")) {
          session.presentListScroll = e.target.scrollTop;
        }
      },
      true
    );
    return el;
  }

  function togglePresentPanel(force) {
    if (api?.view?.() !== "calculator") {
      hidePresentPanel();
      return;
    }
    session.presentPanel = force == null ? !session.presentPanel : !!force;
    const btn = $("calc-present-btn");
    btn?.classList.toggle("is-on", session.presentPanel);
    btn?.setAttribute("aria-pressed", session.presentPanel ? "true" : "false");
    renderPresentPanel();
  }

  function renderPresentPanel() {
    const el = presentPanelEl();
    if (!el) return;
    const show = api?.view?.() === "calculator" && session.presentPanel;
    el.hidden = !show;
    if (!session.presentPanel) {
      setPresentHover("");
      return;
    }
    if (show && !el.dataset.moved) {
      const board = $("calc-board");
      const rect = board?.getBoundingClientRect();
      if (rect) {
        el.style.left = `${Math.max(12, rect.left + 12)}px`;
        el.style.top = `${Math.max(12, rect.top + 52)}px`;
      }
    }
    const skip = new Set(["title", "note", "spacer"]);
    const pages = window.FinPresent?.pages?.() || [];
    const prevList = el.querySelector(".calc-present-list");
    if (prevList) session.presentListScroll = prevList.scrollTop;
    const scrollTop = session.presentListScroll || 0;
    if (!pages.length) {
      el.innerHTML = `<div class="calc-present-h" data-present-drag="1">Презентация <button type="button" class="calc-mini" data-close-present-panel="1" title="Закрыть">×</button></div><div class="calc-empty">Создайте страницы во вкладке «Презентация»</div>`;
      return;
    }
    el.innerHTML = `<div class="calc-present-h" data-present-drag="1"><span>Презентация</span> <button type="button" class="calc-mini" data-close-present-panel="1" title="Закрыть">×</button></div>
      <div class="calc-present-list">
        ${pages
          .map((page) => {
            const blocks = (page.blocks || []).filter((block) => !skip.has(block.type));
            return `<details class="calc-present-page" open>
              <summary>${esc(page.name || "Страница")} <span>${blocks.length}</span></summary>
              <div class="calc-present-blocks">
                ${
                  blocks.length
                    ? blocks
                        .map((block) => {
                          const meta = window.FinPresent?.blockMeta?.(block.type) || { ico: "▣", name: block.type, ports: [] };
                          const ports = meta.ports || [];
                          const usage = presentUsage(block.id);
                          const onScheme = usage.onActive > 0;
                          const onOther = !onScheme && usage.onOther > 0;
                          let status = "Не на схеме";
                          let tip = "Добавить ноду на схему";
                          if (onScheme) {
                            status = "На схеме";
                            tip = "Уже на этой схеме — наведите, чтобы подсветить";
                          } else if (onOther) {
                            status = "Другая схема";
                            tip = `Есть на: ${usage.otherNames.slice(0, 3).join(", ") || "другой схеме"}`;
                          }
                          return `<button type="button" class="calc-present-block ${onScheme ? "is-used" : ""} ${onOther ? "is-used-other" : ""}" draggable="true" data-present-block="${esc(block.id)}" data-present-page="${esc(page.id)}" data-present-used="${onScheme ? "1" : "0"}" title="${esc(tip)}">
                            <b><span class="pres-tool-ico" aria-hidden="true">${esc(meta.ico || "▣")}</span><span class="pres-tool-name">${esc(block.title || meta.name)}</span></b>
                            <span>${esc(meta.name)}${ports.length ? ` · ${ports.length} вх.` : ""}</span>
                            <em class="calc-present-badge ${onScheme ? "is-on" : ""} ${onOther ? "is-other" : ""}">${esc(status)}</em>
                          </button>`;
                        })
                        .join("")
                    : `<div class="calc-empty">Нет блоков со входами</div>`
                }
              </div>
            </details>`;
          })
          .join("")}
      </div>`;
    const nextList = el.querySelector(".calc-present-list");
    if (nextList) nextList.scrollTop = scrollTop;
  }

  function addPresentNode(pageId, blockId, point) {
    const found = window.FinPresent?.findBlock?.(blockId);
    if (!found) return;
    const bp = activeBlueprint();
    if (!bp) return;
    const existing = (bp.nodes || []).find((node) => node.type === "present" && node.blockId === blockId);
    if (existing) {
      session.selected = existing.id;
      render();
      return;
    }
    addNode("present", point || null, {
      pageId: pageId || found.page.id,
      blockId: found.block.id,
      blockType: found.block.type,
      title: found.block.title || found.block.type,
    });
  }

  function showPresentPortMenu(clientX, clientY, nodeId, portId) {
    document.querySelector(".calc-port-menu")?.remove();
    const bp = activeBlueprint();
    const node = bp?.nodes?.find((item) => item.id === nodeId && item.type === "present");
    if (!node || !node.blockId || !portId) return;
    const owner = presentOwner(node.blockId, portId, null);
    const menu = document.createElement("div");
    menu.className = "calc-port-menu";
    menu.style.left = `${clientX}px`;
    menu.style.top = `${clientY}px`;
    if (owner) {
      menu.innerHTML = `<button type="button" data-free-present="1">Освободить вход</button>
        <div class="calc-port-menu-note">Сейчас: «${esc(owner.blueprint.name || "Схема")}»</div>`;
    } else {
      menu.innerHTML = `<div class="calc-port-menu-note">Вход свободен</div>`;
    }
    document.body.appendChild(menu);
    const close = () => {
      menu.remove();
      document.removeEventListener("pointerdown", onDoc, true);
    };
    const onDoc = (ev) => {
      if (!menu.contains(ev.target)) close();
    };
    menu.addEventListener("click", (ev) => {
      if (ev.target.closest("[data-free-present]")) {
        freePresentPort(node.blockId, portId);
        close();
      }
    });
    setTimeout(() => document.addEventListener("pointerdown", onDoc, true), 0);
  }

  function recalculate() {
    session.linking = null;
    session.drag = null;
    session.pan = null;
    session.resize = null;
    session.busy = false;
    session.folds = null;
    setLinkingClass();
    const calc = ensureState();
    if (!calc) return;
    calc.blueprints.forEach((bp) => healLinks(bp));
    dirty();
    render();
  }

  function onBoardPointerDown(e) {
    const bp = activeBlueprint();
    if (!bp) return;
    if (session.jump) {
      session.jump = null;
      document.querySelectorAll(".calc-row.is-jump").forEach((el) => el.classList.remove("is-jump"));
    }
    if (e.button === 1) {
      e.preventDefault();
      session.busy = true;
      session.pan = { x: e.clientX, y: e.clientY, ox: bp.x || 0, oy: bp.y || 0 };
      $("calc-board").setPointerCapture(e.pointerId);
      return;
    }
    const delLayout = e.target.closest("[data-del-planner-layout]");
    if (delLayout) {
      e.preventDefault();
      e.stopPropagation();
      const nodeEl = delLayout.closest(".calc-node");
      const node = nodeEl && bp.nodes.find((item) => item.id === nodeEl.dataset.node && item.type === "planner");
      if (node && plannerRemoveLayout(node, delLayout.dataset.delPlannerLayout)) {
        dirty();
        render();
      }
      return;
    }
    const del = e.target.closest("[data-del-node]");
    if (del) {
      e.preventDefault();
      e.stopPropagation();
      removeNode(del.dataset.delNode);
      return;
    }
    const unlink = e.target.closest("[data-del-link], [data-del-in-link]");
    if (unlink) {
      e.preventDefault();
      e.stopPropagation();
      if (unlink.dataset.delLink) removeLink(unlink.dataset.delLink);
      else disconnectInput(unlink.closest(".calc-node")?.dataset.node, unlink.dataset.delInLink);
      return;
    }
    if (e.target.closest(".calc-refresh, .calc-chain-move, .calc-present-btn, .calc-present-panel, .calc-board-tools, .calc-bp-name, .calc-screen-copy, .calc-minimap, .calc-mini-toggle, .calc-mini-wrap, input, textarea, select")) return;
    const resizeFormula = e.target.closest("[data-resize-formula]");
    if (resizeFormula) {
      e.preventDefault();
      e.stopPropagation();
      const id = resizeFormula.dataset.resizeFormula;
      const item = bp.nodes.find((n) => n.id === id && n.type === "formula");
      if (!item) return;
      session.selected = id;
      session.busy = true;
      session.resize = {
        id,
        axis: "w",
        dx: e.clientX,
        w: formulaWidth(item),
        min: 280,
        max: 1200,
      };
      $("calc-board").setPointerCapture(e.pointerId);
      return;
    }
    const resize = e.target.closest("[data-resize-group]");
    if (resize) {
      e.preventDefault();
      e.stopPropagation();
      const id = resize.dataset.resizeGroup;
      const item = bp.nodes.find((n) => n.id === id && n.type === "group");
      if (!item) return;
      session.selected = id;
      session.busy = true;
      session.resize = {
        id,
        dx: e.clientX,
        dy: e.clientY,
        w: Math.max(160, item.w || 320),
        h: Math.max(120, item.h || 220),
      };
      $("calc-board").setPointerCapture(e.pointerId);
      return;
    }
    const plannerCard = e.target.closest(".calc-film-card[data-planner-layout]");
    if (plannerCard) {
      const nodeEl = plannerCard.closest(".calc-node");
      const nodeId = nodeEl?.dataset.node;
      const planner = bp.nodes.find((item) => item.id === nodeId && item.type === "planner");
      if (planner) {
        const changed = plannerUseLayout(planner, plannerCard.dataset.plannerLayout);
        session.selected = planner.id;
        session.selectedLink = "";
        nodeEl.querySelectorAll(".calc-film-card[data-planner-layout]").forEach((card) => {
          card.classList.toggle("is-on", card === plannerCard);
        });
        nodeEl.querySelectorAll(".calc-node").forEach((el) => el.classList.remove("is-on"));
        nodeEl.classList.add("is-on");
        const colorInput = nodeEl.querySelector("[data-planner-color]");
        if (colorInput) colorInput.value = planner.color || "#65a30d";
        nodeEl.style.setProperty("--planner-color", planner.color || "#65a30d");
        drawWires(bp, computeGraph(bp));
        if (changed) dirty();
      }
      e.preventDefault();
      e.stopPropagation();
      return;
    }
    const port = e.target.closest(".calc-port");
    const node = e.target.closest(".calc-node, .calc-group-chrome");
    const drag = e.target.closest("[data-drag-node]");
    if (port) {
      e.preventDefault();
      e.stopPropagation();
      const nodeId = port.closest(".calc-node")?.dataset.node;
      const io = port.dataset.io;
      const portId = port.dataset.port;
      session.selected = nodeId || "";
      session.selectedLink = "";
      const lineId = port.dataset.line || "";
      const parsed = parseLinePort(portId);
      const typed = parseTypePort(portId);
      const isMainLineOut = io === "out" && parsed && !parsed.field;
      const isMainTypeOut = io === "out" && typed && !typed.field;

      if (e.button === 2) {
        if (session.linking) {
          session.linking = null;
          setLinkingClass();
          if (bp) drawWires(bp, computeGraph(bp));
        }
        if (isMainLineOut) showLinePortMenu(e.clientX, e.clientY, nodeId, parsed.lineId);
        else if (isMainTypeOut) showTypePortMenu(e.clientX, e.clientY, nodeId, typed.typeName);
        else {
          const owner = bp?.nodes.find((item) => item.id === nodeId);
          if (owner?.type === "dashboard") showDashPortMenu(e.clientX, e.clientY, nodeId);
          else if (owner?.type === "present" && io === "in") showPresentPortMenu(e.clientX, e.clientY, nodeId, portId);
          else if (owner?.type === "order" && io === "in") showOrderInputPortMenu(e.clientX, e.clientY, nodeId, portId);
        }
        return;
      }
      if (e.button !== 0) return;
      if (io === "in" && (port.dataset.presentLock === "1" || port.dataset.orderLock === "1")) {
        if (port.dataset.orderLock === "1") {
          const ownerNode = bp?.nodes.find((item) => item.id === nodeId);
          const locked = parseLinePort(portId);
          if (ownerNode?.type === "order" && locked?.input) {
            const why = orderFieldOwner(ownerNode.orderId, locked.lineId, locked.field);
            const order = api.findOrder(ownerNode.orderId);
            const line = (order?.lines || []).find((item) => item.id === locked.lineId);
            api?.toast?.(orderFieldOwnerReason(why, line, order, locked.field) || "Вход занят");
          }
        }
        return;
      }

      if (session.linking) {
        const src = session.linking;
        if (src.reverse && io === "out" && nodeId !== src.to) {
          session.linking = null;
          finishLink(nodeId, portId, src.to, src.toPort);
          return;
        }
        if (!src.reverse && io === "in" && nodeId !== src.from) {
          session.linking = null;
          finishLink(src.from, src.fromPort, nodeId, portId);
          return;
        }
      }
      if (io === "in") {
        if (e.altKey) {
          disconnectInput(nodeId, portId);
          return;
        }
        const at = screenToWorld(e.clientX, e.clientY, bp);
        session.linking = { reverse: true, to: nodeId, toPort: portId, x: at.x, y: at.y, sx: e.clientX, sy: e.clientY };
        session.selectedLink = "";
        session.busy = true;
        $("calc-board").setPointerCapture(e.pointerId);
        drawWires(bp, computeGraph(bp));
        return;
      }
      const board = $("calc-board");
      const at = screenToWorld(e.clientX, e.clientY, bp);
      session.linking = { from: nodeId, fromPort: portId, x: at.x, y: at.y, sx: e.clientX, sy: e.clientY };
      session.selectedLink = "";
      session.busy = true;
      board.setPointerCapture(e.pointerId);
      drawWires(bp, computeGraph(bp));
      return;
    }
    if (session.linking) {
      session.linking = null;
      session.selectedLink = "";
      drawWires(bp, computeGraph(bp));
    }
    if (e.target.closest("button") && !e.target.closest(".calc-film-card")) return;
    if (drag && node) {
      e.preventDefault();
      session.selected = node.dataset.node;
      session.selectedLink = "";
      session.busy = true;
      const id = node.dataset.node;
      const origins = [];
      const byId = Object.fromEntries((bp.nodes || []).map((item) => [item.id, item]));
      const moveIds = new Set([id]);
      const dragged = byId[id];
      if (dragged?.type === "group") {
        if (!e.shiftKey) nodesInsideGroup(bp, dragged).forEach((item) => moveIds.add(item.id));
        if (session.moveChain) upstreamNodeIds(bp, id).forEach((nid) => moveIds.add(nid));
      } else if (session.moveChain) {
        upstreamNodeIds(bp, id).forEach((nid) => moveIds.add(nid));
      }
      moveIds.forEach((nid) => {
        const item = byId[nid];
        if (item) origins.push({ id: nid, x: item.x || 0, y: item.y || 0 });
      });
      session.drag = {
        id,
        dx: e.clientX,
        dy: e.clientY,
        origins,
        isGroup: dragged?.type === "group",
      };
      $("calc-board").setPointerCapture(e.pointerId);
      document.querySelectorAll("#calc-nodes .calc-node, #calc-groups .calc-node, #calc-group-ui .calc-group-chrome").forEach((el) => {
        el.classList.toggle("is-on", el.dataset.node === id);
      });
      return;
    }
    if (node) {
      session.selected = node.dataset.node;
      session.selectedLink = "";
      document.querySelectorAll("#calc-nodes .calc-node, #calc-groups .calc-node, #calc-group-ui .calc-group-chrome").forEach((el) => {
        el.classList.toggle("is-on", el.dataset.node === node.dataset.node);
      });
      drawWires(bp, computeGraph(bp));
      return;
    }
    session.selected = "";
    session.selectedLink = "";
    document.querySelectorAll("#calc-nodes .calc-node, #calc-groups .calc-node, #calc-group-ui .calc-group-chrome").forEach((el) => el.classList.remove("is-on"));
    drawWires(bp, computeGraph(bp));
    session.busy = true;
    session.pan = { x: e.clientX, y: e.clientY, ox: bp.x || 0, oy: bp.y || 0 };
    $("calc-board").setPointerCapture(e.pointerId);
  }

  function onBoardPointerMove(e) {
    const bp = activeBlueprint();
    if (!bp) return;
    if (session.pan) {
      bp.x = session.pan.ox + (e.clientX - session.pan.x);
      bp.y = session.pan.oy + (e.clientY - session.pan.y);
      applyWorld(bp);
      if (session.linking) {
        const at = screenToWorld(e.clientX, e.clientY, bp);
        session.linking.x = at.x;
        session.linking.y = at.y;
        drawWires(bp, computeGraph(bp));
      }
      drawMinimap(bp);
      return;
    }
    if (session.linking) {
      const at = screenToWorld(e.clientX, e.clientY, bp);
      session.linking.x = at.x;
      session.linking.y = at.y;
      drawWires(bp, computeGraph(bp));
      return;
    }
    if (session.resize) {
      const zoom = bp.zoom || 1;
      const item = bp.nodes.find((n) => n.id === session.resize.id);
      if (!item) return;
      if (session.resize.axis === "w") {
        const next = Math.round(session.resize.w + (e.clientX - session.resize.dx) / zoom);
        item.w = Math.max(session.resize.min, Math.min(session.resize.max, next));
      } else if (item.type === "group") {
        item.w = Math.max(160, Math.round(session.resize.w + (e.clientX - session.resize.dx) / zoom));
        item.h = Math.max(120, Math.round(session.resize.h + (e.clientY - session.resize.dy) / zoom));
      } else return;
      applyNodeEl(item);
      drawMinimap(bp);
      return;
    }
    if (session.drag) {
      const zoom = bp.zoom || 1;
      const dx = (e.clientX - session.drag.dx) / zoom;
      const dy = (e.clientY - session.drag.dy) / zoom;
      const byId = Object.fromEntries((bp.nodes || []).map((item) => [item.id, item]));
      (session.drag.origins || []).forEach((origin) => {
        const item = byId[origin.id];
        if (!item) return;
        item.x = origin.x + dx;
        item.y = origin.y + dy;
        applyNodeEl(item);
      });
      drawWires(bp, computeGraph(bp));
      drawMinimap(bp);
      return;
    }
  }

  function onBoardPointerUp(e) {
    const bp = activeBlueprint();
    const movedNode = session.drag;
    const movedPan = session.pan;
    const resized = session.resize;
    const linking = session.linking;
    session.drag = null;
    session.pan = null;
    session.resize = null;

    // Средняя кнопка — только панорама; тянущуюся связь не сбрасываем.
    if (e.button === 1) {
      session.busy = !!session.linking;
      if (bp) {
        if (session.linking) {
          const at = screenToWorld(e.clientX, e.clientY, bp);
          session.linking.x = at.x;
          session.linking.y = at.y;
          drawWires(bp, computeGraph(bp));
        }
        drawMinimap(bp);
      }
      setLinkingClass();
      return;
    }

    session.busy = false;
    if (resized) {
      dirty();
      if (bp) drawMinimap(bp);
      return;
    }
    if (e.target.closest?.("input, textarea, select, .calc-bp-name, .calc-refresh, .calc-chain-move, .calc-board-tools")) return;
    if (linking) {
      const over = document.elementFromPoint(e.clientX, e.clientY)?.closest?.(".calc-port");
      const nodeId = over?.closest?.(".calc-node")?.dataset.node;
      const io = over?.dataset.io;
      if (e.button === 2) {
        session.linking = null;
        setLinkingClass();
        if (bp) drawWires(bp, computeGraph(bp));
        if (linking.reverse && io === "out" && nodeId) {
          const parsed = parseLinePort(over.dataset.port);
          if (parsed && !parsed.field) showLinePortMenu(e.clientX, e.clientY, nodeId, parsed.lineId);
          else {
            const typed = parseTypePort(over.dataset.port);
            if (typed && !typed.field) showTypePortMenu(e.clientX, e.clientY, nodeId, typed.typeName);
          }
        }
        return;
      }
      if (linking.reverse && io === "out" && nodeId && nodeId !== linking.to) {
        session.linking = null;
        finishLink(nodeId, over.dataset.port, linking.to, linking.toPort);
        setLinkingClass();
        return;
      }
      if (!linking.reverse && io === "in" && nodeId && nodeId !== linking.from) {
        session.linking = null;
        finishLink(linking.from, linking.fromPort, nodeId, over.dataset.port);
        setLinkingClass();
        return;
      }
      const dx = e.clientX - (linking.sx || e.clientX);
      const dy = e.clientY - (linking.sy || e.clientY);
      if (dx * dx + dy * dy > 64 && !over) {
        session.linking = null;
        setLinkingClass();
        if (bp) drawWires(bp, computeGraph(bp));
      }
      return;
    }
    if (movedPan) {
      const dx = e.clientX - movedPan.x;
      const dy = e.clientY - movedPan.y;
      if (dx * dx + dy * dy > 16) dirty();
      if (bp) drawMinimap(bp);
      return;
    }
    if (movedNode) {
      if (bp && !movedNode.isGroup) {
        const byId = Object.fromEntries((bp.nodes || []).map((item) => [item.id, item]));
        (movedNode.origins || []).forEach((origin) => {
          const item = byId[origin.id];
          if (!item || item.type === "group") return;
          if (snapNodeToGroups(bp, item)) applyNodeEl(item);
        });
      }
      dirty();
      if (bp) {
        drawWires(bp, computeGraph(bp));
        drawMinimap(bp);
      }
    }
  }

  function closeOpenFilterMultis(except) {
    const open = nodesRoot()?.querySelectorAll(".calc-multi[open]") || [];
    if (!open.length && !session.filterMultiOpen) return;
    session.filterMultiLock = true;
    try {
      open.forEach((el) => {
        if (except && (el === except || el.contains(except))) return;
        el.open = false;
      });
    } finally {
      session.filterMultiLock = false;
    }
    if (!except || !except.closest?.(".calc-multi")) {
      session.filterMultiOpen = null;
      session.filterMultiScroll = 0;
    }
  }

  function onBoardWheel(e) {
    const bp = activeBlueprint();
    if (!bp) return;
    // Let nested scrollables (multi-select lists, side panels) scroll instead of zooming.
    const filmWheel = e.target.closest(".calc-film, .mark-film");
    if (filmWheel && filmWheel.scrollWidth > filmWheel.clientWidth + 4) {
      e.preventDefault();
      filmWheel.scrollLeft += e.deltaY + e.deltaX;
      return;
    }
    if (e.target.closest("input, textarea, select, .calc-multi-list, .calc-side, .calc-present-list, .calc-tabs")) return;
    e.preventDefault();
    const before = bp.zoom || 1;
    const next = Math.max(0.35, Math.min(2.5, before * (e.deltaY > 0 ? 0.92 : 1.08)));
    const rect = $("calc-board").getBoundingClientRect();
    const cx = e.clientX - rect.left;
    const cy = e.clientY - rect.top;
    const k = next / before;
    bp.x = cx - (cx - (bp.x || 0)) * k;
    bp.y = cy - (cy - (bp.y || 0)) * k;
    bp.zoom = next;
    applyWorld(bp);
    drawMinimap(bp);
    clearTimeout(onBoardWheel.t);
    onBoardWheel.t = setTimeout(() => dirty(), 280);
  }

  function onDrop(e) {
    const bp = activeBlueprint();
    if (!bp) return;
    const orderId = e.dataTransfer?.getData("text/finmaster-order") || e.dataTransfer?.getData("text/plain");
    const kind = e.dataTransfer?.getData("text/finmaster-node");
    const blueprintId = e.dataTransfer?.getData("text/finmaster-blueprint");
    const presentBlock = e.dataTransfer?.getData("text/finmaster-present");
    const presentPage = e.dataTransfer?.getData("text/finmaster-present-page");
    e.preventDefault();
    const at = worldPoint(bp, e.clientX, e.clientY);
    if (presentBlock) addPresentNode(presentPage, presentBlock, at);
    else if (kind === "math" || kind === "formula" || kind === "percent" || kind === "const" || kind === "result" || kind === "group" || kind === "comment" || kind === "filter" || kind === "dashboard" || kind === "planner" || kind === "openings" || kind === "electrics") addNode(kind, at);
    else if (blueprintId && blueprintId !== bp.id) addNode("scheme", at, { blueprintId });
    else if (orderId && api.findOrder(orderId)) addNode("order", at, { orderId });
  }

  function formulaNode(id) {
    return (activeBlueprint()?.nodes || []).find((node) => node.id === id && node.type === "formula");
  }

  function bind() {
    if (session.bound) return;
    session.bound = true;
    bindFormulaProfileModals();
    const root = $("view-calculator");
    const board = $("calc-board");
    if (!root || !board) return;
    $("calc-tabs")?.addEventListener("pointerdown", (e) => {
      const calc = ensureState();
      if (!calc) return;
      const del = e.target.closest("[data-del-bp]");
      if (!del) return;
      e.preventDefault();
      e.stopPropagation();
      if (calc.blueprints.length < 2) return;
      const id = del.dataset.delBp;
      calc.blueprints.forEach((item) => {
        item.nodes = (item.nodes || []).filter((node) => !(node.type === "scheme" && node.blueprintId === id));
        const ids = new Set(item.nodes.map((node) => node.id));
        item.links = (item.links || []).filter((link) => ids.has(link.from) && ids.has(link.to));
      });
      calc.blueprints = calc.blueprints.filter((item) => item.id !== id);
      if (calc.active === id) calc.active = calc.blueprints[0].id;
      dirty();
      render();
    });
    $("calc-tabs")?.addEventListener("click", (e) => {
      if (e.target.closest("[data-del-bp]")) return;
      if (session.tabMoved) {
        session.tabMoved = false;
        return;
      }
      const calc = ensureState();
      const tab = e.target.closest("[data-bp]");
      if (!calc || !tab || tab.dataset.bp === calc.active) return;
      calc.active = tab.dataset.bp;
      dirty();
      render();
    });
    $("calc-tabs")?.addEventListener("dragstart", (e) => {
      const tab = e.target.closest("[data-bp]");
      if (!tab || e.target.closest("[data-del-bp]")) {
        e.preventDefault();
        return;
      }
      session.tabDrag = tab.dataset.bp || "";
      session.tabMoved = false;
      tab.classList.add("is-drag");
      e.dataTransfer.effectAllowed = "move";
      e.dataTransfer.setData("text/finmaster-tab", session.tabDrag);
      e.dataTransfer.setData("text/plain", session.tabDrag);
    });
    $("calc-tabs")?.addEventListener("dragend", () => {
      session.tabDrag = "";
      $("calc-tabs")?.querySelectorAll(".calc-tab").forEach((el) => {
        el.classList.remove("is-drag", "is-drop-before", "is-drop-after");
      });
    });
    $("calc-tabs")?.addEventListener("dragover", (e) => {
      const dragId = session.tabDrag;
      if (!dragId) return;
      const tab = e.target.closest("[data-bp]");
      const host = $("calc-tabs");
      host?.querySelectorAll(".calc-tab").forEach((el) => el.classList.remove("is-drop-before", "is-drop-after"));
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
      if (!tab || tab.dataset.bp === dragId) return;
      const rect = tab.getBoundingClientRect();
      const after = e.clientX > rect.left + rect.width / 2;
      tab.classList.add(after ? "is-drop-after" : "is-drop-before");
    });
    $("calc-tabs")?.addEventListener("drop", (e) => {
      const fromId = session.tabDrag || e.dataTransfer?.getData("text/finmaster-tab") || e.dataTransfer?.getData("text/plain");
      const tab = e.target.closest("[data-bp]");
      e.preventDefault();
      if (!fromId || !tab || tab.dataset.bp === fromId) return;
      const rect = tab.getBoundingClientRect();
      const after = e.clientX > rect.left + rect.width / 2;
      if (reorderBlueprint(fromId, tab.dataset.bp, after)) session.tabMoved = true;
      session.tabDrag = "";
    });
    root.querySelector(".calc-tabbar")?.addEventListener(
      "wheel",
      (e) => {
        const host = $("calc-tabs");
        if (!host) return;
        const delta = Math.abs(e.deltaY) >= Math.abs(e.deltaX) ? e.deltaY : e.deltaX;
        if (!delta) return;
        e.preventDefault();
        host.scrollLeft += delta;
      },
      { passive: false }
    );
    root.addEventListener("click", (e) => {
      const eye = e.target.closest("[data-result-eye]");
      if (eye) {
        e.preventDefault();
        e.stopPropagation();
        const bp = activeBlueprint();
        const node = bp?.nodes.find((item) => item.id === eye.dataset.resultEye && item.type === "result");
        if (!node) return;
        node.visible = !resultVisible(node);
        if (!resultVisible(node)) pruneHiddenResultLinks(node.id);
        dirty();
        render();
        return;
      }
      if (!e.target.closest("[data-add-bp]")) return;
      const calc = ensureState();
      if (!calc) return;
      const bp = emptyBlueprint(`Схема ${calc.blueprints.length + 1}`);
      calc.blueprints.push(bp);
      calc.active = bp.id;
      dirty();
      render();
    });
    $("calc-refresh")?.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      recalculate();
    });
    $("calc-chain-move")?.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      session.moveChain = !session.moveChain;
      syncChainMoveBtn();
    });
    $("calc-prune")?.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      const n = pruneOrphanNodes();
      const btn = $("calc-prune");
      if (btn) {
        btn.title = n ? `Убрано: ${n}` : "Нет нод без связей";
        clearTimeout(btn._pruneT);
        btn._pruneT = setTimeout(() => {
          btn.title = "Убрать ноды без связей";
        }, 1600);
      }
    });
    $("calc-present-btn")?.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      togglePresentPanel();
    });
    document.addEventListener("click", (e) => {
      if (!session.presentPanel) return;
      if (e.target.closest("[data-close-present-panel]")) {
        togglePresentPanel(false);
        return;
      }
      const item = e.target.closest("[data-present-block]");
      if (item && item.closest("#calc-present-panel")) {
        addPresentNode(item.dataset.presentPage, item.dataset.presentBlock);
      }
    });
    document.addEventListener(
      "pointerdown",
      (e) => {
        if (!session.filterMultiOpen && !nodesRoot()?.querySelector(".calc-multi[open]")) return;
        const hit = e.target.closest?.(".calc-multi, [data-filter-multi-clear]");
        if (hit) return;
        closeOpenFilterMultis();
      },
      true
    );
    document.addEventListener("dragstart", (e) => {
      const item = e.target.closest("[data-present-block]");
      if (!item || !item.closest("#calc-present-panel")) return;
      e.dataTransfer.setData("text/finmaster-present", item.dataset.presentBlock);
      e.dataTransfer.setData("text/finmaster-present-page", item.dataset.presentPage || "");
      e.dataTransfer.effectAllowed = "copy";
    });
    syncChainMoveBtn();
    syncMiniToggle();
    $("calc-mini-toggle")?.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      session.miniHidden = !session.miniHidden;
      syncMiniToggle();
      const bp = activeBlueprint();
      if (bp && !session.miniHidden) drawMinimap(bp);
    });
    $("calc-bp-name")?.addEventListener("input", (e) => {
      const bp = activeBlueprint();
      if (!bp) return;
      bp.name = String(e.target.value || "").slice(0, 48);
      const label = $("calc-tabs")?.querySelector(".calc-tab.active .calc-tab-label");
      if (label) label.textContent = bp.name || "Схема";
      dirty();
    });
    $("calc-bp-name")?.addEventListener("focusout", (e) => {
      const bp = activeBlueprint();
      if (!bp) return;
      bp.name = String(e.target.value || "").trim().slice(0, 48) || "Схема";
      e.target.value = bp.name;
      dirty();
      render();
    });
    $("calc-bp-name")?.addEventListener("keydown", (e) => {
      if (e.key !== "Enter") return;
      e.preventDefault();
      e.target.blur();
    });
    $("calc-side")?.addEventListener("input", (e) => {
      if (e.target.id !== "calc-order-search") return;
      session.search = e.target.value;
      const start = e.target.selectionStart;
      const end = e.target.selectionEnd;
      const list = document.querySelector("#calc-side .calc-order-list");
      const listScroll = list?.scrollTop || 0;
      const sideScroll = $("calc-side")?.scrollTop || 0;
      renderSide(activeBlueprint());
      const input = $("calc-order-search");
      if (input) {
        input.focus({ preventScroll: true });
        try {
          input.setSelectionRange(start ?? input.value.length, end ?? input.value.length);
        } catch {
          /* ignore */
        }
      }
      const side = $("calc-side");
      if (side) side.scrollTop = sideScroll;
      const nextList = document.querySelector("#calc-side .calc-order-list");
      if (nextList) nextList.scrollTop = listScroll;
    });
    $("calc-side")?.addEventListener("click", (e) => {
      const clear = e.target.closest("[data-search-clear]");
      if (clear) {
        e.preventDefault();
        e.stopPropagation();
        session.search = "";
        renderSide(activeBlueprint());
        $("calc-order-search")?.focus();
        return;
      }
      const add = e.target.closest("[data-add-node]");
      if (add) {
        addNode(add.dataset.addNode);
        return;
      }
      const scheme = e.target.closest("[data-blueprint]");
      if (scheme) {
        addNode("scheme", null, { blueprintId: scheme.dataset.blueprint });
        return;
      }
      const order = e.target.closest("[data-order]");
      if (order) addNode("order", null, { orderId: order.dataset.order });
      const summary = e.target.closest("details.calc-fold > summary");
      if (summary) {
        const fold = summary.parentElement;
        if (fold instanceof HTMLDetailsElement && fold.dataset.fold) {
          requestAnimationFrame(() => setFold(fold.dataset.fold, fold.open));
        }
      }
    });
    $("calc-side")?.addEventListener(
      "toggle",
      (e) => {
        const fold = e.target;
        if (!(fold instanceof HTMLDetailsElement)) return;
        if (!fold.matches("details.calc-fold[data-fold]")) return;
        setFold(fold.dataset.fold, fold.open);
      },
      true
    );
    $("calc-side")?.addEventListener("dragstart", (e) => {
      const order = e.target.closest("[data-order]");
      const tool = e.target.closest("[data-add-node]");
      const scheme = e.target.closest("[data-blueprint]");
      if (order) {
        e.dataTransfer.setData("text/finmaster-order", order.dataset.order);
        e.dataTransfer.setData("text/plain", order.dataset.order);
        e.dataTransfer.effectAllowed = "copy";
      } else if (tool) {
        e.dataTransfer.setData("text/finmaster-node", tool.dataset.addNode);
        e.dataTransfer.effectAllowed = "copy";
      } else if (scheme) {
        e.dataTransfer.setData("text/finmaster-blueprint", scheme.dataset.blueprint);
        e.dataTransfer.effectAllowed = "copy";
      }
    });
    board.addEventListener("dragover", (e) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = "copy";
    });
    board.addEventListener("drop", onDrop);
    board.addEventListener("scroll", () => {
      board.scrollTop = 0;
      board.scrollLeft = 0;
    });
    board.addEventListener("pointerdown", onBoardPointerDown);
    board.addEventListener("pointermove", onBoardPointerMove);
    board.addEventListener("pointerup", onBoardPointerUp);
    board.addEventListener("pointercancel", onBoardPointerUp);
    board.addEventListener("dblclick", (e) => {
      const card = e.target.closest(".calc-film-card");
      if (!card) return;
      const nodeEl = card.closest(".calc-node");
      const bp = activeBlueprint();
      const node = nodeEl && bp
        ? bp.nodes.find((item) => item.id === nodeEl.dataset.node)
        : null;
      if (!node) return;
      e.preventDefault();
      e.stopPropagation();
      if (node.type === "planner") openPlanner(node.id);
      else if (node.type === "openings" || node.type === "electrics") {
        openMark(node.id, card.dataset.markSurface || "");
      }
    });
    board.addEventListener("auxclick", (e) => {
      if (e.button === 1) e.preventDefault();
    });
    board.addEventListener("contextmenu", (e) => {
      if (e.target.closest(".calc-port, .calc-port-menu")) e.preventDefault();
    });
    board.addEventListener("wheel", onBoardWheel, { passive: false });
    const mini = $("calc-minimap");
    mini?.addEventListener("pointerdown", (e) => {
      if (session.miniHidden) return;
      e.preventDefault();
      e.stopPropagation();
      const bp = activeBlueprint();
      const at = miniWorldPoint(e.clientX, e.clientY);
      if (!bp || !at) return;
      session.miniDrag = true;
      session.busy = true;
      centerViewOn(bp, at.x, at.y);
      mini.setPointerCapture(e.pointerId);
    });
    mini?.addEventListener("pointermove", (e) => {
      if (!session.miniDrag || session.miniHidden) return;
      const bp = activeBlueprint();
      const at = miniWorldPoint(e.clientX, e.clientY);
      if (!bp || !at) return;
      centerViewOn(bp, at.x, at.y);
    });
    mini?.addEventListener("pointerup", () => {
      if (!session.miniDrag) return;
      session.miniDrag = null;
      session.busy = false;
      dirty();
    });
    mini?.addEventListener("pointercancel", () => {
      session.miniDrag = null;
      session.busy = false;
    });
    board.addEventListener("click", async (e) => {
      const btn = e.target.closest(".calc-screen-copy");
      if (!btn || !board.contains(btn) || btn.disabled) return;
      e.preventDefault();
      e.stopPropagation();
      const text = btn.dataset.copy || "";
      if (!(await copyScreenText(text))) return;
      const screen = btn.closest(".calc-screen");
      btn.classList.add("is-copied");
      screen?.classList.add("is-copied");
      btn.title = "Скопировано";
      clearTimeout(btn._copyT);
      btn._copyT = setTimeout(() => {
        btn.classList.remove("is-copied");
        screen?.classList.remove("is-copied");
        btn.title = "Копировать";
      }, 1400);
    });
    root.addEventListener("click", (e) => {
      const clearMulti = e.target.closest("[data-filter-multi-clear]");
      if (clearMulti) {
        e.preventDefault();
        e.stopPropagation();
        const nodeEl = clearMulti.closest(".calc-node");
        const bp = activeBlueprint();
        const node = nodeEl && bp ? bp.nodes.find((item) => item.id === nodeEl.dataset.node) : null;
        const field = clearMulti.dataset.filterMultiClear || "";
        const allowed = new Set(["customers", "orderIds", "payFilters", "payStatusFilters", "orderTypes", "products", "statuses"]);
        if (!node || !allowed.has(field) || (node.type !== "filter" && node.type !== "dashboard")) return;
        node[field] = [];
        if (field === "customers") {
          /* keep orderIds — user can clear orders separately */
        }
        normalizeFilterNode(node);
        if (session.filterMultiOpen?.nodeId === node.id && session.filterMultiOpen?.field === field) {
          session.filterMultiOpen = null;
          session.filterMultiScroll = 0;
        }
        session.selected = node.id;
        dirty();
        render();
        return;
      }
      const nodeEl = e.target.closest(".calc-node");
      const bp = activeBlueprint();
      if (e.target.closest("[data-del-node]")) {
        removeNode(e.target.closest("[data-del-node]").dataset.delNode);
        return;
      }
      const dropLink = e.target.closest("[data-del-link]");
      if (dropLink) {
        removeLink(dropLink.dataset.delLink);
        return;
      }
      const dropIn = e.target.closest("[data-del-in-link]");
      if (dropIn) {
        disconnectInput(dropIn.closest(".calc-node")?.dataset.node, dropIn.dataset.delInLink);
        return;
      }
      if (!bp || !nodeEl) return;
      const node = bp.nodes.find((item) => item.id === nodeEl.dataset.node);
      if (!node) return;
      session.selected = node.id;
      const op = e.target.closest("[data-op]");
      if (op && node.type === "math") {
        node.op = op.dataset.op;
        dirty();
        render();
        return;
      }
      if (e.target.closest("[data-formula-profile-save]") && node.type === "formula") {
        openFormulaProfileSave(node);
        return;
      }
      if (e.target.closest("[data-formula-profile-del]") && node.type === "formula") {
        openFormulaProfileDelete();
        return;
      }
      if (e.target.closest("[data-add-in]") && node.type === "formula") {
        if ((node.inputs || []).length >= 26) return;
        const used = formulaLetterSet(node);
        const name = nextLetter(used);
        if (!name) return;
        node.inputs.push({ id: uid(), name });
        dirty();
        render();
        return;
      }
      if (e.target.closest("[data-add-out]") && node.type === "formula") {
        if ((node.outputs || []).length >= MATH_MAX) return;
        const used = formulaLetterSet(node);
        const name = nextLetter(used);
        if (!name) return;
        node.outputs.push({ id: uid(), name, expr: "0" });
        dirty();
        render();
        return;
      }
      if (e.target.closest("[data-del-in]") && node.type === "formula") {
        const id = e.target.closest("[data-del-in]").dataset.delIn;
        if ((node.inputs || []).length <= 1) return;
        node.inputs = node.inputs.filter((port) => port.id !== id);
        bp.links = bp.links.filter((link) => !(link.to === node.id && link.toPort === id));
        dirty();
        render();
        return;
      }
      if (e.target.closest("[data-del-out]") && node.type === "formula") {
        const id = e.target.closest("[data-del-out]").dataset.delOut;
        if ((node.outputs || []).length <= 1) return;
        node.outputs = node.outputs.filter((port) => port.id !== id);
        bp.links = bp.links.filter((link) => !(link.from === node.id && link.fromPort === id));
        dirty();
        render();
        return;
      }
      const dashPorts = e.target.closest("[data-dash-ports]");
      if (dashPorts && node.type === "dashboard") {
        showDashPortMenu(e.clientX, e.clientY, node.id);
        return;
      }
      const plannerEdit = e.target.closest("[data-planner-edit]");
      if (plannerEdit) {
        e.preventDefault();
        e.stopPropagation();
        const layoutId = e.target.closest("[data-planner-layout]")?.dataset.plannerLayout;
        if (layoutId && node?.type === "planner") plannerUseLayout(node, layoutId);
        openPlanner(plannerEdit.dataset.plannerEdit || node.id);
        return;
      }
      const markEdit = e.target.closest("[data-mark-edit], [data-mark-open]");
      if (markEdit && !e.target.closest(".calc-film-card")) {
        e.preventDefault();
        e.stopPropagation();
        openMark(markEdit.dataset.markEdit || markEdit.dataset.markOpen || node.id, markEdit.dataset.markSurface || "");
        return;
      }
      const orderTypes = e.target.closest("[data-order-types]");
      if (orderTypes && node.type === "order") {
        showOrderTypeMenu(e.clientX, e.clientY, node.id);
      }
    });
    root.addEventListener("input", (e) => {
      if (e.target.dataset?.plannerColor) {
        const nodeEl = e.target.closest("[data-node]");
        const bp = activeBlueprint();
        const node = nodeEl && bp ? bp.nodes.find((item) => item.id === nodeEl.dataset.node) : null;
        if (node?.type === "planner") {
          node.color = String(e.target.value || "#65a30d").toLowerCase();
          const layout = plannerActive(node);
          if (layout) layout.color = node.color;
          nodeEl.style.setProperty("--planner-color", node.color);
          const card = nodeEl.querySelector(`.calc-film-card[data-planner-layout="${cssEsc(node.layoutId)}"]`);
          const thumb = card?.querySelector(".calc-planner-thumb");
          if (thumb) thumb.style.setProperty("--planner-color", node.color);

          // Распространяем цвет по всей цепочке чертежей, а не только по прямым связям с планировщиком.
          // Обновление выполняется без render(), чтобы не закрывать системный выбор цвета.
          const graph = computeGraph(bp);
          (bp.nodes || []).forEach((target) => {
            if (target.type !== "openings" && target.type !== "electrics") return;
            const plan = upstreamPlan(target, bp, [], graph.values);
            if (!plan) return;
            const tones = markTones(target, plan.color);
            const targetEl = findNodeEl(target.id);
            if (!targetEl) return;
            targetEl.style.setProperty("--planner-color", tones.floor);
            targetEl.style.setProperty("--mark-floor", tones.floor);
            targetEl.style.setProperty("--mark-ceiling", tones.ceiling);
            targetEl.style.setProperty("--mark-wall", tones.wall);
            targetEl.querySelectorAll(".calc-film-thumb").forEach((filmThumb) => {
              const filmCard = filmThumb.closest("[data-mark-surface]");
              if (!filmCard) {
                filmThumb.style.setProperty("--film-tone", tones.floor);
                return;
              }
              const surface = filmCard.dataset.markSurface;
              const tone = surface === "ceiling" ? tones.ceiling : surface === "floor" ? tones.floor : tones.wall;
              filmThumb.style.setProperty("--film-tone", tone);
            });
          });
          dirty();
        } else if (node?.type === "openings" || node?.type === "electrics") {
          node.color = String(e.target.value || "#65a30d").toLowerCase();
          nodeEl.style.setProperty("--planner-color", node.color);
          const path = nodeEl.querySelector(".calc-planner-thumb path");
          if (path) path.style.stroke = node.color;
        }
        return;
      }
      if (e.target.dataset?.groupColor) {
        const nodeEl = e.target.closest("[data-node]");
        const bp = activeBlueprint();
        const node = nodeEl && bp ? bp.nodes.find((item) => item.id === nodeEl.dataset.node) : null;
        if (node?.type === "group") {
          node.color = String(e.target.value || "#14b8a6");
          const vis = groupsRoot()?.querySelector(`[data-node="${cssEsc(node.id)}"]`);
          const chrome = findGroupChrome(node.id);
          vis?.style.setProperty("--group-color", node.color);
          chrome?.style.setProperty("--group-color", node.color);
          drawMinimap(bp);
        }
        return;
      }
      const nodeEl = e.target.closest(".calc-node");
      const bp = activeBlueprint();
      const node = nodeEl && bp ? bp.nodes.find((item) => item.id === nodeEl.dataset.node) : null;
      if (!node || !bp) return;
      if (e.target.dataset?.constValue && node.type === "const") {
        const text = String(e.target.value || "").replace(",", ".").trim();
        if (text && text !== "-" && text !== "." && text !== "-.") {
          const value = Number(text);
          if (Number.isFinite(value)) node.value = value;
        } else if (!text) {
          node.value = 0;
        }
        dirty();
        patchGraphLive();
        return;
      }
      if (e.target.dataset?.constNote && node.type === "const") {
        node.note = String(e.target.value || "").slice(0, 500);
        dirty();
        return;
      }
      if (e.target.dataset?.commentText && node.type === "comment") {
        node.text = String(e.target.value || "").slice(0, 2000);
        dirty();
        return;
      }
      if (e.target.dataset?.plannerTitle && node.type === "planner") {
        node.name = String(e.target.value || "").trim().slice(0, 48);
        return;
      }
      if (e.target.dataset?.markTitle && (node.type === "openings" || node.type === "electrics")) {
        node.name = String(e.target.value || "").trim().slice(0, 48);
        const title = $("mark-title");
        if (title && document.activeElement !== title && session.mark?.id === node.id) title.value = node.name;
        return;
      }
      if ((e.target.dataset?.inName || e.target.dataset?.outName) && node.type === "formula") {
        const list = e.target.dataset.inName ? node.inputs : node.outputs;
        const portId = e.target.dataset.inName || e.target.dataset.outName;
        const port = (list || []).find((item) => item.id === portId);
        if (port) {
          let letter = "";
          for (const ch of String(e.target.value || "")) {
            if ((ch >= "a" && ch <= "z") || (ch >= "A" && ch <= "Z")) letter = ch.toUpperCase();
          }
          if (e.target.value !== letter) {
            e.target.value = letter;
            try {
              e.target.setSelectionRange(letter.length, letter.length);
            } catch {
              /* ignore */
            }
          }
          port.name = letter;
        }
        dirty();
        patchGraphLive();
        return;
      }
      if (e.target.dataset?.outExpr && node.type === "formula") {
        const port = (node.outputs || []).find((item) => item.id === e.target.dataset.outExpr);
        if (port) {
          const raw = e.target.value;
          const next = sanitizeFormulaExpr(raw);
          if (next !== raw) {
            const pos = e.target.selectionStart ?? raw.length;
            let kept = 0;
            let seen = 0;
            for (const ch of raw) {
              if (seen >= pos) break;
              seen += ch.length;
              kept += sanitizeFormulaExpr(ch).length;
            }
            e.target.value = next;
            try {
              e.target.setSelectionRange(kept, kept);
            } catch {
              /* ignore */
            }
          }
          port.expr = e.target.value;
        }
        dirty();
        patchGraphLive();
      }
    });
    root.addEventListener("toggle", (e) => {
      if (session.filterMultiLock) return;
      const box = e.target;
      if (!(box instanceof HTMLDetailsElement) || !box.classList.contains("calc-multi")) return;
      const nodeEl = box.closest("[data-node]");
      const field = box.dataset.filterMultiField || "";
      const nodeId = nodeEl?.dataset?.node || "";
      if (!field || !nodeId) return;
      if (box.open) {
        session.filterMultiOpen = { nodeId, field };
        session.filterMultiLock = true;
        try {
          nodesRoot()?.querySelectorAll(".calc-multi[open]").forEach((el) => {
            if (el !== box) el.open = false;
          });
        } finally {
          session.filterMultiLock = false;
        }
      } else if (session.filterMultiOpen?.nodeId === nodeId && session.filterMultiOpen?.field === field) {
        session.filterMultiOpen = null;
        session.filterMultiScroll = 0;
      }
    }, true);
    root.addEventListener("change", (e) => {
      const nodeEl = e.target.closest(".calc-node, .calc-group-chrome");
      const bp = activeBlueprint();
      const plannerPick = e.target.matches?.("[data-planner-pick]") ? e.target : null;
      const plannerId = plannerPick?.dataset.plannerPick || "";
      const node = bp ? bp.nodes.find((item) => item.id === (plannerId || nodeEl?.dataset.node)) : null;
      if (!node) return;
      if (e.target.dataset.resultName && node.type === "result") {
        node.name = String(e.target.value || "").trim().slice(0, 48) || "Результат";
        e.target.value = node.name;
        dirty();
        render();
        return;
      }
      if (e.target.dataset.plannerTitle && node.type === "planner") {
        node.name = plannerName({ name: e.target.value });
        e.target.value = node.name;
        dirty();
        return;
      }
      if (plannerPick && node.type === "planner") {
        const value = plannerPick.value;
        if (value === "__new") {
          const created = plannerAddLayout(node);
          if (!created) {
            plannerPick.value = node.layoutId;
            api?.toast?.("Достигнут лимит планировок");
            return;
          }
        } else plannerUseLayout(node, value);
        if (session.planner?.id === node.id) {
          session.planner.sel = null;
          plannerCommit(true);
        } else {
          dirty();
          render();
        }
        return;
      }
      if (e.target.dataset.markTitle && (node.type === "openings" || node.type === "electrics")) {
        const fallback = node.type === "electrics" ? "Электрика" : "Проёмы";
        node.name = String(e.target.value || "").trim().slice(0, 48) || fallback;
        e.target.value = node.name;
        const title = $("mark-title");
        if (title && session.mark?.id === node.id) title.value = node.name;
        dirty();
        return;
      }
      if (e.target.dataset.plannerColor && node.type === "planner") {
        node.color = String(e.target.value || "#65a30d").toLowerCase();
        dirty();
        render();
        return;
      }
      if (e.target.dataset.resultPrio && node.type === "result") {
        const n = Math.round(Number(e.target.value));
        node.priority = Number.isFinite(n) ? Math.max(0, Math.min(9999, n)) : nextResultPriority(bp);
        e.target.value = String(node.priority);
        dirty();
        render();
        return;
      }
      if (e.target.dataset.groupName && node.type === "group") {
        node.name = String(e.target.value || "").trim().slice(0, 48) || "Группа";
        e.target.value = node.name;
        dirty();
        return;
      }
      if (e.target.dataset.groupColor && node.type === "group") {
        node.color = String(e.target.value || "#14b8a6");
        const vis = groupsRoot()?.querySelector(`[data-node="${cssEsc(node.id)}"]`);
        const chrome = findGroupChrome(node.id);
        vis?.style.setProperty("--group-color", node.color);
        chrome?.style.setProperty("--group-color", node.color);
        dirty();
        drawMinimap(bp);
        return;
      }
      if (e.target.dataset.constValue && node.type === "const") {
        node.value = parseConstValue(e.target.value);
        e.target.value = String(node.value);
        dirty();
        render();
        return;
      }
      if (e.target.dataset.filterField && (node.type === "filter" || node.type === "dashboard")) {
        const field = e.target.dataset.filterField;
        const raw = String(e.target.value || "").trim();
        if (field === "period") node.period = DASH_PERIODS.some(([id]) => id === raw) ? raw : "all";
        else if (field === "dateFrom") node.dateFrom = raw.slice(0, 10);
        else if (field === "dateTo") node.dateTo = raw.slice(0, 10);
        dirty();
        render();
        return;
      }
      if (e.target.dataset.filterMulti && (node.type === "filter" || node.type === "dashboard")) {
        const field = e.target.dataset.filterMulti;
        const box = e.target.closest(".calc-multi");
        const checked = [...(box?.querySelectorAll(`input[data-filter-multi="${cssEsc(field)}"]:checked`) || [])].map((el) =>
          String(el.value || "").trim()
        );
        const allowed = new Set(["customers", "orderIds", "payFilters", "payStatusFilters", "orderTypes", "products", "statuses"]);
        if (!allowed.has(field)) return;
        node[field] = uniqueStrings(checked).slice(0, FILTER_MULTI_MAX);
        if (field === "customers") {
          const keys = new Set(node.customers.map((name) => name.toLowerCase()));
          if (keys.size) {
            node.orderIds = (node.orderIds || []).filter((id) => {
              const order = api.findOrder?.(id);
              return order && keys.has(String(order.customer || "").toLowerCase());
            });
          }
        }
        normalizeFilterNode(node);
        session.filterMultiOpen = { nodeId: node.id, field };
        const listEl = box?.querySelector(".calc-multi-list");
        if (listEl) session.filterMultiScroll = listEl.scrollTop;
        dirty();
        render();
        return;
      }
      if (node.type !== "formula") return;
      if (e.target.dataset.formulaProfile != null) {
        const raw = String(e.target.value || "");
        if (!raw) return;
        const profile = loadFormulaProfiles()[Number(raw)];
        if (!profile) return;
        applyFormulaProfile(node, bp, profile);
        dirty();
        render();
        api?.toast?.(`Профиль «${profile.name}»`);
        return;
      }
      if (e.target.dataset.inName) {
        const port = node.inputs.find((item) => item.id === e.target.dataset.inName);
        if (port) {
          const used = formulaLetterSet(node, port.id);
          port.name = sanitizeFormulaInput(e.target.value, used, port.name);
          e.target.value = port.name;
        }
      }
      if (e.target.dataset.outName) {
        const port = node.outputs.find((item) => item.id === e.target.dataset.outName);
        if (port) {
          const used = formulaLetterSet(node, port.id);
          port.name = sanitizeFormulaInput(e.target.value, used, port.name);
          e.target.value = port.name;
        }
      }
      if (e.target.dataset.outExpr) {
        const port = node.outputs.find((item) => item.id === e.target.dataset.outExpr);
        if (port) {
          port.expr = sanitizeFormulaExpr(e.target.value);
          e.target.value = port.expr;
        }
      }
      dirty();
      render();
    });
    root.addEventListener("keydown", (e) => {
      if (e.key !== "Enter") return;
      if (e.target.matches(".calc-expr, .calc-pname, .calc-const-val, .calc-filter-input")) {
        e.preventDefault();
        e.target.blur();
      }
    });
    document.addEventListener("pointermove", (e) => {
      if (api?.view?.() !== "calculator" || !session.linking || session.drag || session.pan) return;
      const bp = activeBlueprint();
      if (!bp) return;
      const at = screenToWorld(e.clientX, e.clientY, bp);
      session.linking.x = at.x;
      session.linking.y = at.y;
      drawWires(bp, computeGraph(bp));
      const want = session.linking.reverse ? "out" : "in";
      nodesRoot()?.querySelectorAll(".calc-port").forEach((el) => el.classList.toggle("is-hot", false));
      const over = document.elementFromPoint(e.clientX, e.clientY)?.closest?.(".calc-port");
      if (over?.dataset.io === want) {
        const owner = bp.nodes.find((item) => item.id === over.closest(".calc-node")?.dataset.node);
        const dragNode = bp.nodes.find((item) => item.id === (session.linking.reverse ? session.linking.to : session.linking.from));
        const dragPort = session.linking.reverse ? session.linking.toPort : session.linking.fromPort;
        if (portSignal(owner, over.dataset.port) === portSignal(dragNode, dragPort)) over.classList.add("is-hot");
      }
    });
    document.addEventListener("keydown", (e) => {
      if (api?.view?.() !== "calculator") return;
      if (session.mark?.id) {
        const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName) || e.target.isContentEditable;
        if (e.key === "Escape") {
          e.preventDefault();
          if (!$("mark-menu")?.hidden) markHideMenu();
          else closeMark();
          return;
        }
        if (!typing && (e.key === "Delete" || e.key === "Backspace")) {
          e.preventDefault();
          const node = markNode();
          const sel = session.mark.sel;
          if (!node || !sel) return;
          if (node.type === "openings") {
            node.holes = node.holes.filter((hole) => hole.id !== sel);
            const bp = activeBlueprint();
            if (bp) bp.links = (bp.links || []).filter((link) => !(link.to === node.id && String(link.toPort || "").startsWith(`b:${sel}:`)));
          } else node.fixtures = node.fixtures.filter((item) => item.id !== sel);
          session.mark.sel = "";
          markCommit(true);
          return;
        }
        if ((e.ctrlKey || e.metaKey) && !e.altKey && e.code === "KeyD") {
          e.preventDefault();
          return;
        }
      }
      if (session.planner?.id) {
        const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName) || e.target.isContentEditable;
        if (e.key === "Escape") {
          e.preventDefault();
          if (session.planner.nudge) plannerHideNudge();
          else closePlanner();
          return;
        }
        if (!typing && (e.key === "Delete" || e.key === "Backspace") && session.planner.sel?.kind === "point") {
          e.preventDefault();
          plannerDeleteSelected();
          return;
        }
        if ((e.ctrlKey || e.metaKey) && !e.altKey && e.code === "KeyD") {
          e.preventDefault();
          return;
        }
        if (!typing && (e.key === "Delete" || e.key === "Backspace")) {
          e.preventDefault();
          return;
        }
      }
      if (e.key === "Escape") {
        hidePortMenu();
        session.resize = null;
        let redraw = false;
        if (session.linking) {
          session.linking = null;
          setLinkingClass();
          redraw = true;
        }
        if (session.selectedLink) {
          session.selectedLink = "";
          redraw = true;
        }
        if (redraw) {
          const bp = activeBlueprint();
          if (bp) drawWires(bp, computeGraph(bp));
        }
        return;
      }
      const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName) || e.target.isContentEditable;
      if (typing) return;
      if ((e.ctrlKey || e.metaKey) && !e.altKey && e.code === "KeyD" && session.selected) {
        e.preventDefault();
        duplicateNode(session.selected);
        return;
      }
      if ((e.key === "Delete" || e.key === "Backspace") && session.selectedLink) {
        e.preventDefault();
        removeLink(session.selectedLink);
        return;
      }
      if ((e.key === "Delete" || e.key === "Backspace") && session.selected) {
        e.preventDefault();
        removeNode(session.selected);
      }
    });
    window.addEventListener("resize", () => {
      if (session.planner?.id) plannerDraw();
      if (api?.view?.() === "calculator") {
        const bp = activeBlueprint();
        if (bp) {
          drawWires(bp, computeGraph(bp));
          drawMinimap(bp);
        }
      }
    });
  }

  window.FinCalc = {
    bind(next) {
      api = next;
      bind();
    },
    render(next) {
      if (next) api = next;
      render();
    },
    presentValue(blockId, portId) {
      const key = `${blockId}:${portId}`;
      if (!presentValues.has(key)) return null;
      return presentValues.get(key);
    },
    syncPresentValues(next) {
      if (next) api = next;
      rebuildPresentValues();
    },
    refreshPresent() {
      renderPresentPanel();
    },
    refreshEditors() {
      refreshEditors();
    },
    editorKeys(e) {
      const open = $("planner-modal")?.classList.contains("open") || $("mark-modal")?.classList.contains("open");
      if (!open || !e.ctrlKey && !e.metaKey) return false;
      if (e.code === "KeyZ" && !e.shiftKey) {
        editorUndo();
        return true;
      }
      if (e.code === "KeyY" || (e.code === "KeyZ" && e.shiftKey)) {
        editorRedo();
        return true;
      }
      return false;
    },
    hidePresentPanel() {
      hidePresentPanel();
    },
    removePresentBlock(blockId) {
      return removePresentBlockNodes(blockId);
    },
    orderFieldLocks() {
      try {
        return collectOrderFieldLocks();
      } catch (err) {
        console.warn("calc orderFieldLocks", err);
        return [];
      }
    },
    orderFieldLock(orderId, lineId, fieldOrExpr) {
      try {
        const locks = collectOrderFieldLocks();
        const field = exprKeyToField(fieldOrExpr);
        return (
          locks.find((item) => item.orderId === orderId && item.lineId === lineId && item.field === field) || null
        );
      } catch (err) {
        console.warn("calc orderFieldLock", err);
        return null;
      }
    },
    focusOrderField(orderId, lineId, fieldOrExpr) {
      try {
        const field = exprKeyToField(fieldOrExpr);
        const owner = orderFieldOwner(orderId, lineId, field);
        if (!owner?.blueprint || !owner.node) return false;
        const calc = ensureState();
        if (!calc) return false;
        calc.active = owner.blueprint.id;
        session.selected = owner.node.id;
        session.selectedLink = "";
        const portId = lineInPortId(lineId, field);
        session.jump = { nodeId: owner.node.id, portId };
        session.pendingFocus = { nodeId: owner.node.id, portId };
        dirty();
        return true;
      } catch (err) {
        console.warn("calc focusOrderField", err);
        return false;
      }
    },
    pruneOrderLinks(orderId, lineId) {
      return pruneOrderCalcLinks(orderId, lineId);
    },
  };
})();
