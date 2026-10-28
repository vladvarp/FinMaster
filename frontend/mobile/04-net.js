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

  function utcLabel() {
    const minutes = -new Date().getTimezoneOffset();
    const sign = minutes >= 0 ? "+" : "−";
    const abs = Math.abs(minutes);
    const hours = Math.floor(abs / 60);
    const rest = abs % 60;
    return rest ? `UTC${sign}${hours}:${String(rest).padStart(2, "0")}` : `UTC${sign}${hours}`;
  }

  function connectionText() {
    const link = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
    if (!link) return "";
    return [link.effectiveType, link.downlink ? `${link.downlink} Мбит/с` : "", link.rtt ? `${link.rtt} мс` : "", link.saveData ? "экономия" : ""]
      .filter(Boolean)
      .join(" · ");
  }

  function prefersText() {
    const bits = [];
    try {
      bits.push(window.matchMedia("(prefers-color-scheme: dark)").matches ? "тёмная тема" : "светлая тема");
      if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) bits.push("без анимации");
      if (window.matchMedia("(pointer: coarse)").matches) bits.push("сенсор");
    } catch {
      /* браузер без matchMedia */
    }
    return bits.join(", ");
  }

  function devicePayload() {
    const info = state.device || {};
    const languages = navigator.languages && navigator.languages.length ? navigator.languages.join(", ") : "";
    return {
      name: deviceName(),
      model: info.model || "",
      platform: info.platform || "",
      platform_version: info.platformVersion || "",
      brands: info.brands || "",
      full_version: info.fullVersion || "",
      architecture: info.architecture || "",
      bitness: info.bitness || "",
      user_agent: navigator.userAgent || "",
      language: navigator.language || "",
      languages,
      screen: `${window.screen?.width || 0}×${window.screen?.height || 0}`,
      viewport: `${window.innerWidth}×${window.innerHeight}`,
      pixel_ratio: String(window.devicePixelRatio || 1),
      color_depth: String(window.screen?.colorDepth || ""),
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "",
      utc: utcLabel(),
      touch: String(navigator.maxTouchPoints || 0),
      cores: String(navigator.hardwareConcurrency || ""),
      memory: navigator.deviceMemory ? `${navigator.deviceMemory} ГБ` : "",
      connection: connectionText(),
      prefers: prefersText(),
      vendor: navigator.vendor || "",
      cookies: navigator.cookieEnabled ? "да" : "нет",
      online: navigator.onLine ? "да" : "нет",
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
            uaData.getHighEntropyValues(["model", "platform", "platformVersion", "architecture", "bitness", "fullVersionList"]),
            new Promise((resolve) => setTimeout(() => resolve({}), 700)),
          ]);
          info.model = String(high.model || "").trim();
          info.platform = high.platform || info.platform;
          info.platformVersion = String(high.platformVersion || "").trim();
          info.architecture = String(high.architecture || "").trim();
          info.bitness = String(high.bitness || "").trim();
          if (Array.isArray(high.fullVersionList)) {
            info.fullVersion = high.fullVersionList
              .filter((item) => item && item.brand && !/not.?a.?brand/i.test(item.brand))
              .map((item) => `${item.brand} ${item.version}`)
              .join(", ");
          }
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
    noteOnline();
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

  let telegramApp = null;

  function telegramColor(name, fallback) {
    return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;
  }

  function paintTelegram(tg) {
    if (!tg) return;
    const accent = telegramColor("--accent", "#0f766e");
    const bg = telegramColor("--bg", "#f1f5f9");
    try {
      tg.setHeaderColor(accent);
    } catch (_) {}
    try {
      tg.setBackgroundColor(bg);
    } catch (_) {}
    if (typeof tg.setBottomBarColor === "function") {
      try {
        tg.setBottomBarColor(bg);
      } catch (_) {}
    }
  }

  function enterTelegramFullscreen(tg) {
    if (!tg || typeof tg.requestFullscreen !== "function" || tg.isFullscreen) return;
    try {
      tg.requestFullscreen();
    } catch (_) {}
  }

  function refreshHomeScreenStatus() {
    const tg = telegramApp;
    if (!tg || typeof tg.checkHomeScreenStatus !== "function") {
      state.homeScreen = telegramApp ? "unsupported" : "";
      return;
    }
    try {
      tg.checkHomeScreenStatus((status) => {
        state.homeScreen = status || "unknown";
        if (state.view === "files") renderFiles();
        renderMenu();
      });
    } catch (_) {
      state.homeScreen = "unsupported";
    }
  }

  function addToHomeScreen() {
    const tg = telegramApp;
    if (!tg) {
      toast("Ярлык как у игр доступен только внутри Telegram");
      return;
    }
    if (typeof tg.addToHomeScreen !== "function") {
      toast("Обновите Telegram — эта версия не ставит ярлык на экран");
      return;
    }
    if (state.homeScreen === "added") {
      toast("Ярлык уже на экране телефона");
      return;
    }
    if (state.homeScreen === "unsupported") {
      toast("Телефон или Telegram не умеет ярлык Mini App. В @BotFather: Mini App → иконка.");
      return;
    }
    try {
      tg.addToHomeScreen();
    } catch (_) {
      toast("Не удалось показать запрос ярлыка");
    }
  }

  function initTelegram() {
    const tg = window.Telegram && window.Telegram.WebApp;
    if (!tg || !tg.initData) return;
    telegramApp = tg;
    document.documentElement.classList.add("in-telegram");
    document.documentElement.classList.toggle("tg-fullscreen", Boolean(tg.isFullscreen));
    try {
      tg.ready();
    } catch (_) {}
    try {
      tg.expand();
    } catch (_) {}
    if (typeof tg.disableVerticalSwipes === "function") {
      try {
        tg.disableVerticalSwipes();
      } catch (_) {}
    }
    paintTelegram(tg);
    enterTelegramFullscreen(tg);
    if (typeof tg.onEvent === "function") {
      tg.onEvent("fullscreenChanged", () => {
        document.documentElement.classList.toggle("tg-fullscreen", Boolean(tg.isFullscreen));
        paintTelegram(tg);
      });
      tg.onEvent("fullscreenFailed", (err) => {
        if (err && err.error === "ALREADY_FULLSCREEN") {
          document.documentElement.classList.add("tg-fullscreen");
        }
      });
      tg.onEvent("homeScreenAdded", () => {
        state.homeScreen = "added";
        toast("Ярлык добавлен на экран телефона");
        if (state.view === "files") renderFiles();
        renderMenu();
      });
      tg.onEvent("homeScreenChecked", (ev) => {
        if (ev && ev.status) state.homeScreen = ev.status;
      });
      tg.onEvent("homeScreenFailed", () => {
        toast("Ярлык не добавлен");
      });
    }
    refreshHomeScreenStatus();
    setTimeout(() => enterTelegramFullscreen(tg), 80);
    setTimeout(() => enterTelegramFullscreen(tg), 400);
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
        applyCalHidePause(data.cal_hide_pause, data.version);
        if (typeof data.version === "number") state.version = Math.max(state.version, data.version);
        if (typeof data.autosave === "boolean") applyAutosave(data.autosave);
        if (data.changed) applySnapshot(data);
        else {
          noteOnline();
          const lists = applyFileLists(data) && state.view === "files";
          const profiles = applyShareProfiles(data.share_profiles);
          if (lists) renderFiles();
          else if (profiles) refreshSnapProfiles();
        }
        if (state.version <= before) await sleep(400);
      } catch (err) {
        if (state.stopped) return;
        noteOffline();
        await sleep(2000);
      }
    }
  }

  function hasDocument() {
    return !!(state.doc && typeof state.doc === "object");
  }

  function normalizeHistory(raw) {
    const items = Array.isArray(raw?.items) ? raw.items : [];
    return {
      undo: !!raw?.undo,
      redo: !!raw?.redo,
      index: Number.isInteger(raw?.index) ? raw.index : -1,
      limit: Math.max(5, Math.min(200, Number(raw?.limit) || 40)),
      items,
    };
  }

  function historyTime(iso) {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return "";
    return d.toLocaleString("ru-RU", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
  }

  function fileListsSig(library, recent) {
    const lib = (library?.items || []).map((item) => `${item.path}|${item.modified_at}|${item.bytes}`).join("\n");
    const rec = (recent || []).map((item) => `${item.path}|${item.exists}`).join("\n");
    return `${lib}#${rec}`;
  }

  function applyFileLists(data) {
    if (!data) return false;
    const hasLib = data.library && typeof data.library === "object";
    const hasRec = Array.isArray(data.recent);
    if (!hasLib && !hasRec) return false;
    const library = hasLib ? data.library : state.library;
    const recent = hasRec ? data.recent : state.recent;
    const sig = fileListsSig(library, recent);
    if (sig === state.listsSig) return false;
    state.listsSig = sig;
    if (hasLib) state.library = library;
    if (hasRec) state.recent = recent;
    return true;
  }

  function applyShareProfiles(raw) {
    if (!Array.isArray(raw)) return false;
    const known = new Set(SNAP_FIELDS.map((f) => f.id));
    const next = [];
    raw.forEach((item) => {
      const name = String(item?.name || "").trim().replace(/\s+/g, " ");
      const fields = Array.isArray(item?.fields) ? item.fields.filter((id) => known.has(id)) : [];
      if (!name || !fields.length) return;
      next.push({
        name: name.slice(0, 80),
        fields,
        hideLabels: !!item.hideLabels,
        hideStamp: !!item.hideStamp,
      });
    });
    const sig = JSON.stringify(next);
    if (sig === state.shareProfilesSig) return false;
    state.shareProfilesSig = sig;
    state.shareProfiles = next;
    return true;
  }

  function refreshSnapProfiles() {
    if (state.view !== "snapshot" || document.activeElement?.id === "snap-title") return;
    renderSnapshot();
  }

  function snapProfileOn(profile) {
    const fields = [...(state.snap.fields || [])].filter((id) => SNAP_FIELDS.some((f) => f.id === id)).sort();
    return (
      [...profile.fields].sort().join("\0") === fields.join("\0") &&
      !!profile.hideLabels === !!state.snap.hideLabels &&
      !!profile.hideStamp === !!state.snap.hideStamp
    );
  }

  function applyCalHidePause(value, version) {
    if (typeof value !== "boolean") return false;
    if (state.cal.hidePauseLock) return false;
    if (typeof version === "number" && version < state.version) return false;
    if ((state.cal.hidePause !== false) === value) return false;
    state.cal.hidePause = value;
    if (state.view === "calendar") renderCalendar();
    return true;
  }

  function applySnapshot(data, initial = false) {
    applyCalHidePause(data.cal_hide_pause, data.version);
    const profilesChanged = applyShareProfiles(data.share_profiles);
    if (typeof data.version === "number") state.version = Math.max(state.version, data.version);
    if (typeof data.autosave === "boolean") applyAutosave(data.autosave);
    const prevPath = state.path;
    const prevHadDoc = !!state.doc;
    const pathChanged = !!(data.path && prevPath && !sameFile(data.path, prevPath));
    const expectHit = !!(state.expectPath && data.path && sameFile(data.path, state.expectPath));
    if (typeof data.path === "string") state.path = data.path;
    if (typeof data.dirty === "boolean") state.dirty = data.dirty;
    if (Array.isArray(data.clients)) state.clients = data.clients;
    const listsChanged = applyFileLists(data);
    if (data.history && typeof data.history === "object") {
      state.history = normalizeHistory(data.history);
      if ($("sheet-title")?.textContent === "История" && !$("sheet").hidden) renderHistorySheet();
    }
    updateHead();
    if (!data.document) {
      if (state.doc) state.doc = null;
      state.waitingForDoc = true;
      if (!initial && state.view !== "files") setView("files");
      else if (!initial) renderCurrent();
      return;
    }
    const incomingVer = typeof data.doc_version === "number" ? data.doc_version : null;
    const fresh = incomingVer == null ? true : incomingVer > state.docVersion;
    if (!initial && !fresh && !pathChanged && !expectHit) {
      if (listsChanged && state.view === "files") renderFiles();
      else if (profilesChanged) refreshSnapProfiles();
      return;
    }
    if (!initial && data.origin === state.cid && !pathChanged && !expectHit) {
      if (incomingVer != null) state.docVersion = Math.max(state.docVersion, incomingVer);
      if (listsChanged && state.view === "files") renderFiles();
      else if (profilesChanged) refreshSnapProfiles();
      return;
    }
    if (!initial && (state.pushTimer || state.pushing || isTyping()) && !pathChanged && !expectHit) {
      if (data.document) state.pending = data.document;
      if (listsChanged && state.view === "files") renderFiles();
      else if (profilesChanged) refreshSnapProfiles();
      return;
    }
    if (incomingVer != null) state.docVersion = Math.max(state.docVersion, incomingVer);
    state.doc = data.document;
    syncMoneyFmt(moneyDecimals());
    const opened = !initial && (!prevHadDoc || pathChanged || expectHit);
    if (expectHit) state.expectPath = "";
    if (!initial) {
      state.offline = false;
      setSync("ok", opened ? "отчёт открыт" : "обновлено с компьютера");
    }
    if (opened && (state.view === "files" || state.waitingForDoc)) {
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
    syncMoneyFmt(moneyDecimals());
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

  async function waitForOpenedReport(path) {
    state.expectPath = path;
    wakeSleep();
    for (let i = 0; i < 24; i += 1) {
      try {
        const data = await api("/api/remote/session");
        if (data.document && data.path && sameFile(data.path, path)) {
          applySnapshot(data);
          if (state.view === "files") setView("orders");
          return;
        }
      } catch {
        /* компьютер ещё поднимается */
      }
      await sleep(160);
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

  function applyAutosave(enabled) {
    if (typeof enabled !== "boolean") return;
    state.autosave = enabled;
    const el = $("m-autosave");
    if (el) el.checked = enabled;
  }

  function navReport() {
    if (state.stopped || !state.token) return;
    const view = state.view;
    const orderId = view === "order" ? state.orderId || "" : "";
    const payload = { view, order_id: orderId, cid: state.cid };
    if (view === "order" && state.editLineId) payload.line_id = state.editLineId;
    if (view === "stats") {
      payload.period = state.stats.period || "all";
      payload.filter = state.stats.filter || "all";
      payload.status = state.stats.status || "";
    }
    if (view === "calendar") {
      const cal = state.cal;
      const anchor = cal.anchor instanceof Date && !Number.isNaN(cal.anchor.getTime()) ? dayKey(dayStart(cal.anchor)) : "";
      payload.cal_mode = cal.mode === "extended" || cal.mode === "day" ? cal.mode : "classic";
      payload.cal_day = anchor;
      payload.cal_pick = cal.pick || "";
      payload.cal_filter = cal.filter || "all";
    }
    api("/api/remote/nav", { method: "POST", body: JSON.stringify(payload) }).catch(() => {});
  }

