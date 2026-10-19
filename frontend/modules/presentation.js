(() => {
  "use strict";

  const BLOCK_TYPES = [
    { id: "kpi", name: "KPI", ico: "◆", hint: "Крупная метрика", w: 220, h: 140, ports: [{ id: "value", name: "Значение" }, { id: "goal", name: "Цель" }] },
    { id: "metric", name: "Метрика", ico: "●", hint: "Число с подписью", w: 180, h: 110, ports: [{ id: "value", name: "Значение" }] },
    { id: "compare", name: "Сравнение", ico: "⇄", hint: "Два значения рядом", w: 280, h: 140, ports: [{ id: "a", name: "A" }, { id: "b", name: "B" }] },
    { id: "delta", name: "Динамика", ico: "Δ", hint: "Сейчас vs было", w: 240, h: 130, ports: [{ id: "now", name: "Сейчас" }, { id: "was", name: "Было" }] },
    { id: "progress", name: "Прогресс", ico: "▣", hint: "Шкала выполнения", w: 280, h: 120, ports: [{ id: "value", name: "Значение" }, { id: "max", name: "Максимум" }] },
    { id: "bars", name: "Столбцы", ico: "▥", hint: "До 4 столбцов", w: 320, h: 180, ports: [{ id: "a", name: "A" }, { id: "b", name: "B" }, { id: "c", name: "C" }, { id: "d", name: "D" }] },
    { id: "share", name: "Доля", ico: "◐", hint: "Часть от целого", w: 220, h: 140, ports: [{ id: "part", name: "Часть" }, { id: "whole", name: "Целое" }] },
    { id: "title", name: "Заголовок", ico: "T", hint: "Текст заголовка", w: 360, h: 80, ports: [] },
    { id: "note", name: "Заметка", ico: "✎", hint: "Пояснение", w: 280, h: 120, ports: [] },
    { id: "spacer", name: "Отступ", ico: "▭", hint: "Пустой блок", w: 160, h: 40, ports: [] },
  ];
  const STYLE_PRESETS = [
    {
      id: "card",
      name: "Карточка",
      swatch: "#0f172a",
      style: { fill: "auto", bg: "", bg2: "", fg: "", muted: "", accent: "", border: "", borderW: -1, radius: -1, shadow: -1, align: "start", pad: 1, weight: "bold", opacity: 1, fs: 1 },
    },
    {
      id: "glass",
      name: "Стекло",
      swatch: "#94a3b8",
      style: { fill: "glass", bg: "#ffffff", bg2: "", fg: "", muted: "#64748b", accent: "#14b8a6", border: "#cbd5e1", borderW: 1, radius: 20, shadow: 2, align: "start", pad: 1, weight: "bold", opacity: 1, fs: 1 },
    },
    {
      id: "solid",
      name: "Заливка",
      swatch: "#0f766e",
      style: { fill: "solid", bg: "#0f766e", bg2: "", fg: "#f8fafc", muted: "#99f6e4", accent: "#5eead4", border: "#0f766e", borderW: 0, radius: 18, shadow: 2, align: "start", pad: 1.05, weight: "black", opacity: 1, fs: 1.05 },
    },
    {
      id: "outline",
      name: "Контур",
      swatch: "#38bdf8",
      style: { fill: "none", bg: "", bg2: "", fg: "", muted: "", accent: "#0ea5e9", border: "#38bdf8", borderW: 2, radius: 14, shadow: 0, align: "start", pad: 1, weight: "bold", opacity: 1, fs: 1 },
    },
    {
      id: "ink",
      name: "Плакат",
      swatch: "#111827",
      style: { fill: "solid", bg: "#111827", bg2: "#1e293b", fg: "#f8fafc", muted: "#94a3b8", accent: "#f59e0b", border: "#111827", borderW: 0, radius: 8, shadow: 3, align: "start", pad: 1.1, weight: "black", opacity: 1, fs: 1.1 },
    },
    {
      id: "neon",
      name: "Неон",
      swatch: "#a855f7",
      style: { fill: "solid", bg: "#1e1b4b", bg2: "#312e81", fg: "#f5f3ff", muted: "#c4b5fd", accent: "#c084fc", border: "#a855f7", borderW: 1, radius: 22, shadow: 3, align: "center", pad: 1, weight: "black", opacity: 1, fs: 1.05 },
    },
    {
      id: "soft",
      name: "Мягкий",
      swatch: "#fef3c7",
      style: { fill: "solid", bg: "#fff7ed", bg2: "#ffedd5", fg: "#9a3412", muted: "#c2410c", accent: "#ea580c", border: "#fdba74", borderW: 1, radius: 24, shadow: 1, align: "start", pad: 1.05, weight: "bold", opacity: 1, fs: 1 },
    },
    {
      id: "bare",
      name: "Голый",
      swatch: "#e2e8f0",
      style: { fill: "none", bg: "", bg2: "", fg: "", muted: "", accent: "", border: "", borderW: 0, radius: 0, shadow: 0, align: "start", pad: 0.7, weight: "bold", opacity: 1, fs: 1 },
    },
  ];
  const PAGE_BG_PRESETS = [
    { id: "", name: "По умолч.", color: "" },
    { id: "#0b1220", name: "Ночь", color: "#0b1220" },
    { id: "#f8fafc", name: "Бумага", color: "#f8fafc" },
    { id: "#ecfeff", name: "Лёд", color: "#ecfeff" },
    { id: "#fff7ed", name: "Тёплый", color: "#fff7ed" },
    { id: "#f5f3ff", name: "Лаванда", color: "#f5f3ff" },
  ];
  const GRID = 10;
  const PAGE_W = 1200;
  const PAGE_H = 800;

  let api = null;
  const session = {
    bound: false,
    selected: "",
    drag: null,
    resize: null,
    place: 0,
    tabDrag: "",
    tabMoved: false,
    viewScale: 1,
    viewOffsetX: 0,
    viewOffsetY: 0,
    fitObs: null,
  };

  function $(id) {
    return document.getElementById(id);
  }

  function esc(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function uid() {
    return api?.uid?.() || `p${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
  }

  function blockMeta(type) {
    return BLOCK_TYPES.find((item) => item.id === type) || BLOCK_TYPES[0];
  }

  function ensurePresentation() {
    const doc = api?.doc?.();
    if (!doc) return null;
    if (!doc.ui || typeof doc.ui !== "object") doc.ui = {};
    if (!doc.ui.presentation || typeof doc.ui.presentation !== "object") {
      doc.ui.presentation = { active: "", pages: [], inspectorOpen: true, canvasLocked: false };
    }
    const pres = doc.ui.presentation;
    if (!Array.isArray(pres.pages)) pres.pages = [];
    if (!pres.pages.length) {
      const page = emptyPage("Страница 1");
      pres.pages.push(page);
      pres.active = page.id;
    }
    if (!pres.active || !pres.pages.some((p) => p.id === pres.active)) {
      pres.active = pres.pages[0].id;
    }
    if (typeof pres.inspectorOpen !== "boolean") {
      let stored = true;
      try {
        const raw = localStorage.getItem("finmaster.pres.inspector");
        if (raw === "0") stored = false;
        else if (raw === "1") stored = true;
      } catch {
        /* ignore */
      }
      pres.inspectorOpen = stored;
    }
    if (typeof pres.canvasLocked !== "boolean") {
      let locked = false;
      try {
        locked = localStorage.getItem("finmaster.pres.canvasLock") === "1";
      } catch {
        /* ignore */
      }
      pres.canvasLocked = locked;
    }
    return pres;
  }

  function inspectorIsOpen() {
    return ensurePresentation()?.inspectorOpen !== false;
  }

  function canvasIsLocked() {
    return ensurePresentation()?.canvasLocked === true;
  }

  function setInspectorOpen(open) {
    const pres = ensurePresentation();
    if (!pres) return;
    pres.inspectorOpen = !!open;
    try {
      localStorage.setItem("finmaster.pres.inspector", open ? "1" : "0");
    } catch {
      /* ignore */
    }
    applyInspectorFold();
    dirty();
    requestAnimationFrame(() => fitWorld());
  }

  function setCanvasLocked(locked) {
    const pres = ensurePresentation();
    if (!pres) return;
    pres.canvasLocked = !!locked;
    try {
      localStorage.setItem("finmaster.pres.canvasLock", locked ? "1" : "0");
    } catch {
      /* ignore */
    }
    if (locked) {
      session.selected = "";
      session.drag = null;
      session.resize = null;
    }
    applyCanvasLock();
    dirty();
    renderBoard();
    renderInspector();
  }

  function applyInspectorFold() {
    const root = $("view-presentation");
    const shell = $("pres-inspector-shell");
    const btn = root?.querySelector("[data-pres-inspector-toggle]");
    const open = inspectorIsOpen();
    root?.classList.toggle("is-inspector-collapsed", !open);
    shell?.classList.toggle("is-collapsed", !open);
    if (btn) {
      btn.setAttribute("aria-expanded", open ? "true" : "false");
      btn.title = open ? "Свернуть панель" : "Развернуть панель";
      btn.textContent = open ? "›" : "‹";
    }
  }

  function applyCanvasLock() {
    const board = $("pres-board");
    const btn = $("pres-lock-btn");
    const locked = canvasIsLocked();
    board?.classList.toggle("is-locked", locked);
    if (btn) {
      btn.classList.toggle("is-on", locked);
      btn.setAttribute("aria-pressed", locked ? "true" : "false");
      btn.title = locked ? "Разблокировать холст" : "Заблокировать выделение и перемещение";
      btn.textContent = locked ? "⊠" : "⊡";
    }
  }

  function emptyPage(name) {
    return {
      id: uid(),
      name: name || "Страница",
      w: PAGE_W,
      h: PAGE_H,
      bg: "",
      showGrid: false,
      blocks: [],
    };
  }

  function hexOk(value) {
    const color = String(value || "").trim().toLowerCase();
    return /^#[0-9a-f]{6}$/.test(color) ? color : "";
  }

  function clampNum(value, low, high, fallback) {
    const n = Number(value);
    if (!Number.isFinite(n)) return fallback;
    return Math.max(low, Math.min(high, n));
  }

  function defaultStyle() {
    return {
      preset: "card",
      fill: "auto",
      bg: "",
      bg2: "",
      fg: "",
      muted: "",
      accent: "",
      border: "",
      borderW: -1,
      radius: -1,
      shadow: -1,
      align: "start",
      pad: 1,
      weight: "bold",
      label: true,
      opacity: 1,
      fs: 1,
    };
  }

  function normalizeStyle(raw) {
    const base = defaultStyle();
    const s = raw && typeof raw === "object" ? raw : {};
    const fills = ["auto", "solid", "gradient", "glass", "none"];
    const aligns = ["start", "center", "end"];
    const weights = ["normal", "bold", "black"];
    const presets = STYLE_PRESETS.map((item) => item.id);
    return {
      preset: presets.includes(s.preset) ? s.preset : base.preset,
      fill: fills.includes(s.fill) ? s.fill : base.fill,
      bg: hexOk(s.bg),
      bg2: hexOk(s.bg2),
      fg: hexOk(s.fg),
      muted: hexOk(s.muted),
      accent: hexOk(s.accent),
      border: hexOk(s.border),
      borderW: clampNum(s.borderW, -1, 12, -1),
      radius: clampNum(s.radius, -1, 64, -1),
      shadow: clampNum(s.shadow, -1, 4, -1),
      align: aligns.includes(s.align) ? s.align : base.align,
      pad: clampNum(s.pad, 0.4, 2.4, 1),
      weight: weights.includes(s.weight) ? s.weight : base.weight,
      label: s.label !== false,
      opacity: clampNum(s.opacity, 0.15, 1, 1),
      fs: clampNum(s.fs, 0.55, 2.2, 1),
    };
  }

  function applyPreset(block, presetId) {
    const preset = STYLE_PRESETS.find((item) => item.id === presetId) || STYLE_PRESETS[0];
    block.style = normalizeStyle({ ...preset.style, preset: preset.id, label: block.style?.label !== false });
    return block.style;
  }

  function blockStyle(block) {
    if (!block.style || typeof block.style !== "object") block.style = defaultStyle();
    else block.style = normalizeStyle(block.style);
    return block.style;
  }

  function shadowCss(level) {
    if (level <= 0) return "none";
    if (level === 1) return "0 6px 18px rgba(15, 23, 42, 0.08)";
    if (level === 2) return "0 12px 28px rgba(15, 23, 42, 0.14)";
    if (level === 3) return "0 18px 40px rgba(15, 23, 42, 0.22)";
    return "0 22px 52px rgba(15, 23, 42, 0.3), 0 0 0 1px rgba(255,255,255,0.04)";
  }

  function applyShadeBox(shade, block) {
    if (!shade || !block) return;
    const meta = blockMeta(block.type);
    const style = blockStyle(block);
    const level = style.shadow >= 0 ? style.shadow : 1;
    shade.style.left = `${block.x || 0}px`;
    shade.style.top = `${block.y || 0}px`;
    shade.style.width = `${block.w || meta.w}px`;
    shade.style.height = `${block.h || meta.h}px`;
    shade.style.borderRadius = style.radius >= 0 ? `${style.radius}px` : "16px";
    shade.style.opacity = String(style.opacity);
    shade.style.boxShadow = shadowCss(level);
    shade.hidden = level <= 0;
  }

  function applyBlockStyle(el, block) {
    if (!el || !block) return;
    const style = blockStyle(block);
    const fill = style.fill === "auto" ? "solid" : style.fill;
    el.classList.remove("is-fill-solid", "is-fill-gradient", "is-fill-glass", "is-fill-none", "is-align-start", "is-align-center", "is-align-end", "is-weight-normal", "is-weight-bold", "is-weight-black", "is-nolabel");
    el.classList.add(`is-fill-${fill}`);
    el.classList.add(`is-align-${style.align}`);
    el.classList.add(`is-weight-${style.weight}`);
    if (!style.label) el.classList.add("is-nolabel");
    const set = (key, value) => {
      if (value == null || value === "") el.style.removeProperty(key);
      else el.style.setProperty(key, String(value));
    };
    set("--pres-bg", style.bg || null);
    set("--pres-bg2", style.bg2 || style.bg || null);
    set("--pres-fg", style.fg || null);
    set("--pres-muted", style.muted || null);
    set("--pres-accent", style.accent || null);
    set("--pres-border", style.border || null);
    set("--pres-bw", style.borderW >= 0 ? `${style.borderW}px` : null);
    set("--pres-radius", style.radius >= 0 ? `${style.radius}px` : null);
    set("--pres-pad", String(style.pad));
    set("--pres-opacity", String(style.opacity));
    el.style.zIndex = String(Math.max(1, block.z || 1) + (session.selected === block.id ? 1000 : 0));
    el.style.setProperty("--pres-fs", String(contentScale(block)));
    const world = el.closest(".pres-world") || $("pres-world");
    applyShadeBox(world?.querySelector(`[data-pres-shade="${CSS.escape(block.id)}"]`), block);
  }

  function contentScale(block) {
    const meta = blockMeta(block.type);
    const style = blockStyle(block);
    const sx = Math.max(0.01, (block.w || meta.w) / meta.w);
    const sy = Math.max(0.01, (block.h || meta.h) / meta.h);
    return Math.max(0.5, Math.min(3.2, Math.sqrt(sx * sy) * (style.fs || 1)));
  }

  function pageSize(page) {
    return {
      w: Math.max(400, snapGrid(page?.w || PAGE_W, 400)),
      h: Math.max(300, snapGrid(page?.h || PAGE_H, 300)),
    };
  }

  function applyPageLook(page) {
    const world = $("pres-world");
    if (!world || !page) return;
    const bg = hexOk(page.bg);
    world.classList.toggle("is-grid", !!page.showGrid);
    if (bg) world.style.setProperty("--pres-page-bg", bg);
    else world.style.removeProperty("--pres-page-bg");
  }

  function fitWorld() {
    const board = $("pres-board");
    const world = $("pres-world");
    const page = activePage();
    if (!board || !world || !page) return;
    const size = pageSize(page);
    page.w = size.w;
    page.h = size.h;
    const bw = board.clientWidth;
    const bh = board.clientHeight;
    if (bw < 1 || bh < 1) return;
    const scale = Math.min(bw / size.w, bh / size.h);
    const ox = (bw - size.w * scale) / 2;
    const oy = (bh - size.h * scale) / 2;
    session.viewScale = scale;
    session.viewOffsetX = ox;
    session.viewOffsetY = oy;
    world.style.width = `${size.w}px`;
    world.style.height = `${size.h}px`;
    world.style.transformOrigin = "0 0";
    world.style.transform = `translate(${ox}px, ${oy}px) scale(${scale})`;
    applyPageLook(page);
  }

  function viewScale() {
    return session.viewScale > 0.01 ? session.viewScale : 1;
  }

  function snapGrid(value, min = 0, max = Infinity) {
    const n = Number(value);
    if (!Number.isFinite(n)) return min;
    const snapped = Math.round(n / GRID) * GRID;
    const hi = Number.isFinite(max) ? max : Infinity;
    return Math.max(min, Math.min(hi, snapped));
  }

  function clampBlock(block, page) {
    if (!block) return block;
    const meta = blockMeta(block.type);
    const size = pageSize(page || activePage());
    block.w = snapGrid(block.w ?? meta.w, 80, size.w);
    block.h = snapGrid(block.h ?? meta.h, 40, size.h);
    const maxX = Math.max(0, size.w - block.w);
    const maxY = Math.max(0, size.h - block.h);
    block.x = snapGrid(block.x, 0, maxX);
    block.y = snapGrid(block.y, 0, maxY);
    return block;
  }

  function normalizeBlock(block, page) {
    return clampBlock(block, page);
  }

  function emptyBlock(type, point) {
    const meta = blockMeta(type);
    const page = activePage();
    session.place += 1;
    const n = session.place;
    const zMax = Math.max(0, ...(page?.blocks || []).map((b) => b.z || 1));
    return clampBlock(
      {
        id: uid(),
        type: meta.id,
        title: meta.name,
        text: meta.id === "note" ? "Текст заметки" : meta.id === "title" ? "Заголовок" : "",
        x: point?.x ?? 40 + ((n * 30) % 320),
        y: point?.y ?? 40 + ((n * 40) % 240),
        w: meta.w,
        h: meta.h,
        z: zMax + 1,
        values: {},
        labels: { a: "A", b: "B", c: "C", d: "D" },
        style: defaultStyle(),
      },
      page
    );
  }

  function activePage() {
    const pres = ensurePresentation();
    if (!pres) return null;
    return pres.pages.find((p) => p.id === pres.active) || pres.pages[0] || null;
  }

  function dirty() {
    api?.markDirty?.("Презентация");
    window.FinCalc?.refreshPresent?.();
  }

  function money(value) {
    if (api?.money) return api.money(value);
    if (value == null || !Number.isFinite(Number(value))) return "—";
    return String(Math.round(Number(value) * 100) / 100);
  }

  function fmt(value) {
    if (value == null || !Number.isFinite(Number(value))) return "—";
    const n = Number(value);
    if (Math.abs(n) >= 1000) return money(n);
    const rounded = Math.round(n * 100) / 100;
    return String(rounded);
  }

  function liveValue(block, portId) {
    const fromCalc = api?.presentValue?.(block.id, portId);
    if (fromCalc != null && Number.isFinite(Number(fromCalc))) return Number(fromCalc);
    const raw = block.values?.[portId];
    return raw != null && Number.isFinite(Number(raw)) ? Number(raw) : null;
  }

  function renderTabs(pres) {
    const host = $("pres-tabs");
    if (!host || !pres) return;
    host.innerHTML = (pres.pages || [])
      .map(
        (page) => `<div class="calc-tab ${page.id === pres.active ? "active" : ""}" data-pres-page="${esc(page.id)}" draggable="true" title="${esc(page.name)}">
          <span class="calc-tab-label">${esc(page.name)}</span>
          ${pres.pages.length > 1 ? `<button type="button" class="calc-tab-x" data-del-pres-page="${esc(page.id)}" title="Закрыть страницу" draggable="false">×</button>` : ""}
        </div>`
      )
      .join("");
  }

  function renderSide() {
    const host = $("pres-side");
    if (!host) return;
    host.innerHTML = `
      <div class="pres-side-top">
        <div class="calc-tools-label">Блоки</div>
        <div class="calc-tools pres-tools">
          ${BLOCK_TYPES.map(
            (item) => `<button type="button" class="btn calc-tool" data-add-pres-block="${esc(item.id)}" title="${esc(item.hint)}" draggable="true">
              <span class="pres-tool-ico" aria-hidden="true">${esc(item.ico)}</span>
              <span class="pres-tool-name">${esc(item.name)}</span>
            </button>`
          ).join("")}
        </div>
      </div>
      <div class="calc-hint hint-i pres-hint">
        <button type="button" class="info-btn" aria-label="Подсказка по блокам">i</button>
        <div class="hint-i-pop" role="tooltip">
          Перетащите блок на холст или кликните, чтобы добавить. Значения приходят из схем калькулятора.
        </div>
      </div>
    `;
  }

  function blockBodyHtml(block) {
    const type = block.type;
    const title = block.title || blockMeta(type).name;
    const showLabel = blockStyle(block).label;
    const labelHtml = showLabel ? `<div class="pres-k">${esc(title)}</div>` : "";
    if (type === "title") {
      return `<div class="pres-block-title">${esc(block.text || title)}</div>`;
    }
    if (type === "note") {
      return `<div class="pres-block-note">${showLabel ? `<b>${esc(title)}</b>` : ""}<p>${esc(block.text || "")}</p></div>`;
    }
    if (type === "spacer") {
      return `<div class="pres-block-spacer"></div>`;
    }
    if (type === "kpi") {
      const value = liveValue(block, "value");
      const goal = liveValue(block, "goal");
      return `<div class="pres-block-kpi">
        ${labelHtml}
        <div class="pres-v">${esc(fmt(value))}</div>
        ${goal != null ? `<div class="pres-sub">цель ${esc(fmt(goal))}</div>` : ""}
      </div>`;
    }
    if (type === "metric") {
      return `<div class="pres-block-metric">
        ${labelHtml}
        <div class="pres-v">${esc(fmt(liveValue(block, "value")))}</div>
      </div>`;
    }
    if (type === "compare") {
      return `<div class="pres-block-compare">
        ${labelHtml}
        <div class="pres-pair">
          <div><span>${esc(block.labels?.a || "A")}</span><b>${esc(fmt(liveValue(block, "a")))}</b></div>
          <div><span>${esc(block.labels?.b || "B")}</span><b>${esc(fmt(liveValue(block, "b")))}</b></div>
        </div>
      </div>`;
    }
    if (type === "delta") {
      const now = liveValue(block, "now");
      const was = liveValue(block, "was");
      let pct = null;
      if (now != null && was != null && was !== 0) pct = ((now - was) / Math.abs(was)) * 100;
      const up = pct != null && pct >= 0;
      return `<div class="pres-block-delta">
        ${labelHtml}
        <div class="pres-v">${esc(fmt(now))}</div>
        <div class="pres-delta ${pct == null ? "" : up ? "is-up" : "is-down"}">${pct == null ? "—" : `${up ? "+" : ""}${Math.round(pct)}%`}</div>
      </div>`;
    }
    if (type === "progress") {
      const value = liveValue(block, "value") || 0;
      const max = liveValue(block, "max");
      const denom = max != null && max > 0 ? max : 100;
      const pct = Math.max(0, Math.min(100, (value / denom) * 100));
      return `<div class="pres-block-progress">
        ${labelHtml}
        <div class="pres-progress-row"><b>${esc(fmt(value))}</b><span>${esc(fmt(denom))}</span></div>
        <div class="pres-bar"><i style="width:${pct}%"></i></div>
      </div>`;
    }
    if (type === "bars") {
      const ports = ["a", "b", "c", "d"];
      const vals = ports.map((id) => liveValue(block, id)).filter((v) => v != null);
      const peak = Math.max(1, ...vals.map((v) => Math.abs(v)));
      return `<div class="pres-block-bars">
        ${labelHtml}
        <div class="pres-cols">
          ${ports
            .map((id) => {
              const v = liveValue(block, id);
              if (v == null) return "";
              const h = Math.max(6, Math.round((Math.abs(v) / peak) * 100));
              return `<div class="pres-col"><i style="height:${h}%"></i><span>${esc(block.labels?.[id] || id.toUpperCase())}</span></div>`;
            })
            .join("")}
        </div>
      </div>`;
    }
    if (type === "share") {
      const part = liveValue(block, "part");
      const whole = liveValue(block, "whole");
      const pct = part != null && whole != null && whole !== 0 ? (part / whole) * 100 : null;
      return `<div class="pres-block-share">
        ${labelHtml}
        <div class="pres-share-ring" style="--p:${pct == null ? 0 : Math.max(0, Math.min(100, pct))}">
          <b>${pct == null ? "—" : `${Math.round(pct)}%`}</b>
        </div>
      </div>`;
    }
    return labelHtml || `<div class="pres-k">${esc(title)}</div>`;
  }

  function renderBoard() {
    const page = activePage();
    const world = $("pres-world");
    const name = $("pres-page-name");
    if (!world || !page) return;
    if (name && document.activeElement !== name) name.value = page.name || "";
    const blocks = [...(page.blocks || [])].sort((a, b) => (a.z || 1) - (b.z || 1));
    const shades = blocks
      .map((block) => {
        clampBlock(block, page);
        blockStyle(block);
        const meta = blockMeta(block.type);
        return `<i class="pres-shade" data-pres-shade="${esc(block.id)}" style="left:${block.x || 0}px;top:${block.y || 0}px;width:${block.w || meta.w}px;height:${block.h || meta.h}px" aria-hidden="true"></i>`;
      })
      .join("");
    const cards = blocks
      .map((block) => {
        const meta = blockMeta(block.type);
        const on = session.selected === block.id;
        return `<article class="pres-block is-${esc(block.type)} ${on ? "is-on" : ""}" data-pres-block="${esc(block.id)}" style="left:${block.x || 0}px;top:${block.y || 0}px;width:${block.w || meta.w}px;height:${block.h || meta.h}px">
          <button type="button" class="pres-x" data-del-pres-block="${esc(block.id)}" title="Удалить">×</button>
          <div class="pres-block-body">${blockBodyHtml(block)}</div>
          <i class="pres-resize" data-resize-pres="${esc(block.id)}" title="Размер"></i>
        </article>`;
      })
      .join("");
    world.innerHTML = `<div class="pres-shade-layer">${shades}</div>${cards}`;
    blocks.forEach((block) => {
      applyBlockStyle(world.querySelector(`[data-pres-block="${CSS.escape(block.id)}"]`), block);
    });
    applyPageLook(page);
    fitWorld();
  }

  function colorFallbacks() {
    return {
      bg: "#ffffff",
      bg2: "#e2e8f0",
      fg: "#0f172a",
      muted: "#64748b",
      accent: "#14b8a6",
      border: "#cbd5e1",
    };
  }

  function displayColor(style, key) {
    const s = style && typeof style === "object" ? style : {};
    if (hexOk(s[key])) return s[key];
    const fallbacks = colorFallbacks();
    if (key === "bg2") return hexOk(s.bg) || fallbacks.bg2;
    return fallbacks[key] || "#64748b";
  }

  function syncColorFields(block) {
    const host = $("pres-inspector");
    if (!host || !block) return;
    const style = blockStyle(block);
    ["bg", "bg2", "fg", "muted", "accent", "border"].forEach((key) => {
      const input = host.querySelector(`input[data-pres-style="${CSS.escape(key)}"]`);
      if (input) input.value = displayColor(style, key);
    });
  }

  function colorField(key, label, style) {
    const hex = displayColor(style, key);
    return `<label class="pres-color-field">
      <span>${esc(label)}</span>
      <span class="pres-color-wrap">
        <input type="color" data-pres-style="${esc(key)}" value="${esc(hex)}" title="${esc(label)}" />
        <button type="button" class="pres-color-clear" data-pres-style-clear="${esc(key)}" title="Сбросить">×</button>
      </span>
    </label>`;
  }

  function segBtn(group, value, current, label) {
    return `<button type="button" class="pres-seg ${current === value ? "is-on" : ""}" data-pres-style-set="${esc(group)}" data-value="${esc(value)}">${esc(label)}</button>`;
  }

  function renderInspector() {
    const host = $("pres-inspector");
    if (!host) return;
    const page = activePage();
    const block = page?.blocks?.find((item) => item.id === session.selected);
    if (!block) {
      const bg = hexOk(page?.bg) || "#e2e8f0";
      host.innerHTML = `
        <div class="pres-inspector-body">
          <div class="pres-inspector-h"><span class="pres-tool-name">Страница</span></div>
          <div class="pres-style-sec">
            <div class="pres-style-label">Фон страницы</div>
            <div class="pres-preset-row">
              ${PAGE_BG_PRESETS.map(
                (item) =>
                  `<button type="button" class="pres-page-bg ${(!page?.bg && !item.color) || page?.bg === item.color ? "is-on" : ""}" data-pres-page-bg="${esc(item.color)}" title="${esc(item.name)}" style="--sw:${esc(item.color || "#cbd5e1")}"></button>`
              ).join("")}
            </div>
            <label class="pres-color-field">
              <span>Свой цвет</span>
              <span class="pres-color-wrap">
                <input type="color" data-pres-page-field="bg" value="${esc(bg)}" />
              </span>
            </label>
            <label class="pres-check"><input type="checkbox" data-pres-page-field="showGrid" ${page?.showGrid ? "checked" : ""} /> Сетка 10px</label>
          </div>
          <div class="pres-inspector-empty" style="margin-top:12px">Выберите блок, чтобы настроить внешний вид, выравнивание и акценты.</div>
        </div>
        <div class="calc-hint hint-i pres-hint">
          <button type="button" class="info-btn" aria-label="Подсказка">i</button>
          <div class="hint-i-pop" role="tooltip">Кликните блок на холсте — справа откроется кастомизация: пресеты, цвета, тень, выравнивание.</div>
        </div>`;
      return;
    }
    const meta = blockMeta(block.type);
    const style = blockStyle(block);
    const ports = meta.ports || [];
    const tip = ports.length
      ? "Входы задаются в калькуляторе: кнопка «Презентация» → перетащите блок на схему."
      : "У этого блока нет входов из схем — это оформление страницы.";
    host.innerHTML = `
      <div class="pres-inspector-body">
        <div class="pres-inspector-h">
          <span class="pres-tool-ico" aria-hidden="true">${esc(meta.ico)}</span>
          <span class="pres-tool-name">${esc(meta.name)}</span>
        </div>
        <label class="field"><span>Подпись</span><input data-pres-field="title" value="${esc(block.title || "")}" maxlength="64" /></label>
        ${
          meta.id === "title" || meta.id === "note"
            ? `<label class="field"><span>Текст</span><textarea data-pres-field="text" rows="3" maxlength="400">${esc(block.text || "")}</textarea></label>`
            : ""
        }
        <div class="pres-style-sec">
          <div class="pres-style-label">Стиль</div>
          <div class="pres-preset-row">
            ${STYLE_PRESETS.map(
              (item) =>
                `<button type="button" class="pres-preset ${style.preset === item.id ? "is-on" : ""}" data-pres-preset="${esc(item.id)}" title="${esc(item.name)}">
                  <i style="background:${esc(item.swatch)}"></i><span>${esc(item.name)}</span>
                </button>`
            ).join("")}
          </div>
        </div>
        <div class="pres-style-sec">
          <div class="pres-style-label">Заливка</div>
          <div class="pres-seg-row">
            ${segBtn("fill", "auto", style.fill, "Авто")}
            ${segBtn("fill", "solid", style.fill, "Цвет")}
            ${segBtn("fill", "gradient", style.fill, "Градиент")}
            ${segBtn("fill", "glass", style.fill, "Стекло")}
            ${segBtn("fill", "none", style.fill, "Нет")}
          </div>
          <div class="pres-color-grid">
            ${colorField("bg", "Фон", style)}
            ${colorField("bg2", "Фон 2", style)}
            ${colorField("fg", "Текст", style)}
            ${colorField("muted", "Подпись", style)}
            ${colorField("accent", "Акцент", style)}
            ${colorField("border", "Рамка", style)}
          </div>
        </div>
        <div class="pres-style-sec">
          <div class="pres-style-label">Композиция</div>
          <div class="pres-seg-row">
            ${segBtn("align", "start", style.align, "Слева")}
            ${segBtn("align", "center", style.align, "Центр")}
            ${segBtn("align", "end", style.align, "Справа")}
          </div>
          <div class="pres-seg-row">
            ${segBtn("weight", "normal", style.weight, "Regular")}
            ${segBtn("weight", "bold", style.weight, "Bold")}
            ${segBtn("weight", "black", style.weight, "Black")}
          </div>
          <label class="pres-range"><span>Отступ</span><input type="range" min="0.4" max="2.2" step="0.05" data-pres-style="pad" value="${esc(style.pad)}" /><b>${esc(style.pad.toFixed(2))}</b></label>
          <label class="pres-range"><span>Шрифт</span><input type="range" min="0.6" max="1.8" step="0.05" data-pres-style="fs" value="${esc(style.fs)}" /><b>${esc(style.fs.toFixed(2))}</b></label>
          <label class="pres-range"><span>Скругление</span><input type="range" min="0" max="40" step="1" data-pres-style="radius" value="${esc(style.radius < 0 ? 16 : style.radius)}" /><b>${esc(String(style.radius < 0 ? 16 : style.radius))}</b></label>
          <label class="pres-range"><span>Рамка</span><input type="range" min="0" max="8" step="1" data-pres-style="borderW" value="${esc(style.borderW < 0 ? 1 : style.borderW)}" /><b>${esc(String(style.borderW < 0 ? 1 : style.borderW))}</b></label>
          <label class="pres-range"><span>Тень</span><input type="range" min="0" max="4" step="1" data-pres-style="shadow" value="${esc(style.shadow < 0 ? 1 : style.shadow)}" /><b>${esc(String(style.shadow < 0 ? 1 : style.shadow))}</b></label>
          <label class="pres-range"><span>Непрозрачность</span><input type="range" min="0.2" max="1" step="0.05" data-pres-style="opacity" value="${esc(style.opacity)}" /><b>${esc(Math.round(style.opacity * 100))}%</b></label>
          <label class="pres-check"><input type="checkbox" data-pres-style-bool="label" ${style.label ? "checked" : ""} /> Показывать подпись</label>
        </div>
        <div class="pres-style-sec">
          <div class="pres-style-label">Слой</div>
          <div class="pres-actions">
            <button type="button" class="btn" data-pres-layer="back" title="Назад">↓</button>
            <button type="button" class="btn" data-pres-layer="front" title="Вперёд">↑</button>
            <button type="button" class="btn" data-pres-dup="1" title="Дублировать">⧉</button>
            <button type="button" class="btn danger" data-del-pres-block="${esc(block.id)}" title="Удалить">×</button>
          </div>
        </div>
        ${
          ports.length
            ? `<div class="pres-ports-list">${ports
                .map((port) => {
                  const v = liveValue(block, port.id);
                  return `<div class="pres-port-row"><span>${esc(port.name)}</span><b>${esc(fmt(v))}</b></div>`;
                })
                .join("")}</div>`
            : ""
        }
      </div>
      <div class="calc-hint hint-i pres-hint">
        <button type="button" class="info-btn" aria-label="Подсказка">i</button>
        <div class="hint-i-pop" role="tooltip">${esc(tip)}</div>
      </div>
    `;
  }

  function render() {
    if (!api || api.view?.() !== "presentation") return;
    const pres = ensurePresentation();
    applyInspectorFold();
    applyCanvasLock();
    renderTabs(pres);
    renderSide();
    renderBoard();
    renderInspector();
    requestAnimationFrame(() => fitWorld());
  }

  function addPage() {
    const pres = ensurePresentation();
    if (!pres) return;
    const page = emptyPage(`Страница ${pres.pages.length + 1}`);
    pres.pages.push(page);
    pres.active = page.id;
    session.selected = "";
    dirty();
    render();
  }

  function deletePage(id) {
    const pres = ensurePresentation();
    if (!pres || (pres.pages || []).length <= 1) return;
    const page = pres.pages.find((p) => p.id === id);
    (page?.blocks || []).forEach((block) => window.FinCalc?.removePresentBlock?.(block.id));
    pres.pages = pres.pages.filter((p) => p.id !== id);
    if (pres.active === id) pres.active = pres.pages[0]?.id || "";
    session.selected = "";
    dirty();
    render();
  }

  function addBlock(type, point) {
    if (canvasIsLocked()) return;
    const page = activePage();
    if (!page) return;
    const block = emptyBlock(type, point);
    page.blocks.push(block);
    session.selected = block.id;
    dirty();
    render();
  }

  function deleteBlock(id) {
    if (canvasIsLocked()) return;
    const page = activePage();
    if (!page) return;
    window.FinCalc?.removePresentBlock?.(id);
    page.blocks = (page.blocks || []).filter((b) => b.id !== id);
    if (session.selected === id) session.selected = "";
    dirty();
    render();
  }

  function worldPoint(_page, clientX, clientY) {
    const board = $("pres-board");
    if (!board) return { x: 40, y: 40 };
    const rect = board.getBoundingClientRect();
    const scale = viewScale();
    return {
      x: (clientX - rect.left - session.viewOffsetX) / scale,
      y: (clientY - rect.top - session.viewOffsetY) / scale,
    };
  }

  function applyBlockBox(el, block) {
    if (!el || !block) return;
    const meta = blockMeta(block.type);
    el.style.left = `${block.x || 0}px`;
    el.style.top = `${block.y || 0}px`;
    el.style.width = `${block.w || meta.w}px`;
    el.style.height = `${block.h || meta.h}px`;
    applyBlockStyle(el, block);
  }

  function duplicateBlock(id) {
    if (canvasIsLocked()) return;
    const page = activePage();
    if (!page) return;
    const src = page.blocks.find((b) => b.id === id);
    if (!src) return;
    const zMax = Math.max(0, ...page.blocks.map((b) => b.z || 1));
    const copy = clampBlock(
      {
        ...JSON.parse(JSON.stringify(src)),
        id: uid(),
        x: (src.x || 0) + GRID * 2,
        y: (src.y || 0) + GRID * 2,
        z: zMax + 1,
      },
      page
    );
    page.blocks.push(copy);
    session.selected = copy.id;
    dirty();
    render();
  }

  function moveLayer(id, dir) {
    if (canvasIsLocked()) return;
    const page = activePage();
    if (!page) return;
    const block = page.blocks.find((b) => b.id === id);
    if (!block) return;
    const zs = page.blocks.map((b) => b.z || 1);
    const minZ = Math.min(...zs);
    const maxZ = Math.max(...zs);
    if (dir === "front") block.z = maxZ + 1;
    else block.z = Math.max(0, minZ - 1);
    dirty();
    renderBoard();
    renderInspector();
  }

  function refreshStyleControls(host, style) {
    host.querySelectorAll(".pres-range").forEach((row) => {
      const input = row.querySelector("input[type=range]");
      const out = row.querySelector("b");
      if (!input || !out) return;
      const key = input.dataset.presStyle;
      let val = style[key];
      if (key === "opacity") out.textContent = `${Math.round(val * 100)}%`;
      else if (key === "pad" || key === "fs") out.textContent = Number(val).toFixed(2);
      else out.textContent = String(val < 0 ? input.value : val);
    });
  }

  function bind() {
    if (session.bound) return;
    session.bound = true;
    const root = $("view-presentation");
    if (!root) return;

    root.querySelector(".calc-tabbar")?.addEventListener("click", (e) => {
      if (e.target.closest("[data-add-pres-page]")) {
        addPage();
        return;
      }
      const del = e.target.closest("[data-del-pres-page]");
      if (del) {
        e.preventDefault();
        e.stopPropagation();
        deletePage(del.dataset.delPresPage);
        return;
      }
      const tab = e.target.closest("[data-pres-page]");
      if (tab && !session.tabMoved) {
        const pres = ensurePresentation();
        if (pres) {
          pres.active = tab.dataset.presPage;
          session.selected = "";
          dirty();
          render();
        }
      }
      session.tabMoved = false;
    });

    root.addEventListener("click", (e) => {
      const lockBtn = e.target.closest("[data-pres-canvas-lock]");
      if (lockBtn) {
        e.preventDefault();
        setCanvasLocked(!canvasIsLocked());
        return;
      }
      const toggle = e.target.closest("[data-pres-inspector-toggle]");
      if (!toggle) return;
      e.preventDefault();
      setInspectorOpen(!inspectorIsOpen());
    });

    $("pres-side")?.addEventListener("click", (e) => {
      const add = e.target.closest("[data-add-pres-block]");
      if (add) addBlock(add.dataset.addPresBlock);
    });

    $("pres-side")?.addEventListener("dragstart", (e) => {
      const add = e.target.closest("[data-add-pres-block]");
      if (!add) return;
      e.dataTransfer.setData("text/pres-block", add.dataset.addPresBlock);
      e.dataTransfer.effectAllowed = "copy";
    });

    const board = $("pres-board");
    if (board && typeof ResizeObserver !== "undefined") {
      session.fitObs = new ResizeObserver(() => {
        if (api?.view?.() === "presentation") fitWorld();
      });
      session.fitObs.observe(board);
    }
    window.addEventListener("resize", () => {
      if (api?.view?.() === "presentation") fitWorld();
    });

    board?.addEventListener("dragover", (e) => {
      if ([...e.dataTransfer.types].includes("text/pres-block")) e.preventDefault();
    });
    board?.addEventListener("drop", (e) => {
      if (canvasIsLocked()) return;
      const type = e.dataTransfer.getData("text/pres-block");
      if (!type) return;
      e.preventDefault();
      const page = activePage();
      const at = worldPoint(page, e.clientX, e.clientY);
      const meta = blockMeta(type);
      const size = pageSize(page);
      addBlock(type, {
        x: snapGrid(at.x, 0, Math.max(0, size.w - meta.w)),
        y: snapGrid(at.y, 0, Math.max(0, size.h - meta.h)),
      });
    });

    board?.addEventListener("pointerdown", (e) => {
      if (e.target.closest("[data-pres-canvas-lock]")) return;
      const page = activePage();
      if (!page) return;
      if (canvasIsLocked()) return;
      const del = e.target.closest("[data-del-pres-block]");
      if (del) {
        e.preventDefault();
        deleteBlock(del.dataset.delPresBlock);
        return;
      }
      const resize = e.target.closest("[data-resize-pres]");
      if (resize && e.button === 0) {
        const block = page.blocks.find((b) => b.id === resize.dataset.resizePres);
        if (!block) return;
        clampBlock(block, page);
        session.selected = block.id;
        session.resize = {
          id: block.id,
          x: e.clientX,
          y: e.clientY,
          w: block.w || blockMeta(block.type).w,
          h: block.h || blockMeta(block.type).h,
        };
        board.setPointerCapture(e.pointerId);
        renderInspector();
        return;
      }
      const card = e.target.closest("[data-pres-block]");
      if (card && e.button === 0) {
        const block = page.blocks.find((b) => b.id === card.dataset.presBlock);
        if (!block) return;
        clampBlock(block, page);
        session.selected = block.id;
        session.drag = { id: block.id, dx: e.clientX, dy: e.clientY, ox: block.x || 0, oy: block.y || 0 };
        board.setPointerCapture(e.pointerId);
        renderBoard();
        renderInspector();
        return;
      }
      if (e.target === board || e.target.id === "pres-world" || e.target.closest(".pres-shade-layer")) {
        session.selected = "";
        renderBoard();
        renderInspector();
      }
    });

    board?.addEventListener("pointermove", (e) => {
      if (canvasIsLocked()) return;
      const page = activePage();
      if (!page) return;
      const scale = viewScale();
      const size = pageSize(page);
      if (session.drag) {
        const block = page.blocks.find((b) => b.id === session.drag.id);
        if (!block) return;
        const w = block.w || blockMeta(block.type).w;
        const h = block.h || blockMeta(block.type).h;
        block.x = snapGrid(session.drag.ox + (e.clientX - session.drag.dx) / scale, 0, Math.max(0, size.w - w));
        block.y = snapGrid(session.drag.oy + (e.clientY - session.drag.dy) / scale, 0, Math.max(0, size.h - h));
        applyBlockBox(board.querySelector(`[data-pres-block="${CSS.escape(block.id)}"]`), block);
        return;
      }
      if (session.resize) {
        const block = page.blocks.find((b) => b.id === session.resize.id);
        if (!block) return;
        const maxW = Math.max(80, size.w - (block.x || 0));
        const maxH = Math.max(40, size.h - (block.y || 0));
        block.w = snapGrid(session.resize.w + (e.clientX - session.resize.x) / scale, 80, maxW);
        block.h = snapGrid(session.resize.h + (e.clientY - session.resize.y) / scale, 40, maxH);
        applyBlockBox(board.querySelector(`[data-pres-block="${CSS.escape(block.id)}"]`), block);
      }
    });

    board?.addEventListener("pointerup", () => {
      if (session.drag || session.resize) {
        const page = activePage();
        const id = session.drag?.id || session.resize?.id;
        const block = page?.blocks?.find((b) => b.id === id);
        if (block) clampBlock(block, page);
        dirty();
        renderBoard();
      }
      session.drag = null;
      session.resize = null;
    });

    $("pres-page-name")?.addEventListener("input", (e) => {
      const page = activePage();
      if (!page) return;
      page.name = e.target.value.slice(0, 48);
      dirty();
      renderTabs(ensurePresentation());
    });

    const inspector = $("pres-inspector");
    inspector?.addEventListener("input", (e) => {
      const page = activePage();
      if (!page) return;
      const pageField = e.target.dataset.presPageField;
      if (pageField) {
        if (pageField === "showGrid") page.showGrid = !!e.target.checked;
        else if (pageField === "bg") page.bg = hexOk(e.target.value);
        dirty();
        applyPageLook(page);
        return;
      }
      const block = page.blocks?.find((b) => b.id === session.selected);
      if (!block) return;
      const field = e.target.dataset.presField;
      if (field) {
        block[field] = e.target.value;
        dirty();
        renderBoard();
        return;
      }
      const styleKey = e.target.dataset.presStyle;
      if (styleKey) {
        const style = blockStyle(block);
        let value = e.target.type === "range" ? Number(e.target.value) : hexOk(e.target.value);
        if (styleKey === "pad" || styleKey === "fs" || styleKey === "opacity") value = Number(e.target.value);
        if (styleKey === "radius" || styleKey === "borderW" || styleKey === "shadow") value = Number(e.target.value);
        style[styleKey] = value;
        style.preset = "card";
        block.style = normalizeStyle(style);
        dirty();
        const el = board?.querySelector(`[data-pres-block="${CSS.escape(block.id)}"]`);
        if (styleKey === "label") {
          renderBoard();
        } else {
          applyBlockStyle(el, block);
          if (el) {
            const body = el.querySelector(".pres-block-body");
            if (body && (styleKey === "fs" || field === "title")) {
              /* keep live typography */
            }
            if (styleKey === "fs") el.style.setProperty("--pres-fs", String(contentScale(block)));
          }
          refreshStyleControls(inspector, block.style);
        }
        return;
      }
      if (e.target.dataset.presStyleBool === "label") {
        const style = blockStyle(block);
        style.label = !!e.target.checked;
        block.style = normalizeStyle(style);
        dirty();
        renderBoard();
      }
    });

    inspector?.addEventListener("click", (e) => {
      const page = activePage();
      if (!page) return;
      const pageBg = e.target.closest("[data-pres-page-bg]");
      if (pageBg) {
        page.bg = hexOk(pageBg.dataset.presPageBg);
        dirty();
        applyPageLook(page);
        renderInspector();
        return;
      }
      const del = e.target.closest("[data-del-pres-block]");
      if (del) {
        deleteBlock(del.dataset.delPresBlock);
        return;
      }
      const preset = e.target.closest("[data-pres-preset]");
      if (preset) {
        const block = page.blocks.find((b) => b.id === session.selected);
        if (!block) return;
        applyPreset(block, preset.dataset.presPreset);
        dirty();
        renderBoard();
        renderInspector();
        return;
      }
      const setBtn = e.target.closest("[data-pres-style-set]");
      if (setBtn) {
        const block = page.blocks.find((b) => b.id === session.selected);
        if (!block) return;
        const style = blockStyle(block);
        style[setBtn.dataset.presStyleSet] = setBtn.dataset.value;
        style.preset = "card";
        block.style = normalizeStyle(style);
        dirty();
        renderBoard();
        renderInspector();
        return;
      }
      const clear = e.target.closest("[data-pres-style-clear]");
      if (clear) {
        const block = page.blocks.find((b) => b.id === session.selected);
        if (!block) return;
        const style = blockStyle(block);
        style[clear.dataset.presStyleClear] = "";
        block.style = normalizeStyle(style);
        dirty();
        applyBlockStyle(board?.querySelector(`[data-pres-block="${CSS.escape(block.id)}"]`), block);
        syncColorFields(block);
        return;
      }
      const layer = e.target.closest("[data-pres-layer]");
      if (layer) {
        moveLayer(session.selected, layer.dataset.presLayer);
        return;
      }
      if (e.target.closest("[data-pres-dup]")) {
        duplicateBlock(session.selected);
      }
    });
  }

  window.FinPresent = {
    BLOCK_TYPES,
    blockMeta,
    ensurePresentation,
    pages() {
      return ensurePresentation()?.pages || [];
    },
    findBlock(blockId) {
      for (const page of ensurePresentation()?.pages || []) {
        const block = (page.blocks || []).find((b) => b.id === blockId);
        if (block) return { page, block };
      }
      return null;
    },
    bind(next) {
      api = next;
      bind();
    },
    render(next) {
      if (next) api = next;
      render();
    },
  };
})();
