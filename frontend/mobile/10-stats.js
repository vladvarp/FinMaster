  /* ================= сводка ================= */

  function dayKeyOf(d) {
    const p = (n) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  }

  function matchesStatsPeriod(iso, period) {
    if (!period || period === "all") return true;
    const stamp = String(iso || "");
    if (!stamp) return false;
    const now = new Date();
    if (period === "today") return stamp.slice(0, 10) === dayKeyOf(now);
    if (period === "week") {
      const from = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 6);
      return dateValue(stamp) >= dayKeyOf(from);
    }
    if (period === "month") return stamp.startsWith(`${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`);
    if (period === "year") return stamp.startsWith(String(now.getFullYear()));
    return true;
  }

  const STATS_PERIODS = [
    ["all", "Все даты"],
    ["today", "Сегодня"],
    ["week", "7 дней"],
    ["month", "Месяц"],
    ["year", "Год"],
  ];
  const STATS_FILTERS = [
    ["all", "Все заказы"],
    ["debt", "С долгом"],
    ["paid", "Оплачены"],
  ];

  function statsPeriodLabel() {
    return (STATS_PERIODS.find(([id]) => id === state.stats.period) || STATS_PERIODS[0])[1];
  }

  function statsFilterLabel() {
    return (STATS_FILTERS.find(([id]) => id === state.stats.filter) || STATS_FILTERS[0])[1];
  }

  function statsStatusLabel() {
    return state.stats.status || "Все статусы";
  }

  function statsPickHtml(label, on) {
    return `<span class="${on ? "on" : ""}">${esc(label)}</span><span class="picker-ico">▾</span>`;
  }

  function renderStatsChips(rows, list) {
    const periodEl = $("stats-period");
    const filterEl = $("stats-filter");
    const statusEl = $("stats-status");
    if (!periodEl || !filterEl || !statusEl) return;
    periodEl.innerHTML = statsPickHtml(statsPeriodLabel(), state.stats.period !== "all");
    filterEl.innerHTML = statsPickHtml(statsFilterLabel(), state.stats.filter !== "all");
    statusEl.innerHTML = statsPickHtml(statsStatusLabel(), !!state.stats.status);
    periodEl._rows = rows;
    filterEl._list = list;
    statusEl._rows = rows;
  }

  function openStatsPeriod() {
    const rows = $("stats-period")?._rows || [];
    openSheet(
      "Период",
      STATS_PERIODS.map(([id, label]) => ({
        value: id,
        label,
        hint: `${rows.filter(({ line }) => matchesStatsPeriod(line.order_date, id)).length} поз.`,
      })),
      state.stats.period,
      (item) => {
        state.stats.period = item.value;
        renderStats();
        navReport();
      }
    );
  }

  function openStatsFilter() {
    const list = $("stats-filter")?._list || orders();
    openSheet(
      "Заказы",
      STATS_FILTERS.map(([id, label]) => ({
        value: id,
        label,
        hint: `${id === "all" ? list.length : list.filter((o) => matchesFilter(o, id)).length}`,
      })),
      state.stats.filter,
      (item) => {
        state.stats.filter = item.value;
        renderStats();
        navReport();
      }
    );
  }

  function openStatsStatus() {
    const rows = $("stats-status")?._rows || [];
    const statuses = state.doc?.statuses || [];
    openSheet(
      "Статус",
      [{ value: "", label: "Все статусы", hint: `${rows.length} поз.`, color: "" }].concat(
        statuses.map((s) => ({
          value: s.name,
          label: s.name,
          hint: `${rows.filter(({ line }) => line.status === s.name).length} поз.`,
          color: s.color || "",
        }))
      ),
      state.stats.status,
      (item) => {
        state.stats.status = item.value;
        renderStats();
        navReport();
      }
    );
  }

  function statsOrders() {
    return orders().filter((order) => (order.lines || []).some((line) => !isFrozenLine(line)));
  }

  function statsLines(list) {
    return (list || [])
      .flatMap((order) => (order.lines || []).map((line) => ({ order, line })))
      .filter(({ line }) => !isFrozenLine(line));
  }

  function statsRows() {
    const list = statsOrders().filter((o) => matchesFilter(o, state.stats.filter));
    return statsLines(list).filter(({ line }) => {
      if (state.stats.status && line.status !== state.stats.status) return false;
      return matchesStatsPeriod(line.order_date, state.stats.period);
    });
  }

  function mcalWorkLines(order) {
    return (order.lines || []).filter((line) => !isFrozenLine(line) && !isExpenseLine(line));
  }

  function mcalRoleBits(role) {
    const cls = {
      "старт": "role-start",
      "финиш": "role-done",
      "старт и финиш": "role-both",
      "пауза": "role-pause",
      "выполняется": "role-now",
      "выполнялось": "role-was",
      "запланировано": "role-plan",
    }[role] || "";
    const icons = {
      "role-start": `<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M5 3.2v9.6L13 8z" fill="currentColor"/></svg>`,
      "role-done": `<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3.2 8.4 6.3 11.5 12.8 4.5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
      "role-both": `<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M2.6 4.4v7.2L7.6 8z" fill="currentColor"/><path d="M9 5.6 12.8 8 9 10.4" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
      "role-pause": `<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4.2 3h2.2v10H4.2zm5.4 0h2.2v10H9.6z" fill="currentColor"/></svg>`,
      "role-now": `<svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="3.1" fill="currentColor"/></svg>`,
      "role-was": `<svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="5" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M8 4.7V8l2.1 1.3" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>`,
      "role-plan": `<svg viewBox="0 0 16 16" aria-hidden="true"><rect x="3" y="3.4" width="10" height="9.2" rx="1.3" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M3 6.6h10M6 2.6v2.2M10 2.6v2.2" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>`,
    };
    return { cls, icon: icons[cls] || "" };
  }

  function mcalRoleHtml(role) {
    const { cls, icon } = mcalRoleBits(role);
    return `<i class="mcal-role-i ${cls}">${icon}<span>${esc(role)}</span></i>`;
  }

  function mcalDayRole(order, day) {
    const key = dayKey(dayStart(day));
    const today = dayKey(dayStart(new Date()));
    const start = dateValue(order.work_start);
    const end = dateValue(order.work_end);
    if (start && end && start === end && start === key) return "старт и финиш";
    if (isPaused(order, day)) return "пауза";
    if (start === key) return "старт";
    if (end && end === key) return "финиш";
    if (key === today) return "выполняется";
    if (key < today) return "выполнялось";
    return "запланировано";
  }

  function mcalDayOrder(order, day) {
    const role = mcalDayRole(order, day);
    const meta = workStatusMeta(order, day);
    const lines = mcalWorkLines(order)
      .map((line) => {
        const lineRole = dateValue(line.work_start) || dateValue(line.work_end) ? mcalDayRole(line, day) : role;
        return `<div class="mcal-line"><span>${esc(line.product || "Без названия")}</span>${mcalRoleHtml(lineRole)}${noteBoxHtml(line.notes)}</div>`;
      })
      .join("");
    return `<article class="mcal-chip" data-open="${esc(order.id)}" style="--tint:${esc(meta.color)}">
      <div class="mcal-chip-title"><b>${esc(order.number || "—")}</b> ${esc(order.name || "без названия")}</div>
      ${mcalRoleHtml(role)}
      ${noteBoxHtml(order.notes)}
      ${lines ? `<div class="mcal-lines">${lines}</div>` : ""}
    </article>`;
  }

  function mcalDayBoard(list, day, cal) {
    const key = dayKey(day);
    const todayKey = dayKey(dayStart(new Date()));
    const hidePause = cal.hidePause !== false;
    const items = list.filter((order) => orderMarksDay(order, day) && !(hidePause && isPaused(order, day)));
    const starts = items.filter((order) => dateValue(order.work_start) === key && !isPaused(order, day));
    const ends = items.filter((order) => {
      const end = dateValue(order.work_end);
      return end === key && end !== dateValue(order.work_start) && !isPaused(order, day);
    });
    const running = items.filter((order) => !isPaused(order, day) && dateValue(order.work_start) !== key && dateValue(order.work_end) !== key);
    const paused = hidePause ? [] : items.filter((order) => isPaused(order, day));
    const mid = key < todayKey ? "выполнялось" : key > todayKey ? "запланировано" : "выполняется";
    const block = (role, rows) => {
      if (!rows.length) return "";
      const { cls, icon } = mcalRoleBits(role);
      return `<div class="mcal-sec ${cls}">${icon}<span>${esc(role)}</span></div>${rows.map((order) => mcalDayOrder(order, day)).join("")}`;
    };
    const pct = Math.min(100, (items.length / 4) * 100);
    return `<div class="mcal-day">
      <div class="mcal-col ${dayToneClass(day)} ${key === todayKey ? "is-today" : ""} ${cal.pick === key ? "is-pick" : ""}">
        <div class="mcal-col-h">
          <strong>${RU_WEEKDAYS[(day.getDay() + 6) % 7]}</strong>
          <span>${esc(calFmtDay(day))}</span>
          <em>${items.length} зак.</em>
        </div>
        <div class="mcal-load"><i style="width:${pct}%"></i></div>
        <textarea class="mcal-memo-edit" rows="2" data-cal-note="${esc(key)}" placeholder="Заметка">${esc(dayNote(key))}</textarea>
        ${block("старт", starts)}
        ${block(mid, running)}
        ${block("пауза", paused)}
        ${block("финиш", ends)}
        ${items.length ? "" : `<div class="empty">пусто</div>`}
      </div>
    </div>`;
  }

  function renderCalendar() {
    if (!requireDocument()) return;
    const cal = state.cal;
    if (!cal.anchor) cal.anchor = dayStart(new Date());
    if (cal.mode !== "classic" && cal.mode !== "day") cal.mode = "extended";
    const today = dayStart(new Date());
    const all = orders();
    const list = cal.filter === "all" ? all : all.filter((order) => workStatus(order) === cal.filter);
    const now = all.filter((order) => workStatus(order) === "now");
    const nodate = all.filter((order) => workStatus(order) === "nodate");
    const hidePause = cal.hidePause !== false;
    const modes = [
      ["classic", "Классический — сетка месяца"],
      ["extended", "Неделя — старты, в работе и финиши"],
      ["day", "День — как столбец недели на компьютере"],
    ];
    const filters = [
      ["all", "Все"],
      ["now", "Сейчас"],
      ["planned", "План"],
      ["done", "Готово"],
      ["nodate", "Без дат"],
    ];
    const modeIcon = (id) =>
      id === "classic"
        ? `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true"><rect x="4" y="5" width="16" height="15" rx="2" stroke="currentColor" stroke-width="1.8"/><path d="M4 9.5h16M8 5v3M16 5v3M8 13h.01M12 13h.01M16 13h.01M8 16.5h.01M12 16.5h.01" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>`
        : id === "day"
          ? `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true"><rect x="7" y="3.5" width="10" height="17" rx="2" stroke="currentColor" stroke-width="1.8"/><path d="M7 8h10" stroke="currentColor" stroke-width="1.8"/><path d="M12 12.2v4.2" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><circle cx="12" cy="12.2" r="1.5" fill="currentColor"/></svg>`
          : `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M5 9v8M8.5 6v11M12 8v9M15.5 7v10M19 10v7" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>`;
    const filterMeta = filters.find(([id]) => id === cal.filter) || filters[0];
    let title = "";
    let board = "";
    if (cal.filter === "nodate") {
      title = "Без дат";
      board = nodate.length
        ? nodate.map((order) => mcalOrderCard(order)).join("")
        : `<div class="empty">Нет заказов без дат.</div>`;
    } else if (cal.mode === "classic") {
      const from = new Date(cal.anchor.getFullYear(), cal.anchor.getMonth(), 1);
      const to = new Date(cal.anchor.getFullYear(), cal.anchor.getMonth() + 1, 0);
      title = `${RU_MONTHS_NOM[from.getMonth()]} ${from.getFullYear()}`;
      const gridFrom = mondayOf(from);
      let gridTo = addDays(gridFrom, 41);
      while (gridTo < to) gridTo = addDays(gridTo, 7);
      const cells = [];
      for (let d = gridFrom; d <= gridTo; d = addDays(d, 1)) {
        const key = dayKey(d);
        const covering = list.filter((order) => orderMarksDay(order, d) && !(hidePause && isPaused(order, d)));
        const n = covering.length;
        const inMonth = d.getMonth() === from.getMonth();
        const note = dayNote(key);
        cells.push(`<button type="button" class="mcal-cell ${inMonth ? "" : "is-out"} ${dayToneClass(d)} ${note ? "has-note" : ""} ${key === dayKey(today) ? "is-today" : ""} ${cal.pick === key ? "is-pick" : ""} ${mcalDayTone(covering)}" data-cal-day="${key}">
          <b>${d.getDate()}</b>${n ? `<i>${n}</i>` : ""}${note ? `<span class="mcal-dot" aria-label="Есть заметка"></span>` : ""}
        </button>`);
      }
      board = `<div class="mcal-weekdays">${RU_WEEKDAYS.map((w, i) => `<span class="${calendarOffSettings().weekends.includes(i) ? "is-weekend" : ""}">${w}</span>`).join("")}</div>
        <div class="mcal-month">${cells.join("")}</div>`;
      if (cal.pick) {
        const pick = parseDay(cal.pick);
        const items = list.filter((order) => orderMarksDay(order, pick) && !(hidePause && isPaused(order, pick)));
        const pickKey = dayKey(pick);
        board += `<div class="mcal-daylist"><h3>${esc(calFmtDay(pick))}</h3>
          <label class="mcal-note">Заметка<textarea rows="2" data-cal-note="${esc(pickKey)}" placeholder="Что в этот день">${esc(dayNote(pickKey))}</textarea></label>
          ${items.length ? items.map((order) => mcalOrderCard(order, pick)).join("") : `<div class="empty">В этот день никто не отмечен.</div>`}
        </div>`;
      }
    } else if (cal.mode === "extended") {
      const from = mondayOf(cal.anchor);
      const to = addDays(from, 6);
      title = `${from.getDate()}–${calFmtDay(to)}`;
      const weekDays = latestDaysFirst(from, to).filter((day) => !isGlobalWeekend(day));
      board = weekDays.length
        ? `<div class="mcal-week">${weekDays
        .map((day) => {
          const key = dayKey(day);
          const items = list.filter((order) => orderMarksDay(order, day) && !(hidePause && isPaused(order, day)));
          const starts = items.filter((order) => dateValue(order.work_start) === key && !isPaused(order, day));
          const ends = items.filter((order) => dateValue(order.work_end) === key && !isPaused(order, day));
          const paused = items.filter((order) => isPaused(order, day));
          const running = items.filter((order) => !isPaused(order, day) && dateValue(order.work_start) !== key && dateValue(order.work_end) !== key);
          const note = dayNote(key);
          const block = (title, rows) =>
            rows.length ? `<div class="mcal-sec">${esc(title)}</div>${rows.map((order) => mcalOrderCard(order, day)).join("")}` : "";
          return `<div class="mcal-col ${dayToneClass(day)} ${key === dayKey(today) ? "is-today" : ""} ${cal.pick === key ? "is-pick" : ""} ${mcalDayTone(items)}" data-cal-day="${key}">
            <div class="mcal-col-h"><b>${RU_WEEKDAYS[(day.getDay() + 6) % 7]}</b><span>${day.getDate()}</span><i>${items.length}</i></div>
            ${note && cal.pick !== key ? `<div class="mcal-memo">${esc(note)}</div>` : ""}
            ${cal.pick === key ? `<label class="mcal-note">Заметка<textarea rows="2" data-cal-note="${esc(key)}" placeholder="Что в этот день">${esc(note)}</textarea></label>` : ""}
            ${block("Старт", starts)}${block("В работе", running)}${block("На паузе", paused)}${block("Финиш", ends)}
            ${items.length ? "" : `<div class="empty">пусто</div>`}
          </div>`;
        })
        .join("")}</div>`
        : `<div class="empty">На этой неделе нет рабочих дней.</div>`;
    } else if (cal.mode === "day") {
      const day = dayStart(cal.anchor);
      title = `${RU_WEEKDAYS[(day.getDay() + 6) % 7]} · ${calFmtDay(day)}`;
      board = mcalDayBoard(list, day, cal);
    }
    const year = cal.anchor.getFullYear();
    const month = cal.anchor.getMonth();
    const y0 = Math.min(year, today.getFullYear()) - 15;
    const y1 = Math.max(year, today.getFullYear()) + 10;
    let yearOpts = "";
    for (let y = y0; y <= y1; y++) yearOpts += `<option value="${y}" ${y === year ? "selected" : ""}>${y}</option>`;
    const titleHtml =
      cal.mode === "classic"
        ? `<select class="mcal-pick" data-cal-month aria-label="Месяц">${RU_MONTHS_NOM.map((name, i) => `<option value="${i}" ${i === month ? "selected" : ""}>${esc(name)}</option>`).join("")}</select>
           <select class="mcal-pick" data-cal-year aria-label="Год">${yearOpts}</select>`
        : `<strong>${esc(title)}</strong>`;
    const todayIcon = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true"><rect x="4" y="5" width="16" height="15" rx="2" stroke="currentColor" stroke-width="1.8"/><path d="M4 9.5h16M8 5v3M16 5v3" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><circle cx="12" cy="15" r="2.3" fill="currentColor"/></svg>`;
    $("calendar-body").innerHTML = `
      <div class="mcal-kpis">
        <div><span>Идёт</span><b>${now.length}</b></div>
        <div><span>Без дат</span><b>${nodate.length}</b></div>
      </div>
      <div class="mcal-top">
        <div class="mcal-modes">${modes
          .map(
            ([id, label]) =>
              `<button type="button" class="chip ${cal.mode === id ? "active" : ""}" data-cal-mode="${id}" title="${esc(label)}" aria-label="${esc(label)}">${modeIcon(id)}</button>`
          )
          .join("")}</div>
        <div class="mcal-filter">
          <button type="button" class="btn ${cal.filter !== "all" ? "active" : ""}" id="btn-mcal-filter" title="Фильтр заказов: ${esc(filterMeta[1])}" aria-haspopup="menu" aria-expanded="false" aria-controls="mcal-filter-menu">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path d="M4 5h16l-6.2 7.4v5.1L10.2 19v-6.6L4 5Z" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/>
            </svg>
            <span>${esc(filterMeta[1])}</span>
          </button>
          <div class="mcal-filter-menu" id="mcal-filter-menu" hidden role="menu">${filters
            .map(
              ([id, label]) =>
                `<button type="button" class="btn ${cal.filter === id ? "active" : ""}" data-cal-filter="${id}" role="menuitem">${esc(label)}<span>${id === "all" ? all.length : all.filter((order) => workStatus(order) === id).length}</span></button>`
            )
            .join("")}</div>
        </div>
      </div>
      <div class="mcal-nav">
        <button type="button" class="btn mcal-ico" data-cal-nav="0" title="Сегодня" aria-label="Сегодня">${todayIcon}</button>
        <button type="button" class="btn mcal-ico ${hidePause ? "active" : ""}" id="mcal-hide-pause" title="Скрывать на паузе" aria-label="Скрывать на паузе" aria-pressed="${hidePause}">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M9 6.5v11M15 6.5v11" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>
        </button>
        ${
          cal.filter === "nodate"
            ? ""
            : `<div class="mcal-nav-dates">
          <button type="button" class="btn" data-cal-nav="-1">‹</button>
          ${titleHtml}
          <button type="button" class="btn" data-cal-nav="1">›</button>
        </div>`
        }
      </div>
      ${board}
    `;
    if (cal.revealPick) {
      cal.revealPick = false;
      const key = cal.pick;
      if (key && cal.mode !== "day") {
        requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(() => {
          document.querySelector(`[data-cal-day="${key}"]`)?.scrollIntoView({ block: "nearest" });
        })));
      }
    }
  }

  function rangeDays(from, to) {
    const days = [];
    for (let d = dayStart(from); d <= to; d = addDays(d, 1)) days.push(d);
    return days;
  }

  function mcalOrderCard(order, day) {
    const meta = workStatusMeta(order, day);
    const t = orderTotals(order);
    const role = day ? calendarRole(order, day) : "";
    return `<article class="card order-item mcal-order tone-${esc(meta.tone)}" data-open="${esc(order.id)}" style="--tint:${esc(meta.color)}">
      <div class="oi-top"><span class="oi-num">${esc(order.number || "—")}</span><span class="oi-sep">—</span><span class="oi-customer">${esc(order.name || "без названия")}</span></div>
      <div class="oi-name">${esc(order.customer || "Без заказчика")} · ${esc(dateValue(order.work_start) || "нет старта")} → ${esc(workEndLabel(order))}</div>
      <div class="oi-foot">
        <span class="work-pill work-pill-${esc(meta.id)}">${esc(meta.label)}</span>
        ${role ? `<span class="mcal-role">${esc(role)}</span>` : ""}
        <span class="sum">${esc(money(t.after))}</span>
      </div>
      <div class="mcal-acts">${workActButtons(order, true)}</div>
    </article>`;
  }

  function renderStats() {
    if (!requireDocument()) return;
    const all = statsRows();
    renderStatsChips(statsLines(statsOrders()), statsOrders());
    const list = [...new Set(all.map((r) => r.order))];
    const agg = all.reduce(
      (acc, { line }) => {
        const t = lineTotals(line);
        acc.after += t.after;
        acc.paid += t.paid;
        acc.unpaid += t.unpaid;
        acc.cost += t.cost;
        if (t.expense) acc.costCount += 1;
        else acc.count += 1;
        return acc;
      },
      { after: 0, paid: 0, unpaid: 0, cost: 0, count: 0, costCount: 0 }
    );
    agg.net = round2(agg.after - agg.cost);

    const byStatus = {};
    all.forEach(({ line }) => {
      const t = lineTotals(line);
      byStatus[line.status] = (byStatus[line.status] || 0) + t.after;
    });
    const maxStatus = Math.max(1, ...Object.values(byStatus));

    const byCustomer = {};
    list.forEach((o) => {
      const t = all
        .filter((r) => r.order.id === o.id)
        .reduce((acc, { line }) => acc + lineTotals(line).after, 0);
      const key = o.customer || "Без заказчика";
      byCustomer[key] = (byCustomer[key] || 0) + t;
    });
    const top = Object.entries(byCustomer)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5);
    const maxCustomer = Math.max(1, ...top.map(([, v]) => v));

    const monthKey = (() => {
      const now = new Date();
      return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
    })();
    let monthSum = 0;
    all.forEach(({ line }) => {
      if (String(line.order_date || "").startsWith(monthKey)) monthSum += lineTotals(line).after;
    });

    const debtMap = new Map();
    all.forEach(({ order, line }) => {
      const unpaid = lineTotals(line).unpaid;
      if (unpaid <= 0.005) return;
      const cur = debtMap.get(order.id) || { order, unpaid: 0 };
      cur.unpaid += unpaid;
      debtMap.set(order.id, cur);
    });
    const debtors = [...debtMap.values()].sort((a, b) => b.unpaid - a.unpaid).slice(0, 8);

    $("stats-body").innerHTML = `
      <div class="kpis">
        <div class="kpi"><span>Заказов</span><strong>${list.length}</strong></div>
        <div class="kpi"><span>Позиций</span><strong>${agg.count}</strong></div>
        <div class="kpi"><span>Выручка</span><strong>${esc(compact(agg.after))}</strong></div>
        <div class="kpi ${agg.unpaid > 0.005 ? "debt" : "ok"}"><span>Долг</span><strong>${esc(compact(agg.unpaid))}</strong></div>
        ${
          agg.cost > 0.005
            ? `<div class="kpi cost"><span>Расход</span><strong>−${esc(compact(agg.cost))}</strong></div>
        <div class="kpi ${agg.net >= 0 ? "ok" : "debt"}"><span>Чистыми</span><strong>${esc(compact(agg.net))}</strong></div>`
            : ""
        }
      </div>
      <article class="card">
        <div class="bar-row"><span>За этот месяц</span><b>${esc(money(monthSum))}</b>
          <div class="bar-track"><div class="bar-fill" style="background:var(--accent-2);width:${
            agg.after ? Math.min(100, (monthSum / agg.after) * 100) : 0
          }%"></div></div>
        </div>
        <div style="height:12px"></div>
        <div class="bar-row"><span>Оплачено</span><b>${esc(money(agg.paid))}</b>
          <div class="bar-track"><div class="bar-fill" style="background:var(--ok);width:${
            agg.after ? Math.min(100, (agg.paid / agg.after) * 100) : 0
          }%"></div></div>
        </div>
        <div style="height:12px"></div>
        <div class="bar-row"><span>Осталось получить</span><b>${esc(money(agg.unpaid))}</b>
          <div class="bar-track"><div class="bar-fill" style="background:var(--danger);width:${
            agg.after ? Math.min(100, (agg.unpaid / agg.after) * 100) : 0
          }%"></div></div>
        </div>
        ${
          agg.cost > 0.005
            ? `<div style="height:12px"></div>
        <div class="bar-row"><span>Налоги и затраты</span><b>−${esc(money(agg.cost))}</b>
          <div class="bar-track"><div class="bar-fill" style="background:var(--warn, #d97706);width:${
            agg.after ? Math.min(100, (agg.cost / agg.after) * 100) : 100
          }%"></div></div>
        </div>
        <div style="height:12px"></div>
        <div class="bar-row"><span>Чистыми</span><b>${esc(money(agg.net))}</b>
          <div class="bar-track"><div class="bar-fill" style="background:var(--accent);width:${
            agg.after ? Math.max(0, Math.min(100, (agg.net / agg.after) * 100)) : 0
          }%"></div></div>
        </div>`
            : ""
        }
      </article>
      <h3 class="section">По статусам</h3>
      <article class="card"><div class="bars">${
        Object.keys(byStatus).length
          ? Object.entries(byStatus)
              .sort((a, b) => b[1] - a[1])
              .map(
                ([name, value]) => `<div class="bar-row"><span>${esc(name)}</span><b>${esc(compact(value))}</b>
                  <div class="bar-track"><div class="bar-fill" style="background:${esc(statusMeta(name).color)};width:${
                    (value / maxStatus) * 100
                  }%"></div></div></div>`
              )
              .join("")
          : '<div class="muted">Нет данных</div>'
      }</div></article>
      <h3 class="section">Топ заказчиков</h3>
      <article class="card"><div class="bars">${
        top.length
          ? top
              .map(
                ([name, value]) => `<div class="bar-row"><span>${esc(name)}</span><b>${esc(compact(value))}</b>
                  <div class="bar-track"><div class="bar-fill" style="background:var(--accent-2);width:${
                    (value / maxCustomer) * 100
                  }%"></div></div></div>`
              )
              .join("")
          : '<div class="muted">Нет данных</div>'
      }</div></article>
      <h3 class="section">Кто должен</h3>
      <div class="list tight">${
        debtors.length
          ? debtors
              .map(
                ({ order, unpaid }) => `<article class="card order-item" data-open="${esc(order.id)}" style="--tint:var(--danger)">
                  <div class="oi-top">
                    <span class="oi-num">${esc(order.number || "—")}</span>
                    <span class="oi-sep">—</span>
                    <span class="oi-customer">${esc(order.name || "без названия")}</span>
                  </div>
                  <div class="oi-name">${esc(order.customer || "Без заказчика")}</div>
                  <div class="oi-foot">
                    <span class="sum debt">долг ${esc(money(unpaid))}</span>
                  </div>
                </article>`
              )
              .join("")
          : '<div class="empty">Долгов нет</div>'
      }</div>`;

    requestAnimationFrame(() => {
      document.querySelectorAll("#stats-body .bar-fill").forEach((el) => {
        const w = el.style.width;
        el.style.width = "0";
        requestAnimationFrame(() => {
          el.style.width = w;
        });
      });
    });
  }

