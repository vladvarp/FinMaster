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


/* bundle-seam */
})();
