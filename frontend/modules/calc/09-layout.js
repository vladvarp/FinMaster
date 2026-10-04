  function worldPoint(bp, clientX, clientY) {
    return screenToWorld(clientX, clientY, bp);
  }

  function applyWorld(bp) {
    const world = $("calc-world");
    if (!world || !bp) return;
    world.style.transform = `translate(${bp.x || 0}px, ${bp.y || 0}px) scale(${bp.zoom || 1})`;
  }

  function nodeFootprint(node) {
    const el = findNodeEl(node.id);
    if (el) return { w: Math.max(40, el.offsetWidth), h: Math.max(28, el.offsetHeight) };
    if (node.type === "formula") return { w: 360, h: 160 };
    if (node.type === "order") return { w: 230, h: 140 };
    if (node.type === "scheme") return { w: 220, h: 100 };
    if (node.type === "result") return { w: 376, h: 120 };
    if (node.type === "filter" || node.type === "dashboard") return { w: 384, h: 420 };
    if (node.type === "present") return { w: 220, h: 160 };
    if (node.type === "group") return { w: Math.max(160, node.w || 320), h: Math.max(120, node.h || 220) };
    return { w: 188, h: 120 };
  }

  function groupRect(node) {
    return {
      x: node.x || 0,
      y: node.y || 0,
      w: Math.max(160, Number(node.w) || 320),
      h: Math.max(120, Number(node.h) || 220),
    };
  }

  function nodeRect(node) {
    const size = nodeFootprint(node);
    return { x: node.x || 0, y: node.y || 0, w: size.w, h: size.h };
  }

  function overlapArea(a, b) {
    const x1 = Math.max(a.x, b.x);
    const y1 = Math.max(a.y, b.y);
    const x2 = Math.min(a.x + a.w, b.x + b.w);
    const y2 = Math.min(a.y + a.h, b.y + b.h);
    if (x2 <= x1 || y2 <= y1) return 0;
    return (x2 - x1) * (y2 - y1);
  }

  function nodesInsideGroup(bp, group, seen) {
    const visited = seen || new Set();
    if (!group || visited.has(group.id)) return [];
    visited.add(group.id);
    const gr = groupRect(group);
    const selfArea = gr.w * gr.h;
    const direct = (bp.nodes || []).filter((node) => {
      if (visited.has(node.id)) return false;
      // Не тянуть родительские/более крупные группы (их центр часто попадает внутрь вложенной)
      if (node.type === "group" && groupArea(node) >= selfArea) return false;
      const nr = nodeRect(node);
      const cx = nr.x + nr.w / 2;
      const cy = nr.y + nr.h / 2;
      return cx >= gr.x && cx <= gr.x + gr.w && cy >= gr.y && cy <= gr.y + gr.h;
    });
    const all = new Map();
    direct.forEach((node) => {
      all.set(node.id, node);
      if (node.type === "group") {
        nodesInsideGroup(bp, node, visited).forEach((child) => all.set(child.id, child));
      }
    });
    return [...all.values()];
  }

  function groupArea(node) {
    const gr = groupRect(node);
    return gr.w * gr.h;
  }

  function sortGroupsByArea(groups) {
    return [...groups].sort((a, b) => groupArea(b) - groupArea(a));
  }

  function containNodeInGroup(node, group) {
    const gr = groupRect(group);
    const size = nodeFootprint(node);
    const maxX = gr.x + Math.max(0, gr.w - size.w);
    const maxY = gr.y + Math.max(0, gr.h - size.h);
    node.x = Math.min(Math.max(node.x || 0, gr.x), maxX);
    node.y = Math.min(Math.max(node.y || 0, gr.y), maxY);
  }

  function pushNodeOutOfGroup(node, group) {
    const gr = groupRect(group);
    const nr = nodeRect(node);
    const overlap = overlapArea(nr, gr);
    if (overlap <= 0) return;
    const left = nr.x + nr.w - gr.x;
    const right = gr.x + gr.w - nr.x;
    const top = nr.y + nr.h - gr.y;
    const bottom = gr.y + gr.h - nr.y;
    const options = [
      { axis: "x", delta: -left },
      { axis: "x", delta: right },
      { axis: "y", delta: -top },
      { axis: "y", delta: bottom },
    ];
    options.sort((a, b) => Math.abs(a.delta) - Math.abs(b.delta));
    const best = options[0];
    if (best.axis === "x") node.x = (node.x || 0) + best.delta;
    else node.y = (node.y || 0) + best.delta;
  }

  function snapNodeToGroups(bp, node) {
    if (!bp || !node || node.type === "group") return false;
    const nr = nodeRect(node);
    const area = Math.max(1, nr.w * nr.h);
    let best = null;
    (bp.nodes || []).forEach((group) => {
      if (group.type !== "group") return;
      const gr = groupRect(group);
      const overlap = overlapArea(nr, gr);
      if (overlap <= 0) return;
      if (!best || overlap > best.overlap) best = { group, overlap, ratio: overlap / area };
    });
    if (!best) return false;
    if (best.ratio >= 0.5) containNodeInGroup(node, best.group);
    else pushNodeOutOfGroup(node, best.group);
    return true;
  }

