  function nodesRoot() {
    return $("calc-nodes") || $("calc-world");
  }

  function groupsRoot() {
    return $("calc-groups");
  }

  function groupUiRoot() {
    return $("calc-group-ui");
  }

  function wireUiRoot() {
    return $("calc-wire-ui");
  }

  function findNodeEl(id) {
    const key = cssEsc(id);
    return (
      nodesRoot()?.querySelector(`[data-node="${key}"]`) ||
      groupsRoot()?.querySelector(`[data-node="${key}"]`) ||
      groupUiRoot()?.querySelector(`[data-node="${key}"]`) ||
      null
    );
  }

  function findGroupChrome(id) {
    return groupUiRoot()?.querySelector(`.calc-group-chrome[data-node="${cssEsc(id)}"]`) || null;
  }

  function applyNodeEl(node) {
    const el = groupsRoot()?.querySelector(`[data-node="${cssEsc(node.id)}"]`) || nodesRoot()?.querySelector(`[data-node="${cssEsc(node.id)}"]`);
    const chrome = node.type === "group" ? findGroupChrome(node.id) : null;
    if (el) {
      el.style.left = `${node.x || 0}px`;
      el.style.top = `${node.y || 0}px`;
      if (node.type === "group") {
        el.style.width = `${Math.max(160, node.w || 320)}px`;
        el.style.height = `${Math.max(120, node.h || 220)}px`;
      }
    }
    if (chrome) {
      chrome.style.left = `${node.x || 0}px`;
      chrome.style.top = `${node.y || 0}px`;
      chrome.style.width = `${Math.max(160, node.w || 320)}px`;
      chrome.style.height = `${Math.max(120, node.h || 220)}px`;
    }
  }

  function miniNodeColor(node) {
    if (node?.type === "group") return String(node.color || "#14b8a6");
    const kind = wireKind(node);
    const map = {
      order: "#0d9488",
      math: "#f97316",
      formula: "#a855f7",
      percent: "#f43f5e",
      const: "#64748b",
      result: "#06b6d4",
      scheme: "#eab308",
      filter: "#0ea5e9",
      dashboard: "#14b8a6",
      present: "#8b5cf6",
      group: "#94a3b8",
    };
    return map[kind] || "#0d9488";
  }

  function blueprintBounds(bp) {
    const nodes = bp?.nodes || [];
    if (!nodes.length) return { minX: -80, minY: -60, maxX: 320, maxY: 220, width: 400, height: 280 };
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    nodes.forEach((node) => {
      const size = nodeFootprint(node);
      minX = Math.min(minX, node.x || 0);
      minY = Math.min(minY, node.y || 0);
      maxX = Math.max(maxX, (node.x || 0) + size.w);
      maxY = Math.max(maxY, (node.y || 0) + size.h);
    });
    const pad = 80;
    minX -= pad;
    minY -= pad;
    maxX += pad;
    maxY += pad;
    return { minX, minY, maxX, maxY, width: Math.max(1, maxX - minX), height: Math.max(1, maxY - minY) };
  }

  function drawMinimap(bp) {
    const canvas = $("calc-minimap");
    const board = $("calc-board");
    const wrap = $("calc-mini-wrap");
    if (!canvas || !board || !bp) return;
    if (session.miniHidden) {
      wrap?.classList.add("is-hidden");
      board.classList.add("is-mini-hidden");
      return;
    }
    wrap?.classList.remove("is-hidden");
    board.classList.remove("is-mini-hidden");
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const cssW = 200;
    const cssH = 128;
    if (canvas.width !== Math.round(cssW * dpr) || canvas.height !== Math.round(cssH * dpr)) {
      canvas.width = Math.round(cssW * dpr);
      canvas.height = Math.round(cssH * dpr);
      canvas.style.width = `${cssW}px`;
      canvas.style.height = `${cssH}px`;
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const w = cssW;
    const h = cssH;
    const box = blueprintBounds(bp);
    const boardRect = board.getBoundingClientRect();
    const zoom = bp.zoom || 1;
    const view = {
      x: -(bp.x || 0) / zoom,
      y: -(bp.y || 0) / zoom,
      w: boardRect.width / zoom,
      h: boardRect.height / zoom,
    };
    const inset = 10;
    const scale = Math.min((w - inset * 2) / box.width, (h - inset * 2) / box.height);
    const ox = (w - box.width * scale) / 2 - box.minX * scale;
    const oy = (h - box.height * scale) / 2 - box.minY * scale;
    session.mini = { scale, ox, oy, w, h };

    const dark = document.documentElement.getAttribute("data-theme") === "dark";
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = dark ? "#0b1220" : "#eef3f8";
    ctx.fillRect(0, 0, w, h);

    const byId = Object.fromEntries((bp.nodes || []).map((node) => [node.id, node]));
    (bp.links || []).forEach((link) => {
      const a = byId[link.from];
      const b = byId[link.to];
      if (!a || !b) return;
      const as = nodeFootprint(a);
      const bs = nodeFootprint(b);
      ctx.strokeStyle = dark ? "rgba(148,163,184,0.35)" : "rgba(100,116,139,0.35)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo((a.x || 0) * scale + ox + (as.w * scale) / 2, (a.y || 0) * scale + oy + (as.h * scale) / 2);
      ctx.lineTo((b.x || 0) * scale + ox + (bs.w * scale) / 2, (b.y || 0) * scale + oy + (bs.h * scale) / 2);
      ctx.stroke();
    });

    (bp.nodes || [])
      .filter((node) => node.type === "group")
      .forEach((node) => {
        const gr = groupRect(node);
        const x = gr.x * scale + ox;
        const y = gr.y * scale + oy;
        const rw = Math.max(6, gr.w * scale);
        const rh = Math.max(5, gr.h * scale);
        ctx.fillStyle = miniNodeColor(node);
        ctx.globalAlpha = 0.22;
        ctx.fillRect(x, y, rw, rh);
        ctx.globalAlpha = 0.7;
        ctx.strokeStyle = miniNodeColor(node);
        ctx.lineWidth = 1;
        ctx.strokeRect(x, y, rw, rh);
        ctx.globalAlpha = 1;
      });

    (bp.nodes || [])
      .filter((node) => node.type !== "group")
      .forEach((node) => {
      const size = nodeFootprint(node);
      const x = (node.x || 0) * scale + ox;
      const y = (node.y || 0) * scale + oy;
      const rw = Math.max(4, size.w * scale);
      const rh = Math.max(3, size.h * scale);
      ctx.fillStyle = miniNodeColor(node);
      ctx.globalAlpha = session.selected === node.id ? 1 : 0.85;
      ctx.beginPath();
      const r = 2;
      ctx.moveTo(x + r, y);
      ctx.arcTo(x + rw, y, x + rw, y + rh, r);
      ctx.arcTo(x + rw, y + rh, x, y + rh, r);
      ctx.arcTo(x, y + rh, x, y, r);
      ctx.arcTo(x, y, x + rw, y, r);
      ctx.closePath();
      ctx.fill();
      if (session.selected === node.id) {
        ctx.strokeStyle = dark ? "#f8fafc" : "#0f172a";
        ctx.lineWidth = 1.2;
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
    });

    ctx.strokeStyle = "#14b8a6";
    ctx.lineWidth = 1.4;
    ctx.strokeRect(view.x * scale + ox, view.y * scale + oy, Math.max(8, view.w * scale), Math.max(8, view.h * scale));
    ctx.fillStyle = "rgba(20, 184, 166, 0.12)";
    ctx.fillRect(view.x * scale + ox, view.y * scale + oy, Math.max(8, view.w * scale), Math.max(8, view.h * scale));
  }

  function miniWorldPoint(clientX, clientY) {
    const canvas = $("calc-minimap");
    const map = session.mini;
    if (!canvas || !map) return null;
    const rect = canvas.getBoundingClientRect();
    const sx = ((clientX - rect.left) / rect.width) * map.w;
    const sy = ((clientY - rect.top) / rect.height) * map.h;
    return {
      x: (sx - map.ox) / map.scale,
      y: (sy - map.oy) / map.scale,
    };
  }

  function centerViewOn(bp, worldX, worldY) {
    const board = $("calc-board");
    if (!board || !bp) return;
    const rect = board.getBoundingClientRect();
    const zoom = bp.zoom || 1;
    bp.x = rect.width / 2 - worldX * zoom;
    bp.y = rect.height / 2 - worldY * zoom;
    applyWorld(bp);
    drawMinimap(bp);
  }

  function nextLetter(used) {
    for (const letter of LETTERS) {
      if (!used.has(letter)) return letter;
    }
    return "";
  }

  function nextName(used) {
    for (const letter of LETTERS) {
      if (!used.has(letter)) return letter;
    }
    let i = used.size + 1;
    while (used.has(`P${i}`)) i += 1;
    return `P${i}`;
  }

  function formulaLetterSet(node, exceptId) {
    const used = new Set();
    for (const port of node.inputs || []) {
      if (exceptId && port.id === exceptId) continue;
      const name = String(port.name || "").trim();
      if (name) used.add(name);
    }
    for (const port of node.outputs || []) {
      if (exceptId && port.id === exceptId) continue;
      const name = String(port.name || "").trim();
      if (name) used.add(name);
    }
    return used;
  }

  function sanitizeFormulaInput(raw, used, fallback) {
    const letter = String(raw || "")
      .trim()
      .toUpperCase()
      .replace(/[^A-Z]/g, "")
      .slice(0, 1);
    if (letter && !used.has(letter)) return letter;
    return fallback || nextLetter(used) || "A";
  }

  function parseConstValue(raw) {
    const text = String(raw ?? "").replace(",", ".").trim();
    if (!text) return 0;
    const value = Number(text);
    return Number.isFinite(value) ? value : 0;
  }

  function addNode(type, point, extra) {
    const bp = activeBlueprint();
    if (!bp) return;
    const at = point || viewCenter(bp);
    session.place += 1;
    const node = { id: uid(), type, x: at.x, y: at.y };
    if (type === "math") node.op = "+";
    if (type === "result") {
      node.op = "result";
      node.name = "Результат";
      node.priority = nextResultPriority(bp);
      node.visible = true;
    }
    if (type === "percent") node.op = "percent";
    if (type === "const") node.value = 0;
    if (type === "scheme") node.blueprintId = extra?.blueprintId || "";
    if (type === "formula") {
      node.inputs = [
        { id: uid(), name: "A" },
        { id: uid(), name: "B" },
      ];
      node.outputs = [
        { id: uid(), name: "C", expr: "A+B" },
        { id: uid(), name: "D", expr: "(-40+A)*B" },
      ];
    }
    if (type === "order") node.orderId = extra?.orderId || "";
    if (type === "filter") {
      node.customers = [];
      node.orderIds = [];
      node.period = "all";
      node.payFilters = [];
      node.statuses = [];
      node.orderTypes = [];
      node.products = [];
      node.dateFrom = "";
      node.dateTo = "";
    }
    if (type === "dashboard") {
      node.customers = [];
      node.orderIds = [];
      node.period = "all";
      node.payFilters = [];
      node.statuses = [];
      node.orderTypes = [];
      node.products = [];
      node.dateFrom = "";
      node.dateTo = "";
      node.openPorts = DASH_DEFAULT.slice();
    }
    if (type === "present") {
      node.pageId = extra?.pageId || "";
      node.blockId = extra?.blockId || "";
      node.blockType = extra?.blockType || "metric";
      node.title = extra?.title || "Блок";
    }
    if (type === "group") {
      node.name = "Группа";
      node.color = GROUP_COLORS[Math.floor(Math.random() * GROUP_COLORS.length)];
      node.w = 320;
      node.h = 220;
    }
    bp.nodes.push(node);
    session.selected = node.id;
    dirty();
    render();
  }

  function removeNode(id) {
    const bp = activeBlueprint();
    if (!bp) return;
    bp.nodes = bp.nodes.filter((node) => node.id !== id);
    bp.links = bp.links.filter((link) => link.from !== id && link.to !== id);
    if (session.selected === id) session.selected = "";
    dirty();
    render();
  }

  function duplicateNode(id) {
    const bp = activeBlueprint();
    if (!bp || !id) return;
    const src = (bp.nodes || []).find((node) => node.id === id);
    if (!src) return;
    let clone;
    try {
      clone = JSON.parse(JSON.stringify(src));
    } catch {
      return;
    }
    clone.id = uid();
    clone.x = (Number(src.x) || 0) + 48;
    clone.y = (Number(src.y) || 0) + 48;
    if (clone.type === "formula") {
      (clone.inputs || []).forEach((port) => {
        port.id = uid();
      });
      (clone.outputs || []).forEach((port) => {
        port.id = uid();
      });
    }
    if (clone.type === "result") {
      clone.priority = nextResultPriority(bp);
    }
    bp.nodes.push(clone);
    session.selected = clone.id;
    dirty();
    render();
  }

  function pruneOrphanNodes() {
    const bp = activeBlueprint();
    if (!bp) return 0;
    const linked = new Set();
    (bp.links || []).forEach((link) => {
      if (link.from) linked.add(link.from);
      if (link.to) linked.add(link.to);
    });
    const before = (bp.nodes || []).length;
    bp.nodes = (bp.nodes || []).filter((node) => node.type === "scheme" || node.type === "group" || linked.has(node.id));
    const removed = before - bp.nodes.length;
    if (!removed) return 0;
    const keep = new Set(bp.nodes.map((node) => node.id));
    bp.links = (bp.links || []).filter((link) => keep.has(link.from) && keep.has(link.to));
    if (session.selected && !keep.has(session.selected)) session.selected = "";
    dirty();
    render();
    return removed;
  }

  function usedInputPorts(nodeId, links) {
    const used = new Set();
    (links || []).forEach((link) => {
      if (link.to === nodeId) used.add(link.toPort);
    });
    return used;
  }

  function firstFreeMathPort(nodeId, links) {
    const used = usedInputPorts(nodeId, links);
    for (let i = 1; i <= MATH_MAX; i += 1) {
      if (!used.has(`in${i}`)) return `in${i}`;
    }
    return "";
  }

  function resolveToPort(dst, requested, links) {
    if (dst.type === "math") {
      if (/^in([1-9]|1[0-9]|20)$/.test(requested || "")) return requested;
      return firstFreeMathPort(dst.id, links);
    }
    if (dst.type === "order") {
      const parsed = parseLinePort(requested);
      if (parsed?.input && parsed.field) {
        const order = api.findOrder(dst.orderId);
        const line = (order?.lines || []).find((item) => item.id === parsed.lineId);
        if (lineInputFieldOptions(line, order).some((item) => item.id === parsed.field)) {
          ensureOpenField(dst, parsed.lineId, parsed.field);
          return lineInPortId(parsed.lineId, parsed.field);
        }
        return "";
      }
    }
    const inputs = nodeInputs(dst, links);
    if (requested && inputs.some((port) => port.id === requested)) return requested;
    return inputs[0]?.id || "";
  }

  function matchPortId(wanted, ids) {
    if (!wanted) return "";
    if (ids.includes(wanted)) return wanted;
    const hits = ids.filter((id) => id.startsWith(wanted) || wanted.startsWith(id));
    return hits.length === 1 ? hits[0] : "";
  }

  function healLinks(bp) {
    if (!bp) return false;
    let changed = false;
    // Убрать устаревшие текстовые порты «за что» / product
    (bp.nodes || []).forEach((node) => {
      if (node.type !== "order" || !node.openFields) return;
      Object.keys(node.openFields).forEach((lineId) => {
        const list = node.openFields[lineId] || [];
        const next = list.filter((f) => f !== "product");
        if (next.length === list.length) return;
        changed = true;
        if (next.length) node.openFields[lineId] = next;
        else delete node.openFields[lineId];
      });
    });
    const beforeLinks = (bp.links || []).length;
    bp.links = (bp.links || []).filter((link) => {
      const to = parseLinePort(link.toPort);
      const from = parseLinePort(link.fromPort);
      if (to?.field === "product" || from?.field === "product") return false;
      return true;
    });
    if ((bp.links || []).length !== beforeLinks) changed = true;
    (bp.links || []).forEach((link) => {
      const src = (bp.nodes || []).find((node) => node.id === link.from);
      const dst = (bp.nodes || []).find((node) => node.id === link.to);
      if (src?.type === "order") {
        const ids = nodeOutputs(src, api.findOrder(src.orderId), bp.links).map((port) => port.id);
        const hit = matchPortId(link.fromPort, ids);
        if (hit && hit !== link.fromPort) {
          link.fromPort = hit;
          changed = true;
        }
      }
      if (dst?.type === "order") {
        const ids = nodeInputs(dst, bp.links).map((port) => port.id);
        const hit = matchPortId(link.toPort, ids);
        if (hit && hit !== link.toPort) {
          link.toPort = hit;
          changed = true;
        }
      }
    });
    return changed;
  }

  function connect(from, fromPort, to, toPort) {
    const bp = activeBlueprint();
    if (!bp || from === to) return false;
    const src = bp.nodes.find((node) => node.id === from);
    const dst = bp.nodes.find((node) => node.id === to);
    if (!src || !dst) return false;
    const srcIds = nodeOutputs(src, api.findOrder(src.orderId), bp.links).map((port) => port.id);
    const fromHit = matchPortId(fromPort, srcIds);
    if (!fromHit) return false;
    const port = resolveToPort(dst, toPort, bp.links);
    if (!port) return false;
    if (dst.type === "present" && dst.blockId) {
      const owner = presentOwner(dst.blockId, port, bp.id);
      if (owner) {
        api?.toast?.(`Вход занят схемой «${owner.blueprint.name || "Схема"}»`);
        return false;
      }
    }
    if (dst.type === "order") {
      const parsed = parseLinePort(port);
      if (parsed?.input && parsed.field) {
        const order = api.findOrder(dst.orderId);
        const line = (order?.lines || []).find((item) => item.id === parsed.lineId);
        const allowed = lineInputFieldOptions(line, order).some((item) => item.id === parsed.field);
        if (!allowed) {
          api?.toast?.("Это поле нельзя подать на вход этой позиции");
          return false;
        }
        const owner = orderFieldOwner(dst.orderId, parsed.lineId, parsed.field);
        // Разрешаем только замену связи на том же порту той же ноды
        if (owner && !(owner.blueprint.id === bp.id && owner.node.id === dst.id && owner.link.toPort === port)) {
          api?.toast?.(orderFieldOwnerReason(owner, line, order, parsed.field));
          return false;
        }
        ensureOpenField(dst, parsed.lineId, parsed.field);
      }
    }
    const replaced = (bp.links || []).filter((link) => link.to === to && link.toPort === port);
    bp.links = bp.links.filter((link) => !(link.to === to && link.toPort === port));
    bp.links.push({ id: uid(), from, fromPort: fromHit, to, toPort: port });
    replaced.forEach((link) => releaseOrderField(bp, link.from, link.fromPort));
    dirty();
    render();
    if (dst.type === "order") api?.refreshOrders?.();
    return true;
  }

  function releaseOrderField(bp, nodeId, fromPort) {
    const parsed = parseLinePort(fromPort);
    if (parsed?.field && !parsed.input) {
      const still = (bp.links || []).some((link) => link.from === nodeId && link.fromPort === fromPort);
      if (still) return;
      const inStill = (bp.links || []).some(
        (link) => link.to === nodeId && link.toPort === lineInPortId(parsed.lineId, parsed.field)
      );
      if (inStill) return;
      const node = (bp.nodes || []).find((item) => item.id === nodeId && item.type === "order");
      if (node) dropOpenField(node, parsed.lineId, parsed.field);
      return;
    }
    const typed = parseTypePort(fromPort);
    if (!typed?.field) return;
    const stillType = (bp.links || []).some((link) => link.from === nodeId && link.fromPort === fromPort);
    if (stillType) return;
    const orderNode = (bp.nodes || []).find((item) => item.id === nodeId && item.type === "order");
    if (orderNode) dropOpenTypeField(orderNode, typed.typeName, typed.field);
  }

  function releaseOrderInputField(bp, nodeId, toPort) {
    const parsed = parseLinePort(toPort);
    if (!parsed?.input || !parsed.field) return;
    const stillIn = (bp.links || []).some((link) => link.to === nodeId && link.toPort === toPort);
    if (stillIn) return;
    const stillOut = (bp.links || []).some(
      (link) => link.from === nodeId && link.fromPort === `line:${parsed.lineId}:${parsed.field}`
    );
    if (stillOut) return;
    const node = (bp.nodes || []).find((item) => item.id === nodeId && item.type === "order");
    if (!node) return;
    const open = openFieldsFor(node, parsed.lineId);
    // Не снимаем поле с ноды автоматически при обрыве только входа — оставляем, если явно открыто.
    if (!open.includes(parsed.field)) return;
  }

  function removeLink(id) {
    const bp = activeBlueprint();
    if (!bp || !id) return;
    const gone = bp.links.find((link) => link.id === id);
    const before = bp.links.length;
    bp.links = bp.links.filter((link) => link.id !== id);
    if (bp.links.length !== before) {
      if (session.selectedLink === id) session.selectedLink = "";
      if (gone) {
        releaseOrderField(bp, gone.from, gone.fromPort);
        releaseOrderInputField(bp, gone.to, gone.toPort);
      }
      dirty();
      render();
      api?.refreshOrders?.();
    }
  }

  function finishLink(from, fromPort, to, toPort) {
    session.linking = null;
    setLinkingClass();
    return connect(from, fromPort, to, toPort);
  }

  function disconnectInput(nodeId, portId) {
    const bp = activeBlueprint();
    if (!bp) return;
    const gone = (bp.links || []).filter((link) => link.to === nodeId && link.toPort === portId);
    const before = bp.links.length;
    bp.links = bp.links.filter((link) => !(link.to === nodeId && link.toPort === portId));
    if (bp.links.length !== before) {
      gone.forEach((link) => {
        releaseOrderField(bp, link.from, link.fromPort);
        releaseOrderInputField(bp, link.to, link.toPort);
      });
      dirty();
      render();
      api?.refreshOrders?.();
    }
  }

