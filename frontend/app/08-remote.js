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
    deskLocked: false,
    deskBeat: 0,
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
    $("net-console-cal-next")?.addEventListener("click", () => applyClockOffset(clockOffsetDays + 1));
    $("net-console-cal-reset")?.addEventListener("click", () => applyClockOffset(0));
    paintClockOffset();
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
    const phones = remote.clients?.filter((c) => c.kind === "mobile" || c.kind === "bank").length || 0;
    document.querySelectorAll(".phone-live").forEach((live) => {
      live.hidden = !remote.enabled;
      live.textContent = phones ? String(phones) : "";
      live.classList.toggle("idle", remote.enabled && !phones);
    });
    document.querySelectorAll(".phone-btn").forEach((btn) => btn.classList.toggle("on", remote.enabled));
    paintTelegramAsk();
  }

  function paintTelegramAsk() {
    const count = remote.telegramPending?.length || 0;
    document.querySelectorAll(".phone-ask").forEach((mark) => {
      mark.hidden = !count;
      mark.textContent = count > 1 ? String(count) : "";
    });
  }

  function telegramNick(person) {
    if (person?.username) return `@${String(person.username).replace(/^@/, "")}`;
    if (person?.name) return person.name;
    return person?.id || "";
  }

  function renderTelegramPeople() {
    const pending = $("remote-tg-pending");
    const users = $("remote-tg-users");
    if (pending) {
      const rows = remote.telegramPending || [];
      pending.innerHTML = rows.length ? rows.map((person) => `
        <div class="remote-tg-person">
          <span><b>${esc(telegramNick(person))}</b><small>id ${esc(person.id || "")}</small></span>
          <button type="button" class="btn small" data-tg-decline="${esc(person.id || "")}">Отклонить</button>
          <button type="button" class="btn small primary" data-tg-approve="${esc(person.id || "")}">Добавить</button>
        </div>
      `).join("") : "";
    }
    if (users) {
      const rows = remote.telegramUsers || [];
      users.innerHTML = rows.length ? rows.map((person) => `
        <div class="remote-tg-person">
          <span><b>${esc(telegramNick(person))}</b><small>id ${esc(person.id || "")}</small></span>
          <button type="button" class="btn small danger" data-tg-remove="${esc(person.id || "")}">Удалить</button>
        </div>
      `).join("") : '<p class="report-settings-hint">Подтверждённых пользователей пока нет. Пусть человек напишет боту.</p>';
    }
  }

  function applyRemotePayload(data) {
    if (!data) return;
    if (typeof data.enabled === "boolean") remote.enabled = data.enabled;
    if (data.url) remote.url = data.url;
    if (data.ip) remote.ip = data.ip;
    if (data.ips) remote.ips = data.ips;
    if (Array.isArray(data.clients)) remote.clients = data.clients;
    if (Array.isArray(data.devices)) remote.devices = data.devices;
    if (typeof data.autostart === "boolean") remote.autostart = data.autostart;
    if (typeof data.windows_login === "boolean") {
      remote.windowsLogin = data.windows_login;
      paintWindowsLogin();
    }
    if (data.qr) remote.qr = data.qr;
    if (data.lan_url) remote.lan_url = data.lan_url;
    if ("public_url" in data) remote.public_url = data.public_url || "";
    if (data.via) remote.via = data.via;
    if (typeof data.ngrok === "boolean") remote.ngrok = data.ngrok;
    if (typeof data.ngrok_ready === "boolean") remote.ngrokReady = data.ngrok_ready;
    if (typeof data.ngrok_installed === "boolean") remote.ngrokInstalled = data.ngrok_installed;
    if (data.tunnel) remote.tunnel = data.tunnel;
    if (typeof data.telegram_ready === "boolean") remote.telegramReady = data.telegram_ready;
    if (Array.isArray(data.telegram_users)) remote.telegramUsers = data.telegram_users;
    if (Array.isArray(data.telegram_pending)) {
      const next = data.telegram_pending.length;
      if (remote.pendingReady && next > (remote.telegramPending || []).length) toast("Запрос доступа к боту");
      remote.telegramPending = data.telegram_pending;
      remote.pendingReady = true;
      paintTelegramAsk();
      if ($("remote-modal")?.classList.contains("open")) renderTelegramPeople();
    }
    if (typeof data.telegram_listening === "boolean") remote.telegramListening = data.telegram_listening;
    if ("telegram_error" in data) remote.telegramError = data.telegram_error || "";
    if (data.desk) applyPcDeskLock(data.desk);
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
    return (remote.clients || []).filter((c) => c.kind === "mobile" || c.kind === "bank");
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
    // #region agent log
    const devSig = devices.map((d) => `${String(d.id).slice(-6)}:${live.has(d.id) ? 1 : 0}:${d.name || ""}`).join("|");
    if (devSig !== window.__fmDevSig) {
      window.__fmDevSig = devSig;
      fetch("http://127.0.0.1:7439/ingest/2217c639-1122-4f34-8d73-9f66df23a223", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Debug-Session-Id": "871c54" },
        body: JSON.stringify({
          sessionId: "871c54",
          runId: "pre",
          hypothesisId: "E",
          location: "08-remote.js:renderRemoteDevices",
          message: "device list",
          data: {
            online,
            live: [...live.values()].map((c) => ({ tail: String(c.id).slice(-6), kind: c.kind, name: c.name })),
            devices: devices.map((d) => ({ tail: String(d.id).slice(-6), name: d.name, on: live.has(d.id) })),
          },
          timestamp: Date.now(),
        }),
      }).catch(() => {});
    }
    // #endregion
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

  function remoteDeskUrl() {
    return String(remote.url || "").includes("/m?") ? remote.url.replace("/m?", "/desk?") : "";
  }

  function remoteBankUrl() {
    return String(remote.url || "").includes("/m?") ? remote.url.replace("/m?", "/bank?") : "";
  }

  function paintRemoteUrl(el, url, caption) {
    if (!el) return;
    el.replaceChildren();
    if (!url) {
      el.textContent = el.id === "remote-url" ? "—" : "";
      return;
    }
    const label = document.createElement("span");
    label.className = "remote-url-k";
    label.textContent = caption;
    el.append(label, document.createTextNode(" "));
    String(url).split(/([/?&=.:_\-])/).forEach((part) => {
      el.append(document.createTextNode(part));
      if (/^[/?&=.:_\-]$/.test(part)) el.append(document.createElement("wbr"));
    });
  }

  function paintRemoteLink(rowId, buttonId, urlId, url, caption) {
    const row = $(rowId);
    const button = $(buttonId);
    const on = !!url;
    if (row && rowId !== "remote-phone-row") row.hidden = !on;
    if (button) button.hidden = !on;
    paintRemoteUrl($(urlId), url, caption);
  }

  async function copyRemoteLink(text, okText) {
    if (!text) return;
    try {
      if (state.desktop) await apiPost("/api/clipboard-text", { text });
      else await navigator.clipboard.writeText(text);
      toast(okText);
    } catch {
      toast("Не удалось скопировать ссылку");
    }
  }

  function paintWindowsLogin() {
    const login = $("remote-windows-login");
    if (login && typeof remote.windowsLogin === "boolean") login.checked = remote.windowsLogin;
  }

  function renderRemoteModal(data) {
    applyRemotePayload(data);
    const qrBox = $("remote-qr");
    if (remote.qr) qrBox.innerHTML = remote.qr;
    else if (!remote.enabled) qrBox.innerHTML = '<div class="remote-qr-empty">Сессия не запущена</div>';
    paintRemoteLink("remote-phone-row", "remote-copy", "remote-url", remote.url || "", "Телефон");
    paintRemoteLink("remote-desk-row", "remote-copy-desk", "remote-desk-url", remoteDeskUrl(), "Интерфейс ПК");
    paintRemoteLink("remote-bank-row", "remote-copy-bank", "remote-bank-url", remoteBankUrl(), "Хранилище");
    renderRemoteIps();
    const auto = $("remote-autostart");
    if (auto) auto.checked = !!remote.autostart;
    paintWindowsLogin();
    const ngrokChk = $("remote-ngrok");
    if (ngrokChk) ngrokChk.checked = !!remote.ngrok;
    const ngrokCheck = $("remote-ngrok-check");
    if (ngrokCheck) ngrokCheck.disabled = !remote.ngrok;
    const tokenInput = $("remote-ngrok-token");
    if (tokenInput && remote.ngrokReady && !tokenInput.value) tokenInput.placeholder = "токен сохранён — можно не вводить заново";
    const tgToken = $("remote-tg-token");
    if (tgToken && remote.telegramReady && !tgToken.value) tgToken.placeholder = "токен сохранён — можно не вводить заново";
    renderTelegramPeople();
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
    try {
      if (ngrokToken) await apiPost("/api/remote/ngrok", { authtoken: ngrokToken });
      if (tgToken) await apiPost("/api/remote/telegram", { token: tgToken });
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
    if (window.FM_DESK) return;
    if (remote.deskLocked) return;
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
    if (window.FM_DESK) return;
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
    if (window.FM_DESK) return;
    if (remote.polling) return;
    remote.polling = true;
    while (remote.enabled) {
      try {
        const data = await apiGet(`/api/remote/pull?since=${remote.version}&cid=${remote.cid}&kind=desktop`);
        if (data.enabled === false) break;
        applyRemoteHidePause(data);
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
        if (data.desk) applyPcDeskLock(data.desk);
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

  function applyRemoteHidePause(data) {
    if (typeof data?.cal_hide_pause !== "boolean") return;
    if (typeof data.version === "number" && data.version < remote.version) return;
    const cal = calendarState();
    const next = data.cal_hide_pause;
    if ((cal.hidePause !== false) === next) return;
    cal.hidePause = next;
    persistPref(LS_CAL_HIDE_PAUSE, JSON.stringify(next), { now: true });
    if (state.view === "calendar" && state.doc) renderCalendar();
    if (state.phoneCalNav && $("phone-cal-modal")?.classList.contains("open")) applyPhoneCalendar(state.phoneCalNav);
  }

  function applyRemoteAutosave(enabled) {
    if (window.FM_DESK) return;
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

  function pcDeskNote(text) {
    ensurePcDeskLock();
    const el = $("fm-pc-sync");
    if (!el) return;
    el.hidden = !text;
    el.textContent = text || "";
    clearTimeout(pcDeskNote.timer);
    if (text) pcDeskNote.timer = setTimeout(() => { el.hidden = true; }, 2600);
  }

  function applyPcDeskLock() {
    remote.deskLocked = false;
    document.documentElement.classList.remove("fm-pc-locked");
    const card = $("fm-pc-lock");
    if (card) card.hidden = true;
    stopPcDeskBeat();
  }

  function ensurePcDeskLock() {
    if ($("fm-pc-lock")) return;
    const lock = document.createElement("div");
    lock.id = "fm-pc-lock";
    lock.hidden = true;
    lock.innerHTML = `<div class="fm-pc-card"><h2>Управление заблокировано</h2><p id="fm-pc-lock-text"></p><button type="button" id="fm-pc-take">Перехватить управление</button></div>`;
    const note = document.createElement("div");
    note.id = "fm-pc-sync";
    note.hidden = true;
    document.body.append(lock, note);
    $("fm-pc-take")?.addEventListener("click", () => {
      pcDeskTake().catch((err) => toast(err.message || "Не удалось перехватить управление"));
    });
    document.addEventListener("keydown", (e) => {
      if (!remote.deskLocked) return;
      if (e.target && e.target.closest && e.target.closest("#fm-pc-lock")) return;
      e.preventDefault();
      e.stopPropagation();
    }, true);
  }

  function startPcDeskBeat() {
    if (remote.deskBeat) return;
    const beat = () => {
      fetch("/api/remote/desk/beat", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-FM-Desk": "pc" },
        body: JSON.stringify({ name: "Компьютер" }),
      }).catch(() => {});
    };
    beat();
    remote.deskBeat = setInterval(beat, 3000);
  }

  function stopPcDeskBeat() {
    if (!remote.deskBeat) return;
    clearInterval(remote.deskBeat);
    remote.deskBeat = 0;
  }

  async function pcDeskTake() {
    const res = await fetch("/api/remote/desk/take", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-FM-Desk": "pc" },
      body: JSON.stringify({ name: "Компьютер" }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || "Не удалось перехватить управление");
    applyPcDeskLock(data);
  }

  function applyRemoteDoc(doc, origin) {
    if (state.preview) return;
    const active = document.activeElement;
    const typing = active && /^(INPUT|SELECT|TEXTAREA)$/.test(active.tagName);
    if (typing) {
      remote.deferred = doc;
      remote.deferredOrigin = origin;
      return;
    }
    const fromBank = (remote.clients || []).some((c) => c.id === origin && c.kind === "bank");
    const fromDesk = String(origin || "").startsWith("web:") || origin === "desk" || (remote.clients || []).some((c) => c.id === origin && c.kind === "desk");
    if (fromDesk) {
      clearTimeout(state.autosaveTimer);
      remote.applying = true;
      remote.origin = origin || "";
      state.doc = doc;
      showApp();
      renderAll();
      setClean();
      remote.applying = false;
      if (state.path) {
        apiPost("/api/history", { path: state.path, read: true }).then((res) => {
          if (res.history && Array.isArray(res.history.items) && res.history.items.length) {
            adoptHistory(res.history, res.history_limit);
          }
        }).catch(() => {});
      }
      pcDeskNote("Пришли изменения из WEB");
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
    toast(fromBank ? "Изменения из хранилища применены" : "Изменения с телефона применены");
  }

  function showCloudOverview() {
    state.focusOrderId = null;
    state.focusLineId = null;
    if (state.view !== "cloud" || !orderCloud) return;
    orderCloud.select(null);
    orderCloud.fit();
  }

  function closePhoneCal() {
    $("phone-cal-modal")?.classList.remove("open");
  }

  function phoneCalModal() {
    let el = $("phone-cal-modal");
    if (el) return el;
    el = document.createElement("div");
    el.id = "phone-cal-modal";
    el.className = "modal";
    el.innerHTML = `<div class="modal-card phone-cal-modal" role="dialog" aria-modal="true" aria-labelledby="phone-cal-title">
      <div class="modal-title-row">
        <h3 id="phone-cal-title">Календарь с телефона</h3>
        <button type="button" class="btn small" id="phone-cal-close">Закрыть</button>
      </div>
      <div class="phone-cal-sub" id="phone-cal-sub"></div>
      <div class="phone-cal-board" id="phone-cal-board"></div>
    </div>`;
    el.addEventListener("click", (e) => {
      if (e.target !== el && !e.target.closest("#phone-cal-close")) return;
      state.phoneCalDismissed = state.phoneCalSeq || 0;
      el.classList.remove("open");
    });
    document.body.appendChild(el);
    return el;
  }

  function phoneCalWindow(mode, day) {
    const anchor = dayStart(day || clockToday());
    const today = clockToday();
    if (mode === "classic") {
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
    if (mode === "day") return { from: anchor, to: anchor, days: [anchor], today, title: calFmtDay(anchor) };
    const from = mondayOf(anchor);
    const to = addDays(from, 6);
    return { from, to, days: rangeDays(from, to), today, title: calFmtRange(from, to) };
  }

  function phoneCalLoad(orders, days) {
    const map = {};
    let peak = 0;
    days.forEach((day) => {
      const key = dayKey(day);
      const n = orders.filter((order) => boardCoversDay(order, day) && workStatus(order) !== "cancelled").length;
      map[key] = n;
      if (n > peak) peak = n;
    });
    return { map, peak, peakKey: "" };
  }

  function applyPhoneCalendar(nav) {
    if (!state.doc) return;
    const phoneMode = nav.cal_mode === "extended" || nav.cal_mode === "day" || nav.cal_mode === "classic" ? nav.cal_mode : "classic";
    const allowed = new Set(["all", "now", "planned", "done", "nodate"]);
    const filter = allowed.has(nav.cal_filter) ? nav.cal_filter : "all";
    const day = parseDay(nav.cal_day) || clockToday();
    const pick = /^\d{4}-\d{2}-\d{2}$/.test(String(nav.cal_pick || "")) ? nav.cal_pick : "";
    const seq = Number(nav.seq) || 0;
    state.phoneCalSeq = seq;
    state.phoneCalNav = nav;
    const win = phoneCalWindow(phoneMode, day);
    const list = calendarOrders(filter);
    const span = phoneMode === "classic" ? rangeDays(win.gridFrom, win.gridTo) : win.days;
    const load = phoneCalLoad(list, span);
    const cal = calendarState();
    cal.mirrorPick = pick;
    cal.mirrorHidePause = true;
    let board = "";
    try {
      if (filter === "nodate") {
        board = list.length
          ? list.map((order) => `<div class="phone-cal-row"><b>${esc(order.number || "—")}</b> ${esc(order.name || "без названия")}</div>`).join("")
          : `<div class="empty">Нет заказов без дат.</div>`;
      } else if (phoneMode === "classic") board = renderClassicCalendar(win, list, load);
      else board = renderExtendedCalendar(win, list, load);
    } finally {
      delete cal.mirrorPick;
      delete cal.mirrorHidePause;
    }
    const modal = phoneCalModal();
    const modeLabel = phoneMode === "day" ? "День" : phoneMode === "extended" ? "Неделя" : "Месяц";
    const filterLabel = (CALENDAR_FILTERS.find(([id]) => id === filter) || CALENDAR_FILTERS[0])[1];
    const picked = pick ? ` · выделен ${calFmtDay(parseDay(pick))}` : "";
    $("phone-cal-sub").textContent = `${modeLabel} · ${win.title}${picked} · ${filterLabel}`;
    const boardEl = $("phone-cal-board");
    boardEl.classList.toggle("is-day", phoneMode === "day");
    boardEl.innerHTML = board;
    if (state.phoneCalDismissed !== seq) modal.classList.add("open");
  }

  function applyRemoteNav(nav) {
    if (!nav || !nav.view) return;
    if (nav.view !== "calendar") closePhoneCal();
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
      if (!sameOrder) toast(`Телефон открыл заказ ${order.number || "—"}`);
      return;
    }
    const hadFocus = !!state.focusOrderId;
    if (nav.view === "calendar") {
      state.remoteStats = null;
      if (state.view !== "calendar") setView("calendar");
      applyPhoneCalendar(nav);
      return;
    }
    if (nav.view === "stats") {
      state.focusOrderId = null;
      state.focusLineId = null;
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
    if (state.view === "cloud") {
      if (cloudState().catalog) {
        cloudState().catalog = false;
        renderCloud();
      }
      showCloudOverview();
      state.remoteStats = null;
      return;
    }
    state.focusOrderId = null;
    state.focusLineId = null;
    state.remoteStats = null;
    if (nav.view === "orders") setView("orders");
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
      if (state.dirty) await revertHistoryToLastSave();
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
    if (window.FM_DESK) {
      while (state.desktop) {
        await new Promise((r) => setTimeout(r, 4000));
        try {
          applyRemoteLists({ library: await apiGet("/api/library"), recent: state.recentItems });
        } catch {
          /* список обновится следующим запросом */
        }
      }
      return;
    }
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

  let settingsPackTimer = 0;
  let settingsPackMode = "";
  let settingsPackPath = "";
  let settingsPackBusy = false;
  let settingsPackSettled = false;

  function settingsPackIds() {
    return [...document.querySelectorAll("#settings-pack-list input[data-pack-id]:checked")].map((input) => input.dataset.packId);
  }

  function paintSettingsPack(parts) {
    const list = $("settings-pack-list");
    if (!list) return;
    const rows = parts || [];
    list.innerHTML = rows.map((part) => `
      <label class="report-settings-check settings-pack-check"${part.title ? ` title="${esc(part.title)}"` : ""}>
        <input type="checkbox" data-pack-id="${esc(part.id)}"${part.on ? " checked" : ""}>
        <span>${esc(part.label)}${part.detail ? `<small>${esc(part.detail)}</small>` : ""}</span>
        <small>${esc(part.size || "")}</small>
      </label>
    `).join("");
    if (!rows.length) {
      list.innerHTML = '<p class="report-settings-hint">В папке настроек нечего упаковывать.</p>';
    }
    const go = $("settings-pack-go");
    if (go) go.disabled = !settingsPackIds().length;
  }

  function settingsPackProgress(on, percent, text) {
    const box = $("settings-pack-progress");
    if (box) box.hidden = !on;
    const bar = $("settings-pack-bar");
    if (bar) bar.style.width = `${Math.max(0, Math.min(100, percent || 0))}%`;
    const pct = $("settings-pack-pct");
    if (pct) pct.textContent = `${Math.max(0, Math.min(100, percent || 0))}%`;
    const status = $("settings-pack-status");
    if (status && text) status.textContent = text;
  }

  function closeSettingsPack() {
    if (settingsPackBusy) return;
    clearInterval(settingsPackTimer);
    settingsPackTimer = 0;
    settingsPackMode = "";
    settingsPackPath = "";
    $("settings-pack-modal")?.classList.remove("open");
  }

  function openSettingsPack(mode, parts, path) {
    settingsPackMode = mode;
    settingsPackPath = path || "";
    settingsPackBusy = false;
    const importing = mode === "import";
    const title = $("settings-pack-title");
    if (title) title.textContent = importing ? "Импорт настроек" : "Экспорт настроек";
    const lead = $("settings-pack-lead");
    if (lead) {
      lead.hidden = importing;
      lead.textContent = "Отмеченное попадёт в архив .fms. Python и модели речи выключены, пока галочка не стоит.";
    }
    const warn = $("settings-pack-warn");
    if (warn) warn.hidden = !importing;
    const go = $("settings-pack-go");
    if (go) go.textContent = importing ? "Импортировать" : "Упаковать";
    const cancel = $("settings-pack-cancel");
    if (cancel) {
      cancel.disabled = false;
      cancel.textContent = "Отмена";
    }
    paintSettingsPack(parts);
    settingsPackProgress(false, 0, importing ? "Распаковка…" : "Упаковка…");
    $("settings-pack-modal")?.classList.add("open");
  }

  async function finishSettingsPack(job) {
    if (settingsPackSettled) return;
    settingsPackSettled = true;
    settingsPackBusy = false;
    clearInterval(settingsPackTimer);
    settingsPackTimer = 0;
    const cancel = $("settings-pack-cancel");
    if (cancel) cancel.disabled = false;
    const go = $("settings-pack-go");
    if (go) go.disabled = !settingsPackIds().length;
    if (job.error) {
      settingsPackProgress(true, job.progress || 0, job.text || "Ошибка");
      toast(job.error);
      return;
    }
    settingsPackProgress(true, 100, "Готово");
    if (cancel) cancel.textContent = "Закрыть";
    if (settingsPackMode === "import") {
      if (job.config) {
        try {
          const bootData = await apiGet("/api/bootstrap");
          state.autosave = window.FM_DESK ? false : !!bootData.autosave;
          const box = $("autosave");
          if (box) box.checked = state.autosave;
          hydratePrefs(bootData.ui_prefs);
          applyTheme(bootData.theme || "light", false);
          if (bootData.history_limit) history.limit = clampHistoryLimit(bootData.history_limit);
          await renderStartLists(bootData);
        } catch {
          /* файл уже записан */
        }
      }
      if (job.dictionary) {
        try { await loadDictionary(); } catch { /* словарь уже на диске */ }
      }
      toast("Настройки импортированы");
    } else {
      toast("Настройки экспортированы");
    }
    settingsPackMode = "";
    settingsPackPath = "";
  }

  function watchSettingsPack() {
    clearInterval(settingsPackTimer);
    settingsPackTimer = setInterval(async () => {
      try {
        const job = await apiGet("/api/settings/job");
        settingsPackProgress(true, job.progress, job.text || (settingsPackMode === "import" ? "Распаковка…" : "Упаковка…"));
        if (job.running) return;
        await finishSettingsPack(job);
      } catch (err) {
        settingsPackSettled = true;
        settingsPackBusy = false;
        clearInterval(settingsPackTimer);
        settingsPackTimer = 0;
        const go = $("settings-pack-go");
        const cancel = $("settings-pack-cancel");
        if (go) go.disabled = false;
        if (cancel) cancel.disabled = false;
        toast(err.message || "Не удалось дождаться окончания");
      }
    }, 200);
  }

  async function runSettingsPack() {
    const ids = settingsPackIds();
    if (!ids.length || settingsPackBusy) return;
    const go = $("settings-pack-go");
    const cancel = $("settings-pack-cancel");
    if (go) go.disabled = true;
    if (cancel) cancel.disabled = true;
    settingsPackBusy = true;
    settingsPackSettled = false;
    try {
      if (settingsPackMode === "export") {
        const data = await apiPost("/api/settings/export", { ids });
        if (data.cancelled) {
          settingsPackBusy = false;
          if (go) go.disabled = !settingsPackIds().length;
          if (cancel) cancel.disabled = false;
          return;
        }
        settingsPackProgress(true, data.progress || 0, data.text || "Упаковка…");
        if (!data.running) {
          await finishSettingsPack(data);
          return;
        }
        watchSettingsPack();
        return;
      }
      const data = await apiPost("/api/settings/import", { path: settingsPackPath, ids });
      settingsPackProgress(true, data.progress || 0, data.text || "Распаковка…");
      if (!data.running) {
        await finishSettingsPack(data);
        return;
      }
      watchSettingsPack();
    } catch (err) {
      settingsPackBusy = false;
      settingsPackSettled = true;
      if (go) go.disabled = !settingsPackIds().length;
      if (cancel) cancel.disabled = false;
      settingsPackProgress(false, 0, "");
      toast(err.message || "Не удалось обработать архив");
    }
  }

  function bindSettingsPack() {
    $("btn-settings-export")?.addEventListener("click", async () => {
      if (!state.desktop) {
        toast("Только на этом компьютере");
        return;
      }
      try {
        const data = await apiGet("/api/settings/bundle");
        openSettingsPack("export", data.parts || []);
      } catch (err) {
        toast(err.message || "Не удалось прочитать настройки");
      }
    });
    $("btn-settings-import")?.addEventListener("click", async () => {
      if (!state.desktop) {
        toast("Только на этом компьютере");
        return;
      }
      const ok = await askConfirm({
        title: "Импорт настроек",
        text: "Старые настройки потеряются. Отмеченные файлы из архива заменят текущие, остальные останутся.",
        ok: "Выбрать архив",
        cancel: "Отмена",
        danger: true,
      });
      if (!ok) return;
      try {
        const data = await apiPost("/api/settings/import/pick", {});
        if (data.cancelled) return;
        if (!data.parts || !data.parts.length) {
          toast("В архиве нет настроек");
          return;
        }
        openSettingsPack("import", data.parts, data.path);
      } catch (err) {
        toast(err.message || "Не удалось открыть архив");
      }
    });
    $("settings-pack-list")?.addEventListener("change", () => {
      const go = $("settings-pack-go");
      if (go && !settingsPackBusy) go.disabled = !settingsPackIds().length;
    });
    $("settings-pack-cancel")?.addEventListener("click", closeSettingsPack);
    $("settings-pack-go")?.addEventListener("click", () => { runSettingsPack(); });
    $("settings-pack-modal")?.addEventListener("click", (e) => {
      if (e.target === $("settings-pack-modal")) closeSettingsPack();
    });
  }

  let tokenPackMode = "";
  let tokenPackPath = "";

  function tokenPackIds() {
    return [...document.querySelectorAll("#token-pack-list input[data-pack-id]:checked")].map((input) => input.dataset.packId);
  }

  function paintTokenPack(parts) {
    const list = $("token-pack-list");
    if (!list) return;
    const rows = parts || [];
    list.innerHTML = rows.map((part) => `
      <label class="report-settings-check settings-pack-check">
        <input type="checkbox" data-pack-id="${esc(part.id)}"${part.on ? " checked" : ""}>
        <span>${esc(part.label)}${part.detail ? `<small>${esc(part.detail)}</small>` : ""}</span>
      </label>
    `).join("") || '<p class="report-settings-hint">В файле нечего брать.</p>';
    const go = $("token-pack-go");
    if (go) go.disabled = !tokenPackIds().length;
  }

  function closeTokenPack() {
    tokenPackMode = "";
    tokenPackPath = "";
    $("token-pack-modal")?.classList.remove("open");
  }

  function openTokenPack(mode, parts, path) {
    tokenPackMode = mode;
    tokenPackPath = path || "";
    const importing = mode === "import";
    const title = $("token-pack-title");
    if (title) title.textContent = importing ? "Импорт токенов" : "Экспорт токенов";
    const lead = $("token-pack-lead");
    if (lead) lead.textContent = importing ? "Отмеченное из файла заменит токены на этом компьютере." : "Один файл .fmt. Отметьте, что в него положить.";
    const warn = $("token-pack-warn");
    if (warn) warn.hidden = !importing;
    const go = $("token-pack-go");
    if (go) go.textContent = importing ? "Импортировать" : "Сохранить";
    paintTokenPack(parts);
    $("token-pack-modal")?.classList.add("open");
  }

  async function runTokenPack() {
    const ids = tokenPackIds();
    if (!ids.length) return;
    try {
      if (tokenPackMode === "export") {
        const data = await apiPost("/api/tokens/export", { ids });
        if (data.cancelled) return;
        toast("Токены экспортированы");
        closeTokenPack();
        return;
      }
      const data = await apiPost("/api/tokens/import", { path: tokenPackPath, ids });
      renderRemoteModal(data);
      toast("Токены импортированы");
      closeTokenPack();
    } catch (err) {
      toast(err.message || "Не удалось обработать токены");
    }
  }

  function bindTokenPack() {
    $("btn-tokens-export")?.addEventListener("click", async () => {
      try {
        const data = await apiGet("/api/tokens/bundle");
        if (!data.parts?.length) {
          toast("Сохранённых токенов пока нет");
          return;
        }
        openTokenPack("export", data.parts);
      } catch (err) {
        toast(err.message || "Не удалось прочитать токены");
      }
    });
    $("btn-tokens-import")?.addEventListener("click", async () => {
      try {
        const data = await apiPost("/api/tokens/import/pick", {});
        if (data.cancelled) return;
        if (!data.parts?.length) {
          toast("В файле нет токенов");
          return;
        }
        openTokenPack("import", data.parts, data.path);
      } catch (err) {
        toast(err.message || "Не удалось открыть файл");
      }
    });
    $("token-pack-list")?.addEventListener("change", () => {
      const go = $("token-pack-go");
      if (go) go.disabled = !tokenPackIds().length;
    });
    $("token-pack-cancel")?.addEventListener("click", closeTokenPack);
    $("token-pack-go")?.addEventListener("click", () => { runTokenPack(); });
    $("token-pack-modal")?.addEventListener("click", (e) => {
      if (e.target === $("token-pack-modal")) closeTokenPack();
    });
  }

  async function telegramUserAction(action, id, nick) {
    if (action === "remove") {
      const ok = await askConfirm({
        title: "Удалить пользователя?",
        text: `${nick} больше не сможет писать боту. Снова попасть можно только новым запросом через /start.`,
        ok: "Удалить",
        cancel: "Отмена",
        danger: true,
      });
      if (!ok) return;
    }
    try {
      renderRemoteModal(await apiPost("/api/telegram/users", { action, id }));
      toast(action === "approve" ? "Пользователь добавлен" : action === "decline" ? "Запрос отклонён" : "Пользователь удалён");
    } catch (err) {
      toast(err.message || "Не удалось изменить доступ");
    }
  }

  function bindTelegramPeople() {
    const onClick = async (e) => {
      const approve = e.target.closest("[data-tg-approve]");
      const decline = e.target.closest("[data-tg-decline]");
      const remove = e.target.closest("[data-tg-remove]");
      const node = approve || decline || remove;
      if (!node) return;
      const id = node.dataset.tgApprove || node.dataset.tgDecline || node.dataset.tgRemove;
      const nick = node.closest(".remote-tg-person")?.querySelector("b")?.textContent || id;
      const action = approve ? "approve" : decline ? "decline" : "remove";
      await telegramUserAction(action, id, nick);
    };
    $("remote-tg-pending")?.addEventListener("click", onClick);
    $("remote-tg-users")?.addEventListener("click", onClick);
    if (!state.desktop) return;
    setInterval(async () => {
      try {
        applyRemotePayload(await apiGet("/api/telegram/access"));
      } catch {
        /* запрос повторится */
      }
    }, 3000);
  }

  function bindRemote() {
    bindSettingsPack();
    bindTokenPack();
    bindTelegramPeople();
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
      if (status) {
        status.dataset.hold = "1";
        status.className = "remote-ngrok-status";
        status.textContent = send ? "Отправляю…" : "Сохраняю токен…";
      }
      try {
        if (send && !remote.enabled) await remoteStart();
        const payload = { send };
        if (token) payload.token = token;
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
    $("remote-copy")?.addEventListener("click", () => copyRemoteLink(remote.url, "Ссылка на телефон скопирована"));
    $("remote-copy-desk")?.addEventListener("click", () => copyRemoteLink(remoteDeskUrl(), "Ссылка на интерфейс ПК скопирована"));
    $("remote-copy-bank")?.addEventListener("click", () => copyRemoteLink(remoteBankUrl(), "Ссылка на хранилище скопирована"));
    document.addEventListener("focusout", () => setTimeout(flushRemoteDoc, 150));
  }

  let externalOpenBusy = false;

  async function acceptExternalOpens() {
    if (window.FM_DESK) return;
    if (!state.desktop || externalOpenBusy) return;
    externalOpenBusy = true;
    try {
      const data = await apiGet("/api/instance/pending");
      for (const path of data.paths || []) {
        if (!path || /\.(fmwb|fms)$/i.test(path)) continue;
        if (samePath(path, state.path) && state.doc) continue;
        const choice = await confirmSwitchReport();
        if (!choice || choice === "cancel") continue;
        if (choice === "save") {
          const ok = await save();
          if (!ok) continue;
        } else if (choice === "discard") {
          await revertHistoryToLastSave();
        }
        await openPath(path);
      }
    } catch {
      /* окно ещё поднимается */
    } finally {
      externalOpenBusy = false;
    }
  }

  async function openStartupReport(recent) {
    try {
      const pending = await apiGet("/api/instance/pending");
      const queued = (pending.paths || []).filter(Boolean);
      if (queued.length) {
        for (const path of queued) {
          if (/\.(fmwb|fms)$/i.test(path)) continue;
          await openPath(path);
        }
        return;
      }
    } catch {
      /* окно ещё поднимается */
    }
    if (state.doc) return;
    const last = (recent || []).find((item) => item?.path && item.exists !== false);
    if (last) await openPath(last.path);
  }

  async function boot() {
    try {
      bind();
      bindRemote();
    } catch (err) {
      console.error(err);
    }
    window.FM_DESK_READY?.();
    try {
      const bootData = await apiGet("/api/bootstrap");
      state.desktop = true;
      refreshUpdateButton();
      state.autosave = window.FM_DESK ? false : !!bootData.autosave;
      hydratePrefs(bootData.ui_prefs);
      applyTheme(bootData.theme || "light", false);
      await renderStartLists(bootData);
      await openStartupReport(bootData.recent);
      libraryWatchLoop();
      await apiPost("/api/dirty", { dirty: false });
      if (bootData.remote) {
        applyRemotePayload(bootData.remote);
        remoteBadge();
        if (remote.enabled && !remote.polling) remotePoll();
      }
      watchRemoteAccess();
      watchDesktopPdfJobs();
      setInterval(acceptExternalOpens, 800);
    } catch {
      state.desktop = false;
      state.autosave = window.FM_DESK ? false : localStorage.getItem(LS_AUTOSAVE) === "true";
      applyTheme(localStorage.getItem(LS_THEME) || "light", false);
      await renderRecent();
    }
    $("autosave") && ($("autosave").checked = state.autosave);
  }

  window.finmasterNew = createNew;
  window.finmasterOpen = openFromDialog;

  boot();
