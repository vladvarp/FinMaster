/* Свой выбор даты вместо системного окна Windows — для всех input[type=date] интерфейса компьютера. */
(function () {
  "use strict";

  const MONTHS = ["Январь", "Февраль", "Март", "Апрель", "Май", "Июнь", "Июль", "Август", "Сентябрь", "Октябрь", "Ноябрь", "Декабрь"];
  const MONTHS_SHORT = ["янв", "фев", "мар", "апр", "май", "июн", "июл", "авг", "сен", "окт", "ноя", "дек"];
  const WEEK = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"];

  let pop = null;
  let input = null;
  let mode = "days";
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

  function daysHtml() {
    const selected = input?.value || "";
    const today = todayIso();
    const first = (new Date(viewY, viewM, 1).getDay() + 6) % 7;
    const cells = [];
    for (let i = 0; i < 42; i += 1) {
      const d = new Date(viewY, viewM, 1 - first + i);
      const value = iso(d.getFullYear(), d.getMonth(), d.getDate());
      const cls = [
        "dp-day",
        d.getMonth() !== viewM ? "out" : "",
        value === today ? "today" : "",
        value === selected ? "sel" : "",
        value === cursor ? "cur" : "",
        i % 7 >= 5 ? "wkend" : "",
      ]
        .filter(Boolean)
        .join(" ");
      cells.push(`<button type="button" class="${cls}" data-day="${value}" ${allowed(value) ? "" : "disabled"}>${d.getDate()}</button>`);
    }
    return `${headHtml(
      "Предыдущий месяц (PageUp)",
      "Следующий месяц (PageDown)",
      `<button type="button" class="dp-title" data-dp="months" title="Выбрать месяц">${MONTHS[viewM]}</button>
       <button type="button" class="dp-title" data-dp="years" title="Выбрать год">${viewY}</button>`
    )}
    <div class="dp-week">${WEEK.map((w, i) => `<span class="${i >= 5 ? "wkend" : ""}">${w}</span>`).join("")}</div>
    <div class="dp-grid days">${cells.join("")}</div>`;
  }

  function monthsHtml() {
    const sel = parse(input?.value);
    const now = parse(todayIso());
    return `${headHtml(
      "Предыдущий год",
      "Следующий год",
      `<button type="button" class="dp-title" data-dp="years" title="Выбрать год">${viewY}</button>`
    )}
    <div class="dp-grid months">${MONTHS_SHORT.map((name, m) => {
      const cls = [
        "dp-cell",
        m === viewM ? "cur" : "",
        sel && sel.y === viewY && sel.m === m ? "sel" : "",
        now.y === viewY && now.m === m ? "today" : "",
      ]
        .filter(Boolean)
        .join(" ");
      return `<button type="button" class="${cls}" data-month="${m}">${name}</button>`;
    }).join("")}</div>`;
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
    <div class="dp-grid years">${cells.join("")}</div>`;
  }

  function render() {
    if (!pop || !input) return;
    const body = mode === "years" ? yearsHtml() : mode === "months" ? monthsHtml() : daysHtml();
    const value = parse(input.value);
    const picked = value ? `${pad(value.d)}.${pad(value.m + 1)}.${value.y}` : "дата не выбрана";
    pop.innerHTML = `${body}
      <div class="dp-foot">
        <span class="dp-picked">${picked}</span>
        <button type="button" class="dp-link" data-dp="today" ${allowed(todayIso()) ? "" : "disabled"}>Сегодня</button>
        ${input.required ? "" : `<button type="button" class="dp-link muted" data-dp="clear">Очистить</button>`}
      </div>`;
    position();
  }

  function position() {
    if (!pop || !input) return;
    if (!input.isConnected) {
      close();
      return;
    }
    const anchor = input.getBoundingClientRect();
    const w = pop.offsetWidth;
    const h = pop.offsetHeight;
    let left = Math.min(Math.max(8, anchor.left), window.innerWidth - w - 8);
    let top = anchor.bottom + 4;
    if (top + h > window.innerHeight - 8 && anchor.top - h - 4 >= 8) top = anchor.top - h - 4;
    top = Math.max(8, Math.min(top, window.innerHeight - h - 8));
    pop.style.left = `${Math.round(left)}px`;
    pop.style.top = `${Math.round(top)}px`;
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
    mode = "days";
    cursor = el.value || todayIso();
    setView(cursor);
    ensurePop().classList.add("open");
    render();
  }

  function close() {
    if (pop) pop.classList.remove("open");
    input = null;
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
      const total = viewY * 12 + viewM + dir;
      viewY = Math.floor(total / 12);
      viewM = total - viewY * 12;
    }
    render();
  }

  function onPopClick(e) {
    const btn = e.target.closest("button");
    if (!btn || btn.disabled || !input) return;
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
