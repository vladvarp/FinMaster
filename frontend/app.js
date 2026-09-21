(() => {
  const LS_RECENT = "finmaster.recent";
  const LS_AUTOSAVE = "finmaster.autosave";
  let moneyFmt = new Intl.NumberFormat("ru-RU", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  function moneyDecimals(doc = state?.doc) {
    const n = Number(doc?.money_decimals);
    return Number.isFinite(n) ? Math.max(0, Math.min(4, Math.round(n))) : 2;
  }

  function syncMoneyFmt(decimals) {
    const d = Math.max(0, Math.min(4, Number(decimals)));
    const safe = Number.isFinite(d) ? d : 2;
    moneyFmt = new Intl.NumberFormat("ru-RU", { minimumFractionDigits: safe, maximumFractionDigits: safe });
    return safe;
  }

  const state = {
    doc: null,
    path: null,
    dirty: false,
    autosave: false,
    desktop: false,
    view: "dashboard",
    search: "",
    autosaveTimer: null,
    appFullscreen: false,
    closeAfterSave: false,
    newAfterSave: false,
    selectedCustomerId: null,
    shareOrderId: null,
    orderFilter: "all",
    focusOrderId: null,
    focusLineId: null,
    remoteStats: null,
    cash: { filter: "all", day: "", bucket: "", customer: "" },
    calendar: null,
    cloud: null,
  };

  const LS_NET_CONSOLE = "finmaster.netconsole";
  const LS_START_VIEW = "finmaster.startView";
  const LS_CHARTS = "finmaster.charts";
  const CLOUD_LAYOUTS = ["galaxy", "orbit", "timeline", "constellation"];
  const CLOUD_COLOR_MODES = ["status", "customer", "debt", "type"];
  const CLOUD_SIZE_MODES = ["amount", "debt", "quantity", "equal"];

  function sanitizeCloudPrefs(raw) {
    if (!raw || typeof raw !== "object") return {};
    const out = {};
    if (CLOUD_LAYOUTS.includes(raw.layout)) out.layout = raw.layout;
    if (CLOUD_COLOR_MODES.includes(raw.color)) out.color = raw.color;
    if (CLOUD_SIZE_MODES.includes(raw.size)) out.size = raw.size;
    if (typeof raw.labels === "boolean") out.labels = raw.labels;
    if (typeof raw.motion === "boolean") out.motion = raw.motion;
    if (typeof raw.heat === "boolean") out.heat = raw.heat;
    if (typeof raw.space3d === "boolean") out.space3d = raw.space3d;
    if (typeof raw.debtOnly === "boolean") out.debtOnly = raw.debtOnly;
    return out;
  }

  function loadStoredCloud() {
    try {
      return sanitizeCloudPrefs(JSON.parse(localStorage.getItem(LS_CLOUD) || "null"));
    } catch {
      return {};
    }
  }

  function persistCloudPrefs() {
    const s = cloudState();
    const payload = {
      layout: s.layout,
      color: s.color,
      size: s.size,
      labels: !!s.labels,
      motion: s.motion !== false,
      heat: !!s.heat,
      space3d: !!s.space3d,
      debtOnly: !!s.debtOnly,
    };
    try {
      localStorage.setItem(LS_CLOUD, JSON.stringify(payload));
    } catch {
      /* ignore */
    }
    if (state.doc) ensureUi().cloud = payload;
  }

  function adoptCloudFromDocument() {
    const saved = sanitizeCloudPrefs(state.doc?.ui?.cloud);
    if (Object.keys(saved).length) Object.assign(cloudState(), saved);
    persistCloudPrefs();
  }

  const $ = (id) => document.getElementById(id);

  const HISTORY_LIMIT_MIN = 5;
  const HISTORY_LIMIT_MAX = 200;
  const HISTORY_LIMIT_DEFAULT = 40;
  const history = {
    stack: [],
    index: -1,
    timer: null,
    persistTimer: null,
    flagsTimer: null,
    busy: false,
    pending: false,
    pendingLabel: "",
    saveChain: Promise.resolve(),
    limit: HISTORY_LIMIT_DEFAULT,
  };

  function clampHistoryLimit(value) {
    const n = Number(value);
    if (!Number.isFinite(n)) return HISTORY_LIMIT_DEFAULT;
    return Math.max(HISTORY_LIMIT_MIN, Math.min(HISTORY_LIMIT_MAX, Math.round(n)));
  }

  function historyKey(value) {
    try {
      const obj = typeof value === "string" ? JSON.parse(value) : JSON.parse(JSON.stringify(value || {}));
      delete obj.modified_at;
      return JSON.stringify(obj);
    } catch {
      return "";
    }
  }

  function historySnapshot() {
    try {
      return JSON.stringify(state.doc);
    } catch {
      return null;
    }
  }

  function historyGuessLabel(prevJson, nextJson) {
    try {
      const a = JSON.parse(prevJson);
      const b = JSON.parse(nextJson);
      const ao = a.orders || [];
      const bo = b.orders || [];
      if (ao.length < bo.length) return "Новый заказ";
      if (ao.length > bo.length) return "Удаление заказа";
      const byId = (list) => Object.fromEntries((list || []).map((o) => [o.id, o]));
      const A = byId(ao);
      const B = byId(bo);
      for (const id of Object.keys(B)) {
        if (JSON.stringify(A[id] || null) === JSON.stringify(B[id] || null)) continue;
        const n = String(B[id].number || B[id].name || "").trim();
        return n ? `Заказ ${n}` : "Правка заказа";
      }
      if (JSON.stringify(a.customers || []) !== JSON.stringify(b.customers || [])) return "Справочник заказчиков";
      if (JSON.stringify(a.statuses || []) !== JSON.stringify(b.statuses || [])) return "Справочник статусов";
      if (JSON.stringify(a.products || []) !== JSON.stringify(b.products || [])) return "Справочник продуктов";
      if (JSON.stringify(a.units || []) !== JSON.stringify(b.units || [])) return "Единицы измерения";
      if (JSON.stringify(a.order_types || []) !== JSON.stringify(b.order_types || [])) return "Типы заказов";
      if (JSON.stringify(a.ui?.calendar || {}) !== JSON.stringify(b.ui?.calendar || {})) return "Календарь";
      if (JSON.stringify(a.ui?.calculator || {}) !== JSON.stringify(b.ui?.calculator || {})) return "Калькулятор";
      if (JSON.stringify(a.ui?.presentation || {}) !== JSON.stringify(b.ui?.presentation || {})) return "Презентация";
      if (a.title !== b.title) return "Название отчёта";
    } catch {
      /* ignore */
    }
    return "Правка";
  }

  function remoteDeviceName(origin) {
    const cid = String(origin || "");
    const client = (remote.clients || []).find((c) => c.id === cid);
    return String(client?.name || "").trim() || "Телефон";
  }

  function historyItem(json, label, meta) {
    return {
      id: uid(),
      at: new Date().toISOString(),
      label: label || "Правка",
      source: meta?.source || "pc",
      device: meta?.device || "ПК",
      json,
    };
  }

  function historyReset(label = "Открыт отчёт", opts = {}) {
    clearTimeout(history.timer);
    history.pending = false;
    history.pendingLabel = "";
    const snap = state.doc ? historySnapshot() : null;
    history.stack = snap ? [historyItem(snap, label, { source: "pc", device: "ПК" })] : [];
    history.index = history.stack.length - 1;
    updateHistoryButtons();
    if (opts.persist !== false) persistHistorySoon();
  }

  function historyTrim() {
    while (history.stack.length > history.limit) {
      history.stack.shift();
      history.index = Math.max(0, history.index - 1);
    }
  }

  function historyCommit(label, meta) {
    clearTimeout(history.timer);
    if (!state.doc || history.busy) return null;
    const snap = historySnapshot();
    if (snap == null) return null;
    const cur = history.stack[history.index];
    if (cur && historyKey(cur.json) === historyKey(snap)) {
      history.pending = false;
      history.pendingLabel = "";
      return null;
    }
    const text = label || history.pendingLabel || (cur ? historyGuessLabel(cur.json, snap) : "Правка");
    const src = meta || (remote.applying ? { source: "mobile", device: remoteDeviceName(remote.origin) } : { source: "pc", device: "ПК" });
    history.stack = history.stack.slice(0, history.index + 1);
    history.stack.push(historyItem(snap, text, src));
    historyTrim();
    history.index = history.stack.length - 1;
    history.pending = false;
    history.pendingLabel = "";
    updateHistoryButtons();
    persistHistorySoon();
    return history.stack[history.index];
  }

  function historySchedule(label) {
    if (history.busy) return;
    if (label) history.pendingLabel = label;
    history.pending = true;
    clearTimeout(history.timer);
    history.timer = setTimeout(() => historyCommit(history.pendingLabel), 500);
  }

  function historyMeta() {
    return {
      undo: history.index > 0,
      redo: history.index < history.stack.length - 1,
      index: history.index,
      limit: history.limit,
      items: history.stack.map((item) => ({
        id: item.id,
        at: item.at,
        label: item.label,
        source: item.source,
        device: item.device,
      })),
    };
  }

  function historyDiskPayload() {
    return {
      index: history.index,
      items: history.stack.map((item) => {
        let doc = null;
        try {
          doc = JSON.parse(item.json);
        } catch {
          doc = null;
        }
        return { id: item.id, file: item.file || undefined, at: item.at, label: item.label, source: item.source, device: item.device, doc };
      }).filter((item) => item.doc),
    };
  }

  function persistHistorySoon() {
    renderHistoryPanel();
    if (!state.desktop || !state.path) return;
    clearTimeout(history.persistTimer);
    history.persistTimer = setTimeout(() => {
      apiPost("/api/history", {
        path: state.path,
        title: state.doc?.title || "",
        ...historyDiskPayload(),
      }).catch(() => {});
    }, 400);
  }

  function adoptHistory(payload, limit) {
    if (limit != null) history.limit = clampHistoryLimit(limit);
    const items = Array.isArray(payload?.items) ? payload.items : [];
    const restored = [];
    items.forEach((item) => {
      if (!item || !item.doc || typeof item.doc !== "object") return;
      try {
        restored.push({
          id: item.id || uid(),
          file: item.file ? String(item.file) : undefined,
          at: item.at || new Date().toISOString(),
          label: item.label || "Правка",
          source: item.source === "mobile" ? "mobile" : "pc",
          device: item.device || (item.source === "mobile" ? "Телефон" : "ПК"),
          json: JSON.stringify(item.doc),
        });
      } catch {
        /* skip broken snapshot */
      }
    });
    if (!restored.length) {
      historyReset(state.path ? "Открыт отчёт" : "Новый отчёт", { persist: !items.length });
      return;
    }
    history.stack = restored;
    historyTrim();
    let index = Number(payload?.index);
    if (!Number.isInteger(index) || index < 0 || index >= history.stack.length) index = history.stack.length - 1;
    const key = historyKey(state.doc);
    const match = history.stack.findIndex((item) => historyKey(item.json) === key);
    history.index = match >= 0 ? match : index;
    history.pending = false;
    history.pendingLabel = "";
    updateHistoryButtons();
  }

  function updateHistoryButtons() {
    const undoBtn = $("btn-undo");
    const redoBtn = $("btn-redo");
    if (undoBtn) undoBtn.disabled = history.index <= 0;
    if (redoBtn) redoBtn.disabled = history.index >= history.stack.length - 1;
    const clock = $("btn-history");
    if (clock) clock.disabled = !state.doc;
    publishHistoryFlags();
    renderHistoryPanel();
  }

  function publishHistoryFlags() {
    if (!state.desktop) return;
    clearTimeout(history.flagsTimer);
    history.flagsTimer = setTimeout(() => {
      apiPost("/api/remote/publish", { history: historyMeta() }).catch(() => {});
    }, 300);
  }

  function historyApplyIndex(next, { toastText } = {}) {
    if (!state.doc || next < 0 || next >= history.stack.length) {
      toast(next < history.index ? "Отменять больше нечего" : "Повторять нечего");
      return false;
    }
    if (next === history.index && !history.pending) return false;
    let doc;
    try {
      doc = JSON.parse(history.stack[next].json);
    } catch {
      return false;
    }
    history.busy = true;
    history.pending = false;
    history.pendingLabel = "";
    history.index = next;
    state.doc = doc;
    if (state.doc && typeof state.doc === "object") {
      state.doc.modified_at = new Date().toISOString();
    }
    if (state.calendar) {
      const saved = ensureUi().calendar || {};
      if (CALENDAR_MODES.includes(saved.mode)) state.calendar.mode = saved.mode;
      if (CALENDAR_FILTERS.some(([id]) => id === saved.filter)) state.calendar.filter = saved.filter;
    }
    state.dirty = true;
    renderAll();
    syncDirty();
    updateHistoryButtons();
    persistHistorySoon();
    history.busy = false;
    clearTimeout(state.autosaveTimer);
    if (state.path) {
      // Сразу пишем файл: иначе при закрытии без автосохранения отмена теряется.
      history.saveChain = Promise.resolve(history.saveChain)
        .then(() => save({ silent: true }))
        .catch(() => false);
    } else {
      scheduleAutosave();
    }
    if (toastText) toast(toastText);
    return true;
  }

  function historyGo(step) {
    if (!state.doc) return false;
    if (step < 0 && history.pending) historyCommit(history.pendingLabel);
    return historyApplyIndex(history.index + step);
  }

  function historyJump(id) {
    const next = history.stack.findIndex((item) => item.id === id);
    if (next < 0) return false;
    return historyApplyIndex(next, { toastText: history.stack[next].label || "Снимок восстановлен" });
  }

  async function setHistoryLimit(value) {
    const next = clampHistoryLimit(value);
    history.limit = next;
    const extra = history.stack.length - history.limit;
    if (extra > 0) {
      history.stack = history.stack.slice(extra);
      history.index = Math.max(0, history.index - extra);
    }
    if (state.desktop) {
      try {
        const res = await apiPost("/api/history/limit", { limit: next });
        if (res.history_limit) history.limit = clampHistoryLimit(res.history_limit);
      } catch {
        /* keep local */
      }
    }
    updateHistoryButtons();
    persistHistorySoon();
  }

  function historyTime(iso) {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return "";
    return d.toLocaleString("ru-RU", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
  }

  function fmtBytes(n) {
    const x = Number(n) || 0;
    if (x < 1024) return `${Math.round(x)} Б`;
    if (x < 1024 * 1024) return `${(x / 1024).toFixed(1)} КБ`;
    if (x < 1024 * 1024 * 1024) return `${(x / (1024 * 1024)).toFixed(1)} МБ`;
    return `${(x / (1024 * 1024 * 1024)).toFixed(2)} ГБ`;
  }

  function historyPlaceLabel(row) {
    if (row.current) return "открыт сейчас";
    if (!row.exists) return row.in_library ? "удалён из FinMaster" : "файла нет на диске";
    if (row.in_library) return "в папке FinMaster";
    return "другой путь";
  }

  function renderHistoryLibrary(data) {
    const box = $("history-modal-list");
    const sum = $("history-modal-sum");
    if (sum) {
      const n = (data.items || []).length;
      sum.textContent = `${data.root || "Документы\\FinMaster\\history"} · ${n} ${n === 1 ? "история" : "историй"} · ${fmtBytes(data.bytes)}`;
    }
    if (!box) return;
    const rows = data.items || [];
    if (!rows.length) {
      box.innerHTML = `<div class="empty">Папок истории ещё нет.</div>`;
      return;
    }
    box.innerHTML = `<table class="data hist-lib-table"><thead><tr>
      <th>Отчёт</th><th>Путь</th><th>Где</th><th>Снимки</th><th>Размер</th><th></th>
    </tr></thead><tbody>${rows
      .map(
        (row) => `<tr class="${row.current ? "is-current" : ""} ${row.exists ? "" : "is-missing"}">
          <td><b>${esc(row.title || row.folder)}</b><div class="meta">${esc(row.folder)}</div></td>
          <td class="hist-lib-path">${esc(row.path || "—")}</td>
          <td>${esc(historyPlaceLabel(row))}</td>
          <td>${row.count || 0}</td>
          <td>${esc(fmtBytes(row.bytes))}</td>
          <td><button class="btn small danger" type="button" data-hist-del="${esc(row.folder)}">Удалить</button></td>
        </tr>`
      )
      .join("")}</tbody></table>`;
  }

  async function refreshHistoryLibrary() {
    if (!$("history-modal")?.classList.contains("open") || !state.desktop) return;
    try {
      const q = state.path ? `?path=${encodeURIComponent(state.path)}` : "";
      renderHistoryLibrary(await apiGet(`/api/history/library${q}`));
    } catch {
      /* список подтянется при следующем открытии */
    }
  }

  async function openHistoryLibrary() {
    toggleHistoryPanel(false);
    if (!state.desktop) {
      toast("Управление историями доступно в программе на компьютере");
      return;
    }
    $("history-modal")?.classList.add("open");
    try {
      const q = state.path ? `?path=${encodeURIComponent(state.path)}` : "";
      renderHistoryLibrary(await apiGet(`/api/history/library${q}`));
    } catch (err) {
      toast(`Не удалось открыть истории: ${err.message || err}`);
    }
  }

  async function deleteHistoryFolder(name) {
    const ok = await askConfirm({
      title: "Удалить историю?",
      text: `Папка «${name}» и все снимки этого отчёта будут удалены. Сам файл отчёта останется.`,
      ok: "Удалить",
      danger: true,
    });
    if (!ok) return;
    try {
      const data = await apiPost("/api/history/delete", { folder: name, path: state.path || "" });
      renderHistoryLibrary(data);
      const current = (data.items || []).some((row) => row.current);
      if (!current && state.doc) historyReset(state.path ? "Открыт отчёт" : "Новый отчёт");
      toast("История удалена");
    } catch (err) {
      toast(`Не удалось удалить: ${err.message || err}`);
    }
  }

  function renderHistoryPanel() {
    const list = $("history-list");
    const input = $("history-limit");
    if (input && document.activeElement !== input) input.value = String(history.limit);
    if (!list) return;
    if (!history.stack.length) {
      list.innerHTML = `<div class="history-empty">Пока нет снимков</div>`;
      return;
    }
    const rows = [...history.stack].reverse();
    list.innerHTML = rows
      .map((item) => {
        const i = history.stack.indexOf(item);
        return `<button type="button" class="history-item ${i === history.index ? "active" : ""}" data-history-id="${esc(item.id)}">
          <span class="history-item-top"><b>${esc(item.label || "Правка")}</b><time>${esc(historyTime(item.at))}</time></span>
          <small>${esc(item.device || (item.source === "mobile" ? "Телефон" : "ПК"))}</small>
        </button>`;
      })
      .join("");
  }

  function placeHistoryPanel() {
    const panel = $("history-panel");
    const btn = $("btn-history");
    if (!panel || panel.hidden || !btn) return;
    const r = btn.getBoundingClientRect();
    const width = Math.min(360, window.innerWidth - 16);
    let left = r.right - width;
    if (left < 8) left = 8;
    if (left + width > window.innerWidth - 8) left = Math.max(8, window.innerWidth - 8 - width);
    let top = r.bottom + 8;
    const spaceBelow = window.innerHeight - top - 8;
    const spaceAbove = r.top - 8;
    const need = Math.min(420, window.innerHeight * 0.7);
    if (spaceBelow < 180 && spaceAbove > spaceBelow) {
      top = Math.max(8, r.top - 8 - Math.min(need, panel.offsetHeight || need));
    }
    panel.style.top = `${Math.round(top)}px`;
    panel.style.left = `${Math.round(left)}px`;
    panel.style.right = "auto";
    panel.style.width = `${Math.round(width)}px`;
  }

  function toggleHistoryPanel(force) {
    const panel = $("history-panel");
    const btn = $("btn-history");
    if (!panel) return;
    const open = force == null ? panel.hidden : !!force;
    panel.hidden = !open;
    btn?.setAttribute("aria-expanded", String(open));
    if (open) {
      renderHistoryPanel();
      requestAnimationFrame(placeHistoryPanel);
    }
  }

  function undo() {
    if (historyGo(-1)) toast("Действие отменено");
  }

  function redo() {
    if (historyGo(1)) toast("Действие возвращено");
  }

  function uid() {
    if (crypto.randomUUID) return crypto.randomUUID();
    return `id-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  }

  function localStamp(d) {
    const p = (n) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  }

  function nowLocal() {
    return localStamp(new Date());
  }

  function dateDay(v) {
    const s = String(v || "");
    return s.length >= 10 ? s.slice(0, 10) : s;
  }

  function money(n) {
    const cur = state.doc?.currency || "₽";
    return `${moneyFmt.format(Number(n) || 0)} ${cur}`;
  }

  function formatMoneySample(n = 1234.5678) {
    const cur = String(state.doc?.currency || "₽").slice(0, 8) || "₽";
    const d = moneyDecimals();
    const fmt = new Intl.NumberFormat("ru-RU", { minimumFractionDigits: d, maximumFractionDigits: d });
    return `${fmt.format(Number(n) || 0)} ${cur}`;
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
      ui: { sidebar_collapsed: false, column_widths: {}, share_fields: [], share_theme: "teal", cloud: {}, line_series: {}, calculator: { active: "", blueprints: [] }, presentation: { active: "", pages: [] } },
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

  let dirtySyncChain = Promise.resolve();

  function syncDirty() {
    if (!state.desktop) return;
    const dirty = !!state.dirty;
    dirtySyncChain = dirtySyncChain
      .then(() => apiPost("/api/dirty", { dirty }))
      .catch(() => {});
  }

  async function flushPendingSaves() {
    clearTimeout(state.autosaveTimer);
    clearTimeout(history.persistTimer);
    try {
      await Promise.resolve(history.saveChain);
    } catch {
      /* ignore */
    }
    if (state.dirty && state.doc && state.path) {
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
  }

  function showStart() {
    $("start-screen").classList.remove("hidden");
    $("app-shell").hidden = true;
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
    if (!confirm(`Удалить «${name}» из папки FinMaster? Файл попадёт в корзину.`)) return;
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
    const blob = [order.number, order.customer, order.name, order.notes, line?.product, line?.order_type, line?.status]
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
    FinCharts.line(canvas, { labels, datasets });
  }

  function renderDashboard() {
    renderDashFocus();
    renderKpis();
    renderInsights();
    const rows = dashRows();
    paintTrendLine($("chart-dash-line"), rows, "day", "order_date", 14);
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
                  return `<tr class="${lt.expense ? "is-expense" : ""}"><td>${esc(label)}</td><td>${esc(line.product || "—")}</td>
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
    ["order_date", "Дата заказа", 132],
    ["paid", "Оплачено", 90],
    ["payment_date", "Дата оплаты", 132],
    ["unpaid", "Не оплачено", 110],
    ["total", "Итог", 120],
    ["status", "Статус", 140],
    ["actions", "", 86],
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

  function applySidebar() {
    const shell = $("app-shell");
    if (!shell || !state.doc) return;
    const collapsed = !!ensureUi().sidebar_collapsed;
    shell.classList.toggle("sidebar-collapsed", collapsed);
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
    const summary = summarize(orders.flatMap((o) => (o.lines || []).map((line) => ({ order: o, line, totals: lineTotals(line) }))));
    $("orders-summary").innerHTML = `<span>${orders.length} зак. · ${money(summary.after)} · долг ${money(summary.unpaid)}</span>`;
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
    const ctx = { statusNames, units, types };
    const canExpense = typeNames("expense").length > 0;
    $("orders-list").innerHTML = orders
      .map((order) => {
        const tot = orderTotals(order);
        const { income, expense, frozen } = splitLines(order.lines);
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
                    ? income.map((line) => orderLineRow(line, ctx)).join("")
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

  function orderLineRow(line, { statusNames, units, types }) {
    const t = lineTotals(line);
    return `<tr data-line="${line.id}" class="line-row${isFrozenLine(line) ? " is-frozen" : ""}" style="--status-color:${esc(statusColor(line.status))}">
      <td class="line-drag" title="Перетащить строку. Правый клик — заморозить"><span></span></td>
      <td><select data-lk="order_type">${optionList(unique([line.order_type, ...types]), line.order_type)}</select></td>
      <td><input data-lk="product" data-suggest="product" autocomplete="off" spellcheck="false" value="${esc(line.product)}" /></td>
      <td class="num">${exprInput(line, "qty_expr")}</td>
      <td><select data-lk="unit">${optionList(unique([line.unit, ...units]), line.unit)}</select></td>
      <td class="num">${exprInput(line, "price_expr")}</td>
      <td class="num">${exprInput(line, "discount_expr")}</td>
      <td><input data-lk="order_date" type="date" value="${esc(dateDay(line.order_date))}" /></td>
      <td class="num">${exprInput(line, "paid_expr")}</td>
      <td><input data-lk="payment_date" type="date" value="${esc(dateDay(line.payment_date))}" /></td>
      <td class="num computed">${esc(money(t.unpaid))}</td>
      <td class="num computed">${esc(money(t.after))}<div style="color:#94a3b8;font-weight:500;font-size:11px">до скидки ${esc(money(t.total))}</div></td>
      <td><select data-lk="status">${optionList(unique([line.status, ...statusNames]), line.status)}</select></td>
      <td><div class="row-actions">
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
    const calc =
      t.kind === "tax"
        ? `<select data-lk="tax_mode" title="Своя сумма или процент от заказа">${TAX_MODES.map(
            ([id, label]) => `<option value="${id}" ${id === t.mode ? "selected" : ""}>${esc(label)}</option>`
          ).join("")}</select>`
        : `<span class="cost-calc">своя сумма</span>`;
    const amount =
      t.mode === "amount"
        ? `<td class="num">${exprInput(line, "qty_expr")}</td>
      <td><select data-lk="unit">${optionList(unique([line.unit, ...units]), line.unit)}</select></td>
      <td class="num">${exprInput(line, "price_expr")}</td>`
        : `<td class="num" colspan="3">
        <div class="tax-percent">${exprInput(line, "tax_percent_expr")}<span class="tax-of">% от ${esc(money(t.base))}</span></div>
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
          <tbody>${expense.map((line) => orderCostRow(line, ctx)).join("")}</tbody>
        </table>
      </div>
    </div>`;
  }

  function orderFrozenHtml(frozen, ctx) {
    if (!frozen.length) return "";
    const income = frozen.filter((line) => !isExpenseLine(line));
    const expense = frozen.filter((line) => isExpenseLine(line));
    return `<div class="order-frozen">
      <div class="oe-head"><span class="oe-title">Замороженные позиции</span>
        <span class="oe-sum">${frozen.length} · не учитываются нигде</span>
      </div>
      ${
        income.length
          ? `<div class="table-wrap">
        <table class="data">
          ${colgroupHtml()}
          <thead><tr>${orderHeadHtml()}</tr></thead>
          <tbody>${income.map((line) => orderLineRow(line, ctx)).join("")}</tbody>
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
          <tbody>${expense.map((line) => orderCostRow(line, ctx)).join("")}</tbody>
        </table>
      </div>`
          : ""
      }
    </div>`;
  }

  function productEntry(item) {
    if (item && typeof item === "object" && !Array.isArray(item)) {
      return {
        name: String(item.name || "").trim(),
        unit: String(item.unit || "").trim(),
        price: Math.max(0, round2(item.price)),
      };
    }
    return { name: String(item || "").trim(), unit: "", price: 0 };
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
      const { name, unit, price } = productEntry(item);
      const key = catalogNameKey(name);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      next.push({ name, unit: unit || fallback, price });
    }
    state.doc.products = next;
  }

  function catalogProductNames() {
    return (state.doc.products || []).map((p) => productEntry(p).name).filter(Boolean);
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

  function productSuggestNames() {
    const catalog = catalogProductNames();
    const seen = new Set(catalog.map(catalogNameKey));
    const extra = [];
    for (const { line } of allRows()) {
      const name = String(line.product || "").trim();
      const key = catalogNameKey(name);
      if (!name || seen.has(key)) continue;
      seen.add(key);
      extra.push(name);
    }
    return catalog.concat(extra);
  }

  function suggestNames(kind) {
    if (kind === "customer") return customerSuggestNames();
    if (kind === "product") return productSuggestNames();
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
    return filterSuggestNames(productSuggestNames(), query, "filter");
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
    const all = suggestNames(kind);
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

  function catalogProduct(name) {
    const key = catalogNameKey(name);
    if (!key) return null;
    return (state.doc.products || []).find((x) => catalogNameKey(productEntry(x).name) === key) || null;
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

  function applyLineProductDefaults(tr, line) {
    const p = catalogProduct(line.product);
    if (!p) return;
    applyLineUnit(tr, line, p.unit);
    applyLinePrice(tr, line, p.price);
  }

  function ensureProduct(name, unitHint, priceHint) {
    const n = String(name || "").trim();
    if (!n) return;
    const list = state.doc.products || (state.doc.products = []);
    if (list.some((p) => catalogNameKey(p.name) === catalogNameKey(n))) return;
    const fallback = String(unitHint || "").trim() || (state.doc.units || [])[0] || "шт.";
    list.push({ name: n, unit: fallback, price: Math.max(0, round2(priceHint)) });
  }

  /** Убрать обрывки вроде «т», «то», «тор», если в заказах уже есть полное имя. */
  function pruneDraftProducts() {
    const list = state.doc.products || [];
    if (list.length < 2) return;
    const used = new Set();
    for (const order of state.doc.orders || []) {
      for (const line of order.lines || []) {
        const key = catalogNameKey(line.product);
        if (key) used.add(key);
      }
    }
    const keys = list.map((p) => catalogNameKey(p.name));
    const next = list.filter((p, i) => {
      const key = keys[i];
      if (!key) return false;
      if (used.has(key)) return true;
      return !keys.some((other, j) => j !== i && other.startsWith(key) && other.length > key.length);
    });
    if (next.length !== list.length) state.doc.products = next;
  }

  function syncProductsFromOrders() {
    const list = state.doc.products || (state.doc.products = []);
    (state.doc.orders || []).forEach((order) => {
      (order.lines || []).forEach((line) => ensureProduct(line.product, line.unit, line.price));
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

  function renameProduct(oldName, nextName) {
    renameCatalogValue("product", oldName, nextName);
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

  function compareOrders(a, b, sort) {
    if (sort === "date-asc") return orderNewestStamp(a).localeCompare(orderNewestStamp(b));
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

  /* ==== Касса: платёжный календарь и дебиторка ==== */

  const DAY_MS = 86400000;
  const CASH_HORIZONS = [14, 30, 60, 90];
  const CASH_BUCKETS = [
    { id: "future", label: "Срок не наступил", color: "#0f766e" },
    { id: "d7", label: "Просрочка 1–7 дней", color: "#f59e0b" },
    { id: "d30", label: "Просрочка 8–30 дней", color: "#f97316" },
    { id: "d60", label: "Просрочка 31–60 дней", color: "#dc2626" },
    { id: "d60p", label: "Просрочка больше 60 дней", color: "#7f1d1d" },
    { id: "nodate", label: "Без даты заказа и оплаты", color: "#64748b" },
  ];
  const CASH_PIE_COLORS = ["#0f766e", "#2563eb", "#c9a227", "#7c3aed", "#0891b2", "#db2777", "#94a3b8"];
  const dayShortFmt = new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "short" });
  const dayLongFmt = new Intl.DateTimeFormat("ru-RU", { weekday: "short", day: "numeric", month: "short" });

  function cashState() {
    if (!state.cash) state.cash = { filter: "all", day: "", bucket: "", customer: "" };
    return state.cash;
  }

  function cashTerms() {
    const v = Number(ensureUi().payment_terms);
    if (!Number.isFinite(v) || v < 0) return 14;
    return Math.min(365, Math.round(v));
  }

  function cashHorizon() {
    const v = Number(ensureUi().cash_horizon);
    return CASH_HORIZONS.includes(v) ? v : 30;
  }

  function dayStart(d) {
    return new Date(d.getFullYear(), d.getMonth(), d.getDate());
  }

  function parseDay(iso) {
    if (!iso) return null;
    const m = String(iso).match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (m) return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? null : dayStart(d);
  }

  function addDays(d, n) {
    const x = new Date(d);
    x.setDate(x.getDate() + n);
    return x;
  }

  function dayDiff(from, to) {
    return Math.round((to.getTime() - from.getTime()) / DAY_MS);
  }

  function dayKey(d) {
    const p = (n) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  }

  function keyToDay(key) {
    const [y, m, d] = String(key).split("-").map(Number);
    if (!y || !m || !d) return null;
    return new Date(y, m - 1, d);
  }

  function daysWord(n) {
    const abs = Math.abs(Math.round(n)) % 100;
    const tail = abs % 10;
    if (abs > 10 && abs < 20) return "дней";
    if (tail === 1) return "день";
    if (tail >= 2 && tail <= 4) return "дня";
    return "дней";
  }

  function posWord(n) {
    const abs = Math.abs(Math.round(n)) % 100;
    const tail = abs % 10;
    if (abs > 10 && abs < 20) return "позиций";
    if (tail === 1) return "позиция";
    if (tail >= 2 && tail <= 4) return "позиции";
    return "позиций";
  }

  function ordWord(n) {
    const abs = Math.abs(Math.round(n)) % 100;
    const tail = abs % 10;
    if (abs > 10 && abs < 20) return "заказов";
    if (tail === 1) return "заказ";
    if (tail >= 2 && tail <= 4) return "заказа";
    return "заказов";
  }

  function cashCancelled(line) {
    return /отмен|аннул|черн/i.test(line.status || "");
  }

  function cashDue(line, terms) {
    const planned = parseDay(line.payment_date);
    if (planned) return { day: planned, planned: true };
    const ordered = parseDay(line.order_date);
    if (!ordered) return { day: null, planned: false };
    return { day: addDays(ordered, terms), planned: false };
  }

  function cashDiscipline(terms) {
    const acc = new Map();
    let dsoSum = 0;
    let dsoWeight = 0;
    allRows().forEach(({ order, line, totals }) => {
      if (totals.paid <= 0.005) return;
      const ordered = parseDay(line.order_date);
      const paidDay = parseDay(line.payment_date);
      if (!ordered || !paidDay) return;
      const lead = Math.max(0, dayDiff(ordered, paidDay));
      dsoSum += lead * totals.paid;
      dsoWeight += totals.paid;
      const key = String(order.customer || "").trim() || "Без заказчика";
      const cur = acc.get(key) || { delaySum: 0, weight: 0, last: "" };
      cur.delaySum += (lead - terms) * totals.paid;
      cur.weight += totals.paid;
      if ((line.payment_date || "") > cur.last) cur.last = line.payment_date || "";
      acc.set(key, cur);
    });
    const delays = new Map();
    acc.forEach((cur, key) => delays.set(key, { delay: cur.weight ? cur.delaySum / cur.weight : 0, last: cur.last }));
    return { dso: dsoWeight ? dsoSum / dsoWeight : 0, known: dsoWeight > 0, delays };
  }

  function cashData() {
    const terms = cashTerms();
    const today = dayStart(new Date());
    const history = cashDiscipline(terms);
    const items = [];
    let receivable = 0;
    let after = 0;
    let paid = 0;
    let cancelledDebt = 0;
    allRows().forEach(({ order, line, totals }) => {
      after += totals.after;
      paid += totals.paid;
      if (totals.unpaid <= 0.005) return;
      if (cashCancelled(line)) {
        cancelledDebt += totals.unpaid;
        return;
      }
      const customer = String(order.customer || "").trim() || "Без заказчика";
      const due = cashDue(line, terms);
      const delay = Math.round(history.delays.get(customer)?.delay || 0);
      const overdue = due.day ? dayDiff(due.day, today) : null;
      const expected = due.day ? new Date(Math.max(addDays(due.day, Math.max(0, delay)).getTime(), today.getTime())) : null;
      items.push({ order, line, totals, customer, amount: totals.unpaid, due: due.day, planned: due.planned, overdue, expected, delay });
      receivable += totals.unpaid;
    });
    items.sort((a, b) => {
      if (!a.due && !b.due) return b.amount - a.amount;
      if (!a.due) return 1;
      if (!b.due) return -1;
      return a.due - b.due || b.amount - a.amount;
    });
    return { terms, today, items, receivable, after, paid, cancelledDebt, history };
  }

  function cashSum(items) {
    return items.reduce((acc, it) => acc + it.amount, 0);
  }

  function cashBucketId(item) {
    if (item.overdue === null) return "nodate";
    if (item.overdue <= 0) return "future";
    if (item.overdue <= 7) return "d7";
    if (item.overdue <= 30) return "d30";
    if (item.overdue <= 60) return "d60";
    return "d60p";
  }

  function cashDateText(day) {
    return day ? dayShortFmt.format(day) : "не задан";
  }

  function cashDelayText(delay, known) {
    if (!known) return "нет истории оплат";
    const d = Math.round(delay);
    if (d > 1) return `+${d} ${daysWord(d)} к сроку`;
    if (d < -1) return `${Math.abs(d)} ${daysWord(d)} раньше срока`;
    return "платит в срок";
  }

  function renderCashflow() {
    const data = cashData();
    const terms = $("cash-terms");
    if (terms && document.activeElement !== terms) terms.value = data.terms;
    $("cash-horizon").value = String(cashHorizon());
    $("cash-note").textContent =
      data.cancelledDebt > 0.005
        ? `Отменённые и аннулированные позиции на ${money(data.cancelledDebt)} в дебиторку не входят`
        : "В дебиторку входят неоплаченные позиции без отмен и аннулирований";
    renderCashKpi(data);
    renderCashForecast(data);
    renderCashPie(data);
    renderCashCalendar(data);
    renderCashAging(data);
    renderCashChips(data);
    renderCashTable(data);
    renderCashDebtors(data);
  }

  function renderCashKpi(data) {
    const soon = (n) => data.items.filter((it) => it.expected && dayDiff(data.today, it.expected) <= n);
    const week = soon(7);
    const month = soon(30);
    const overdue = data.items.filter((it) => it.overdue > 0);
    const worst = overdue.reduce((acc, it) => Math.max(acc, it.overdue), 0);
    const dso = Math.round(data.history.dso);
    const collect = data.after ? Math.round((data.paid / data.after) * 100) : 0;
    const orders = new Set(data.items.map((it) => it.order.id)).size;
    $("cash-kpi").innerHTML = `
      <div class="kpi ok">
        <div class="label">Поступит за 7 дней</div>
        <div class="value">${money(cashSum(week))}</div>
        <div class="sub">${week.length} ${posWord(week.length)} · за 30 дней ${money(cashSum(month))}</div>
      </div>
      <div class="kpi ${overdue.length ? "warn" : ""}">
        <div class="label">Просрочено</div>
        <div class="value">${money(cashSum(overdue))}</div>
        <div class="sub">${overdue.length ? `${overdue.length} ${posWord(overdue.length)} · максимум ${worst} ${daysWord(worst)}` : "просрочки нет"}</div>
      </div>
      <div class="kpi">
        <div class="label">Средний срок оплаты</div>
        <div class="value">${data.history.known ? `${dso} ${daysWord(dso)}` : "нет данных"}</div>
        <div class="sub">по договору ${data.terms} ${daysWord(data.terms)}${data.history.known && dso > data.terms ? ` · платят на ${dso - data.terms} ${daysWord(dso - data.terms)} позже` : ""}</div>
      </div>
      <div class="kpi">
        <div class="label">Дебиторка всего</div>
        <div class="value">${money(data.receivable)}</div>
        <div class="sub">${orders} ${ordWord(orders)} · собираемость ${collect}%</div>
      </div>
    `;
  }

  function renderCashForecast(data) {
    const horizon = cashHorizon();
    const step = horizon <= 30 ? 1 : 7;
    const marks = [];
    for (let i = 0; i <= horizon; i += step) marks.push(i);
    if (marks[marks.length - 1] !== horizon) marks.push(horizon);
    const labels = marks.map((i) => (i === 0 ? "сегодня" : dayShortFmt.format(addDays(data.today, i))));
    const plan = marks.map((i) => cashSum(data.items.filter((it) => it.due && dayDiff(data.today, it.due) <= i)));
    const real = marks.map((i) => cashSum(data.items.filter((it) => it.expected && dayDiff(data.today, it.expected) <= i)));
    FinCharts.line($("chart-cash-line"), {
      labels,
      datasets: [
        { values: plan, color: "#0f766e", label: "Если платят в срок", fill: true },
        { values: real, color: "#c9a227", label: "С учётом дисциплины", dashed: true },
      ],
    });
  }

  function renderCashPie(data) {
    const map = new Map();
    data.items.forEach((it) => map.set(it.customer, (map.get(it.customer) || 0) + it.amount));
    const sorted = [...map.entries()].sort((a, b) => b[1] - a[1]);
    const top = sorted.slice(0, 6).map(([label, value], i) => ({ label, value, color: CASH_PIE_COLORS[i] }));
    const rest = sorted.slice(6).reduce((acc, [, value]) => acc + value, 0);
    if (rest > 0.005) top.push({ label: "Прочие", value: rest, color: CASH_PIE_COLORS[6] });
    FinCharts.doughnut($("chart-cash-pie"), top);
  }

  function cashDayRow({ key, title, note, items, tone }) {
    const sum = cashSum(items);
    const names = unique(items.map((it) => it.customer)).slice(0, 3).join(", ");
    const active = cashState().day === key ? " active" : "";
    return `<button type="button" class="cash-day${tone ? ` ${tone}` : ""}${active}" data-cash-day="${esc(key)}">
      <span class="cash-day-main"><b>${esc(title)}</b><small>${esc(note)}${names ? ` · ${esc(names)}` : ""}</small></span>
      <span class="cash-day-sum">${esc(money(sum))}<small>${items.length} ${posWord(items.length)}</small></span>
    </button>`;
  }

  function renderCashCalendar(data) {
    const horizon = cashHorizon();
    const days = new Map();
    const overdue = [];
    const later = [];
    const nodate = [];
    data.items.forEach((it) => {
      if (!it.due) {
        nodate.push(it);
        return;
      }
      const diff = dayDiff(data.today, it.due);
      if (diff < 0) {
        overdue.push(it);
        return;
      }
      if (diff > horizon) {
        later.push(it);
        return;
      }
      const key = dayKey(it.due);
      if (!days.has(key)) days.set(key, { day: it.due, items: [] });
      days.get(key).items.push(it);
    });
    const rows = [];
    if (overdue.length) {
      const worst = overdue.reduce((acc, it) => Math.max(acc, it.overdue), 0);
      rows.push(cashDayRow({ key: "overdue", title: "Просрочено", note: `до ${worst} ${daysWord(worst)} задержки`, items: overdue, tone: "bad" }));
    }
    [...days.values()]
      .sort((a, b) => a.day - b.day)
      .forEach((g) => {
        const diff = dayDiff(data.today, g.day);
        const note = diff === 0 ? "сегодня" : diff === 1 ? "завтра" : `через ${diff} ${daysWord(diff)}`;
        rows.push(cashDayRow({ key: dayKey(g.day), title: dayLongFmt.format(g.day), note, items: g.items, tone: diff <= 3 ? "soon" : "" }));
      });
    if (later.length) rows.push(cashDayRow({ key: "later", title: `Дальше ${horizon} ${daysWord(horizon)}`, note: "за горизонтом прогноза", items: later, tone: "" }));
    if (nodate.length) rows.push(cashDayRow({ key: "nodate", title: "Срок не определён", note: "нет даты заказа и оплаты", items: nodate, tone: "" }));
    $("cash-calendar").innerHTML = rows.length
      ? `<div class="cash-days">${rows.join("")}</div>`
      : `<div class="empty">Долгов нет — платёжный календарь пуст.</div>`;
  }

  function renderCashAging(data) {
    const f = cashState();
    const groups = CASH_BUCKETS.map((b) => {
      const items = data.items.filter((it) => cashBucketId(it) === b.id);
      return { ...b, items, sum: cashSum(items) };
    });
    const total = data.receivable;
    if (total <= 0.005) {
      $("cash-aging").innerHTML = `<div class="empty">Вся дебиторка закрыта — старение считать не от чего.</div>`;
      return;
    }
    const stack = groups
      .filter((g) => g.sum > 0.005)
      .map((g) => `<span class="aging-seg" style="flex:${g.sum};background:${g.color}" title="${esc(g.label)}: ${esc(money(g.sum))}"></span>`)
      .join("");
    const rows = groups
      .map(
        (g) => `<button type="button" class="aging-row${f.bucket === g.id ? " active" : ""}${g.sum > 0.005 ? "" : " dim"}" data-cash-bucket="${g.id}">
          <i style="background:${g.color}"></i>
          <span class="aging-label">${esc(g.label)}</span>
          <span class="aging-share">${Math.round((g.sum / total) * 100)}%</span>
          <span class="aging-sum">${esc(money(g.sum))}</span>
        </button>`
      )
      .join("");
    const bad = groups.filter((g) => g.id === "d60" || g.id === "d60p").reduce((acc, g) => acc + g.sum, 0);
    const badShare = Math.round((bad / total) * 100);
    $("cash-aging").innerHTML = `<div class="aging-stack">${stack}</div><div class="aging-rows">${rows}</div>
      <p class="hint aging-hint">Безнадёжная зона (просрочка больше 30 дней): ${money(bad)} — ${badShare}% дебиторки.${badShare >= 20 ? " Портфель требует работы с должниками." : ""}</p>`;
  }

  function cashDayLabel(key) {
    if (key === "overdue") return "просрочка";
    if (key === "nodate") return "без срока";
    if (key === "later") return "за горизонтом";
    const day = keyToDay(key);
    return day ? dayShortFmt.format(day) : key;
  }

  function cashVisible(data) {
    const f = cashState();
    const horizon = cashHorizon();
    return data.items.filter((it) => {
      if (f.customer && it.customer !== f.customer) return false;
      if (f.bucket && cashBucketId(it) !== f.bucket) return false;
      if (f.day === "overdue" && !(it.overdue > 0)) return false;
      if (f.day === "nodate" && it.due) return false;
      if (f.day === "later" && !(it.due && dayDiff(data.today, it.due) > horizon)) return false;
      if (f.day && !["overdue", "nodate", "later"].includes(f.day) && (!it.due || dayKey(it.due) !== f.day)) return false;
      if (f.filter === "overdue" && !(it.overdue > 0)) return false;
      if (f.filter === "week" && !(it.due && dayDiff(data.today, it.due) <= 7)) return false;
      if (f.filter === "nodate" && it.due) return false;
      return true;
    });
  }

  function renderCashChips(data) {
    const f = cashState();
    const counts = {
      all: data.items.length,
      overdue: data.items.filter((it) => it.overdue > 0).length,
      week: data.items.filter((it) => it.due && dayDiff(data.today, it.due) <= 7).length,
      nodate: data.items.filter((it) => !it.due).length,
    };
    const chip = (id, label) =>
      `<button type="button" class="chip ${f.filter === id ? "active" : ""}" data-cash-filter="${id}">${label}<span class="chip-count">${counts[id]}</span></button>`;
    let html = chip("all", "Все") + chip("overdue", "Просрочено") + chip("week", "Срок ≤ 7 дней") + chip("nodate", "Без срока");
    if (f.day) html += `<button type="button" class="chip active" data-cash-clear="day" title="Убрать фильтр">День: ${esc(cashDayLabel(f.day))} ✕</button>`;
    if (f.bucket) {
      const bucket = CASH_BUCKETS.find((b) => b.id === f.bucket);
      html += `<button type="button" class="chip active" data-cash-clear="bucket" title="Убрать фильтр">${esc(bucket?.label || f.bucket)} ✕</button>`;
    }
    if (f.customer) html += `<button type="button" class="chip active" data-cash-clear="customer" title="Убрать фильтр">${esc(f.customer)} ✕</button>`;
    $("cash-chips").innerHTML = html;
  }

  function renderCashTable(data) {
    const rows = cashVisible(data);
    if (!rows.length) {
      $("cash-table").innerHTML = `<div class="empty">Под выбранный фильтр нет позиций.</div>`;
      return;
    }
    const body = rows
      .map((it) => {
        const bucket = CASH_BUCKETS.find((b) => b.id === cashBucketId(it));
        const overdueText = it.overdue === null ? "—" : it.overdue > 0 ? `${it.overdue} ${daysWord(it.overdue)}` : `в запасе ${Math.abs(it.overdue)} ${daysWord(it.overdue)}`;
        const dueHint = it.planned ? "дата оплаты указана в позиции" : `дата заказа + ${data.terms} ${daysWord(data.terms)}`;
        return `<tr data-cash-line="${esc(it.line.id)}" data-cash-order="${esc(it.order.id)}" data-cash-customer="${esc(it.customer)}">
          <td><button type="button" class="link-btn" data-cash-act="customer">${esc(it.customer)}</button></td>
          <td>${esc(it.order.number || "—")}${it.order.name ? `<small class="cash-sub">${esc(it.order.name)}</small>` : ""}</td>
          <td>${esc(it.line.product || "без продукта")}<small class="cash-sub">${esc(qtyValue(it.line))} ${esc(it.line.unit || "")}</small></td>
          <td class="num">${esc(money(it.amount))}<small class="cash-sub">из ${esc(money(it.totals.after))}</small></td>
          <td title="${esc(dueHint)}">${esc(cashDateText(it.due))}</td>
          <td><span class="pill" style="background:${bucket?.color || "#64748b"}">${esc(overdueText)}</span></td>
          <td>${it.expected ? esc(cashDateText(it.expected)) : "—"}${it.delay > 1 ? `<small class="cash-sub">клиент платит +${it.delay} ${daysWord(it.delay)}</small>` : ""}</td>
          <td><span class="pill" style="background:${statusMeta(it.line.status).color}">${esc(it.line.status)}</span></td>
          <td class="cash-acts">
            <button class="btn small" type="button" data-cash-act="open">Заказ</button>
            <button class="btn small" type="button" data-cash-act="remind">Напомнить</button>
            <button class="btn small primary" type="button" data-cash-act="pay">Оплата</button>
          </td>
        </tr>`;
      })
      .join("");
    $("cash-table").innerHTML = `<table class="data cash-table"><thead><tr>
        <th>Заказчик</th><th>Заказ</th><th>Позиция</th><th class="num">Долг</th><th>Срок оплаты</th><th>Просрочка</th><th>Прогноз оплаты</th><th>Статус</th><th></th>
      </tr></thead><tbody>${body}</tbody>
      <tfoot><tr>
        <td colspan="3">Итого ${rows.length} ${posWord(rows.length)}</td>
        <td class="num">${esc(money(cashSum(rows)))}</td>
        <td colspan="5"></td>
      </tr></tfoot></table>`;
  }

  function renderCashDebtors(data) {
    const map = new Map();
    data.items.forEach((it) => {
      const cur = map.get(it.customer) || { debt: 0, overdue: 0, count: 0, orders: new Set(), worst: 0, next: null };
      cur.debt += it.amount;
      cur.count += 1;
      cur.orders.add(it.order.id);
      if (it.overdue > 0) {
        cur.overdue += it.amount;
        cur.worst = Math.max(cur.worst, it.overdue);
      }
      if (it.due && (!cur.next || it.due < cur.next)) cur.next = it.due;
      map.set(it.customer, cur);
    });
    const list = [...map.entries()]
      .map(([name, v]) => {
        const hist = data.history.delays.get(name);
        return { name, ...v, delay: hist?.delay || 0, known: !!hist, last: hist?.last || "" };
      })
      .sort((a, b) => b.overdue - a.overdue || b.debt - a.debt);
    if (!list.length) {
      $("cash-debtors").innerHTML = `<div class="empty">Должников нет — все позиции оплачены.</div>`;
      return;
    }
    const body = list
      .map(
        (c) => `<tr data-cash-customer="${esc(c.name)}">
          <td><button type="button" class="link-btn" data-cash-dact="filter">${esc(c.name)}</button></td>
          <td class="num">${esc(money(c.debt))}</td>
          <td class="num">${c.overdue > 0.005 ? `<b class="cash-bad">${esc(money(c.overdue))}</b><small class="cash-sub">до ${c.worst} ${daysWord(c.worst)}</small>` : "—"}</td>
          <td class="num">${c.count} / ${c.orders.size}</td>
          <td>${esc(cashDateText(c.next))}</td>
          <td>${esc(cashDelayText(c.delay, c.known))}</td>
          <td>${c.last ? esc(c.last.slice(0, 10)) : "—"}</td>
          <td class="cash-acts"><button class="btn small" type="button" data-cash-dact="remind">Напомнить</button></td>
        </tr>`
      )
      .join("");
    $("cash-debtors").innerHTML = `<table class="data cash-table"><thead><tr>
        <th>Заказчик</th><th class="num">Долг</th><th class="num">Просрочено</th><th class="num">Поз. / зак.</th><th>Ближайший срок</th><th>Дисциплина</th><th>Последняя оплата</th><th></th>
      </tr></thead><tbody>${body}</tbody></table>`;
  }

  function cashReminderText(customer, items, data) {
    const total = cashSum(items);
    const out = [`Здравствуйте, ${customer}!`, "", `Напоминаем об оплате по ${items.length > 1 ? "заказам" : "заказу"}:`];
    const byOrder = new Map();
    items.forEach((it) => {
      if (!byOrder.has(it.order.id)) byOrder.set(it.order.id, { order: it.order, items: [] });
      byOrder.get(it.order.id).items.push(it);
    });
    byOrder.forEach(({ order, items: lines }) => {
      const sum = cashSum(lines);
      const due = lines.reduce((acc, it) => (it.due && (!acc || it.due < acc) ? it.due : acc), null);
      const worst = lines.reduce((acc, it) => Math.max(acc, it.overdue || 0), 0);
      const dueText = due ? ` · срок оплаты ${cashDateText(due)}${worst > 0 ? `, просрочка ${worst} ${daysWord(worst)}` : ""}` : "";
      out.push("", `Заказ ${order.number || ""}${order.name ? ` «${order.name}»` : ""} — остаток ${money(sum)}${dueText}`);
      lines.forEach((it) => {
        out.push(`  • ${it.line.product || "позиция"} — ${qtyValue(it.line)} ${it.line.unit || ""}: ${money(it.amount)}`.replace(/\s+:/, ":"));
      });
    });
    out.push("", `Итого к оплате: ${money(total)}`);
    if (data.terms) out.push(`Срок оплаты по договорённости — ${data.terms} ${daysWord(data.terms)} от даты заказа.`);
    return out.join("\n");
  }

  function cashSummaryText(data) {
    const soon = (n) => cashSum(data.items.filter((it) => it.expected && dayDiff(data.today, it.expected) <= n));
    const overdue = data.items.filter((it) => it.overdue > 0);
    const dso = Math.round(data.history.dso);
    const out = [
      `Касса и дебиторка — ${state.doc.title || "отчёт"}`,
      `На дату: ${dayLongFmt.format(data.today)}`,
      "",
      `Дебиторка: ${money(data.receivable)} (${data.items.length} ${posWord(data.items.length)} в ${new Set(data.items.map((it) => it.order.id)).size} ${ordWord(new Set(data.items.map((it) => it.order.id)).size)})`,
      `Просрочено: ${money(cashSum(overdue))} (${overdue.length} ${posWord(overdue.length)})`,
      `Ожидается за 7 дней: ${money(soon(7))}, за 30 дней: ${money(soon(30))}`,
      `Средний срок оплаты: ${data.history.known ? `${dso} ${daysWord(dso)}` : "нет данных"} (по договору ${data.terms} ${daysWord(data.terms)})`,
      "",
      "Старение дебиторки:",
    ];
    CASH_BUCKETS.forEach((b) => {
      const sum = cashSum(data.items.filter((it) => cashBucketId(it) === b.id));
      if (sum > 0.005) out.push(`  • ${b.label}: ${money(sum)}`);
    });
    const byCustomer = new Map();
    data.items.forEach((it) => byCustomer.set(it.customer, (byCustomer.get(it.customer) || 0) + it.amount));
    const top = [...byCustomer.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);
    if (top.length) {
      out.push("", "Крупнейшие должники:");
      top.forEach(([name, sum], i) => out.push(`  ${i + 1}. ${name} — ${money(sum)}`));
    }
    return out.join("\n");
  }

  async function cashCopy(text, okMessage) {
    try {
      if (state.desktop) await apiPost("/api/clipboard-text", { text });
      else if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(text);
      else throw new Error("clipboard");
      toast(okMessage);
    } catch {
      toast("Не удалось скопировать текст");
    }
  }

  function cashResetFilters() {
    const f = cashState();
    f.filter = "all";
    f.day = "";
    f.bucket = "";
    f.customer = "";
  }

  function cashMarkPaid(item) {
    historyCommit();
    const line = item.line;
    line.paid = item.totals.after;
    line.paid_expr = String(item.totals.after);
    if (!line.payment_date) line.payment_date = nowLocal();
    applyPaidIfCovered(line);
    markDirty();
    renderCashflow();
    undoToast(`Оплата ${money(item.amount)} по заказу ${item.order.number || ""}`.trim());
  }

  function onCashTableClick(e) {
    const btn = e.target.closest("[data-cash-act]");
    if (!btn) return;
    const tr = btn.closest("tr[data-cash-line]");
    if (!tr) return;
    const data = cashData();
    const item = data.items.find((it) => it.line.id === tr.dataset.cashLine);
    if (!item) return;
    const act = btn.dataset.cashAct;
    if (act === "open") {
      gotoOrder(item.order.id);
      return;
    }
    if (act === "customer") {
      const f = cashState();
      f.customer = f.customer === item.customer ? "" : item.customer;
      renderCashflow();
      return;
    }
    if (act === "remind") {
      const items = data.items.filter((it) => it.order.id === item.order.id);
      cashCopy(cashReminderText(item.customer, items, data), "Напоминание по заказу скопировано");
      return;
    }
    if (act === "pay") cashMarkPaid(item);
  }

  function onCashDebtorsClick(e) {
    const btn = e.target.closest("[data-cash-dact]");
    if (!btn) return;
    const tr = btn.closest("tr[data-cash-customer]");
    if (!tr) return;
    const customer = tr.dataset.cashCustomer;
    if (btn.dataset.cashDact === "filter") {
      const f = cashState();
      f.customer = f.customer === customer ? "" : customer;
      renderCashflow();
      return;
    }
    const data = cashData();
    const items = data.items.filter((it) => it.customer === customer);
    if (!items.length) return;
    cashCopy(cashReminderText(customer, items, data), `Напоминание для ${customer} скопировано`);
  }

  function bindCashflow() {
    $("cash-terms")?.addEventListener("change", (e) => {
      if (!state.doc) return;
      const v = Math.max(0, Math.min(365, Math.round(Number(e.target.value) || 0)));
      e.target.value = v;
      if (cashTerms() === v) return;
      ensureUi().payment_terms = v;
      markDirty();
      renderCashflow();
    });
    $("cash-horizon")?.addEventListener("change", (e) => {
      if (!state.doc) return;
      const v = Number(e.target.value) || 30;
      ensureUi().cash_horizon = CASH_HORIZONS.includes(v) ? v : 30;
      markDirty();
      renderCashflow();
    });
    $("cash-copy")?.addEventListener("click", () => {
      if (!state.doc) return;
      cashCopy(cashSummaryText(cashData()), "Сводка по кассе скопирована");
    });
    $("cash-calendar")?.addEventListener("click", (e) => {
      const btn = e.target.closest("[data-cash-day]");
      if (!btn) return;
      const f = cashState();
      f.day = f.day === btn.dataset.cashDay ? "" : btn.dataset.cashDay;
      renderCashflow();
    });
    $("cash-aging")?.addEventListener("click", (e) => {
      const btn = e.target.closest("[data-cash-bucket]");
      if (!btn) return;
      const f = cashState();
      f.bucket = f.bucket === btn.dataset.cashBucket ? "" : btn.dataset.cashBucket;
      renderCashflow();
    });
    $("cash-chips")?.addEventListener("click", (e) => {
      const f = cashState();
      const filter = e.target.closest("[data-cash-filter]");
      if (filter) {
        f.filter = filter.dataset.cashFilter;
        renderCashflow();
        return;
      }
      const clear = e.target.closest("[data-cash-clear]");
      if (!clear) return;
      f[clear.dataset.cashClear] = "";
      renderCashflow();
    });
    $("cash-table")?.addEventListener("click", onCashTableClick);
    $("cash-debtors")?.addEventListener("click", onCashDebtorsClick);
  }

  /* ==== Календарь работ ==== */
  const CALENDAR_MODES = ["timeline", "classic", "extended"];
  const CALENDAR_FILTERS = [
    ["all", "Все"],
    ["now", "Идёт сейчас"],
    ["planned", "Запланированы"],
    ["done", "Завершены"],
    ["nodate", "Без дат"],
  ];
  const RU_MONTHS_GEN = ["января", "февраля", "марта", "апреля", "мая", "июня", "июля", "августа", "сентября", "октября", "ноября", "декабря"];
  const RU_MONTHS_NOM = ["Январь", "Февраль", "Март", "Апрель", "Май", "Июнь", "Июль", "Август", "Сентябрь", "Октябрь", "Ноябрь", "Декабрь"];
  const RU_WEEKDAYS = ["пн", "вт", "ср", "чт", "пт", "сб", "вс"];
  const RU_WEEKDAYS_FULL = ["понедельник", "вторник", "среда", "четверг", "пятница", "суббота", "воскресенье"];
  const WORK_STATUS = {
    nodate: { label: "без дат", tone: "mute" },
    planned: { label: "запланирован", tone: "wait" },
    now: { label: "идёт сейчас", tone: "now" },
    done: { label: "завершён", tone: "ok" },
    overdue: { label: "просрочен", tone: "warn" },
    cancelled: { label: "снят", tone: "mute" },
    paused: { label: "На паузе", tone: "pause" },
  };
  const CAL_HOT_LOAD = 4;
  const TL_MIN_DAYS = 3;
  const TL_DEFAULT_DAYS = 21;
  const CAL_BAR_PAID = "#059669";
  const CAL_BAR_DEBT = "#d97706";
  const CAL_BAR_DUE = "#dc2626";
  const DEFAULT_WEEKENDS = [5, 6];
  let calDrag = null;
  let calNav = null;
  let calSkipClick = false;

  function mondayOf(d) {
    const x = dayStart(d);
    return addDays(x, -((x.getDay() + 6) % 7));
  }

  function rangeDays(from, to) {
    const days = [];
    for (let d = dayStart(from); d <= to; d = addDays(d, 1)) days.push(d);
    return days;
  }

  function weekdayIndex(d) {
    return (d.getDay() + 6) % 7;
  }

  function normalizeWeekends(raw) {
    if (!Array.isArray(raw)) return DEFAULT_WEEKENDS.slice();
    const out = [];
    raw.forEach((v) => {
      const n = Number(v);
      if (Number.isInteger(n) && n >= 0 && n <= 6 && !out.includes(n)) out.push(n);
    });
    return out.sort((a, b) => a - b);
  }

  function normalizeDayList(raw) {
    if (!Array.isArray(raw)) return [];
    const out = [];
    raw.forEach((v) => {
      const key = dateDay(v);
      if (/^\d{4}-\d{2}-\d{2}$/.test(key) && !out.includes(key)) out.push(key);
    });
    return out.sort();
  }

  function calendarOffSettings() {
    const saved = ensureUi().calendar || {};
    const weekends = "weekends" in saved ? normalizeWeekends(saved.weekends) : DEFAULT_WEEKENDS.slice();
    const workDays = normalizeDayList(saved.work_days);
    const workSet = new Set(workDays);
    const offDays = normalizeDayList(saved.off_days).filter((key) => !workSet.has(key));
    return { weekends, offDays, workDays };
  }

  function pruneOffLists(weekends, offDays, workDays) {
    const off = offDays.filter((key) => {
      const d = parseDay(key);
      return d && !weekends.includes(weekdayIndex(d));
    });
    const work = workDays.filter((key) => {
      const d = parseDay(key);
      return d && weekends.includes(weekdayIndex(d));
    });
    return { offDays: off, workDays: work };
  }

  function writeCalendarOff({ weekends, offDays, workDays } = {}) {
    const cur = calendarOffSettings();
    const nextW = weekends ?? cur.weekends;
    const pruned = pruneOffLists(nextW, offDays ?? cur.offDays, workDays ?? cur.workDays);
    const ui = ensureUi();
    ui.calendar = {
      ...(ui.calendar || {}),
      weekends: nextW,
      off_days: pruned.offDays,
      work_days: pruned.workDays,
    };
  }

  function isWeekend(d) {
    const tone = dayToneClass(d);
    return tone === "is-weekend" || tone === "is-off-day";
  }

  function isGlobalWeekend(d) {
    const off = calendarOffSettings();
    if (off.workDays.includes(dayKey(d))) return false;
    return off.weekends.includes(weekdayIndex(d));
  }

  function dayToneClass(d) {
    const key = dayKey(d);
    const off = calendarOffSettings();
    if (off.workDays.includes(key)) return "is-work-day";
    if (off.offDays.includes(key)) return "is-off-day";
    if (off.weekends.includes(weekdayIndex(d))) return "is-weekend";
    return "";
  }

  function calendarDayNotes() {
    const raw = ensureUi().calendar?.day_notes;
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
    const out = {};
    Object.keys(raw).forEach((key) => {
      const day = dateDay(key);
      const text = String(raw[key] || "").trim();
      if (/^\d{4}-\d{2}-\d{2}$/.test(day) && text) out[day] = text.slice(0, 2000);
    });
    return out;
  }

  function dayNote(d) {
    return calendarDayNotes()[typeof d === "string" ? d : dayKey(d)] || "";
  }

  function setDayNote(key, text) {
    if (!key) return;
    const notes = calendarDayNotes();
    const clean = String(text || "").trim().slice(0, 2000);
    if (clean) notes[key] = clean;
    else delete notes[key];
    const ui = ensureUi();
    ui.calendar = { ...(ui.calendar || {}), day_notes: notes };
    persistCalendar();
    markDirty();
  }

  function calFmtDay(d, withYear = false) {
    const text = `${d.getDate()} ${RU_MONTHS_GEN[d.getMonth()]}`;
    return withYear ? `${text} ${d.getFullYear()}` : text;
  }

  function calFmtRange(from, to) {
    if (from.getFullYear() === to.getFullYear() && from.getMonth() === to.getMonth()) {
      return `${from.getDate()}–${calFmtDay(to, true)}`;
    }
    if (from.getFullYear() === to.getFullYear()) {
      return `${calFmtDay(from)} — ${calFmtDay(to, true)}`;
    }
    return `${calFmtDay(from, true)} — ${calFmtDay(to, true)}`;
  }

  function orderIsOff(order) {
    const income = (order.lines || []).filter((line) => !isFrozenLine(line) && !isExpenseLine(line));
    if (!income.length) return false;
    return income.every((line) => /отмен|аннул|черн/i.test(line.status || ""));
  }

  function workPauses(order) {
    return Array.isArray(order?.work_pauses) ? order.work_pauses : [];
  }

  function pauseIsOpen(order, pause) {
    if (!pause || dateDay(order.work_end)) return false;
    if (pause.open) return true;
    const till = dateDay(pause.end);
    if (!till) return !!dateDay(pause.start);
    return till >= dayKey(dayStart(new Date()));
  }

  function pauseEndKey(order, pause, today = dayStart(new Date())) {
    if (pauseIsOpen(order, pause)) return dayKey(today);
    return dateDay(pause?.end);
  }

  function isPaused(order, day) {
    const key = typeof day === "string" ? String(day).slice(0, 10) : dayKey(dayStart(day));
    const today = dayStart(new Date());
    return workPauses(order).some((pause) => {
      const from = dateDay(pause.start);
      const till = pauseEndKey(order, pause, today);
      return from && till && key >= from && key <= till;
    });
  }

  function clampDay(day, min, max) {
    if (min && day < min) day = min;
    if (max && day > max) day = max;
    return day;
  }

  function normalizeWorkPauses(order, merge = true) {
    const start = dateDay(order.work_start);
    const end = dateDay(order.work_end);
    if (!start && !end) {
      order.work_pauses = [];
      return order;
    }
    const envStart = start;
    const envEnd = end || (start ? dayKey(dayStart(new Date())) : "");
    const items = [];
    workPauses(order).forEach((pause) => {
      if (!pause || typeof pause !== "object") return;
      let from = dateDay(pause.start);
      let till = dateDay(pause.end);
      const todayKey = envEnd && !end ? envEnd : dayKey(dayStart(new Date()));
      const wasOpen = !!(pause.open || !till);
      let open = !end && (wasOpen || (till && envEnd && till >= envEnd));
      if (from && till && till < from) [from, till] = [till, from];
      if (!from && !till && !wasOpen) return;
      from = from || till || envStart;
      if (envStart && from < envStart) from = envStart;
      if (open) till = envEnd;
      else {
        if (wasOpen) till = todayKey;
        till = till || from;
        if (envEnd && till > envEnd) till = envEnd;
      }
      if (envStart && till < envStart) return;
      if (envEnd && from > envEnd) return;
      if (from && till && from <= till) {
        items.push(open ? { start: from, end: merge ? "" : till, open: true } : { start: from, end: till });
      }
    });
    items.sort((a, b) => a.start.localeCompare(b.start) || String(a.end || envEnd).localeCompare(String(b.end || envEnd)));
    if (!merge) {
      order.work_pauses = items;
      return order;
    }
    const merged = [];
    items.forEach((pause) => {
      const last = merged[merged.length - 1];
      const lastEndKey = last ? (last.open ? envEnd : last.end) : "";
      const lastEnd = lastEndKey ? parseDay(lastEndKey) : null;
      const nextStart = parseDay(pause.start);
      if (last && lastEnd && nextStart && nextStart <= addDays(lastEnd, 1)) {
        if (pause.open || last.open) {
          last.end = "";
          last.open = true;
        } else if (pause.end > last.end) last.end = pause.end;
        return;
      }
      merged.push(pause.open ? { start: pause.start, end: "", open: true } : { start: pause.start, end: pause.end });
    });
    order.work_pauses = merged;
    return order;
  }

  function addWorkPause(order, day) {
    const span = orderDrawSpan(order);
    const parsed = day instanceof Date ? dayStart(day) : parseDay(day);
    if (!span || !parsed) return false;
    const key = dayKey(parsed);
    if (key < dayKey(span.from) || key > dayKey(span.till)) return false;
    if (isPaused(order, key)) return false;
    order.work_pauses = workPauses(order).concat({ start: key, end: key });
    normalizeWorkPauses(order);
    return true;
  }

  function removePauseCovering(order, day) {
    const key = typeof day === "string" ? String(day).slice(0, 10) : dayKey(dayStart(day));
    const next = workPauses(order).filter((pause) => {
      const from = dateDay(pause.start);
      const till = pauseEndKey(order, pause);
      return !(from && till && key >= from && key <= till);
    });
    if (next.length === workPauses(order).length) return false;
    order.work_pauses = next;
    normalizeWorkPauses(order);
    return true;
  }

  function removePauseAt(order, index) {
    const list = workPauses(order).slice();
    if (index < 0 || index >= list.length) return false;
    list.splice(index, 1);
    order.work_pauses = list;
    normalizeWorkPauses(order);
    return true;
  }

  function pauseInEnvelope(order, day) {
    const span = orderDrawSpan(order);
    const parsed = day instanceof Date ? dayStart(day) : parseDay(day);
    if (!span || !parsed) return false;
    const key = dayKey(parsed);
    return key >= dayKey(span.from) && key <= dayKey(span.till);
  }

  function normalizeWorkDates(order, { mergePauses = true, lines = true } = {}) {
    const start = dateDay(order.work_start);
    const end = dateDay(order.work_end);
    order.work_start = start;
    order.work_end = end;
    if (start && end && end < start) {
      order.work_start = end;
      order.work_end = start;
    }
    if (!order.work_start && !order.work_end) order.work_pauses = [];
    else normalizeWorkPauses(order, mergePauses);
    if (lines) normalizeOrderLinesWork(order);
    return order;
  }

  function calendarWorkLines(order) {
    return (order?.lines || []).filter((line) => !isFrozenLine(line) && !isExpenseLine(line));
  }

  function findCalendarLine(order, lineId) {
    if (!order || !lineId) return null;
    return (order.lines || []).find((line) => line.id === lineId) || null;
  }

  function lineWorkName(line, index = 0) {
    const name = String(line?.product || "").trim() || String(line?.order_type || "").trim();
    return name || `Позиция ${index + 1}`;
  }

  function lineDateFloor(line) {
    return dateDay(line?.order_date) || "";
  }

  function dayKeyMax(...keys) {
    return keys.filter(Boolean).sort().at(-1) || "";
  }

  function lineWorkProxy(order, line) {
    const floor = lineDateFloor(line);
    let start = dateDay(line?.work_start) || dateDay(order?.work_start);
    let end = dateDay(line?.work_end) || dateDay(order?.work_end);
    if (floor) {
      if (start && start < floor) start = floor;
      if (end && end < floor) end = floor;
    }
    return {
      work_start: start || "",
      work_end: end || "",
      work_pauses: Array.isArray(line?.work_pauses) ? line.work_pauses.map((pause) => ({ ...pause })) : [],
    };
  }

  function clampLineToOrder(order, start, end, line) {
    const oStart = dateDay(order?.work_start);
    const oEnd = dateDay(order?.work_end);
    const floor = lineDateFloor(line);
    let a = dateDay(start);
    let b = dateDay(end);
    if (oStart && a && a < oStart) a = oStart;
    if (oEnd && a && a > oEnd) a = oEnd;
    if (oStart && b && b < oStart) b = oStart;
    if (oEnd && b && b > oEnd) b = oEnd;
    if (floor && a && a < floor) a = floor;
    if (floor && b && b < floor) b = floor;
    if (a && b && b < a) [a, b] = [b, a];
    if (floor && a && a < floor) a = floor;
    if (a && b && b < a) b = a;
    return { start: a, end: b };
  }

  function writeLineWork(order, line, proxy) {
    if (!line) return;
    normalizeWorkDates(proxy, { mergePauses: true, lines: false });
    const clamped = clampLineToOrder(order, proxy.work_start, proxy.work_end, line);
    proxy.work_start = clamped.start;
    proxy.work_end = clamped.end;
    normalizeWorkDates(proxy, { mergePauses: true, lines: false });
    const pauses = workPauses(proxy);
    const oStart = dateDay(order.work_start);
    const oEnd = dateDay(order.work_end);
    const defaultStart = dayKeyMax(oStart, lineDateFloor(line));
    const sameDates = dateDay(proxy.work_start) === defaultStart && dateDay(proxy.work_end) === oEnd;
    if (!dateDay(proxy.work_start) && !dateDay(proxy.work_end)) {
      line.work_start = "";
      line.work_end = "";
      line.work_pauses = [];
      return;
    }
    if (sameDates) {
      line.work_start = "";
      line.work_end = "";
      line.work_pauses = pauses;
      return;
    }
    line.work_start = dateDay(proxy.work_start);
    line.work_end = dateDay(proxy.work_end);
    line.work_pauses = pauses;
  }

  function normalizeOrderLinesWork(order) {
    if (!dateDay(order.work_start) && !dateDay(order.work_end)) {
      calendarWorkLines(order).forEach((line) => {
        line.work_start = "";
        line.work_end = "";
        line.work_pauses = [];
      });
      return order;
    }
    calendarWorkLines(order).forEach((line) => {
      const proxy = lineWorkProxy(order, line);
      writeLineWork(order, line, proxy);
    });
    return order;
  }

  function lineDrawEnvelope(order, line) {
    const env = orderDrawSpan(order);
    if (!env) return null;
    const floor = parseDay(lineDateFloor(line));
    let from = env.from;
    if (floor) {
      if (floor > env.till) from = env.till;
      else if (floor > from) from = floor;
    }
    if (from > env.till) return null;
    return { from, till: env.till };
  }

  function clampLineProxy(order, proxy, drag) {
    const line = drag?.line;
    const env = lineDrawEnvelope(order, line) || orderDrawSpan(order);
    if (!env) return;
    let start = parseDay(proxy.work_start);
    let end = parseDay(proxy.work_end);
    if (drag?.mode === "move" && start) {
      const len = end ? dayDiff(start, end) : 0;
      if (start < env.from) start = env.from;
      if (end) {
        end = addDays(start, len);
        if (end > env.till) {
          end = env.till;
          start = addDays(end, -len);
        }
        if (start < env.from) start = env.from;
        proxy.work_end = dayKey(end);
      } else if (start > env.till) start = env.till;
      if (start < env.from) start = env.from;
      proxy.work_start = dayKey(start);
      return;
    }
    const c = clampLineToOrder(order, proxy.work_start, proxy.work_end, line);
    proxy.work_start = c.start;
    proxy.work_end = c.end;
  }

  function lineWorkMeta(order, line, day) {
    if (/отмен|аннул|черн/i.test(line?.status || "")) return { id: "cancelled", ...WORK_STATUS.cancelled };
    return workStatusMeta(lineWorkProxy(order, line), day);
  }

  function calendarLinesOpen(orderId) {
    return !!calendarState().openLines?.[orderId];
  }

  function toggleCalendarLines(orderId) {
    const cal = calendarState();
    if (!cal.openLines) cal.openLines = {};
    if (cal.openLines[orderId]) delete cal.openLines[orderId];
    else cal.openLines[orderId] = true;
    cal.selected = orderId;
    cal.selectedLine = "";
    renderCalendar();
  }

  function workSpan(order) {
    return {
      start: parseDay(order.work_start),
      end: parseDay(order.work_end),
      startKey: dateDay(order.work_start),
      endKey: dateDay(order.work_end),
    };
  }

  function orderDeadline(order, today = dayStart(new Date())) {
    const end = parseDay(order.work_end);
    if (!end || end <= today) return null;
    return end;
  }

  function workStatus(order, today = dayStart(new Date())) {
    if (orderIsOff(order)) return "cancelled";
    const { start, end } = workSpan(order);
    if (!start && !end) return "nodate";
    if (start && !end) {
      if (start > today) return "planned";
      return "now";
    }
    if (!start && end) {
      if (end <= today) return "done";
      return "now";
    }
    if (today < start) return "planned";
    if (end <= today) return "done";
    return "now";
  }

  function orderIsPausedNow(order, today = dayStart(new Date())) {
    const st = workStatus(order, today);
    if (st === "cancelled" || st === "nodate") return false;
    return isPaused(order, today);
  }

  function workStatusMeta(order, day) {
    const id = workStatus(order);
    const paused = day ? isPaused(order, day) : orderIsPausedNow(order);
    if (paused && id !== "cancelled" && id !== "nodate") return { id: "paused", ...WORK_STATUS.paused };
    return { id, ...(WORK_STATUS[id] || WORK_STATUS.nodate) };
  }

  const TL_STATUS_RANK = { now: 0, overdue: 1, planned: 2, done: 3, cancelled: 4, nodate: 5 };

  function timelineFreshness(order, today) {
    const { start, end } = workSpan(order);
    const st = workStatus(order, today);
    if (st === "now" || st === "overdue") return start ? start.getTime() : today.getTime();
    if (st === "planned") return start ? -start.getTime() : Number.NEGATIVE_INFINITY;
    if (st === "done") return (end || start || today).getTime();
    return 0;
  }

  function compareTimelineOrders(a, b, today) {
    const ra = TL_STATUS_RANK[workStatus(a, today)] ?? 9;
    const rb = TL_STATUS_RANK[workStatus(b, today)] ?? 9;
    if (ra !== rb) return ra - rb;
    const fa = timelineFreshness(a, today);
    const fb = timelineFreshness(b, today);
    if (fa !== fb) return fb - fa;
    return String(a.number).localeCompare(String(b.number), "ru", { numeric: true });
  }

  function firstWorkOnOrAfter(day, limit) {
    const cap = dayStart(limit || addDays(day, 16));
    for (let d = dayStart(day); d <= cap; d = addDays(d, 1)) {
      if (!isWeekend(d)) return d;
    }
    return null;
  }

  function orderCoversDay(order, day) {
    if (isWeekend(day) || isPaused(order, day)) return false;
    const { start, end } = workSpan(order);
    if (!start && !end) return false;
    const d = dayStart(day);
    const today = dayStart(new Date());
    if (start && !end) {
      if (start > today) {
        const shown = isWeekend(start) ? firstWorkOnOrAfter(start) : start;
        return shown && dayKey(d) === dayKey(shown);
      }
      return d >= start && d <= today;
    }
    if (!start && end) return d <= end;
    return d >= start && d <= end;
  }

  function orderMarksDay(order, day) {
    if (isWeekend(day)) return false;
    return isPaused(order, day) || orderCoversDay(order, day);
  }

  function splitWorkSegments(from, till, order) {
    if (!from || !till || from > till) return [];
    const segments = [];
    let segStart = null;
    let prev = null;
    for (let d = dayStart(from); d <= till; d = addDays(d, 1)) {
      if (!isWeekend(d) && !(order && isPaused(order, d))) {
        if (!segStart) segStart = d;
        prev = d;
      } else if (segStart) {
        segments.push({ from: segStart, till: prev });
        segStart = null;
        prev = null;
      }
    }
    if (segStart) segments.push({ from: segStart, till: prev });
    return segments;
  }

  function orderWorkSegments(order, clipFrom, clipTo, today = dayStart(new Date())) {
    const span = orderDrawSpan(order, today);
    if (!span) return [];
    let from = span.from;
    let till = span.till;
    if (clipFrom && from < clipFrom) from = clipFrom;
    if (clipTo && till > clipTo) till = clipTo;
    if (from > till) return [];
    return splitWorkSegments(from, till, order);
  }

  function orderPauseSegments(order, clipFrom, clipTo, today = dayStart(new Date())) {
    const span = orderDrawSpan(order, today);
    if (!span) return [];
    return workPauses(order)
      .map((pause, index) => {
        let from = parseDay(pause.start);
        let till = parseDay(pauseEndKey(order, pause, today));
        if (!from || !till) return null;
        if (from < span.from) from = span.from;
        if (till > span.till) till = span.till;
        const unclippedFrom = from;
        const unclippedTill = till;
        if (clipFrom && from < clipFrom) from = clipFrom;
        if (clipTo && till > clipTo) till = clipTo;
        if (from > till) return null;
        return {
          from,
          till,
          index,
          showStart: from.getTime() === unclippedFrom.getTime(),
          showEnd: till.getTime() === unclippedTill.getTime(),
        };
      })
      .filter(Boolean);
  }

  function workDurationDays(order) {
    const span = orderDrawSpan(order);
    if (!span) return 0;
    let n = 0;
    for (let d = span.from; d <= span.till; d = addDays(d, 1)) {
      if (!isWeekend(d) && !isPaused(order, d)) n += 1;
    }
    return n;
  }

  function lineDateRange(order) {
    const keys = (order.lines || [])
      .filter((line) => !isFrozenLine(line) && !isExpenseLine(line))
      .map((line) => dateDay(line.order_date))
      .filter(Boolean)
      .sort();
    if (!keys.length) return null;
    return { start: keys[0], end: keys[keys.length - 1] };
  }

  function calendarState() {
    if (!state.calendar) {
      const saved = ensureUi().calendar || {};
      state.calendar = {
        mode: CALENDAR_MODES.includes(saved.mode) ? saved.mode : "timeline",
        filter: CALENDAR_FILTERS.some(([id]) => id === saved.filter) ? saved.filter : "all",
        selected: "",
        selectedLine: "",
        openLines: {},
        pick: "",
        anchor: dayStart(new Date()),
        viewFrom: null,
        viewDays: TL_DEFAULT_DAYS,
      };
    }
    if (!state.calendar.openLines || typeof state.calendar.openLines !== "object") state.calendar.openLines = {};
    if (typeof state.calendar.selectedLine !== "string") state.calendar.selectedLine = "";
    if (!(state.calendar.anchor instanceof Date) || Number.isNaN(state.calendar.anchor.getTime())) {
      state.calendar.anchor = dayStart(new Date());
    }
    return state.calendar;
  }

  function persistCalendar() {
    if (!state.doc) return;
    const cal = calendarState();
    const off = calendarOffSettings();
    const pruned = pruneOffLists(off.weekends, off.offDays, off.workDays);
    ensureUi().calendar = {
      mode: cal.mode,
      filter: cal.filter,
      weekends: off.weekends,
      off_days: pruned.offDays,
      work_days: pruned.workDays,
      day_notes: calendarDayNotes(),
    };
  }

  function orderDrawSpan(order, today = dayStart(new Date())) {
    const { start, end } = workSpan(order);
    if (!start && !end) return null;
    if (start && !end) {
      if (start > today) {
        const from = isWeekend(start) ? firstWorkOnOrAfter(start) : start;
        return from ? { from, till: from } : null;
      }
      return { from: start, till: today };
    }
    if (!start && end) return { from: end, till: end };
    return { from: start, till: end };
  }

  function timelineFullRange() {
    const today = dayStart(new Date());
    let from = today;
    let to = today;
    calendarOrders().forEach((order) => {
      const span = orderDrawSpan(order, today);
      if (!span) return;
      if (span.from < from) from = span.from;
      if (span.till > to) to = span.till;
    });
    const pad = 30;
    from = mondayOf(addDays(from, -pad));
    to = addDays(mondayOf(addDays(to, pad)), 6);
    const days = rangeDays(from, to);
    return { from, to, days, span: days.length, today };
  }

  function clampTimelineView() {
    const cal = calendarState();
    const full = timelineFullRange();
    if (!cal.viewDays) cal.viewDays = Math.min(TL_DEFAULT_DAYS, full.span);
    cal.viewDays = Math.max(TL_MIN_DAYS, Math.min(full.span, Math.round(cal.viewDays)));
    if (!(cal.viewFrom instanceof Date) || Number.isNaN(cal.viewFrom.getTime())) {
      const today = full.today < full.from ? full.from : dayStart(full.today);
      cal.viewFrom = addDays(today, -Math.floor((cal.viewDays - 1) / 2));
    } else {
      cal.viewFrom = dayStart(cal.viewFrom);
    }
    const last = addDays(full.to, 1 - cal.viewDays);
    if (cal.viewFrom < full.from) cal.viewFrom = full.from;
    if (last >= full.from && cal.viewFrom > last) cal.viewFrom = last;
    return full;
  }

  function goTimelineToday() {
    const cal = calendarState();
    const today = dayStart(new Date());
    cal.anchor = today;
    if (cal.mode === "timeline") {
      if (!cal.viewDays) cal.viewDays = TL_DEFAULT_DAYS;
      cal.viewFrom = addDays(today, -Math.floor((cal.viewDays - 1) / 2));
      clampTimelineView();
    }
  }

  function calendarWindow() {
    const cal = calendarState();
    const anchor = dayStart(cal.anchor || new Date());
    const today = dayStart(new Date());
    if (cal.mode === "classic") {
      const from = new Date(anchor.getFullYear(), anchor.getMonth(), 1);
      const to = new Date(anchor.getFullYear(), anchor.getMonth() + 1, 0);
      const gridFrom = mondayOf(from);
      let gridTo = addDays(gridFrom, 41);
      while (gridTo < to) gridTo = addDays(gridTo, 7);
      return {
        from,
        to,
        days: rangeDays(from, to),
        gridFrom,
        gridTo,
        today,
        title: `${RU_MONTHS_NOM[from.getMonth()]} ${from.getFullYear()}`,
      };
    }
    if (cal.mode === "extended") {
      const from = mondayOf(anchor);
      const to = addDays(from, 6);
      return { from, to, days: rangeDays(from, to), today, title: calFmtRange(from, to) };
    }
    const full = clampTimelineView();
    const from = calendarState().viewFrom;
    const days = rangeDays(from, addDays(from, calendarState().viewDays - 1));
    return { from, to: days[days.length - 1], days, today: full.today, full, title: calFmtRange(from, days[days.length - 1]) };
  }

  function calendarShift(dir, unit = "period") {
    const cal = calendarState();
    if (!(cal.anchor instanceof Date) || Number.isNaN(cal.anchor.getTime())) cal.anchor = dayStart(new Date());
    if (cal.mode === "classic") {
      if (unit === "year") cal.anchor = new Date(cal.anchor.getFullYear() + dir, cal.anchor.getMonth(), 1);
      else cal.anchor = new Date(cal.anchor.getFullYear(), cal.anchor.getMonth() + dir, 1);
    } else if (cal.mode === "timeline") {
      const step = Math.max(1, Math.floor((cal.viewDays || TL_DEFAULT_DAYS) / 2));
      cal.viewFrom = addDays(cal.viewFrom || dayStart(new Date()), dir * step);
      clampTimelineView();
      cal.anchor = cal.viewFrom;
    } else cal.anchor = addDays(mondayOf(cal.anchor), dir * 7);
    renderCalendar();
  }

  function calendarYearOptions(year) {
    const now = new Date().getFullYear();
    const from = Math.min(year, now) - 15;
    const to = Math.max(year, now) + 10;
    let html = "";
    for (let y = from; y <= to; y++) html += `<option value="${y}" ${y === year ? "selected" : ""}>${y}</option>`;
    return html;
  }

  function paintCalTitle(win) {
    const host = $("cal-title");
    if (!host) return;
    const cal = calendarState();
    if (cal.mode !== "classic") {
      host.textContent = win.title;
      return;
    }
    const year = win.from.getFullYear();
    const month = win.from.getMonth();
    host.innerHTML = `
      <select class="cal-pick" id="cal-month-pick" aria-label="Месяц">${RU_MONTHS_NOM.map((name, i) => `<option value="${i}" ${i === month ? "selected" : ""}>${esc(name)}</option>`).join("")}</select>
      <select class="cal-pick" id="cal-year-pick" aria-label="Год">${calendarYearOptions(year)}</select>`;
  }

  function calendarOrdersAll() {
    const q = state.search.trim().toLowerCase();
    return (state.doc.orders || []).filter((order) => {
      if (!q) return true;
      const hay = [order.number, order.customer, order.name, order.notes].join(" ").toLowerCase();
      return hay.includes(q);
    });
  }

  function calendarOrders(filter = calendarState().filter) {
    return calendarOrdersAll().filter((order) => filter === "all" || workStatus(order) === filter);
  }

  function calendarLoadMap(orders, days) {
    const map = {};
    let peak = 0;
    let peakKey = "";
    days.forEach((day) => {
      const key = dayKey(day);
      const n = orders.filter((order) => orderCoversDay(order, day) && workStatus(order) !== "cancelled").length;
      map[key] = n;
      if (n > peak) {
        peak = n;
        peakKey = key;
      }
    });
    return { map, peak, peakKey };
  }

  function calendarBarColor(order) {
    const tot = orderTotals(order);
    if (tot.unpaid > 0.005) return workStatus(order) === "done" ? CAL_BAR_DUE : CAL_BAR_DEBT;
    if (tot.after > 0.005) return CAL_BAR_PAID;
    const first = (order.lines || []).find((line) => !isFrozenLine(line) && !isExpenseLine(line));
    return statusColor(first?.status) || "#0f766e";
  }

  function calendarLineBarColor(order, line) {
    if (!line || isFrozenLine(line) || isExpenseLine(line)) return calendarBarColor(order);
    const t = lineTotals(line, order);
    if (t.unpaid > 0.005) return workStatus(order) === "done" ? CAL_BAR_DUE : CAL_BAR_DEBT;
    if (t.after > 0.005) return CAL_BAR_PAID;
    const paid = paidStatus();
    if (paid && line.status === paid.name) return CAL_BAR_PAID;
    return statusColor(line.status) || calendarBarColor(order);
  }

  function setWorkToday(order, which) {
    const today = dayKey(dayStart(new Date()));
    if (which === "start") {
      order.work_start = today;
      if (order.work_end && order.work_end < today) order.work_end = "";
    } else {
      if (!order.work_start) order.work_start = today;
      order.work_end = today;
    }
    normalizeWorkDates(order);
  }

  function shiftWorkDates(order, days) {
    const { start, end } = workSpan(order);
    if (start) order.work_start = dayKey(addDays(start, days));
    if (end) order.work_end = dayKey(addDays(end, days));
    if (!start && !end) {
      const today = dayStart(new Date());
      order.work_start = dayKey(addDays(today, days));
    }
    order.work_pauses = workPauses(order).map((pause) => ({
      start: pause.start ? dayKey(addDays(parseDay(pause.start), days)) : "",
      end: pauseIsOpen(order, pause) ? "" : pause.end ? dayKey(addDays(parseDay(pause.end), days)) : "",
      open: pauseIsOpen(order, pause),
    }));
    normalizeWorkDates(order);
  }

  function fillWorkFromLines(order) {
    const range = lineDateRange(order);
    if (!range) return false;
    if (!order.work_start) order.work_start = range.start;
    if (!order.work_end) order.work_end = range.end;
    normalizeWorkDates(order);
    return true;
  }

  function calendarRole(order, day) {
    if (isPaused(order, day)) return "На паузе";
    const key = dayKey(day);
    const start = dateDay(order.work_start);
    const end = dateDay(order.work_end);
    if (start === key && end === key) return "день";
    if (start === key) return "старт";
    if (end === key) return "финиш";
    return "в работе";
  }

  function orderNum(order) {
    return String(order?.number || "—").replace(/^№+\s*/, "") || "—";
  }

  function orderTitle(order) {
    return String(order?.name || "").trim() || "без названия";
  }

  function calChipHtml(order, day) {
    const meta = workStatusMeta(order, day);
    const role = day ? calendarRole(order, day) : meta.label;
    const due = orderDeadline(order);
    const dueText = due && meta.id !== "paused" ? `до ${calFmtDay(due)}` : "";
    return `<button type="button" class="cal-chip tone-${meta.tone} ${due ? "has-deadline" : ""}" data-cal-id="${esc(order.id)}" title="${esc(`${orderNum(order)} ${orderTitle(order)} · ${meta.label}${due ? ` · дедлайн ${calFmtDay(due, true)}` : ""}`)}" style="--bar:${esc(calendarBarColor(order))}">
      <b>${esc(orderNum(order))}</b>
      <span>${esc(orderTitle(order))}</span>
      <i>${esc(dueText || role)}</i>
    </button>`;
  }

  function renderCalendar() {
    if (!state.doc || !$("cal-board")) return;
    const cal = calendarState();
    const win = calendarWindow();
    const all = calendarOrdersAll();
    const list = calendarOrders();
    const weekFrom = mondayOf(win.today);
    const weekTo = addDays(weekFrom, 6);
    const nowCount = all.filter((order) => workStatus(order) === "now").length;
    const startWeek = all.filter((order) => {
      const key = dateDay(order.work_start);
      return key && key >= dayKey(weekFrom) && key <= dayKey(weekTo);
    }).length;
    const endWeek = all.filter((order) => {
      const key = dateDay(order.work_end);
      return key && key >= dayKey(weekFrom) && key <= dayKey(weekTo);
    }).length;
    const nodate = all.filter((order) => workStatus(order) === "nodate").length;
    const load = calendarLoadMap(all.filter((order) => workStatus(order) !== "cancelled"), win.days);
    const peakLabel = load.peakKey ? calFmtDay(parseDay(load.peakKey)) : "—";

    paintCalTitle(win);
    document.querySelectorAll("[data-cal-mode]").forEach((btn) => {
      btn.classList.toggle("active", btn.dataset.calMode === cal.mode);
    });
    const filterMeta = CALENDAR_FILTERS.find(([id]) => id === cal.filter) || CALENDAR_FILTERS[0];
    const filterBtn = $("btn-cal-filter");
    const filterMenu = $("cal-filter-menu");
    const filterLabel = $("cal-filter-label");
    if (filterLabel) filterLabel.textContent = `${filterMeta[1]} · ${calendarOrders(cal.filter).length}`;
    filterBtn?.classList.toggle("active", cal.filter !== "all");
    filterBtn?.setAttribute("aria-expanded", "false");
    if (filterMenu) {
      filterMenu.hidden = true;
      filterMenu.innerHTML = CALENDAR_FILTERS.map(([id, label]) => {
        const n = calendarOrders(id).length;
        return `<button type="button" class="btn ${cal.filter === id ? "active" : ""}" data-cal-filter="${id}" role="menuitem">${esc(label)}<span class="chip-count">${n}</span></button>`;
      }).join("");
    }
    const off = calendarOffSettings();
    const weekendBtn = $("btn-cal-weekends");
    const weekendMenu = $("cal-weekend-menu");
    const weekendOpen = weekendMenu && !weekendMenu.hidden;
    const customOff =
      off.weekends.join() !== DEFAULT_WEEKENDS.join() || off.offDays.length > 0 || off.workDays.length > 0;
    weekendBtn?.classList.toggle("active", customOff);
    weekendBtn?.setAttribute("aria-expanded", String(!!weekendOpen));
    if (weekendMenu) {
      weekendMenu.innerHTML = weekendMenuHtml();
      weekendMenu.hidden = !weekendOpen;
    }
    const stats = $("cal-stats-pop");
    if (stats) {
      stats.innerHTML = `<div class="cal-stats-list">
        <div class="cal-stat ${nowCount ? "ok" : ""}"><span>Идёт сейчас</span><b>${nowCount}</b><small>в работе, в том числе без дедлайна</small></div>
        <div class="cal-stat"><span>Старт на неделе</span><b>${startWeek}</b><small>с ${calFmtDay(weekFrom)}</small></div>
        <div class="cal-stat"><span>Финиш на неделе</span><b>${endWeek}</b><small>до ${calFmtDay(weekTo)}</small></div>
        <div class="cal-stat"><span>Без дат</span><b>${nodate}</b><small>ещё не отмечены на календаре</small></div>
        <div class="cal-stat ${load.peak >= CAL_HOT_LOAD ? "warn" : ""}"><span>Пик загрузки</span><b>${load.peak}</b><small>${load.peak ? `${peakLabel} · одновременно` : "нет пересечений"}</small></div>
      </div>`;
    }

    const board = $("cal-board");
    const keepY = board.scrollTop;
    const keepGanttY = document.querySelector("#gantt-scroll .gantt")?.scrollTop || 0;
    if (cal.mode === "classic") board.innerHTML = renderClassicCalendar(win, list, load);
    else if (cal.mode === "extended") board.innerHTML = renderExtendedCalendar(win, list, load);
    else board.innerHTML = renderTimelineCalendar(win, list, load);
    board.scrollTop = keepY;
    const ganttEl = document.querySelector("#gantt-scroll .gantt");
    if (ganttEl) ganttEl.scrollTop = keepGanttY;
    $("cal-side").innerHTML = renderCalendarSide(win, all, list);
    const reveal = cal.revealDay ? parseDay(cal.revealDay) : null;
    cal.revealDay = "";
    requestAnimationFrame(() => {
      if (reveal && cal.mode !== "timeline") {
        const cell = document.querySelector(`[data-cal-day="${cssEscape(dayKey(reveal))}"]`);
        cell?.scrollIntoView({ block: "nearest", inline: "nearest" });
      }
    });
  }

  function timelineDayFromX(track, clientX, full) {
    const rect = track.getBoundingClientRect();
    if (!rect.width || !full.days.length) return full.from;
    const t = Math.max(0, Math.min(0.999, (clientX - rect.left) / rect.width));
    return full.days[Math.floor(t * full.days.length)];
  }

  function timelineViewBox(full, viewFrom, viewDays) {
    if (!full.span) return { left: 0, width: 100 };
    const left = (dayDiff(full.from, viewFrom) / full.span) * 100;
    const width = (viewDays / full.span) * 100;
    return { left, width };
  }

  function paintNavView() {
    const full = clampTimelineView();
    const cal = calendarState();
    const box = timelineViewBox(full, cal.viewFrom, cal.viewDays);
    const view = $("tl-nav-view");
    const sl = $("tl-nav-shade-l");
    const sr = $("tl-nav-shade-r");
    if (view) {
      view.style.left = `${box.left}%`;
      view.style.width = `${box.width}%`;
    }
    if (sl) sl.style.width = `${box.left}%`;
    if (sr) {
      sr.style.left = `${box.left + box.width}%`;
      sr.style.width = `${Math.max(0, 100 - box.left - box.width)}%`;
    }
    const meta = $("tl-nav-meta-view");
    if (meta) meta.textContent = `видно ${cal.viewDays} дн. · ${calFmtRange(cal.viewFrom, addDays(cal.viewFrom, cal.viewDays - 1))}`;
    const title = $("cal-title");
    if (title && calendarState().mode === "timeline") title.textContent = calFmtRange(cal.viewFrom, addDays(cal.viewFrom, cal.viewDays - 1));
    refreshTimelineGantt();
  }

  function refreshTimelineGantt() {
    const host = $("gantt-scroll");
    if (!host) return;
    const keepY = host.querySelector(".gantt")?.scrollTop || 0;
    const win = calendarWindow();
    const list = calendarOrders();
    const load = calendarLoadMap(
      calendarOrdersAll().filter((order) => workStatus(order) !== "cancelled"),
      win.days
    );
    const tmp = document.createElement("div");
    tmp.innerHTML = renderTimelineCalendar(win, list, load);
    const next = tmp.querySelector("#gantt-scroll");
    if (next) host.replaceWith(next);
    const gantt = $("gantt-scroll")?.querySelector(".gantt");
    if (gantt) gantt.scrollTop = keepY;
  }

  function timelineZoomAt(ratio, factor) {
    const full = clampTimelineView();
    const cal = calendarState();
    const focus = full.days[Math.min(full.span - 1, Math.max(0, Math.floor(ratio * full.span)))];
    const oldFrom = cal.viewFrom;
    const oldDays = cal.viewDays;
    let next = Math.round(oldDays * factor);
    if (factor < 1 && next >= oldDays) next = oldDays - 1;
    if (factor > 1 && next <= oldDays) next = oldDays + 1;
    const oldStart = dayDiff(full.from, oldFrom);
    const focusIdx = dayDiff(full.from, focus);
    let local = 0.5;
    if (oldDays > 1 && focusIdx >= oldStart && focusIdx < oldStart + oldDays) {
      local = (focusIdx - oldStart) / (oldDays - 1);
    }
    cal.viewDays = next;
    clampTimelineView();
    cal.viewFrom = addDays(focus, -Math.round(local * (cal.viewDays - 1)));
    clampTimelineView();
  }

  function timelineLaneItems(today) {
    const blocks = calendarOrders()
      .map((order) => {
        const span = orderDrawSpan(order, today);
        if (!span) return null;
        const segs = splitWorkSegments(span.from, span.till, order);
        const pauses = orderPauseSegments(order, span.from, span.till, today);
        return segs.length || pauses.length ? { order, span, segs, pauses, kind: "order" } : null;
      })
      .filter(Boolean)
      .sort((a, b) => compareTimelineOrders(a.order, b.order, today) || a.span.from - b.span.from || a.span.till - b.span.till);
    const items = [];
    blocks.forEach((block) => {
      items.push(block);
      if (!calendarLinesOpen(block.order.id)) return;
      calendarWorkLines(block.order).forEach((line) => {
        const proxy = lineWorkProxy(block.order, line);
        const span = orderDrawSpan(proxy, today);
        if (!span) return;
        const segs = splitWorkSegments(span.from, span.till, proxy);
        const pauses = orderPauseSegments(proxy, span.from, span.till, today);
        if (!segs.length && !pauses.length) return;
        items.push({
          order: block.order,
          line,
          span,
          segs,
          pauses,
          kind: "line",
          color: calendarLineBarColor(block.order, line),
        });
      });
    });
    const byStart = items.slice().sort((a, b) => {
      const from = a.span.from - b.span.from;
      if (from) return from;
      const dur = (b.span.till - b.span.from) - (a.span.till - a.span.from);
      if (dur) return dur;
      return String(a.order.number || "").localeCompare(String(b.order.number || ""), "ru", { numeric: true });
    });
    const ends = [];
    const laneOf = new Map();
    byStart.forEach((item) => {
      let lane = ends.findIndex((till) => item.span.from > till);
      if (lane < 0) {
        lane = ends.length;
        ends.push(item.span.till);
      } else ends[lane] = item.span.till;
      laneOf.set(item, lane);
    });
    const lanes = Math.max(1, ends.length);
    return items.map((item) => ({ ...item, lane: laneOf.get(item) || 0, lanes }));
  }

  function ganttBarsHtml(target, win, { order, lineId = "", label = "", color = "", meta } = {}) {
    const status = meta || workStatusMeta(target);
    const segs = orderWorkSegments(target, win.from, win.to, win.today);
    const pauses = orderPauseSegments(target, win.from, win.to, win.today);
    if (!segs.length && !pauses.length) return "";
    const due = orderDeadline(target, win.today);
    const tip = due ? `${label} · дедлайн ${calFmtDay(due, true)}` : label;
    const lineAttr = lineId ? ` data-cal-line="${esc(lineId)}"` : "";
    const id = esc(order.id);
    return segs
      .map((seg, i) => {
        const left = dayDiff(win.from, seg.from);
        const span = dayDiff(seg.from, seg.till) + 1;
        const first = i === 0;
        const last = i === segs.length - 1;
        const cut = `${first ? "" : " is-cut-start"}${last ? "" : " is-cut-end"}`;
        return `<div class="gantt-bar tone-${status.tone} ${status.id === "now" ? "is-live" : ""} ${due && last ? "has-deadline" : ""}${cut}" data-cal-id="${id}"${lineAttr} data-cal-drag="move" style="--from:${left};--span:${span};--bar:${esc(color)}" title="${esc(tip)}">
          ${first ? `<i class="gantt-h start" data-cal-drag="start"></i>` : ""}
          ${last ? `<i class="gantt-h end" data-cal-drag="end"></i>` : ""}
        </div>`;
      })
      .concat(
        pauses.map((seg) => {
          const left = dayDiff(win.from, seg.from);
          const span = dayDiff(seg.from, seg.till) + 1;
          const pauseTip = pauseIsOpen(target, workPauses(target)[seg.index])
            ? `${label} · пауза с ${calFmtDay(seg.from)} · идёт, пока не снимете`
            : `${label} · пауза ${calFmtDay(seg.from)}${span > 1 ? ` — ${calFmtDay(seg.till)}` : ""}`;
          return `<div class="gantt-bar is-pause" data-cal-id="${id}"${lineAttr} data-pause-i="${seg.index}" data-cal-drag="pause-move" style="--from:${left};--span:${span};--bar:${esc(color)}" title="${esc(pauseTip)}">
            ${seg.showStart ? `<i class="gantt-h start" data-cal-drag="pause-start"></i>` : "<i></i>"}
            ${seg.showEnd ? `<i class="gantt-h end" data-cal-drag="pause-end"></i>` : "<i></i>"}
          </div>`;
        })
      )
      .join("");
  }

  function ganttExpandIcon() {
    return `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 6l6 6-6 6" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
  }

  function renderTimelineCalendar(win, list, load) {
    const full = win.full || clampTimelineView();
    const n = win.days.length;
    const dated = list.filter((order) => workStatus(order) !== "nodate");
    const visible = dated.filter((order) => {
      const span = orderDrawSpan(order, win.today);
      return span && span.from <= win.to && span.till >= win.from;
    });
    const box = timelineViewBox(full, win.from, n);
    const ticks = full.days
      .filter((day) => day.getDate() === 1)
      .map((day) => {
        const left = (dayDiff(full.from, day) / full.span) * 100;
        const label = day.getMonth() === 0 ? `${RU_MONTHS_NOM[day.getMonth()].slice(0, 3)} ${day.getFullYear()}` : RU_MONTHS_NOM[day.getMonth()].slice(0, 3);
        return `<div class="tl-nav-tick" style="left:${left}%" title="${esc(calFmtDay(day, true))}">${esc(label)}</div>`;
      })
      .join("");
    const laneItems = timelineLaneItems(win.today);
    const laneCount = Math.max(1, ...laneItems.map((item) => item.lanes), 1);
    const navBars = laneItems
      .flatMap((item) => {
        const title = item.line
          ? `${orderNum(item.order)} ${lineWorkName(item.line)}`.trim()
          : `${orderNum(item.order)} ${orderTitle(item.order)}`.trim();
        const due = orderDeadline(item.line ? lineWorkProxy(item.order, item.line) : item.order, win.today);
        const color = item.color || calendarBarColor(item.order);
        const lineAttr = item.line ? ` data-cal-line="${esc(item.line.id)}"` : "";
        const lineClass = item.kind === "line" ? " is-line" : "";
        return item.segs.map((seg, i) => {
          const from = Math.max(0, dayDiff(full.from, seg.from));
          const till = Math.min(full.span - 1, dayDiff(full.from, seg.till));
          if (till < from) return "";
          const len = till - from + 1;
          const cut = `${i ? " is-cut-start" : ""}${i < item.segs.length - 1 ? " is-cut-end" : ""}`;
          return `<div class="tl-nav-bar ${due ? "has-deadline" : ""}${lineClass}${cut}" data-cal-id="${esc(item.order.id)}"${lineAttr} style="--lane:${item.lane};--from:${from};--len:${len};--span:${full.span};--bar:${esc(color)}" title="${esc(title)}${due ? ` · до ${calFmtDay(due, true)}` : ""}"></div>`;
        }).concat(
          (item.pauses || []).map((seg) => {
            const from = Math.max(0, dayDiff(full.from, seg.from));
            const till = Math.min(full.span - 1, dayDiff(full.from, seg.till));
            if (till < from) return "";
            const len = till - from + 1;
            return `<div class="tl-nav-bar is-pause${lineClass}" data-cal-id="${esc(item.order.id)}"${lineAttr} style="--lane:${item.lane};--from:${from};--len:${len};--span:${full.span};--bar:${esc(color)}" title="${esc(title)} · пауза"></div>`;
          })
        );
      })
      .join("");
    const todayInFull = win.today >= full.from && win.today <= full.to;
    const todayNav = todayInFull ? `<div class="tl-nav-today" style="left:${((dayDiff(full.from, win.today) + 0.5) / full.span) * 100}%"></div>` : "";
    const dense = n > 45;
    const head = win.days
      .map((day) => {
        const key = dayKey(day);
        const hot = (load.map[key] || 0) >= CAL_HOT_LOAD;
        const monday = (day.getDay() + 6) % 7 === 0;
        const first = day.getDate() === 1;
        const showNum = !dense || monday || first;
        const label = first ? RU_MONTHS_NOM[day.getMonth()].slice(0, 3) : RU_WEEKDAYS[(day.getDay() + 6) % 7];
        const note = dayNote(key);
        return `<div class="gantt-day ${dayToneClass(day)} ${note ? "has-note" : ""} ${dayKey(day) === dayKey(win.today) ? "is-today" : ""} ${calendarState().pick === key ? "is-pick" : ""} ${hot ? "is-hot" : ""} ${showNum ? "" : "is-slim"}" data-cal-day="${key}" title="${esc(note)}">
          <span>${showNum ? day.getDate() : ""}</span><small>${showNum ? esc(label) : ""}</small>
        </div>`;
      })
      .join("");
    const todayInView = win.today >= win.from && win.today <= win.to;
    const todayLine = todayInView ? `<div class="gantt-today" style="left:calc((${dayDiff(win.from, win.today)} + 0.5) / ${n} * 100%)"></div>` : "";
    const gridCols = win.days
      .map((day) => {
        const key = dayKey(day);
        const hot = (load.map[key] || 0) >= CAL_HOT_LOAD;
        return `<div class="gantt-grid-col ${dayToneClass(day)} ${key === dayKey(win.today) ? "is-today" : ""} ${calendarState().pick === key ? "is-pick" : ""} ${hot ? "is-hot" : ""}"></div>`;
      })
      .join("");
    const rows = visible
      .slice()
      .sort((a, b) => compareTimelineOrders(a, b, win.today))
      .map((order) => {
        const meta = workStatusMeta(order);
        const pausedNow = orderIsPausedNow(order, win.today);
        const due = orderDeadline(order, win.today);
        const label = `${orderNum(order)} ${orderTitle(order)}`.trim();
        const color = calendarBarColor(order);
        const bars = ganttBarsHtml(order, win, { order, label, color });
        if (!bars) return "";
        const workLines = calendarWorkLines(order);
        const open = calendarLinesOpen(order.id);
        const expand = workLines.length
          ? `<button type="button" class="gantt-expand ${open ? "is-open" : ""}" data-cal-expand="${esc(order.id)}" title="${open ? "Скрыть позиции" : "Показать позиции"}" aria-label="${open ? "Скрыть позиции" : "Показать позиции"}" aria-expanded="${open}">${ganttExpandIcon()}</button>`
          : `<span class="gantt-expand is-empty" aria-hidden="true"></span>`;
        const lineRows = open
          ? workLines
              .map((line, index) => {
                const proxy = lineWorkProxy(order, line);
                const lineMeta = lineWorkMeta(order, line);
                const linePaused = orderIsPausedNow(proxy, win.today);
                const lineLabel = lineWorkName(line, index);
                const lineBars = ganttBarsHtml(proxy, win, {
                  order,
                  lineId: line.id,
                  label: `${label} · ${lineLabel}`,
                  color: calendarLineBarColor(order, line),
                  meta: lineMeta,
                });
                const days = workDurationDays(proxy);
                return `<div class="gantt-row is-line ${calSelectedClass(order.id, line.id)} ${linePaused ? "is-paused" : ""}" data-cal-id="${esc(order.id)}" data-cal-line="${esc(line.id)}">
          <div class="gantt-head">
            <button type="button" class="gantt-label" data-cal-id="${esc(order.id)}" data-cal-line="${esc(line.id)}">
              <b>${esc(lineLabel)}</b>
              <small>${esc(lineMeta.label)}${days ? ` · ${days} дн.` : ""}</small>
            </button>
          </div>
          <div class="gantt-track" data-cal-track="${esc(order.id)}" data-cal-line="${esc(line.id)}">${lineBars}</div>
        </div>`;
              })
              .join("")
          : "";
        return `<div class="gantt-row ${calSelectedClass(order.id)} ${due ? "has-deadline" : ""} ${pausedNow ? "is-paused" : ""} ${open ? "is-open" : ""}" data-cal-id="${esc(order.id)}">
          <div class="gantt-head">
            ${expand}
            <button type="button" class="gantt-label" data-cal-id="${esc(order.id)}">
              <b>${esc(orderNum(order))} ${esc(orderTitle(order))}</b>
              <small>${esc(order.customer || "без заказчика")} · ${esc(meta.label)}${workDurationDays(order) ? ` · ${workDurationDays(order)} дн.` : ""}${due ? ` · до ${calFmtDay(due)}` : ""}${workLines.length ? ` · ${workLines.length} поз.` : ""}</small>
            </button>
          </div>
          <div class="gantt-track" data-cal-track="${esc(order.id)}">${bars}</div>
        </div>${lineRows}`;
      })
      .join("");
    const empty = visible.length
      ? ""
      : `<div class="cal-empty">${dated.length ? "В видимой области нет заказов — сдвиньте рамку сверху или прокрутите линейку дней колесом." : list.length ? "Нет отмеченных заказов по фильтру." : "Нет заказов по фильтру. Отметьте начало работ в карточке или справа."}</div>`;
    return `<div class="tl-nav" id="tl-nav">
      <div class="tl-nav-meta">
        <span>весь период · ${esc(calFmtRange(full.from, full.to))} · ${full.span} дн.</span>
        <span id="tl-nav-meta-view">видно ${n} дн. · ${esc(calFmtRange(win.from, win.to))}</span>
      </div>
      <div class="tl-nav-track" id="tl-nav-track" data-tl-nav="track" style="--lanes:${laneCount}">
        ${ticks}
        <div class="tl-nav-bars">${navBars}</div>
        ${todayNav}
        <div class="tl-nav-shade left" id="tl-nav-shade-l" style="width:${box.left}%"></div>
        <div class="tl-nav-shade right" id="tl-nav-shade-r" style="left:${box.left + box.width}%;width:${Math.max(0, 100 - box.left - box.width)}%"></div>
        <div class="tl-nav-view" id="tl-nav-view" data-tl-nav="view" style="left:${box.left}%;width:${box.width}%">
          <i class="tl-nav-h start" data-tl-nav="start"></i>
          <i class="tl-nav-h end" data-tl-nav="end"></i>
        </div>
      </div>
    </div>
    <div class="gantt-scroll" id="gantt-scroll" style="--days:${n}">
      <div class="gantt-days">${head}<div class="gantt-day-tip" id="gantt-day-tip" hidden></div></div>
      <div class="gantt">
        <div class="gantt-day-col" id="gantt-day-col" hidden></div>
        ${todayLine}
        <div class="gantt-body">
          <div class="gantt-grid" aria-hidden="true">${gridCols}</div>
          ${rows || empty}
        </div>
      </div>
    </div>
    <div class="cal-hint hint-i">
      <button type="button" class="info-btn" title="Подсказка по таймлайну" aria-label="Подсказка по таймлайну">i</button>
      <div class="hint-i-pop" role="tooltip">
        Колесо на навигаторе — масштаб, на датах — период. Полосу двигают, края меняют даты. Стрелка — позиции. Shift+клик — пауза, Shift+двойной клик снимает.
      </div>
    </div>`;
  }

  function renderClassicCalendar(win, list, load) {
    const cells = [];
    for (let d = win.gridFrom; d <= win.gridTo; d = addDays(d, 1)) {
      const key = dayKey(d);
      const inMonth = d.getMonth() === win.from.getMonth();
      const items = list.filter((order) => orderMarksDay(order, d));
      const shown = items.slice(0, 3);
      const more = items.length - shown.length;
      const hot = (load.map[key] || 0) >= CAL_HOT_LOAD;
      const note = dayNote(key);
      cells.push(`<div class="cal-cell ${inMonth ? "" : "is-out"} ${dayToneClass(d)} ${note ? "has-note" : ""} ${key === dayKey(win.today) ? "is-today" : ""} ${calendarState().pick === key ? "is-pick" : ""} ${hot ? "is-hot" : ""}" data-cal-day="${key}">
        <div class="cal-cell-n">${d.getDate()}${items.length ? `<b>${items.length}</b>` : ""}</div>
        ${note ? `<div class="cal-day-memo">${esc(note)}</div>` : ""}
        ${shown.map((order) => calChipHtml(order, d)).join("")}
        ${more > 0 ? `<div class="cal-more">ещё ${more}</div>` : ""}
      </div>`);
    }
    return `<div class="cal-weekdays">${RU_WEEKDAYS.map((w, i) => `<div class="${calendarOffSettings().weekends.includes(i) ? "is-weekend" : ""}">${w}</div>`).join("")}</div>
      <div class="cal-month">${cells.join("")}</div>`;
  }

  function renderExtendedCalendar(win, list, load) {
    const cols = win.days
      .map((day) => {
        const key = dayKey(day);
        const items = list.filter((order) => orderMarksDay(order, day));
        const starts = items.filter((order) => dateDay(order.work_start) === key && !isPaused(order, day));
        const ends = items.filter((order) => dateDay(order.work_end) === key && !isPaused(order, day));
        const paused = items.filter((order) => isPaused(order, day));
        const running = items.filter((order) => !isPaused(order, day) && dateDay(order.work_start) !== key && dateDay(order.work_end) !== key);
        const n = load.map[key] || 0;
        const pct = Math.min(100, (n / Math.max(CAL_HOT_LOAD, load.peak || 1)) * 100);
        const note = dayNote(key);
        return `<div class="cal-col ${dayToneClass(day)} ${note ? "has-note" : ""} ${key === dayKey(win.today) ? "is-today" : ""} ${calendarState().pick === key ? "is-pick" : ""} ${n >= CAL_HOT_LOAD ? "is-hot" : ""}" data-cal-day="${key}">
          <div class="cal-col-head">
            <strong>${RU_WEEKDAYS[(day.getDay() + 6) % 7]}</strong>
            <span>${calFmtDay(day)}</span>
            <em>${n} зак.</em>
          </div>
          <div class="cal-load"><i style="width:${pct}%"></i></div>
          ${note ? `<div class="cal-day-memo">${esc(note)}</div>` : ""}
          ${starts.length ? `<div class="cal-col-sec">Старт</div>${starts.map((order) => calChipHtml(order, day)).join("")}` : ""}
          ${running.length ? `<div class="cal-col-sec">В работе</div>${running.map((order) => calChipHtml(order, day)).join("")}` : ""}
          ${paused.length ? `<div class="cal-col-sec">На паузе</div>${paused.map((order) => calChipHtml(order, day)).join("")}` : ""}
          ${ends.length ? `<div class="cal-col-sec">Финиш</div>${ends.map((order) => calChipHtml(order, day)).join("")}` : ""}
          ${items.length ? "" : `<div class="cal-col-empty">пусто</div>`}
        </div>`;
      })
      .join("");
    return `<div class="cal-week">${cols}</div>`;
  }

  function calSelectedClass(id, lineId = "") {
    const cal = calendarState();
    if (lineId) return cal.selected === id && cal.selectedLine === lineId ? "is-selected" : "";
    return cal.selected === id && !cal.selectedLine ? "is-selected" : "";
  }

  function renderCalendarSide(win, all, list) {
    const cal = calendarState();
    const selected = findOrder(cal.selected);
    const today = win.today;
    const pausedNow = all.filter((order) => orderIsPausedNow(order, today));
    const now = all.filter((order) => workStatus(order) === "now" && !orderIsPausedNow(order, today));
    const nodate = all.filter((order) => workStatus(order) === "nodate");
    const pick = cal.pick ? parseDay(cal.pick) : null;
    const pickItems = pick ? all.filter((order) => orderMarksDay(order, pick)) : [];
    const selectedLine = selected && cal.selectedLine ? findCalendarLine(selected, cal.selectedLine) : null;
    const workTarget = selectedLine ? lineWorkProxy(selected, selectedLine) : selected;
    const due = workTarget ? orderDeadline(workTarget, today) : null;
    const pauses = workTarget ? workPauses(workTarget) : [];
    const inheritLine = !!(selectedLine && !dateDay(selectedLine.work_start) && !dateDay(selectedLine.work_end));
    const pauseList = pauses.length
      ? `<div class="cal-pauses">${pauses
          .map((pause, i) => {
            const from = parseDay(pause.start);
            const open = pauseIsOpen(workTarget, pause);
            const till = parseDay(pauseEndKey(workTarget, pause, today));
            const label = !from
              ? ""
              : open
                ? `${calFmtDay(from)} — идёт`
                : till && pause.start !== pauseEndKey(workTarget, pause, today)
                  ? `${calFmtDay(from)} — ${calFmtDay(till)}`
                  : calFmtDay(from);
            return `<div class="cal-pause-row">
              <span>Пауза ${esc(label)}</span>
              <button type="button" class="btn small" data-cal-act="remove-pause" data-pause-i="${i}">Снять</button>
            </div>`;
          })
          .join("")}</div>`
      : "";
    const lineIdx = selectedLine ? calendarWorkLines(selected).findIndex((line) => line.id === selectedLine.id) : -1;
    const sel = selected
      ? `<div class="cal-sel">
          <div class="cal-sel-head">
            <b>${esc(orderNum(selected))} ${esc(orderTitle(selected))}</b>
            <span class="work-pill work-pill-${esc(workStatusMeta(workTarget).id)}">${esc(workStatusMeta(workTarget).label)}</span>
          </div>
          <div class="cal-sel-sub">${
            selectedLine
              ? `позиция · ${esc(lineWorkName(selectedLine, Math.max(0, lineIdx)))}${inheritLine ? " · как у заказа" : ""}`
              : `${esc(selected.customer || "без заказчика")}${workDurationDays(selected) ? ` · ${workDurationDays(selected)} дн.` : ""}`
          }</div>
          ${due ? `<div class="cal-due-line">Дедлайн ${esc(calFmtDay(due, true))}</div>` : ""}
          <div class="cal-dates">
            <div class="field"><label>Начало</label><input type="date" data-cal-field="work_start" value="${esc(dateDay(workTarget.work_start))}" /></div>
            <div class="field"><label>Конец</label><input type="date" data-cal-field="work_end" value="${esc(dateDay(workTarget.work_end))}" /></div>
          </div>
          ${pauseList}
          <div class="cal-actions">
            <button type="button" class="btn small primary" data-cal-act="start-today">Начать сегодня</button>
            <button type="button" class="btn small" data-cal-act="end-today">Закончить сегодня</button>
            <button type="button" class="btn small" data-cal-act="shift-left" title="Сдвинуть на день назад">−1 день</button>
            <button type="button" class="btn small" data-cal-act="shift-right" title="Сдвинуть на день вперёд">+1 день</button>
            ${
              selectedLine
                ? `<button type="button" class="btn small" data-cal-act="reset-line" title="Вернуть срок позиции к сроку заказа">Как у заказа</button>`
                : `<button type="button" class="btn small" data-cal-act="fill-lines" title="Взять крайние даты позиций">С дат позиций</button>`
            }
            <button type="button" class="btn small" data-cal-act="clear">${selectedLine ? "Сбросить позицию" : "Снять даты"}</button>
            <button type="button" class="btn small" data-cal-act="open">Открыть заказ</button>
          </div>
        </div>`
      : `<div class="cal-sel idle">Выберите заказ на доске — здесь можно поставить старт и финиш, паузы внутри срока, сдвинуть или открыть карточку. Стрелка на таймлайне раскрывает позиции.</div>`;
    const pickOff = pick ? isWeekend(pick) : false;
    const pickKey = pick ? dayKey(pick) : "";
    const offSets = calendarOffSettings();
    const pickMark = !pick
      ? ""
      : offSets.offDays.includes(pickKey)
        ? " · выходной точечно"
        : offSets.workDays.includes(pickKey)
          ? " · рабочий точечно"
          : pickOff
            ? " · выходной"
            : "";
    const pickPaused = workTarget && pick && isPaused(workTarget, pick);
    const pickCanPause = workTarget && pick && pauseInEnvelope(workTarget, pick);
    const pickBlock = pick
      ? `<div class="cal-block">
          <h3>${esc(calFmtDay(pick, true))}${pickMark}${pickItems.length >= CAL_HOT_LOAD ? " · перегруз" : ""}</h3>
          <div class="cal-actions">
            <button type="button" class="btn small" data-cal-act="toggle-off">${pickOff ? "Сделать рабочим" : "Сделать выходным"}</button>
            <button type="button" class="btn small" data-cal-act="pick-start" ${selected ? "" : "disabled"}>Старт выбранного</button>
            <button type="button" class="btn small" data-cal-act="pick-end" ${selected ? "" : "disabled"}>Финиш выбранного</button>
            <button type="button" class="btn small" data-cal-act="${pickPaused ? "remove-pause-day" : "add-pause"}" ${pickCanPause ? "" : "disabled"}>${pickPaused ? "Убрать паузу" : "Пауза в этот день"}</button>
          </div>
          <div class="field cal-day-note"><label>Заметка</label><textarea rows="3" data-cal-note="${esc(pickKey)}" placeholder="Что в этот день">${esc(dayNote(pickKey))}</textarea></div>
          ${pickPaused ? `<div class="cal-pause-note">Выбранный заказ на паузе</div>` : ""}
          ${pickItems.length ? pickItems.map((order) => calChipHtml(order, pick)).join("") : pickPaused ? "" : `<div class="cal-col-empty">в этот день никто не отмечен</div>`}
        </div>`
      : "";
    const listBlock = (title, items, empty) =>
      `<div class="cal-block"><h3>${title} <span>${items.length}</span></h3>${
        items.length ? items.map((order) => calChipHtml(order)).join("") : `<div class="cal-col-empty">${empty}</div>`
      }</div>`;
    const fillAll = nodate.some((order) => lineDateRange(order))
      ? `<button type="button" class="btn small" data-cal-act="fill-all">Подставить даты с позиций всем без дат</button>`
      : "";
    return `${sel}${pickBlock}
      ${listBlock("На паузе", pausedNow, "Нет заказов на паузе.")}
      ${listBlock("В работе", now, "Нет заказов в работе — поставьте дату начала.")}
      <div class="cal-block"><h3>Без дат <span>${nodate.length}</span></h3>${fillAll}${
        nodate.length ? nodate.map((order) => calChipHtml(order)).join("") : `<div class="cal-col-empty">Все заказы размечены.</div>`
      }</div>`;
  }

  function weekendMenuHtml() {
    const off = calendarOffSettings();
    const days = RU_WEEKDAYS.map(
      (name, i) =>
        `<button type="button" class="btn ${off.weekends.includes(i) ? "active" : ""}" data-cal-weekend="${i}" role="menuitemcheckbox" aria-checked="${off.weekends.includes(i)}">${esc(name)}</button>`
    ).join("");
    return `<div class="cal-weekend-label">Дни недели</div>
      <div class="cal-weekend-days">${days}</div>
      <div class="cal-weekend-hint">Отдельный день — клик по дате справа: «Сделать выходным» или «Сделать рабочим».</div>`;
  }

  function commitCalendarOff(patch, toastText) {
    historyCommit();
    writeCalendarOff(patch);
    persistCalendar();
    historyCommit();
    markDirty();
    renderCalendar();
    if (toastText) toast(toastText);
  }

  function toggleWeekdayWeekend(wd) {
    if (!Number.isInteger(wd) || wd < 0 || wd > 6) return;
    const off = calendarOffSettings();
    const weekends = off.weekends.includes(wd) ? off.weekends.filter((x) => x !== wd) : off.weekends.concat(wd).sort((a, b) => a - b);
    commitCalendarOff({ weekends }, weekends.includes(wd) ? `${RU_WEEKDAYS[wd]} — выходной` : `${RU_WEEKDAYS[wd]} — рабочий`);
  }

  function setPointDay(key, kind) {
    const d = parseDay(key);
    if (!d) {
      toast("Выберите дату");
      return;
    }
    const iso = dayKey(d);
    const off = calendarOffSettings();
    const offDays = new Set(off.offDays);
    const workDays = new Set(off.workDays);
    const recurring = off.weekends.includes(weekdayIndex(d));
    if (kind === "off") {
      workDays.delete(iso);
      if (recurring) commitCalendarOff({ offDays: [...offDays], workDays: [...workDays] }, "Выходной");
      else {
        offDays.add(iso);
        commitCalendarOff({ offDays: [...offDays].sort(), workDays: [...workDays].sort() }, "Выходной на дату");
      }
    } else {
      offDays.delete(iso);
      if (!recurring) commitCalendarOff({ offDays: [...offDays], workDays: [...workDays] }, "Рабочий день");
      else {
        workDays.add(iso);
        commitCalendarOff({ offDays: [...offDays].sort(), workDays: [...workDays].sort() }, "Рабочий на дату");
      }
    }
  }

  function togglePickedOffDay(key) {
    const d = parseDay(key);
    if (!d) return;
    setPointDay(dayKey(d), isWeekend(d) ? "work" : "off");
  }

  function calendarPlanText() {
    const win = calendarWindow();
    const all = calendarOrdersAll();
    const now = all.filter((order) => workStatus(order) === "now");
    const lines = [`План работ ${win.title}`, ""];
    lines.push(`Сейчас в работе (${now.length}):`);
    if (now.length) now.forEach((order) => lines.push(`• ${orderNum(order)} ${orderTitle(order)} — ${order.customer || "без заказчика"}`));
    else lines.push("• нет");
    lines.push("");
    win.days.forEach((day) => {
      const key = dayKey(day);
      const starts = all.filter((order) => dateDay(order.work_start) === key);
      const ends = all.filter((order) => dateDay(order.work_end) === key);
      const load = all.filter((order) => orderCoversDay(order, day) && workStatus(order) !== "cancelled").length;
      if (!starts.length && !ends.length) return;
      lines.push(`${calFmtDay(day, true)} · ${load} в работе`);
      starts.forEach((order) => lines.push(`  старт  ${orderNum(order)} ${orderTitle(order)}`));
      ends.forEach((order) => lines.push(`  финиш ${orderNum(order)} ${orderTitle(order)}`));
    });
    return lines.join("\n");
  }

  function calendarSelect(id, lineId = "") {
    const cal = calendarState();
    cal.selected = id;
    cal.selectedLine = lineId || "";
    const order = findOrder(id);
    if (order) revealOrderOnCalendar(order);
    else renderCalendar();
  }

  function revealOrderOnCalendar(order) {
    const cal = calendarState();
    const start = parseDay(order.work_start) || parseDay(order.work_end);
    if (start) {
      if (cal.mode === "timeline") {
        clampTimelineView();
        const to = addDays(cal.viewFrom, cal.viewDays - 1);
        if (start < cal.viewFrom || start > to) {
          cal.viewFrom = addDays(start, -Math.floor((cal.viewDays - 1) * 0.2));
          clampTimelineView();
        }
        cal.anchor = start;
      } else {
        const win = calendarWindow();
        if (start < win.from || start > win.to) {
          if (cal.mode === "classic") cal.anchor = new Date(start.getFullYear(), start.getMonth(), 1);
          else cal.anchor = mondayOf(start);
        }
      }
      cal.pick = dayKey(start);
      cal.revealDay = dayKey(start);
    }
    renderCalendar();
  }

  function applyCalendarOrder(mutator, { toastText, stay = false } = {}) {
    const cal = calendarState();
    const order = findOrder(cal.selected);
    if (!order) {
      toast("Сначала выберите заказ");
      return;
    }
    const line = cal.selectedLine ? findCalendarLine(order, cal.selectedLine) : null;
    historyCommit();
    if (line) {
      const proxy = lineWorkProxy(order, line);
      mutator(proxy);
      writeLineWork(order, line, proxy);
    } else {
      mutator(order);
      normalizeWorkDates(order);
    }
    historyCommit();
    markDirty();
    if (stay) renderCalendar();
    else revealOrderOnCalendar(order);
    if (toastText) toast(toastText);
  }

  function onCalClick(e) {
    const onTools = e.target.closest(".cal-tools");
    if (calSkipClick) {
      calSkipClick = false;
      if (!onTools) return;
    }
    if (e.target.closest("textarea, [data-cal-note]")) return;
    const mode = e.target.closest("[data-cal-mode]");
    if (mode) {
      const cal = calendarState();
      cal.mode = mode.dataset.calMode;
      persistCalendar();
      markDirty();
      historyCommit();
      renderCalendar();
      return;
    }
    if (e.target.closest("#btn-cal-filter")) {
      const menu = $("cal-filter-menu");
      const btn = $("btn-cal-filter");
      if (!menu) return;
      closeWeekendMenu();
      const open = menu.hidden;
      menu.hidden = !open;
      btn?.setAttribute("aria-expanded", String(open));
      return;
    }
    if (e.target.closest("#btn-cal-weekends")) {
      const menu = $("cal-weekend-menu");
      const btn = $("btn-cal-weekends");
      if (!menu) return;
      closeCalFilter();
      const open = menu.hidden;
      menu.hidden = !open;
      btn?.setAttribute("aria-expanded", String(open));
      return;
    }
    const weekendDay = e.target.closest("[data-cal-weekend]");
    if (weekendDay) {
      toggleWeekdayWeekend(Number(weekendDay.dataset.calWeekend));
      return;
    }
    const filter = e.target.closest("[data-cal-filter]");
    if (filter) {
      calendarState().filter = filter.dataset.calFilter;
      persistCalendar();
      markDirty();
      historyCommit();
      renderCalendar();
      return;
    }
    if (e.target.closest("#cal-prev")) {
      calendarShift(-1);
      return;
    }
    if (e.target.closest("#cal-next")) {
      calendarShift(1);
      return;
    }
    if (e.target.closest("#cal-today")) {
      goTimelineToday();
      renderCalendar();
      return;
    }
    if (e.target.closest("#cal-copy")) {
      cashCopy(calendarPlanText(), "План работ скопирован");
      return;
    }
    const actBtn = e.target.closest("[data-cal-act]");
    if (actBtn) {
      onCalendarAct(actBtn.dataset.calAct, actBtn);
      return;
    }
    const expand = e.target.closest("[data-cal-expand]");
    if (expand) {
      toggleCalendarLines(expand.dataset.calExpand);
      return;
    }
    const pauseBar = e.target.closest(".gantt-bar.is-pause");
    if (pauseBar) {
      const order = findOrder(pauseBar.dataset.calId);
      const lineId = pauseBar.dataset.calLine || "";
      const index = Number(pauseBar.dataset.pauseI);
      if (e.detail === 2 && e.shiftKey && order && Number.isInteger(index)) {
        calendarState().selected = order.id;
        calendarState().selectedLine = lineId;
        applyCalendarOrder(
          (item) => {
            removePauseAt(item, index);
          },
          { toastText: "Пауза снята", stay: true }
        );
        return;
      }
      calendarSelect(pauseBar.dataset.calId, lineId);
      return;
    }
    const workBar = e.target.closest(".gantt-bar[data-cal-id]");
    if (workBar && e.shiftKey) {
      const order = findOrder(workBar.dataset.calId);
      const lineId = workBar.dataset.calLine || "";
      const track = workBar.closest(".gantt-track");
      const day = track ? calDayFromPoint(track, e.clientX, calendarWindow().days) : null;
      if (order && day) {
        calendarState().selected = order.id;
        calendarState().selectedLine = lineId;
        calendarState().pick = dayKey(day);
        let added = false;
        applyCalendarOrder(
          (item) => {
            added = addWorkPause(item, day);
          },
          { stay: true }
        );
        toast(added ? "Пауза" : "Пауза уже есть или день вне срока");
      }
      return;
    }
    const chip = e.target.closest("[data-cal-id]");
    if (chip) {
      if (e.detail === 2 && !chip.dataset.calLine) {
        gotoOrder(chip.dataset.calId);
        return;
      }
      calendarSelect(chip.dataset.calId, chip.dataset.calLine || "");
      return;
    }
    const day = e.target.closest("[data-cal-day]");
    if (day) {
      const cal = calendarState();
      cal.pick = cal.pick === day.dataset.calDay ? "" : day.dataset.calDay;
      renderCalendar();
    }
  }

  function onCalendarAct(act, btn) {
    const cal = calendarState();
    if (act === "fill-all") {
      historyCommit();
      let n = 0;
      calendarOrdersAll().forEach((order) => {
        if (workStatus(order) !== "nodate") return;
        if (fillWorkFromLines(order)) n += 1;
      });
      if (n) {
        historyCommit();
        markDirty();
      }
      renderCalendar();
      toast(n ? `Даты подставлены у ${n} зак.` : "У заказов без дат нет дат позиций");
      return;
    }
    if (act === "open") {
      if (cal.selected) gotoOrder(cal.selected);
      return;
    }
    if (act === "toggle-off") {
      if (!cal.pick) return;
      togglePickedOffDay(cal.pick);
      return;
    }
    if (act === "pick-start" || act === "pick-end") {
      if (!cal.pick) return;
      applyCalendarOrder((order) => {
        if (act === "pick-start") order.work_start = cal.pick;
        else order.work_end = cal.pick;
        normalizeWorkDates(order);
      });
      return;
    }
    if (act === "add-pause") {
      if (!cal.pick) return;
      let added = false;
      applyCalendarOrder(
        (order) => {
          added = addWorkPause(order, cal.pick);
        },
        { stay: true }
      );
      toast(added ? "Пауза" : "Пауза уже есть или день вне срока");
      return;
    }
    if (act === "remove-pause-day") {
      if (!cal.pick) return;
      applyCalendarOrder(
        (order) => {
          removePauseCovering(order, cal.pick);
        },
        { toastText: "Пауза снята", stay: true }
      );
      return;
    }
    if (act === "remove-pause") {
      const index = Number(btn?.dataset.pauseI);
      applyCalendarOrder(
        (order) => {
          removePauseAt(order, index);
        },
        { toastText: "Пауза снята", stay: true }
      );
      return;
    }
    if (act === "fill-lines") {
      calendarState().selectedLine = "";
      applyCalendarOrder((order) => {
        if (!fillWorkFromLines(order)) toast("У позиций нет дат заказа");
      });
      return;
    }
    if (act === "reset-line") {
      applyCalendarOrder(
        (item) => {
          item.work_start = "";
          item.work_end = "";
          item.work_pauses = [];
        },
        { toastText: "Позиция как у заказа", stay: true }
      );
      return;
    }
    applyCalendarOrder((order) => {
      if (act === "start-today") setWorkToday(order, "start");
      else if (act === "end-today") setWorkToday(order, "end");
      else if (act === "shift-left") shiftWorkDates(order, -1);
      else if (act === "shift-right") shiftWorkDates(order, 1);
      else if (act === "clear") {
        order.work_start = "";
        order.work_end = "";
        order.work_pauses = [];
      }
    });
  }

  function onCalChange(e) {
    if (e.target.id === "cal-month-pick" || e.target.id === "cal-year-pick") {
      const cal = calendarState();
      if (!(cal.anchor instanceof Date) || Number.isNaN(cal.anchor.getTime())) cal.anchor = dayStart(new Date());
      const month = Number($("cal-month-pick")?.value ?? cal.anchor.getMonth());
      const year = Number($("cal-year-pick")?.value ?? cal.anchor.getFullYear());
      cal.anchor = new Date(year, month, 1);
      renderCalendar();
      return;
    }
    const field = e.target.dataset.calField;
    if (e.target.dataset.calNote != null) {
      historyCommit();
      setDayNote(e.target.dataset.calNote, e.target.value);
      historyCommit();
      markDirty();
      renderCalendar();
      return;
    }
    if (!field) return;
    applyCalendarOrder((order) => {
      order[field] = e.target.value;
      normalizeWorkDates(order);
    });
  }

  function calDayFromPoint(track, clientX, days) {
    const rect = track.getBoundingClientRect();
    if (!rect.width) return days[0];
    const t = Math.max(0, Math.min(0.999, (clientX - rect.left) / rect.width));
    return days[Math.floor(t * days.length)];
  }

  function onCalPointerDown(e) {
    if (e.button !== 0) return;
    const navHit = e.target.closest("[data-tl-nav]");
    if (navHit) {
      e.preventDefault();
      const full = clampTimelineView();
      const cal = calendarState();
      const track = $("tl-nav-track");
      const originDay = timelineDayFromX(track, e.clientX, full);
      calNav = {
        mode: navHit.dataset.tlNav,
        full,
        originX: e.clientX,
        originFrom: cal.viewFrom,
        originDays: cal.viewDays,
        originEnd: addDays(cal.viewFrom, cal.viewDays - 1),
        originDay,
        moved: false,
      };
      $("tl-nav-view")?.classList.add("is-drag");
      try {
        navHit.setPointerCapture(e.pointerId);
      } catch {
        /* ignore */
      }
      return;
    }
    const handle = e.target.closest("[data-cal-drag]");
    if (!handle) return;
    const mode = handle.dataset.calDrag || "";
    if (e.shiftKey && !mode.startsWith("pause")) return;
    const bar = handle.closest(".gantt-bar[data-cal-id]");
    const order = findOrder(bar?.dataset.calId);
    if (!order) return;
    const track = handle.closest(".gantt-track");
    if (!track) return;
    e.preventDefault();
    historyCommit();
    const win = calendarWindow();
    const lineId = bar.dataset.calLine || "";
    const line = lineId ? findCalendarLine(order, lineId) : null;
    const target = line ? lineWorkProxy(order, line) : order;
    const pauseIndex = mode.startsWith("pause") ? Number(bar.dataset.pauseI) : -1;
    const pause = pauseIndex >= 0 ? workPauses(target)[pauseIndex] : null;
    calDrag = {
      order,
      line,
      target,
      bar,
      mode,
      days: win.days,
      full: win.full,
      track,
      start0: parseDay(target.work_start),
      end0: parseDay(target.work_end),
      pauses0: workPauses(target).map((item) => ({
        start: item.start,
        end: pauseEndKey(target, item),
        open: pauseIsOpen(target, item),
      })),
      pauseIndex,
      pause0: pause
        ? {
            from: parseDay(pause.start),
            till: parseDay(pauseEndKey(target, pause)),
            open: pauseIsOpen(target, pause),
          }
        : null,
      originDay: calDayFromPoint(track, e.clientX, win.days),
      moved: false,
    };
    bar.classList.add("is-drag");
    paintCalDragBar();
    showGanttDayTip(calDrag.originDay, e);
    try {
      bar.setPointerCapture(e.pointerId);
    } catch {
      try {
        handle.setPointerCapture(e.pointerId);
      } catch {
        /* ignore */
      }
    }
  }

  function paintCalDragPauseBar() {
    if (!calDrag) return;
    const { bar, days, pauseIndex } = calDrag;
    const target = calDrag.target || calDrag.order;
    const pause = workPauses(target)[pauseIndex];
    if (!bar || !pause || !days.length) return;
    const winFrom = days[0];
    const winTo = days[days.length - 1];
    let from = parseDay(pause.start);
    let till = parseDay(pauseEndKey(target, pause));
    if (!from || !till) return;
    if (from < winFrom) from = winFrom;
    if (till > winTo) till = winTo;
    if (from > till) return;
    const fromIdx = dayDiff(winFrom, from);
    const len = dayDiff(from, till) + 1;
    const n = days.length;
    bar.style.setProperty("--from", String(fromIdx));
    bar.style.setProperty("--span", String(len));
    bar.style.setProperty("--days", String(n));
    bar.style.left = `${(fromIdx / n) * 100}%`;
    bar.style.width = `${(len / n) * 100}%`;
  }

  function applyPauseDrag(order, day, delta) {
    const index = calDrag.pauseIndex;
    const list = workPauses(order);
    if (!list[index] || !calDrag.pause0) return;
    const env = calDrag.line ? lineDrawEnvelope(calDrag.order, calDrag.line) : orderDrawSpan(calDrag.order || order);
    if (!env) return;
    const others = calDrag.pauses0 || list;
    const prev = others[index - 1];
    const next = others[index + 1];
    let min = env.from;
    let max = env.till;
    if (prev) {
      const prevEnd = parseDay(prev.end);
      if (prevEnd) min = addDays(prevEnd, 1);
    }
    if (next) {
      const nextStart = parseDay(next.start);
      if (nextStart) max = addDays(nextStart, -1);
    }
    if (min > max) return;
    let from = calDrag.pause0.from;
    let till = calDrag.pause0.till;
    if (calDrag.mode === "pause-start") {
      from = day;
      till = calDrag.pause0.till;
    } else if (calDrag.mode === "pause-end") {
      from = calDrag.pause0.from;
      till = day;
    } else {
      const len = dayDiff(calDrag.pause0.from, calDrag.pause0.till);
      from = addDays(calDrag.pause0.from, delta);
      till = addDays(from, len);
      if (from < min) {
        from = min;
        till = addDays(from, len);
      }
      if (till > max) {
        till = max;
        from = addDays(till, -len);
      }
    }
    if (from > till) [from, till] = [till, from];
    from = clampDay(from, min, max);
    till = clampDay(till, min, max);
    if (from > till) from = till;
    list[index] = { start: dayKey(from), end: dayKey(till) };
  }

  function paintCalDragBar() {
    if (!calDrag) return;
    if (String(calDrag.mode).startsWith("pause")) {
      paintCalDragPauseBar();
      return;
    }
    const { bar, days } = calDrag;
    const target = calDrag.target || calDrag.order;
    if (!bar || !days.length) return;
    const winFrom = days[0];
    const winTo = days[days.length - 1];
    const span = orderDrawSpan(target, dayStart(new Date()));
    if (!span) return;
    const from = span.from < winFrom ? winFrom : span.from;
    const till = span.till > winTo ? winTo : span.till;
    if (from > till) return;
    const fromIdx = dayDiff(winFrom, from);
    const len = dayDiff(from, till) + 1;
    const n = days.length;
    bar.style.setProperty("--from", String(fromIdx));
    bar.style.setProperty("--span", String(len));
    bar.style.setProperty("--days", String(n));
    bar.style.left = `${(fromIdx / n) * 100}%`;
    bar.style.width = `${(len / n) * 100}%`;
    bar.classList.toggle("has-deadline", !!orderDeadline(target));
    bar.classList.toggle("is-live", workStatus(target) === "now");
    const track = bar.closest(".gantt-track");
    track?.querySelectorAll(".gantt-bar").forEach((el) => {
      if (el !== bar) el.hidden = true;
    });
    if (calDrag.line) return;
    const full = calDrag.full;
    const navBars = document.querySelectorAll(`.tl-nav-bar[data-cal-id="${cssEscape(calDrag.order.id)}"]`);
    navBars.forEach((navBar, i) => {
      if (i === 0 && full) {
        const navFrom = Math.max(0, dayDiff(full.from, span.from));
        const navTill = Math.min(full.span - 1, dayDiff(full.from, span.till));
        if (navTill >= navFrom) {
          navBar.hidden = false;
          navBar.style.setProperty("--from", String(navFrom));
          navBar.style.setProperty("--len", String(navTill - navFrom + 1));
        }
      } else navBar.hidden = true;
    });
  }

  function onCalPointerMove(e) {
    if (calNav) {
      const track = $("tl-nav-track");
      if (!track) return;
      const day = timelineDayFromX(track, e.clientX, calNav.full);
      if (!day) return;
      if (!calNav.moved && Math.abs(e.clientX - calNav.originX) < 3) return;
      calNav.moved = true;
      const cal = calendarState();
      if (calNav.mode === "view") {
        cal.viewFrom = addDays(calNav.originFrom, dayDiff(calNav.originDay, day));
        cal.viewDays = calNav.originDays;
      } else if (calNav.mode === "start") {
        let from = day;
        if (from > calNav.originEnd) from = calNav.originEnd;
        cal.viewFrom = from;
        cal.viewDays = Math.max(TL_MIN_DAYS, dayDiff(from, calNav.originEnd) + 1);
      } else if (calNav.mode === "end") {
        let end = day;
        if (end < calNav.originFrom) end = calNav.originFrom;
        cal.viewFrom = calNav.originFrom;
        cal.viewDays = Math.max(TL_MIN_DAYS, dayDiff(calNav.originFrom, end) + 1);
      } else {
        const from = day < calNav.originDay ? day : calNav.originDay;
        const to = day < calNav.originDay ? calNav.originDay : day;
        cal.viewFrom = from;
        cal.viewDays = Math.max(TL_MIN_DAYS, dayDiff(from, to) + 1);
      }
      clampTimelineView();
      paintNavView();
      return;
    }
    if (!calDrag) return;
    const day = calDayFromPoint(calDrag.track, e.clientX, calDrag.days);
    if (!day) return;
    const delta = dayDiff(calDrag.originDay, day);
    if (delta || calDrag.moved) calDrag.moved = true;
    const target = calDrag.target || calDrag.order;
    if (String(calDrag.mode).startsWith("pause")) {
      applyPauseDrag(target, day, delta);
      normalizeWorkPauses(target, false);
      paintCalDragPauseBar();
      const pause = workPauses(target)[calDrag.pauseIndex];
      const highlight =
        calDrag.mode === "pause-start"
          ? parseDay(pause?.start)
          : calDrag.mode === "pause-end"
            ? parseDay(pauseEndKey(target, pause))
            : day;
      showGanttDayTip(highlight || day, e);
      return;
    }
    if (calDrag.mode === "start") {
      target.work_start = dayKey(day);
      if (!target.work_end && calDrag.end0) target.work_end = dayKey(calDrag.end0);
    } else if (calDrag.mode === "end") {
      if (!target.work_start) target.work_start = calDrag.start0 ? dayKey(calDrag.start0) : dayKey(day);
      target.work_end = dayKey(day);
    } else {
      if (calDrag.start0) target.work_start = dayKey(addDays(calDrag.start0, delta));
      else target.work_start = dayKey(day);
      if (calDrag.end0) target.work_end = dayKey(addDays(calDrag.end0, delta));
      target.work_pauses = (calDrag.pauses0 || []).map((pause) => ({
        start: pause.start ? dayKey(addDays(parseDay(pause.start), delta)) : "",
        end: pause.open ? "" : pause.end ? dayKey(addDays(parseDay(pause.end), delta)) : "",
        open: !!pause.open,
      }));
    }
    if (calDrag.line) clampLineProxy(calDrag.order, target, calDrag);
    normalizeWorkDates(target, { mergePauses: false, lines: false });
    paintCalDragBar();
    const highlight =
      calDrag.mode === "start" ? parseDay(target.work_start) : calDrag.mode === "end" ? parseDay(target.work_end) : day;
    showGanttDayTip(highlight || day, e);
  }

  function onCalPointerUp() {
    if (calNav) {
      $("tl-nav-view")?.classList.remove("is-drag");
      const jumped = !calNav.moved && calNav.mode === "track";
      if (jumped) {
        const cal = calendarState();
        cal.viewFrom = addDays(calNav.originDay, -Math.floor((cal.viewDays - 1) / 2));
        clampTimelineView();
      }
      if (calNav.moved || jumped) {
        calSkipClick = true;
        calendarState().anchor = calendarState().viewFrom;
        calNav = null;
        renderCalendar();
        return;
      }
      calNav = null;
      return;
    }
    if (!calDrag) return;
    const bar = calDrag.bar;
    const order = calDrag.order;
    if (calDrag.moved) {
      calSkipClick = true;
      calendarState().selected = order.id;
      calendarState().selectedLine = calDrag.line?.id || "";
      if (calDrag.line) writeLineWork(order, calDrag.line, calDrag.target);
      else normalizeWorkDates(order);
      historyCommit();
      markDirty();
      calDrag = null;
      renderCalendar();
      return;
    }
    bar?.classList.remove("is-drag");
    if (bar) {
      bar.style.removeProperty("left");
      bar.style.removeProperty("width");
    }
    calDrag = null;
    showGanttDayTip(null);
  }

  function onCalWheel(e) {
    if (calendarState().mode !== "timeline") return;
    const nav = e.target.closest("#tl-nav");
    const days = e.target.closest(".gantt-days");
    if (!nav && !days) return;
    e.preventDefault();
    if (nav) {
      const track = $("tl-nav-track");
      if (!track) return;
      const rect = track.getBoundingClientRect();
      const ratio = rect.width ? Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width)) : 0.5;
      timelineZoomAt(ratio, e.deltaY > 0 ? 1.14 : 0.88);
      calendarState().anchor = calendarState().viewFrom;
      renderCalendar();
      return;
    }
    const delta = e.deltaX || e.deltaY;
    if (!delta) return;
    const step = Math.max(1, Math.round(Math.abs(delta) / 70));
    const cal = calendarState();
    cal.viewFrom = addDays(cal.viewFrom, (delta > 0 ? 1 : -1) * step);
    clampTimelineView();
    cal.anchor = cal.viewFrom;
    renderCalendar();
  }

  function showGanttDayTip(day, pointer) {
    const tip = $("gantt-day-tip");
    const col = $("gantt-day-col");
    const strip = document.querySelector("#gantt-scroll .gantt-days");
    document.querySelectorAll(".gantt-day.is-hover").forEach((el) => el.classList.remove("is-hover"));
    if (!day) {
      if (tip) {
        tip.hidden = true;
        tip.classList.remove("is-follow");
        tip.style.removeProperty("top");
      }
      if (col) col.hidden = true;
      return;
    }
    const days = calDrag?.days || calendarWindow().days;
    const idx = days.length ? dayDiff(days[0], day) : -1;
    if (col) {
      if (idx >= 0 && idx < days.length) {
        col.hidden = false;
        col.style.setProperty("--col", String(idx));
      } else col.hidden = true;
    }
    const cell = strip?.querySelector(`.gantt-day[data-cal-day="${cssEscape(dayKey(day))}"]`);
    if (cell) cell.classList.add("is-hover");
    if (!tip) return;
    tip.hidden = false;
    const tone = dayToneClass(day);
    const note = dayNote(day);
    const mark =
      tone === "is-off-day"
        ? " · выходной точечно"
        : tone === "is-work-day"
          ? " · рабочий точечно"
          : tone === "is-weekend"
            ? " · выходной"
            : "";
    const extra = note ? ` · ${note.length > 80 ? `${note.slice(0, 80)}…` : note}` : "";
    tip.textContent = `${RU_WEEKDAYS_FULL[weekdayIndex(day)]}, ${calFmtDay(day, true)}${mark}${extra}`;
    const follow = !!(calDrag && pointer && Number.isFinite(pointer.clientX));
    if (follow) {
      tip.classList.add("is-follow");
      const tipW = tip.offsetWidth || 160;
      const tipH = tip.offsetHeight || 28;
      let x = pointer.clientX + 14;
      let y = pointer.clientY - tipH - 10;
      if (y < 8) y = pointer.clientY + 18;
      if (x + tipW > window.innerWidth - 8) x = pointer.clientX - tipW - 14;
      if (x < 8) x = 8;
      tip.style.left = `${x}px`;
      tip.style.top = `${y}px`;
      return;
    }
    tip.classList.remove("is-follow");
    tip.style.removeProperty("top");
    if (!strip || !cell) {
      tip.hidden = true;
      return;
    }
    const stripRect = strip.getBoundingClientRect();
    const dayRect = cell.getBoundingClientRect();
    const tipW = tip.offsetWidth || 140;
    let left = dayRect.left - stripRect.left + dayRect.width / 2;
    const pad = tipW / 2 + 6;
    left = Math.max(pad, Math.min(stripRect.width - pad, left));
    tip.style.left = `${left}px`;
  }

  function onGanttDayHover(e) {
    if (calendarState().mode !== "timeline") return;
    if (calNav || calDrag) return;
    const dayEl = e.type === "pointerleave" ? null : e.target.closest(".gantt-days .gantt-day");
    const parsed = dayEl ? parseDay(dayEl.dataset.calDay) : null;
    showGanttDayTip(parsed);
  }

  function closeCalFilter() {
    const menu = $("cal-filter-menu");
    if (menu) menu.hidden = true;
    $("btn-cal-filter")?.setAttribute("aria-expanded", "false");
  }

  function closeWeekendMenu() {
    const menu = $("cal-weekend-menu");
    if (menu) menu.hidden = true;
    $("btn-cal-weekends")?.setAttribute("aria-expanded", "false");
  }

  function closeCalMenus() {
    closeCalFilter();
    closeWeekendMenu();
  }

  function bindCalendar() {
    $("view-calendar")?.addEventListener("click", onCalClick);
    $("view-calendar")?.addEventListener("change", onCalChange);
    $("cal-board")?.addEventListener("pointerdown", onCalPointerDown);
    $("cal-board")?.addEventListener("pointermove", onGanttDayHover);
    $("cal-board")?.addEventListener("pointerleave", onGanttDayHover);
    $("cal-board")?.addEventListener("wheel", onCalWheel, { passive: false });
    window.addEventListener("pointermove", onCalPointerMove);
    window.addEventListener("pointerup", onCalPointerUp);
    window.addEventListener("pointercancel", onCalPointerUp);
    document.addEventListener("click", (e) => {
      if (e.target.closest("#cal-filter") || e.target.closest("#cal-weekends")) return;
      closeCalMenus();
    });
  }

  /* ==== Облако заказов: интерактивный граф ==== */
  const CLOUD_COLORS = ["#0f766e", "#2563eb", "#7c3aed", "#d97706", "#db2777", "#0891b2", "#059669", "#e11d48", "#4f46e5", "#ca8a04"];
  const GALAXY_TYPES = [
    ["spiral", "спиральная"],
    ["barred", "пересечённая"],
    ["elliptical", "эллиптическая"],
    ["lenticular", "линзовидная"],
    ["flocculent", "клочковатая"],
    ["irregular", "неправильная"],
  ];
  const GALAXY_COLORS = {
    spiral: "#84a4d6",
    barred: "#94aac8",
    elliptical: "#d6c4a8",
    lenticular: "#bab0a4",
    flocculent: "#769cd2",
    irregular: "#608ec4",
  };
  let orderCloud = null;
  let startCloud = null;
  let unsavedWait = null;

  function startViewMode() {
    try {
      return localStorage.getItem(LS_START_VIEW) === "galaxies" ? "galaxies" : "list";
    } catch {
      return "list";
    }
  }

  function persistStartView(mode) {
    try {
      localStorage.setItem(LS_START_VIEW, mode === "galaxies" ? "galaxies" : "list");
    } catch {
      /* ignore */
    }
  }

  function galaxyTypeFor(path) {
    return GALAXY_TYPES[cloudHash(path) % GALAXY_TYPES.length][0];
  }

  function galaxyVolume(item) {
    return Math.max(1, Number(item.lines) || 0, (Number(item.orders) || 0) * 2, (Number(item.bytes) || 0) / 2400);
  }

  function galaxyItems() {
    const lib = state.library?.items || [];
    const seen = new Set(lib.map((item) => String(item.path || "").replace(/\//g, "\\").toLowerCase()));
    const extra = (state.recentItems || []).filter((item) => {
      if (item.exists === false) return false;
      const key = String(item.path || "").replace(/\//g, "\\").toLowerCase();
      return key && !seen.has(key);
    });
    return [
      ...lib.map((item) => ({ ...item, origin: "library" })),
      ...extra.map((item) => ({ ...item, origin: "recent" })),
    ];
  }

  function galaxyGraphData(items = galaxyItems()) {
    const vols = items.map((item) => galaxyVolume(item));
    const peak = Math.max(1, ...vols);
    return {
      nodes: items.map((item) => {
        const type = galaxyTypeFor(item.path);
        const volume = galaxyVolume(item);
        const mass = Math.log1p(volume) / Math.log1p(peak);
        return {
          id: `galaxy:${item.path}`,
          kind: "galaxy",
          label: item.title || item.name || "Отчёт",
          path: item.path,
          origin: item.origin,
          galaxy: type,
          volume,
          orders: item.orders || 0,
          lines: item.lines || 0,
          value: item.value || 0,
          current: samePath(item.path, state.path),
          color: GALAXY_COLORS[type] || GALAXY_COLORS.spiral,
          radius: 26 + mass * 56,
        };
      }),
      edges: [],
    };
  }

  function cloudState() {
    if (!state.cloud) {
      state.cloud = {
        query: "",
        layout: "galaxy",
        color: "status",
        size: "amount",
        debtOnly: false,
        labels: true,
        motion: true,
        heat: false,
        space3d: false,
        catalog: false,
        ...loadStoredCloud(),
      };
      state.cloud.catalog = false;
    }
    return state.cloud;
  }

  function cloudHash(text) {
    let h = 0;
    for (const ch of String(text || "Без значения")) h = (Math.imul(h, 31) + ch.charCodeAt(0)) | 0;
    return Math.abs(h);
  }

  function cloudCategoryColor(value) {
    return CLOUD_COLORS[cloudHash(value) % CLOUD_COLORS.length];
  }

  function cloudNodeColor(kind, item) {
    const mode = cloudState().color;
    if (kind === "customer") return mode === "debt" ? (item.debt > 0.005 ? "#dc2626" : "#059669") : cloudCategoryColor(item.customer);
    if (mode === "customer") return cloudCategoryColor(item.customer);
    if (mode === "type") return cloudCategoryColor(item.type || "Без типа");
    if (mode === "debt") {
      if (item.debt <= 0.005) return "#059669";
      if (item.paid > 0.005) return "#f59e0b";
      return "#dc2626";
    }
    return statusMeta(item.status || "Без статуса").color;
  }

  function cloudRadius(kind, item, maxima) {
    if (kind === "customer") {
      const factor = Math.min(1.45, Math.sqrt(Math.max(0, item.value) / Math.max(1, maxima.value)));
      return 17 + factor * 13;
    }
    if (kind === "order") {
      const factor = Math.min(1.25, Math.sqrt(Math.max(0, item.value) / Math.max(1, maxima.value)));
      return 10 + factor * 10;
    }
    const mode = cloudState().size;
    if (mode === "equal") return 6;
    const key = mode === "debt" ? "debt" : mode === "quantity" ? "quantity" : "value";
    const factor = Math.sqrt(Math.max(0, item[key]) / Math.max(1, maxima[key]));
    return 4.5 + factor * 9.5;
  }

  function cloudGraphData() {
    const query = cloudState().query.trim().toLocaleLowerCase("ru");
    const debtOnly = cloudState().debtOnly;
    const orderRows = [];
    (state.doc.orders || []).forEach((order) => {
      const orderText = [order.number, order.name, order.customer, order.notes].join(" ").toLocaleLowerCase("ru");
      const lines = (order.lines || []).filter((line) => {
        if (isFrozenLine(line)) return false;
        const t = lineTotals(line);
        if (t.expense) return false;
        if (debtOnly && t.unpaid <= 0.005) return false;
        if (!query || orderText.includes(query)) return true;
        return [line.product, line.order_type, line.status, line.unit].join(" ").toLocaleLowerCase("ru").includes(query);
      });
      if (lines.length) orderRows.push({ order, lines });
    });

    const maxima = { value: 1, debt: 1, quantity: 1 };
    orderRows.forEach(({ lines }) => lines.forEach((line) => {
      const t = lineTotals(line);
      maxima.value = Math.max(maxima.value, t.after);
      maxima.debt = Math.max(maxima.debt, t.unpaid);
      maxima.quantity = Math.max(maxima.quantity, Math.abs(qtyValue(line)));
    }));

    const customers = new Map();
    orderRows.forEach(({ order, lines }) => {
      const name = String(order.customer || "Без заказчика").trim() || "Без заказчика";
      if (!customers.has(name)) customers.set(name, { customer: name, orders: [], value: 0, paid: 0, debt: 0, positions: 0 });
      const c = customers.get(name);
      c.orders.push(order);
      lines.forEach((line) => {
        const t = lineTotals(line);
        c.value += t.after;
        c.paid += t.paid;
        c.debt += t.unpaid;
        c.positions += 1;
      });
    });

    const nodes = [];
    const edges = [];
    customers.forEach((c) => {
      const id = `customer:${c.customer}`;
      nodes.push({
        id,
        kind: "customer",
        label: c.customer,
        customer: c.customer,
        value: c.value,
        paid: c.paid,
        debt: c.debt,
        count: c.orders.length,
        positions: c.positions,
        color: cloudNodeColor("customer", c),
        radius: cloudRadius("customer", c, maxima),
      });
    });

    orderRows.forEach(({ order, lines }) => {
      const customer = String(order.customer || "Без заказчика").trim() || "Без заказчика";
      const totals = lines.reduce((acc, line) => {
        const t = lineTotals(line);
        acc.value += t.after;
        acc.paid += t.paid;
        acc.debt += t.unpaid;
        return acc;
      }, { value: 0, paid: 0, debt: 0 });
      const first = lines.find((line) => line.order_date) || lines[0];
      const statuses = unique(lines.map((line) => line.status).filter(Boolean));
      const types = unique(lines.map((line) => line.order_type).filter(Boolean));
      const orderNode = {
        id: `order:${order.id}`,
        rawId: order.id,
        kind: "order",
        parent: `customer:${customer}`,
        label: `${order.number || "—"} · ${order.name || "Без названия"}`,
        number: order.number || "—",
        name: order.name || "Без названия",
        customer,
        status: statuses.length === 1 ? statuses[0] : "Смешанные статусы",
        statuses,
        type: types.length === 1 ? types[0] : "Несколько типов",
        value: totals.value,
        paid: totals.paid,
        debt: totals.debt,
        count: lines.length,
        time: first?.order_date ? parseDay(first.order_date)?.getTime() ?? NaN : NaN,
      };
      orderNode.color = cloudNodeColor("order", orderNode);
      orderNode.radius = cloudRadius("order", orderNode, maxima);
      nodes.push(orderNode);
      edges.push({ source: orderNode.parent, target: orderNode.id, kind: "customer" });

      lines.forEach((line, index) => {
        const t = lineTotals(line);
        const lineNode = {
          id: `line:${order.id}:${line.id}`,
          rawId: line.id,
          orderId: order.id,
          kind: "line",
          parent: orderNode.id,
          label: line.product || line.order_type || `Позиция ${index + 1}`,
          product: line.product || "Без продукта",
          type: line.order_type || "Без типа",
          status: line.status || "Без статуса",
          customer,
          orderNumber: order.number || "—",
          orderName: order.name || "Без названия",
          value: t.after,
          paid: t.paid,
          debt: t.unpaid,
          quantity: Math.abs(qtyValue(line)),
          unit: line.unit || "",
          discount: t.discount,
          orderDate: line.order_date || "",
          paymentDate: line.payment_date || "",
          time: line.order_date ? parseDay(line.order_date)?.getTime() ?? orderNode.time : orderNode.time,
        };
        lineNode.color = cloudNodeColor("line", lineNode);
        lineNode.radius = cloudRadius("line", lineNode, maxima);
        nodes.push(lineNode);
        edges.push({ source: orderNode.id, target: lineNode.id, kind: "line" });
      });
    });
    return { nodes, edges, orderRows, customers };
  }

  function cloudPercent(paid, value) {
    return value > 0.005 ? Math.min(100, Math.round((paid / value) * 100)) : 0;
  }

  function renderCloudKpis(graph) {
    const orderNodes = graph.nodes.filter((node) => node.kind === "order");
    const lineNodes = graph.nodes.filter((node) => node.kind === "line");
    const value = lineNodes.reduce((sum, node) => sum + node.value, 0);
    const debt = lineNodes.reduce((sum, node) => sum + node.debt, 0);
    const paid = lineNodes.reduce((sum, node) => sum + node.paid, 0);
    $("cloud-kpis").innerHTML = `
      <div><span>Заказы</span><b>${orderNodes.length}</b></div>
      <div><span>Позиции</span><b>${lineNodes.length}</b></div>
      <div><span>Оборот</span><b>${esc(money(value))}</b></div>
      <div class="${debt > 0.005 ? "debt" : ""}"><span>Долг</span><b>${esc(money(debt))}</b><small>${cloudPercent(paid, value)}% собрано</small></div>`;
  }

  function renderCloudLegend(graph) {
    const mode = cloudState().color;
    let items;
    if (mode === "debt") {
      items = [["Оплачено", "#059669"], ["Частично", "#f59e0b"], ["Не оплачено", "#dc2626"]];
    } else {
      const key = mode === "customer" ? "customer" : mode === "type" ? "type" : "status";
      const map = new Map();
      graph.nodes.filter((node) => node.kind === "line").forEach((node) => {
        const name = node[key] || "Без значения";
        if (!map.has(name)) map.set(name, node.color);
      });
      items = [...map.entries()].slice(0, 9);
    }
    $("cloud-legend").innerHTML = [
      ...(cloudState().heat ? [`<span class="cloud-legend-heat" title="Цвет показывает, где сосредоточен долг"><i></i>тепло долга: слабый → сильный</span>`] : []),
      `<span class="cloud-legend-kind"><i class="customer"></i>звезда — заказчик</span>`,
      `<span class="cloud-legend-kind"><i class="order"></i>планета — заказ</span>`,
      `<span class="cloud-legend-kind"><i class="line"></i>спутник — позиция</span>`,
      `<span class="cloud-legend-link trunk" title="Стрелка и бегущие штрихи показывают направление">заказчик → заказ</span>`,
      `<span class="cloud-legend-link branch" title="От заказа к его позициям">заказ → позиция</span>`,
      `<span class="cloud-legend-link bridge" title="Пунктир между близкими заказчиками">связь заказчиков</span>`,
      ...items.map(([label, color]) => `<span title="${esc(label)}"><i style="background:${esc(color)}"></i>${esc(label)}</span>`),
    ].join("");
  }

  function cloudMetric(label, value, danger = false) {
    return `<div class="cloud-detail-metric${danger ? " danger" : ""}"><span>${esc(label)}</span><b>${esc(value)}</b></div>`;
  }

  function renderCloudInspector(node) {
    const box = $("cloud-inspector");
    if (!box) return;
    if (!node) {
      box.innerHTML = cloudState().catalog
        ? `<div class="cloud-inspector-idle">
        <div class="cloud-scan"><span></span></div>
        <strong>Выберите галактику</strong>
        <p>Каждый отчёт — отдельная галактика. Нажмите, чтобы влететь внутрь и открыть файл.</p>
      </div>`
        : `<div class="cloud-inspector-idle">
        <div class="cloud-scan"><span></span></div>
        <strong>Выберите объект</strong>
        <p>Наведите на узел для быстрой справки. Нажмите, чтобы зафиксировать подробности.</p>
      </div>`;
      return;
    }
    if (node.kind === "galaxy") {
      const typeLabel = (GALAXY_TYPES.find((row) => row[0] === node.galaxy) || ["", "галактика"])[1];
      const origin = node.origin === "recent" ? "Недавний файл" : "Папка FinMaster";
      box.innerHTML = `<div class="cloud-detail">
        <div class="cloud-detail-top"><span class="cloud-detail-dot" style="--node:${esc(node.color)}"></span><span>Галактика</span></div>
        <h3>${esc(node.label)}</h3>
        <p>${esc(origin)} · ${esc(typeLabel)}</p>
        <div class="cloud-detail-metrics">${cloudMetric("Заказы", String(node.orders || 0))}${cloudMetric("Позиции", String(node.lines || 0))}${cloudMetric("Оборот", money(node.value || 0))}</div>
        <div class="cloud-detail-row"><span>Файл</span><b>${esc(node.path || "—")}</b></div>
        <div class="cloud-detail-actions"><button class="btn primary" type="button" data-cloud-galaxy="${esc(node.path)}">${node.current ? "Войти в систему" : "Открыть отчёт"}</button></div>
      </div>`;
      return;
    }
    const kind = node.kind === "customer" ? "Заказчик" : node.kind === "order" ? "Заказ" : "Позиция";
    let meta = "";
    let metrics = "";
    let actions = "";
    if (node.kind === "customer") {
      meta = `${node.count} ${ordWord(node.count)} · ${node.positions} ${posWord(node.positions)}`;
      metrics = cloudMetric("Оборот", money(node.value)) + cloudMetric("Оплачено", money(node.paid)) + cloudMetric("Долг", money(node.debt), node.debt > 0.005);
      actions = `<button class="btn primary" type="button" data-cloud-customer="${esc(node.customer)}">Показать только связи</button>
        <button class="btn" type="button" data-cloud-focus="${esc(node.id)}">Центрировать</button>`;
    } else if (node.kind === "order") {
      meta = `${esc(node.customer)} · ${node.count} ${posWord(node.count)}`;
      metrics = cloudMetric("Сумма", money(node.value)) + cloudMetric("Оплачено", money(node.paid)) + cloudMetric("Долг", money(node.debt), node.debt > 0.005);
      actions = `<button class="btn primary" type="button" data-cloud-open="${esc(node.rawId)}">Открыть заказ</button>
        <button class="btn" type="button" data-cloud-snapshot="${esc(node.rawId)}">Снимок</button>
        <button class="btn" type="button" data-cloud-focus="${esc(node.id)}">Центрировать</button>`;
    } else {
      meta = `${esc(node.orderNumber)} · ${esc(node.orderName)}`;
      metrics = cloudMetric("Сумма", money(node.value)) + cloudMetric("Оплачено", money(node.paid)) + cloudMetric("Долг", money(node.debt), node.debt > 0.005);
      actions = `<button class="btn primary" type="button" data-cloud-open="${esc(node.orderId)}">Открыть заказ</button>
        <button class="btn" type="button" data-cloud-focus="${esc(node.id)}">Центрировать</button>`;
    }
    const progress = cloudPercent(node.paid, node.value);
    box.innerHTML = `<div class="cloud-detail">
      <div class="cloud-detail-top"><span class="cloud-detail-dot" style="--node:${esc(node.color)}"></span><span>${kind}</span></div>
      <h3>${esc(node.label)}</h3>
      <p>${meta}</p>
      <div class="cloud-detail-metrics">${metrics}</div>
      <div class="cloud-progress"><span style="width:${progress}%"></span></div>
      <div class="cloud-progress-label"><span>Собираемость</span><b>${progress}%</b></div>
      ${node.status ? `<div class="cloud-detail-row"><span>Статус</span><b>${esc(node.status)}</b></div>` : ""}
      ${node.type ? `<div class="cloud-detail-row"><span>Тип</span><b>${esc(node.type)}</b></div>` : ""}
      ${node.quantity != null ? `<div class="cloud-detail-row"><span>Количество</span><b>${esc(String(node.quantity))} ${esc(node.unit || "")}</b></div>` : ""}
      ${node.orderDate ? `<div class="cloud-detail-row"><span>Дата заказа</span><b>${esc(cashDateText(parseDay(node.orderDate)))}</b></div>` : ""}
      <div class="cloud-detail-actions">${actions}</div>
    </div>`;
  }

  function renderCloudTooltip(node, point) {
    const tip = $("cloud-tooltip");
    if (!tip) return;
    if (!node || !point) {
      tip.hidden = true;
      return;
    }
    const kind = node.kind === "galaxy" ? "Галактика" : node.kind === "customer" ? "Заказчик" : node.kind === "order" ? "Заказ" : "Позиция";
    const extra = node.kind === "galaxy"
      ? `${node.origin === "recent" ? "недавний" : "FinMaster"} · ${node.orders || 0} зак.`
      : `${esc(money(node.value))}${node.debt > 0.005 ? ` · долг ${esc(money(node.debt))}` : ""}`;
    tip.innerHTML = `<small>${kind}</small><b>${esc(node.label)}</b><span>${extra}</span>`;
    tip.hidden = false;
    const wrap = $("cloud-canvas-wrap").getBoundingClientRect();
    const tw = tip.offsetWidth || 220;
    const th = tip.offsetHeight || 72;
    tip.style.left = `${Math.max(10, Math.min(wrap.width - tw - 10, point.x + 16))}px`;
    tip.style.top = `${Math.max(10, Math.min(wrap.height - th - 10, point.y + 16))}px`;
  }

  function ensureOrderCloud() {
    if (orderCloud || !window.FinOrderCloud || !$("cloud-canvas")) return orderCloud;
    orderCloud = window.FinOrderCloud.create({
      canvas: $("cloud-canvas"),
      minimap: $("cloud-minimap"),
      onHover: renderCloudTooltip,
      onSelect: renderCloudInspector,
      onOpen: (node) => {
        if (node.kind === "galaxy") {
          openGalaxy(node);
          return;
        }
        const id = node.kind === "order" ? node.rawId : node.kind === "line" ? node.orderId : null;
        if (id) gotoOrder(id);
      },
      onTransform: ({ zoom }) => {
        if ($("cloud-zoom-value")) $("cloud-zoom-value").textContent = `${Math.round(zoom * 100)}%`;
      },
    });
    return orderCloud;
  }

  function syncCloudControls() {
    const s = cloudState();
    if ($("cloud-search") && document.activeElement !== $("cloud-search")) $("cloud-search").value = s.query;
    if ($("cloud-layout")) $("cloud-layout").value = s.layout;
    if ($("cloud-color")) $("cloud-color").value = s.color;
    if ($("cloud-size")) $("cloud-size").value = s.size;
    if ($("cloud-debt")) $("cloud-debt").checked = !!s.debtOnly;
    $("cloud-labels")?.setAttribute("aria-pressed", String(s.labels !== false));
    $("cloud-motion")?.setAttribute("aria-pressed", String(s.motion !== false));
    $("cloud-heat")?.setAttribute("aria-pressed", String(!!s.heat));
    $("cloud-heat")?.classList.toggle("active", !!s.heat);
    $("cloud-3d")?.setAttribute("aria-pressed", String(!!s.space3d));
    $("cloud-3d")?.classList.toggle("active", !!s.space3d);
    if ($("cloud-motion")) $("cloud-motion").textContent = s.motion === false ? "Ⅱ" : "◉";
    const hint = $("cloud-hint");
    if (hint) {
      hint.innerHTML = s.catalog
        ? `<b>Галактики</b> двойной клик — войти в отчёт · <b>левая</b> обзор · <b>средняя</b> сдвиг · <b>колесо</b> масштаб`
        : s.space3d
        ? `<b>3D</b> левая — обзор · <b>средняя</b> сдвиг · <b>колесо</b> масштаб · <b>узел</b> сдвинуть · <b>двойной клик</b> открыть · <b>T</b> автотур`
        : `<b>Стрелка</b> заказчик → заказ → позиция · <b>колесо</b> масштаб · <b>drag</b> карта · <b>узел</b> сдвинуть · <b>двойной клик</b> открыть · <b>T</b> автотур · <b>Esc</b> свернуть карту`;
    }
    $("cloud-canvas-wrap")?.classList.toggle("space-3d", !!s.space3d || !!s.catalog);
  }

  function heatFociWord(n) {
    const abs = Math.abs(Math.round(n)) % 100;
    const tail = abs % 10;
    if (abs > 10 && abs < 20) return "очагов";
    if (tail === 1) return "очаг";
    if (tail >= 2 && tail <= 4) return "очага";
    return "очагов";
  }

  function syncCloudHeatScale(graph) {
    const on = !!cloudState().heat;
    const empty = $("cloud-empty") && !$("cloud-empty").hidden;
    const el = $("cloud-heat-scale");
    if (el) el.hidden = !on || empty;
    $("cloud-canvas-wrap")?.classList.toggle("heat-on", on);
    const sum = $("cloud-heat-sum");
    if (!sum || !on) return;
    const nodes = (graph || cloudGraphData()).nodes || [];
    const debt = nodes.filter((n) => n.kind === "line").reduce((acc, n) => acc + (n.debt || 0), 0);
    const foci = nodes.filter((n) => n.kind === "customer" && (n.debt || 0) > 0.01).length;
    sum.textContent = debt > 0.01
      ? `в кадре ${money(debt)}${foci ? ` · ${foci} ${heatFociWord(foci)}` : ""}`
      : "неоплаченных позиций нет";
  }

  function renderGalaxyCloud() {
    syncCloudControls();
    const items = galaxyItems();
    const graph = galaxyGraphData(items);
    $("cloud-kpis").innerHTML = `
      <div><span>Галактики</span><b>${items.length}</b></div>
      <div><span>FinMaster</span><b>${items.filter((item) => item.origin === "library").length}</b></div>
      <div><span>Недавние</span><b>${items.filter((item) => item.origin === "recent").length}</b></div>`;
    $("cloud-legend").innerHTML = [
      `<span class="cloud-legend-kind"><i class="customer"></i>галактика — отчёт</span>`,
      `<span class="cloud-legend-link trunk" title="Файлы из папки Documents/FinMaster">папка FinMaster</span>`,
      `<span class="cloud-legend-link bridge" title="Недавние файлы вне папки">недавние вне папки</span>`,
      ...GALAXY_TYPES.map(([id, label]) => `<span title="${esc(label)}"><i style="background:${esc(GALAXY_COLORS[id])}"></i>${esc(label)}</span>`),
    ].join("");
    const empty = !items.length;
    $("cloud-empty").hidden = !empty;
    $("cloud-canvas")?.classList.toggle("is-empty", empty);
    if (empty) {
      const title = $("cloud-empty").querySelector("strong");
      const note = $("cloud-empty").querySelector(":scope > span");
      const add = $("cloud-add-order");
      if (title) title.textContent = "Галактик пока нет";
      if (note) note.textContent = "Сохраните отчёт в папку FinMaster или откройте файл — он появится здесь.";
      if (add) add.hidden = true;
    }
    const el = $("cloud-heat-scale");
    if (el) el.hidden = true;
    const engine = ensureOrderCloud();
    engine?.update(graph, {
      catalog: true,
      labels: true,
      motion: cloudState().motion !== false,
      heat: false,
      space3d: true,
      query: cloudState().query,
      openOnClick: false,
    });
    $("cloud-tech").textContent = `${items.length} галактик · размер по объёму отчёта · 3D`;
    renderCloudInspector(orderCloud?.selected?.data || null);
  }

  function renderCloud() {
    const catalog = !!cloudState().catalog;
    $("cloud-board")?.classList.toggle("is-catalog", catalog);
    $("cloud-galaxies")?.setAttribute("aria-pressed", String(catalog));
    $("cloud-galaxies")?.classList.toggle("active", catalog);
    if ($("cloud-title")) {
      $("cloud-title").innerHTML = catalog
        ? `Галактики <span class="cloud-live"><i></i> отчёты</span>`
        : `Облако заказов <span class="cloud-live"><i></i> живая физика</span>`;
    }
    if ($("cloud-eyebrow")) $("cloud-eyebrow").textContent = catalog ? "REPORT GALAXIES" : "LIVE RELATIONSHIP ENGINE";
    if ($("cloud-search")) $("cloud-search").placeholder = catalog ? "Название отчёта…" : "Номер, заказчик, работа, продукт…";
    if (catalog) {
      renderGalaxyCloud();
      return;
    }
    syncCloudControls();
    const graph = cloudGraphData();
    renderCloudKpis(graph);
    renderCloudLegend(graph);
    const empty = !$("cloud-canvas") || graph.nodes.length === 0;
    $("cloud-empty").hidden = !empty;
    $("cloud-canvas").classList.toggle("is-empty", empty);
    if (empty) {
      const hasOrders = (state.doc.orders || []).length > 0;
      const title = $("cloud-empty").querySelector("strong");
      const note = $("cloud-empty").querySelector(":scope > span");
      const add = $("cloud-add-order");
      if (title) title.textContent = hasOrders ? "Совпадений не найдено" : "Облако пока пусто";
      if (note) note.textContent = hasOrders ? "Измените запрос или выключите фильтр долгов." : "Добавьте первый заказ — связи появятся здесь автоматически.";
      if (add) add.hidden = hasOrders;
    }
    syncCloudHeatScale(graph);
    const engine = ensureOrderCloud();
    engine?.update(graph, {
      layout: cloudState().layout,
      labels: cloudState().labels,
      motion: cloudState().motion,
      heat: cloudState().heat,
      space3d: cloudState().space3d,
      query: cloudState().query,
      catalog: false,
      openOnClick: false,
    });
    $("cloud-tech").textContent = `${graph.nodes.length} узлов · ${graph.edges.length} связей · MST-созвездия · ${cloudState().space3d ? "3D" : "2D"}${cloudState().heat ? " · тепло долга" : ""}`;
    if (state.focusLineId) applyCloudFocus({ fly: false });
  }

  function bindCloud() {
    let searchTimer = 0;
    $("cloud-search")?.addEventListener("input", (e) => {
      cloudState().query = e.target.value;
      syncSearchClear(e.target);
      renderCloud();
      clearTimeout(searchTimer);
      searchTimer = setTimeout(() => orderCloud?.fit(), 180);
    });
    $("cloud-layout")?.addEventListener("change", (e) => {
      cloudState().layout = e.target.value;
      persistCloudPrefs();
      orderCloud?.setOptions({ layout: e.target.value });
      setTimeout(() => orderCloud?.fit(), 140);
    });
    $("cloud-color")?.addEventListener("change", (e) => {
      cloudState().color = e.target.value;
      persistCloudPrefs();
      renderCloud();
    });
    $("cloud-size")?.addEventListener("change", (e) => {
      cloudState().size = e.target.value;
      persistCloudPrefs();
      renderCloud();
    });
    $("cloud-debt")?.addEventListener("change", (e) => {
      cloudState().debtOnly = e.target.checked;
      persistCloudPrefs();
      renderCloud();
      setTimeout(() => orderCloud?.fit(), 100);
    });
    $("cloud-labels")?.addEventListener("click", (e) => {
      cloudState().labels = !cloudState().labels;
      persistCloudPrefs();
      e.currentTarget.setAttribute("aria-pressed", String(cloudState().labels));
      orderCloud?.setOptions({ labels: cloudState().labels });
    });
    $("cloud-motion")?.addEventListener("click", (e) => {
      cloudState().motion = !cloudState().motion;
      persistCloudPrefs();
      e.currentTarget.setAttribute("aria-pressed", String(cloudState().motion));
      e.currentTarget.textContent = cloudState().motion ? "◉" : "Ⅱ";
      orderCloud?.setOptions({ motion: cloudState().motion });
    });
    $("cloud-heat")?.addEventListener("click", (e) => {
      cloudState().heat = !cloudState().heat;
      persistCloudPrefs();
      e.currentTarget.setAttribute("aria-pressed", String(cloudState().heat));
      e.currentTarget.classList.toggle("active", cloudState().heat);
      orderCloud?.setOptions({ heat: cloudState().heat });
      syncCloudHeatScale();
      renderCloudLegend(cloudGraphData());
    });
    $("cloud-3d")?.addEventListener("click", (e) => {
      cloudState().space3d = !cloudState().space3d;
      persistCloudPrefs();
      e.currentTarget.setAttribute("aria-pressed", String(cloudState().space3d));
      e.currentTarget.classList.toggle("active", cloudState().space3d);
      orderCloud?.setOptions({ space3d: cloudState().space3d });
      syncCloudControls();
    });
    $("cloud-galaxies")?.addEventListener("click", () => {
      cloudState().catalog = !cloudState().catalog;
      renderCloud();
      setTimeout(() => orderCloud?.fit(), 80);
    });
    $("cloud-tour")?.addEventListener("click", () => {
      if (!orderCloud?.startTour()) toast("Для автотура нужны заказы или долги");
      else toast("Автотур по очагам долга · Esc остановить");
    });
    $("cloud-fit")?.addEventListener("click", () => orderCloud?.fit());
    $("cloud-zoom-in")?.addEventListener("click", () => orderCloud?.zoomAt(1.22));
    $("cloud-zoom-out")?.addEventListener("click", () => orderCloud?.zoomAt(1 / 1.22));
    $("cloud-fs")?.addEventListener("click", () => toggleCloudFullscreen());
    $("cloud-add-order")?.addEventListener("click", () => {
      state.doc.orders.push(emptyOrder());
      markDirty();
      gotoOrder(state.doc.orders[state.doc.orders.length - 1].id);
    });
    $("cloud-inspector")?.addEventListener("click", (e) => {
      const open = e.target.closest("[data-cloud-open]");
      const snapshot = e.target.closest("[data-cloud-snapshot]");
      const customer = e.target.closest("[data-cloud-customer]");
      const focus = e.target.closest("[data-cloud-focus]");
      const galaxy = e.target.closest("[data-cloud-galaxy]");
      if (open) gotoOrder(open.dataset.cloudOpen);
      else if (galaxy) openGalaxy({ path: galaxy.dataset.cloudGalaxy, id: `galaxy:${galaxy.dataset.cloudGalaxy}` });
      else if (snapshot) openShare(findOrder(snapshot.dataset.cloudSnapshot));
      else if (focus) orderCloud?.focus(focus.dataset.cloudFocus);
      else if (customer) {
        cloudState().query = customer.dataset.cloudCustomer;
        $("cloud-search").value = cloudState().query;
        renderCloud();
        setTimeout(() => orderCloud?.fit(), 100);
      }
    });
    document.addEventListener("fullscreenchange", syncCloudFullscreen);
    document.addEventListener("webkitfullscreenchange", syncCloudFullscreen);
  }

  function calculatorApi() {
    return {
      doc: () => state.doc,
      view: () => state.view,
      uid,
      money,
      toast,
      markDirty,
      orders: () => state.doc?.orders || [],
      findOrder,
      lineTotals,
      orderTotals,
      isFrozen: isFrozenLine,
      isExpense: isExpenseLine,
      taxMode,
      qtyValue,
      lineUnitPrice: (line) => Math.max(0, numExpr(line, "price_expr", "price")),
      statuses: () => (state.doc?.statuses || []).map((s) => s.name),
      customers: () => unique((state.doc?.orders || []).map((o) => o.customer).filter(Boolean)),
      calcStats: (opts) => calcNodeStats(opts || {}),
      presentValue: (blockId, portId) => window.FinCalc?.presentValue?.(blockId, portId) ?? null,
      copyText: async (text) => {
        if (state.desktop) await apiPost("/api/clipboard-text", { text });
        else if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(text);
        else throw new Error("clipboard");
      },
    };
  }

  function presentationApi() {
    return {
      doc: () => state.doc,
      view: () => state.view,
      uid,
      money,
      markDirty,
      presentValue: (blockId, portId) => window.FinCalc?.presentValue?.(blockId, portId) ?? null,
    };
  }

  function calcNodeStats(opts) {
    const customer = String(opts.customer || "").trim().toLowerCase();
    const orderId = String(opts.orderId || "").trim();
    const period = opts.period || "all";
    const payFilter = opts.payFilter || "all";
    const status = String(opts.status || "").trim();
    const dateFrom = dateDay(opts.dateFrom);
    const dateTo = dateDay(opts.dateTo);
    let rows = allRows();
    if (orderId) rows = rows.filter(({ order }) => order.id === orderId);
    if (customer) rows = rows.filter(({ order }) => String(order.customer || "").toLowerCase().includes(customer));
    if (status) rows = rows.filter(({ line }) => line.status === status);
    if (payFilter && payFilter !== "all") rows = rows.filter(({ order }) => orderFilterMatch(order, payFilter));
    if (period === "range") {
      rows = rows.filter(({ line }) => {
        const d = dateDay(line.order_date);
        if (!d) return false;
        if (dateFrom && d < dateFrom) return false;
        if (dateTo && d > dateTo) return false;
        return true;
      });
    } else if (period && period !== "all") {
      rows = rows.filter(({ line }) => dashPeriodMatch(line.order_date, period));
    }
    const s = summarize(rows);
    const active = rows.filter(({ line }) => !/отмен|аннул|черн/i.test(line.status));
    const as = summarize(active);
    const now = new Date();
    const curKey = monthKeyOf(now.toISOString());
    let monthAfter = 0;
    let monthCost = 0;
    rows.forEach(({ line, totals }) => {
      if (monthKeyOf(line.order_date) !== curKey) return;
      if (totals.expense) monthCost += totals.cost;
      else monthAfter += totals.after;
    });
    const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
    const dayOfMonth = now.getDate() || 1;
    const monthAgo = localStamp(new Date(now.getTime() - 30 * 86400000));
    const overdueRows = rows.filter(({ line, totals }) => totals.unpaid > 0.005 && line.order_date && dateDay(line.order_date) < monthAgo);
    const overdueSum = overdueRows.reduce((acc, r) => acc + r.totals.unpaid, 0);
    const orderSums = new Map();
    rows.forEach(({ order, totals }) => {
      if (totals.expense) return;
      orderSums.set(order.id, (orderSums.get(order.id) || 0) + totals.after);
    });
    const paidOrders = [...orderSums.values()].filter((v) => v > 0);
    const avgCheck = paidOrders.length ? paidOrders.reduce((a, b) => a + b, 0) / paidOrders.length : 0;
    return {
      orders: s.orderCount,
      lines: s.count,
      after: s.after,
      afterActive: as.after,
      paid: s.paid,
      unpaid: s.unpaid,
      total: s.total,
      cost: s.cost,
      costCount: s.costCount,
      net: s.net,
      paidShare: s.after ? Math.round((s.paid / s.after) * 100) : 0,
      avgCheck,
      overdue: overdueRows.length,
      overdueSum,
      monthAfter,
      monthCost,
      forecast: monthAfter ? (monthAfter / dayOfMonth) * daysInMonth : 0,
    };
  }

  function renderCalculator() {
    window.FinCalc?.render(calculatorApi());
  }

  function bindCalculator() {
    window.FinCalc?.bind(calculatorApi());
  }

  function renderPresentation() {
    window.FinCalc?.syncPresentValues?.(calculatorApi());
    window.FinPresent?.render(presentationApi());
  }

  function bindPresentation() {
    window.FinPresent?.bind(presentationApi());
  }

  function cloudFullscreenElement() {
    return document.fullscreenElement || document.webkitFullscreenElement || null;
  }

  function cloudFullscreenOn() {
    const board = $("cloud-board");
    const el = cloudFullscreenElement();
    return !!board && (el === board || board.contains(el));
  }

  async function toggleCloudFullscreen(force) {
    const board = $("cloud-board");
    if (!board) return;
    try {
      if (force === false || (force == null && cloudFullscreenOn())) {
        const exit = document.exitFullscreen || document.webkitExitFullscreen;
        if (exit) await exit.call(document);
      } else if (!cloudFullscreenOn()) {
        const enter = board.requestFullscreen || board.webkitRequestFullscreen;
        if (enter) await enter.call(board);
      }
    } catch {
      toast("Полноэкранный режим недоступен в этом окне");
    }
  }

  function syncCloudFullscreen() {
    const on = cloudFullscreenOn();
    $("cloud-board")?.classList.toggle("is-fullscreen", on);
    $("cloud-stage")?.classList.toggle("is-fullscreen", on);
    const fs = $("cloud-fs");
    fs?.classList.toggle("on", on);
    fs?.setAttribute("aria-pressed", String(on));
    fs?.setAttribute("title", on ? "Вернуться в окно" : "Развернуть карту");
    fs?.setAttribute("aria-label", on ? "Вернуться в окно" : "Развернуть карту");
    requestAnimationFrame(() => orderCloud?.resize?.());
  }

  function renderCatalogs() {
    const statusNames = (state.doc.statuses || []).map((s) => s.name);
    $("status-list").innerHTML = (state.doc.statuses || [])
      .map(
        (s, i) => `<div class="list-item" data-i="${i}">
        <button type="button" class="item-drag" title="Перетащить"><span></span></button>
        <input type="color" data-ck="color" value="${esc(toHex(s.color))}" />
        <input data-ck="name" value="${esc(s.name)}"${catalogNameAttrs(statusNames, s.name, i)} />
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
    const unitNames = state.doc.units || [];
    $("unit-list").innerHTML = unitNames
      .map(
        (u, i) =>
          `<div class="list-item" data-i="${i}"><button type="button" class="item-drag" title="Перетащить"><span></span></button><input data-uk value="${esc(u)}"${catalogNameAttrs(
            unitNames,
            u,
            i
          )} /><button class="btn small danger" data-uact="del">Удалить</button></div>`
      )
      .join("");
    const typeNamesList = (state.doc.order_types || []).map((t) => typeEntry(t).name);
    $("type-list").innerHTML = (state.doc.order_types || [])
      .map(typeEntry)
      .map(
        (t, i) => `<div class="list-item type-item ${t.is_tax || t.is_cost ? "is-expense" : ""}" data-i="${i}">
        <button type="button" class="item-drag" title="Перетащить"><span></span></button>
        <input data-tk value="${esc(t.name)}"${catalogNameAttrs(typeNamesList, t.name, i)} />
        <button class="btn small danger" data-tact="del">Удалить</button>
        <div class="type-flags">
          <label class="type-flag tax ${t.is_tax ? "on" : ""}" title="Строки этого типа вычитаются из суммы заказа как налог">
            <input type="checkbox" data-ck="is_tax" ${t.is_tax ? "checked" : ""} /><span>Налог</span>
          </label>
          <label class="type-flag ${t.is_cost ? "on" : ""}" title="Строки этого типа вычитаются из суммы заказа как затрата">
            <input type="checkbox" data-ck="is_cost" ${t.is_cost ? "checked" : ""} /><span>Затрата</span>
          </label>
          <span class="type-flag-note">${
            t.is_tax ? "процент можно задать в строке заказа" : t.is_cost ? "вычитается из заказа" : "обычная выручка"
          }</span>
        </div>
      </div>`
      )
      .join("");
    syncProductsFromOrders();
    const units = state.doc.units || [];
    const productNames = (state.doc.products || []).map((p) => p.name);
    $("product-catalog").innerHTML = (state.doc.products || [])
      .map((p, i) => {
        const unitOpts = unique([p.unit, ...units]);
        return `<div class="list-item" data-i="${i}"><button type="button" class="item-drag" title="Перетащить"><span></span></button><input data-pk value="${esc(p.name)}"${catalogNameAttrs(
          productNames,
          p.name,
          i
        )} /><select data-pu title="Ед. по умолчанию">${optionList(unitOpts, p.unit)}</select><input data-pp inputmode="decimal" placeholder="Цена" title="Цена по умолчанию" value="${
          p.price ? esc(formatQty(p.price)) : ""
        }" /><button class="btn small danger" data-pact="del">Удалить</button></div>`;
      })
      .join("");
  }

  function toHex(color) {
    if (!color) return "#64748b";
    if (color.startsWith("#") && color.length === 7) return color;
    return "#64748b";
  }

  function normalizeOrderTypes() {
    if (!state.doc) return;
    const seen = new Set();
    const next = [];
    for (const item of state.doc.order_types || []) {
      const entry = typeEntry(item);
      const key = catalogNameKey(entry.name);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      next.push(entry);
    }
    state.doc.order_types = next;
  }

  function renderAll() {
    if (!state.doc) return;
    normalizeOrderTypes();
    normalizeProducts();
    FinCharts.setCurrency(state.doc.currency || "₽");
    FinCharts.setMoneyDecimals?.(moneyDecimals());
    syncMoneyFmt(moneyDecimals());
    updateChrome();
    fillFilterSelects();
    if (state.view === "dashboard") renderDashboard();
    if (state.view === "orders") renderOrders();
    if (state.view === "analytics") renderAnalytics();
    if (state.view === "cashflow") renderCashflow();
    if (state.view === "calendar") renderCalendar();
    if (state.view === "calculator") renderCalculator();
    if (state.view === "presentation") renderPresentation();
    if (state.view === "cloud") renderCloud();
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
    closeProductSuggest();
    if (name !== "cloud") orderCloud?.stopTour();
    if (name !== "calculator") {
      const panel = document.getElementById("calc-present-panel");
      if (panel) panel.hidden = true;
      $("calc-present-btn")?.classList.remove("is-on");
    }
    state.view = name;
    document.querySelectorAll(".nav button").forEach((b) => b.classList.toggle("active", b.dataset.view === name));
    document.querySelectorAll(".view").forEach((v) => v.classList.toggle("active", v.id === `view-${name}`));
    if (name === "analytics" && !$("c-a-from").value && !$("c-b-from").value) {
      const now = new Date();
      const monthStart = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0);
      const prevStart = new Date(now.getFullYear(), now.getMonth() - 1, 1, 0, 0);
      const prevEnd = new Date(now.getFullYear(), now.getMonth(), 0);
      setDT("c-b-from", prevStart);
      setDT("c-b-to", prevEnd);
      setDT("c-a-from", monthStart);
      setDT("c-a-to", now);
    }
    renderAll();
    if (name === "cloud") {
      applyCloudFocus({ fly: true });
      requestAnimationFrame(() => orderCloud?.resize?.());
    }
    if (name === "calculator") requestAnimationFrame(() => renderCalculator());
    if (name === "presentation") requestAnimationFrame(() => renderPresentation());
  }

  function createNew() {
    state.doc = emptyDoc();
    persistCloudPrefs();
    persistChartPrefs();
    state.path = null;
    historyReset("Новый отчёт");
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

  function applyLoaded(res, { keepView = false, view = "" } = {}) {
    const stay = keepView && !!state.view && $("app-shell") && !$("app-shell").hidden;
    const next = view || (stay ? state.view : "dashboard");
    state.doc = res.document;
    state.path = res.path;
    state.focusOrderId = null;
    state.focusLineId = null;
    cloudState().catalog = false;
    adoptCloudFromDocument();
    adoptChartsFromDocument();
    if (res.history && Array.isArray(res.history.items) && res.history.items.length) {
      adoptHistory(res.history, res.history_limit);
    } else {
      historyReset("Открыт отчёт", { persist: !res.history?.folder });
    }
    if (res.recent) renderRecent(res.recent);
    else if (res.path) pushLocalRecent(res.path, res.document.title);
    setClean();
    showApp();
    setView(next);
    if (next === "cloud") showCloudOverview();
    remotePublish();
    toast("Отчёт открыт");
  }

  async function openPath(path, opts) {
    if (state.desktop) {
      try {
        applyLoaded(await apiPost("/api/open-path", { path }), opts);
      } catch (err) {
        toast("Не удалось открыть файл. Возможно, он перемещён.");
      }
      return;
    }
    toast("В браузерном режиме откройте файл через кнопку «Открыть».");
  }

  function restoreNewModal() {
    if ($("new-modal-title")) $("new-modal-title").textContent = "Создать новый отчёт?";
    if ($("new-modal-text")) $("new-modal-text").textContent = "Текущий файл будет закрыт. Несохранённые изменения нужно сохранить заранее.";
    if ($("new-save")) $("new-save").textContent = "Сохранить и создать";
    if ($("new-discard")) $("new-discard").textContent = "Создать без сохранения";
  }

  function confirmSwitchReport() {
    if (!state.dirty) return Promise.resolve(true);
    restoreNewModal();
    if ($("new-modal-title")) $("new-modal-title").textContent = "Отчёт не сохранён";
    if ($("new-modal-text")) $("new-modal-text").textContent = "Вы переходите в другую галактику. Сохранить текущий отчёт перед открытием?";
    if ($("new-save")) $("new-save").textContent = "Сохранить и открыть";
    if ($("new-discard")) $("new-discard").textContent = "Открыть без сохранения";
    $("new-modal").classList.add("open");
    return new Promise((resolve) => {
      unsavedWait = resolve;
    });
  }

  async function openGalaxy(data, { fromStart = false } = {}) {
    const path = data?.path;
    if (!path) return;
    const same = samePath(path, state.path) && state.doc;
    if (!fromStart && !same && state.doc && !$("app-shell")?.hidden) {
      const choice = await confirmSwitchReport();
      if (choice === "cancel" || choice === false) return;
      if (choice === "save") {
        const ok = await save();
        if (!ok) return;
      }
    }
    const engine = fromStart ? startCloud : orderCloud;
    const node = engine?.findNode?.(data.id || `galaxy:${path}`) || engine?.findNode?.(path);
    if (node && engine.flyInto) await engine.flyInto(node);
    if (same && !fromStart) {
      cloudState().catalog = false;
      renderCloud();
      setTimeout(() => orderCloud?.fit(), 40);
      return;
    }
    await openPath(path, { keepView: !fromStart && !!state.doc && !$("app-shell")?.hidden, view: "cloud" });
  }

  function applyStartView(mode) {
    const view = mode === "galaxies" ? "galaxies" : "list";
    persistStartView(view);
    $("start-inner")?.classList.toggle("is-galaxies", view === "galaxies");
    if ($("start-lists")) $("start-lists").hidden = view === "galaxies";
    if ($("start-galaxy")) $("start-galaxy").hidden = view !== "galaxies";
    $("start-view-toggle")?.querySelectorAll("[data-start-view]").forEach((btn) => {
      const on = btn.dataset.startView === view;
      btn.classList.toggle("active", on);
      btn.setAttribute("aria-selected", String(on));
    });
    if (view === "galaxies") {
      requestAnimationFrame(() => {
        renderStartGalaxies();
        startCloud?.resize();
        startCloud?.fit(false);
      });
    }
  }

  function ensureStartCloud() {
    if (startCloud || !window.FinOrderCloud || !$("start-galaxy-canvas")) return startCloud;
    startCloud = window.FinOrderCloud.create({
      canvas: $("start-galaxy-canvas"),
      onHover: (node, point) => {
        const tip = $("start-galaxy-tip");
        if (!tip) return;
        if (!node || !point) {
          tip.hidden = true;
          return;
        }
        tip.innerHTML = `<b>${esc(node.label)}</b><span>${node.origin === "recent" ? "недавний файл" : "папка FinMaster"}</span>`;
        tip.hidden = false;
        const wrap = $("start-galaxy").getBoundingClientRect();
        const tw = tip.offsetWidth || 200;
        const th = tip.offsetHeight || 48;
        tip.style.left = `${Math.max(10, Math.min(wrap.width - tw - 10, point.x + 16))}px`;
        tip.style.top = `${Math.max(10, Math.min(wrap.height - th - 10, point.y + 16))}px`;
      },
      onSelect: () => {},
      onOpen: (node) => {
        if (node?.kind === "galaxy") openGalaxy(node, { fromStart: true });
      },
    });
    startCloud.setOptions({ catalog: true, labels: true, motion: true, heat: false, space3d: true, openOnClick: true });
    return startCloud;
  }

  function renderStartGalaxies() {
    const engine = ensureStartCloud();
    engine?.update(galaxyGraphData(), {
      catalog: true,
      labels: true,
      motion: true,
      heat: false,
      space3d: true,
      query: "",
      openOnClick: true,
    });
  }

  function showGalaxyCatalog() {
    cloudState().catalog = true;
    if ($("app-shell")?.hidden || !state.doc) {
      applyStartView("galaxies");
      return;
    }
    if (state.view !== "cloud") setView("cloud");
    else renderCloud();
    setTimeout(() => orderCloud?.fit(), 80);
  }

  async function save({ as = false, silent = false } = {}) {
    if (!state.doc) return false;
    persistCloudPrefs();
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
        const res = await apiPost("/api/write", { path, document: state.doc, history: historyDiskPayload() });
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
    const head = ["Номер", "Заказчик", "Название", "Начало работ", "Конец работ", "Тип", "Вид", "Продукт", "Количество", "Ед", "Цена", "Скидка%", "Итог", "Расход", "Оплачено", "Не оплачено", "Дата заказа", "Дата оплаты", "Статус"];
    const lines = [head.join(";")];
    rows.forEach(({ order, line, totals }) => {
      const vals = [
        order.number,
        order.customer,
        order.name,
        dateDay(order.work_start),
        dateDay(order.work_end),
        line.order_type,
        kindLabel(totals.kind) || "доход",
        line.product,
        totals.mode === "amount" ? line.quantity : `${totals.percent} %`,
        totals.mode === "amount" ? line.unit : "",
        totals.mode === "amount" ? totals.total : totals.base,
        totals.expense ? "" : line.discount,
        totals.expense ? "" : totals.after,
        totals.expense ? totals.cost : "",
        totals.expense ? "" : totals.paid,
        totals.expense ? "" : totals.unpaid,
        line.order_date ? dateDay(line.order_date) : "",
        totals.expense ? "" : line.payment_date ? dateDay(line.payment_date) : "",
        totals.expense ? kindLabel(totals.kind) : line.status,
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

  function fileStamp(value) {
    return String(value || "").replace("T", " ").slice(0, 19);
  }

  function renderRecentItems(items) {
    const box = $("recent-list");
    if (!box) return;
    if (!items.length) {
      box.innerHTML = `<div class="recent-item missing"><div>Пока нет недавних отчётов</div></div>`;
      return;
    }
    box.innerHTML = items
      .map((item) => {
        const missing = item.exists === false;
        const date = fileStamp(item.opened_at);
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

  function renderLibrary(lib) {
    const box = $("library-list");
    const pathEl = $("library-path");
    const openBtn = $("btn-open-library");
    if (!box) return;
    if (!lib) {
      if (pathEl) pathEl.textContent = "";
      if (openBtn) openBtn.hidden = true;
      box.innerHTML = `<div class="recent-item missing"><div>Папка отчётов доступна в программе на компьютере</div></div>`;
      return;
    }
    if (pathEl) pathEl.textContent = lib.path || "";
    if (openBtn) openBtn.hidden = !state.desktop;
    const items = lib.items || [];
    if (!items.length) {
      box.innerHTML = `<div class="recent-item missing"><div>Пока пусто — новые отчёты появятся здесь</div></div>`;
      return;
    }
    box.innerHTML = items
      .map((item) => {
        const date = fileStamp(item.modified_at);
        return `<div class="recent-item" data-path="${esc(item.path)}">
          <div><b>${esc(item.title || item.name || item.path)}</b><div class="meta">${esc(item.name || item.path)}</div></div>
          <div class="recent-side">
            <div class="meta">${esc(date)}</div>
            <button type="button" class="recent-remove" data-library-delete title="Удалить отчёт в корзину">✕</button>
          </div>
        </div>`;
      })
      .join("");
  }

  async function renderStartLists(data) {
    let payload = data;
    if (!payload) {
      if (state.desktop) {
        try {
          payload = await apiGet("/api/bootstrap");
          state.autosave = !!payload.autosave;
          if (payload.history_limit) history.limit = clampHistoryLimit(payload.history_limit);
        } catch {
          payload = {};
        }
      } else {
        state.recentItems = localRecent();
        state.library = null;
        renderRecentItems(state.recentItems);
        renderLibrary(null);
        applyStartView(startViewMode());
        return;
      }
    }
    state.recentItems = payload.recent || [];
    state.library = payload.library || null;
    state.listsSig = fileListsSig(state.library, state.recentItems);
    renderRecentItems(state.recentItems);
    renderLibrary(state.library);
    applyStartView(startViewMode());
  }

  async function renderRecent(list) {
    if (list) {
      state.recentItems = list;
      renderRecentItems(list);
      if (cloudState().catalog && state.view === "cloud") renderGalaxyCloud();
      if ($("start-screen") && !$("start-screen").classList.contains("hidden") && startViewMode() === "galaxies") renderStartGalaxies();
      return;
    }
    await renderStartLists();
  }

  async function askClose() {
    await flushPendingSaves();
    if (!state.dirty) {
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
      if (state.desktop) {
        try {
          await apiPost("/api/quit", {});
        } catch {
          window.close();
        }
      } else {
        window.close();
      }
      return;
    }
    $("close-modal").classList.add("open");
  }

  let confirmWait = null;

  function closeConfirm(ok) {
    $("confirm-modal")?.classList.remove("open");
    const wait = confirmWait;
    confirmWait = null;
    wait?.(!!ok);
  }

  function askConfirm({ title, text, ok = "Продолжить", cancel = "Отмена", danger = false } = {}) {
    closeConfirm(false);
    return new Promise((resolve) => {
      confirmWait = resolve;
      const titleEl = $("confirm-title");
      const textEl = $("confirm-text");
      const okBtn = $("confirm-ok");
      const cancelBtn = $("confirm-cancel");
      if (titleEl) titleEl.textContent = title || "Подтверждение";
      if (textEl) textEl.textContent = text || "";
      if (okBtn) {
        okBtn.textContent = ok;
        okBtn.className = danger ? "btn danger" : "btn primary";
      }
      if (cancelBtn) cancelBtn.textContent = cancel;
      $("confirm-modal")?.classList.add("open");
      queueMicrotask(() => okBtn?.focus());
    });
  }

  function typeKindWarning(name, prevKind, nextKind) {
    const label = name || "этот тип";
    if (!prevKind && nextKind) {
      return {
        title: "Отметить тип как расход?",
        text: `Тип «${label}» станет ${nextKind === "tax" ? "налогом" : "затратой"}. Строки с этим типом в заказах перейдут в расходы и будут вычитаться из суммы.`,
      };
    }
    if (prevKind && !nextKind) {
      return {
        title: "Снять пометку с типа?",
        text: `Тип «${label}» снова станет обычной выручкой. Строки в заказах выйдут из блока расходов.`,
      };
    }
    return {
      title: "Изменить вид типа?",
      text: `Тип «${label}» станет ${nextKind === "tax" ? "налогом" : "затратой"} вместо ${
        prevKind === "tax" ? "налога" : "затраты"
      }. Строки этого типа в заказах изменятся.`,
    };
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

  function closeFileMenu() {
    const menu = $("file-menu");
    const btn = $("btn-file-menu");
    if (menu) menu.hidden = true;
    btn?.setAttribute("aria-expanded", "false");
  }

  function bindFileMenu() {
    const btn = $("btn-file-menu");
    const menu = $("file-menu");
    if (!btn || !menu) return;
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const open = menu.hidden;
      menu.hidden = !open;
      btn.setAttribute("aria-expanded", String(open));
    });
    menu.addEventListener("click", (e) => {
      if (e.target.closest("button")) closeFileMenu();
    });
    document.addEventListener("click", (e) => {
      if (menu.hidden) return;
      if (e.target.closest("#file-menu") || e.target.closest("#btn-file-menu")) return;
      closeFileMenu();
    });
  }

  function bind() {
    applyTheme(localStorage.getItem(LS_THEME) || currentTheme(), false);
    $("nav").addEventListener("click", (e) => {
      const btn = e.target.closest("button[data-view]");
      if (btn) setView(btn.dataset.view);
    });
    bindCashflow();
    bindCalendar();
    bindFileMenu();
    bindCloud();
    bindCalculator();
    bindPresentation();
    bindSearchClears();
    $("global-search").addEventListener("input", (e) => {
      state.search = e.target.value;
      syncSearchClear(e.target);
      renderAll();
    });
    $("report-title").addEventListener("input", (e) => {
      if (!state.doc) return;
      state.doc.title = e.target.value;
      markDirty();
    });
    $("btn-report-settings")?.addEventListener("click", () => openReportSettings());
    $("report-settings-close")?.addEventListener("click", () => closeReportSettings());
    $("report-settings-modal")?.addEventListener("click", (e) => {
      if (e.target === $("report-settings-modal")) closeReportSettings();
    });
    $("report-currency")?.addEventListener("input", (e) => {
      setCurrency(e.target.value, { refresh: false });
    });
    $("report-currency")?.addEventListener("change", (e) => {
      setCurrency(e.target.value, { refresh: true });
    });
    document.querySelector(".report-currency-presets")?.addEventListener("click", (e) => {
      const chip = e.target.closest("[data-currency]");
      if (!chip) return;
      setCurrency(chip.dataset.currency, { refresh: true });
    });
    document.querySelector(".report-decimals-presets")?.addEventListener("click", (e) => {
      const chip = e.target.closest("[data-decimals]");
      if (!chip) return;
      setMoneyDecimals(chip.dataset.decimals, { refresh: true });
    });
    $("btn-add-order").addEventListener("click", () => {
      state.doc.orders.push(emptyOrder());
      markDirty();
      setView("orders");
    });
    $("btn-share-many").addEventListener("click", () => openShare(null));
    $("dash-focus")?.addEventListener("click", (e) => {
      if (e.target.closest("#focus-clear")) {
        state.remoteStats = null;
        setFocusOrder(null);
      } else if (e.target.closest("#focus-open")) {
        const id = state.focusOrderId;
        state.focusOrderId = null;
        state.focusLineId = null;
        if (id) gotoOrder(id);
      }
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
    $("orders-list").addEventListener("contextmenu", onLineContextMenu);
    $("orders-list").addEventListener("keydown", onOrderKeydown);
    document.addEventListener("click", (e) => {
      if (!e.target.closest("#line-menu")) closeLineMenu();
    });
    $("line-menu-freeze")?.addEventListener("click", (e) => {
      e.preventDefault();
      toggleLineFrozen();
    });
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") closeLineMenu();
    });
    $("orders-list").addEventListener("focusin", (e) => {
      const kind = suggestKindOf(e.target);
      if (kind) openTextSuggest(e.target, kind, "browse");
    });
    $("orders-list").addEventListener("focusout", (e) => {
      if (!suggestKindOf(e.target)) return;
      requestAnimationFrame(() => {
        if (document.activeElement === textSuggest.input) return;
        if (($("text-suggest") || $("product-suggest"))?.contains(document.activeElement)) return;
        closeTextSuggest();
      });
    });
    $("orders-list").addEventListener("mousedown", (e) => {
      const input = e.target.closest?.("input[data-suggest], input[data-lk='product'], input[data-k='customer']");
      if (!input || !suggestKindOf(input)) return;
      if (document.activeElement === input) {
        requestAnimationFrame(() => openTextSuggest(input, suggestKindOf(input), "browse"));
      }
    });
    const suggestBox = () => suggestBoxEl();
    suggestBox()?.addEventListener("mousedown", (e) => {
      const btn = e.target.closest("[data-i]");
      if (!btn) return;
      e.preventDefault();
      const item = textSuggest.items[Number(btn.dataset.i)];
      if (item != null) pickTextSuggest(item);
    });
    window.addEventListener("scroll", () => {
      if (textSuggest.input || textSuggest.selectEl) positionTextSuggest();
    }, true);
    window.addEventListener("resize", () => {
      if (textSuggest.input || textSuggest.selectEl) positionTextSuggest();
    });
    document.addEventListener(
      "mousedown",
      (e) => {
        if (e.button !== 0) return;
        const sel = e.target.closest?.("select");
        if (sel && !sel.disabled && !sel.multiple) {
          e.preventDefault();
          openSelectSuggest(sel);
          return;
        }
        if (!textSuggestOpen()) return;
        if (suggestBox()?.contains(e.target)) return;
        if (textSuggest.selectEl && e.target === textSuggest.selectEl) return;
        if (textSuggest.input && (e.target === textSuggest.input || textSuggest.input.contains?.(e.target))) return;
        closeTextSuggest();
      },
      true
    );
    document.addEventListener("focusin", (e) => {
      if (e.target.closest?.("#orders-list")) return;
      const kind = suggestKindOf(e.target);
      if (!kind) return;
      openTextSuggest(e.target, kind, "browse");
    });
    document.addEventListener("focusout", (e) => {
      if (e.target.closest?.("#orders-list")) return;
      if (e.target?.tagName === "SELECT") {
        requestAnimationFrame(() => {
          if (suggestBox()?.contains(document.activeElement)) return;
          if (document.activeElement === textSuggest.selectEl) return;
          if (textSuggest.kind === "select") closeTextSuggest();
        });
        return;
      }
      if (!suggestKindOf(e.target)) return;
      requestAnimationFrame(() => {
        if (document.activeElement === textSuggest.input) return;
        if (suggestBox()?.contains(document.activeElement)) return;
        closeTextSuggest();
      });
    });
    document.addEventListener("mousedown", (e) => {
      if (e.target.closest?.("#orders-list")) return;
      const input = e.target.closest?.("input[data-suggest], #f-customer, #f-product, input[data-filter-field='customer']");
      if (!input || !suggestKindOf(input)) return;
      if (document.activeElement === input) {
        requestAnimationFrame(() => openTextSuggest(input, suggestKindOf(input), "browse"));
      }
    });
    document.addEventListener("input", (e) => {
      if (textSuggest.picking) return;
      const kind = suggestKindOf(e.target);
      if (!kind) return;
      if (e.target.closest?.("#orders-list") && e.target.dataset?.lk === "product") return;
      openTextSuggest(e.target, kind, "filter");
    });
    document.addEventListener("keydown", (e) => {
      if (e.target?.tagName === "SELECT") {
        bindTextSuggestKeys(e);
        return;
      }
      if (e.target.closest?.("#orders-list")) return;
      bindTextSuggestKeys(e);
    });
    $("order-filter")?.addEventListener("click", (e) => {
      if (e.target.closest("#btn-order-filter")) {
        const menu = $("order-filter-menu");
        const btn = $("btn-order-filter");
        if (!menu) return;
        const open = menu.hidden;
        menu.hidden = !open;
        btn?.setAttribute("aria-expanded", String(open));
        return;
      }
      const item = e.target.closest("[data-order-filter]");
      if (!item) return;
      state.orderFilter = item.dataset.orderFilter || "all";
      renderOrders();
    });
    document.addEventListener("click", (e) => {
      if (e.target.closest("#order-filter")) return;
      closeOrderFilter();
    });
    $("btn-undo").addEventListener("click", undo);
    $("btn-redo").addEventListener("click", redo);
    $("btn-history")?.addEventListener("click", (e) => {
      e.stopPropagation();
      const panel = $("history-panel");
      toggleHistoryPanel(panel?.hidden);
    });
    $("history-panel")?.addEventListener("click", (e) => {
      e.stopPropagation();
      if (e.target.closest("#btn-history-manage")) {
        openHistoryLibrary();
        return;
      }
      const item = e.target.closest("[data-history-id]");
      if (item) historyJump(item.dataset.historyId);
    });
    $("history-limit")?.addEventListener("change", (e) => {
      setHistoryLimit(e.target.value);
    });
    $("history-modal-close")?.addEventListener("click", () => $("history-modal")?.classList.remove("open"));
    $("history-modal")?.addEventListener("click", (e) => {
      if (e.target === $("history-modal")) $("history-modal")?.classList.remove("open");
    });
    $("history-modal-list")?.addEventListener("click", (e) => {
      const btn = e.target.closest("[data-hist-del]");
      if (btn) deleteHistoryFolder(btn.dataset.histDel);
    });
    document.addEventListener("click", (e) => {
      if (e.target.closest("#history-pop") || e.target.closest("#history-panel") || e.target.closest("#history-modal")) return;
      toggleHistoryPanel(false);
    });
    window.addEventListener("resize", placeHistoryPanel);
    window.addEventListener("scroll", placeHistoryPanel, true);
    $("btn-command").addEventListener("click", openPalette);
    $("btn-fullscreen")?.addEventListener("click", () => toggleAppFullscreen());
    document.addEventListener("fullscreenchange", () => {
      if (state.desktop || cloudFullscreenOn()) return;
      syncAppFullscreen(pageFullscreenOn());
    });
    document.addEventListener("webkitfullscreenchange", () => {
      if (state.desktop || cloudFullscreenOn()) return;
      syncAppFullscreen(pageFullscreenOn());
    });
    $("btn-help").addEventListener("click", openHelp);
    $("help-close").addEventListener("click", () => $("help-modal").classList.remove("open"));
    $("help-modal").addEventListener("click", (e) => {
      if (e.target === $("help-modal")) $("help-modal").classList.remove("open");
    });
    $("palette").addEventListener("click", (e) => {
      if (e.target === $("palette")) closePalette();
      const item = e.target.closest("[data-pi]");
      if (item) paletteRun(Number(item.dataset.pi));
    });
    $("palette-input").addEventListener("input", (e) => renderPaletteList(e.target.value));
    $("palette-input").addEventListener("keydown", (e) => {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        paletteMove(1);
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        paletteMove(-1);
      } else if (e.key === "Enter") {
        e.preventDefault();
        paletteRun(palette.index);
      } else if (e.key === "Escape") {
        e.preventDefault();
        closePalette();
      }
    });
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
        renderOrders();
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
      if (!s) return;
      if (e.target.dataset.ck === "name") {
        const names = (state.doc.statuses || []).map((x) => x.name);
        const accepted = tryCatalogName(e.target, names, i);
        if (accepted == null) return;
        const prev = s.name;
        s.name = accepted;
        renameCatalogValue("status", prev, s.name);
        markDirty();
        return;
      }
      if (e.target.dataset.ck === "color") s.color = e.target.value;
      markDirty();
    });
    $("status-list").addEventListener("focusout", (e) => {
      if (e.target.dataset.ck !== "name") return;
      const i = Number(e.target.closest(".list-item")?.dataset.i);
      const s = state.doc.statuses?.[i];
      if (!s) return;
      const names = (state.doc.statuses || []).map((x) => x.name);
      const next = finishCatalogName(e.target, names, i, s.name);
      if (next == null || next === s.name) return;
      const prev = s.name;
      s.name = next;
      renameCatalogValue("status", prev, s.name);
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
        historyCommit();
        state.doc.statuses.splice(i, 1);
        markDirty();
        renderCatalogs();
        undoToast("Статус удалён");
      }
    });
    $("btn-add-status").addEventListener("click", () => {
      const names = (state.doc.statuses || []).map((x) => x.name);
      state.doc.statuses.push({
        id: uid(),
        name: uniqueCatalogName(names, "Новый статус"),
        color: "#64748b",
        is_paid: false,
        locked: false,
      });
      markDirty();
      renderCatalogs();
    });
    $("unit-list").addEventListener("input", (e) => {
      const i = Number(e.target.closest(".list-item").dataset.i);
      if (!e.target.hasAttribute("data-uk")) return;
      const names = state.doc.units || [];
      const accepted = tryCatalogName(e.target, names, i);
      if (accepted == null) return;
      const prev = state.doc.units[i];
      state.doc.units[i] = accepted;
      renameCatalogValue("unit", prev, accepted);
      (state.doc.products || []).forEach((p) => {
        if (p.unit === prev) p.unit = accepted;
      });
      markDirty();
    });
    $("unit-list").addEventListener("focusout", (e) => {
      if (!e.target.hasAttribute("data-uk")) return;
      const i = Number(e.target.closest(".list-item")?.dataset.i);
      if (!Number.isFinite(i) || !state.doc.units?.[i]) return;
      const next = finishCatalogName(e.target, state.doc.units, i, state.doc.units[i]);
      if (next == null || next === state.doc.units[i]) return;
      const prev = state.doc.units[i];
      state.doc.units[i] = next;
      renameCatalogValue("unit", prev, next);
      (state.doc.products || []).forEach((p) => {
        if (p.unit === prev) p.unit = next;
      });
      markDirty();
    });
    $("unit-list").addEventListener("click", (e) => {
      if (e.target.dataset.uact === "del") {
        historyCommit();
        state.doc.units.splice(Number(e.target.closest(".list-item").dataset.i), 1);
        markDirty();
        renderCatalogs();
        undoToast("Единица измерения удалена");
      }
    });
    $("btn-add-unit").addEventListener("click", () => {
      state.doc.units.push(uniqueCatalogName(state.doc.units || [], "ед."));
      markDirty();
      renderCatalogs();
    });
    $("type-list").addEventListener("focusin", (e) => {
      if (e.target.hasAttribute("data-tk")) e.target.dataset.old = e.target.value;
    });
    $("type-list").addEventListener("input", (e) => {
      if (!e.target.hasAttribute("data-tk")) return;
      const i = Number(e.target.closest(".list-item").dataset.i);
      const names = (state.doc.order_types || []).map((t) => typeEntry(t).name);
      const accepted = tryCatalogName(e.target, names, i);
      if (accepted == null) return;
      const entry = typeEntry(state.doc.order_types[i]);
      const prev = e.target.dataset.old ?? entry.name;
      entry.name = accepted;
      state.doc.order_types[i] = entry;
      if (prev && prev !== entry.name) {
        renameCatalogValue("order_type", prev, entry.name);
        e.target.dataset.old = entry.name;
      }
      markDirty();
    });
    $("type-list").addEventListener("focusout", (e) => {
      if (!e.target.hasAttribute("data-tk")) return;
      const i = Number(e.target.closest(".list-item")?.dataset.i);
      const current = state.doc.order_types?.[i];
      if (current == null) return;
      const saved = typeEntry(current).name;
      const names = (state.doc.order_types || []).map((t) => typeEntry(t).name);
      const next = finishCatalogName(e.target, names, i, saved);
      if (next == null || next === saved) return;
      const entry = typeEntry(current);
      entry.name = next;
      state.doc.order_types[i] = entry;
      renameCatalogValue("order_type", saved, next);
      e.target.dataset.old = next;
      markDirty();
    });
    $("type-list").addEventListener("change", async (e) => {
      const key = e.target.dataset.ck;
      if (key !== "is_tax" && key !== "is_cost") return;
      const i = Number(e.target.closest(".list-item").dataset.i);
      const entry = typeEntry(state.doc.order_types[i]);
      const prevKind = entry.is_tax ? "tax" : entry.is_cost ? "cost" : "";
      const nextKind = e.target.checked ? (key === "is_tax" ? "tax" : "cost") : "";
      if (prevKind === nextKind) return;
      e.target.checked = !e.target.checked;
      const warn = typeKindWarning(entry.name, prevKind, nextKind);
      const ok = await askConfirm({ title: warn.title, text: warn.text, ok: "Изменить" });
      if (!ok) return;
      entry.is_tax = nextKind === "tax";
      entry.is_cost = nextKind === "cost";
      state.doc.order_types[i] = entry;
      (state.doc.orders || []).forEach((order) =>
        (order.lines || []).forEach((line) => {
          if (line.order_type !== entry.name) return;
          line.tax_mode = nextKind === "tax" ? "gross" : "amount";
        })
      );
      markDirty();
      renderAll();
    });
    $("type-list").addEventListener("click", (e) => {
      if (e.target.dataset.tact === "del") {
        historyCommit();
        state.doc.order_types.splice(Number(e.target.closest(".list-item").dataset.i), 1);
        markDirty();
        renderCatalogs();
        undoToast("Тип заказа удалён");
      }
    });
    $("btn-add-type").addEventListener("click", () => {
      const names = (state.doc.order_types || []).map((t) => typeEntry(t).name);
      state.doc.order_types.push({ id: uid(), name: uniqueCatalogName(names, "Новый тип"), is_tax: false, is_cost: false });
      markDirty();
      renderCatalogs();
    });
    $("product-catalog").addEventListener("focusin", (e) => {
      if (e.target.hasAttribute("data-pk")) e.target.dataset.old = e.target.value;
    });
    $("product-catalog").addEventListener("input", (e) => {
      const row = e.target.closest(".list-item");
      if (!row) return;
      const i = Number(row.dataset.i);
      const item = state.doc.products[i];
      if (!item) return;
      if (e.target.hasAttribute("data-pk")) {
        const names = (state.doc.products || []).map((p) => p.name);
        const accepted = tryCatalogName(e.target, names, i);
        if (accepted == null) return;
        const old = e.target.dataset.old || item.name;
        item.name = accepted;
        renameProduct(old, accepted);
        e.target.dataset.old = accepted;
        markDirty();
        return;
      }
      if (e.target.hasAttribute("data-pu")) {
        item.unit = e.target.value;
        markDirty();
        return;
      }
      if (e.target.hasAttribute("data-pp")) {
        const raw = String(e.target.value || "").replaceAll(",", ".");
        if (raw !== e.target.value) e.target.value = raw;
        const v = evalExpr(raw);
        e.target.classList.toggle("invalid", raw.trim() !== "" && !Number.isFinite(v));
        item.price = Number.isFinite(v) ? Math.max(0, round2(v)) : 0;
        markDirty();
      }
    });
    $("product-catalog").addEventListener("focusout", (e) => {
      if (!e.target.hasAttribute("data-pk")) return;
      const i = Number(e.target.closest(".list-item")?.dataset.i);
      const item = state.doc.products?.[i];
      if (!item) return;
      const names = (state.doc.products || []).map((p) => p.name);
      const next = finishCatalogName(e.target, names, i, item.name);
      if (next == null || next === item.name) return;
      const old = item.name;
      item.name = next;
      renameProduct(old, next);
      e.target.dataset.old = next;
      markDirty();
    });
    $("product-catalog").addEventListener("change", (e) => {
      const i = Number(e.target.closest(".list-item")?.dataset.i);
      const item = state.doc.products?.[i];
      if (!item) return;
      if (e.target.hasAttribute("data-pu")) {
        item.unit = e.target.value;
        markDirty();
      }
      if (e.target.hasAttribute("data-pp")) {
        const raw = String(e.target.value || "").replaceAll(",", ".").trim();
        const v = evalExpr(raw);
        item.price = Number.isFinite(v) ? Math.max(0, round2(v)) : 0;
        e.target.value = item.price ? formatQty(item.price) : "";
        e.target.classList.remove("invalid");
        markDirty();
      }
    });
    $("product-catalog").addEventListener("click", (e) => {
      if (e.target.closest("[data-pact='del']")) {
        historyCommit();
        state.doc.products.splice(Number(e.target.closest(".list-item").dataset.i), 1);
        markDirty();
        renderCatalogs();
        undoToast("Продукт удалён из справочника");
      }
    });
    $("btn-add-product").addEventListener("click", () => {
      const list = state.doc.products || (state.doc.products = []);
      list.push({
        name: uniqueCatalogName(list.map((p) => p.name), "Новый продукт"),
        unit: (state.doc.units || [])[0] || "шт.",
        price: 0,
      });
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
        if (old && old !== c.name) renameCatalogValue("customer", old, c.name);
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
      historyCommit();
      const gone = (state.doc.customers || []).find((x) => x.id === row.dataset.cid);
      state.doc.customers = (state.doc.customers || []).filter((x) => x.id !== row.dataset.cid);
      markDirty();
      renderCustomers();
      undoToast(`Заказчик ${gone?.name || ""} убран из справочника`.replace(/\s+/g, " ").trim());
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
      setDT("f-from", new Date(d.getFullYear(), d.getMonth(), d.getDate()));
      setDT("f-to", new Date(d.getFullYear(), d.getMonth(), d.getDate()));
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

    document.addEventListener("click", (e) => {
      const btn = e.target.closest("[data-line-series]");
      if (!btn || !state.doc) return;
      const id = btn.dataset.lineSeries;
      const chart = LINE_CHARTS.includes(btn.dataset.lineChart) ? btn.dataset.lineChart : "dash";
      const on = lineSeriesOn(chart);
      const next = !on[id];
      if (!next && LINE_METRICS.every((m) => (m.id === id ? false : on[m.id]))) return;
      chartPrefs.series[chart] = { ...on, [id]: next };
      persistChartPrefs();
      if (chart === "analytics") paintTrendLine($("chart-an-line"), analyticsRows(), $("f-group").value, $("f-date-field").value);
      else paintTrendLine($("chart-dash-line"), dashRows(), "day", "order_date", 14);
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
    $("share-themes").addEventListener("click", (e) => {
      const btn = e.target.closest("[data-share-theme]");
      if (!btn) return;
      ensureUi().share_theme = btn.dataset.shareTheme;
      markDirty();
      renderShareThemes();
      renderSharePreview();
    });
    $("share-title").addEventListener("input", renderSharePreview);
    $("share-modal").addEventListener("click", (e) => {
      const head = e.target.closest("[data-share-fold]");
      if (!head) return;
      const fold = head.closest(".share-fold");
      if (!fold) return;
      const open = fold.classList.toggle("collapsed") === false;
      const ico = fold.querySelector(".share-fold-ico");
      if (ico) ico.textContent = open ? "▾" : "▸";
    });
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
    $("share-copy-text").addEventListener("click", copyShareText);
    $("share-copy").addEventListener("click", copySharePng);
    $("share-save").addEventListener("click", saveSharePng);
    $("btn-open-library")?.addEventListener("click", async () => {
      try {
        await apiPost("/api/open-folder", {});
      } catch (err) {
        toast(String(err.message || "Не удалось открыть папку"));
      }
    });
    $("start-view-toggle")?.addEventListener("click", (e) => {
      const btn = e.target.closest("[data-start-view]");
      if (btn) applyStartView(btn.dataset.startView);
    });
    $("library-list")?.addEventListener("click", (e) => {
      const del = e.target.closest("[data-library-delete]");
      if (del) {
        e.preventDefault();
        e.stopPropagation();
        const row = del.closest(".recent-item");
        if (row?.dataset.path) deleteLibraryFile(row.dataset.path);
        return;
      }
      const item = e.target.closest(".recent-item");
      if (!item || item.classList.contains("missing") || !item.dataset.path) return;
      openPath(item.dataset.path);
    });
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
        adoptCloudFromDocument();
        adoptChartsFromDocument();
        historyReset("Открыт отчёт");
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

    $("new-cancel").addEventListener("click", () => {
      $("new-modal").classList.remove("open");
      if (unsavedWait) {
        const done = unsavedWait;
        unsavedWait = null;
        restoreNewModal();
        done("cancel");
      }
    });
    $("new-modal")?.addEventListener("click", (e) => {
      if (e.target === $("new-modal")) $("new-cancel").click();
    });
    $("new-discard").addEventListener("click", async () => {
      $("new-modal").classList.remove("open");
      if (unsavedWait) {
        const done = unsavedWait;
        unsavedWait = null;
        restoreNewModal();
        done("discard");
        return;
      }
      await createNew();
    });
    $("new-save").addEventListener("click", async () => {
      $("new-modal").classList.remove("open");
      if (unsavedWait) {
        const done = unsavedWait;
        unsavedWait = null;
        restoreNewModal();
        done("save");
        return;
      }
      const ok = await save();
      if (ok) await createNew();
    });
    $("confirm-cancel")?.addEventListener("click", () => closeConfirm(false));
    $("confirm-ok")?.addEventListener("click", () => closeConfirm(true));
    $("confirm-modal")?.addEventListener("click", (e) => {
      if (e.target === $("confirm-modal")) closeConfirm(false);
    });

    document.addEventListener("keydown", (e) => {
      const ctrl = e.ctrlKey || e.metaKey;
      const code = e.code;
      if (e.key === "F1") {
        e.preventDefault();
        openHelp();
        return;
      }
      if (e.key === "F11") {
        e.preventDefault();
        toggleAppFullscreen();
        return;
      }
      if (e.key === "Escape") {
        if (cloudFullscreenOn()) {
          e.preventDefault();
          toggleCloudFullscreen(false);
          return;
        }
        if (state.appFullscreen) {
          e.preventDefault();
          toggleAppFullscreen(false);
          return;
        }
        if (productSuggestOpen()) {
          e.preventDefault();
          closeProductSuggest();
          return;
        }
        if (netConsoleOpen()) {
          e.preventDefault();
          closeNetConsole();
          return;
        }
        if (paletteIsOpen()) {
          closePalette();
          return;
        }
        if ($("confirm-modal")?.classList.contains("open")) {
          e.preventDefault();
          closeConfirm(false);
          return;
        }
        if ($("help-modal").classList.contains("open")) $("help-modal").classList.remove("open");
        if ($("report-settings-modal")?.classList.contains("open")) {
          e.preventDefault();
          closeReportSettings();
          return;
        }
        if ($("device-info-modal")?.classList.contains("open")) {
          $("device-info-modal").classList.remove("open");
          return;
        }
        if ($("remote-guide-modal")?.classList.contains("open")) {
          $("remote-guide-modal").classList.remove("open");
          return;
        }
        if ($("remote-modal").classList.contains("open")) $("remote-modal").classList.remove("open");
        if (!$("file-menu")?.hidden) {
          e.preventDefault();
          closeFileMenu();
          return;
        }
        if ($("cal-filter-menu") && !$("cal-filter-menu").hidden) {
          e.preventDefault();
          closeCalMenus();
          return;
        }
        if ($("cal-weekend-menu") && !$("cal-weekend-menu").hidden) {
          e.preventDefault();
          closeCalMenus();
          return;
        }
      }
      if (state.view === "cloud" && e.key === "/" && !/^(INPUT|SELECT|TEXTAREA)$/.test(e.target.tagName)) {
        e.preventDefault();
        $("cloud-search")?.focus();
        return;
      }
      if (state.view === "calendar" && !ctrl && !/^(INPUT|SELECT|TEXTAREA)$/.test(e.target.tagName)) {
        if (e.key === "ArrowLeft") {
          e.preventDefault();
          calendarShift(-1, e.shiftKey && calendarState().mode === "classic" ? "year" : "period");
          return;
        }
        if (e.key === "ArrowRight") {
          e.preventDefault();
          calendarShift(1, e.shiftKey && calendarState().mode === "classic" ? "year" : "period");
          return;
        }
        if (e.key === "t" || e.key === "T") {
          e.preventDefault();
          goTimelineToday();
          renderCalendar();
          return;
        }
        if (e.key === "Enter" && calendarState().selected) {
          e.preventDefault();
          gotoOrder(calendarState().selected);
          return;
        }
        if (e.key === "1" || e.key === "2" || e.key === "3") {
          e.preventDefault();
          calendarState().mode = CALENDAR_MODES[Number(e.key) - 1];
          persistCalendar();
          markDirty();
          renderCalendar();
          return;
        }
      }
      if (!ctrl) return;
      if (code === "KeyK" || (e.shiftKey && code === "KeyP")) {
        e.preventDefault();
        paletteIsOpen() ? closePalette() : openPalette();
        return;
      }
      if (code === "Backquote" || e.key === "`" || e.key === "ё" || e.key === "Ё") {
        e.preventDefault();
        toggleNetConsole();
        return;
      }
      if (code === "KeyS") {
        e.preventDefault();
        save({ as: e.shiftKey });
        return;
      }
      if (code === "KeyO") {
        e.preventDefault();
        maybeOpen(openFromDialog);
        return;
      }
      if (code === "KeyN") {
        e.preventDefault();
        onNew();
        return;
      }
      if (code === "KeyF") {
        e.preventDefault();
        if (!$("app-shell").hidden) {
          $("global-search").focus();
          $("global-search").select();
        }
        return;
      }
      if (code === "KeyZ" && !e.shiftKey) {
        if (paletteIsOpen()) return;
        e.preventDefault();
        undo();
        return;
      }
      if (code === "KeyY" || (code === "KeyZ" && e.shiftKey)) {
        if (paletteIsOpen()) return;
        e.preventDefault();
        redo();
      }
    });

    window.addEventListener("resize", () => {
      if (state.doc && (state.view === "dashboard" || state.view === "analytics" || state.view === "cloud")) renderAll();
    });
  }

  function setDT(id, date) {
    const p = (n) => String(n).padStart(2, "0");
    $(id).value = `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())}`;
  }

  function onNew() {
    if (state.dirty) {
      restoreNewModal();
      $("new-modal").classList.add("open");
    }
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
          if (isFrozenLine(line) || isExpenseLine(line)) return;
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
          if (isFrozenLine(line) || isExpenseLine(line)) return;
          if (g === "status" && statusLocked(line.status)) return;
          line[g] = e.target.value;
        });
        markDirty();
      } else if (g === "order_date" || g === "payment_date") {
        if (e.type !== "change" || !e.target.value) return;
        (order.lines || []).forEach((line) => {
          if (isFrozenLine(line)) return;
          if (g === "payment_date" && isExpenseLine(line)) return;
          line[g] = e.target.value;
        });
        markDirty();
      }
      renderOrders();
      return;
    }
    if (e.target.dataset.k) {
      order[e.target.dataset.k] = e.target.value;
      if (e.target.dataset.k === "notes") {
        card.querySelector(".note-btn")?.classList.toggle("has-note", !!String(e.target.value || "").trim());
      }
      if (e.target.dataset.k === "name" && !state.path) state.doc.title = e.target.value || state.doc.title;
      if (e.target.dataset.k === "customer" && e.type === "change") {
        syncCustomersFromOrders();
        const list = state.doc.customers || [];
        $("customer-list").innerHTML = unique(list.map((c) => c.name)).map((c) => `<option value="${esc(c)}">`).join("");
      }
      if (e.target.dataset.k === "work_start" || e.target.dataset.k === "work_end") {
        normalizeWorkDates(order);
        if (e.type === "change") {
          e.target.value = order[e.target.dataset.k] || "";
          const other = e.target.dataset.k === "work_start" ? "work_end" : "work_start";
          const otherEl = card.querySelector(`[data-k="${other}"]`);
          if (otherEl) otherEl.value = order[other] || "";
          const pill = card.querySelector(".work-pill");
          if (pill) {
            const meta = workStatusMeta(order);
            pill.className = `work-pill work-pill-${meta.id}`;
            pill.textContent = meta.label;
          }
        }
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
      if (key === "price_expr") {
        const cleaned = stripLeadingZerosPlain(e.target.value);
        if (cleaned !== e.target.value) {
          const pos = e.target.selectionStart;
          const diff = e.target.value.length - cleaned.length;
          e.target.value = cleaned;
          try {
            if (pos != null) e.target.setSelectionRange(Math.max(0, pos - diff), Math.max(0, pos - diff));
          } catch {
            /* ignore */
          }
        }
      }
      line[key] = e.target.value;
      const v = evalExpr(e.target.value);
      e.target.dataset.expr = e.target.value;
      e.target.classList.toggle("invalid", e.target.value.trim() !== "" && !Number.isFinite(v));
      if (Number.isFinite(v)) {
        const numKey = EXPR_MAP[key];
        let n = round2(v);
        if (numKey === "discount") n = Math.min(100, Math.max(0, n));
        if (numKey === "price" || numKey === "paid" || numKey === "tax_percent") n = Math.max(0, n);
        line[numKey] = n;
      }
    } else {
      const prevKind = key === "order_type" ? typeKind(line.order_type) : "";
      line[key] = e.target.type === "number" ? num(e.target.value) : e.target.value;
      if (key === "product") {
        if (e.type === "change") ensureProduct(line.product, line.unit, line.price);
        applyLineProductDefaults(tr, line);
        if (e.type === "input" && !productSuggest.picking) openProductSuggest(e.target, "filter");
      }
      if (key === "tax_mode") {
        markDirty();
        renderOrders();
        requestAnimationFrame(() => focusLineCell(line.id, 4));
        return;
      }
      if (key === "order_type") {
        const nextKind = typeKind(line.order_type);
        if (nextKind !== prevKind) {
          if (nextKind && !prevKind) resetExpenseLine(line);
          line.tax_mode = nextKind === "tax" ? "gross" : "amount";
          markDirty();
          renderOrders();
          requestAnimationFrame(() => focusLineCell(line.id, 1));
          return;
        }
      }
    }
    applyPaidIfCovered(line);
    applyRowStatus(tr, line.status);
    const statusSel = tr.querySelector('[data-lk="status"]');
    if (statusSel && statusSel.value !== line.status) statusSel.value = line.status;
    markDirty();
    refreshComputed(card, tr, order, line);
  }

  function refreshComputed(card, tr, order, line) {
    const t = lineTotals(line, order);
    const cells = tr.querySelectorAll(".computed");
    if (t.expense) {
      if (cells[0]) cells[0].textContent = `−${money(t.cost)}`;
    } else {
      if (cells[0]) cells[0].textContent = money(t.unpaid);
      if (cells[1]) {
        cells[1].innerHTML = `${esc(money(t.after))}<div style="color:#94a3b8;font-weight:500;font-size:11px">до скидки ${esc(money(t.total))}</div>`;
      }
    }
    if (!t.expense || t.mode === "amount") refreshPercentRows(card, order);
    const tot = orderTotals(order);
    const foot = card.querySelector(".totals");
    if (foot) foot.innerHTML = orderTotalsHtml(tot);
    const oeSum = card.querySelector(".oe-sum");
    if (oeSum) oeSum.textContent = `−${money(tot.cost)} · чистыми ${money(tot.net)}`;
  }

  /** Налог в процентах зависит от других строк — обновляем его при любой правке заказа. */
  function refreshPercentRows(card, order) {
    for (const item of order.lines || []) {
      if (isFrozenLine(item) || !isExpenseLine(item) || taxMode(item) === "amount") continue;
      const row = card.querySelector(`tr[data-line="${cssEscape(item.id)}"]`);
      if (!row) continue;
      const t = lineTotals(item, order);
      const cell = row.querySelector(".computed");
      if (cell) cell.textContent = `−${money(t.cost)}`;
      const of = row.querySelector(".tax-of");
      if (of) of.textContent = `% от ${money(t.base)}`;
    }
  }

  function onExprFocus(e) {
    const inp = e.target;
    const key = inp.dataset?.lk;
    if (!EXPR_MAP[key]) return;
    if (inp.dataset.showing === "result") {
      inp.dataset.showing = "expr";
      inp.value = inp.dataset.expr || "";
      queueMicrotask(() => {
        try {
          inp.select();
        } catch {
          /* ignore */
        }
      });
      return;
    }
    if (key === "price_expr" && isBareZeroExpr(inp.value)) {
      queueMicrotask(() => {
        try {
          inp.select();
        } catch {
          /* ignore */
        }
      });
    }
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
    const next = key === "price_expr" ? stripLeadingZerosPlain(raw) : raw;
    if (next !== inp.value) inp.value = next;
    line[key] = next;
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
    { id: "expenses", label: "Налоги и затраты", kind: "meta" },
  ];
  const SHARE_PRESETS = {
    work: ["number", "name", "order_type", "product", "quantity", "status", "order_date"],
    invoice: ["number", "customer", "organization", "name", "order_type", "product", "quantity", "price", "discount", "total", "paid", "unpaid", "totals"],
    full: SHARE_FIELDS.map((f) => f.id),
  };

  const SHARE_THEMES = {
    teal: {
      label: "Изумруд",
      head: ["#0f766e", "#115e59"],
      headInk: "#ffffff",
      accent: "#0f766e",
      bg: "#ffffff",
      ink: "#0f172a",
      meta: "#334155",
      line: "#e2e8f0",
      thBg: "#f8fafc",
      thInk: "#64748b",
      zebra: "#f8fafc",
      footBg: "#f1f5f9",
      note: "#94a3b8",
    },
    graphite: {
      label: "Графит",
      head: ["#1e293b", "#0f172a"],
      headInk: "#ffffff",
      accent: "#334155",
      bg: "#ffffff",
      ink: "#0f172a",
      meta: "#334155",
      line: "#e2e8f0",
      thBg: "#f8fafc",
      thInk: "#64748b",
      zebra: "#f8fafc",
      footBg: "#f1f5f9",
      note: "#94a3b8",
    },
    indigo: {
      label: "Индиго",
      head: ["#4f46e5", "#3730a3"],
      headInk: "#ffffff",
      accent: "#4f46e5",
      bg: "#ffffff",
      ink: "#111827",
      meta: "#3f3f5a",
      line: "#e4e7f5",
      thBg: "#f5f6fd",
      thInk: "#6366f1",
      zebra: "#f9f9fe",
      footBg: "#eef0fc",
      note: "#a5b4fc",
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
    rose: {
      label: "Вишня",
      head: ["#be123c", "#881337"],
      headInk: "#ffffff",
      accent: "#be123c",
      bg: "#ffffff",
      ink: "#18181b",
      meta: "#3f3f46",
      line: "#f0dde2",
      thBg: "#fdf2f5",
      thInk: "#9f1239",
      zebra: "#fdf8f9",
      footBg: "#fbe8ed",
      note: "#d4a4b3",
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

  function shareThemeKey() {
    const key = ensureUi().share_theme;
    return SHARE_THEMES[key] ? key : "teal";
  }

  function shareTheme() {
    return SHARE_THEMES[shareThemeKey()];
  }

  function renderShareThemes() {
    const box = $("share-themes");
    if (!box) return;
    const cur = shareThemeKey();
    box.innerHTML = Object.entries(SHARE_THEMES)
      .map(
        ([key, t]) => `<button type="button" class="share-theme ${key === cur ? "active" : ""}" data-share-theme="${key}" title="${esc(t.label)}">
          <span class="st-swatch" style="background:linear-gradient(135deg, ${t.head[0]}, ${t.head[1]})"></span>
          <span>${esc(t.label)}</span>
        </button>`
      )
      .join("");
  }

  function currentShareFields() {
    return [...document.querySelectorAll("#share-fields input:checked")].map((el) => el.value);
  }

  function fmtShareDate(value) {
    if (!value) return "—";
    return dateDay(value) || "—";
  }

  function customerOrg(name) {
    return (state.doc.customers || []).find((c) => c.name === name)?.organization || "";
  }

  function shareNumber(n) {
    const r = round2(n);
    if (Number.isInteger(r)) return String(r);
    return r.toFixed(2).replace(".", ",");
  }

  function shareLineValue(line, id) {
    const t = lineTotals(line);
    if (t.expense) {
      // Расход в снимке — только название, объём и сумма с минусом; скидок и оплат у него нет.
      if (id === "order_type") return `${line.order_type || "—"} · ${kindLabel(t.kind)}`;
      if (id === "product") return line.product || "—";
      if (id === "quantity") return t.mode === "amount" ? `${shareNumber(qtyValue(line))} ${line.unit || ""}`.trim() : `${shareNumber(t.percent)} %`;
      if (id === "price") return t.mode === "amount" ? money(numExpr(line, "price_expr", "price")) : money(t.base);
      if (id === "total") return `−${money(t.cost)}`;
      if (id === "order_date") return fmtShareDate(line.order_date);
      return "—";
    }
    if (id === "order_type") return line.order_type || "—";
    if (id === "product") return line.product || "—";
    if (id === "quantity") return `${shareNumber(qtyValue(line))} ${line.unit || ""}`.trim();
    if (id === "price") return money(numExpr(line, "price_expr", "price"));
    if (id === "discount") return `${shareNumber(numExpr(line, "discount_expr", "discount"))} %`;
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
    const acc = (lines || []).reduce(
      (sum, line) => {
        const t = lineTotals(line);
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

  /** Расходы попадают в снимок только при включённом поле «Налоги и затраты». */
  function shareShowsExpenses() {
    return currentShareFields().includes("expenses");
  }

  function selectedShareBlocks() {
    const withExpenses = shareShowsExpenses();
    return [...document.querySelectorAll("#share-orders .share-order")]
      .map((block) => {
        const order = findOrder(block.dataset.order);
        if (!order || !block.querySelector("[data-share-order]")?.checked) return null;
        const ids = new Set([...block.querySelectorAll("[data-share-line]:checked")].map((el) => el.dataset.shareLine));
        const lines = (order.lines || []).filter((l) => ids.has(l.id) && !isFrozenLine(l) && (withExpenses || !isExpenseLine(l)));
        if (!lines.length) return null;
        return { order, lines };
      })
      .filter(Boolean);
  }

  function shareMetaPairs(order, fields) {
    const items = [];
    if (fields.includes("number")) items.push(["№", order.number]);
    if (fields.includes("name")) items.push(["Заказ", order.name]);
    if (fields.includes("customer")) items.push(["Заказчик", order.customer]);
    if (fields.includes("organization")) items.push(["Организация", customerOrg(order.customer)]);
    return items;
  }

  function shareMetaItems(order, fields, hideLabels) {
    return shareMetaPairs(order, fields).map(([label, value]) => {
      const v = value || "—";
      if (hideLabels) return v;
      return label === "№" ? `№ ${v}` : `${label}: ${v}`;
    });
  }

  function shareTotalsText(fields, cols, lines) {
    if (!fields.includes("totals") || shareNeedsMoneyFooter(cols)) return "";
    const tot = linesTotals(lines);
    const bits = [];
    if (fields.includes("total") || fields.includes("price") || !cols.length) bits.push(`Итого ${money(tot.after)}`);
    if (tot.cost > 0.005) {
      bits.push(`расходы −${money(tot.cost)}`);
      bits.push(`к оплате ${money(tot.net)}`);
    }
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
    if (colId === "total") return tot.cost > 0.005 ? money(tot.net) : money(tot.after);
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
            .filter((line) => !isFrozenLine(line))
            .map((line) => {
              const kind = typeKind(line.order_type);
              return `<label class="${kind ? "share-cost" : ""}"><input type="checkbox" data-share-line="${esc(line.id)}" ${
                on ? "checked" : ""
              } /> ${esc(line.order_type || "тип")} · ${esc(line.product || "—")}${kind ? ` · ${esc(kindLabel(kind))}` : ""}</label>`;
            })
            .join("")}</div>
        </div>`;
          })
          .join("")
      : `<div class="hint">Нет заказов</div>`;
    if (focusOrderId) {
      [...box.querySelectorAll(".share-order")].find((el) => el.dataset.order === focusOrderId)?.scrollIntoView({ block: "nearest" });
    }
  }

  function openShare(orderOrId) {
    const order = typeof orderOrId === "string" ? findOrder(orderOrId) : orderOrId;
    const saved = ensureUi().share_fields;
    const selected = saved && saved.length ? saved : SHARE_PRESETS.work;
    $("share-fields").innerHTML = SHARE_FIELDS.map(
      (f) => `<label><input type="checkbox" value="${f.id}" ${selected.includes(f.id) ? "checked" : ""} /> ${esc(f.label)}</label>`
    ).join("");
    renderShareThemes();
    renderShareOrdersPicker(order?.id || null);
    $("share-title").value = order ? [order.number, order.name].filter(Boolean).join(" · ") : "";
    document.querySelectorAll("#share-modal .share-fold").forEach((fold) => {
      fold.classList.add("collapsed");
      const ico = fold.querySelector(".share-fold-ico");
      if (ico) ico.textContent = "▸";
    });
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
    const t = shareTheme();
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
                      `<th style="text-align:left;padding:8px 10px;font-size:11px;text-transform:uppercase;letter-spacing:.04em;color:${t.thInk};background:${t.thBg};border-top:1px solid ${t.line};white-space:nowrap">${esc(c.label)}</th>`
                  )
                  .join("")}</tr></thead><tbody>${lines
                  .map(
                    (line, ri) =>
                      `<tr style="background:${ri % 2 ? t.zebra : "transparent"}">${cols
                        .map(
                          (c) =>
                            `<td style="text-align:left;padding:8px 10px;border-top:1px solid ${t.line};color:${t.ink};white-space:nowrap">${esc(shareLineValue(line, c.id))}</td>`
                        )
                        .join("")}</tr>`
                  )
                  .join("")}</tbody>${
                  foot
                    ? `<tfoot><tr>${foot
                        .map(
                          (v) =>
                            `<td style="text-align:left;padding:10px;border-top:2px solid ${t.accent};font-weight:700;color:${t.ink};background:${t.footBg};white-space:nowrap">${esc(v)}</td>`
                        )
                        .join("")}</tr></tfoot>`
                    : ""
                }</table>`
              : "";
            const sep = i ? `border-top:2px solid ${t.accent};margin-top:12px;padding-top:16px;` : "";
            return `<div class="share-order-block" style="padding:0 20px 16px;${sep}">
          ${meta.length ? `<div class="sp-meta" style="padding:0 0 10px;display:grid;gap:4px;font-size:13px;color:${t.meta}">${meta.map((m) => `<div>${esc(m)}</div>`).join("")}</div>` : ""}
          ${table || `<div style="padding:8px 0;font-size:13px;color:${t.note}">Таблица работ скрыта — включите колонки слева.</div>`}
          ${totalsText ? `<div class="sp-foot" style="padding:10px 0 4px;font-size:14px;color:${t.ink}"><b>${esc(totalsText)}</b></div>` : ""}
        </div>`;
          })
          .join("")
      : `<div style="padding:20px;color:${t.note}">Выберите хотя бы один заказ и строку слева.</div>`;
    box.style.background = t.bg;
    box.style.color = t.ink;
    box.innerHTML = `
      <div class="sp-head" style="background:linear-gradient(90deg,${t.head[0]},${t.head[1]});color:${t.headInk};padding:18px 20px;${
        t.headLine ? `border-bottom:2px solid ${t.accent};` : ""
      }">
        <b style="font-size:18px;display:block">${esc(title)}</b>
      </div>
      ${body}
      ${hideStamp ? "" : `<div class="sp-note" style="padding:0 20px 16px;font-size:11px;color:${t.note}">Сформировано ${esc(new Date().toLocaleString("ru-RU"))}</div>`}
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
    const theme = shareTheme();
    const canvas = document.createElement("canvas");
    canvas.width = width * scale;
    canvas.height = height * scale;
    const ctx = canvas.getContext("2d");
    ctx.scale(scale, scale);
    ctx.fillStyle = theme.bg;
    ctx.fillRect(0, 0, width, height);
    const head = ctx.createLinearGradient(0, 0, width, 0);
    head.addColorStop(0, theme.head[0]);
    head.addColorStop(1, theme.head[1]);
    ctx.fillStyle = head;
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
    ctx.fillText(title, pad, 40);
    let y = headerH + 16;
    layouts.forEach(({ order, lines, colWidths, tableW }, bi) => {
      if (bi) {
        y += 16;
        ctx.strokeStyle = theme.accent;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(pad, y);
        ctx.lineTo(width - pad, y);
        ctx.stroke();
        ctx.lineWidth = 1;
        y += 20;
      }
      const meta = shareMetaItems(order, fields, hideLabels);
      ctx.fillStyle = theme.meta;
      ctx.font = "13px Segoe UI, sans-serif";
      meta.forEach((line) => {
        ctx.fillText(line, pad, y + 14);
        y += 22;
      });
      if (meta.length) y += 10;
      if (cols.length) {
        const xs = shareColStarts(colWidths, pad);
        ctx.fillStyle = theme.thBg;
        ctx.fillRect(pad, y, tableW, 32);
        ctx.fillStyle = theme.thInk;
        ctx.font = "600 11px Segoe UI, sans-serif";
        cols.forEach((col, i) => {
          ctx.fillText(fitCanvasText(ctx, col.label.toUpperCase(), colWidths[i] - 12), xs[i] + 8, y + 21);
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
          ctx.fillStyle = theme.footBg;
          ctx.fillRect(pad, y, tableW, rowH);
          ctx.strokeStyle = theme.accent;
          ctx.beginPath();
          ctx.moveTo(pad, y);
          ctx.lineTo(pad + tableW, y);
          ctx.stroke();
          ctx.fillStyle = theme.ink;
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
        ctx.fillStyle = theme.ink;
        ctx.font = "700 14px Segoe UI, sans-serif";
        ctx.fillText(totalsText, pad, y + 14);
        y += 22;
      }
      y += 16;
    });
    if (!hideStamp) {
      ctx.fillStyle = theme.note;
      ctx.font = "11px Segoe UI, sans-serif";
      ctx.fillText(stamp, pad, height - 16);
    }
    return canvas;
  }

  function visLen(s) {
    return [...String(s ?? "")].length;
  }

  function padVis(s, n, align = "left") {
    const str = String(s ?? "");
    const extra = Math.max(0, n - visLen(str));
    return align === "right" ? `${" ".repeat(extra)}${str}` : `${str}${" ".repeat(extra)}`;
  }

  function shareToText() {
    const blocks = selectedShareBlocks();
    if (!blocks.length) throw new Error("Выберите заказы и строки для снимка");
    const fields = currentShareFields();
    const hideLabels = shareHideLabels();
    const hideStamp = shareHideStamp();
    const cols = SHARE_FIELDS.filter((f) => f.kind === "col" && fields.includes(f.id));
    const title = shareTitleText(blocks);
    const out = [title];

    blocks.forEach(({ order, lines }, bi) => {
      if (bi) out.push("");
      const meta = shareMetaItems(order, fields, hideLabels);
      if (meta.length) {
        out.push("");
        meta.forEach((line) => out.push(line));
      }

      if (cols.length) {
        const foot = shareFooterCells(cols, lines);
        const rows = [
          cols.map((c) => c.label),
          ...lines.map((line) => cols.map((c) => String(shareLineValue(line, c.id) || "—"))),
        ];
        if (foot && foot.some(Boolean)) rows.push(foot.map((v) => v || ""));
        const widths = cols.map((_, i) => Math.max(1, ...rows.map((row) => visLen(row[i]))));
        out.push("");
        rows.forEach((row, ri) => {
          out.push(row.map((cell, i) => padVis(cell, widths[i])).join("  "));
          if (ri === 0) out.push(widths.map((w) => "─".repeat(w)).join("  "));
        });
      }

      const totalsText = shareTotalsText(fields, cols, lines);
      if (totalsText) {
        out.push("");
        out.push(totalsText);
      }
    });

    if (!hideStamp) {
      out.push("");
      out.push(`Сформировано ${new Date().toLocaleString("ru-RU")}`);
    }
    return `${out.join("\n").trim()}\n`;
  }

  function blobToBase64(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result).split(",")[1] || "");
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  }

  async function copyShareText() {
    try {
      const text = shareToText();
      if (state.desktop) {
        await apiPost("/api/clipboard-text", { text });
        toast("Текст снимка скопирован — вставьте в чат (Ctrl+V)");
        return;
      }
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
        toast("Текст снимка скопирован в буфер обмена");
        return;
      }
      throw new Error("clipboard");
    } catch (err) {
      toast(`Не удалось скопировать текст: ${err.message || err}`);
    }
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

  function cssEscape(value) {
    if (window.CSS && typeof CSS.escape === "function") return CSS.escape(String(value));
    return String(value).replace(/["\\]/g, "\\$&");
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

  function addExpenseLine(order) {
    const type = typeNames("expense")[0];
    if (!type) {
      toast("Сначала отметьте тип заказа как налог или затрату в справочниках");
      return null;
    }
    const prev = (order.lines || [])[order.lines.length - 1];
    const line = resetExpenseLine(emptyLine());
    line.order_type = type;
    line.tax_mode = typeKind(type) === "tax" ? "gross" : "amount";
    line.product = "";
    line.price = 0;
    line.price_expr = "0";
    if (prev) {
      line.unit = prev.unit;
      line.order_date = prev.order_date;
    }
    order.lines.push(line);
    markDirty();
    renderOrders();
    requestAnimationFrame(() => focusLineCell(line.id, 3));
    return line;
  }

  function addOrderLine(order, afterId) {
    const line = emptyLine();
    const idx = afterId ? order.lines.findIndex((l) => l.id === afterId) : -1;
    if (idx >= 0) order.lines.splice(idx + 1, 0, line);
    else order.lines.push(line);
    markDirty();
    renderOrders();
    requestAnimationFrame(() => focusLineCell(line.id, 2));
    return line;
  }

  function focusCellElement(cell) {
    const target = cell?.querySelector("input, select");
    if (!target) return false;
    target.focus();
    try {
      target.select?.();
    } catch {
      /* ignore */
    }
    return true;
  }

  function focusLineCell(lineId, cellIndex) {
    const row = document.querySelector(`tr[data-line="${cssEscape(lineId)}"]`);
    if (!row) return;
    focusCellElement(row.children[cellIndex]);
    row.classList.add("focus-row");
    setTimeout(() => row.classList.remove("focus-row"), 900);
  }

  function moveLine(order, lineId, dir, cellIndex) {
    const i = order.lines.findIndex((l) => l.id === lineId);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= order.lines.length) return;
    const [item] = order.lines.splice(i, 1);
    order.lines.splice(j, 0, item);
    markDirty();
    renderOrders();
    requestAnimationFrame(() => focusLineCell(lineId, cellIndex));
  }

  function copyCellFromAbove(tr, target) {
    const prev = tr.previousElementSibling;
    const lk = target.dataset?.lk;
    if (!prev || !prev.dataset.line || !lk) return false;
    const src = prev.querySelector(`[data-lk="${lk}"]`);
    if (!src) return false;
    const value = src.dataset.showing === "result" && src.dataset.expr != null ? src.dataset.expr : src.value;
    if (target.dataset.showing) target.dataset.showing = "expr";
    target.value = value;
    target.dispatchEvent(new Event("input", { bubbles: true }));
    target.dispatchEvent(new Event("change", { bubbles: true }));
    try {
      target.select?.();
    } catch {
      /* ignore */
    }
    return true;
  }

  const NAV_SKIP_INPUT_TYPES = new Set(["datetime-local", "date", "time", "number"]);

  function onOrderKeydown(e) {
    if (bindTextSuggestKeys(e)) return;
    const tr = e.target.closest?.("tr[data-line]");
    const td = e.target.closest?.("td");
    if (!tr || !td) return;
    const card = tr.closest("[data-order]");
    const order = findOrder(card?.dataset.order);
    if (!order) return;
    const cellIndex = [...tr.children].indexOf(td);
    const ctrl = e.ctrlKey || e.metaKey;
    const code = e.code;

    if (e.altKey && !ctrl && (e.key === "ArrowUp" || e.key === "ArrowDown")) {
      e.preventDefault();
      moveLine(order, tr.dataset.line, e.key === "ArrowUp" ? -1 : 1, cellIndex);
      return;
    }
    if (ctrl && e.altKey && code === "KeyD") {
      e.preventDefault();
      const idx = order.lines.findIndex((l) => l.id === tr.dataset.line);
      if (idx < 0) return;
      const copy = JSON.parse(JSON.stringify(order.lines[idx]));
      copy.id = uid();
      order.lines.splice(idx + 1, 0, copy);
      markDirty();
      renderOrders();
      requestAnimationFrame(() => focusLineCell(copy.id, cellIndex));
      return;
    }
    if (ctrl && !e.altKey && code === "KeyD") {
      e.preventDefault();
      copyCellFromAbove(tr, e.target);
      return;
    }
    if (ctrl && e.key === "Enter") {
      e.preventDefault();
      addOrderLine(order, tr.dataset.line);
      return;
    }
    if (e.key === "Enter" && !ctrl && !e.altKey) {
      e.preventDefault();
      const next = e.shiftKey ? tr.previousElementSibling : tr.nextElementSibling;
      if (next?.dataset.line) focusCellElement(next.children[cellIndex]);
      else if (!e.shiftKey) addOrderLine(order, tr.dataset.line);
      return;
    }
    if ((e.key === "ArrowDown" || e.key === "ArrowUp") && !ctrl && !e.altKey && !e.shiftKey) {
      if (e.target.tagName === "SELECT") return;
      if (e.target.tagName === "INPUT" && NAV_SKIP_INPUT_TYPES.has(e.target.type)) return;
      const next = e.key === "ArrowUp" ? tr.previousElementSibling : tr.nextElementSibling;
      if (next?.dataset.line && focusCellElement(next.children[cellIndex])) e.preventDefault();
    }
  }

  function flashOrder(id) {
    const card = document.querySelector(`[data-order="${cssEscape(id)}"]`);
    if (!card) return;
    card.scrollIntoView({ behavior: "smooth", block: "center" });
    card.classList.add("flash");
    setTimeout(() => card.classList.remove("flash"), 1700);
  }

  function syncSearchClear(input) {
    if (!input) return;
    const wrap = input.closest(".search, .cloud-search, .calc-search, .palette-input");
    wrap?.classList.toggle("has-value", !!String(input.value || "").length);
  }

  function clearSearchInput(input) {
    if (!input) return;
    input.value = "";
    syncSearchClear(input);
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.focus();
  }

  function bindSearchClears() {
    document.querySelectorAll("[data-search-clear]").forEach((btn) => {
      if (btn.dataset.boundClear) return;
      btn.dataset.boundClear = "1";
      btn.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        const input = $(btn.dataset.searchClear) || btn.parentElement?.querySelector("input");
        clearSearchInput(input);
      });
    });
    ["global-search", "cloud-search", "palette-input"].forEach((id) => {
      const input = $(id);
      if (!input || input.dataset.boundClearSync) return;
      input.dataset.boundClearSync = "1";
      input.addEventListener("input", () => syncSearchClear(input));
      syncSearchClear(input);
    });
  }

  function gotoOrder(id) {
    state.orderFilter = "all";
    state.search = "";
    const search = $("global-search");
    if (search) search.value = "";
    syncSearchClear(search);
    setView("orders");
    requestAnimationFrame(() => flashOrder(id));
  }

  function gotoCustomer(id) {
    setView("customers");
    requestAnimationFrame(() => {
      const row = document.querySelector(`tr[data-cid="${cssEscape(id)}"]`);
      if (!row) return;
      row.scrollIntoView({ behavior: "smooth", block: "center" });
      row.classList.add("flash-row");
      setTimeout(() => row.classList.remove("flash-row"), 1700);
      row.querySelector("input")?.focus();
    });
  }

  /* ==== Командная палитра ==== */
  const palette = { items: [], index: 0 };

  function paletteCommands() {
    const items = [
      { group: "Разделы", ico: "⌂", title: "Дашборд", sub: "KPI, инсайты и графики", run: () => setView("dashboard") },
      { group: "Разделы", ico: "☰", title: "Заказы", sub: "таблицы заказов и позиций", run: () => setView("orders") },
      { group: "Разделы", ico: "◷", title: "Аналитика", sub: "фильтры, сравнение периодов", run: () => setView("analytics") },
      { group: "Разделы", ico: "₽", title: "Касса", sub: "платёжный календарь и дебиторка", run: () => setView("cashflow") },
      { group: "Разделы", ico: "▦", title: "Календарь", sub: "старт, финиш и что идёт сейчас", run: () => setView("calendar") },
      { group: "Разделы", ico: "∑", title: "Калькулятор", sub: "схемы из заказов, операторов и формул", run: () => setView("calculator") },
      { group: "Разделы", ico: "▣", title: "Презентация", sub: "инфографика из блоков и схем", run: () => setView("presentation") },
      { group: "Разделы", ico: "✣", title: "Облако заказов", sub: "живая карта заказов и позиций", run: () => setView("cloud") },
      { group: "Разделы", ico: "◉", title: "Заказчики", sub: "контакты и рейтинг", run: () => setView("customers") },
      { group: "Разделы", ico: "⚙", title: "Справочники", sub: "статусы, единицы, продукты", run: () => setView("catalogs") },

      {
        group: "Действия",
        ico: "+",
        title: "Новый заказ",
        sub: "добавить пустой заказ",
        run: () => {
          state.doc.orders.push(emptyOrder());
          markDirty();
          state.orderFilter = "all";
          setView("orders");
          const last = state.doc.orders[state.doc.orders.length - 1];
          requestAnimationFrame(() => flashOrder(last.id));
        },
      },
      { group: "Действия", ico: "⤓", title: "Сохранить отчёт", right: "Ctrl+S", run: () => save() },
      {
        group: "Действия",
        ico: "▯",
        title: remote.enabled ? "Телефон: показать QR-код" : "Управление с телефона",
        sub: "работать с отчётом со смартфона",
        run: () => $("btn-remote")?.click(),
      },
      {
        group: "Действия",
        ico: ">_",
        title: netConsoleOpen() ? "Скрыть консоль сети" : "Консоль сети",
        sub: "подключения, синхронизация, Telegram и ngrok",
        right: "Ctrl+Ё",
        run: () => toggleNetConsole(),
      },
      { group: "Действия", ico: "⤓", title: "Сохранить как…", right: "Ctrl+Shift+S", run: () => save({ as: true }) },
      { group: "Действия", ico: "⌸", title: "Открыть отчёт", right: "Ctrl+O", run: () => maybeOpen(openFromDialog) },
      { group: "Действия", ico: "✧", title: "Создать новый отчёт", right: "Ctrl+N", run: onNew },
      { group: "Действия", ico: "⛶", title: state.appFullscreen ? "Выйти из полного экрана" : "Полный экран", right: "F11", run: () => toggleAppFullscreen() },
      { group: "Действия", ico: "⎘", title: "Экспорт в CSV", sub: "все позиции отчёта", run: exportCsv },
      { group: "Действия", ico: "▣", title: "Снимок заказов", sub: "красивая картинка для заказчика", run: () => openShare(null) },
      { group: "Действия", ico: "↶", title: "Отменить действие", right: "Ctrl+Z", run: undo },
      { group: "Действия", ico: "↷", title: "Повторить действие", right: "Ctrl+Y", run: redo },
      {
        group: "Действия",
        ico: "◐",
        title: currentTheme() === "dark" ? "Включить светлую тему" : "Включить тёмную тему",
        run: () => applyTheme(currentTheme() === "dark" ? "light" : "dark", true),
      },
      {
        group: "Действия",
        ico: "⊏",
        title: ensureUi().sidebar_collapsed ? "Развернуть боковую панель" : "Свернуть боковую панель",
        run: () => {
          ensureUi().sidebar_collapsed = !ensureUi().sidebar_collapsed;
          applySidebar();
          markDirty();
        },
      },
      { group: "Действия", ico: "?", title: "Горячие клавиши", right: "F1", run: openHelp },

      {
        group: "Фильтры",
        ico: "!",
        title: "Заказы с долгом",
        sub: "оставить только неоплаченные",
        run: () => {
          state.orderFilter = "debt";
          setView("orders");
        },
      },
      {
        group: "Фильтры",
        ico: "✓",
        title: "Полностью оплаченные заказы",
        run: () => {
          state.orderFilter = "paid";
          setView("orders");
        },
      },
      {
        group: "Фильтры",
        ico: "◷",
        title: "Заказы этого месяца",
        run: () => {
          state.orderFilter = "month";
          setView("orders");
        },
      },
      {
        group: "Фильтры",
        ico: "▦",
        title: "Календарь: идёт сейчас",
        sub: "заказы в работе сегодня",
        run: () => {
          calendarState().filter = "now";
          persistCalendar();
          setView("calendar");
        },
      },
      {
        group: "Фильтры",
        ico: "!",
        title: "Касса: просроченные долги",
        run: () => {
          cashResetFilters();
          cashState().filter = "overdue";
          setView("cashflow");
        },
      },
      {
        group: "Фильтры",
        ico: "₽",
        title: "Касса: скопировать сводку",
        run: () => {
          if (!state.doc) return;
          cashCopy(cashSummaryText(cashData()), "Сводка по кассе скопирована");
        },
      },
      {
        group: "Фильтры",
        ico: "∑",
        title: "Аналитика: только долги",
        run: () => {
          setView("analytics");
          $("f-unpaid").checked = true;
          renderAnalytics();
        },
      },
      {
        group: "Облако",
        ico: "➤",
        title: "Облако: автотур по долгам",
        sub: "пролететь по самым крупным очагам",
        run: () => {
          setView("cloud");
          requestAnimationFrame(() => {
            if (!orderCloud?.startTour()) toast("Для автотура нужны заказы или долги");
          });
        },
      },
      {
        group: "Облако",
        ico: "♨",
        title: "Облако: тепловая карта долга",
        run: () => {
          cloudState().heat = true;
          persistCloudPrefs();
          setView("cloud");
          $("cloud-heat")?.setAttribute("aria-pressed", "true");
          $("cloud-heat")?.classList.add("active");
          syncCloudHeatScale();
        },
      },
      {
        group: "Облако",
        ico: "3D",
        title: "Облако: объёмное пространство",
        sub: "переключить карту в 3D",
        run: () => {
          cloudState().space3d = true;
          persistCloudPrefs();
          setView("cloud");
          $("cloud-3d")?.setAttribute("aria-pressed", "true");
          $("cloud-3d")?.classList.add("active");
          orderCloud?.setOptions({ space3d: true });
        },
      },
      {
        group: "Облако",
        ico: "✦",
        title: "Облако: созвездия работ",
        run: () => {
          cloudState().layout = "constellation";
          persistCloudPrefs();
          setView("cloud");
          if ($("cloud-layout")) $("cloud-layout").value = "constellation";
        },
      },
    ];
    return items;
  }

  function paletteDataItems() {
    const items = [];
    (state.doc.orders || []).forEach((order) => {
      const t = orderTotals(order);
      items.push({
        group: "Заказы",
        ico: "№",
        title: `${order.number || "—"} · ${order.name || "без названия"}`,
        sub: order.customer || "без заказчика",
        right: money(t.after),
        run: () => gotoOrder(order.id),
      });
    });
    (state.doc.customers || []).forEach((c) => {
      items.push({
        group: "Заказчики",
        ico: "◉",
        title: c.name || "без имени",
        sub: [c.organization, c.phone].filter(Boolean).join(" · "),
        right: `${(state.doc.orders || []).filter((o) => o.customer === c.name).length} зак.`,
        run: () => gotoCustomer(c.id),
      });
    });
    (state.doc.products || []).forEach((p) => {
      items.push({
        group: "Продукты",
        ico: "✦",
        title: p.name,
        sub: `ед. по умолчанию: ${p.unit}`,
        run: () => {
          setView("analytics");
          $("f-product").value = p.name;
          renderAnalytics();
        },
      });
    });
    return items;
  }

  function paletteMatch(item, tokens) {
    if (!tokens.length) return true;
    const hay = `${item.title} ${item.sub || ""} ${item.group}`.toLowerCase();
    return tokens.every((t) => hay.includes(t));
  }

  function renderPaletteList(query) {
    const tokens = String(query || "")
      .trim()
      .toLowerCase()
      .split(/\s+/)
      .filter(Boolean);
    const all = [...paletteCommands(), ...paletteDataItems()];
    const limit = tokens.length ? 8 : 5;
    const counts = {};
    const items = [];
    all.forEach((item) => {
      if (!paletteMatch(item, tokens)) return;
      counts[item.group] = (counts[item.group] || 0) + 1;
      if (counts[item.group] <= limit) items.push(item);
    });
    palette.items = items.slice(0, 40);
    palette.index = 0;
    drawPalette();
  }

  function drawPalette() {
    const list = $("palette-list");
    if (!palette.items.length) {
      list.innerHTML = `<div class="palette-empty">Ничего не найдено. Попробуйте другое слово.</div>`;
      return;
    }
    let group = null;
    list.innerHTML = palette.items
      .map((item, i) => {
        let head = "";
        if (item.group !== group) {
          group = item.group;
          head = `<div class="palette-group">${esc(group)}</div>`;
        }
        return `${head}<button type="button" class="palette-item ${i === palette.index ? "active" : ""}" data-pi="${i}">
          <span class="pi-ico">${esc(item.ico || "•")}</span>
          <span><span class="pi-title">${esc(item.title)}</span>${item.sub ? `<span class="pi-sub"> — ${esc(item.sub)}</span>` : ""}</span>
          ${item.right ? `<span class="pi-right">${esc(item.right)}</span>` : ""}
        </button>`;
      })
      .join("");
    list.querySelector(".palette-item.active")?.scrollIntoView({ block: "nearest" });
  }

  function paletteMove(dir) {
    if (!palette.items.length) return;
    palette.index = (palette.index + dir + palette.items.length) % palette.items.length;
    drawPalette();
  }

  function paletteRun(index) {
    const item = palette.items[index];
    if (!item) return;
    closePalette();
    try {
      item.run();
    } catch (err) {
      toast(String(err.message || err));
    }
  }

  function openPalette() {
    if (!state.doc || $("app-shell").hidden) return;
    $("palette").classList.add("open");
    const input = $("palette-input");
    input.value = "";
    syncSearchClear(input);
    renderPaletteList("");
    setTimeout(() => input.focus(), 10);
  }

  function closePalette() {
    $("palette").classList.remove("open");
  }

  function paletteIsOpen() {
    return $("palette").classList.contains("open");
  }

  function pageFullscreenOn() {
    const el = document.fullscreenElement || document.webkitFullscreenElement;
    return el === document.documentElement;
  }

  function syncAppFullscreen(on) {
    state.appFullscreen = !!on;
    const btn = $("btn-fullscreen");
    if (!btn) return;
    btn.classList.toggle("on", !!on);
    btn.textContent = on ? "↙" : "⛶";
    btn.setAttribute("title", on ? "Выйти из полного экрана (F11)" : "Полный экран (F11)");
    btn.setAttribute("aria-label", on ? "Выйти из полного экрана" : "Полный экран");
  }

  async function toggleAppFullscreen(force) {
    const want = force == null ? !state.appFullscreen : !!force;
    if (state.desktop) {
      try {
        const res = await apiPost("/api/window/fullscreen", { on: want });
        if (res.ok) {
          syncAppFullscreen(!!res.fullscreen);
          return;
        }
      } catch {
        /* окно в браузере — ниже обычный полный экран страницы */
      }
    }
    try {
      if (!want && (pageFullscreenOn() || document.fullscreenElement || document.webkitFullscreenElement)) {
        if (cloudFullscreenOn()) {
          await toggleCloudFullscreen(false);
          return;
        }
        const exit = document.exitFullscreen || document.webkitExitFullscreen;
        if (exit) await exit.call(document);
      } else if (want && !pageFullscreenOn()) {
        const el = document.documentElement;
        const enter = el.requestFullscreen || el.webkitRequestFullscreen;
        if (enter) await enter.call(el);
      }
    } catch {
      toast("Полноэкранный режим недоступен");
    }
    syncAppFullscreen(pageFullscreenOn());
  }

  function openHelp() {
    $("help-modal").classList.add("open");
  }

  function closeLineMenu() {
    const menu = $("line-menu");
    if (menu) menu.hidden = true;
  }

  function onLineContextMenu(e) {
    const grip = e.target.closest(".line-drag");
    if (!grip) return;
    const tr = grip.closest("tr[data-line]");
    const card = tr?.closest("[data-order]");
    const order = findOrder(card?.dataset.order);
    const line = order?.lines?.find((item) => item.id === tr.dataset.line);
    const menu = $("line-menu");
    const btn = $("line-menu-freeze");
    if (!line || !menu || !btn) return;
    e.preventDefault();
    e.stopPropagation();
    menu.dataset.order = order.id;
    menu.dataset.line = line.id;
    btn.textContent = isFrozenLine(line) ? "Вернуть в заказ" : "Заморозить позицию";
    menu.hidden = false;
    const x = Math.min(e.clientX, window.innerWidth - 250);
    const y = Math.min(e.clientY, window.innerHeight - 60);
    menu.style.left = `${Math.max(8, x)}px`;
    menu.style.top = `${Math.max(8, y)}px`;
  }

  function toggleLineFrozen() {
    const menu = $("line-menu");
    const order = findOrder(menu?.dataset.order);
    const line = order?.lines?.find((item) => item.id === menu?.dataset.line);
    closeLineMenu();
    if (!line) return;
    historyCommit();
    line.frozen = !isFrozenLine(line);
    markDirty();
    renderOrders();
    toast(line.frozen ? "Позиция заморожена" : "Позиция снова в заказе");
  }

  function onOrderClick(e) {
    const act = e.target.dataset.act || e.target.closest("button")?.dataset.act;
    if (!act) return;
    const card = e.target.closest("[data-order]");
    const order = findOrder(card.dataset.order);
    if (act === "notes") {
      const panel = card.querySelector(".order-notes");
      const btn = card.querySelector(".note-btn");
      const open = !panel.classList.contains("open");
      panel.classList.toggle("open", open);
      btn.classList.toggle("open", open);
      if (open) requestAnimationFrame(() => panel.querySelector("textarea")?.focus());
      return;
    }
    if (act === "work-start-today" || act === "work-end-today") {
      setWorkToday(order, act === "work-start-today" ? "start" : "end");
      markDirty();
      renderOrders();
      return;
    }
    if (act === "share") {
      openShare(order);
      return;
    }
    if (act === "payall") {
      (order.lines || []).forEach((line) => {
        if (isFrozenLine(line) || isExpenseLine(line)) return;
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
      historyCommit();
      state.doc.orders = state.doc.orders.filter((o) => o.id !== order.id);
      markDirty();
      renderOrders();
      undoToast(`Заказ ${order.number || ""} удалён`.trim());
    }
    if (act === "dupline") {
      const tr = e.target.closest("[data-line]");
      const idx = order.lines.findIndex((l) => l.id === tr?.dataset.line);
      if (idx < 0) return;
      const copy = JSON.parse(JSON.stringify(order.lines[idx]));
      copy.id = uid();
      copy.frozen = false;
      order.lines.splice(idx + 1, 0, copy);
      markDirty();
      renderOrders();
      requestAnimationFrame(() => focusLineCell(copy.id, 2));
      return;
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
      addOrderLine(order);
    }
    if (act === "addcost") {
      addExpenseLine(order);
      return;
    }
    if (act === "delline") {
      const id = e.target.closest("[data-line]").dataset.line;
      if (order.lines.length <= 1) {
        toast("У заказа должна остаться хотя бы одна позиция. Удалите заказ целиком, если он не нужен.");
        return;
      }
      historyCommit();
      order.lines = order.lines.filter((l) => l.id !== id);
      markDirty();
      renderOrders();
      undoToast("Строка удалена");
    }
  }

  /* ========== Управление с телефона ========== */

  const remote = {
    enabled: false,
    url: "",
    version: 0,
    cid: `desktop-${Math.random().toString(16).slice(2, 8)}`,
    lastCommand: 0,
    lastNav: 0,
    docVersion: 0,
    publishTimer: null,
    polling: false,
    applying: false,
    origin: "",
    deferred: null,
    deferredOrigin: "",
    clients: [],
  };

  const NET_KIND = {
    session: "сессия",
    client: "клиент",
    sync: "синхр.",
    command: "команда",
    nav: "навиг.",
    http: "http",
    telegram: "telegram",
    ngrok: "ngrok",
  };

  const netConsole = { lastId: 0, timer: 0, stick: true, drag: null };
  const NET_CONSOLE_MIN_W = 280;
  const NET_CONSOLE_MIN_H = 160;

  function netConsoleOpen() {
    return !!$("net-console") && !$("net-console").hidden;
  }

  function loadNetConsoleSize() {
    try {
      const raw = JSON.parse(localStorage.getItem(LS_NET_CONSOLE) || "null");
      const w = Number(raw?.w);
      const h = Number(raw?.h);
      if (!Number.isFinite(w) || !Number.isFinite(h)) return null;
      if (Math.round(w) === 440) w = 880;
      return { w, h };
    } catch {
      return null;
    }
  }

  function clampNetConsoleSize(w, h) {
    const maxW = Math.max(NET_CONSOLE_MIN_W, window.innerWidth - 24);
    const maxH = Math.max(NET_CONSOLE_MIN_H, window.innerHeight - 24);
    return {
      w: Math.min(maxW, Math.max(NET_CONSOLE_MIN_W, Math.round(w))),
      h: Math.min(maxH, Math.max(NET_CONSOLE_MIN_H, Math.round(h))),
    };
  }

  function applyNetConsoleSize(box) {
    const el = box || $("net-console");
    if (!el) return;
    const saved = loadNetConsoleSize();
    if (!saved) return;
    const { w, h } = clampNetConsoleSize(saved.w, saved.h);
    el.style.width = `${w}px`;
    el.style.height = `${h}px`;
  }

  function persistNetConsoleSize(box) {
    const el = box || $("net-console");
    if (!el) return;
    const r = el.getBoundingClientRect();
    const { w, h } = clampNetConsoleSize(r.width, r.height);
    try {
      localStorage.setItem(LS_NET_CONSOLE, JSON.stringify({ w, h }));
    } catch {
      /* ignore */
    }
  }

  function toggleNetConsole(force) {
    const show = force == null ? !netConsoleOpen() : !!force;
    if (show) openNetConsole();
    else closeNetConsole();
  }

  function openNetConsole() {
    const box = $("net-console");
    if (!box) return;
    box.hidden = false;
    applyNetConsoleSize(box);
    $("remote-console-open")?.classList.add("on");
    if (!netConsole.timer) netConsole.timer = setInterval(() => pollNetConsole(), 800);
    pollNetConsole(true);
  }

  function closeNetConsole() {
    const box = $("net-console");
    if (box) box.hidden = true;
    $("remote-console-open")?.classList.remove("on");
    if (netConsole.timer) clearInterval(netConsole.timer);
    netConsole.timer = 0;
  }

  function formatNetTime(ts) {
    const d = new Date((Number(ts) || 0) * 1000);
    if (!Number.isFinite(d.getTime())) return "—";
    return d.toLocaleTimeString("ru-RU", { hour12: false });
  }

  function appendNetConsoleEvents(events) {
    const log = $("net-console-log");
    const empty = $("net-console-empty");
    if (!log) return;
    if (events.length && empty) empty.hidden = true;
    const body = $("net-console-body");
    const stick = netConsole.stick || (body && body.scrollHeight - body.scrollTop - body.clientHeight < 28);
    events.forEach((ev) => {
      const row = document.createElement("div");
      row.className = `nc-row ${ev.level || "info"}`;
      const src = ev.source ? ` <span class="nc-src">${esc(ev.source)}</span>` : "";
      row.innerHTML = `<span class="nc-time">${esc(formatNetTime(ev.ts))}</span><span class="nc-kind">${esc(
        NET_KIND[ev.kind] || ev.kind || ""
      )}</span><span class="nc-text">${esc(ev.text || "")}${src}</span>`;
      log.appendChild(row);
    });
    while (log.children.length > 500) log.removeChild(log.firstChild);
    if (stick && body) body.scrollTop = body.scrollHeight;
  }

  async function pollNetConsole(reset) {
    if (!netConsoleOpen()) return;
    try {
      if (reset) {
        netConsole.lastId = 0;
        const log = $("net-console-log");
        if (log) log.innerHTML = "";
        const empty = $("net-console-empty");
        if (empty) empty.hidden = false;
      }
      const data = await apiGet(`/api/remote/log?since=${netConsole.lastId}`);
      const events = data.events || [];
      if (events.length) appendNetConsoleEvents(events);
      if (typeof data.last_id === "number") netConsole.lastId = data.last_id;
      const empty = $("net-console-empty");
      if (empty && $("net-console-log")?.children.length) empty.hidden = true;
    } catch {
      /* консоль только с компьютера */
    }
  }

  function bindNetConsole() {
    $("remote-console-open")?.addEventListener("click", () => toggleNetConsole(true));
    $("net-console-close")?.addEventListener("click", () => closeNetConsole());
    $("net-console-clear")?.addEventListener("click", async () => {
      try {
        await apiPost("/api/remote/log/clear", {});
      } catch {
        /* ignore */
      }
      pollNetConsole(true);
    });
    $("net-console-body")?.addEventListener("scroll", () => {
      const body = $("net-console-body");
      if (!body) return;
      netConsole.stick = body.scrollHeight - body.scrollTop - body.clientHeight < 36;
    });
    const box = $("net-console");
    const head = $("net-console-head");
    const grip = $("net-console-resize");
    if (!box || !head) return;
    applyNetConsoleSize(box);
    head.addEventListener("pointerdown", (e) => {
      if (e.button !== 0 || e.target.closest("button")) return;
      e.preventDefault();
      const r = box.getBoundingClientRect();
      netConsole.drag = { kind: "move", dx: e.clientX - r.left, dy: e.clientY - r.top };
      head.setPointerCapture(e.pointerId);
    });
    grip?.addEventListener("pointerdown", (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      e.stopPropagation();
      const r = box.getBoundingClientRect();
      netConsole.drag = { kind: "resize", x: e.clientX, y: e.clientY, w: r.width, h: r.height };
      grip.setPointerCapture(e.pointerId);
    });
    const onMove = (e) => {
      const drag = netConsole.drag;
      if (!drag) return;
      if (drag.kind === "move") {
        const x = Math.max(8, Math.min(window.innerWidth - 80, e.clientX - drag.dx));
        const y = Math.max(8, Math.min(window.innerHeight - 40, e.clientY - drag.dy));
        box.style.left = `${x}px`;
        box.style.top = `${y}px`;
        box.style.right = "auto";
        box.style.bottom = "auto";
      } else {
        const next = clampNetConsoleSize(drag.w + e.clientX - drag.x, drag.h + e.clientY - drag.y);
        box.style.width = `${next.w}px`;
        box.style.height = `${next.h}px`;
      }
    };
    const onUp = () => {
      if (netConsole.drag?.kind === "resize") persistNetConsoleSize(box);
      netConsole.drag = null;
    };
    head.addEventListener("pointermove", onMove);
    head.addEventListener("pointerup", onUp);
    grip?.addEventListener("pointermove", onMove);
    grip?.addEventListener("pointerup", onUp);
  }

  function remoteWatchStart() {
    if (remote.watch) return;
    const tick = async () => {
      if (!$("remote-modal")?.classList.contains("open")) {
        remoteWatchStop();
        return;
      }
      if (!state.desktop) return;
      try {
        applyRemotePayload(await apiGet("/api/remote/info"));
        renderRemoteLive();
      } catch {
        renderRemoteLive();
      }
    };
    remote.watch = setInterval(tick, 2000);
    tick();
  }

  function remoteWatchStop() {
    if (remote.watch) clearInterval(remote.watch);
    remote.watch = 0;
  }

  function remoteBadge() {
    const phones = remote.clients?.filter((c) => c.kind === "mobile").length || 0;
    document.querySelectorAll(".phone-live").forEach((live) => {
      live.hidden = !remote.enabled;
      live.textContent = phones ? String(phones) : "";
      live.classList.toggle("idle", remote.enabled && !phones);
    });
    document.querySelectorAll(".phone-btn").forEach((btn) => btn.classList.toggle("on", remote.enabled));
  }

  function applyRemotePayload(data) {
    if (!data) return;
    if (typeof data.enabled === "boolean") remote.enabled = data.enabled;
    if (data.url) remote.url = data.url;
    if (data.ip) remote.ip = data.ip;
    if (data.ips) remote.ips = data.ips;
    if (typeof data.version === "number") remote.version = data.version;
    if (Array.isArray(data.clients)) remote.clients = data.clients;
    if (Array.isArray(data.devices)) remote.devices = data.devices;
    if (typeof data.autostart === "boolean") remote.autostart = data.autostart;
    if (data.qr) remote.qr = data.qr;
    if (data.lan_url) remote.lan_url = data.lan_url;
    if ("public_url" in data) remote.public_url = data.public_url || "";
    if (data.via) remote.via = data.via;
    if (typeof data.ngrok === "boolean") remote.ngrok = data.ngrok;
    if (typeof data.ngrok_ready === "boolean") remote.ngrokReady = data.ngrok_ready;
    if (typeof data.ngrok_installed === "boolean") remote.ngrokInstalled = data.ngrok_installed;
    if (data.tunnel) remote.tunnel = data.tunnel;
    if (typeof data.telegram_ready === "boolean") remote.telegramReady = data.telegram_ready;
    if ("telegram_chat_id" in data) remote.telegramChatId = data.telegram_chat_id || "";
    if (typeof data.telegram_listening === "boolean") remote.telegramListening = data.telegram_listening;
    if ("telegram_error" in data) remote.telegramError = data.telegram_error || "";
  }

  function renderRemoteIps() {
    const box = $("remote-ips");
    if (!box) return;
    const list = remote.ips || [];
    const chips = [];
    if (remote.public_url) {
      chips.push(`<button type="button" data-via="ngrok" class="${remote.via === "ngrok" ? "active" : ""}">Интернет</button>`);
    }
    list.forEach((ip) => {
      chips.push(`<button type="button" data-ip="${ip}" class="${remote.via !== "ngrok" && ip === remote.ip ? "active" : ""}">${ip}</button>`);
    });
    box.hidden = chips.length < 2 && !remote.public_url;
    box.innerHTML = chips.join("");
  }

  function mobileClients() {
    return (remote.clients || []).filter((c) => c.kind === "mobile");
  }

  function renderRemoteLive() {
    const phones = mobileClients();
    const stateText = $("remote-state-text");
    const stateBox = $("remote-state");
    if (stateBox && stateText) {
      if (remote.enabled) {
        stateBox.classList.add("on");
        if (phones.length) {
          const names = phones.map((c) => c.name || "Телефон").slice(0, 3).join(", ");
          stateText.textContent =
            phones.length === 1 ? `В сети: ${names}` : `В сети ${phones.length}: ${names}`;
        } else {
          stateText.textContent = "Доступ включён — устройств в сети нет";
        }
      } else {
        stateBox.classList.remove("on");
        stateText.textContent = "Доступ выключен";
      }
    }
    if (remote.enabled) {
      $("remote-start") && ($("remote-start").hidden = true);
      $("remote-stop") && ($("remote-stop").hidden = false);
    } else {
      $("remote-start") && ($("remote-start").hidden = false);
      $("remote-stop") && ($("remote-stop").hidden = true);
    }
    renderRemoteDevices();
    remoteBadge();
  }

  function setTokenDot(id, { state: mark, title }) {
    const dot = $(id);
    if (!dot) return;
    dot.className = `token-dot${mark ? ` ${mark}` : ""}`;
    dot.setAttribute("title", title);
  }

  function renderTokenDots() {
    if (!remote.ngrokReady) {
      setTokenDot("ngrok-token-dot", { state: "", title: "Токен ngrok не сохранён" });
    } else if (remote.ngrok && remote.tunnel?.error) {
      setTokenDot("ngrok-token-dot", { state: "err", title: `Токен сохранён, ошибка туннеля: ${remote.tunnel.error}` });
    } else if (remote.public_url) {
      setTokenDot("ngrok-token-dot", { state: "live", title: "Токен сохранён, туннель работает" });
    } else {
      setTokenDot("ngrok-token-dot", { state: "on", title: "Токен ngrok сохранён" });
    }

    if (!remote.telegramReady) {
      setTokenDot("tg-token-dot", { state: "", title: "Токен Telegram-бота не сохранён" });
    } else if (remote.telegramError) {
      setTokenDot("tg-token-dot", { state: "err", title: `Токен сохранён, ошибка: ${remote.telegramError}` });
    } else if (remote.telegramListening) {
      setTokenDot("tg-token-dot", { state: "live", title: "Токен сохранён, бот слушает" });
    } else {
      setTokenDot("tg-token-dot", { state: "on", title: "Токен Telegram-бота сохранён" });
    }
  }

  function renderRemoteDevices() {
    const box = $("remote-clients");
    if (!box) return;
    const live = new Map(mobileClients().map((c) => [c.id, c]));
    const devices = remote.devices || [];
    const online = devices.filter((d) => live.has(d.id)).length;
    const title = $("remote-devices-title");
    if (title) {
      if (!devices.length) title.textContent = "Устройства";
      else if (online) title.textContent = `Устройства · ${devices.length} · в сети ${online}`;
      else title.textContent = `Устройства · ${devices.length}`;
    }
    if (!devices.length) {
      box.innerHTML = `<div class="remote-empty">Запомненных устройств нет — отсканируйте QR или откройте ссылку с телефона.</div>`;
      return;
    }
    box.innerHTML = devices
      .map((d) => {
        const on = live.has(d.id);
        const when = d.seen_at ? new Date(d.seen_at).toLocaleString("ru-RU") : "";
        const model = d.info?.model && d.info.model !== d.name ? d.info.model : "";
        return `<div class="remote-device ${on ? "is-on" : "is-off"}">
          <span class="rd-dot" title="${on ? "в сети" : "не в сети"}"></span>
          <div class="rd-body">
            <strong>${esc(d.name || "Телефон")}</strong>
            <small>${on ? '<span class="online">в сети</span>' : '<span class="offline">не в сети</span>'}${
              d.ip ? ` · ${esc(d.ip)}` : ""
            }${model ? ` · ${esc(model)}` : ""}${when ? ` · ${esc(when)}` : ""}</small>
          </div>
          <button type="button" class="btn small rd-info" data-device-info="${esc(d.id)}" title="О устройстве" aria-label="О устройстве">i</button>
          <button type="button" class="btn small" data-forget="${esc(d.id)}">Забыть</button>
        </div>`;
      })
      .join("");
  }

  function deviceInfoRows(device, online) {
    const info = device.info || {};
    const when = device.seen_at ? new Date(device.seen_at).toLocaleString("ru-RU") : "—";
    return [
      ["Имя", device.name || "Телефон"],
      ["Статус", online ? "в сети" : "не в сети"],
      ["Адрес", device.ip || "—"],
      ["Был в сети", when],
      ["Модель", info.model],
      ["Система", [info.platform, info.platform_version].filter(Boolean).join(" ")],
      ["Браузер", info.brands],
      ["Язык", info.language],
      ["Экран", info.screen],
      ["Окно", info.viewport],
      ["Плотность", info.pixel_ratio],
      ["Часовой пояс", info.timezone],
      ["User-Agent", info.user_agent],
    ].filter(([, value]) => value);
  }

  function openDeviceInfo(id) {
    const device = (remote.devices || []).find((d) => d.id === id);
    if (!device) return;
    const online = mobileClients().some((c) => c.id === id);
    const body = $("device-info-body");
    const title = $("device-info-title");
    if (title) title.textContent = device.name || "Устройство";
    if (body) {
      body.innerHTML = deviceInfoRows(device, online)
        .map(([label, value]) => `<div class="device-info-row"><span>${esc(label)}</span><b>${esc(value)}</b></div>`)
        .join("");
    }
    $("device-info-modal")?.classList.add("open");
  }

  function renderRemoteModal(data) {
    applyRemotePayload(data);
    const qrBox = $("remote-qr");
    if (remote.qr) qrBox.innerHTML = remote.qr;
    else if (!remote.enabled) qrBox.innerHTML = '<div class="remote-qr-empty">Сессия не запущена</div>';
    $("remote-url").textContent = remote.url || "—";
    renderRemoteIps();
    const auto = $("remote-autostart");
    if (auto) auto.checked = !!remote.autostart;
    const ngrokChk = $("remote-ngrok");
    if (ngrokChk) ngrokChk.checked = !!remote.ngrok;
    const tokenInput = $("remote-ngrok-token");
    if (tokenInput && remote.ngrokReady && !tokenInput.value) tokenInput.placeholder = "токен сохранён — можно не вводить заново";
    const tgToken = $("remote-tg-token");
    if (tgToken && remote.telegramReady && !tgToken.value) tgToken.placeholder = "токен сохранён — можно не вводить заново";
    const tgChat = $("remote-tg-chat");
    if (tgChat && remote.telegramChatId && !tgChat.value) tgChat.value = remote.telegramChatId;
    renderTokenDots();
    const tgStatus = $("remote-tg-status");
    if (tgStatus && !tgStatus.dataset.hold) {
      tgStatus.className = "remote-ngrok-status";
      if (remote.telegramError) {
        tgStatus.classList.add("err");
        tgStatus.textContent = remote.telegramError;
      } else if (remote.telegramListening) {
        tgStatus.classList.add("ok");
        tgStatus.textContent = "Бот слушает. Напишите /start — отчёты, заказы, снимки и ссылка на телефон.";
      } else if (remote.telegramReady) {
        tgStatus.textContent = "Токен сохранён. Нажмите «Запомнить токен», если бот ещё не отвечает.";
      } else {
        tgStatus.textContent = "Вставьте токен от @BotFather и нажмите «Запомнить токен».";
      }
    }
    const ngrokStatus = $("remote-ngrok-status");
    if (ngrokStatus) {
      const tun = remote.tunnel || {};
      ngrokStatus.className = "remote-ngrok-status";
      if (!remote.ngrok) ngrokStatus.textContent = "";
      else if (tun.error) {
        ngrokStatus.classList.add("err");
        ngrokStatus.textContent = tun.error;
      } else if (remote.public_url) {
        ngrokStatus.classList.add("ok");
        ngrokStatus.textContent = "Туннель открыт. Сканируйте QR или сохраните ссылку в закладки — работает из любой сети.";
      } else if (!remote.ngrokInstalled) {
        ngrokStatus.classList.add("err");
        ngrokStatus.textContent = "ngrok не установлен. Скачайте с ngrok.com и добавьте в PATH.";
      } else {
        ngrokStatus.textContent = "Туннель ещё не поднят — сохраните токен и включите доступ.";
      }
    }
    renderRemoteLive();
  }

  async function remoteStart() {
    if (!state.desktop) {
      toast("Удалённый доступ работает только в приложении на компьютере");
      return;
    }
    try {
      const data = await apiPost("/api/remote/start", { document: state.doc, path: state.path, dirty: state.dirty });
      renderRemoteModal(data);
      toast("Доступ с телефона включён — ссылка постоянная");
      if (!remote.polling) remotePoll();
    } catch (err) {
      toast(`Не удалось включить доступ: ${err.message || err}`);
    }
  }

  async function persistRemoteSecrets() {
    const ngrokToken = $("remote-ngrok-token")?.value?.trim() || "";
    const tgToken = $("remote-tg-token")?.value?.trim() || "";
    const tgChat = $("remote-tg-chat")?.value?.trim() || "";
    try {
      if (ngrokToken) await apiPost("/api/remote/ngrok", { authtoken: ngrokToken });
      if (tgToken || tgChat) {
        const payload = {};
        if (tgToken) payload.token = tgToken;
        if (tgChat) payload.chat_id = tgChat;
        await apiPost("/api/remote/telegram", payload);
      }
    } catch {
      /* токены уже на диске или поля пустые */
    }
  }

  async function remoteStop() {
    await persistRemoteSecrets();
    try {
      const data = await apiPost("/api/remote/stop", {});
      renderRemoteModal(data);
    } catch {
      remote.enabled = false;
      renderRemoteModal();
    }
    toast("Доступ с телефона выключен");
  }

  function remotePublish() {
    if (!remote.enabled || !state.desktop || !state.doc || remote.applying) return;
    clearTimeout(remote.publishTimer);
    remote.publishTimer = setTimeout(async () => {
      try {
        const res = await apiPost("/api/remote/publish", {
          document: state.doc,
          path: state.path,
          dirty: state.dirty,
          history: historyMeta(),
        });
        if (res.version) remote.version = res.version;
      } catch {
        /* телефон переподключится сам */
      }
    }, 250);
  }

  async function remotePoll() {
    remote.polling = true;
    while (remote.enabled) {
      try {
        const data = await apiGet(`/api/remote/pull?since=${remote.version}&cid=${remote.cid}&kind=desktop`);
        if (data.enabled === false) break;
        if (typeof data.version === "number") remote.version = data.version;
        if (Array.isArray(data.clients)) remote.clients = data.clients;
        if (Array.isArray(data.devices)) remote.devices = data.devices;
        if ($("remote-modal")?.classList.contains("open")) renderRemoteLive();
        else remoteBadge();
        if (typeof data.doc_version === "number" && data.origin === "desktop") remote.docVersion = data.doc_version;
        if (data.command && data.command.id > remote.lastCommand) {
          remote.lastCommand = data.command.id;
          await runRemoteCommand(data.command);
        } else if (
          data.changed &&
          data.document &&
          data.origin &&
          data.origin !== "desktop" &&
          (data.doc_version || 0) > remote.docVersion
        ) {
          remote.docVersion = data.doc_version || 0;
          applyRemoteDoc(data.document, data.origin);
        }
        if (typeof data.autosave === "boolean") applyRemoteAutosave(data.autosave);
        if (data.nav && data.nav.seq > remote.lastNav) {
          remote.lastNav = data.nav.seq;
          applyRemoteNav(data.nav);
        }
        applyRemoteLists(data);
      } catch {
        await new Promise((r) => setTimeout(r, 2000));
      }
    }
    remote.polling = false;
  }

  function applyRemoteAutosave(enabled) {
    if (typeof enabled !== "boolean") return;
    const el = $("autosave");
    if (el) el.checked = enabled;
    if (state.autosave === enabled) return;
    state.autosave = enabled;
    if (enabled) scheduleAutosave();
    else clearTimeout(state.autosaveTimer);
  }

  function revealRemoteWorkspace() {
    if (!state.doc) return false;
    if ($("app-shell")?.hidden) showApp();
    return true;
  }

  function applyRemoteDoc(doc, origin) {
    const active = document.activeElement;
    const typing = active && /^(INPUT|SELECT|TEXTAREA)$/.test(active.tagName);
    if (typing) {
      remote.deferred = doc;
      remote.deferredOrigin = origin;
      return;
    }
    historyCommit();
    remote.applying = true;
    remote.origin = origin || "";
    state.doc = doc;
    state.dirty = true;
    historyCommit("Правка", { source: "mobile", device: remoteDeviceName(origin) });
    showApp();
    renderAll();
    syncDirty();
    remote.applying = false;
    scheduleAutosave();
    toast("Изменения с телефона применены");
  }

  function showCloudOverview() {
    state.focusOrderId = null;
    state.focusLineId = null;
    if (state.view !== "cloud" || !orderCloud) return;
    orderCloud.select(null);
    orderCloud.fit();
  }

  function applyRemoteNav(nav) {
    if (!nav || !nav.view) return;
    if (nav.view === "files") {
      showGalaxyCatalog();
      if (!state.doc || $("app-shell")?.hidden) renderStartLists();
      return;
    }
    if (!revealRemoteWorkspace()) return;
    if (nav.view === "order" && nav.order_id) {
      const order = (state.doc.orders || []).find((o) => o.id === nav.order_id);
      if (!order) return;
      state.remoteStats = null;
      const sameOrder = state.focusOrderId === order.id;
      setFocusOrder(order.id, nav.line_id || "");
      if (!sameOrder) toast(`Телефон открыл заказ №${order.number || "—"}`);
      return;
    }
    const hadFocus = !!state.focusOrderId;
    if (nav.view === "calendar") {
      state.remoteStats = null;
      setView("calendar");
      return;
    }
    if (state.view === "cloud") {
      if (cloudState().catalog) {
        cloudState().catalog = false;
        renderCloud();
      }
      if (nav.view === "stats") {
        const next = {
          period: nav.period || "all",
          filter: nav.filter || "all",
          status: nav.status || "",
        };
        const changed = JSON.stringify(state.remoteStats) !== JSON.stringify(next);
        state.remoteStats = next;
        showCloudOverview();
        if (changed && remoteStatsActive()) toast(`Сводка с телефона: ${remoteStatsLabel()}`);
        return;
      }
      showCloudOverview();
      state.remoteStats = null;
      return;
    }
    state.focusOrderId = null;
    state.focusLineId = null;
    if (nav.view === "stats") {
      const next = {
        period: nav.period || "all",
        filter: nav.filter || "all",
        status: nav.status || "",
      };
      const changed = JSON.stringify(state.remoteStats) !== JSON.stringify(next);
      state.remoteStats = next;
      if (state.view === "dashboard") renderDashboard();
      else setView("dashboard");
      if (changed && remoteStatsActive()) toast(`Сводка с телефона: ${remoteStatsLabel()}`);
      return;
    }
    state.remoteStats = null;
    if (nav.view === "calendar") setView("calendar");
    else if (nav.view === "orders") setView("orders");
    else if (nav.view === "snapshot") setView("dashboard");
    else if (hadFocus && state.view === "dashboard") renderDashboard();
    else if (state.view === "dashboard") renderDashboard();
  }

  function flushRemoteDoc() {
    if (!remote.deferred) return;
    const doc = remote.deferred;
    remote.deferred = null;
    const origin = remote.deferredOrigin;
    remote.deferredOrigin = "";
    applyRemoteDoc(doc, origin);
  }

  async function runRemoteCommand(cmd) {
    if (cmd.type === "save") {
      const ok = await save({ silent: true });
      toast(ok ? "Отчёт сохранён с телефона" : "Телефон просил сохранить — укажите файл на компьютере");
      if (!ok) await save();
    } else if (cmd.type === "open" && cmd.path) {
      await openPath(cmd.path, { keepView: true });
      toast("Отчёт открыт по команде с телефона");
    } else if (cmd.type === "undo" || cmd.type === "redo") {
      const back = cmd.type === "undo";
      const ok = historyGo(back ? -1 : 1);
      if (ok) toast(back ? "Действие отменено с телефона" : "Действие возвращено с телефона");
    } else if (cmd.type === "history_jump") {
      const ok = historyJump(String(cmd.id || ""));
      if (ok) toast("Снимок восстановлен с телефона");
    } else if (cmd.type === "history_limit") {
      history.limit = clampHistoryLimit(cmd.limit);
      const extra = history.stack.length - history.limit;
      if (extra > 0) {
        history.stack = history.stack.slice(extra);
        history.index = Math.max(0, history.index - extra);
      }
      updateHistoryButtons();
      persistHistorySoon();
      toast(`Хранить снимков: ${history.limit}`);
    } else if (cmd.type === "new") {
      const stay = !!state.view && $("app-shell") && !$("app-shell").hidden;
      const view = stay ? state.view : "dashboard";
      state.doc = emptyDoc();
      state.focusOrderId = null;
      state.focusLineId = null;
      persistCloudPrefs();
      persistChartPrefs();
      state.path = "";
      historyReset("Новый отчёт");
      setClean();
      showApp();
      setView(view);
      if (view === "cloud") showCloudOverview();
      toast("Новый отчёт создан с телефона");
    } else if (cmd.type === "delete") {
      applyRemoteLists(cmd);
      if (cmd.closed || samePath(state.path, cmd.path)) {
        discardOpenReport();
        applyRemoteLists(cmd);
        toast("Отчёт удалён");
      }
      return;
    } else if (cmd.type === "close") {
      discardOpenReport();
      toast("Отчёт удалён");
      return;
    }
    remotePublish();
  }

  function fileListsSig(library, recent) {
    const lib = (library?.items || []).map((item) => `${item.path}|${item.modified_at}|${item.bytes}|${item.orders}`).join("\n");
    const rec = (recent || []).map((item) => `${item.path}|${item.exists}|${item.opened_at}`).join("\n");
    return `${lib}#${rec}`;
  }

  function pathInLibraryFolder(path, folder) {
    if (!path || !folder) return false;
    const file = String(path).replace(/\//g, "\\").toLowerCase();
    const root = String(folder).replace(/\//g, "\\").toLowerCase().replace(/\\+$/, "");
    return file.startsWith(`${root}\\`) && file.endsWith(".fmaster");
  }

  function noteMissingOpenFile(library) {
    if (!state.path || !state.doc) return;
    const folder = library?.path || "";
    if (!pathInLibraryFolder(state.path, folder)) return;
    const there = (library?.items || []).some((item) => samePath(item.path, state.path));
    if (there) {
      state.missingFileNoted = false;
      return;
    }
    if (state.missingFileNoted) return;
    state.missingFileNoted = true;
    toast("Файл отчёта удалён или перемещён — при необходимости сохраните копию");
  }

  function applyRemoteLists(data) {
    if (!data) return false;
    const hasLib = !!data.library;
    const hasRecent = Array.isArray(data.recent);
    if (!hasLib && !hasRecent) return false;
    const library = hasLib ? data.library : state.library;
    const recent = hasRecent ? data.recent : state.recentItems || [];
    const sig = fileListsSig(library, recent);
    if (sig === state.listsSig) return false;
    state.listsSig = sig;
    if (hasLib) {
      state.library = library;
      renderLibrary(library);
    }
    if (hasRecent) {
      state.recentItems = recent;
      renderRecentItems(recent);
    }
    noteMissingOpenFile(state.library);
    refreshHistoryLibrary();
    if (cloudState().catalog && state.view === "cloud") renderGalaxyCloud();
    if ($("start-screen") && !$("start-screen").classList.contains("hidden") && startViewMode() === "galaxies") {
      renderStartGalaxies();
    }
    return true;
  }

  async function libraryWatchLoop() {
    if (!state.desktop || state.libraryWatching) return;
    state.libraryWatching = true;
    let version = 0;
    while (state.desktop) {
      try {
        const data = await apiGet(`/api/library/watch?since=${version}`);
        if (typeof data.version === "number") version = data.version;
        applyRemoteLists(data);
      } catch {
        await new Promise((r) => setTimeout(r, 2000));
      }
    }
  }

  function bindRemote() {
    bindNetConsole();
    document.querySelectorAll(".js-open-remote").forEach((btn) => {
      btn.addEventListener("click", async () => {
        $("remote-modal").classList.add("open");
        if (state.desktop) {
          try {
            renderRemoteModal(await apiGet("/api/remote/info"));
          } catch {
            renderRemoteModal();
          }
        } else {
          renderRemoteModal();
        }
        if (!remote.enabled) remoteStart();
        remoteWatchStart();
      });
    });
    const closeRemoteModal = () => {
      remoteWatchStop();
      $("remote-guide-modal")?.classList.remove("open");
      $("remote-modal")?.classList.remove("open");
    };
    $("remote-close")?.addEventListener("click", closeRemoteModal);
    $("remote-modal")?.addEventListener("click", (e) => {
      if (e.target === $("remote-modal")) closeRemoteModal();
      const head = e.target.closest(".remote-fold-head");
      if (head) head.closest(".remote-fold")?.classList.toggle("collapsed");
    });
    $("remote-ips")?.addEventListener("click", async (e) => {
      const btn = e.target.closest("[data-ip], [data-via]");
      if (!btn) return;
      try {
        const data = await apiPost("/api/remote/address", btn.dataset.via === "ngrok" ? { via: "ngrok" } : { ip: btn.dataset.ip });
        renderRemoteModal(data);
        toast(btn.dataset.via === "ngrok" ? "QR ведёт в интернет" : `Адрес переключён на ${data.ip}`);
      } catch (err) {
        toast(`Не удалось сменить адрес: ${err.message || err}`);
      }
    });
    $("remote-ngrok")?.addEventListener("change", async (e) => {
      const on = e.target.checked;
      if (on) $("remote-ngrok-box")?.closest(".remote-fold")?.classList.remove("collapsed");
      const token = $("remote-ngrok-token")?.value?.trim() || "";
      const body = { enabled: on };
      if (token) body.authtoken = token;
      try {
        if (on && !remote.enabled) await remoteStart();
        renderRemoteModal(await apiPost("/api/remote/ngrok", body));
        toast(on ? "Интернет-туннель включён" : "Интернет-туннель выключен, токен сохранён");
      } catch (err) {
        e.target.checked = !on;
        toast(err.message || String(err));
      }
    });
    const postTelegram = async (send) => {
      const status = $("remote-tg-status");
      const token = $("remote-tg-token")?.value?.trim() || "";
      const chat = $("remote-tg-chat")?.value?.trim() || "";
      if (status) {
        status.dataset.hold = "1";
        status.className = "remote-ngrok-status";
        status.textContent = send ? "Отправляю…" : "Сохраняю токен…";
      }
      try {
        if (send && !remote.enabled) await remoteStart();
        const payload = { send };
        if (token) payload.token = token;
        if (chat) payload.chat_id = chat;
        const data = await apiPost("/api/remote/telegram", payload);
        renderRemoteModal(data);
        toast(send ? "Ссылка отправлена в Telegram" : "Токен запомнен — бот будет отвечать сам");
      } catch (err) {
        if (status) {
          status.className = "remote-ngrok-status err";
          status.textContent = err.message || String(err);
        }
        toast(`Telegram: ${err.message || err}`);
      } finally {
        if (status) delete status.dataset.hold;
      }
    };
    $("remote-tg-save")?.addEventListener("click", () => postTelegram(false));
    $("remote-tg-send")?.addEventListener("click", () => postTelegram(true));
    $("remote-ngrok-save")?.addEventListener("click", async () => {
      const token = $("remote-ngrok-token")?.value?.trim() || "";
      try {
        if (!remote.enabled) await remoteStart();
        const body = { enabled: true };
        if (token) body.authtoken = token;
        const data = await apiPost("/api/remote/ngrok", body);
        renderRemoteModal(data);
        toast(data.public_url ? "Интернет-ссылка готова" : "Туннель включён");
      } catch (err) {
        toast(`ngrok: ${err.message || err}`);
        try {
          renderRemoteModal(await apiGet("/api/remote/info"));
        } catch {
          /* ignore */
        }
      }
    });
    $("remote-guide-open")?.addEventListener("click", () => $("remote-guide-modal")?.classList.add("open"));
    $("remote-guide-close")?.addEventListener("click", () => $("remote-guide-modal")?.classList.remove("open"));
    $("remote-guide-modal")?.addEventListener("click", (e) => {
      if (e.target === $("remote-guide-modal")) $("remote-guide-modal").classList.remove("open");
    });
    $("remote-start")?.addEventListener("click", remoteStart);
    $("remote-stop")?.addEventListener("click", remoteStop);
    $("remote-rotate")?.addEventListener("click", async () => {
      const ok = await askConfirm({
        title: "Новая ссылка",
        text: "Старая закладка на телефоне перестанет работать. Бот останется на связи, кнопка «Открыть» обновится сама.",
        ok: "Создать ссылку",
        cancel: "Отмена",
        danger: true,
      });
      if (!ok) return;
      try {
        const data = await apiPost("/api/remote/rotate", {});
        renderRemoteModal(data);
        toast("Ссылка обновлена — в боте нажмите «Открыть»");
      } catch (err) {
        toast(`Не удалось сменить ссылку: ${err.message || err}`);
      }
    });
    $("remote-autostart")?.addEventListener("change", async (e) => {
      if (e.target.checked) await remoteStart();
      else await remoteStop();
    });
    $("device-info-close")?.addEventListener("click", () => $("device-info-modal")?.classList.remove("open"));
    $("device-info-modal")?.addEventListener("click", (e) => {
      if (e.target === $("device-info-modal")) $("device-info-modal").classList.remove("open");
    });
    $("remote-clients")?.addEventListener("click", async (e) => {
      const info = e.target.closest("[data-device-info]");
      if (info) {
        openDeviceInfo(info.dataset.deviceInfo);
        return;
      }
      const btn = e.target.closest("[data-forget]");
      if (!btn) return;
      try {
        const res = await apiPost("/api/remote/forget", { id: btn.dataset.forget });
        remote.devices = res.devices || [];
        renderRemoteDevices();
        toast("Устройство забыто");
      } catch (err) {
        toast(`Не удалось забыть устройство: ${err.message || err}`);
      }
    });
    $("remote-copy")?.addEventListener("click", async () => {
      if (!remote.url) return;
      try {
        if (state.desktop) await apiPost("/api/clipboard-text", { text: remote.url });
        else await navigator.clipboard.writeText(remote.url);
        toast("Ссылка скопирована");
      } catch {
        toast("Не удалось скопировать ссылку");
      }
    });
    document.addEventListener("focusout", () => setTimeout(flushRemoteDoc, 150));
  }

  async function boot() {
    try {
      bind();
      bindRemote();
    } catch (err) {
      console.error(err);
    }
    try {
      const bootData = await apiGet("/api/bootstrap");
      state.desktop = true;
      state.autosave = !!bootData.autosave;
      applyTheme(bootData.theme || "light", false);
      await renderStartLists(bootData);
      libraryWatchLoop();
      await apiPost("/api/dirty", { dirty: false });
      if (bootData.remote) {
        applyRemotePayload(bootData.remote);
        remoteBadge();
        if (remote.enabled && !remote.polling) remotePoll();
      }
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
