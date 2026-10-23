(function () {
  const view = document.body.dataset.view === "week" ? "week" : "month";
  const ICONS = {
    "role-start": '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M5 3.2v9.6L13 8z" fill="currentColor"/></svg>',
    "role-done": '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3.2 8.4 6.3 11.5 12.8 4.5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    "role-now": '<svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="3.1" fill="currentColor"/></svg>',
    "role-was": '<svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="5" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M8 4.7V8l2.1 1.3" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>',
    "role-plan": '<svg viewBox="0 0 16 16" aria-hidden="true"><rect x="3" y="3.4" width="10" height="9.2" rx="1.3" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M3 6.6h10M6 2.6v2.2M10 2.6v2.2" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>',
    "role-pause": '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4.2 3h2.2v10H4.2zm5.4 0h2.2v10H9.6z" fill="currentColor"/></svg>'
  };
  const WD = ["пн", "вт", "ср", "чт", "пт", "сб", "вс"];
  const MONTHS = ["января", "февраля", "марта", "апреля", "мая", "июня", "июля", "августа", "сентября", "октября", "ноября", "декабря"];
  let hidePause = true;

  function dayStart(offset) {
    const d = new Date();
    d.setHours(12, 0, 0, 0);
    d.setDate(d.getDate() + offset);
    return d;
  }

  function keyOf(d) {
    return d.getFullYear() + "-" + d.getMonth() + "-" + d.getDate();
  }

  function monday(d) {
    const x = new Date(d);
    x.setDate(x.getDate() - (x.getDay() + 6) % 7);
    return x;
  }

  function add(d, n) {
    const x = new Date(d);
    x.setDate(x.getDate() + n);
    return x;
  }

  const today = dayStart(0);
  const jobs = [
    { num: "1033", title: "Вывеска", role: "финиш", cls: "role-done", tone: "ok", color: "#059669", day: -1, pause: false },
    { num: "1042", title: "Кухня", role: "выполняется", cls: "role-now", tone: "now", color: "#0f766e", veil: "rgba(217,119,6,.45)", day: 0, pause: false },
    { num: "1051", title: "Свет", role: "выполняется", cls: "role-now", tone: "now", color: "#0369a1", day: 0, pause: false },
    { num: "1055", title: "Карниз", role: "пауза", cls: "role-pause", tone: "pause", color: "#64748b", day: 0, pause: true },
    { num: "1058", title: "Сборка", role: "выполняется", cls: "role-now", tone: "now", color: "#0f766e", day: 0, pause: false },
    { num: "1048", title: "Полка", role: "запланировано", cls: "role-plan", tone: "now", color: "#0284c8", day: 1, pause: false }
  ];

  function onDay(offset) {
    const want = keyOf(dayStart(offset));
    return jobs.filter((job) => keyOf(dayStart(job.day)) === want && !(hidePause && job.pause));
  }

  function roleMark(cls, word) {
    return '<i class="' + cls + '">' + ICONS[cls] + "<span>" + word + "</span></i>";
  }

  function monthChip(job) {
    return '<button type="button" class="cal-chip tone-' + job.tone + '" style="--bar:' + job.color + ";--a:100%;--veil:" + (job.veil || "transparent") + ";--ink:" + job.color + '" title="' + job.num + " " + job.title + " · " + job.role + '"><b>' + job.num + "</b><span>" + job.title + "</span>" + roleMark(job.cls, job.role) + "</button>";
  }

  function weekChip(job) {
    return '<button type="button" class="cal-chip is-week tone-' + job.tone + '" style="--bar:' + job.color + ";--a:100%;--veil:" + (job.veil || "transparent") + ";--ink:" + job.color + '" title="' + job.num + " " + job.title + " · " + job.role + '"><span class="cal-chip-title"><b>' + job.num + "</b> " + job.title + "</span>" + roleMark(job.cls, job.role) + "</button>";
  }

  function paintMonth() {
    const first = new Date(today.getFullYear(), today.getMonth(), 1, 12);
    const gridFrom = monday(first);
    const last = new Date(today.getFullYear(), today.getMonth() + 1, 0, 12);
    const gridTo = add(monday(last), 6);
    let cells = "";
    for (let d = new Date(gridFrom); d <= gridTo; d = add(d, 1)) {
      const offset = Math.round((d - today) / 86400000);
      const items = onDay(offset);
      const shown = items.slice(0, 3);
      const more = items.length - shown.length;
      const weekend = d.getDay() === 0 || d.getDay() === 6;
      const out = d.getMonth() !== today.getMonth();
      const isToday = keyOf(d) === keyOf(today);
      cells += '<div class="cal-cell' + (out ? " is-out" : "") + (weekend ? " is-weekend" : "") + (isToday ? " is-today" : "") + '"><div class="cal-cell-n">' + d.getDate() + (items.length ? "<b>" + items.length + "</b>" : "") + "</div>" + shown.map(monthChip).join("") + (more > 0 ? '<div class="cal-more">ещё ' + more + "</div>" : "") + "</div>";
    }
    const heads = WD.map((word, i) => '<div class="' + (i >= 5 ? "is-weekend" : "") + '">' + word + "</div>").join("");
    document.getElementById("board").innerHTML = '<div class="cal-weekdays">' + heads + '</div><div class="cal-month">' + cells + "</div>";
  }

  function paintWeek() {
    const start = monday(today);
    let cols = "";
    for (let i = 0; i < 7; i++) {
      const d = add(start, i);
      const offset = Math.round((d - today) / 86400000);
      const items = onDay(offset);
      const weekend = d.getDay() === 0 || d.getDay() === 6;
      const isToday = offset === 0;
      const past = offset < 0;
      const midCls = past ? "role-was" : offset > 0 ? "role-plan" : "role-now";
      const midWord = past ? "Выполнялось" : offset > 0 ? "Запланировано" : "Выполняется";
      const starts = items.filter((job) => job.cls === "role-start");
      const ends = items.filter((job) => job.cls === "role-done");
      const paused = items.filter((job) => job.pause);
      const running = items.filter((job) => !job.pause && job.cls !== "role-done" && job.cls !== "role-start");
      const pct = Math.min(100, items.length / 4 * 100);
      let body = "";
      if (starts.length) body += '<div class="cal-col-sec role-start">' + ICONS["role-start"] + "<span>Старт</span></div>" + starts.map(weekChip).join("");
      if (running.length) body += '<div class="cal-col-sec ' + midCls + '">' + ICONS[midCls] + "<span>" + midWord + "</span></div>" + running.map(weekChip).join("");
      if (paused.length) body += '<div class="cal-col-sec role-pause">' + ICONS["role-pause"] + "<span>Пауза</span></div>" + paused.map(weekChip).join("");
      if (ends.length) body += '<div class="cal-col-sec role-done">' + ICONS["role-done"] + "<span>Финиш</span></div>" + ends.map(weekChip).join("");
      if (!body) body = '<div class="cal-col-empty">пусто</div>';
      cols += '<div class="cal-col' + (weekend ? " is-weekend" : "") + (isToday ? " is-today" : "") + '"><div class="cal-col-pin"><div class="cal-col-head"><strong>' + WD[i] + "</strong><span>" + d.getDate() + " " + MONTHS[d.getMonth()] + "</span><em>" + items.length + ' зак.</em></div><div class="cal-load"><i style="width:' + pct + '%"></i></div></div><div class="cal-col-body">' + body + "</div></div>";
    }
    document.getElementById("board").innerHTML = '<div class="cal-week">' + cols + "</div>";
  }

  function story() {
    if (view === "week") {
      return hidePause
        ? "Паузы скрыты. «Карниз» не попал в колонку, зоны «Пауза» нет."
        : "Паузы показаны. У сегодняшнего дня есть зона «Пауза» с «Карнизом».";
    }
    return hidePause
      ? "Паузы скрыты. «Карниз» не попал в ячейку. «Сборка» была четвёртой и теперь видна: в ячейке снова не больше трёх."
      : "Паузы показаны. Сегодня четыре заказа: виден «Карниз», а «Сборка» спрятана за «ещё 1».";
  }

  function paint() {
    if (view === "week") paintWeek();
    else paintMonth();
    const btn = document.getElementById("hide-pause");
    btn.classList.toggle("active", hidePause);
    btn.setAttribute("aria-pressed", hidePause ? "true" : "false");
    document.getElementById("story").textContent = story();
  }

  document.getElementById("hide-pause").addEventListener("click", () => {
    hidePause = !hidePause;
    paint();
  });
  paint();
})();
