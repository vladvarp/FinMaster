  /* ================= шторки ================= */

  function openSheet(title, items, current, onPick) {
    $("sheet").classList.remove("is-menu");
    $("sheet-title").hidden = false;
    $("sheet-title").textContent = title;
    $("sheet-list").innerHTML = items
      .map(
        (item, i) =>
          `<button type="button" data-pick="${i}" class="${item.value === current ? "active" : ""}">
            ${item.color ? `<i class="dot" style="width:14px;height:14px;background:${esc(item.color)}"></i>` : ""}
            <span>${esc(item.label)}</span>
            ${item.hint ? `<small>${esc(item.hint)}</small>` : ""}
          </button>`
      )
      .join("");
    $("sheet").hidden = false;
    $("sheet").classList.add("is-on");
    $("sheet")._pick = (i) => {
      closeSheet();
      onPick(items[i]);
    };
  }

  function renderHistorySheet() {
    const items = state.history.items || [];
    const index = state.history.index;
    $("sheet-list").innerHTML = `
      <div class="empty" style="margin-bottom:8px">Только просмотр: отмена и повтор — стрелками сверху.</div>
      ${
        items.length
          ? items
              .slice()
              .reverse()
              .map((item) => {
                const i = items.indexOf(item);
                return `<div class="hist-info ${i === index ? "active" : ""}">
                  <span>${esc(item.label || "Правка")}</span>
                  <small>${esc([historyTime(item.at), item.device || (item.source === "mobile" ? "Телефон" : "ПК")].filter(Boolean).join(" · "))}</small>
                </div>`;
              })
              .join("")
          : `<div class="empty">Пока нет снимков</div>`
      }`;
  }

  function openHistorySheet() {
    $("sheet").classList.remove("is-menu");
    $("sheet-title").hidden = false;
    $("sheet-title").textContent = "История";
    $("sheet").hidden = false;
    $("sheet").classList.add("is-on");
    $("sheet")._menu = null;
    renderHistorySheet();
  }

  function closeSheet() {
    $("sheet").hidden = true;
    $("sheet").classList.remove("is-on", "is-menu");
    $("sheet-title").hidden = false;
    $("sheet")._menu = null;
  }

  function menuHtml() {
    const dark = document.documentElement.getAttribute("data-theme") === "dark";
    const full = fullscreenOn();
    const tiles = [
      ["snapshot", "◨", "Снимок"],
      ["new", "+", "Новый отчёт"],
      ["link", "↗", "Ссылка"],
      ["device", "◈", "Отчёты"],
    ];
    const homeAdded = state.homeScreen === "added";
    const toolBtn = telegramApp
      ? `<button type="button" class="menu-sq ${homeAdded ? "on" : ""}" data-menu="homescreen" aria-label="${homeAdded ? "Ярлык уже на экране" : "Добавить иконку на экран"}">
              <b>⌂</b>
            </button>`
      : `<button type="button" class="menu-sq ${full ? "on" : ""}" data-menu="fullscreen" aria-label="${full ? "Выйти из полного экрана" : "Полный экран"}">
              <b>${full ? "↙" : "⛶"}</b>
            </button>`;
    return `
      <div class="menu-panel">
        <div class="menu-head">
          <div class="menu-title">Меню</div>
          <div class="menu-tools">
            ${toolBtn}
            <button type="button" class="menu-sq" data-menu="theme" aria-label="${dark ? "Светлая тема" : "Тёмная тема"}">
              <b>${dark ? "☀" : "☾"}</b>
            </button>
            <button type="button" class="menu-sq ${state.pinging ? "busy" : ""}" data-menu="ping" aria-label="Проверить подключение">
              <b>↻</b>
            </button>
          </div>
        </div>
        <button type="button" class="menu-save ${state.dirty ? "dirty" : ""}" data-menu="save">
          <strong>${state.dirty ? "Сохранить изменения" : "Сохранить"}</strong>
          ${state.dirty ? "<small>есть несохранённые правки</small>" : "<small>на компьютере</small>"}
        </button>
        <label class="menu-autosave">
          <input type="checkbox" id="m-autosave" ${state.autosave ? "checked" : ""} />
          <span>
            <strong>Автосохранение</strong>
            <small>синхронно с компьютером</small>
          </span>
        </label>
        <button type="button" class="menu-history" data-menu="desk">
          <b>▣</b>
          <span>
            <strong>Интерфейс ПК</strong>
            <small>тот же экран, что на компьютере</small>
          </span>
        </button>
        <button type="button" class="menu-history" data-menu="history">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <circle cx="12" cy="12" r="8" stroke="currentColor" stroke-width="1.8"/>
            <path d="M12 8v4.2L15 15" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
          <span>
            <strong>История</strong>
            <small>${(state.history.items || []).length ? `${state.history.items.length} снимков` : "только просмотр"}</small>
          </span>
        </button>
        <div class="menu-grid">
          ${tiles
            .map(
              ([id, ico, label]) =>
                `<button type="button" class="menu-tile" data-menu="${id}"><b>${ico}</b><span>${label}</span></button>`
            )
            .join("")}
        </div>
      </div>`;
  }

  function renderMenu() {
    if (!$("sheet").classList.contains("is-menu")) return;
    $("sheet-list").innerHTML = menuHtml();
    bindMenuAutosave();
  }

  function openMenu() {
    $("sheet-title").hidden = true;
    $("sheet").classList.add("is-on", "is-menu");
    $("sheet").hidden = false;
    $("sheet-list").innerHTML = menuHtml();
    $("sheet")._menu = onMenuAction;
    bindMenuAutosave();
  }

  function bindMenuAutosave() {
    $("m-autosave")?.addEventListener("change", onAutosaveChange);
  }

  async function onAutosaveChange(e) {
    const enabled = !!e.target.checked;
    const previous = state.autosave;
    state.autosave = enabled;
    try {
      const res = await api("/api/remote/autosave", { method: "POST", body: JSON.stringify({ enabled }) });
      if (typeof res.version === "number") state.version = res.version;
      toast(enabled ? "Автосохранение включено" : "Автосохранение выключено");
    } catch (err) {
      state.autosave = previous;
      e.target.checked = previous;
      toast(`Не удалось: ${err.message || err}`);
    }
  }

  async function onMenuAction(value) {
    if (value === "theme") {
      toggleTheme();
      renderMenu();
      return;
    }
    if (value === "ping") {
      await checkConnection();
      return;
    }
    if (value === "fullscreen") {
      await toggleFullscreen();
      renderMenu();
      return;
    }
    if (value === "homescreen") {
      addToHomeScreen();
      if (state.homeScreen === "added") renderMenu();
      else closeSheet();
      return;
    }
    if (value === "history") {
      openHistorySheet();
      return;
    }
    closeSheet();
    if (value === "save") {
      await push();
      if (await command("save")) toast("Отчёт сохраняется на компьютере");
    } else if (value === "snapshot") openSnapshot();
    else if (value === "new") await createNewReport();
    else if (value === "link") copyLink();
    else if (value === "desk") openDesk();
    else if (value === "device") setView("files");
  }

  function toggleTheme() {
    const next = document.documentElement.getAttribute("data-theme") === "dark" ? "light" : "dark";
    document.documentElement.setAttribute("data-theme", next);
    localStorage.setItem(LS_THEME, next);
    paintTelegram(telegramApp);
  }

  async function checkConnection() {
    if (state.pinging) return;
    state.pinging = true;
    document.querySelector('[data-menu="ping"]')?.classList.add("busy");
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 8000);
    try {
      await api("/api/remote/info", { signal: ctrl.signal });
      toast("Связь с компьютером есть");
      setSync("ok", "подключено");
    } catch (err) {
      if (state.stopped) return;
      const timedOut = err?.name === "AbortError";
      toast(timedOut ? "Нет ответа от компьютера" : "Нет связи с компьютером");
      noteOffline();
    } finally {
      clearTimeout(timer);
      state.pinging = false;
      document.querySelector('[data-menu="ping"]')?.classList.remove("busy");
    }
  }

  function openDesk() {
    if (!state.token) {
      toast("Нет сессии");
      return;
    }
    const url = new URL("/desk", location.origin);
    url.searchParams.set("t", state.token);
    location.assign(url.href);
  }

  function copyLink() {
    const link = location.href;
    navigator.clipboard?.writeText(link).then(
      () => toast("Ссылка скопирована — сохраните в закладки"),
      () => toast(link)
    );
  }

