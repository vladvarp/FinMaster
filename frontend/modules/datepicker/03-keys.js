/* bundle-seam */
(function () {
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
