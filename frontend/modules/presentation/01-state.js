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


/* bundle-seam */
})();
