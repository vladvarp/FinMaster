  /* ================= отчёты и устройство ================= */

  function fileCardHtml(item, canDelete = false) {
    let actions = "";
    if (item.path === state.path) actions += '<span class="pill" style="background:var(--accent-2)">открыт</span>';
    else if (item.exists === false) actions += '<span class="pill" style="background:var(--muted)">нет файла</span>';
    else actions += `<button type="button" class="btn small" data-open-file="${esc(item.path)}">Открыть</button>`;
    if (canDelete) {
      actions += `<button type="button" class="btn small danger-ghost" data-delete-file="${esc(item.path)}">Удалить</button>`;
    }
    return `<article class="card file-item ${item.path === state.path ? "current" : ""}">
          <div class="fi-body">
            <strong>${esc(item.title || item.name || item.path.split(/[\\/]/).pop())}</strong>
            <small>${esc(item.name || item.path)}</small>
          </div>
          <div class="fi-actions">${actions}</div>
        </article>`;
  }

  function recentListHtml() {
    const recent = state.recent || [];
    if (!recent.length) return '<div class="empty">Недавних отчётов нет — создайте новый или откройте файл на компьютере.</div>';
    return recent.map((item) => fileCardHtml(item)).join("");
  }

  function libraryListHtml() {
    const lib = state.library || {};
    const items = lib.items || [];
    const path = lib.path ? `<small class="muted" style="display:block;margin:-4px 0 10px;word-break:break-all">${esc(lib.path)}</small>` : "";
    if (!items.length) {
      return `${path}<div class="empty">Пока пусто — новые отчёты появятся здесь</div>`;
    }
    return path + items.map((item) => fileCardHtml(item, true)).join("");
  }

  function renderFiles() {
    const file = state.path ? state.path.split(/[\\/]/).pop() : "";
    const openCard = hasDocument()
      ? `<article class="card">
        <div class="muted" style="margin-bottom:8px">Открыто на компьютере</div>
        <div class="grid-2">
          <div class="field"><label>Название отчёта</label><input type="text" data-d="title" value="${esc(state.doc?.title || "")}" /></div>
          <div class="field"><label>Валюта</label><input type="text" data-d="currency" value="${esc(state.doc?.currency || "₽")}" /></div>
        </div>
        <div class="field">
          <label>Точность сумм</label>
          <select data-d="money_decimals">
            ${[0, 1, 2, 3, 4]
              .map((d) => {
                const label = d === 0 ? "Целые" : `0.${"0".repeat(d)}`;
                const sel = moneyDecimals() === d ? " selected" : "";
                return `<option value="${d}"${sel}>${label}</option>`;
              })
              .join("")}
          </select>
        </div>
        <small class="muted" style="word-break:break-all">${esc(state.path || "файл ещё не сохранён")}</small>
        <div class="stack">
          <button type="button" class="btn primary wide" id="cmd-save">${state.dirty ? "Сохранить изменения" : "Сохранить"}${
            file ? ` — ${esc(file)}` : ""
          }</button>
          <button type="button" class="btn wide" id="cmd-new">Создать новый отчёт</button>
        </div>
      </article>`
      : `<article class="card">
        <strong>На компьютере нет открытого отчёта</strong>
        <p class="muted" style="margin:8px 0 12px">Выберите недавний файл — он откроется в программе. Или создайте новый.</p>
        <button type="button" class="btn primary wide" id="cmd-new">Создать новый отчёт</button>
      </article>`;
    $("files-body").innerHTML = `
      ${openCard}
      <h3 class="section">Папка FinMaster</h3>
      <div class="list">${libraryListHtml()}</div>
      <h3 class="section">Недавние отчёты</h3>
      <div class="list">${recentListHtml()}</div>
      <h3 class="section">Это устройство</h3>
      <article class="card">
        <div class="field last">
          <label>Имя на компьютере</label>
          <div class="name-row">
            <input type="text" id="device-name" value="${esc(deviceName())}" placeholder="${esc(guessDeviceName())}" />
            <button type="button" class="icon-btn ghost" id="device-info" aria-label="О устройстве" title="О устройстве">i</button>
          </div>
        </div>
        <div class="device-facts" id="device-facts" ${state.deviceFactsOpen ? "" : "hidden"}>${deviceFactsHtml()}</div>
        <div class="muted" style="margin:10px 0 0">Если имя не задано, компьютер берёт его из браузера. Добавьте страницу в закладки — QR больше не нужен.</div>
        <div class="stack">
          ${
            telegramApp
              ? `<button type="button" class="btn wide" id="cmd-homescreen">${
                  state.homeScreen === "added" ? "Ярлык уже на экране" : "Добавить иконку на экран"
                }</button>`
              : `<button type="button" class="btn wide" id="cmd-fullscreen">${document.fullscreenElement ? "Выйти из полного экрана" : "Полный экран"}</button>`
          }
          <button type="button" class="btn wide" id="cmd-copy-link">Скопировать постоянную ссылку</button>
          <button type="button" class="btn wide danger-ghost" id="cmd-leave">Отключиться от компьютера</button>
        </div>
      </article>`;
  }

  function deviceFactsHtml() {
    const p = devicePayload();
    const rows = [
      ["Имя", p.name],
      ["Модель", p.model],
      ["Система", [p.platform, p.platform_version].filter(Boolean).join(" ")],
      ["Браузер", p.brands],
      ["Язык", p.language],
      ["Экран", p.screen],
      ["Окно", p.viewport],
      ["Плотность", p.pixel_ratio],
      ["Часовой пояс", p.timezone],
      ["User-Agent", p.user_agent],
    ].filter(([, value]) => value);
    return rows
      .map(([label, value]) => `<div class="fact"><span>${esc(label)}</span><b>${esc(value)}</b></div>`)
      .join("");
  }

  async function refreshRecent() {
    try {
      const data = await api("/api/remote/session");
      state.recent = data.recent || [];
      if (data.library) state.library = data.library;
      applySnapshot(data);
      if (state.view === "files") renderFiles();
    } catch {
      /* полл покажет ошибку */
    }
  }

  /* ================= полный экран ================= */

  function fullscreenOn() {
    return !!(document.fullscreenElement || document.webkitFullscreenElement);
  }

  async function toggleFullscreen() {
    try {
      if (fullscreenOn()) {
        await (document.exitFullscreen?.() || document.webkitExitFullscreen?.());
        return;
      }
      const el = document.documentElement;
      const req = el.requestFullscreen || el.webkitRequestFullscreen;
      if (!req) {
        toast("Браузер не умеет полный экран. В Safari: «Поделиться» → «На экран Домой»");
        return;
      }
      await req.call(el, { navigationUI: "hide" });
    } catch {
      toast("Полный экран недоступен в этом браузере");
    }
  }

