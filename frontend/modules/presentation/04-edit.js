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

