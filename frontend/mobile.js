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
    clients: [],
    history: { undo: false, redo: false },
    view: "orders",
    orderId: null,
    editLineId: null,
    headOpen: false,
    query: "",
    filter: "all",
    stats: { period: "all", filter: "all", status: "" },
    sort: "date-desc",
    pending: null,
    pushTimer: null,
    pushing: false,
    stopped: false,
    snap: {
      orderId: null,
      lines: null,
      fields: null,
      theme: "teal",
      hideLabels: false,
      hideStamp: false,
      title: "",
      fieldsOpen: false,
    },
    device: null,
    deviceFactsOpen: false,
    waitingForDoc: false,
    exprField: "",
    exprInput: null,
    exprSystemKb: false,
  };

  /* ================= утилиты ================= */

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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

  function typeNames(kind) {
    const list = orderTypes();
    if (kind === "expense") return list.filter((t) => t.is_tax || t.is_cost).map((t) => t.name);
    if (kind === "income") return list.filter((t) => !t.is_tax && !t.is_cost).map((t) => t.name);
    return list.map((t) => t.name);
  }

  function splitLines(lines) {
    const income = [];
    const expense = [];
    (lines || []).forEach((line) => (isExpenseLine(line) ? expense : income).push(line));
    return { income, expense };
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
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
  }

  function fmtDate(v) {
    if (!v) return "—";
    return String(v).replace("T", " ").slice(0, 16);
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
        if (data.changed) applySnapshot(data);
        if (state.version <= before) await sleep(400);
      } catch (err) {
        if (state.stopped) return;
        setSync("err", "нет связи с компьютером");
        await sleep(2000);
      }
    }
  }

  function hasDocument() {
    return !!(state.doc && typeof state.doc === "object");
  }

  function applySnapshot(data, initial = false) {
    if (typeof data.version === "number") state.version = Math.max(state.version, data.version);
    if (typeof data.path === "string") state.path = data.path;
    if (typeof data.dirty === "boolean") state.dirty = data.dirty;
    if (Array.isArray(data.clients)) state.clients = data.clients;
    if (Array.isArray(data.recent)) state.recent = data.recent;
    if (data.library && typeof data.library === "object") state.library = data.library;
    if (data.history && typeof data.history === "object") state.history = data.history;
    updateHead();
    if (!data.document) {
      if (state.doc) state.doc = null;
      state.waitingForDoc = true;
      if (!initial && state.view !== "files") setView("files");
      else if (!initial) renderCurrent();
      return;
    }
    const fresh = typeof data.doc_version === "number" ? data.doc_version > state.docVersion : true;
    if (typeof data.doc_version === "number") state.docVersion = Math.max(state.docVersion, data.doc_version);
    if (!initial && !fresh) return;
    if (!initial && data.origin === state.cid) return;
    if (!initial && (state.pushTimer || state.pushing)) return;
    if (!initial && isTyping()) {
      state.pending = data.document;
      return;
    }
    const wasEmpty = !state.doc;
    state.doc = data.document;
    if (!initial) setSync("ok", "обновлено с компьютера");
    if (wasEmpty && state.waitingForDoc && state.view === "files") {
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

  function navReport() {
    if (state.stopped || !state.token) return;
    const view = state.view;
    const orderId = view === "order" ? state.orderId || "" : "";
    const payload = { view, order_id: orderId, cid: state.cid };
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
    let best = order.created_at || "";
    for (const line of order.lines || []) {
      const d = line.order_date || "";
      if (d > best) best = d;
    }
    return best;
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
    $("btn-back").hidden = state.view !== "order";
    const undo = $("btn-undo");
    const redo = $("btn-redo");
    if (undo) undo.disabled = !state.history.undo;
    if (redo) redo.disabled = !state.history.redo;
  }

  const SCREENS = ["orders", "order", "stats", "snapshot", "files"];

  function setView(view, orderId) {
    const changed = view !== state.view || (orderId !== undefined && orderId !== state.orderId);
    state.view = view;
    if (orderId !== undefined) state.orderId = orderId;
    SCREENS.forEach((v) => {
      $(`screen-${v}`).hidden = v !== view;
    });
    document.querySelectorAll("#tabbar button").forEach((b) => {
      const tab = b.dataset.tab;
      b.classList.toggle("active", tab === view || (view === "order" && tab === "orders"));
    });
    window.scrollTo({ top: 0 });
    renderCurrent();
    if (changed) navReport();
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
    else if (state.view === "snapshot") renderSnapshot();
    else renderFiles();
    if (state.editLineId && !$("editor").hidden) renderEditor();
  }

  /* ================= список заказов ================= */

  function renderChips() {
    const list = orders();
    const counts = {
      all: list.length,
      debt: list.filter((o) => matchesFilter(o, "debt")).length,
      paid: list.filter((o) => matchesFilter(o, "paid")).length,
      month: list.filter((o) => matchesFilter(o, "month")).length,
    };
    const defs = [
      ["all", "Все"],
      ["debt", "С долгом"],
      ["paid", "Оплачены"],
      ["month", "Этот месяц"],
    ];
    $("chips").innerHTML = defs
      .map(
        ([id, label]) =>
          `<button type="button" class="chip ${state.filter === id ? "active" : ""}" data-chip="${id}">${label}<b>${counts[id]}</b></button>`
      )
      .join("");
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
        const dots = (order.lines || [])
          .slice(0, 8)
          .map((l) => `<i class="dot" style="background:${esc(statusMeta(l.status).color)}"></i>`)
          .join("");
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
            <span class="dots">${dots}</span>
          </div>
        </article>`;
      })
      .join("");
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
    return `<article class="line-row" data-edit="${esc(line.id)}" style="--tint:${esc(meta.color)}">
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
    return `<article class="line-row cost-row" data-edit="${esc(line.id)}">
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
    const { income, expense } = splitLines(lines);
    const a = (f) => `data-o="${esc(order.id)}" data-f="${f}"`;

    $("order-top").innerHTML = `
      <div class="ot-line">
        <span class="ot-num">${esc(order.number || "—")}</span>
        <span class="ot-cust">${esc(order.customer || "Без заказчика")}</span>
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
          <div class="field"><label>Создан</label><input type="datetime-local" value="${esc(order.created_at || "")}" ${a("created_at")} /></div>
        </div>
        <div class="field"><label>Заказчик</label><input type="text" list="customers-list" value="${esc(order.customer || "")}" ${a("customer")} /></div>
        <div class="field"><label>Название</label><input type="text" value="${esc(order.name || "")}" ${a("name")} /></div>
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
  }

  function refreshOrderRow(lineId) {
    const order = currentOrder();
    if (!order) return;
    const row = document.querySelector(`.line-row[data-edit="${CSS.escape(lineId)}"]`);
    const { income, expense } = splitLines(order.lines);
    const wasCost = !!row?.classList.contains("cost-row");
    const index = income.findIndex((l) => l.id === lineId);
    const costIndex = expense.findIndex((l) => l.id === lineId);
    const line = index >= 0 ? income[index] : expense[costIndex];
    if (!line) return;
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
  }

  function catalogProductNames() {
    return (state.doc.products || []).map((p) => String(p.name || p || "").trim()).filter(Boolean);
  }

  function edProductSuggestHtml(query) {
    const q = String(query || "").trim().toLocaleLowerCase("ru");
    const items = catalogProductNames().filter((name) => !q || name.toLocaleLowerCase("ru").includes(q));
    if (!items.length) return "";
    return items
      .map((name) => `<button type="button" class="suggest-item" data-pick-product>${esc(name)}</button>`)
      .join("");
  }

  function fillEdProductSuggest(query) {
    const box = $("ed-product-suggest");
    if (box) box.innerHTML = edProductSuggestHtml(query);
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
    $("ed-title").textContent = t.expense
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
        <div class="suggest-inline" id="ed-product-suggest">${edProductSuggestHtml(line.product)}</div>
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
        <div class="field"><label>Дата заказа</label><input type="datetime-local" value="${esc(line.order_date || "")}" ${a("order_date")} /></div>
        <div class="field"><label>Дата оплаты</label><input type="datetime-local" value="${esc(line.payment_date || "")}" ${a("payment_date")} /></div>
      </div>
      <div class="chips inline">
        <button type="button" class="chip" data-now="order_date">Заказ — сейчас</button>
        <button type="button" class="chip" data-now="payment_date">Оплата — сейчас</button>
      </div>`;

    const costOnly = `
      <div class="field"><label>Дата</label><input type="datetime-local" value="${esc(line.order_date || "")}" ${a("order_date")} /></div>
      <div class="chips inline">
        <button type="button" class="chip" data-now="order_date">Сейчас</button>
      </div>
      <div class="hint">Расход вычитается из заказа: скидки, оплаты и статуса у него нет.</div>`;

    $("editor-body").innerHTML = `
      ${t.expense ? `<div class="cost-banner ${esc(t.kind)}">Это расход — ${esc(kindLabel(t.kind))}</div>` : ""}
      ${head}
      ${t.expense ? costOnly : money_}

      <div class="ed-sums" id="ed-sums">${editorSumsHtml(t)}</div>

      <div class="stack">
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
    } else {
      next = value.slice(0, start) + token + value.slice(end);
      pos = start + token.length;
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
    if (!next) return;
    state.editLineId = next.id;
    renderEditor();
    $("editor-body").scrollTop = 0;
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
      return stamp >= `${dayKeyOf(from)}T00:00`;
    }
    if (period === "month") return stamp.startsWith(`${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`);
    if (period === "year") return stamp.startsWith(String(now.getFullYear()));
    return true;
  }

  function statsChip(id, label, count, current, attr) {
    const extra = count == null ? "" : `<b>${count}</b>`;
    return `<button type="button" class="chip ${current === id ? "active" : ""}" ${attr}="${esc(id)}">${label}${extra}</button>`;
  }

  function renderStatsChips(rows, list) {
    if (!$("stats-period") || !$("stats-filter") || !$("stats-status")) return;
    const periodCounts = { all: rows.length };
    ["today", "week", "month", "year"].forEach((id) => {
      periodCounts[id] = rows.filter(({ line }) => matchesStatsPeriod(line.order_date, id)).length;
    });
    $("stats-period").innerHTML = [
      ["all", "Все даты"],
      ["today", "Сегодня"],
      ["week", "7 дней"],
      ["month", "Месяц"],
      ["year", "Год"],
    ]
      .map(([id, label]) => statsChip(id, label, periodCounts[id], state.stats.period, "data-stats-period"))
      .join("");

    const filterCounts = {
      all: list.length,
      debt: list.filter((o) => matchesFilter(o, "debt")).length,
      paid: list.filter((o) => matchesFilter(o, "paid")).length,
    };
    $("stats-filter").innerHTML = [
      ["all", "Все заказы"],
      ["debt", "С долгом"],
      ["paid", "Оплачены"],
    ]
      .map(([id, label]) => statsChip(id, label, filterCounts[id], state.stats.filter, "data-stats-filter"))
      .join("");

    const statuses = state.doc?.statuses || [];
    const statusCounts = { "": rows.length };
    statuses.forEach((s) => {
      statusCounts[s.name] = rows.filter(({ line }) => line.status === s.name).length;
    });
    $("stats-status").innerHTML =
      statsChip("", "Все статусы", statusCounts[""], state.stats.status, "data-stats-status") +
      statuses
        .map((s) => statsChip(s.name, s.name, statusCounts[s.name] || 0, state.stats.status, "data-stats-status"))
        .join("");
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
    return (order?.lines || []).filter((l) => withExpenses || !isExpenseLine(l));
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

      <h3 class="section">Позиции в снимке</h3>
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
        <button type="button" class="btn primary wide" id="snap-share">Поделиться картинкой</button>
        <button type="button" class="btn wide" id="snap-download">Сохранить PNG в телефон</button>
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
    const base = [order?.number ? `zakaz-${order.number}` : "snimok", order?.customer]
      .filter(Boolean)
      .join("-")
      .replace(/[^\wа-яё\-]+/gi, "-")
      .slice(0, 60);
    return `${base || "snimok"}.png`;
  }

  function canvasBlob(canvas) {
    return new Promise((resolve) => canvas.toBlob((b) => resolve(b), "image/png"));
  }

  async function snapShare() {
    try {
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
          <button type="button" class="btn wide" id="cmd-fullscreen">${document.fullscreenElement ? "Выйти из полного экрана" : "Полный экран"}</button>
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
    return `
      <div class="menu-panel">
        <div class="menu-head">
          <div class="menu-title">Меню</div>
          <div class="menu-tools">
            <button type="button" class="menu-sq ${full ? "on" : ""}" data-menu="fullscreen" aria-label="${full ? "Выйти из полного экрана" : "Полный экран"}">
              <b>${full ? "↙" : "⛶"}</b>
            </button>
            <button type="button" class="menu-sq" data-menu="theme" aria-label="${dark ? "Светлая тема" : "Тёмная тема"}">
              <b>${dark ? "☀" : "☾"}</b>
            </button>
          </div>
        </div>
        <button type="button" class="menu-save ${state.dirty ? "dirty" : ""}" data-menu="save">
          <strong>${state.dirty ? "Сохранить изменения" : "Сохранить"}</strong>
          ${state.dirty ? "<small>есть несохранённые правки</small>" : "<small>на компьютере</small>"}
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
  }

  function openMenu() {
    $("sheet-title").hidden = true;
    $("sheet").classList.add("is-on", "is-menu");
    $("sheet").hidden = false;
    $("sheet-list").innerHTML = menuHtml();
    $("sheet")._menu = onMenuAction;
  }

  async function onMenuAction(value) {
    if (value === "theme") {
      toggleTheme();
      renderMenu();
      return;
    }
    if (value === "fullscreen") {
      await toggleFullscreen();
      renderMenu();
      return;
    }
    closeSheet();
    if (value === "save") {
      await push();
      if (await command("save")) toast("Отчёт сохраняется на компьютере");
    } else if (value === "snapshot") setView("snapshot");
    else if (value === "new") await createNewReport();
    else if (value === "link") copyLink();
    else if (value === "device") setView("files");
  }

  function toggleTheme() {
    const next = document.documentElement.getAttribute("data-theme") === "dark" ? "light" : "dark";
    document.documentElement.setAttribute("data-theme", next);
    localStorage.setItem(LS_THEME, next);
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
        if (found?.price != null && num(found.price) > 0) {
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
      if (field === "number" || field === "customer") renderOrderTopOnly(order);
    }
    touchDoc();
    pushSoon();
  }

  function renderOrderTopOnly(order) {
    const top = $("order-top");
    if (!top) return;
    const numEl = top.querySelector(".ot-num");
    const cust = top.querySelector(".ot-cust");
    if (numEl) numEl.textContent = order.number || "—";
    if (cust) cust.textContent = order.customer || "Без заказчика";
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

    document.addEventListener("touchstart", (e) => {
      const input = e.target.closest("#editor-body input.expr-input");
      if (!input || state.exprSystemKb || document.activeElement === input) return;
      input.setAttribute("readonly", "readonly");
    }, true);

    document.addEventListener("focusin", (e) => {
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
      const open = e.target.closest("[data-open]");
      if (open) {
        setView("order", open.dataset.open);
        return;
      }
      const editRow = e.target.closest("[data-edit]");
      if (editRow) {
        openEditor(editRow.dataset.edit);
        return;
      }
      const chip = e.target.closest("[data-chip]");
      if (chip) {
        state.filter = chip.dataset.chip;
        renderOrders();
        return;
      }
      const statsPeriod = e.target.closest("[data-stats-period]");
      if (statsPeriod) {
        state.stats.period = statsPeriod.dataset.statsPeriod;
        renderStats();
        navReport();
        return;
      }
      const statsFilter = e.target.closest("[data-stats-filter]");
      if (statsFilter) {
        state.stats.filter = statsFilter.dataset.statsFilter;
        renderStats();
        navReport();
        return;
      }
      const statsStatus = e.target.closest("[data-stats-status]");
      if (statsStatus) {
        state.stats.status = statsStatus.dataset.statsStatus;
        renderStats();
        navReport();
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
        if (await command("open", { path: openFile.dataset.openFile })) toast("Открываю на компьютере…");
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

    $("editor").addEventListener("click", (e) => {
      if (e.target.closest("[data-close-editor]") || e.target.closest("#ed-done")) {
        closeEditor();
        return;
      }
      const pickProduct = e.target.closest("[data-pick-product]");
      if (pickProduct) {
        const inp = document.querySelector('#editor-body [data-f="product"]');
        if (inp) {
          inp.value = pickProduct.textContent;
          inp.dispatchEvent(new Event("input", { bubbles: true }));
          inp.dispatchEvent(new Event("change", { bubbles: true }));
        }
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
      if (e.target.closest("#ed-dup")) {
        const copy = { ...line, id: uid() };
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
      setView("snapshot");
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

    $("btn-back").addEventListener("click", () => setView("orders"));

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
      if (tab === "files") refreshRecent();
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
  bind();
  boot();
})();
