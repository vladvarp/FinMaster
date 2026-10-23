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
    lineFilter: null,
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
  const LS_CAL_COLORS = "finmaster.calColors";
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
    [LS_CAL_COLORS]: "cal_colors",
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
    savedStack: null,
    limit: HISTORY_LIMIT_DEFAULT,
  };

  let historyWrite = Promise.resolve();

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

  function historyChrome(place) {
    if (place === "Калькулятор · открытая схема" || place === "Презентация · открытая страница" || place === "Хранилище · открытая страница") return true;
    if (place === "Боковая панель" || place.startsWith("Ширина колонки") || place.startsWith("Калькулятор · панель ")) return true;
    if (place === "Презентация · инспектор" || place === "Презентация · холст") return true;
    return place.startsWith("Калькулятор") && place.endsWith(" · вид");
  }

  function historyContentChanged(prevJson, nextJson) {
    try {
      const before = typeof prevJson === "string" ? JSON.parse(prevJson) : prevJson;
      const after = typeof nextJson === "string" ? JSON.parse(nextJson) : nextJson;
      const rows = reportDiff(before, after);
      if (!rows.length) return false;
      return rows.some((row) => !historyChrome(row.place));
    } catch {
      return true;
    }
  }

  function historyNoise(place) {
    if (place === "Калькулятор · открытая схема" || place === "Презентация · открытая страница" || place === "Хранилище · открытая страница") return true;
    if (place === "Боковая панель" || place.startsWith("Ширина колонки") || place.startsWith("Калькулятор · панель ")) return true;
    if (place === "Презентация · инспектор" || place === "Презентация · холст") return true;
    if (place.startsWith("Калькулятор") && (place.endsWith(" · вид") || place.endsWith(" · положение"))) return true;
    if (place.startsWith("Презентация") && place.endsWith(" · положение")) return true;
    return false;
  }

  function historyClip(value) {
    const text = String(value ?? "")
      .replace(/-?\d+\.\d{2,}/g, (n) => {
        const x = Number(n);
        return Number.isFinite(x) ? String(Math.round(x * 100) / 100) : n;
      })
      .replace(/\s+/g, " ")
      .trim();
    if (!text) return "—";
    return text.length > 36 ? `${text.slice(0, 35)}…` : text;
  }

  function historyBit(row) {
    const was = historyClip(row.was);
    const now = historyClip(row.now);
    if (was === "—") return `${row.place}: ${now}`;
    if (now === "—") return `${row.place}: убрано ${was}`;
    return `${row.place}: ${was} → ${now}`;
  }

  function historyShort(row) {
    const place = row.place || "";
    if (place.endsWith(" · вид") || place.endsWith(" · положение")) {
      const name = place.replace(/ · (вид|положение)$/, "").replace(/^Калькулятор · /, "");
      return place.startsWith("Презентация") ? `Презентация: сдвиг ${name.replace(/^Презентация · /, "")}` : `Калькулятор: сдвиг ${name}`;
    }
    if (place === "Калькулятор · открытая схема") return `Калькулятор: схема «${historyClip(row.now)}»`;
    if (place === "Презентация · открытая страница") return `Презентация: «${historyClip(row.now)}»`;
    if (place === "Хранилище · открытая страница") return `Хранилище: «${historyClip(row.now)}»`;
    if (place.startsWith("Ширина колонки")) return "Ширина колонок";
    if (place === "Боковая панель") return row.now === "свёрнута" ? "Боковая панель свёрнута" : "Боковая панель развёрнута";
    return historyBit(row);
  }

  function historyGuessLabel(prevJson, nextJson) {
    try {
      const before = typeof prevJson === "string" ? JSON.parse(prevJson) : prevJson;
      const after = typeof nextJson === "string" ? JSON.parse(nextJson) : nextJson;
      const rows = reportDiff(before, after);
      if (!rows.length) return "";
      const real = rows.filter((row) => !historyNoise(row.place));
      if (!real.length) return historyShort(rows[0]);
      let text = historyBit(real[0]);
      if (real.length > 1) text += ` · ещё ${real.length - 1}`;
      return text.length > 120 ? `${text.slice(0, 119)}…` : text;
    } catch {
      return "";
    }
  }

  function historyItemLabel(item, index) {
    const prev = index > 0 ? history.stack[index - 1] : null;
    if (prev?.json && item?.json) {
      const key = `${prev.id}:${item.id}`;
      if (item._stepKey === key && item._step) return item._step;
      const text = historyGuessLabel(prev.json, item.json);
      if (text) {
        item._stepKey = key;
        item._step = text;
        return text;
      }
    }
    return item?.label || "Правка";
  }

  function remoteDeviceName(origin) {
    const cid = String(origin || "");
    const client = (remote.clients || []).find((c) => c.id === cid);
    return String(client?.name || "").trim() || "Телефон";
  }

  function localActor() {
    return window.FM_DESK ? { source: "web", device: "WEB" } : { source: "pc", device: "ПК" };
  }

  function historyItem(json, label, meta) {
    const actor = localActor();
    return {
      id: uid(),
      at: new Date().toISOString(),
      label: label || "Правка",
      source: meta?.source || actor.source,
      device: meta?.device || actor.device,
      json,
    };
  }

  function historyReset(label = "Открыт отчёт", opts = {}) {
    clearTimeout(history.timer);
    history.pending = false;
    history.pendingLabel = "";
    const snap = state.doc ? historySnapshot() : null;
    history.stack = snap ? [historyItem(snap, label, localActor())] : [];
    history.index = history.stack.length - 1;
    updateHistoryButtons();
    markHistorySaved();
    if (opts.persist !== false) persistHistorySoon();
  }

  function historyTrim() {
    while (history.stack.length > history.limit) {
      history.stack.shift();
      history.index = Math.max(0, history.index - 1);
    }
  }

  function historyCommit(label, meta, opts = {}) {
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
    if (cur?.json && !historyContentChanged(cur.json, snap)) {
      history.pending = false;
      history.pendingLabel = "";
      return null;
    }
    const text = (cur && historyGuessLabel(cur.json, snap)) || label || history.pendingLabel || "Правка";
    const src = meta || (remote.applying ? { source: "mobile", device: remoteDeviceName(remote.origin) } : localActor());
    history.stack = history.stack.slice(0, history.index + 1);
    history.stack.push(historyItem(snap, text, src));
    historyTrim();
    history.index = history.stack.length - 1;
    history.pending = false;
    history.pendingLabel = "";
    updateHistoryButtons();
    if (opts.persist !== false) persistHistorySoon();
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
    if (window.FM_DESK) {
      const snap = history.stack[history.index];
      return {
        append: true,
        index: history.index,
        items: history.stack.map((item) => ({
          id: item.id,
          at: item.at,
          label: item.label,
          source: item.source,
          device: item.device,
          file: item.file || undefined,
        })),
        snap: snap
          ? { id: snap.id, at: snap.at, label: snap.label, source: snap.source, device: snap.device }
          : null,
      };
    }
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

  function markHistorySaved() {
    if (history.index < 0 || !history.stack.length) {
      history.savedStack = null;
      return;
    }
    history.savedStack = history.stack.slice(0, history.index + 1);
  }

  function persistHistoryNow() {
    if (window.FM_DESK || !state.desktop || !state.path) return historyWrite;
    const path = state.path;
    const title = state.doc?.title || "";
    const payload = historyDiskPayload();
    historyWrite = historyWrite
      .catch(() => {})
      .then(() => apiPost("/api/history", { path, title, ...payload }))
      .catch(() => {});
    return historyWrite;
  }

  async function revertHistoryToLastSave() {
    const saved = history.savedStack;
    if (!saved || !saved.length || !state.path) return;
    const same = history.stack.length === saved.length && history.stack.every((item, i) => item.id === saved[i]?.id);
    if (same && history.index === saved.length - 1) return;
    clearTimeout(history.timer);
    clearTimeout(history.persistTimer);
    history.pending = false;
    history.pendingLabel = "";
    history.stack = saved.slice();
    history.index = saved.length - 1;
    updateHistoryButtons();
    await persistHistoryNow();
  }

  function persistHistorySoon() {
    renderHistoryPanel();
    if (window.FM_DESK) return;
    if (!state.desktop || !state.path) return;
    clearTimeout(history.persistTimer);
    history.persistTimer = setTimeout(() => {
      history.persistTimer = 0;
      persistHistoryNow();
    }, 400);
  }

  function adoptHistory(payload, limit) {
    if (limit != null) history.limit = clampHistoryLimit(limit);
    const items = Array.isArray(payload?.items) ? payload.items : [];
    if (payload?.meta) {
      const labels = items.filter((item) => item && item.id).map((item) => ({
        id: item.id || uid(),
        file: item.file ? String(item.file) : undefined,
        at: item.at || new Date().toISOString(),
        label: item.label || "Правка",
        source: item.source === "mobile" || item.source === "desk" || item.source === "web" ? item.source : "pc",
        device: item.device || (item.source === "mobile" ? "Телефон" : item.source === "web" ? "WEB" : item.source === "desk" ? "Браузер" : "ПК"),
        json: "",
      }));
      if (!labels.length) {
        historyReset(state.path ? "Открыт отчёт" : "Новый отчёт", { persist: false });
        return;
      }
      history.stack = labels;
      historyTrim();
      let index = Number(payload.index);
      if (!Number.isInteger(index) || index < 0 || index >= history.stack.length) index = history.stack.length - 1;
      if (state.doc && history.stack[index]) {
        try { history.stack[index].json = JSON.stringify(state.doc); } catch { /* экран уже показывает отчёт */ }
      }
      history.index = index;
      history.pending = false;
      history.pendingLabel = "";
      updateHistoryButtons();
      markHistorySaved();
      return;
    }
    const restored = [];
    items.forEach((item) => {
      if (!item || !item.doc || typeof item.doc !== "object") return;
      try {
        restored.push({
          id: item.id || uid(),
          file: item.file ? String(item.file) : undefined,
          at: item.at || new Date().toISOString(),
          label: item.label || "Правка",
          source: item.source === "mobile" || item.source === "desk" || item.source === "web" ? item.source : "pc",
          device: item.device || (item.source === "mobile" ? "Телефон" : item.source === "web" ? "WEB" : item.source === "desk" ? "Браузер" : "ПК"),
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
    markHistorySaved();
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
    if (!history.stack[next].json) {
      toast("Снимок остаётся на главном компьютере");
      return false;
    }
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
    scheduleAutosave();
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
            <button class="btn small" type="button" data-bak-diff="${esc(row.name)}" title="До и после относительно открытого отчёта">До/после</button>
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

  const DIFF_CAP = 200;
  let diffSeq = 0;

  function diffSame(a, b) {
    return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
  }

  function diffShow(value) {
    if (value == null || value === "") return "—";
    if (typeof value === "boolean") return value ? "да" : "нет";
    if (typeof value === "number") return String(value);
    if (typeof value === "string") return value;
    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  }

  function diffClip(value, limit = 90) {
    const text = String(diffShow(value)).replace(/\s+/g, " ").trim();
    if (!text) return "—";
    return text.length > limit ? `${text.slice(0, limit - 1)}…` : text;
  }

  function diffPush(rows, place, was, now) {
    const left = diffClip(was);
    const right = diffClip(now);
    if (left === right) return;
    if (rows.length >= DIFF_CAP) {
      rows.overflow = (rows.overflow || 0) + 1;
      return;
    }
    rows.push({ place, was: left, now: right });
  }

  function pauseText(value) {
    const items = Array.isArray(value) ? value : [];
    if (!items.length) return "—";
    return items
      .map((pause) => {
        const start = String(pause?.start || "").slice(0, 10);
        const end = String(pause?.end || "").slice(0, 10);
        if (!start && !end) return "";
        if (pause?.open || !end) return start ? `с ${start}` : "открыта";
        return `${start} — ${end}`;
      })
      .filter(Boolean)
      .join("; ");
  }

  function taxModeText(value) {
    if (value === "gross") return "% от выручки";
    if (value === "net") return "% от выручки − затраты";
    if (value === "amount") return "своя сумма";
    return diffShow(value);
  }

  function kindText(value) {
    if (value === "tax") return "налог";
    if (value === "cost") return "затрата";
    if (value === "order" || value == null || value === "") return "заказ";
    return String(value);
  }

  function ratingText(value) {
    const n = Number(value) || 0;
    return n ? `${n} из 5` : "без оценки";
  }

  function frozenText(value) {
    return value ? "заморожена" : "нет";
  }

  function diffFields(rows, place, prev, next, fields) {
    fields.forEach(([key, label, shadow, fmt]) => {
      const show = fmt || diffShow;
      if (shadow) {
        if (!diffSame(prev?.[key], next?.[key])) {
          diffPush(rows, `${place} · ${label}`, show(prev?.[key]), show(next?.[key]));
          return;
        }
        if (!diffSame(prev?.[shadow], next?.[shadow])) diffPush(rows, `${place} · ${label}`, show(prev?.[shadow]), show(next?.[shadow]));
        return;
      }
      if (diffSame(prev?.[key], next?.[key])) return;
      diffPush(rows, `${place} · ${label}`, show(prev?.[key]), show(next?.[key]));
    });
  }

  function diffRest(rows, place, prev, next, known) {
    const keys = new Set([...Object.keys(prev || {}), ...Object.keys(next || {})]);
    keys.forEach((key) => {
      if (known.has(key) || diffSame(prev?.[key], next?.[key])) return;
      diffPush(rows, place ? `${place} · ${key}` : key, prev?.[key], next?.[key]);
    });
  }

  function walkById(prevList, nextList, idOf, onPair, onGone, onAdded) {
    const prev = Array.isArray(prevList) ? prevList : [];
    const next = Array.isArray(nextList) ? nextList : [];
    const nextMap = new Map();
    next.forEach((item, index) => {
      const key = idOf(item, index) || `#${index}`;
      if (!nextMap.has(key)) nextMap.set(key, item);
    });
    const seen = new Set();
    prev.forEach((item, index) => {
      const key = idOf(item, index) || `#${index}`;
      if (seen.has(key)) return;
      seen.add(key);
      if (nextMap.has(key)) onPair(item, nextMap.get(key));
      else onGone(item);
    });
    next.forEach((item, index) => {
      const key = idOf(item, index) || `#${index}`;
      if (seen.has(key)) return;
      seen.add(key);
      onAdded(item);
    });
  }

  function sameIdOrder(prev, next, idOf) {
    const a = (Array.isArray(prev) ? prev : []).map((item, index) => idOf(item, index) || `#${index}`);
    const b = (Array.isArray(next) ? next : []).map((item, index) => idOf(item, index) || `#${index}`);
    if (a.join("\0") === b.join("\0")) return true;
    return a.slice().sort().join("\0") !== b.slice().sort().join("\0");
  }

  function diffNameList(rows, place, prev, next) {
    const a = (Array.isArray(prev) ? prev : []).map((item) => String(item ?? "").trim()).filter(Boolean);
    const b = (Array.isArray(next) ? next : []).map((item) => String(item ?? "").trim()).filter(Boolean);
    if (a.join("\0") === b.join("\0")) return;
    const setB = new Set(b);
    const setA = new Set(a);
    const gone = a.filter((item) => !setB.has(item));
    const added = b.filter((item) => !setA.has(item));
    if (!gone.length && !added.length) {
      diffPush(rows, `${place} · порядок`, a.join(", "), b.join(", "));
      return;
    }
    if (gone.length === 1 && added.length === 1 && a.length === b.length) {
      diffPush(rows, place, gone[0], added[0]);
      return;
    }
    gone.forEach((item) => diffPush(rows, place, item, "—"));
    added.forEach((item) => diffPush(rows, place, "—", item));
  }

  function orderTag(order) {
    const n = String(order?.number || "").trim();
    const name = String(order?.name || "").trim();
    if (n && name) return `Заказ ${n} · ${name}`;
    if (n) return `Заказ ${n}`;
    if (name) return `Заказ ${name}`;
    return "Заказ";
  }

  function orderBrief(order) {
    const who = String(order?.customer || "").trim();
    const names = lineNames(order?.lines);
    return [who, names].filter(Boolean).join(" · ") || "пустой";
  }

  function lineTag(line) {
    const name = String(line?.product || line?.order_type || "").trim();
    return name ? `«${diffClip(name, 32)}»` : "позиция";
  }

  function lineBrief(line) {
    const bits = [line?.order_type, line?.qty_expr || line?.quantity, line?.unit, line?.price_expr ?? line?.price, line?.status]
      .map((item) => String(item ?? "").trim())
      .filter((item) => item && item !== "undefined");
    if (line?.frozen) bits.push("заморожена");
    return bits.join(" · ") || "пустая";
  }

  function lineNames(lines) {
    return (Array.isArray(lines) ? lines : [])
      .map((line) => String(line?.product || line?.order_type || "позиция").trim() || "позиция")
      .join(", ");
  }

  const ORDER_FIELDS = [
    ["number", "номер"],
    ["customer", "заказчик"],
    ["name", "название"],
    ["notes", "заметки"],
    ["work_start", "начало работ"],
    ["work_end", "конец работ"],
    ["work_pauses", "паузы", "", pauseText],
  ];
  const LINE_FIELDS = [
    ["order_type", "тип"],
    ["product", "продукт"],
    ["qty_expr", "количество", "quantity"],
    ["unit", "единица"],
    ["price_expr", "цена", "price"],
    ["discount_expr", "скидка", "discount"],
    ["order_date", "дата заказа"],
    ["paid_expr", "оплата", "paid"],
    ["payment_date", "дата оплаты"],
    ["status", "статус"],
    ["tax_mode", "расчёт", "", taxModeText],
    ["tax_percent_expr", "процент", "tax_percent"],
    ["work_start", "начало работ"],
    ["work_end", "конец работ"],
    ["work_pauses", "паузы", "", pauseText],
    ["frozen", "заморозка", "", frozenText],
    ["notes", "комментарий"],
  ];
  const ORDER_KNOWN = new Set(["id", "created_at", "lines", ...ORDER_FIELDS.map((field) => field[0])]);
  const LINE_KNOWN = new Set(["id", "quantity", "price", "discount", "paid", "tax_percent", ...LINE_FIELDS.map((field) => field[0])]);

  function diffLines(rows, place, prev, next) {
    const idOf = (line, index) => String(line?.id || "") || `#${index}`;
    if (!sameIdOrder(prev, next, idOf)) diffPush(rows, `${place} · порядок позиций`, lineNames(prev), lineNames(next));
    walkById(
      prev,
      next,
      idOf,
      (was, now) => {
        const spot = `${place} · ${lineTag(was.product || was.order_type ? was : now)}`;
        diffFields(rows, spot, was, now, LINE_FIELDS);
        diffRest(rows, spot, was, now, LINE_KNOWN);
      },
      (was) => diffPush(rows, `${place} · ${lineTag(was)}`, lineBrief(was), "—"),
      (now) => diffPush(rows, `${place} · ${lineTag(now)}`, "—", lineBrief(now))
    );
  }

  function diffOrders(rows, prev, next) {
    const idOf = (order, index) => String(order?.id || "") || `#${index}`;
    if (!sameIdOrder(prev, next, idOf)) diffPush(rows, "Порядок заказов", (prev || []).map(orderTag).join(", "), (next || []).map(orderTag).join(", "));
    walkById(
      prev,
      next,
      idOf,
      (was, now) => {
        const place = orderTag(was.number || was.name ? was : now);
        diffFields(rows, place, was, now, ORDER_FIELDS);
        diffLines(rows, place, was.lines, now.lines);
        diffRest(rows, place, was, now, ORDER_KNOWN);
      },
      (was) => diffPush(rows, orderTag(was), orderBrief(was), "—"),
      (now) => diffPush(rows, orderTag(now), "—", orderBrief(now))
    );
  }

  function namedPlace(kind, item) {
    const name = String(item?.name || "").trim();
    return name ? `${kind} «${name}»` : kind;
  }

  function diffCustomers(rows, prev, next) {
    const idOf = (item, index) => String(item?.id || "").trim() || `#${index}`;
    walkById(
      prev,
      next,
      idOf,
      (was, now) => {
        const place = namedPlace("Заказчик", was.name ? was : now);
        diffFields(rows, place, was, now, [
          ["name", "имя"],
          ["organization", "организация"],
          ["phone", "телефон"],
          ["email", "почта"],
          ["address", "адрес"],
          ["rating", "оценка", "", ratingText],
        ]);
      },
      (was) => diffPush(rows, "Заказчик", was.name || "без имени", "—"),
      (now) => diffPush(rows, "Заказчик", "—", now.name || "без имени")
    );
  }

  function diffStatuses(rows, prev, next) {
    const idOf = (item, index) => String(item?.id || item?.name || "") || `#${index}`;
    if (!sameIdOrder(prev, next, idOf)) diffPush(rows, "Порядок статусов", (prev || []).map((item) => item.name).join(", "), (next || []).map((item) => item.name).join(", "));
    walkById(
      prev,
      next,
      idOf,
      (was, now) =>
        diffFields(rows, namedPlace("Статус", was.name ? was : now), was, now, [
          ["name", "имя"],
          ["color", "цвет"],
          ["is_paid", "признак оплаты", "", (value) => (value ? "да" : "нет")],
          ["locked", "замок", "", (value) => (value ? "закрыт" : "открыт")],
        ]),
      (was) => diffPush(rows, "Статус", was.name || "без имени", "—"),
      (now) => diffPush(rows, "Статус", "—", now.name || "без имени")
    );
  }

  function diffTypes(rows, prev, next) {
    const idOf = (item, index) => String(item?.id || item?.name || "") || `#${index}`;
    if (!sameIdOrder(prev, next, idOf)) diffPush(rows, "Порядок типов", (prev || []).map((item) => item.name).join(", "), (next || []).map((item) => item.name).join(", "));
    walkById(
      prev,
      next,
      idOf,
      (was, now) =>
        diffFields(rows, namedPlace("Тип", was.name ? was : now), was, now, [
          ["name", "имя"],
          ["is_tax", "налог", "", (value) => (value ? "да" : "нет")],
          ["is_cost", "затрата", "", (value) => (value ? "да" : "нет")],
        ]),
      (was) => diffPush(rows, "Тип", was.name || "без имени", "—"),
      (now) => diffPush(rows, "Тип", "—", now.name || "без имени")
    );
  }

  function diffProducts(rows, prev, next) {
    const idOf = (item, index) => {
      const name = String(item?.name || "").trim().toLowerCase();
      return name ? `${item?.kind || "order"}\0${name}` : `#${index}`;
    };
    walkById(
      prev,
      next,
      idOf,
      (was, now) =>
        diffFields(rows, namedPlace("Продукт", was), was, now, [
          ["unit", "единица"],
          ["price", "цена"],
          ["tax_percent", "процент"],
          ["kind", "вид", "", kindText],
        ]),
      (was) => diffPush(rows, "Продукт", `${was.name || "без имени"} · ${kindText(was.kind)}`, "—"),
      (now) => diffPush(rows, "Продукт", "—", `${now.name || "без имени"} · ${kindText(now.kind)}`)
    );
  }

  function diffDateSet(rows, place, prev, next) {
    const a = (Array.isArray(prev) ? prev : []).map((item) => String(item || "").slice(0, 10)).filter(Boolean);
    const b = (Array.isArray(next) ? next : []).map((item) => String(item || "").slice(0, 10)).filter(Boolean);
    const setA = new Set(a);
    const setB = new Set(b);
    a.filter((item) => !setB.has(item)).forEach((item) => diffPush(rows, place, item, "—"));
    b.filter((item) => !setA.has(item)).forEach((item) => diffPush(rows, place, "—", item));
  }

  function weekdayText(list) {
    const names = ["пн", "вт", "ср", "чт", "пт", "сб", "вс"];
    return [...(Array.isArray(list) ? list : [])]
      .map(Number)
      .filter((n) => n >= 0 && n <= 6)
      .sort((a, b) => a - b)
      .map((n) => names[n])
      .join(", ");
  }

  function diffCalendar(rows, prev, next) {
    const a = prev && typeof prev === "object" ? prev : {};
    const b = next && typeof next === "object" ? next : {};
    const modes = { timeline: "таймлайн", classic: "классический", extended: "неделя" };
    const filters = { all: "все", now: "идёт сейчас", planned: "запланированы", done: "завершены", nodate: "без дат" };
    if (a.mode !== b.mode) diffPush(rows, "Календарь · вид", modes[a.mode] || a.mode, modes[b.mode] || b.mode);
    if (a.filter !== b.filter) diffPush(rows, "Календарь · фильтр", filters[a.filter] || a.filter, filters[b.filter] || b.filter);
    const wasDays = weekdayText(a.weekends);
    const nowDays = weekdayText(b.weekends);
    if (wasDays !== nowDays) diffPush(rows, "Календарь · выходные", wasDays, nowDays);
    diffDateSet(rows, "Календарь · выходной день", a.off_days, b.off_days);
    diffDateSet(rows, "Календарь · рабочий день", a.work_days, b.work_days);
    const notesA = a.day_notes && typeof a.day_notes === "object" ? a.day_notes : {};
    const notesB = b.day_notes && typeof b.day_notes === "object" ? b.day_notes : {};
    [...new Set([...Object.keys(notesA), ...Object.keys(notesB)])].sort().forEach((day) => {
      if (diffSame(notesA[day], notesB[day])) return;
      diffPush(rows, `Календарь · заметка ${day}`, notesA[day], notesB[day]);
    });
  }

  function diffSeries(rows, prev, next) {
    const metrics = { after: "выручка", paid: "оплачено", unpaid: "долг", cost: "расход", net: "чистыми" };
    const flat = (raw) => raw && typeof raw === "object" && raw.dash == null && raw.analytics == null;
    const one = (place, was, now) => {
      const left = was && typeof was === "object" ? was : {};
      const right = now && typeof now === "object" ? now : {};
      Object.keys(metrics).forEach((key) => {
        if (!!left[key] === !!right[key]) return;
        diffPush(rows, `${place} · ${metrics[key]}`, left[key] ? "вкл" : "выкл", right[key] ? "вкл" : "выкл");
      });
    };
    if (flat(prev) && flat(next)) {
      one("График", prev, next);
      return;
    }
    one("График сводки", prev?.dash, next?.dash);
    one("График аналитики", prev?.analytics, next?.analytics);
  }

  function diffCloud(rows, prev, next) {
    const labels = {
      layout: "раскладка",
      color: "цвет",
      size: "размер",
      labels: "подписи",
      motion: "движение",
      heat: "тепловая карта",
      space3d: "объём",
      debtOnly: "только долги",
    };
    const flags = new Set(["labels", "motion", "heat", "space3d", "debtOnly"]);
    const a = prev && typeof prev === "object" ? prev : {};
    const b = next && typeof next === "object" ? next : {};
    Object.keys(labels).forEach((key) => {
      if (diffSame(a[key], b[key])) return;
      const show = flags.has(key) ? (value) => (value === false ? "выкл" : "вкл") : diffShow;
      diffPush(rows, `Облако · ${labels[key]}`, show(a[key]), show(b[key]));
    });
  }

  function entityName(list, id, fallback) {
    const found = (Array.isArray(list) ? list : []).find((item) => item && item.id === id);
    return String(found?.name || "").trim() || fallback;
  }

  function tabChanged(prevList, nextList, prevId, nextId) {
    if ((prevId || "") === (nextId || "")) return false;
    const before = new Set((prevList || []).map((item) => item?.id));
    const after = new Set((nextList || []).map((item) => item?.id));
    if (!after.has(nextId) || !before.has(nextId)) return false;
    if (prevId && !before.has(prevId)) return false;
    return true;
  }

  function diffBlueprints(rows, prev, next) {
    const idOf = (item, index) => String(item?.id || "") || `#${index}`;
    if (tabChanged(prev?.blueprints, next?.blueprints, prev?.active, next?.active)) {
      diffPush(rows, "Калькулятор · открытая схема", entityName(prev?.blueprints, prev?.active, "—"), entityName(next?.blueprints, next?.active, "—"));
    }
    const folds = { nodes: "панель узлов", schemes: "панель схем", orders: "панель заказов" };
    Object.keys(folds).forEach((key) => {
      const left = prev?.folds?.[key] !== false;
      const right = next?.folds?.[key] !== false;
      if (left !== right) diffPush(rows, `Калькулятор · ${folds[key]}`, left ? "развёрнута" : "свёрнута", right ? "развёрнута" : "свёрнута");
    });
    walkById(
      prev?.blueprints,
      next?.blueprints,
      idOf,
      (was, now) => diffBlueprint(rows, was, now),
      (was) => diffPush(rows, "Калькулятор · схема", was.name || "Схема", "—"),
      (now) => diffPush(rows, "Калькулятор · схема", "—", now.name || "Схема")
    );
  }

  function nodeTag(node) {
    return String(node?.name || node?.type || "узел").trim() || "узел";
  }

  function linkText(link, byId) {
    const from = byId.get(link?.from);
    const to = byId.get(link?.to);
    const left = from ? nodeTag(from) : "узел";
    const right = to ? nodeTag(to) : "узел";
    return `${left}${link?.fromPort ? `:${link.fromPort}` : ""} → ${right}${link?.toPort ? `:${link.toPort}` : ""}`;
  }

  function diffBlueprint(rows, was, now) {
    const place = `Калькулятор · «${String(was?.name || now?.name || "Схема").trim() || "Схема"}»`;
    if ((was?.name || "") !== (now?.name || "")) diffPush(rows, `${place} · имя`, was?.name, now?.name);
    const view = (bp) => `${Number(bp?.x) || 0}, ${Number(bp?.y) || 0} · ${Number(bp?.zoom) || 1}`;
    if (view(was) !== view(now)) diffPush(rows, `${place} · вид`, view(was), view(now));
    const nodeId = (node, index) => String(node?.id || "") || `#${index}`;
    const skip = new Set(["id", "x", "y"]);
    const labels = { type: "тип", name: "имя", expr: "формула", orderId: "заказ", blueprintId: "схема", text: "текст" };
    walkById(
      was?.nodes,
      now?.nodes,
      nodeId,
      (left, right) => {
        const spot = `${place} · «${nodeTag(left)}»`;
        if ((Number(left?.x) || 0) !== (Number(right?.x) || 0) || (Number(left?.y) || 0) !== (Number(right?.y) || 0)) {
          diffPush(rows, `${spot} · положение`, `${Number(left?.x) || 0}, ${Number(left?.y) || 0}`, `${Number(right?.x) || 0}, ${Number(right?.y) || 0}`);
        }
        const keys = new Set([...Object.keys(left || {}), ...Object.keys(right || {})]);
        keys.forEach((key) => {
          if (skip.has(key) || diffSame(left?.[key], right?.[key])) return;
          diffPush(rows, `${spot} · ${labels[key] || key}`, left?.[key], right?.[key]);
        });
      },
      (left) => diffPush(rows, `${place} · узел`, nodeTag(left), "—"),
      (right) => diffPush(rows, `${place} · узел`, "—", nodeTag(right))
    );
    const byWas = new Map((was?.nodes || []).map((node) => [node.id, node]));
    const byNow = new Map((now?.nodes || []).map((node) => [node.id, node]));
    walkById(
      was?.links,
      now?.links,
      (link, index) => String(link?.id || "") || `#${index}`,
      (left, right) => {
        const before = linkText(left, byWas);
        const after = linkText(right, byNow);
        if (before !== after) diffPush(rows, `${place} · связь`, before, after);
      },
      (left) => diffPush(rows, `${place} · связь`, linkText(left, byWas), "—"),
      (right) => diffPush(rows, `${place} · связь`, "—", linkText(right, byNow))
    );
  }

  function diffPages(rows, prev, next) {
    if (!!prev?.inspectorOpen !== !!next?.inspectorOpen) {
      diffPush(rows, "Презентация · инспектор", prev?.inspectorOpen === false ? "закрыт" : "открыт", next?.inspectorOpen === false ? "закрыт" : "открыт");
    }
    if (!!prev?.canvasLocked !== !!next?.canvasLocked) {
      diffPush(rows, "Презентация · холст", prev?.canvasLocked ? "заблокирован" : "свободен", next?.canvasLocked ? "заблокирован" : "свободен");
    }
    if (tabChanged(prev?.pages, next?.pages, prev?.active, next?.active)) {
      diffPush(rows, "Презентация · открытая страница", entityName(prev?.pages, prev?.active, "—"), entityName(next?.pages, next?.active, "—"));
    }
    const idOf = (item, index) => String(item?.id || "") || `#${index}`;
    walkById(
      prev?.pages,
      next?.pages,
      idOf,
      (was, now) => diffPresPage(rows, was, now),
      (was) => diffPush(rows, "Презентация · страница", was.name || "Страница", "—"),
      (now) => diffPush(rows, "Презентация · страница", "—", now.name || "Страница")
    );
  }

  function diffPresPage(rows, was, now) {
    const place = `Презентация · «${String(was?.name || now?.name || "Страница").trim() || "Страница"}»`;
    diffFields(rows, place, was, now, [
      ["name", "имя"],
      ["bg", "фон"],
      ["showGrid", "сетка", "", (value) => (value ? "вкл" : "выкл")],
    ]);
    const box = (block) => `${block?.x ?? 0}, ${block?.y ?? 0}, ${block?.w ?? 0}×${block?.h ?? 0}`;
    walkById(
      was?.blocks,
      now?.blocks,
      (block, index) => String(block?.id || "") || `#${index}`,
      (left, right) => {
        const spot = `${place} · «${String(left?.title || left?.type || "блок").trim() || "блок"}»`;
        diffFields(rows, spot, left, right, [
          ["type", "тип"],
          ["title", "заголовок"],
          ["text", "текст"],
        ]);
        if (box(left) !== box(right)) diffPush(rows, `${spot} · положение`, box(left), box(right));
        ["values", "labels", "style"].forEach((key) => {
          if (diffSame(left?.[key], right?.[key])) return;
          diffPush(rows, `${spot} · ${key === "values" ? "значения" : key === "labels" ? "подписи" : "оформление"}`, left?.[key], right?.[key]);
        });
      },
      (left) => diffPush(rows, `${place} · блок`, left.title || left.type || "блок", "—"),
      (right) => diffPush(rows, `${place} · блок`, "—", right.title || right.type || "блок")
    );
  }

  function vaultPageBrief(page) {
    const types = { in: "пополнение", out: "снятие", save: "копилка" };
    const name = page?.name || "Страница";
    const list = Array.isArray(page?.rows) ? page.rows : [];
    if (!list.length) return name;
    const bits = list.slice(0, 8).map((row) => {
      const kind = types[row?.type] || "строка";
      const title = String(row?.name || "без названия").trim() || "без названия";
      const date = String(row?.date || "").slice(0, 10);
      return [kind, `«${title}»`, row?.amount ?? "", date].filter((part) => part !== "" && part != null).join(" ");
    });
    return `${name}: ${bits.join("; ")}${list.length > 8 ? ` и ещё ${list.length - 8}` : ""}`;
  }

  function diffVault(rows, prev, next) {
    if (tabChanged(prev?.pages, next?.pages, prev?.active, next?.active)) {
      diffPush(rows, "Хранилище · открытая страница", entityName(prev?.pages, prev?.active, "—"), entityName(next?.pages, next?.active, "—"));
    }
    const types = { in: "пополнение", out: "снятие", save: "копилка" };
    walkById(
      prev?.pages,
      next?.pages,
      (page, index) => String(page?.id || "") || `#${index}`,
      (was, now) => {
        const place = `Хранилище · «${String(was?.name || now?.name || "Страница").trim() || "Страница"}»`;
        if ((was?.name || "") !== (now?.name || "")) diffPush(rows, `${place} · имя`, was?.name, now?.name);
        walkById(
          was?.rows,
          now?.rows,
          (row, index) => String(row?.id || "") || `#${index}`,
          (left, right) => {
            const kind = types[left?.type] || types[right?.type] || "строка";
            const spot = `${place} · ${kind} «${String(left?.name || "без названия").trim() || "без названия"}»`;
            diffFields(rows, spot, left, right, [
              ["type", "тип", "", (value) => types[value] || diffShow(value)],
              ["name", "название"],
              ["amount", "сумма"],
              ["date", "дата"],
            ]);
          },
          (left) => diffPush(rows, place, `${types[left?.type] || "строка"} «${left?.name || "без названия"}» ${left?.amount ?? ""} ${String(left?.date || "").slice(0, 10)}`.trim(), "—"),
          (right) => diffPush(rows, place, "—", `${types[right?.type] || "строка"} «${right?.name || "без названия"}» ${right?.amount ?? ""} ${String(right?.date || "").slice(0, 10)}`.trim())
        );
      },
      (was) => diffPush(rows, "Хранилище · страница", vaultPageBrief(was), "—"),
      (now) => diffPush(rows, "Хранилище · страница", "—", vaultPageBrief(now))
    );
  }

  function diffUi(rows, prev, next) {
    const a = prev && typeof prev === "object" ? prev : {};
    const b = next && typeof next === "object" ? next : {};
    if (!!a.sidebar_collapsed !== !!b.sidebar_collapsed) {
      diffPush(rows, "Боковая панель", a.sidebar_collapsed ? "свёрнута" : "развёрнута", b.sidebar_collapsed ? "свёрнута" : "развёрнута");
    }
    const cols = {
      order_type: "Тип заказа",
      product: "Продукт",
      qty_expr: "Кол-во",
      unit: "Ед.",
      price: "Цена",
      discount: "Скидка %",
      order_date: "Дата заказа",
      paid: "Оплачено",
      payment_date: "Дата оплаты",
      unpaid: "Не оплачено",
      total: "Итог",
      status: "Статус",
    };
    const widthsA = a.column_widths && typeof a.column_widths === "object" ? a.column_widths : {};
    const widthsB = b.column_widths && typeof b.column_widths === "object" ? b.column_widths : {};
    [...new Set([...Object.keys(widthsA), ...Object.keys(widthsB)])].forEach((key) => {
      if (Number(widthsA[key]) === Number(widthsB[key])) return;
      const px = (value) => (Number.isFinite(Number(value)) ? `${Math.round(Number(value))} px` : "—");
      diffPush(rows, `Ширина колонки · ${cols[key] || key}`, px(widthsA[key]), px(widthsB[key]));
    });
    const shareLabels = {
      number: "номер",
      customer: "заказчик",
      organization: "организация",
      name: "название",
      order_type: "тип",
      product: "продукт",
      quantity: "количество",
      price: "цена",
      discount: "скидка",
      total: "сумма",
      paid: "оплачено",
      unpaid: "не оплачено",
      payment_date: "дата оплаты",
      totals: "итоги",
      expenses: "расходы",
    };
    const shareText = (list) => (Array.isArray(list) ? list : []).map((id) => shareLabels[id] || id).join(", ");
    if (shareText(a.share_fields) !== shareText(b.share_fields)) diffPush(rows, "Снимок · поля", shareText(a.share_fields), shareText(b.share_fields));
    const themes = { teal: "Изумруд", graphite: "Графит", indigo: "Индиго", gold: "Золото", rose: "Вишня", mono: "Минимал", night: "Ночь" };
    if ((a.share_theme || "") !== (b.share_theme || "")) diffPush(rows, "Снимок · тема", themes[a.share_theme] || a.share_theme, themes[b.share_theme] || b.share_theme);
    if (!diffSame(a.payment_terms, b.payment_terms)) diffPush(rows, "Срок оплаты, дни", a.payment_terms, b.payment_terms);
    if (!diffSame(a.cash_horizon, b.cash_horizon)) diffPush(rows, "Горизонт кассы, дни", a.cash_horizon, b.cash_horizon);
    diffCloud(rows, a.cloud, b.cloud);
    diffSeries(rows, a.line_series, b.line_series);
    diffCalendar(rows, a.calendar, b.calendar);
    diffBlueprints(rows, a.calculator, b.calculator);
    diffPages(rows, a.presentation, b.presentation);
    diffVault(rows, a.vault, b.vault);
    diffRest(
      rows,
      "Интерфейс",
      a,
      b,
      new Set(["sidebar_collapsed", "column_widths", "share_fields", "share_theme", "payment_terms", "cash_horizon", "cloud", "line_series", "calendar", "calculator", "presentation", "vault"])
    );
  }

  function reportDiff(before, after) {
    const rows = [];
    const a = before && typeof before === "object" ? before : {};
    const b = after && typeof after === "object" ? after : {};
    if (!diffSame(a.title, b.title)) diffPush(rows, "Название", a.title, b.title);
    if (!diffSame(a.currency, b.currency)) diffPush(rows, "Валюта", a.currency, b.currency);
    if (!diffSame(a.money_decimals, b.money_decimals)) diffPush(rows, "Знаки после запятой", a.money_decimals, b.money_decimals);
    diffOrders(rows, a.orders, b.orders);
    diffCustomers(rows, a.customers, b.customers);
    diffStatuses(rows, a.statuses, b.statuses);
    diffNameList(rows, "Единица", a.units, b.units);
    diffTypes(rows, a.order_types, b.order_types);
    diffProducts(rows, a.products, b.products);
    diffUi(rows, a.ui, b.ui);
    diffRest(rows, "", a, b, new Set(["title", "currency", "money_decimals", "orders", "customers", "statuses", "units", "order_types", "products", "ui", "modified_at", "created_at", "version", "id"]));
    return rows;
  }

  function diffPretty(value, field, currency) {
    let text = String(value ?? "");
    text = text.replace(/\d{4}-\d{2}-\d{2}/g, (iso) => {
      const [y, m, d] = iso.split("-");
      return `${d}.${m}.${y}`;
    });
    if ((field === "оплата" || field === "цена" || field === "сумма" || field === "скидка") && /^-?\d+(\.\d+)?$/.test(text.trim())) {
      const formatted = Number(text).toLocaleString("ru-RU", { maximumFractionDigits: 2 });
      return currency ? `${formatted} ${currency}` : formatted;
    }
    if (field === "процент" && /^-?\d+(\.\d+)?$/.test(text.trim())) {
      return `${Number(text).toLocaleString("ru-RU", { maximumFractionDigits: 2 })} %`;
    }
    return text;
  }

  function paintDiff(before, after) {
    const body = $("diff-body");
    if (!body) return;
    const all = reportDiff(before, after);
    const rows = all.filter((row) => !historyChrome(row.place));
    if (!rows.length) {
      body.innerHTML = `<div class="empty">В данных отчёта отличий нет.</div>`;
      return;
    }
    const currency = String(after?.currency || before?.currency || "").trim();
    const lines = [];
    let group = null;
    rows.forEach((row) => {
      const parts = String(row.place || "Правка").split(" · ");
      const field = parts.length > 1 ? parts.pop() : parts[0];
      const title = parts.join(" · ");
      if (title !== group) {
        group = title;
        if (title) lines.push(`<tr class="diff-head"><td colspan="3">${esc(title)}</td></tr>`);
      }
      const label = field ? field.charAt(0).toUpperCase() + field.slice(1) : "Правка";
      lines.push(
        `<tr><td>${esc(label)}</td><td>${esc(diffPretty(row.was, field, currency))}</td><td>${esc(diffPretty(row.now, field, currency))}</td></tr>`
      );
    });
    const more = all.overflow || 0;
    body.innerHTML = `<table class="diff-table"><thead><tr><th>Поле</th><th>До</th><th>После</th></tr></thead><tbody>${lines.join("")}${
      more ? `<tr><td colspan="3">И ещё ${more}</td></tr>` : ""
    }</tbody></table>`;
  }

  function showDiffShell(lead, bodyHtml) {
    const leadEl = $("diff-lead");
    const body = $("diff-body");
    if (leadEl) leadEl.textContent = lead;
    if (body) body.innerHTML = bodyHtml;
    $("diff-modal")?.classList.add("open");
  }

  function closeDiffModal() {
    diffSeq += 1;
    $("diff-modal")?.classList.remove("open");
  }

  async function loadHistoryDoc(item) {
    if (item?.json) {
      try {
        return JSON.parse(item.json);
      } catch {
        /* снимок на диске */
      }
    }
    if (!state.path) throw new Error("Снимок остаётся на главном компьютере");
    const res = await apiPost("/api/history/snap", { path: state.path, id: item.id });
    if (!res?.doc || typeof res.doc !== "object") throw new Error("Снимок не найден.");
    try {
      item.json = JSON.stringify(res.doc);
    } catch {
      /* сравнение и без кэша */
    }
    return res.doc;
  }

  async function openHistoryDiff(id) {
    const item = history.stack.find((row) => row.id === id);
    if (!item || !state.doc) return;
    const seq = ++diffSeq;
    const lead = `До — снимок «${historyItemLabel(item, history.stack.indexOf(item))}», ${historyTime(item.at) || "без времени"}. После — открытый отчёт «${state.doc.title || "Отчёт"}».`;
    showDiffShell(lead, `<div class="empty">Считаю отличия…</div>`);
    try {
      const before = await loadHistoryDoc(item);
      if (seq !== diffSeq) return;
      paintDiff(before, state.doc);
    } catch (err) {
      if (seq !== diffSeq) return;
      $("diff-body").innerHTML = `<div class="empty">${esc(err.message || "Не удалось прочитать снимок")}</div>`;
    }
  }

  async function openBackupDiff(name) {
    if (!state.doc) return;
    if (!state.desktop) {
      toast("Резервные копии доступны в программе на компьютере");
      return;
    }
    const seq = ++diffSeq;
    const lead = `До — копия «${name}». После — открытый отчёт «${state.doc.title || "Отчёт"}».`;
    showDiffShell(lead, `<div class="empty">Считаю отличия…</div>`);
    try {
      const res = await apiPost("/api/backups/read", { id: state.doc.id || "", name });
      if (seq !== diffSeq) return;
      if (!res?.doc || typeof res.doc !== "object") throw new Error("Файл копии повреждён.");
      paintDiff(res.doc, state.doc);
    } catch (err) {
      if (seq !== diffSeq) return;
      $("diff-body").innerHTML = `<div class="empty">${esc(err.message || "Не удалось прочитать копию")}</div>`;
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
        return `<div class="history-item ${i === history.index ? "active" : ""}">
          <button type="button" class="history-jump" data-history-id="${esc(item.id)}">
            <span class="history-item-top"><b>${esc(historyItemLabel(item, i))}</b><time>${esc(historyTime(item.at))}</time></span>
            <small>${esc(item.device || (item.source === "mobile" ? "Телефон" : item.source === "web" ? "WEB" : item.source === "desk" ? "Браузер" : "ПК"))}</small>
          </button>
          <button type="button" class="btn small history-diff" data-history-diff="${esc(item.id)}" title="До и после относительно открытого отчёта" aria-label="До и после">≠</button>
        </div>`;
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
