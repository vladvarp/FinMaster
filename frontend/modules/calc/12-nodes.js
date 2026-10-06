  function renderNodes(bp, graph) {
    const host = nodesRoot();
    const groups = groupsRoot();
    const groupUi = groupUiRoot();
    if (!host) return;
    const focus = document.activeElement;
    const focusHost = host.contains(focus) || groups?.contains(focus) || groupUi?.contains(focus) ? focus : null;
    const keep = focusHost
      ? {
          name: focus.dataset.inName || focus.dataset.outName || focus.dataset.outExpr || focus.dataset.resultName || focus.dataset.resultPrio || focus.dataset.constValue || focus.dataset.groupName || focus.dataset.filterField,
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
        : host.querySelector(`[data-in-name="${cssEsc(keep.name)}"], [data-out-name="${cssEsc(keep.name)}"], [data-out-expr="${cssEsc(keep.name)}"], [data-result-name="${cssEsc(keep.name)}"], [data-result-prio="${cssEsc(keep.name)}"], [data-const-value="${cssEsc(keep.name)}"]`) ||
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
    if (type === "math" || type === "formula" || type === "percent" || type === "const" || type === "result" || type === "scheme" || type === "group" || type === "filter" || type === "dashboard" || type === "present" || type === "comment") return type;
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
    btn.classList.toggle("is-on", !!session.moveChain);
    btn.setAttribute("aria-pressed", session.moveChain ? "true" : "false");
    btn.title = session.moveChain ? "Цепочка входов: вкл" : "Тянуть цепочку входов";
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

