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

