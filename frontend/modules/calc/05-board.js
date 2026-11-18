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
          name: focus.dataset.inName || focus.dataset.outName || focus.dataset.outExpr || focus.dataset.resultName || focus.dataset.resultPrio || focus.dataset.constValue || focus.dataset.groupName || focus.dataset.plannerTitle || focus.dataset.markTitle || focus.dataset.filterField || focus.dataset.teleLabel || focus.dataset.teleHead,
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
        if (node.type === "joint") return jointNodeHtml(node);
        if (node.type === "teleport") return teleportNodeHtml(node, bp);
        if (node.type === "teleout") return teleoutNodeHtml(node, bp);
        if (node.type === "bus") return busNodeHtml(node, bp, graph);
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
          : host.querySelector(`[data-in-name="${cssEsc(keep.name)}"], [data-out-name="${cssEsc(keep.name)}"], [data-out-expr="${cssEsc(keep.name)}"], [data-result-name="${cssEsc(keep.name)}"], [data-result-prio="${cssEsc(keep.name)}"], [data-const-value="${cssEsc(keep.name)}"], [data-planner-title="${cssEsc(keep.name)}"], [data-mark-title="${cssEsc(keep.name)}"], [data-tele-label="${cssEsc(keep.name)}"], [data-tele-head="${cssEsc(keep.name)}"]`) ||
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

  function polyPath(pts) {
    return pts.map((p, i) => `${i ? "L" : "M"}${p.x},${p.y}`).join(" ");
  }

  function dedupePts(pts) {
    const out = [];
    pts.forEach((p) => {
      const prev = out[out.length - 1];
      if (!prev || Math.abs(prev.x - p.x) > 0.4 || Math.abs(prev.y - p.y) > 0.4) out.push(p);
    });
    return out;
  }

  function polyMid(pts) {
    let total = 0;
    const lens = [];
    for (let i = 1; i < pts.length; i += 1) {
      const len = Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
      lens.push(len);
      total += len;
    }
    let left = total / 2;
    for (let i = 1; i < pts.length; i += 1) {
      if (lens[i - 1] >= left) {
        const t = lens[i - 1] ? left / lens[i - 1] : 0;
        return {
          x: pts[i - 1].x + (pts[i].x - pts[i - 1].x) * t,
          y: pts[i - 1].y + (pts[i].y - pts[i - 1].y) * t,
        };
      }
      left -= lens[i - 1];
    }
    return pts[0];
  }

  const WIRE_STUB = 18;
  const WIRE_GAP = 14;

  function applyWireRaw(raw) {
    if (!raw || typeof raw !== "object") return;
    if (raw.route === "curve" || raw.route === "ortho" || raw.route === "diag") session.wireRoute = raw.route;
    if (typeof raw.avoid === "boolean") session.wireAvoid = raw.avoid;
    if (typeof raw.snap === "boolean") session.wireSnap = raw.snap;
    if (raw.chain === "off" || raw.chain === "in" || raw.chain === "out" || raw.chain === "all") session.moveChain = raw.chain;
  }

  function loadWirePrefs() {
    if (session.wirePrefsLoaded) return;
    let stored = null;
    try {
      stored = JSON.parse(localStorage.getItem("finmaster.calc.wires") || "null");
    } catch {
      stored = null;
    }
    const doc = api?.doc?.();
    if (!stored && !doc) return;
    const file = doc?.ui?.calculator?.tools;
    applyWireRaw(Object.assign({}, file || {}, stored || {}));
    session.wirePrefsLoaded = true;
  }

  function saveWirePrefs() {
    const route = session.wireRoute === "ortho" || session.wireRoute === "diag" ? session.wireRoute : "curve";
    const chain = chainMode();
    const prefs = {
      chain,
      route,
      avoid: !!session.wireAvoid,
      snap: !!session.wireSnap,
    };
    try {
      localStorage.setItem("finmaster.calc.wires", JSON.stringify(prefs));
    } catch {
      /* ignore */
    }
    const calc = ensureState();
    if (!calc) return;
    const prev = calc.tools || {};
    if (prev.chain === prefs.chain && prev.route === prefs.route && prev.avoid === prefs.avoid && prev.snap === prefs.snap) return;
    calc.tools = prefs;
    dirtyLive();
  }

  function nodeObstacles(skip) {
    const world = $("calc-world");
    if (!world) return [];
    const zoom = Number(activeBlueprint()?.zoom) || 1;
    const wr = world.getBoundingClientRect();
    const pad = 16;
    const boxes = [];
    world.querySelectorAll(".calc-node").forEach((el) => {
      if (el.classList.contains("is-group")) return;
      const id = el.dataset.node || "";
      if (skip?.has(id) || (session.spliceSkip && id === session.spliceSkip)) return;
      const r = el.getBoundingClientRect();
      if (r.width < 2 || r.height < 2) return;
      boxes.push({
        id,
        x: (r.left - wr.left) / zoom - pad,
        y: (r.top - wr.top) / zoom - pad,
        r: (r.right - wr.left) / zoom + pad,
        b: (r.bottom - wr.top) / zoom + pad,
      });
    });
    return boxes;
  }

  function wireBoxes(opens, force) {
    loadWirePrefs();
    if (!session.wireAvoid && !force) return [];
    const boxes = nodeObstacles(null);
    (opens || []).forEach((open) => {
      if (!open?.id) return;
      const box = boxes.find((item) => item.id === open.id);
      if (!box) return;
      if (open.side === "out") box.r = Math.min(box.r, open.at - 1);
      else box.x = Math.max(box.x, open.at + 1);
    });
    return boxes.filter((box) => box.r > box.x + 4 && box.b > box.y + 4);
  }

  function pointInBox(p, box) {
    return p.x > box.x && p.x < box.r && p.y > box.y && p.y < box.b;
  }

  function segsCross(ax, ay, bx, by, cx, cy, dx, dy) {
    const cross = (px, py, qx, qy) => px * qy - py * qx;
    const d1 = cross(bx - ax, by - ay, cx - ax, cy - ay);
    const d2 = cross(bx - ax, by - ay, dx - ax, dy - ay);
    const d3 = cross(dx - cx, dy - cy, ax - cx, ay - cy);
    const d4 = cross(dx - cx, dy - cy, bx - cx, by - cy);
    return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0));
  }

  function segHitsBox(p, q, box) {
    if (pointInBox(p, box) || pointInBox(q, box)) return true;
    return segsCross(p.x, p.y, q.x, q.y, box.x, box.y, box.r, box.y)
      || segsCross(p.x, p.y, q.x, q.y, box.r, box.y, box.r, box.b)
      || segsCross(p.x, p.y, q.x, q.y, box.r, box.b, box.x, box.b)
      || segsCross(p.x, p.y, q.x, q.y, box.x, box.b, box.x, box.y);
  }

  function pathHits(pts, boxes) {
    if (!boxes.length || pts.length < 2) return false;
    for (let i = 1; i < pts.length; i += 1) {
      if (boxes.some((box) => segHitsBox(pts[i - 1], pts[i], box))) return true;
    }
    return false;
  }

  function pathLen(pts) {
    let total = 0;
    for (let i = 1; i < pts.length; i += 1) total += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
    return total;
  }

  function orthoPoints(a, b) {
    const stub = WIRE_STUB;
    if (b.x >= a.x + stub * 2) {
      const mid = (a.x + b.x) / 2;
      return dedupePts([a, { x: mid, y: a.y }, { x: mid, y: b.y }, b]);
    }
    const midY = (a.y + b.y) / 2;
    return dedupePts([
      a,
      { x: a.x + stub, y: a.y },
      { x: a.x + stub, y: midY },
      { x: b.x - stub, y: midY },
      { x: b.x - stub, y: b.y },
      b,
    ]);
  }

  function pushHorizontal(y, x0, x1, boxes, dir) {
    let lane = y;
    const left = Math.min(x0, x1);
    const right = Math.max(x0, x1);
    for (let i = 0; i < 12; i += 1) {
      const hit = boxes.filter((box) => segHitsBox({ x: left, y: lane }, { x: right, y: lane }, box));
      if (!hit.length) return lane;
      lane = dir < 0 ? Math.min(...hit.map((box) => box.y)) - WIRE_GAP : Math.max(...hit.map((box) => box.b)) + WIRE_GAP;
    }
    return lane;
  }

  function openX(port, laneY, boxes, prefer, lo, hi) {
    const fits = (x) => !boxes.some((box) => segHitsBox(port, { x, y: port.y }, box) || segHitsBox({ x, y: port.y }, { x, y: laneY }, box));
    if (fits(prefer)) return prefer;
    if (fits(port.x)) return port.x;
    let best = null;
    const start = Math.min(lo, hi);
    const end = Math.max(lo, hi);
    for (let x = start; x <= end; x += 6) {
      if (!fits(x)) continue;
      if (best == null || Math.abs(x - prefer) < Math.abs(best - prefer)) best = x;
    }
    return best == null ? port.x : best;
  }

  function orthoAvoid(a, b, boxes) {
    const plain = orthoPoints(a, b);
    if (!pathHits(plain, boxes)) return plain;
    const options = [-1, 1].map((dir) => {
      const lo = Math.min(a.x, b.x) - 120;
      const hi = Math.max(a.x, b.x) + 120;
      let y = dir < 0 ? Math.min(a.y, b.y) - WIRE_GAP : Math.max(a.y, b.y) + WIRE_GAP;
      let x1 = a.x + WIRE_STUB;
      let x2 = b.x - WIRE_STUB;
      for (let pass = 0; pass < 4; pass += 1) {
        y = pushHorizontal(y, Math.min(lo, x1, x2), Math.max(hi, x1, x2), boxes, dir);
        x1 = openX(a, y, boxes, a.x + WIRE_STUB, a.x, hi);
        x2 = openX(b, y, boxes, b.x - WIRE_STUB, lo, b.x);
      }
      const pts = dedupePts([
        a,
        { x: x1, y: a.y },
        { x: x1, y },
        { x: x2, y },
        { x: x2, y: b.y },
        b,
      ]);
      return { pts, ok: !pathHits(pts, boxes), len: pathLen(pts) };
    });
    const good = options.filter((item) => item.ok).sort((p, q) => p.len - q.len);
    return (good[0] || options.sort((p, q) => p.len - q.len)[0]).pts;
  }

  function firstBlocking(p, q, boxes) {
    let best = null;
    let bestT = Infinity;
    boxes.forEach((box) => {
      if (!segHitsBox(p, q, box)) return;
      let t = 1;
      if (pointInBox(p, box)) t = 0;
      else {
        const edges = [
          [box.x, box.y, box.r, box.y],
          [box.r, box.y, box.r, box.b],
          [box.r, box.b, box.x, box.b],
          [box.x, box.b, box.x, box.y],
        ];
        edges.forEach(([x1, y1, x2, y2]) => {
          const den = (p.x - q.x) * (y1 - y2) - (p.y - q.y) * (x1 - x2);
          if (Math.abs(den) < 1e-6) return;
          const tt = ((p.x - x1) * (y1 - y2) - (p.y - y1) * (x1 - x2)) / den;
          const uu = ((p.x - x1) * (p.y - q.y) - (p.y - y1) * (p.x - q.x)) / den;
          if (tt >= 0 && tt <= 1 && uu >= 0 && uu <= 1 && tt < t) t = tt;
        });
      }
      if (t < bestT) {
        bestT = t;
        best = box;
      }
    });
    return best;
  }

  function diagWalk(a, b, boxes, dir) {
    const stub = WIRE_STUB;
    let startX = a.x + stub;
    const early = boxes.find((box) => segHitsBox(a, { x: startX, y: a.y }, box));
    if (early) startX = Math.max(a.x, early.x - WIRE_GAP);
    let goalX = b.x - stub;
    const late = boxes.find((box) => segHitsBox({ x: goalX, y: b.y }, b, box));
    if (late) goalX = Math.min(b.x, late.r + WIRE_GAP);
    const start = { x: startX, y: a.y };
    const goal = { x: goalX, y: b.y };
    const pts = [a, start];
    let cur = start;
    const seen = new Set();
    for (let n = 0; n < 10; n += 1) {
      if (!boxes.some((box) => segHitsBox(cur, goal, box))) {
        pts.push(goal);
        break;
      }
      const box = firstBlocking(cur, goal, boxes);
      if (!box) {
        pts.push(goal);
        break;
      }
      const y = dir < 0 ? box.y : box.b;
      const corners = [{ x: box.x, y }, { x: box.r, y }]
        .map((corner) => ({ corner, key: `${Math.round(corner.x)}:${Math.round(corner.y)}` }))
        .filter((item) => !seen.has(item.key))
        .sort((p, q) => Math.hypot(p.corner.x - cur.x, p.corner.y - cur.y) - Math.hypot(q.corner.x - cur.x, q.corner.y - cur.y));
      const pick = corners.find((item) => !segHitsBox(cur, item.corner, box)) || corners[0];
      if (!pick) break;
      seen.add(pick.key);
      pts.push(pick.corner);
      cur = pick.corner;
    }
    if (pts[pts.length - 1] !== goal) pts.push(goal);
    pts.push(b);
    return dedupePts(pts);
  }

  function diagDirect(a, b) {
    const stub = WIRE_STUB;
    if (Math.abs(a.y - b.y) < 1.5 && b.x >= a.x) return [a, b];
    const p1 = { x: a.x + stub, y: a.y };
    const p2 = { x: b.x - stub, y: b.y };
    if (p2.x < p1.x + 8) return orthoPoints(a, b);
    return dedupePts([a, p1, p2, b]);
  }

  function diagAvoid(a, b, boxes) {
    const direct = diagDirect(a, b);
    if (!pathHits(direct, boxes)) return direct;
    const options = [-1, 1].map((dir) => {
      const pts = diagWalk(a, b, boxes, dir);
      return { pts, ok: !pathHits(pts, boxes), len: pathLen(pts) };
    });
    const good = options.filter((item) => item.ok).sort((p, q) => p.len - q.len);
    return (good[0] || options.sort((p, q) => p.len - q.len)[0]).pts;
  }

  function bezierPoint(p0, p1, p2, p3, t) {
    const u = 1 - t;
    return {
      x: u * u * u * p0.x + 3 * u * u * t * p1.x + 3 * u * t * t * p2.x + t * t * t * p3.x,
      y: u * u * u * p0.y + 3 * u * u * t * p1.y + 3 * u * t * t * p2.y + t * t * t * p3.y,
    };
  }

  function bezierHits(p0, p1, p2, p3, boxes) {
    if (!boxes.length) return false;
    let prev = p0;
    for (let i = 1; i <= 24; i += 1) {
      const cur = bezierPoint(p0, p1, p2, p3, i / 24);
      if (boxes.some((box) => segHitsBox(prev, cur, box))) return true;
      prev = cur;
    }
    return false;
  }

  function curveDirect(a, b) {
    const dx = Math.max(40, Math.abs(b.x - a.x) * 0.45);
    const sign = b.x >= a.x ? 1 : -1;
    return {
      d: `M${a.x},${a.y} C${a.x + sign * dx},${a.y} ${b.x - sign * dx},${b.y} ${b.x},${b.y}`,
      mid: bezierMid(a, b),
    };
  }

  function curveHits(a, b, boxes) {
    const dx = Math.max(40, Math.abs(b.x - a.x) * 0.45);
    const sign = b.x >= a.x ? 1 : -1;
    return bezierHits(a, { x: a.x + sign * dx, y: a.y }, { x: b.x - sign * dx, y: b.y }, b, boxes);
  }

  function roundPoly(pts, radius) {
    const p = dedupePts(pts);
    if (p.length < 3) return polyPath(p);
    const parts = [`M${p[0].x},${p[0].y}`];
    for (let i = 1; i < p.length - 1; i += 1) {
      const prev = p[i - 1];
      const cur = p[i];
      const next = p[i + 1];
      const len1 = Math.hypot(cur.x - prev.x, cur.y - prev.y);
      const len2 = Math.hypot(next.x - cur.x, next.y - cur.y);
      const r = Math.min(radius, len1 / 2, len2 / 2);
      if (r < 4 || len1 < 1 || len2 < 1) {
        parts.push(`L${cur.x},${cur.y}`);
        continue;
      }
      const ux1 = (cur.x - prev.x) / len1;
      const uy1 = (cur.y - prev.y) / len1;
      const ux2 = (next.x - cur.x) / len2;
      const uy2 = (next.y - cur.y) / len2;
      const k = 0.5519;
      const a1x = cur.x - ux1 * r;
      const a1y = cur.y - uy1 * r;
      const a2x = cur.x + ux2 * r;
      const a2y = cur.y + uy2 * r;
      parts.push(`L${a1x},${a1y} C${a1x + ux1 * r * k},${a1y + uy1 * r * k} ${a2x - ux2 * r * k},${a2y - uy2 * r * k} ${a2x},${a2y}`);
    }
    const last = p[p.length - 1];
    parts.push(`L${last.x},${last.y}`);
    return parts.join(" ");
  }

  function curveAvoid(a, b, boxes) {
    if (!curveHits(a, b, boxes)) return curveDirect(a, b);
    const stub = WIRE_STUB;
    let p1 = { x: a.x + stub, y: a.y };
    let p2 = { x: b.x - stub, y: b.y };
    if (boxes.some((box) => segHitsBox(a, p1, box))) p1 = { x: a.x, y: a.y };
    if (boxes.some((box) => segHitsBox(p2, b, box))) p2 = { x: b.x, y: b.y };
    const spanL = Math.min(p1.x, p2.x);
    const spanR = Math.max(p1.x, p2.x);
    const between = boxes.filter((box) => box.r > spanL && box.x < spanR);
    const options = [-1, 1].map((dir) => {
      const seed = between.length
        ? (dir < 0 ? Math.min(...between.map((box) => box.y)) : Math.max(...between.map((box) => box.b)))
        : (dir < 0 ? Math.min(a.y, b.y) - 48 : Math.max(a.y, b.y) + 48);
      let apex = seed + dir * WIRE_GAP;
      let hit = true;
      let controls = null;
      for (let n = 0; n < 14 && hit; n += 1) {
        const c = (apex - 0.125 * (p1.y + p2.y)) / 0.75;
        const dx = Math.max(28, Math.abs(p2.x - p1.x) * 0.22);
        const sign = p2.x >= p1.x ? 1 : -1;
        controls = {
          c1: { x: p1.x + sign * dx, y: c },
          c2: { x: p2.x - sign * dx, y: c },
        };
        hit = bezierHits(p1, controls.c1, controls.c2, p2, boxes);
        if (hit) apex += dir * 28;
      }
      return { apex, controls, hit };
    });
    const fit = options.find((item) => item.controls && !item.hit) || options[0];
    if (fit?.controls && !fit.hit) {
      const c1 = fit.controls.c1;
      const c2 = fit.controls.c2;
      return {
        d: `M${a.x},${a.y} L${p1.x},${p1.y} C${c1.x},${c1.y} ${c2.x},${c2.y} ${p2.x},${p2.y} L${b.x},${b.y}`,
        mid: bezierPoint(p1, c1, c2, p2, 0.5),
      };
    }
    const pts = orthoAvoid(a, b, boxes);
    return { pts, radius: 36, d: roundPoly(pts, 36), mid: polyMid(pts) };
  }

  const WIRE_LANE = 8;

  function spreadWireLanes(items) {
    const segs = [];
    items.forEach((item) => {
      const pts = item.geo?.pts;
      if (!pts || pts.length < 4 || item.bundled) return;
      for (let i = 1; i < pts.length - 2; i += 1) {
        const p = pts[i];
        const q = pts[i + 1];
        const dx = q.x - p.x;
        const dy = q.y - p.y;
        const len = Math.hypot(dx, dy);
        if (len < 110) continue;
        const vertical = Math.abs(dx) < 1.5;
        const horizontal = Math.abs(dy) < 1.5;
        if (!vertical && !horizontal) continue;
        if (horizontal && (i === 1 || i + 1 === pts.length - 2)) continue;
        segs.push({
          item,
          i,
          vertical,
          x: (p.x + q.x) / 2,
          y: (p.y + q.y) / 2,
          lo: vertical ? Math.min(p.y, q.y) : Math.min(p.x, q.x),
          hi: vertical ? Math.max(p.y, q.y) : Math.max(p.x, q.x),
          sort: pts[0].y * 100000 + pts[0].x,
        });
      }
    });
    const used = new Array(segs.length).fill(false);
    const overlaps = (a, b) => {
      if (a.vertical !== b.vertical || a.item === b.item) return false;
      const coord = a.vertical ? Math.abs(a.x - b.x) : Math.abs(a.y - b.y);
      if (coord > 3) return false;
      return Math.min(a.hi, b.hi) - Math.max(a.lo, b.lo) >= 16;
    };
    segs.forEach((seg, index) => {
      if (used[index]) return;
      const group = [];
      const queue = [index];
      used[index] = true;
      while (queue.length) {
        const cur = queue.pop();
        group.push(segs[cur]);
        segs.forEach((other, j) => {
          if (used[j] || !overlaps(segs[cur], other)) return;
          used[j] = true;
          queue.push(j);
        });
      }
      if (group.length < 2) return;
      group.sort((a, b) => a.sort - b.sort);
      const mid = (group.length - 1) / 2;
      group.forEach((entry, lane) => {
        const pts = entry.item.geo.pts;
        const p = pts[entry.i];
        const q = pts[entry.i + 1];
        const axis = entry.vertical ? "x" : "y";
        if ((p._lane && p._lane[axis]) || (q._lane && q._lane[axis])) return;
        const want = (lane - mid) * WIRE_LANE;
        const boxes = entry.item.laneBoxes || [];
        const ox = p.x;
        const oy = p.y;
        const qx = q.x;
        const qy = q.y;
        const sign = want < 0 ? -1 : 1;
        let placed = false;
        for (let step = Math.abs(want); step >= 2; step -= 2) {
          const delta = sign * step;
          if (axis === "x") {
            p.x = ox + delta;
            q.x = qx + delta;
          } else {
            p.y = oy + delta;
            q.y = qy + delta;
          }
          const from = Math.max(1, entry.i);
          const to = Math.min(pts.length - 1, entry.i + 2);
          let hit = false;
          for (let k = from; k <= to; k += 1) {
            if (boxes.some((box) => segHitsBox(pts[k - 1], pts[k], box))) {
              hit = true;
              break;
            }
          }
          if (!hit) {
            placed = true;
            break;
          }
        }
        if (!placed) {
          p.x = ox;
          p.y = oy;
          q.x = qx;
          q.y = qy;
          return;
        }
        p._lane = p._lane || {};
        q._lane = q._lane || {};
        p._lane[axis] = true;
        q._lane[axis] = true;
      });
    });
  }

  function orthoCandidates(a, b) {
    const stub = WIRE_STUB;
    const list = [];
    if (b.x >= a.x + stub * 2) {
      const lo = a.x + stub;
      const hi = b.x - stub;
      [0.22, 0.5, 0.78].forEach((t) => {
        const mid = lo + (hi - lo) * t;
        list.push(dedupePts([a, { x: mid, y: a.y }, { x: mid, y: b.y }, b]));
      });
      [ -1, 1 ].forEach((dir) => {
        const y = a.y + dir * 36;
        list.push(dedupePts([
          a,
          { x: a.x + stub, y: a.y },
          { x: a.x + stub, y },
          { x: b.x - stub, y },
          { x: b.x - stub, y: b.y },
          b,
        ]));
      });
      return list;
    }
    const x1 = a.x + stub;
    const x2 = b.x - stub;
    [a.y, (a.y + b.y) / 2, b.y].forEach((y) => {
      list.push(dedupePts([
        a,
        { x: x1, y: a.y },
        { x: x1, y },
        { x: x2, y },
        { x: x2, y: b.y },
        b,
      ]));
    });
    return list;
  }

  function floatPenalty(pts) {
    const a = pts[0];
    const b = pts[pts.length - 1];
    const minX = Math.min(a.x, b.x);
    const maxX = Math.max(a.x, b.x);
    const minY = Math.min(a.y, b.y);
    const maxY = Math.max(a.y, b.y);
    let penalty = 0;
    for (let i = 1; i < pts.length; i += 1) {
      const p = pts[i - 1];
      const q = pts[i];
      const len = Math.hypot(q.x - p.x, q.y - p.y);
      if (len < 40) continue;
      if (Math.abs(p.y - q.y) < 1.5) {
        const y = p.y;
        const align = Math.min(Math.abs(y - a.y), Math.abs(y - b.y));
        penalty += y < minY - 8 || y > maxY + 8 ? align + 80 : align * 0.2;
      } else if (Math.abs(p.x - q.x) < 1.5 && (p.x < minX - 8 || p.x > maxX + 8)) {
        penalty += Math.min(Math.abs(p.x - a.x), Math.abs(p.x - b.x)) + 40;
      }
    }
    return penalty;
  }

  function countRouteCrossings(pts, routed) {
    let count = 0;
    (routed || []).forEach((other) => {
      for (let i = 1; i < pts.length; i += 1) {
        for (let j = 1; j < other.length; j += 1) {
          if (segsCross(pts[i - 1].x, pts[i - 1].y, pts[i].x, pts[i].y, other[j - 1].x, other[j - 1].y, other[j].x, other[j].y)) count += 1;
        }
      }
    });
    return count;
  }

  function pickRoute(candidates, routed) {
    const pool = candidates.filter((pts) => pts && pts.length >= 2);
    if (!pool.length) return null;
    let minLen = Infinity;
    pool.forEach((pts) => { minLen = Math.min(minLen, pathLen(pts)); });
    const budget = minLen + 120;
    let best = null;
    pool.forEach((pts) => {
      const len = pathLen(pts);
      if (len > budget) return;
      const score = [countRouteCrossings(pts, routed), floatPenalty(pts), len];
      if (!best
        || score[0] < best.score[0]
        || (score[0] === best.score[0] && score[1] < best.score[1])
        || (score[0] === best.score[0] && score[1] === best.score[1] && score[2] < best.score[2])) {
        best = { pts, score };
      }
    });
    return (best || { pts: pool[0] }).pts;
  }

  function chooseWirePts(a, b, boxes, mode, routed) {
    const avoid = boxes || [];
    const shaped = orthoCandidates(a, b).filter((pts) => !avoid.length || !pathHits(pts, avoid));
    const native = mode === "diag"
      ? [avoid.length ? diagAvoid(a, b, avoid) : diagDirect(a, b)]
      : [];
    let pool = native.concat(shaped);
    if (!pool.length) pool = [mode === "diag" ? diagAvoid(a, b, avoid) : orthoAvoid(a, b, avoid)];
    return pickRoute(pool, routed);
  }

  function bundlePaths(specs) {
    loadWirePrefs();
    const mode = session.wireRoute === "ortho" || session.wireRoute === "diag" ? session.wireRoute : "curve";
    if (mode === "curve") return;
    const groups = new Map();
    specs.forEach((spec) => {
      const forward = spec.b.x >= spec.a.x + WIRE_STUB;
      const key = `${spec.link.from}:${forward ? "f" : "b"}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(spec);
    });
    groups.forEach((group) => {
      if (group.length < 2) return;
      const ordered = group.slice().sort((p, q) => p.a.y - q.a.y || p.a.x - q.a.x);
      const n = ordered.length;
      const forward = ordered[0].b.x >= ordered[0].a.x + WIRE_STUB;
      const rises = ordered.map((spec) => spec.b.y - spec.a.y).sort((p, q) => p - q);
      const rising = rises[Math.floor((n - 1) / 2)] < -4;
      const laneOf = (index) => (rising ? index : n - 1 - index);
      if (forward) {
        const left = Math.max(...ordered.map((spec) => spec.a.x)) + WIRE_STUB;
        const right = Math.min(...ordered.map((spec) => spec.b.x)) - WIRE_STUB;
        const room = Math.max(0, right - left);
        const step = n === 1 ? 0 : Math.min(WIRE_LANE, room / (n - 1));
        const base = Math.max(left, right - step * (n - 1));
        ordered.forEach((spec, index) => {
          const x = base + laneOf(index) * step;
          const pts = dedupePts([spec.a, { x, y: spec.a.y }, { x, y: spec.b.y }, spec.b]);
          const boxes = wireBoxes(spec.opens);
          if (!boxes.length || !pathHits(pts, boxes)) spec.bundlePts = pts;
        });
        return;
      }
      const edge = Math.max(...ordered.map((spec) => spec.a.x)) + WIRE_STUB;
      ordered.forEach((spec, index) => {
        const x = edge + laneOf(index) * WIRE_LANE;
        const pts = dedupePts([
          spec.a,
          { x, y: spec.a.y },
          { x, y: spec.b.y },
          { x: spec.b.x - WIRE_STUB, y: spec.b.y },
          spec.b,
        ]);
        const boxes = wireBoxes(spec.opens);
        if (!boxes.length || !pathHits(pts, boxes)) spec.bundlePts = pts;
      });
    });
  }

  function wireGeometry(a, b, boxes, routed) {
    loadWirePrefs();
    const mode = session.wireRoute === "ortho" || session.wireRoute === "diag" ? session.wireRoute : "curve";
    const avoid = boxes || [];
    if (mode === "curve") return avoid.length ? curveAvoid(a, b, avoid) : curveDirect(a, b);
    const pts = chooseWirePts(a, b, avoid, mode, routed || []);
    return { pts, radius: 22, d: roundPoly(pts, 22), mid: polyMid(pts) };
  }

  function syncWireBtns() {
    loadWirePrefs();
    const route = $("calc-wire-route");
    const avoid = $("calc-wire-avoid");
    const mode = session.wireRoute === "ortho" || session.wireRoute === "diag" ? session.wireRoute : "curve";
    const routeTitle = mode === "ortho" ? "Прямоугольные линии" : mode === "diag" ? "Прямоугольные и диагональные" : "Плавные линии";
    if (route) {
      route.dataset.route = mode;
      route.title = routeTitle;
      route.setAttribute("aria-label", routeTitle);
    }
    if (avoid) {
      const on = !!session.wireAvoid;
      avoid.classList.toggle("is-on", on);
      avoid.setAttribute("aria-pressed", on ? "true" : "false");
      const title = on ? "Обходить ноды: включено" : "Обходить ноды: выключено";
      avoid.title = title;
      avoid.setAttribute("aria-label", title);
    }
    const snap = $("calc-snap");
    if (snap) {
      const on = !!session.wireSnap;
      snap.classList.toggle("is-on", on);
      snap.setAttribute("aria-pressed", on ? "true" : "false");
      const title = on ? "Привязка к сетке: включено" : "Привязка к сетке: выключено";
      snap.title = title;
      snap.setAttribute("aria-label", title);
    }
    const align = $("calc-snap-align");
    if (align) align.hidden = !session.wireSnap;
    syncSnapGrid(activeBlueprint());
  }

  const SNAP = 20;

  function snapCoord(value) {
    return Math.round((Number(value) || 0) / SNAP) * SNAP;
  }

  function alignNodesToSnap() {
    const bp = activeBlueprint();
    if (!bp || !session.wireSnap) return;
    let moved = false;
    (bp.nodes || []).forEach((node) => {
      if (!Number.isFinite(node.x) || !Number.isFinite(node.y)) return;
      const x = snapCoord(node.x);
      const y = snapCoord(node.y);
      if (x === node.x && y === node.y) return;
      node.x = x;
      node.y = y;
      applyNodeEl(node);
      moved = true;
    });
    if (!moved) return;
    dirty();
    drawWires(bp, computeGraph(bp));
    drawMinimap(bp);
  }

  function syncSnapGrid(bp) {
    const board = $("calc-board");
    if (!board) return;
    loadWirePrefs();
    const on = !!session.wireSnap;
    board.classList.toggle("is-snap", on);
    const zoom = bp?.zoom || 1;
    board.style.setProperty("--snap-size", `${SNAP * zoom}px`);
    board.style.setProperty("--snap-x", `${bp?.x || 0}px`);
    board.style.setProperty("--snap-y", `${bp?.y || 0}px`);
  }

  function wireKind(node, fromPort) {
    const portId = String(fromPort || "");
    if (portId === "plan" || portId.startsWith("plan:")) return "plan";
    if ((node?.type === "result" || node?.type === "scheme") && portSignal(node, portId) === "plan") return "plan";
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
    if (type === "joint") return node.tone || "order";
    if (type === "teleport") return teleportPortOf(node, portId)?.tone || node.tone || "order";
    if (type === "teleout") return teleoutPort(node, fromPort)?.tone || "order";
    if (type === "bus") {
      const laneId = String(fromPort || "").startsWith("out:") ? String(fromPort).slice(4) : "";
      const lane = (node.lanes || []).find((item) => item.id === laneId);
      return lane?.tone || "order";
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

  function teleportSourcesOf(bp, id) {
    const sources = new Set();
    const node = (bp?.nodes || []).find((item) => item.id === id);
    if (node?.type === "teleport") teleportEntries(node).forEach((port) => sources.add(port.id));
    else if (node?.type === "teleout") (node.ports || []).forEach((port) => sources.add(port.source));
    else if (teleportHost(bp, id)) sources.add(id);
    return sources;
  }

  function teleportFamily(bp, nodeId) {
    const sources = teleportSourcesOf(bp, nodeId);
    if (!sources.size) return [];
    return (bp.nodes || []).filter((item) => {
      if (item.type === "teleport") return teleportEntries(item).some((port) => sources.has(port.id));
      if (item.type === "teleout") return (item.ports || []).some((port) => sources.has(port.source));
      return false;
    });
  }

  function teleportFlow(bp, nodeId) {
    const flow = upstreamFlow(bp, nodeId);
    const family = teleportFamily(bp, nodeId);
    const sources = teleportSourcesOf(bp, nodeId);
    family.forEach((node) => flow.nodeIds.add(node.id));
    family.forEach((node) => {
      if (node.type !== "teleport" || node.id === nodeId) return;
      (bp.links || []).forEach((link) => {
        if (link.to !== node.id) return;
        const entry = teleportPortOf(node, link.toPort);
        if (!entry || !sources.has(entry.id)) return;
        flow.linkIds.add(link.id);
        flow.nodeIds.add(link.from);
        flow.nodeIds.add(link.to);
        const extra = upstreamFlow(bp, link.from);
        extra.linkIds.forEach((id) => flow.linkIds.add(id));
        extra.nodeIds.forEach((id) => flow.nodeIds.add(id));
        extra.outPorts.forEach((id) => flow.outPorts.add(id));
        extra.inPorts.forEach((id) => flow.inPorts.add(id));
      });
    });
    return flow;
  }

  function setTeleportHover(id) {
    const next = id || "";
    if (session.teleportHover === next) return;
    session.teleportHover = next;
    const bp = activeBlueprint();
    if (!bp) return;
    drawWires(bp, computeGraph(bp));
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
    if (session.moveChain === "all") return "all";
    return "off";
  }

  function connectedNodeIds(bp, nodeId, frameOnly) {
    const ids = new Set();
    if (!bp || !nodeId) return ids;
    const next = new Map();
    const add = (a, b) => {
      if (!a || !b) return;
      if (!next.has(a)) next.set(a, []);
      next.get(a).push(b);
    };
    (bp.links || []).forEach((link) => {
      add(link.from, link.to);
      add(link.to, link.from);
    });
    const byId = Object.fromEntries((bp.nodes || []).map((item) => [item.id, item]));
    const seen = new Set();
    const queue = [nodeId];
    while (queue.length) {
      const cur = queue.shift();
      if (!cur || seen.has(cur)) continue;
      seen.add(cur);
      if (cur !== nodeId) ids.add(cur);
      (next.get(cur) || []).forEach((nid) => queue.push(nid));
      const item = byId[cur];
      if (item?.type === "group" && !(frameOnly && cur === nodeId)) {
        nodesInsideGroup(bp, item).forEach((child) => queue.push(child.id));
      }
    }
    return ids;
  }

  function chainBetween(bp, fromId, toId) {
    if (!fromId || !toId) return null;
    if (fromId === toId) return [fromId];
    const next = new Map();
    const add = (a, b) => {
      if (!a || !b || a === b) return;
      if (!next.has(a)) next.set(a, []);
      next.get(a).push(b);
    };
    (bp.links || []).forEach((link) => {
      add(link.from, link.to);
      add(link.to, link.from);
    });
    const prev = new Map([[fromId, ""]]);
    const queue = [fromId];
    while (queue.length) {
      const cur = queue.shift();
      if (cur === toId) break;
      (next.get(cur) || []).forEach((nid) => {
        if (prev.has(nid)) return;
        prev.set(nid, cur);
        queue.push(nid);
      });
    }
    if (!prev.has(toId)) return null;
    const path = [];
    let cur = toId;
    while (cur) {
      path.push(cur);
      cur = prev.get(cur);
    }
    return path;
  }

  function selectChain(bp, id) {
    const path = session.selected ? chainBetween(bp, session.selected, id) : null;
    if (path) selectNodes(path, session.selected);
    else selectOnly(id);
  }

  function togglePick(id) {
    const ids = new Set(selectionIds());
    if (ids.has(id)) ids.delete(id);
    else ids.add(id);
    const anchor = ids.has(session.selected) ? session.selected : [...ids][0] || "";
    selectNodes([...ids], anchor);
  }

  function marqueeEl() {
    let el = document.getElementById("calc-marquee");
    if (el) return el;
    el = document.createElement("div");
    el.id = "calc-marquee";
    el.className = "calc-marquee";
    el.hidden = true;
    $("calc-board")?.appendChild(el);
    return el;
  }

  function showMarquee(x0, y0, x1, y1) {
    const board = $("calc-board")?.getBoundingClientRect();
    const el = marqueeEl();
    if (!board || !el) return;
    el.hidden = false;
    el.style.left = `${Math.min(x0, x1) - board.left}px`;
    el.style.top = `${Math.min(y0, y1) - board.top}px`;
    el.style.width = `${Math.abs(x1 - x0)}px`;
    el.style.height = `${Math.abs(y1 - y0)}px`;
  }

  function hideMarquee() {
    const el = document.getElementById("calc-marquee");
    if (el) el.hidden = true;
  }

  function nodesInMarquee(x0, y0, x1, y1) {
    const left = Math.min(x0, x1);
    const right = Math.max(x0, x1);
    const top = Math.min(y0, y1);
    const bottom = Math.max(y0, y1);
    const ids = [];
    document.querySelectorAll("#calc-nodes .calc-node, #calc-groups .calc-node, #calc-group-ui .calc-group-chrome").forEach((el) => {
      const id = el.dataset.node;
      if (!id || ids.includes(id)) return;
      const rect = el.getBoundingClientRect();
      if (rect.width < 1 || rect.height < 1) return;
      if (rect.right < left || rect.left > right || rect.bottom < top || rect.top > bottom) return;
      ids.push(id);
    });
    return ids;
  }

  function applyMarquee(box) {
    const hits = nodesInMarquee(box.x, box.y, box.cx, box.cy);
    const ids = box.ctrl ? [...new Set([...box.base, ...hits])] : hits;
    const anchor = ids.includes(session.selected) ? session.selected : ids[0] || "";
    selectNodes(ids, anchor);
  }

  function beginNodeDrag(bp, id, origin, frameOnly) {
    if (!selectionIds().has(id)) selectOnly(id);
    const origins = [];
    const byId = Object.fromEntries((bp.nodes || []).map((item) => [item.id, item]));
    const moveIds = new Set([id]);
    const dragged = byId[id];
    const mode = chainMode();
    const along = mode === "in" ? upstreamNodeIds(bp, id) : mode === "out" ? downstreamNodeIds(bp, id) : mode === "all" ? connectedNodeIds(bp, id, frameOnly) : null;
    if (dragged?.type === "group") {
      if (!frameOnly) nodesInsideGroup(bp, dragged).forEach((item) => moveIds.add(item.id));
      if (along) along.forEach((nid) => moveIds.add(nid));
    } else if (along) along.forEach((nid) => moveIds.add(nid));
    if (selectionIds().size > 1) {
      selectionIds().forEach((nid) => {
        moveIds.add(nid);
        const item = byId[nid];
        if (item?.type === "group" && !frameOnly) nodesInsideGroup(bp, item).forEach((child) => moveIds.add(child.id));
      });
    }
    moveIds.forEach((nid) => {
      const item = byId[nid];
      if (item) origins.push({ id: nid, x: item.x || 0, y: item.y || 0 });
    });
    session.drag = {
      id,
      dx: origin.clientX,
      dy: origin.clientY,
      origins,
      isGroup: dragged?.type === "group",
    };
    session.selectedLink = "";
    session.busy = true;
  }

  let wireProbe = null;

  function wireProbePath() {
    if (wireProbe) return wireProbe;
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    wireProbe = document.createElementNS("http://www.w3.org/2000/svg", "path");
    svg.appendChild(wireProbe);
    return wireProbe;
  }

  function distToPathD(d, x, y) {
    const path = wireProbePath();
    path.setAttribute("d", d || "");
    const len = path.getTotalLength();
    if (!len) return Infinity;
    const step = Math.max(6, len / 48);
    let best = Infinity;
    for (let at = 0; at <= len; at += step) {
      const p = path.getPointAtLength(Math.min(at, len));
      const dist = Math.hypot(p.x - x, p.y - y);
      if (dist < best) best = dist;
    }
    return best;
  }

  function jointBox(bp, node) {
    const el = findNodeEl(node.id);
    const world = $("calc-world");
    const zoom = bp?.zoom || 1;
    const pad = 6;
    if (!el || !world) {
      const x = node.x || 0;
      const y = node.y || 0;
      return { x: x - pad, y: y - pad, r: x + 36 + pad, b: y + 36 + pad };
    }
    const wr = world.getBoundingClientRect();
    const nr = el.getBoundingClientRect();
    return {
      x: (nr.left - wr.left) / zoom - pad,
      y: (nr.top - wr.top) / zoom - pad,
      r: (nr.right - wr.left) / zoom + pad,
      b: (nr.bottom - wr.top) / zoom + pad,
    };
  }

  function pathGap(d, box) {
    const path = wireProbePath();
    path.setAttribute("d", d || "");
    const len = path.getTotalLength();
    if (!len) return Infinity;
    const step = Math.max(4, len / 72);
    let best = Infinity;
    for (let at = 0; at <= len; at += step) {
      const p = path.getPointAtLength(Math.min(at, len));
      const dx = p.x < box.x ? box.x - p.x : p.x > box.r ? p.x - box.r : 0;
      const dy = p.y < box.y ? box.y - p.y : p.y > box.b ? p.y - box.b : 0;
      const dist = Math.hypot(dx, dy);
      if (dist < best) best = dist;
    }
    return best;
  }

  function paintJoint(node) {
    const el = findNodeEl(node?.id);
    if (!el) return;
    const color = toneColor(node.tone);
    if (color) el.style.setProperty("--joint", color);
    else el.style.removeProperty("--joint");
    el.querySelectorAll(".calc-port").forEach((port) => {
      if (node.signal === "plan") port.dataset.signal = "plan";
      else port.removeAttribute("data-signal");
      if (port.dataset.io === "out") {
        if (node.tone) port.removeAttribute("data-pass");
        else port.dataset.pass = "any";
      }
    });
  }

  function jointPortsFree(bp, id) {
    return !(bp.links || []).some((link) => link.from === id || link.to === id);
  }

  function spliceHolderId(holder) {
    return holder?.nodeId || holder?.id || "";
  }

  function clearJointSplice(bp, holder) {
    const snap = holder?.splice;
    if (!snap || !bp) return;
    bp.links = (bp.links || []).filter((link) => link.id !== snap.inId && link.id !== snap.outId);
    if (!bp.links.some((link) => link.id === snap.original.id)) bp.links.push({ ...snap.original });
    holder.splice = null;
    syncPassNodes(bp);
    const node = (bp.nodes || []).find((item) => item.id === spliceHolderId(holder));
    if (node) paintJoint(node);
  }

  function applyJointSplice(bp, holder, node, hit) {
    const link = hit.link;
    const original = { id: link.id, from: link.from, fromPort: link.fromPort, to: link.to, toPort: link.toPort };
    const inId = uid();
    const outId = uid();
    bp.links = (bp.links || []).filter((item) => item.id !== link.id);
    bp.links.push(
      { id: inId, from: original.from, fromPort: original.fromPort, to: node.id, toPort: "in" },
      { id: outId, from: node.id, fromPort: "out", to: original.to, toPort: original.toPort }
    );
    holder.splice = { original, inId, outId, d: hit.d };
    syncPassNodes(bp);
    const kept = bp.links.some((item) => item.id === inId) && bp.links.some((item) => item.id === outId);
    if (!kept) {
      bp.links = bp.links.filter((item) => item.id !== inId && item.id !== outId);
      bp.links.push(original);
      holder.splice = null;
      syncPassNodes(bp);
    }
    paintJoint(node);
  }

  function closestJointWire(bp, nodeId, box) {
    const svg = $("calc-wires");
    if (!svg) return null;
    let best = null;
    let bestDist = 1;
    svg.querySelectorAll("path.calc-wire").forEach((path) => {
      const id = path.getAttribute("data-link");
      const link = (bp.links || []).find((item) => item.id === id);
      if (!link || link.from === nodeId || link.to === nodeId) return;
      const dist = pathGap(path.getAttribute("d"), box);
      if (dist < bestDist) {
        bestDist = dist;
        best = { link, d: path.getAttribute("d") || "" };
      }
    });
    return best;
  }

  function updateJointSplice(bp, holder) {
    const nodeId = spliceHolderId(holder);
    const node = nodeId && (bp.nodes || []).find((item) => item.id === nodeId);
    if (!holder || node?.type !== "joint") {
      clearJointSplice(bp, holder);
      return;
    }
    const box = jointBox(bp, node);
    if (holder.splice && pathGap(holder.splice.d, box) <= 14) return;
    clearJointSplice(bp, holder);
    if (!jointPortsFree(bp, node.id)) return;
    session.spliceSkip = node.id;
    try {
      drawWires(bp, computeGraph(bp));
    } finally {
      session.spliceSkip = "";
    }
    const hit = closestJointWire(bp, node.id, box);
    if (hit) applyJointSplice(bp, holder, node, hit);
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
    const title = mode === "in" ? "Тянуть цепочку входов" : mode === "out" ? "Тянуть цепочку выходов" : mode === "all" ? "Тянуть всю связь" : "Выключен";
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
    const openPass = !!(owner && (
      (owner.type === "joint" && !owner.tone)
      || (owner.type === "teleport" && !teleportPortOf(owner, portId)?.tone)
      || (owner.type === "teleout" && teleoutPort(owner, portId) && !teleoutPort(owner, portId).tone)
      || (owner.type === "bus" && laneOf(owner, portId) && !laneOf(owner, portId).tone)
      || (owner.type === "result" && !(activeBlueprint()?.links || []).some((item) => item.to === owner.id && item.toPort === "in"))
    ));
    board.classList.toggle("is-link-plan", !openPass && signal === "plan");
    board.classList.toggle("is-link-num", !openPass && !!link && signal !== "plan");
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
    const flow = teleportFlow(bp, session.selected);
    if (session.teleportHover) {
      const hover = teleportFlow(bp, session.teleportHover);
      hover.linkIds.forEach((id) => flow.linkIds.add(id));
      hover.nodeIds.forEach((id) => flow.nodeIds.add(id));
    }
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
    const specs = [];
    (bp.links || []).forEach((link) => {
      const fromEl = findNodeEl(link.from);
      const toEl = findNodeEl(link.to);
      if (!fromEl || !toEl) return;
      const a = portWorld(fromEl, link.fromPort, "out", bp);
      const b = portWorld(toEl, link.toPort, "in", bp);
      if (!a || !b) return;
      specs.push({
        link,
        fromEl,
        toEl,
        a,
        b,
        opens: [
          { id: link.from, side: "out", at: a.x },
          { id: link.to, side: "in", at: b.x },
        ],
      });
    });
    specs.sort((p, q) => p.a.y - q.a.y || p.a.x - q.a.x);
    bundlePaths(specs);
    const routed = [];
    const pending = specs.map((spec) => {
      if (spec.bundlePts) {
        const pts = spec.bundlePts;
        routed.push(pts);
        return {
          link: spec.link,
          fromEl: spec.fromEl,
          toEl: spec.toEl,
          geo: { pts, radius: 22, d: roundPoly(pts, 22), mid: polyMid(pts) },
          laneBoxes: wireBoxes(spec.opens, true),
          bundled: true,
        };
      }
      const geo = wireGeometry(spec.a, spec.b, wireBoxes(spec.opens), routed);
      if (geo.pts) routed.push(geo.pts);
      return { link: spec.link, fromEl: spec.fromEl, toEl: spec.toEl, geo, laneBoxes: wireBoxes(spec.opens, true) };
    });
    spreadWireLanes(pending);
    pending.forEach(({ link, fromEl, toEl, geo }) => {
      if (geo.pts) {
        geo.d = roundPoly(geo.pts, geo.radius || 22);
        geo.mid = polyMid(geo.pts);
      }
      const d = geo.d;
      const src = byId[link.from];
      const onFlow = flow.linkIds.has(link.id);
      const onPick = !!(picked && picked.id === link.id);
      const onCut = session.jointCut === link.from && link.fromPort === "out";
      const err = graph.errors.has(link.from) || graph.errors.has(link.to);
      const wire = addPath(
        d,
        `calc-wire is-${wireKind(src, link.fromPort)}${onFlow ? " is-flow" : ""}${onPick ? " is-pick" : ""}${onCut ? " is-cut" : ""}${err ? " is-error" : ""}`,
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
        const mid = geo.mid;
        hostButtons.push({ id: link.id, x: mid.x, y: mid.y, wire, hit });
      }
    });
    document.querySelectorAll(".calc-node.is-joint.is-cut").forEach((el) => el.classList.remove("is-cut"));
    if (session.jointCut) findNodeEl(session.jointCut)?.classList.add("is-cut");
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
        if (e.button === 2) {
          e.preventDefault();
          e.stopPropagation();
          removeLink(item.id);
          return;
        }
        if (e.button !== 0) return;
        const cut = (bp.links || []).find((row) => row.id === item.id);
        if (session.jointCut && cut?.from === session.jointCut && cut.fromPort === "out") {
          e.preventDefault();
          e.stopPropagation();
          bridgeJoint(bp, session.jointCut, cut);
          return;
        }
        e.preventDefault();
        e.stopPropagation();
        session.selectedLink = item.id;
        session.selected = "";
        session.picked = new Set();
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
        const geo = wireGeometry(a, b, wireBoxes(L.reverse
          ? [{ id: L.to, side: "in", at: b.x }]
          : [{ id: L.from, side: "out", at: a.x }]));
        addPath(geo.d, `calc-wire is-temp is-${kind}`, { "pointer-events": "none" });
      }
    }
    setLinkingClass();
    drawMinimap(bp);
    paintTeleportArrows(bp);
  }

  function paintTeleportArrows(bp) {
    const board = $("calc-board");
    if (!board) return;
    let layer = board.querySelector(".calc-tele-arrows");
    if (!layer) {
      layer = document.createElement("div");
      layer.className = "calc-tele-arrows";
      board.appendChild(layer);
    }
    layer.replaceChildren();
    if (!bp) return;
    const seen = new Set();
    const family = [];
    [session.selected, session.teleportHover].forEach((id) => {
      teleportFamily(bp, id).forEach((node) => {
        if (seen.has(node.id)) return;
        seen.add(node.id);
        family.push(node);
      });
    });
    if (!family.length) return;
    const box = board.getBoundingClientRect();
    const pad = 16;
    const spots = [];
    family.forEach((node) => {
      const el = findNodeEl(node.id);
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const cx = rect.left + rect.width / 2;
      const cy = rect.top + rect.height / 2;
      if (cx >= box.left + pad && cx <= box.right - pad && cy >= box.top + pad && cy <= box.bottom - pad) return;
      const vx = cx - (box.left + box.width / 2);
      const vy = cy - (box.top + box.height / 2);
      const hw = Math.max(8, box.width / 2 - pad);
      const hh = Math.max(8, box.height / 2 - pad);
      const tx = vx === 0 ? Infinity : hw / Math.abs(vx);
      const ty = vy === 0 ? Infinity : hh / Math.abs(vy);
      const t = Math.min(tx, ty);
      let x = box.width / 2 + vx * t;
      let y = box.height / 2 + vy * t;
      spots.forEach((spot) => {
        if (Math.hypot(spot.x - x, spot.y - y) < 18) {
          x += vx === 0 ? 16 : 0;
          y += vy === 0 ? 16 : 0;
        }
      });
      spots.push({ x, y });
      const arrow = document.createElement("i");
      arrow.className = "calc-tele-arrow";
      arrow.style.left = `${Math.round(x)}px`;
      arrow.style.top = `${Math.round(y)}px`;
      arrow.style.transform = `translate(-50%, -50%) rotate(${Math.atan2(vy, vx) * 180 / Math.PI}deg)`;
      const host = node.type === "teleport" ? node : teleportHost(bp, node.ports?.[0]?.source);
      const entry = host && (node.type === "teleport" ? teleportEntries(host)[0] : teleportEntry(host, node.ports?.[0]?.source));
      arrow.title = (host && entry && teleportPortName(bp, host, entry)) || "Телепорт";
      arrow.innerHTML = `<svg viewBox="0 0 12 12" aria-hidden="true"><path d="M4 2.2 8.2 6 4 9.8" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
      layer.appendChild(arrow);
    });
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
      closePalette();
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
    syncChainMoveBtn();
    syncWireBtns();
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
    if (!session.presentPanel) return;
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

  function closeTeleportLabel(input) {
    if (!input?.dataset?.teleLabel || input.dataset.teleDone) return;
    input.dataset.teleDone = "1";
    const nodeEl = input.closest("[data-node]");
    const bp = activeBlueprint();
    const node = nodeEl && bp ? bp.nodes.find((item) => item.id === nodeEl.dataset.node && item.type === "teleport") : null;
    const stored = node && teleportWritable(node, input.dataset.teleLabel);
    if (stored) {
      const text = String(input.value || "").trim().slice(0, 48);
      stored.label = text;
      stored.labelSet = !!text;
      dirty();
    }
    render();
  }

  function beginTeleportEdit(el) {
    if (!el?.dataset?.teleIn) return;
    const input = document.createElement("input");
    input.className = "calc-pname";
    input.maxLength = 48;
    input.spellcheck = false;
    input.value = el.textContent || "";
    input.placeholder = "Название";
    input.dataset.teleLabel = el.dataset.teleIn;
    input.setAttribute("aria-label", "Название порта");
    el.closest(".calc-row")?.querySelector("[data-tele-rename]")?.remove();
    el.replaceWith(input);
    input.addEventListener("blur", () => closeTeleportLabel(input));
    input.focus();
    input.select();
  }

  function onBoardPointerDown(e) {
    const bp = activeBlueprint();
    if (!bp) return;
    const naming = document.querySelector("#calc-nodes input[data-tele-label]");
    if (naming && e.target !== naming) {
      const nextPort = e.target.closest("[data-tele-rename]")?.dataset.teleRename || "";
      const headId = e.target.closest("[data-tele-head]")?.dataset.teleHead || "";
      closeTeleportLabel(naming);
      if (nextPort) {
        const name = document.querySelector(`#calc-nodes [data-tele-in="${cssEsc(nextPort)}"]`);
        if (name) beginTeleportEdit(name);
        e.preventDefault();
        e.stopPropagation();
        return;
      }
      if (headId) document.querySelector(`#calc-nodes [data-tele-head="${cssEsc(headId)}"]`)?.focus();
    }
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
    const rename = e.target.closest("[data-tele-rename]");
    if (rename) {
      e.preventDefault();
      e.stopPropagation();
      const name = rename.closest(".calc-row")?.querySelector("[data-tele-in]");
      if (name) beginTeleportEdit(name);
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
    if (e.target.closest(".calc-refresh, .calc-chain-move, .calc-wire-route, .calc-wire-avoid, .calc-present-btn, .calc-present-panel, .calc-board-tools, .calc-bp-name, .calc-screen-copy, .calc-minimap, .calc-mini-toggle, .calc-mini-wrap, input, textarea, select")) return;
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
    const teleSplit = e.target.closest("[data-tele-split]");
    const teleIn = e.target.closest("[data-tele-in]");
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
    if (node && e.button === 0) {
      const id = node.dataset.node;
      const kind = bp.nodes.find((item) => item.id === id)?.type;
      session.press = {
        id,
        x: e.clientX,
        y: e.clientY,
        ctrl: e.ctrlKey,
        shift: e.shiftKey,
        grip: !!(drag || teleSplit || teleIn),
        teleSplit: teleSplit?.dataset.teleSplit || "",
        teleIn: teleIn?.dataset.teleIn || "",
        group: kind === "group",
      };
      session.selectedLink = "";
      if (drag || teleSplit || teleIn) {
        e.preventDefault();
        $("calc-board").setPointerCapture(e.pointerId);
      }
      return;
    }
    if (node || (e.button !== 0 && e.button !== 2)) return;
    session.busy = true;
    $("calc-board").setPointerCapture(e.pointerId);
    if (e.button === 0) {
      session.marquee = { x: e.clientX, y: e.clientY, cx: e.clientX, cy: e.clientY, ctrl: e.ctrlKey, moved: false, base: [...selectionIds()] };
      return;
    }
    session.pan = { x: e.clientX, y: e.clientY, ox: bp.x || 0, oy: bp.y || 0 };
  }

  function onBoardPointerMove(e) {
    const bp = activeBlueprint();
    if (!bp) return;
    if (session.marquee) {
      const box = session.marquee;
      if (Math.hypot(e.clientX - box.x, e.clientY - box.y) >= 4) box.moved = true;
      if (!box.moved) return;
      box.cx = e.clientX;
      box.cy = e.clientY;
      showMarquee(box.x, box.y, box.cx, box.cy);
      applyMarquee(box);
      return;
    }
    if (session.pan) {
      bp.x = session.pan.ox + (e.clientX - session.pan.x);
      bp.y = session.pan.oy + (e.clientY - session.pan.y);
      applyWorld(bp);
      paintTeleportArrows(bp);
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
    if (session.press && !session.drag) {
      const press = session.press;
      if (!e.buttons) {
        session.press = null;
        session.busy = false;
        return;
      }
      const dist = Math.hypot(e.clientX - press.x, e.clientY - press.y);
      if (dist < 4) return;
      if (press.grip && !press.ctrl && (!press.shift || press.group)) {
        let dragId = press.id;
        if (press.teleIn) {
          const born = splitTeleport(bp, press.id, press.teleIn);
          if (born) {
            dragId = born;
            render();
          }
        } else if (press.teleSplit) {
          const born = splitTeleout(bp, press.id, press.teleSplit);
          if (born) {
            dragId = born;
            render();
          }
        }
        beginNodeDrag(bp, dragId, { clientX: press.x, clientY: press.y }, press.shift && press.group);
        session.press = null;
        $("calc-board").setPointerCapture(e.pointerId);
      } else return;
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
      const dx0 = (e.clientX - session.drag.dx) / zoom;
      const dy0 = (e.clientY - session.drag.dy) / zoom;
      const anchor = (session.drag.origins || []).find((origin) => origin.id === session.drag.id) || session.drag.origins?.[0];
      const dx = session.wireSnap && anchor ? snapCoord(anchor.x + dx0) - anchor.x : dx0;
      const dy = session.wireSnap && anchor ? snapCoord(anchor.y + dy0) - anchor.y : dy0;
      const byId = Object.fromEntries((bp.nodes || []).map((item) => [item.id, item]));
      (session.drag.origins || []).forEach((origin) => {
        const item = byId[origin.id];
        if (!item) return;
        item.x = origin.x + dx;
        item.y = origin.y + dy;
        applyNodeEl(item);
      });
      updateJointSplice(bp, session.drag);
      drawWires(bp, computeGraph(bp));
      drawMinimap(bp);
      return;
    }
  }

  function onBoardPointerUp(e) {
    const bp = activeBlueprint();
    const movedNode = session.drag;
    const spliced = !!movedNode?.splice;
    if (movedNode?.splice) movedNode.splice = null;
    const movedPan = session.pan;
    const resized = session.resize;
    const linking = session.linking;
    const press = session.press;
    const marquee = session.marquee;
    session.drag = null;
    session.pan = null;
    session.resize = null;
    session.press = null;
    session.marquee = null;
    if (marquee) {
      hideMarquee();
      session.busy = false;
      if (!marquee.moved && e.button === 0 && bp) {
        session.selected = "";
        session.picked = new Set();
        session.selectedLink = "";
        document.querySelectorAll("#calc-nodes .calc-node, #calc-groups .calc-node, #calc-group-ui .calc-group-chrome").forEach((el) => el.classList.remove("is-on"));
        drawWires(bp, computeGraph(bp));
      } else if (marquee.moved && bp) {
        drawWires(bp, computeGraph(bp));
      }
      return;
    }
    if (press && !movedNode) {
      session.busy = false;
      if (e.button === 0 && bp) {
        if (press.ctrl) togglePick(press.id);
        else if (press.shift) selectChain(bp, press.id);
        else selectOnly(press.id);
        drawWires(bp, computeGraph(bp));
      }
      return;
    }

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
    if (e.target.closest?.("input, textarea, select, .calc-bp-name, .calc-refresh, .calc-chain-move, .calc-wire-route, .calc-wire-avoid, .calc-board-tools")) {
      if (spliced && bp) {
        dirty();
        drawWires(bp, computeGraph(bp));
        drawMinimap(bp);
      }
      return;
    }
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
      if (bp && (movedNode.origins || []).length === 1) {
        const moved = (bp.nodes || []).find((item) => item.id === movedNode.id);
        if ((moved?.type === "teleout" && mergeTeleout(bp, moved.id)) || (moved?.type === "teleport" && mergeTeleport(bp, moved.id))) {
          dirty();
          render();
          return;
        }
      }
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
    paintTeleportArrows(bp);
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
    const teleportId = e.dataTransfer?.getData("text/finmaster-teleport");
    e.preventDefault();
    const at = worldPoint(bp, e.clientX, e.clientY);
    if (presentBlock) addPresentNode(presentPage, presentBlock, at);
    else if (kind === "math" || kind === "formula" || kind === "percent" || kind === "const" || kind === "result" || kind === "group" || kind === "comment" || kind === "filter" || kind === "dashboard" || kind === "planner" || kind === "openings" || kind === "electrics" || kind === "joint" || kind === "bus" || kind === "teleport") addNode(kind, at);
    else if (teleportId) addNode("teleout", at, { source: teleportId });
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
      const order = ["off", "in", "out", "all"];
      const at = order.indexOf(chainMode());
      session.moveChain = order[(at + 1) % order.length];
      saveWirePrefs();
      syncChainMoveBtn();
    });
    $("calc-wire-route")?.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      const order = ["curve", "ortho", "diag"];
      const at = order.indexOf(session.wireRoute);
      session.wireRoute = order[(at + 1) % order.length];
      saveWirePrefs();
      syncWireBtns();
      const bp = activeBlueprint();
      if (bp) drawWires(bp, computeGraph(bp));
    });
    $("calc-wire-avoid")?.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      session.wireAvoid = !session.wireAvoid;
      saveWirePrefs();
      syncWireBtns();
      const bp = activeBlueprint();
      if (bp) drawWires(bp, computeGraph(bp));
    });
    $("calc-snap")?.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      session.wireSnap = !session.wireSnap;
      saveWirePrefs();
      syncWireBtns();
    });
    $("calc-snap-align")?.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      alignNodesToSnap();
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
    syncWireBtns();
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
    $("calc-screen")?.addEventListener("click", () => {
      const view = $("view-calculator");
      if (!view) return;
      const on = view.classList.toggle("is-screen");
      const btn = $("calc-screen");
      const title = on ? "Свернуть калькулятор" : "Калькулятор на весь экран";
      if (btn) {
        btn.title = title;
        btn.setAttribute("aria-label", title);
        btn.setAttribute("aria-pressed", on ? "true" : "false");
      }
    });
    $("calc-side")?.addEventListener("scroll", () => syncRailSearch(), { passive: true });
    document.addEventListener("input", (e) => {
      if (e.target.id !== "calc-order-search") return;
      session.search = e.target.value;
      session.searchOpen = true;
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
    document.addEventListener("keydown", (e) => {
      if (e.target?.id !== "calc-order-search" || e.key !== "Escape") return;
      e.preventDefault();
      e.stopPropagation();
      session.search = "";
      session.searchOpen = false;
      renderSide(activeBlueprint());
    });
    document.addEventListener("click", (e) => {
      const clear = e.target.closest?.("#calc-order-pop [data-search-clear]");
      if (!clear) return;
      e.preventDefault();
      e.stopPropagation();
      session.search = "";
      session.searchOpen = true;
      renderSide(activeBlueprint());
      $("calc-order-search")?.focus();
    });
    document.addEventListener("pointerdown", (e) => {
      if (!session.searchOpen || session.search.trim()) return;
      if (e.target.closest?.(".calc-search, #calc-order-pop, [data-search-open]")) return;
      session.searchOpen = false;
      if ($("calc-side")?.classList.contains("is-rail")) renderSide(activeBlueprint());
    });
    $("calc-side")?.addEventListener("click", (e) => {
      const rail = e.target.closest("[data-calc-rail]");
      if (rail) {
        e.preventDefault();
        e.stopPropagation();
        const wasOpen = sideOpen();
        setFold("side", !wasOpen);
        if (wasOpen && session.search.trim()) session.searchOpen = true;
        renderSide(activeBlueprint());
        if (!sideOpen() && session.searchOpen) $("calc-order-search")?.focus();
        return;
      }
      const openSearch = e.target.closest("[data-search-open]");
      if (openSearch) {
        session.searchOpen = !session.searchOpen;
        renderSide(activeBlueprint());
        if (session.searchOpen) $("calc-order-search")?.focus();
        return;
      }
      const clear = e.target.closest("[data-search-clear]");
      if (clear) {
        e.preventDefault();
        e.stopPropagation();
        session.search = "";
        session.searchOpen = true;
        renderSide(activeBlueprint());
        $("calc-order-search")?.focus();
        return;
      }
      const add = e.target.closest("[data-add-node]");
      if (add) {
        addNode(add.dataset.addNode);
        return;
      }
      const teleport = e.target.closest("[data-teleport]");
      if (teleport) {
        addNode("teleout", null, { source: teleport.dataset.teleport });
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
    let paletteCloseTimer = 0;
    const placeFromPalette = (spec, point) => {
      if (spec.presentBlock) addPresentNode(spec.presentPage, spec.presentBlock, point);
      else if (spec.teleportId) addNode("teleout", point, { source: spec.teleportId });
      else if (spec.orderId) addNode("order", point, { orderId: spec.orderId });
      else if (spec.blueprintId) addNode("scheme", point, { blueprintId: spec.blueprintId });
      else if (spec.kind) addNode(spec.kind, point);
    };
    const followPeek = (x, y, glide) => {
      const peek = document.getElementById("calc-peek");
      if (!peek) return;
      const card = peek.querySelector(".calc-node, .calc-peek-group");
      const w = card?.offsetWidth || 230;
      const board = $("calc-board")?.getBoundingClientRect();
      const over = board && x >= board.left && x <= board.right && y >= board.top && y <= board.bottom;
      const zoom = over ? (activeBlueprint()?.zoom || 1) : 1;
      if (glide) {
        peek.classList.add("is-glide");
        setTimeout(() => peek.classList.remove("is-glide"), 180);
      }
      peek.style.transformOrigin = `${w / 2}px 22px`;
      if (!peek.classList.contains("is-follow")) {
        peek.style.transform = "scale(1)";
        peek.classList.add("is-follow");
        void peek.offsetWidth;
      }
      peek.style.transform = `scale(${zoom})`;
      peek.style.left = `${Math.round(x - w / 2)}px`;
      peek.style.top = `${Math.round(y - 22)}px`;
    };
    const armPaletteClose = () => {
      clearTimeout(paletteCloseTimer);
      paletteCloseTimer = setTimeout(() => {
        if (!session.palette) closePalette();
      }, 140);
    };
    $("calc-side")?.addEventListener("pointerover", (e) => {
      if (session.palette?.moved) return;
      const btn = e.target.closest("[data-palette]");
      if (!btn) return;
      clearTimeout(paletteCloseTimer);
      openPalette(btn);
    });
    $("calc-side")?.addEventListener("pointerout", (e) => {
      if (!e.target.closest?.("[data-palette]")) return;
      if (e.relatedTarget?.closest?.("#calc-palette, [data-palette]")) return;
      armPaletteClose();
    });
    document.addEventListener("pointerover", (e) => {
      if (api?.view?.() !== "calculator" || session.palette?.moved) return;
      const item = e.target.closest?.("#calc-palette [data-peek]");
      if (item) {
        clearTimeout(paletteCloseTimer);
        showPeek(item.dataset.peek);
        if (item.dataset.presentUsed === "1") setPresentHover(item.dataset.presentBlock || "");
        else if (session.presentHover) setPresentHover("");
        if (item.dataset.teleport) setTeleportHover(item.dataset.teleport);
        else if (session.teleportHover) setTeleportHover("");
        return;
      }
      if (e.target.closest?.("#calc-palette")) clearTimeout(paletteCloseTimer);
    });
    document.addEventListener("pointerout", (e) => {
      if (session.palette?.moved || !e.target.closest?.("#calc-palette")) return;
      if (e.relatedTarget?.closest?.("#calc-palette, [data-palette]")) return;
      if (session.presentHover) setPresentHover("");
      if (session.teleportHover) setTeleportHover("");
      armPaletteClose();
    });
    document.addEventListener("pointerdown", (e) => {
      const item = e.target.closest?.("#calc-palette [data-add-node], #calc-palette [data-order], #calc-palette [data-blueprint], #calc-palette [data-present-block], #calc-palette [data-teleport]");
      if (!item || e.button !== 0 || api?.view?.() !== "calculator") return;
      e.preventDefault();
      item.setPointerCapture?.(e.pointerId);
      session.palette = {
        x: e.clientX,
        y: e.clientY,
        kind: item.dataset.addNode || "",
        orderId: item.dataset.order || "",
        blueprintId: item.dataset.blueprint || "",
        presentBlock: item.dataset.presentBlock || "",
        presentPage: item.dataset.presentPage || "",
        teleportId: item.dataset.teleport || "",
        moved: false,
      };
      showPeek(item.dataset.peek);
    });
    document.addEventListener("pointermove", (e) => {
      const drag = session.palette;
      if (!drag) return;
      if (!drag.moved && Math.hypot(e.clientX - drag.x, e.clientY - drag.y) < 5) return;
      const start = !drag.moved;
      drag.moved = true;
      if (start) closePalette();
      if (drag.kind === "joint") {
        const bp = activeBlueprint();
        const board = $("calc-board")?.getBoundingClientRect();
        const inside = board && e.clientX >= board.left && e.clientX <= board.right && e.clientY >= board.top && e.clientY <= board.bottom;
        if (!bp || !inside) {
          clearJointSplice(bp, drag);
          if (drag.nodeId && bp) {
            bp.nodes = (bp.nodes || []).filter((item) => item.id !== drag.nodeId);
            findNodeEl(drag.nodeId)?.remove();
            drag.nodeId = "";
            drawWires(bp, computeGraph(bp));
          }
          followPeek(e.clientX, e.clientY, start);
          return;
        }
        const at = screenToWorld(e.clientX, e.clientY, bp);
        let node = (bp.nodes || []).find((item) => item.id === drag.nodeId);
        if (!node) {
          node = blankNode("joint");
          node.x = at.x - 18;
          node.y = at.y - 18;
          bp.nodes.push(node);
          drag.nodeId = node.id;
          nodesRoot()?.insertAdjacentHTML("beforeend", jointNodeHtml(node));
          hidePeek();
        } else {
          node.x = at.x - 18;
          node.y = at.y - 18;
          applyNodeEl(node);
        }
        updateJointSplice(bp, drag);
        drawWires(bp, computeGraph(bp));
        return;
      }
      followPeek(e.clientX, e.clientY, start);
    });
    document.addEventListener("pointerup", (e) => {
      const drag = session.palette;
      if (!drag) return;
      session.palette = null;
      if (drag.kind === "joint" && drag.nodeId) {
        const bp = activeBlueprint();
        const rect = $("calc-board")?.getBoundingClientRect();
        const inside = rect && e.clientX >= rect.left && e.clientX <= rect.right && e.clientY >= rect.top && e.clientY <= rect.bottom;
        if (!inside) {
          clearJointSplice(bp, drag);
          if (bp) bp.nodes = (bp.nodes || []).filter((item) => item.id !== drag.nodeId);
          findNodeEl(drag.nodeId)?.remove();
          if (bp) drawWires(bp, computeGraph(bp));
          hidePeek();
          return;
        }
        drag.splice = null;
        session.selected = drag.nodeId;
        session.picked = new Set([drag.nodeId]);
        hidePeek();
        dirty();
        render();
        return;
      }
      const peek = document.getElementById("calc-peek");
      peek?.classList.remove("is-glide", "is-follow");
      if (!drag.moved) {
        placeFromPalette(drag, null);
        return;
      }
      const rect = $("calc-board")?.getBoundingClientRect();
      const inside = rect && e.clientX >= rect.left && e.clientX <= rect.right && e.clientY >= rect.top && e.clientY <= rect.bottom;
      if (inside) {
        const bp = activeBlueprint();
        const at = screenToWorld(e.clientX, e.clientY, bp);
        const card = peek?.querySelector(".calc-node");
        const zoom = bp?.zoom || 1;
        at.x -= ((card?.offsetWidth || 230) / 2) / zoom;
        at.y -= 22 / zoom;
        placeFromPalette(drag, at);
        hidePeek();
        return;
      }
      const item = document.elementFromPoint(e.clientX, e.clientY)?.closest?.("#calc-palette [data-peek]");
      if (item) showPeek(item.dataset.peek);
      else hidePeek();
    });
    document.addEventListener("pointercancel", () => {
      if (!session.palette) return;
      session.palette = null;
      hidePeek();
    });
    $("calc-side")?.addEventListener("dragstart", (e) => {
      const order = e.target.closest("[data-order]");
      const tool = e.target.closest("[data-add-node]");
      const scheme = e.target.closest("[data-blueprint]");
      const teleport = e.target.closest("[data-teleport]");
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
      } else if (teleport) {
        e.dataTransfer.setData("text/finmaster-teleport", teleport.dataset.teleport);
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
      if (e.target.closest(".calc-wire-hit, #calc-wires, .calc-port, .calc-port-menu")) e.preventDefault();
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
        if (!e.detail) removeNode(e.target.closest("[data-del-node]").dataset.delNode);
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
      if (!e.ctrlKey && !e.shiftKey) selectOnly(node.id);
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
      if (e.target.dataset?.teleHead) {
        const nodeEl = e.target.closest("[data-node]");
        const bp = activeBlueprint();
        const node = nodeEl && bp ? bp.nodes.find((item) => item.id === nodeEl.dataset.node) : null;
        if (node && (node.type === "teleport" || node.type === "teleout")) {
          node.title = String(e.target.value || "").slice(0, 48);
          dirty();
        }
        return;
      }
      if (e.target.dataset?.teleLabel) {
        const nodeEl = e.target.closest("[data-node]");
        const bp = activeBlueprint();
        const node = nodeEl && bp ? bp.nodes.find((item) => item.id === nodeEl.dataset.node && item.type === "teleport") : null;
        const stored = node && teleportWritable(node, e.target.dataset.teleLabel);
        if (stored) {
          stored.label = String(e.target.value || "").slice(0, 48);
          stored.labelSet = !!stored.label.trim();
          paintTeleportNames(bp, node, e.target.dataset.teleLabel);
          dirty();
        }
        return;
      }
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
      if (e.target.dataset.teleHead && (node.type === "teleport" || node.type === "teleout")) {
        const text = String(e.target.value || "").trim().slice(0, 48);
        node.title = text && text !== "Телепорт" ? text : "";
        dirty();
        render();
        return;
      }
      if (e.target.dataset.teleLabel && node.type === "teleport") return;
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
        const fromNode = session.linking.reverse ? owner : dragNode;
        const fromPort = session.linking.reverse ? over.dataset.port : dragPort;
        const toNode = session.linking.reverse ? dragNode : owner;
        const toPort = session.linking.reverse ? dragPort : over.dataset.port;
        if (fromNode && toNode && passSignalOk(fromNode, fromPort, toNode, toPort, bp.links)) over.classList.add("is-hot");
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
        if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && (e.code === "KeyD" || e.code === "KeyC" || e.code === "KeyX" || e.code === "KeyV")) {
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
        if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && (e.code === "KeyD" || e.code === "KeyC" || e.code === "KeyX" || e.code === "KeyV")) {
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
        if (session.jointCut) {
          session.jointCut = "";
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
      if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && e.code === "KeyD" && session.selected) {
        e.preventDefault();
        duplicateNode(session.selected);
        return;
      }
      if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && e.code === "KeyC" && session.selected) {
        e.preventDefault();
        copyNodes(false);
        return;
      }
      if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && e.code === "KeyX" && session.selected) {
        e.preventDefault();
        copyNodes(true);
        return;
      }
      if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && e.code === "KeyV" && nodeClip) {
        e.preventDefault();
        pasteNodes();
        return;
      }
      if ((e.key === "Delete" || e.key === "Backspace") && session.selectedLink) {
        e.preventDefault();
        removeLink(session.selectedLink);
        return;
      }
      if ((e.key === "Delete" || e.key === "Backspace") && session.selected) {
        e.preventDefault();
        removeNodes([...selectionIds()]);
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
