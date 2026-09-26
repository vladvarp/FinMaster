/* Хранилище: личный учёт денег пользователя со страницами-копилками. С заказами не связан. */
(function () {
  "use strict";

  let api = null;
  const session = { bound: false, filter: "all", draftType: "in" };

  const TYPES = {
    in: { label: "Пополнение", plural: "Пополнения", hint: "Пополнение — деньги пришли (карманные, зарплата). Плюс к деньгам на руках." },
    out: { label: "Снятие", plural: "Снятия", hint: "Снятие — деньги потрачены. Минус из денег на руках." },
    save: {
      label: "Копилка",
      plural: "Копилка",
      hint: "Копилка — отложили деньги: они уходят с рук в копилку. Сумма с минусом — достали из копилки обратно.",
    },
  };

  const $ = (id) => document.getElementById(id);

  function esc(value) {
    return String(value ?? "").replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]);
  }

  function uid() {
    return api?.uid ? api.uid() : `v-${Date.now().toString(16)}-${Math.random().toString(16).slice(2)}`;
  }

  function money(n) {
    return api?.money ? api.money(n) : `${Math.round(n * 100) / 100}`;
  }

  function today() {
    const d = new Date();
    const p = (n) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  }

  function parseAmount(raw) {
    const n = Number(String(raw ?? "").replace(/\s+/g, "").replace(",", "."));
    return Number.isFinite(n) ? Math.round(n * 100) / 100 : NaN;
  }

  function dirty() {
    api?.markDirty?.("Хранилище");
  }

  function newPage(name) {
    return { id: uid(), name: name || "Копилка", goal: 0, rows: [] };
  }

  function ensureVault() {
    const doc = api?.doc?.();
    if (!doc) return null;
    if (!doc.ui || typeof doc.ui !== "object") doc.ui = {};
    if (!doc.ui.vault || typeof doc.ui.vault !== "object") doc.ui.vault = { active: "", pages: [] };
    const vault = doc.ui.vault;
    if (!Array.isArray(vault.pages)) vault.pages = [];
    if (!vault.pages.length) {
      vault.pages.push(newPage("Копилка 1"));
      vault.active = vault.pages[0].id;
    }
    vault.pages.forEach((p) => {
      if (!Array.isArray(p.rows)) p.rows = [];
    });
    if (!vault.pages.some((p) => p.id === vault.active)) vault.active = vault.pages[0].id;
    return vault;
  }

  function activePage() {
    const vault = ensureVault();
    return vault ? vault.pages.find((p) => p.id === vault.active) || vault.pages[0] : null;
  }

  /** Влияние строки: на руках и в копилке. */
  function rowEffect(row) {
    const a = Number(row.amount) || 0;
    if (row.type === "in") return { hand: Math.abs(a), save: 0 };
    if (row.type === "out") return { hand: -Math.abs(a), save: 0 };
    return { hand: -a, save: a };
  }

  function pageTotals(page) {
    const t = { inc: 0, out: 0, save: 0, hand: 0 };
    (page?.rows || []).forEach((row) => {
      const a = Number(row.amount) || 0;
      if (row.type === "in") t.inc += Math.abs(a);
      else if (row.type === "out") t.out += Math.abs(a);
      else t.save += a;
    });
    t.hand = t.inc - t.out - t.save;
    Object.keys(t).forEach((k) => (t[k] = Math.round(t[k] * 100) / 100));
    return t;
  }

  function chronological(rows) {
    return rows
      .map((row, index) => ({ row, index }))
      .sort((a, b) => {
        const da = a.row.date || "9999-99-99";
        const db = b.row.date || "9999-99-99";
        if (da !== db) return da < db ? -1 : 1;
        return a.index - b.index;
      })
      .map((x) => x.row);
  }

  /** Остаток на руках и в копилке после каждой строки — по хронологии. */
  function runningBalances(page) {
    const out = new Map();
    let hand = 0;
    let save = 0;
    chronological(page.rows).forEach((row) => {
      const e = rowEffect(row);
      hand += e.hand;
      save += e.save;
      out.set(row.id, { hand: Math.round(hand * 100) / 100, save: Math.round(save * 100) / 100 });
    });
    return out;
  }

  function signOf(row) {
    const a = Number(row.amount) || 0;
    if (row.type === "in") return "+";
    if (row.type === "out") return "−";
    return a < 0 ? "−" : "+";
  }

  function renderTabs(vault) {
    const box = $("vault-tabs");
    if (!box) return;
    box.innerHTML = vault.pages
      .map(
        (page) => `<div class="calc-tab ${page.id === vault.active ? "active" : ""}" data-vault-page="${esc(page.id)}" title="${esc(page.name)}">
          <span class="calc-tab-label">${esc(page.name)}</span>
          ${vault.pages.length > 1 ? `<button type="button" class="calc-tab-x" data-del-vault-page="${esc(page.id)}" title="Удалить страницу">×</button>` : ""}
        </div>`
      )
      .join("");
  }

  function kpiHtml(page, t) {
    const goal = Number(page.goal) || 0;
    const pct = goal > 0 ? Math.max(0, Math.min(100, (t.save / goal) * 100)) : 0;
    const left = goal > 0 ? Math.max(0, goal - t.save) : 0;
    return `
      <div class="vault-kpis">
        <div class="vault-kpi hand ${t.hand < 0 ? "neg" : ""}"><span>На руках</span><b>${esc(money(t.hand))}</b><small>пополнения − снятия − копилка</small></div>
        <div class="vault-kpi save"><span>В копилке</span><b>${esc(money(t.save))}</b><small>${
          goal > 0 ? `${Math.round(pct)}% от цели` : "отложено всего"
        }</small></div>
        <div class="vault-kpi in"><span>Пополнено</span><b>+${esc(money(t.inc))}</b><small>все пополнения</small></div>
        <div class="vault-kpi out"><span>Потрачено</span><b>−${esc(money(t.out))}</b><small>все снятия</small></div>
      </div>
      <div class="vault-goal">
        <label class="vault-goal-field">Цель копилки
          <input id="vault-goal" inputmode="decimal" placeholder="без цели" value="${goal > 0 ? esc(goal) : ""}" />
        </label>
        <div class="vault-progress" title="${goal > 0 ? `${Math.round(pct)}%` : "Цель не задана"}"><i style="width:${pct.toFixed(1)}%"></i></div>
        <span class="vault-goal-note">${
          goal > 0 ? (left > 0.005 ? `осталось отложить ${esc(money(left))}` : "цель достигнута ✓") : "задайте сумму, чтобы видеть прогресс"
        }</span>
      </div>`;
  }

  function addFormHtml() {
    const type = session.draftType;
    return `
      <div class="vault-add-row">
        <div class="vault-type-seg" role="radiogroup" aria-label="Тип строки">
          ${Object.entries(TYPES)
            .map(
              ([id, meta]) =>
                `<button type="button" class="vt-${id} ${id === type ? "active" : ""}" data-vault-type="${id}" role="radio" aria-checked="${id === type}" title="${esc(meta.hint)}">${esc(meta.label)}</button>`
            )
            .join("")}
        </div>
        <input id="vault-new-name" class="vault-in-name" maxlength="120" placeholder="Название строки" autocomplete="off" spellcheck="false" />
        <input id="vault-new-amount" class="vault-in-amount" inputmode="decimal" placeholder="Сумма" autocomplete="off" />
        <input id="vault-new-date" class="vault-in-date" type="date" value="${today()}" />
        <button type="button" class="btn primary" id="vault-add-btn">Добавить</button>
      </div>
      <div class="vault-type-hint" id="vault-type-hint">${esc(TYPES[type].hint)}</div>`;
  }

  function listHtml(page, balances) {
    const counts = { all: page.rows.length, in: 0, out: 0, save: 0 };
    page.rows.forEach((r) => (counts[r.type] = (counts[r.type] || 0) + 1));
    const filter = session.filter;
    const rows = chronological(page.rows)
      .reverse()
      .filter((r) => filter === "all" || r.type === filter);
    const chips = [["all", "Все"], ...Object.entries(TYPES).map(([id, m]) => [id, m.plural])]
      .map(
        ([id, label]) =>
          `<button type="button" class="vault-chip ${id === filter ? "active" : ""}" data-vault-filter="${id}">${esc(label)} <em>${counts[id] || 0}</em></button>`
      )
      .join("");
    const body = rows.length
      ? rows
          .map((row) => {
            const bal = balances.get(row.id) || { hand: 0, save: 0 };
            const amount = row.type === "save" ? Number(row.amount) || 0 : Math.abs(Number(row.amount) || 0);
            return `<tr class="vault-row vt-${esc(row.type)}" data-vault-row="${esc(row.id)}">
              <td><input type="date" data-vf="date" value="${esc(row.date || "")}" /></td>
              <td><select data-vf="type">${Object.entries(TYPES)
                .map(([id, m]) => `<option value="${id}" ${id === row.type ? "selected" : ""}>${esc(m.label)}</option>`)
                .join("")}</select></td>
              <td><input data-vf="name" maxlength="120" value="${esc(row.name || "")}" placeholder="без названия" spellcheck="false" /></td>
              <td class="num"><div class="vault-amount"><span class="vault-sign">${signOf(row)}</span><input data-vf="amount" inputmode="decimal" value="${esc(
                row.type === "save" ? amount : Math.abs(amount)
              )}" /></div></td>
              <td class="num computed ${bal.hand < 0 ? "neg" : ""}">${esc(money(bal.hand))}</td>
              <td class="num computed save">${esc(money(bal.save))}</td>
              <td><button type="button" class="btn icon small danger" data-vault-del="${esc(row.id)}" title="Удалить строку">✕</button></td>
            </tr>`;
          })
          .join("")
      : `<tr><td colspan="7" class="empty-cell">${
          page.rows.length ? "Под фильтр ничего не подошло." : "Строк пока нет. Добавьте первое пополнение выше."
        }</td></tr>`;
    return `
      <div class="vault-list-head">
        <h3>Движение денег</h3>
        <div class="vault-filter">${chips}</div>
      </div>
      <div class="table-wrap">
        <table class="data vault-table">
          <colgroup><col style="width:140px"><col style="width:140px"><col><col style="width:150px"><col style="width:140px"><col style="width:140px"><col style="width:52px"></colgroup>
          <thead><tr><th>Дата</th><th>Тип</th><th>Название</th><th class="num">Сумма</th><th class="num">На руках после</th><th class="num">В копилке после</th><th></th></tr></thead>
          <tbody>${body}</tbody>
        </table>
      </div>`;
  }

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
    body.innerHTML = `
      <section class="card vault-head">
        <input id="vault-page-name" class="vault-name" maxlength="48" spellcheck="false" value="${esc(page.name)}" title="Название страницы — например «Отпуск» или «Новый телефон»" />
        ${kpiHtml(page, t)}
      </section>
      <section class="card vault-add">${addFormHtml()}</section>
      <section class="card vault-list">${listHtml(page, runningBalances(page))}</section>`;
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
