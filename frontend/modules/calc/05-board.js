/* bundle-seam */
(() => {
  function renderNodes(bp, graph) {
    const host = nodesRoot();
    const groups = groupsRoot();
    const groupUi = groupUiRoot();
    if (!host) return;
    const focus = document.activeElement;
    const focusHost = host.contains(focus) || groups?.contains(focus) || groupUi?.contains(focus) ? focus : null;
    const keep = focusHost
      ? {
          name: focus.dataset.inName || focus.dataset.outName || focus.dataset.outExpr || focus.dataset.resultName || focus.dataset.resultPrio || focus.dataset.constValue || focus.dataset.groupName || focus.dataset.plannerTitle || focus.dataset.markTitle || focus.dataset.filterField,
          start: focus.selectionStart,
          end: focus.selectionEnd,
          filterField: focus.dataset.filterField || "",
          nodeId: focus.closest?.("[data-node]")?.dataset?.node || "",
        }
      : null;
    const groupNodes = sortGroupsByArea((bp.nodes || []).filter((node) => node.type === "group"));
    const plainNodes = (bp.nodes || []).filter((node) => node.type !== "group");
    const multiOpen = session.filterMultiOpen;
    if (multiOpen?.nodeId && multiOpen?.field) {
      const prevList = host.querySelector(
        `[data-node="${cssEsc(multiOpen.nodeId)}"] .calc-multi[data-filter-multi-field="${cssEsc(multiOpen.field)}"] .calc-multi-list`
      );
      if (prevList) session.filterMultiScroll = prevList.scrollTop;
    }
    if (groups) {
      groups.innerHTML = groupNodes.map((node, i) => groupNodeHtml(node, i)).join("");
    }
    if (groupUi) {
      groupUi.innerHTML = groupNodes.map((node, i) => groupChromeHtml(node, i)).join("");
    }
    host.innerHTML = plainNodes
      .map((node) => {
        if (node.type === "math") return mathNodeHtml(node, bp, graph);
        if (node.type === "percent") return percentNodeHtml(node, bp, graph);
        if (node.type === "const") return constNodeHtml(node, graph);
        if (node.type === "result") return resultNodeHtml(node, bp, graph);
        if (node.type === "formula") return formulaNodeHtml(node, bp, graph);
        if (node.type === "comment") return commentNodeHtml(node);
        if (node.type === "scheme") return schemeNodeHtml(node, graph);
        if (node.type === "filter") return filterNodeHtml(node, graph);
        if (node.type === "dashboard") return dashboardNodeHtml(node, bp, graph);
        if (node.type === "planner") return plannerNodeHtml(node, bp, graph);
        if (node.type === "openings") return openingsNodeHtml(node, bp, graph);
        if (node.type === "electrics") return electricsNodeHtml(node, bp, graph);
        if (node.type === "present") return presentNodeHtml(node, bp, graph);
        return orderNodeHtml(node, api.findOrder(node.orderId), graph, bp);
      })
      .join("");
    fitScreenNodes();
    applyWorld(bp);
    if (multiOpen?.nodeId && multiOpen?.field) {
      const nextList = host.querySelector(
        `[data-node="${cssEsc(multiOpen.nodeId)}"] .calc-multi[data-filter-multi-field="${cssEsc(multiOpen.field)}"] .calc-multi-list`
      );
      if (nextList) nextList.scrollTop = session.filterMultiScroll || 0;
    }
    if (keep?.name || keep?.filterField) {
      const again = keep.filterField && keep.nodeId
        ? host.querySelector(`[data-node="${cssEsc(keep.nodeId)}"] [data-filter-field="${cssEsc(keep.filterField)}"]`)
          : host.querySelector(`[data-in-name="${cssEsc(keep.name)}"], [data-out-name="${cssEsc(keep.name)}"], [data-out-expr="${cssEsc(keep.name)}"], [data-result-name="${cssEsc(keep.name)}"], [data-result-prio="${cssEsc(keep.name)}"], [data-const-value="${cssEsc(keep.name)}"], [data-planner-title="${cssEsc(keep.name)}"], [data-mark-title="${cssEsc(keep.name)}"]`) ||
          groupUi?.querySelector(`[data-group-name="${cssEsc(keep.name)}"]`);
      if (again) {
        again.focus({ preventScroll: true });
        try {
          again.setSelectionRange(keep.start, keep.end);
        } catch {
          /* ignore */
        }
      }
    }
  }

  function screenToWorld(clientX, clientY, bp) {
    const world = $("calc-world");
    const zoom = bp?.zoom || 1;
    if (world) {
      const rect = world.getBoundingClientRect();
      return {
        x: (clientX - rect.left) / zoom,
        y: (clientY - rect.top) / zoom,
      };
    }
    const board = $("calc-board");
    const rect = board.getBoundingClientRect();
    return {
      x: (clientX - rect.left - (bp?.x || 0)) / zoom,
      y: (clientY - rect.top - (bp?.y || 0)) / zoom,
    };
  }

  function viewCenter(bp) {
    const board = $("calc-board");
    if (!board || !bp) return { x: 120, y: 80 };
    const rect = board.getBoundingClientRect();
    const mid = screenToWorld(rect.left + rect.width / 2, rect.top + rect.height / 2, bp);
    const n = session.place % 6;
    return {
      x: mid.x - 115 + n * 24,
      y: mid.y - 50 + n * 24,
    };
  }

  function findPortEl(nodeEl, portId, io) {
    if (!nodeEl) return null;
    const ports = [...nodeEl.querySelectorAll(`.calc-port[data-io="${io}"]`)];
    const exact = ports.find((el) => el.dataset.port === portId);
    if (exact) return exact;
    const hit = matchPortId(portId, ports.map((el) => el.dataset.port || ""));
    return hit ? ports.find((el) => el.dataset.port === hit) : null;
  }

  function portWorld(nodeEl, portId, io, bp) {
    const port = findPortEl(nodeEl, portId, io);
    if (!port) return null;
    const world = $("calc-world");
    const zoom = bp?.zoom || 1;
    if (!world) {
      const rect = port.getBoundingClientRect();
      return screenToWorld(rect.left + rect.width / 2, rect.top + rect.height / 2, bp);
    }
    const wr = world.getBoundingClientRect();
    const pr = port.getBoundingClientRect();
    const nr = nodeEl.getBoundingClientRect();
    const cy = (pr.top + pr.height / 2 - wr.top) / zoom;
    // Конец линии — на внешнем краю ноды (порт висит снаружи), чтобы провод не уходил под карточку.
    if (io === "in") {
      const edge = (nr.left - wr.left) / zoom;
      const portOuter = (pr.left - wr.left) / zoom;
      return { x: Math.min(edge, portOuter), y: cy };
    }
    if (io === "out") {
      const edge = (nr.right - wr.left) / zoom;
      const portOuter = (pr.right - wr.left) / zoom;
      return { x: Math.max(edge, portOuter), y: cy };
    }
    return {
      x: (pr.left + pr.width / 2 - wr.left) / zoom,
      y: cy,
    };
  }

  function bezierMid(a, b) {
    const dx = Math.max(40, Math.abs(b.x - a.x) * 0.45);
    return {
      x: 0.125 * a.x + 0.375 * (a.x + dx) + 0.375 * (b.x - dx) + 0.125 * b.x,
      y: 0.125 * a.y + 0.375 * a.y + 0.375 * b.y + 0.125 * b.y,
    };
  }

  function wireKind(node, fromPort) {
    if (fromPort === "plan") return "plan";
    const type = node?.type || "";
    if (type === "order") {
      if (fromPort === "total") return "order";
      const parsed = parseLinePort(fromPort);
      if (parsed?.field) return `field-${parsed.field}`;
      if (parsed) {
        const order = api.findOrder(node.orderId);
        const line = (order?.lines || []).find((item) => item.id === parsed.lineId);
        if (line) return lineTone(line, order);
      }
      const typed = parseTypePort(fromPort);
      if (typed?.field) return `field-${typed.field}`;
      if (typed) {
        const order = api.findOrder(node.orderId);
        if (order) return typeTone(order, typed.typeName);
      }
      return "order";
    }
    if (type === "math" || type === "formula" || type === "percent" || type === "const" || type === "result" || type === "scheme" || type === "group" || type === "filter" || type === "dashboard" || type === "planner" || type === "openings" || type === "electrics" || type === "present" || type === "comment") return type;
    return "order";
  }

  function upstreamFlow(bp, nodeId) {
    const linkIds = new Set();
    const outPorts = new Set();
    const inPorts = new Set();
    const nodeIds = new Set();
    if (!bp || !nodeId) return { linkIds, outPorts, inPorts, nodeIds };
    const incoming = {};
    (bp.links || []).forEach((link) => {
      if (!incoming[link.to]) incoming[link.to] = [];
      incoming[link.to].push(link);
    });
    const seen = new Set();
    function walk(id) {
      if (!id || seen.has(id)) return;
      seen.add(id);
      (incoming[id] || []).forEach((link) => {
        linkIds.add(link.id);
        outPorts.add(`${link.from}:${link.fromPort}`);
        inPorts.add(`${link.to}:${link.toPort}`);
        nodeIds.add(link.from);
        nodeIds.add(link.to);
        walk(link.from);
      });
    }
    walk(nodeId);
    return { linkIds, outPorts, inPorts, nodeIds };
  }

  function downstreamNodeIds(bp, nodeId) {
    const ids = new Set();
    if (!bp || !nodeId) return ids;
    const outgoing = {};
    (bp.links || []).forEach((link) => {
      if (!outgoing[link.from]) outgoing[link.from] = [];
      outgoing[link.from].push(link.to);
    });
    function walk(id) {
      (outgoing[id] || []).forEach((to) => {
        if (!to || ids.has(to)) return;
        ids.add(to);
        walk(to);
      });
    }
    walk(nodeId);
    return ids;
  }

  function chainMode() {
    if (session.moveChain === true || session.moveChain === "in") return "in";
    if (session.moveChain === "out") return "out";
    return "off";
  }

  function upstreamNodeIds(bp, nodeId) {
    const ids = new Set();
    if (!bp || !nodeId) return ids;
    const incoming = {};
    (bp.links || []).forEach((link) => {
      if (!incoming[link.to]) incoming[link.to] = [];
      incoming[link.to].push(link.from);
    });
    function walk(id) {
      (incoming[id] || []).forEach((from) => {
        if (!from || ids.has(from)) return;
        ids.add(from);
        walk(from);
      });
    }
    walk(nodeId);
    return ids;
  }

  function syncChainMoveBtn() {
    const btn = $("calc-chain-move");
    if (!btn) return;
    const mode = chainMode();
    const title = mode === "in" ? "Тянуть цепочку входов" : mode === "out" ? "Тянуть цепочку выходов" : "Выключен";
    btn.dataset.chain = mode;
    btn.classList.toggle("is-on", mode !== "off");
    btn.setAttribute("aria-pressed", mode === "off" ? "false" : "true");
    btn.title = title;
    btn.setAttribute("aria-label", title);
  }

  function syncMiniToggle() {
    const btn = $("calc-mini-toggle");
    const wrap = $("calc-mini-wrap");
    const board = $("calc-board");
    if (!btn) return;
    const on = !session.miniHidden;
    btn.setAttribute("aria-pressed", on ? "true" : "false");
    btn.title = on ? "Скрыть навигатор" : "Показать навигатор";
    wrap?.classList.toggle("is-hidden", !on);
    board?.classList.toggle("is-mini-hidden", !on);
  }

  function setLinkingClass() {
    const board = $("calc-board");
    if (!board) return;
    const link = session.linking;
    board.classList.toggle("is-link-out", !!(link && !link.reverse));
    board.classList.toggle("is-link-in", !!(link && link.reverse));
    const ownerId = link ? (link.reverse ? link.to : link.from) : "";
    const portId = link ? (link.reverse ? link.toPort : link.fromPort) : "";
    const owner = ownerId ? (activeBlueprint()?.nodes || []).find((item) => item.id === ownerId) : null;
    const signal = link ? portSignal(owner, portId) : "";
    board.classList.toggle("is-link-plan", signal === "plan");
    board.classList.toggle("is-link-num", !!link && signal !== "plan");
  }

  function drawWires(bp, graph) {
    const svg = $("calc-wires");
    const host = nodesRoot();
    const ui = wireUiRoot() || host;
    if (!svg || !host || !bp) return;
    const ns = "http://www.w3.org/2000/svg";
    while (svg.firstChild) svg.removeChild(svg.firstChild);
    const addPath = (d, cls, attrs) => {
      const el = document.createElementNS(ns, "path");
      el.setAttribute("d", d);
      el.setAttribute("class", cls);
      if (attrs) Object.entries(attrs).forEach(([key, value]) => el.setAttribute(key, value));
      svg.appendChild(el);
      return el;
    };
    const hostButtons = [];
    const byId = Object.fromEntries((bp.nodes || []).map((node) => [node.id, node]));
    const flow = upstreamFlow(bp, session.selected);
    const picked = session.selectedLink
      ? (bp.links || []).find((link) => link.id === session.selectedLink) || null
      : null;
    if (session.selectedLink && !picked) session.selectedLink = "";

    const clearPickClass = (root) => {
      root?.querySelectorAll(".is-link-pick").forEach((el) => el.classList.remove("is-link-pick"));
    };
    clearPickClass(host);
    clearPickClass(groupsRoot());
    clearPickClass(groupUiRoot());

    host.querySelectorAll(".calc-port.is-flow").forEach((el) => el.classList.remove("is-flow"));
    groupsRoot()?.querySelectorAll(".calc-port.is-flow").forEach((el) => el.classList.remove("is-flow"));
    host.querySelectorAll(".calc-node.is-flow").forEach((el) => el.classList.remove("is-flow"));
    groupsRoot()?.querySelectorAll(".calc-node.is-flow").forEach((el) => el.classList.remove("is-flow"));
    groupUiRoot()?.querySelectorAll(".calc-group-chrome.is-flow").forEach((el) => el.classList.remove("is-flow"));
    flow.nodeIds.forEach((id) => {
      const el = findNodeEl(id);
      el?.classList.add("is-flow");
      if (el?.classList.contains("calc-group-chrome") || byId[id]?.type === "group") {
        findGroupChrome(id)?.classList.add("is-flow");
      }
    });
    if (picked) {
      const fromEl = findNodeEl(picked.from);
      const toEl = findNodeEl(picked.to);
      fromEl?.classList.add("is-link-pick");
      toEl?.classList.add("is-link-pick");
      if (byId[picked.from]?.type === "group") findGroupChrome(picked.from)?.classList.add("is-link-pick");
      if (byId[picked.to]?.type === "group") findGroupChrome(picked.to)?.classList.add("is-link-pick");
      findPortEl(fromEl, picked.fromPort, "out")?.classList.add("is-link-pick");
      findPortEl(toEl, picked.toPort, "in")?.classList.add("is-link-pick");
    }
    (bp.links || []).forEach((link) => {
      const fromEl = findNodeEl(link.from);
      const toEl = findNodeEl(link.to);
      if (!fromEl || !toEl) return;
      const a = portWorld(fromEl, link.fromPort, "out", bp);
      const b = portWorld(toEl, link.toPort, "in", bp);
      if (!a || !b) return;
      const dx = Math.max(40, Math.abs(b.x - a.x) * 0.45);
      const d = `M${a.x},${a.y} C${a.x + dx},${a.y} ${b.x - dx},${b.y} ${b.x},${b.y}`;
      const src = byId[link.from];
      const onFlow = flow.linkIds.has(link.id);
      const onPick = !!(picked && picked.id === link.id);
      const err = graph.errors.has(link.from) || graph.errors.has(link.to);
      const wire = addPath(
        d,
        `calc-wire is-${wireKind(src, link.fromPort)}${onFlow ? " is-flow" : ""}${onPick ? " is-pick" : ""}${err ? " is-error" : ""}`,
        {
          "pointer-events": "none",
          "data-link": link.id,
        }
      );
      if (onFlow) {
        findPortEl(fromEl, link.fromPort, "out")?.classList.add("is-flow");
        findPortEl(toEl, link.toPort, "in")?.classList.add("is-flow");
      }
      if (!session.linking && !session.drag && !session.pan) {
        const hit = addPath(d, "calc-wire-hit", { "data-link": link.id });
        const mid = bezierMid(a, b);
        hostButtons.push({ id: link.id, x: mid.x, y: mid.y, wire, hit });
      }
    });
    ui.querySelectorAll(".calc-unlink-wire").forEach((el) => el.remove());
    hostButtons.forEach((item) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "calc-unlink-wire";
      btn.dataset.delLink = item.id;
      btn.title = "Удалить связь";
      btn.textContent = "×";
      btn.style.left = `${item.x}px`;
      btn.style.top = `${item.y}px`;
      const show = () => {
        item.wire.classList.add("is-hot");
        btn.classList.add("is-show");
      };
      const hide = () => {
        if (session.selectedLink === item.id) return;
        item.wire.classList.remove("is-hot");
        btn.classList.remove("is-show");
      };
      item.hit.addEventListener("pointerenter", show);
      item.hit.addEventListener("pointerleave", (e) => {
        if (e.relatedTarget === btn || btn.contains(e.relatedTarget)) return;
        hide();
      });
      btn.addEventListener("pointerenter", show);
      btn.addEventListener("pointerleave", (e) => {
        if (e.relatedTarget === item.hit) return;
        hide();
      });
      item.hit.addEventListener("pointerdown", (e) => {
        if (e.button !== 0) return;
        e.preventDefault();
        e.stopPropagation();
        session.selectedLink = item.id;
        session.selected = "";
        document.querySelectorAll(".calc-node.is-on, .calc-group-chrome.is-on").forEach((el) => el.classList.remove("is-on"));
        drawWires(bp, computeGraph(bp));
      });
      if (session.selectedLink === item.id) {
        item.wire.classList.add("is-hot");
        btn.classList.add("is-show");
      }
      ui.appendChild(btn);
    });
    if (session.linking?.x != null) {
      const L = session.linking;
      let a = null;
      let b = null;
      let kind = "order";
      if (L.reverse) {
        const toEl = findNodeEl(L.to);
        a = { x: L.x, y: L.y };
        b = toEl ? portWorld(toEl, L.toPort, "in", bp) : null;
        kind = wireKind(byId[L.to]);
      } else {
        const fromEl = findNodeEl(L.from);
        a = fromEl ? portWorld(fromEl, L.fromPort, "out", bp) : null;
        b = { x: L.x, y: L.y };
        kind = wireKind(byId[L.from], L.fromPort);
      }
      if (a && b) {
        const dx = Math.max(40, Math.abs(b.x - a.x) * 0.45);
        addPath(`M${a.x},${a.y} C${a.x + dx},${a.y} ${b.x - dx},${b.y} ${b.x},${b.y}`, `calc-wire is-temp is-${kind}`, { "pointer-events": "none" });
      }
    }
    setLinkingClass();
    drawMinimap(bp);
  }

  function rebuildPresentValues() {
    presentValues.clear();
    try {
      (window.FinPresent?.pages?.() || []).forEach((page) => {
        (page.blocks || []).forEach((block) => {
          block.values = {};
        });
      });
    } catch {
      /* ignore */
    }
    const calc = ensureState();
    if (!calc) return;
    (calc.blueprints || []).forEach((bp) => {
      try {
        computeGraph(bp);
      } catch (err) {
        console.warn("calc graph", bp?.id, err);
      }
    });
    flushOrderWrites();
  }

  function hidePresentPanel() {
    session.presentPanel = false;
    session.presentDrag = null;
    setPresentHover("");
    const btn = $("calc-present-btn");
    btn?.classList.remove("is-on");
    btn?.setAttribute("aria-pressed", "false");
    const el = $("calc-present-panel");
    if (el) el.hidden = true;
  }

  function flushOrderWrites() {
    if (!session.orderWritePending) return;
    session.orderWritePending = false;
    api?.markDirty?.("Калькулятор → заказ");
    api?.refreshOrders?.();
  }

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
    const delLayout = e.target.closest("[data-del-planner-layout]");
    if (delLayout) {
      e.preventDefault();
      e.stopPropagation();
      const nodeEl = delLayout.closest(".calc-node");
      const node = nodeEl && bp.nodes.find((item) => item.id === nodeEl.dataset.node && item.type === "planner");
      if (node && plannerRemoveLayout(node, delLayout.dataset.delPlannerLayout)) {
        dirty();
        render();
      }
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
    const plannerCard = e.target.closest(".calc-film-card[data-planner-layout]");
    if (plannerCard) {
      const nodeEl = plannerCard.closest(".calc-node");
      const nodeId = nodeEl?.dataset.node;
      const planner = bp.nodes.find((item) => item.id === nodeId && item.type === "planner");
      if (planner) {
        const changed = plannerUseLayout(planner, plannerCard.dataset.plannerLayout);
        session.selected = planner.id;
        session.selectedLink = "";
        nodeEl.querySelectorAll(".calc-film-card[data-planner-layout]").forEach((card) => {
          card.classList.toggle("is-on", card === plannerCard);
        });
        nodeEl.querySelectorAll(".calc-node").forEach((el) => el.classList.remove("is-on"));
        nodeEl.classList.add("is-on");
        const colorInput = nodeEl.querySelector("[data-planner-color]");
        if (colorInput) colorInput.value = planner.color || "#65a30d";
        nodeEl.style.setProperty("--planner-color", planner.color || "#65a30d");
        drawWires(bp, computeGraph(bp));
        if (changed) dirty();
      }
      e.preventDefault();
      e.stopPropagation();
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
    if (e.target.closest("button") && !e.target.closest(".calc-film-card")) return;
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
      const mode = chainMode();
      const along = mode === "in" ? upstreamNodeIds(bp, id) : mode === "out" ? downstreamNodeIds(bp, id) : null;
      if (dragged?.type === "group") {
        if (!e.shiftKey) nodesInsideGroup(bp, dragged).forEach((item) => moveIds.add(item.id));
        if (along) along.forEach((nid) => moveIds.add(nid));
      } else if (along) {
        along.forEach((nid) => moveIds.add(nid));
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
    const filmWheel = e.target.closest(".calc-film, .mark-film");
    if (filmWheel && filmWheel.scrollWidth > filmWheel.clientWidth + 4) {
      e.preventDefault();
      filmWheel.scrollLeft += e.deltaY + e.deltaX;
      return;
    }
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
    else if (kind === "math" || kind === "formula" || kind === "percent" || kind === "const" || kind === "result" || kind === "group" || kind === "comment" || kind === "filter" || kind === "dashboard" || kind === "planner" || kind === "openings" || kind === "electrics") addNode(kind, at);
    else if (blueprintId && blueprintId !== bp.id) addNode("scheme", at, { blueprintId });
    else if (orderId && api.findOrder(orderId)) addNode("order", at, { orderId });
  }

  function formulaNode(id) {
    return (activeBlueprint()?.nodes || []).find((node) => node.id === id && node.type === "formula");
  }

  function bind() {
    if (session.bound) return;
    session.bound = true;
    bindFormulaProfileModals();
    const root = $("view-calculator");
    const board = $("calc-board");
    if (!root || !board) return;
    $("calc-tabs")?.addEventListener("pointerdown", (e) => {
      const calc = ensureState();
      if (!calc) return;
      const del = e.target.closest("[data-del-bp]");
      if (!del) return;
      e.preventDefault();
      e.stopPropagation();
      if (calc.blueprints.length < 2) return;
      const id = del.dataset.delBp;
      calc.blueprints.forEach((item) => {
        item.nodes = (item.nodes || []).filter((node) => !(node.type === "scheme" && node.blueprintId === id));
        const ids = new Set(item.nodes.map((node) => node.id));
        item.links = (item.links || []).filter((link) => ids.has(link.from) && ids.has(link.to));
      });
      calc.blueprints = calc.blueprints.filter((item) => item.id !== id);
      if (calc.active === id) calc.active = calc.blueprints[0].id;
      dirty();
      render();
    });
    $("calc-tabs")?.addEventListener("click", (e) => {
      if (e.target.closest("[data-del-bp]")) return;
      if (session.tabMoved) {
        session.tabMoved = false;
        return;
      }
      const calc = ensureState();
      const tab = e.target.closest("[data-bp]");
      if (!calc || !tab || tab.dataset.bp === calc.active) return;
      calc.active = tab.dataset.bp;
      dirty();
      render();
    });
    $("calc-tabs")?.addEventListener("dragstart", (e) => {
      const tab = e.target.closest("[data-bp]");
      if (!tab || e.target.closest("[data-del-bp]")) {
        e.preventDefault();
        return;
      }
      session.tabDrag = tab.dataset.bp || "";
      session.tabMoved = false;
      tab.classList.add("is-drag");
      e.dataTransfer.effectAllowed = "move";
      e.dataTransfer.setData("text/finmaster-tab", session.tabDrag);
      e.dataTransfer.setData("text/plain", session.tabDrag);
    });
    $("calc-tabs")?.addEventListener("dragend", () => {
      session.tabDrag = "";
      $("calc-tabs")?.querySelectorAll(".calc-tab").forEach((el) => {
        el.classList.remove("is-drag", "is-drop-before", "is-drop-after");
      });
    });
    $("calc-tabs")?.addEventListener("dragover", (e) => {
      const dragId = session.tabDrag;
      if (!dragId) return;
      const tab = e.target.closest("[data-bp]");
      const host = $("calc-tabs");
      host?.querySelectorAll(".calc-tab").forEach((el) => el.classList.remove("is-drop-before", "is-drop-after"));
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
      if (!tab || tab.dataset.bp === dragId) return;
      const rect = tab.getBoundingClientRect();
      const after = e.clientX > rect.left + rect.width / 2;
      tab.classList.add(after ? "is-drop-after" : "is-drop-before");
    });
    $("calc-tabs")?.addEventListener("drop", (e) => {
      const fromId = session.tabDrag || e.dataTransfer?.getData("text/finmaster-tab") || e.dataTransfer?.getData("text/plain");
      const tab = e.target.closest("[data-bp]");
      e.preventDefault();
      if (!fromId || !tab || tab.dataset.bp === fromId) return;
      const rect = tab.getBoundingClientRect();
      const after = e.clientX > rect.left + rect.width / 2;
      if (reorderBlueprint(fromId, tab.dataset.bp, after)) session.tabMoved = true;
      session.tabDrag = "";
    });
    root.querySelector(".calc-tabbar")?.addEventListener(
      "wheel",
      (e) => {
        const host = $("calc-tabs");
        if (!host) return;
        const delta = Math.abs(e.deltaY) >= Math.abs(e.deltaX) ? e.deltaY : e.deltaX;
        if (!delta) return;
        e.preventDefault();
        host.scrollLeft += delta;
      },
      { passive: false }
    );
    root.addEventListener("click", (e) => {
      const eye = e.target.closest("[data-result-eye]");
      if (eye) {
        e.preventDefault();
        e.stopPropagation();
        const bp = activeBlueprint();
        const node = bp?.nodes.find((item) => item.id === eye.dataset.resultEye && item.type === "result");
        if (!node) return;
        node.visible = !resultVisible(node);
        if (!resultVisible(node)) pruneHiddenResultLinks(node.id);
        dirty();
        render();
        return;
      }
      if (!e.target.closest("[data-add-bp]")) return;
      const calc = ensureState();
      if (!calc) return;
      const bp = emptyBlueprint(`Схема ${calc.blueprints.length + 1}`);
      calc.blueprints.push(bp);
      calc.active = bp.id;
      dirty();
      render();
    });
    $("calc-refresh")?.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      recalculate();
    });
    $("calc-chain-move")?.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      const order = ["off", "in", "out"];
      const at = order.indexOf(chainMode());
      session.moveChain = order[(at + 1) % order.length];
      syncChainMoveBtn();
    });
    $("calc-prune")?.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      const n = pruneOrphanNodes();
      const btn = $("calc-prune");
      if (btn) {
        btn.title = n ? `Убрано: ${n}` : "Нет нод без связей";
        clearTimeout(btn._pruneT);
        btn._pruneT = setTimeout(() => {
          btn.title = "Убрать ноды без связей";
        }, 1600);
      }
    });
    $("calc-present-btn")?.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      togglePresentPanel();
    });
    document.addEventListener("click", (e) => {
      if (!session.presentPanel) return;
      if (e.target.closest("[data-close-present-panel]")) {
        togglePresentPanel(false);
        return;
      }
      const item = e.target.closest("[data-present-block]");
      if (item && item.closest("#calc-present-panel")) {
        addPresentNode(item.dataset.presentPage, item.dataset.presentBlock);
      }
    });
    document.addEventListener(
      "pointerdown",
      (e) => {
        if (!session.filterMultiOpen && !nodesRoot()?.querySelector(".calc-multi[open]")) return;
        const hit = e.target.closest?.(".calc-multi, [data-filter-multi-clear]");
        if (hit) return;
        closeOpenFilterMultis();
      },
      true
    );
    document.addEventListener("dragstart", (e) => {
      const item = e.target.closest("[data-present-block]");
      if (!item || !item.closest("#calc-present-panel")) return;
      e.dataTransfer.setData("text/finmaster-present", item.dataset.presentBlock);
      e.dataTransfer.setData("text/finmaster-present-page", item.dataset.presentPage || "");
      e.dataTransfer.effectAllowed = "copy";
    });
    syncChainMoveBtn();
    syncMiniToggle();
    $("calc-mini-toggle")?.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      session.miniHidden = !session.miniHidden;
      syncMiniToggle();
      const bp = activeBlueprint();
      if (bp && !session.miniHidden) drawMinimap(bp);
    });
    $("calc-bp-name")?.addEventListener("input", (e) => {
      const bp = activeBlueprint();
      if (!bp) return;
      bp.name = String(e.target.value || "").slice(0, 48);
      const label = $("calc-tabs")?.querySelector(".calc-tab.active .calc-tab-label");
      if (label) label.textContent = bp.name || "Схема";
      dirty();
    });
    $("calc-bp-name")?.addEventListener("focusout", (e) => {
      const bp = activeBlueprint();
      if (!bp) return;
      bp.name = String(e.target.value || "").trim().slice(0, 48) || "Схема";
      e.target.value = bp.name;
      dirty();
      render();
    });
    $("calc-bp-name")?.addEventListener("keydown", (e) => {
      if (e.key !== "Enter") return;
      e.preventDefault();
      e.target.blur();
    });
    $("calc-side")?.addEventListener("input", (e) => {
      if (e.target.id !== "calc-order-search") return;
      session.search = e.target.value;
      const start = e.target.selectionStart;
      const end = e.target.selectionEnd;
      const list = document.querySelector("#calc-side .calc-order-list");
      const listScroll = list?.scrollTop || 0;
      const sideScroll = $("calc-side")?.scrollTop || 0;
      renderSide(activeBlueprint());
      const input = $("calc-order-search");
      if (input) {
        input.focus({ preventScroll: true });
        try {
          input.setSelectionRange(start ?? input.value.length, end ?? input.value.length);
        } catch {
          /* ignore */
        }
      }
      const side = $("calc-side");
      if (side) side.scrollTop = sideScroll;
      const nextList = document.querySelector("#calc-side .calc-order-list");
      if (nextList) nextList.scrollTop = listScroll;
    });
    $("calc-side")?.addEventListener("click", (e) => {
      const clear = e.target.closest("[data-search-clear]");
      if (clear) {
        e.preventDefault();
        e.stopPropagation();
        session.search = "";
        renderSide(activeBlueprint());
        $("calc-order-search")?.focus();
        return;
      }
      const add = e.target.closest("[data-add-node]");
      if (add) {
        addNode(add.dataset.addNode);
        return;
      }
      const scheme = e.target.closest("[data-blueprint]");
      if (scheme) {
        addNode("scheme", null, { blueprintId: scheme.dataset.blueprint });
        return;
      }
      const order = e.target.closest("[data-order]");
      if (order) addNode("order", null, { orderId: order.dataset.order });
      const summary = e.target.closest("details.calc-fold > summary");
      if (summary) {
        const fold = summary.parentElement;
        if (fold instanceof HTMLDetailsElement && fold.dataset.fold) {
          requestAnimationFrame(() => setFold(fold.dataset.fold, fold.open));
        }
      }
    });
    $("calc-side")?.addEventListener(
      "toggle",
      (e) => {
        const fold = e.target;
        if (!(fold instanceof HTMLDetailsElement)) return;
        if (!fold.matches("details.calc-fold[data-fold]")) return;
        setFold(fold.dataset.fold, fold.open);
      },
      true
    );
    $("calc-side")?.addEventListener("dragstart", (e) => {
      const order = e.target.closest("[data-order]");
      const tool = e.target.closest("[data-add-node]");
      const scheme = e.target.closest("[data-blueprint]");
      if (order) {
        e.dataTransfer.setData("text/finmaster-order", order.dataset.order);
        e.dataTransfer.setData("text/plain", order.dataset.order);
        e.dataTransfer.effectAllowed = "copy";
      } else if (tool) {
        e.dataTransfer.setData("text/finmaster-node", tool.dataset.addNode);
        e.dataTransfer.effectAllowed = "copy";
      } else if (scheme) {
        e.dataTransfer.setData("text/finmaster-blueprint", scheme.dataset.blueprint);
        e.dataTransfer.effectAllowed = "copy";
      }
    });
    board.addEventListener("dragover", (e) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = "copy";
    });
    board.addEventListener("drop", onDrop);
    board.addEventListener("scroll", () => {
      board.scrollTop = 0;
      board.scrollLeft = 0;
    });
    board.addEventListener("pointerdown", onBoardPointerDown);
    board.addEventListener("pointermove", onBoardPointerMove);
    board.addEventListener("pointerup", onBoardPointerUp);
    board.addEventListener("pointercancel", onBoardPointerUp);
    board.addEventListener("dblclick", (e) => {
      const card = e.target.closest(".calc-film-card");
      if (!card) return;
      const nodeEl = card.closest(".calc-node");
      const bp = activeBlueprint();
      const node = nodeEl && bp
        ? bp.nodes.find((item) => item.id === nodeEl.dataset.node)
        : null;
      if (!node) return;
      e.preventDefault();
      e.stopPropagation();
      if (node.type === "planner") openPlanner(node.id);
      else if (node.type === "openings" || node.type === "electrics") {
        openMark(node.id, card.dataset.markSurface || "", card.closest("[data-mark-feed]")?.dataset.markFeed || "");
      }
    });
    board.addEventListener("auxclick", (e) => {
      if (e.button === 1) e.preventDefault();
    });
    board.addEventListener("contextmenu", (e) => {
      if (e.target.closest(".calc-port, .calc-port-menu")) e.preventDefault();
    });
    board.addEventListener("wheel", onBoardWheel, { passive: false });
    const mini = $("calc-minimap");
    mini?.addEventListener("pointerdown", (e) => {
      if (session.miniHidden) return;
      e.preventDefault();
      e.stopPropagation();
      const bp = activeBlueprint();
      const at = miniWorldPoint(e.clientX, e.clientY);
      if (!bp || !at) return;
      session.miniDrag = true;
      session.busy = true;
      centerViewOn(bp, at.x, at.y);
      mini.setPointerCapture(e.pointerId);
    });
    mini?.addEventListener("pointermove", (e) => {
      if (!session.miniDrag || session.miniHidden) return;
      const bp = activeBlueprint();
      const at = miniWorldPoint(e.clientX, e.clientY);
      if (!bp || !at) return;
      centerViewOn(bp, at.x, at.y);
    });
    mini?.addEventListener("pointerup", () => {
      if (!session.miniDrag) return;
      session.miniDrag = null;
      session.busy = false;
      dirty();
    });
    mini?.addEventListener("pointercancel", () => {
      session.miniDrag = null;
      session.busy = false;
    });
    board.addEventListener("click", async (e) => {
      const btn = e.target.closest(".calc-screen-copy");
      if (!btn || !board.contains(btn) || btn.disabled) return;
      e.preventDefault();
      e.stopPropagation();
      const text = btn.dataset.copy || "";
      if (!(await copyScreenText(text))) return;
      const screen = btn.closest(".calc-screen");
      btn.classList.add("is-copied");
      screen?.classList.add("is-copied");
      btn.title = "Скопировано";
      clearTimeout(btn._copyT);
      btn._copyT = setTimeout(() => {
        btn.classList.remove("is-copied");
        screen?.classList.remove("is-copied");
        btn.title = "Копировать";
      }, 1400);
    });
    root.addEventListener("click", (e) => {
      const clearMulti = e.target.closest("[data-filter-multi-clear]");
      if (clearMulti) {
        e.preventDefault();
        e.stopPropagation();
        const nodeEl = clearMulti.closest(".calc-node");
        const bp = activeBlueprint();
        const node = nodeEl && bp ? bp.nodes.find((item) => item.id === nodeEl.dataset.node) : null;
        const field = clearMulti.dataset.filterMultiClear || "";
        const allowed = new Set(["customers", "orderIds", "payFilters", "payStatusFilters", "orderTypes", "products", "statuses"]);
        if (!node || !allowed.has(field) || (node.type !== "filter" && node.type !== "dashboard")) return;
        node[field] = [];
        if (field === "customers") {
          /* keep orderIds — user can clear orders separately */
        }
        normalizeFilterNode(node);
        if (session.filterMultiOpen?.nodeId === node.id && session.filterMultiOpen?.field === field) {
          session.filterMultiOpen = null;
          session.filterMultiScroll = 0;
        }
        session.selected = node.id;
        dirty();
        render();
        return;
      }
      const nodeEl = e.target.closest(".calc-node");
      const bp = activeBlueprint();
      if (e.target.closest("[data-del-node]")) {
        removeNode(e.target.closest("[data-del-node]").dataset.delNode);
        return;
      }
      const dropLink = e.target.closest("[data-del-link]");
      if (dropLink) {
        removeLink(dropLink.dataset.delLink);
        return;
      }
      const dropIn = e.target.closest("[data-del-in-link]");
      if (dropIn) {
        disconnectInput(dropIn.closest(".calc-node")?.dataset.node, dropIn.dataset.delInLink);
        return;
      }
      if (!bp || !nodeEl) return;
      const node = bp.nodes.find((item) => item.id === nodeEl.dataset.node);
      if (!node) return;
      const films = e.target.closest("[data-films-toggle]");
      if (films && (node.type === "openings" || node.type === "electrics")) {
        node.filmsOff = !node.filmsOff;
        session.selected = node.id;
        dirty();
        render();
        return;
      }
      session.selected = node.id;
      const op = e.target.closest("[data-op]");
      if (op && node.type === "math") {
        node.op = op.dataset.op;
        dirty();
        render();
        return;
      }
      if (e.target.closest("[data-formula-profile-save]") && node.type === "formula") {
        openFormulaProfileSave(node);
        return;
      }
      if (e.target.closest("[data-formula-profile-del]") && node.type === "formula") {
        openFormulaProfileDelete();
        return;
      }
      if (e.target.closest("[data-add-in]") && node.type === "formula") {
        if ((node.inputs || []).length >= 26) return;
        const used = formulaLetterSet(node);
        const name = nextLetter(used);
        if (!name) return;
        node.inputs.push({ id: uid(), name });
        dirty();
        render();
        return;
      }
      if (e.target.closest("[data-add-out]") && node.type === "formula") {
        if ((node.outputs || []).length >= MATH_MAX) return;
        const used = formulaLetterSet(node);
        const name = nextLetter(used);
        if (!name) return;
        node.outputs.push({ id: uid(), name, expr: "0" });
        dirty();
        render();
        return;
      }
      if (e.target.closest("[data-del-in]") && node.type === "formula") {
        const id = e.target.closest("[data-del-in]").dataset.delIn;
        if ((node.inputs || []).length <= 1) return;
        node.inputs = node.inputs.filter((port) => port.id !== id);
        bp.links = bp.links.filter((link) => !(link.to === node.id && link.toPort === id));
        dirty();
        render();
        return;
      }
      if (e.target.closest("[data-del-out]") && node.type === "formula") {
        const id = e.target.closest("[data-del-out]").dataset.delOut;
        if ((node.outputs || []).length <= 1) return;
        node.outputs = node.outputs.filter((port) => port.id !== id);
        bp.links = bp.links.filter((link) => !(link.from === node.id && link.fromPort === id));
        dirty();
        render();
        return;
      }
      const dashPorts = e.target.closest("[data-dash-ports]");
      if (dashPorts && node.type === "dashboard") {
        showDashPortMenu(e.clientX, e.clientY, node.id);
        return;
      }
      const plannerEdit = e.target.closest("[data-planner-edit]");
      if (plannerEdit) {
        e.preventDefault();
        e.stopPropagation();
        const layoutId = e.target.closest("[data-planner-layout]")?.dataset.plannerLayout;
        if (layoutId && node?.type === "planner") plannerUseLayout(node, layoutId);
        openPlanner(plannerEdit.dataset.plannerEdit || node.id);
        return;
      }
      const markEdit = e.target.closest("[data-mark-edit], [data-mark-open]");
      if (markEdit && !e.target.closest(".calc-film-card")) {
        e.preventDefault();
        e.stopPropagation();
        openMark(markEdit.dataset.markEdit || markEdit.dataset.markOpen || node.id, markEdit.dataset.markSurface || "");
        return;
      }
      const orderTypes = e.target.closest("[data-order-types]");
      if (orderTypes && node.type === "order") {
        showOrderTypeMenu(e.clientX, e.clientY, node.id);
      }
    });
    root.addEventListener("input", (e) => {
      if (e.target.dataset?.plannerColor) {
        const nodeEl = e.target.closest("[data-node]");
        const bp = activeBlueprint();
        const node = nodeEl && bp ? bp.nodes.find((item) => item.id === nodeEl.dataset.node) : null;
        if (node?.type === "planner") {
          node.color = String(e.target.value || "#65a30d").toLowerCase();
          const layout = plannerActive(node);
          if (layout) layout.color = node.color;
          nodeEl.style.setProperty("--planner-color", node.color);
          const card = nodeEl.querySelector(`.calc-film-card[data-planner-layout="${cssEsc(node.layoutId)}"]`);
          const thumb = card?.querySelector(".calc-film-thumb");
          if (thumb) thumb.style.setProperty("--film-tone", node.color);

          // Распространяем цвет по всей цепочке чертежей, а не только по прямым связям с планировщиком.
          // Обновление выполняется без render(), чтобы не закрывать системный выбор цвета.
          const graph = computeGraph(bp);
          (bp.nodes || []).forEach((target) => {
            if (target.type !== "openings" && target.type !== "electrics") return;
            const plan = upstreamPlan(target, bp, [], graph.values);
            if (!plan) return;
            const tones = markTones(target, plan.color);
            const targetEl = findNodeEl(target.id);
            if (!targetEl) return;
            targetEl.style.setProperty("--planner-color", tones.floor);
            targetEl.style.setProperty("--mark-floor", tones.floor);
            targetEl.style.setProperty("--mark-ceiling", tones.ceiling);
            targetEl.style.setProperty("--mark-wall", tones.wall);
            targetEl.querySelectorAll(".calc-film-thumb").forEach((filmThumb) => {
              const filmCard = filmThumb.closest("[data-mark-surface]");
              if (!filmCard) {
                filmThumb.style.setProperty("--film-tone", tones.floor);
                return;
              }
              const surface = filmCard.dataset.markSurface;
              const tone = surface === "ceiling" ? tones.ceiling : surface === "floor" ? tones.floor : tones.wall;
              filmThumb.style.setProperty("--film-tone", tone);
            });
          });
          dirty();
        } else if (node?.type === "openings" || node?.type === "electrics") {
          node.color = String(e.target.value || "#65a30d").toLowerCase();
          nodeEl.style.setProperty("--planner-color", node.color);
          const path = nodeEl.querySelector(".calc-planner-thumb path");
          if (path) path.style.stroke = node.color;
        }
        return;
      }
      if (e.target.dataset?.groupColor) {
        const nodeEl = e.target.closest("[data-node]");
        const bp = activeBlueprint();
        const node = nodeEl && bp ? bp.nodes.find((item) => item.id === nodeEl.dataset.node) : null;
        if (node?.type === "group") {
          node.color = String(e.target.value || "#14b8a6");
          const vis = groupsRoot()?.querySelector(`[data-node="${cssEsc(node.id)}"]`);
          const chrome = findGroupChrome(node.id);
          vis?.style.setProperty("--group-color", node.color);
          chrome?.style.setProperty("--group-color", node.color);
          drawMinimap(bp);
        }
        return;
      }
      const nodeEl = e.target.closest(".calc-node");
      const bp = activeBlueprint();
      const node = nodeEl && bp ? bp.nodes.find((item) => item.id === nodeEl.dataset.node) : null;
      if (!node || !bp) return;
      if (e.target.dataset?.constValue && node.type === "const") {
        const text = String(e.target.value || "").replace(",", ".").trim();
        if (text && text !== "-" && text !== "." && text !== "-.") {
          const value = Number(text);
          if (Number.isFinite(value)) node.value = value;
        } else if (!text) {
          node.value = 0;
        }
        dirty();
        patchGraphLive();
        return;
      }
      if (e.target.dataset?.constNote && node.type === "const") {
        node.note = String(e.target.value || "").slice(0, 500);
        dirty();
        return;
      }
      if (e.target.dataset?.commentText && node.type === "comment") {
        node.text = String(e.target.value || "").slice(0, 2000);
        dirty();
        return;
      }
      if (e.target.dataset?.plannerTitle && node.type === "planner") {
        node.name = String(e.target.value || "").trim().slice(0, 48);
        e.target.title = node.name;
        return;
      }
      if (e.target.dataset?.markTitle && (node.type === "openings" || node.type === "electrics")) {
        node.name = String(e.target.value || "").trim().slice(0, 48);
        e.target.title = node.name;
        const title = $("mark-title");
        if (title && document.activeElement !== title && session.mark?.id === node.id) title.value = node.name;
        return;
      }
      if ((e.target.dataset?.inName || e.target.dataset?.outName) && node.type === "formula") {
        const list = e.target.dataset.inName ? node.inputs : node.outputs;
        const portId = e.target.dataset.inName || e.target.dataset.outName;
        const port = (list || []).find((item) => item.id === portId);
        if (port) {
          let letter = "";
          for (const ch of String(e.target.value || "")) {
            if ((ch >= "a" && ch <= "z") || (ch >= "A" && ch <= "Z")) letter = ch.toUpperCase();
          }
          if (e.target.value !== letter) {
            e.target.value = letter;
            try {
              e.target.setSelectionRange(letter.length, letter.length);
            } catch {
              /* ignore */
            }
          }
          port.name = letter;
        }
        dirty();
        patchGraphLive();
        return;
      }
      if (e.target.dataset?.outExpr && node.type === "formula") {
        const port = (node.outputs || []).find((item) => item.id === e.target.dataset.outExpr);
        if (port) {
          const raw = e.target.value;
          const next = sanitizeFormulaExpr(raw);
          if (next !== raw) {
            const pos = e.target.selectionStart ?? raw.length;
            let kept = 0;
            let seen = 0;
            for (const ch of raw) {
              if (seen >= pos) break;
              seen += ch.length;
              kept += sanitizeFormulaExpr(ch).length;
            }
            e.target.value = next;
            try {
              e.target.setSelectionRange(kept, kept);
            } catch {
              /* ignore */
            }
          }
          port.expr = e.target.value;
        }
        dirty();
        patchGraphLive();
      }
    });
    root.addEventListener("toggle", (e) => {
      if (session.filterMultiLock) return;
      const box = e.target;
      if (!(box instanceof HTMLDetailsElement) || !box.classList.contains("calc-multi")) return;
      const nodeEl = box.closest("[data-node]");
      const field = box.dataset.filterMultiField || "";
      const nodeId = nodeEl?.dataset?.node || "";
      if (!field || !nodeId) return;
      if (box.open) {
        session.filterMultiOpen = { nodeId, field };
        session.filterMultiLock = true;
        try {
          nodesRoot()?.querySelectorAll(".calc-multi[open]").forEach((el) => {
            if (el !== box) el.open = false;
          });
        } finally {
          session.filterMultiLock = false;
        }
      } else if (session.filterMultiOpen?.nodeId === nodeId && session.filterMultiOpen?.field === field) {
        session.filterMultiOpen = null;
        session.filterMultiScroll = 0;
      }
    }, true);
    root.addEventListener("change", (e) => {
      const nodeEl = e.target.closest(".calc-node, .calc-group-chrome");
      const bp = activeBlueprint();
      const plannerPick = e.target.matches?.("[data-planner-pick]") ? e.target : null;
      const plannerId = plannerPick?.dataset.plannerPick || "";
      const node = bp ? bp.nodes.find((item) => item.id === (plannerId || nodeEl?.dataset.node)) : null;
      if (!node) return;
      if (e.target.dataset.resultName && node.type === "result") {
        node.name = String(e.target.value || "").trim().slice(0, 48) || "Результат";
        e.target.value = node.name;
        e.target.title = node.name;
        dirty();
        render();
        return;
      }
      if (e.target.dataset.plannerTitle && node.type === "planner") {
        node.name = plannerName({ name: e.target.value });
        e.target.value = node.name;
        e.target.title = node.name;
        dirty();
        return;
      }
      if (plannerPick && node.type === "planner") {
        const value = plannerPick.value;
        if (value === "__new") {
          const created = plannerAddLayout(node);
          if (!created) {
            plannerPick.value = node.layoutId;
            api?.toast?.("Достигнут лимит планировок");
            return;
          }
        } else plannerUseLayout(node, value);
        if (session.planner?.id === node.id) {
          session.planner.sel = null;
          plannerCommit(true);
        } else {
          dirty();
          render();
        }
        return;
      }
      if (e.target.dataset.markTitle && (node.type === "openings" || node.type === "electrics")) {
        const fallback = node.type === "electrics" ? "Электрика" : "Проёмы";
        node.name = String(e.target.value || "").trim().slice(0, 48) || fallback;
        e.target.value = node.name;
        e.target.title = node.name;
        const title = $("mark-title");
        if (title && session.mark?.id === node.id) title.value = node.name;
        dirty();
        return;
      }
      if (e.target.dataset.plannerColor && node.type === "planner") {
        node.color = String(e.target.value || "#65a30d").toLowerCase();
        dirty();
        render();
        return;
      }
      if (e.target.dataset.resultPrio && node.type === "result") {
        const n = Math.round(Number(e.target.value));
        node.priority = Number.isFinite(n) ? Math.max(0, Math.min(9999, n)) : nextResultPriority(bp);
        e.target.value = String(node.priority);
        dirty();
        render();
        return;
      }
      if (e.target.dataset.groupName && node.type === "group") {
        node.name = String(e.target.value || "").trim().slice(0, 48) || "Группа";
        e.target.value = node.name;
        e.target.title = node.name;
        dirty();
        return;
      }
      if (e.target.dataset.groupColor && node.type === "group") {
        node.color = String(e.target.value || "#14b8a6");
        const vis = groupsRoot()?.querySelector(`[data-node="${cssEsc(node.id)}"]`);
        const chrome = findGroupChrome(node.id);
        vis?.style.setProperty("--group-color", node.color);
        chrome?.style.setProperty("--group-color", node.color);
        dirty();
        drawMinimap(bp);
        return;
      }
      if (e.target.dataset.constValue && node.type === "const") {
        node.value = parseConstValue(e.target.value);
        e.target.value = String(node.value);
        dirty();
        render();
        return;
      }
      if (e.target.dataset.filterField && (node.type === "filter" || node.type === "dashboard")) {
        const field = e.target.dataset.filterField;
        const raw = String(e.target.value || "").trim();
        if (field === "period") node.period = DASH_PERIODS.some(([id]) => id === raw) ? raw : "all";
        else if (field === "dateFrom") node.dateFrom = raw.slice(0, 10);
        else if (field === "dateTo") node.dateTo = raw.slice(0, 10);
        dirty();
        render();
        return;
      }
      if (e.target.dataset.filterMulti && (node.type === "filter" || node.type === "dashboard")) {
        const field = e.target.dataset.filterMulti;
        const box = e.target.closest(".calc-multi");
        const checked = [...(box?.querySelectorAll(`input[data-filter-multi="${cssEsc(field)}"]:checked`) || [])].map((el) =>
          String(el.value || "").trim()
        );
        const allowed = new Set(["customers", "orderIds", "payFilters", "payStatusFilters", "orderTypes", "products", "statuses"]);
        if (!allowed.has(field)) return;
        node[field] = uniqueStrings(checked).slice(0, FILTER_MULTI_MAX);
        if (field === "customers") {
          const keys = new Set(node.customers.map((name) => name.toLowerCase()));
          if (keys.size) {
            node.orderIds = (node.orderIds || []).filter((id) => {
              const order = api.findOrder?.(id);
              return order && keys.has(String(order.customer || "").toLowerCase());
            });
          }
        }
        normalizeFilterNode(node);
        session.filterMultiOpen = { nodeId: node.id, field };
        const listEl = box?.querySelector(".calc-multi-list");
        if (listEl) session.filterMultiScroll = listEl.scrollTop;
        dirty();
        render();
        return;
      }
      if (node.type !== "formula") return;
      if (e.target.dataset.formulaProfile != null) {
        const raw = String(e.target.value || "");
        if (!raw) return;
        const profile = loadFormulaProfiles()[Number(raw)];
        if (!profile) return;
        applyFormulaProfile(node, bp, profile);
        dirty();
        render();
        api?.toast?.(`Профиль «${profile.name}»`);
        return;
      }
      if (e.target.dataset.inName) {
        const port = node.inputs.find((item) => item.id === e.target.dataset.inName);
        if (port) {
          const used = formulaLetterSet(node, port.id);
          port.name = sanitizeFormulaInput(e.target.value, used, port.name);
          e.target.value = port.name;
        }
      }
      if (e.target.dataset.outName) {
        const port = node.outputs.find((item) => item.id === e.target.dataset.outName);
        if (port) {
          const used = formulaLetterSet(node, port.id);
          port.name = sanitizeFormulaInput(e.target.value, used, port.name);
          e.target.value = port.name;
        }
      }
      if (e.target.dataset.outExpr) {
        const port = node.outputs.find((item) => item.id === e.target.dataset.outExpr);
        if (port) {
          port.expr = sanitizeFormulaExpr(e.target.value);
          e.target.value = port.expr;
        }
      }
      dirty();
      render();
    });
    root.addEventListener("keydown", (e) => {
      if (e.key !== "Enter") return;
      if (e.target.matches(".calc-expr, .calc-pname, .calc-const-val, .calc-filter-input")) {
        e.preventDefault();
        e.target.blur();
      }
    });
    document.addEventListener("pointermove", (e) => {
      if (api?.view?.() !== "calculator" || !session.linking || session.drag || session.pan) return;
      const bp = activeBlueprint();
      if (!bp) return;
      const at = screenToWorld(e.clientX, e.clientY, bp);
      session.linking.x = at.x;
      session.linking.y = at.y;
      drawWires(bp, computeGraph(bp));
      const want = session.linking.reverse ? "out" : "in";
      nodesRoot()?.querySelectorAll(".calc-port").forEach((el) => el.classList.toggle("is-hot", false));
      const over = document.elementFromPoint(e.clientX, e.clientY)?.closest?.(".calc-port");
      if (over?.dataset.io === want) {
        const owner = bp.nodes.find((item) => item.id === over.closest(".calc-node")?.dataset.node);
        const dragNode = bp.nodes.find((item) => item.id === (session.linking.reverse ? session.linking.to : session.linking.from));
        const dragPort = session.linking.reverse ? session.linking.toPort : session.linking.fromPort;
        if (portSignal(owner, over.dataset.port) === portSignal(dragNode, dragPort)) over.classList.add("is-hot");
      }
    });
    document.addEventListener("keydown", (e) => {
      if (api?.view?.() !== "calculator") return;
      if (session.mark?.id) {
        const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName) || e.target.isContentEditable;
        if (e.key === "Escape") {
          e.preventDefault();
          if (!$("mark-menu")?.hidden) markHideMenu();
          else closeMark();
          return;
        }
        if (!typing && (e.key === "Delete" || e.key === "Backspace")) {
          e.preventDefault();
          const node = markNode();
          const sel = session.mark.sel;
          if (!node || !sel) return;
          if (node.type === "openings") {
            node.holes = node.holes.filter((hole) => hole.id !== sel);
            const bp = activeBlueprint();
            if (bp) bp.links = (bp.links || []).filter((link) => !(link.to === node.id && String(link.toPort || "").startsWith(`b:${sel}:`)));
          } else node.fixtures = node.fixtures.filter((item) => item.id !== sel);
          session.mark.sel = "";
          markCommit(true);
          return;
        }
        if ((e.ctrlKey || e.metaKey) && !e.altKey && e.code === "KeyD") {
          e.preventDefault();
          return;
        }
      }
      if (session.planner?.id) {
        const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName) || e.target.isContentEditable;
        if (e.key === "Escape") {
          e.preventDefault();
          if (session.planner.nudge) plannerHideNudge();
          else closePlanner();
          return;
        }
        if (!typing && (e.key === "Delete" || e.key === "Backspace") && session.planner.sel?.kind === "point") {
          e.preventDefault();
          plannerDeleteSelected();
          return;
        }
        if ((e.ctrlKey || e.metaKey) && !e.altKey && e.code === "KeyD") {
          e.preventDefault();
          return;
        }
        if (!typing && (e.key === "Delete" || e.key === "Backspace")) {
          e.preventDefault();
          return;
        }
      }
      if (e.key === "Escape") {
        hidePortMenu();
        session.resize = null;
        let redraw = false;
        if (session.linking) {
          session.linking = null;
          setLinkingClass();
          redraw = true;
        }
        if (session.selectedLink) {
          session.selectedLink = "";
          redraw = true;
        }
        if (redraw) {
          const bp = activeBlueprint();
          if (bp) drawWires(bp, computeGraph(bp));
        }
        return;
      }
      const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName) || e.target.isContentEditable;
      if (typing) return;
      if ((e.ctrlKey || e.metaKey) && !e.altKey && e.code === "KeyD" && session.selected) {
        e.preventDefault();
        duplicateNode(session.selected);
        return;
      }
      if ((e.key === "Delete" || e.key === "Backspace") && session.selectedLink) {
        e.preventDefault();
        removeLink(session.selectedLink);
        return;
      }
      if ((e.key === "Delete" || e.key === "Backspace") && session.selected) {
        e.preventDefault();
        removeNode(session.selected);
      }
    });
    window.addEventListener("resize", () => {
      if (session.planner?.id) plannerDraw();
      if (api?.view?.() === "calculator") {
        const bp = activeBlueprint();
        if (bp) {
          drawWires(bp, computeGraph(bp));
          drawMinimap(bp);
        }
      }
    });
  }

  window.FinCalc = {
    bind(next) {
      api = next;
      bind();
    },
    render(next) {
      if (next) api = next;
      render();
    },
    presentValue(blockId, portId) {
      const key = `${blockId}:${portId}`;
      if (!presentValues.has(key)) return null;
      return presentValues.get(key);
    },
    syncPresentValues(next) {
      if (next) api = next;
      rebuildPresentValues();
    },
    refreshPresent() {
      renderPresentPanel();
    },
    refreshEditors() {
      refreshEditors();
    },
    editorKeys(e) {
      const open = $("planner-modal")?.classList.contains("open") || $("mark-modal")?.classList.contains("open");
      if (!open || !e.ctrlKey && !e.metaKey) return false;
      if (e.code === "KeyZ" && !e.shiftKey) {
        editorUndo();
        return true;
      }
      if (e.code === "KeyY" || (e.code === "KeyZ" && e.shiftKey)) {
        editorRedo();
        return true;
      }
      return false;
    },
    hidePresentPanel() {
      hidePresentPanel();
    },
    removePresentBlock(blockId) {
      return removePresentBlockNodes(blockId);
    },
    orderFieldLocks() {
      try {
        return collectOrderFieldLocks();
      } catch (err) {
        console.warn("calc orderFieldLocks", err);
        return [];
      }
    },
    orderFieldLock(orderId, lineId, fieldOrExpr) {
      try {
        const locks = collectOrderFieldLocks();
        const field = exprKeyToField(fieldOrExpr);
        return (
          locks.find((item) => item.orderId === orderId && item.lineId === lineId && item.field === field) || null
        );
      } catch (err) {
        console.warn("calc orderFieldLock", err);
        return null;
      }
    },
    focusOrderField(orderId, lineId, fieldOrExpr) {
      try {
        const field = exprKeyToField(fieldOrExpr);
        const owner = orderFieldOwner(orderId, lineId, field);
        if (!owner?.blueprint || !owner.node) return false;
        const calc = ensureState();
        if (!calc) return false;
        calc.active = owner.blueprint.id;
        session.selected = owner.node.id;
        session.selectedLink = "";
        const portId = lineInPortId(lineId, field);
        session.jump = { nodeId: owner.node.id, portId };
        session.pendingFocus = { nodeId: owner.node.id, portId };
        dirty();
        return true;
      } catch (err) {
        console.warn("calc focusOrderField", err);
        return false;
      }
    },
    pruneOrderLinks(orderId, lineId) {
      return pruneOrderCalcLinks(orderId, lineId);
    },
  };
})();
