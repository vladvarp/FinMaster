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
    productCatalogTab: "order",
  };

  const LS_NET_CONSOLE = "finmaster.netconsole";
  const LS_START_VIEW = "finmaster.startView";
  const LS_CHARTS = "finmaster.charts";
  /** localStorage окна программы не переживает перезапуск — эти ключи дублируются в config.json. */
  const LS_CAL_FOLLOW = "finmaster.calFollow";
  const LS_CAL_HIDE_PAUSE = "finmaster.calHidePause";
  const LS_REPORT_VIEWS = "finmaster.reportViews";
  const REPORT_VIEWS = new Set(["orders", "dashboard", "analytics", "cashflow", "forecast", "calendar", "calculator", "presentation", "cloud", "vault", "customers", "catalogs"]);
  const SYNCED_PREFS = {
    "finmaster.shareProfiles": "share_profiles",
    "finmaster.pdfProfiles": "pdf_profiles",
    "finmaster.sharePdf": "share_pdf",
    "finmaster.shareGrand": "share_grand",
    "finmaster.formulaProfiles": "formula_profiles",
    [LS_CAL_FOLLOW]: "cal_follow",
    [LS_CAL_HIDE_PAUSE]: "cal_hide_pause",
    [LS_REPORT_VIEWS]: "report_views",
  };
  const prefTimers = {};
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
      if (JSON.stringify(a.ui?.vault || {}) !== JSON.stringify(b.ui?.vault || {})) return "Хранилище";
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
    if (!state.doc || history.busy || state.preview) return null;
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
    if (state.preview) {
      toast("Резервная копия только для просмотра. Сохраните её как отчёт.");
      return false;
    }
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

  function renderBackupList(data) {
    const box = $("backup-list");
    const sum = $("backup-sum");
    const make = $("backup-create");
    if (make) make.disabled = !!data.preview || !state.path || String(state.path).toLowerCase().endsWith(".fbak");
    if (sum) {
      const n = (data.items || []).length;
      const id = data.id ? String(data.id).slice(0, 8) : "нет номера";
      sum.textContent = data.id
        ? `${data.root || ""} · номер ${id} · ${n} ${n === 1 ? "копия" : "копий"}`
        : "Сначала сохраните отчёт — копии привязываются к его номеру, а не к названию.";
    }
    if (!box) return;
    const rows = data.items || [];
    if (!data.id) {
      box.innerHTML = `<div class="empty">У несохранённого отчёта копий ещё нет.</div>`;
      return;
    }
    if (!rows.length) {
      box.innerHTML = `<div class="empty">Копий пока нет. Нажмите «Создать копию».</div>`;
      return;
    }
    box.innerHTML = `<table class="data hist-lib-table"><thead><tr>
      <th>Когда</th><th>Название</th><th>Файл</th><th>Размер</th><th></th>
    </tr></thead><tbody>${rows
      .map(
        (row) => `<tr>
          <td>${esc(historyTime(row.at))}</td>
          <td>${esc(row.title || "Отчёт")}</td>
          <td class="hist-lib-path">${esc(row.name)}</td>
          <td>${esc(fmtBytes(row.bytes))}</td>
          <td class="backup-actions">
            <button class="btn small" type="button" data-bak-open="${esc(row.path)}">Смотреть</button>
            <button class="btn small danger" type="button" data-bak-del="${esc(row.name)}">Удалить</button>
          </td>
        </tr>`
      )
      .join("")}</tbody></table>`;
  }

  async function openBackupLibrary() {
    toggleHistoryPanel(false);
    if (!state.desktop) {
      toast("Резервные копии доступны в программе на компьютере");
      return;
    }
    if (!state.doc) return;
    $("backup-modal")?.classList.add("open");
    try {
      const data = await apiPost("/api/backups", { path: state.path || "", document: state.doc });
      if (data.id && state.doc && !state.preview && state.doc.id !== data.id) state.doc.id = data.id;
      renderBackupList(data);
    } catch (err) {
      renderBackupList({ id: "", items: [] });
      toast(err.message || String(err));
    }
  }

  async function createReportBackup() {
    if (state.preview) {
      toast("Сначала сохраните эту копию как отчёт.");
      return;
    }
    try {
      const data = await apiPost("/api/backups/create", { path: state.path || "", document: state.doc });
      if (data.id && state.doc) state.doc.id = data.id;
      renderBackupList(data);
      toast("Резервная копия создана");
    } catch (err) {
      toast(err.message || String(err));
    }
  }

  async function deleteReportBackup(name) {
    const ok = await askConfirm({
      title: "Удалить резервную копию?",
      text: `Файл «${name}» попадёт в корзину. Сам отчёт останется.`,
      ok: "Удалить",
      danger: true,
    });
    if (!ok) return;
    try {
      const data = await apiPost("/api/backups/delete", {
        id: state.doc?.id || "",
        name,
        path: state.path || "",
        document: state.doc,
      });
      renderBackupList(data);
      toast("Копия удалена");
    } catch (err) {
      toast(err.message || String(err));
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

  function nowLocalDateTime() {
    const d = new Date();
    const p = (n) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
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


/* bundle-seam */
})();
