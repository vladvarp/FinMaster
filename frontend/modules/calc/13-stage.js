  function render() {
    if (!api || api.view() !== "calculator") {
      const panel = $("calc-present-panel");
      if (panel) panel.hidden = true;
      return;
    }
    const calc = ensureState();
    const bp = activeBlueprint();
    if (!calc || !bp) return;
    if (healLinks(bp)) dirty();
    if (session.busy) {
      applyWorld(bp);
      drawWires(bp, computeGraph(bp));
      flushOrderWrites();
      drawMinimap(bp);
      return;
    }
    rebuildPresentValues();
    let graph;
    try {
      graph = computeGraph(bp);
    } catch (err) {
      console.warn("calc render graph", err);
      graph = { values: {}, errors: new Set() };
    }
    flushOrderWrites();
    renderTabs(calc);
    renderTitle(bp);
    renderSide(bp);
    renderNodes(bp, graph);
    if (session.presentHover) setPresentHover(session.presentHover);
    const btn = $("calc-present-btn");
    btn?.classList.toggle("is-on", session.presentPanel);
    btn?.setAttribute("aria-pressed", session.presentPanel ? "true" : "false");
    renderPresentPanel();
    requestAnimationFrame(() => {
      drawWires(bp, graph);
      revealPendingFocus(bp);
      drawMinimap(bp);
    });
  }

  function presentPanelEl() {
    let el = $("calc-present-panel");
    if (el) return el;
    el = document.createElement("div");
    el.id = "calc-present-panel";
    el.className = "calc-present-panel";
    el.hidden = true;
    document.body.appendChild(el);
    el.addEventListener("pointerdown", (e) => {
      const handle = e.target.closest("[data-present-drag]");
      if (!handle || e.button !== 0) return;
      if (e.target.closest("button, details, summary, .calc-present-block")) return;
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      session.presentDrag = {
        dx: e.clientX - rect.left,
        dy: e.clientY - rect.top,
      };
      el.setPointerCapture(e.pointerId);
    });
    el.addEventListener("pointermove", (e) => {
      if (!session.presentDrag) return;
      const x = Math.max(8, Math.min(window.innerWidth - 80, e.clientX - session.presentDrag.dx));
      const y = Math.max(8, Math.min(window.innerHeight - 80, e.clientY - session.presentDrag.dy));
      el.style.left = `${x}px`;
      el.style.top = `${y}px`;
      el.style.right = "auto";
      el.dataset.moved = "1";
    });
    el.addEventListener("pointerup", () => {
      session.presentDrag = null;
    });
    el.addEventListener("pointercancel", () => {
      session.presentDrag = null;
    });
    el.addEventListener("pointerover", (e) => {
      const item = e.target.closest("[data-present-block]");
      if (!item || !el.contains(item)) return;
      if (item.dataset.presentUsed !== "1") {
        if (session.presentHover) setPresentHover("");
        return;
      }
      const blockId = item.dataset.presentBlock || "";
      if (session.presentHover === blockId) return;
      setPresentHover(blockId);
    });
    el.addEventListener("pointerout", (e) => {
      const item = e.target.closest("[data-present-block]");
      if (!item || !el.contains(item)) return;
      if (e.relatedTarget && item.contains(e.relatedTarget)) return;
      if (session.presentHover && session.presentHover === item.dataset.presentBlock) {
        setPresentHover("");
      }
    });
    el.addEventListener(
      "scroll",
      (e) => {
        if (e.target?.classList?.contains("calc-present-list")) {
          session.presentListScroll = e.target.scrollTop;
        }
      },
      true
    );
    return el;
  }

  function togglePresentPanel(force) {
    if (api?.view?.() !== "calculator") {
      hidePresentPanel();
      return;
    }
    session.presentPanel = force == null ? !session.presentPanel : !!force;
    const btn = $("calc-present-btn");
    btn?.classList.toggle("is-on", session.presentPanel);
    btn?.setAttribute("aria-pressed", session.presentPanel ? "true" : "false");
    renderPresentPanel();
  }

  function renderPresentPanel() {
    const el = presentPanelEl();
    if (!el) return;
    const show = api?.view?.() === "calculator" && session.presentPanel;
    el.hidden = !show;
    if (!session.presentPanel) {
      setPresentHover("");
      return;
    }
    if (show && !el.dataset.moved) {
      const board = $("calc-board");
      const rect = board?.getBoundingClientRect();
      if (rect) {
        el.style.left = `${Math.max(12, rect.left + 12)}px`;
        el.style.top = `${Math.max(12, rect.top + 52)}px`;
      }
    }
    const skip = new Set(["title", "note", "spacer"]);
    const pages = window.FinPresent?.pages?.() || [];
    const prevList = el.querySelector(".calc-present-list");
    if (prevList) session.presentListScroll = prevList.scrollTop;
    const scrollTop = session.presentListScroll || 0;
    if (!pages.length) {
      el.innerHTML = `<div class="calc-present-h" data-present-drag="1">Презентация <button type="button" class="calc-mini" data-close-present-panel="1" title="Закрыть">×</button></div><div class="calc-empty">Создайте страницы во вкладке «Презентация»</div>`;
      return;
    }
    el.innerHTML = `<div class="calc-present-h" data-present-drag="1"><span>Презентация</span> <button type="button" class="calc-mini" data-close-present-panel="1" title="Закрыть">×</button></div>
      <div class="calc-present-list">
        ${pages
          .map((page) => {
            const blocks = (page.blocks || []).filter((block) => !skip.has(block.type));
            return `<details class="calc-present-page" open>
              <summary>${esc(page.name || "Страница")} <span>${blocks.length}</span></summary>
              <div class="calc-present-blocks">
                ${
                  blocks.length
                    ? blocks
                        .map((block) => {
                          const meta = window.FinPresent?.blockMeta?.(block.type) || { ico: "▣", name: block.type, ports: [] };
                          const ports = meta.ports || [];
                          const usage = presentUsage(block.id);
                          const onScheme = usage.onActive > 0;
                          const onOther = !onScheme && usage.onOther > 0;
                          let status = "Не на схеме";
                          let tip = "Добавить ноду на схему";
                          if (onScheme) {
                            status = "На схеме";
                            tip = "Уже на этой схеме — наведите, чтобы подсветить";
                          } else if (onOther) {
                            status = "Другая схема";
                            tip = `Есть на: ${usage.otherNames.slice(0, 3).join(", ") || "другой схеме"}`;
                          }
                          return `<button type="button" class="calc-present-block ${onScheme ? "is-used" : ""} ${onOther ? "is-used-other" : ""}" draggable="true" data-present-block="${esc(block.id)}" data-present-page="${esc(page.id)}" data-present-used="${onScheme ? "1" : "0"}" title="${esc(tip)}">
                            <b><span class="pres-tool-ico" aria-hidden="true">${esc(meta.ico || "▣")}</span><span class="pres-tool-name">${esc(block.title || meta.name)}</span></b>
                            <span>${esc(meta.name)}${ports.length ? ` · ${ports.length} вх.` : ""}</span>
                            <em class="calc-present-badge ${onScheme ? "is-on" : ""} ${onOther ? "is-other" : ""}">${esc(status)}</em>
                          </button>`;
                        })
                        .join("")
                    : `<div class="calc-empty">Нет блоков со входами</div>`
                }
              </div>
            </details>`;
          })
          .join("")}
      </div>`;
    const nextList = el.querySelector(".calc-present-list");
    if (nextList) nextList.scrollTop = scrollTop;
  }

  function addPresentNode(pageId, blockId, point) {
    const found = window.FinPresent?.findBlock?.(blockId);
    if (!found) return;
    const bp = activeBlueprint();
    if (!bp) return;
    const existing = (bp.nodes || []).find((node) => node.type === "present" && node.blockId === blockId);
    if (existing) {
      session.selected = existing.id;
      render();
      return;
    }
    addNode("present", point || null, {
      pageId: pageId || found.page.id,
      blockId: found.block.id,
      blockType: found.block.type,
      title: found.block.title || found.block.type,
    });
  }

  function showPresentPortMenu(clientX, clientY, nodeId, portId) {
    document.querySelector(".calc-port-menu")?.remove();
    const bp = activeBlueprint();
    const node = bp?.nodes?.find((item) => item.id === nodeId && item.type === "present");
    if (!node || !node.blockId || !portId) return;
    const owner = presentOwner(node.blockId, portId, null);
    const menu = document.createElement("div");
    menu.className = "calc-port-menu";
    menu.style.left = `${clientX}px`;
    menu.style.top = `${clientY}px`;
    if (owner) {
      menu.innerHTML = `<button type="button" data-free-present="1">Освободить вход</button>
        <div class="calc-port-menu-note">Сейчас: «${esc(owner.blueprint.name || "Схема")}»</div>`;
    } else {
      menu.innerHTML = `<div class="calc-port-menu-note">Вход свободен</div>`;
    }
    document.body.appendChild(menu);
    const close = () => {
      menu.remove();
      document.removeEventListener("pointerdown", onDoc, true);
    };
    const onDoc = (ev) => {
      if (!menu.contains(ev.target)) close();
    };
    menu.addEventListener("click", (ev) => {
      if (ev.target.closest("[data-free-present]")) {
        freePresentPort(node.blockId, portId);
        close();
      }
    });
    setTimeout(() => document.addEventListener("pointerdown", onDoc, true), 0);
  }

  function recalculate() {
    session.linking = null;
    session.drag = null;
    session.pan = null;
    session.resize = null;
    session.busy = false;
    session.folds = null;
    setLinkingClass();
    const calc = ensureState();
    if (!calc) return;
    calc.blueprints.forEach((bp) => healLinks(bp));
    dirty();
    render();
  }

  function onBoardPointerDown(e) {
    const bp = activeBlueprint();
    if (!bp) return;
    if (session.jump) {
      session.jump = null;
      document.querySelectorAll(".calc-row.is-jump").forEach((el) => el.classList.remove("is-jump"));
    }
    if (e.button === 1) {
      e.preventDefault();
      session.busy = true;
      session.pan = { x: e.clientX, y: e.clientY, ox: bp.x || 0, oy: bp.y || 0 };
      $("calc-board").setPointerCapture(e.pointerId);
      return;
    }
    const del = e.target.closest("[data-del-node]");
    if (del) {
      e.preventDefault();
      e.stopPropagation();
      removeNode(del.dataset.delNode);
      return;
    }
    const unlink = e.target.closest("[data-del-link], [data-del-in-link]");
    if (unlink) {
      e.preventDefault();
      e.stopPropagation();
      if (unlink.dataset.delLink) removeLink(unlink.dataset.delLink);
      else disconnectInput(unlink.closest(".calc-node")?.dataset.node, unlink.dataset.delInLink);
      return;
    }
    if (e.target.closest(".calc-refresh, .calc-chain-move, .calc-present-btn, .calc-present-panel, .calc-board-tools, .calc-bp-name, .calc-screen-copy, .calc-minimap, .calc-mini-toggle, .calc-mini-wrap, input, textarea, select")) return;
    const resizeFormula = e.target.closest("[data-resize-formula]");
    if (resizeFormula) {
      e.preventDefault();
      e.stopPropagation();
      const id = resizeFormula.dataset.resizeFormula;
      const item = bp.nodes.find((n) => n.id === id && n.type === "formula");
      if (!item) return;
      session.selected = id;
      session.busy = true;
      session.resize = {
        id,
        axis: "w",
        dx: e.clientX,
        w: formulaWidth(item),
        min: 280,
        max: 1200,
      };
      $("calc-board").setPointerCapture(e.pointerId);
      return;
    }
    const resize = e.target.closest("[data-resize-group]");
    if (resize) {
      e.preventDefault();
      e.stopPropagation();
      const id = resize.dataset.resizeGroup;
      const item = bp.nodes.find((n) => n.id === id && n.type === "group");
      if (!item) return;
      session.selected = id;
      session.busy = true;
      session.resize = {
        id,
        dx: e.clientX,
        dy: e.clientY,
        w: Math.max(160, item.w || 320),
        h: Math.max(120, item.h || 220),
      };
      $("calc-board").setPointerCapture(e.pointerId);
      return;
    }
    const port = e.target.closest(".calc-port");
    const node = e.target.closest(".calc-node, .calc-group-chrome");
    const drag = e.target.closest("[data-drag-node]");
    if (port) {
      e.preventDefault();
      e.stopPropagation();
      const nodeId = port.closest(".calc-node")?.dataset.node;
      const io = port.dataset.io;
      const portId = port.dataset.port;
      session.selected = nodeId || "";
      session.selectedLink = "";
      const lineId = port.dataset.line || "";
      const parsed = parseLinePort(portId);
      const typed = parseTypePort(portId);
      const isMainLineOut = io === "out" && parsed && !parsed.field;
      const isMainTypeOut = io === "out" && typed && !typed.field;

      if (e.button === 2) {
        if (session.linking) {
          session.linking = null;
          setLinkingClass();
          if (bp) drawWires(bp, computeGraph(bp));
        }
        if (isMainLineOut) showLinePortMenu(e.clientX, e.clientY, nodeId, parsed.lineId);
        else if (isMainTypeOut) showTypePortMenu(e.clientX, e.clientY, nodeId, typed.typeName);
        else {
          const owner = bp?.nodes.find((item) => item.id === nodeId);
          if (owner?.type === "dashboard") showDashPortMenu(e.clientX, e.clientY, nodeId);
          else if (owner?.type === "present" && io === "in") showPresentPortMenu(e.clientX, e.clientY, nodeId, portId);
          else if (owner?.type === "order" && io === "in") showOrderInputPortMenu(e.clientX, e.clientY, nodeId, portId);
        }
        return;
      }
      if (e.button !== 0) return;
      if (io === "in" && (port.dataset.presentLock === "1" || port.dataset.orderLock === "1")) {
        if (port.dataset.orderLock === "1") {
          const ownerNode = bp?.nodes.find((item) => item.id === nodeId);
          const locked = parseLinePort(portId);
          if (ownerNode?.type === "order" && locked?.input) {
            const why = orderFieldOwner(ownerNode.orderId, locked.lineId, locked.field);
            const order = api.findOrder(ownerNode.orderId);
            const line = (order?.lines || []).find((item) => item.id === locked.lineId);
            api?.toast?.(orderFieldOwnerReason(why, line, order, locked.field) || "Вход занят");
          }
        }
        return;
      }

      if (session.linking) {
        const src = session.linking;
        if (src.reverse && io === "out" && nodeId !== src.to) {
          session.linking = null;
          finishLink(nodeId, portId, src.to, src.toPort);
          return;
        }
        if (!src.reverse && io === "in" && nodeId !== src.from) {
          session.linking = null;
          finishLink(src.from, src.fromPort, nodeId, portId);
          return;
        }
      }
      if (io === "in") {
        if (e.altKey) {
          disconnectInput(nodeId, portId);
          return;
        }
        const at = screenToWorld(e.clientX, e.clientY, bp);
        session.linking = { reverse: true, to: nodeId, toPort: portId, x: at.x, y: at.y, sx: e.clientX, sy: e.clientY };
        session.selectedLink = "";
        session.busy = true;
        $("calc-board").setPointerCapture(e.pointerId);
        drawWires(bp, computeGraph(bp));
        return;
      }
      const board = $("calc-board");
      const at = screenToWorld(e.clientX, e.clientY, bp);
      session.linking = { from: nodeId, fromPort: portId, x: at.x, y: at.y, sx: e.clientX, sy: e.clientY };
      session.selectedLink = "";
      session.busy = true;
      board.setPointerCapture(e.pointerId);
      drawWires(bp, computeGraph(bp));
      return;
    }
    if (session.linking) {
      session.linking = null;
      session.selectedLink = "";
      drawWires(bp, computeGraph(bp));
    }
    if (e.target.closest("button")) return;
    if (drag && node) {
      e.preventDefault();
      session.selected = node.dataset.node;
      session.selectedLink = "";
      session.busy = true;
      const id = node.dataset.node;
      const origins = [];
      const byId = Object.fromEntries((bp.nodes || []).map((item) => [item.id, item]));
      const moveIds = new Set([id]);
      const dragged = byId[id];
      if (dragged?.type === "group") {
        if (!e.shiftKey) nodesInsideGroup(bp, dragged).forEach((item) => moveIds.add(item.id));
        if (session.moveChain) upstreamNodeIds(bp, id).forEach((nid) => moveIds.add(nid));
      } else if (session.moveChain) {
        upstreamNodeIds(bp, id).forEach((nid) => moveIds.add(nid));
      }
      moveIds.forEach((nid) => {
        const item = byId[nid];
        if (item) origins.push({ id: nid, x: item.x || 0, y: item.y || 0 });
      });
      session.drag = {
        id,
        dx: e.clientX,
        dy: e.clientY,
        origins,
        isGroup: dragged?.type === "group",
      };
      $("calc-board").setPointerCapture(e.pointerId);
      document.querySelectorAll("#calc-nodes .calc-node, #calc-groups .calc-node, #calc-group-ui .calc-group-chrome").forEach((el) => {
        el.classList.toggle("is-on", el.dataset.node === id);
      });
      return;
    }
    if (node) {
      session.selected = node.dataset.node;
      session.selectedLink = "";
      document.querySelectorAll("#calc-nodes .calc-node, #calc-groups .calc-node, #calc-group-ui .calc-group-chrome").forEach((el) => {
        el.classList.toggle("is-on", el.dataset.node === node.dataset.node);
      });
      drawWires(bp, computeGraph(bp));
      return;
    }
    session.selected = "";
    session.selectedLink = "";
    document.querySelectorAll("#calc-nodes .calc-node, #calc-groups .calc-node, #calc-group-ui .calc-group-chrome").forEach((el) => el.classList.remove("is-on"));
    drawWires(bp, computeGraph(bp));
    session.busy = true;
    session.pan = { x: e.clientX, y: e.clientY, ox: bp.x || 0, oy: bp.y || 0 };
    $("calc-board").setPointerCapture(e.pointerId);
  }

  function onBoardPointerMove(e) {
    const bp = activeBlueprint();
    if (!bp) return;
    if (session.pan) {
      bp.x = session.pan.ox + (e.clientX - session.pan.x);
      bp.y = session.pan.oy + (e.clientY - session.pan.y);
      applyWorld(bp);
      if (session.linking) {
        const at = screenToWorld(e.clientX, e.clientY, bp);
        session.linking.x = at.x;
        session.linking.y = at.y;
        drawWires(bp, computeGraph(bp));
      }
      drawMinimap(bp);
      return;
    }
    if (session.linking) {
      const at = screenToWorld(e.clientX, e.clientY, bp);
      session.linking.x = at.x;
      session.linking.y = at.y;
      drawWires(bp, computeGraph(bp));
      return;
    }
    if (session.resize) {
      const zoom = bp.zoom || 1;
      const item = bp.nodes.find((n) => n.id === session.resize.id);
      if (!item) return;
      if (session.resize.axis === "w") {
        const next = Math.round(session.resize.w + (e.clientX - session.resize.dx) / zoom);
        item.w = Math.max(session.resize.min, Math.min(session.resize.max, next));
      } else if (item.type === "group") {
        item.w = Math.max(160, Math.round(session.resize.w + (e.clientX - session.resize.dx) / zoom));
        item.h = Math.max(120, Math.round(session.resize.h + (e.clientY - session.resize.dy) / zoom));
      } else return;
      applyNodeEl(item);
      drawMinimap(bp);
      return;
    }
    if (session.drag) {
      const zoom = bp.zoom || 1;
      const dx = (e.clientX - session.drag.dx) / zoom;
      const dy = (e.clientY - session.drag.dy) / zoom;
      const byId = Object.fromEntries((bp.nodes || []).map((item) => [item.id, item]));
      (session.drag.origins || []).forEach((origin) => {
        const item = byId[origin.id];
        if (!item) return;
        item.x = origin.x + dx;
        item.y = origin.y + dy;
        applyNodeEl(item);
      });
      drawWires(bp, computeGraph(bp));
      drawMinimap(bp);
      return;
    }
  }

  function onBoardPointerUp(e) {
    const bp = activeBlueprint();
    const movedNode = session.drag;
    const movedPan = session.pan;
    const resized = session.resize;
    const linking = session.linking;
    session.drag = null;
    session.pan = null;
    session.resize = null;

    // Средняя кнопка — только панорама; тянущуюся связь не сбрасываем.
    if (e.button === 1) {
      session.busy = !!session.linking;
      if (bp) {
        if (session.linking) {
          const at = screenToWorld(e.clientX, e.clientY, bp);
          session.linking.x = at.x;
          session.linking.y = at.y;
          drawWires(bp, computeGraph(bp));
        }
        drawMinimap(bp);
      }
      setLinkingClass();
      return;
    }

    session.busy = false;
    if (resized) {
      dirty();
      if (bp) drawMinimap(bp);
      return;
    }
    if (e.target.closest?.("input, textarea, select, .calc-bp-name, .calc-refresh, .calc-chain-move, .calc-board-tools")) return;
    if (linking) {
      const over = document.elementFromPoint(e.clientX, e.clientY)?.closest?.(".calc-port");
      const nodeId = over?.closest?.(".calc-node")?.dataset.node;
      const io = over?.dataset.io;
      if (e.button === 2) {
        session.linking = null;
        setLinkingClass();
        if (bp) drawWires(bp, computeGraph(bp));
        if (linking.reverse && io === "out" && nodeId) {
          const parsed = parseLinePort(over.dataset.port);
          if (parsed && !parsed.field) showLinePortMenu(e.clientX, e.clientY, nodeId, parsed.lineId);
          else {
            const typed = parseTypePort(over.dataset.port);
            if (typed && !typed.field) showTypePortMenu(e.clientX, e.clientY, nodeId, typed.typeName);
          }
        }
        return;
      }
      if (linking.reverse && io === "out" && nodeId && nodeId !== linking.to) {
        session.linking = null;
        finishLink(nodeId, over.dataset.port, linking.to, linking.toPort);
        setLinkingClass();
        return;
      }
      if (!linking.reverse && io === "in" && nodeId && nodeId !== linking.from) {
        session.linking = null;
        finishLink(linking.from, linking.fromPort, nodeId, over.dataset.port);
        setLinkingClass();
        return;
      }
      const dx = e.clientX - (linking.sx || e.clientX);
      const dy = e.clientY - (linking.sy || e.clientY);
      if (dx * dx + dy * dy > 64 && !over) {
        session.linking = null;
        setLinkingClass();
        if (bp) drawWires(bp, computeGraph(bp));
      }
      return;
    }
    if (movedPan) {
      const dx = e.clientX - movedPan.x;
      const dy = e.clientY - movedPan.y;
      if (dx * dx + dy * dy > 16) dirty();
      if (bp) drawMinimap(bp);
      return;
    }
    if (movedNode) {
      if (bp && !movedNode.isGroup) {
        const byId = Object.fromEntries((bp.nodes || []).map((item) => [item.id, item]));
        (movedNode.origins || []).forEach((origin) => {
          const item = byId[origin.id];
          if (!item || item.type === "group") return;
          if (snapNodeToGroups(bp, item)) applyNodeEl(item);
        });
      }
      dirty();
      if (bp) {
        drawWires(bp, computeGraph(bp));
        drawMinimap(bp);
      }
    }
  }

  function closeOpenFilterMultis(except) {
    const open = nodesRoot()?.querySelectorAll(".calc-multi[open]") || [];
    if (!open.length && !session.filterMultiOpen) return;
    session.filterMultiLock = true;
    try {
      open.forEach((el) => {
        if (except && (el === except || el.contains(except))) return;
        el.open = false;
      });
    } finally {
      session.filterMultiLock = false;
    }
    if (!except || !except.closest?.(".calc-multi")) {
      session.filterMultiOpen = null;
      session.filterMultiScroll = 0;
    }
  }

  function onBoardWheel(e) {
    const bp = activeBlueprint();
    if (!bp) return;
    // Let nested scrollables (multi-select lists, side panels) scroll instead of zooming.
    if (e.target.closest("input, textarea, select, .calc-multi-list, .calc-side, .calc-present-list, .calc-tabs")) return;
    e.preventDefault();
    const before = bp.zoom || 1;
    const next = Math.max(0.35, Math.min(2.5, before * (e.deltaY > 0 ? 0.92 : 1.08)));
    const rect = $("calc-board").getBoundingClientRect();
    const cx = e.clientX - rect.left;
    const cy = e.clientY - rect.top;
    const k = next / before;
    bp.x = cx - (cx - (bp.x || 0)) * k;
    bp.y = cy - (cy - (bp.y || 0)) * k;
    bp.zoom = next;
    applyWorld(bp);
    drawMinimap(bp);
    clearTimeout(onBoardWheel.t);
    onBoardWheel.t = setTimeout(() => dirty(), 280);
  }

  function onDrop(e) {
    const bp = activeBlueprint();
    if (!bp) return;
    const orderId = e.dataTransfer?.getData("text/finmaster-order") || e.dataTransfer?.getData("text/plain");
    const kind = e.dataTransfer?.getData("text/finmaster-node");
    const blueprintId = e.dataTransfer?.getData("text/finmaster-blueprint");
    const presentBlock = e.dataTransfer?.getData("text/finmaster-present");
    const presentPage = e.dataTransfer?.getData("text/finmaster-present-page");
    e.preventDefault();
    const at = worldPoint(bp, e.clientX, e.clientY);
    if (presentBlock) addPresentNode(presentPage, presentBlock, at);
    else if (kind === "math" || kind === "formula" || kind === "percent" || kind === "const" || kind === "result" || kind === "group" || kind === "comment" || kind === "filter" || kind === "dashboard") addNode(kind, at);
    else if (blueprintId && blueprintId !== bp.id) addNode("scheme", at, { blueprintId });
    else if (orderId && api.findOrder(orderId)) addNode("order", at, { orderId });
  }

  function formulaNode(id) {
    return (activeBlueprint()?.nodes || []).find((node) => node.id === id && node.type === "formula");
  }

