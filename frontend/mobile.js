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
    clients: [],
    history: { undo: false, redo: false },
    view: "orders",
    orderId: null,
    editLineId: null,
    headOpen: false,
    query: "",
    filter: "all",
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
    return { qty, price, discount, total, after, paid, unpaid: round2(Math.max(0, after - paid)) };
  }

  function sumLines(lines) {
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

  function orderTotals(order) {
    return sumLines(order?.lines);
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

  function applySnapshot(data, initial = false) {
    if (typeof data.version === "number") state.version = Math.max(state.version, data.version);
    if (typeof data.path === "string") state.path = data.path;
    if (typeof data.dirty === "boolean") state.dirty = data.dirty;
    if (Array.isArray(data.clients)) state.clients = data.clients;
    if (data.history && typeof data.history === "object") state.history = data.history;
    updateHead();
    if (!data.document) return;
    const fresh = typeof data.doc_version === "number" ? data.doc_version > state.docVersion : true;
    if (typeof data.doc_version === "number") state.docVersion = Math.max(state.docVersion, data.doc_version);
    if (!initial && !fresh) return;
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

  function navReport() {
    if (state.stopped || !state.token) return;
    const view = state.view;
    const orderId = view === "order" ? state.orderId || "" : "";
    api("/api/remote/nav", { method: "POST", body: JSON.stringify({ view, order_id: orderId, cid: state.cid }) }).catch(() => {});
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
    $("head-title").textContent = state.doc?.title || "FinMaster";
    const file = state.path ? state.path.split(/[\\/]/).pop() : "файл не сохранён";
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
    const meta = statusMeta(line.status);
    const t = lineTotals(line);
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

  function renderOrder() {
    const order = currentOrder();
    if (!order) {
      setView("orders");
      return;
    }
    const t = orderTotals(order);
    const lines = order.lines || [];
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
        <div class="ot-sum"><span>Позиций</span><b>${lines.length}</b></div>
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
    <datalist id="products-list">${(state.doc.products || []).map((p) => `<option value="${esc(p.name || p)}"></option>`).join("")}</datalist>
    <datalist id="customers-list">${(state.doc.customers || []).map((c) => `<option value="${esc(c.name || "")}"></option>`).join("")}</datalist>`;

    $("lines-title").textContent = `Позиции · ${lines.length}`;
    $("lines-list").innerHTML = lines.length
      ? lines.map((line, i) => lineRowHtml(line, i)).join("")
      : `<div class="empty">Позиций нет. Нажмите «+ Позиция».</div>`;
  }

  function refreshOrderRow(lineId) {
    const order = currentOrder();
    if (!order) return;
    const index = (order.lines || []).findIndex((l) => l.id === lineId);
    const line = order.lines?.[index];
    if (line) {
      const row = document.querySelector(`.line-row[data-edit="${CSS.escape(lineId)}"]`);
      if (row) row.outerHTML = lineRowHtml(line, index);
    }
    const t = orderTotals(order);
    const top = $("order-top");
    if (top) {
      const sums = top.querySelectorAll(".ot-sum b");
      if (sums.length === 3) {
        sums[0].textContent = money(t.after);
        sums[1].textContent = money(t.unpaid > 0.005 ? t.unpaid : t.paid);
        sums[2].textContent = String((order.lines || []).length);
        const second = top.querySelectorAll(".ot-sum")[1];
        second.className = `ot-sum ${t.unpaid > 0.005 ? "debt" : "paid"}`;
        second.querySelector("span").textContent = t.unpaid > 0.005 ? "Долг" : "Оплачено";
      }
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
    $("editor").hidden = true;
    $("editor").classList.remove("is-on");
    document.body.classList.remove("locked");
    if (state.view === "order") renderOrder();
    flushPending();
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
    $("ed-title").textContent = `Позиция ${index + 1} из ${lines.length}`;
    $("ed-prev").disabled = index <= 0;
    $("ed-next").disabled = index >= lines.length - 1;

    $("editor-body").innerHTML = `
      <div class="field">
        <label>Позиция</label>
        <input type="text" list="products-list" placeholder="Название работы или товара" value="${esc(line.product || "")}" ${a("product")} />
      </div>
      <div class="field">
        <label>Тип заказа</label>
        ${selectHtml(state.doc.order_types, line.order_type, a("order_type"))}
      </div>

      <label class="big-label">Количество</label>
      <div class="stepper">
        <button type="button" class="step" data-step="-1">−</button>
        <input type="text" inputmode="decimal" class="big-input" value="${esc(line.qty_expr ?? line.quantity ?? "")}" ${a("qty_expr")} />
        <button type="button" class="step" data-step="1">+</button>
        ${selectHtml(state.doc.units, line.unit, `${a("unit")} class="unit-select"`)}
      </div>

      <label class="big-label">Цена за единицу</label>
      <input type="text" inputmode="decimal" class="big-input" value="${esc(line.price_expr ?? line.price ?? "")}" ${a("price_expr")} />
      <div class="hint">Можно писать выражение: <code>2*350</code> или <code>1200+80</code></div>

      <label class="big-label">Скидка, %</label>
      <input type="text" inputmode="decimal" class="big-input" value="${esc(line.discount_expr ?? line.discount ?? "")}" ${a("discount_expr")} />
      <div class="chips inline">${DISCOUNTS.map(
        (d) => `<button type="button" class="chip ${Math.round(t.discount) === d ? "active" : ""}" data-discount="${d}">${d}%</button>`
      ).join("")}</div>

      <label class="big-label">Оплачено</label>
      <input type="text" inputmode="decimal" class="big-input" value="${esc(line.paid_expr ?? line.paid ?? "")}" ${a("paid_expr")} />
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
      </div>

      <div class="ed-sums" id="ed-sums">${editorSumsHtml(t)}</div>

      <div class="stack">
        <button type="button" class="btn wide" id="ed-dup">Дублировать позицию</button>
        <button type="button" class="btn wide danger-ghost" id="ed-del">Удалить позицию</button>
      </div>`;
  }

  function editorSumsHtml(t) {
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
  }

  function setLineNumber(line, exprKey, value) {
    line[exprKey] = String(value);
    const mirror = MIRROR[exprKey];
    if (mirror) {
      const v = evalExpr(line[exprKey]);
      line[mirror] = Number.isFinite(v) ? round2(v) : 0;
    }
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

    const debtors = list
      .map((o) => ({ order: o, t: orderTotals(o) }))
      .filter(({ t }) => t.unpaid > 0.005)
      .sort((a, b) => b.t.unpaid - a.t.unpaid)
      .slice(0, 5);

    $("stats-body").innerHTML = `
      <div class="kpis">
        <div class="kpi"><span>Заказов</span><strong>${list.length}</strong></div>
        <div class="kpi"><span>Позиций</span><strong>${all.length}</strong></div>
        <div class="kpi"><span>Выручка</span><strong>${esc(compact(agg.after))}</strong></div>
        <div class="kpi ${agg.unpaid > 0.005 ? "debt" : "ok"}"><span>Долг</span><strong>${esc(compact(agg.unpaid))}</strong></div>
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
                ({ order, t }) => `<article class="line-row" data-open="${esc(order.id)}" style="--tint:var(--danger)">
                  <span class="lr-index">${esc(order.number || "—")}</span>
                  <div class="lr-main">
                    <strong>${esc(order.customer || "Без заказчика")}</strong>
                    <small>${esc(order.number || "—")} · ${esc(order.name || "без названия")}</small>
                  </div>
                  <div class="lr-right"><b class="debt">${esc(money(t.unpaid))}</b><span class="lr-go">›</span></div>
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

  function snapLines(order) {
    const all = order?.lines || [];
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

  function snapValue(line, id) {
    const t = lineTotals(line);
    if (id === "order_type") return line.order_type || "—";
    if (id === "product") return line.product || "—";
    if (id === "quantity") return qtyText(line) || "—";
    if (id === "price") return money(t.price);
    if (id === "discount") return `${Math.round(t.discount * 100) / 100} %`;
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
    if (colId === "total") return money(tot.after);
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
    if (state.snap.fields.includes("paid")) bits.push(`оплачено ${money(tot.paid)}`);
    if (state.snap.fields.includes("unpaid")) bits.push(`остаток ${money(tot.unpaid)}`);
    return bits.join(" · ");
  }

  function renderSnapshot() {
    const box = $("snapshot-body");
    const list = orders();
    if (!list.length) {
      box.innerHTML = `<div class="empty">Сначала создайте заказ — потом можно отправить снимок заказчику.</div>`;
      return;
    }
    const order = snapOrder();
    const lines = order.lines || [];
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
          return `<label class="pick-row ${on ? "on" : ""}">
            <input type="checkbox" data-snap-line="${esc(line.id)}" ${on ? "checked" : ""} />
            <span class="pr-main"><strong>${i + 1}. ${esc(line.product || "Без названия")}</strong>
            <small>${esc(line.order_type || "")} · ${esc(qtyText(line))}</small></span>
            <b>${esc(money(t.after))}</b>
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

  function renderFiles() {
    const file = state.path ? state.path.split(/[\\/]/).pop() : "";
    const recent = state.recent || [];
    $("files-body").innerHTML = `
      <article class="card">
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
        <div class="field last"><label>Имя на компьютере</label><input type="text" id="device-name" value="${esc(deviceName())}" /></div>
        <div class="muted" style="margin:10px 0 0">Устройство запомнено. Добавьте страницу в закладки — QR больше не нужен.</div>
        <div class="stack">
          <button type="button" class="btn wide" id="cmd-fullscreen">${document.fullscreenElement ? "Выйти из полного экрана" : "Полный экран"}</button>
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
    $("sheet").classList.remove("is-on");
  }

  function openMenu() {
    const items = [
      { value: "save", label: "Сохранить на компьютере", hint: state.dirty ? "есть несохранённые правки" : "" },
      { value: "fullscreen", label: fullscreenOn() ? "Выйти из полного экрана" : "Полный экран" },
      { value: "snapshot", label: "Снимок для заказчика" },
      { value: "theme", label: document.documentElement.getAttribute("data-theme") === "dark" ? "Светлая тема" : "Тёмная тема" },
      { value: "new", label: "Создать новый отчёт" },
      { value: "link", label: "Скопировать постоянную ссылку" },
      { value: "device", label: "Отчёты и устройство" },
    ];
    openSheet("Меню", items, "", async (item) => {
      if (item.value === "save") {
        await push();
        if (await command("save")) toast("Отчёт сохраняется на компьютере");
      } else if (item.value === "fullscreen") toggleFullscreen();
      else if (item.value === "snapshot") setView("snapshot");
      else if (item.value === "theme") toggleTheme();
      else if (item.value === "new") {
        if (confirm("Создать новый отчёт на компьютере? Несохранённые правки нужно сохранить заранее.")) {
          if (await command("new")) toast("Создаю новый отчёт…");
        }
      } else if (item.value === "link") copyLink();
      else if (item.value === "device") setView("files");
    });
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

  const DECIMAL_FIELDS = new Set(["qty_expr", "price_expr", "discount_expr", "paid_expr"]);
  const MIRROR = { qty_expr: "quantity", price_expr: "price", discount_expr: "discount", paid_expr: "paid" };

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
        if (found?.unit) {
          line.unit = found.unit;
          const sel = document.querySelector(`select[data-l="${CSS.escape(line.id)}"][data-f="unit"]`);
          if (sel) sel.value = found.unit;
        }
        if (found?.price != null && !num(line.price)) {
          setLineNumber(line, "price_expr", found.price);
          const inp = document.querySelector(`input[data-l="${CSS.escape(line.id)}"][data-f="price_expr"]`);
          if (inp) inp.value = String(found.price);
        }
      }
      if (field === "paid_expr") autoPaidStatus(line);
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

  function autoPaidStatus(line) {
    const name = paidStatusName();
    if (!name) return;
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
    document.addEventListener("input", (e) => {
      if (e.target.id === "device-name") {
        localStorage.setItem(LS_NAME, e.target.value.trim() || guessDeviceName());
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

    document.addEventListener("focusout", () => setTimeout(flushPending, 150));

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
        renderSnapPreview();
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
      if (e.target.closest("#cmd-save")) {
        await push();
        if (await command("save")) toast("Компьютер сохраняет отчёт…");
        return;
      }
      if (e.target.closest("#cmd-new")) {
        if (await command("new")) toast("Создаю новый отчёт…");
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
      const order = currentOrder();
      const line = findLine(order, state.editLineId);
      if (!line) return;

      const step = e.target.closest("[data-step]");
      if (step) {
        const delta = Number(step.dataset.step);
        const next = Math.max(0, round2(lineTotals(line).qty + delta));
        setLineNumber(line, "qty_expr", next);
        const inp = document.querySelector(`input[data-l="${CSS.escape(line.id)}"][data-f="qty_expr"]`);
        if (inp) inp.value = String(next);
        refreshEditorSums();
        refreshOrderRow(line.id);
        touchDoc();
        pushSoon();
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

    $("btn-retry").addEventListener("click", () => location.reload());

    $("sheet").addEventListener("click", (e) => {
      if (e.target.closest("[data-close-sheet]")) {
        closeSheet();
        return;
      }
      const pick = e.target.closest("[data-pick]");
      if (pick) $("sheet")._pick?.(Number(pick.dataset.pick));
    });

    document.addEventListener("fullscreenchange", () => {
      if (state.view === "files") renderFiles();
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
