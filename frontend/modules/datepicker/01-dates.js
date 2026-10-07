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


/* bundle-seam */
})();
