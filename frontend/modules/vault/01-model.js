/* Хранилище: личный учёт денег пользователя со страницами-копилками. С заказами не связан. */
(function () {
  "use strict";

  let api = null;
  const session = { bound: false, filter: "all", draftType: "in", draftDate: "", chartOpen: false, chartMode: "balance", chartSave: true, zoom: null, zoomPreset: "all", chartYear: "" };
  const CHART_COLORS = { hand: "#0f766e", save: "#eab308", in: "#22c55e", out: "#ef4444" };
  const MONTHS_SHORT = ["янв", "фев", "мар", "апр", "май", "июн", "июл", "авг", "сен", "окт", "ноя", "дек"];

  const TYPES = {
    in: { label: "Пополнение", plural: "Пополнения", hint: "Пополнение — деньги пришли (карманные, зарплата). Плюс к деньгам на руках." },
    out: { label: "Снятие", plural: "Снятия", hint: "Снятие — деньги потрачены. Минус из денег на руках." },
    save: {
      label: "Копилка",
      plural: "Копилка",
      hint: "Копилка — отложили деньги: они уходят с рук в копилку. Сумма с минусом — достали из копилки обратно.",
    },
  };
  const TYPE_KEYS = { in: "Ctrl+Q", out: "Ctrl+W", save: "Ctrl+E" };
  const TYPE_BY_CODE = { KeyQ: "in", KeyW: "out", KeyE: "save" };

  const $ = (id) => document.getElementById(id);

  function esc(value) {
    return String(value ?? "").replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]);
  }

  function uid() {
    return api?.uid ? api.uid() : `v-${Date.now().toString(16)}-${Math.random().toString(16).slice(2)}`;
  }

  function money(n) {
    return api?.money ? api.money(n) : `${Math.round(n * 100) / 100}`;
  }

  function today() {
    const d = new Date();
    const p = (n) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  }

  function parseAmount(raw) {
    const n = Number(String(raw ?? "").replace(/\s+/g, "").replace(",", "."));
    return Number.isFinite(n) ? Math.round(n * 100) / 100 : NaN;
  }

  function dirty() {
    api?.markDirty?.("Хранилище");
  }

  function newPage(name) {
    return { id: uid(), name: name || "Копилка", goal: 0, rows: [] };
  }

  function ensureVault() {
    const doc = api?.doc?.();
    if (!doc) return null;
    if (!doc.ui || typeof doc.ui !== "object") doc.ui = {};
    if (!doc.ui.vault || typeof doc.ui.vault !== "object") doc.ui.vault = { active: "", pages: [] };
    const vault = doc.ui.vault;
    if (!Array.isArray(vault.pages)) vault.pages = [];
    if (!vault.pages.length) {
      vault.pages.push(newPage("Копилка 1"));
      vault.active = vault.pages[0].id;
    }
    vault.pages.forEach((p) => {
      if (!Array.isArray(p.rows)) p.rows = [];
    });
    if (!vault.pages.some((p) => p.id === vault.active)) vault.active = vault.pages[0].id;
    return vault;
  }

  function activePage() {
    const vault = ensureVault();
    return vault ? vault.pages.find((p) => p.id === vault.active) || vault.pages[0] : null;
  }

  /** Влияние строки: на руках и в копилке. */
  function rowEffect(row) {
    const a = Number(row.amount) || 0;
    if (row.type === "in") return { hand: Math.abs(a), save: 0 };
    if (row.type === "out") return { hand: -Math.abs(a), save: 0 };
    return { hand: -a, save: a };
  }

  function pageTotals(page) {
    const t = { inc: 0, out: 0, save: 0, hand: 0 };
    (page?.rows || []).forEach((row) => {
      const a = Number(row.amount) || 0;
      if (row.type === "in") t.inc += Math.abs(a);
      else if (row.type === "out") t.out += Math.abs(a);
      else t.save += a;
    });
    t.hand = t.inc - t.out - t.save;
    Object.keys(t).forEach((k) => (t[k] = Math.round(t[k] * 100) / 100));
    return t;
  }

  function chronological(rows) {
    return rows
      .map((row, index) => ({ row, index }))
      .sort((a, b) => {
        const da = a.row.date || "9999-99-99";
        const db = b.row.date || "9999-99-99";
        if (da !== db) return da < db ? -1 : 1;
        return a.index - b.index;
      })
      .map((x) => x.row);
  }

  /** Остаток на руках и в копилке после каждой строки — по хронологии. */
  function runningBalances(page) {
    const out = new Map();
    let hand = 0;
    let save = 0;
    chronological(page.rows).forEach((row) => {
      const e = rowEffect(row);
      hand += e.hand;
      save += e.save;
      out.set(row.id, { hand: Math.round(hand * 100) / 100, save: Math.round(save * 100) / 100 });
    });
    return out;
  }

  function signOf(row) {
    const a = Number(row.amount) || 0;
    if (row.type === "in") return "+";
    if (row.type === "out") return "−";
    return a < 0 ? "−" : "+";
  }


/* bundle-seam */
})();
