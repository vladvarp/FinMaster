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
        const probe = $("remote-ngrok")?.checked ? "?probe=1" : "";
        applyRemotePayload(await apiGet(`/api/remote/info${probe}`));
        renderRemoteLive();
        renderRemoteSignals();
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
    if (typeof data.windows_login === "boolean") remote.windowsLogin = data.windows_login;
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
      setTokenDot("ngrok-token-dot", { state: "err", title: remote.tunnel.error });
    } else if (remote.ngrok && remote.public_url && remote.tunnel?.online !== false) {
      setTokenDot("ngrok-token-dot", { state: "live", title: "Туннель выходит в интернет" });
    } else if (remote.ngrok) {
      setTokenDot("ngrok-token-dot", { state: "on", title: "Токен сохранён, туннель ещё не открыт" });
    } else {
      setTokenDot("ngrok-token-dot", { state: "on", title: "Токен сохранён, туннель выключен" });
    }

    if (!remote.telegramReady && !remote.telegramListening) {
      setTokenDot("tg-token-dot", { state: "", title: "Токен Telegram-бота не сохранён" });
    } else if (remote.telegramError) {
      setTokenDot("tg-token-dot", { state: "err", title: `Нет связи: ${remote.telegramError}` });
    } else if (remote.telegramListening) {
      setTokenDot("tg-token-dot", { state: "live", title: "Бот слушает сообщения" });
    } else {
      setTokenDot("tg-token-dot", { state: "on", title: "Токен сохранён, бот сейчас не слушает" });
    }
  }

  function renderRemoteSignals() {
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
        tgStatus.textContent = "Токен сохранён. Нажмите «Проверить связь», если бот не отвечает.";
      } else {
        tgStatus.textContent = "Вставьте токен от @BotFather и нажмите «Запомнить токен».";
      }
    }
    const ngrokStatus = $("remote-ngrok-status");
    if (ngrokStatus && !ngrokStatus.dataset.hold) {
      const tun = remote.tunnel || {};
      ngrokStatus.className = "remote-ngrok-status";
      if (!remote.ngrok && !remote.ngrokReady) ngrokStatus.textContent = "";
      else if (!remote.ngrok) ngrokStatus.textContent = "Туннель выключен. Токен сохранён.";
      else if (tun.error) {
        ngrokStatus.classList.add("err");
        ngrokStatus.textContent = tun.error;
      } else if (remote.public_url && tun.online !== false) {
        ngrokStatus.classList.add("ok");
        ngrokStatus.textContent = "Туннель открыт. Сканируйте QR или сохраните ссылку в закладки — работает из любой сети.";
      } else if (!remote.ngrokInstalled) {
        ngrokStatus.classList.add("err");
        ngrokStatus.textContent = "ngrok не установлен. Скачайте с ngrok.com и добавьте в PATH.";
      } else {
        ngrokStatus.textContent = "Туннель ещё не поднят — сохраните токен и включите доступ.";
      }
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
    const login = $("remote-windows-login");
    if (login && typeof remote.windowsLogin === "boolean") login.checked = remote.windowsLogin;
    const ngrokChk = $("remote-ngrok");
    if (ngrokChk) ngrokChk.checked = !!remote.ngrok;
    const ngrokCheck = $("remote-ngrok-check");
    if (ngrokCheck) ngrokCheck.disabled = !remote.ngrok;
    const tokenInput = $("remote-ngrok-token");
    if (tokenInput && remote.ngrokReady && !tokenInput.value) tokenInput.placeholder = "токен сохранён — можно не вводить заново";
    const tgToken = $("remote-tg-token");
    if (tgToken && remote.telegramReady && !tgToken.value) tgToken.placeholder = "токен сохранён — можно не вводить заново";
    const tgChat = $("remote-tg-chat");
    if (tgChat && remote.telegramChatId && !tgChat.value) tgChat.value = remote.telegramChatId;
    renderRemoteSignals();
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

  function watchRemoteAccess() {
    if (remote.accessWatch) return;
    remote.accessWatch = true;
    const tick = async () => {
      if (!state.desktop) return;
      try {
        const data = await apiGet("/api/remote/info");
        const was = !!remote.enabled;
        applyRemotePayload(data);
        if (!!remote.enabled !== was) {
          const auto = $("remote-autostart");
          if (auto) auto.checked = !!remote.enabled;
          if ($("remote-modal")?.classList.contains("open")) renderRemoteLive();
          else remoteBadge();
          if (remote.enabled) remotePublish();
        }
        if (remote.enabled && !remote.polling) remotePoll();
      } catch {
        /* сервер ещё поднимается */
      }
      if (state.desktop) setTimeout(tick, 2500);
    };
    setTimeout(tick, 2500);
  }

  async function remotePoll() {
    if (remote.polling) return;
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
      const ngrokCheck = $("remote-ngrok-check");
      if (ngrokCheck) ngrokCheck.disabled = !on;
      if (on) $("remote-ngrok-box")?.closest(".remote-fold")?.classList.remove("collapsed");
      const token = $("remote-ngrok-token")?.value?.trim() || "";
      const body = { enabled: on };
      if (token) body.authtoken = token;
      try {
        if (on && !remote.enabled) await remoteStart();
        renderRemoteModal(await apiPost("/api/remote/ngrok", body));
        const tun = remote.tunnel || {};
        toast(
          on
            ? remote.public_url
              ? "Интернет-туннель включён"
              : tun.error || "Туннель включён, ссылка пока локальная"
            : "Интернет-туннель выключен, токен сохранён"
        );
      } catch (err) {
        e.target.checked = !on;
        if (ngrokCheck) ngrokCheck.disabled = on;
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
    const checkRemoteLink = async (kind) => {
      if (kind === "ngrok" && !$("remote-ngrok")?.checked) return;
      const status = $(kind === "ngrok" ? "remote-ngrok-status" : "remote-tg-status");
      const btn = $(kind === "ngrok" ? "remote-ngrok-check" : "remote-tg-check");
      if (status) {
        status.dataset.hold = "1";
        status.className = "remote-ngrok-status";
        status.textContent = "Проверяю связь…";
      }
      if (btn) btn.disabled = true;
      try {
        const body = { kind };
        if (kind === "telegram") {
          const token = $("remote-tg-token")?.value?.trim();
          if (token) body.token = token;
        }
        const data = await apiPost("/api/remote/check", body);
        renderRemoteModal(data);
        if (status) {
          status.className = `remote-ngrok-status ${data.ok ? "ok" : "err"}`;
          status.textContent = data.check || (data.ok ? "Связь есть" : "Нет связи");
        }
        toast(data.check || (data.ok ? "Связь есть" : "Нет связи"));
      } catch (err) {
        if (status) {
          status.className = "remote-ngrok-status err";
          status.textContent = err.message || String(err);
        }
        toast(`Проверка связи: ${err.message || err}`);
      } finally {
        if (status) delete status.dataset.hold;
        if (btn) btn.disabled = false;
      }
    };
    $("remote-ngrok-check")?.addEventListener("click", () => checkRemoteLink("ngrok"));
    $("remote-tg-check")?.addEventListener("click", () => checkRemoteLink("telegram"));
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
    $("remote-windows-login")?.addEventListener("change", async (e) => {
      const want = !!e.target.checked;
      try {
        const data = await apiPost("/api/remote/windows-login", { enabled: want });
        remote.windowsLogin = !!data.windows_login;
        e.target.checked = remote.windowsLogin;
        toast(remote.windowsLogin ? "FinMaster откроется вместе с Windows" : "Автозагрузка выключена");
      } catch (err) {
        e.target.checked = !want;
        toast(err.message || "Не удалось изменить автозагрузку");
      }
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
      hydratePrefs(bootData.ui_prefs);
      applyTheme(bootData.theme || "light", false);
      await renderStartLists(bootData);
      libraryWatchLoop();
      await apiPost("/api/dirty", { dirty: false });
      if (bootData.remote) {
        applyRemotePayload(bootData.remote);
        remoteBadge();
        if (remote.enabled && !remote.polling) remotePoll();
      }
      watchRemoteAccess();
      watchDesktopPdfJobs();
    } catch {
      state.desktop = false;
      state.autosave = localStorage.getItem(LS_AUTOSAVE) === "true";
      applyTheme(localStorage.getItem(LS_THEME) || "light", false);
      await renderRecent();
    }
    $("autosave") && ($("autosave").checked = state.autosave);
  }

  window.finmasterNew = createNew;
  window.finmasterOpen = openFromDialog;

  boot();
