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
                `<button type="button" class="vt-${id} ${id === type ? "active" : ""}" data-vault-type="${id}" role="radio" aria-checked="${id === type}" title="${esc(meta.hint)} · ${TYPE_KEYS[id]}">${esc(meta.label)}</button>`
            )
            .join("")}
        </div>
        <input id="vault-new-name" class="vault-in-name" maxlength="120" placeholder="Название строки" autocomplete="off" spellcheck="false" />
        <input id="vault-new-amount" class="vault-in-amount" inputmode="decimal" placeholder="Сумма" autocomplete="off" />
        <input id="vault-new-date" class="vault-in-date" type="date" value="${session.draftDate || today()}" title="Дата запоминается для следующих строк" />
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
              <td><select data-vf="type">${Object.entries(TYPES)
                .map(([id, m]) => `<option value="${id}" ${id === row.type ? "selected" : ""}>${esc(m.label)}</option>`)
                .join("")}</select></td>
              <td><input data-vf="name" maxlength="120" value="${esc(row.name || "")}" placeholder="без названия" spellcheck="false" /></td>
              <td class="num"><div class="vault-amount"><span class="vault-sign">${signOf(row)}</span><input data-vf="amount" inputmode="decimal" value="${esc(
                row.type === "save" ? amount : Math.abs(amount)
              )}" /></div></td>
              <td class="num computed ${bal.hand < 0 ? "neg" : ""}">${esc(money(bal.hand))}</td>
              <td class="num computed save">${esc(money(bal.save))}</td>
              <td><input type="date" data-vf="date" value="${esc(row.date || "")}" /></td>
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
          <colgroup><col style="width:140px"><col><col style="width:150px"><col style="width:140px"><col style="width:140px"><col style="width:140px"><col style="width:52px"></colgroup>
          <thead><tr><th>Тип</th><th>Название</th><th class="num">Сумма</th><th class="num" title="Сколько было на руках после этой строки">На руках</th><th class="num" title="Сколько было в копилке после этой строки">В копилке</th><th>Дата</th><th></th></tr></thead>
          <tbody>${body}</tbody>
        </table>
      </div>`;
  }

