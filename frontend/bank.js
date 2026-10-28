/* Телефонное хранилище: тот же учёт, что вкладка на компьютере, через /bank?t= */
(function () {
  "use strict";

  const $ = (id) => document.getElementById(id);
  const LS_CID = "finmaster.bank.cid";

  const state = {
    token: "",
    cid: "",
    doc: null,
    version: 0,
    docVersion: 0,
    path: "",
    dirty: false,
    stopped: false,
    pushing: false,
    pushTimer: 0,
    pending: null,
    recent: [],
    library: { path: "", items: [] },
    filesOpen: false,
    ops: false,
  };

  let moneyFmt = new Intl.NumberFormat("ru-RU", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  let toastTimer = 0;

  function esc(value) {
    return String(value ?? "").replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]);
  }

  function sameFile(a, b) {
    const n = (p) => String(p || "").replace(/\//g, "\\").toLowerCase();
    return !!a && !!b && n(a) === n(b);
  }

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  const OPS_TYPE = { in: "Пополнение", out: "Снятие", save: "Копилка" };

  function uid() {
    if (crypto.randomUUID) return crypto.randomUUID();
    return `v-${Date.now().toString(16)}-${Math.random().toString(16).slice(2)}`;
  }

  function moneyDecimals() {
    const n = Number(state.doc?.money_decimals);
    return Number.isFinite(n) ? Math.max(0, Math.min(4, Math.round(n))) : 2;
  }

  function syncMoney() {
    const d = moneyDecimals();
    moneyFmt = new Intl.NumberFormat("ru-RU", { minimumFractionDigits: d, maximumFractionDigits: d });
  }

  function money(n) {
    return `${moneyFmt.format(Number(n) || 0)} ${state.doc?.currency || "₽"}`;
  }

  function deviceHeader() {
    const minutes = -new Date().getTimezoneOffset();
    const sign = minutes >= 0 ? "+" : "−";
    const abs = Math.abs(minutes);
    const hours = Math.floor(abs / 60);
    const rest = abs % 60;
    const utc = rest ? `UTC${sign}${hours}:${String(rest).padStart(2, "0")}` : `UTC${sign}${hours}`;
    const languages = navigator.languages && navigator.languages.length ? navigator.languages.join(", ") : "";
    const link = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
    const payload = {
      name: deviceName(),
      user_agent: navigator.userAgent || "",
      language: navigator.language || "",
      languages,
      screen: `${window.screen?.width || 0}×${window.screen?.height || 0}`,
      viewport: `${window.innerWidth}×${window.innerHeight}`,
      pixel_ratio: String(window.devicePixelRatio || 1),
      color_depth: String(window.screen?.colorDepth || ""),
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "",
      utc,
      touch: String(navigator.maxTouchPoints || 0),
      cores: String(navigator.hardwareConcurrency || ""),
      memory: navigator.deviceMemory ? `${navigator.deviceMemory} ГБ` : "",
      connection: link ? [link.effectiveType, link.downlink ? `${link.downlink} Мбит/с` : ""].filter(Boolean).join(" · ") : "",
      vendor: navigator.vendor || "",
      platform: navigator.platform || "",
      cookies: navigator.cookieEnabled ? "да" : "нет",
      online: navigator.onLine ? "да" : "нет",
    };
    try {
      return btoa(unescape(encodeURIComponent(JSON.stringify(payload))));
    } catch {
      return "";
    }
  }

  function deviceName() {
    const ua = navigator.userAgent || "";
    let model = "Телефон";
    if (/iPhone/.test(ua)) model = "iPhone";
    else if (/iPad/.test(ua)) model = "iPad";
    else {
      const android = ua.match(/Android[^;]*;\s*([^);]+)/);
      if (android) {
        const name = android[1].replace(/\s*Build\/.*$/i, "").trim();
        if (name && !/^Android$/i.test(name)) model = name;
        else model = "Android";
      }
    }
    return `Хранилище · ${model}`.slice(0, 80);
  }

  function toast(text) {
    const el = $("toast");
    if (!el) return;
    el.textContent = text;
    el.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      el.hidden = true;
    }, 2400);
  }

  function confirmBox(opts) {
    return new Promise((resolve) => {
      const layer = $("ask");
      $("ask-title").textContent = opts.title || "Подтвердите";
      $("ask-text").textContent = opts.text || "";
      const ok = $("ask-ok");
      ok.textContent = opts.ok || "Ок";
      ok.classList.toggle("danger", !!opts.danger);
      layer.hidden = false;
      layer.classList.add("open");
      const done = (yes) => {
        layer.hidden = true;
        layer.classList.remove("open");
        ok.onclick = null;
        $("ask-cancel").onclick = null;
        resolve(yes);
      };
      ok.onclick = () => done(true);
      $("ask-cancel").onclick = () => done(false);
    });
  }

  function setSync(mode, text) {
    const bar = $("sync-bar");
    bar.classList.remove("ok", "wait", "err");
    if (mode) bar.classList.add(mode);
    $("sync-text").textContent = text;
  }

  function blocked(title, text) {
    state.stopped = true;
    $("blocker-title").textContent = title;
    $("blocker-text").textContent = text;
    $("blocker").hidden = false;
    $("view-vault").hidden = true;
  }

  function isTyping() {
    const el = document.activeElement;
    return !!el && /^(INPUT|SELECT|TEXTAREA)$/.test(el.tagName);
  }

  function fileTitle() {
    const name = String(state.path || "").split(/[/\\]/).pop() || "";
    return state.doc?.title || name.replace(/\.fmaster$/i, "") || "Отчёт";
  }

  function paintHead() {
    $("head-title").textContent = "Хранилище";
    const extra = state.dirty ? " · есть правки" : "";
    $("head-sub").textContent = state.doc ? `${fileTitle()}${extra}` : "нет отчёта";
    const filesBtn = $("btn-files");
    if (filesBtn) {
      const back = !!(state.doc && state.filesOpen);
      filesBtn.textContent = back ? "К копилкам" : "Отчёты";
      filesBtn.setAttribute("aria-label", filesBtn.textContent);
    }
  }

  function showDoc() {
    paintHead();
    if (state.filesOpen) {
      $("view-vault").hidden = true;
      $("empty").hidden = false;
      $("empty-title").textContent = "Другой отчёт";
      paintFiles();
      return;
    }
    $("empty").hidden = true;
    $("view-vault").hidden = false;
    if (state.ops) syncOps();
    else window.FinVault?.render(vaultApi());
  }

  function showEmpty(text) {
    state.doc = null;
    state.ops = false;
    state.filesOpen = true;
    $("view-vault").hidden = true;
    $("empty").hidden = false;
    $("empty-title").textContent = "Нет отчёта";
    $("empty-text").textContent = text;
    paintFiles();
    paintHead();
  }

  function showFiles(text) {
    state.filesOpen = true;
    $("view-vault").hidden = true;
    $("empty").hidden = false;
    $("empty-title").textContent = state.doc ? "Другой отчёт" : "Нет отчёта";
    $("empty-text").textContent = text;
    paintFiles();
    paintHead();
  }

  function vaultApi() {
    return {
      doc: () => state.doc,
      view: () => "vault",
      uid,
      money,
      markDirty: () => {
        state.dirty = true;
        paintHead();
        pushSoon();
      },
      toast,
      confirm: confirmBox,
    };
  }

  function cid() {
    let id = "";
    try {
      id = localStorage.getItem(LS_CID) || "";
    } catch {
      id = "";
    }
    if (!id) {
      id = `bank-${uid()}`;
      try {
        localStorage.setItem(LS_CID, id);
      } catch {
        /* приватный режим */
      }
    }
    return id;
  }

  async function api(path, options = {}) {
    const sep = path.includes("?") ? "&" : "?";
    const extra = `t=${encodeURIComponent(state.token)}&cid=${encodeURIComponent(state.cid)}&name=${encodeURIComponent(deviceName())}&kind=bank`;
    const headers = {
      "Content-Type": "application/json",
      "X-FM-Token": state.token,
      "ngrok-skip-browser-warning": "1",
      ...(options.headers || {}),
    };
    const device = deviceHeader();
    if (device) headers["X-FM-Device"] = device;
    const res = await fetch(`${path}${sep}${extra}`, { ...options, headers });
    const data = await res.json().catch(() => ({}));
    if (res.status === 401 || res.status === 403) {
      const reason = data.error || "Откройте ссылку из бота заново.";
      blocked("Сессия закрыта", reason);
      throw new Error(reason);
    }
    if (!res.ok) throw new Error(data.error || res.statusText);
    return data;
  }

  function fileCard(item) {
    const name = item.title || item.name || String(item.path || "").split(/[/\\]/).pop() || "Отчёт";
    const current = sameFile(item.path, state.path);
    let action = '<span class="pill muted">нет файла</span>';
    if (current) action = '<span class="pill">открыт</span>';
    else if (item.exists !== false) action = `<button type="button" class="btn small" data-open-file="${esc(item.path)}">Открыть</button>`;
    return `<article class="file-row${current ? " current" : ""}"><div><strong>${esc(name)}</strong><small>${esc(item.name || "")}</small></div>${action}</article>`;
  }

  function paintFiles() {
    const box = $("bank-files");
    if (!box) return;
    const lib = state.library || {};
    const items = lib.items || [];
    const recent = state.recent || [];
    const path = lib.path ? `<small class="file-path">${esc(lib.path)}</small>` : "";
    const libraryHtml = items.length ? items.map(fileCard).join("") : '<p class="ops-empty">В папке FinMaster пока нет отчётов</p>';
    const recentHtml = recent.length ? recent.map(fileCard).join("") : '<p class="ops-empty">Недавних отчётов нет</p>';
    box.innerHTML = `<h3 class="file-head">Папка FinMaster</h3>${path}<div class="file-list">${libraryHtml}</div><h3 class="file-head">Недавние отчёты</h3><div class="file-list">${recentHtml}</div>`;
  }

  function ruDate(value) {
    const match = String(value || "").match(/^(\d{4})-(\d{2})-(\d{2})/);
    return match ? `${match[3]}.${match[2]}.${match[1]}` : "—";
  }

  function opsAmount(row) {
    const raw = Number(row.amount) || 0;
    if (row.type === "out") return `−${money(Math.abs(raw))}`;
    if (row.type === "save") return `${raw < 0 ? "−" : "+"}${money(Math.abs(raw))}`;
    return `+${money(Math.abs(raw))}`;
  }

  function opsItems() {
    const pages = state.doc?.ui?.vault?.pages || [];
    const rows = [];
    pages.forEach((page) => {
      (page.rows || []).forEach((row, index) => {
        rows.push({ row, index, page: page.name || "Страница" });
      });
    });
    rows.sort((a, b) => {
      const da = a.row.date || "";
      const db = b.row.date || "";
      if (da !== db) return da < db ? 1 : -1;
      return b.index - a.index;
    });
    return rows;
  }

  function paintOpsBody() {
    const body = $("vault-body");
    if (!body) return;
    const rows = opsItems();
    body.innerHTML = rows.length
      ? `<section class="card"><h3 class="file-head">Все операции</h3><div class="ops-list">${rows
          .map(({ row, page }) => {
            const type = OPS_TYPE[row.type] || "Строка";
            return `<article class="ops-row vt-${esc(row.type)}"><b>${esc(row.name || "без названия")}</b><span class="ops-type">${esc(type)}</span><span class="ops-amt">${esc(opsAmount(row))}</span><span class="ops-page">${esc(page)}</span><span class="ops-date">${esc(ruDate(row.date))}</span></article>`;
          })
          .join("")}</div></section>`
      : '<section class="card"><p class="ops-empty">Операций пока нет</p></section>';
  }

  function syncOps() {
    const view = $("view-vault");
    if (view) view.classList.toggle("is-ops", state.ops);
    const btn = $("btn-ops");
    if (btn) {
      btn.textContent = state.ops ? "Копилка" : "Все операции";
      btn.setAttribute("aria-label", btn.textContent);
    }
    if (state.ops) paintOpsBody();
  }

  function hookVault() {
    const vault = window.FinVault;
    if (!vault || vault.render.__bankOps) return;
    const base = vault.render.bind(vault);
    function wrapped(next) {
      base(next);
      syncOps();
    }
    wrapped.__bankOps = true;
    vault.render = wrapped;
  }

  function rememberLists(data) {
    if (data && data.library) state.library = data.library;
    if (data && Array.isArray(data.recent)) state.recent = data.recent;
  }

  function applySnapshot(data, initial) {
    if (typeof data.version === "number") state.version = Math.max(state.version, data.version);
    rememberLists(data);
    if (!data.document) {
      showEmpty("На компьютере не открыт отчёт. Хранилище лежит в открытом файле.");
      if (!initial) setSync("ok", "отчёт не открыт");
      return;
    }
    const incoming = typeof data.doc_version === "number" ? data.doc_version : null;
    if (!initial && data.origin === state.cid) {
      if (incoming != null) state.docVersion = Math.max(state.docVersion, incoming);
      state.dirty = !!data.dirty;
      paintHead();
      return;
    }
    if (!initial && (state.pushTimer || state.pushing || isTyping())) {
      state.pending = data.document;
      if (incoming != null) state.pendingVersion = incoming;
      return;
    }
    if (incoming != null) state.docVersion = Math.max(state.docVersion, incoming);
    state.doc = data.document;
    state.path = typeof data.path === "string" ? data.path : state.path;
    state.dirty = !!data.dirty;
    syncMoney();
    showDoc();
    if (!initial) setSync("ok", "обновлено с компьютера");
  }

  function flushPending() {
    if (!state.pending || isTyping()) return;
    state.doc = state.pending;
    state.pending = null;
    if (typeof state.pendingVersion === "number") state.docVersion = Math.max(state.docVersion, state.pendingVersion);
    syncMoney();
    showDoc();
    setSync("ok", "обновлено с компьютера");
  }

  function pushSoon() {
    clearTimeout(state.pushTimer);
    state.pushTimer = setTimeout(push, 350);
  }

  async function push() {
    clearTimeout(state.pushTimer);
    state.pushTimer = 0;
    if (!state.doc || state.stopped) return;
    state.pushing = true;
    setSync("wait", "передача на компьютер…");
    try {
      const res = await api("/api/remote/push", {
        method: "POST",
        body: JSON.stringify({ document: state.doc, cid: state.cid, kind: "bank", name: deviceName() }),
      });
      state.version = res.version;
      setSync("ok", "передано на компьютер");
    } catch (err) {
      if (!state.stopped) setSync("err", "изменения не отправлены");
    } finally {
      state.pushing = false;
      flushPending();
    }
  }

  async function command(type, extra = {}) {
    try {
      const res = await api("/api/remote/command", { method: "POST", body: JSON.stringify({ type, ...extra }) });
      if (typeof res.version === "number") state.version = res.version;
      return res;
    } catch (err) {
      toast(err.message || "Не удалось");
      return null;
    }
  }

  async function waitForOpenedReport(path) {
    for (let i = 0; i < 24; i += 1) {
      try {
        const data = await api("/api/remote/session");
        rememberLists(data);
        if (data.document && data.path && sameFile(data.path, path)) {
          state.filesOpen = false;
          state.ops = false;
          applySnapshot(data, false);
          setSync("ok", "отчёт открыт");
          return true;
        }
      } catch {
        /* компьютер ещё открывает файл */
      }
      await sleep(160);
    }
    toast("Компьютер не открыл отчёт");
    paintFiles();
    return false;
  }

  async function openReport(path) {
    if (!path || sameFile(path, state.path)) {
      state.filesOpen = false;
      if (state.doc) showDoc();
      return;
    }
    if (state.dirty) await push();
    setSync("wait", "открываю на компьютере…");
    const res = await command("open", { path });
    if (!res) return;
    toast("Открываю на компьютере…");
    await waitForOpenedReport(path);
  }

  async function pollLoop() {
    while (!state.stopped) {
      const before = state.version;
      try {
        const data = await api(`/api/remote/pull?since=${state.version}`);
        if (data.enabled === false) {
          blocked("Сессия завершена", "На компьютере выключили удалённый доступ.");
          return;
        }
        if (typeof data.version === "number") state.version = Math.max(state.version, data.version);
        rememberLists(data);
        if (data.changed) applySnapshot(data, false);
        else {
          if (state.filesOpen) paintFiles();
          setSync(state.pushing ? "wait" : "ok", state.pushing ? "передача на компьютер…" : "на связи");
        }
        if (state.version <= before) await new Promise((resolve) => setTimeout(resolve, 400));
      } catch (err) {
        if (state.stopped) return;
        setSync("err", "нет связи с компьютером");
        await new Promise((resolve) => setTimeout(resolve, 2000));
      }
    }
  }

  function paintTelegram() {
    const tg = window.Telegram && window.Telegram.WebApp;
    if (!tg || !tg.initData) return;
    document.documentElement.classList.add("in-telegram");
    try { tg.ready(); } catch (e) {}
    try { tg.expand(); } catch (e) {}
    if (typeof tg.disableVerticalSwipes === "function") {
      try { tg.disableVerticalSwipes(); } catch (e) {}
    }
    const accent = getComputedStyle(document.documentElement).getPropertyValue("--accent").trim() || "#0f766e";
    const bg = getComputedStyle(document.documentElement).getPropertyValue("--bg").trim() || "#f1f5f9";
    try { tg.setHeaderColor(accent); } catch (e) {}
    try { tg.setBackgroundColor(bg); } catch (e) {}
    if (typeof tg.requestFullscreen === "function" && !tg.isFullscreen) {
      try { tg.requestFullscreen(); } catch (e) {}
    }
  }

  function toggleTheme() {
    const next = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = next;
    try { localStorage.setItem("finmaster.theme", next); } catch (e) {}
    $("btn-theme").textContent = next === "dark" ? "☀" : "☾";
    paintTelegram();
    if (!state.doc) return;
    if (state.ops) syncOps();
    else window.FinVault?.render(vaultApi());
  }

  async function boot() {
    paintTelegram();
    $("btn-theme").textContent = document.documentElement.dataset.theme === "dark" ? "☀" : "☾";
    const params = new URLSearchParams(location.search);
    state.token = params.get("t") || "";
    state.cid = cid();
    hookVault();
    window.FinVault?.bind(vaultApi());
    $("btn-theme").addEventListener("click", toggleTheme);
    $("btn-files").addEventListener("click", () => {
      if (state.doc && state.filesOpen) {
        state.filesOpen = false;
        showDoc();
        return;
      }
      showFiles(state.doc
        ? "Выберите другой файл. Он откроется на компьютере, и хранилище переключится на него."
        : "На компьютере не открыт отчёт. Выберите файл — он откроется в программе.");
    });
    $("empty").addEventListener("click", (e) => {
      const open = e.target.closest("[data-open-file]");
      if (open) openReport(open.dataset.openFile);
    });
    $("btn-ops").addEventListener("click", () => {
      if (!state.doc) return;
      state.ops = !state.ops;
      if (state.ops) syncOps();
      else window.FinVault?.render(vaultApi());
    });
    document.addEventListener("focusout", () => setTimeout(flushPending, 0));
    window.addEventListener("pagehide", () => {
      const body = JSON.stringify({ cid: state.cid });
      navigator.sendBeacon?.(
        `/api/remote/leave?t=${encodeURIComponent(state.token)}`,
        new Blob([body], { type: "application/json" })
      );
    });
    if (!state.token) {
      blocked("Нет доступа", "Откройте хранилище кнопкой в Telegram или по ссылке из окна «Телефон».");
      return;
    }
    try {
      const data = await api("/api/remote/session");
      applySnapshot(data, true);
      setSync("ok", state.doc ? "подключено" : "отчёт не открыт");
      pollLoop();
    } catch (err) {
      if (!state.stopped) blocked("Нет связи", "Компьютер недоступен. Проверьте, что FinMaster запущен и доступ включён.");
    }
  }

  boot();
})();
