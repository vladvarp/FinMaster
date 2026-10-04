/* bundle-seam */
(() => {
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
