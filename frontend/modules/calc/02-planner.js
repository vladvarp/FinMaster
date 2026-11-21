  const PLANNER_MAX_PTS = 24;
  const PLANNER_MAX_SUMS = 8;
  const PLANNER_MAX_LAYOUTS = 12;
  let editorClip = null;

  function plannerRound(n) {
    return Math.round(Number(n) * 10000) / 10000;
  }

  function plannerNum(value, fallback) {
    const n = typeof value === "number" ? value : Number(String(value ?? "").replace(",", ".").trim());
    return Number.isFinite(n) ? n : fallback;
  }

  function plannerClamp(n, lo, hi) {
    return Math.max(lo, Math.min(hi, n));
  }

  function plannerDraft(text) {
    const raw = String(text ?? "").trim().replace(",", ".");
    if (!raw || raw === "-" || raw.endsWith(".")) return null;
    const n = Number(raw);
    return Number.isFinite(n) ? n : null;
  }

  function plannerInput(n) {
    const r = plannerRound(n);
    if (!Number.isFinite(r)) return "";
    if (Number.isInteger(r)) return String(r);
    return String(r).replace(".", ",");
  }

  function plannerArea(points) {
    let sum = 0;
    for (let i = 0; i < points.length; i += 1) {
      const a = points[i];
      const b = points[(i + 1) % points.length];
      sum += a.x * b.y - b.x * a.y;
    }
    return Math.abs(sum) / 2;
  }

  function plannerCentroid(points) {
    let x = 0;
    let y = 0;
    let a = 0;
    for (let i = 0; i < points.length; i += 1) {
      const p = points[i];
      const q = points[(i + 1) % points.length];
      const cross = p.x * q.y - q.x * p.y;
      a += cross;
      x += (p.x + q.x) * cross;
      y += (p.y + q.y) * cross;
    }
    if (Math.abs(a) < 1e-8) {
      return {
        x: points.reduce((s, p) => s + p.x, 0) / points.length,
        y: points.reduce((s, p) => s + p.y, 0) / points.length,
      };
    }
    return { x: x / (3 * a), y: y / (3 * a) };
  }

  function plannerWalls(node) {
    const pts = node.points || [];
    return pts.map((p, i) => {
      const q = pts[(i + 1) % pts.length];
      return { id: `w:${p.id}`, index: i, a: p, b: q, len: Math.hypot(q.x - p.x, q.y - p.y) };
    });
  }

  function plannerAutoName(name) {
    return /^Стена \d+$/.test(String(name || "").trim());
  }

  function plannerWallName(out, index) {
    const name = String(out?.name || "").trim();
    if (!name || plannerAutoName(name)) return `Стена ${index + 1}`;
    return name;
  }

  function plannerRect(points) {
    if (!points || points.length !== 4) return null;
    const eps = 0.001;
    for (let i = 0; i < 4; i += 1) {
      const a = points[i];
      const b = points[(i + 1) % 4];
      const dx = Math.abs(b.x - a.x);
      const dy = Math.abs(b.y - a.y);
      if ((dx > eps && dy > eps) || (dx <= eps && dy <= eps)) return null;
    }
    const xs = points.map((p) => p.x);
    const ys = points.map((p) => p.y);
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys);
    if (maxX - minX < 0.05 || maxY - minY < 0.05) return null;
    return { w: maxX - minX, d: maxY - minY, minX, maxX, minY, maxY };
  }

  function plannerLayoutColor(layouts) {
    const used = new Set((layouts || []).map((item) => String(item?.color || "").toLowerCase()));
    const start = (layouts || []).length % GROUP_COLORS.length;
    for (let i = 0; i < GROUP_COLORS.length; i += 1) {
      const color = GROUP_COLORS[(start + i) % GROUP_COLORS.length];
      if (!used.has(color)) return color;
    }
    return GROUP_COLORS[Math.floor(Math.random() * GROUP_COLORS.length)];
  }

  function plannerPort(layout, kind) {
    if (layout?.legacy) return kind === "plan" ? "plan" : kind === "floor" ? "floor" : "height";
    return `${kind}:${layout?.id || ""}`;
  }

  function plannerLayoutName(layout, index) {
    const name = String(layout?.name || "").trim().slice(0, 48);
    return name || `Планировка ${(index || 0) + 1}`;
  }

  function plannerActive(node) {
    return (node?.layouts || []).find((item) => item.id === node.layoutId) || node?.layouts?.[0] || null;
  }

  function plannerRemember(node) {
    const layout = plannerActive(node);
    if (!layout) return;
    layout.points = node.points;
    layout.outs = node.outs;
    layout.height = node.height;
    layout.heightOut = !!node.heightOut;
    layout.color = node.color;
  }

  function plannerApply(node, layout) {
    if (!layout) return;
    node.layoutId = layout.id;
    node.points = layout.points;
    node.outs = layout.outs;
    node.height = layout.height;
    node.heightOut = !!layout.heightOut;
    node.color = layout.color;
  }

  function plannerNormalize(layout, index) {
    if (!layout) return layout;
    if (!Array.isArray(layout.points)) layout.points = [];
    const seen = new Set();
    const points = [];
    layout.points.forEach((p) => {
      if (!p || typeof p !== "object" || points.length >= PLANNER_MAX_PTS) return;
      let id = String(p.id || "").trim();
      if (!id || seen.has(id)) id = uid();
      const x = plannerNum(p.x, NaN);
      const y = plannerNum(p.y, NaN);
      if (!Number.isFinite(x) || !Number.isFinite(y)) return;
      seen.add(id);
      p.id = id;
      p.x = plannerRound(plannerClamp(x, -500, 500));
      p.y = plannerRound(plannerClamp(y, -500, 500));
      points.push(p);
    });
    if (points.length < 3) {
      layout.points = [
        { id: uid(), x: 0, y: 0 },
        { id: uid(), x: 4, y: 0 },
        { id: uid(), x: 4, y: 3 },
        { id: uid(), x: 0, y: 3 },
      ];
    } else layout.points = points;
    layout.height = plannerRound(plannerClamp(plannerNum(layout.height, 2.7), 0.2, 30));
    layout.heightOut = !!layout.heightOut;
    const rawColor = String(layout.color || "").trim().toLowerCase();
    layout.color = /^#[0-9a-f]{6}$/.test(rawColor) ? rawColor : plannerLayoutColor([]);
    layout.name = plannerLayoutName(layout, index);
    const floorId = plannerPort(layout, "floor");
    const fresh = !Array.isArray(layout.outs);
    const prev = fresh ? [] : layout.outs;
    const byId = new Map(prev.filter((item) => item && item.id).map((item) => [String(item.id), item]));
    const walls = plannerWalls(layout);
    const wallIds = new Set(walls.map((wall) => wall.id));
    const floor = byId.get(floorId) || prev.find((item) => item && item.kind === "floor");
    const outs = [{ id: floorId, kind: "floor", name: "Пол", on: floor ? floor.on !== false : true }];
    walls.forEach((wall) => {
      const old = byId.get(wall.id);
      const name = String(old?.name || "").trim();
      outs.push({
        id: wall.id,
        kind: "wall",
        name: name && !plannerAutoName(name) ? name.slice(0, 48) : "",
        on: old ? !!old.on : false,
        pogonazh: !!old?.pogonazh,
        pogonazhAxis: old?.pogonazhAxis === "length" ? "length" : "height",
      });
    });
    const sums = prev.filter((item) => item && item.kind === "sum").slice(0, PLANNER_MAX_SUMS);
    if (fresh) {
      sums.push({ id: uid(), kind: "sum", name: "Стены", on: true, parts: walls.map((wall) => wall.id) });
    }
    const used = new Set(outs.map((item) => item.id));
    sums.forEach((item) => {
      let id = String(item.id || "").trim();
      if (!id || used.has(id)) id = uid();
      used.add(id);
      const parts = [];
      const seenParts = new Set();
      (Array.isArray(item.parts) ? item.parts : []).forEach((part) => {
        let key = String(part || "");
        if (key === "floor" || key.startsWith("floor:")) key = floorId;
        if (seenParts.has(key) || (key !== floorId && !wallIds.has(key))) return;
        seenParts.add(key);
        parts.push(key);
      });
      outs.push({
        id,
        kind: "sum",
        name: String(item.name || "").trim().slice(0, 48) || "Сумма",
        on: !!item.on,
        parts,
      });
    });
    layout.outs = outs;
    return layout;
  }

  function ensurePlanner(node) {
    if (!node || node.type !== "planner") return node;
    if (!Array.isArray(node.layouts) || !node.layouts.length) {
      const id = uid();
      const named = plannerName(node);
      node.layouts = [{
        id,
        legacy: true,
        name: named === "Планировщик" ? "Планировка 1" : named,
        color: node.color,
        points: node.points,
        outs: node.outs,
        height: node.height,
        heightOut: node.heightOut,
      }];
      node.layoutId = id;
    } else plannerRemember(node);
    node.layouts.forEach((layout, index) => plannerNormalize(layout, index));
    plannerApply(node, plannerActive(node));
    ensureCommons(node);
    return node;
  }

  function plannerUseLayout(node, id) {
    ensurePlanner(node);
    const layout = (node.layouts || []).find((item) => item.id === id);
    if (!layout || layout.id === node.layoutId) return false;
    plannerRemember(node);
    plannerApply(node, layout);
    return true;
  }

  function plannerRemoveLayout(node, id) {
    ensurePlanner(node);
    if (node.layouts.length <= 1) {
      api?.toast?.("Нельзя удалить последнюю планировку");
      return false;
    }
    const index = node.layouts.findIndex((item) => item.id === id);
    if (index < 0) return false;
    plannerRemember(node);
    const [removed] = node.layouts.splice(index, 1);
    const outputIds = new Set([
      plannerPort(removed, "plan"),
      plannerPort(removed, "floor"),
      plannerPort(removed, "height"),
      ...(removed.outs || []).map((item) => item.id),
    ]);
    const bp = activeBlueprint();
    if (bp) {
      bp.links = (bp.links || []).filter(
        (link) => !(link.from === node.id && outputIds.has(link.fromPort))
      );
    }
    if (node.layoutId === id) {
      const next = node.layouts[Math.min(index, node.layouts.length - 1)] || node.layouts[0];
      plannerApply(node, next);
    }
    return true;
  }

  function plannerAddLayout(node) {
    ensurePlanner(node);
    if (node.layouts.length >= PLANNER_MAX_LAYOUTS) return null;
    const ids = [uid(), uid(), uid(), uid()];
    const layout = {
      id: uid(),
      legacy: false,
      name: `Планировка ${node.layouts.length + 1}`,
      color: plannerLayoutColor(node.layouts),
      height: 2.7,
      heightOut: false,
      points: [
        { id: ids[0], x: 0, y: 0 },
        { id: ids[1], x: 4, y: 0 },
        { id: ids[2], x: 4, y: 3 },
        { id: ids[3], x: 0, y: 3 },
      ],
    };
    node.layouts.push(layout);
    plannerNormalize(layout, node.layouts.length - 1);
    plannerApply(node, layout);
    return layout;
  }

  function plannerExternalHeight(node) {
    if (!node?.heightInputEnabled) return null;
    const bp = activeBlueprint();
    if (!bp) return null;
    const value = computeGraph(bp).values?.[`${node.id}:height-in`];
    return Number.isFinite(value) ? plannerRound(plannerClamp(value, 0.2, 30)) : null;
  }

  function plannerModel(node, heightOverride) {
    if (node?.type === "planner") ensurePlanner(node);
    const walls = plannerWalls(node);
    const floor = plannerArea(node.points);
    const height = Number.isFinite(heightOverride)
      ? plannerRound(plannerClamp(heightOverride, 0.2, 30))
      : node.height;
    const outById = Object.fromEntries((node.outs || []).map((item) => [item.id, item]));
    const floorOut = (node.outs || []).find((item) => item.kind === "floor");
    const floorId = floorOut?.id || "floor";
    const rows = [{ id: floorId, kind: "floor", name: "Пол", area: floor, on: !!outById[floorId]?.on }];
    walls.forEach((wall, index) => {
      const out = outById[wall.id];
      rows.push({
        id: wall.id,
        kind: "wall",
        name: plannerWallName(out, index),
        len: wall.len,
        area: wall.len * height,
        value: out?.pogonazh ? (out.pogonazhAxis === "length" ? wall.len : height) : wall.len * height,
        unit: out?.pogonazh ? "м" : "м²",
        pogonazh: !!out?.pogonazh,
        pogonazhAxis: out?.pogonazhAxis === "length" ? "length" : "height",
        on: !!out?.on,
        index,
      });
    });
    const rowById = new Map(rows.map((row) => [row.id, row]));
    const sums = (node.outs || [])
      .filter((item) => item.kind === "sum")
      .map((item) => {
        const selected = (item.parts || []).map((id) => rowById.get(id)).filter(Boolean);
        const units = [...new Set(selected.map((row) => row.unit || "м²"))];
        return {
          id: item.id,
          kind: "sum",
          name: item.name || "Сумма",
          on: !!item.on,
          parts: item.parts || [],
          area: selected.reduce((sum, row) => sum + row.area, 0),
          value: selected.reduce((sum, row) => sum + (row.value ?? row.area), 0),
          unit: units.length > 1 ? units.join(" / ") : (units[0] || "м²"),
        };
      });
    return { floor, height, walls, rows, sums, peri: walls.reduce((sum, wall) => sum + wall.len, 0) };
  }

  function plannerLayoutPorts(node, links, all, heightOverride) {
    ensurePlanner(node);
    const linked = linkedFromPorts(node.id, links || []);
    const ports = [];
    (node.layouts || []).forEach((layout) => {
      const model = plannerModel(layout, heightOverride);
      ports.push({ id: plannerPort(layout, "plan"), name: layout.name, signal: "plan", layoutId: layout.id });
      model.rows.concat(model.sums).forEach((row) => {
        if (all || row.on || linked.has(row.id)) ports.push({ id: row.id, name: row.name, value: row.value ?? row.area, unit: row.unit || "м²", layoutId: layout.id });
      });
      const heightId = plannerPort(layout, "height");
      if (all || layout.heightOut || linked.has(heightId)) ports.push({ id: heightId, name: "Высота стен", value: model.height, unit: "м", layoutId: layout.id });
    });
    return ports;
  }

  function plannerOutputs(node, links, values) {
    ensurePlanner(node);
    const incomingHeight = values?.[`${node.id}:height-in`];
    const heightOverride = node.heightInputEnabled && Number.isFinite(incomingHeight) ? incomingHeight : null;
    const ports = plannerLayoutPorts(node, links, false, heightOverride);
    appendCommons(node, ports, linkedFromPorts(node.id, links || []), plannerLayoutPorts(node, links, true, heightOverride), values, links);
    return ports;
  }

  function plannerDropPorts(node, ids) {
    const bp = activeBlueprint();
    if (!bp || !ids?.length) return;
    const drop = new Set(ids);
    bp.links = (bp.links || []).filter((link) => !(link.from === node.id && drop.has(link.fromPort)));
  }

  function plannerSumNote(parts, wallCount) {
    const floor = (parts || []).some((id) => id === "floor" || String(id).startsWith("floor:"));
    const walls = parts.filter((id) => String(id).startsWith("w:")).length;
    const bits = [];
    if (floor) bits.push("пол");
    if (walls) bits.push(`${walls} из ${wallCount} стен`);
    return bits.length ? bits.join(" + ") : "ничего не выбрано";
  }

  function plannerSetRect(node, w, d) {
    const box = plannerRect(node.points);
    if (!box) return false;
    const width = plannerClamp(w, 0.05, 500);
    const depth = plannerClamp(d, 0.05, 500);
    node.points.forEach((p) => {
      const onMaxX = Math.abs(p.x - box.maxX) < Math.abs(p.x - box.minX);
      const onMaxY = Math.abs(p.y - box.maxY) < Math.abs(p.y - box.minY);
      p.x = plannerRound(onMaxX ? box.minX + width : box.minX);
      p.y = plannerRound(onMaxY ? box.minY + depth : box.minY);
    });
    return true;
  }

  function plannerMakeRect(node, w, d) {
    const width = plannerRound(plannerClamp(plannerNum(w, 4), 0.05, 500));
    const depth = plannerRound(plannerClamp(plannerNum(d, 3), 0.05, 500));
    const origin = node.points[0] || { x: 0, y: 0 };
    const keep = node.points.slice(0, 4);
    while (keep.length < 4) keep.push({ id: uid(), x: 0, y: 0 });
    const drop = node.points.slice(4).map((p) => `w:${p.id}`);
    keep[0].x = plannerRound(origin.x);
    keep[0].y = plannerRound(origin.y);
    keep[1].x = plannerRound(origin.x + width);
    keep[1].y = plannerRound(origin.y);
    keep[2].x = plannerRound(origin.x + width);
    keep[2].y = plannerRound(origin.y + depth);
    keep[3].x = plannerRound(origin.x);
    keep[3].y = plannerRound(origin.y + depth);
    node.points = keep;
    if (drop.length) {
      const gone = new Set(drop);
      node.outs = (node.outs || []).filter((item) => !gone.has(item.id));
      (node.outs || []).forEach((item) => {
        if (item.kind === "sum" && Array.isArray(item.parts)) item.parts = item.parts.filter((id) => !gone.has(id));
      });
      plannerDropPorts(node, drop);
    }
    ensurePlanner(node);
  }

  function plannerProject(wall, at) {
    const dx = wall.b.x - wall.a.x;
    const dy = wall.b.y - wall.a.y;
    const l2 = dx * dx + dy * dy || 1;
    let t = ((at.x - wall.a.x) * dx + (at.y - wall.a.y) * dy) / l2;
    t = Math.max(0.08, Math.min(0.92, t));
    return { x: plannerRound(wall.a.x + dx * t), y: plannerRound(wall.a.y + dy * t) };
  }

  function plannerInsertCorner(node, wallId, at) {
    if (node.points.length >= PLANNER_MAX_PTS) return "";
    const wall = plannerWalls(node).find((item) => item.id === wallId);
    if (!wall) return "";
    const spot = at ? plannerProject(wall, at) : plannerProject(wall, { x: (wall.a.x + wall.b.x) / 2, y: (wall.a.y + wall.b.y) / 2 });
    const id = uid();
    node.points.splice(wall.index + 1, 0, { id, x: spot.x, y: spot.y });
    ensurePlanner(node);
    return id;
  }

  function plannerDeleteCorner(node, pointId) {
    if (!pointId || node.points.length <= 3) return false;
    const wallId = `w:${pointId}`;
    node.points = node.points.filter((p) => p.id !== pointId);
    node.outs = (node.outs || []).filter((item) => item.id !== wallId);
    (node.outs || []).forEach((item) => {
      if (item.kind === "sum" && Array.isArray(item.parts)) item.parts = item.parts.filter((id) => id !== wallId);
    });
    plannerDropPorts(node, [wallId]);
    ensurePlanner(node);
    return true;
  }

  function plannerSetLength(node, wallId, len) {
    const wall = plannerWalls(node).find((item) => item.id === wallId);
    if (!wall) return;
    const length = plannerClamp(len, 0.05, 500);
    const dx = wall.b.x - wall.a.x;
    const dy = wall.b.y - wall.a.y;
    const cur = Math.hypot(dx, dy) || 1;
    wall.b.x = plannerRound(plannerClamp(wall.a.x + (dx / cur) * length, -500, 500));
    wall.b.y = plannerRound(plannerClamp(wall.a.y + (dy / cur) * length, -500, 500));
  }

  const EDITOR_SNAP_DEFAULT = 0.05;
  function editorSnapValue(value, step) {
    const size = plannerClamp(plannerNum(step, EDITOR_SNAP_DEFAULT), 0.01, 5);
    return plannerRound(Math.round(Number(value) / size) * size);
  }
  function editorSnapControls(kind) {
    return '<div class="editor-snap-controls" data-snap-controls="' + kind + '">' +
      '<button type="button" class="editor-snap-toggle is-on" data-snap-toggle="' + kind + '" aria-pressed="true" title="Привязка к сетке" aria-label="Включить или выключить привязку">' +
      '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6.5 13.5 4 11a3.5 3.5 0 0 1 5-5l2 2m1.5 2.5L15 13a3.5 3.5 0 0 1-5 5l-2-2m-1-5 8-8m-3 11 8-8" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg></button>' +
      '<label class="editor-snap-step"><input type="number" min="0.01" max="5" step="0.01" value="0.05" data-snap-step="' + kind + '" aria-label="Шаг привязки" /><span>м</span></label>' +
      (kind === "mark" ? '<button type="button" class="editor-snap-toggle" data-mark-dims hidden aria-pressed="false" title="Размеры стены и пола" aria-label="Показать размеры стены и пола"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M4 17h16M7 7v3M12 7v4M17 7v3M7 17v-3M12 17v-4M17 17v-3" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg></button>' : "") +
      "</div>";
  }
  function editorSnapRefresh(kind) {
    const state = kind === "planner" ? session.planner : session.mark;
    const root = $(kind === "planner" ? "planner-modal" : "mark-modal");
    if (!state || !root) return;
    const button = root.querySelector('[data-snap-toggle="' + kind + '"]');
    const input = root.querySelector('[data-snap-step="' + kind + '"]');
    if (button) {
      button.classList.toggle("is-on", state.snapEnabled !== false);
      button.setAttribute("aria-pressed", state.snapEnabled !== false ? "true" : "false");
    }
    if (input && document.activeElement !== input) input.value = String(state.snapStep || EDITOR_SNAP_DEFAULT);
  }
  function bindEditorSnap(modal, kind) {
    modal.addEventListener("click", (e) => {
      const button = e.target.closest('[data-snap-toggle="' + kind + '"]');
      if (!button) return;
      const state = kind === "planner" ? session.planner : session.mark;
      if (!state) return;
      state.snapEnabled = state.snapEnabled === false;
      editorSnapRefresh(kind);
      if (kind === "planner") plannerDraw(); else markDraw();
    });
    if (kind === "mark") {
      modal.addEventListener("click", (e) => {
        const dims = e.target.closest("[data-mark-dims]");
        if (!dims || !session.mark) return;
        session.mark.dims = !session.mark.dims;
        dims.classList.toggle("is-on", session.mark.dims);
        dims.setAttribute("aria-pressed", session.mark.dims ? "true" : "false");
        markDraw();
      });
    }
    modal.addEventListener("change", (e) => {
      const input = e.target.closest('[data-snap-step="' + kind + '"]');
      if (!input) return;
      const state = kind === "planner" ? session.planner : session.mark;
      if (!state) return;
      const value = plannerDraft(input.value);
      if (value == null || value < 0.01 || value > 5) {
        editorSnapRefresh(kind);
        return;
      }
      state.snapStep = plannerRound(value);
      input.value = String(state.snapStep);
      if (kind === "planner") plannerDraw(); else markDraw();
    });
  }

  function plannerSnap(node, pointId, x, y, shift, origin) {
    const snapOn = session.planner?.snapEnabled !== false;
    const step = session.planner?.snapStep || EDITOR_SNAP_DEFAULT;
    let nx = snapOn ? editorSnapValue(x, step) : plannerRound(x);
    let ny = snapOn ? editorSnapValue(y, step) : plannerRound(y);
    if (shift && origin) {
      if (Math.abs(x - origin.x) >= Math.abs(y - origin.y)) ny = origin.y;
      else nx = origin.x;
    }
    let bestX = null;
    let bestY = null;
    let bestDx = 0.12;
    let bestDy = 0.12;
    if (snapOn) node.points.forEach((p) => {
      if (p.id === pointId) return;
      const dx = Math.abs(nx - p.x);
      const dy = Math.abs(ny - p.y);
      if (dx < bestDx) {
        bestDx = dx;
        bestX = p.x;
      }
      if (dy < bestDy) {
        bestDy = dy;
        bestY = p.y;
      }
    });
    if (bestX != null) nx = bestX;
    if (bestY != null) ny = bestY;
    nx = plannerClamp(nx, -500, 500);
    ny = plannerClamp(ny, -500, 500);
    const i = node.points.findIndex((p) => p.id === pointId);
    if (i < 0) return null;
    const prev = node.points[(i - 1 + node.points.length) % node.points.length];
    const next = node.points[(i + 1) % node.points.length];
    if (Math.hypot(nx - prev.x, ny - prev.y) < 0.05 || Math.hypot(nx - next.x, ny - next.y) < 0.05) return null;
    return { x: plannerRound(nx), y: plannerRound(ny) };
  }

  const PLANNER_NUDGE_DIRS = {
    n: [0, -1],
    ne: [1, -1],
    e: [1, 0],
    se: [1, 1],
    s: [0, 1],
    sw: [-1, 1],
    w: [-1, 0],
    nw: [-1, -1],
  };

  function plannerShift(node, nudge, dist) {
    const vec = PLANNER_NUDGE_DIRS[nudge?.dir];
    if (!vec || !(dist > 0)) return false;
    const len = Math.hypot(vec[0], vec[1]) || 1;
    const dx = (vec[0] / len) * dist;
    const dy = (vec[1] / len) * dist;
    const pts = node.points || [];
    const near = (x, y, other) => other && Math.hypot(x - other.x, y - other.y) < 0.05;
    if (nudge.kind === "point") {
      const i = pts.findIndex((p) => p.id === nudge.id);
      if (i < 0) return false;
      const p = pts[i];
      const prev = pts[(i - 1 + pts.length) % pts.length];
      const next = pts[(i + 1) % pts.length];
      const x = plannerClamp(p.x + dx, -500, 500);
      const y = plannerClamp(p.y + dy, -500, 500);
      if (near(x, y, prev) || near(x, y, next)) return false;
      p.x = plannerRound(x);
      p.y = plannerRound(y);
      return true;
    }
    const wall = plannerWalls(node).find((item) => item.id === nudge.id);
    if (!wall) return false;
    const before = pts[(wall.index - 1 + pts.length) % pts.length];
    const after = pts[(wall.index + 2) % pts.length];
    const ax = plannerClamp(wall.a.x + dx, -500, 500);
    const ay = plannerClamp(wall.a.y + dy, -500, 500);
    const bx = plannerClamp(wall.b.x + dx, -500, 500);
    const by = plannerClamp(wall.b.y + dy, -500, 500);
    if (near(ax, ay, before) || near(bx, by, after) || Math.hypot(ax - bx, ay - by) < 0.05) return false;
    wall.a.x = plannerRound(ax);
    wall.a.y = plannerRound(ay);
    wall.b.x = plannerRound(bx);
    wall.b.y = plannerRound(by);
    return true;
  }

  function plannerHideNudge() {
    const el = $("planner-nudge");
    if (el) el.hidden = true;
    const box = el?.querySelector(".planner-nudge-box");
    if (box) {
      box.hidden = true;
      box.classList.remove("is-bad");
    }
    if (session.planner) session.planner.nudge = null;
  }

  function plannerPlaceNudge() {
    const el = $("planner-nudge");
    const plan = $("planner-plan");
    const node = plannerNode();
    const nudge = session.planner?.nudge;
    if (!el || !plan || !node || !nudge) return;
    let world = null;
    if (nudge.kind === "point") world = node.points.find((p) => p.id === nudge.id) || null;
    else {
      const wall = plannerWalls(node).find((item) => item.id === nudge.id);
      if (wall) world = { x: (wall.a.x + wall.b.x) / 2, y: (wall.a.y + wall.b.y) / 2 };
    }
    if (!world) {
      plannerHideNudge();
      return;
    }
    const view = plannerView(plan, node.points, session.planner.viewLock);
    const spot = view.to(world);
    el.hidden = false;
    el.style.left = `${spot.x}px`;
    el.style.top = `${spot.y}px`;
    el.querySelectorAll("[data-dir]").forEach((btn) => btn.classList.toggle("is-on", btn.dataset.dir === nudge.dir));
    const box = el.querySelector(".planner-nudge-box");
    if (box) {
      box.hidden = !nudge.dir;
      const below = spot.y + 116 <= plan.clientHeight;
      box.style.top = below ? "68px" : "-68px";
      box.style.transform = below ? "translate(-50%, 0)" : "translate(-50%, -100%)";
    }
  }

  function plannerNudgeSubmit() {
    const node = plannerNode();
    const nudge = session.planner?.nudge;
    const input = $("planner-nudge-input");
    const box = document.querySelector("#planner-nudge .planner-nudge-box");
    if (!node || !nudge?.dir || !input) return;
    const value = plannerDraft(input.value);
    const ok = value != null && plannerShift(node, nudge, value);
    box?.classList.toggle("is-bad", !ok);
    if (!ok) {
      input.focus();
      return;
    }
    plannerCommit(false);
    input.focus();
    input.select();
  }

  function plannerNode() {
    const id = session.planner?.id;
    if (!id) return null;
    const node = (activeBlueprint()?.nodes || []).find((item) => item.id === id && item.type === "planner") || null;
    if (!node) {
      session.planner = null;
      $("planner-modal")?.classList.remove("open");
    }
    return node;
  }

  function plannerSelWall(node) {
    const sel = session.planner?.sel;
    if (!node || !sel) return null;
    const walls = plannerWalls(node);
    if (sel.kind === "wall") return walls.find((wall) => wall.id === sel.id) || null;
    if (sel.kind === "point") return walls.find((wall) => wall.id === `w:${sel.id}`) || null;
    return null;
  }

  function plannerColors() {
    const css = getComputedStyle(document.documentElement);
    const pick = (name, fallback) => css.getPropertyValue(name).trim() || fallback;
    return {
      ink: pick("--ink", "#0f172a"),
      muted: pick("--muted", "#64748b"),
      line: pick("--line", "#dbe3ec"),
      card: pick("--card", "#fff"),
      bg: pick("--bg-2", "#f7fafc"),
    };
  }

  function plannerFitCanvas(canvas) {
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    if (w < 8 || h < 8) return null;
    const dpr = window.devicePixelRatio || 1;
    const bw = Math.max(1, Math.round(w * dpr));
    const bh = Math.max(1, Math.round(h * dpr));
    if (canvas.width !== bw || canvas.height !== bh) {
      canvas.width = bw;
      canvas.height = bh;
    }
    const ctx = canvas.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return { ctx, w, h };
  }

  function plannerFit(canvas, points) {
    const pad = 36;
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    points.forEach((p) => {
      minX = Math.min(minX, p.x);
      minY = Math.min(minY, p.y);
      maxX = Math.max(maxX, p.x);
      maxY = Math.max(maxY, p.y);
    });
    const spanX = Math.max(0.5, maxX - minX);
    const spanY = Math.max(0.5, maxY - minY);
    const scale = Math.min((canvas.clientWidth - pad * 2) / spanX, (canvas.clientHeight - pad * 2) / spanY);
    return {
      scale,
      ox: (canvas.clientWidth - spanX * scale) / 2 - minX * scale,
      oy: (canvas.clientHeight - spanY * scale) / 2 - minY * scale,
      minX,
      minY,
      spanX,
      spanY,
    };
  }

  function plannerCam() {
    if (!session.planner) return { k: 1, x: 0, y: 0 };
    if (!session.planner.cam) session.planner.cam = { k: 1, x: 0, y: 0 };
    return session.planner.cam;
  }

  function plannerView(canvas, points, lock) {
    if (lock) return lock;
    const fit = plannerFit(canvas, points);
    const cam = session.planner?.cam || { k: 1, x: 0, y: 0 };
    const k = cam.k || 1;
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    const scale = fit.scale * k;
    const ox = (fit.ox - w / 2) * k + w / 2 + (cam.x || 0);
    const oy = (fit.oy - h / 2) * k + h / 2 + (cam.y || 0);
    return {
      scale,
      to(p) {
        return { x: ox + p.x * scale, y: oy + p.y * scale };
      },
      from(x, y) {
        return { x: (x - ox) / scale, y: (y - oy) / scale };
      },
    };
  }

  function plannerDistSeg(px, py, ax, ay, bx, by) {
    const dx = bx - ax;
    const dy = by - ay;
    const l2 = dx * dx + dy * dy || 1;
    let t = ((px - ax) * dx + (py - ay) * dy) / l2;
    t = Math.max(0, Math.min(1, t));
    return Math.hypot(px - (ax + dx * t), py - (ay + dy * t));
  }

  function plannerRoundPath(ctx, x, y, w, h, r) {
    if (typeof ctx.roundRect === "function") ctx.roundRect(x, y, w, h, r);
    else ctx.rect(x, y, w, h);
  }

  function plannerPill(ctx, text, x, y, colors) {
    ctx.save();
    ctx.font = "12px Segoe UI, sans-serif";
    const w = ctx.measureText(text).width + 12;
    const h = 18;
    const left = x - w / 2;
    const top = y - h / 2;
    ctx.fillStyle = colors.card;
    ctx.strokeStyle = colors.line;
    ctx.lineWidth = 1;
    ctx.beginPath();
    plannerRoundPath(ctx, left, top, w, h, 6);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = colors.ink;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(text, x, y + 0.5);
    ctx.restore();
  }

  function plannerHit(canvas, node, clientX, clientY) {
    const view = session.planner?.viewLock || plannerView(canvas, node.points);
    const rect = canvas.getBoundingClientRect();
    const x = clientX - rect.left;
    const y = clientY - rect.top;
    let pointId = "";
    let best = 12;
    node.points.forEach((p) => {
      const s = view.to(p);
      const d = Math.hypot(s.x - x, s.y - y);
      if (d <= best) {
        best = d;
        pointId = p.id;
      }
    });
    if (pointId) return { pointId, wallId: "", world: view.from(x, y) };
    let wallId = "";
    let bestW = 8;
    plannerWalls(node).forEach((wall) => {
      const a = view.to(wall.a);
      const b = view.to(wall.b);
      const d = plannerDistSeg(x, y, a.x, a.y, b.x, b.y);
      if (d <= bestW) {
        bestW = d;
        wallId = wall.id;
      }
    });
    return { pointId: "", wallId, world: view.from(x, y) };
  }

  function plannerDraw() {
    const node = plannerNode();
    const plan = $("planner-plan");
    const unfold = $("planner-unfold");
    if (!node || !plan || !unfold || !session.planner) return;
    const colors = plannerColors();
    const model = plannerModel(node, plannerExternalHeight(node));
    const selWall = plannerSelWall(node);
    const selPoint = session.planner.sel?.kind === "point" ? session.planner.sel.id : "";
    const fitted = plannerFitCanvas(plan);
    if (fitted) {
      const { ctx, w, h } = fitted;
      const view = plannerView(plan, node.points, session.planner.viewLock);
      ctx.clearRect(0, 0, w, h);
      ctx.fillStyle = colors.bg;
      ctx.fillRect(0, 0, w, h);
      const step = session.planner.snapStep || EDITOR_SNAP_DEFAULT;
      if (session.planner.snapEnabled !== false) {
      ctx.save();
      ctx.beginPath();
      ctx.strokeStyle = colors.line;
      ctx.globalAlpha = 0.85;
      ctx.lineWidth = 1;
      const topLeft = view.from(0, 0);
      const botRight = view.from(w, h);
      const x0 = Math.floor(Math.min(topLeft.x, botRight.x) / step) * step;
      const x1 = Math.ceil(Math.max(topLeft.x, botRight.x) / step) * step;
      const y0 = Math.floor(Math.min(topLeft.y, botRight.y) / step) * step;
      const y1 = Math.ceil(Math.max(topLeft.y, botRight.y) / step) * step;
      for (let x = x0; x <= x1; x += step) {
        const s = view.to({ x, y: 0 });
        ctx.moveTo(s.x, 0);
        ctx.lineTo(s.x, h);
      }
      for (let y = y0; y <= y1; y += step) {
        const s = view.to({ x: 0, y });
        ctx.moveTo(0, s.y);
        ctx.lineTo(w, s.y);
      }
      ctx.stroke();
      ctx.restore();
      }
      ctx.beginPath();
      node.points.forEach((p, i) => {
        const s = view.to(p);
        if (i) ctx.lineTo(s.x, s.y);
        else ctx.moveTo(s.x, s.y);
      });
      ctx.closePath();
      ctx.fillStyle = "rgba(101, 163, 13, 0.16)";
      ctx.fill();
      const center = plannerCentroid(node.points);
      const mid = view.to(center);
      plannerWalls(node).forEach((wall) => {
        const a = view.to(wall.a);
        const b = view.to(wall.b);
        const on = selWall && selWall.id === wall.id;
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.strokeStyle = on ? "#65a30d" : "#3f6212";
        ctx.lineWidth = on ? 3.5 : 2;
        ctx.stroke();
        if (Math.hypot(b.x - a.x, b.y - a.y) < 36) return;
        let nx = -(wall.b.y - wall.a.y);
        let ny = wall.b.x - wall.a.x;
        const len = Math.hypot(nx, ny) || 1;
        nx /= len;
        ny /= len;
        const mx = (wall.a.x + wall.b.x) / 2;
        const my = (wall.a.y + wall.b.y) / 2;
        if ((mx - center.x) * nx + (my - center.y) * ny < 0) {
          nx = -nx;
          ny = -ny;
        }
        const label = view.to({ x: mx, y: my });
        plannerPill(ctx, `${fmtShort(wall.len)} м`, Math.max(28, Math.min(w - 28, label.x + nx * 18)), Math.max(14, Math.min(h - 14, label.y + ny * 18)), colors);
      });
      node.points.forEach((p) => {
        const s = view.to(p);
        ctx.beginPath();
        ctx.arc(s.x, s.y, p.id === selPoint ? 7 : 5.5, 0, Math.PI * 2);
        ctx.fillStyle = colors.card;
        ctx.fill();
        ctx.lineWidth = 2;
        ctx.strokeStyle = p.id === selPoint ? "#65a30d" : "#3f6212";
        ctx.stroke();
      });
      const activeDrag = session.planner.drag;
      if (activeDrag?.id && activeDrag.moved) {
        const moving = node.points.find((p) => p.id === activeDrag.id);
        if (moving) {
          const guides = { x: true, y: true };
          ctx.save();
          ctx.strokeStyle = "#0ea5e9";
          ctx.lineWidth = 1;
          ctx.setLineDash([5, 4]);
          ctx.globalAlpha = 0.95;
          const center = view.to(moving);
          ctx.beginPath();
          if (guides.x) { ctx.moveTo(center.x, 0); ctx.lineTo(center.x, h); }
          if (guides.y) { ctx.moveTo(0, center.y); ctx.lineTo(w, center.y); }
          ctx.stroke();
          ctx.restore();
        }
      }
      ctx.fillStyle = colors.ink;
      ctx.font = "700 14px Segoe UI, sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(`${fmtShort(model.floor)} м²`, mid.x, mid.y);
    }
    const strip = plannerFitCanvas(unfold);
    session.planner.hits = [];
    if (strip) {
      const { ctx, w, h } = strip;
      ctx.clearRect(0, 0, w, h);
      ctx.fillStyle = colors.bg;
      ctx.fillRect(0, 0, w, h);
      const walls = model.walls;
      const total = walls.reduce((sum, wall) => sum + wall.len, 0) || 1;
      const gap = walls.length > 1 ? 8 : 0;
      const scale = Math.min((w - 24 - gap * (walls.length - 1)) / total, (h - 46) / Math.max(0.2, model.height));
      let x = 12;
      const rh = model.height * scale;
      const top = Math.max(22, (h - 18 - rh) / 2);
      walls.forEach((wall, index) => {
        const rw = Math.max(1, wall.len * scale);
        const on = selWall && selWall.id === wall.id;
        ctx.fillStyle = on ? "rgba(101, 163, 13, 0.28)" : "rgba(101, 163, 13, 0.12)";
        ctx.strokeStyle = on ? "#65a30d" : "#4d7c0f";
        ctx.lineWidth = on ? 2.5 : 1.25;
        ctx.beginPath();
        plannerRoundPath(ctx, x, top, rw, rh, 4);
        ctx.fill();
        ctx.stroke();
        const row = model.rows[index + 1];
        ctx.fillStyle = colors.ink;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.font = "700 12px Segoe UI, sans-serif";
        if (rw >= 54) {
          ctx.fillText(String(index + 1), x + rw / 2, top + Math.min(rh / 2, 16));
          ctx.font = "11px Segoe UI, sans-serif";
          ctx.fillStyle = colors.muted;
          if (rh > 36) ctx.fillText(`${fmtShort(row?.area || 0)} м²`, x + rw / 2, top + rh / 2 + 12);
        } else {
          ctx.fillText(String(index + 1), x + rw / 2, top - 10);
        }
        session.planner.hits.push({ id: wall.id, x, y: top, w: rw, h: rh });
        x += rw + gap;
      });
    }
    plannerSyncFields(model);
    plannerPlaceNudge();
    plannerMini();
  }

  function plannerMini() {
    const canvas = $("planner-minimap");
    const wrap = $("planner-mini-wrap");
    const plan = $("planner-plan");
    const node = plannerNode();
    if (!canvas || !plan || !node || !session.planner) return;
    wrap?.classList.toggle("is-hidden", !!session.planner.miniHidden);
    if (session.planner.miniHidden) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const cssW = 200;
    const cssH = 128;
    if (canvas.width !== Math.round(cssW * dpr)) {
      canvas.width = Math.round(cssW * dpr);
      canvas.height = Math.round(cssH * dpr);
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const dark = document.documentElement.getAttribute("data-theme") === "dark";
    ctx.clearRect(0, 0, cssW, cssH);
    ctx.fillStyle = dark ? "#0b1220" : "#eef3f8";
    ctx.fillRect(0, 0, cssW, cssH);
    const fit = plannerFit(plan, node.points);
    const inset = 10;
    const scale = Math.min((cssW - inset * 2) / fit.spanX, (cssH - inset * 2) / fit.spanY);
    const ox = (cssW - fit.spanX * scale) / 2 - fit.minX * scale;
    const oy = (cssH - fit.spanY * scale) / 2 - fit.minY * scale;
    session.planner.mini = { scale, ox, oy, w: cssW, h: cssH };
    ctx.beginPath();
    node.points.forEach((p, i) => {
      const x = ox + p.x * scale;
      const y = oy + p.y * scale;
      if (i) ctx.lineTo(x, y);
      else ctx.moveTo(x, y);
    });
    ctx.closePath();
    ctx.fillStyle = node.color || "#65a30d";
    ctx.globalAlpha = 0.28;
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.strokeStyle = node.color || "#65a30d";
    ctx.lineWidth = 1.5;
    ctx.stroke();
    const view = plannerView(plan, node.points);
    const a = view.from(0, 0);
    const b = view.from(plan.clientWidth, plan.clientHeight);
    const vx = ox + Math.min(a.x, b.x) * scale;
    const vy = oy + Math.min(a.y, b.y) * scale;
    const vw = Math.abs(b.x - a.x) * scale;
    const vh = Math.abs(b.y - a.y) * scale;
    ctx.strokeStyle = "#14b8a6";
    ctx.lineWidth = 1.4;
    ctx.strokeRect(vx, vy, Math.max(8, vw), Math.max(8, vh));
    ctx.fillStyle = "rgba(20, 184, 166, 0.12)";
    ctx.fillRect(vx, vy, Math.max(8, vw), Math.max(8, vh));
  }

  function plannerSyncFields(model) {
    const node = plannerNode();
    if (!node || !model || !session.planner) return;
    const linked = linkedFromPorts(node.id, activeBlueprint()?.links || []);
    const setVal = (id, text) => {
      const el = document.querySelector(`#planner-side [data-planner-val="${cssEsc(id)}"]`);
      if (el) el.textContent = text;
    };
    const setNote = (id, text) => {
      const el = document.querySelector(`#planner-side [data-planner-note="${cssEsc(id)}"]`);
      if (el) el.textContent = text;
    };
    model.rows.forEach((row) => {
      setVal(row.id, `${fmtShort(row.value ?? row.area)} ${row.unit || "м²"}`);
      const pogonazh = document.querySelector(`#planner-side [data-planner-pogonazh="${cssEsc(row.id)}"]`);
      if (pogonazh) pogonazh.checked = !!row.pogonazh;
      const axis = document.querySelector(`#planner-side [data-planner-axis="${cssEsc(row.id)}"]`);
      if (axis) axis.checked = row.pogonazhAxis === "length";
      const axisWrap = document.querySelector(`#planner-side [data-planner-axis-wrap="${cssEsc(row.id)}"]`);
      if (axisWrap) axisWrap.hidden = !row.pogonazh;
      const len = document.querySelector(`#planner-side [data-planner-len="${cssEsc(row.id)}"]`);
      if (len && document.activeElement !== len) len.value = plannerInput(row.len);
      const name = document.querySelector(`#planner-side [data-planner-name="${cssEsc(row.id)}"]`);
      if (name && document.activeElement !== name) name.value = row.name;
    });
    model.sums.forEach((row) => {
      setVal(row.id, `${fmtShort(row.value ?? row.area)} ${row.unit || "м²"}`);
      setNote(row.id, plannerSumNote(row.parts, model.walls.length));
      const name = document.querySelector(`#planner-side [data-planner-sum-name="${cssEsc(row.id)}"]`);
      if (name && document.activeElement !== name) name.value = row.name;
    });
    document.querySelectorAll("#planner-side .planner-part").forEach((label) => {
      const row = model.rows.find((item) => item.id === label.querySelector("[data-part]")?.dataset.part);
      if (!row) return;
      const span = label.querySelector("span");
      const em = label.querySelector("em");
      if (span) span.textContent = row.name;
      if (em) em.textContent = `${fmtShort(row.value ?? row.area)} ${row.unit || "м²"}`;
    });
    document.querySelectorAll("#planner-side [data-planner-on]").forEach((el) => {
      const id = el.dataset.plannerOn;
      const row = model.rows.concat(model.sums).find((item) => item.id === id);
      if (!row || document.activeElement === el) return;
      el.checked = !!(row.on || linked.has(id));
      el.disabled = linked.has(id);
      el.title = linked.has(id) ? "Сначала снимите связь на схеме" : "Вывести число на ноду";
    });
    const heightIn = document.querySelector('#planner-side [data-planner-height-in-on]');
    if (heightIn) heightIn.checked = !!node.heightInputEnabled;
    const heightOut = document.querySelector('#planner-side [data-planner-height-on]');
    if (heightOut) {
      const heightId = plannerPort(plannerActive(node), "height");
      heightOut.checked = !!(node.heightOut || linked.has(heightId));
      heightOut.disabled = linked.has(heightId);
      heightOut.title = linked.has(heightId) ? "Сначала снимите связь на схеме" : "Вывести высоту стен на ноду";
    }
    document.querySelectorAll("#planner-side [data-planner-row]").forEach((el) => {
      const wall = plannerSelWall(node);
      el.classList.toggle("is-sel", !!wall && el.dataset.plannerRow === wall.id);
    });
    const rect = plannerRect(node.points);
    const width = $("planner-width");
    const depth = $("planner-depth");
    const height = $("planner-height");
    const linkedHeight = (activeBlueprint()?.links || []).some((link) => link.to === node.id && link.toPort === "height-in");
    const incomingHeight = plannerExternalHeight(node);
    if (height) {
      height.disabled = linkedHeight && incomingHeight != null;
      height.title = height.disabled ? "Высота поступает с подключённого входа" : "Высота стен, метры";
    }
    if (rect && width && document.activeElement !== width) width.value = plannerInput(rect.w);
    if (rect && depth && document.activeElement !== depth) depth.value = plannerInput(rect.d);
    if (height && document.activeElement !== height) height.value = plannerInput(model.height);
    const make = $("planner-make-rect");
    if (make) make.hidden = !!rect;
    if (width) width.title = rect ? "Ширина комнаты" : "Ширина прямоугольника, который заменит план";
    if (depth) depth.title = rect ? "Глубина комнаты" : "Глубина прямоугольника, который заменит план";
    const add = $("planner-add-corner");
    const del = $("planner-del-corner");
    if (add) add.disabled = !plannerSelWall(node) || node.points.length >= PLANNER_MAX_PTS;
    if (del) del.disabled = session.planner.sel?.kind !== "point" || node.points.length <= 3;
    const peri = document.querySelector("#planner-side [data-planner-peri]");
    if (peri) peri.textContent = `периметр ${fmtShort(model.peri)} м`;
  }

  function plannerSideHtml(node) {
    const incomingHeight = plannerExternalHeight(node);
    const model = plannerModel(node, incomingHeight);
    const linked = linkedFromPorts(node.id, activeBlueprint()?.links || []);
    const onBox = (id, on) => {
      const lock = linked.has(id);
      return `<label class="planner-on" title="${lock ? "Сначала снимите связь на схеме" : "Вывести число на ноду"}"><input type="checkbox" data-planner-on="${esc(id)}" ${on || lock ? "checked" : ""} ${lock ? "disabled" : ""} /> На ноду</label>`;
    };
    const rows = model.rows
      .map((row) => {
        if (row.kind === "floor") {
          return `<div class="planner-metric" data-planner-row="${esc(row.id)}">
            ${onBox(row.id, row.on)}
            <span class="planner-label">Пол</span>
            <b data-planner-val="${esc(row.id)}">${esc(fmtShort(row.area))} м²</b>
          </div>`;
        }
        return `<div class="planner-metric" data-planner-row="${esc(row.id)}">
          ${onBox(row.id, row.on)}
          <input class="planner-name" data-planner-name="${esc(row.id)}" value="${esc(row.name)}" maxlength="48" aria-label="Имя стены" />
          <label class="planner-len">длина <input data-planner-len="${esc(row.id)}" value="${esc(plannerInput(row.len))}" inputmode="decimal" aria-label="Длина стены" /> м</label>
          <b data-planner-val="${esc(row.id)}">${esc(fmtShort(row.value ?? row.area))} ${row.unit || "м²"}</b>
          <div class="planner-wall-tools">
            <label class="planner-on" title="Вместо площади выводить погонаж"><input type="checkbox" data-planner-pogonazh="${esc(row.id)}" ${row.pogonazh ? "checked" : ""} /> Погонаж</label>
            <label class="planner-axis-switch" data-planner-axis-wrap="${esc(row.id)}" ${row.pogonazh ? "" : "hidden"}>
              <span>Высота</span>
              <input type="checkbox" role="switch" data-planner-axis="${esc(row.id)}" ${row.pogonazhAxis === "length" ? "checked" : ""} aria-label="Переключить на длину стены" />
              <span>Длина</span>
            </label>
          </div>
        </div>`;
      })
      .join("");
    const sums = model.sums
      .map((sum) => {
        const parts = model.rows
          .map((row) => {
            const checked = sum.parts.includes(row.id) ? "checked" : "";
            return `<label class="planner-part"><input type="checkbox" data-planner-part="${esc(sum.id)}" data-part="${esc(row.id)}" ${checked} /> <span>${esc(row.name)}</span> <em>${esc(fmtShort(row.value ?? row.area))} ${row.unit || "м²"}</em></label>`;
          })
          .join("");
        return `<div class="planner-sum" data-planner-row="${esc(sum.id)}">
          <div class="planner-sum-h">
            ${onBox(sum.id, sum.on)}
            <input class="planner-name" data-planner-sum-name="${esc(sum.id)}" value="${esc(sum.name)}" maxlength="48" aria-label="Имя суммы" />
            <b data-planner-val="${esc(sum.id)}">${esc(fmtShort(sum.value ?? sum.area))} ${sum.unit || "м²"}</b>
            <button type="button" class="calc-x" data-planner-del-sum="${esc(sum.id)}" title="Удалить сумму">×</button>
          </div>
          <div class="planner-sum-tools">
            <p data-planner-note="${esc(sum.id)}">${esc(plannerSumNote(sum.parts, model.walls.length))}</p>
            <button type="button" data-planner-sum-walls="${esc(sum.id)}">Все стены</button>
            <button type="button" data-planner-sum-clear="${esc(sum.id)}">Снять</button>
          </div>
          <div class="planner-parts">${parts}</div>
        </div>`;
      })
      .join("");
    const addSum = model.sums.length >= PLANNER_MAX_SUMS ? "" : `<button type="button" class="btn planner-add-sum" data-planner-add-sum>+ Сумма</button>`;
    return `<div class="planner-block">
        <div class="planner-block-h">Площади <span data-planner-peri>периметр ${esc(fmtShort(model.peri))} м</span></div>
        ${rows}
      </div>
      <div class="planner-block">
        <div class="planner-block-h">Параметры</div>
        <div class="planner-metric">
          <label class="planner-on" title="Включить вход для внешней высоты потолка"><input type="checkbox" data-planner-height-in-on ${node.heightInputEnabled ? "checked" : ""} /> Вход высоты потолка</label>
        </div>
        <div class="planner-metric">
          <label class="planner-on" title="Вывести высоту стен на ноду"><input type="checkbox" data-planner-height-on ${node.heightOut ? "checked" : ""} /> На ноду</label>
          <span class="planner-label">Высота стен</span>
          <b>${esc(fmtShort(model.height))} м</b>
        </div>
      </div>
      <div class="planner-block">
        <div class="planner-block-h">Сумма выбранных ${addSum}</div>
        <p class="planner-lead">Отметьте пол и стены, которые нужно сложить. На ноду выйдет одно число.</p>
        ${sums || `<div class="calc-empty">Сумм пока нет</div>`}
      </div>`;
  }

  function plannerMenu(node) {
    const picker = $("planner-layout-trigger");
    const menu = $("planner-layout-menu");
    if (!picker || !menu) return;
    const common = session.planner?.view === COMMON_VIEW;
    const layout = plannerActive(node);
    const commonToggle = $("planner-common-toggle");
    if (commonToggle) {
      commonToggle.classList.toggle("is-on", common);
      commonToggle.setAttribute("aria-pressed", String(common));
      commonToggle.setAttribute("aria-label", common ? "Вернуться к чертежу" : "Открыть общий вывод");
      commonToggle.title = common ? "Вернуться к чертежу" : "Общий вывод";
    }
    picker.textContent = common ? "Общий вывод" : (layout?.name || "Планировка");
    menu.innerHTML = `${(node.layouts || []).map((item) => `<button type="button" class="planner-layout-option ${!common && item.id === node.layoutId ? "is-active" : ""}" role="menuitem" data-planner-layout-choice="${esc(item.id)}">${esc(item.name)}</button>`).join("")}<div class="planner-layout-menu-sep"></div><button type="button" class="planner-layout-option is-create" role="menuitem" data-planner-layout-choice="__new">＋ Создать планировку</button><button type="button" class="planner-layout-option ${common ? "is-active" : ""}" role="menuitem" data-planner-layout-choice="${COMMON_VIEW}">Общий вывод</button>`;
  }

  function plannerSideHelpify(side) {
    if (!side) return;
    const groups = new Map();
    side.querySelectorAll('.planner-lead').forEach((lead) => {
      if (false) return;
      const block = lead.closest('.planner-block');
      if (!block) return;
      let head = block.querySelector(':scope > .planner-block-h');
      if (!head) { head = document.createElement('div'); head.className = 'planner-block-h'; head.textContent = 'Пояснение'; block.insertBefore(head, block.firstChild); }
      const value = String(lead.textContent || '').trim();
      if (value) { if (!groups.has(head)) groups.set(head, []); groups.get(head).push(value); }
      lead.remove();
    });
    groups.forEach((texts, head) => {
      let wrap = head.querySelector(':scope > .planner-block-title-wrap');
      if (!wrap) {
        wrap = document.createElement('span'); wrap.className = 'planner-block-title-wrap';
        const node = [...head.childNodes].find((item) => item.nodeType === Node.TEXT_NODE && String(item.textContent || '').trim());
        if (node) { const title = document.createElement('span'); title.className = 'planner-block-title'; title.textContent = node.textContent.trim(); head.replaceChild(title, node); wrap.appendChild(title); }
        else { const title = [...head.children].find((item) => !item.matches('button,.planner-help')); if (title) wrap.appendChild(title); }
        head.insertBefore(wrap, head.firstChild);
      }
      let button = wrap.querySelector(':scope > .planner-help');
      if (!button) { button = document.createElement('button'); button.type = 'button'; button.className = 'planner-help'; button.textContent = 'i'; button.setAttribute('aria-label', 'Пояснение к разделу'); wrap.appendChild(button); }
      button.dataset.help = [...new Set(texts)].join(String.fromCharCode(10));
      button.removeAttribute('title');
    });
  }

  function plannerFill() {
    const node = plannerNode();
    const side = $("planner-side");
    if (!node || !side) return;
    ensurePlanner(node);
    const modal = $("planner-modal");
    const common = session.planner?.view === COMMON_VIEW;
    modal?.classList.toggle("is-common", common);
    plannerMenu(node);
    if (common) {
      const bp = activeBlueprint();
      const stage = $("planner-common");
      if (stage) stage.hidden = false;
      paintCommon("planner", node, bp, bp ? computeGraph(bp).values : {});
      plannerSideHelpify(side);
      return;
    }
    const stage = $("planner-common");
    if (stage) stage.hidden = true;
    const scroll = side.scrollTop;
    side.innerHTML = plannerSideHtml(node);
    plannerSideHelpify(side);
    side.scrollTop = scroll;
    const rect = plannerRect(node.points);
    const boxW = rect ? rect.w : Math.max(...node.points.map((p) => p.x)) - Math.min(...node.points.map((p) => p.x));
    const boxD = rect ? rect.d : Math.max(...node.points.map((p) => p.y)) - Math.min(...node.points.map((p) => p.y));
    const width = $("planner-width");
    const depth = $("planner-depth");
    const height = $("planner-height");
    const graph = activeBlueprint() ? computeGraph(activeBlueprint()) : null;
    const linkedHeight = (activeBlueprint()?.links || []).some((link) => link.to === node.id && link.toPort === "height-in");
    const incomingHeight = graph?.values?.[`${node.id}:height-in`];
    const effectiveHeight = node.heightInputEnabled && Number.isFinite(incomingHeight) ? plannerRound(plannerClamp(incomingHeight, 0.2, 30)) : node.height;
    if (width && document.activeElement !== width) width.value = plannerInput(boxW || 4);
    if (depth && document.activeElement !== depth) depth.value = plannerInput(boxD || 3);
    if (height && document.activeElement !== height) height.value = plannerInput(effectiveHeight);
    if (height) {
      height.disabled = linkedHeight && Number.isFinite(incomingHeight);
      height.title = height.disabled ? "Высота поступает с подключённого входа" : "Высота стен, метры";
    }
    const title = $("planner-title");
    const layout = plannerActive(node);
    if (title && document.activeElement !== title) title.value = layout?.name || "Планировка 1";
    plannerMenu(node);
    const paste = $("planner-paste");
    if (paste) paste.hidden = editorClip?.kind !== "planner";
    plannerDraw();
  }

  async function plannerPasteLayout() {
    const node = plannerNode();
    const layout = node && plannerActive(node);
    if (!node || !layout || editorClip?.kind !== "planner") return;
    const ok = api?.confirm
      ? await api.confirm({
          title: "Заменить планировку?",
          text: "Текущая планировка будет заменена копией.",
          ok: "Заменить",
          danger: true,
        })
      : true;
    if (!ok || !plannerNode()) return;
    const src = JSON.parse(JSON.stringify(editorClip));
    const map = new Map();
    (src.points || []).forEach((p) => {
      const next = uid();
      map.set(p.id, next);
      p.id = next;
    });
    const floorId = plannerPort(layout, "floor");
    const oldIds = new Set((layout.outs || []).map((item) => item.id).concat(plannerPort(layout, "height")));
    (src.outs || []).forEach((out) => {
      if (out.kind === "wall") {
        const next = map.get(String(out.id || "").slice(2));
        out.id = next ? `w:${next}` : `w:${uid()}`;
      } else if (out.kind === "floor") out.id = floorId;
      else if (out.kind === "sum") {
        out.id = uid();
        out.parts = (out.parts || []).map((part) => {
          const key = String(part || "");
          if (key === "floor" || key.startsWith("floor:")) return floorId;
          if (key.startsWith("w:")) {
            const next = map.get(key.slice(2));
            return next ? `w:${next}` : "";
          }
          return "";
        }).filter(Boolean);
      }
    });
    layout.name = plannerLayoutName({ name: src.name }, Math.max(0, node.layouts.indexOf(layout)));
    layout.color = src.color;
    layout.height = src.height;
    layout.heightOut = !!src.heightOut;
    layout.points = src.points;
    layout.outs = src.outs;
    plannerApply(node, layout);
    ensurePlanner(node);
    const keep = new Set((node.outs || []).map((item) => item.id).concat(plannerPort(layout, "height"), plannerPort(layout, "plan")));
    plannerDropPorts(node, [...oldIds].filter((id) => !keep.has(id)));
    if (session.planner) session.planner.sel = null;
    plannerCommit(true);
  }

  const editorHist = { on: false, stack: [], index: -1 };

  function editorBundle() {
    const plannerOpen = $("planner-modal")?.classList.contains("open");
    const markOpen = $("mark-modal")?.classList.contains("open");
    const node = plannerOpen ? plannerNode() : markOpen ? markNode() : null;
    const bp = activeBlueprint();
    const calc = ensureState();
    if (!node || !bp || !calc) return "";
    const links = (bp.links || []).filter((link) => link.from === node.id || link.to === node.id);
    const catalog = node.type === "electrics"
      ? {
          socketTypes: calc.socketTypes || [],
          lightTypes: calc.lightTypes || [],
          labels: calc.labels || {},
          typeOff: calc.typeOff || [],
        }
      : null;
    return JSON.stringify({ node, links, catalog });
  }

  function editorBegin() {
    editorHist.on = true;
    editorHist.stack = [];
    editorHist.index = -1;
    const snap = editorBundle();
    if (!snap) return;
    editorHist.stack.push(snap);
    editorHist.index = 0;
  }

  function editorEnd() {
    const base = editorHist.stack[0] || "";
    const now = editorHist.on ? editorBundle() : "";
    const changed = !!(editorHist.on && base && now && base !== now);
    editorHist.on = false;
    editorHist.stack = [];
    editorHist.index = -1;
    if (changed) dirty();
  }

  function editorPush() {
    if (!editorHist.on) return;
    const snap = editorBundle();
    if (!snap || editorHist.stack[editorHist.index] === snap) return;
    editorHist.stack = editorHist.stack.slice(0, editorHist.index + 1);
    editorHist.stack.push(snap);
    if (editorHist.stack.length > 80) editorHist.stack.shift();
    editorHist.index = editorHist.stack.length - 1;
    dirtyLive();
  }

  function editorApply(snap) {
    const data = JSON.parse(snap);
    const bp = activeBlueprint();
    const calc = ensureState();
    if (!bp || !data?.node) return;
    const at = (bp.nodes || []).findIndex((item) => item.id === data.node.id);
    if (at < 0) return;
    bp.nodes[at] = data.node;
    bp.links = (bp.links || []).filter((link) => link.from !== data.node.id && link.to !== data.node.id).concat(data.links || []);
    if (data.catalog && calc) {
      calc.socketTypes = data.catalog.socketTypes || [];
      calc.lightTypes = data.catalog.lightTypes || [];
      calc.labels = data.catalog.labels || {};
      calc.typeOff = data.catalog.typeOff || [];
    }
    if (session.planner) session.planner.drag = null;
    if (session.mark) session.mark.drag = null;
    render();
    if ($("planner-modal")?.classList.contains("open")) plannerFill();
    if ($("mark-modal")?.classList.contains("open")) {
      markFill();
      const body = $("mark-preset-body");
      if (body && $("mark-preset-modal")?.classList.contains("open")) body.innerHTML = markPresetHtml();
    }
    dirtyLive();
  }

  function editorUndo() {
    if (!editorHist.on || editorHist.index <= 0) return false;
    editorHist.index -= 1;
    editorApply(editorHist.stack[editorHist.index]);
    return true;
  }

  function editorRedo() {
    if (!editorHist.on || editorHist.index >= editorHist.stack.length - 1) return false;
    editorHist.index += 1;
    editorApply(editorHist.stack[editorHist.index]);
    return true;
  }

  function refreshEditors() {
    if (editorHist.on) editorBegin();
    if (session.planner) session.planner.drag = null;
    if (session.mark) session.mark.drag = null;
    if ($("planner-modal")?.classList.contains("open")) plannerFill();
    if ($("mark-modal")?.classList.contains("open")) {
      markFill();
      const body = $("mark-preset-body");
      if (body && $("mark-preset-modal")?.classList.contains("open")) body.innerHTML = markPresetHtml();
    } else $("mark-preset-modal")?.classList.remove("open");
  }

  function plannerCommit(rebuild) {
    const node = plannerNode();
    if (!node) return;
    ensurePlanner(node);
    if ($("planner-modal")?.classList.contains("open")) editorPush();
    else dirty();
    render();
    if (!$("planner-modal")?.classList.contains("open")) return;
    if (session.planner?.view === COMMON_VIEW) {
      if (rebuild) plannerFill();
      return;
    }
    if (rebuild) plannerFill();
    else plannerDraw();
  }

  function plannerSelect(sel, scroll) {
    if (!session.planner) return;
    session.planner.sel = sel;
    plannerDraw();
    if (!scroll || !sel) return;
    const wallId = sel.kind === "wall" ? sel.id : `w:${sel.id}`;
    document.querySelector(`#planner-side [data-planner-row="${cssEsc(wallId)}"]`)?.scrollIntoView({ block: "nearest" });
  }

  function ensurePlannerModal() {
    if ($("planner-modal")) return;
    const modal = document.createElement("div");
    modal.className = "modal";
    modal.id = "planner-modal";
    modal.innerHTML = `<div class="modal-card planner-modal" role="dialog" aria-label="Планировщик">
      <div class="planner-head">
        <div class="planner-layout-control" id="planner-layout-control">
          <button type="button" class="planner-layout-trigger" id="planner-layout-trigger" aria-haspopup="true" aria-expanded="false">Планировка</button>
          <div class="planner-layout-menu" id="planner-layout-menu" role="menu" hidden></div>
        </div>
        <button type="button" class="planner-common-toggle" id="planner-common-toggle" aria-label="Открыть общий вывод" aria-pressed="false" title="Общий вывод">Σ</button>
        <input id="planner-title" class="planner-title" maxlength="48" spellcheck="false" aria-label="Имя планировки" />
        <label>Высота <input id="planner-height" inputmode="decimal" aria-label="Высота стен, метры" /> м</label>
        <label>Ширина <input id="planner-width" inputmode="decimal" aria-label="Ширина, метры" /> м</label>
        <label>Глубина <input id="planner-depth" inputmode="decimal" aria-label="Глубина, метры" /> м</label>
        <button type="button" class="btn" id="planner-make-rect">Прямоугольник</button>
        <button type="button" class="btn primary" id="planner-close">Готово</button>
      </div>
      <div class="planner-body">
        <div class="planner-stage">
          <div class="planner-cap">План пола</div>
          <div class="planner-plan-wrap">
            ${editorSnapControls("planner")}
            <canvas id="planner-plan"></canvas>
            <div class="planner-clip">
              <button type="button" class="planner-clip-btn" id="planner-paste" title="Вставить планировку" aria-label="Вставить планировку" hidden><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5h8v2h2a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2h2V5z" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M9 5.5h6V7H9z" fill="none" stroke="currentColor" stroke-width="1.8"/></svg></button>
              <button type="button" class="planner-clip-btn" id="planner-copy" title="Копировать планировку" aria-label="Копировать планировку"><svg viewBox="0 0 24 24" aria-hidden="true"><rect x="8" y="8" width="11" height="11" rx="2" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M5 15V5.5A1.5 1.5 0 0 1 6.5 4H16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg></button>
            </div>
            <div class="calc-mini-wrap planner-mini" id="planner-mini-wrap">
              <canvas id="planner-minimap" class="calc-minimap" width="200" height="128" aria-label="Карта плана"></canvas>
              <button type="button" class="calc-mini-toggle" id="planner-mini-toggle" title="Скрыть карту" aria-label="Показать или скрыть карту"><svg class="calc-mini-eye-on" width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M2.5 12s3.5-7 9.5-7 9.5 7 9.5 7-3.5 7-9.5 7-9.5-7-9.5-7z" stroke="currentColor" stroke-width="1.8"/><circle cx="12" cy="12" r="3" stroke="currentColor" stroke-width="1.8"/></svg><svg class="calc-mini-eye-off" width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M3 3l18 18M10.6 10.7a2.8 2.8 0 0 0 3.7 3.7M6.2 6.3C4.1 7.8 2.5 12 2.5 12s3.5 7 9.5 7c1.2 0 2.3-.2 3.3-.6" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg></button>
            </div>
            <div id="planner-nudge" class="planner-nudge" hidden>
              <button type="button" class="planner-nudge-dir" data-dir="nw" aria-label="Вверх-влево"><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 3.2 12.4 11.2H3.6z"/></svg></button>
              <button type="button" class="planner-nudge-dir" data-dir="n" aria-label="Вверх"><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 3.2 12.4 11.2H3.6z"/></svg></button>
              <button type="button" class="planner-nudge-dir" data-dir="ne" aria-label="Вверх-вправо"><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 3.2 12.4 11.2H3.6z"/></svg></button>
              <button type="button" class="planner-nudge-dir" data-dir="w" aria-label="Влево"><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 3.2 12.4 11.2H3.6z"/></svg></button>
              <button type="button" class="planner-nudge-dir" data-dir="e" aria-label="Вправо"><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 3.2 12.4 11.2H3.6z"/></svg></button>
              <button type="button" class="planner-nudge-dir" data-dir="sw" aria-label="Вниз-влево"><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 3.2 12.4 11.2H3.6z"/></svg></button>
              <button type="button" class="planner-nudge-dir" data-dir="s" aria-label="Вниз"><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 3.2 12.4 11.2H3.6z"/></svg></button>
              <button type="button" class="planner-nudge-dir" data-dir="se" aria-label="Вниз-вправо"><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 3.2 12.4 11.2H3.6z"/></svg></button>
              <form class="planner-nudge-box" hidden>
                <input id="planner-nudge-input" inputmode="decimal" autocomplete="off" placeholder="0" aria-label="Сдвиг, метры" />
                <span>м</span>
                <button type="submit" aria-label="Сдвинуть"><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3.2 8.2 6.4 11.4 12.8 4.6"/></svg></button>
              </form>
            </div>
          </div>
          <div class="planner-hint">
            <span>Тяните угол. Клик по стене — длина справа. Двойной клик по стене добавляет угол. Правый клик по углу или стене сдвигает их стрелками. Shift держит линию прямой.</span>
            <span class="planner-hint-btns">
              <button type="button" class="btn" id="planner-add-corner">Добавить угол</button>
              <button type="button" class="btn" id="planner-del-corner">Удалить угол</button>
            </span>
          </div>
          <div class="planner-cap">Развертка стен</div>
          <canvas id="planner-unfold"></canvas>
          <div id="planner-common" class="common-stage" hidden></div>
        </div>
        <div class="planner-side" id="planner-side"></div>
      </div>
    </div>`;
    document.body.appendChild(modal);
    bindEditorSnap(modal, "planner");
    bindCommonStage("planner-common", () => plannerNode(), () => plannerCommit(true));
    bindCommonDrag("planner-side", () => plannerNode(), () => plannerCommit(true));
    modal.addEventListener("click", (e) => {
      if (e.target === modal) closePlanner();
    });
    $("planner-close")?.addEventListener("click", () => closePlanner());
    $("planner-common-toggle")?.addEventListener("click", () => {
      if (!session.planner) return;
      session.planner.view = session.planner.view === COMMON_VIEW ? "" : COMMON_VIEW;
      const menu = $("planner-layout-menu");
      if (menu) menu.hidden = true;
      $("planner-layout-trigger")?.setAttribute("aria-expanded", "false");
      plannerCommit(true);
    });
    $("planner-layout-trigger")?.addEventListener("click", (e) => {
      e.stopPropagation();
      const menu = $("planner-layout-menu");
      if (!menu) return;
      const opening = menu.hidden;
      menu.hidden = !opening;
      $("planner-layout-trigger")?.setAttribute("aria-expanded", String(opening));
    });
    $("planner-layout-menu")?.addEventListener("click", (e) => {
      const option = e.target.closest("[data-planner-layout-choice]");
      if (!option) return;
      const node = plannerNode();
      if (!node) return;
      const value = option.dataset.plannerLayoutChoice;
      if (value === COMMON_VIEW) session.planner.view = COMMON_VIEW;
      else {
        session.planner.view = "";
        if (value === "__new") {
          const created = plannerAddLayout(node);
          if (!created) {
            api?.toast?.("Достигнут лимит планировок");
            return;
          }
        } else plannerUseLayout(node, value);
      }
      $("planner-layout-menu").hidden = true;
      $("planner-layout-trigger")?.setAttribute("aria-expanded", "false");
      if (session.planner) session.planner.sel = null;
      plannerCommit(true);
    });
    $("planner-modal")?.addEventListener("click", (e) => {
      if (e.target.closest("#planner-layout-control")) return;
      const menu = $("planner-layout-menu");
      if (menu) menu.hidden = true;
      $("planner-layout-trigger")?.setAttribute("aria-expanded", "false");
    });
    $("planner-title")?.addEventListener("input", (e) => {
      const node = plannerNode();
      if (!node || !session.planner) return;
      if (session.planner.view === COMMON_VIEW) {
        const row = (node.commons || []).find((item) => item.id === session.planner.commonId);
        if (row) row.name = String(e.target.value || "").trim().slice(0, 48);
        session.planner.touched = true;
        return;
      }
      const layout = plannerActive(node);
      if (!layout) return;
      layout.name = String(e.target.value || "").trim().slice(0, 48);
      const index = Math.max(0, (node.layouts || []).indexOf(layout));
      const shownName = plannerLayoutName(layout, index);
      const picker = $("planner-layout-trigger");
      const menuItem = $("planner-layout-menu")?.querySelector(`[data-planner-layout-choice="${cssEsc(layout.id)}"]`);
      if (picker) picker.textContent = shownName;
      if (menuItem) menuItem.textContent = shownName;
      session.planner.touched = true;
    });
    $("planner-title")?.addEventListener("change", (e) => {
      const node = plannerNode();
      if (session.planner?.view === COMMON_VIEW) {
        const row = (node?.commons || []).find((item) => item.id === session.planner.commonId);
        if (row) {
          row.name = String(e.target.value || "").trim().slice(0, 48) || "Итог";
          e.target.value = row.name;
        }
        plannerCommit(false);
        return;
      }
      const layout = node && plannerActive(node);
      if (!layout) return;
      const index = Math.max(0, (node.layouts || []).indexOf(layout));
      layout.name = plannerLayoutName(layout, index);
      e.target.value = layout.name;
      if (session.planner) session.planner.touched = false;
      plannerCommit(false);
    });
    $("planner-copy")?.addEventListener("click", () => {
      const node = plannerNode();
      const layout = node && plannerActive(node);
      if (!layout) return;
      editorClip = JSON.parse(JSON.stringify({
        kind: "planner",
        name: layout.name,
        color: layout.color,
        height: layout.height,
        heightOut: !!layout.heightOut,
        points: layout.points,
        outs: layout.outs,
      }));
      const paste = $("planner-paste");
      if (paste) paste.hidden = false;
      showCopied($("planner-copy"));
    });
    $("planner-paste")?.addEventListener("click", () => plannerPasteLayout());
    $("planner-make-rect")?.addEventListener("click", () => plannerAskRect());
    $("planner-add-corner")?.addEventListener("click", () => {
      const node = plannerNode();
      const wall = node && plannerSelWall(node);
      if (!node || !wall) return;
      const id = plannerInsertCorner(node, wall.id);
      if (!id) return;
      session.planner.sel = { kind: "point", id };
      plannerCommit(true);
    });
    $("planner-del-corner")?.addEventListener("click", () => plannerDeleteSelected());
    $("planner-height")?.addEventListener("input", (e) => {
      const node = plannerNode();
      const value = plannerDraft(e.target.value);
      if (!node || value == null) return;
      const graph = activeBlueprint() ? computeGraph(activeBlueprint()) : null;
      const incomingHeight = graph?.values?.[`${node.id}:height-in`];
      const linkedHeight = (activeBlueprint()?.links || []).some((link) => link.to === node.id && link.toPort === "height-in");
      if (linkedHeight && Number.isFinite(incomingHeight)) return;
      node.height = plannerRound(plannerClamp(value, 0.2, 30));
      plannerCommit(false);
    });
    const liveSize = () => {
      const node = plannerNode();
      if (!node || !plannerRect(node.points)) return;
      const w = plannerDraft($("planner-width")?.value);
      const d = plannerDraft($("planner-depth")?.value);
      if (w == null || d == null) return;
      plannerSetRect(node, w, d);
      plannerCommit(false);
    };
    $("planner-width")?.addEventListener("input", liveSize);
    $("planner-depth")?.addEventListener("input", liveSize);
    $("planner-side")?.addEventListener("input", (e) => {
      const node = plannerNode();
      if (!node) return;
      if (handleCommonInput(e, node)) return;
      if (e.target.matches("[data-planner-height-in-on]")) {
        node.heightInputEnabled = !!e.target.checked;
        if (!node.heightInputEnabled) {
          const bp = activeBlueprint();
          if (bp) bp.links = (bp.links || []).filter((link) => !(link.to === node.id && link.toPort === "height-in"));
        }
        plannerCommit(true);
        return;
      }
      if (e.target.matches("[data-planner-height-on]")) {
        const linked = linkedFromPorts(node.id, activeBlueprint()?.links || []);
        const heightId = plannerPort(plannerActive(node), "height");
        if (linked.has(heightId)) {
          e.target.checked = true;
          return;
        }
        node.heightOut = !!e.target.checked;
        const layout = plannerActive(node);
        if (layout) layout.heightOut = node.heightOut;
        plannerCommit(false);
        return;
      }
      const on = e.target.dataset?.plannerOn;
      if (on) {
        const out = (node.outs || []).find((item) => item.id === on);
        const linked = linkedFromPorts(node.id, activeBlueprint()?.links || []);
        if (!out || linked.has(on)) {
          e.target.checked = true;
          return;
        }
        out.on = !!e.target.checked;
        plannerCommit(false);
        return;
      }
      const nameId = e.target.dataset?.plannerName;
      if (nameId) {
        const out = (node.outs || []).find((item) => item.id === nameId);
        if (!out) return;
        const text = String(e.target.value || "").trim();
        out.name = plannerAutoName(text) ? "" : text.slice(0, 48);
        session.planner.touched = true;
        return;
      }
      const sumName = e.target.dataset?.plannerSumName;
      if (sumName) {
        const out = (node.outs || []).find((item) => item.id === sumName);
        if (!out) return;
        out.name = String(e.target.value || "").trim().slice(0, 48) || "Сумма";
        session.planner.touched = true;
        return;
      }
      const lenId = e.target.dataset?.plannerLen;
      if (lenId) {
        const value = plannerDraft(e.target.value);
        if (value == null) return;
        plannerSetLength(node, lenId, value);
        plannerCommit(false);
        return;
      }
      const sumId = e.target.dataset?.plannerPart;
      if (sumId) {
        const out = (node.outs || []).find((item) => item.id === sumId && item.kind === "sum");
        if (!out) return;
        const part = e.target.dataset.part || "";
        const parts = new Set(out.parts || []);
        if (e.target.checked) parts.add(part);
        else parts.delete(part);
        const order = ["floor"].concat(plannerWalls(node).map((wall) => wall.id));
        out.parts = order.filter((id) => parts.has(id));
        plannerCommit(false);
      }
    });
    $("planner-side")?.addEventListener("change", (e) => {
      const node = plannerNode();
      if (!node) return;
      if (e.target?.dataset?.commonName || e.target?.dataset?.commonInputName) {
        plannerCommit(false);
        return;
      }
      if (handleCommonChange(e, node)) {
        plannerCommit(!!e.target?.dataset?.commonOn);
        return;
      }
      const pogonazhId = e.target.dataset?.plannerPogonazh;
      if (pogonazhId) {
        const out = (node.outs || []).find((item) => item.id === pogonazhId && item.kind === "wall");
        if (!out) return;
        out.pogonazh = e.target.checked;
        plannerCommit(false);
        return;
      }
      const axisId = e.target.dataset?.plannerAxis;
      if (axisId) {
        const out = (node.outs || []).find((item) => item.id === axisId && item.kind === "wall");
        if (!out) return;
        out.pogonazhAxis = e.target.checked ? "length" : "height";
        plannerCommit(false);
        return;
      }
      if (e.target.dataset?.plannerName || e.target.dataset?.plannerSumName) {
        if (session.planner) session.planner.touched = false;
        plannerCommit(false);
      }
    });
    $("planner-side")?.addEventListener("click", (e) => {
      const node = plannerNode();
      if (!node || !session.planner) return;
      const hit = handleCommonClick(e, node);
      if (hit === "stay") return;
      if (hit) {
        plannerCommit(true);
        return;
      }
      const add = e.target.closest("[data-planner-add-sum]");
      if (add) {
        if ((node.outs || []).filter((item) => item.kind === "sum").length >= PLANNER_MAX_SUMS) return;
        const names = new Set((node.outs || []).filter((item) => item.kind === "sum").map((item) => item.name));
        let name = "Сумма";
        let n = 2;
        while (names.has(name)) {
          name = `Сумма ${n}`;
          n += 1;
        }
        node.outs.push({ id: uid(), kind: "sum", name, on: true, parts: [] });
        plannerCommit(true);
        return;
      }
      const del = e.target.closest("[data-planner-del-sum]");
      if (del) {
        const id = del.dataset.plannerDelSum;
        node.outs = (node.outs || []).filter((item) => item.id !== id);
        plannerDropPorts(node, [id]);
        plannerCommit(true);
        return;
      }
      const all = e.target.closest("[data-planner-sum-walls]");
      if (all) {
        const out = (node.outs || []).find((item) => item.id === all.dataset.plannerSumWalls);
        if (!out) return;
        const walls = plannerWalls(node).map((wall) => wall.id);
        const floor = (out.parts || []).includes("floor") ? ["floor"] : [];
        out.parts = floor.concat(walls);
        plannerCommit(true);
        return;
      }
      const clear = e.target.closest("[data-planner-sum-clear]");
      if (clear) {
        const out = (node.outs || []).find((item) => item.id === clear.dataset.plannerSumClear);
        if (!out) return;
        out.parts = [];
        plannerCommit(true);
        return;
      }
      const row = e.target.closest(".planner-metric[data-planner-row]");
      if (!row || e.target.closest("button, .planner-on, .planner-axis-switch")) return;
      const id = row.dataset.plannerRow || "";
      if (!id.startsWith("w:")) return;
      plannerSelect({ kind: "wall", id }, false);
    });
    $("planner-side")?.addEventListener("focusin", (e) => {
      const row = e.target.closest(".planner-metric[data-planner-row]");
      const id = row?.dataset.plannerRow || "";
      if (!id.startsWith("w:")) return;
      plannerSelect({ kind: "wall", id }, false);
    });
    const plan = $("planner-plan");
    $("planner-mini-toggle")?.addEventListener("click", () => {
      if (!session.planner) return;
      session.planner.miniHidden = !session.planner.miniHidden;
      plannerMini();
    });
    $("planner-minimap")?.addEventListener("pointerdown", (e) => {
      const node = plannerNode();
      const map = session.planner?.mini;
      const mini = $("planner-minimap");
      if (!node || !map || !mini || !session.planner) return;
      const place = (ev) => {
        const rect = mini.getBoundingClientRect();
        const sx = ((ev.clientX - rect.left) / rect.width) * map.w;
        const sy = ((ev.clientY - rect.top) / rect.height) * map.h;
        const worldX = (sx - map.ox) / map.scale;
        const worldY = (sy - map.oy) / map.scale;
        const plan = $("planner-plan");
        const fit = plannerFit(plan, node.points);
        const cam = plannerCam();
        const k = cam.k || 1;
        const w = plan.clientWidth;
        const h = plan.clientHeight;
        cam.x = w / 2 - worldX * fit.scale * k - ((fit.ox - w / 2) * k + w / 2);
        cam.y = h / 2 - worldY * fit.scale * k - ((fit.oy - h / 2) * k + h / 2);
        plannerDraw();
      };
      place(e);
      mini.setPointerCapture(e.pointerId);
      const move = (ev) => place(ev);
      const up = () => {
        mini.removeEventListener("pointermove", move);
        mini.removeEventListener("pointerup", up);
      };
      mini.addEventListener("pointermove", move);
      mini.addEventListener("pointerup", up);
    });
    plan?.addEventListener("wheel", (e) => {
      const node = plannerNode();
      if (!node || !session.planner) return;
      e.preventDefault();
      const cam = plannerCam();
      const rect = plan.getBoundingClientRect();
      const sx = e.clientX - rect.left;
      const sy = e.clientY - rect.top;
      const world = plannerView(plan, node.points).from(sx, sy);
      cam.k = Math.max(0.2, Math.min(12, cam.k * (e.deltaY > 0 ? 1 / 1.12 : 1.12)));
      const fit = plannerFit(plan, node.points);
      const k = cam.k;
      cam.x = sx - ((fit.ox - rect.width / 2) * k + rect.width / 2) - world.x * fit.scale * k;
      cam.y = sy - ((fit.oy - rect.height / 2) * k + rect.height / 2) - world.y * fit.scale * k;
      plannerDraw();
    }, { passive: false });
    plan?.addEventListener("pointerdown", (e) => {
      if (e.button !== 0 && e.button !== 1) return;
      const node = plannerNode();
      if (!node || !session.planner) return;
      const hit = plannerHit(plan, node, e.clientX, e.clientY);
      const cam = plannerCam();
      if (e.button === 1 || (!hit.pointId && !hit.wallId)) {
        session.planner.viewLock = null;
        session.planner.drag = { pan: true, x: e.clientX, y: e.clientY, ox: cam.x, oy: cam.y };
        plan.setPointerCapture(e.pointerId);
        return;
      }
      if (e.button !== 0) return;
      session.planner.viewLock = plannerView(plan, node.points);
      if (hit.pointId) {
        const point = node.points.find((p) => p.id === hit.pointId);
        session.planner.drag = {
          id: hit.pointId,
          x: e.clientX,
          y: e.clientY,
          ox: point?.x || 0,
          oy: point?.y || 0,
          moved: false,
        };
        session.planner.sel = { kind: "point", id: hit.pointId };
      } else if (hit.wallId) {
        session.planner.drag = null;
        session.planner.sel = { kind: "wall", id: hit.wallId };
      } else session.planner.drag = null;
      plan.setPointerCapture(e.pointerId);
      plannerDraw();
    });
    plan?.addEventListener("pointermove", (e) => {
      const node = plannerNode();
      const drag = session.planner?.drag;
      if (drag?.pan && session.planner) {
        const cam = plannerCam();
        cam.x = drag.ox + (e.clientX - drag.x);
        cam.y = drag.oy + (e.clientY - drag.y);
        plannerDraw();
        return;
      }
      if (!node || !drag) {
        const hit = node ? plannerHit(plan, node, e.clientX, e.clientY) : null;
        if (plan) plan.style.cursor = hit?.pointId ? "grab" : hit?.wallId ? "pointer" : "default";
        return;
      }
      if (!drag.moved && Math.hypot(e.clientX - drag.x, e.clientY - drag.y) < 4) return;
      drag.moved = true;
      const view = session.planner.viewLock || plannerView(plan, node.points);
      const rect = plan.getBoundingClientRect();
      const world = view.from(e.clientX - rect.left, e.clientY - rect.top);
      const next = plannerSnap(node, drag.id, world.x, world.y, e.shiftKey, { x: drag.ox, y: drag.oy });
      if (!next) return;
      const point = node.points.find((p) => p.id === drag.id);
      if (!point) return;
      point.x = next.x;
      point.y = next.y;
      plannerDraw();
    });
    const endDrag = () => {
      const drag = session.planner?.drag;
      if (!session.planner) return;
      session.planner.drag = null;
      session.planner.viewLock = null;
      if (drag?.pan) plannerDraw();
      else if (drag?.moved) plannerCommit(false);
      else plannerDraw();
    };
    plan?.addEventListener("pointerup", endDrag);
    plan?.addEventListener("pointercancel", endDrag);
    plan?.addEventListener("dblclick", (e) => {
      const node = plannerNode();
      if (!node || node.points.length >= PLANNER_MAX_PTS) return;
      const hit = plannerHit(plan, node, e.clientX, e.clientY);
      if (!hit.wallId) return;
      const id = plannerInsertCorner(node, hit.wallId, hit.world);
      if (!id) return;
      session.planner.sel = { kind: "point", id };
      plannerCommit(true);
    });
    plan?.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      const node = plannerNode();
      if (!node || !session.planner) return;
      const hit = plannerHit(plan, node, e.clientX, e.clientY);
      if (!hit.pointId && !hit.wallId) {
        plannerHideNudge();
        plannerDraw();
        return;
      }
      session.planner.sel = hit.pointId ? { kind: "point", id: hit.pointId } : { kind: "wall", id: hit.wallId };
      session.planner.nudge = {
        kind: hit.pointId ? "point" : "wall",
        id: hit.pointId || hit.wallId,
        dir: "",
      };
      const box = document.querySelector("#planner-nudge .planner-nudge-box");
      const input = $("planner-nudge-input");
      if (box) {
        box.hidden = true;
        box.classList.remove("is-bad");
      }
      if (input) input.value = "";
      plannerDraw();
    });
    const nudge = $("planner-nudge");
    nudge?.addEventListener("contextmenu", (e) => e.preventDefault());
    nudge?.addEventListener("pointerdown", (e) => e.stopPropagation());
    nudge?.addEventListener("click", (e) => {
      const dir = e.target.closest("[data-dir]")?.dataset.dir || "";
      const current = session.planner?.nudge;
      if (!dir || !current || !PLANNER_NUDGE_DIRS[dir]) return;
      current.dir = dir;
      const box = nudge.querySelector(".planner-nudge-box");
      if (box) {
        box.hidden = false;
        box.classList.remove("is-bad");
      }
      plannerPlaceNudge();
      const input = $("planner-nudge-input");
      input?.focus();
      input?.select();
    });
    nudge?.querySelector("form")?.addEventListener("submit", (e) => {
      e.preventDefault();
      plannerNudgeSubmit();
    });
    modal.addEventListener("pointerdown", (e) => {
      if (!session.planner?.nudge || e.target.closest("#planner-nudge")) return;
      plannerHideNudge();
    });
    unfoldHit(modal);
    if (window.ResizeObserver) {
      const stage = modal.querySelector(".planner-stage");
      if (stage) new ResizeObserver(() => {
        if (session.planner?.id && modal.classList.contains("open") && !session.planner.drag) plannerDraw();
      }).observe(stage);
    }
  }

  function unfoldHit(modal) {
    const unfold = modal.querySelector("#planner-unfold");
    unfold?.addEventListener("pointerdown", (e) => {
      const node = plannerNode();
      if (!node || !session.planner || e.button !== 0) return;
      const rect = unfold.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      const hit = (session.planner.hits || []).find((item) => x >= item.x && x <= item.x + item.w && y >= item.y && y <= item.y + item.h);
      if (!hit) return;
      plannerSelect({ kind: "wall", id: hit.id }, true);
    });
  }

  function plannerDeleteSelected() {
    const node = plannerNode();
    const sel = session.planner?.sel;
    if (!node || sel?.kind !== "point") return;
    if (!plannerDeleteCorner(node, sel.id)) return;
    session.planner.sel = null;
    plannerCommit(true);
  }

  async function plannerAskRect() {
    const node = plannerNode();
    if (!node || plannerRect(node.points)) return;
    const ok = api?.confirm
      ? await api.confirm({
          title: "Сделать прямоугольником?",
          text: "Текущий план заменится прямоугольником с шириной и глубиной из полей. Лишние углы пропадут.",
          ok: "Заменить",
          danger: true,
        })
      : true;
    if (!ok || !plannerNode()) return;
    plannerMakeRect(node, plannerDraft($("planner-width")?.value) ?? 4, plannerDraft($("planner-depth")?.value) ?? 3);
    if (session.planner) session.planner.sel = null;
    plannerCommit(true);
  }

  function openPlanner(nodeId) {
    const bp = activeBlueprint();
    const node = bp?.nodes.find((item) => item.id === nodeId && item.type === "planner");
    if (!node) return;
    ensurePlannerModal();
    ensurePlanner(node);
    session.planner = { id: nodeId, sel: null, drag: null, viewLock: null, hits: [], touched: false, nudge: null, snapEnabled: true, snapStep: EDITOR_SNAP_DEFAULT };
    plannerHideNudge();
    session.selected = nodeId;
    hidePortMenu();
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
    $("planner-modal")?.classList.add("open");
    editorSnapRefresh("planner");
    editorBegin();
    requestAnimationFrame(() => plannerFill());
  }

  function closePlanner() {
    const node = plannerNode();
    if (node) node.name = plannerName(node);
    editorEnd();
    plannerHideNudge();
    session.planner = null;
    $("planner-modal")?.classList.remove("open");
    if (api?.view?.() === "calculator") render();
  }

