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
  const DASH_DEFAULT = ["orders", "after", "paid", "unpaid"];
  const FILTER_PORTS = ["orders", "lines", "after", "paid", "unpaid", "cost", "net"];
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
    presentListScroll: 0,
    filterMultiOpen: null,
    filterMultiLock: false,
    filterMultiScroll: 0,
    orderWritePending: false,
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
    const out = [];
    const seen = new Set();
    (Array.isArray(list) ? list : DASH_DEFAULT).forEach((id) => {
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
        "Фильтр",
        DASH_PAY_MULTI.map(([id, label]) => ({ id, label })),
        Array.isArray(node.payFilters) ? node.payFilters : [],
        {
          getValue: (item) => item.id,
          getLabel: (item) => item.label,
          title: "Несколько фильтров оплаты",
        }
      )}
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

  function formulaConflict(node) {
    const names = new Set();
    let error = false;
    for (const port of node.inputs || []) {
      const name = String(port.name || "").trim();
      if (!/^[A-Z]$/.test(name) || names.has(name)) error = true;
      if (name) names.add(name);
    }
    for (const port of node.outputs || []) {
      const name = String(port.name || "").trim();
      if (!/^[A-Z]$/.test(name) || names.has(name)) error = true;
      if (name) names.add(name);
      const raw = String(port.expr || "").includes("=") ? port.expr : `${port.expr || "0"}=${port.name}`;
      const parsed = splitAssign(raw);
      if (parsed.out && parsed.out !== name) error = true;
      try {
        evalExpr(parsed.expr || "0", {});
      } catch {
        error = true;
      }
    }
    return error;
  }

  function computeGraph(bp, stack) {
    const values = {};
    const errors = new Set();
    const nodes = bp.nodes || [];
    const links = bp.links || [];
    if ((stack || []).includes(bp.id)) {
      nodes.forEach((node) => errors.add(node.id));
      return { values, errors };
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
        if (formulaConflict(node)) errors.add(nodeId);
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
          const parsed = splitAssign(String(port.expr || "").includes("=") ? port.expr : `${port.expr || "0"}=${port.name}`);
          const outName = String(port.name || parsed.out || "").trim();
          try {
            const value = evalExpr(parsed.expr || "0", vars);
            setVal(nodeId, port.id, value);
            if (/^[A-Z]$/.test(outName) && value != null && Number.isFinite(value)) {
              vars[outName] = value;
            }
          } catch {
            errors.add(nodeId);
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
    return { values, errors };
  }

  function worldPoint(bp, clientX, clientY) {
    return screenToWorld(clientX, clientY, bp);
  }

  function applyWorld(bp) {
    const world = $("calc-world");
    if (!world || !bp) return;
    world.style.transform = `translate(${bp.x || 0}px, ${bp.y || 0}px) scale(${bp.zoom || 1})`;
  }

  function nodeFootprint(node) {
    const el = findNodeEl(node.id);
    if (el) return { w: Math.max(40, el.offsetWidth), h: Math.max(28, el.offsetHeight) };
    if (node.type === "formula") return { w: 360, h: 160 };
    if (node.type === "order") return { w: 230, h: 140 };
    if (node.type === "scheme") return { w: 220, h: 100 };
    if (node.type === "result") return { w: 376, h: 120 };
    if (node.type === "filter" || node.type === "dashboard") return { w: 384, h: 420 };
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
      present: "#8b5cf6",
      group: "#94a3b8",
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
      node.statuses = [];
      node.orderTypes = [];
      node.products = [];
      node.dateFrom = "";
      node.dateTo = "";
      node.openPorts = DASH_DEFAULT.slice();
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
    bp.nodes = (bp.nodes || []).filter((node) => node.type === "scheme" || node.type === "group" || linked.has(node.id));
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
          <button type="button" class="btn calc-tool" data-add-node="math" draggable="true">Оператор</button>
          <button type="button" class="btn calc-tool" data-add-node="formula" draggable="true">Формула</button>
          <button type="button" class="btn calc-tool" data-add-node="percent" draggable="true">Процент</button>
          <button type="button" class="btn calc-tool" data-add-node="const" draggable="true">Константа</button>
          <button type="button" class="btn calc-tool" data-add-node="filter" draggable="true">Фильтр</button>
          <button type="button" class="btn calc-tool" data-add-node="dashboard" draggable="true">Дашборд</button>
          <button type="button" class="btn calc-tool" data-add-node="result" draggable="true">Результат</button>
          <button type="button" class="btn calc-tool" data-add-node="group" draggable="true">Группа</button>
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
              return `<div class="calc-row both is-${tone}${child}${fieldCls}${locked ? " is-locked" : ""}" title="${esc(tip)}">
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

  function formulaNodeHtml(node, bp, graph) {
    const bad = graph.errors.has(node.id);
    const linked = usedInputPorts(node.id, bp.links);
    return `<article class="calc-node is-formula ${bad ? "is-error" : ""} ${session.selected === node.id ? "is-on" : ""}" data-node="${esc(node.id)}" style="left:${node.x}px;top:${node.y}px">
      <i class="calc-grip" data-drag-node="${esc(node.id)}" title="Перетащить"></i>
      <header class="calc-node-h">
        <span>Формула</span>
        <button type="button" class="calc-x" data-del-node="${esc(node.id)}" title="Удалить">×</button>
      </header>
      <div class="calc-ports">
        <div class="calc-sec">Входы</div>
        ${(node.inputs || [])
          .map(
            (port) => `<div class="calc-row in">
              <i class="calc-port in" data-port="${esc(port.id)}" data-io="in"></i>
              <input class="calc-pname" data-in-name="${esc(port.id)}" value="${esc(port.name)}" maxlength="1" spellcheck="false" title="Одна заглавная латинская буква" />
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
            const expr = String(port.expr || "").includes("=") ? splitAssign(port.expr).expr : port.expr || "";
            return `<div class="calc-row out formula">
              <input class="calc-expr" data-out-expr="${esc(port.id)}" value="${esc(expr)}" spellcheck="false" />
              <span class="calc-eq">=</span>
              <input class="calc-pname" data-out-name="${esc(port.id)}" value="${esc(port.name)}" maxlength="1" spellcheck="false" title="Одна заглавная латинская буква" />
              <b class="calc-out-val">${esc(fmtShort(value))}</b>
              <i class="calc-port out" data-port="${esc(port.id)}" data-io="out"></i>
              <button type="button" class="calc-mini" data-del-out="${esc(port.id)}" title="Убрать выход">−</button>
            </div>`;
          })
          .join("")}
        <button type="button" class="btn small calc-add" data-add-out="1">+ выход</button>
      </div>
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
          name: focus.dataset.inName || focus.dataset.outName || focus.dataset.outExpr || focus.dataset.resultName || focus.dataset.resultPrio || focus.dataset.constValue || focus.dataset.groupName || focus.dataset.filterField,
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
        if (node.type === "scheme") return schemeNodeHtml(node, graph);
        if (node.type === "filter") return filterNodeHtml(node, graph);
        if (node.type === "dashboard") return dashboardNodeHtml(node, bp, graph);
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
        : host.querySelector(`[data-in-name="${cssEsc(keep.name)}"], [data-out-name="${cssEsc(keep.name)}"], [data-out-expr="${cssEsc(keep.name)}"], [data-result-name="${cssEsc(keep.name)}"], [data-result-prio="${cssEsc(keep.name)}"], [data-const-value="${cssEsc(keep.name)}"]`) ||
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
    if (type === "math" || type === "formula" || type === "percent" || type === "const" || type === "result" || type === "scheme" || type === "group" || type === "filter" || type === "dashboard" || type === "present") return type;
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
    if (e.button === 1) {
      e.preventDefault();
      session.busy = true;
      session.pan = { x: e.clientX, y: e.clientY, ox: bp.x || 0, oy: bp.y || 0 };
      $("calc-board").setPointerCapture(e.pointerId);
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
    if (e.target.closest("button")) return;
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
      const item = bp.nodes.find((n) => n.id === session.resize.id && n.type === "group");
      if (!item) return;
      item.w = Math.max(160, Math.round(session.resize.w + (e.clientX - session.resize.dx) / zoom));
      item.h = Math.max(120, Math.round(session.resize.h + (e.clientY - session.resize.dy) / zoom));
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
    if (e.target.closest?.("input, textarea, select, .calc-bp-name, .calc-refresh, .calc-chain-move, .calc-board-tools")) return;
    if (resized) {
      dirty();
      if (bp) drawMinimap(bp);
      return;
    }
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
    else if (kind === "math" || kind === "formula" || kind === "percent" || kind === "const" || kind === "result" || kind === "group" || kind === "filter" || kind === "dashboard") addNode(kind, at);
    else if (blueprintId && blueprintId !== bp.id) addNode("scheme", at, { blueprintId });
    else if (orderId && api.findOrder(orderId)) addNode("order", at, { orderId });
  }

  function formulaNode(id) {
    return (activeBlueprint()?.nodes || []).find((node) => node.id === id && node.type === "formula");
  }

  function bind() {
    if (session.bound) return;
    session.bound = true;
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
        const allowed = new Set(["customers", "orderIds", "payFilters", "orderTypes", "products", "statuses"]);
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
      const orderTypes = e.target.closest("[data-order-types]");
      if (orderTypes && node.type === "order") {
        showOrderTypeMenu(e.clientX, e.clientY, node.id);
      }
    });
    root.addEventListener("input", (e) => {
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
      if (e.target.dataset?.outExpr && node.type === "formula") {
        const port = (node.outputs || []).find((item) => item.id === e.target.dataset.outExpr);
        if (port) port.expr = e.target.value;
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
      const node = nodeEl && bp ? bp.nodes.find((item) => item.id === nodeEl.dataset.node) : null;
      if (!node) return;
      if (e.target.dataset.resultName && node.type === "result") {
        node.name = String(e.target.value || "").trim().slice(0, 48) || "Результат";
        e.target.value = node.name;
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
        const allowed = new Set(["customers", "orderIds", "payFilters", "orderTypes", "products", "statuses"]);
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
        if (port) port.expr = e.target.value;
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
      if (over?.dataset.io === want) over.classList.add("is-hot");
    });
    document.addEventListener("keydown", (e) => {
      if (api?.view?.() !== "calculator") return;
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
        const field =
          fieldOrExpr === "qty_expr"
            ? "qty"
            : fieldOrExpr === "price_expr"
              ? "price"
              : fieldOrExpr === "discount_expr"
                ? "discount"
                : fieldOrExpr === "paid_expr"
                  ? "paid"
                  : fieldOrExpr === "tax_percent_expr"
                    ? "percent"
                    : fieldOrExpr;
        return (
          locks.find((item) => item.orderId === orderId && item.lineId === lineId && item.field === field) || null
        );
      } catch (err) {
        console.warn("calc orderFieldLock", err);
        return null;
      }
    },
    pruneOrderLinks(orderId, lineId) {
      return pruneOrderCalcLinks(orderId, lineId);
    },
  };
})();
