/* Свой выбор даты вместо системного окна Windows — для всех input[type=date] интерфейса компьютера. */
(function () {
  "use strict";

  const MONTHS = ["Январь", "Февраль", "Март", "Апрель", "Май", "Июнь", "Июль", "Август", "Сентябрь", "Октябрь", "Ноябрь", "Декабрь"];
  const MONTHS_SHORT = ["янв", "фев", "мар", "апр", "май", "июн", "июл", "авг", "сен", "окт", "ноя", "дек"];
  const WEEK = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"];

  let pop = null;
  let input = null;
  let mode = "days";
  let span = 1;
  let viewY = 0;
  let viewM = 0;
  let cursor = "";

  const pad = (n) => String(n).padStart(2, "0");
  const iso = (y, m, d) => `${String(y).padStart(4, "0")}-${pad(m + 1)}-${pad(d)}`;

  function parse(value) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || ""));
    return m ? { y: +m[1], m: +m[2] - 1, d: +m[3] } : null;
  }

  function todayIso() {
    const d = new Date();
    return iso(d.getFullYear(), d.getMonth(), d.getDate());
  }

  function daysIn(y, m) {
    return new Date(y, m + 1, 0).getDate();
  }

  function shiftIso(value, { days = 0, months = 0 } = {}) {
    const p = parse(value) || parse(todayIso());
    if (months) {
      const total = p.y * 12 + p.m + months;
      const y = Math.floor(total / 12);
      const m = total - y * 12;
      return iso(y, m, Math.min(p.d, daysIn(y, m)));
    }
    const d = new Date(p.y, p.m, p.d + days);
    return iso(d.getFullYear(), d.getMonth(), d.getDate());
  }

  function allowed(value) {
    if (!input) return true;
    if (input.min && value < input.min) return false;
    if (input.max && value > input.max) return false;
    return true;
  }

  function ensurePop() {
    if (pop) return pop;
    pop = document.createElement("div");
    pop.className = "dp-pop";
    pop.setAttribute("role", "dialog");
    pop.setAttribute("aria-label", "Выбор даты");
    pop.addEventListener("mousedown", (e) => e.preventDefault());
    pop.addEventListener("click", onPopClick);
    pop.addEventListener("wheel", onWheel, { passive: false });
    document.body.appendChild(pop);
    return pop;
  }

  function headHtml(prevTip, nextTip, middle) {
    return `<div class="dp-head">
      <button type="button" class="dp-nav" data-dp="prev" title="${prevTip}">‹</button>
      <div class="dp-titles">${middle}</div>
      <button type="button" class="dp-nav" data-dp="next" title="${nextTip}">›</button>
    </div>`;
  }

  function spanSize() {
    return span === 3 || span === 6 || span === 12 ? span : 1;
  }

  function spanStart(y, m, size) {
    if (size === 12) return { y, m: 0 };
    if (size === 6) return { y, m: m < 6 ? 0 : 6 };
    if (size === 3) return { y, m: Math.floor(m / 3) * 3 };
    return { y, m };
  }

  function addMonths(y, m, delta) {
    const total = y * 12 + m + delta;
    const ny = Math.floor(total / 12);
    return { y: ny, m: total - ny * 12 };
  }

  function spanSwitch() {
    const size = spanSize();
    const items = [
      [1, "Месяц"],
      [3, "3 мес"],
      [6, "6 мес"],
      [12, "Год"],
    ];
    return `<div class="dp-spans">${items
      .map(([n, label]) => `<button type="button" class="dp-span${n === size ? " on" : ""}" data-dp-span="${n}">${label}</button>`)
      .join("")}</div>`;
  }

  function monthDays(y, m, bleed) {
    const selected = input?.value || "";
    const today = todayIso();
    const first = (new Date(y, m, 1).getDay() + 6) % 7;
    const count = daysIn(y, m);
    const cells = [];
    const pushDay = (d) => {
      const value = iso(d.getFullYear(), d.getMonth(), d.getDate());
      const cls = [
        "dp-day",
        d.getMonth() !== m ? "out" : "",
        value === today ? "today" : "",
        value === selected ? "sel" : "",
        value === cursor ? "cur" : "",
        (d.getDay() + 6) % 7 >= 5 ? "wkend" : "",
      ]
        .filter(Boolean)
        .join(" ");
      cells.push(`<button type="button" class="${cls}" data-day="${value}" ${allowed(value) ? "" : "disabled"}>${d.getDate()}</button>`);
    };
    if (bleed) {
      for (let i = 0; i < 42; i += 1) pushDay(new Date(y, m, 1 - first + i));
    } else {
      for (let i = 0; i < first; i += 1) cells.push(`<span class="dp-day pad"></span>`);
      for (let day = 1; day <= count; day += 1) pushDay(new Date(y, m, day));
      for (let i = first + count; i < 42; i += 1) cells.push(`<span class="dp-day pad"></span>`);
    }
    return cells.join("");
  }

  function weekRow() {
    return `<div class="dp-week">${WEEK.map((w, i) => `<span class="${i >= 5 ? "wkend" : ""}">${w}</span>`).join("")}</div>`;
  }

  function daysHtml() {
    const size = spanSize();
    const start = spanStart(viewY, viewM, size);
    if (size === 1) {
      return `${headHtml(
        "Предыдущий месяц",
        "Следующий месяц",
        `<button type="button" class="dp-title" data-dp="months" title="Выбрать месяц">${MONTHS[viewM]}</button>
         <button type="button" class="dp-title" data-dp="years" title="Выбрать год">${viewY}</button>`
      )}
      <div class="dp-scroll">${weekRow()}<div class="dp-grid days">${monthDays(viewY, viewM, true)}</div></div>`;
    }
    const end = addMonths(start.y, start.m, size - 1);
    const label =
      size === 12
        ? String(start.y)
        : start.y === end.y
          ? `${MONTHS_SHORT[start.m]} — ${MONTHS_SHORT[end.m]} ${start.y}`
          : `${MONTHS_SHORT[start.m]} ${start.y} — ${MONTHS_SHORT[end.m]} ${end.y}`;
    const prevTip = size === 12 ? "Предыдущий год" : size === 6 ? "Предыдущее полугодие" : "Предыдущий квартал";
    const nextTip = size === 12 ? "Следующий год" : size === 6 ? "Следующее полугодие" : "Следующий квартал";
    const blocks = [];
    for (let i = 0; i < size; i += 1) {
      const p = addMonths(start.y, start.m, i);
      blocks.push(`<section class="dp-month"><div class="dp-month-name">${MONTHS[p.m]}</div>${weekRow()}<div class="dp-grid days">${monthDays(p.y, p.m, false)}</div></section>`);
    }
    return `${headHtml(prevTip, nextTip, `<span class="dp-range">${label}</span>`)}
      <div class="dp-scroll"><div class="dp-boards span-${size}">${blocks.join("")}</div></div>`;
  }

  function monthsHtml() {
    const sel = parse(input?.value);
    const now = parse(todayIso());
    return `${headHtml(
      "Предыдущий год",
      "Следующий год",
      `<button type="button" class="dp-title" data-dp="years" title="Выбрать год">${viewY}</button>`
    )}
    <div class="dp-scroll"><div class="dp-grid months">${MONTHS_SHORT.map((name, m) => {
      const cls = [
        "dp-cell",
        m === viewM ? "cur" : "",
        sel && sel.y === viewY && sel.m === m ? "sel" : "",
        now.y === viewY && now.m === m ? "today" : "",
      ]
        .filter(Boolean)
        .join(" ");
      return `<button type="button" class="${cls}" data-month="${m}">${name}</button>`;
    }).join("")}</div></div>`;
  }

  function yearsHtml() {
    const base = viewY - (((viewY % 12) + 12) % 12);
    const sel = parse(input?.value);
    const now = parse(todayIso());
    const cells = [];
    for (let y = base; y < base + 12; y += 1) {
      const cls = ["dp-cell", y === viewY ? "cur" : "", sel && sel.y === y ? "sel" : "", now.y === y ? "today" : ""].filter(Boolean).join(" ");
      cells.push(`<button type="button" class="${cls}" data-year="${y}">${y}</button>`);
    }
    return `${headHtml("Предыдущие 12 лет", "Следующие 12 лет", `<span class="dp-range">${base} — ${base + 11}</span>`)}
    <div class="dp-scroll"><div class="dp-grid years">${cells.join("")}</div></div>`;
  }

  function render() {
    if (!pop || !input) return;
    pop.classList.remove("span-3", "span-6", "span-12");
    if (spanSize() > 1 && mode === "days") pop.classList.add(`span-${spanSize()}`);
    const body = mode === "years" ? yearsHtml() : mode === "months" ? monthsHtml() : daysHtml();
    const value = parse(input.value);
    const picked = value ? `${pad(value.d)}.${pad(value.m + 1)}.${value.y}` : "дата не выбрана";
    const scrollTop = pop.querySelector(".dp-scroll")?.scrollTop || 0;
    pop.innerHTML = `${spanSwitch()}${body}
      <div class="dp-foot">
        <span class="dp-picked">${picked}</span>
        <button type="button" class="dp-link" data-dp="today" ${allowed(todayIso()) ? "" : "disabled"}>Сегодня</button>
        ${input.required ? "" : `<button type="button" class="dp-link muted" data-dp="clear">Очистить</button>`}
      </div>`;
    const sc = pop.querySelector(".dp-scroll");
    if (sc) sc.scrollTop = scrollTop;
    position(pinTop != null);
  }

  let pinTop = null;

  function placePop(top, left) {
    const margin = 8;
    const limit = Math.max(160, window.innerHeight - top - margin);
    pop.style.maxWidth = `${window.innerWidth - margin * 2}px`;
    pop.style.maxHeight = `${limit}px`;
    pop.style.left = `${Math.round(left)}px`;
    pop.style.top = `${Math.round(top)}px`;
    pinTop = top;
    const sc = pop.querySelector(".dp-scroll");
    if (!sc) return;
    let chrome = 0;
    for (const child of pop.children) {
      if (child !== sc) chrome += child.offsetHeight;
    }
    const cs = getComputedStyle(pop);
    const pad = parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom);
    sc.style.maxHeight = `${Math.max(96, limit - chrome - pad)}px`;
  }

  function position(keepTop) {
    if (!pop || !input) return;
    if (!input.isConnected) {
      close();
      return;
    }
    const margin = 8;
    const anchor = input.getBoundingClientRect();
    const w = pop.offsetWidth;
    const left = Math.min(Math.max(margin, anchor.left), Math.max(margin, window.innerWidth - w - margin));
    if (keepTop && pinTop != null) {
      placePop(Math.max(margin, pinTop), left);
      return;
    }
    pop.style.maxHeight = `${window.innerHeight - margin * 2}px`;
    const h = Math.min(pop.offsetHeight, window.innerHeight - margin * 2);
    let top = anchor.bottom + 4;
    const below = window.innerHeight - margin - top;
    const above = anchor.top - margin - 4;
    if (h > below && above > below) top = Math.max(margin, anchor.top - 4 - h);
    if (top < margin) top = margin;
    placePop(top, left);
  }

  function setView(value) {
    const p = parse(value) || parse(todayIso());
    viewY = p.y;
    viewM = p.m;
  }

  function open(el) {
    if (!el || el.disabled || el.readOnly) return;
    if (input === el && pop?.classList.contains("open")) return;
    input = el;
    pinTop = null;
    mode = "days";
    cursor = el.value || todayIso();
    setView(cursor);
    ensurePop().classList.add("open");
    render();
  }

  function close() {
    if (pop) pop.classList.remove("open");
    input = null;
    pinTop = null;
  }

  function commit(value) {
    const el = input;
    if (!el) return;
    if (value && !allowed(value)) return;
    close();
    if (el.value === value) return;
    el.value = value;
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
  }

  function step(dir) {
    if (mode === "years") viewY += dir * 12;
    else if (mode === "months") viewY += dir;
    else {
      const size = spanSize();
      const start = spanStart(viewY, viewM, size);
      const next = addMonths(start.y, start.m, dir * size);
      viewY = next.y;
      viewM = next.m;
    }
    render();
  }

  function onPopClick(e) {
    const btn = e.target.closest("button");
    if (!btn || btn.disabled || !input) return;
    if (btn.dataset.dpSpan) {
      const size = +btn.dataset.dpSpan;
      if (size === 1 || size === 3 || size === 6 || size === 12) {
        span = size;
        mode = "days";
        render();
      }
      return;
    }
    if (btn.dataset.day) {
      commit(btn.dataset.day);
      return;
    }
    if (btn.dataset.month) {
      viewM = +btn.dataset.month;
      mode = "days";
      render();
      return;
    }
    if (btn.dataset.year) {
      viewY = +btn.dataset.year;
      mode = "months";
      render();
      return;
    }
    const act = btn.dataset.dp;
    if (act === "prev") step(-1);
    else if (act === "next") step(1);
    else if (act === "months") {
      mode = "months";
      render();
    } else if (act === "years") {
      mode = "years";
      render();
    } else if (act === "today") commit(todayIso());
    else if (act === "clear") commit("");
  }

  function onWheel(e) {
    if (!input || !e.target.closest(".dp-grid")) return;
    e.preventDefault();
    step(e.deltaY > 0 ? 1 : -1);
  }

  function moveCursor(opts) {
    cursor = shiftIso(cursor || input.value || todayIso(), opts);
    mode = "days";
    setView(cursor);
    render();
  }

  function isDateInput(el) {
    return el instanceof HTMLInputElement && el.type === "date";
  }

  document.addEventListener(
    "click",
    (e) => {
      if (isDateInput(e.target)) open(e.target);
    },
    true
  );

  document.addEventListener(
    "mousedown",
    (e) => {
      if (!pop?.classList.contains("open")) return;
      if (pop.contains(e.target) || e.target === input) return;
      close();
    },
    true
  );

  document.addEventListener(
    "keydown",
    (e) => {
      const el = e.target;
      if (!isDateInput(el)) return;
      if ((e.altKey && (e.key === "ArrowDown" || e.key === "ArrowUp")) || e.key === "F4") {
        e.preventDefault();
        if (input === el && pop?.classList.contains("open")) close();
        else open(el);
        return;
      }
      if (input !== el || !pop?.classList.contains("open")) return;
      const keys = {
        ArrowLeft: { days: -1 },
        ArrowRight: { days: 1 },
        ArrowUp: { days: -7 },
        ArrowDown: { days: 7 },
        PageUp: e.shiftKey ? { months: -12 } : { months: -1 },
        PageDown: e.shiftKey ? { months: 12 } : { months: 1 },
      };
      if (keys[e.key]) {
        e.preventDefault();
        moveCursor(keys[e.key]);
      } else if (e.key === "Enter") {
        e.preventDefault();
        e.stopPropagation();
        commit(cursor || todayIso());
      } else if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        close();
      } else if (e.key === "Tab") close();
    },
    true
  );

  document.addEventListener(
    "input",
    (e) => {
      if (e.target !== input || !pop?.classList.contains("open")) return;
      if (parse(input.value)) {
        cursor = input.value;
        mode = "days";
        setView(cursor);
        render();
      }
    },
    true
  );

  document.addEventListener(
    "focusout",
    (e) => {
      if (e.target === input) setTimeout(() => document.activeElement !== input && close(), 0);
    },
    true
  );

  window.addEventListener("resize", position);
  document.addEventListener("scroll", () => pop?.classList.contains("open") && position(), true);

  window.FinDatePicker = { open, close };
})();
