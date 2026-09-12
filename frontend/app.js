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

  function lineTotals(line) {
    const qty = num(line.quantity);
    const price = num(line.price);
    const discount = Math.min(100, Math.max(0, num(line.discount)));
    const total = round2(qty * price);
    const after = round2(total * (1 - discount / 100));
    const paid = Math.max(0, num(line.paid));
    const unpaid = round2(Math.max(0, after - paid));
    return { total, after, paid, unpaid, discount };
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
        { id: "paid", name: "Оплачено", color: "#059669" },
        { id: "cancelled", name: "Отменено", color: "#64748b" },
        { id: "annulled", name: "Аннулирован", color: "#475569" },
        { id: "blacklist", name: "Черный список", color: "#111827" },
      ],
      units: ["шт.", "м²", "м", "мин"],
      order_types: ["Производство", "Услуга", "Поставка", "Монтаж"],
      customers: [],
      orders: [],
    };
  }

  function emptyLine() {
    return {
      id: uid(),
      order_type: state.doc.order_types[0] || "",
      product: "",
      quantity: 1,
      unit: state.doc.units[0] || "шт.",
      price: 0,
      discount: 0,
      order_date: nowLocal(),
      paid: 0,
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
  function updateChrome() {
    const titleEl = $("report-title");
    if (document.activeElement !== titleEl) {
      titleEl.value = state.doc?.title || "Отчёт";
    }
    $("file-path").textContent = state.path || "Файл ещё не сохранён";
    $("dirty-dot").classList.toggle("hidden", !state.dirty);
    $("autosave").checked = !!state.autosave;
    document.title = `${state.dirty ? "• " : ""}${state.doc?.title || "FinMaster"} — FinMaster`;
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
    const blacklist = $("f-blacklist").checked;

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
      if (blacklist && line.status !== "Черный список" && !statusMeta(line.status).name.toLowerCase().includes("черн")) return false;
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
              <div><b>${esc(order.number)}</b> · ${esc(order.customer) || "без заказчика"} · ${esc(line.product) || esc(order.name)}</div>
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

  function optionList(values, selected) {
    return values.map((v) => `<option ${v === selected ? "selected" : ""}>${esc(v)}</option>`).join("");
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
              <button class="btn small" data-act="dup">Дублировать</button>
              <button class="btn small danger" data-act="del">Удалить</button>
            </div>
          </div>
          <div class="table-wrap">
            <table class="data">
              <thead>
                <tr>
                  <th>Тип заказа</th><th>Продукт</th><th>Кол-во</th><th>Ед.</th><th>Цена</th><th>Скидка %</th>
                  <th>Дата заказа</th><th>Оплачено</th><th>Дата оплаты</th><th>Не оплачено</th><th>Итог</th><th>Статус</th><th></th>
                </tr>
              </thead>
              <tbody>
                ${(order.lines || [])
                  .map((line) => {
                    const t = lineTotals(line);
                    return `<tr data-line="${line.id}">
                      <td><select data-lk="order_type">${optionList(unique([line.order_type, ...types]), line.order_type)}</select></td>
                      <td><input data-lk="product" list="product-list" value="${esc(line.product)}" /></td>
                      <td class="num"><input data-lk="quantity" type="number" min="0" step="0.01" value="${esc(line.quantity)}" /></td>
                      <td><select data-lk="unit">${optionList(unique([line.unit, ...units]), line.unit)}</select></td>
                      <td class="num"><input data-lk="price" type="number" min="0" step="0.01" value="${esc(line.price)}" /></td>
                      <td class="num"><input data-lk="discount" type="number" min="0" max="100" step="0.01" value="${esc(line.discount)}" /></td>
                      <td><input data-lk="order_date" type="datetime-local" value="${esc((line.order_date || "").slice(0, 16))}" /></td>
                      <td class="num"><input data-lk="paid" type="number" min="0" step="0.01" value="${esc(line.paid)}" /></td>
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
    $("product-list").innerHTML = unique(allRows().map((r) => r.line.product)).map((c) => `<option value="${esc(c)}">`).join("");
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
            <td class="num">${esc(line.quantity)} ${esc(line.unit)}</td>
            <td class="num">${esc(money(totals.after))}</td>
            <td class="num">${esc(money(totals.paid))}</td>
            <td class="num">${esc(money(totals.unpaid))}</td>
            <td>${esc((line.order_date || "").replace("T", " "))}</td>
            <td><span class="pill" style="background:${statusMeta(line.status).color}">${esc(line.status)}</span></td>
          </tr>`
          )
          .join("")}</tbody></table>
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
        <input type="color" data-ck="color" value="${esc(toHex(s.color))}" />
        <input data-ck="name" value="${esc(s.name)}" />
        <button class="btn small danger" data-cact="del">Удалить</button>
      </div>`
      )
      .join("");
    $("unit-list").innerHTML = (state.doc.units || [])
      .map((u, i) => `<div class="list-item" data-i="${i}"><input data-uk value="${esc(u)}" /><button class="btn small danger" data-uact="del">Удалить</button></div>`)
      .join("");
    $("type-list").innerHTML = (state.doc.order_types || [])
      .map((u, i) => `<div class="list-item" data-i="${i}"><input data-tk value="${esc(u)}" /><button class="btn small danger" data-tact="del">Удалить</button></div>`)
      .join("");

    const map = new Map();
    (state.doc.customers || []).forEach((c) => map.set(c.name, { ...c }));
    (state.doc.orders || []).forEach((o) => {
      if (!o.customer) return;
      if (!map.has(o.customer)) map.set(o.customer, { name: o.customer, phone: "", note: "" });
    });
    state.doc.customers = [...map.values()];
    $("customer-catalog").innerHTML = state.doc.customers.length
      ? `<table class="data"><thead><tr><th>Имя</th><th>Телефон</th><th>Заметка</th><th>Заказов</th></tr></thead><tbody>${state.doc.customers
          .map((c) => {
            const n = (state.doc.orders || []).filter((o) => o.customer === c.name).length;
            return `<tr data-name="${esc(c.name)}"><td>${esc(c.name)}</td>
              <td><input data-cust="phone" value="${esc(c.phone || "")}" /></td>
              <td><input data-cust="note" value="${esc(c.note || "")}" /></td>
              <td>${n}</td></tr>`;
          })
          .join("")}</tbody></table>`
      : `<div class="empty">Заказчики появятся после ввода в заказах</div>`;
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
          <div class="meta">${missing ? "файл не найден" : esc(date)}</div>
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

  function bind() {
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

    $("status-list").addEventListener("input", (e) => {
      const row = e.target.closest(".list-item");
      if (!row) return;
      const i = Number(row.dataset.i);
      const s = state.doc.statuses[i];
      if (e.target.dataset.ck === "name") s.name = e.target.value;
      if (e.target.dataset.ck === "color") s.color = e.target.value;
      markDirty();
    });
    $("status-list").addEventListener("click", (e) => {
      if (e.target.dataset.cact === "del") {
        const i = Number(e.target.closest(".list-item").dataset.i);
        state.doc.statuses.splice(i, 1);
        markDirty();
        renderCatalogs();
      }
    });
    $("btn-add-status").addEventListener("click", () => {
      state.doc.statuses.push({ id: uid(), name: "Новый статус", color: "#64748b" });
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
    $("customer-catalog").addEventListener("input", (e) => {
      const name = e.target.closest("tr")?.dataset.name;
      const c = state.doc.customers.find((x) => x.name === name);
      if (!c) return;
      c[e.target.dataset.cust] = e.target.value;
      markDirty();
    });

    ["f-from", "f-to", "f-date-field", "f-group", "f-status", "f-type", "f-customer", "f-product", "f-unit", "f-min", "f-max", "f-unpaid", "f-blacklist", "c-a-from", "c-a-to", "c-b-from", "c-b-to"].forEach(
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
      $("f-blacklist").checked = false;
      renderAnalytics();
    });
    $("btn-preset-month").addEventListener("click", () => {
      const d = new Date();
      const from = new Date(d.getFullYear(), d.getMonth(), 1, 0, 0);
      setDT("f-from", from);
      setDT("f-to", d);
      renderAnalytics();
    });
    $("btn-preset-week").addEventListener("click", () => {
      const d = new Date();
      const from = new Date(d.getTime() - 7 * 86400000);
      setDT("f-from", from);
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
    $("recent-list").addEventListener("click", (e) => {
      const item = e.target.closest(".recent-item");
      if (!item || item.classList.contains("missing")) return;
      openPath(item.dataset.path);
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
    if (e.target.dataset.k) {
      order[e.target.dataset.k] = e.target.value;
      if (e.target.dataset.k === "name" && !state.path) state.doc.title = e.target.value || state.doc.title;
      markDirty();
      return;
    }
    const tr = e.target.closest("[data-line]");
    if (!tr) return;
    const line = order.lines.find((l) => l.id === tr.dataset.line);
    if (!line || !e.target.dataset.lk) return;
    const key = e.target.dataset.lk;
    line[key] = e.target.type === "number" ? num(e.target.value) : e.target.value;
    markDirty();
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

  function onOrderClick(e) {
    const act = e.target.dataset.act || e.target.closest("button")?.dataset.act;
    if (!act) return;
    const card = e.target.closest("[data-order]");
    const order = findOrder(card.dataset.order);
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
      order.lines.push(emptyLine());
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
      await renderRecent(bootData.recent);
      await apiPost("/api/dirty", { dirty: false });
    } catch {
      state.desktop = false;
      state.autosave = localStorage.getItem(LS_AUTOSAVE) === "true";
      await renderRecent();
    }
    $("autosave").checked = state.autosave;
  }

  document.addEventListener("click", (e) => {
    if (e.target.closest("#btn-start-new")) {
      e.preventDefault();
      createNew();
    } else if (e.target.closest("#btn-start-open")) {
      e.preventDefault();
      openFromDialog();
    }
  });

  boot();
})();
