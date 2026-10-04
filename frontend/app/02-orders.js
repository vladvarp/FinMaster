  /* ==== Типы заказа: обычные, «налог» и «затрата» ==== */

  function typeEntry(item) {
    if (item && typeof item === "object" && !Array.isArray(item)) {
      const isTax = !!item.is_tax;
      return { id: String(item.id || item.name || ""), name: String(item.name || "").trim(), is_tax: isTax, is_cost: !isTax && !!item.is_cost };
    }
    return { id: String(item || ""), name: String(item || "").trim(), is_tax: false, is_cost: false };
  }

  function orderTypes() {
    return (state.doc?.order_types || []).map(typeEntry).filter((t) => t.name);
  }

  function typeMeta(name) {
    const key = String(name || "").trim();
    return orderTypes().find((t) => t.name === key) || { id: key, name: key, is_tax: false, is_cost: false };
  }

  /** "tax" | "cost" | "" — пустая строка означает обычную доходную позицию. */
  function typeKind(name) {
    const meta = typeMeta(name);
    return meta.is_tax ? "tax" : meta.is_cost ? "cost" : "";
  }

  function kindLabel(kind) {
    return kind === "tax" ? "налог" : kind === "cost" ? "затрата" : "";
  }

  function isExpenseLine(line) {
    return !!typeKind(line?.order_type);
  }

  function isFrozenLine(line) {
    return !!line?.frozen;
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
    const frozen = [];
    (lines || []).forEach((line) => {
      if (isFrozenLine(line)) frozen.push(line);
      else if (isExpenseLine(line)) expense.push(line);
      else income.push(line);
    });
    return { income, expense, frozen };
  }

  /** Режим строки налога: «amount» — своя сумма, «gross» — % от выручки, «net» — % от выручки без затрат. */
  function taxMode(line) {
    const mode = String(line?.tax_mode || "amount");
    return mode === "gross" || mode === "net" ? mode : "amount";
  }

  function ownerOrder(line) {
    return (state.doc?.orders || []).find((o) => (o.lines || []).includes(line)) || null;
  }

  /**
   * База для процента налога: выручка заказа, при режиме «net» — за вычетом затрат.
   * Считается только по доходным строкам и затратам, поэтому налог никогда не зависит от налога.
   */
  function orderTaxBase(order, mode) {
    let gross = 0;
    let costs = 0;
    for (const item of order?.lines || []) {
      if (isFrozenLine(item)) continue;
      const kind = typeKind(item.order_type);
      if (!kind) gross += lineTotals(item).after;
      else if (kind === "cost") costs += lineTotals(item).cost;
    }
    return round2(mode === "net" ? gross - costs : gross);
  }

  function lineTotals(line, order) {
    const qty = qtyValue(line);
    const price = Math.max(0, numExpr(line, "price_expr", "price"));
    const kind = typeKind(line.order_type);
    if (kind) {
      const mode = kind === "tax" ? taxMode(line) : "amount";
      if (mode !== "amount") {
        const percent = Math.max(0, numExpr(line, "tax_percent_expr", "tax_percent"));
        const base = orderTaxBase(order || ownerOrder(line), mode);
        const cost = round2((base * percent) / 100);
        return { total: cost, after: 0, paid: 0, unpaid: 0, discount: 0, cost, kind, expense: true, mode, percent, base };
      }
      const cost = round2(qty * price);
      return { total: cost, after: 0, paid: 0, unpaid: 0, discount: 0, cost, kind, expense: true, mode: "amount", percent: 0, base: 0 };
    }
    const discount = Math.min(100, Math.max(0, numExpr(line, "discount_expr", "discount")));
    const total = round2(qty * price);
    const after = round2(total * (1 - discount / 100));
    const paid = Math.max(0, numExpr(line, "paid_expr", "paid"));
    const unpaid = round2(Math.max(0, after - paid));
    return { total, after, paid, unpaid, discount, cost: 0, kind: "", expense: false, mode: "amount", percent: 0, base: 0 };
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
    if (!ps || statusLocked(line.status) || isExpenseLine(line) || isFrozenLine(line)) return false;
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
    const acc = (order.lines || []).reduce(
      (sum, line) => {
        if (isFrozenLine(line)) return sum;
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

  function emptyDoc() {
    return {
      version: 1,
      title: "Новый отчёт",
      created_at: new Date().toISOString(),
      modified_at: new Date().toISOString(),
      currency: "₽",
      money_decimals: 2,
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
      order_types: [
        { id: "production", name: "Производство", is_tax: false, is_cost: false },
        { id: "service", name: "Услуга", is_tax: false, is_cost: false },
        { id: "supply", name: "Поставка", is_tax: false, is_cost: false },
        { id: "install", name: "Монтаж", is_tax: false, is_cost: false },
      ],
      products: [],
      customers: [],
      orders: [],
      ui: { sidebar_collapsed: false, column_widths: {}, share_fields: [], share_theme: "teal", cloud: {}, line_series: {}, calculator: { active: "", blueprints: [] }, presentation: { active: "", pages: [] }, vault: { active: "", pages: [] } },
    };
  }

  function emptyLine() {
    return {
      id: uid(),
      order_type: typeNames("income")[0] || typeNames()[0] || "",
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
      tax_mode: "gross",
      tax_percent: 0,
      tax_percent_expr: "0",
      work_start: "",
      work_end: "",
      work_pauses: [],
      frozen: false,
      notes: "",
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
      created_at: nowLocalDateTime(),
      work_start: "",
      work_end: "",
      work_pauses: [],
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

  function prefValueFromRaw(raw) {
    if (raw == null) return null;
    try {
      return JSON.parse(raw);
    } catch {
      return raw;
    }
  }

  let prefChain = Promise.resolve();

  function sendPref(lsKey) {
    clearTimeout(prefTimers[lsKey]);
    delete prefTimers[lsKey];
    prefChain = prefChain.then(() => {
      let raw = null;
      try {
        raw = localStorage.getItem(lsKey);
      } catch {
        raw = null;
      }
      return apiPost("/api/ui-pref", { key: SYNCED_PREFS[lsKey], value: prefValueFromRaw(raw) }).catch(() => {});
    });
    return prefChain;
  }

  /** Пишет настройку в localStorage и (на компьютере) в config.json программы. */
  function persistPref(lsKey, raw, { now = false } = {}) {
    try {
      localStorage.setItem(lsKey, raw);
    } catch {
      /* ignore */
    }
    if (!state.desktop || !SYNCED_PREFS[lsKey]) return;
    clearTimeout(prefTimers[lsKey]);
    if (now) sendPref(lsKey);
    else prefTimers[lsKey] = setTimeout(() => sendPref(lsKey), 400);
  }

  function flushPrefs() {
    return Promise.all(Object.keys(prefTimers).map((lsKey) => sendPref(lsKey)));
  }

  /** При запуске: значения из config.json главнее; то, чего там нет, переносится из localStorage. */
  function hydratePrefs(serverPrefs) {
    const prefs = serverPrefs && typeof serverPrefs === "object" ? serverPrefs : {};
    Object.entries(SYNCED_PREFS).forEach(([lsKey, key]) => {
      try {
        if (key in prefs && prefs[key] != null) {
          const value = prefs[key];
          localStorage.setItem(lsKey, typeof value === "string" ? value : JSON.stringify(value));
        } else if (localStorage.getItem(lsKey) != null) {
          sendPref(lsKey);
        }
      } catch {
        /* ignore */
      }
    });
    if (state.calendar) state.calendar.followOrder = readCalFollow();
  }

  let dirtySyncChain = Promise.resolve();

  function syncDirty() {
    if (!state.desktop) return;
    const dirty = !!state.dirty;
    dirtySyncChain = dirtySyncChain
      .then(() => apiPost("/api/dirty", { dirty }))
      .catch(() => {});
  }

  async function flushPendingSaves() {
    await flushPrefs();
    clearTimeout(state.autosaveTimer);
    clearTimeout(history.persistTimer);
    try {
      await Promise.resolve(history.saveChain);
    } catch {
      /* ignore */
    }
    // Only auto-write the document when autosave is on. Otherwise askClose keeps dirty
    // and shows save/discard — closing must not silently persist edits.
    if (state.autosave && state.dirty && state.doc && state.path) {
      try {
        await save({ silent: true });
      } catch {
        /* ignore */
      }
    }
    if (state.desktop && state.path) {
      try {
        await apiPost("/api/history", {
          path: state.path,
          title: state.doc?.title || "",
          ...historyDiskPayload(),
        });
      } catch {
        /* ignore */
      }
    }
    try {
      await dirtySyncChain;
    } catch {
      /* ignore */
    }
  }

  function toast(text, action) {
    const el = $("toast");
    el.textContent = "";
    const span = document.createElement("span");
    span.textContent = text;
    el.appendChild(span);
    if (action) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "toast-action";
      btn.textContent = action.label;
      btn.addEventListener("click", () => {
        el.classList.remove("show");
        action.run();
      });
      el.appendChild(btn);
    }
    el.classList.add("show");
    clearTimeout(el._t);
    el._t = setTimeout(() => el.classList.remove("show"), action ? 6000 : 2800);
  }

  function undoToast(text) {
    toast(text, { label: "Отменить", run: undo });
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

  function themeIcon(theme) {
    if (theme === "dark") {
      return `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path d="M21 14.5A8.5 8.5 0 0 1 9.5 3 7 7 0 1 0 21 14.5z" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/>
      </svg>`;
    }
    return `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="4" stroke="currentColor" stroke-width="1.8"/>
      <path d="M12 2.5v2.2M12 19.3v2.2M2.5 12h2.2M19.3 12h2.2M5.05 5.05l1.56 1.56M17.39 17.39l1.56 1.56M18.95 5.05l-1.56 1.56M6.61 17.39l-1.56 1.56" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
    </svg>`;
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
      btn.innerHTML = themeIcon(t);
      btn.title = t === "dark" ? "Включить светлую тему" : "Включить тёмную тему";
      btn.setAttribute("aria-label", btn.title);
    });
    if (persist && state.desktop) {
      apiPost("/api/theme", { theme: t }).catch(() => {});
    }
    if (state.doc) renderAll();
  }

  function scheduleAutosave() {
    if (!state.autosave || !state.doc) return;
    clearTimeout(state.autosaveTimer);
    state.autosaveTimer = setTimeout(() => {
      if (!state.autosave || !state.doc || !state.dirty) return;
      save({ silent: true });
    }, 800);
  }

  function markDirty(label) {
    if (!state.doc || history.busy) return;
    state.dirty = true;
    state.doc.modified_at = new Date().toISOString();
    historySchedule(label);
    updateChrome();
    syncDirty();
    remotePublish();
    scheduleAutosave();
  }

  function setClean() {
    state.dirty = false;
    updateChrome();
    syncDirty();
    remotePublish();
  }

  function updateChrome() {
    const titleEl = $("report-title");
    if (titleEl && document.activeElement !== titleEl) {
      titleEl.value = state.doc?.title || "Отчёт";
    }
    const currencyEl = $("report-currency");
    const cur = String(state.doc?.currency || "₽").slice(0, 8) || "₽";
    if (currencyEl && document.activeElement !== currencyEl) {
      currencyEl.value = cur;
    }
    document.querySelectorAll(".report-currency-chip").forEach((btn) => {
      btn.classList.toggle("is-on", btn.dataset.currency === cur);
    });
    const dec = moneyDecimals();
    document.querySelectorAll(".report-decimals-chip").forEach((btn) => {
      btn.classList.toggle("is-on", Number(btn.dataset.decimals) === dec);
    });
    const preview = $("report-settings-preview");
    if (preview) preview.textContent = `Пример: ${formatMoneySample()}`;
    const pathEl = $("file-path");
    if (pathEl) pathEl.textContent = state.path || "Файл ещё не сохранён";
    $("dirty-dot")?.classList.toggle("hidden", !state.dirty);
    const saveBtn = $("btn-q-save");
    if (saveBtn) {
      saveBtn.classList.toggle("is-dirty", !!state.dirty);
      const tip = state.dirty
        ? "Сохранить (Ctrl+S) · есть несохранённые изменения"
        : state.path
          ? "Сохранить (Ctrl+S) · всё сохранено"
          : "Сохранить (Ctrl+S) · файл ещё не сохранён";
      saveBtn.setAttribute("data-tip", tip);
      saveBtn.setAttribute("aria-label", tip);
    }
    const autosaveEl = $("autosave");
    if (autosaveEl) autosaveEl.checked = !!state.autosave;
    document.title = `${state.dirty ? "• " : ""}${state.doc?.title || "FinMaster"} — FinMaster`;
    updateHistoryButtons();
    applySidebar();
  }

  function setCurrency(raw, opts = {}) {
    if (!state.doc) return;
    const refresh = opts.refresh !== false;
    let next = String(raw ?? "").slice(0, 8);
    if (refresh) next = next.trim() || "₽";
    if (state.doc.currency === next) {
      updateChrome();
      return;
    }
    state.doc.currency = next;
    markDirty("Валюта");
    if (refresh) renderAll();
    else {
      FinCharts?.setCurrency?.(next || "₽");
      updateChrome();
    }
  }

  function setMoneyDecimals(raw, opts = {}) {
    if (!state.doc) return;
    const refresh = opts.refresh !== false;
    const next = moneyDecimals({ money_decimals: raw });
    if (Number(state.doc.money_decimals) === next) {
      syncMoneyFmt(next);
      updateChrome();
      return;
    }
    state.doc.money_decimals = next;
    syncMoneyFmt(next);
    markDirty("Точность сумм");
    if (refresh) renderAll();
    else {
      FinCharts?.setMoneyDecimals?.(next);
      updateChrome();
    }
  }

  function openReportSettings() {
    updateChrome();
    $("report-settings-modal")?.classList.add("open");
    $("report-currency")?.focus();
  }

  function closeReportSettings() {
    $("report-settings-modal")?.classList.remove("open");
  }

  function showApp() {
    $("start-screen").classList.add("hidden");
    $("app-shell").hidden = false;
    ensureAssistant();
  }

  function showStart() {
    $("start-screen").classList.remove("hidden");
    $("app-shell").hidden = true;
    closePalette();
    renderStartLists();
  }

  function discardOpenReport() {
    state.doc = emptyDoc();
    state.path = "";
    historyReset("Отчёт закрыт");
    setClean();
    showStart();
  }

  function samePath(a, b) {
    const norm = (p) => String(p || "").replace(/\//g, "\\").toLowerCase();
    return !!a && !!b && norm(a) === norm(b);
  }

  async function deleteLibraryFile(path) {
    const name = String(path || "").split(/[\\/]/).pop() || "отчёт";
    const ok = await askConfirm({
      title: "Удалить отчёт?",
      text: `«${name}» будет удалён из папки FinMaster. Файл попадёт в корзину — его можно будет восстановить оттуда.`,
      ok: "Удалить",
      danger: true,
    });
    if (!ok) return;
    try {
      const res = await apiPost("/api/library/delete", { path });
      if (res.library) renderLibrary(res.library);
      if (res.recent) renderRecentItems(res.recent);
      if (res.closed || samePath(state.path, path)) discardOpenReport();
      toast("Отчёт удалён");
    } catch (err) {
      toast(String(err.message || "Не удалось удалить файл"));
    }
  }

  function allRows() {
    const rows = [];
    for (const order of state.doc.orders || []) {
      for (const line of order.lines || []) {
        if (isFrozenLine(line)) continue;
        rows.push({ order, line, totals: lineTotals(line, order) });
      }
    }
    return rows;
  }

  function statusMeta(name) {
    return (state.doc.statuses || []).find((s) => s.name === name) || { name, color: "#64748b" };
  }

  function focusedOrder() {
    if (!state.focusOrderId) return null;
    return (state.doc?.orders || []).find((o) => o.id === state.focusOrderId) || null;
  }

  function dashPeriodMatch(iso, period) {
    if (!period || period === "all") return true;
    const stamp = String(iso || "");
    if (!stamp) return false;
    const now = new Date();
    const pad = (n) => String(n).padStart(2, "0");
    const dayKey = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
    if (period === "today") return stamp.slice(0, 10) === dayKey;
    if (period === "week") {
      const from = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 6);
      return dateDay(stamp) >= `${from.getFullYear()}-${pad(from.getMonth() + 1)}-${pad(from.getDate())}`;
    }
    if (period === "month") return stamp.startsWith(`${now.getFullYear()}-${pad(now.getMonth() + 1)}`);
    if (period === "year") return stamp.startsWith(String(now.getFullYear()));
    return true;
  }

  function remoteStatsActive() {
    const f = state.remoteStats;
    if (!f) return false;
    return (f.period && f.period !== "all") || (f.filter && f.filter !== "all") || !!f.status;
  }

  function remoteStatsLabel() {
    const f = state.remoteStats || {};
    const parts = [];
    const periods = { today: "сегодня", week: "7 дней", month: "этот месяц", year: "этот год" };
    const filters = { debt: "с долгом", paid: "оплаченные" };
    if (f.period && f.period !== "all") parts.push(periods[f.period] || f.period);
    if (f.filter && f.filter !== "all") parts.push(filters[f.filter] || f.filter);
    if (f.status) parts.push(f.status);
    return parts.join(" · ") || "все заказы";
  }

  function dashRows() {
    const order = focusedOrder();
    let rows = order
      ? (order.lines || []).filter((line) => !isFrozenLine(line)).map((line) => ({ order, line, totals: lineTotals(line, order) }))
      : allRows();
    const f = state.remoteStats;
    if (!f || focusedOrder()) return rows;
    if (f.filter && f.filter !== "all") rows = rows.filter(({ order: o }) => orderFilterMatch(o, f.filter));
    if (f.status) rows = rows.filter(({ line }) => line.status === f.status);
    if (f.period && f.period !== "all") rows = rows.filter(({ line }) => dashPeriodMatch(line.order_date, f.period));
    return rows;
  }

  function matchesSearch(order, line, q) {
    if (!q) return true;
    const blob = [order.number, order.customer, order.name, order.notes, line?.product, line?.order_type, line?.status, line?.notes]
      .join(" ")
      .toLowerCase();
    return blob.includes(q);
  }

  function orderFilterMatch(order, filter) {
    if (!filter || filter === "all") return true;
    const t = orderTotals(order);
    if (filter === "debt") return t.unpaid > 0.005;
    if (filter === "paid") return t.after > 0.005 && t.unpaid <= 0.005;
    if (filter === "empty") return (order.lines || []).some((line) => !isFrozenLine(line) && !isExpenseLine(line) && lineTotals(line).after <= 0.005);
    if (filter === "month") {
      const now = new Date();
      const key = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
      return (
        (order.lines || []).some((line) => !isFrozenLine(line) && String(line.order_date || "").slice(0, 7) === key) ||
        String(order.created_at || "").slice(0, 7) === key
      );
    }
    return true;
  }

  const ORDER_FILTERS = [
    ["all", "Все"],
    ["debt", "С долгом"],
    ["paid", "Оплаченные"],
    ["month", "Этот месяц"],
    ["empty", "Без цены"],
  ];

  function closeOrderFilter() {
    const menu = $("order-filter-menu");
    if (menu) menu.hidden = true;
    $("btn-order-filter")?.setAttribute("aria-expanded", "false");
  }

  function renderOrderChips() {
    const btn = $("btn-order-filter");
    const menu = $("order-filter-menu");
    const label = $("order-filter-label");
    if (!btn || !state.doc) return;
    const all = state.doc.orders || [];
    const meta = ORDER_FILTERS.find(([id]) => id === state.orderFilter) || ORDER_FILTERS[0];
    const n = all.filter((o) => orderFilterMatch(o, meta[0])).length;
    if (label) label.textContent = `${meta[1]} · ${n}`;
    btn.classList.toggle("active", state.orderFilter !== "all");
    btn.setAttribute("aria-expanded", "false");
    if (menu) {
      menu.hidden = true;
      menu.innerHTML = ORDER_FILTERS.map(([id, name]) => {
        const count = all.filter((o) => orderFilterMatch(o, id)).length;
        return `<button type="button" class="btn ${state.orderFilter === id ? "active" : ""}" data-order-filter="${id}" role="menuitem">${esc(name)}<span class="chip-count">${count}</span></button>`;
      }).join("");
    }
  }

  function filteredOrders() {
    const q = state.search.trim().toLowerCase();
    let orders = [...(state.doc.orders || [])];
    if (q) {
      orders = orders.filter((o) => o.lines.some((l) => matchesSearch(o, l, q)) || matchesSearch(o, {}, q));
    }
    orders = orders.filter((o) => orderFilterMatch(o, state.orderFilter));
    const sort = $("order-sort")?.value || "date-desc";
    orders.sort((a, b) => compareOrders(a, b, sort));
    return orders;
  }

  function updateOrdersSummary() {
    const el = $("orders-summary");
    if (!el || !state.doc) return;
    if (state.view && state.view !== "orders") return;
    const orders = filteredOrders();
    const summary = summarize(
      orders.flatMap((o) =>
        (o.lines || []).filter((line) => !isFrozenLine(line)).map((line) => ({ order: o, line, totals: lineTotals(line, o) }))
      )
    );
    const hasCost = summary.cost > 0.005;
    const hasDebt = summary.unpaid > 0.005;
    const tip = [
      `Заказов: ${orders.length}`,
      `Выручка: ${money(summary.after)}`,
      hasCost ? `Расходы (налоги и затраты): −${money(summary.cost)}` : "",
      hasCost ? `Чистыми: ${money(summary.net)}` : "",
      `Долг: ${money(summary.unpaid)}`,
    ]
      .filter(Boolean)
      .join("\n");
    el.innerHTML = `<div class="os-line" data-tip="${esc(tip)}">
      <span class="os-count">${orders.length} зак.</span>
      <b>${esc(money(summary.after))}</b>${
        hasCost
          ? `<span class="os-op">−</span><b class="cost">${esc(money(summary.cost))}</b><span class="os-op">=</span><b class="os-net">${esc(money(summary.net))}</b>`
          : ""
      }${hasDebt ? `<span class="os-debt">долг ${esc(money(summary.unpaid))}</span>` : ""}
    </div>`;
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
      const dt = dateDay(line[dateField]);
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
      const dt = dateDay(line[dateField]);
      if (from && (!dt || dt < from)) return false;
      if (to && (!dt || dt > to)) return false;
      return true;
    });
    return summarize(rows);
  }

  function summarize(rows) {
    const s = { count: 0, costCount: 0, orders: new Set(), after: 0, paid: 0, unpaid: 0, total: 0, cost: 0 };
    rows.forEach(({ order, totals }) => {
      s.orders.add(order.id);
      if (totals.expense) {
        s.cost += totals.cost;
        s.costCount += 1;
        return;
      }
      s.count += 1;
      s.after += totals.after;
      s.paid += totals.paid;
      s.unpaid += totals.unpaid;
      s.total += totals.total;
    });
    s.orderCount = s.orders.size;
    s.net = round2(s.after - s.cost);
    return s;
  }

  function groupKey(iso, mode) {
    if (!iso) return "без даты";
    const d = parseDay(iso);
    if (!d) return dateDay(iso) || String(iso);
    const p = (n) => String(n).padStart(2, "0");
    if (mode === "month") return `${d.getFullYear()}-${p(d.getMonth() + 1)}`;
    if (mode === "week") {
      const tmp = new Date(d);
      tmp.setDate(d.getDate() - ((d.getDay() + 6) % 7));
      return `нед. ${tmp.getFullYear()}-${p(tmp.getMonth() + 1)}-${p(tmp.getDate())}`;
    }
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  }

  function renderKpis() {
    const rows = dashRows();
    const s = summarize(rows);
    const active = rows.filter(({ line }) => !/отмен|аннул|черн/i.test(line.status));
    const as = summarize(active);
    const costTiles = s.cost
      ? `<div class="kpi cost"><div class="label">Расходы</div><div class="value">−${money(s.cost)}</div><div class="sub">${s.costCount} налогов и затрат</div></div>
      <div class="kpi ${s.net >= 0 ? "ok" : "warn"}"><div class="label">Чистыми</div><div class="value">${money(s.net)}</div><div class="sub">${
          s.after ? Math.round((s.net / s.after) * 100) : 0
        }% от выручки</div></div>`
      : "";
    $("kpi-row").innerHTML = `
      <div class="kpi"><div class="label">Заказов</div><div class="value">${s.orderCount}</div><div class="sub">${s.count} позиций</div></div>
      <div class="kpi ok"><div class="label">К оплате (после скидки)</div><div class="value">${money(s.after)}</div><div class="sub">без отмен: ${money(as.after)}</div></div>
      <div class="kpi"><div class="label">Оплачено</div><div class="value">${money(s.paid)}</div><div class="sub">${s.after ? Math.round((s.paid / s.after) * 100) : 0}% от суммы</div></div>
      <div class="kpi warn"><div class="label">Не оплачено</div><div class="value">${money(s.unpaid)}</div><div class="sub">долг по открытым позициям</div></div>
      ${costTiles}
    `;
  }

  function monthKeyOf(iso) {
    if (!iso) return "";
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return "";
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  }

  function trendChip(current, previous) {
    if (!previous) return current ? { dir: "up", text: "новое" } : null;
    const diff = ((current - previous) / previous) * 100;
    if (!Number.isFinite(diff) || Math.abs(diff) < 1) return { dir: "", text: "без изменений" };
    return { dir: diff > 0 ? "up" : "down", text: `${diff > 0 ? "+" : "−"}${Math.abs(Math.round(diff))}%` };
  }

  function insightCard({ tint, ico, label, value, note, trend }) {
    return `<div class="insight" style="--tint:${tint}">
      <div class="insight-ico">${ico}</div>
      <div class="insight-body">
        <div class="insight-label">${esc(label)}</div>
        <div class="insight-value">${esc(value)}</div>
        <div class="insight-note">${esc(note)}</div>
      </div>
      ${trend ? `<span class="trend ${trend.dir}">${esc(trend.text)}</span>` : ""}
    </div>`;
  }

  function topBy(rows, keyFn, valueFn) {
    const map = new Map();
    rows.forEach((row) => {
      const key = String(keyFn(row) || "").trim();
      if (!key) return;
      map.set(key, (map.get(key) || 0) + valueFn(row));
    });
    let best = null;
    map.forEach((value, key) => {
      if (!best || value > best.value) best = { key, value };
    });
    return best;
  }

  function renderInsights() {
    const box = $("insights");
    if (!box) return;
    const rows = dashRows();
    if (!rows.length) {
      box.innerHTML = `<div class="empty">Добавьте первый заказ — здесь появятся выводы по выручке, долгам и заказчикам.</div>`;
      return;
    }
    const now = new Date();
    const curKey = monthKeyOf(now.toISOString());
    const prevKey = monthKeyOf(new Date(now.getFullYear(), now.getMonth() - 1, 15).toISOString());
    let curMonth = 0;
    let prevMonth = 0;
    let curMonthCost = 0;
    rows.forEach(({ line, totals }) => {
      const k = monthKeyOf(line.order_date);
      if (k === curKey) {
        curMonth += totals.after;
        curMonthCost += totals.cost;
      }
      if (k === prevKey) prevMonth += totals.after;
    });

    const s = summarize(rows);
    const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
    const dayOfMonth = now.getDate();
    const forecast = curMonth ? (curMonth / dayOfMonth) * daysInMonth : 0;

    const orderSums = new Map();
    rows.forEach(({ order, totals }) => orderSums.set(order.id, (orderSums.get(order.id) || 0) + totals.after));
    const paidOrders = [...orderSums.values()].filter((v) => v > 0);
    const avgCheck = paidOrders.length ? paidOrders.reduce((a, b) => a + b, 0) / paidOrders.length : 0;

    const topCustomer = topBy(rows, ({ order }) => order.customer, ({ totals }) => totals.after);
    const topProduct = topBy(rows, ({ line }) => line.product, ({ totals }) => totals.after);

    const monthAgo = localStamp(new Date(now.getTime() - 30 * 86400000));
    const overdue = rows.filter(({ line, totals }) => totals.unpaid > 0.005 && line.order_date && dateDay(line.order_date) < monthAgo);
    const overdueSum = overdue.reduce((acc, r) => acc + r.totals.unpaid, 0);

    const twoMonthsAgo = localStamp(new Date(now.getTime() - 60 * 86400000));
    const recentOrders = new Set();
    const olderOrders = new Set();
    rows.forEach(({ order, line }) => {
      const d = dateDay(line.order_date);
      if (!d) return;
      if (d >= monthAgo) recentOrders.add(order.id);
      else if (d >= twoMonthsAgo) olderOrders.add(order.id);
    });

    const paidShare = s.after ? Math.round((s.paid / s.after) * 100) : 0;

    const netCards = s.cost
      ? [
          insightCard({
            tint: "#b45309",
            ico: "▼",
            label: "Налоги и затраты",
            value: `−${money(s.cost)}`,
            note: `${s.costCount} строк расхода · за месяц ${money(curMonthCost)}`,
          }),
          insightCard({
            tint: s.net >= 0 ? "#047857" : "#dc2626",
            ico: "=",
            label: "Чистая прибыль",
            value: money(s.net),
            note: `выручка ${money(s.after)} минус расходы`,
          }),
        ]
      : [];

    box.innerHTML = [
      insightCard({
        tint: "#0f766e",
        ico: "▲",
        label: "Выручка за месяц",
        value: money(curMonth),
        note: `прошлый месяц ${money(prevMonth)}`,
        trend: trendChip(curMonth, prevMonth),
      }),
      ...netCards,
      insightCard({
        tint: "#2563eb",
        ico: "◈",
        label: "Прогноз до конца месяца",
        value: money(forecast),
        note: `по темпу за ${dayOfMonth} дн. из ${daysInMonth}`,
      }),
      insightCard({
        tint: "#c9a227",
        ico: "≡",
        label: "Средний чек",
        value: money(avgCheck),
        note: `по ${paidOrders.length} заказам`,
      }),
      insightCard({
        tint: paidShare >= 80 ? "#059669" : "#d97706",
        ico: "%",
        label: "Собираемость оплат",
        value: `${paidShare}%`,
        note: `не оплачено ${money(s.unpaid)}`,
      }),
      insightCard({
        tint: "#7c3aed",
        ico: "★",
        label: "Лучший заказчик",
        value: topCustomer ? topCustomer.key : "нет данных",
        note: topCustomer ? `принёс ${money(topCustomer.value)}` : "укажите заказчиков в заказах",
      }),
      insightCard({
        tint: "#0891b2",
        ico: "✦",
        label: "Хит продаж",
        value: topProduct ? topProduct.key : "нет данных",
        note: topProduct ? `выручка ${money(topProduct.value)}` : "укажите продукты в строках",
      }),
      insightCard({
        tint: overdueSum > 0 ? "#dc2626" : "#64748b",
        ico: "!",
        label: "Долги старше 30 дней",
        value: money(overdueSum),
        note: overdue.length ? `${overdue.length} позиций ждут оплаты` : "просроченных долгов нет",
      }),
      insightCard({
        tint: "#0284c7",
        ico: "◐",
        label: "Заказов за 30 дней",
        value: String(recentOrders.size),
        note: `предыдущие 30 дней: ${olderOrders.size}`,
        trend: trendChip(recentOrders.size, olderOrders.size),
      }),
    ].join("");
  }

  const LINE_METRICS = [
    { id: "after", label: "Выручка", color: "#0f766e", fill: true, on: true },
    { id: "paid", label: "Оплачено", color: "#059669", on: true },
    { id: "unpaid", label: "Долг", color: "#dc2626", on: true },
    { id: "cost", label: "Расход", color: "#d97706", on: true },
    { id: "net", label: "Чистыми", color: "#6366f1", dashed: true, on: false },
  ];
  const LINE_CHARTS = ["dash", "analytics"];
  const LINE_LEGEND_ID = { dash: "dash-line-legend", analytics: "an-line-legend" };

  function defaultLineSeries() {
    const out = {};
    LINE_METRICS.forEach((m) => {
      out[m.id] = !!m.on;
    });
    return out;
  }

  function sanitizeLineSeries(raw) {
    const out = defaultLineSeries();
    if (raw && typeof raw === "object") {
      LINE_METRICS.forEach((m) => {
        if (typeof raw[m.id] === "boolean") out[m.id] = raw[m.id];
      });
    }
    if (LINE_METRICS.every((m) => !out[m.id])) out.after = true;
    return out;
  }

  function sanitizeChartSeries(raw) {
    const blank = () => ({ dash: defaultLineSeries(), analytics: defaultLineSeries() });
    if (!raw || typeof raw !== "object") return blank();
    const flat = LINE_METRICS.some((m) => typeof raw[m.id] === "boolean") && raw.dash == null && raw.analytics == null;
    if (flat) {
      const shared = sanitizeLineSeries(raw);
      return { dash: { ...shared }, analytics: { ...shared } };
    }
    return {
      dash: sanitizeLineSeries(raw.dash),
      analytics: sanitizeLineSeries(raw.analytics),
    };
  }

  function loadStoredChartSeries() {
    try {
      return sanitizeChartSeries(JSON.parse(localStorage.getItem(LS_CHARTS) || "null"));
    } catch {
      return sanitizeChartSeries(null);
    }
  }

  const chartPrefs = { series: loadStoredChartSeries() };

  function persistChartPrefs() {
    const payload = sanitizeChartSeries(chartPrefs.series);
    chartPrefs.series = payload;
    try {
      localStorage.setItem(LS_CHARTS, JSON.stringify(payload));
    } catch {
      /* ignore */
    }
    if (state.doc) ensureUi().line_series = payload;
  }

  function adoptChartsFromDocument() {
    const saved = state.doc?.ui?.line_series;
    if (saved && typeof saved === "object" && Object.keys(saved).length) {
      chartPrefs.series = sanitizeChartSeries(saved);
    }
    persistChartPrefs();
  }

  function lineChartId(canvas) {
    return canvas?.id === "chart-an-line" ? "analytics" : "dash";
  }

  function lineSeriesOn(chart) {
    const id = LINE_CHARTS.includes(chart) ? chart : "dash";
    return chartPrefs.series[id] || defaultLineSeries();
  }

  function renderLineLegend(chart) {
    const on = lineSeriesOn(chart);
    const el = $(LINE_LEGEND_ID[chart] || LINE_LEGEND_ID.dash);
    if (!el) return;
    el.innerHTML = LINE_METRICS.map(
      (m) =>
        `<button type="button" class="chart-leg ${on[m.id] ? "on" : ""}" data-line-chart="${chart}" data-line-series="${m.id}" title="${on[m.id] ? "Скрыть ряд" : "Показать ряд"}">
          <i style="background:${m.color}"></i>${m.label}
        </button>`
    ).join("");
  }

  function trendDatasets(rows, group, dateField, lastN, chart) {
    const map = new Map();
    rows.forEach(({ line, totals }) => {
      const k = groupKey(line[dateField] || line.order_date, group);
      let b = map.get(k);
      if (!b) {
        b = { after: 0, paid: 0, unpaid: 0, cost: 0 };
        map.set(k, b);
      }
      if (totals.expense) b.cost += totals.cost;
      else {
        b.after += totals.after;
        b.paid += totals.paid;
        b.unpaid += totals.unpaid;
      }
    });
    let labels = [...map.keys()].sort();
    if (lastN) labels = labels.slice(-lastN);
    const on = lineSeriesOn(chart);
    const datasets = LINE_METRICS.filter((m) => on[m.id]).map((m) => ({
      label: m.label,
      color: m.color,
      fill: !!m.fill,
      dashed: !!m.dashed,
      values: labels.map((k) => {
        const b = map.get(k) || { after: 0, paid: 0, unpaid: 0, cost: 0 };
        if (m.id === "net") return round2(b.after - b.cost);
        return b[m.id] || 0;
      }),
    }));
    return { labels, datasets };
  }

  function paintTrendLine(canvas, rows, group, dateField, lastN) {
    const chart = lineChartId(canvas);
    renderLineLegend(chart);
    if (!canvas) return;
    const { labels, datasets } = trendDatasets(rows, group, dateField, lastN, chart);
    lineZoomData[chart] = { canvas, labels, datasets };
    bindLineZoom(canvas, chart);
    paintLineZoomed(chart);
  }

  /* ---- Масштаб линейных графиков дашборда и аналитики ---- */

  const LINE_ZOOM_ID = { dash: "dash-line-zoom", analytics: "an-line-zoom" };
  const LINE_ZOOM_PRESETS = {
    dash: [
      ["all", "Всё"],
      ["90", "3 мес"],
      ["30", "Месяц"],
      ["14", "2 нед"],
    ],
    analytics: [
      ["all", "Всё"],
      ["365", "Год"],
      ["90", "3 мес"],
      ["30", "Месяц"],
    ],
  };
  const lineZoom = {
    dash: { preset: "14", fromKey: "", toKey: "" },
    analytics: { preset: "all", fromKey: "", toKey: "" },
  };
  const lineZoomData = {};

  function zoomKeyDate(key) {
    const m = /(\d{4})-(\d{2})(?:-(\d{2}))?/.exec(String(key || ""));
    return m ? `${m[1]}-${m[2]}-${m[3] || "01"}` : "";
  }

  /** Видимый отрезок: индексы from..to включительно (минимум 3 точки). */
  function lineZoomRange(chart, labels) {
    const n = labels.length;
    const all = { from: 0, to: Math.max(0, n - 1) };
    const z = lineZoom[chart];
    if (n < 4 || !z) return all;
    if (z.preset) {
      const days = Number(z.preset);
      const dated = labels.map(zoomKeyDate);
      const last = [...dated].reverse().find(Boolean);
      if (!days || !last) return all;
      const d = new Date(`${last}T00:00:00`);
      d.setDate(d.getDate() - days);
      const edge = dayKey(d);
      let from = dated.findIndex((iso) => iso && iso > edge);
      if (from < 0) from = n - 3;
      return { from: Math.min(from, n - 3), to: n - 1 };
    }
    let from = labels.findIndex((k) => k >= z.fromKey);
    let to = labels.findLastIndex((k) => k <= z.toKey);
    if (from < 0) from = Math.max(0, n - 3);
    if (to < 0 || to < from) to = n - 1;
    if (to - from < 2) {
      to = Math.min(n - 1, from + 2);
      from = Math.max(0, to - 2);
    }
    return { from, to };
  }

  function setLineZoom(chart, labels, from, to) {
    const z = lineZoom[chart];
    if (from <= 0 && to >= labels.length - 1) {
      z.preset = "all";
      return;
    }
    z.preset = "";
    z.fromKey = labels[from];
    z.toKey = labels[to];
  }

  function renderLineZoomBar(chart, range, n) {
    const el = $(LINE_ZOOM_ID[chart]);
    if (!el) return;
    const data = lineZoomData[chart];
    const z = lineZoom[chart];
    el.hidden = n < 4;
    if (n < 4) return;
    const presets = LINE_ZOOM_PRESETS[chart]
      .map(
        ([id, label]) =>
          `<button type="button" class="chart-leg zoom-preset ${z.preset === id ? "on" : ""}" data-line-zoom="${chart}" data-zoom-preset="${id}">${label}</button>`
      )
      .join("");
    el.innerHTML = `<div class="chart-zoom-presets">${presets}</div>
      <span class="chart-zoom-range">${esc(data.labels[range.from])} — ${esc(data.labels[range.to])} · ${range.to - range.from + 1} из ${n}</span>
      <span class="chart-zoom-hint">колесо — масштаб · перетаскивание — сдвиг · двойной клик — всё</span>`;
  }

  function paintLineZoomed(chart, { instant = false } = {}) {
    const data = lineZoomData[chart];
    if (!data?.canvas) return;
    const n = data.labels.length;
    const range = lineZoomRange(chart, data.labels);
    FinCharts.line(data.canvas, {
      labels: data.labels.slice(range.from, range.to + 1),
      datasets: data.datasets.map((ds) => ({ ...ds, values: ds.values.slice(range.from, range.to + 1) })),
      instant,
    });
    renderLineZoomBar(chart, range, n);
  }

  /** Колесо, перетаскивание и двойной клик. Отступы — как у FinCharts.line. */
  function bindLineZoom(canvas, chart) {
    if (canvas.dataset.lineZoomBound) return;
    canvas.dataset.lineZoomBound = "1";
    const PAD_L = 58;
    const PAD_R = 18;
    canvas.addEventListener(
      "wheel",
      (e) => {
        const data = lineZoomData[chart];
        const n = data?.labels.length || 0;
        if (n < 4) return;
        e.preventDefault();
        const rect = canvas.getBoundingClientRect();
        const r = Math.min(1, Math.max(0, (e.clientX - rect.left - PAD_L) / Math.max(1, rect.width - PAD_L - PAD_R)));
        const { from, to } = lineZoomRange(chart, data.labels);
        const span = to - from;
        const next = Math.min(n - 1, Math.max(2, Math.round(span * (e.deltaY > 0 ? 1.25 : 0.8))));
        if (next === span) return;
        let nf = Math.round(from + r * span - r * next);
        nf = Math.max(0, Math.min(nf, n - 1 - next));
        setLineZoom(chart, data.labels, nf, nf + next);
        paintLineZoomed(chart, { instant: true });
      },
      { passive: false }
    );
    let drag = null;
    canvas.addEventListener("pointerdown", (e) => {
      const data = lineZoomData[chart];
      if (e.button !== 0 || !data || lineZoom[chart].preset === "all") return;
      drag = { x: e.clientX, ...lineZoomRange(chart, data.labels) };
      canvas.setPointerCapture?.(e.pointerId);
      canvas.classList.add("is-panning");
    });
    canvas.addEventListener("pointermove", (e) => {
      const data = lineZoomData[chart];
      if (!drag || !data) return;
      const n = data.labels.length;
      const rect = canvas.getBoundingClientRect();
      const span = drag.to - drag.from;
      const perPoint = Math.max(1, rect.width - PAD_L - PAD_R) / Math.max(1, span);
      const nf = Math.max(0, Math.min(drag.from + Math.round((drag.x - e.clientX) / perPoint), n - 1 - span));
      if (nf === lineZoomRange(chart, data.labels).from) return;
      setLineZoom(chart, data.labels, nf, nf + span);
      paintLineZoomed(chart, { instant: true });
    });
    const stop = () => {
      drag = null;
      canvas.classList.remove("is-panning");
    };
    canvas.addEventListener("pointerup", stop);
    canvas.addEventListener("pointercancel", stop);
    canvas.addEventListener("dblclick", () => {
      lineZoom[chart].preset = "all";
      paintLineZoomed(chart, { instant: true });
    });
  }

  function renderDashboard() {
    renderDashFocus();
    renderKpis();
    renderInsights();
    const rows = dashRows();
    paintTrendLine($("chart-dash-line"), rows, "day", "order_date");
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

    const focus = focusedOrder();
    const last = focus
      ? [focus]
      : (() => {
          const seen = [];
          const ids = new Set();
          for (const { order } of [...rows].reverse()) {
            if (ids.has(order.id)) continue;
            ids.add(order.id);
            seen.push(order);
            if (seen.length >= 8) break;
          }
          return seen.length ? seen : [...(state.doc.orders || [])].slice(-8).reverse();
        })();
    $("recent-orders").innerHTML = last.length
      ? `<table class="data"><thead><tr><th>№</th><th>Заказчик</th><th>Название</th><th>Итог</th></tr></thead><tbody>${last
          .map((o) => `<tr><td>${esc(o.number)}</td><td>${esc(o.customer)}</td><td>${esc(o.name)}</td><td class="num">${esc(money(orderTotals(o).after))}</td></tr>`)
          .join("")}</tbody></table>`
      : `<div class="empty">Заказов ещё нет</div>`;
  }

  function renderDashFocus() {
    const box = $("dash-focus");
    if (!box) return;
    const order = focusedOrder();
    const sub = $("insights-sub");
    if (!order && remoteStatsActive()) {
      box.hidden = false;
      box.innerHTML = `
        <div class="focus-head">
          <span class="focus-tag">с телефона</span>
          <b>Сводка</b>
          <span class="focus-name">${esc(remoteStatsLabel())}</span>
          <div class="focus-acts">
            <button class="btn small" type="button" id="focus-clear">Весь отчёт</button>
          </div>
        </div>`;
      if (sub) sub.textContent = `фильтры сводки: ${remoteStatsLabel()}`;
      return;
    }
    if (!order) {
      box.hidden = true;
      box.innerHTML = "";
      if (sub) sub.textContent = "считаются по всем заказам отчёта";
      return;
    }
    if (sub) sub.textContent = `только заказ №${order.number || "—"}`;
    const t = orderTotals(order);
    const lines = order.lines || [];
    box.hidden = false;
    box.innerHTML = `
      <div class="focus-head">
        <span class="focus-tag">с телефона</span>
        <b>№${esc(order.number || "—")}</b>
        <span class="focus-name">${esc(order.name || "без названия")}</span>
        <span class="focus-cust">${esc(order.customer || "без заказчика")}</span>
        <div class="focus-acts">
          <button class="btn small" type="button" id="focus-open">Открыть в заказах</button>
          <button class="btn small" type="button" id="focus-clear">Весь отчёт</button>
        </div>
      </div>
      <div class="focus-sums">
        <div class="focus-sum"><span>Позиций</span><b>${lines.length}</b></div>
        <div class="focus-sum"><span>К оплате</span><b>${esc(money(t.after))}</b></div>
        <div class="focus-sum ok"><span>Оплачено</span><b>${esc(money(t.paid))}</b></div>
        <div class="focus-sum ${t.unpaid > 0.005 ? "warn" : ""}"><span>Долг</span><b>${esc(money(t.unpaid))}</b></div>
        ${
          t.cost > 0.005
            ? `<div class="focus-sum warn"><span>Расход</span><b>−${esc(money(t.cost))}</b></div>
        <div class="focus-sum ${t.net >= 0 ? "ok" : "warn"}"><span>Чистыми</span><b>${esc(money(t.net))}</b></div>`
            : ""
        }
      </div>
      <div class="table-wrap">
        <table class="data"><thead><tr><th>Тип</th><th>Позиция</th><th class="num">Кол-во</th><th class="num">Цена</th><th class="num">Итог</th><th class="num">Долг</th><th>Статус</th></tr></thead>
        <tbody>${
          lines.length
            ? lines
                .map((line) => {
                  const lt = lineTotals(line);
                  const label = lt.expense ? `${line.order_type || "—"} · ${kindLabel(lt.kind)}` : line.order_type || "—";
                  const rowCls = [lt.expense ? "is-expense" : "", isFrozenLine(line) ? "is-frozen" : ""].filter(Boolean).join(" ");
                  return `<tr class="${rowCls}"><td>${esc(label)}</td><td>${esc(line.product || "—")}</td>
                  <td class="num">${esc(`${qtyValue(line)} ${line.unit || ""}`.trim())}</td>
                  <td class="num">${esc(money(numExpr(line, "price_expr", "price")))}</td>
                  <td class="num">${lt.expense ? `−${esc(money(lt.cost))}` : esc(money(lt.after))}</td>
                  <td class="num">${lt.unpaid > 0.005 ? esc(money(lt.unpaid)) : "—"}</td>
                  <td>${
                    lt.expense
                      ? `<span class="pill expense-pill">${esc(kindLabel(lt.kind))}</span>`
                      : `<span class="pill" style="background:${statusMeta(line.status).color}">${esc(line.status || "—")}</span>`
                  }</td></tr>`;
                })
                .join("")
            : `<tr><td colspan="7">В заказе нет позиций</td></tr>`
        }</tbody></table>
      </div>
      ${order.notes ? `<div class="focus-notes">${esc(order.notes)}</div>` : ""}`;
  }

  function setFocusOrder(id, lineId) {
    const nextOrder = id || null;
    const nextLine = nextOrder ? (lineId || null) : null;
    const same = state.focusOrderId === nextOrder && state.focusLineId === nextLine;
    state.focusOrderId = nextOrder;
    state.focusLineId = nextLine;
    if (state.view === "cloud") {
      if (nextOrder) {
        renderCloud();
        applyCloudFocus({ fly: !same });
      }
      return;
    }
    if (state.view === "dashboard") renderDashboard();
    else setView("dashboard");
  }

  function applyCloudFocus({ fly = false } = {}) {
    if (state.view !== "cloud" || !orderCloud || !state.focusOrderId || cloudState().catalog) return;
    const lineId = state.focusLineId ? `line:${state.focusOrderId}:${state.focusLineId}` : "";
    const orderId = `order:${state.focusOrderId}`;
    const node = (lineId && orderCloud.findNode(lineId)) || orderCloud.findNode(orderId);
    if (!node) return;
    if (fly) orderCloud.focus(node.data.id);
    else if (orderCloud.selected !== node) orderCloud.select(node);
  }

  const EXPR_MAP = {
    qty_expr: "quantity",
    price_expr: "price",
    discount_expr: "discount",
    paid_expr: "paid",
    tax_percent_expr: "tax_percent",
  };
  const DECIMAL_KEYS = new Set(["qty_expr", "price_expr", "discount_expr", "tax_percent_expr"]);

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

  function isBareZeroExpr(value) {
    return /^0([.,]0+)?$/.test(String(value || "").trim());
  }

  function stripLeadingZerosPlain(raw) {
    const text = String(raw ?? "").replaceAll(",", ".");
    if (!text || isFormula(text)) return String(raw ?? "");
    const m = /^(-?)0+(\d+(?:\.\d*)?)$/.exec(text);
    return m ? m[1] + m[2] : text;
  }

  function shownExpr(line, exprKey) {
    const expr = exprRaw(line, exprKey);
    const v = evalExpr(expr);
    if (isFormula(expr) && Number.isFinite(v)) return formatQty(v);
    return expr;
  }

  function exprInput(line, exprKey, extra = "", lockReason = "") {
    const raw = exprRaw(line, exprKey);
    const formula = isFormula(raw);
    const locked = !!lockReason;
    const lockAttr = locked
      ? `readonly disabled data-calc-lock="1" title="${esc(lockReason)}"`
      : extra;
    return `<input data-lk="${exprKey}" class="expr-field${locked ? " is-calc-locked" : ""}" inputmode="decimal" placeholder="1+2*6" ${lockAttr}
      value="${esc(shownExpr(line, exprKey))}" data-expr="${esc(raw)}" data-showing="${formula ? "result" : "expr"}"
      title="${locked ? esc(lockReason) : "Можно формулу. Клик — правка, вне фокуса — результат."}" />`;
  }

  function calcLockFor(orderId, lineId, fieldOrExpr) {
    try {
      return window.FinCalc?.orderFieldLock?.(orderId, lineId, fieldOrExpr) || null;
    } catch {
      return null;
    }
  }

  function statusColor(name) {
    return statusMeta(name).color || "#64748b";
  }

  function applyRowStatus(tr, statusName) {
    if (!tr || tr.classList.contains("cost-row")) return;
    tr.style.setProperty("--status-color", statusColor(statusName));
  }

  function optionList(values, selected) {
    return values.map((v) => `<option ${v === selected ? "selected" : ""}>${esc(v)}</option>`).join("");
  }

  const openLineNotes = new Set();
  const openFrozenOrders = new Set();

  function lineHasNote(line) {
    return !!String(line?.notes || "").trim();
  }

  function lineNoteRow(line, cols) {
    const open = openLineNotes.has(line.id);
    return `<tr class="line-note-row${open ? " open" : ""}" data-line="${line.id}">
      <td colspan="${cols}"><div class="line-note">
        <textarea data-lk="notes" rows="2" maxlength="2000" placeholder="Комментарий к позиции">${esc(line.notes || "")}</textarea>
      </div></td>
    </tr>`;
  }

  const ORDER_COLS = [
    ["drag", "", 28],
    ["order_type", "Тип заказа", 130],
    ["product", "Продукт", 150],
    ["qty_expr", "Кол-во", 90],
    ["unit", "Ед.", 72],
    ["price", "Цена", 90],
    ["discount", "Скидка %", 80],
    ["order_date", "Дата заказа", 132],
    ["paid", "Оплачено", 90],
    ["payment_date", "Дата оплаты", 132],
    ["unpaid", "Не оплачено", 110],
    ["total", "Итог", 120],
    ["status", "Статус", 140],
    ["actions", "", 118],
  ];

  function ensureUi() {
    if (!state.doc.ui || typeof state.doc.ui !== "object") state.doc.ui = { sidebar_collapsed: false, column_widths: {} };
    if (!state.doc.ui.column_widths || typeof state.doc.ui.column_widths !== "object") state.doc.ui.column_widths = {};
    if (!Array.isArray(state.doc.ui.share_fields)) state.doc.ui.share_fields = [];
    return state.doc.ui;
  }

  function colWidth(key, fallback) {
    const w = Number(ensureUi().column_widths[key]);
    const min = key === "drag" ? 24 : key === "actions" ? 86 : 52;
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
              <input type="date" data-g="${key}" />
            </span>`
          : "";
      const resize = key === "actions" || key === "drag" ? "" : `<span class="col-resizer" data-col="${key}"></span>`;
      return `<th data-col="${key}"><span class="th-title">${label}</span>${cal}${resize}</th>`;
    }).join("");
  }

  function bindNavFlyout() {
    const nav = $("nav");
    if (!nav || nav.dataset.flyout) return;
    nav.dataset.flyout = "1";
    const place = (btn, open) => {
      const label = btn.querySelector(".nav-label");
      if (!label) return;
      if (!open || !$("app-shell")?.classList.contains("sidebar-collapsed")) {
        label.classList.remove("is-out");
        label.style.left = "";
        label.style.top = "";
        label.style.height = "";
        return;
      }
      const rect = btn.getBoundingClientRect();
      label.style.left = `${Math.round(rect.right)}px`;
      label.style.top = `${Math.round(rect.top)}px`;
      label.style.height = `${Math.round(rect.height)}px`;
      label.classList.add("is-out");
    };
    nav.querySelectorAll("button").forEach((btn) => {
      btn.addEventListener("mouseenter", () => place(btn, true));
      btn.addEventListener("focus", () => place(btn, true));
      btn.addEventListener("mouseleave", () => place(btn, false));
      btn.addEventListener("blur", () => place(btn, false));
    });
  }

  function applySidebar() {
    const shell = $("app-shell");
    if (!shell || !state.doc) return;
    const collapsed = !!ensureUi().sidebar_collapsed;
    shell.classList.toggle("sidebar-collapsed", collapsed);
    bindNavFlyout();
    shell.querySelectorAll(".nav button").forEach((tab) => {
      tab.removeAttribute("title");
      tab.removeAttribute("data-tip");
      tab.setAttribute("data-no-tip", "1");
      if (!collapsed) tab.querySelector(".nav-label")?.classList.remove("is-out");
    });
    const btn = $("btn-toggle-sidebar");
    if (btn) {
      btn.title = collapsed ? "Развернуть панель" : "Свернуть панель";
      btn.setAttribute("aria-label", btn.title);
    }
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

  function customerIsBlank(c) {
    return !String(c.organization || "").trim()
      && !String(c.phone || "").trim()
      && !String(c.email || "").trim()
      && !String(c.address || "").trim()
      && !(Number(c.rating) > 0);
  }

  /** Обрывки вроде «Я», «Ян», если в заказах уже есть полное имя. */
  function pruneDraftCustomers() {
    const list = state.doc.customers || [];
    if (!list.length) return;
    const used = new Set();
    for (const order of state.doc.orders || []) {
      const key = catalogNameKey(order.customer);
      if (key) used.add(key);
    }
    const keys = list.map((c) => catalogNameKey(c.name));
    const next = list.filter((c, i) => {
      const key = keys[i];
      if (!key) return false;
      if (used.has(key)) return true;
      if (!customerIsBlank(c)) return true;
      return !keys.some((other, j) => j !== i && other.startsWith(key) && other.length > key.length);
    });
    if (next.length !== list.length) state.doc.customers = next;
  }

  function syncCustomersFromOrders() {
    const list = state.doc.customers || (state.doc.customers = []);
    list.forEach((c) => {
      if (!c.id) c.id = uid();
    });
    (state.doc.orders || []).forEach((order) => {
      const name = String(order.customer || "").trim();
      if (!name) return;
      if (!list.some((c) => catalogNameKey(c.name) === catalogNameKey(name))) {
        list.push({ id: uid(), name, organization: "", phone: "", email: "", address: "", rating: 0 });
      }
    });
    pruneDraftCustomers();
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
    closeProductSuggest();
    const orders = filteredOrders();
    renderOrderChips();
    updateOrdersSummary();
    if (!orders.length) {
      const filtered = state.orderFilter !== "all" || state.search.trim();
      $("orders-list").innerHTML = filtered
        ? `<div class="card empty">Под фильтр ничего не подошло. Сбросьте фильтр или поиск.</div>`
        : `<div class="card empty">Нет заказов. Нажмите «+ Заказ», чтобы добавить первый.</div>`;
      return;
    }
    const statusNames = (state.doc.statuses || []).map((s) => s.name);
    const units = state.doc.units || [];
    const types = typeNames();
    const canExpense = typeNames("expense").length > 0;
    $("orders-list").innerHTML = orders
      .map((order) => {
        const tot = orderTotals(order);
        const { income, expense, frozen } = splitLines(order.lines);
        const ctx = { statusNames, units, types, order };
        return `<article class="order-card" data-order="${order.id}">
          <div class="order-head">
            <div class="field"><label>Номер заказа</label><input data-k="number" value="${esc(order.number)}" /></div>
            <div class="field"><label>Заказчик</label><input data-k="customer" data-suggest="customer" autocomplete="off" spellcheck="false" value="${esc(order.customer)}" /></div>
            <div class="field"><label>Название заказа</label><input data-k="name" value="${esc(order.name)}" /></div>
            <div class="order-head-actions">
              <button type="button" class="note-btn ${order.notes ? "has-note" : ""}" data-act="notes" title="Заметки к заказу" aria-label="Заметки к заказу">i</button>
              <button class="btn small" data-act="share">Снимок</button>
              <button class="btn small" data-act="dup">Дублировать</button>
              <button class="btn small danger" data-act="del">Удалить</button>
            </div>
          </div>
          <div class="order-work">
            <div class="field"><label>Начало работ</label><input data-k="work_start" type="date" value="${esc(dateDay(order.work_start))}" /></div>
            <div class="field"><label>Конец работ</label><input data-k="work_end" type="date" value="${esc(dateDay(order.work_end))}" /></div>
            <span class="work-pill work-pill-${esc(workStatusMeta(order).id)}">${esc(workStatusMeta(order).label)}</span>
            <button class="btn small" type="button" data-act="work-start-today" title="Поставить начало на сегодня">Начать сегодня</button>
            <button class="btn small" type="button" data-act="work-end-today" title="Поставить конец на сегодня">Закончить сегодня</button>
          </div>
          <div class="order-notes">
            <label>Заметки к заказу</label>
            <textarea data-k="notes" rows="3" placeholder="Комментарий, договорённости, детали…">${esc(order.notes || "")}</textarea>
          </div>
          <div class="order-globals">
            <div class="field"><label>Тип всем строкам</label>
              <select data-g="order_type"><option value="">— не менять —</option>${optionList(typeNames("income"), "")}</select>
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
                ${
                  income.length
                    ? income.map((line) => orderLineRow(line, ctx) + lineNoteRow(line, ORDER_COLS.length)).join("")
                    : `<tr><td colspan="${ORDER_COLS.length}" class="empty-cell">${frozen.length ? "Все позиции заморожены — они ниже, в отдельном блоке." : expense.length ? "Доходных позиций нет — только расходы. Нажмите «+ Тип заказа»." : "Нет позиций. Нажмите «+ Тип заказа»."}</td></tr>`
                }
              </tbody>
            </table>
          </div>
          ${orderExpensesHtml(expense, tot, { ...ctx, order })}
          ${orderFrozenHtml(frozen, { ...ctx, order })}
          <div class="order-foot">
            <button class="btn small" data-act="addline">+ Тип заказа</button>
            ${canExpense ? `<button class="btn small" data-act="addcost" title="Строка налога или затраты — вычитается из заказа">+ Расход</button>` : ""}
            <div class="totals">${orderTotalsHtml(tot)}</div>
          </div>
        </article>`;
      })
      .join("");
  }

  function orderTotalsHtml(tot) {
    const base = `Итог <b>${esc(money(tot.after))}</b> · оплачено <b>${esc(money(tot.paid))}</b> · не оплачено <b>${esc(money(tot.unpaid))}</b>`;
    if (tot.cost <= 0.005) return base;
    return `${base} · расход <b class="cost">−${esc(money(tot.cost))}</b> · чистыми <b>${esc(money(tot.net))}</b>`;
  }

  function orderLineRow(line, { statusNames, units, types, order }) {
    const t = lineTotals(line);
    const oid = order?.id || "";
    const lockQty = calcLockFor(oid, line.id, "qty");
    const lockPrice = calcLockFor(oid, line.id, "price");
    const lockDisc = calcLockFor(oid, line.id, "discount");
    const lockPaid = calcLockFor(oid, line.id, "paid");
    return `<tr data-line="${line.id}" class="line-row${isFrozenLine(line) ? " is-frozen" : ""}" style="--status-color:${esc(statusColor(line.status))}">
      <td class="line-drag" title="Перетащить строку. Правый клик — заморозить"><span></span></td>
      <td><select data-lk="order_type">${optionList(unique([line.order_type, ...types]), line.order_type)}</select></td>
      <td><input data-lk="product" data-suggest="product" autocomplete="off" spellcheck="false" value="${esc(line.product)}" /></td>
      <td class="num">${exprInput(line, "qty_expr", "", lockQty?.reason || "")}</td>
      <td><select data-lk="unit">${optionList(unique([line.unit, ...units]), line.unit)}</select></td>
      <td class="num">${exprInput(line, "price_expr", "", lockPrice?.reason || "")}</td>
      <td class="num">${exprInput(line, "discount_expr", "", lockDisc?.reason || "")}</td>
      <td><input data-lk="order_date" type="date" value="${esc(dateDay(line.order_date))}" /></td>
      <td class="num">${exprInput(line, "paid_expr", "", lockPaid?.reason || "")}</td>
      <td><input data-lk="payment_date" type="date" value="${esc(dateDay(line.payment_date))}" /></td>
      <td class="num computed">${esc(money(t.unpaid))}</td>
      <td class="num computed">${esc(money(t.after))}<div style="color:#94a3b8;font-weight:500;font-size:11px">до скидки ${esc(money(t.total))}</div></td>
      <td><select data-lk="status">${optionList(unique([line.status, ...statusNames]), line.status)}</select></td>
      <td><div class="row-actions">
        <button type="button" class="note-btn ${lineHasNote(line) ? "has-note" : ""}" data-act="linenotes" title="Комментарий к позиции" aria-label="Комментарий к позиции">i</button>
        <button class="btn icon small" data-act="dupline" title="Дублировать строку (Ctrl+Alt+D)">⧉</button>
        <button class="btn icon small danger" data-act="delline" title="Удалить строку">✕</button>
      </div></td>
    </tr>`;
  }

  const TAX_MODES = [
    ["gross", "% от выручки"],
    ["net", "% от выручки − затраты"],
    ["amount", "своя сумма"],
  ];

  function orderCostRow(line, { units, types, order }) {
    const t = lineTotals(line, order);
    const oid = order?.id || "";
    const lockQty = calcLockFor(oid, line.id, "qty");
    const lockPrice = calcLockFor(oid, line.id, "price");
    const lockPercent = calcLockFor(oid, line.id, "percent");
    const calc =
      t.kind === "tax"
        ? `<select data-lk="tax_mode" title="Своя сумма или процент от заказа">${TAX_MODES.map(
            ([id, label]) => `<option value="${id}" ${id === t.mode ? "selected" : ""}>${esc(label)}</option>`
          ).join("")}</select>`
        : `<span class="cost-calc">своя сумма</span>`;
    const amount =
      t.mode === "amount"
        ? `<td class="num">${exprInput(line, "qty_expr", "", lockQty?.reason || "")}</td>
      <td><select data-lk="unit">${optionList(unique([line.unit, ...units]), line.unit)}</select></td>
      <td class="num">${exprInput(line, "price_expr", "", lockPrice?.reason || "")}</td>`
        : `<td class="num" colspan="3">
        <div class="tax-percent">${exprInput(line, "tax_percent_expr", "", lockPercent?.reason || "")}<span class="tax-of">% от ${esc(money(t.base))}</span></div>
      </td>`;
    return `<tr data-line="${line.id}" class="line-row cost-row${isFrozenLine(line) ? " is-frozen" : ""}">
      <td class="line-drag" title="Перетащить строку. Правый клик — заморозить"><span></span></td>
      <td><select data-lk="order_type">${optionList(unique([line.order_type, ...types]), line.order_type)}</select></td>
      <td><span class="cost-kind ${esc(t.kind)}">${esc(kindLabel(t.kind))}</span></td>
      <td><input data-lk="product" data-suggest="product" autocomplete="off" spellcheck="false" value="${esc(line.product)}" placeholder="за что" /></td>
      <td>${calc}</td>
      ${amount}
      <td><input data-lk="order_date" type="date" value="${esc(dateDay(line.order_date))}" /></td>
      <td class="num computed">−${esc(money(t.cost))}</td>
      <td><div class="row-actions">
        <button type="button" class="note-btn ${lineHasNote(line) ? "has-note" : ""}" data-act="linenotes" title="Комментарий к позиции" aria-label="Комментарий к позиции">i</button>
        <button class="btn icon small" data-act="dupline" title="Дублировать строку">⧉</button>
        <button class="btn icon small danger" data-act="delline" title="Удалить строку">✕</button>
      </div></td>
    </tr>`;
  }

  function orderExpensesHtml(expense, tot, ctx) {
    if (!expense.length) return "";
    return `<div class="order-expenses">
      <div class="oe-head"><span class="oe-title">Расходы заказа</span>
        <span class="oe-sum">−${esc(money(tot.cost))} · чистыми ${esc(money(tot.net))}</span>
      </div>
      <div class="table-wrap">
        <table class="data cost-table">
          <thead><tr>
            <th></th><th>Тип</th><th>Вид</th><th>За что</th><th>Расчёт</th><th class="num">Кол-во</th><th>Ед.</th>
            <th class="num">Сумма за ед.</th><th>Дата</th><th class="num">Итог</th><th></th>
          </tr></thead>
          <tbody>${expense.map((line) => orderCostRow(line, ctx) + lineNoteRow(line, 11)).join("")}</tbody>
        </table>
      </div>
    </div>`;
  }

  function orderFrozenHtml(frozen, ctx) {
    if (!frozen.length) return "";
    const open = openFrozenOrders.has(ctx.order?.id);
    const income = frozen.filter((line) => !isExpenseLine(line));
    const expense = frozen.filter((line) => isExpenseLine(line));
    return `<div class="order-frozen${open ? "" : " collapsed"}">
      <button type="button" class="oe-head" data-act="toggle-frozen" aria-expanded="${open ? "true" : "false"}">
        <span class="oe-title"><span class="frozen-ico" aria-hidden="true">▾</span>Замороженные позиции</span>
        <span class="oe-sum">${frozen.length} · не учитываются нигде</span>
      </button>
      <div class="order-frozen-body">
      ${
        income.length
          ? `<div class="table-wrap">
        <table class="data">
          ${colgroupHtml()}
          <thead><tr>${orderHeadHtml()}</tr></thead>
          <tbody>${income.map((line) => orderLineRow(line, ctx) + lineNoteRow(line, ORDER_COLS.length)).join("")}</tbody>
        </table>
      </div>`
          : ""
      }
      ${
        expense.length
          ? `<div class="table-wrap">
        <table class="data cost-table">
          <thead><tr>
            <th></th><th>Тип</th><th>Вид</th><th>За что</th><th>Расчёт</th><th class="num">Кол-во</th><th>Ед.</th>
            <th class="num">Сумма за ед.</th><th>Дата</th><th class="num">Итог</th><th></th>
          </tr></thead>
          <tbody>${expense.map((line) => orderCostRow(line, ctx) + lineNoteRow(line, 11)).join("")}</tbody>
        </table>
      </div>`
          : ""
      }
      </div>
    </div>`;
  }

  function productKind(item) {
    const k = String(item?.kind || "order").toLowerCase();
    return k === "cost" || k === "tax" ? k : "order";
  }

  function productKindOfLine(line) {
    const k = typeKind(line?.order_type);
    if (k === "tax") return "tax";
    if (k === "cost") return "cost";
    return "order";
  }

  function productEntry(item) {
    if (item && typeof item === "object" && !Array.isArray(item)) {
      const kind = productKind(item);
      return {
        name: String(item.name || "").trim(),
        unit: String(item.unit || "").trim(),
        price: Math.max(0, round2(item.price)),
        kind,
        tax_percent: kind === "tax" ? Math.max(0, round2(item.tax_percent)) : 0,
      };
    }
    return { name: String(item || "").trim(), unit: "", price: 0, kind: "order", tax_percent: 0 };
  }

  function catalogNameKey(name) {
    return String(name || "").trim().replace(/\s+/g, " ").toLocaleLowerCase("ru");
  }

  function catalogNameConflict(names, candidate, skipIndex) {
    const key = catalogNameKey(candidate);
    if (!key) return "empty";
    const dup = names.some((name, i) => i !== skipIndex && catalogNameKey(name) === key);
    return dup ? "dup" : "";
  }

  function uniqueCatalogName(names, base) {
    const root = String(base || "").trim() || "Без имени";
    if (!catalogNameConflict(names, root, -1)) return root;
    let n = 2;
    while (catalogNameConflict(names, `${root} ${n}`, -1)) n += 1;
    return `${root} ${n}`;
  }

  function catalogConflictMessage(conflict) {
    if (conflict === "dup") return "Такое имя уже есть в справочнике";
    if (conflict === "empty") return "Имя не может быть пустым";
    return "";
  }

  function setCatalogNameState(input, conflict) {
    input.classList.toggle("invalid", !!conflict);
    input.title = catalogConflictMessage(conflict);
  }

  /** Дубликат и пустое имя не пишутся в модель — можно дописать текст дальше. */
  function tryCatalogName(input, names, index) {
    const conflict = catalogNameConflict(names, input.value, index);
    setCatalogNameState(input, conflict);
    return conflict ? null : input.value;
  }

  function finishCatalogName(input, names, index, saved) {
    const trimmed = String(input.value || "").trim().replace(/\s+/g, " ");
    input.value = trimmed;
    const conflict = catalogNameConflict(names, trimmed, index);
    if (!conflict) {
      setCatalogNameState(input, "");
      return trimmed;
    }
    input.value = saved;
    setCatalogNameState(input, "");
    toast(catalogConflictMessage(conflict));
    return null;
  }

  function catalogNameAttrs(names, name, index) {
    const conflict = catalogNameConflict(names, name, index);
    return conflict ? ` class="invalid" title="${esc(catalogConflictMessage(conflict))}"` : "";
  }

  function normalizeProducts() {
    if (!state.doc) return;
    const units = state.doc.units || [];
    const fallback = units[0] || "шт.";
    const seen = new Set();
    const next = [];
    for (const item of state.doc.products || []) {
      const entry = productEntry(item);
      const key = `${entry.kind}:${catalogNameKey(entry.name)}`;
      if (!entry.name || !catalogNameKey(entry.name) || seen.has(key)) continue;
      seen.add(key);
      next.push({
        name: entry.name,
        unit: entry.unit || fallback,
        price: entry.price,
        kind: entry.kind,
        tax_percent: entry.tax_percent,
      });
    }
    state.doc.products = next;
  }

  function productsOfKind(kind) {
    const want = productKind({ kind });
    return (state.doc.products || []).filter((p) => productKind(p) === want);
  }

  function catalogProductNames(kind = "all") {
    const list = kind === "all" ? state.doc.products || [] : productsOfKind(kind);
    return list.map((p) => productEntry(p).name).filter(Boolean);
  }

  const textSuggest = { input: null, items: [], index: -1, picking: false, kind: "", mode: "browse", selectEl: null };
  const productSuggest = textSuggest;

  function customerSuggestNames() {
    const names = [];
    (state.doc?.customers || []).forEach((c) => {
      const name = String(c?.name || "").trim();
      if (name) names.push(name);
    });
    (state.doc?.orders || []).forEach((o) => {
      const name = String(o?.customer || "").trim();
      if (name) names.push(name);
    });
    return unique(names).sort((a, b) => a.localeCompare(b, "ru", { sensitivity: "base" }));
  }

  function productCatalogKindOf(input) {
    if (!input) return "all";
    if (input.id === "f-product" || input.dataset?.filterField === "product") return "all";
    const tr = input.closest?.("tr[data-line]");
    if (!tr) return "all";
    const typeSel = tr.querySelector?.('[data-lk="order_type"]');
    let typeName = typeSel?.value || "";
    if (!typeName) {
      const id = tr.dataset.line;
      for (const order of state.doc?.orders || []) {
        const line = (order.lines || []).find((l) => l.id === id);
        if (line) {
          typeName = line.order_type;
          break;
        }
      }
    }
    return productKindOfLine({ order_type: typeName });
  }

  function productSuggestNames(forInput) {
    const scope = productCatalogKindOf(forInput);
    const catalog = catalogProductNames(scope);
    const seen = new Set(catalog.map(catalogNameKey));
    const extra = [];
    for (const { line } of allRows()) {
      if (scope !== "all" && productKindOfLine(line) !== scope) continue;
      const name = String(line.product || "").trim();
      const key = catalogNameKey(name);
      if (!name || seen.has(key)) continue;
      seen.add(key);
      extra.push(name);
    }
    return catalog.concat(extra);
  }

  function suggestNames(kind, input) {
    if (kind === "customer") return customerSuggestNames();
    if (kind === "product") return productSuggestNames(input || textSuggest.input);
    return [];
  }

  function suggestItemLabel(item) {
    if (item == null) return "";
    return typeof item === "string" ? item : String(item.label ?? item.value ?? "");
  }

  function suggestItemValue(item) {
    if (item == null) return "";
    return typeof item === "string" ? item : String(item.value ?? "");
  }

  function filterSuggestNames(all, query, mode) {
    const q = String(query || "").trim().toLocaleLowerCase("ru");
    if (mode !== "filter" || !q) return all.slice();
    return all.filter((item) => suggestItemLabel(item).toLocaleLowerCase("ru").includes(q));
  }

  function filterProductSuggest(query) {
    return filterSuggestNames(productSuggestNames(textSuggest.input), query, "filter");
  }

  function suggestBoxEl() {
    return $("text-suggest") || $("product-suggest");
  }

  function textSuggestOpen() {
    const box = suggestBoxEl();
    return !!(box && !box.hidden);
  }

  function productSuggestOpen() {
    return textSuggestOpen();
  }

  function closeTextSuggest() {
    const box = suggestBoxEl();
    if (box) {
      box.hidden = true;
      box.innerHTML = "";
    }
    textSuggest.selectEl?.classList.remove("is-suggest-open");
    textSuggest.input = null;
    textSuggest.selectEl = null;
    textSuggest.items = [];
    textSuggest.index = -1;
    textSuggest.kind = "";
    textSuggest.mode = "browse";
  }

  function closeProductSuggest() {
    closeTextSuggest();
  }

  function positionTextSuggest() {
    const box = suggestBoxEl();
    const input = textSuggest.input || textSuggest.selectEl;
    if (!box || !input || box.hidden) return;
    const r = input.getBoundingClientRect();
    const spaceBelow = window.innerHeight - r.bottom - 8;
    const spaceAbove = r.top - 8;
    const openUp = spaceBelow < 140 && spaceAbove > spaceBelow;
    const maxH = Math.min(280, Math.max(120, openUp ? spaceAbove : spaceBelow));
    const width = Math.max(r.width, 180);
    let left = Math.round(r.left);
    if (left + width > window.innerWidth - 8) left = Math.max(8, window.innerWidth - width - 8);
    box.style.left = `${left}px`;
    box.style.minWidth = `${Math.round(width)}px`;
    box.style.width = `${Math.round(width)}px`;
    box.style.maxHeight = `${Math.round(maxH)}px`;
    if (openUp) {
      box.style.top = "auto";
      box.style.bottom = `${Math.round(window.innerHeight - r.top + 4)}px`;
    } else {
      box.style.bottom = "auto";
      box.style.top = `${Math.round(r.bottom + 4)}px`;
    }
  }

  function positionProductSuggest() {
    positionTextSuggest();
  }

  function renderTextSuggestBox() {
    const box = suggestBoxEl();
    const input = textSuggest.input || textSuggest.selectEl;
    if (!box || !input) return;
    const { items, index } = textSuggest;
    if (!items.length) {
      box.hidden = true;
      box.innerHTML = "";
      return;
    }
    box.innerHTML = items
      .map((item, i) => {
        const label = suggestItemLabel(item);
        return `<button type="button" role="option" data-i="${i}" class="suggest-item${i === index ? " active" : ""}">${esc(label)}</button>`;
      })
      .join("");
    box.hidden = false;
    positionTextSuggest();
    box.querySelector(".active")?.scrollIntoView({ block: "nearest" });
  }

  function renderProductSuggestBox() {
    renderTextSuggestBox();
  }

  function openTextSuggest(input, kind, mode) {
    if (!input || (kind !== "customer" && kind !== "product")) return;
    textSuggest.selectEl?.classList.remove("is-suggest-open");
    textSuggest.selectEl = null;
    const openMode = mode === "filter" ? "filter" : "browse";
    const all = suggestNames(kind, input);
    const items = filterSuggestNames(all, input.value, openMode);
    const q = String(input.value || "").trim();
    const exact = items.findIndex((name) => catalogNameKey(suggestItemLabel(name)) === catalogNameKey(q));
    let index = textSuggest.index;
    if (textSuggest.input !== input || textSuggest.kind !== kind) {
      index = exact >= 0 ? exact : openMode === "filter" && q ? 0 : -1;
    } else {
      if (index >= items.length) index = items.length - 1;
      if (exact >= 0 && (index < 0 || catalogNameKey(suggestItemLabel(items[index]) || "") !== catalogNameKey(q))) index = exact;
    }
    textSuggest.input = input;
    textSuggest.items = items;
    textSuggest.index = index;
    textSuggest.kind = kind;
    textSuggest.mode = openMode;
    renderTextSuggestBox();
  }

  function openSelectSuggest(select) {
    if (!select || select.disabled || select.multiple) return;
    if (textSuggestOpen() && textSuggest.selectEl === select) {
      closeTextSuggest();
      return;
    }
    const items = [...select.options].map((opt) => ({
      value: opt.value,
      label: String(opt.textContent || "").trim() || opt.value,
    }));
    if (!items.length) return;
    textSuggest.input = null;
    textSuggest.selectEl?.classList.remove("is-suggest-open");
    textSuggest.selectEl = select;
    textSuggest.items = items;
    textSuggest.kind = "select";
    textSuggest.mode = "browse";
    const selected = Math.max(
      0,
      items.findIndex((item) => item.value === select.value)
    );
    textSuggest.index = selected;
    select.classList.add("is-suggest-open");
    select.focus({ preventScroll: true });
    renderTextSuggestBox();
  }

  function openProductSuggest(input, mode) {
    openTextSuggest(input, "product", mode || "filter");
  }

  function moveTextSuggest(delta) {
    const n = textSuggest.items.length;
    if (!n) return;
    let i = textSuggest.index;
    if (i < 0) i = delta > 0 ? 0 : n - 1;
    else i = (i + delta + n) % n;
    textSuggest.index = i;
    renderTextSuggestBox();
  }

  function moveProductSuggest(delta) {
    moveTextSuggest(delta);
  }

  function pickTextSuggest(item) {
    if (textSuggest.kind === "select" && textSuggest.selectEl) {
      const sel = textSuggest.selectEl;
      const value = suggestItemValue(item);
      sel.value = value;
      textSuggest.picking = true;
      sel.dispatchEvent(new Event("input", { bubbles: true }));
      sel.dispatchEvent(new Event("change", { bubbles: true }));
      textSuggest.picking = false;
      closeTextSuggest();
      return;
    }
    const input = textSuggest.input;
    if (!input || item == null) return;
    const name = suggestItemLabel(item);
    textSuggest.picking = true;
    input.value = name;
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
    textSuggest.picking = false;
    closeTextSuggest();
  }

  function pickProductSuggest(name) {
    pickTextSuggest(name);
  }

  function suggestKindOf(el) {
    const kind = el?.dataset?.suggest;
    if (kind === "customer" || kind === "product") return kind;
    if (el?.dataset?.lk === "product") return "product";
    if (el?.dataset?.k === "customer") return "customer";
    if (el?.id === "f-customer") return "customer";
    if (el?.id === "f-product") return "product";
    if (el?.dataset?.filterField === "customer") return "customer";
    return "";
  }

  function bindTextSuggestKeys(e) {
    if (e.target?.tagName === "SELECT") {
      const open = textSuggestOpen() && textSuggest.selectEl === e.target;
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        if (open) moveTextSuggest(e.key === "ArrowDown" ? 1 : -1);
        else openSelectSuggest(e.target);
        return true;
      }
      if ((e.key === "Enter" || e.key === " ") && !e.ctrlKey && !e.altKey) {
        e.preventDefault();
        if (open && textSuggest.index >= 0) pickTextSuggest(textSuggest.items[textSuggest.index]);
        else openSelectSuggest(e.target);
        return true;
      }
      if (e.key === "Escape" && open) {
        e.preventDefault();
        closeTextSuggest();
        return true;
      }
      if (e.key === "Tab") closeTextSuggest();
      return false;
    }
    const kind = suggestKindOf(e.target);
    if (!kind) return false;
    const open = textSuggestOpen() && textSuggest.input === e.target;
    if (e.key === "ArrowDown" && !e.altKey && !e.ctrlKey && !e.metaKey) {
      e.preventDefault();
      if (open) moveTextSuggest(1);
      else openTextSuggest(e.target, kind, "browse");
      return true;
    }
    if (e.key === "ArrowUp" && !e.altKey && !e.ctrlKey && !e.metaKey) {
      e.preventDefault();
      if (open) moveTextSuggest(-1);
      else openTextSuggest(e.target, kind, "browse");
      return true;
    }
    if (e.key === "Enter" && !e.ctrlKey && !e.altKey && open && textSuggest.index >= 0) {
      e.preventDefault();
      pickTextSuggest(textSuggest.items[textSuggest.index]);
      return true;
    }
    if (e.key === "Escape" && open) {
      e.preventDefault();
      closeTextSuggest();
      return true;
    }
    if (e.key === "Tab") closeTextSuggest();
    return false;
  }

  function catalogProduct(name, kind = "order") {
    const key = catalogNameKey(name);
    if (!key) return null;
    const want = productKind({ kind });
    return (state.doc.products || []).find((x) => productKind(x) === want && catalogNameKey(productEntry(x).name) === key) || null;
  }

  function applyLineUnit(tr, line, unit) {
    if (!unit) return;
    line.unit = unit;
    const sel = tr.querySelector('[data-lk="unit"]');
    if (!sel) return;
    if (![...sel.options].some((opt) => opt.value === unit || opt.textContent === unit)) {
      sel.insertAdjacentHTML("beforeend", `<option selected>${esc(unit)}</option>`);
    }
    sel.value = unit;
  }

  function applyLinePrice(tr, line, price) {
    const n = Math.max(0, round2(price));
    if (!n || num(line.price) > 0) return;
    line.price = n;
    line.price_expr = String(n);
    const inp = tr.querySelector('[data-lk="price_expr"]');
    if (!inp) return;
    inp.value = String(n);
    inp.dataset.expr = String(n);
    inp.dataset.showing = "expr";
    inp.classList.remove("invalid");
  }

  function applyLineTaxPercent(tr, line, percent) {
    const n = Math.max(0, round2(percent));
    if (!n) return;
    line.tax_percent = n;
    line.tax_percent_expr = String(n);
    const inp = tr.querySelector('[data-lk="tax_percent_expr"]');
    if (!inp) return;
    inp.value = String(n);
    inp.dataset.expr = String(n);
    inp.dataset.showing = "expr";
    inp.classList.remove("invalid");
  }

  function applyLineProductDefaults(tr, line) {
    const want = productKindOfLine(line);
    const p = catalogProduct(line.product, want);
    if (!p) return;
    applyLineUnit(tr, line, p.unit);
    applyLinePrice(tr, line, p.price);
    if (want === "tax" && p.tax_percent > 0) applyLineTaxPercent(tr, line, p.tax_percent);
  }

  function ensureProduct(name, unitHint, priceHint, kind = "order", taxPercentHint = 0) {
    const n = String(name || "").trim();
    if (!n) return;
    const want = productKind({ kind });
    const list = state.doc.products || (state.doc.products = []);
    if (list.some((p) => productKind(p) === want && catalogNameKey(p.name) === catalogNameKey(n))) return;
    const fallback = String(unitHint || "").trim() || (state.doc.units || [])[0] || "шт.";
    list.push({
      name: n,
      unit: fallback,
      price: Math.max(0, round2(priceHint)),
      kind: want,
      tax_percent: want === "tax" ? Math.max(0, round2(taxPercentHint)) : 0,
    });
  }

  /** Убрать обрывки вроде «т», «то», «тор», если в заказах уже есть полное имя. */
  function pruneDraftProducts() {
    const list = state.doc.products || [];
    if (list.length < 2) return;
    const used = new Set();
    for (const order of state.doc.orders || []) {
      for (const line of order.lines || []) {
        const key = catalogNameKey(line.product);
        if (key) used.add(`${productKindOfLine(line)}:${key}`);
      }
    }
    const keys = list.map((p) => `${productKind(p)}:${catalogNameKey(p.name)}`);
    const next = list.filter((p, i) => {
      const key = keys[i];
      if (!key.endsWith(":") && !catalogNameKey(p.name)) return false;
      if (!catalogNameKey(p.name)) return false;
      if (used.has(key)) return true;
      const kind = productKind(p);
      const nameKey = catalogNameKey(p.name);
      return !keys.some((other, j) => {
        if (j === i) return false;
        const [ok, on] = other.split(":");
        return ok === kind && on.startsWith(nameKey) && on.length > nameKey.length;
      });
    });
    if (next.length !== list.length) state.doc.products = next;
  }

  function syncProductsFromOrders() {
    const list = state.doc.products || (state.doc.products = []);
    (state.doc.orders || []).forEach((order) => {
      (order.lines || []).forEach((line) => {
        ensureProduct(line.product, line.unit, line.price, productKindOfLine(line), line.tax_percent);
      });
    });
    pruneDraftProducts();
  }

  /** Переименование в справочнике сразу подставляется во все заказы и строки. */
  function renameCatalogValue(field, oldName, nextName) {
    if (!oldName || oldName === nextName) return;
    for (const order of state.doc.orders || []) {
      if (field === "customer" && order.customer === oldName) order.customer = nextName;
      for (const line of order.lines || []) {
        if (line[field] === oldName) line[field] = nextName;
      }
    }
  }

  function catalogFieldUsage(field, name) {
    const key = catalogNameKey(name);
    if (!key) return 0;
    let count = 0;
    for (const order of state.doc?.orders || []) {
      for (const line of order.lines || []) {
        if (catalogNameKey(line[field]) === key) count += 1;
      }
    }
    return count;
  }

  function statusUsage(name) {
    return catalogFieldUsage("status", name);
  }

  function unitUsage(name) {
    let count = catalogFieldUsage("unit", name);
    for (const p of state.doc?.products || []) {
      if (catalogNameKey(p.unit) === catalogNameKey(name)) count += 1;
    }
    return count;
  }

  function orderTypeUsage(name) {
    return catalogFieldUsage("order_type", name);
  }

  function catalogDelBtn(attr, used, label = "поз.") {
    if (used > 0) {
      return `<button class="btn small danger" ${attr} disabled title="Нельзя удалить: используется в ${used} ${label}">Удалить</button>`;
    }
    return `<button class="btn small danger" ${attr} title="Удалить">Удалить</button>`;
  }

  function productTemplateUsage(name, kind = "order") {
    const key = catalogNameKey(name);
    if (!key) return 0;
    const want = productKind({ kind });
    let count = 0;
    for (const order of state.doc?.orders || []) {
      for (const line of order.lines || []) {
        if (productKindOfLine(line) === want && catalogNameKey(line.product) === key) count += 1;
      }
    }
    return count;
  }

  function renameProduct(oldName, nextName, kind = "order") {
    if (!oldName || oldName === nextName) return;
    const want = productKind({ kind });
    for (const order of state.doc.orders || []) {
      for (const line of order.lines || []) {
        if (line.product === oldName && productKindOfLine(line) === want) line.product = nextName;
      }
    }
  }

  function orderNewestStamp(order) {
    let best = "";
    for (const line of order.lines || []) {
      const d = dateDay(line.order_date);
      if (d && d > best) best = d;
    }
    if (best) return best;
    return dateDay(order.created_at) || "";
  }

  function orderCreatedStamp(order) {
    const raw = String(order?.created_at || "").trim();
    if (raw) return raw;
    return orderNewestStamp(order);
  }

  function compareOrders(a, b, sort) {
    if (sort === "date-asc") return orderNewestStamp(a).localeCompare(orderNewestStamp(b));
    if (sort === "created-desc") return orderCreatedStamp(b).localeCompare(orderCreatedStamp(a));
    if (sort === "created-asc") return orderCreatedStamp(a).localeCompare(orderCreatedStamp(b));
    if (sort === "number") return String(a.number || "").localeCompare(String(b.number || ""), "ru", { numeric: true });
    if (sort === "customer") return String(a.customer || "").localeCompare(String(b.customer || ""), "ru");
    if (sort === "amount-desc") return orderTotals(b).after - orderTotals(a).after;
    return orderNewestStamp(b).localeCompare(orderNewestStamp(a));
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
    setSel("f-type", typeNames());
    setSel("f-unit", state.doc.units || []);
    $("customer-list").innerHTML = unique((state.doc.orders || []).map((o) => o.customer)).map((c) => `<option value="${esc(c)}">`).join("");
  }

  function renderAnalytics() {
    fillFilterSelects();
    const rows = analyticsRows();
    const s = summarize(rows);
    const group = $("f-group").value;
    const dateField = $("f-date-field").value;
    paintTrendLine($("chart-an-line"), rows, group, dateField);

    const a = periodStats($("c-a-from").value, $("c-a-to").value, dateField);
    const b = periodStats($("c-b-from").value, $("c-b-to").value, dateField);
    $("cmp-a").innerHTML = cmpHtml(a);
    $("cmp-b").innerHTML = cmpHtml(b);
    const withCost = a.cost > 0.005 || b.cost > 0.005;
    FinCharts.bar($("chart-an-bar"), {
      tinyLabels: true,
      labels: withCost ? ["Выручка", "Оплачено", "Долг", "Расход", "Чистыми", "Позиции"] : ["Выручка", "Оплачено", "Долг", "Позиции"],
      scale: "group",
      formats: withCost ? ["money", "money", "money", "money", "money", "count"] : ["money", "money", "money", "count"],
      legend: [
        { label: "Период A", color: "#0f766e" },
        { label: "Период B", color: "#c9a227" },
      ],
      datasets: [
        { values: withCost ? [a.after, a.paid, a.unpaid, a.cost, a.net, a.count] : [a.after, a.paid, a.unpaid, a.count], color: "#0f766e" },
        { values: withCost ? [b.after, b.paid, b.unpaid, b.cost, b.net, b.count] : [b.after, b.paid, b.unpaid, b.count], color: "#c9a227" },
      ],
    });

    $("analytics-table").innerHTML = rows.length
      ? `<table class="data"><thead><tr>
          <th>№</th><th>Заказчик</th><th>Название</th><th>Тип</th><th>Продукт</th><th>Кол-во</th>
          <th>Итог</th><th>Оплачено</th><th>Долг</th><th>Дата</th><th>Статус</th>
        </tr></thead><tbody>${rows
          .map(
            ({ order, line, totals }) => `<tr class="${totals.expense ? "is-expense" : ""}">
            <td>${esc(order.number)}</td><td>${esc(order.customer)}</td><td>${esc(order.name)}</td>
            <td>${esc(line.order_type)}</td><td>${esc(line.product)}</td>
            <td class="num">${esc(qtyValue(line))} ${esc(line.unit)}</td>
            <td class="num">${totals.expense ? `−${esc(money(totals.cost))}` : esc(money(totals.after))}</td>
            <td class="num">${totals.expense ? "—" : esc(money(totals.paid))}</td>
            <td class="num">${totals.expense ? "—" : esc(money(totals.unpaid))}</td>
            <td>${esc(dateDay(line.order_date))}</td>
            <td>${
              totals.expense
                ? `<span class="pill expense-pill">${esc(kindLabel(totals.kind))}</span>`
                : `<span class="pill" style="background:${statusMeta(line.status).color}">${esc(line.status)}</span>`
            }</td>
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
          </tr>${
            s.cost
              ? `<tr><td colspan="5">Расход и чистыми</td>
            <td class="num">${s.costCount} поз.</td>
            <td class="num">−${esc(money(s.cost))}</td>
            <td colspan="2" class="num">чистыми ${esc(money(s.net))}</td>
            <td colspan="2"></td>
          </tr>`
              : ""
          }</tfoot>
          </table>
          <p class="hint">Найдено ${rows.length} позиций, ${s.orderCount} заказов, сумма ${money(s.after)}, долг ${money(s.unpaid)}${
            s.cost ? `, расход ${money(s.cost)}, чистыми ${money(s.net)}` : ""
          }</p>`
      : `<div class="empty">Ничего не найдено — ослабьте фильтры.</div>`;
  }

  function cmpHtml(s) {
    return `<div class="kpis" style="grid-template-columns:1fr 1fr;margin:0">
      <div class="kpi"><div class="label">Выручка</div><div class="value" style="font-size:18px">${money(s.after)}</div></div>
      <div class="kpi"><div class="label">Оплачено</div><div class="value" style="font-size:18px">${money(s.paid)}</div></div>
      <div class="kpi warn"><div class="label">Долг</div><div class="value" style="font-size:18px">${money(s.unpaid)}</div></div>
      <div class="kpi"><div class="label">Позиции / заказы</div><div class="value" style="font-size:18px">${s.count} / ${s.orderCount}</div></div>
      ${
        s.cost
          ? `<div class="kpi cost"><div class="label">Расход</div><div class="value" style="font-size:18px">−${money(s.cost)}</div></div>
      <div class="kpi ${s.net >= 0 ? "ok" : "warn"}"><div class="label">Чистыми</div><div class="value" style="font-size:18px">${money(s.net)}</div></div>`
          : ""
      }
    </div>`;
  }

