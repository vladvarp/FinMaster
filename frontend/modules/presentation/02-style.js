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

