(() => {
  const LS_RECENT = "finmaster.recent";
  const LS_AUTOSAVE = "finmaster.autosave";
  const moneyFmt = new Intl.NumberFormat("ru-RU", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  const state = {
    doc: null,
    path: null,
    dirty: false,
    autosave: false,
    desktop: false,
    view: "dashboard",
    search: "",
    autosaveTimer: null,
    closeAfterSave: false,
    newAfterSave: false,
    selectedCustomerId: null,
    shareOrderId: null,
  };

  const $ = (id) => document.getElementById(id);

  function uid() {
    if (crypto.randomUUID) return crypto.randomUUID();
    return `id-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  }

  function nowLocal() {
    const d = new Date();
    const p = (n) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
  }

  function money(n) {
    const cur = state.doc?.currency || "₽";
    return `${moneyFmt.format(Number(n) || 0)} ${cur}`;
  }

  function num(v) {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
  }

  function round2(n) {
    return Math.round((Number(n) || 0) * 100) / 100;
  }

  function evalExpr(raw) {
    const s = String(raw ?? "")
      .trim()
      .replaceAll("×", "*")
      .replaceAll(",", ".");
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

  function qtyValue(line) {
    return numExpr(line, "qty_expr", "quantity");
  }

  function numExpr(line, exprKey, numKey) {
    const raw = line[exprKey] != null && String(line[exprKey]).trim() !== "" ? line[exprKey] : line[numKey];
    const v = evalExpr(raw);
    return Number.isFinite(v) ? v : num(line[numKey]);
  }

  function lineTotals(line) {
    const qty = qtyValue(line);
    const price = Math.max(0, numExpr(line, "price_expr", "price"));
    const discount = Math.min(100, Math.max(0, numExpr(line, "discount_expr", "discount")));
    const total = round2(qty * price);
    const after = round2(total * (1 - discount / 100));
    const paid = Math.max(0, numExpr(line, "paid_expr", "paid"));
    const unpaid = round2(Math.max(0, after - paid));
    return { total, after, paid, unpaid, discount };
  }

  function paidStatus() {
    const list = state.doc?.statuses || [];
    return list.find((s) => s.is_paid) || list.find((s) => s.id === "paid") || list.find((s) => /оплачен/i.test(s.name || ""));
  }

  function statusLocked(name) {
    return !!(state.doc.statuses || []).find((s) => s.name === name && s.locked);
  }

  function applyPaidIfCovered(line) {
    const ps = paidStatus();
    if (!ps || statusLocked(line.status)) return false;
    const t = lineTotals(line);
    if (t.after > 0 && t.paid + 0.005 >= t.after) {
      if (line.status !== ps.name) {
        line.status = ps.name;
        return true;
      }
    }
    return false;
  }

  function orderTotals(order) {
    return (order.lines || []).reduce(
      (acc, line) => {
        const t = lineTotals(line);
        acc.total += t.total;
        acc.after += t.after;
        acc.paid += t.paid;
        acc.unpaid += t.unpaid;
        return acc;
      },
      { total: 0, after: 0, paid: 0, unpaid: 0 }
    );
  }

  function emptyDoc() {
    return {
      version: 1,
      title: "Новый отчёт",
      created_at: new Date().toISOString(),
      modified_at: new Date().toISOString(),
      currency: "₽",
      statuses: [
        { id: "new", name: "Новый заказ", color: "#0284c7" },
        { id: "in_progress", name: "Выполняется", color: "#2563eb" },
        { id: "waiting", name: "Ожидание", color: "#d97706" },
        { id: "unpaid", name: "Не оплачено", color: "#dc2626" },
        { id: "paid", name: "Оплачено", color: "#059669", is_paid: true },
        { id: "cancelled", name: "Отменено", color: "#64748b" },
        { id: "annulled", name: "Аннулирован", color: "#475569" },
        { id: "blacklist", name: "Черный список", color: "#111827" },
      ],
      units: ["шт.", "м²", "м", "мин"],
      order_types: ["Производство", "Услуга", "Поставка", "Монтаж"],
      products: [],
      customers: [],
      orders: [],
      ui: { sidebar_collapsed: false, column_widths: {}, share_fields: [] },
    };
  }

  function emptyLine() {
    return {
      id: uid(),
      order_type: state.doc.order_types[0] || "",
      product: "",
      quantity: 1,
      qty_expr: "1",
      unit: state.doc.units[0] || "шт.",
      price: 0,
      price_expr: "0",
      discount: 0,
      discount_expr: "0",
      order_date: nowLocal(),
      paid: 0,
      paid_expr: "0",
      payment_date: "",
      status: state.doc.statuses[0]?.name || "Новый заказ",
    };
  }

  function emptyOrder() {
    const n = (state.doc.orders?.length || 0) + 1;
    return {
      id: uid(),
      number: String(n).padStart(4, "0"),
      customer: "",
      name: "",
      notes: "",
      created_at: nowLocal(),
      lines: [emptyLine()],
    };
  }

  async function apiGet(path) {
    const res = await fetch(path);
    if (!res.ok) throw new Error(res.statusText);
    return res.json();
  }

  async function apiPost(path, body) {
    const res = await fetch(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body || {}),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || res.statusText);
    return data;
  }

  async function syncDirty() {
    if (!state.desktop) return;
    try {
      await apiPost("/api/dirty", { dirty: !!state.dirty });
    } catch {
      /* ignore */
    }
  }

  function toast(text) {
    const el = $("toast");
    el.textContent = text;
    el.classList.add("show");
    clearTimeout(el._t);
    el._t = setTimeout(() => el.classList.remove("show"), 2800);
  }

  function localRecent() {
    try {
      return JSON.parse(localStorage.getItem(LS_RECENT) || "[]");
    } catch {
      return [];
    }
  }

  function pushLocalRecent(path, title) {
    const list = localRecent().filter((x) => x.path !== path);
    list.unshift({ path, title, opened_at: new Date().toISOString(), exists: true });
    localStorage.setItem(LS_RECENT, JSON.stringify(list.slice(0, 15)));
  }

  async function removeRecent(path) {
    if (!path) return;
    if (state.desktop) {
      try {
        const res = await apiPost("/api/recent/remove", { path });
        await renderRecent(res.recent || []);
        return;
      } catch {
        toast("Не удалось убрать из списка");
        return;
      }
    }
    localStorage.setItem(LS_RECENT, JSON.stringify(localRecent().filter((x) => x.path !== path)));
    await renderRecent();
  }

  const LS_THEME = "finmaster.theme";

  function currentTheme() {
    return document.documentElement.getAttribute("data-theme") === "dark" ? "dark" : "light";
  }

  function applyTheme(theme, persist) {
    const t = theme === "dark" ? "dark" : "light";
    document.documentElement.setAttribute("data-theme", t);
    try {
      localStorage.setItem(LS_THEME, t);
    } catch {
      /* ignore */
    }
    document.querySelectorAll(".js-theme-toggle").forEach((btn) => {
      btn.setAttribute("aria-pressed", t === "dark" ? "true" : "false");
      btn.textContent = t === "dark" ? "Светлая" : "Тёмная";
      btn.title = t === "dark" ? "Включить светлую тему" : "Включить тёмную тему";
    });
    if (persist && state.desktop) {
      apiPost("/api/theme", { theme: t }).catch(() => {});
    }
    if (state.doc) renderAll();
  }

  function markDirty() {
    if (!state.doc) return;
    state.dirty = true;
    state.doc.modified_at = new Date().toISOString();
    updateChrome();
    syncDirty();
    if (state.autosave) {
      clearTimeout(state.autosaveTimer);
      state.autosaveTimer = setTimeout(() => save({ silent: true }), 800);
    }
  }

  function setClean() {
    state.dirty = false;
    updateChrome();
    syncDirty();
  }

  function updateChrome() {
    const titleEl = $("report-title");
    if (titleEl && document.activeElement !== titleEl) {
      titleEl.value = state.doc?.title || "Отчёт";
    }
    const pathEl = $("file-path");
    if (pathEl) pathEl.textContent = state.path || "Файл ещё не сохранён";
    $("dirty-dot")?.classList.toggle("hidden", !state.dirty);
    const autosaveEl = $("autosave");
    if (autosaveEl) autosaveEl.checked = !!state.autosave;
    document.title = `${state.dirty ? "• " : ""}${state.doc?.title || "FinMaster"} — FinMaster`;
    applySidebar();
  }

  function showApp() {
    $("start-screen").classList.add("hidden");
    $("app-shell").hidden = false;
  }

  function showStart() {
    $("start-screen").classList.remove("hidden");
    $("app-shell").hidden = true;
    renderRecent();
  }

  function allRows() {
    const rows = [];
    for (const order of state.doc.orders || []) {
      for (const line of order.lines || []) {
        rows.push({ order, line, totals: lineTotals(line) });
      }
    }
    return rows;
  }

  function statusMeta(name) {
    return (state.doc.statuses || []).find((s) => s.name === name) || { name, color: "#64748b" };
  }

  function matchesSearch(order, line, q) {
    if (!q) return true;
    const blob = [order.number, order.customer, order.name, order.notes, line?.product, line?.order_type, line?.status]
      .join(" ")
      .toLowerCase();
    return blob.includes(q);
  }

  function filteredOrders() {
    const q = state.search.trim().toLowerCase();
    let orders = [...(state.doc.orders || [])];
    if (q) {
      orders = orders.filter((o) => o.lines.some((l) => matchesSearch(o, l, q)) || matchesSearch(o, {}, q));
    }
    const sort = $("order-sort")?.value || "date-desc";
    const stamp = (o) => o.lines[0]?.order_date || o.created_at || "";
    orders.sort((a, b) => {
      if (sort === "date-asc") return stamp(a).localeCompare(stamp(b));
      if (sort === "number") return String(a.number).localeCompare(String(b.number), "ru", { numeric: true });
      if (sort === "customer") return String(a.customer).localeCompare(String(b.customer), "ru");
      if (sort === "amount-desc") return orderTotals(b).after - orderTotals(a).after;
      return stamp(b).localeCompare(stamp(a));
    });
    return orders;
  }

  function analyticsRows() {
    const q = state.search.trim().toLowerCase();
    const from = $("f-from").value;
    const to = $("f-to").value;
    const dateField = $("f-date-field").value;
    const status = $("f-status").value;
    const type = $("f-type").value;
    const customer = $("f-customer").value.trim().toLowerCase();
    const product = $("f-product").value.trim().toLowerCase();
    const unit = $("f-unit").value;
    const min = $("f-min").value === "" ? null : num($("f-min").value);
    const max = $("f-max").value === "" ? null : num($("f-max").value);
    const unpaidOnly = $("f-unpaid").checked;

    return allRows().filter(({ order, line, totals }) => {
      if (q && !matchesSearch(order, line, q)) return false;
      const dt = line[dateField] || "";
      if (from && dt && dt < from) return false;
      if (to && dt && dt > to) return false;
      if (from && !dt) return false;
      if (status && line.status !== status) return false;
      if (type && line.order_type !== type) return false;
      if (customer && !String(order.customer).toLowerCase().includes(customer)) return false;
      if (product && !String(line.product).toLowerCase().includes(product)) return false;
      if (unit && line.unit !== unit) return false;
      if (min != null && totals.after < min) return false;
      if (max != null && totals.after > max) return false;
      if (unpaidOnly && totals.unpaid <= 0) return false;
      return true;
    });
  }

  function periodStats(from, to, dateField = "order_date") {
    const rows = allRows().filter(({ line }) => {
      const dt = line[dateField] || "";
      if (from && (!dt || dt < from)) return false;
      if (to && (!dt || dt > to)) return false;
      return true;
    });
    return summarize(rows);
  }

  function summarize(rows) {
    const s = { count: rows.length, orders: new Set(), after: 0, paid: 0, unpaid: 0, total: 0 };
    rows.forEach(({ order, totals }) => {
      s.orders.add(order.id);
      s.after += totals.after;
      s.paid += totals.paid;
      s.unpaid += totals.unpaid;
      s.total += totals.total;
    });
    s.orderCount = s.orders.size;
    return s;
  }

  function groupKey(iso, mode) {
    if (!iso) return "без даты";
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso.slice(0, 10);
    const p = (n) => String(n).padStart(2, "0");
    if (mode === "hour") return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:00`;
    if (mode === "month") return `${d.getFullYear()}-${p(d.getMonth() + 1)}`;
    if (mode === "week") {
      const tmp = new Date(d);
      tmp.setDate(d.getDate() - ((d.getDay() + 6) % 7));
      return `нед. ${tmp.getFullYear()}-${p(tmp.getMonth() + 1)}-${p(tmp.getDate())}`;
    }
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  }

  function renderKpis() {
    const rows = allRows();
    const s = summarize(rows);
    const active = rows.filter(({ line }) => !/отмен|аннул|черн/i.test(line.status));
    const as = summarize(active);
    $("kpi-row").innerHTML = `
      <div class="kpi"><div class="label">Заказов</div><div class="value">${s.orderCount}</div><div class="sub">${s.count} позиций</div></div>
      <div class="kpi ok"><div class="label">К оплате (после скидки)</div><div class="value">${money(s.after)}</div><div class="sub">без отмен: ${money(as.after)}</div></div>
      <div class="kpi"><div class="label">Оплачено</div><div class="value">${money(s.paid)}</div><div class="sub">${s.after ? Math.round((s.paid / s.after) * 100) : 0}% от суммы</div></div>
      <div class="kpi warn"><div class="label">Не оплачено</div><div class="value">${money(s.unpaid)}</div><div class="sub">долг по открытым позициям</div></div>
    `;
  }

  function renderDashboard() {
    renderKpis();
    const rows = allRows();
    const byDay = {};
    rows.forEach(({ line, totals }) => {
      const k = groupKey(line.order_date, "day");
      byDay[k] = (byDay[k] || 0) + totals.after;
    });
    const labels = Object.keys(byDay).sort().slice(-14);
    FinCharts.line($("chart-dash-line"), {
      labels,
      datasets: [{ values: labels.map((k) => byDay[k] || 0), color: "#0f766e", fill: "rgba(15,118,110,0.12)" }],
    });
    const byStatus = {};
    rows.forEach(({ line, totals }) => {
      const name = line.status || "Без статуса";
      byStatus[name] = (byStatus[name] || 0) + totals.after;
    });
    FinCharts.doughnut(
      $("chart-dash-pie"),
      Object.entries(byStatus).map(([label, value]) => ({ label, value, color: statusMeta(label).color }))
    );

    const alerts = rows.filter(({ totals, line }) => totals.unpaid > 0 || /черн/i.test(line.status)).slice(0, 8);
    $("alerts").innerHTML = alerts.length
      ? alerts
          .map(({ order, line, totals }) => {
            const msg = /черн/i.test(line.status) ? "чёрный список" : `долг ${money(totals.unpaid)}`;
            return `<div class="alert-row"><span class="pill" style="background:${statusMeta(line.status).color}">${esc(line.status)}</span>
              <div><b>${esc(order.number)}</b> · ${esc(order.name) || "без названия"} · ${esc(line.product) || "без продукта"}</div>
              <div style="margin-left:auto;color:#dc2626">${esc(msg)}</div></div>`;
          })
          .join("")
      : `<div class="empty">Пока нет долгов и стоп-листов — отличный знак.</div>`;

    const last = [...(state.doc.orders || [])].slice(-8).reverse();
    $("recent-orders").innerHTML = last.length
      ? `<table class="data"><thead><tr><th>№</th><th>Заказчик</th><th>Название</th><th>Итог</th></tr></thead><tbody>${last
          .map((o) => `<tr><td>${esc(o.number)}</td><td>${esc(o.customer)}</td><td>${esc(o.name)}</td><td class="num">${esc(money(orderTotals(o).after))}</td></tr>`)
          .join("")}</tbody></table>`
      : `<div class="empty">Заказов ещё нет</div>`;
  }

  const EXPR_MAP = {
    qty_expr: "quantity",
    price_expr: "price",
    discount_expr: "discount",
    paid_expr: "paid",
  };
  const DECIMAL_KEYS = new Set(["qty_expr", "price_expr", "discount_expr"]);

  function commaToDot(inp) {
    if (!DECIMAL_KEYS.has(inp?.dataset?.lk) || !inp.value.includes(",")) return;
    const start = inp.selectionStart;
    const end = inp.selectionEnd;
    inp.value = inp.value.replaceAll(",", ".");
    try {
      if (start != null) inp.setSelectionRange(start, end);
    } catch {
      /* ignore */
    }
  }

  function exprRaw(line, exprKey) {
    const numKey = EXPR_MAP[exprKey];
    const raw = line[exprKey];
    if (raw != null && String(raw).trim() !== "") return String(raw);
    return String(line[numKey] ?? "");
  }

  function formatQty(n) {
    const r = round2(n);
    return Number.isInteger(r) ? String(r) : String(r);
  }

  function isFormula(expr) {
    return /[+\-*/()×xX]/.test(String(expr || ""));
  }

  function shownExpr(line, exprKey) {
    const expr = exprRaw(line, exprKey);
    const v = evalExpr(expr);
    if (isFormula(expr) && Number.isFinite(v)) return formatQty(v);
    return expr;
  }

  function exprInput(line, exprKey, extra = "") {
    const raw = exprRaw(line, exprKey);
    const formula = isFormula(raw);
    return `<input data-lk="${exprKey}" class="expr-field" inputmode="decimal" placeholder="1+2*6" ${extra}
      value="${esc(shownExpr(line, exprKey))}" data-expr="${esc(raw)}" data-showing="${formula ? "result" : "expr"}"
      title="Можно формулу. Клик — правка, вне фокуса — результат." />`;
  }

  function statusColor(name) {
    return statusMeta(name).color || "#64748b";
  }

  function applyRowStatus(tr, statusName) {
    if (!tr) return;
    tr.style.setProperty("--status-color", statusColor(statusName));
  }

  function optionList(values, selected) {
    return values.map((v) => `<option ${v === selected ? "selected" : ""}>${esc(v)}</option>`).join("");
  }

  const ORDER_COLS = [
    ["drag", "", 28],
    ["order_type", "Тип заказа", 130],
    ["product", "Продукт", 150],
    ["qty_expr", "Кол-во", 90],
    ["unit", "Ед.", 72],
    ["price", "Цена", 90],
    ["discount", "Скидка %", 80],
    ["order_date", "Дата заказа", 170],
    ["paid", "Оплачено", 90],
    ["payment_date", "Дата оплаты", 170],
    ["unpaid", "Не оплачено", 110],
    ["total", "Итог", 120],
    ["status", "Статус", 140],
    ["actions", "", 44],
  ];

  function ensureUi() {
    if (!state.doc.ui || typeof state.doc.ui !== "object") state.doc.ui = { sidebar_collapsed: false, column_widths: {} };
    if (!state.doc.ui.column_widths || typeof state.doc.ui.column_widths !== "object") state.doc.ui.column_widths = {};
    if (!Array.isArray(state.doc.ui.share_fields)) state.doc.ui.share_fields = [];
    return state.doc.ui;
  }

  function colWidth(key, fallback) {
    const w = Number(ensureUi().column_widths[key]);
    const min = key === "drag" ? 24 : 52;
    return Math.max(min, Number.isFinite(w) && w > 0 ? w : fallback);
  }

  function colgroupHtml() {
    return `<colgroup>${ORDER_COLS.map(([key, , w]) => `<col data-col="${key}" style="width:${colWidth(key, w)}px">`).join("")}</colgroup>`;
  }

  function orderHeadHtml() {
    return ORDER_COLS.map(([key, label]) => {
      const cal =
        key === "order_date" || key === "payment_date"
          ? `<span class="th-cal" title="Дата всем строкам заказа">
              <input type="datetime-local" data-g="${key}" />
            </span>`
          : "";
      const resize = key === "actions" || key === "drag" ? "" : `<span class="col-resizer" data-col="${key}"></span>`;
      return `<th data-col="${key}"><span class="th-title">${label}</span>${cal}${resize}</th>`;
    }).join("");
  }

  function applySidebar() {
    const shell = $("app-shell");
    if (!shell || !state.doc) return;
    shell.classList.toggle("sidebar-collapsed", !!ensureUi().sidebar_collapsed);
  }

  function customerTenure(c) {
    const dates = [];
    for (const order of state.doc.orders || []) {
      if (order.customer !== c.name) continue;
      if (order.created_at) dates.push(order.created_at);
      for (const line of order.lines || []) {
        if (line.order_date) dates.push(line.order_date);
      }
    }
    if (!dates.length) return "нет заказов";
    dates.sort();
    const first = new Date(dates[0]);
    if (Number.isNaN(first.getTime())) return "нет заказов";
    const days = Math.max(0, Math.floor((Date.now() - first.getTime()) / 86400000));
    const years = Math.floor(days / 365);
    const months = Math.floor((days % 365) / 30);
    const started = first.toLocaleDateString("ru-RU");
    if (years) return `с ${started} · ${years} г. ${months} мес.`;
    if (months) return `с ${started} · ${months} мес.`;
    return `с ${started} · ${days} дн.`;
  }

  function syncCustomersFromOrders() {
    const list = state.doc.customers || (state.doc.customers = []);
    list.forEach((c) => {
      if (!c.id) c.id = uid();
    });
    (state.doc.orders || []).forEach((order) => {
      const name = String(order.customer || "").trim();
      if (!name) return;
      if (!list.some((c) => c.name === name)) {
        list.push({ id: uid(), name, organization: "", phone: "", email: "", address: "", rating: 0 });
      }
    });
  }

  function starRatingHtml(value) {
    const n = Math.max(0, Math.min(5, Math.round(num(value))));
    return `<div class="star-rating" title="${n ? `${n} из 5` : "без оценки"}">${[5, 4, 3, 2, 1]
      .map((i) => `<button type="button" class="star${i <= n ? " on" : ""}" data-star="${i}" aria-label="${i} из 5">★</button>`)
      .join("")}</div>`;
  }

  function renderCustomers() {
    const box = $("customers-panel");
    if (!box || !state.doc) return;
    syncCustomersFromOrders();
    const list = state.doc.customers || [];
    $("customer-list").innerHTML = unique(list.map((c) => c.name)).map((c) => `<option value="${esc(c)}">`).join("");
    if (!list.length) {
      box.innerHTML = `<div class="empty">Нет заказчиков. Нажмите «+ Заказчик» или укажите имя в заказе.</div>`;
      return;
    }
    box.innerHTML = `<table class="data cust-table"><thead><tr>
        <th>Имя</th><th>Организация</th><th>Телефон</th><th>Почта</th><th>Адрес</th><th>Рейтинг</th><th>Совместная работа</th><th>Заказов</th><th></th>
      </tr></thead><tbody>${list
        .map((c) => {
          const n = (state.doc.orders || []).filter((o) => o.customer === c.name).length;
          return `<tr data-cid="${esc(c.id)}">
            <td><input data-cf="name" value="${esc(c.name || "")}" /></td>
            <td><input data-cf="organization" value="${esc(c.organization || "")}" /></td>
            <td><input data-cf="phone" value="${esc(c.phone || "")}" /></td>
            <td><input data-cf="email" value="${esc(c.email || "")}" /></td>
            <td><input data-cf="address" value="${esc(c.address || "")}" /></td>
            <td>${starRatingHtml(c.rating)}</td>
            <td class="meta">${esc(customerTenure(c))}</td>
            <td>${n}</td>
            <td><button class="btn small danger" type="button" data-cact="delcust">Удалить</button></td>
          </tr>`;
        })
        .join("")}</tbody></table>`;
  }

  function renderOrders() {
    const orders = filteredOrders();
    const summary = summarize(orders.flatMap((o) => (o.lines || []).map((line) => ({ order: o, line, totals: lineTotals(line) }))));
    $("orders-summary").innerHTML = `<span>${orders.length} зак. · ${money(summary.after)} · долг ${money(summary.unpaid)}</span>`;
    if (!orders.length) {
      $("orders-list").innerHTML = `<div class="card empty">Нет заказов. Нажмите «+ Заказ», чтобы добавить первый.</div>`;
      return;
    }
    const statusNames = (state.doc.statuses || []).map((s) => s.name);
    const units = state.doc.units || [];
    const types = state.doc.order_types || [];
    $("orders-list").innerHTML = orders
      .map((order) => {
        const tot = orderTotals(order);
        return `<article class="order-card" data-order="${order.id}">
          <div class="order-head">
            <div class="field"><label>Номер заказа</label><input data-k="number" value="${esc(order.number)}" /></div>
            <div class="field"><label>Заказчик</label><input data-k="customer" list="customer-list" value="${esc(order.customer)}" /></div>
            <div class="field"><label>Название заказа</label><input data-k="name" value="${esc(order.name)}" /></div>
            <div class="field" style="align-items:flex-end;flex-direction:row;gap:8px">
              <button class="btn small" data-act="share">Снимок</button>
              <button class="btn small" data-act="dup">Дублировать</button>
              <button class="btn small danger" data-act="del">Удалить</button>
            </div>
          </div>
          <div class="order-globals">
            <div class="field"><label>Тип всем строкам</label>
              <select data-g="order_type"><option value="">— не менять —</option>${optionList(types, "")}</select>
            </div>
            <div class="field"><label>Скидка % всем</label>
              <input data-g="discount" type="number" min="0" max="100" step="0.01" placeholder="%" />
            </div>
            <div class="field"><label>Статус всем строкам</label>
              <select data-g="status"><option value="">— не менять —</option>${optionList(statusNames, "")}</select>
            </div>
            <button class="btn small primary" data-act="payall" title="В каждую строку запишет её итог и при полной оплате поставит статус «оплачено»">Оплатить все типы</button>
          </div>
          <div class="table-wrap">
            <table class="data">
              ${colgroupHtml()}
              <thead>
                <tr>${orderHeadHtml()}</tr>
              </thead>
              <tbody>
                ${(order.lines || [])
                  .map((line) => {
                    const t = lineTotals(line);
                    return `<tr data-line="${line.id}" class="line-row" style="--status-color:${esc(statusColor(line.status))}">
                      <td class="line-drag" title="Перетащить строку"><span></span></td>
                      <td><select data-lk="order_type">${optionList(unique([line.order_type, ...types]), line.order_type)}</select></td>
                      <td><input data-lk="product" list="product-list" value="${esc(line.product)}" /></td>
                      <td class="num">${exprInput(line, "qty_expr")}</td>
                      <td><select data-lk="unit">${optionList(unique([line.unit, ...units]), line.unit)}</select></td>
                      <td class="num">${exprInput(line, "price_expr")}</td>
                      <td class="num">${exprInput(line, "discount_expr")}</td>
                      <td><input data-lk="order_date" type="datetime-local" value="${esc((line.order_date || "").slice(0, 16))}" /></td>
                      <td class="num">${exprInput(line, "paid_expr")}</td>
                      <td><input data-lk="payment_date" type="datetime-local" value="${esc((line.payment_date || "").slice(0, 16))}" /></td>
                      <td class="num computed">${esc(money(t.unpaid))}</td>
                      <td class="num computed">${esc(money(t.after))}<div style="color:#94a3b8;font-weight:500;font-size:11px">до скидки ${esc(money(t.total))}</div></td>
                      <td><select data-lk="status">${optionList(unique([line.status, ...statusNames]), line.status)}</select></td>
                      <td><button class="btn icon small danger" data-act="delline" title="Удалить тип">✕</button></td>
                    </tr>`;
                  })
                  .join("")}
              </tbody>
            </table>
          </div>
          <div class="order-foot">
            <button class="btn small" data-act="addline">+ Тип заказа</button>
            <div class="totals">Итог <b>${esc(money(tot.after))}</b> · оплачено <b>${esc(money(tot.paid))}</b> · не оплачено <b>${esc(money(tot.unpaid))}</b></div>
          </div>
        </article>`;
      })
      .join("");
  }

  function ensureProduct(name) {
    const n = String(name || "").trim();
    if (!n) return;
    const list = state.doc.products || (state.doc.products = []);
    if (!list.some((p) => p === n)) list.push(n);
  }

  function syncProductsFromOrders() {
    const list = state.doc.products || (state.doc.products = []);
    (state.doc.orders || []).forEach((order) => {
      (order.lines || []).forEach((line) => ensureProduct(line.product));
    });
  }

  function renameProduct(oldName, nextName) {
    if (!oldName || oldName === nextName) return;
    (state.doc.orders || []).forEach((order) => {
      (order.lines || []).forEach((line) => {
        if (line.product === oldName) line.product = nextName;
      });
    });
  }

  function orderNewestStamp(order) {
    let best = order.created_at || "";
    for (const line of order.lines || []) {
      const d = line.order_date || "";
      if (d > best) best = d;
    }
    return best;
  }

  function unique(arr) {
    return [...new Set(arr.filter((x) => x != null && String(x).length))];
  }

  function fillFilterSelects() {
    const setSel = (id, values) => {
      const el = $(id);
      const cur = el.value;
      el.innerHTML = `<option value="">Все</option>` + values.map((v) => `<option ${v === cur ? "selected" : ""}>${esc(v)}</option>`).join("");
    };
    setSel("f-status", (state.doc.statuses || []).map((s) => s.name));
    setSel("f-type", state.doc.order_types || []);
    setSel("f-unit", state.doc.units || []);
    $("customer-list").innerHTML = unique((state.doc.orders || []).map((o) => o.customer)).map((c) => `<option value="${esc(c)}">`).join("");
    $("product-list").innerHTML = unique([...(state.doc.products || []), ...allRows().map((r) => r.line.product)]).map((c) => `<option value="${esc(c)}">`).join("");
  }

  function renderAnalytics() {
    fillFilterSelects();
    const rows = analyticsRows();
    const s = summarize(rows);
    const group = $("f-group").value;
    const dateField = $("f-date-field").value;
    const series = {};
    rows.forEach(({ line, totals }) => {
      const k = groupKey(line[dateField], group);
      series[k] = (series[k] || 0) + totals.after;
    });
    const labels = Object.keys(series).sort();
    FinCharts.line($("chart-an-line"), {
      labels,
      datasets: [{ values: labels.map((k) => series[k]), color: "#2563eb", fill: "rgba(37,99,235,0.12)" }],
    });

    const a = periodStats($("c-a-from").value, $("c-a-to").value, dateField);
    const b = periodStats($("c-b-from").value, $("c-b-to").value, dateField);
    $("cmp-a").innerHTML = cmpHtml(a);
    $("cmp-b").innerHTML = cmpHtml(b);
    FinCharts.bar($("chart-an-bar"), {
      labels: ["Выручка", "Оплачено", "Долг", "Позиции"],
      datasets: [
        { values: [a.after, a.paid, a.unpaid, a.count], color: "#0f766e" },
        { values: [b.after, b.paid, b.unpaid, b.count], color: "#c9a227" },
      ],
    });

    $("analytics-table").innerHTML = rows.length
      ? `<table class="data"><thead><tr>
          <th>№</th><th>Заказчик</th><th>Название</th><th>Тип</th><th>Продукт</th><th>Кол-во</th>
          <th>Итог</th><th>Оплачено</th><th>Долг</th><th>Дата</th><th>Статус</th>
        </tr></thead><tbody>${rows
          .map(
            ({ order, line, totals }) => `<tr>
            <td>${esc(order.number)}</td><td>${esc(order.customer)}</td><td>${esc(order.name)}</td>
            <td>${esc(line.order_type)}</td><td>${esc(line.product)}</td>
            <td class="num">${esc(qtyValue(line))} ${esc(line.unit)}</td>
            <td class="num">${esc(money(totals.after))}</td>
            <td class="num">${esc(money(totals.paid))}</td>
            <td class="num">${esc(money(totals.unpaid))}</td>
            <td>${esc((line.order_date || "").replace("T", " "))}</td>
            <td><span class="pill" style="background:${statusMeta(line.status).color}">${esc(line.status)}</span></td>
          </tr>`
          )
          .join("")}</tbody>
          <tfoot><tr>
            <td colspan="5">Итого</td>
            <td class="num">${rows.length} поз.</td>
            <td class="num">${esc(money(s.after))}</td>
            <td class="num">${esc(money(s.paid))}</td>
            <td class="num">${esc(money(s.unpaid))}</td>
            <td colspan="2">${s.orderCount} зак.</td>
          </tr></tfoot>
          </table>
          <p class="hint">Найдено ${rows.length} позиций, ${s.orderCount} заказов, сумма ${money(s.after)}, долг ${money(s.unpaid)}</p>`
      : `<div class="empty">Ничего не найдено — ослабьте фильтры.</div>`;
  }

  function cmpHtml(s) {
    return `<div class="kpis" style="grid-template-columns:1fr 1fr;margin:0">
      <div class="kpi"><div class="label">Выручка</div><div class="value" style="font-size:18px">${money(s.after)}</div></div>
      <div class="kpi"><div class="label">Оплачено</div><div class="value" style="font-size:18px">${money(s.paid)}</div></div>
      <div class="kpi warn"><div class="label">Долг</div><div class="value" style="font-size:18px">${money(s.unpaid)}</div></div>
      <div class="kpi"><div class="label">Позиции / заказы</div><div class="value" style="font-size:18px">${s.count} / ${s.orderCount}</div></div>
    </div>`;
  }

  function renderCatalogs() {
    $("status-list").innerHTML = (state.doc.statuses || [])
      .map(
        (s, i) => `<div class="list-item" data-i="${i}">
        <button type="button" class="item-drag" title="Перетащить"><span></span></button>
        <input type="color" data-ck="color" value="${esc(toHex(s.color))}" />
        <input data-ck="name" value="${esc(s.name)}" />
        <label class="paid-toggle" title="Статус полной оплаты"><input type="radio" name="paid-status-flag" data-ck="is_paid" ${s.is_paid ? "checked" : ""} /> Оплачено</label>
        <button type="button" class="lock-btn ${s.locked ? "on" : ""}" data-cact="lock" title="${s.locked ? "Снять замок" : "Замок: не менять глобальным статусом"}">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <rect x="5" y="11" width="14" height="10" rx="2" stroke="currentColor" stroke-width="1.8"/>
            <path d="${s.locked ? "M8 11V8a4 4 0 0 1 8 0v3" : "M8 11V8a4 4 0 0 1 7.5-2"}" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
          </svg>
        </button>
        <button class="btn small danger" data-cact="del">Удалить</button>
      </div>`
      )
      .join("");
    $("unit-list").innerHTML = (state.doc.units || [])
      .map((u, i) => `<div class="list-item" data-i="${i}"><button type="button" class="item-drag" title="Перетащить"><span></span></button><input data-uk value="${esc(u)}" /><button class="btn small danger" data-uact="del">Удалить</button></div>`)
      .join("");
    $("type-list").innerHTML = (state.doc.order_types || [])
      .map((u, i) => `<div class="list-item" data-i="${i}"><button type="button" class="item-drag" title="Перетащить"><span></span></button><input data-tk value="${esc(u)}" /><button class="btn small danger" data-tact="del">Удалить</button></div>`)
      .join("");
    syncProductsFromOrders();
    $("product-catalog").innerHTML = (state.doc.products || [])
      .map((u, i) => `<div class="list-item" data-i="${i}"><button type="button" class="item-drag" title="Перетащить"><span></span></button><input data-pk value="${esc(u)}" /><button class="btn small danger" data-pact="del">Удалить</button></div>`)
      .join("");
  }

  function toHex(color) {
    if (!color) return "#64748b";
    if (color.startsWith("#") && color.length === 7) return color;
    return "#64748b";
  }

  function renderAll() {
    if (!state.doc) return;
    updateChrome();
    fillFilterSelects();
    if (state.view === "dashboard") renderDashboard();
    if (state.view === "orders") renderOrders();
    if (state.view === "analytics") renderAnalytics();
    if (state.view === "catalogs") renderCatalogs();
    if (state.view === "customers") renderCustomers();
    else {
      syncCustomersFromOrders();
      const list = state.doc.customers || [];
      $("customer-list").innerHTML = unique(list.map((c) => c.name)).map((c) => `<option value="${esc(c)}">`).join("");
    }
    applySidebar();
  }

  function findOrder(id) {
    return state.doc.orders.find((o) => o.id === id);
  }

  function setView(name) {
    state.view = name;
    document.querySelectorAll(".nav button").forEach((b) => b.classList.toggle("active", b.dataset.view === name));
    document.querySelectorAll(".view").forEach((v) => v.classList.toggle("active", v.id === `view-${name}`));
    if (name === "analytics" && !$("c-a-from").value && !$("c-b-from").value) {
      const now = new Date();
      const monthStart = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0);
      const prevStart = new Date(now.getFullYear(), now.getMonth() - 1, 1, 0, 0);
      const prevEnd = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0);
      prevEnd.setMinutes(prevEnd.getMinutes() - 1);
      setDT("c-b-from", prevStart);
      setDT("c-b-to", prevEnd);
      setDT("c-a-from", monthStart);
      setDT("c-a-to", now);
    }
    renderAll();
  }

  function createNew() {
    state.doc = emptyDoc();
    state.path = null;
    setClean();
    showApp();
    setView("orders");
  }

  async function openFromDialog() {
    if (state.desktop) {
      try {
        const res = await apiPost("/api/dialog/open", {});
        if (res.cancelled) return;
        applyLoaded(res);
        return;
      } catch (err) {
        toast(String(err.message || err));
        $("file-input").click();
        return;
      }
    }
    $("file-input").click();
  }

  function applyLoaded(res) {
    state.doc = res.document;
    state.path = res.path;
    if (res.recent) renderRecent(res.recent);
    else if (res.path) pushLocalRecent(res.path, res.document.title);
    setClean();
    showApp();
    setView("dashboard");
    toast("Отчёт открыт");
  }

  async function openPath(path) {
    if (state.desktop) {
      try {
        applyLoaded(await apiPost("/api/open-path", { path }));
      } catch (err) {
        toast("Не удалось открыть файл. Возможно, он перемещён.");
      }
      return;
    }
    toast("В браузерном режиме откройте файл через кнопку «Открыть».");
  }

  async function save({ as = false, silent = false } = {}) {
    if (!state.doc) return false;
    try {
      if (state.desktop) {
        let path = state.path;
        if (as || !path) {
          if (silent && !path) {
            if (!save._warned) {
              toast("Включили автосохранение — сначала сохраните файл вручную.");
              save._warned = true;
            }
            return false;
          }
          const picked = await apiPost("/api/dialog/save", { suggested: `${state.doc.title || "Отчёт"}.fmaster` });
          if (picked.cancelled || !picked.path) return false;
          path = picked.path;
        }
        const res = await apiPost("/api/write", { path, document: state.doc });
        state.doc = res.document;
        state.path = res.path;
        if (res.recent) renderRecent(res.recent);
        setClean();
        if (!silent) toast("Отчёт сохранён");
        return true;
      }

      const payload = JSON.stringify(state.doc, null, 2);
      if (as || !state.path) {
        downloadFile(`${state.doc.title || "Отчёт"}.fmaster`, payload);
        state.path = `${state.doc.title || "Отчёт"}.fmaster`;
        pushLocalRecent(state.path, state.doc.title);
        setClean();
        toast("Файл скачан. В отдельном окне FinMaster сохраняет напрямую на диск.");
        return true;
      }
      downloadFile(state.path, payload);
      setClean();
      if (!silent) toast("Файл скачан");
      return true;
    } catch (err) {
      toast(`Ошибка сохранения: ${err.message || err}`);
      return false;
    }
  }

  function downloadFile(name, text) {
    const blob = new Blob([text], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = name;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  async function exportCsv() {
    const rows = allRows();
    const head = ["Номер", "Заказчик", "Название", "Тип", "Продукт", "Количество", "Ед", "Цена", "Скидка%", "Итог", "Оплачено", "Не оплачено", "Дата заказа", "Дата оплаты", "Статус"];
    const lines = [head.join(";")];
    rows.forEach(({ order, line, totals }) => {
      const vals = [
        order.number,
        order.customer,
        order.name,
        line.order_type,
        line.product,
        line.quantity,
        line.unit,
        totals.total,
        line.discount,
        totals.after,
        totals.paid,
        totals.unpaid,
        line.order_date,
        line.payment_date,
        line.status,
      ].map((v) => `"${String(v ?? "").replaceAll('"', '""')}"`);
      lines.push(vals.join(";"));
    });
    const csv = "\ufeff" + lines.join("\n");
    if (state.desktop) {
      try {
        const picked = await apiPost("/api/dialog/export", { suggested: `${state.doc.title || "Экспорт"}.csv` });
        if (picked.cancelled || !picked.path) return;
        await apiPost("/api/write-text", { path: picked.path, content: csv });
        toast("CSV сохранён");
        return;
      } catch (err) {
        toast(String(err.message || err));
      }
    }
    downloadFile(`${state.doc.title || "Экспорт"}.csv`, csv);
  }

  async function renderRecent(list) {
    let items = list;
    if (!items) {
      if (state.desktop) {
        try {
          const boot = await apiGet("/api/bootstrap");
          items = boot.recent || [];
          state.autosave = !!boot.autosave;
        } catch {
          items = [];
        }
      } else {
        items = localRecent();
      }
    }
    const box = $("recent-list");
    if (!items.length) {
      box.innerHTML = `<div class="recent-item missing"><div>Пока нет недавних отчётов</div></div>`;
      return;
    }
    box.innerHTML = items
      .map((item) => {
        const missing = item.exists === false;
        const date = (item.opened_at || "").replace("T", " ").slice(0, 19);
        return `<div class="recent-item ${missing ? "missing" : ""}" data-path="${esc(item.path)}">
          <div><b>${esc(item.title || item.path)}</b><div class="meta">${esc(item.path)}</div></div>
          <div class="recent-side">
            <div class="meta">${missing ? "файл не найден" : esc(date)}</div>
            <button type="button" class="recent-remove" data-recent-remove title="Убрать из списка">✕</button>
          </div>
        </div>`;
      })
      .join("");
  }

  function askClose() {
    $("close-modal").classList.add("open");
  }

  window.__finmasterIsDirty = () => !!state.dirty;
  window.__finmasterCanClose = () => !state.dirty;
  window.__finmasterAskClose = () => {
    askClose();
    return false;
  };

  function esc(v) {
    return String(v ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#39;");
  }

  function bindSortable(container, { handle, item, onCommit }) {
    if (!container) return;
    container.addEventListener("pointerdown", (e) => {
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
    });
  }

  function reorderByDom(arr, nodes, attr = "i") {
    return [...nodes]
      .map((el) => arr[Number(el.dataset[attr])])
      .filter((x) => x !== undefined);
  }

  function bind() {
    applyTheme(localStorage.getItem(LS_THEME) || currentTheme(), false);
    $("nav").addEventListener("click", (e) => {
      const btn = e.target.closest("button[data-view]");
      if (btn) setView(btn.dataset.view);
    });
    $("global-search").addEventListener("input", (e) => {
      state.search = e.target.value;
      renderAll();
    });
    $("report-title").addEventListener("input", (e) => {
      if (!state.doc) return;
      state.doc.title = e.target.value;
      markDirty();
    });
    $("btn-add-order").addEventListener("click", () => {
      state.doc.orders.push(emptyOrder());
      markDirty();
      setView("orders");
    });
    $("btn-share-many").addEventListener("click", () => openShare(null));
    $("order-sort").addEventListener("change", () => renderOrders());
    $("autosave").addEventListener("change", async (e) => {
      state.autosave = e.target.checked;
      if (state.desktop) {
        try {
          await apiPost("/api/autosave", { enabled: state.autosave });
        } catch {
          /* ignore */
        }
      } else {
        localStorage.setItem(LS_AUTOSAVE, String(state.autosave));
      }
      if (state.autosave) save({ silent: true });
      toast(state.autosave ? "Автосохранение включено" : "Автосохранение выключено");
    });

    $("orders-list").addEventListener("input", onOrderInput);
    $("orders-list").addEventListener("change", onOrderInput);
    $("orders-list").addEventListener("click", onOrderClick);
    $("orders-list").addEventListener("focusin", onExprFocus);
    $("orders-list").addEventListener("focusout", onExprBlur);
    bindSortable($("orders-list"), {
      handle: ".line-drag",
      item: "tr[data-line]",
      onCommit: (tr) => {
        const card = tr.closest("[data-order]");
        const order = findOrder(card?.dataset.order);
        if (!order) return;
        const ids = [...card.querySelectorAll("tr[data-line]")].map((r) => r.dataset.line);
        order.lines = ids.map((id) => order.lines.find((l) => l.id === id)).filter(Boolean);
        markDirty();
      },
    });
    bindSortable($("status-list"), {
      handle: ".item-drag",
      item: ".list-item",
      onCommit: (row) => {
        const next = reorderByDom(state.doc.statuses, row.parentNode.querySelectorAll(".list-item"));
        if (next.length === (state.doc.statuses || []).length) state.doc.statuses = next;
        markDirty();
        renderCatalogs();
      },
    });
    bindSortable($("unit-list"), {
      handle: ".item-drag",
      item: ".list-item",
      onCommit: () => {
        const list = $("unit-list");
        const next = reorderByDom(state.doc.units, list.querySelectorAll(".list-item"));
        if (next.length === (state.doc.units || []).length) state.doc.units = next;
        markDirty();
        renderCatalogs();
      },
    });
    bindSortable($("type-list"), {
      handle: ".item-drag",
      item: ".list-item",
      onCommit: () => {
        const list = $("type-list");
        const next = reorderByDom(state.doc.order_types, list.querySelectorAll(".list-item"));
        if (next.length === (state.doc.order_types || []).length) state.doc.order_types = next;
        markDirty();
        renderCatalogs();
      },
    });
    bindSortable($("product-catalog"), {
      handle: ".item-drag",
      item: ".list-item",
      onCommit: () => {
        const list = $("product-catalog");
        const next = reorderByDom(state.doc.products, list.querySelectorAll(".list-item"));
        if (next.length === (state.doc.products || []).length) state.doc.products = next;
        markDirty();
        renderCatalogs();
      },
    });

    $("status-list").addEventListener("input", (e) => {
      const row = e.target.closest(".list-item");
      if (!row) return;
      const i = Number(row.dataset.i);
      const s = state.doc.statuses[i];
      if (e.target.dataset.ck === "name") s.name = e.target.value;
      if (e.target.dataset.ck === "color") s.color = e.target.value;
      markDirty();
    });
    $("status-list").addEventListener("change", (e) => {
      if (e.target.dataset.ck !== "is_paid") return;
      const i = Number(e.target.closest(".list-item").dataset.i);
      (state.doc.statuses || []).forEach((st, idx) => {
        st.is_paid = idx === i;
      });
      markDirty();
      renderCatalogs();
    });
    $("status-list").addEventListener("click", (e) => {
      const lockBtn = e.target.closest("[data-cact='lock']");
      if (lockBtn) {
        const i = Number(lockBtn.closest(".list-item").dataset.i);
        const s = state.doc.statuses[i];
        if (s) s.locked = !s.locked;
        markDirty();
        renderCatalogs();
        return;
      }
      if (e.target.closest("[data-cact='del']")) {
        const i = Number(e.target.closest(".list-item").dataset.i);
        state.doc.statuses.splice(i, 1);
        markDirty();
        renderCatalogs();
      }
    });
    $("btn-add-status").addEventListener("click", () => {
      state.doc.statuses.push({ id: uid(), name: "Новый статус", color: "#64748b", is_paid: false, locked: false });
      markDirty();
      renderCatalogs();
    });
    $("unit-list").addEventListener("input", (e) => {
      const i = Number(e.target.closest(".list-item").dataset.i);
      if (e.target.hasAttribute("data-uk")) state.doc.units[i] = e.target.value;
      markDirty();
    });
    $("unit-list").addEventListener("click", (e) => {
      if (e.target.dataset.uact === "del") {
        state.doc.units.splice(Number(e.target.closest(".list-item").dataset.i), 1);
        markDirty();
        renderCatalogs();
      }
    });
    $("btn-add-unit").addEventListener("click", () => {
      state.doc.units.push("ед.");
      markDirty();
      renderCatalogs();
    });
    $("type-list").addEventListener("input", (e) => {
      const i = Number(e.target.closest(".list-item").dataset.i);
      if (e.target.hasAttribute("data-tk")) state.doc.order_types[i] = e.target.value;
      markDirty();
    });
    $("type-list").addEventListener("click", (e) => {
      if (e.target.dataset.tact === "del") {
        state.doc.order_types.splice(Number(e.target.closest(".list-item").dataset.i), 1);
        markDirty();
        renderCatalogs();
      }
    });
    $("btn-add-type").addEventListener("click", () => {
      state.doc.order_types.push("Новый тип");
      markDirty();
      renderCatalogs();
    });
    $("product-catalog").addEventListener("focusin", (e) => {
      if (e.target.hasAttribute("data-pk")) e.target.dataset.old = e.target.value;
    });
    $("product-catalog").addEventListener("input", (e) => {
      const i = Number(e.target.closest(".list-item").dataset.i);
      if (!e.target.hasAttribute("data-pk")) return;
      const old = e.target.dataset.old || "";
      const val = e.target.value;
      state.doc.products[i] = val;
      renameProduct(old, val);
      e.target.dataset.old = val;
      markDirty();
    });
    $("product-catalog").addEventListener("click", (e) => {
      if (e.target.closest("[data-pact='del']")) {
        state.doc.products.splice(Number(e.target.closest(".list-item").dataset.i), 1);
        markDirty();
        renderCatalogs();
      }
    });
    $("btn-add-product").addEventListener("click", () => {
      (state.doc.products || (state.doc.products = [])).push("Новый продукт");
      markDirty();
      renderCatalogs();
    });
    $("customers-panel").addEventListener("input", (e) => {
      const card = e.target.closest("[data-cid]");
      const cf = e.target.dataset.cf;
      if (!card || !cf) return;
      const c = (state.doc.customers || []).find((x) => x.id === card.dataset.cid);
      if (!c) return;
      if (cf === "name") {
        const old = c.name;
        c.name = e.target.value;
        if (old && old !== c.name) {
          (state.doc.orders || []).forEach((o) => {
            if (o.customer === old) o.customer = c.name;
          });
        }
      } else {
        c[cf] = e.target.value;
      }
      markDirty();
    });
    $("customers-panel").addEventListener("click", (e) => {
      const star = e.target.closest("[data-star]");
      if (star) {
        const row = star.closest("[data-cid]");
        const c = (state.doc.customers || []).find((x) => x.id === row?.dataset.cid);
        if (!c) return;
        const v = Number(star.dataset.star);
        c.rating = c.rating === v ? 0 : v;
        markDirty();
        renderCustomers();
        return;
      }
      const btn = e.target.closest("[data-cact='delcust']");
      if (!btn) return;
      const row = btn.closest("[data-cid]");
      if (!row) return;
      if (!confirm("Удалить заказчика из справочника? Заказы не удаляются.")) return;
      state.doc.customers = (state.doc.customers || []).filter((x) => x.id !== row.dataset.cid);
      markDirty();
      renderCustomers();
    });
    $("btn-add-customer").addEventListener("click", () => {
      const c = { id: uid(), name: "Новый заказчик", organization: "", phone: "", email: "", address: "", rating: 0 };
      (state.doc.customers || (state.doc.customers = [])).push(c);
      state.selectedCustomerId = c.id;
      markDirty();
      renderCustomers();
    });
    $("btn-toggle-sidebar").addEventListener("click", () => {
      ensureUi().sidebar_collapsed = !ensureUi().sidebar_collapsed;
      applySidebar();
      markDirty();
    });
    $("orders-list").addEventListener("mousedown", (e) => {
      const handle = e.target.closest(".col-resizer");
      if (!handle) return;
      e.preventDefault();
      const key = handle.dataset.col;
      const startX = e.clientX;
      const startW = colWidth(key, 100);
      handle.classList.add("dragging");
      const move = (ev) => {
        const w = Math.max(52, startW + ev.clientX - startX);
        ensureUi().column_widths[key] = w;
        document.querySelectorAll(`col[data-col="${key}"]`).forEach((col) => {
          col.style.width = `${w}px`;
        });
      };
      const up = () => {
        handle.classList.remove("dragging");
        document.removeEventListener("mousemove", move);
        document.removeEventListener("mouseup", up);
        markDirty();
      };
      document.addEventListener("mousemove", move);
      document.addEventListener("mouseup", up);
    });

    ["f-from", "f-to", "f-date-field", "f-group", "f-status", "f-type", "f-customer", "f-product", "f-unit", "f-min", "f-max", "f-unpaid", "c-a-from", "c-a-to", "c-b-from", "c-b-to"].forEach(
      (id) => {
        $(id).addEventListener("input", () => state.view === "analytics" && renderAnalytics());
        $(id).addEventListener("change", () => state.view === "analytics" && renderAnalytics());
      }
    );
    $("btn-filters-reset").addEventListener("click", () => {
      ["f-from", "f-to", "f-customer", "f-product", "f-min", "f-max", "c-a-from", "c-a-to", "c-b-from", "c-b-to"].forEach((id) => ($(id).value = ""));
      $("f-status").value = "";
      $("f-type").value = "";
      $("f-unit").value = "";
      $("f-unpaid").checked = false;
      renderAnalytics();
    });
    $("btn-preset-today").addEventListener("click", () => {
      const d = new Date();
      setDT("f-from", new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0));
      setDT("f-to", new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59));
      renderAnalytics();
    });
    $("btn-preset-week").addEventListener("click", () => {
      const d = new Date();
      const from = new Date(d.getTime() - 7 * 86400000);
      from.setHours(0, 0, 0, 0);
      setDT("f-from", from);
      setDT("f-to", d);
      renderAnalytics();
    });
    $("btn-preset-month").addEventListener("click", () => {
      const d = new Date();
      setDT("f-from", new Date(d.getFullYear(), d.getMonth(), 1, 0, 0));
      setDT("f-to", d);
      renderAnalytics();
    });
    $("btn-preset-year").addEventListener("click", () => {
      const d = new Date();
      setDT("f-from", new Date(d.getFullYear(), 0, 1, 0, 0));
      setDT("f-to", d);
      renderAnalytics();
    });

    $("btn-save").addEventListener("click", () => save());
    $("btn-save-as").addEventListener("click", () => save({ as: true }));
    $("btn-open").addEventListener("click", () => maybeOpen(openFromDialog));
    $("btn-new").addEventListener("click", onNew);
    $("btn-home").addEventListener("click", () => {
      if (state.dirty) {
        state._home = true;
        askClose();
        return;
      }
      showStart();
    });
    $("btn-export").addEventListener("click", exportCsv);
    $("share-cancel").addEventListener("click", () => $("share-modal").classList.remove("open"));
    $("share-fields").addEventListener("change", () => {
      ensureUi().share_fields = currentShareFields();
      markDirty();
      renderSharePreview();
    });
    $("share-title").addEventListener("input", renderSharePreview);
    $("share-hide-labels").addEventListener("change", renderSharePreview);
    $("share-hide-stamp").addEventListener("change", renderSharePreview);
    $("share-orders").addEventListener("click", (e) => {
      const tog = e.target.closest("[data-share-toggle]");
      if (!tog) return;
      const block = tog.closest(".share-order");
      if (!block) return;
      const open = block.classList.toggle("collapsed") === false;
      tog.setAttribute("aria-expanded", open ? "true" : "false");
      tog.textContent = open ? "▾" : "▸";
    });
    $("share-orders").addEventListener("change", (e) => {
      const block = e.target.closest(".share-order");
      if (block && e.target.hasAttribute("data-share-order")) {
        block.querySelectorAll("[data-share-line]").forEach((el) => {
          el.checked = e.target.checked;
        });
        if (e.target.checked) {
          block.classList.remove("collapsed");
          const tog = block.querySelector("[data-share-toggle]");
          if (tog) {
            tog.setAttribute("aria-expanded", "true");
            tog.textContent = "▾";
          }
        }
      }
      if (block && e.target.hasAttribute("data-share-line")) {
        const any = [...block.querySelectorAll("[data-share-line]")].some((el) => el.checked);
        const orderCb = block.querySelector("[data-share-order]");
        if (orderCb) orderCb.checked = any;
      }
      renderSharePreview();
    });
    document.querySelectorAll("[data-share-preset]").forEach((btn) => {
      btn.addEventListener("click", () => applySharePreset(btn.dataset.sharePreset));
    });
    $("share-copy").addEventListener("click", copySharePng);
    $("share-save").addEventListener("click", saveSharePng);
    $("recent-list").addEventListener("click", async (e) => {
      const rm = e.target.closest("[data-recent-remove]");
      if (rm) {
        e.preventDefault();
        e.stopPropagation();
        const row = rm.closest(".recent-item");
        if (row?.dataset.path) await removeRecent(row.dataset.path);
        return;
      }
      const item = e.target.closest(".recent-item");
      if (!item || item.classList.contains("missing")) return;
      openPath(item.dataset.path);
    });
    document.querySelectorAll(".js-theme-toggle").forEach((btn) => {
      btn.addEventListener("click", () => applyTheme(currentTheme() === "dark" ? "light" : "dark", true));
    });
    $("file-input").addEventListener("change", async (e) => {
      const file = e.target.files[0];
      e.target.value = "";
      if (!file) return;
      try {
        const text = await file.text();
        state.doc = JSON.parse(text);
        state.path = file.name;
        pushLocalRecent(file.name, state.doc.title);
        setClean();
        showApp();
        setView("dashboard");
        toast("Отчёт открыт");
      } catch {
        toast("Не удалось прочитать файл отчёта");
      }
    });

    $("close-cancel").addEventListener("click", () => {
      state.closeAfterSave = false;
      state._home = false;
      $("close-modal").classList.remove("open");
    });
    $("close-discard").addEventListener("click", async () => {
      $("close-modal").classList.remove("open");
      state.dirty = false;
      if (state._home) {
        state._home = false;
        showStart();
        return;
      }
      if (state.desktop) {
        try {
          await apiPost("/api/quit", {});
        } catch {
          window.close();
        }
      } else {
        window.close();
      }
    });
    $("close-save").addEventListener("click", async () => {
      const ok = await save();
      if (!ok) return;
      $("close-modal").classList.remove("open");
      if (state._home) {
        state._home = false;
        showStart();
        return;
      }
      if (state.newAfterSave) {
        state.newAfterSave = false;
        await createNew();
        return;
      }
      if (state.desktop) await apiPost("/api/quit", {});
      else window.close();
    });

    $("new-cancel").addEventListener("click", () => $("new-modal").classList.remove("open"));
    $("new-discard").addEventListener("click", async () => {
      $("new-modal").classList.remove("open");
      await createNew();
    });
    $("new-save").addEventListener("click", async () => {
      $("new-modal").classList.remove("open");
      const ok = await save();
      if (ok) await createNew();
    });

    document.addEventListener("keydown", (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        save({ as: e.shiftKey });
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "o") {
        e.preventDefault();
        maybeOpen(openFromDialog);
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "n") {
        e.preventDefault();
        onNew();
      }
    });

    window.addEventListener("resize", () => {
      if (state.doc && (state.view === "dashboard" || state.view === "analytics")) renderAll();
    });
  }

  function setDT(id, date) {
    const p = (n) => String(n).padStart(2, "0");
    $(id).value = `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())}T${p(date.getHours())}:${p(date.getMinutes())}`;
  }

  function onNew() {
    if (state.dirty) $("new-modal").classList.add("open");
    else createNew();
  }

  async function maybeOpen(fn) {
    if (state.dirty) {
      const ok = confirm("Есть несохранённые изменения. Открыть другой файл без сохранения текущих?");
      if (!ok) return;
    }
    await fn();
  }

  function onOrderInput(e) {
    const card = e.target.closest("[data-order]");
    if (!card) return;
    const order = findOrder(card.dataset.order);
    if (!order) return;
    if (e.target.dataset.g) {
      const g = e.target.dataset.g;
      if (g === "discount") {
        const v = Math.min(100, Math.max(0, num(e.target.value)));
        (order.lines || []).forEach((line) => {
          line.discount = v;
          line.discount_expr = String(v);
          applyPaidIfCovered(line);
        });
        markDirty();
        if (e.type !== "change") {
          card.querySelectorAll("[data-line]").forEach((tr) => {
            const line = order.lines.find((l) => l.id === tr.dataset.line);
            if (line) refreshComputed(card, tr, order, line);
          });
          return;
        }
      } else if (g === "status" || g === "order_type") {
        if (!e.target.value) return;
        (order.lines || []).forEach((line) => {
          if (g === "status" && statusLocked(line.status)) return;
          line[g] = e.target.value;
        });
        markDirty();
      } else if (g === "order_date" || g === "payment_date") {
        if (e.type !== "change" || !e.target.value) return;
        (order.lines || []).forEach((line) => {
          line[g] = e.target.value;
        });
        markDirty();
      }
      renderOrders();
      return;
    }
    if (e.target.dataset.k) {
      order[e.target.dataset.k] = e.target.value;
      if (e.target.dataset.k === "name" && !state.path) state.doc.title = e.target.value || state.doc.title;
      if (e.target.dataset.k === "customer") {
        syncCustomersFromOrders();
        const list = state.doc.customers || [];
        $("customer-list").innerHTML = unique(list.map((c) => c.name)).map((c) => `<option value="${esc(c)}">`).join("");
      }
      markDirty();
      return;
    }
    const tr = e.target.closest("[data-line]");
    if (!tr) return;
    const line = order.lines.find((l) => l.id === tr.dataset.line);
    if (!line || !e.target.dataset.lk) return;
    const key = e.target.dataset.lk;
    if (EXPR_MAP[key]) {
      if (e.target.dataset.showing === "result") return;
      commaToDot(e.target);
      line[key] = e.target.value;
      const v = evalExpr(e.target.value);
      e.target.dataset.expr = e.target.value;
      e.target.classList.toggle("invalid", e.target.value.trim() !== "" && !Number.isFinite(v));
      if (Number.isFinite(v)) {
        const numKey = EXPR_MAP[key];
        let n = round2(v);
        if (numKey === "discount") n = Math.min(100, Math.max(0, n));
        if (numKey === "price" || numKey === "paid") n = Math.max(0, n);
        line[numKey] = n;
      }
    } else {
      line[key] = e.target.type === "number" ? num(e.target.value) : e.target.value;
      if (key === "product") ensureProduct(line.product);
    }
    applyPaidIfCovered(line);
    applyRowStatus(tr, line.status);
    const statusSel = tr.querySelector('[data-lk="status"]');
    if (statusSel && statusSel.value !== line.status) statusSel.value = line.status;
    markDirty();
    refreshComputed(card, tr, order, line);
  }

  function refreshComputed(card, tr, order, line) {
    const t = lineTotals(line);
    const cells = tr.querySelectorAll(".computed");
    if (cells[0]) cells[0].textContent = money(t.unpaid);
    if (cells[1]) {
      cells[1].innerHTML = `${esc(money(t.after))}<div style="color:#94a3b8;font-weight:500;font-size:11px">до скидки ${esc(money(t.total))}</div>`;
    }
    const tot = orderTotals(order);
    const foot = card.querySelector(".totals");
    if (foot) foot.innerHTML = `Итог <b>${esc(money(tot.after))}</b> · оплачено <b>${esc(money(tot.paid))}</b> · не оплачено <b>${esc(money(tot.unpaid))}</b>`;
  }

  function onExprFocus(e) {
    const inp = e.target;
    const key = inp.dataset?.lk;
    if (!EXPR_MAP[key] || inp.dataset.showing !== "result") return;
    inp.dataset.showing = "expr";
    inp.value = inp.dataset.expr || "";
    queueMicrotask(() => {
      try {
        inp.select();
      } catch {
        /* ignore */
      }
    });
  }

  function onExprBlur(e) {
    const inp = e.target;
    const key = inp.dataset?.lk;
    if (!EXPR_MAP[key]) return;
    const card = inp.closest("[data-order]");
    const tr = inp.closest("[data-line]");
    if (!card || !tr) return;
    const order = findOrder(card.dataset.order);
    const line = order?.lines.find((l) => l.id === tr.dataset.line);
    if (!line) return;
    const raw = inp.value.includes(",") && DECIMAL_KEYS.has(key) ? inp.value.replaceAll(",", ".") : inp.value;
    if (raw !== inp.value) inp.value = raw;
    line[key] = raw;
    inp.dataset.expr = raw;
    const v = evalExpr(raw);
    inp.classList.toggle("invalid", raw.trim() !== "" && !Number.isFinite(v));
    if (Number.isFinite(v)) {
      const numKey = EXPR_MAP[key];
      let n = round2(v);
      if (numKey === "discount") n = Math.min(100, Math.max(0, n));
      if (numKey === "price" || numKey === "paid") n = Math.max(0, n);
      line[numKey] = n;
      if (isFormula(raw)) {
        inp.dataset.showing = "result";
        inp.value = formatQty(n);
      } else {
        inp.dataset.showing = "expr";
      }
    }
    applyPaidIfCovered(line);
    applyRowStatus(tr, line.status);
    const statusSel = tr.querySelector('[data-lk="status"]');
    if (statusSel && statusSel.value !== line.status) statusSel.value = line.status;
    refreshComputed(card, tr, order, line);
    markDirty();
  }

  const SHARE_FIELDS = [
    { id: "number", label: "Номер заказа", kind: "meta" },
    { id: "customer", label: "Имя заказчика", kind: "meta" },
    { id: "organization", label: "Организация", kind: "meta" },
    { id: "name", label: "Название заказа", kind: "meta" },
    { id: "order_type", label: "Тип / работа", kind: "col" },
    { id: "product", label: "Продукт", kind: "col" },
    { id: "quantity", label: "Количество", kind: "col" },
    { id: "order_date", label: "Дата заказа", kind: "col" },
    { id: "status", label: "Статус", kind: "col" },
    { id: "price", label: "Цена", kind: "col" },
    { id: "discount", label: "Скидка", kind: "col" },
    { id: "total", label: "Сумма позиции", kind: "col" },
    { id: "paid", label: "Оплачено", kind: "col" },
    { id: "unpaid", label: "Не оплачено", kind: "col" },
    { id: "payment_date", label: "Дата оплаты", kind: "col" },
    { id: "totals", label: "Итоги заказа", kind: "meta" },
  ];
  const SHARE_PRESETS = {
    work: ["number", "name", "order_type", "product", "quantity", "status", "order_date"],
    invoice: ["number", "customer", "organization", "name", "order_type", "product", "quantity", "price", "discount", "total", "paid", "unpaid", "totals"],
    full: SHARE_FIELDS.map((f) => f.id),
  };

  function currentShareFields() {
    return [...document.querySelectorAll("#share-fields input:checked")].map((el) => el.value);
  }

  function fmtShareDate(value) {
    if (!value) return "—";
    return String(value).replace("T", " ").slice(0, 16);
  }

  function customerOrg(name) {
    return (state.doc.customers || []).find((c) => c.name === name)?.organization || "";
  }

  function shareLineValue(line, id) {
    const t = lineTotals(line);
    if (id === "order_type") return line.order_type || "—";
    if (id === "product") return line.product || "—";
    if (id === "quantity") return `${qtyValue(line)} ${line.unit || ""}`.trim();
    if (id === "price") return money(numExpr(line, "price_expr", "price"));
    if (id === "discount") return `${numExpr(line, "discount_expr", "discount")} %`;
    if (id === "total") return money(t.after);
    if (id === "paid") return money(t.paid);
    if (id === "unpaid") return money(t.unpaid);
    if (id === "order_date") return fmtShareDate(line.order_date);
    if (id === "payment_date") return fmtShareDate(line.payment_date);
    if (id === "status") return line.status || "—";
    return "";
  }

  function shareHideLabels() {
    return !!$("share-hide-labels")?.checked;
  }

  function shareHideStamp() {
    return !!$("share-hide-stamp")?.checked;
  }

  function shareTitleText(blocks) {
    const typed = ($("share-title")?.value || "").trim();
    if (typed) return typed;
    if (blocks.length === 1) {
      const o = blocks[0].order;
      return [o.number, o.name].filter(Boolean).join(" · ") || "Снимок заказа";
    }
    if (blocks.length > 1) return `Заказы (${blocks.length})`;
    return "Снимок заказа";
  }

  function linesTotals(lines) {
    return (lines || []).reduce(
      (acc, line) => {
        const t = lineTotals(line);
        acc.total += t.total;
        acc.after += t.after;
        acc.paid += t.paid;
        acc.unpaid += t.unpaid;
        return acc;
      },
      { total: 0, after: 0, paid: 0, unpaid: 0 }
    );
  }

  function selectedShareBlocks() {
    return [...document.querySelectorAll("#share-orders .share-order")]
      .map((block) => {
        const order = findOrder(block.dataset.order);
        if (!order || !block.querySelector("[data-share-order]")?.checked) return null;
        const ids = new Set([...block.querySelectorAll("[data-share-line]:checked")].map((el) => el.dataset.shareLine));
        const lines = (order.lines || []).filter((l) => ids.has(l.id));
        if (!lines.length) return null;
        return { order, lines };
      })
      .filter(Boolean);
  }

  function shareMetaItems(order, fields, hideLabels) {
    const items = [];
    const add = (label, value) => {
      const v = value || "—";
      items.push(hideLabels ? v : `${label}${v}`);
    };
    if (fields.includes("number")) add("№ ", order.number);
    if (fields.includes("name")) add("Заказ: ", order.name);
    if (fields.includes("customer")) add("Заказчик: ", order.customer);
    if (fields.includes("organization")) add("Организация: ", customerOrg(order.customer));
    return items;
  }

  function shareTotalsText(fields, cols, lines) {
    if (!fields.includes("totals") || shareNeedsMoneyFooter(cols)) return "";
    const tot = linesTotals(lines);
    const bits = [];
    if (fields.includes("total") || fields.includes("price") || !cols.length) bits.push(`Итого ${money(tot.after)}`);
    if (fields.includes("paid")) bits.push(`оплачено ${money(tot.paid)}`);
    if (fields.includes("unpaid")) bits.push(`остаток ${money(tot.unpaid)}`);
    return bits.length ? bits.join(" · ") : `Позиций: ${lines.length}`;
  }

  const SHARE_MONEY_COLS = new Set(["price", "total", "paid", "unpaid"]);

  function shareNeedsMoneyFooter(cols) {
    return (cols || []).some((c) => SHARE_MONEY_COLS.has(c.id));
  }

  function shareFooterValue(colId, lines) {
    const tot = linesTotals(lines);
    if (colId === "price") return money(tot.total);
    if (colId === "total") return money(tot.after);
    if (colId === "paid") return money(tot.paid);
    if (colId === "unpaid") return money(tot.unpaid);
    return "";
  }

  function shareFooterCells(cols, lines) {
    if (!shareNeedsMoneyFooter(cols)) return null;
    return cols.map((c) => (SHARE_MONEY_COLS.has(c.id) ? shareFooterValue(c.id, lines) : ""));
  }

  function shareColWidths(cols, linesList) {
    const ctx = document.createElement("canvas").getContext("2d");
    const cellPad = 24;
    return cols.map((col) => {
      ctx.font = "600 11px Segoe UI, sans-serif";
      let w = ctx.measureText(String(col.label || "").toUpperCase()).width;
      ctx.font = "13px Segoe UI, sans-serif";
      (linesList || []).forEach((line) => {
        w = Math.max(w, ctx.measureText(String(shareLineValue(line, col.id) || "—")).width);
      });
      ctx.font = "700 13px Segoe UI, sans-serif";
      const foot = shareFooterCells(cols, linesList);
      if (foot) {
        const idx = cols.indexOf(col);
        w = Math.max(w, ctx.measureText(String(foot[idx] || "")).width);
      }
      return Math.max(52, Math.ceil(w + cellPad));
    });
  }

  function shareColStarts(widths, origin) {
    const xs = [];
    let x = origin;
    widths.forEach((w) => {
      xs.push(x);
      x += w;
    });
    return xs;
  }

  function renderShareOrdersPicker(focusOrderId) {
    const box = $("share-orders");
    const orders = [...(state.doc.orders || [])].sort((a, b) => orderNewestStamp(b).localeCompare(orderNewestStamp(a)));
    box.innerHTML = orders.length
      ? orders
          .map((order) => {
            const on = !!(focusOrderId && focusOrderId === order.id);
            return `<div class="share-order ${on ? "" : "collapsed"}" data-order="${esc(order.id)}">
          <div class="share-order-head">
            <button type="button" class="share-toggle" data-share-toggle title="Строки заказа" aria-expanded="${on ? "true" : "false"}">${on ? "▾" : "▸"}</button>
            <label><input type="checkbox" data-share-order ${on ? "checked" : ""} /> ${esc(order.number || "—")} · ${esc(order.name || "без названия")}</label>
          </div>
          <div class="share-lines">${(order.lines || [])
            .map(
              (line) =>
                `<label><input type="checkbox" data-share-line="${esc(line.id)}" ${on ? "checked" : ""} /> ${esc(line.order_type || "тип")} · ${esc(line.product || "—")}</label>`
            )
            .join("")}</div>
        </div>`;
          })
          .join("")
      : `<div class="hint">Нет заказов</div>`;
    if (focusOrderId) {
      [...box.querySelectorAll(".share-order")].find((el) => el.dataset.order === focusOrderId)?.scrollIntoView({ block: "nearest" });
    }
  }

  function openShare(order) {
    const saved = ensureUi().share_fields;
    const selected = saved && saved.length ? saved : SHARE_PRESETS.work;
    $("share-fields").innerHTML = SHARE_FIELDS.map(
      (f) => `<label><input type="checkbox" value="${f.id}" ${selected.includes(f.id) ? "checked" : ""} /> ${esc(f.label)}</label>`
    ).join("");
    renderShareOrdersPicker(order?.id || null);
    $("share-title").value = order ? [order.number, order.name].filter(Boolean).join(" · ") : "";
    renderSharePreview();
    $("share-modal").classList.add("open");
  }

  function applySharePreset(name) {
    const ids = SHARE_PRESETS[name] || SHARE_PRESETS.work;
    document.querySelectorAll("#share-fields input").forEach((el) => {
      el.checked = ids.includes(el.value);
    });
    ensureUi().share_fields = ids.slice();
    markDirty();
    renderSharePreview();
  }

  function renderSharePreview() {
    const box = $("share-preview");
    if (!box) return;
    const blocks = selectedShareBlocks();
    const fields = currentShareFields();
    const hideLabels = shareHideLabels();
    const hideStamp = shareHideStamp();
    const cols = SHARE_FIELDS.filter((f) => f.kind === "col" && fields.includes(f.id));
    const title = shareTitleText(blocks);
    const body = blocks.length
      ? blocks
          .map(({ order, lines }, i) => {
            const meta = shareMetaItems(order, fields, hideLabels);
            const totalsText = shareTotalsText(fields, cols, lines);
            const foot = shareFooterCells(cols, lines);
            const colWidths = cols.length ? shareColWidths(cols, lines) : [];
            const table = cols.length
              ? `<table style="width:max-content;border-collapse:collapse;font-size:13px;table-layout:fixed"><colgroup>${colWidths
                  .map((w) => `<col style="width:${w}px">`)
                  .join("")}</colgroup><thead><tr>${cols
                  .map(
                    (c) =>
                      `<th style="text-align:left;padding:8px 10px;font-size:11px;text-transform:uppercase;letter-spacing:.04em;color:#64748b;background:#f8fafc;border-top:1px solid #e2e8f0;white-space:nowrap">${esc(c.label)}</th>`
                  )
                  .join("")}</tr></thead><tbody>${lines
                  .map(
                    (line) =>
                      `<tr>${cols
                        .map((c) => `<td style="text-align:left;padding:8px 10px;border-top:1px solid #e2e8f0;white-space:nowrap">${esc(shareLineValue(line, c.id))}</td>`)
                        .join("")}</tr>`
                  )
                  .join("")}</tbody>${
                  foot
                    ? `<tfoot><tr>${foot
                        .map(
                          (v) =>
                            `<td style="text-align:left;padding:10px;border-top:2px solid #0f766e;font-weight:700;background:#f1f5f9;white-space:nowrap">${esc(v)}</td>`
                        )
                        .join("")}</tr></tfoot>`
                    : ""
                }</table>`
              : "";
            const sep = i ? "border-top:2px solid #0f766e;margin-top:12px;padding-top:16px;" : "";
            return `<div class="share-order-block" style="padding:0 20px 16px;${sep}">
          ${meta.length ? `<div class="sp-meta" style="padding:0 0 10px;display:grid;gap:4px;font-size:13px;color:#334155">${meta.map((m) => `<div>${esc(m)}</div>`).join("")}</div>` : ""}
          ${table || `<div style="padding:8px 0;font-size:13px;color:#64748b">Таблица работ скрыта — включите колонки слева.</div>`}
          ${totalsText ? `<div class="sp-foot" style="padding:10px 0 4px;font-size:14px"><b>${esc(totalsText)}</b></div>` : ""}
        </div>`;
          })
          .join("")
      : `<div style="padding:20px;color:#64748b">Выберите хотя бы один заказ и строку слева.</div>`;
    box.innerHTML = `
      <div class="sp-head" style="background:linear-gradient(90deg,#0f766e,#115e59);color:#fff;padding:18px 20px">
        <b style="font-size:18px;display:block">${esc(title)}</b>
      </div>
      ${body}
      ${hideStamp ? "" : `<div class="sp-note" style="padding:0 20px 16px;font-size:11px;color:#94a3b8">Сформировано ${esc(new Date().toLocaleString("ru-RU"))}</div>`}
    `;
  }

  function wrapCanvasText(ctx, text, maxW) {
    const words = String(text || "").split(/\s+/);
    const lines = [];
    let cur = "";
    words.forEach((w) => {
      const test = cur ? `${cur} ${w}` : w;
      if (ctx.measureText(test).width > maxW && cur) {
        lines.push(cur);
        cur = w;
      } else cur = test;
    });
    if (cur) lines.push(cur);
    return lines.length ? lines : [""];
  }

  function fitCanvasText(ctx, text, maxW) {
    const s = String(text || "");
    if (ctx.measureText(s).width <= maxW) return s;
    let t = s;
    while (t.length && ctx.measureText(`${t}…`).width > maxW) t = t.slice(0, -1);
    return `${t}…`;
  }

  function shareToCanvas() {
    const blocks = selectedShareBlocks();
    if (!blocks.length) throw new Error("Выберите заказы и строки для снимка");
    const fields = currentShareFields();
    const hideLabels = shareHideLabels();
    const hideStamp = shareHideStamp();
    const cols = SHARE_FIELDS.filter((f) => f.kind === "col" && fields.includes(f.id));
    const title = shareTitleText(blocks);
    const stamp = `Сформировано ${new Date().toLocaleString("ru-RU")}`;
    const pad = 20;
    const rowH = 34;
    const layouts = blocks.map(({ order, lines }) => {
      const colWidths = cols.length ? shareColWidths(cols, lines) : [];
      const tableW = colWidths.reduce((s, w) => s + w, 0);
      return { order, lines, colWidths, tableW };
    });
    const measure = document.createElement("canvas").getContext("2d");
    let inner = Math.max(0, ...layouts.map((b) => b.tableW));
    measure.font = "700 20px Segoe UI, sans-serif";
    inner = Math.max(inner, measure.measureText(title).width);
    measure.font = "13px Segoe UI, sans-serif";
    layouts.forEach(({ order, lines }) => {
      shareMetaItems(order, fields, hideLabels).forEach((line) => {
        inner = Math.max(inner, measure.measureText(line).width);
      });
      const totalsText = shareTotalsText(fields, cols, lines);
      if (totalsText) {
        measure.font = "700 14px Segoe UI, sans-serif";
        inner = Math.max(inner, measure.measureText(totalsText).width);
        measure.font = "13px Segoe UI, sans-serif";
      }
    });
    if (!hideStamp) {
      measure.font = "11px Segoe UI, sans-serif";
      inner = Math.max(inner, measure.measureText(stamp).width);
    }
    const width = Math.ceil(pad * 2 + Math.max(inner, 80));
    const headerH = 64;
    let bodyH = 16;
    layouts.forEach(({ order, lines }, bi) => {
      const meta = shareMetaItems(order, fields, hideLabels);
      const foot = shareFooterCells(cols, lines);
      bodyH +=
        (bi ? 36 : 0) +
        (meta.length ? meta.length * 22 + 10 : 0) +
        (cols.length ? 32 + lines.length * rowH + (foot ? rowH : 0) : 28) +
        (shareTotalsText(fields, cols, lines) ? 36 : 0) +
        16;
    });
    const height = headerH + bodyH + (hideStamp ? 16 : 36);
    const scale = 2;
    const canvas = document.createElement("canvas");
    canvas.width = width * scale;
    canvas.height = height * scale;
    const ctx = canvas.getContext("2d");
    ctx.scale(scale, scale);
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, width, height);
    const head = ctx.createLinearGradient(0, 0, width, 0);
    head.addColorStop(0, "#0f766e");
    head.addColorStop(1, "#115e59");
    ctx.fillStyle = head;
    ctx.fillRect(0, 0, width, headerH);
    ctx.fillStyle = "#ffffff";
    ctx.font = "700 20px Segoe UI, sans-serif";
    ctx.fillText(title, pad, 40);
    let y = headerH + 16;
    layouts.forEach(({ order, lines, colWidths, tableW }, bi) => {
      if (bi) {
        y += 16;
        ctx.strokeStyle = "#0f766e";
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(pad, y);
        ctx.lineTo(width - pad, y);
        ctx.stroke();
        ctx.lineWidth = 1;
        y += 20;
      }
      const meta = shareMetaItems(order, fields, hideLabels);
      ctx.fillStyle = "#334155";
      ctx.font = "13px Segoe UI, sans-serif";
      meta.forEach((line) => {
        ctx.fillText(line, pad, y + 14);
        y += 22;
      });
      if (meta.length) y += 10;
      if (cols.length) {
        const xs = shareColStarts(colWidths, pad);
        ctx.fillStyle = "#f8fafc";
        ctx.fillRect(pad, y, tableW, 32);
        ctx.fillStyle = "#64748b";
        ctx.font = "600 11px Segoe UI, sans-serif";
        cols.forEach((col, i) => {
          ctx.fillText(fitCanvasText(ctx, col.label.toUpperCase(), colWidths[i] - 12), xs[i] + 8, y + 21);
        });
        y += 32;
        ctx.font = "13px Segoe UI, sans-serif";
        lines.forEach((line, ri) => {
          if (ri % 2) {
            ctx.fillStyle = "#f8fafc";
            ctx.fillRect(pad, y, tableW, rowH);
          }
          ctx.strokeStyle = "#e2e8f0";
          ctx.beginPath();
          ctx.moveTo(pad, y);
          ctx.lineTo(pad + tableW, y);
          ctx.stroke();
          ctx.fillStyle = "#0f172a";
          cols.forEach((col, i) => {
            const text = fitCanvasText(ctx, String(shareLineValue(line, col.id) || "—"), colWidths[i] - 12);
            ctx.save();
            ctx.beginPath();
            ctx.rect(xs[i], y, colWidths[i] - 2, rowH);
            ctx.clip();
            ctx.fillText(text, xs[i] + 8, y + 22);
            ctx.restore();
          });
          y += rowH;
        });
        const foot = shareFooterCells(cols, lines);
        if (foot) {
          ctx.fillStyle = "#f1f5f9";
          ctx.fillRect(pad, y, tableW, rowH);
          ctx.strokeStyle = "#0f766e";
          ctx.beginPath();
          ctx.moveTo(pad, y);
          ctx.lineTo(pad + tableW, y);
          ctx.stroke();
          ctx.fillStyle = "#0f172a";
          ctx.font = "700 13px Segoe UI, sans-serif";
          foot.forEach((v, i) => {
            ctx.save();
            ctx.beginPath();
            ctx.rect(xs[i], y, colWidths[i] - 2, rowH);
            ctx.clip();
            ctx.fillText(fitCanvasText(ctx, v, colWidths[i] - 12), xs[i] + 8, y + 22);
            ctx.restore();
          });
          y += rowH;
        }
      }
      const totalsText = shareTotalsText(fields, cols, lines);
      if (totalsText) {
        y += 14;
        ctx.fillStyle = "#0f172a";
        ctx.font = "700 14px Segoe UI, sans-serif";
        ctx.fillText(totalsText, pad, y + 14);
        y += 22;
      }
      y += 16;
    });
    if (!hideStamp) {
      ctx.fillStyle = "#94a3b8";
      ctx.font = "11px Segoe UI, sans-serif";
      ctx.fillText(stamp, pad, height - 16);
    }
    return canvas;
  }

  function blobToBase64(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result).split(",")[1] || "");
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  }

  async function copySharePng() {
    try {
      const canvas = shareToCanvas();
      const blob = await canvasToPngBlob(canvas);
      if (!blob) throw new Error("Не удалось создать изображение");
      if (state.desktop) {
        await apiPost("/api/clipboard-png", { base64: await blobToBase64(blob) });
        toast("Снимок скопирован — вставьте в чат или документ (Ctrl+V)");
        return;
      }
      if (navigator.clipboard && window.ClipboardItem) {
        await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
        toast("Снимок скопирован в буфер обмена");
        return;
      }
      throw new Error("clipboard");
    } catch (err) {
      toast(`Не удалось скопировать: ${err.message || err}`);
    }
  }

  async function canvasToPngBlob(canvas) {
    return new Promise((resolve) => canvas.toBlob((blob) => resolve(blob), "image/png"));
  }

  async function saveSharePng() {
    try {
      const canvas = await shareToCanvas();
      const blob = await canvasToPngBlob(canvas);
      const title = shareTitleText(selectedShareBlocks());
      const name = `${(title || "снимок").slice(0, 80)}.png`.replace(/[\\/:*?"<>|]+/g, "_");
      if (state.desktop) {
        const picked = await apiPost("/api/dialog/png", { suggested: name });
        if (picked.cancelled || !picked.path) return;
        const buf = await blob.arrayBuffer();
        const bytes = new Uint8Array(buf);
        let bin = "";
        bytes.forEach((b) => {
          bin += String.fromCharCode(b);
        });
        await apiPost("/api/write-bytes", { path: picked.path, base64: btoa(bin) });
        toast("PNG сохранён");
        return;
      }
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = name;
      a.click();
      URL.revokeObjectURL(a.href);
      toast("PNG скачан");
    } catch (err) {
      toast(`Не удалось сохранить снимок: ${err.message || err}`);
    }
  }

  function onOrderClick(e) {
    const act = e.target.dataset.act || e.target.closest("button")?.dataset.act;
    if (!act) return;
    const card = e.target.closest("[data-order]");
    const order = findOrder(card.dataset.order);
    if (act === "share") {
      openShare(order);
      return;
    }
    if (act === "payall") {
      (order.lines || []).forEach((line) => {
        const after = lineTotals(line).after;
        line.paid = after;
        line.paid_expr = String(after);
        applyPaidIfCovered(line);
      });
      markDirty();
      renderOrders();
      return;
    }
    if (act === "del") {
      if (!confirm("Удалить заказ целиком?")) return;
      state.doc.orders = state.doc.orders.filter((o) => o.id !== order.id);
      markDirty();
      renderOrders();
    }
    if (act === "dup") {
      const copy = JSON.parse(JSON.stringify(order));
      copy.id = uid();
      copy.number = `${order.number}-копия`;
      copy.lines.forEach((l) => (l.id = uid()));
      state.doc.orders.push(copy);
      markDirty();
      renderOrders();
    }
    if (act === "addline") {
      const prev = (order.lines || [])[order.lines.length - 1];
      const line = emptyLine();
      if (prev) {
        line.order_type = prev.order_type;
        line.product = prev.product;
        line.unit = prev.unit;
        line.order_date = prev.order_date;
        line.status = prev.status;
      }
      order.lines.push(line);
      markDirty();
      renderOrders();
    }
    if (act === "delline") {
      const id = e.target.closest("[data-line]").dataset.line;
      if (order.lines.length <= 1) {
        toast("У заказа должна остаться хотя бы одна позиция. Удалите заказ целиком, если он не нужен.");
        return;
      }
      order.lines = order.lines.filter((l) => l.id !== id);
      markDirty();
      renderOrders();
    }
  }

  async function boot() {
    try {
      bind();
    } catch (err) {
      console.error(err);
    }
    try {
      const bootData = await apiGet("/api/bootstrap");
      state.desktop = true;
      state.autosave = !!bootData.autosave;
      applyTheme(bootData.theme || "light", false);
      await renderRecent(bootData.recent);
      await apiPost("/api/dirty", { dirty: false });
    } catch {
      state.desktop = false;
      state.autosave = localStorage.getItem(LS_AUTOSAVE) === "true";
      applyTheme(localStorage.getItem(LS_THEME) || "light", false);
      await renderRecent();
    }
    $("autosave").checked = state.autosave;
  }

  window.finmasterNew = createNew;
  window.finmasterOpen = openFromDialog;

  boot();
})();
