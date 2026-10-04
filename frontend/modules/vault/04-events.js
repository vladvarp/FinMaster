/* bundle-seam */
(function () {
  function render(nextApi) {
    if (nextApi) api = nextApi;
    if (!api || api.view?.() !== "vault") return;
    const vault = ensureVault();
    const page = activePage();
    const body = $("vault-body");
    if (!vault || !page || !body) return;
    renderTabs(vault);
    const focusId = document.activeElement?.id || "";
    const scroller = body.closest(".content");
    const scroll = scroller?.scrollTop ?? 0;
    const t = pageTotals(page);
    const oldCanvas = $("vault-chart");
    body.innerHTML = `
      <section class="card vault-head">
        <input id="vault-page-name" class="vault-name" maxlength="48" spellcheck="false" value="${esc(page.name)}" title="Название страницы — например «Отпуск» или «Новый телефон»" />
        ${kpiHtml(page, t)}
      </section>
      <section class="card vault-chart ${session.chartOpen ? "" : "collapsed"}">${chartHtml(page)}</section>
      <section class="card vault-add">${addFormHtml()}</section>
      <section class="card vault-list">${listHtml(page, runningBalances(page))}</section>`;
    const chartBox = body.querySelector(".vault-chart-box");
    if (chartBox) {
      const canvas = oldCanvas || document.createElement("canvas");
      canvas.id = "vault-chart";
      chartBox.appendChild(canvas);
      bindChartCanvas(canvas);
      requestAnimationFrame(() => paintChart(page, canvas));
    }
    if (scroller) scroller.scrollTop = scroll;
    if (focusId && ["vault-new-name", "vault-new-amount"].includes(focusId)) $(focusId)?.focus();
  }

  function addPage() {
    const vault = ensureVault();
    if (!vault) return;
    const names = new Set(vault.pages.map((p) => p.name));
    let n = vault.pages.length + 1;
    while (names.has(`Копилка ${n}`)) n += 1;
    const page = newPage(`Копилка ${n}`);
    vault.pages.push(page);
    vault.active = page.id;
    dirty();
    render();
    requestAnimationFrame(() => {
      const input = $("vault-page-name");
      input?.focus();
      input?.select();
    });
  }

  async function deletePage(id) {
    const vault = ensureVault();
    const page = vault?.pages.find((p) => p.id === id);
    if (!page || vault.pages.length <= 1) return;
    const ok = api?.confirm
      ? await api.confirm({
          title: "Удалить страницу?",
          text: `Страница «${page.name}» и все её строки (${page.rows.length}) будут удалены. Отменить можно через Ctrl+Z.`,
          ok: "Удалить",
          danger: true,
        })
      : true;
    if (!ok) return;
    const idx = vault.pages.indexOf(page);
    vault.pages.splice(idx, 1);
    if (vault.active === id) vault.active = (vault.pages[idx] || vault.pages[idx - 1] || vault.pages[0]).id;
    dirty();
    render();
  }

  function addRow() {
    const page = activePage();
    if (!page) return;
    const nameEl = $("vault-new-name");
    const amountEl = $("vault-new-amount");
    const dateEl = $("vault-new-date");
    const amount = parseAmount(amountEl?.value);
    if (!Number.isFinite(amount) || amount === 0) {
      api?.toast?.("Введите сумму");
      amountEl?.focus();
      return;
    }
    const type = session.draftType;
    session.draftDate = dateEl?.value || session.draftDate;
    page.rows.push({
      id: uid(),
      type,
      name: String(nameEl?.value || "").trim(),
      amount: type === "save" ? amount : Math.abs(amount),
      date: dateEl?.value || today(),
      created: new Date().toISOString(),
    });
    dirty();
    render();
    requestAnimationFrame(() => $("vault-new-name")?.focus());
  }

  function setDraftType(type) {
    if (!TYPES[type]) return;
    session.draftType = type;
    document.querySelectorAll("#vault-body [data-vault-type]").forEach((b) => {
      const on = b.dataset.vaultType === type;
      b.classList.toggle("active", on);
      b.setAttribute("aria-checked", String(on));
    });
    const hint = $("vault-type-hint");
    if (hint) hint.textContent = TYPES[type].hint;
  }

  function findRow(el) {
    const tr = el.closest("[data-vault-row]");
    const page = activePage();
    return tr && page ? page.rows.find((r) => r.id === tr.dataset.vaultRow) : null;
  }

  function bind(nextApi) {
    if (nextApi) api = nextApi;
    if (session.bound) return;
    const root = $("view-vault");
    if (!root) return;
    session.bound = true;

    root.querySelector(".calc-tabbar")?.addEventListener("click", (e) => {
      if (e.target.closest("[data-add-vault-page]")) {
        addPage();
        return;
      }
      const del = e.target.closest("[data-del-vault-page]");
      if (del) {
        e.stopPropagation();
        deletePage(del.dataset.delVaultPage);
        return;
      }
      const tab = e.target.closest("[data-vault-page]");
      if (!tab) return;
      const vault = ensureVault();
      if (!vault || vault.active === tab.dataset.vaultPage) return;
      vault.active = tab.dataset.vaultPage;
      session.filter = "all";
      session.zoom = null;
      session.zoomPreset = "all";
      session.chartYear = "";
      dirty();
      render();
    });

    const body = $("vault-body");
    body?.addEventListener("click", (e) => {
      const typeBtn = e.target.closest("[data-vault-type]");
      if (typeBtn) {
        setDraftType(typeBtn.dataset.vaultType);
        return;
      }
      if (e.target.closest("#vault-add-btn")) {
        addRow();
        return;
      }
      if (e.target.closest("[data-vault-chart-toggle]")) {
        session.chartOpen = !session.chartOpen;
        render();
        return;
      }
      if (e.target.closest("[data-vault-chart-save]")) {
        session.chartSave = !session.chartSave;
        render();
        return;
      }
      const zoomBtn = e.target.closest("[data-vault-zoom]");
      if (zoomBtn) {
        const page = activePage();
        if (page) presetZoom(page, zoomBtn.dataset.vaultZoom);
        syncZoomPresets();
        const canvas = $("vault-chart");
        if (page && canvas) paintChart(page, canvas);
        return;
      }
      const yearBtn = e.target.closest("[data-vault-year]");
      if (yearBtn && !yearBtn.disabled) {
        const page = activePage();
        if (!page) return;
        const years = chartYears(page);
        const cur = years.indexOf(chartYear(page));
        const v = yearBtn.dataset.vaultYear;
        session.chartYear = v === "prev" ? years[Math.max(0, cur - 1)] : v === "next" ? years[Math.min(years.length - 1, cur + 1)] : v;
        render();
        return;
      }
      const mode = e.target.closest("[data-vault-chart-mode]");
      if (mode) {
        session.chartMode = mode.dataset.vaultChartMode === "months" ? "months" : "balance";
        render();
        return;
      }
      const chip = e.target.closest("[data-vault-filter]");
      if (chip) {
        session.filter = chip.dataset.vaultFilter;
        render();
        return;
      }
      const del = e.target.closest("[data-vault-del]");
      if (del) {
        const page = activePage();
        if (!page) return;
        page.rows = page.rows.filter((r) => r.id !== del.dataset.vaultDel);
        dirty();
        render();
        api?.toast?.("Строка удалена · Ctrl+Z — вернуть");
      }
    });

    document.addEventListener(
      "keydown",
      (e) => {
        if (!(e.ctrlKey || e.metaKey) || e.altKey || e.shiftKey || e.repeat) return;
        const type = TYPE_BY_CODE[e.code];
        if (!type) return;
        const view = $("view-vault");
        if (!view?.classList.contains("active")) return;
        if (document.querySelector(".modal.open") || $("palette")?.classList.contains("open")) return;
        e.preventDefault();
        e.stopPropagation();
        setDraftType(type);
      },
      true
    );

    body?.addEventListener("keydown", (e) => {
      if (e.key !== "Enter") return;
      if (e.target.closest(".vault-add-row")) {
        e.preventDefault();
        addRow();
      } else if (e.target.dataset?.vf || e.target.id === "vault-goal" || e.target.id === "vault-page-name") {
        e.preventDefault();
        e.target.blur();
      }
    });

    body?.addEventListener("input", (e) => {
      const el = e.target;
      if (el.id === "vault-page-name") {
        const page = activePage();
        if (!page) return;
        page.name = el.value.slice(0, 48);
        const label = document.querySelector(`#vault-tabs [data-vault-page="${CSS.escape(page.id)}"] .calc-tab-label`);
        if (label) label.textContent = page.name || "Без названия";
        dirty();
        return;
      }
      if (el.dataset?.vf === "name") {
        const row = findRow(el);
        if (!row) return;
        row.name = el.value.slice(0, 120);
        dirty();
      }
    });

    body?.addEventListener("change", (e) => {
      const el = e.target;
      if (el.id === "vault-new-date") {
        session.draftDate = el.value || "";
        return;
      }
      if (el.id === "vault-page-name") {
        const page = activePage();
        if (page && !page.name.trim()) {
          page.name = "Копилка";
          dirty();
          render();
        }
        return;
      }
      if (el.id === "vault-goal") {
        const page = activePage();
        if (!page) return;
        const goal = parseAmount(el.value);
        page.goal = Number.isFinite(goal) && goal > 0 ? goal : 0;
        dirty();
        render();
        return;
      }
      const key = el.dataset?.vf;
      if (!key || key === "name") return;
      const row = findRow(el);
      if (!row) return;
      if (key === "date") row.date = el.value || "";
      if (key === "type") {
        row.type = TYPES[el.value] ? el.value : "in";
        if (row.type !== "save") row.amount = Math.abs(Number(row.amount) || 0);
      }
      if (key === "amount") {
        const amount = parseAmount(el.value);
        if (!Number.isFinite(amount)) {
          api?.toast?.("Сумма должна быть числом");
          render();
          return;
        }
        row.amount = row.type === "save" ? amount : Math.abs(amount);
      }
      dirty();
      render();
    });
  }

  window.FinVault = { render, bind, totals: pageTotals };
})();
