/* Удалённое окно того же интерфейса. Файлы пишет сервер на главном компьютере. */
(() => {
  const params = new URLSearchParams(location.search);
  const token = params.get("t") || "";
  const cidKey = "finmaster.desk.id";
  let cid = "";
  try {
    cid = localStorage.getItem(cidKey) || sessionStorage.getItem(cidKey) || "";
    if (!cid) cid = Math.random().toString(36).slice(2) + Date.now().toString(36);
    localStorage.setItem(cidKey, cid);
  } catch {
    cid = Math.random().toString(36).slice(2);
  }

  const ua = navigator.userAgent || "";
  const browser = /Telegram/i.test(ua)
    ? "Telegram"
    : /Edg\//.test(ua)
      ? "Edge"
      : /Chrome\//.test(ua)
        ? "Chrome"
        : /Firefox\//.test(ua)
          ? "Firefox"
          : /Safari\//.test(ua)
            ? "Safari"
            : "Браузер";
  let name = browser;
  const profile = {
    model: "",
    platform: navigator.platform || "",
    platform_version: "",
    brands: "",
    full_version: "",
    architecture: "",
    bitness: "",
  };
  let deviceHeaderValue = "";

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

  function paintDeskName() {
    if (profile.model && /Telegram/i.test(ua)) name = `Telegram · ${profile.model}`;
    else if (profile.model) name = profile.model;
    else name = browser;
  }

  function deviceFacts() {
    const languages = navigator.languages && navigator.languages.length ? navigator.languages.join(", ") : "";
    return {
      name,
      model: profile.model || "",
      platform: profile.platform || "",
      platform_version: profile.platform_version || "",
      brands: profile.brands || browser,
      full_version: profile.full_version || "",
      architecture: profile.architecture || "",
      bitness: profile.bitness || "",
      user_agent: ua,
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

  function refreshDeviceHeader() {
    paintDeskName();
    try {
      deviceHeaderValue = btoa(unescape(encodeURIComponent(JSON.stringify(deviceFacts()))));
    } catch {
      deviceHeaderValue = "";
    }
  }

  async function enrichDevice() {
    refreshDeviceHeader();
    const uaData = navigator.userAgentData;
    try {
      if (uaData) {
        profile.platform = uaData.platform || profile.platform;
        profile.brands = (uaData.brands || [])
          .map((item) => `${item.brand}${item.version ? " " + item.version : ""}`)
          .filter((item) => item && !/not.?a.?brand/i.test(item))
          .join(", ");
        if (uaData.getHighEntropyValues) {
          const high = await Promise.race([
            uaData.getHighEntropyValues(["model", "platform", "platformVersion", "architecture", "bitness", "fullVersionList"]),
            new Promise((resolve) => setTimeout(() => resolve({}), 800)),
          ]);
          profile.model = String(high.model || "").trim();
          profile.platform = high.platform || profile.platform;
          profile.platform_version = String(high.platformVersion || "").trim();
          profile.architecture = String(high.architecture || "").trim();
          profile.bitness = String(high.bitness || "").trim();
          if (Array.isArray(high.fullVersionList)) {
            profile.full_version = high.fullVersionList
              .filter((item) => item && item.brand && !/not.?a.?brand/i.test(item.brand))
              .map((item) => `${item.brand} ${item.version}`)
              .join(", ");
          }
        }
      }
    } catch {
      /* браузер не отдал модель */
    }
    refreshDeviceHeader();
    helloDesk();
  }

  window.FM_DESK = true;
  document.documentElement.classList.add("fm-desk");

  const native = window.fetch.bind(window);
  let locked = false;
  let shown = false;
  let statusReady = false;
  let last = { mine: false, free: true };
  let noteTimer = 0;

  const OPEN_WHEN_LOCKED = new Set([
    "/api/open-path",
    "/api/backups",
    "/api/remote/desk/take",
    "/api/remote/desk/beat",
    "/api/remote/desk/leave",
  ]);

  function pathOf(input) {
    const raw = typeof input === "string" ? input : input && input.url ? input.url : "";
    try {
      return new URL(raw, location.origin).pathname;
    } catch {
      return "";
    }
  }

  function methodOf(input, init) {
    return String((init && init.method) || (input && input.method) || "GET").toUpperCase();
  }

  function withDesk(init) {
    const headers = new Headers((init && init.headers) || {});
    if (token) headers.set("X-FM-Token", token);
    if (cid) headers.set("X-FM-Desk", cid);
    if (deviceHeaderValue) headers.set("X-FM-Device", deviceHeaderValue);
    return { ...(init || {}), headers };
  }

  function jsonResponse(data, status = 200) {
    return new Response(JSON.stringify(data), {
      status,
      headers: { "Content-Type": "application/json" },
    });
  }

  function deskNote(text) {
    const el = document.getElementById("fm-desk-note");
    if (!el) return;
    el.hidden = !text;
    el.textContent = text || "";
    clearTimeout(noteTimer);
    if (text) noteTimer = setTimeout(() => {
      el.hidden = true;
    }, 4200);
  }

  let syncCount = 0;

  function syncMark() {
    const el = document.getElementById("fm-desk-sync");
    if (!el) return;
    el.hidden = syncCount <= 0;
  }

  function ensureChrome() {
    if (document.getElementById("fm-desk-sync")) return;
    const sync = document.createElement("div");
    sync.id = "fm-desk-sync";
    sync.hidden = true;
    sync.textContent = "Передача на компьютер…";
    const note = document.createElement("div");
    note.id = "fm-desk-note";
    note.hidden = true;
    document.body.append(sync, note);
  }

  async function readJson(res) {
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || "Нет связи с главным компьютером");
    return data;
  }

  async function pullLock() {
    if (!token) return;
    try {
      const res = await native(`/api/remote/desk?name=${encodeURIComponent(name)}`, withDesk({}));
      paint(await readJson(res));
    } catch {
      /* следующая проверка */
    }
    if (!statusReady) {
      statusReady = true;
      reveal();
    }
  }

  async function beat() {
    if (locked || !token) return;
    try {
      const res = await native("/api/remote/desk/beat", withDesk({
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      }));
      paint(await readJson(res));
    } catch {
      /* управление снимут по таймауту */
    }
  }

  async function take() {
    const res = await native("/api/remote/desk/take", withDesk({
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    }));
    paint(await readJson(res));
  }

  function pickFile() {
    return new Promise((resolve) => {
      const input = document.createElement("input");
      input.type = "file";
      input.accept = ".fmaster,.fbak,.json,application/json";
      let settled = false;
      const finish = (file) => {
        if (settled) return;
        settled = true;
        resolve(file || null);
      };
      input.addEventListener("change", () => finish(input.files && input.files[0]));
      window.addEventListener("focus", () => setTimeout(() => finish(input.files && input.files[0]), 500), { once: true });
      input.click();
    });
  }

  async function importFile() {
    const file = await pickFile();
    if (!file) return jsonResponse({ cancelled: true });
    let content = "";
    try {
      content = await file.text();
    } catch {
      deskNote("Не удалось прочитать файл");
      return jsonResponse({ cancelled: true });
    }
    const res = await native("/api/remote/desk/import", withDesk({
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: file.name, content }),
    }));
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      deskNote(data.error || "Файл не добавлен на главный компьютер");
      return jsonResponse({ cancelled: true });
    }
    return jsonResponse(data);
  }

  async function hostPath(suggested, ext) {
    const res = await native("/api/remote/desk/path", withDesk({
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ suggested, ext }),
    }));
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.path) {
      deskNote(data.error || "Не удалось выбрать место на главном компьютере");
      return jsonResponse({ cancelled: true });
    }
    return jsonResponse({ path: data.path, cancelled: false });
  }

  async function localAction(path, init) {
    if (path === "/api/dialog/open") return importFile();
    if (path === "/api/dialog/save") {
      const body = JSON.parse((init && init.body) || "{}");
      return hostPath(body.suggested || "Отчёт.fmaster", ".fmaster");
    }
    if (path === "/api/dialog/export") {
      const body = JSON.parse((init && init.body) || "{}");
      return hostPath(body.suggested || "Экспорт.csv", ".csv");
    }
    if (path === "/api/dialog/png") {
      const body = JSON.parse((init && init.body) || "{}");
      return hostPath(body.suggested || "Заказ.png", ".png");
    }
    if (path === "/api/dialog/pdf") {
      const body = JSON.parse((init && init.body) || "{}");
      return hostPath(body.suggested || "Заказы.pdf", ".pdf");
    }
    if (path === "/api/instance/pending") return jsonResponse({ paths: [] });
    if (path === "/api/desktop/pdf-job") return jsonResponse({});
    if (path === "/api/quit" || path === "/api/open-folder" || path.startsWith("/api/runtime/")) {
      return jsonResponse({ error: "Это действие остаётся на главном компьютере." }, 403);
    }
    if (path === "/api/window/fullscreen") {
      try {
        if (document.fullscreenElement) await document.exitFullscreen();
        else await document.documentElement.requestFullscreen();
      } catch {
        /* браузер не дал полный экран */
      }
      return jsonResponse({ ok: true, fullscreen: !!document.fullscreenElement });
    }
    if (path === "/api/clipboard-text") {
      const body = JSON.parse((init && init.body) || "{}");
      await navigator.clipboard.writeText(String(body.text || ""));
      return jsonResponse({ ok: true });
    }
    if (path === "/api/clipboard-png") {
      return jsonResponse({ error: "Картинку в буфер можно скопировать на главном компьютере." }, 403);
    }
    return null;
  }

  function deskSame(a, b) {
    try {
      return JSON.stringify(a) === JSON.stringify(b);
    } catch {
      return false;
    }
  }

  function deskId(item) {
    return item && item.id != null && item.id !== "" ? String(item.id) : "";
  }

  function deskLinesPatch(prev, next) {
    const before = Array.isArray(prev) ? prev : [];
    const after = Array.isArray(next) ? next : [];
    if (before.some((line) => !deskId(line)) || after.some((line) => !deskId(line))) return null;
    const oldBy = new Map(before.map((line) => [deskId(line), line]));
    const upsert = [];
    const drop = [];
    const seen = new Set();
    after.forEach((line) => {
      const id = deskId(line);
      seen.add(id);
      if (!oldBy.has(id) || !deskSame(oldBy.get(id), line)) upsert.push(line);
    });
    before.forEach((line) => {
      const id = deskId(line);
      if (!seen.has(id)) drop.push(id);
    });
    const order = after.map(deskId);
    const moved = order.join("\0") !== before.map(deskId).join("\0");
    if (!upsert.length && !drop.length && !moved) return undefined;
    const patch = {};
    if (upsert.length) patch.upsert = upsert;
    if (drop.length) patch.delete = drop;
    if (moved || drop.length) patch.order = order;
    return patch;
  }

  function deskOrdersPatch(prev, next) {
    const before = Array.isArray(prev) ? prev : [];
    const after = Array.isArray(next) ? next : [];
    if (before.some((order) => !deskId(order)) || after.some((order) => !deskId(order))) return { replace: after };
    const oldBy = new Map(before.map((order) => [deskId(order), order]));
    const upsert = [];
    const drop = [];
    const seen = new Set();
    after.forEach((order) => {
      const id = deskId(order);
      seen.add(id);
      const old = oldBy.get(id);
      if (!old) {
        upsert.push(order);
        return;
      }
      if (deskSame(old, order)) return;
      const linesPatch = deskLinesPatch(old.lines, order.lines);
      if (linesPatch === null) {
        upsert.push(order);
        return;
      }
      const fields = { ...order };
      delete fields.lines;
      const oldFields = { ...old };
      delete oldFields.lines;
      const item = { id: order.id };
      if (!deskSame(oldFields, fields)) {
        Object.keys(fields).forEach((key) => {
          if (key !== "id") item[key] = fields[key];
        });
      }
      if (linesPatch) item.lines_patch = linesPatch;
      if (Object.keys(item).length > 1) upsert.push(item);
    });
    before.forEach((order) => {
      const id = deskId(order);
      if (!seen.has(id)) drop.push(id);
    });
    const orderIds = after.map(deskId);
    const moved = orderIds.join("\0") !== before.map(deskId).join("\0");
    if (!upsert.length && !drop.length && !moved) return null;
    const patch = {};
    if (upsert.length) patch.upsert = upsert;
    if (drop.length) patch.delete = drop;
    if (moved || drop.length) patch.order = orderIds;
    return patch;
  }

  window.FM_DESK_PATCH = (base, next) => {
    if (!base || !next) return null;
    const set = {};
    Object.keys(base).concat(Object.keys(next)).forEach((key) => {
      if (key === "modified_at" || key === "orders") return;
      if (Object.prototype.hasOwnProperty.call(set, key)) return;
      if (!deskSame(base[key], next[key])) set[key] = next[key];
    });
    const orders = deskOrdersPatch(base.orders, next.orders);
    if (orders && orders.replace) set.orders = orders.replace;
    const patch = {};
    if (Object.keys(set).length) patch.set = set;
    if (orders && !orders.replace) patch.orders = orders;
    if (!patch.set && !patch.orders) return { empty: true };
    return patch;
  };

  function reveal() {
    if (!shown || !statusReady) return;
    document.getElementById("fm-desk-load")?.remove();
  }

  window.FM_DESK_READY = () => {
    shown = true;
    reveal();
  };

  window.fetch = async (input, init) => {
    const path = pathOf(input);
    const method = methodOf(input, init);
    if (!token) return jsonResponse({ error: "Нет сессии." }, 401);
    if (path === "/api/dialog/open" || path.startsWith("/api/dialog/") || path === "/api/instance/pending" || path === "/api/desktop/pdf-job" || path === "/api/quit" || path === "/api/open-folder" || path.startsWith("/api/runtime/") || path === "/api/window/fullscreen" || path === "/api/clipboard-text" || path === "/api/clipboard-png") {
      try {
        const local = await localAction(path, init);
        if (local) return local;
      } catch (err) {
        deskNote(err.message || "Не удалось выполнить действие");
        return jsonResponse({ cancelled: true });
      }
    }
    const watch = method === "POST" && (path === "/api/write" || path === "/api/history" || path === "/api/remote/desk/import");
    if (watch) {
      syncCount += 1;
      syncMark();
    }
    try {
      return await native(input, withDesk(init));
    } finally {
      if (watch) {
        syncCount = Math.max(0, syncCount - 1);
        syncMark();
      }
    }
  };

  async function helloDesk() {
    if (!token || !cid) return;
    refreshDeviceHeader();
    try {
      await native("/api/remote/desk/beat", withDesk({
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      }));
    } catch {
      /* следующий удар */
    }
  }

  window.addEventListener("pagehide", () => {
    if (!token || !cid) return;
    refreshDeviceHeader();
    native("/api/remote/desk/leave", withDesk({
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
      keepalive: true,
    })).catch(() => {});
  });

  function bootChrome() {
    ensureChrome();
    statusReady = true;
    if (!token) {
      shown = true;
      deskNote("Откройте ссылку из окна «Телефон», из бота или из мобильного меню.");
      reveal();
      return;
    }
    reveal();
    helloDesk();
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") helloDesk();
    });
    enrichDevice();
  }

  if (document.body) bootChrome();
  else document.addEventListener("DOMContentLoaded", bootChrome);
})();
