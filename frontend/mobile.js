(() => {
  "use strict";

  const $ = (id) => document.getElementById(id);
  const LS_TOKEN = "finmaster.remote.token";
  const LS_THEME = "finmaster.mobile.theme";
  const LS_NAME = "finmaster.remote.name";
  const LS_CID = "finmaster.remote.cid";
  const moneyFmt = new Intl.NumberFormat("ru-RU", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  const state = {
    token: "",
    cid: "",
    doc: null,
    version: 0,
    path: "",
    dirty: false,
    recent: [],
    clients: [],
    view: "orders",
    orderId: null,
    query: "",
    filter: "all",
    sort: "date-desc",
    pending: null,
    pushTimer: null,
    pushing: false,
    stopped: false,
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

  function evalExpr(raw) {
    const s = String(raw ?? "").trim().replaceAll("×", "*").replaceAll(",", ".");
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

  function lineTotals(line) {
    const qty = numExpr(line, "qty_expr", "quantity");
    const price = Math.max(0, numExpr(line, "price_expr", "price"));
    const discount = Math.min(100, Math.max(0, numExpr(line, "discount_expr", "discount")));
    const total = round2(qty * price);
    const after = round2(total * (1 - discount / 100));
    const paid = Math.max(0, numExpr(line, "paid_expr", "paid"));
    return { qty, total, after, paid, unpaid: round2(Math.max(0, after - paid)) };
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

  function money(n) {
    return `${moneyFmt.format(Number(n) || 0)} ${state.doc?.currency || "₽"}`;
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
    const d = new Date(v);
    if (Number.isNaN(d.getTime())) return String(v);
    return d.toLocaleDateString("ru-RU", { day: "2-digit", month: "short", year: "2-digit" });
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

  function guessDeviceName() {
    const ua = navigator.userAgent || "";
    if (/iPhone|iPad/.test(ua)) return "iPhone";
    if (/Android/.test(ua)) return "Android";
    return "Телефон";
  }

  function deviceName() {
    return localStorage.getItem(LS_NAME) || guessDeviceName();
  }

  async function api(path, options = {}) {
    const sep = path.includes("?") ? "&" : "?";
    const extra = `t=${encodeURIComponent(state.token)}&cid=${encodeURIComponent(state.cid)}&name=${encodeURIComponent(deviceName())}`;
    const res = await fetch(`${path}${sep}${extra}`, {
      ...options,
      headers: {
        "Content-Type": "application/json",
        "X-FM-Token": state.token,
        "ngrok-skip-browser-warning": "1",
        ...(options.headers || {}),
      },
    });
    const data = await res.json().catch(() => ({}));
    if (res.status === 401 || res.status === 403) {
      const reason = data.error || "Откройте на компьютере «Телефон» и отсканируйте QR-код заново.";
      blocked("Сессия закрыта", reason);
      throw new Error(reason);
    }
    if (!res.ok) throw new Error(data.error || res.statusText);
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
    state.cid = localStorage.getItem(LS_CID) || uid();
    localStorage.setItem(LS_CID, state.cid);
    if (!localStorage.getItem(LS_NAME)) localStorage.setItem(LS_NAME, guessDeviceName());
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
      setSync("ok", "подключено");
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

  function applySnapshot(data, initial = false) {
    if (typeof data.version === "number") state.version = Math.max(state.version, data.version);
    if (typeof data.path === "string") state.path = data.path;
    if (typeof data.dirty === "boolean") state.dirty = data.dirty;
    if (Array.isArray(data.clients)) state.clients = data.clients;
    updateHead();
    if (!data.document) return;
    if (!initial && data.origin === state.cid) return;
    if (!initial && (state.pushTimer || state.pushing)) return;
    if (!initial && isTyping()) {
      state.pending = data.document;
      return;
    }
    state.doc = data.document;
    if (!initial) setSync("ok", "обновлено с компьютера");
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

  /* ================= модель ================= */

  function orders() {
    return state.doc?.orders || [];
  }

  function currentOrder() {
    return orders().find((o) => o.id === state.orderId) || null;
  }

  function emptyLine() {
    return {
      id: uid(),
      order_type: state.doc.order_types?.[0] || "",
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
    };
  }

  function emptyOrder() {
    return {
      id: uid(),
      number: String(orders().length + 1).padStart(4, "0"),
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
    btn.textContent = state.sort === "date-asc" ? "↑ старые" : state.sort === "amount-desc" ? "Σ сумма" : state.sort === "number" ? "№ номер" : state.sort === "customer" ? "Ая клиент" : "↓ новые";
    btn.title = cur.label;
  }

  /* ================= отрисовка ================= */

  function updateHead() {
    $("head-title").textContent = state.doc?.title || "FinMaster";
    const file = state.path ? state.path.split(/[\\/]/).pop() : "файл не сохранён";
    const phones = state.clients.filter((c) => c.kind === "mobile").length;
    $("head-sub").textContent = `${state.dirty ? "• " : ""}${file}${phones > 1 ? ` · ${phones} телефона` : ""}`;
    $("btn-back").hidden = state.view !== "order";
  }

  function setView(view, orderId) {
    state.view = view;
    if (orderId !== undefined) state.orderId = orderId;
    ["orders", "order", "stats", "files"].forEach((v) => {
      $(`screen-${v}`).hidden = v !== view;
    });
    document.querySelectorAll("#tabbar button").forEach((b) => {
      const tab = b.dataset.tab;
      b.classList.toggle("active", tab === view || (view === "order" && tab === "orders"));
    });
    window.scrollTo({ top: 0 });
    renderCurrent();
  }

  function renderCurrent() {
    updateHead();
    if (state.view === "orders") renderOrders();
    else if (state.view === "order") renderOrder();
    else if (state.view === "stats") renderStats();
    else renderFiles();
  }

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
    renderChips();
    updateSortBtn();
    const list = visibleOrders();
    const box = $("orders-list");
    if (!list.length) {
      box.innerHTML = `<div class="empty">${orders().length ? "Ничего не найдено.<br>Измените поиск или фильтр." : "Заказов пока нет.<br>Нажмите «+», чтобы создать первый."}</div>`;
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
            <span class="oi-num">№${esc(order.number || "—")}</span>
            <span class="oi-customer">${esc(order.customer || "Без заказчика")}</span>
          </div>
          <div class="oi-name">${esc(order.name || "—")} · ${(order.lines || []).length} поз.</div>
          <div class="oi-foot">
            <span class="sum">${esc(money(t.after))}</span>
            ${debt ? `<span class="sum debt">долг ${esc(money(t.unpaid))}</span>` : `<span class="sum paid">оплачено</span>`}
            <span class="dots">${dots}</span>
          </div>
        </article>`;
      })
      .join("");
  }

  function selectHtml(values, selected, attrs) {
    const opts = (values || [])
      .map((v) => `<option value="${esc(v)}" ${v === selected ? "selected" : ""}>${esc(v)}</option>`)
      .join("");
    const extra = selected && !(values || []).includes(selected) ? `<option value="${esc(selected)}" selected>${esc(selected)}</option>` : "";
    return `<select ${attrs}>${extra}${opts}</select>`;
  }

  function lineCardHtml(line, index) {
    const meta = statusMeta(line.status);
    const t = lineTotals(line);
    const a = (f) => `data-l="${esc(line.id)}" data-f="${f}"`;
    return `<article class="card line-card" data-line="${esc(line.id)}" style="--tint:${esc(meta.color)}">
      <div class="line-head">
        <span class="line-index">${index + 1}</span>
        <input type="text" list="products-list" placeholder="Позиция" value="${esc(line.product || "")}" ${a("product")} />
        <button type="button" class="icon-x" data-del-line="${esc(line.id)}" aria-label="Удалить">×</button>
      </div>
      <div class="field">
        <button type="button" class="pill" style="background:${esc(meta.color)}" data-status="${esc(line.id)}">${esc(line.status || "Статус")}</button>
      </div>
      <div class="grid-2">
        <div class="field"><label>Количество</label><input type="text" inputmode="decimal" value="${esc(line.qty_expr ?? line.quantity ?? "")}" ${a("qty_expr")} /></div>
        <div class="field"><label>Ед.</label>${selectHtml(state.doc.units, line.unit, a("unit"))}</div>
        <div class="field"><label>Цена</label><input type="text" inputmode="decimal" value="${esc(line.price_expr ?? line.price ?? "")}" ${a("price_expr")} /></div>
        <div class="field"><label>Скидка, %</label><input type="text" inputmode="decimal" value="${esc(line.discount_expr ?? line.discount ?? "")}" ${a("discount_expr")} /></div>
        <div class="field"><label>Оплачено</label><input type="text" inputmode="decimal" value="${esc(line.paid_expr ?? line.paid ?? "")}" ${a("paid_expr")} /></div>
        <div class="field"><label>Тип</label>${selectHtml(state.doc.order_types, line.order_type, a("order_type"))}</div>
        <div class="field"><label>Дата заказа</label><input type="datetime-local" value="${esc(line.order_date || "")}" ${a("order_date")} /></div>
        <div class="field"><label>Дата оплаты</label><input type="datetime-local" value="${esc(line.payment_date || "")}" ${a("payment_date")} /></div>
      </div>
      <div class="line-total" data-total="${esc(line.id)}">
        <span>Итого${t.unpaid > 0.005 ? ` · долг ${esc(money(t.unpaid))}` : ""}</span>
        <b>${esc(money(t.after))}</b>
      </div>
    </article>`;
  }

  function renderOrder() {
    const order = currentOrder();
    if (!order) {
      setView("orders");
      return;
    }
    const t = orderTotals(order);
    const a = (f) => `data-o="${esc(order.id)}" data-f="${f}"`;
    $("order-head").innerHTML = `<article class="card">
      <div class="grid-2">
        <div class="field"><label>Номер</label><input type="text" value="${esc(order.number || "")}" ${a("number")} /></div>
        <div class="field"><label>Создан</label><input type="datetime-local" value="${esc(order.created_at || "")}" ${a("created_at")} /></div>
      </div>
      <div class="field" style="margin-top:10px"><label>Заказчик</label><input type="text" list="customers-list" value="${esc(order.customer || "")}" ${a("customer")} /></div>
      <div class="field"><label>Название</label><input type="text" value="${esc(order.name || "")}" ${a("name")} /></div>
      <div class="field"><label>Заметки</label><textarea ${a("notes")}>${esc(order.notes || "")}</textarea></div>
      <div class="line-total" id="order-sum">
        <span>${(order.lines || []).length} позиций${t.unpaid > 0.005 ? ` · долг ${esc(money(t.unpaid))}` : ""}</span>
        <b>${esc(money(t.after))}</b>
      </div>
    </article>
    <datalist id="products-list">${(state.doc.products || []).map((p) => `<option value="${esc(p.name || p)}"></option>`).join("")}</datalist>
    <datalist id="customers-list">${(state.doc.customers || []).map((c) => `<option value="${esc(c.name || "")}"></option>`).join("")}</datalist>`;

    $("lines-list").innerHTML = (order.lines || []).map((line, i) => lineCardHtml(line, i)).join("");
  }

  function refreshTotals(lineId) {
    const order = currentOrder();
    if (!order) return;
    const line = (order.lines || []).find((l) => l.id === lineId);
    if (line) {
      const el = document.querySelector(`[data-total="${CSS.escape(lineId)}"]`);
      if (el) {
        const t = lineTotals(line);
        el.innerHTML = `<span>Итого${t.unpaid > 0.005 ? ` · долг ${esc(money(t.unpaid))}` : ""}</span><b>${esc(money(t.after))}</b>`;
      }
    }
    const sum = $("order-sum");
    if (sum) {
      const t = orderTotals(order);
      sum.innerHTML = `<span>${(order.lines || []).length} позиций${t.unpaid > 0.005 ? ` · долг ${esc(money(t.unpaid))}` : ""}</span><b>${esc(money(t.after))}</b>`;
    }
  }

  function renderStats() {
    const list = orders();
    const all = list.flatMap((o) => (o.lines || []).map((l) => ({ line: l, order: o })));
    const agg = all.reduce(
      (acc, { line }) => {
        const t = lineTotals(line);
        acc.after += t.after;
        acc.paid += t.paid;
        acc.unpaid += t.unpaid;
        return acc;
      },
      { after: 0, paid: 0, unpaid: 0 }
    );

    const byStatus = {};
    all.forEach(({ line }) => {
      const t = lineTotals(line);
      byStatus[line.status] = (byStatus[line.status] || 0) + t.after;
    });
    const maxStatus = Math.max(1, ...Object.values(byStatus));

    const byCustomer = {};
    list.forEach((o) => {
      const t = orderTotals(o);
      const key = o.customer || "Без заказчика";
      byCustomer[key] = (byCustomer[key] || 0) + t.after;
    });
    const top = Object.entries(byCustomer).sort((a, b) => b[1] - a[1]).slice(0, 5);
    const maxCustomer = Math.max(1, ...top.map(([, v]) => v));

    $("stats-body").innerHTML = `
      <div class="kpis">
        <div class="kpi"><span>Заказов</span><strong>${list.length}</strong></div>
        <div class="kpi"><span>Позиций</span><strong>${all.length}</strong></div>
        <div class="kpi"><span>Выручка</span><strong>${esc(compact(agg.after))}</strong></div>
        <div class="kpi ${agg.unpaid > 0.005 ? "debt" : "ok"}"><span>Долг</span><strong>${esc(compact(agg.unpaid))}</strong></div>
      </div>
      <article class="card">
        <div class="bar-row"><span>Оплачено</span><b>${esc(money(agg.paid))}</b>
          <div class="bar-track"><div class="bar-fill" style="background:var(--ok);width:${agg.after ? Math.min(100, (agg.paid / agg.after) * 100) : 0}%"></div></div>
        </div>
        <div style="height:12px"></div>
        <div class="bar-row"><span>Осталось получить</span><b>${esc(money(agg.unpaid))}</b>
          <div class="bar-track"><div class="bar-fill" style="background:var(--danger);width:${agg.after ? Math.min(100, (agg.unpaid / agg.after) * 100) : 0}%"></div></div>
        </div>
      </article>
      <h3 class="section">По статусам</h3>
      <article class="card"><div class="bars">${
        Object.keys(byStatus).length
          ? Object.entries(byStatus)
              .sort((a, b) => b[1] - a[1])
              .map(
                ([name, value]) => `<div class="bar-row"><span>${esc(name)}</span><b>${esc(compact(value))}</b>
                  <div class="bar-track"><div class="bar-fill" style="background:${esc(statusMeta(name).color)};width:${(value / maxStatus) * 100}%"></div></div></div>`
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
                  <div class="bar-track"><div class="bar-fill" style="background:var(--accent-2);width:${(value / maxCustomer) * 100}%"></div></div></div>`
              )
              .join("")
          : '<div class="muted">Нет данных</div>'
      }</div></article>`;

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

  function renderFiles() {
    const file = state.path ? state.path.split(/[\\/]/).pop() : "";
    const recent = state.recent || [];
    $("files-body").innerHTML = `
      <article class="card">
        <div class="muted" style="margin-bottom:6px">Открыто на компьютере</div>
        <strong style="display:block;font-size:17px">${esc(state.doc?.title || "Без названия")}</strong>
        <small class="muted" style="word-break:break-all">${esc(state.path || "файл ещё не сохранён")}</small>
        <div class="stack">
          <button type="button" class="btn primary wide" id="cmd-save">${state.dirty ? "Сохранить изменения" : "Сохранить"}${file ? ` — ${esc(file)}` : ""}</button>
          <button type="button" class="btn wide" id="cmd-new">Создать новый отчёт</button>
        </div>
      </article>
      <h3 class="section">Недавние отчёты</h3>
      <div class="list">${
        recent.length
          ? recent
              .map(
                (item) => `<article class="card file-item ${item.path === state.path ? "current" : ""}">
                  <div class="fi-body">
                    <strong>${esc(item.title || item.path.split(/[\\/]/).pop())}</strong>
                    <small>${esc(item.path)}</small>
                  </div>
                  ${
                    item.path === state.path
                      ? '<span class="pill" style="background:var(--accent-2)">открыт</span>'
                      : item.exists === false
                        ? '<span class="pill" style="background:var(--muted)">нет файла</span>'
                        : `<button type="button" class="btn small" data-open-file="${esc(item.path)}">Открыть</button>`
                  }
                </article>`
              )
              .join("")
          : '<div class="empty">Список пуст</div>'
      }</div>
      <h3 class="section">Это устройство</h3>
      <article class="card">
        <div class="field"><label>Имя на компьютере</label><input type="text" id="device-name" value="${esc(deviceName())}" /></div>
        <div class="muted" style="margin:8px 0 0">Устройство запомнено. Добавьте эту страницу в закладки — QR больше не нужен.</div>
        <div class="stack" style="margin-top:12px">
          <button type="button" class="btn wide" id="cmd-copy-link">Скопировать постоянную ссылку</button>
          <button type="button" class="btn wide danger-ghost" id="cmd-leave">Отключиться от компьютера</button>
        </div>
      </article>`;
  }

  async function refreshRecent() {
    try {
      const data = await api("/api/remote/session");
      state.recent = data.recent || [];
      applySnapshot(data);
      if (state.view === "files") renderFiles();
    } catch {
      /* полл покажет ошибку */
    }
  }

  /* ================= нижняя шторка ================= */

  function openSheet(title, items, current, onPick) {
    $("sheet-title").textContent = title;
    $("sheet-list").innerHTML = items
      .map(
        (item, i) =>
          `<button type="button" data-pick="${i}" class="${item.value === current ? "active" : ""}">
            ${item.color ? `<i class="dot" style="width:14px;height:14px;background:${esc(item.color)}"></i>` : ""}
            <span>${esc(item.label)}</span>
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
    $("sheet").classList.remove("is-on");
  }

  /* ================= редактирование ================= */

  const DECIMAL_FIELDS = new Set(["qty_expr", "price_expr", "discount_expr", "paid_expr"]);
  const MIRROR = { qty_expr: "quantity", price_expr: "price", discount_expr: "discount", paid_expr: "paid" };

  function onEdit(e) {
    const el = e.target;
    const field = el.dataset?.f;
    if (!field) return;
    const order = el.dataset.o ? orders().find((o) => o.id === el.dataset.o) : currentOrder();
    if (!order) return;

    if (el.dataset.l) {
      const line = (order.lines || []).find((l) => l.id === el.dataset.l);
      if (!line) return;
      let value = el.value;
      if (DECIMAL_FIELDS.has(field) && value.includes(",")) {
        const pos = el.selectionStart;
        value = value.replaceAll(",", ".");
        el.value = value;
        if (pos != null) el.setSelectionRange(pos, pos);
      }
      line[field] = value;
      if (MIRROR[field]) {
        const v = evalExpr(value);
        line[MIRROR[field]] = Number.isFinite(v) ? round2(v) : 0;
      }
      if (field === "product") {
        const found = (state.doc.products || []).find((p) => (p.name || p) === value);
        const unit = found?.unit;
        if (unit) {
          line.unit = unit;
          const sel = document.querySelector(`select[data-l="${CSS.escape(line.id)}"][data-f="unit"]`);
          if (sel) sel.value = unit;
        }
      }
      if (field === "paid_expr") autoPaidStatus(line);
      refreshTotals(line.id);
    } else {
      order[field] = el.value;
    }
    touchDoc();
    pushSoon();
  }

  function autoPaidStatus(line) {
    const name = paidStatusName();
    if (!name) return;
    const t = lineTotals(line);
    if (t.after > 0 && t.paid + 0.005 >= t.after && line.status !== name) {
      line.status = name;
      const card = document.querySelector(`[data-line="${CSS.escape(line.id)}"]`);
      if (card) {
        card.style.setProperty("--tint", statusMeta(name).color);
        const pill = card.querySelector("[data-status]");
        if (pill) {
          pill.textContent = name;
          pill.style.background = statusMeta(name).color;
        }
      }
    }
  }

  function touchDoc() {
    if (state.doc) state.doc.modified_at = new Date().toISOString();
  }

  /* ================= события ================= */

  function bind() {
    $("main").addEventListener("input", (e) => {
      if (e.target.id === "device-name") {
        localStorage.setItem(LS_NAME, e.target.value.trim() || guessDeviceName());
        return;
      }
      onEdit(e);
    });
    $("main").addEventListener("change", (e) => {
      if (e.target.id === "device-name") return;
      onEdit(e);
    });
    document.addEventListener("focusout", () => setTimeout(flushPending, 120));

    $("main").addEventListener("click", async (e) => {
      const open = e.target.closest("[data-open]");
      if (open) {
        setView("order", open.dataset.open);
        return;
      }
      const chip = e.target.closest("[data-chip]");
      if (chip) {
        state.filter = chip.dataset.chip;
        renderOrders();
        return;
      }
      const del = e.target.closest("[data-del-line]");
      if (del) {
        const order = currentOrder();
        if (!order) return;
        if ((order.lines || []).length <= 1) {
          toast("В заказе должна остаться хотя бы одна позиция");
          return;
        }
        order.lines = order.lines.filter((l) => l.id !== del.dataset.delLine);
        touchDoc();
        pushSoon();
        renderOrder();
        toast("Позиция удалена");
        return;
      }
      const status = e.target.closest("[data-status]");
      if (status) {
        const order = currentOrder();
        const line = (order?.lines || []).find((l) => l.id === status.dataset.status);
        if (!line) return;
        openSheet(
          "Статус позиции",
          (state.doc.statuses || []).map((s) => ({ label: s.name, value: s.name, color: s.color })),
          line.status,
          (item) => {
            line.status = item.value;
            touchDoc();
            pushSoon();
            renderOrder();
          }
        );
        return;
      }
      const openFile = e.target.closest("[data-open-file]");
      if (openFile) {
        if (await command("open", { path: openFile.dataset.openFile })) toast("Открываю на компьютере…");
        return;
      }
      if (e.target.closest("#cmd-save")) {
        if (await command("save")) toast("Компьютер сохраняет отчёт…");
        return;
      }
      if (e.target.closest("#cmd-new")) {
        if (await command("new")) toast("Создаю новый отчёт…");
        return;
      }
      if (e.target.closest("#cmd-copy-link")) {
        const link = location.href;
        navigator.clipboard?.writeText(link).then(
          () => toast("Ссылка скопирована — сохраните в закладки"),
          () => toast(link)
        );
        return;
      }
      if (e.target.closest("#cmd-leave")) {
        state.stopped = true;
        api("/api/remote/leave", { method: "POST", body: JSON.stringify({ cid: state.cid }) }).catch(() => {});
        localStorage.removeItem(LS_TOKEN);
        blocked("Отключено", "Чтобы подключиться снова, откройте закладку или отсканируйте QR-код.");
      }
    });

    $("btn-add-order").addEventListener("click", () => {
      if (!state.doc) return;
      const order = emptyOrder();
      state.doc.orders = orders().concat([order]);
      touchDoc();
      pushSoon();
      setView("order", order.id);
      toast("Заказ создан");
    });

    $("btn-add-line").addEventListener("click", () => {
      const order = currentOrder();
      if (!order) return;
      order.lines = (order.lines || []).concat([emptyLine()]);
      touchDoc();
      pushSoon();
      renderOrder();
      window.scrollTo({ top: document.body.scrollHeight, behavior: "smooth" });
    });

    $("btn-del-order").addEventListener("click", () => {
      const order = currentOrder();
      if (!order) return;
      if (!confirm(`Удалить заказ №${order.number}?`)) return;
      state.doc.orders = orders().filter((o) => o.id !== order.id);
      touchDoc();
      pushSoon();
      setView("orders");
      toast("Заказ удалён");
    });

    $("btn-back").addEventListener("click", () => setView("orders"));

    $("search").addEventListener("input", (e) => {
      state.query = e.target.value;
      renderOrders();
    });

    $("btn-sort").addEventListener("click", () => {
      openSheet(
        "Сортировка заказов",
        SORT_OPTIONS,
        state.sort,
        (item) => {
          state.sort = item.value;
          renderOrders();
        }
      );
    });

    $("tabbar").addEventListener("click", (e) => {
      const btn = e.target.closest("[data-tab]");
      if (!btn) return;
      const tab = btn.dataset.tab;
      if (tab === "files") refreshRecent();
      setView(tab);
    });

    $("btn-save").addEventListener("click", async () => {
      await push();
      if (await command("save")) toast("Отчёт сохраняется на компьютере");
    });

    $("btn-theme").addEventListener("click", () => {
      const next = document.documentElement.getAttribute("data-theme") === "dark" ? "light" : "dark";
      document.documentElement.setAttribute("data-theme", next);
      localStorage.setItem(LS_THEME, next);
    });

    $("btn-retry").addEventListener("click", () => location.reload());

    $("sheet").addEventListener("click", (e) => {
      if (e.target.closest("[data-close-sheet]")) {
        closeSheet();
        return;
      }
      const pick = e.target.closest("[data-pick]");
      if (pick) $("sheet")._pick?.(Number(pick.dataset.pick));
    });

    window.addEventListener("beforeunload", () => {
      if (state.pushTimer) {
        navigator.sendBeacon?.(
          `/api/remote/push?t=${encodeURIComponent(state.token)}`,
          new Blob([JSON.stringify({ document: state.doc, cid: state.cid })], { type: "application/json" })
        );
      }
    });

    document.addEventListener("visibilitychange", () => {
      if (!document.hidden && !state.stopped) refreshRecent();
    });
  }

  const savedTheme = localStorage.getItem(LS_THEME);
  document.documentElement.setAttribute(
    "data-theme",
    savedTheme || (window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light")
  );

  bind();
  boot();
})();
