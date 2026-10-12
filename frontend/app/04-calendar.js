  /* ==== Календарь работ ==== */
  const CALENDAR_MODES = ["timeline", "classic", "extended"];
  const CALENDAR_FILTERS = [
    ["all", "Все"],
    ["now", "Идёт сейчас"],
    ["planned", "Запланированы"],
    ["done", "Завершены"],
    ["nodate", "Без дат"],
  ];
  const RU_MONTHS_GEN = ["января", "февраля", "марта", "апреля", "мая", "июня", "июля", "августа", "сентября", "октября", "ноября", "декабря"];
  const RU_MONTHS_NOM = ["Январь", "Февраль", "Март", "Апрель", "Май", "Июнь", "Июль", "Август", "Сентябрь", "Октябрь", "Ноябрь", "Декабрь"];
  const RU_WEEKDAYS = ["пн", "вт", "ср", "чт", "пт", "сб", "вс"];
  const RU_WEEKDAYS_FULL = ["понедельник", "вторник", "среда", "четверг", "пятница", "суббота", "воскресенье"];
  const WORK_STATUS = {
    nodate: { label: "без дат", tone: "mute" },
    planned: { label: "запланирован", tone: "wait" },
    now: { label: "идёт сейчас", tone: "now" },
    done: { label: "завершён", tone: "ok" },
    overdue: { label: "просрочен", tone: "warn" },
    cancelled: { label: "снят", tone: "mute" },
    paused: { label: "На паузе", tone: "pause" },
  };
  const CAL_HOT_LOAD = 4;
  const TL_MIN_DAYS = 3;
  const TL_DEFAULT_DAYS = 21;
  const CAL_BAR_PAID = "#059669";
  const CAL_BAR_DEBT = "#d97706";
  const CAL_BAR_DUE = "#dc2626";
  const CAL_BAR_PLANNED = "#0284c8";
  const CAL_COLOR_GROUPS = [
    {
      title: "Линии",
      hint: "Полосы заказов и позиций",
      items: [
        ["paid", "Оплачено"],
        ["debt", "Долг"],
        ["due", "Закрыт с долгом"],
        ["planned", "Запланировано"],
        ["work", "В работе"],
        ["live", "Выполняется"],
        ["finished", "Завершено"],
        ["stripe", "Штрих паузы"],
      ],
    },
    {
      title: "Статусы",
      hint: "Подписи таймлайна и роли недели",
      items: [
        ["edge", "Старт и финиш"],
        ["now", "Выполняется"],
        ["was", "Выполнялось"],
        ["plan", "План"],
        ["pause", "Пауза"],
      ],
    },
  ];
  const CAL_COLOR_KEYS = CAL_COLOR_GROUPS.flatMap((group) => group.items.map(([key]) => key));
  const CAL_SWATCHES = {
    light: ["#166534", "#15803d", "#059669", "#0f766e", "#0d9488", "#155e75", "#1d4ed8", "#0369a1", "#0284c8", "#0891b2", "#4f46e5", "#6d28d9", "#7c3aed", "#a16207", "#b45309", "#d97706", "#c2410c", "#9a3412", "#b91c1c", "#dc2626", "#be123c", "#9d174d", "#334155", "#475569"],
    dark: ["#4ade80", "#86efac", "#34d399", "#2dd4bf", "#5eead4", "#67e8f9", "#7dd3fc", "#38bdf8", "#22d3ee", "#93c5fd", "#a5b4fc", "#c4b5fd", "#e9d5ff", "#fde68a", "#fbbf24", "#fcd34d", "#fdba74", "#fb923c", "#fca5a5", "#f87171", "#fda4af", "#f9a8d4", "#e2e8f0", "#cbd5e1"],
  };
  function calPalette(partial) {
    const base = {
      paid: CAL_BAR_PAID,
      debt: CAL_BAR_DEBT,
      due: CAL_BAR_DUE,
      planned: CAL_BAR_PLANNED,
      work: "#0f766e",
      live: "#0369a1",
      finished: "#166534",
      stripe: "#64748b",
      edge: "#15803d",
      now: "#0369a1",
      was: "#4f46e5",
      plan: "#b45309",
      pause: "#dc2626",
    };
    const out = Object.assign(base, partial || {});
    if (partial && partial.live == null && partial.now) out.live = partial.now;
    return out;
  }
  const CAL_COLOR_PRESETS = [
    {
      id: "current",
      name: "Текущая",
      light: calPalette(),
      dark: calPalette({
        stripe: "#94a3b8",
        finished: "#86efac",
        edge: "#4ade80",
        now: "#7dd3fc",
        was: "#a5b4fc",
        plan: "#fbbf24",
        pause: "#f87171",
      }),
    },
    {
      id: "sea",
      name: "Море",
      light: calPalette({ paid: "#0d9488", planned: "#0891b2", work: "#0e7490", edge: "#0f766e", now: "#0369a1", was: "#1d4ed8", plan: "#0e7490", pause: "#be123c" }),
      dark: calPalette({ paid: "#2dd4bf", debt: "#fbbf24", due: "#fb7185", planned: "#38bdf8", work: "#67e8f9", finished: "#86efac", edge: "#5eead4", now: "#7dd3fc", was: "#93c5fd", plan: "#22d3ee", pause: "#fda4af" }),
    },
    {
      id: "forest",
      name: "Лес",
      light: calPalette({ paid: "#15803d", debt: "#a16207", due: "#b45309", planned: "#4d7c0f", work: "#166534", edge: "#166534", now: "#3f6212", was: "#4d7c0f", plan: "#65a30d", pause: "#9f1239" }),
      dark: calPalette({ paid: "#4ade80", debt: "#fcd34d", due: "#fdba74", planned: "#bef264", work: "#86efac", finished: "#bbf7d0", edge: "#86efac", now: "#bbf7d0", was: "#d9f99d", plan: "#bef264", pause: "#fda4af" }),
    },
    {
      id: "sunset",
      name: "Закат",
      light: calPalette({ paid: "#ea580c", debt: "#a16207", due: "#9f1239", planned: "#d97706", work: "#c2410c", finished: "#9a3412", edge: "#b45309", now: "#c2410c", was: "#9a3412", plan: "#d97706", pause: "#be123c" }),
      dark: calPalette({ paid: "#fb923c", debt: "#fbbf24", due: "#fb7185", planned: "#fcd34d", work: "#fdba74", finished: "#fed7aa", edge: "#fdba74", now: "#fb923c", was: "#fcd34d", plan: "#fde68a", pause: "#fda4af" }),
    },
    {
      id: "ink",
      name: "Чернила",
      light: calPalette({ paid: "#4f46e5", debt: "#7c3aed", planned: "#4338ca", work: "#3730a3", edge: "#4f46e5", now: "#4338ca", was: "#6d28d9", plan: "#7c3aed", pause: "#be123c" }),
      dark: calPalette({ paid: "#a5b4fc", debt: "#c4b5fd", due: "#fda4af", planned: "#818cf8", work: "#c7d2fe", finished: "#e0e7ff", edge: "#c4b5fd", now: "#a5b4fc", was: "#ddd6fe", plan: "#c4b5fd", pause: "#fda4af" }),
    },
    {
      id: "berry",
      name: "Ягода",
      light: calPalette({ paid: "#be123c", debt: "#a21caf", due: "#881337", planned: "#db2777", work: "#9f1239", edge: "#be123c", now: "#9d174d", was: "#a21caf", plan: "#db2777", pause: "#881337" }),
      dark: calPalette({ paid: "#fb7185", debt: "#f0abfc", due: "#fda4af", planned: "#f472b6", work: "#fb7185", finished: "#fecdd3", edge: "#fda4af", now: "#f9a8d4", was: "#e9d5ff", plan: "#f472b6", pause: "#fecdd3" }),
    },
    {
      id: "sand",
      name: "Песок",
      light: calPalette({ paid: "#a16207", debt: "#92400e", due: "#9a3412", planned: "#b45309", work: "#78716c", edge: "#a16207", now: "#92400e", was: "#57534e", plan: "#b45309", pause: "#9f1239" }),
      dark: calPalette({ paid: "#fcd34d", debt: "#fbbf24", due: "#fdba74", planned: "#fde68a", work: "#d6d3d1", finished: "#e7e5e4", edge: "#fde68a", now: "#fcd34d", was: "#e7e5e4", plan: "#fbbf24", pause: "#fda4af" }),
    },
    {
      id: "north",
      name: "Север",
      light: calPalette({ paid: "#0369a1", debt: "#475569", due: "#b91c1c", planned: "#0284c8", work: "#334155", edge: "#0369a1", now: "#075985", was: "#334155", plan: "#0284c8", pause: "#b91c1c" }),
      dark: calPalette({ paid: "#7dd3fc", debt: "#cbd5e1", due: "#fca5a5", planned: "#38bdf8", work: "#e2e8f0", finished: "#f8fafc", edge: "#7dd3fc", now: "#bae6fd", was: "#cbd5e1", plan: "#7dd3fc", pause: "#fca5a5" }),
    },
    {
      id: "contrast",
      name: "Контраст",
      light: calPalette({ paid: "#059669", debt: "#d97706", due: "#dc2626", planned: "#2563eb", work: "#0f766e", edge: "#15803d", now: "#1d4ed8", was: "#6d28d9", plan: "#a16207", pause: "#be123c" }),
      dark: calPalette({ paid: "#34d399", debt: "#fbbf24", due: "#f87171", planned: "#60a5fa", work: "#2dd4bf", finished: "#86efac", edge: "#4ade80", now: "#93c5fd", was: "#c4b5fd", plan: "#fde68a", pause: "#fb7185" }),
    },
  ];
  let calColorSlot = "paid";
  let calColorTheme = "";
  let calColorName = "";

  const CAL_DEBT_ALPHA = 0.4;

  function calHex(value, fallback) {
    const hex = String(value || "").trim().toLowerCase();
    return /^#[0-9a-f]{6}$/.test(hex) ? hex : fallback;
  }

  function colorRgb(value) {
    const hex = String(value || "").trim().toLowerCase();
    return /^#[0-9a-f]{6}/.test(hex) ? hex.slice(0, 7) : "";
  }

  function colorAlpha(value) {
    const hex = String(value || "").trim().toLowerCase();
    if (/^#[0-9a-f]{8}$/.test(hex)) return parseInt(hex.slice(7, 9), 16) / 255;
    return 1;
  }

  function alphaByte(alpha) {
    const n = Math.max(0, Math.min(1, Number(alpha)));
    return Math.round((Number.isFinite(n) ? n : 1) * 255).toString(16).padStart(2, "0");
  }

  function packCalColor(rgb, alpha) {
    return `${calHex(rgb, "#000000")}${alphaByte(alpha)}`;
  }

  function slotAlpha(key) {
    if (key === "debt") return CAL_DEBT_ALPHA;
    if (key === "stripe") return 0.55;
    return 1;
  }

  function parseCalColor(value, key, fallback) {
    const raw = String(value || "").trim().toLowerCase();
    const fb = calHex(fallback, "#64748b");
    if (/^#[0-9a-f]{8}$/.test(raw)) return raw;
    if (/^#[0-9a-f]{6}$/.test(raw)) return packCalColor(raw, slotAlpha(key));
    return packCalColor(fb, slotAlpha(key));
  }

  function calPreset(id) {
    return CAL_COLOR_PRESETS.find((item) => item.id === id) || CAL_COLOR_PRESETS[0];
  }

  function blankCalSide() {
    return { id: "current", colors: null };
  }

  function normalizeCalSide(raw) {
    const side = raw && typeof raw === "object" ? raw : {};
    const preset = calPreset(side.id);
    const customOk = String(side.id || "").startsWith("c_");
    const id = customOk ? String(side.id) : preset.id;
    if (!side.colors || typeof side.colors !== "object") return { id, colors: null };
    const colors = {};
    const base = preset.light;
    CAL_COLOR_KEYS.forEach((key) => {
      colors[key] = parseCalColor(side.colors[key], key, base[key]);
    });
    return { id, colors };
  }

  function defaultCalColorStore() {
    return { light: blankCalSide(), dark: blankCalSide(), custom: [] };
  }

  function normalizeCalColorStore(raw) {
    const store = defaultCalColorStore();
    if (!raw || typeof raw !== "object") return store;
    store.light = normalizeCalSide(raw.light);
    store.dark = normalizeCalSide(raw.dark);
    const custom = Array.isArray(raw.custom) ? raw.custom : [];
    store.custom = custom.slice(0, 24).map((item) => {
      const id = String(item?.id || "");
      if (!id.startsWith("c_")) return null;
      const name = String(item.name || "Своя").trim().slice(0, 32) || "Своя";
      const light = {};
      const dark = {};
      CAL_COLOR_KEYS.forEach((key) => {
        light[key] = parseCalColor(item.light?.[key], key, calPreset("current").light[key]);
        dark[key] = parseCalColor(item.dark?.[key], key, calPreset("current").dark[key]);
      });
      return { id, name, light, dark };
    }).filter(Boolean);
    ["light", "dark"].forEach((theme) => {
      const id = store[theme].id;
      if (id.startsWith("c_") && !store.custom.some((item) => item.id === id)) store[theme] = blankCalSide();
    });
    return store;
  }

  function readCalColorStore() {
    try {
      return normalizeCalColorStore(JSON.parse(localStorage.getItem(LS_CAL_COLORS) || "null"));
    } catch {
      return defaultCalColorStore();
    }
  }

  function writeCalColorStore(store, { now = true } = {}) {
    persistPref(LS_CAL_COLORS, JSON.stringify(normalizeCalColorStore(store)), { now });
  }

  function hexToRgb(hex) {
    const h = (colorRgb(hex) || "#000000").slice(1);
    return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
  }

  function rgbToHex(r, g, b) {
    const c = (n) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, "0");
    return `#${c(r)}${c(g)}${c(b)}`;
  }

  function rgbToHsv(r, g, b) {
    const rn = r / 255;
    const gn = g / 255;
    const bn = b / 255;
    const max = Math.max(rn, gn, bn);
    const min = Math.min(rn, gn, bn);
    const d = max - min;
    let h = 0;
    if (d) {
      if (max === rn) h = ((gn - bn) / d) % 6;
      else if (max === gn) h = (bn - rn) / d + 2;
      else h = (rn - gn) / d + 4;
      h *= 60;
      if (h < 0) h += 360;
    }
    return { h, s: max === 0 ? 0 : d / max, v: max };
  }

  function hsvToHex(h, s, v) {
    const hue = ((h % 360) + 360) % 360;
    const c = v * s;
    const x = c * (1 - Math.abs((hue / 60) % 2 - 1));
    const m = v - c;
    let r = 0;
    let g = 0;
    let b = 0;
    if (hue < 60) [r, g, b] = [c, x, 0];
    else if (hue < 120) [r, g, b] = [x, c, 0];
    else if (hue < 180) [r, g, b] = [0, c, x];
    else if (hue < 240) [r, g, b] = [0, x, c];
    else if (hue < 300) [r, g, b] = [x, 0, c];
    else [r, g, b] = [c, 0, x];
    return rgbToHex((r + m) * 255, (g + m) * 255, (b + m) * 255);
  }

  let calPickerDrag = null;
  let calPickerBlockClick = false;
  let calColorDrag = null;
  let calColorPos = null;

  function paintCalSlot(hex, { now = true, theme = calColorEditorTheme(), key = calColorSlot, alpha = null } = {}) {
    const rgb = calHex(String(hex || "").slice(0, 7), "");
    if (!rgb) return "";
    const store = readCalColorStore();
    const mode = theme === "dark" ? "dark" : "light";
    const next = resolvedCalColors(mode);
    const prevA = colorAlpha(next[key]);
    const a = alpha == null ? prevA : Math.max(0, Math.min(1, Number(alpha)));
    const clean = packCalColor(rgb, Number.isFinite(a) ? a : prevA);
    next[key] = clean;
    store[mode] = { id: store[mode].id, colors: next };
    writeCalColorStore(store, { now });
    applyCalColors();
    return clean;
  }

  function syncCalPicker(hex) {
    const hsv = rgbToHsv(...hexToRgb(hex));
    const sv = document.querySelector("#cal-color-menu [data-cal-sv]");
    const hueBar = document.querySelector("#cal-color-menu [data-cal-hue]");
    if (sv) {
      sv.style.backgroundColor = `hsl(${hsv.h} 100% 50%)`;
      const dot = sv.querySelector("i");
      if (dot) {
        dot.style.left = `${hsv.s * 100}%`;
        dot.style.top = `${(1 - hsv.v) * 100}%`;
      }
    }
    if (hueBar) {
      const knob = hueBar.querySelector("i");
      if (knob) knob.style.left = `${(hsv.h / 360) * 100}%`;
    }
    const rgb = colorRgb(hex) || hex;
    const input = $("cal-color-hex");
    if (input && document.activeElement !== input) input.value = rgb;
    const row = document.querySelector(`#cal-color-menu [data-cal-color-slot="${calColorSlot}"] > i`);
    if (row) row.style.setProperty("--swatch", hex);
    const chip = document.querySelector("#cal-color-menu .cal-picker-hex > i");
    if (chip) chip.style.setProperty("--swatch", hex);
    const alphaBar = document.querySelector("#cal-color-menu [data-cal-alpha]");
    if (alphaBar) {
      alphaBar.style.setProperty("--pick", rgb);
      const knob = alphaBar.querySelector("i");
      if (knob) knob.style.left = `${colorAlpha(hex) * 100}%`;
    }
    const pct = $("cal-color-alpha");
    if (pct) pct.textContent = `${Math.round(colorAlpha(hex) * 100)}%`;
    document.querySelectorAll("#cal-color-menu .cal-swatch").forEach((btn) => {
      btn.classList.toggle("is-on", btn.dataset.calColorSwatch === rgb);
    });
  }

  function pickerRatio(el, e) {
    const rect = el.getBoundingClientRect();
    const x = rect.width ? (e.clientX - rect.left) / rect.width : 0;
    const y = rect.height ? (e.clientY - rect.top) / rect.height : 0;
    return { x: Math.max(0, Math.min(1, x)), y: Math.max(0, Math.min(1, y)) };
  }

  function placeCalColorMenu() {
    const menu = $("cal-color-menu");
    if (!menu || !calColorPos) return;
    const w = menu.offsetWidth || 770;
    const h = menu.offsetHeight || 320;
    const x = Math.max(8, Math.min(window.innerWidth - w - 8, calColorPos.x));
    const y = Math.max(8, Math.min(window.innerHeight - h - 8, calColorPos.y));
    calColorPos = { x, y };
    menu.style.position = "fixed";
    menu.style.right = "auto";
    menu.style.left = `${x}px`;
    menu.style.top = `${y}px`;
    menu.style.zIndex = "40";
  }

  function onCalColorHeadDown(e) {
    const head = e.target.closest(".cal-color-head");
    if (!head || !head.closest("#cal-color-menu") || e.target.closest("button, input, a")) return false;
    const menu = $("cal-color-menu");
    if (!menu) return false;
    const rect = menu.getBoundingClientRect();
    calColorDrag = { dx: e.clientX - rect.left, dy: e.clientY - rect.top };
    menu.classList.add("is-moving");
    e.preventDefault();
    e.stopPropagation();
    return true;
  }

  function moveCalPicker(e) {
    if (calColorDrag) {
      calColorPos = { x: e.clientX - calColorDrag.dx, y: e.clientY - calColorDrag.dy };
      placeCalColorMenu();
      return;
    }
    if (!calPickerDrag) return;
    const currentHex = resolvedCalColors(calColorEditorTheme())[calColorSlot];
    const current = rgbToHsv(...hexToRgb(currentHex));
    let hex = "";
    let alpha = null;
    if (calPickerDrag.kind === "sv") {
      const el = document.querySelector("#cal-color-menu [data-cal-sv]");
      if (!el) return;
      const { x, y } = pickerRatio(el, e);
      hex = hsvToHex(current.h, x, 1 - y);
    } else if (calPickerDrag.kind === "hue") {
      const el = document.querySelector("#cal-color-menu [data-cal-hue]");
      if (!el) return;
      const { x } = pickerRatio(el, e);
      hex = hsvToHex(x * 359.99, current.s || 1, current.v === 0 ? 1 : current.v);
    } else {
      const el = document.querySelector("#cal-color-menu [data-cal-alpha]");
      if (!el) return;
      alpha = pickerRatio(el, e).x;
      hex = colorRgb(currentHex) || "#000000";
    }
    const clean = paintCalSlot(hex, { now: false, alpha });
    if (clean) syncCalPicker(clean);
  }

  function onCalPickerDown(e) {
    const sv = e.target.closest("[data-cal-sv]");
    const hueBar = e.target.closest("[data-cal-hue]");
    const alphaBar = e.target.closest("[data-cal-alpha]");
    if (!sv && !hueBar && !alphaBar) return;
    e.preventDefault();
    e.stopPropagation();
    calPickerDrag = { kind: sv ? "sv" : hueBar ? "hue" : "alpha" };
    try {
      (sv || hueBar || alphaBar).setPointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
    moveCalPicker(e);
  }

  function onCalPickerUp() {
    if (calColorDrag) {
      calColorDrag = null;
      $("cal-color-menu")?.classList.remove("is-moving");
      calPickerBlockClick = true;
      return;
    }
    if (!calPickerDrag) return;
    calPickerDrag = null;
    calPickerBlockClick = true;
    writeCalColorStore(readCalColorStore(), { now: true });
    renderCalendar();
  }

  function calProfile(store, id) {
    return store.custom.find((item) => item.id === id) || calPreset(id);
  }

  function resolvedCalColors(theme) {
    const mode = theme === "dark" ? "dark" : "light";
    const store = readCalColorStore();
    const side = store[mode];
    const profile = calProfile(store, side.id);
    const base = profile[mode] || profile.light;
    const raw = side.colors ? Object.assign({}, base, side.colors) : base;
    const out = {};
    const builtin = (calPreset("current")[mode] || calPreset("current").light);
    CAL_COLOR_KEYS.forEach((key) => {
      out[key] = parseCalColor(raw[key], key, base[key] || builtin[key]);
    });
    return out;
  }

  function calPaint(key) {
    return resolvedCalColors(currentTheme())[key] || calPreset("current").light[key];
  }

  function applyCalColors() {
    const colors = resolvedCalColors(currentTheme());
    CAL_COLOR_KEYS.forEach((key) => {
      document.documentElement.style.setProperty(`--cal-${key}`, colors[key]);
    });
  }

  function calColorEditorTheme() {
    return calColorTheme === "dark" || calColorTheme === "light" ? calColorTheme : currentTheme();
  }

  function paintCalColor(theme, key, hex) {
    paintCalSlot(hex, { theme, key });
  }

  function assignCalProfile(theme, id) {
    const store = readCalColorStore();
    const mode = theme === "dark" ? "dark" : "light";
    if (id.startsWith("c_") && !store.custom.some((item) => item.id === id)) return;
    if (!id.startsWith("c_") && !CAL_COLOR_PRESETS.some((item) => item.id === id)) return;
    store[mode] = { id, colors: null };
    writeCalColorStore(store);
    applyCalColors();
  }

  function saveCalProfile(name) {
    const title = String(name || "").trim().slice(0, 32);
    if (!title) return "";
    const store = readCalColorStore();
    const profile = {
      id: `c_${uid().replace(/-/g, "").slice(0, 8)}`,
      name: title,
      light: resolvedCalColors("light"),
      dark: resolvedCalColors("dark"),
    };
    store.custom.push(profile);
    const mode = calColorEditorTheme();
    store[mode] = { id: profile.id, colors: null };
    writeCalColorStore(store);
    applyCalColors();
    calColorName = "";
    return profile.id;
  }

  function updateCalProfile(id) {
    const store = readCalColorStore();
    const profile = store.custom.find((item) => item.id === id);
    if (!profile) return false;
    profile.light = resolvedCalColors("light");
    profile.dark = resolvedCalColors("dark");
    ["light", "dark"].forEach((theme) => {
      if (store[theme].id === id) store[theme] = { id, colors: null };
    });
    writeCalColorStore(store);
    applyCalColors();
    return true;
  }

  function deleteCalProfile(id) {
    const store = readCalColorStore();
    store.custom = store.custom.filter((item) => item.id !== id);
    ["light", "dark"].forEach((theme) => {
      if (store[theme].id === id) store[theme] = blankCalSide();
    });
    writeCalColorStore(store);
    applyCalColors();
  }

  function resetCalTheme(theme) {
    const store = readCalColorStore();
    const mode = theme === "dark" ? "dark" : "light";
    store[mode] = { id: store[mode].id, colors: null };
    writeCalColorStore(store);
    applyCalColors();
  }

  function calColorMenuHtml() {
    if (!CAL_COLOR_KEYS.includes(calColorSlot)) calColorSlot = "finished";
    const store = readCalColorStore();
    const theme = calColorEditorTheme();
    const side = store[theme];
    const colors = resolvedCalColors(theme);
    const swatches = CAL_SWATCHES[theme];
    const edited = !!side.colors;
    const customOn = side.id.startsWith("c_");
    const profileBtn = (item) => {
      const ink = item[theme] || item.light;
      const on = side.id === item.id;
      const dots = ["paid", "now", "pause"].map((key) => `<i style="--swatch:${esc(ink[key])}"></i>`).join("");
      return `<button type="button" class="cal-color-profile ${on ? "is-on" : ""}" data-cal-color-profile="${esc(item.id)}" title="${esc(item.name)}">
        <span class="cal-color-dots">${dots}</span><b>${esc(item.name)}</b>
      </button>`;
    };
    const rows = CAL_COLOR_GROUPS.map((group) => {
      const lines = group.items.map(([key, label]) => `<button type="button" class="cal-color-row ${calColorSlot === key ? "is-on" : ""}" data-cal-color-slot="${key}">
          <i style="--swatch:${esc(colors[key])}"></i><span>${esc(label)}</span>
        </button>`).join("");
      return `<section class="cal-color-block">
        <div class="cal-color-block-h"><b>${esc(group.title)}</b><button type="button" class="cal-color-info" title="${esc(group.hint)}" aria-label="${esc(group.hint)}">i</button></div>
        <div class="cal-color-rows">${lines}</div>
      </section>`;
    }).join("");
    const palette = swatches.map((hex) => `<button type="button" class="cal-swatch ${colorRgb(colors[calColorSlot]) === hex ? "is-on" : ""}" data-cal-color-swatch="${hex}" style="background:${hex}" title="${hex}" aria-label="${hex}"></button>`).join("");
    const slotColor = colors[calColorSlot];
    const slotRgb = colorRgb(slotColor) || "#000000";
    const slotAlpha = colorAlpha(slotColor);
    const hsv = rgbToHsv(...hexToRgb(slotColor));
    const slotName = CAL_COLOR_GROUPS.flatMap((group) => group.items).find(([key]) => key === calColorSlot)?.[1] || "";
    const custom = store.custom.length
      ? `<div class="cal-color-profiles is-custom">${store.custom.map((item) => `<span class="cal-color-custom ${side.id === item.id ? "is-on" : ""}">
          ${profileBtn(item)}
          <button type="button" class="cal-color-x" data-cal-color-del="${esc(item.id)}" title="Удалить профиль" aria-label="Удалить профиль">×</button>
        </span>`).join("")}</div>`
      : "";
    const note = theme === currentTheme()
      ? "Эта схема сейчас на экране."
      : "Включится вместе со " + (theme === "dark" ? "тёмной темой." : "светлой темой.");
    return `<div class="cal-color-head">
        <div class="cal-color-title" title="Перетащите, чтобы передвинуть окно">
          <b>Цвета календаря</b>
          <span class="cal-color-note">${note}</span>
        </div>
        <div class="cal-color-head-side">
          <div class="cal-color-themes" role="tablist">
            <button type="button" class="${theme === "light" ? "is-on" : ""}" data-cal-color-theme="light">Светлая</button>
            <button type="button" class="${theme === "dark" ? "is-on" : ""}" data-cal-color-theme="dark">Тёмная</button>
          </div>
          <button type="button" class="cal-color-x" data-cal-color-close title="Закрыть" aria-label="Закрыть">×</button>
        </div>
      </div>
      <section class="cal-color-block">
        <div class="cal-color-block-h"><b>Профили</b><span>9 встроенных и свои</span></div>
        <div class="cal-color-profiles">${CAL_COLOR_PRESETS.map(profileBtn).join("")}</div>
        ${custom}
        <div class="cal-color-save">
          <input id="cal-color-name" class="cal-color-name" maxlength="32" placeholder="Имя новой схемы" value="${esc(calColorName)}" spellcheck="false" />
          <button type="button" class="btn small" data-cal-color-save>Сохранить</button>
          ${customOn ? `<button type="button" class="btn small" data-cal-color-update="${esc(side.id)}">Обновить</button>` : ""}
          ${edited ? `<button type="button" class="btn small" data-cal-color-reset>Вернуть</button>` : ""}
        </div>
      </section>
      <div class="cal-color-stage">
        ${rows}
        <section class="cal-color-block cal-color-editor">
          <div class="cal-color-block-h"><b>Свой цвет</b><span>${esc(slotName)}</span></div>
          <div class="cal-picker">
            <div class="cal-picker-sv" data-cal-sv style="background-color:hsl(${hsv.h} 100% 50%)">
              <i style="left:${hsv.s * 100}%;top:${(1 - hsv.v) * 100}%"></i>
            </div>
            <div class="cal-picker-hue" data-cal-hue>
              <i style="left:${(hsv.h / 360) * 100}%"></i>
            </div>
            <div class="cal-picker-alpha" data-cal-alpha style="--pick:${esc(slotRgb)}">
              <i style="left:${slotAlpha * 100}%"></i>
            </div>
            <label class="cal-picker-hex">
              <i style="--swatch:${esc(slotColor)}"></i>
              <input id="cal-color-hex" maxlength="9" spellcheck="false" value="${esc(slotRgb)}" aria-label="Код цвета" />
              <b id="cal-color-alpha">${Math.round(slotAlpha * 100)}%</b>
            </label>
          </div>
        </section>
      </div>
      <section class="cal-color-block">
        <div class="cal-color-block-h"><b>Образцы</b><span>быстрый выбор для «${esc(slotName)}»</span></div>
        <div class="cal-swatches">${palette}</div>
      </section>`;
  }
  const LINE_DRAG_HORIZON_DAYS = 730;
  const DEFAULT_WEEKENDS = [5, 6];
  let calDrag = null;
  let calNav = null;
  let calSkipClick = false;

  function mondayOf(d) {
    const x = dayStart(d);
    return addDays(x, -((x.getDay() + 6) % 7));
  }

  function rangeDays(from, to) {
    const days = [];
    for (let d = dayStart(from); d <= to; d = addDays(d, 1)) days.push(d);
    return days;
  }

  function weekdayIndex(d) {
    return (d.getDay() + 6) % 7;
  }

  function normalizeWeekends(raw) {
    if (!Array.isArray(raw)) return DEFAULT_WEEKENDS.slice();
    const out = [];
    raw.forEach((v) => {
      const n = Number(v);
      if (Number.isInteger(n) && n >= 0 && n <= 6 && !out.includes(n)) out.push(n);
    });
    return out.sort((a, b) => a - b);
  }

  function normalizeDayList(raw) {
    if (!Array.isArray(raw)) return [];
    const out = [];
    raw.forEach((v) => {
      const key = dateDay(v);
      if (/^\d{4}-\d{2}-\d{2}$/.test(key) && !out.includes(key)) out.push(key);
    });
    return out.sort();
  }

  function calendarOffSettings() {
    const saved = ensureUi().calendar || {};
    const weekends = "weekends" in saved ? normalizeWeekends(saved.weekends) : DEFAULT_WEEKENDS.slice();
    const workDays = normalizeDayList(saved.work_days);
    const workSet = new Set(workDays);
    const offDays = normalizeDayList(saved.off_days).filter((key) => !workSet.has(key));
    return { weekends, offDays, workDays };
  }

  function pruneOffLists(weekends, offDays, workDays) {
    const off = offDays.filter((key) => {
      const d = parseDay(key);
      return d && !weekends.includes(weekdayIndex(d));
    });
    const work = workDays.filter((key) => {
      const d = parseDay(key);
      return d && weekends.includes(weekdayIndex(d));
    });
    return { offDays: off, workDays: work };
  }

  function writeCalendarOff({ weekends, offDays, workDays } = {}) {
    const cur = calendarOffSettings();
    const nextW = weekends ?? cur.weekends;
    const pruned = pruneOffLists(nextW, offDays ?? cur.offDays, workDays ?? cur.workDays);
    const ui = ensureUi();
    ui.calendar = {
      ...(ui.calendar || {}),
      weekends: nextW,
      off_days: pruned.offDays,
      work_days: pruned.workDays,
    };
  }

  function isWeekend(d) {
    const tone = dayToneClass(d);
    return tone === "is-weekend" || tone === "is-off-day";
  }

  function isGlobalWeekend(d) {
    const off = calendarOffSettings();
    if (off.workDays.includes(dayKey(d))) return false;
    return off.weekends.includes(weekdayIndex(d));
  }

  function dayToneClass(d) {
    const key = dayKey(d);
    const off = calendarOffSettings();
    if (off.workDays.includes(key)) return "is-work-day";
    if (off.offDays.includes(key)) return "is-off-day";
    if (off.weekends.includes(weekdayIndex(d))) return "is-weekend";
    return "";
  }

  function calendarDayNotes() {
    const raw = ensureUi().calendar?.day_notes;
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
    const out = {};
    Object.keys(raw).forEach((key) => {
      const day = dateDay(key);
      const text = String(raw[key] || "").trim();
      if (/^\d{4}-\d{2}-\d{2}$/.test(day) && text) out[day] = text.slice(0, 2000);
    });
    return out;
  }

  function dayNote(d) {
    return calendarDayNotes()[typeof d === "string" ? d : dayKey(d)] || "";
  }

  function setDayNote(key, text) {
    if (!key) return;
    const notes = calendarDayNotes();
    const clean = String(text || "").trim().slice(0, 2000);
    if (clean) notes[key] = clean;
    else delete notes[key];
    const ui = ensureUi();
    ui.calendar = { ...(ui.calendar || {}), day_notes: notes };
    persistCalendar();
    markDirty();
  }

  function calFmtDay(d, withYear = false) {
    const text = `${d.getDate()} ${RU_MONTHS_GEN[d.getMonth()]}`;
    return withYear ? `${text} ${d.getFullYear()}` : text;
  }

  function calFmtRange(from, to) {
    if (from.getFullYear() === to.getFullYear() && from.getMonth() === to.getMonth()) {
      return `${from.getDate()}–${calFmtDay(to, true)}`;
    }
    if (from.getFullYear() === to.getFullYear()) {
      return `${calFmtDay(from)} — ${calFmtDay(to, true)}`;
    }
    return `${calFmtDay(from, true)} — ${calFmtDay(to, true)}`;
  }

  function orderIsOff(order) {
    const income = (order.lines || []).filter((line) => !isFrozenLine(line) && !isExpenseLine(line));
    if (!income.length) return false;
    return income.every((line) => /отмен|аннул|черн/i.test(line.status || ""));
  }

  function workPauses(order) {
    return Array.isArray(order?.work_pauses) ? order.work_pauses : [];
  }

  function pauseIsOpen(order, pause) {
    if (!pause || dateDay(order.work_end)) return false;
    if (pause.open) return true;
    const till = dateDay(pause.end);
    if (!till) return !!dateDay(pause.start);
    return false;
  }

  function pauseEndKey(order, pause, today = dayStart(new Date())) {
    if (pauseIsOpen(order, pause)) {
      const startKey = dateDay(pause.start);
      const todayKey = dayKey(today);
      // Пауза со следующего дня рисуется одним днём у края полосы, стрелка значит «и дальше».
      if (startKey && startKey > todayKey) return startKey;
      return todayKey;
    }
    return dateDay(pause?.end);
  }

  function previousWorkDay(day) {
    const start = day instanceof Date ? dayStart(day) : parseDay(day);
    if (!start) return null;
    let d = addDays(start, -1);
    const cap = addDays(start, -21);
    while (d >= cap && isWeekend(d)) d = addDays(d, -1);
    return d >= cap && !isWeekend(d) ? d : null;
  }

  function followingWorkDay(day) {
    const start = day instanceof Date ? dayStart(day) : parseDay(day);
    if (!start) return null;
    let d = addDays(start, 1);
    const cap = addDays(start, 21);
    while (d <= cap && isWeekend(d)) d = addDays(d, 1);
    return d <= cap && !isWeekend(d) ? d : null;
  }

  function pauseOnDay(order, day) {
    const key = typeof day === "string" ? String(day).slice(0, 10) : dayKey(dayStart(day));
    const todayKey = dayKey(dayStart(new Date()));
    return workPauses(order).some((pause) => {
      const from = dateDay(pause.start);
      if (!from || key < from) return false;
      // Пауза без конца, которая начинается позже сегодня, закрывает все дни вперёд.
      if (pauseIsOpen(order, pause) && from > todayKey) return true;
      const till = pauseEndKey(order, pause, dayStart(new Date()));
      return !!(till && key <= till);
    });
  }

  /** Выходной не снимает паузу: если последний рабочий день ещё в паузе, выходные тоже. */
  function isPaused(order, day) {
    if (pauseOnDay(order, day)) return true;
    const key = typeof day === "string" ? String(day).slice(0, 10) : dayKey(dayStart(day));
    const d = typeof day === "string" ? parseDay(key) : dayStart(day);
    if (!d || !isWeekend(d)) return false;
    const prev = previousWorkDay(d);
    if (!prev || !pauseOnDay(order, prev)) return false;
    const prevKey = dayKey(prev);
    const resumed = workPauses(order).some((pause) => {
      if (!pause.resumeNext || pauseIsOpen(order, pause)) return false;
      const end = dateDay(pause.end);
      return !!end && end >= prevKey && end <= key;
    });
    return !resumed;
  }

  /** Пауза кончилась до выходного, а Shift уже поставил возобновление со следующего рабочего дня. */
  function carriedResume(order, today) {
    if (!isWeekend(today)) return null;
    const todayKey = dayKey(today);
    const prev = previousWorkDay(today);
    if (!prev) return null;
    const prevKey = dayKey(prev);
    return (
      workPauses(order).find((pause) => {
        if (!pause.resumeNext || pauseIsOpen(order, pause)) return false;
        const end = dateDay(pause.end);
        return !!end && end >= prevKey && end < todayKey;
      }) || null
    );
  }

  function explicitResumePause(order, today) {
    const carried = carriedResume(order, today);
    if (carried) return carried;
    const todayKey = dayKey(today);
    return workPauses(order).find((pause) => pause.resumeNext && dateDay(pause.end) === todayKey && !pauseIsOpen(order, pause)) || null;
  }

  function clampDay(day, min, max) {
    if (min && day < min) day = min;
    if (max && day > max) day = max;
    return day;
  }

  function normalizeWorkPauses(order, merge = true) {
    const start = dateDay(order.work_start);
    const end = dateDay(order.work_end);
    if (!start && !end) {
      order.work_pauses = [];
      return order;
    }
    const envStart = start;
    const envEnd = end || (start ? dayKey(dayStart(new Date())) : "");
    const items = [];
    workPauses(order).forEach((pause) => {
      if (!pause || typeof pause !== "object") return;
      let from = dateDay(pause.start);
      let till = dateDay(pause.end);
      const todayKey = envEnd && !end ? envEnd : dayKey(dayStart(new Date()));
      const explicitEnd = !pause.open && !!dateDay(pause.end);
      const wasOpen = !!(pause.open || !till);
      let open = !end && !explicitEnd && (wasOpen || (till && envEnd && till >= envEnd));
      if (from && till && till < from) [from, till] = [till, from];
      if (!from && !till && !wasOpen) return;
      from = from || till || envStart;
      if (envStart && from < envStart) from = envStart;
      if (open) till = envEnd;
      else {
        if (wasOpen) till = todayKey;
        till = till || from;
        if (envEnd && till > envEnd) till = envEnd;
      }
      if (envStart && till < envStart) return;
      if (envEnd && from > envEnd) {
        if (!end && wasOpen) items.push({ start: from, end: "", open: true });
        return;
      }
      if (from && till && from <= till) {
        const item = open ? { start: from, end: merge ? "" : till, open: true } : { start: from, end: till };
        if (!open && pause.resumeNext) item.resumeNext = true;
        items.push(item);
      }
    });
    items.sort((a, b) => a.start.localeCompare(b.start) || String(a.end || envEnd).localeCompare(String(b.end || envEnd)));
    if (!merge) {
      order.work_pauses = items;
      return order;
    }
    const merged = [];
    items.forEach((pause) => {
      const last = merged[merged.length - 1];
      const lastEndKey = last ? (last.open ? envEnd : last.end) : "";
      const lastEnd = lastEndKey ? parseDay(lastEndKey) : null;
      const nextStart = parseDay(pause.start);
      const futureOpen = !!(pause.open && envEnd && pause.start > envEnd);
      if (!futureOpen && last && lastEnd && nextStart && nextStart <= addDays(lastEnd, 1)) {
        if (pause.open || last.open) {
          last.end = "";
          last.open = true;
          delete last.resumeNext;
        } else if (pause.end > last.end) last.end = pause.end;
        if (!last.open && pause.resumeNext) last.resumeNext = true;
        return;
      }
      const kept = pause.open ? { start: pause.start, end: "", open: true } : { start: pause.start, end: pause.end };
      if (!pause.open && pause.resumeNext) kept.resumeNext = true;
      merged.push(kept);
    });
    order.work_pauses = merged;
    return order;
  }

  function futureOpenPauses(proxy, today) {
    const todayKey = dayKey(today);
    return workPauses(proxy).filter((pause) => pauseIsOpen(proxy, pause) && dateDay(pause.start) > todayKey);
  }

  function toggleLineFromNextDay(proxy) {
    const today = dayStart(new Date());
    if (dateDay(proxy?.work_end)) return "";
    if (workStatus(proxy, today) !== "now") return "";
    const todayKey = dayKey(today);
    if (futureOpenPauses(proxy, today).length) {
      proxy.work_pauses = workPauses(proxy).filter((pause) => !(pauseIsOpen(proxy, pause) && dateDay(pause.start) > todayKey));
      normalizeWorkPauses(proxy);
      return "Пауза со следующего дня снята";
    }
    const carried = carriedResume(proxy, today);
    if (carried) {
      const start = dateDay(carried.start);
      const end = dateDay(carried.end);
      proxy.work_pauses = workPauses(proxy).map((pause) => {
        if (!pause.resumeNext || dateDay(pause.start) !== start || dateDay(pause.end) !== end) return pause;
        return { start: pause.start, end: pause.end };
      });
      normalizeWorkPauses(proxy);
      return "С завтра снова на паузе";
    }
    if (isPaused(proxy, today)) {
      let changed = false;
      proxy.work_pauses = workPauses(proxy).map((pause) => {
        const from = dateDay(pause.start);
        if (!from || from > todayKey) return pause;
        const till = pauseIsOpen(proxy, pause) ? todayKey : dateDay(pause.end);
        if (!till || todayKey < from || todayKey > till) return pause;
        if (pauseIsOpen(proxy, pause)) {
          changed = true;
          return { start: from, end: todayKey, resumeNext: true };
        }
        if (till === todayKey) {
          changed = true;
          return { start: from, end: "", open: true };
        }
        return pause;
      });
      if (!changed && isWeekend(today)) {
        const prev = previousWorkDay(today);
        const prevKey = prev ? dayKey(prev) : "";
        proxy.work_pauses = workPauses(proxy).map((pause) => {
          const from = dateDay(pause.start);
          const till = pauseIsOpen(proxy, pause) ? todayKey : dateDay(pause.end);
          if (!from || !till || !prevKey || prevKey < from || prevKey > till || pause.resumeNext) return pause;
          changed = true;
          return { start: from, end: pauseIsOpen(proxy, pause) ? prevKey : till, resumeNext: true };
        });
      }
      if (!changed) return "";
      normalizeWorkPauses(proxy);
      return isPaused(proxy, addDays(today, 1)) ? "С завтра снова на паузе" : "С завтрашнего дня без паузы";
    }
    let next = addDays(today, 1);
    if (isWeekend(next)) next = followingWorkDay(today) || next;
    proxy.work_pauses = workPauses(proxy).concat({ start: dayKey(next), end: "", open: true });
    normalizeWorkPauses(proxy);
    return "С завтрашнего дня позиция на паузе";
  }

  function addWorkPause(order, day) {
    const span = orderDrawSpan(order);
    const parsed = day instanceof Date ? dayStart(day) : parseDay(day);
    if (!span || !parsed) return false;
    const key = dayKey(parsed);
    if (key < dayKey(span.from) || key > dayKey(span.till)) return false;
    if (isPaused(order, key)) return false;
    order.work_pauses = workPauses(order).concat({ start: key, end: key });
    normalizeWorkPauses(order);
    return true;
  }

  function removePauseCovering(order, day) {
    const key = typeof day === "string" ? String(day).slice(0, 10) : dayKey(dayStart(day));
    const next = workPauses(order).filter((pause) => {
      const from = dateDay(pause.start);
      const till = pauseEndKey(order, pause);
      return !(from && till && key >= from && key <= till);
    });
    if (next.length === workPauses(order).length) return false;
    order.work_pauses = next;
    normalizeWorkPauses(order);
    return true;
  }

  function removePauseAt(order, index) {
    const list = workPauses(order).slice();
    if (index < 0 || index >= list.length) return false;
    list.splice(index, 1);
    order.work_pauses = list;
    normalizeWorkPauses(order);
    return true;
  }

  function pauseInEnvelope(order, day) {
    const span = orderDrawSpan(order);
    const parsed = day instanceof Date ? dayStart(day) : parseDay(day);
    if (!span || !parsed) return false;
    const key = dayKey(parsed);
    return key >= dayKey(span.from) && key <= dayKey(span.till);
  }

  function normalizeWorkDates(order, { mergePauses = true, lines = true } = {}) {
    const start = dateDay(order.work_start);
    const end = dateDay(order.work_end);
    order.work_start = start;
    order.work_end = end;
    if (start && end && end < start) {
      order.work_start = end;
      order.work_end = start;
    }
    const isOrder = Array.isArray(order?.lines);
    if (!order.work_start && !order.work_end) order.work_pauses = [];
    else if (!isOrder) normalizeWorkPauses(order, mergePauses);
    if (lines && isOrder) {
      normalizeOrderLinesWork(order);
      syncOrderPausesFromLines(order);
    }
    return order;
  }

  function calendarWorkLines(order) {
    return (order?.lines || []).filter((line) => !isFrozenLine(line) && !isExpenseLine(line));
  }

  function findCalendarLine(order, lineId) {
    if (!order || !lineId) return null;
    return (order.lines || []).find((line) => line.id === lineId) || null;
  }

  function lineWorkName(line, index = 0) {
    const name = String(line?.product || "").trim() || String(line?.order_type || "").trim();
    return name || `Позиция ${index + 1}`;
  }

  function lineDateFloor(line) {
    return dateDay(line?.order_date) || "";
  }

  function dayKeyMax(...keys) {
    return keys.filter(Boolean).sort().at(-1) || "";
  }

  function lineWorkProxy(order, line) {
    const floor = lineDateFloor(line);
    let start = dateDay(line?.work_start) || dateDay(order?.work_start);
    let end = dateDay(line?.work_end) || dateDay(order?.work_end);
    if (floor) {
      if (start && start < floor) start = floor;
      if (end && end < floor) end = floor;
    }
    return {
      work_start: start || "",
      work_end: end || "",
      work_pauses: Array.isArray(line?.work_pauses) ? line.work_pauses.map((pause) => ({ ...pause })) : [],
    };
  }

  /** Срок позиции без расширения по sibling-линиям заказа. */
  function lineOwnDrawSpan(order, line, today = dayStart(new Date())) {
    const floor = lineDateFloor(line);
    let start = dateDay(line?.work_start) || dateDay(order?.work_start);
    let end = dateDay(line?.work_end) || dateDay(order?.work_end);
    if (floor) {
      if (start && start < floor) start = floor;
      if (end && end < floor) end = floor;
    }
    return orderDrawSpan({ work_start: start || "", work_end: end || "", work_pauses: [] }, today);
  }

  function dayIsOrderDerivedPause(order, day, today = dayStart(new Date())) {
    const lines = calendarWorkLines(order);
    if (!lines.length) return false;
    const d = dayStart(typeof day === "string" ? parseDay(day) : day);
    if (!d) return false;
    const covering = lines.filter((line) => {
      const span = lineOwnDrawSpan(order, line, today);
      return span && d >= span.from && d <= span.till;
    });
    if (!covering.length) return true;
    return covering.every((line) => pauseOnDay(lineWorkProxy(order, line), d));
  }

  function syncOrderPausesFromLines(order) {
    if (!Array.isArray(order?.lines)) return order;
    if (!dateDay(order.work_start) && !dateDay(order.work_end)) {
      order.work_pauses = [];
      return order;
    }
    const lines = calendarWorkLines(order);
    if (!lines.length) {
      order.work_pauses = [];
      return order;
    }
    const today = dayStart(new Date());
    const span = orderDrawSpan(order, today);
    if (!span) {
      order.work_pauses = [];
      return order;
    }
    const items = [];
    let run = null;
    for (let d = span.from; d <= span.till; d = addDays(d, 1)) {
      if (dayIsOrderDerivedPause(order, d, today)) {
        if (!run) run = { start: dayKey(d), end: dayKey(d) };
        else run.end = dayKey(d);
      } else if (run) {
        items.push(run);
        run = null;
      }
    }
    if (run) items.push(run);
    const openOrder = !dateDay(order.work_end);
    const todayKey = dayKey(today);
    order.work_pauses = items.map((pause) => {
      if (openOrder && pause.start <= todayKey && pause.end >= todayKey) {
        return { start: pause.start, end: "", open: true };
      }
      return { start: pause.start, end: pause.end };
    });
    return order;
  }

  function clampLineToOrder(order, start, end, line) {
    const oStart = dateDay(order?.work_start);
    const oEnd = dateDay(order?.work_end);
    const floor = lineDateFloor(line);
    let a = dateDay(start);
    let b = dateDay(end);
    if (oStart && a && a < oStart) a = oStart;
    if (oEnd && a && a > oEnd) a = oEnd;
    if (oStart && b && b < oStart) b = oStart;
    if (oEnd && b && b > oEnd) b = oEnd;
    if (floor && a && a < floor) a = floor;
    if (floor && b && b < floor) b = floor;
    if (a && b && b < a) [a, b] = [b, a];
    if (floor && a && a < floor) a = floor;
    if (a && b && b < a) b = a;
    return { start: a, end: b };
  }

  function writeLineWork(order, line, proxy) {
    if (!line) return;
    normalizeWorkDates(proxy, { mergePauses: true, lines: false });
    const clamped = clampLineToOrder(order, proxy.work_start, proxy.work_end, line);
    proxy.work_start = clamped.start;
    proxy.work_end = clamped.end;
    normalizeWorkDates(proxy, { mergePauses: true, lines: false });
    const pauses = workPauses(proxy);
    const oStart = dateDay(order.work_start);
    const oEnd = dateDay(order.work_end);
    const defaultStart = dayKeyMax(oStart, lineDateFloor(line));
    const sameDates = dateDay(proxy.work_start) === defaultStart && dateDay(proxy.work_end) === oEnd;
    if (!dateDay(proxy.work_start) && !dateDay(proxy.work_end)) {
      line.work_start = "";
      line.work_end = "";
      line.work_pauses = [];
      syncOrderPausesFromLines(order);
      return;
    }
    if (sameDates) {
      line.work_start = "";
      line.work_end = "";
      line.work_pauses = pauses;
      syncOrderPausesFromLines(order);
      return;
    }
    line.work_start = dateDay(proxy.work_start);
    line.work_end = dateDay(proxy.work_end);
    line.work_pauses = pauses;
    syncOrderPausesFromLines(order);
  }

  function normalizeOrderLinesWork(order) {
    if (!dateDay(order.work_start) && !dateDay(order.work_end)) {
      calendarWorkLines(order).forEach((line) => {
        line.work_start = "";
        line.work_end = "";
        line.work_pauses = [];
      });
      return order;
    }
    calendarWorkLines(order).forEach((line) => {
      const proxy = lineWorkProxy(order, line);
      writeLineWork(order, line, proxy);
    });
    return order;
  }

  function lineDrawEnvelope(order, line) {
    const oStart = parseDay(order?.work_start);
    const oEnd = parseDay(order?.work_end);
    const floor = parseDay(lineDateFloor(line));
    let from = oStart;
    if (floor && (!from || floor > from)) from = floor;
    if (!from) return null;
    if (oEnd) {
      if (from > oEnd) return null;
      return { from, till: oEnd };
    }
    // Без конца у заказа позицию можно увести в будущее — полоса заказа удлинится.
    return { from, till: addDays(dayStart(new Date()), LINE_DRAG_HORIZON_DAYS) };
  }

  function clampLineProxy(order, proxy, drag) {
    const line = drag?.line;
    const env = lineDrawEnvelope(order, line) || orderDrawSpan(order);
    if (!env) return;
    let start = parseDay(proxy.work_start);
    let end = parseDay(proxy.work_end);
    if (drag?.mode === "move" && start) {
      const len = end ? dayDiff(start, end) : 0;
      if (start < env.from) start = env.from;
      if (end) {
        end = addDays(start, len);
        if (end > env.till) {
          end = env.till;
          start = addDays(end, -len);
        }
        if (start < env.from) start = env.from;
        proxy.work_end = dayKey(end);
      } else if (start > env.till) start = env.till;
      if (start < env.from) start = env.from;
      proxy.work_start = dayKey(start);
      return;
    }
    const c = clampLineToOrder(order, proxy.work_start, proxy.work_end, line);
    proxy.work_start = c.start;
    proxy.work_end = c.end;
  }

  function lineWorkMeta(order, line, day) {
    if (/отмен|аннул|черн/i.test(line?.status || "")) return { id: "cancelled", ...WORK_STATUS.cancelled };
    return workStatusMeta(lineWorkProxy(order, line), day);
  }

  function calendarLinesOpen(orderId) {
    return !!calendarState().openLines?.[orderId];
  }

  /** Правый клик по строке заказа (или его позиции) на таймлайне раскрывает / сворачивает позиции. */
  function onCalContextMenu(e) {
    if (calendarState().mode !== "timeline") return;
    const row = e.target.closest(".gantt-row[data-cal-id]");
    if (!row) return;
    const order = findOrder(row.dataset.calId);
    if (!order || !calendarWorkLines(order).length) return;
    e.preventDefault();
    toggleCalendarLines(order.id);
  }

  function toggleCalendarLines(orderId) {
    const cal = calendarState();
    if (!cal.openLines) cal.openLines = {};
    if (cal.openLines[orderId]) delete cal.openLines[orderId];
    else cal.openLines[orderId] = true;
    cal.selected = orderId;
    cal.selectedLine = "";
    renderCalendar();
  }

  function workSpan(order) {
    return {
      start: parseDay(order.work_start),
      end: parseDay(order.work_end),
      startKey: dateDay(order.work_start),
      endKey: dateDay(order.work_end),
    };
  }

  function orderDeadline(order, today = dayStart(new Date())) {
    const end = parseDay(order.work_end);
    if (!end || end <= today) return null;
    return end;
  }

  function workStatus(order, today = dayStart(new Date())) {
    if (orderIsOff(order)) return "cancelled";
    const { start, end } = workSpan(order);
    if (!start && !end) return "nodate";
    if (start && !end) {
      if (start > today) return "planned";
      return "now";
    }
    if (!start && end) {
      if (end <= today) return "done";
      return "now";
    }
    if (today < start) return "planned";
    if (end <= today) return "done";
    return "now";
  }

  function orderIsPausedNow(order, today = dayStart(new Date())) {
    const st = workStatus(order, today);
    if (st === "cancelled" || st === "nodate") return false;
    return isPaused(order, today);
  }

  function workStatusMeta(order, day) {
    const id = workStatus(order);
    const paused = day ? isPaused(order, day) : orderIsPausedNow(order);
    if (paused && id !== "cancelled" && id !== "nodate") return { id: "paused", ...WORK_STATUS.paused };
    return { id, ...(WORK_STATUS[id] || WORK_STATUS.nodate) };
  }

  const TL_STATUS_RANK = { now: 0, overdue: 1, planned: 2, done: 3, cancelled: 4, nodate: 5 };

  function timelineFreshness(order, today) {
    const { start, end } = workSpan(order);
    const st = workStatus(order, today);
    if (st === "now" || st === "overdue") return start ? start.getTime() : today.getTime();
    if (st === "planned") return start ? -start.getTime() : Number.NEGATIVE_INFINITY;
    if (st === "done") return (end || start || today).getTime();
    return 0;
  }

  function compareTimelineOrders(a, b, today) {
    const ra = TL_STATUS_RANK[workStatus(a, today)] ?? 9;
    const rb = TL_STATUS_RANK[workStatus(b, today)] ?? 9;
    if (ra !== rb) return ra - rb;
    const fa = timelineFreshness(a, today);
    const fb = timelineFreshness(b, today);
    if (fa !== fb) return fb - fa;
    return String(a.number).localeCompare(String(b.number), "ru", { numeric: true });
  }

  function orderCoversDay(order, day) {
    if (isPaused(order, day)) return false;
    const { start, end } = workSpan(order);
    if (!start && !end) return false;
    const d = dayStart(day);
    const today = dayStart(new Date());
    if (start && !end) {
      if (start > today) return dayKey(d) === dayKey(start);
      return d >= start && d <= today;
    }
    if (!start && end) return d <= end;
    return d >= start && d <= end;
  }

  function orderMarksDay(order, day) {
    const d = dayStart(day);
    if (d > dayStart(new Date()) && Array.isArray(order?.lines)) {
      return calendarWorkLines(order).some((line) => positionCoversFutureDay(order, line, day));
    }
    return isPaused(order, day) || boardCoversDay(order, day);
  }

  /** work или pause, если таймлайн в этот день рисует полосу. Пусто — полосы нет, даже если пауза «открыта вперёд». */
  function timelinePaintKind(proxy, day, today = dayStart(new Date())) {
    const d = dayStart(day);
    if (!d) return "";
    const span = orderDrawSpan(proxy, today);
    if (!span || d < span.from || d > span.till) return "";
    if (splitWorkSegments(span.from, span.till, proxy).some((seg) => d >= seg.from && d <= seg.till)) return "work";
    if (orderPauseSegments(proxy, span.from, span.till, today).some((seg) => d >= seg.from && d <= seg.till)) return "pause";
    return "";
  }

  /** День после сегодня: как полоса на таймлайне. Завтра добавляется только у позиции, которая сегодня идёт и не закрыта. */
  function lineFutureKind(order, line, day) {
    const d = dayStart(day);
    const today = dayStart(new Date());
    if (!d || d <= today) return "";
    const proxy = lineWorkProxy(order, line);
    const painted = timelinePaintKind(proxy, d, today);
    if (painted) return painted;
    if (dateDay(proxy.work_end) || futureOpenPauses(proxy, today).length || isPaused(proxy, today) || isPaused(proxy, d)) return "";
    if (workStatus(proxy, today) !== "now") return "";
    return dayKey(d) === dayKey(addDays(today, 1)) ? "work" : "";
  }

  function orderPauseHidden(order, day) {
    if (!hidePausedOnBoard()) return false;
    const active = calendarWorkLines(order).map((line) => lineActiveOnDay(order, line, day)).filter(Boolean);
    if (active.length && active.every((kind) => kind === "pause")) return true;
    if (!isPaused(order, day)) return false;
    return !active.some((kind) => kind === "work");
  }

  function positionCoversFutureDay(order, line, day) {
    return !!lineFutureKind(order, line, day);
  }

  function boardCoversDay(target, day) {
    if (isPaused(target, day)) return false;
    const { start, end } = workSpan(target);
    if (!start && !end) return false;
    const d = dayStart(day);
    if (start && end) return d >= start && d <= end;
    if (!start && end) return d <= end;
    if (!start || d < start) return false;
    const today = dayStart(new Date());
    if (d <= today) return true;
    if (Array.isArray(target.lines)) {
      return calendarWorkLines(target).some((line) => positionCoversFutureDay(target, line, day));
    }
    if (!dateDay(target.work_end) && (futureOpenPauses(target, today).length || isPaused(target, d))) return false;
    if (!dateDay(target.work_end) && workStatus(target, today) === "now" && dayKey(d) === dayKey(addDays(today, 1))) return true;
    const resume = resumeDrawTill(target, today);
    if (resume && dayKey(d) === dayKey(resume)) return true;
    return start > today && dayKey(d) === dayKey(start);
  }

  function splitWorkSegments(from, till, order) {
    if (!from || !till || from > till) return [];
    const segments = [];
    let segStart = null;
    let prev = null;
    for (let d = dayStart(from); d <= till; d = addDays(d, 1)) {
      if (!(order && pauseOnDay(order, d))) {
        if (!segStart) segStart = d;
        prev = d;
      } else if (segStart) {
        segments.push({ from: segStart, till: prev });
        segStart = null;
        prev = null;
      }
    }
    if (segStart) segments.push({ from: segStart, till: prev });
    return segments;
  }

  function orderWorkSegments(order, clipFrom, clipTo, today = dayStart(new Date())) {
    const span = orderDrawSpan(order, today);
    if (!span) return [];
    let from = span.from;
    let till = span.till;
    if (clipFrom && from < clipFrom) from = clipFrom;
    if (clipTo && till > clipTo) till = clipTo;
    if (from > till) return [];
    return splitWorkSegments(from, till, order);
  }

  function orderPauseSegments(order, clipFrom, clipTo, today = dayStart(new Date())) {
    const span = orderDrawSpan(order, today);
    if (!span) return [];
    return workPauses(order)
      .map((pause, index) => {
        let from = parseDay(pause.start);
        let till = parseDay(pauseEndKey(order, pause, today));
        if (!from || !till) return null;
        if (from < span.from) from = span.from;
        if (till > span.till) till = span.till;
        const unclippedFrom = from;
        const unclippedTill = till;
        if (clipFrom && from < clipFrom) from = clipFrom;
        if (clipTo && till > clipTo) till = clipTo;
        if (from > till) return null;
        return {
          from,
          till,
          index,
          showStart: from.getTime() === unclippedFrom.getTime(),
          showEnd: till.getTime() === unclippedTill.getTime(),
        };
      })
      .filter(Boolean);
  }

  function workDurationDays(order) {
    const span = orderDrawSpan(order);
    if (!span) return 0;
    let n = 0;
    for (let d = span.from; d <= span.till; d = addDays(d, 1)) {
      if (!isWeekend(d) && !isPaused(order, d)) n += 1;
    }
    return n;
  }

  function lineDateRange(order) {
    const keys = (order.lines || [])
      .filter((line) => !isFrozenLine(line) && !isExpenseLine(line))
      .map((line) => dateDay(line.order_date))
      .filter(Boolean)
      .sort();
    if (!keys.length) return null;
    return { start: keys[0], end: keys[keys.length - 1] };
  }

  function calendarState() {
    if (!state.calendar) {
      const saved = ensureUi().calendar || {};
      state.calendar = {
        mode: CALENDAR_MODES.includes(saved.mode) ? saved.mode : "timeline",
        filter: CALENDAR_FILTERS.some(([id]) => id === saved.filter) ? saved.filter : "all",
        selected: "",
        selectedLine: "",
        openLines: {},
        pick: "",
        anchor: dayStart(new Date()),
        viewFrom: null,
        viewDays: TL_DEFAULT_DAYS,
        followOrder: readCalFollow(),
        hidePause: readCalHidePause(),
      };
    }
    if (!state.calendar.openLines || typeof state.calendar.openLines !== "object") state.calendar.openLines = {};
    if (typeof state.calendar.selectedLine !== "string") state.calendar.selectedLine = "";
    if (!(state.calendar.anchor instanceof Date) || Number.isNaN(state.calendar.anchor.getTime())) {
      state.calendar.anchor = dayStart(new Date());
    }
    return state.calendar;
  }

  function readCalFollow() {
    try {
      const raw = localStorage.getItem(LS_CAL_FOLLOW);
      if (raw === "false" || raw === "0") return false;
      if (raw === "true" || raw === "1") return true;
    } catch {
      /* ignore */
    }
    const saved = state.doc?.ui?.calendar?.follow_order;
    return typeof saved === "boolean" ? saved : true;
  }

  function readCalHidePause() {
    try {
      const raw = localStorage.getItem(LS_CAL_HIDE_PAUSE);
      if (raw === "false" || raw === "0") return false;
      if (raw === "true" || raw === "1") return true;
    } catch {
      /* ignore */
    }
    return true;
  }

  /** Неделя и месяц: заказы и позиции «На паузе» спрятаны, пока включена кнопка. Таймлайн не трогает. */
  function hidePausedOnBoard() {
    const cal = calendarState();
    return cal.mode !== "timeline" && cal.hidePause !== false;
  }

  function persistCalendar() {
    if (!state.doc) return;
    const cal = calendarState();
    const off = calendarOffSettings();
    const pruned = pruneOffLists(off.weekends, off.offDays, off.workDays);
    ensureUi().calendar = {
      mode: cal.mode,
      filter: cal.filter,
      weekends: off.weekends,
      off_days: pruned.offDays,
      work_days: pruned.workDays,
      day_notes: calendarDayNotes(),
    };
  }

  function openPauseDrawTill(order, today) {
    let till = null;
    const todayKey = dayKey(today);
    workPauses(order).forEach((pause) => {
      if (!pauseIsOpen(order, pause)) return;
      const startKey = dateDay(pause.start);
      if (!startKey || startKey <= todayKey) return;
      const end = parseDay(startKey);
      if (!till || end > till) till = end;
    });
    return till;
  }

  function resumeDrawTill(order, today) {
    if (dateDay(order?.work_end)) return null;
    // Обычная пауза на сегодня (Shift по дню или кнопка) завтра не планирует.
    // Следующий рабочий день рисуется только после явного Shift по краю: пауза закрыта с пометкой resumeNext.
    // Если Shift нажали в выходной, пауза кончается последним рабочим днём, а полоса работы — после выходных.
    const hit = explicitResumePause(order, today);
    if (!hit) return null;
    let day = addDays(parseDay(dateDay(hit.end)), 1);
    const cap = addDays(today, 21);
    while (day <= cap && isWeekend(day)) day = addDays(day, 1);
    if (!day || day <= today || isWeekend(day)) return null;
    if (pauseOnDay(order, day)) return null;
    return day;
  }

  function orderDrawSpan(order, today = dayStart(new Date())) {
    const { start, end } = workSpan(order);
    if (!start && !end) return null;
    if (start && !end) {
      if (start > today) {
        const from = start;
        if (!from) return null;
        let till = from;
        if (Array.isArray(order?.lines)) {
          calendarWorkLines(order).forEach((line) => {
            const own = lineOwnDrawSpan(order, line, today);
            if (own && own.till > till) till = own.till;
          });
        }
        return { from, till };
      }
      let till = today;
      if (Array.isArray(order?.lines)) {
        calendarWorkLines(order).forEach((line) => {
          const own = lineOwnDrawSpan(order, line, today);
          if (!own) return;
          if (own.till > till) till = own.till;
          if (own.from > till) till = own.from;
        });
      }
      const ahead = openPauseDrawTill(order, today);
      if (ahead && ahead > till) till = ahead;
      const resumed = resumeDrawTill(order, today);
      if (resumed && resumed > till) till = resumed;
      return { from: start, till };
    }
    if (!start && end) return { from: end, till: end };
    return { from: start, till: end };
  }

  function timelineFullRange() {
    const today = dayStart(new Date());
    let from = today;
    let to = today;
    calendarOrders().forEach((order) => {
      const span = orderDrawSpan(order, today);
      if (!span) return;
      if (span.from < from) from = span.from;
      if (span.till > to) to = span.till;
    });
    const pad = 30;
    from = mondayOf(addDays(from, -pad));
    to = addDays(mondayOf(addDays(to, pad)), 6);
    const days = rangeDays(from, to);
    return { from, to, days, span: days.length, today };
  }

  function clampTimelineView() {
    const cal = calendarState();
    const full = timelineFullRange();
    if (!cal.viewDays) cal.viewDays = Math.min(TL_DEFAULT_DAYS, full.span);
    cal.viewDays = Math.max(TL_MIN_DAYS, Math.min(full.span, Math.round(cal.viewDays)));
    if (!(cal.viewFrom instanceof Date) || Number.isNaN(cal.viewFrom.getTime())) {
      const today = full.today < full.from ? full.from : dayStart(full.today);
      cal.viewFrom = addDays(today, -Math.floor((cal.viewDays - 1) / 2));
    } else {
      cal.viewFrom = dayStart(cal.viewFrom);
    }
    const last = addDays(full.to, 1 - cal.viewDays);
    if (cal.viewFrom < full.from) cal.viewFrom = full.from;
    if (last >= full.from && cal.viewFrom > last) cal.viewFrom = last;
    return full;
  }

  function goCalendarDay(day) {
    const cal = calendarState();
    const target = dayStart(day instanceof Date ? day : parseDay(day));
    if (!target) return false;
    cal.anchor = target;
    if (cal.mode === "timeline") {
      if (!cal.viewDays) cal.viewDays = TL_DEFAULT_DAYS;
      cal.viewFrom = addDays(target, -Math.floor((cal.viewDays - 1) / 2));
      clampTimelineView();
    }
    cal.revealDay = dayKey(target);
    return true;
  }

  function goTimelineToday() {
    goCalendarDay(new Date());
  }

  function calendarWindow() {
    const cal = calendarState();
    const anchor = dayStart(cal.anchor || new Date());
    const today = dayStart(new Date());
    if (cal.mode === "classic") {
      const from = new Date(anchor.getFullYear(), anchor.getMonth(), 1);
      const to = new Date(anchor.getFullYear(), anchor.getMonth() + 1, 0);
      const gridFrom = mondayOf(from);
      let gridTo = addDays(gridFrom, 41);
      while (gridTo < to) gridTo = addDays(gridTo, 7);
      return {
        from,
        to,
        days: rangeDays(from, to),
        gridFrom,
        gridTo,
        today,
        title: `${RU_MONTHS_NOM[from.getMonth()]} ${from.getFullYear()}`,
      };
    }
    if (cal.mode === "extended") {
      const from = mondayOf(anchor);
      const to = addDays(from, 6);
      return { from, to, days: rangeDays(from, to), today, title: calFmtRange(from, to) };
    }
    const full = clampTimelineView();
    const from = calendarState().viewFrom;
    const days = rangeDays(from, addDays(from, calendarState().viewDays - 1));
    return { from, to: days[days.length - 1], days, today: full.today, full, title: calFmtRange(from, days[days.length - 1]) };
  }

  function calendarShift(dir, unit = "period") {
    const cal = calendarState();
    if (!(cal.anchor instanceof Date) || Number.isNaN(cal.anchor.getTime())) cal.anchor = dayStart(new Date());
    if (cal.mode === "classic") {
      if (unit === "year") cal.anchor = new Date(cal.anchor.getFullYear() + dir, cal.anchor.getMonth(), 1);
      else cal.anchor = new Date(cal.anchor.getFullYear(), cal.anchor.getMonth() + dir, 1);
    } else if (cal.mode === "timeline") {
      const step = Math.max(1, Math.floor((cal.viewDays || TL_DEFAULT_DAYS) / 2));
      cal.viewFrom = addDays(cal.viewFrom || dayStart(new Date()), dir * step);
      clampTimelineView();
      cal.anchor = cal.viewFrom;
    } else cal.anchor = addDays(mondayOf(cal.anchor), dir * 7);
    renderCalendar();
  }

  function calendarYearOptions(year) {
    const now = new Date().getFullYear();
    const from = Math.min(year, now) - 15;
    const to = Math.max(year, now) + 10;
    let html = "";
    for (let y = from; y <= to; y++) html += `<option value="${y}" ${y === year ? "selected" : ""}>${y}</option>`;
    return html;
  }

  function paintCalTitle(win) {
    const host = $("cal-title");
    if (!host) return;
    const cal = calendarState();
    if (cal.mode !== "classic") {
      host.textContent = win.title;
      return;
    }
    const year = win.from.getFullYear();
    const month = win.from.getMonth();
    host.innerHTML = `
      <select class="cal-pick" id="cal-month-pick" aria-label="Месяц">${RU_MONTHS_NOM.map((name, i) => `<option value="${i}" ${i === month ? "selected" : ""}>${esc(name)}</option>`).join("")}</select>
      <select class="cal-pick" id="cal-year-pick" aria-label="Год">${calendarYearOptions(year)}</select>`;
  }

  function calendarOrdersAll() {
    const q = state.search.trim().toLowerCase();
    return (state.doc.orders || []).filter((order) => {
      if (!q) return true;
      const hay = [order.number, order.customer, order.name, order.notes].join(" ").toLowerCase();
      return hay.includes(q);
    });
  }

  function calendarOrders(filter = calendarState().filter) {
    return calendarOrdersAll().filter((order) => filter === "all" || workStatus(order) === filter);
  }

  function calendarLoadMap(orders, days) {
    const map = {};
    let peak = 0;
    let peakKey = "";
    days.forEach((day) => {
      const key = dayKey(day);
      const covers = calendarState().mode === "timeline" ? orderCoversDay : boardCoversDay;
      const n = orders.filter((order) => covers(order, day) && workStatus(order) !== "cancelled").length;
      map[key] = n;
      if (n > peak) {
        peak = n;
        peakKey = key;
      }
    });
    return { map, peak, peakKey };
  }

  function barVars(base, veil) {
    const raw = String(base || "").trim().toLowerCase();
    const rgb = colorRgb(raw) || "#0f766e";
    const alpha = /^#[0-9a-f]{8}$/.test(raw) ? colorAlpha(raw) : 1;
    const veilRaw = String(veil || "").trim().toLowerCase();
    const veilCss = /^#[0-9a-f]{6}/.test(veilRaw) ? veilRaw.slice(0, 9) : "transparent";
    return `--bar:${rgb};--a:${Math.round(alpha * 100)}%;--veil:${veilCss};--ink:${rgb}${alphaByte(alpha)}`;
  }

  function pauseBarVars() {
    return barVars(calPaint("stripe"), "");
  }

  function calendarBarPaint(order) {
    const tot = orderTotals(order);
    const status = workStatus(order);
    const unpaid = tot.unpaid > 0.005;
    const ahead = tot.after > 0.005;
    let base;
    if (status === "done" && unpaid) base = calPaint("due");
    else if (unpaid && status === "planned") base = calPaint("planned");
    else if (unpaid) base = calPaint("work");
    else if (ahead) base = calPaint("paid");
    else {
      const first = (order.lines || []).find((line) => !isFrozenLine(line) && !isExpenseLine(line));
      base = statusColor(first?.status) || calPaint("work");
    }
    const veil = unpaid && status !== "done" ? calPaint("debt") : "";
    return { base, veil };
  }

  function calendarLineBarPaint(order, line) {
    if (!line || isFrozenLine(line) || isExpenseLine(line)) return calendarBarPaint(order);
    const proxy = lineWorkProxy(order, line);
    const status = workStatus(proxy);
    const t = lineTotals(line, order);
    const unpaid = t.unpaid > 0.005;
    const ahead = t.after > 0.005;
    const orderDone = workStatus(order) === "done";
    if (status === "planned") return { base: calPaint("planned"), veil: unpaid && !orderDone ? calPaint("debt") : "" };
    if (status === "done") {
      if (unpaid && orderDone) return { base: calPaint("due"), veil: "" };
      return { base: calPaint("finished"), veil: unpaid ? calPaint("debt") : "" };
    }
    if (status === "now") {
    if (orderDone && unpaid) return { base: calPaint("due"), veil: "" };
    if (!unpaid && ahead) return { base: calPaint("paid"), veil: "" };
    const paidNow = paidStatus();
    if (!unpaid && paidNow && line.status === paidNow.name) return { base: calPaint("paid"), veil: "" };
    return { base: calPaint("live"), veil: unpaid ? calPaint("debt") : "" };
    }
    if (orderDone && unpaid) return { base: calPaint("due"), veil: "" };
    if (!unpaid && ahead) return { base: calPaint("paid"), veil: "" };
    const paid = paidStatus();
    if (!unpaid && paid && line.status === paid.name) return { base: calPaint("paid"), veil: "" };
    if (!unpaid) return { base: statusColor(line.status) || calendarBarPaint(order).base, veil: "" };
    return { base: statusColor(line.status) || calPaint("work"), veil: calPaint("debt") };
  }

  function calendarBarColor(order) {
    return calendarBarPaint(order).base;
  }

  function calendarLineBarColor(order, line) {
    return calendarLineBarPaint(order, line).base;
  }

  function setWorkToday(order, which) {
    const today = dayKey(dayStart(new Date()));
    if (which === "start") {
      order.work_start = today;
      if (order.work_end && order.work_end < today) order.work_end = "";
    } else {
      if (!order.work_start) order.work_start = today;
      order.work_end = today;
    }
    normalizeWorkDates(order);
  }

  function shiftWorkDates(order, days) {
    const { start, end } = workSpan(order);
    if (start) order.work_start = dayKey(addDays(start, days));
    if (end) order.work_end = dayKey(addDays(end, days));
    if (!start && !end) {
      const today = dayStart(new Date());
      order.work_start = dayKey(addDays(today, days));
    }
    order.work_pauses = workPauses(order).map((pause) => ({
      start: pause.start ? dayKey(addDays(parseDay(pause.start), days)) : "",
      end: pauseIsOpen(order, pause) ? "" : pause.end ? dayKey(addDays(parseDay(pause.end), days)) : "",
      open: pauseIsOpen(order, pause),
    }));
    normalizeWorkDates(order);
  }

  function fillWorkFromLines(order) {
    const range = lineDateRange(order);
    if (!range) return false;
    if (!order.work_start) order.work_start = range.start;
    if (!order.work_end) order.work_end = range.end;
    normalizeWorkDates(order);
    return true;
  }

  function calendarRole(order, day) {
    if (isPaused(order, day)) return "На паузе";
    const key = dayKey(day);
    const start = dateDay(order.work_start);
    const end = dateDay(order.work_end);
    if (start === key && end === key) return "день";
    if (start === key) return "старт";
    if (end === key) return "финиш";
    return "в работе";
  }

  /** Позиции, которые в этот день реально стоят на календаре. */
  function dayLineKinds(order, day) {
    if (!Array.isArray(order?.lines)) return [];
    return calendarWorkLines(order).map((line) => lineActiveOnDay(order, line, day)).filter(Boolean);
  }

  /** Пауза со следующего дня не делает заказ «запланированным»: день пауза, пока Shift по краю явно не снимет её. */
  function boardDayPaused(order, day) {
    if (isPaused(order, day)) return true;
    const kinds = dayLineKinds(order, day);
    return kinds.length > 0 && kinds.every((kind) => kind === "pause");
  }

  /** Первый день, когда полоса уже не на паузе. Старт на неделе — он, а не дата начала паузы. */
  function firstWorkDayKey(target) {
    const startKey = dateDay(target?.work_start);
    const start = parseDay(startKey);
    if (!start) return "";
    const end = parseDay(dateDay(target?.work_end));
    const cap = end || addDays(start, 90);
    for (let d = start; d <= cap; d = addDays(d, 1)) {
      if (!isPaused(target, d)) return dayKey(d);
    }
    return startKey;
  }

  /** Роль дня на неделе и в месяце: не путает прошедшее, сегодня и дни после сегодня. */
  function boardRole(target, day) {
    if (!target || !day) return "";
    const key = dayKey(dayStart(day));
    const today = dayKey(dayStart(new Date()));
    const start = firstWorkDayKey(target);
    const end = dateDay(target.work_end);
    if (start && end && start === end && start === key) return "старт и финиш";
    if (boardDayPaused(target, day)) return "пауза";
    if (start === key) return "старт";
    if (end && end === key) return "финиш";
    if (key === today) return "выполняется";
    if (key < today) return "выполнялось";
    return "запланировано";
  }

  function boardRoleClass(role) {
    return {
      "старт": "role-start",
      "пауза": "role-pause",
      "выполнялось": "role-was",
      "выполняется": "role-now",
      "финиш": "role-done",
      "старт и финиш": "role-both",
      "запланировано": "role-plan",
    }[role] || "";
  }

  /** Подпись статуса в таймлайне красится как роль недели: идёт сейчас, пауза, план, финиш. */
  function ganttStatusHtml(meta) {
    const role = {
      now: "role-now",
      paused: "role-pause",
      planned: "role-plan",
      done: "role-done",
      overdue: "role-warn",
    }[meta?.id] || "";
    return `<span class="gantt-status${role ? ` ${role}` : ""}">${esc(meta?.label || "")}</span>`;
  }

  function boardRoleIcon(roleClass) {
    const icons = {
      "role-start": `<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M5 3.2v9.6L13 8z" fill="currentColor"/></svg>`,
      "role-done": `<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3.2 8.4 6.3 11.5 12.8 4.5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
      "role-both": `<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M2.6 4.4v7.2L7.6 8z" fill="currentColor"/><path d="M9 5.6 12.8 8 9 10.4" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
      "role-pause": `<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4.2 3h2.2v10H4.2zm5.4 0h2.2v10H9.6z" fill="currentColor"/></svg>`,
      "role-now": `<svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="3.1" fill="currentColor"/></svg>`,
      "role-was": `<svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="5" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M8 4.7V8l2.1 1.3" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>`,
      "role-plan": `<svg viewBox="0 0 16 16" aria-hidden="true"><rect x="3" y="3.4" width="10" height="9.2" rx="1.3" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M3 6.6h10M6 2.6v2.2M10 2.6v2.2" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>`,
    };
    return icons[roleClass] || "";
  }

  function boardRoleLabel(role) {
    const cls = boardRoleClass(role);
    return `<i class="${cls}">${boardRoleIcon(cls)}<span>${esc(role)}</span></i>`;
  }

  function boardRoleSec(cls, text) {
    return `<div class="cal-col-sec ${cls}">${boardRoleIcon(cls)}<span>${esc(text)}</span></div>`;
  }

  function weekColumnHeads(day) {
    const key = dayKey(day);
    const today = dayKey(dayStart(new Date()));
    if (key < today) return { mid: "Выполнялось", midClass: "role-was", pause: "Пауза" };
    if (key > today) return { mid: "Запланировано", midClass: "role-plan", pause: "Пауза" };
    return { mid: "Выполняется", midClass: "role-now", pause: "Пауза" };
  }

  function orderNum(order) {
    return String(order?.number || "—").replace(/^№+\s*/, "") || "—";
  }

  function orderTitle(order) {
    return String(order?.name || "").trim() || "без названия";
  }

  function calChipHtml(order, day, opts = {}) {
    const meta = workStatusMeta(order, day);
    const due = orderDeadline(order);
    const role = day ? boardRole(order, day) : meta.label;
    const note = opts.week ? String(order.notes || "").trim() : "";
    const title = `${orderNum(order)} ${orderTitle(order)} · ${role}${due ? ` · дедлайн ${calFmtDay(due, true)}` : ""}`;
    const paint = calendarBarPaint(order);
    const picked = calSelectedClass(order.id);
    if (opts.week) {
      return `<button type="button" class="cal-chip is-week tone-${meta.tone} ${due ? "has-deadline" : ""} ${picked}" data-cal-id="${esc(order.id)}" title="${esc(title)}" style="${barVars(paint.base, paint.veil)}">
        <span class="cal-chip-title"><b>${esc(orderNum(order))}</b> ${esc(orderTitle(order))}</span>
        ${boardRoleLabel(role)}
        ${note ? `<em class="cal-note">${esc(note)}</em>` : ""}
      </button>`;
    }
    return `<button type="button" class="cal-chip tone-${meta.tone} ${due ? "has-deadline" : ""} ${picked}" data-cal-id="${esc(order.id)}" title="${esc(title)}" style="${barVars(paint.base, paint.veil)}">
      <b>${esc(orderNum(order))}</b>
      <span>${esc(orderTitle(order))}</span>
      ${boardRoleLabel(role)}
    </button>`;
  }

  function lineActiveOnDay(order, line, day) {
    if (/отмен|аннул|черн/i.test(line?.status || "")) return "";
    const d = dayStart(day);
    if (d > dayStart(new Date())) return lineFutureKind(order, line, day);
    const proxy = lineWorkProxy(order, line);
    if (!dateDay(proxy.work_start) && !dateDay(proxy.work_end)) return "";
    if (isPaused(proxy, day)) return "pause";
    if (boardCoversDay(proxy, day)) return "work";
    return "";
  }

  function weekLinesHtml(order, day) {
    const hidePause = hidePausedOnBoard();
    const rows = calendarWorkLines(order)
      .map((line, index) => ({ line, index, kind: lineActiveOnDay(order, line, day) }))
      .filter((row) => row.kind && !(hidePause && row.kind === "pause"));
    if (!rows.length) return "";
    return `<div class="cal-lines">${rows
      .map(({ line, index, kind }) => {
        const note = String(line.notes || "").trim();
        const proxy = lineWorkProxy(order, line);
        const label = boardRole(proxy, day);
        const going = kind !== "pause" && workStatus(proxy) === "now" && !isPaused(proxy, day);
        const tone = going ? ` style="${barVars(calPaint("live"), "")}"` : "";
        return `<button type="button" class="cal-line ${going ? "has-tone" : ""} ${kind === "pause" ? "is-pause" : ""} ${calSelectedClass(order.id, line.id)}" data-cal-id="${esc(order.id)}" data-cal-line="${esc(line.id)}"${tone}>
          <span>${esc(lineWorkName(line, index))}</span>
          ${boardRoleLabel(label)}
          ${note ? `<em class="cal-note">${esc(note)}</em>` : ""}
        </button>`;
      })
      .join("")}</div>`;
  }

  function renderCalendar() {
    if (!state.doc || !$("cal-board")) return;
    applyCalColors();
    (state.doc.orders || []).forEach((order) => syncOrderPausesFromLines(order));
    const cal = calendarState();
    const win = calendarWindow();
    const all = calendarOrdersAll();
    const list = calendarOrders();
    const weekFrom = mondayOf(win.today);
    const weekTo = addDays(weekFrom, 6);
    const nowCount = all.filter((order) => workStatus(order) === "now").length;
    const startWeek = all.filter((order) => {
      const key = dateDay(order.work_start);
      return key && key >= dayKey(weekFrom) && key <= dayKey(weekTo);
    }).length;
    const endWeek = all.filter((order) => {
      const key = dateDay(order.work_end);
      return key && key >= dayKey(weekFrom) && key <= dayKey(weekTo);
    }).length;
    const nodate = all.filter((order) => workStatus(order) === "nodate").length;
    const load = calendarLoadMap(all.filter((order) => workStatus(order) !== "cancelled"), win.days);
    const peakLabel = load.peakKey ? calFmtDay(parseDay(load.peakKey)) : "—";

    paintCalTitle(win);
    document.querySelectorAll("[data-cal-mode]").forEach((btn) => {
      btn.classList.toggle("active", btn.dataset.calMode === cal.mode);
    });
    const filterMeta = CALENDAR_FILTERS.find(([id]) => id === cal.filter) || CALENDAR_FILTERS[0];
    const filterBtn = $("btn-cal-filter");
    const filterMenu = $("cal-filter-menu");
    const filterLabel = $("cal-filter-label");
    if (filterLabel) filterLabel.textContent = `${filterMeta[1]} · ${calendarOrders(cal.filter).length}`;
    filterBtn?.classList.toggle("active", cal.filter !== "all");
    filterBtn?.setAttribute("aria-expanded", "false");
    if (filterMenu) {
      filterMenu.hidden = true;
      filterMenu.innerHTML = CALENDAR_FILTERS.map(([id, label]) => {
        const n = calendarOrders(id).length;
        return `<button type="button" class="btn ${cal.filter === id ? "active" : ""}" data-cal-filter="${id}" role="menuitem">${esc(label)}<span class="chip-count">${n}</span></button>`;
      }).join("");
    }
    const off = calendarOffSettings();
    const weekendBtn = $("btn-cal-weekends");
    const weekendMenu = $("cal-weekend-menu");
    const weekendOpen = weekendMenu && !weekendMenu.hidden;
    const customOff =
      off.weekends.join() !== DEFAULT_WEEKENDS.join() || off.offDays.length > 0 || off.workDays.length > 0;
    weekendBtn?.classList.toggle("active", customOff);
    weekendBtn?.setAttribute("aria-expanded", String(!!weekendOpen));
    const followBtn = $("cal-follow");
    const followOn = cal.followOrder !== false;
    followBtn?.classList.toggle("active", followOn);
    followBtn?.setAttribute("aria-pressed", String(followOn));
    const hidePauseBtn = $("cal-hide-pause");
    const hidePauseOn = cal.hidePause !== false;
    if (hidePauseBtn) {
      hidePauseBtn.hidden = cal.mode === "timeline";
      hidePauseBtn.classList.toggle("active", hidePauseOn);
      hidePauseBtn.setAttribute("aria-pressed", String(hidePauseOn));
    }
    if (weekendMenu) {
      weekendMenu.innerHTML = weekendMenuHtml();
      weekendMenu.hidden = !weekendOpen;
    }
    const colorBtn = $("btn-cal-colors");
    const colorMenu = $("cal-color-menu");
    const colorOpen = colorMenu && !colorMenu.hidden;
    const colorStore = readCalColorStore();
    const colorSide = colorStore[currentTheme()];
    colorBtn?.classList.toggle("active", colorSide.id !== "current" || !!colorSide.colors);
    colorBtn?.setAttribute("aria-expanded", String(!!colorOpen));
    if (colorMenu) {
      const keepName = document.activeElement === $("cal-color-name");
      colorMenu.innerHTML = calColorMenuHtml();
      colorMenu.hidden = !colorOpen;
      if (keepName) $("cal-color-name")?.focus();
      placeCalColorMenu();
    }
    const stats = $("cal-stats-pop");
    if (stats) {
      stats.innerHTML = `<div class="cal-stats-list">
        <div class="cal-stat ${nowCount ? "ok" : ""}"><span>Идёт сейчас</span><b>${nowCount}</b><small>в работе, в том числе без дедлайна</small></div>
        <div class="cal-stat"><span>Старт на неделе</span><b>${startWeek}</b><small>с ${calFmtDay(weekFrom)}</small></div>
        <div class="cal-stat"><span>Финиш на неделе</span><b>${endWeek}</b><small>до ${calFmtDay(weekTo)}</small></div>
        <div class="cal-stat"><span>Без дат</span><b>${nodate}</b><small>ещё не отмечены на календаре</small></div>
        <div class="cal-stat ${load.peak >= CAL_HOT_LOAD ? "warn" : ""}"><span>Пик загрузки</span><b>${load.peak}</b><small>${load.peak ? `${peakLabel} · одновременно` : "нет пересечений"}</small></div>
      </div>`;
    }

    const board = $("cal-board");
    const selectedId = cal.selected || "";
    const ganttRowsBefore = selectedId
      ? [...board.querySelectorAll(".gantt-row[data-cal-id]:not(.is-line)")].findIndex((el) => el.dataset.calId === selectedId)
      : -1;
    const keepY = board.scrollTop;
    const keepCols = {};
    board.querySelectorAll(".cal-col-body").forEach((el) => {
      const day = el.closest("[data-cal-day]")?.dataset.calDay;
      if (day) keepCols[day] = el.scrollTop;
    });
    const keepGanttY = document.querySelector("#gantt-scroll .gantt")?.scrollTop || 0;
    if (cal.mode === "classic") board.innerHTML = renderClassicCalendar(win, list, load);
    else if (cal.mode === "extended") board.innerHTML = renderExtendedCalendar(win, list, load);
    else board.innerHTML = renderTimelineCalendar(win, list, load);
    board.scrollTop = keepY;
    board.querySelectorAll(".cal-col-body").forEach((el) => {
      const day = el.closest("[data-cal-day]")?.dataset.calDay;
      if (day && keepCols[day]) el.scrollTop = keepCols[day];
    });
    const ganttEl = document.querySelector("#gantt-scroll .gantt");
    if (ganttEl) ganttEl.scrollTop = keepGanttY;
    $("cal-side").innerHTML = renderCalendarSide(win, all, list);
    const reveal = cal.revealDay ? parseDay(cal.revealDay) : null;
    cal.revealDay = "";
    requestAnimationFrame(() => {
      if (reveal && cal.mode !== "timeline") {
        const cell = document.querySelector(`[data-cal-day="${cssEscape(dayKey(reveal))}"]`);
        cell?.scrollIntoView({ block: "nearest", inline: "nearest" });
      }
      if (ganttRowsBefore >= 0 && selectedId && calendarState().mode === "timeline") {
        const rows = [...document.querySelectorAll("#gantt-scroll .gantt-row[data-cal-id]:not(.is-line)")];
        const after = rows.findIndex((el) => el.dataset.calId === selectedId);
        if (after >= 0 && after !== ganttRowsBefore) rows[after].scrollIntoView({ block: "nearest" });
      }
    });
  }

  function timelineDayFromX(track, clientX, full) {
    const rect = track.getBoundingClientRect();
    if (!rect.width || !full.days.length) return full.from;
    const t = Math.max(0, Math.min(0.999, (clientX - rect.left) / rect.width));
    return full.days[Math.floor(t * full.days.length)];
  }

  function timelineViewBox(full, viewFrom, viewDays) {
    if (!full.span) return { left: 0, width: 100 };
    const left = (dayDiff(full.from, viewFrom) / full.span) * 100;
    const width = (viewDays / full.span) * 100;
    return { left, width };
  }

  function paintNavView() {
    const full = clampTimelineView();
    const cal = calendarState();
    const box = timelineViewBox(full, cal.viewFrom, cal.viewDays);
    const view = $("tl-nav-view");
    const sl = $("tl-nav-shade-l");
    const sr = $("tl-nav-shade-r");
    if (view) {
      view.style.left = `${box.left}%`;
      view.style.width = `${box.width}%`;
    }
    if (sl) sl.style.width = `${box.left}%`;
    if (sr) {
      sr.style.left = `${box.left + box.width}%`;
      sr.style.width = `${Math.max(0, 100 - box.left - box.width)}%`;
    }
    const meta = $("tl-nav-meta-view");
    if (meta) meta.textContent = `видно ${cal.viewDays} дн. · ${calFmtRange(cal.viewFrom, addDays(cal.viewFrom, cal.viewDays - 1))}`;
    const title = $("cal-title");
    if (title && calendarState().mode === "timeline") title.textContent = calFmtRange(cal.viewFrom, addDays(cal.viewFrom, cal.viewDays - 1));
    refreshTimelineGantt();
  }

  function refreshTimelineGantt() {
    const host = $("gantt-scroll");
    if (!host) return;
    const keepY = host.querySelector(".gantt")?.scrollTop || 0;
    const win = calendarWindow();
    const list = calendarOrders();
    const load = calendarLoadMap(
      calendarOrdersAll().filter((order) => workStatus(order) !== "cancelled"),
      win.days
    );
    const tmp = document.createElement("div");
    tmp.innerHTML = renderTimelineCalendar(win, list, load);
    const next = tmp.querySelector("#gantt-scroll");
    if (next) host.replaceWith(next);
    const gantt = $("gantt-scroll")?.querySelector(".gantt");
    if (gantt) gantt.scrollTop = keepY;
  }

  function timelineZoomAt(ratio, factor) {
    const full = clampTimelineView();
    const cal = calendarState();
    const focus = full.days[Math.min(full.span - 1, Math.max(0, Math.floor(ratio * full.span)))];
    const oldFrom = cal.viewFrom;
    const oldDays = cal.viewDays;
    let next = Math.round(oldDays * factor);
    if (factor < 1 && next >= oldDays) next = oldDays - 1;
    if (factor > 1 && next <= oldDays) next = oldDays + 1;
    const oldStart = dayDiff(full.from, oldFrom);
    const focusIdx = dayDiff(full.from, focus);
    let local = 0.5;
    if (oldDays > 1 && focusIdx >= oldStart && focusIdx < oldStart + oldDays) {
      local = (focusIdx - oldStart) / (oldDays - 1);
    }
    cal.viewDays = next;
    clampTimelineView();
    cal.viewFrom = addDays(focus, -Math.round(local * (cal.viewDays - 1)));
    clampTimelineView();
  }

  function timelineZoomAtFocus(focus, factor) {
    const full = clampTimelineView();
    const idx = Math.max(0, Math.min(full.span - 1, dayDiff(full.from, focus)));
    timelineZoomAt(full.span ? (idx + 0.5) / full.span : 0.5, factor);
  }

  function timelineWheelDelta(e) {
    const delta = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
    return delta;
  }

  function timelineScrollByWheel(delta) {
    if (!delta) return;
    const step = Math.max(1, Math.round(Math.abs(delta) / 70));
    const cal = calendarState();
    cal.viewFrom = addDays(cal.viewFrom, (delta > 0 ? 1 : -1) * step);
    clampTimelineView();
    cal.anchor = cal.viewFrom;
    renderCalendar();
  }

  function timelineLaneItems(today) {
    const blocks = calendarOrders()
      .map((order) => {
        const span = orderDrawSpan(order, today);
        if (!span) return null;
        const segs = splitWorkSegments(span.from, span.till, order);
        const pauses = orderPauseSegments(order, span.from, span.till, today);
        return segs.length || pauses.length ? { order, span, segs, pauses, kind: "order" } : null;
      })
      .filter(Boolean)
      .sort((a, b) => compareTimelineOrders(a.order, b.order, today) || a.span.from - b.span.from || a.span.till - b.span.till);
    const items = [];
    blocks.forEach((block) => {
      items.push(block);
      if (!calendarLinesOpen(block.order.id)) return;
      calendarWorkLines(block.order).forEach((line) => {
        const proxy = lineWorkProxy(block.order, line);
        const span = orderDrawSpan(proxy, today);
        if (!span) return;
        const segs = splitWorkSegments(span.from, span.till, proxy);
        const pauses = orderPauseSegments(proxy, span.from, span.till, today);
        if (!segs.length && !pauses.length) return;
        const linePaint = calendarLineBarPaint(block.order, line);
        items.push({
          order: block.order,
          line,
          span,
          segs,
          pauses,
          kind: "line",
          color: linePaint.base,
          veil: linePaint.veil,
        });
      });
    });
    const byStart = items.slice().sort((a, b) => {
      const from = a.span.from - b.span.from;
      if (from) return from;
      const dur = (b.span.till - b.span.from) - (a.span.till - a.span.from);
      if (dur) return dur;
      return String(a.order.number || "").localeCompare(String(b.order.number || ""), "ru", { numeric: true });
    });
    const ends = [];
    const laneOf = new Map();
    byStart.forEach((item) => {
      let lane = ends.findIndex((till) => item.span.from > till);
      if (lane < 0) {
        lane = ends.length;
        ends.push(item.span.till);
      } else ends[lane] = item.span.till;
      laneOf.set(item, lane);
    });
    const lanes = Math.max(1, ends.length);
    return items.map((item) => ({ ...item, lane: laneOf.get(item) || 0, lanes }));
  }

  function ganttBarsHtml(target, win, { order, lineId = "", label = "", color = "", veil = "", meta, hasNote = false, noteText = "" } = {}) {
    const status = meta || workStatusMeta(target);
    const segs = orderWorkSegments(target, win.from, win.to, win.today);
    const pauses = orderPauseSegments(target, win.from, win.to, win.today);
    if (!segs.length && !pauses.length) return "";
    const due = orderDeadline(target, win.today);
    const openEnd = !dateDay(target.work_end);
    const planned = status.id === "planned";
    const isOrderBar = !lineId;
    let openEndAt = null;
    if (openEnd) {
      const marks = segs
        .map((seg, i) => ({ kind: "work", i, till: seg.till.getTime() }))
        .concat(pauses.map((seg, i) => ({ kind: "pause", i, till: seg.till.getTime() })));
      openEndAt = marks.reduce((best, cur) => (!best || cur.till >= best.till ? cur : best), null);
    }
    // У заказа ручки длины только на крайних концах всей полосы (не на каждом обрывке после паузы).
    let edgeStart = null;
    let edgeEnd = null;
    if (isOrderBar) {
      const marks = segs
        .map((seg, i) => ({ kind: "work", i, from: seg.from.getTime(), till: seg.till.getTime() }))
        .concat(pauses.map((seg, i) => ({ kind: "pause", i, from: seg.from.getTime(), till: seg.till.getTime() })));
      if (marks.length) {
        edgeStart = marks.reduce((best, cur) => (!best || cur.from < best.from ? cur : best), null);
        edgeEnd = marks.reduce((best, cur) => (!best || cur.till > best.till ? cur : best), null);
      }
    }
    const tip = due
      ? `${label} · дедлайн ${calFmtDay(due, true)}`
      : openEnd
        ? `${label} · выполняется`
        : label;
    const note = String(noteText || "").trim();
    let noteKind = "";
    let noteIndex = -1;
    if (note) {
      const marks = segs
        .map((seg, i) => ({ kind: "work", i, till: seg.till.getTime() }))
        .concat(pauses.map((seg, i) => ({ kind: "pause", i, till: seg.till.getTime() })));
      const last = marks.reduce((best, cur) => (!best || cur.till >= best.till ? cur : best), null);
      if (last) {
        noteKind = last.kind;
        noteIndex = last.i;
      }
    }
    const noteMark = (kind, i) =>
      note && noteKind === kind && noteIndex === i
        ? `<span class="gantt-note-mark" data-tip="${esc(note)}">i</span>`
        : "";
    const lineAttr = lineId ? ` data-cal-line="${esc(lineId)}"` : "";
    const id = esc(order.id);
    return segs
      .map((seg, i) => {
        const left = dayDiff(win.from, seg.from);
        const span = dayDiff(seg.from, seg.till) + 1;
        const first = i === 0;
        const last = i === segs.length - 1;
        const showOpenEnd = openEndAt?.kind === "work" && openEndAt.i === i;
        const showStart = isOrderBar ? edgeStart?.kind === "work" && edgeStart.i === i : first;
        const showEnd = isOrderBar ? edgeEnd?.kind === "work" && edgeEnd.i === i : last;
        const cut = `${first ? "" : " is-cut-start"}${last ? "" : " is-cut-end"}`;
        return `<div class="gantt-bar tone-${status.tone} ${status.id === "now" ? "is-live" : ""} ${planned ? "is-planned" : ""} ${due && showEnd ? "has-deadline" : ""} ${showOpenEnd ? "is-open-end" : ""}${cut}" data-cal-id="${id}"${lineAttr} data-cal-drag="move" style="--from:${left};--span:${span};${barVars(color, veil)}" title="${esc(tip)}">
          ${noteMark("work", i)}
          ${showStart ? `<i class="gantt-h start" data-cal-drag="start"></i>` : ""}
          ${showEnd ? `<i class="gantt-h end" data-cal-drag="end"${!isOrderBar && openEnd && showOpenEnd ? ` title="Shift+клик — пауза или работа со следующего дня"` : ""}></i>` : ""}
        </div>`;
      })
      .concat(
        pauses.map((seg, i) => {
          const left = dayDiff(win.from, seg.from);
          const span = dayDiff(seg.from, seg.till) + 1;
          const openPause = pauseIsOpen(target, workPauses(target)[seg.index]);
          const showOpenEnd = openEndAt?.kind === "pause" && openEndAt.i === i;
          const derived = isOrderBar;
          const showOrderStart = derived && edgeStart?.kind === "pause" && edgeStart.i === i;
          const showOrderEnd = derived && edgeEnd?.kind === "pause" && edgeEnd.i === i;
          const ahead = !derived && pauseIsOpen(target, workPauses(target)[seg.index]) && dayKey(seg.from) > dayKey(win.today);
          const pauseTip = ahead
            ? `${label} · с ${calFmtDay(seg.from)} на паузе и дальше`
            : openPause
              ? `${label} · пауза с ${calFmtDay(seg.from)} · идёт, пока не снимете${openEnd ? " · выполняется" : ""}${derived ? " · из позиций" : ""}`
              : `${label} · пауза ${calFmtDay(seg.from)}${span > 1 ? ` — ${calFmtDay(seg.till)}` : ""}${derived ? " · из позиций" : ""}`;
          const orderLenHandles = derived
            ? `${showOrderStart ? `<i class="gantt-h start" data-cal-drag="start"></i>` : ""}${showOrderEnd ? `<i class="gantt-h end" data-cal-drag="end"></i>` : ""}`
            : `${seg.showStart ? `<i class="gantt-h start" data-cal-drag="pause-start"></i>` : "<i></i>"}
            ${seg.showEnd ? `<i class="gantt-h end" data-cal-drag="pause-end"></i>` : "<i></i>"}`;
          return `<div class="gantt-bar is-pause ${ahead ? "is-ahead" : ""} ${showOpenEnd ? "is-open-end" : ""} ${derived ? "is-derived" : ""} ${showOrderStart || showOrderEnd ? "has-len-h" : ""}" data-cal-id="${id}"${lineAttr} data-pause-i="${seg.index}" ${derived ? "" : `data-cal-drag="pause-move"`} style="--from:${left};--span:${span};${pauseBarVars()}" title="${esc(pauseTip)}">
            ${noteMark("pause", i)}
            ${orderLenHandles}
          </div>`;
        })
      )
      .join("");
  }

  function ganttExpandIcon() {
    return `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 6l6 6-6 6" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
  }

  function renderTimelineCalendar(win, list, load) {
    const full = win.full || clampTimelineView();
    const n = win.days.length;
    const dated = list.filter((order) => workStatus(order) !== "nodate");
    const visible = dated.filter((order) => {
      const span = orderDrawSpan(order, win.today);
      return span && span.from <= win.to && span.till >= win.from;
    });
    const box = timelineViewBox(full, win.from, n);
    const ticks = full.days
      .filter((day) => day.getDate() === 1)
      .map((day) => {
        const left = (dayDiff(full.from, day) / full.span) * 100;
        const label = day.getMonth() === 0 ? `${RU_MONTHS_NOM[day.getMonth()].slice(0, 3)} ${day.getFullYear()}` : RU_MONTHS_NOM[day.getMonth()].slice(0, 3);
        return `<div class="tl-nav-tick" style="left:${left}%" title="${esc(calFmtDay(day, true))}">${esc(label)}</div>`;
      })
      .join("");
    const laneItems = timelineLaneItems(win.today);
    const laneCount = Math.max(1, ...laneItems.map((item) => item.lanes), 1);
    const navBars = laneItems
      .flatMap((item) => {
        const title = item.line
          ? `${orderNum(item.order)} ${lineWorkName(item.line)}`.trim()
          : `${orderNum(item.order)} ${orderTitle(item.order)}`.trim();
        const target = item.line ? lineWorkProxy(item.order, item.line) : item.order;
        const due = orderDeadline(target, win.today);
        const openEnd = !dateDay(target.work_end);
        let openEndAt = null;
        if (openEnd) {
          const marks = item.segs
            .map((seg, i) => ({ kind: "work", i, till: seg.till.getTime() }))
            .concat((item.pauses || []).map((seg, i) => ({ kind: "pause", i, till: seg.till.getTime() })));
          openEndAt = marks.reduce((best, cur) => (!best || cur.till >= best.till ? cur : best), null);
        }
        const paint = item.color ? { base: item.color, veil: item.veil || "" } : calendarBarPaint(item.order);
        const color = paint.base;
        const veil = paint.veil;
        const lineAttr = item.line ? ` data-cal-line="${esc(item.line.id)}"` : "";
        const lineClass = item.kind === "line" ? " is-line" : "";
        return item.segs.map((seg, i) => {
          const from = Math.max(0, dayDiff(full.from, seg.from));
          const till = Math.min(full.span - 1, dayDiff(full.from, seg.till));
          if (till < from) return "";
          const len = till - from + 1;
          const last = i === item.segs.length - 1;
          const showOpenEnd = openEndAt?.kind === "work" && openEndAt.i === i;
          const cut = `${i ? " is-cut-start" : ""}${last ? "" : " is-cut-end"}`;
          return `<div class="tl-nav-bar ${due ? "has-deadline" : ""}${showOpenEnd ? " is-open-end" : ""}${workStatus(target) === "planned" ? " is-planned" : ""}${lineClass}${cut}" data-cal-id="${esc(item.order.id)}"${lineAttr} style="--lane:${item.lane};--from:${from};--len:${len};--span:${full.span};${barVars(color, veil)}" title="${esc(title)}${due ? ` · до ${calFmtDay(due, true)}` : openEnd ? " · выполняется" : ""}"></div>`;
        }).concat(
          (item.pauses || []).map((seg, i) => {
            const from = Math.max(0, dayDiff(full.from, seg.from));
            const till = Math.min(full.span - 1, dayDiff(full.from, seg.till));
            if (till < from) return "";
            const len = till - from + 1;
            const showOpenEnd = openEndAt?.kind === "pause" && openEndAt.i === i;
            return `<div class="tl-nav-bar is-pause${showOpenEnd ? " is-open-end" : ""}${lineClass}" data-cal-id="${esc(item.order.id)}"${lineAttr} style="--lane:${item.lane};--from:${from};--len:${len};--span:${full.span};${pauseBarVars()}" title="${esc(title)} · пауза${openEnd ? " · выполняется" : ""}"></div>`;
          })
        );
      })
      .join("");
    const todayInFull = win.today >= full.from && win.today <= full.to;
    const todayNav = todayInFull ? `<div class="tl-nav-today" style="left:${((dayDiff(full.from, win.today) + 0.5) / full.span) * 100}%"></div>` : "";
    const dense = n > 45;
    const head = win.days
      .map((day) => {
        const key = dayKey(day);
        const hot = (load.map[key] || 0) >= CAL_HOT_LOAD;
        const monday = (day.getDay() + 6) % 7 === 0;
        const first = day.getDate() === 1;
        const showNum = !dense || monday || first;
        const label = first ? RU_MONTHS_NOM[day.getMonth()].slice(0, 3) : RU_WEEKDAYS[(day.getDay() + 6) % 7];
        const note = dayNote(key);
        return `<div class="gantt-day ${dayToneClass(day)} ${note ? "has-note" : ""} ${dayKey(day) === dayKey(win.today) ? "is-today" : ""} ${calendarState().pick === key ? "is-pick" : ""} ${hot ? "is-hot" : ""} ${showNum ? "" : "is-slim"}" data-cal-day="${key}" title="${esc(note)}">
          <span>${showNum ? day.getDate() : ""}</span><small>${showNum ? esc(label) : ""}</small>
        </div>`;
      })
      .join("");
    const todayInView = win.today >= win.from && win.today <= win.to;
    const todayLine = todayInView ? `<div class="gantt-today" style="left:calc((${dayDiff(win.from, win.today)} + 0.5) / ${n} * 100%)"></div>` : "";
    const gridCols = win.days
      .map((day) => {
        const key = dayKey(day);
        const hot = (load.map[key] || 0) >= CAL_HOT_LOAD;
        return `<div class="gantt-grid-col ${dayToneClass(day)} ${key === dayKey(win.today) ? "is-today" : ""} ${calendarState().pick === key ? "is-pick" : ""} ${hot ? "is-hot" : ""}"></div>`;
      })
      .join("");
    const rows = visible
      .slice()
      .sort((a, b) => compareTimelineOrders(a, b, win.today))
      .map((order) => {
        const meta = workStatusMeta(order);
        const pausedNow = orderIsPausedNow(order, win.today);
        const due = orderDeadline(order, win.today);
        const label = `${orderNum(order)} ${orderTitle(order)}`.trim();
        const paint = calendarBarPaint(order);
        const workLines = calendarWorkLines(order);
        const bars = ganttBarsHtml(order, win, {
          order,
          label,
          color: paint.base,
          veil: paint.veil,
          hasNote: lineHasNote(order),
          noteText: String(order.notes || "").trim(),
        });
        if (!bars) return "";
        const open = calendarLinesOpen(order.id);
        const expand = workLines.length
          ? `<button type="button" class="gantt-expand ${open ? "is-open" : ""}" data-cal-expand="${esc(order.id)}" title="${open ? "Скрыть позиции" : "Показать позиции"} · или правый клик по строке заказа" aria-label="${open ? "Скрыть позиции" : "Показать позиции"}" aria-expanded="${open}">${ganttExpandIcon()}</button>`
          : `<span class="gantt-expand is-empty" aria-hidden="true"></span>`;
        const lineRows = open
          ? workLines
              .map((line, index) => {
                const proxy = lineWorkProxy(order, line);
                const lineMeta = lineWorkMeta(order, line);
                const linePaused = orderIsPausedNow(proxy, win.today);
                const lineLabel = lineWorkName(line, index);
                const linePaint = calendarLineBarPaint(order, line);
                const lineBars = ganttBarsHtml(proxy, win, {
                  order,
                  lineId: line.id,
                  label: `${label} · ${lineLabel}`,
                  color: linePaint.base,
                  veil: linePaint.veil,
                  meta: lineMeta,
                  hasNote: lineHasNote(line),
                  noteText: String(line.notes || "").trim(),
                });
                const days = workDurationDays(proxy);
                return `<div class="gantt-row is-line ${calSelectedClass(order.id, line.id)} ${linePaused ? "is-paused" : ""}" data-cal-id="${esc(order.id)}" data-cal-line="${esc(line.id)}">
          <div class="gantt-head">
            <button type="button" class="gantt-label" data-cal-id="${esc(order.id)}" data-cal-line="${esc(line.id)}">
              <b>${esc(lineLabel)}</b>
              <small>${ganttStatusHtml(lineMeta)}${days ? ` · ${days} дн.` : ""}</small>
            </button>
          </div>
          <div class="gantt-track" data-cal-track="${esc(order.id)}" data-cal-line="${esc(line.id)}">${lineBars}</div>
        </div>`;
              })
              .join("")
          : "";
        return `<div class="gantt-row ${calSelectedClass(order.id)} ${due ? "has-deadline" : ""} ${pausedNow ? "is-paused" : ""} ${open ? "is-open" : ""}" data-cal-id="${esc(order.id)}">
          <div class="gantt-head">
            ${expand}
            <button type="button" class="gantt-label" data-cal-id="${esc(order.id)}">
              <b>${esc(orderNum(order))} ${esc(orderTitle(order))}</b>
              <small>${esc(order.customer || "без заказчика")} · ${ganttStatusHtml(meta)}${workDurationDays(order) ? ` · ${workDurationDays(order)} дн.` : ""}${due ? ` · до ${calFmtDay(due)}` : ""}${workLines.length ? ` · ${workLines.length} поз.` : ""}</small>
            </button>
          </div>
          <div class="gantt-track" data-cal-track="${esc(order.id)}">${bars}</div>
        </div>${lineRows}`;
      })
      .join("");
    const empty = visible.length
      ? ""
      : `<div class="cal-empty">${dated.length ? "В видимой области нет заказов — сдвиньте рамку сверху или прокрутите линейку дней колесом." : list.length ? "Нет отмеченных заказов по фильтру." : "Нет заказов по фильтру. Отметьте начало работ в карточке или справа."}</div>`;
    return `<div class="tl-nav" id="tl-nav">
      <div class="tl-nav-meta">
        <span>весь период · ${esc(calFmtRange(full.from, full.to))} · ${full.span} дн.</span>
        <span id="tl-nav-meta-view">видно ${n} дн. · ${esc(calFmtRange(win.from, win.to))}</span>
      </div>
      <div class="tl-nav-track" id="tl-nav-track" data-tl-nav="track" style="--lanes:${laneCount}">
        ${ticks}
        <div class="tl-nav-bars">${navBars}</div>
        ${todayNav}
        <div class="tl-nav-shade left" id="tl-nav-shade-l" style="width:${box.left}%"></div>
        <div class="tl-nav-shade right" id="tl-nav-shade-r" style="left:${box.left + box.width}%;width:${Math.max(0, 100 - box.left - box.width)}%"></div>
        <div class="tl-nav-view" id="tl-nav-view" data-tl-nav="view" style="left:${box.left}%;width:${box.width}%">
          <i class="tl-nav-h start" data-tl-nav="start"></i>
          <i class="tl-nav-h end" data-tl-nav="end"></i>
        </div>
      </div>
    </div>
    <div class="gantt-scroll" id="gantt-scroll" style="--days:${n}">
      <div class="gantt-days">${head}<div class="gantt-day-tip" id="gantt-day-tip" hidden></div></div>
      <div class="gantt">
        <div class="gantt-body">
          <div class="gantt-grid" aria-hidden="true">${gridCols}</div>
          <div class="gantt-day-col" id="gantt-day-col" hidden></div>
          ${todayLine}
          ${rows || empty}
        </div>
      </div>
    </div>
    <div class="cal-hint hint-i">
      <button type="button" class="info-btn" title="Подсказка по таймлайну" aria-label="Подсказка по таймлайну">i</button>
      <div class="hint-i-pop" role="tooltip">
        Колесо на навигаторе — масштаб, на датах — период. Полосу двигают, края меняют даты. Стрелка — позиции. Паузы правят у позиций (Shift+клик). Shift+клик по правому краю открытой позиции переключает со следующего дня: на паузу или снова в работу. Повторный клик возвращает как было. У заказа пауза сама, если день пустой или все позиции стоят.
      </div>
    </div>`;
  }

  function renderClassicCalendar(win, list, load) {
    const cells = [];
    for (let d = win.gridFrom; d <= win.gridTo; d = addDays(d, 1)) {
      const key = dayKey(d);
      const inMonth = d.getMonth() === win.from.getMonth();
      const items = list.filter((order) => orderMarksDay(order, d) && !orderPauseHidden(order, d));
      const selectedId = calendarState().selected;
      const hit = selectedId ? items.find((order) => order.id === selectedId) : null;
      let shown = items.slice(0, 3);
      if (hit && !shown.some((order) => order.id === hit.id)) shown = [hit, ...shown.slice(0, 2)];
      const more = items.length - shown.length;
      const hot = (load.map[key] || 0) >= CAL_HOT_LOAD;
      const note = dayNote(key);
      cells.push(`<div class="cal-cell ${inMonth ? "" : "is-out"} ${dayToneClass(d)} ${note ? "has-note" : ""} ${key === dayKey(win.today) ? "is-today" : ""} ${calendarState().pick === key ? "is-pick" : ""} ${hot ? "is-hot" : ""}" data-cal-day="${key}">
        <div class="cal-cell-n">${d.getDate()}${items.length ? `<b>${items.length}</b>` : ""}</div>
        ${note ? `<div class="cal-day-memo cal-note">${esc(note)}</div>` : ""}
        ${shown.map((order) => calChipHtml(order, d)).join("")}
        ${more > 0 ? `<div class="cal-more">ещё ${more}</div>` : ""}
      </div>`);
    }
    return `<div class="cal-weekdays">${RU_WEEKDAYS.map((w, i) => `<div class="${calendarOffSettings().weekends.includes(i) ? "is-weekend" : ""}">${w}</div>`).join("")}</div>
      <div class="cal-month">${cells.join("")}</div>`;
  }

  function renderExtendedCalendar(win, list, load) {
    const cols = win.days
      .map((day) => {
        const key = dayKey(day);
        const items = list.filter((order) => orderMarksDay(order, day));
        const shown = items.filter((order) => !orderPauseHidden(order, day));
        const starts = shown.filter((order) => firstWorkDayKey(order) === key && !boardDayPaused(order, day));
        const ends = shown.filter((order) => {
          const end = dateDay(order.work_end);
          const start = firstWorkDayKey(order);
          return end === key && end !== start && !boardDayPaused(order, day);
        });
        const paused = shown.filter((order) => boardDayPaused(order, day));
        const running = shown.filter((order) => !boardDayPaused(order, day) && firstWorkDayKey(order) !== key && dateDay(order.work_end) !== key);
        const n = load.map[key] || 0;
        const pct = Math.min(100, (n / Math.max(CAL_HOT_LOAD, load.peak || 1)) * 100);
        const note = dayNote(key);
        const heads = weekColumnHeads(day);
        const chip = (order) => `${calChipHtml(order, day, { week: true })}${weekLinesHtml(order, day)}`;
        return `<div class="cal-col ${dayToneClass(day)} ${note ? "has-note" : ""} ${key === dayKey(win.today) ? "is-today" : ""} ${calendarState().pick === key ? "is-pick" : ""} ${n >= CAL_HOT_LOAD ? "is-hot" : ""}" data-cal-day="${key}">
          <div class="cal-col-pin">
            <div class="cal-col-head">
              <strong>${RU_WEEKDAYS[(day.getDay() + 6) % 7]}</strong>
              <span>${calFmtDay(day)}</span>
              <em>${n} зак.</em>
            </div>
            <div class="cal-load"><i style="width:${pct}%"></i></div>
            ${note ? `<div class="cal-day-memo cal-note">${esc(note)}</div>` : ""}
          </div>
          <div class="cal-col-body">
            ${starts.length ? `${boardRoleSec("role-start", "Старт")}${starts.map(chip).join("")}` : ""}
            ${running.length ? `${boardRoleSec(heads.midClass, heads.mid)}${running.map(chip).join("")}` : ""}
            ${paused.length ? `${boardRoleSec("role-pause", heads.pause)}${paused.map(chip).join("")}` : ""}
            ${ends.length ? `${boardRoleSec("role-done", "Финиш")}${ends.map(chip).join("")}` : ""}
            ${shown.length ? "" : `<div class="cal-col-empty">пусто</div>`}
          </div>
        </div>`;
      })
      .join("");
    return `<div class="cal-week">${cols}</div>`;
  }

  function calSelectedClass(id, lineId = "") {
    const cal = calendarState();
    if (lineId) return cal.selected === id && cal.selectedLine === lineId ? "is-selected" : "";
    return cal.selected === id && !cal.selectedLine ? "is-selected" : "";
  }

  function renderCalendarSide(win, all, list) {
    const cal = calendarState();
    const selected = findOrder(cal.selected);
    const today = win.today;
    const pausedNow = all.filter((order) => orderIsPausedNow(order, today));
    const now = all.filter((order) => workStatus(order) === "now" && !orderIsPausedNow(order, today));
    const nodate = all.filter((order) => workStatus(order) === "nodate");
    const pick = cal.pick ? parseDay(cal.pick) : null;
    const pickItems = pick
      ? all.filter((order) => orderMarksDay(order, pick) && !orderPauseHidden(order, pick))
      : [];
    const selectedLine = selected && cal.selectedLine ? findCalendarLine(selected, cal.selectedLine) : null;
    const workTarget = selectedLine ? lineWorkProxy(selected, selectedLine) : selected;
    const due = workTarget ? orderDeadline(workTarget, today) : null;
    const pauses = selectedLine ? workPauses(workTarget) : workPauses(selected || {});
    const inheritLine = !!(selectedLine && !dateDay(selectedLine.work_start) && !dateDay(selectedLine.work_end));
    const pauseList = pauses.length
      ? `<div class="cal-pauses">${pauses
          .map((pause, i) => {
            const from = parseDay(pause.start);
            const open = pauseIsOpen(workTarget, pause);
            const till = parseDay(pauseEndKey(workTarget, pause, today));
            const label = !from
              ? ""
              : open
                ? `${calFmtDay(from)} — идёт`
                : till && pause.start !== pauseEndKey(workTarget, pause, today)
                  ? `${calFmtDay(from)} — ${calFmtDay(till)}`
                  : calFmtDay(from);
            return `<div class="cal-pause-row">
              <span>Пауза ${esc(label)}</span>
              ${
                selectedLine
                  ? `<button type="button" class="btn small" data-cal-act="remove-pause" data-pause-i="${i}">Снять</button>`
                  : `<small class="cal-pause-auto">из позиций</small>`
              }
            </div>`;
          })
          .join("")}</div>`
      : selected && !selectedLine
        ? `<div class="cal-pause-note">Паузы заказа считаются сами: пустой день или все позиции на паузе.</div>`
        : "";
    const lineIdx = selectedLine ? calendarWorkLines(selected).findIndex((line) => line.id === selectedLine.id) : -1;
    const sel = selected
      ? `<div class="cal-sel">
          <div class="cal-sel-head">
            <b>${esc(orderNum(selected))} ${esc(orderTitle(selected))}</b>
            <span class="work-pill work-pill-${esc(workStatusMeta(workTarget).id)}">${esc(workStatusMeta(workTarget).label)}</span>
          </div>
          <div class="cal-sel-sub">${
            selectedLine
              ? `позиция · ${esc(lineWorkName(selectedLine, Math.max(0, lineIdx)))}${inheritLine ? " · как у заказа" : ""}`
              : `${esc(selected.customer || "без заказчика")}${workDurationDays(selected) ? ` · ${workDurationDays(selected)} дн.` : ""}`
          }</div>
          ${due ? `<div class="cal-due-line">Дедлайн ${esc(calFmtDay(due, true))}</div>` : ""}
          ${
            selectedLine
              ? `<label class="cal-line-note">Комментарий к позиции
                  <textarea id="cal-line-note" data-cal-line-note rows="3" maxlength="2000" placeholder="Что важно по этой позиции">${esc(selectedLine.notes || "")}</textarea>
                </label>`
              : `<label class="cal-line-note">Комментарий к заказу
                  <textarea id="cal-order-note" data-cal-order-note rows="3" maxlength="2000" placeholder="Комментарий, договорённости, детали…">${esc(selected.notes || "")}</textarea>
                </label>`
          }
          <div class="cal-dates">
            <div class="field"><label>Начало</label><input type="date" data-cal-field="work_start" value="${esc(dateDay(workTarget.work_start))}" /></div>
            <div class="field"><label>Конец</label><input type="date" data-cal-field="work_end" value="${esc(dateDay(workTarget.work_end))}" /></div>
          </div>
          ${pauseList}
          <div class="cal-actions">
            <button type="button" class="btn small primary" data-cal-act="start-today">Начать сегодня</button>
            <button type="button" class="btn small" data-cal-act="end-today">Закончить сегодня</button>
            <button type="button" class="btn small" data-cal-act="shift-left" title="Сдвинуть на день назад">−1 день</button>
            <button type="button" class="btn small" data-cal-act="shift-right" title="Сдвинуть на день вперёд">+1 день</button>
            ${
              selectedLine
                ? `<button type="button" class="btn small" data-cal-act="reset-line" title="Вернуть срок позиции к сроку заказа">Как у заказа</button>`
                : `<button type="button" class="btn small" data-cal-act="fill-lines" title="Взять крайние даты позиций">С дат позиций</button>`
            }
            <button type="button" class="btn small" data-cal-act="clear">${selectedLine ? "Сбросить позицию" : "Снять даты"}</button>
            <button type="button" class="btn small" data-cal-act="open">Открыть заказ</button>
          </div>
        </div>`
      : "";
    const pickOff = pick ? isWeekend(pick) : false;
    const pickKey = pick ? dayKey(pick) : "";
    const offSets = calendarOffSettings();
    const pickMark = !pick
      ? ""
      : offSets.offDays.includes(pickKey)
        ? " · выходной точечно"
        : offSets.workDays.includes(pickKey)
          ? " · рабочий точечно"
          : pickOff
            ? " · выходной"
            : "";
    const pickPaused = workTarget && pick && isPaused(workTarget, pick);
    const pickCanPause = !!(selectedLine && workTarget && pick && pauseInEnvelope(workTarget, pick));
    const pickBlock = pick
      ? `<div class="cal-block">
          <h3>${esc(calFmtDay(pick, true))}${pickMark}${pickItems.length >= CAL_HOT_LOAD ? " · перегруз" : ""}</h3>
          <div class="cal-actions">
            <button type="button" class="btn small" data-cal-act="toggle-off">${pickOff ? "Сделать рабочим" : "Сделать выходным"}</button>
            <button type="button" class="btn small" data-cal-act="pick-start" ${selected ? "" : "disabled"}>Старт выбранного</button>
            <button type="button" class="btn small" data-cal-act="pick-end" ${selected ? "" : "disabled"}>Финиш выбранного</button>
            <button type="button" class="btn small" data-cal-act="${pickPaused ? "remove-pause-day" : "add-pause"}" ${pickCanPause ? "" : "disabled"} title="${selectedLine ? "" : "Паузу ставят на позиции"}">${pickPaused && selectedLine ? "Убрать паузу" : "Пауза в этот день"}</button>
          </div>
          <div class="field cal-day-note"><label>Заметка</label><textarea rows="3" data-cal-note="${esc(pickKey)}" placeholder="Что в этот день">${esc(dayNote(pickKey))}</textarea></div>
          ${pickPaused ? `<div class="cal-pause-note">Выбранный заказ на паузе</div>` : ""}
          ${pickItems.length ? pickItems.map((order) => calChipHtml(order, pick)).join("") : pickPaused ? "" : `<div class="cal-col-empty">в этот день никто не отмечен</div>`}
        </div>`
      : "";
    const listBlock = (title, items, empty) =>
      `<div class="cal-block"><h3>${title} <span>${items.length}</span></h3>${
        items.length ? items.map((order) => calChipHtml(order)).join("") : `<div class="cal-col-empty">${empty}</div>`
      }</div>`;
    const fillAll = nodate.some((order) => lineDateRange(order))
      ? `<button type="button" class="btn small" data-cal-act="fill-all">Подставить даты с позиций всем без дат</button>`
      : "";
    const pauseBlock = hidePausedOnBoard() ? "" : listBlock("На паузе", pausedNow, "Нет заказов на паузе.");
    return `<div class="cal-side-body">${sel}${pickBlock}
      ${pauseBlock}
      ${listBlock("В работе", now, "Нет заказов в работе — поставьте дату начала.")}
      <div class="cal-block"><h3>Без дат <span>${nodate.length}</span></h3>${fillAll}${
        nodate.length ? nodate.map((order) => calChipHtml(order)).join("") : `<div class="cal-col-empty">Все заказы размечены.</div>`
      }</div></div>
      <div class="cal-side-hint hint-i">
        <button type="button" class="info-btn" aria-label="Подсказка по доске">i</button>
        <div class="hint-i-pop" role="tooltip">Выберите заказ на доске — здесь можно поставить старт и финиш, сдвинуть или открыть карточку. Паузы правят у позиций; у заказа они собираются сами. Стрелка на таймлайне раскрывает позиции.</div>
      </div>`;
  }

  function weekendMenuHtml() {
    const off = calendarOffSettings();
    const days = RU_WEEKDAYS.map(
      (name, i) =>
        `<button type="button" class="btn ${off.weekends.includes(i) ? "active" : ""}" data-cal-weekend="${i}" role="menuitemcheckbox" aria-checked="${off.weekends.includes(i)}">${esc(name)}</button>`
    ).join("");
    return `<div class="cal-weekend-label">Дни недели</div>
      <div class="cal-weekend-days">${days}</div>
      <div class="cal-weekend-hint">Отдельный день — клик по дате справа: «Сделать выходным» или «Сделать рабочим».</div>`;
  }

  function commitCalendarOff(patch, toastText) {
    historyCommit();
    writeCalendarOff(patch);
    persistCalendar();
    historyCommit();
    markDirty();
    renderCalendar();
    if (toastText) toast(toastText);
  }

  function toggleWeekdayWeekend(wd) {
    if (!Number.isInteger(wd) || wd < 0 || wd > 6) return;
    const off = calendarOffSettings();
    const weekends = off.weekends.includes(wd) ? off.weekends.filter((x) => x !== wd) : off.weekends.concat(wd).sort((a, b) => a - b);
    commitCalendarOff({ weekends }, weekends.includes(wd) ? `${RU_WEEKDAYS[wd]} — выходной` : `${RU_WEEKDAYS[wd]} — рабочий`);
  }

  function setPointDay(key, kind) {
    const d = parseDay(key);
    if (!d) {
      toast("Выберите дату");
      return;
    }
    const iso = dayKey(d);
    const off = calendarOffSettings();
    const offDays = new Set(off.offDays);
    const workDays = new Set(off.workDays);
    const recurring = off.weekends.includes(weekdayIndex(d));
    if (kind === "off") {
      workDays.delete(iso);
      if (recurring) commitCalendarOff({ offDays: [...offDays], workDays: [...workDays] }, "Выходной");
      else {
        offDays.add(iso);
        commitCalendarOff({ offDays: [...offDays].sort(), workDays: [...workDays].sort() }, "Выходной на дату");
      }
    } else {
      offDays.delete(iso);
      if (!recurring) commitCalendarOff({ offDays: [...offDays], workDays: [...workDays] }, "Рабочий день");
      else {
        workDays.add(iso);
        commitCalendarOff({ offDays: [...offDays].sort(), workDays: [...workDays].sort() }, "Рабочий на дату");
      }
    }
  }

  function togglePickedOffDay(key) {
    const d = parseDay(key);
    if (!d) return;
    setPointDay(dayKey(d), isWeekend(d) ? "work" : "off");
  }

  function calendarPlanText() {
    const win = calendarWindow();
    const all = calendarOrdersAll();
    const now = all.filter((order) => workStatus(order) === "now");
    const lines = [`План работ ${win.title}`, ""];
    lines.push(`Сейчас в работе (${now.length}):`);
    if (now.length) now.forEach((order) => lines.push(`• ${orderNum(order)} ${orderTitle(order)} — ${order.customer || "без заказчика"}`));
    else lines.push("• нет");
    lines.push("");
    win.days.forEach((day) => {
      const key = dayKey(day);
      const starts = all.filter((order) => dateDay(order.work_start) === key);
      const ends = all.filter((order) => dateDay(order.work_end) === key);
      const load = all.filter((order) => orderCoversDay(order, day) && workStatus(order) !== "cancelled").length;
      if (!starts.length && !ends.length) return;
      lines.push(`${calFmtDay(day, true)} · ${load} в работе`);
      starts.forEach((order) => lines.push(`  старт  ${orderNum(order)} ${orderTitle(order)}`));
      ends.forEach((order) => lines.push(`  финиш ${orderNum(order)} ${orderTitle(order)}`));
    });
    return lines.join("\n");
  }

  function calendarSelect(id, lineId = "") {
    const cal = calendarState();
    const nextLine = lineId || "";
    if (cal.selected === id && (cal.selectedLine || "") === nextLine) {
      cal.selected = "";
      cal.selectedLine = "";
      renderCalendar();
      return;
    }
    cal.selected = id;
    cal.selectedLine = nextLine;
    const order = findOrder(id);
    if (!order) {
      renderCalendar();
      return;
    }
    const line = findCalendarLine(order, lineId);
    if (cal.followOrder === false) {
      renderCalendar();
      return;
    }
    revealOrderOnCalendar(line ? lineWorkProxy(order, line) : order);
  }

  /** target — заказ или прокси позиции ({work_start, work_end}). */
  function revealOrderOnCalendar(target) {
    const cal = calendarState();
    const start = parseDay(target.work_start) || parseDay(target.work_end);
    if (start) {
      if (cal.mode === "timeline") {
        clampTimelineView();
        const to = addDays(cal.viewFrom, cal.viewDays - 1);
        if (start < cal.viewFrom || start > to) {
          cal.viewFrom = addDays(start, -Math.floor((cal.viewDays - 1) * 0.2));
          clampTimelineView();
        }
        cal.anchor = start;
      } else {
        const win = calendarWindow();
        if (start < win.from || start > win.to) {
          if (cal.mode === "classic") cal.anchor = new Date(start.getFullYear(), start.getMonth(), 1);
          else cal.anchor = mondayOf(start);
        }
      }
      cal.pick = dayKey(start);
      cal.revealDay = dayKey(start);
    }
    renderCalendar();
  }

  function applyCalendarOrder(mutator, { toastText, stay = false } = {}) {
    const cal = calendarState();
    const order = findOrder(cal.selected);
    if (!order) {
      toast("Сначала выберите заказ");
      return;
    }
    const line = cal.selectedLine ? findCalendarLine(order, cal.selectedLine) : null;
    historyCommit();
    if (line) {
      const proxy = lineWorkProxy(order, line);
      mutator(proxy);
      writeLineWork(order, line, proxy);
    } else {
      mutator(order);
      normalizeWorkDates(order);
    }
    historyCommit();
    markDirty();
    if (stay) renderCalendar();
    else revealOrderOnCalendar(line ? lineWorkProxy(order, line) : order);
    if (toastText) toast(toastText);
  }

  function onCalClick(e) {
    if (calPickerBlockClick) {
      calPickerBlockClick = false;
      return;
    }
    const onTools = e.target.closest(".cal-tools");
    if (calSkipClick) {
      calSkipClick = false;
      if (!onTools) return;
    }
    if (e.target.closest("textarea, [data-cal-note]")) return;
    const mode = e.target.closest("[data-cal-mode]");
    if (mode) {
      const cal = calendarState();
      cal.mode = mode.dataset.calMode;
      persistCalendar();
      markDirty();
      historyCommit();
      renderCalendar();
      return;
    }
    if (e.target.closest("#btn-cal-filter")) {
      const menu = $("cal-filter-menu");
      const btn = $("btn-cal-filter");
      if (!menu) return;
      closeWeekendMenu();
      const open = menu.hidden;
      menu.hidden = !open;
      btn?.setAttribute("aria-expanded", String(open));
      return;
    }
    if (e.target.closest("#btn-cal-colors")) {
      const menu = $("cal-color-menu");
      const btn = $("btn-cal-colors");
      if (!menu) return;
      closeCalFilter();
      closeWeekendMenu();
      if (!menu.hidden) return;
      menu.hidden = false;
      btn?.setAttribute("aria-expanded", "true");
      calColorTheme = currentTheme();
      menu.innerHTML = calColorMenuHtml();
      placeCalColorMenu();
      return;
    }
    if (e.target.closest("#cal-color-menu")) {
      if (e.target.closest("[data-cal-color-close]")) {
        closeColorMenu();
        return;
      }
      const themeBtn = e.target.closest("[data-cal-color-theme]");
      if (themeBtn) {
        calColorTheme = themeBtn.dataset.calColorTheme === "dark" ? "dark" : "light";
        renderCalendar();
        return;
      }
      const profileBtn = e.target.closest("[data-cal-color-profile]");
      if (profileBtn && !e.target.closest("[data-cal-color-del]")) {
        assignCalProfile(calColorEditorTheme(), profileBtn.dataset.calColorProfile);
        renderCalendar();
        return;
      }
      const delBtn = e.target.closest("[data-cal-color-del]");
      if (delBtn) {
        deleteCalProfile(delBtn.dataset.calColorDel);
        renderCalendar();
        return;
      }
      const slotBtn = e.target.closest("[data-cal-color-slot]");
      if (slotBtn) {
        calColorSlot = slotBtn.dataset.calColorSlot || "paid";
        renderCalendar();
        return;
      }
      const swatch = e.target.closest("[data-cal-color-swatch]");
      if (swatch) {
        paintCalColor(calColorEditorTheme(), calColorSlot, swatch.dataset.calColorSwatch);
        renderCalendar();
        return;
      }
      if (e.target.closest("[data-cal-color-save]")) {
        saveCalProfile(calColorName || $("cal-color-name")?.value);
        renderCalendar();
        return;
      }
      if (e.target.closest("[data-cal-color-update]")) {
        updateCalProfile(e.target.closest("[data-cal-color-update]").dataset.calColorUpdate);
        renderCalendar();
        return;
      }
      if (e.target.closest("[data-cal-color-reset]")) {
        resetCalTheme(calColorEditorTheme());
        renderCalendar();
        return;
      }
      return;
    }
    if (e.target.closest("#btn-cal-weekends")) {
      const menu = $("cal-weekend-menu");
      const btn = $("btn-cal-weekends");
      if (!menu) return;
      closeCalFilter();
      const open = menu.hidden;
      menu.hidden = !open;
      btn?.setAttribute("aria-expanded", String(open));
      return;
    }
    const weekendDay = e.target.closest("[data-cal-weekend]");
    if (weekendDay) {
      toggleWeekdayWeekend(Number(weekendDay.dataset.calWeekend));
      return;
    }
    const filter = e.target.closest("[data-cal-filter]");
    if (filter) {
      calendarState().filter = filter.dataset.calFilter;
      persistCalendar();
      markDirty();
      historyCommit();
      renderCalendar();
      return;
    }
    if (e.target.closest("#cal-prev")) {
      calendarShift(-1);
      return;
    }
    if (e.target.closest("#cal-next")) {
      calendarShift(1);
      return;
    }
    if (e.target.closest("#cal-today")) {
      goTimelineToday();
      renderCalendar();
      return;
    }
    if (e.target.closest("#cal-pick-day")) {
      const pick = calendarState().pick;
      if (!pick || !goCalendarDay(pick)) {
        toast("Сначала выделите день");
        return;
      }
      renderCalendar();
      return;
    }
    if (e.target.closest("#cal-follow")) {
      const cal = calendarState();
      cal.followOrder = cal.followOrder === false;
      persistPref(LS_CAL_FOLLOW, JSON.stringify(cal.followOrder !== false), { now: true });
      renderCalendar();
      return;
    }
    if (e.target.closest("#cal-hide-pause")) {
      const cal = calendarState();
      cal.hidePause = cal.hidePause === false;
      persistPref(LS_CAL_HIDE_PAUSE, JSON.stringify(cal.hidePause !== false), { now: true });
      renderCalendar();
      return;
    }
    if (e.target.closest("#cal-copy")) {
      cashCopy(calendarPlanText(), "План работ скопирован");
      return;
    }
    const noteBtn = e.target.closest("[data-cal-note]");
    if (noteBtn) {
      e.preventDefault();
      e.stopPropagation();
      const cal = calendarState();
      cal.selected = noteBtn.dataset.calNote || "";
      cal.selectedLine = noteBtn.dataset.calNoteLine || "";
      renderCalendar();
      requestAnimationFrame(() => $("cal-line-note")?.focus());
      return;
    }
    const actBtn = e.target.closest("[data-cal-act]");
    if (actBtn) {
      onCalendarAct(actBtn.dataset.calAct, actBtn);
      return;
    }
    const expand = e.target.closest("[data-cal-expand]");
    if (expand) {
      toggleCalendarLines(expand.dataset.calExpand);
      return;
    }
    const pauseBar = e.target.closest(".gantt-bar.is-pause");
    if (pauseBar) {
      const order = findOrder(pauseBar.dataset.calId);
      const lineId = pauseBar.dataset.calLine || "";
      const index = Number(pauseBar.dataset.pauseI);
      if (e.detail === 2 && e.shiftKey && order && lineId && Number.isInteger(index)) {
        calendarState().selected = order.id;
        calendarState().selectedLine = lineId;
        applyCalendarOrder(
          (item) => {
            removePauseAt(item, index);
          },
          { toastText: "Пауза снята", stay: true }
        );
        return;
      }
      calendarSelect(pauseBar.dataset.calId, lineId);
      return;
    }
    const workBar = e.target.closest(".gantt-bar[data-cal-id]");
    if (workBar && e.shiftKey) {
      const order = findOrder(workBar.dataset.calId);
      const lineId = workBar.dataset.calLine || "";
      if (!lineId) {
        toast("Паузу ставят на позиции — у заказа она считается сама");
        calendarSelect(workBar.dataset.calId, "");
        return;
      }
      const track = workBar.closest(".gantt-track");
      const day = track ? calDayFromPoint(track, e.clientX, calendarWindow().days) : null;
      if (order && day) {
        calendarState().selected = order.id;
        calendarState().selectedLine = lineId;
        calendarState().pick = dayKey(day);
        let added = false;
        applyCalendarOrder(
          (item) => {
            added = addWorkPause(item, day);
          },
          { stay: true }
        );
        toast(added ? "Пауза" : "Пауза уже есть или день вне срока");
      }
      return;
    }
    const chip = e.target.closest("[data-cal-id]");
    if (chip) {
      if (e.detail === 2 && !chip.dataset.calLine) {
        gotoOrder(chip.dataset.calId);
        return;
      }
      calendarSelect(chip.dataset.calId, chip.dataset.calLine || "");
      return;
    }
    const day = e.target.closest("[data-cal-day]");
    if (day) {
      const cal = calendarState();
      cal.pick = cal.pick === day.dataset.calDay ? "" : day.dataset.calDay;
      renderCalendar();
    }
  }

  function onCalendarAct(act, btn) {
    const cal = calendarState();
    if (act === "fill-all") {
      historyCommit();
      let n = 0;
      calendarOrdersAll().forEach((order) => {
        if (workStatus(order) !== "nodate") return;
        if (fillWorkFromLines(order)) n += 1;
      });
      if (n) {
        historyCommit();
        markDirty();
      }
      renderCalendar();
      toast(n ? `Даты подставлены у ${n} зак.` : "У заказов без дат нет дат позиций");
      return;
    }
    if (act === "open") {
      if (cal.selected) gotoOrder(cal.selected);
      return;
    }
    if (act === "toggle-off") {
      if (!cal.pick) return;
      togglePickedOffDay(cal.pick);
      return;
    }
    if (act === "pick-start" || act === "pick-end") {
      if (!cal.pick) return;
      applyCalendarOrder((order) => {
        if (act === "pick-start") order.work_start = cal.pick;
        else order.work_end = cal.pick;
        normalizeWorkDates(order);
      });
      return;
    }
    if (act === "add-pause") {
      if (!cal.pick) return;
      if (!cal.selectedLine) {
        toast("Паузу ставят на позиции — у заказа она считается сама");
        return;
      }
      let added = false;
      applyCalendarOrder(
        (order) => {
          added = addWorkPause(order, cal.pick);
        },
        { stay: true }
      );
      toast(added ? "Пауза" : "Пауза уже есть или день вне срока");
      return;
    }
    if (act === "remove-pause-day") {
      if (!cal.pick) return;
      if (!cal.selectedLine) {
        toast("Паузу снимают у позиции");
        return;
      }
      applyCalendarOrder(
        (order) => {
          removePauseCovering(order, cal.pick);
        },
        { toastText: "Пауза снята", stay: true }
      );
      return;
    }
    if (act === "remove-pause") {
      if (!cal.selectedLine) {
        toast("Паузу снимают у позиции");
        return;
      }
      const index = Number(btn?.dataset.pauseI);
      applyCalendarOrder(
        (order) => {
          removePauseAt(order, index);
        },
        { toastText: "Пауза снята", stay: true }
      );
      return;
    }
    if (act === "fill-lines") {
      calendarState().selectedLine = "";
      applyCalendarOrder((order) => {
        if (!fillWorkFromLines(order)) toast("У позиций нет дат заказа");
      });
      return;
    }
    if (act === "reset-line") {
      applyCalendarOrder(
        (item) => {
          item.work_start = "";
          item.work_end = "";
          item.work_pauses = [];
        },
        { toastText: "Позиция как у заказа", stay: true }
      );
      return;
    }
    applyCalendarOrder((order) => {
      if (act === "start-today") setWorkToday(order, "start");
      else if (act === "end-today") setWorkToday(order, "end");
      else if (act === "shift-left") shiftWorkDates(order, -1);
      else if (act === "shift-right") shiftWorkDates(order, 1);
      else if (act === "clear") {
        order.work_start = "";
        order.work_end = "";
        order.work_pauses = [];
      }
    });
  }

  function onCalChange(e) {
    if (e.target.id === "cal-month-pick" || e.target.id === "cal-year-pick") {
      const cal = calendarState();
      if (!(cal.anchor instanceof Date) || Number.isNaN(cal.anchor.getTime())) cal.anchor = dayStart(new Date());
      const month = Number($("cal-month-pick")?.value ?? cal.anchor.getMonth());
      const year = Number($("cal-year-pick")?.value ?? cal.anchor.getFullYear());
      cal.anchor = new Date(year, month, 1);
      renderCalendar();
      return;
    }
    if (e.target.dataset.calLineNote != null) {
      const cal = calendarState();
      const order = findOrder(cal.selected);
      const line = findCalendarLine(order, cal.selectedLine);
      if (!line) return;
      const next = String(e.target.value || "").slice(0, 2000);
      if ((line.notes || "") !== next) {
        historyCommit();
        line.notes = next;
        markDirty();
      }
      renderCalendar();
      return;
    }
    if (e.target.dataset.calOrderNote != null) {
      const order = findOrder(calendarState().selected);
      if (!order) return;
      order.notes = String(e.target.value || "").slice(0, 2000);
      historyCommit();
      markDirty();
      renderCalendar();
      return;
    }
    const field = e.target.dataset.calField;
    if (e.target.dataset.calNote != null) {
      historyCommit();
      setDayNote(e.target.dataset.calNote, e.target.value);
      historyCommit();
      markDirty();
      renderCalendar();
      return;
    }
    if (!field) return;
    applyCalendarOrder((order) => {
      order[field] = e.target.value;
      normalizeWorkDates(order);
    });
  }

  function calDayFromPoint(track, clientX, days) {
    const rect = track.getBoundingClientRect();
    if (!rect.width) return days[0];
    const t = Math.max(0, Math.min(0.999, (clientX - rect.left) / rect.width));
    return days[Math.floor(t * days.length)];
  }

  function onCalPointerDown(e) {
    if (e.button !== 0) return;
    const navHit = e.target.closest("[data-tl-nav]");
    if (navHit) {
      e.preventDefault();
      const full = clampTimelineView();
      const cal = calendarState();
      const track = $("tl-nav-track");
      const originDay = timelineDayFromX(track, e.clientX, full);
      calNav = {
        mode: navHit.dataset.tlNav,
        full,
        originX: e.clientX,
        originFrom: cal.viewFrom,
        originDays: cal.viewDays,
        originEnd: addDays(cal.viewFrom, cal.viewDays - 1),
        originDay,
        moved: false,
      };
      $("tl-nav-view")?.classList.add("is-drag");
      try {
        navHit.setPointerCapture(e.pointerId);
      } catch {
        /* ignore */
      }
      return;
    }
    const handle = e.target.closest("[data-cal-drag]");
    if (!handle) return;
    const mode = handle.dataset.calDrag || "";
    const bar = handle.closest(".gantt-bar[data-cal-id]");
    const order = findOrder(bar?.dataset.calId);
    if (!order) return;
    const track = handle.closest(".gantt-track");
    if (!track) return;
    const lineId = bar.dataset.calLine || "";
    const line = lineId ? findCalendarLine(order, lineId) : null;
    if (e.shiftKey && (mode === "end" || mode === "pause-end") && line) {
      const proxy = lineWorkProxy(order, line);
      const today = dayStart(new Date());
      if (!dateDay(proxy.work_end) && workStatus(proxy, today) === "now") {
        e.preventDefault();
        e.stopPropagation();
        calSkipClick = true;
        calendarState().selected = order.id;
        calendarState().selectedLine = line.id;
        let message = "";
        applyCalendarOrder(
          (item) => {
            message = toggleLineFromNextDay(item);
          },
          { stay: true }
        );
        if (message) {
          const cal = calendarState();
          const tomorrow = addDays(today, 1);
          const from = cal.viewFrom instanceof Date ? cal.viewFrom : null;
          const to = from ? addDays(from, Math.max(1, cal.viewDays || 1) - 1) : null;
          if (from && to && (tomorrow < from || tomorrow > to)) {
            cal.viewFrom = addDays(tomorrow, -Math.max(3, Math.floor((cal.viewDays || 14) * 0.55)));
            cal.anchor = cal.viewFrom;
            clampTimelineView();
            renderCalendar();
          }
          toast(message);
        }
        return;
      }
    }
    if (e.shiftKey && !mode.startsWith("pause")) return;
    if (mode.startsWith("pause") && !line) {
      toast("Паузы заказа считаются из позиций");
      return;
    }
    e.preventDefault();
    historyCommit();
    const win = calendarWindow();
    const target = line ? lineWorkProxy(order, line) : order;
    const pauseIndex = mode.startsWith("pause") ? Number(bar.dataset.pauseI) : -1;
    const pause = pauseIndex >= 0 ? workPauses(target)[pauseIndex] : null;
    calDrag = {
      order,
      line,
      target,
      bar,
      mode,
      days: win.days,
      full: win.full,
      track,
      start0: parseDay(target.work_start),
      end0: parseDay(target.work_end),
      pauses0: workPauses(target).map((item) => ({
        start: item.start,
        end: pauseEndKey(target, item),
        open: pauseIsOpen(target, item),
      })),
      pauseIndex,
      pause0: pause
        ? {
            from: parseDay(pause.start),
            till: parseDay(pauseEndKey(target, pause)),
            open: pauseIsOpen(target, pause),
          }
        : null,
      originDay: calDayFromPoint(track, e.clientX, win.days),
      moved: false,
    };
    bar.classList.add("is-drag");
    paintCalDragBar();
    showGanttDayTip(calDrag.originDay, e);
    try {
      bar.setPointerCapture(e.pointerId);
    } catch {
      try {
        handle.setPointerCapture(e.pointerId);
      } catch {
        /* ignore */
      }
    }
  }

  function paintCalDragPauseBar() {
    if (!calDrag) return;
    const { bar, days, pauseIndex } = calDrag;
    const target = calDrag.target || calDrag.order;
    const pause = workPauses(target)[pauseIndex];
    if (!bar || !pause || !days.length) return;
    const winFrom = days[0];
    const winTo = days[days.length - 1];
    let from = parseDay(pause.start);
    let till = parseDay(pauseEndKey(target, pause));
    if (!from || !till) return;
    if (from < winFrom) from = winFrom;
    if (till > winTo) till = winTo;
    if (from > till) return;
    const fromIdx = dayDiff(winFrom, from);
    const len = dayDiff(from, till) + 1;
    const n = days.length;
    bar.style.setProperty("--from", String(fromIdx));
    bar.style.setProperty("--span", String(len));
    bar.style.setProperty("--days", String(n));
    bar.style.left = `${(fromIdx / n) * 100}%`;
    bar.style.width = `${(len / n) * 100}%`;
    bar.classList.toggle("is-open-end", !dateDay(target.work_end));
  }

  function applyPauseDrag(order, day, delta) {
    const index = calDrag.pauseIndex;
    const list = workPauses(order);
    if (!list[index] || !calDrag.pause0) return;
    const env = calDrag.line ? lineDrawEnvelope(calDrag.order, calDrag.line) : orderDrawSpan(calDrag.order || order);
    if (!env) return;
    const others = calDrag.pauses0 || list;
    const prev = others[index - 1];
    const next = others[index + 1];
    let min = env.from;
    let max = env.till;
    if (prev) {
      const prevEnd = parseDay(prev.end);
      if (prevEnd) min = addDays(prevEnd, 1);
    }
    if (next) {
      const nextStart = parseDay(next.start);
      if (nextStart) max = addDays(nextStart, -1);
    }
    if (min > max) return;
    let from = calDrag.pause0.from;
    let till = calDrag.pause0.till;
    if (calDrag.mode === "pause-start") {
      from = day;
      till = calDrag.pause0.till;
    } else if (calDrag.mode === "pause-end") {
      from = calDrag.pause0.from;
      till = day;
    } else {
      const len = dayDiff(calDrag.pause0.from, calDrag.pause0.till);
      from = addDays(calDrag.pause0.from, delta);
      till = addDays(from, len);
      if (from < min) {
        from = min;
        till = addDays(from, len);
      }
      if (till > max) {
        till = max;
        from = addDays(till, -len);
      }
    }
    if (from > till) [from, till] = [till, from];
    from = clampDay(from, min, max);
    till = clampDay(till, min, max);
    if (from > till) from = till;
    list[index] = { start: dayKey(from), end: dayKey(till) };
  }

  function paintCalDragBar() {
    if (!calDrag) return;
    if (String(calDrag.mode).startsWith("pause")) {
      paintCalDragPauseBar();
      return;
    }
    const { bar, days } = calDrag;
    const target = calDrag.target || calDrag.order;
    if (!bar || !days.length) return;
    const winFrom = days[0];
    const winTo = days[days.length - 1];
    const span = orderDrawSpan(target, dayStart(new Date()));
    if (!span) return;
    const from = span.from < winFrom ? winFrom : span.from;
    const till = span.till > winTo ? winTo : span.till;
    if (from > till) return;
    const fromIdx = dayDiff(winFrom, from);
    const len = dayDiff(from, till) + 1;
    const n = days.length;
    bar.style.setProperty("--from", String(fromIdx));
    bar.style.setProperty("--span", String(len));
    bar.style.setProperty("--days", String(n));
    bar.style.left = `${(fromIdx / n) * 100}%`;
    bar.style.width = `${(len / n) * 100}%`;
    bar.classList.toggle("has-deadline", !!orderDeadline(target));
    bar.classList.toggle("is-open-end", !dateDay(target.work_end));
    bar.classList.toggle("is-live", workStatus(target) === "now");
    bar.classList.toggle("is-planned", workStatus(target) === "planned");
    const track = bar.closest(".gantt-track");
    track?.querySelectorAll(".gantt-bar").forEach((el) => {
      if (el !== bar) el.hidden = true;
    });
    if (calDrag.line) return;
    const full = calDrag.full;
    const navBars = document.querySelectorAll(`.tl-nav-bar[data-cal-id="${cssEscape(calDrag.order.id)}"]`);
    navBars.forEach((navBar, i) => {
      if (i === 0 && full) {
        const navFrom = Math.max(0, dayDiff(full.from, span.from));
        const navTill = Math.min(full.span - 1, dayDiff(full.from, span.till));
        if (navTill >= navFrom) {
          navBar.hidden = false;
          navBar.style.setProperty("--from", String(navFrom));
          navBar.style.setProperty("--len", String(navTill - navFrom + 1));
          navBar.classList.toggle("is-open-end", !dateDay(target.work_end));
          navBar.classList.toggle("has-deadline", !!orderDeadline(target));
        }
      } else navBar.hidden = true;
    });
  }

  function onCalPointerMove(e) {
    if (calNav) {
      const track = $("tl-nav-track");
      if (!track) return;
      const day = timelineDayFromX(track, e.clientX, calNav.full);
      if (!day) return;
      if (!calNav.moved && Math.abs(e.clientX - calNav.originX) < 3) return;
      calNav.moved = true;
      const cal = calendarState();
      if (calNav.mode === "view") {
        cal.viewFrom = addDays(calNav.originFrom, dayDiff(calNav.originDay, day));
        cal.viewDays = calNav.originDays;
      } else if (calNav.mode === "start") {
        let from = day;
        if (from > calNav.originEnd) from = calNav.originEnd;
        cal.viewFrom = from;
        cal.viewDays = Math.max(TL_MIN_DAYS, dayDiff(from, calNav.originEnd) + 1);
      } else if (calNav.mode === "end") {
        let end = day;
        if (end < calNav.originFrom) end = calNav.originFrom;
        cal.viewFrom = calNav.originFrom;
        cal.viewDays = Math.max(TL_MIN_DAYS, dayDiff(calNav.originFrom, end) + 1);
      } else {
        const from = day < calNav.originDay ? day : calNav.originDay;
        const to = day < calNav.originDay ? calNav.originDay : day;
        cal.viewFrom = from;
        cal.viewDays = Math.max(TL_MIN_DAYS, dayDiff(from, to) + 1);
      }
      clampTimelineView();
      paintNavView();
      return;
    }
    if (!calDrag) return;
    const day = calDayFromPoint(calDrag.track, e.clientX, calDrag.days);
    if (!day) return;
    const delta = dayDiff(calDrag.originDay, day);
    if (delta || calDrag.moved) calDrag.moved = true;
    const target = calDrag.target || calDrag.order;
    if (String(calDrag.mode).startsWith("pause")) {
      applyPauseDrag(target, day, delta);
      normalizeWorkPauses(target, false);
      paintCalDragPauseBar();
      const pause = workPauses(target)[calDrag.pauseIndex];
      const highlight =
        calDrag.mode === "pause-start"
          ? parseDay(pause?.start)
          : calDrag.mode === "pause-end"
            ? parseDay(pauseEndKey(target, pause))
            : day;
      showGanttDayTip(highlight || day, e);
      return;
    }
    if (calDrag.mode === "start") {
      target.work_start = dayKey(day);
      if (!target.work_end && calDrag.end0) target.work_end = dayKey(calDrag.end0);
    } else if (calDrag.mode === "end") {
      if (!target.work_start) target.work_start = calDrag.start0 ? dayKey(calDrag.start0) : dayKey(day);
      target.work_end = dayKey(day);
    } else {
      if (calDrag.start0) target.work_start = dayKey(addDays(calDrag.start0, delta));
      else target.work_start = dayKey(day);
      if (calDrag.end0) target.work_end = dayKey(addDays(calDrag.end0, delta));
      target.work_pauses = (calDrag.pauses0 || []).map((pause) => ({
        start: pause.start ? dayKey(addDays(parseDay(pause.start), delta)) : "",
        end: pause.open ? "" : pause.end ? dayKey(addDays(parseDay(pause.end), delta)) : "",
        open: !!pause.open,
      }));
    }
    if (calDrag.line) clampLineProxy(calDrag.order, target, calDrag);
    normalizeWorkDates(target, { mergePauses: false, lines: false });
    paintCalDragBar();
    const highlight =
      calDrag.mode === "start" ? parseDay(target.work_start) : calDrag.mode === "end" ? parseDay(target.work_end) : day;
    showGanttDayTip(highlight || day, e);
  }

  function onCalPointerUp() {
    if (calNav) {
      $("tl-nav-view")?.classList.remove("is-drag");
      const jumped = !calNav.moved && calNav.mode === "track";
      if (jumped) {
        const cal = calendarState();
        cal.viewFrom = addDays(calNav.originDay, -Math.floor((cal.viewDays - 1) / 2));
        clampTimelineView();
      }
      if (calNav.moved || jumped) {
        calSkipClick = true;
        calendarState().anchor = calendarState().viewFrom;
        calNav = null;
        renderCalendar();
        return;
      }
      calNav = null;
      return;
    }
    if (!calDrag) return;
    const bar = calDrag.bar;
    const order = calDrag.order;
    if (calDrag.moved) {
      calSkipClick = true;
      calendarState().selected = order.id;
      calendarState().selectedLine = calDrag.line?.id || "";
      if (calDrag.line) writeLineWork(order, calDrag.line, calDrag.target);
      else normalizeWorkDates(order);
      historyCommit();
      markDirty();
      calDrag = null;
      renderCalendar();
      return;
    }
    bar?.classList.remove("is-drag");
    if (bar) {
      bar.style.removeProperty("left");
      bar.style.removeProperty("width");
    }
    calDrag = null;
    showGanttDayTip(null);
  }

  function onCalWheel(e) {
    if (calendarState().mode !== "timeline") return;
    const nav = e.target.closest("#tl-nav");
    const gantt = e.target.closest("#gantt-scroll");
    if (!nav && !gantt) return;
    if (e.ctrlKey) {
      e.preventDefault();
      const delta = e.deltaY || e.deltaX;
      if (!delta) return;
      const factor = delta > 0 ? 1.14 : 0.88;
      if (nav) {
        const track = $("tl-nav-track");
        if (!track) return;
        const rect = track.getBoundingClientRect();
        const ratio = rect.width ? Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width)) : 0.5;
        timelineZoomAt(ratio, factor);
      } else {
        const box = gantt.querySelector(".gantt-days") || gantt;
        const rect = box.getBoundingClientRect();
        const ratio = rect.width ? Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width)) : 0.5;
        const cal = calendarState();
        const focus = addDays(cal.viewFrom, Math.min(Math.max(cal.viewDays - 1, 0), Math.floor(ratio * cal.viewDays)));
        timelineZoomAtFocus(focus, factor);
      }
      calendarState().anchor = calendarState().viewFrom;
      renderCalendar();
      return;
    }
    if (e.shiftKey) {
      e.preventDefault();
      timelineScrollByWheel(timelineWheelDelta(e));
      return;
    }
    const days = e.target.closest(".gantt-days");
    if (!nav && !days) return;
    e.preventDefault();
    if (nav) {
      const track = $("tl-nav-track");
      if (!track) return;
      const rect = track.getBoundingClientRect();
      const ratio = rect.width ? Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width)) : 0.5;
      timelineZoomAt(ratio, e.deltaY > 0 ? 1.14 : 0.88);
      calendarState().anchor = calendarState().viewFrom;
      renderCalendar();
      return;
    }
    timelineScrollByWheel(e.deltaX || e.deltaY);
  }

  function showGanttDayTip(day, pointer) {
    const tip = $("gantt-day-tip");
    const col = $("gantt-day-col");
    const strip = document.querySelector("#gantt-scroll .gantt-days");
    document.querySelectorAll(".gantt-day.is-hover").forEach((el) => el.classList.remove("is-hover"));
    if (!day) {
      if (tip) {
        tip.hidden = true;
        tip.classList.remove("is-follow");
        tip.style.removeProperty("top");
      }
      if (col) col.hidden = true;
      return;
    }
    const days = calDrag?.days || calendarWindow().days;
    const idx = days.length ? dayDiff(days[0], day) : -1;
    if (col) {
      if (idx >= 0 && idx < days.length) {
        col.hidden = false;
        col.style.setProperty("--col", String(idx));
      } else col.hidden = true;
    }
    const cell = strip?.querySelector(`.gantt-day[data-cal-day="${cssEscape(dayKey(day))}"]`);
    if (cell) cell.classList.add("is-hover");
    if (!tip) return;
    tip.hidden = false;
    const tone = dayToneClass(day);
    const note = dayNote(day);
    const mark =
      tone === "is-off-day"
        ? " · выходной точечно"
        : tone === "is-work-day"
          ? " · рабочий точечно"
          : tone === "is-weekend"
            ? " · выходной"
            : "";
    const extra = note ? ` · ${note.length > 80 ? `${note.slice(0, 80)}…` : note}` : "";
    tip.textContent = `${RU_WEEKDAYS_FULL[weekdayIndex(day)]}, ${calFmtDay(day, true)}${mark}${extra}`;
    const follow = !!(calDrag && pointer && Number.isFinite(pointer.clientX));
    if (follow) {
      tip.classList.add("is-follow");
      const tipW = tip.offsetWidth || 160;
      const tipH = tip.offsetHeight || 28;
      let x = pointer.clientX + 14;
      let y = pointer.clientY - tipH - 10;
      if (y < 8) y = pointer.clientY + 18;
      if (x + tipW > window.innerWidth - 8) x = pointer.clientX - tipW - 14;
      if (x < 8) x = 8;
      tip.style.left = `${x}px`;
      tip.style.top = `${y}px`;
      return;
    }
    tip.classList.remove("is-follow");
    tip.style.removeProperty("top");
    if (!strip || !cell) {
      tip.hidden = true;
      return;
    }
    const stripRect = strip.getBoundingClientRect();
    const dayRect = cell.getBoundingClientRect();
    const tipW = tip.offsetWidth || 140;
    let left = dayRect.left - stripRect.left + dayRect.width / 2;
    const pad = tipW / 2 + 6;
    left = Math.max(pad, Math.min(stripRect.width - pad, left));
    tip.style.left = `${left}px`;
  }

  function onGanttDayHover(e) {
    if (calendarState().mode !== "timeline") return;
    if (calNav || calDrag) return;
    const dayEl = e.type === "pointerleave" ? null : e.target.closest(".gantt-days .gantt-day");
    const parsed = dayEl ? parseDay(dayEl.dataset.calDay) : null;
    showGanttDayTip(parsed);
  }

  function closeCalFilter() {
    const menu = $("cal-filter-menu");
    if (menu) menu.hidden = true;
    $("btn-cal-filter")?.setAttribute("aria-expanded", "false");
  }

  function closeWeekendMenu() {
    const menu = $("cal-weekend-menu");
    if (menu) menu.hidden = true;
    $("btn-cal-weekends")?.setAttribute("aria-expanded", "false");
  }

  function closeColorMenu() {
    const menu = $("cal-color-menu");
    if (menu) menu.hidden = true;
    $("btn-cal-colors")?.setAttribute("aria-expanded", "false");
  }

  function closeCalMenus() {
    closeCalFilter();
    closeWeekendMenu();
  }

  function bindCalendar() {
    $("view-calendar")?.addEventListener("click", onCalClick);
    $("view-calendar")?.addEventListener("contextmenu", onCalContextMenu);
    $("view-calendar")?.addEventListener("change", onCalChange);
    $("view-calendar")?.addEventListener("keydown", (e) => {
      if (e.key !== "Enter") return;
      if (e.target.id === "cal-color-name") {
        e.preventDefault();
        saveCalProfile(calColorName);
        renderCalendar();
        return;
      }
      if (e.target.id === "cal-color-hex") {
        e.preventDefault();
        renderCalendar();
      }
    });
    $("view-calendar")?.addEventListener("input", (e) => {
      if (e.target.id === "cal-color-name") {
        calColorName = String(e.target.value || "").slice(0, 32);
        return;
      }
      if (e.target.id === "cal-color-hex") {
        let raw = String(e.target.value || "").trim();
        if (/^[0-9a-fA-F]{6}$/.test(raw) || /^[0-9a-fA-F]{8}$/.test(raw)) raw = `#${raw}`;
        const eight = /^#[0-9a-fA-F]{8}$/.test(raw);
        const hex = calHex(eight ? raw.slice(0, 7) : raw, "");
        if (!hex) return;
        const clean = paintCalSlot(hex, { now: false, alpha: eight ? parseInt(raw.slice(7), 16) / 255 : null });
        if (clean) syncCalPicker(clean);
        return;
      }
      const cal = calendarState();
      const order = findOrder(cal.selected);
      if (!order) return;
      if (e.target.id === "cal-line-note") {
        const line = findCalendarLine(order, cal.selectedLine);
        if (!line) return;
        line.notes = String(e.target.value || "").slice(0, 2000);
        markDirty();
        return;
      }
      if (e.target.id === "cal-order-note") {
        order.notes = String(e.target.value || "").slice(0, 2000);
        markDirty();
      }
    });
    $("view-calendar")?.addEventListener("pointerdown", (e) => {
      if (onCalColorHeadDown(e)) return;
      onCalPickerDown(e);
    });
    window.addEventListener("pointermove", moveCalPicker);
    window.addEventListener("pointerup", onCalPickerUp);
    window.addEventListener("pointercancel", onCalPickerUp);
    $("view-calendar")?.addEventListener("focusout", (e) => {
      if (e.target.id !== "cal-color-hex") return;
      setTimeout(() => {
        if (calPickerDrag) return;
        const active = document.activeElement;
        if (active && active.closest && active.closest("#cal-color-menu")) return;
        if ($("cal-color-menu") && !$("cal-color-menu").hidden) renderCalendar();
      }, 0);
    });
    $("cal-board")?.addEventListener("pointerdown", onCalPointerDown);
    $("cal-board")?.addEventListener("pointermove", onGanttDayHover);
    $("cal-board")?.addEventListener("pointerleave", onGanttDayHover);
    $("cal-board")?.addEventListener("wheel", onCalWheel, { passive: false });
    window.addEventListener("pointermove", onCalPointerMove);
    window.addEventListener("pointerup", onCalPointerUp);
    window.addEventListener("pointercancel", onCalPointerUp);
    document.addEventListener("click", (e) => {
      if (e.target.closest("#cal-filter") || e.target.closest("#cal-weekends") || e.target.closest("#cal-colors")) return;
      closeCalMenus();
    });
  }

