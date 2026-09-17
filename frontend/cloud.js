(() => {
  "use strict";

  const TAU = Math.PI * 2;
  const GOLDEN = 2.399963229728653;
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const lerp = (a, b, t) => a + (b - a) * t;
  const easeOut = (t) => 1 - (1 - t) ** 4;

  const hash = (text) => {
    let h = 2166136261;
    const s = String(text);
    for (let i = 0; i < s.length; i += 1) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return h >>> 0;
  };

  const jitter = (id, salt = 0) => (hash(`${id}:${salt}`) / 4294967295) * 2 - 1;

  const hexRgb = (hex) => {
    const raw = String(hex || "#64748b").replace("#", "");
    const value = raw.length === 3 ? raw.split("").map((c) => c + c).join("") : raw;
    const n = Number.parseInt(value, 16);
    if (!Number.isFinite(n)) return [100, 116, 139];
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  };

  const rgbCss = (rgb, alpha) => (alpha == null
    ? `rgb(${rgb[0]},${rgb[1]},${rgb[2]})`
    : `rgba(${rgb[0]},${rgb[1]},${rgb[2]},${alpha})`);

  const hexToRgba = (hex, alpha) => rgbCss(hexRgb(hex), alpha);

  const mixRgb = (a, b, t) => [
    Math.round(a[0] + (b[0] - a[0]) * t),
    Math.round(a[1] + (b[1] - a[1]) * t),
    Math.round(a[2] + (b[2] - a[2]) * t),
  ];

  function heatRgb(t, dark) {
    const x = clamp(t, 0, 1);
    const stops = dark
      ? [[0, [56, 189, 248]], [0.32, [45, 212, 191]], [0.55, [250, 204, 21]], [0.78, [251, 146, 60]], [1, [248, 113, 113]]]
      : [[0, [2, 132, 199]], [0.28, [13, 148, 136]], [0.52, [217, 119, 6]], [0.74, [234, 88, 12]], [1, [185, 28, 28]]];
    for (let i = 1; i < stops.length; i += 1) {
      if (x <= stops[i][0]) {
        const span = stops[i][0] - stops[i - 1][0] || 1;
        return mixRgb(stops[i - 1][1], stops[i][1], (x - stops[i - 1][0]) / span);
      }
    }
    return stops[stops.length - 1][1];
  }

  function heatTone(debt, peak) {
    return Math.log1p(Math.max(0, debt)) / Math.log1p(Math.max(peak, 0.01));
  }

  function compactMoney(value) {
    const n = Number(value) || 0;
    const abs = Math.abs(n);
    const sign = n < 0 ? "−" : "";
    if (abs >= 1_000_000) {
      const v = abs / 1_000_000;
      return `${sign}${v >= 10 ? v.toFixed(0) : v.toFixed(1).replace(".", ",")} млн`;
    }
    if (abs >= 10_000) {
      const v = abs / 1000;
      return `${sign}${v >= 100 ? v.toFixed(0) : v.toFixed(1).replace(".", ",")} тыс`;
    }
    return `${sign}${Math.round(abs).toLocaleString("ru-RU")}`;
  }

  function convexHull(points) {
    const pts = points.slice().sort((a, b) => a.x - b.x || a.y - b.y);
    if (pts.length < 3) return pts;
    const cross = (o, a, b) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
    const lower = [];
    const upper = [];
    pts.forEach((p) => {
      while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop();
      lower.push(p);
    });
    for (let i = pts.length - 1; i >= 0; i -= 1) {
      const p = pts[i];
      while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop();
      upper.push(p);
    }
    lower.pop();
    upper.pop();
    return lower.concat(upper);
  }

  function inflateHull(points, pad) {
    if (points.length < 2) return points;
    const cx = points.reduce((s, p) => s + p.x, 0) / points.length;
    const cy = points.reduce((s, p) => s + p.y, 0) / points.length;
    return points.map((p) => {
      const dx = p.x - cx;
      const dy = p.y - cy;
      const d = Math.hypot(dx, dy) || 1;
      return { x: p.x + (dx / d) * pad, y: p.y + (dy / d) * pad };
    });
  }

  function organicPath(ctx, points) {
    if (!points.length) return;
    if (points.length === 1) {
      ctx.arc(points[0].x, points[0].y, 28, 0, TAU);
      return;
    }
    const n = points.length;
    ctx.moveTo((points[0].x + points[n - 1].x) / 2, (points[0].y + points[n - 1].y) / 2);
    for (let i = 0; i < n; i += 1) {
      const curr = points[i];
      const next = points[(i + 1) % n];
      ctx.quadraticCurveTo(curr.x, curr.y, (curr.x + next.x) / 2, (curr.y + next.y) / 2);
    }
  }

  function kruskalMst(nodes) {
    if (nodes.length < 2) return [];
    const edges = [];
    for (let i = 0; i < nodes.length; i += 1) {
      for (let j = i + 1; j < nodes.length; j += 1) {
        const dx = (nodes[i].tx || 0) - (nodes[j].tx || 0);
        const dy = (nodes[i].ty || 0) - (nodes[j].ty || 0);
        edges.push({ a: nodes[i], b: nodes[j], w: dx * dx + dy * dy });
      }
    }
    edges.sort((a, b) => a.w - b.w);
    const parent = new Map(nodes.map((n) => [n.data.id, n.data.id]));
    const find = (id) => {
      let cur = id;
      while (parent.get(cur) !== cur) {
        parent.set(cur, parent.get(parent.get(cur)));
        cur = parent.get(cur);
      }
      return cur;
    };
    const out = [];
    edges.forEach((edge) => {
      const pa = find(edge.a.data.id);
      const pb = find(edge.b.data.id);
      if (pa === pb) return;
      parent.set(pa, pb);
      out.push(edge);
    });
    return out;
  }

  class SpatialGrid {
    constructor(size = 56) {
      this.size = size;
      this.cells = new Map();
    }
    clear() {
      this.cells.clear();
    }
    key(x, y) {
      return `${Math.floor(x / this.size)}:${Math.floor(y / this.size)}`;
    }
    add(node) {
      const key = this.key(node.x, node.y);
      if (!this.cells.has(key)) this.cells.set(key, []);
      this.cells.get(key).push(node);
    }
    near(x, y, range = 1) {
      const cx = Math.floor(x / this.size);
      const cy = Math.floor(y / this.size);
      const out = [];
      for (let ix = cx - range; ix <= cx + range; ix += 1) {
        for (let iy = cy - range; iy <= cy + range; iy += 1) {
          const cell = this.cells.get(`${ix}:${iy}`);
          if (cell) out.push(...cell);
        }
      }
      return out;
    }
  }

  class OrderCloud {
    constructor(config) {
      this.canvas = config.canvas;
      this.minimap = config.minimap || null;
      this.onHover = config.onHover || (() => {});
      this.onSelect = config.onSelect || (() => {});
      this.onOpen = config.onOpen || (() => {});
      this.onTransform = config.onTransform || (() => {});
      this.ctx = this.canvas.getContext("2d", { alpha: false, desynchronized: true });
      this.miniCtx = this.minimap?.getContext("2d") || null;
      this.nodes = [];
      this.edges = [];
      this.bridges = [];
      this.nodeMap = new Map();
      this.grid = new SpatialGrid();
      this.camera = { x: 0, y: 0, zoom: 1 };
      this.zoomTarget = 1;
      this.zoomAnchor = { sx: 0, sy: 0, wx: 0, wy: 0 };
      this.camTween = null;
      this.orbitTween = null;
      this.panVel = { x: 0, y: 0 };
      this.orbit = { yaw: 0.4, pitch: 0.68, dist: 1080, focal: 920, targetX: 0, targetY: 0, targetZ: 8 };
      this.orbitVel = { yaw: 0, pitch: 0 };
      this.orbitPivot = null;
      this.spaceMix = 0;
      this.spaceTarget = 0;
      this.idleUntil = 0;
      this.options = { layout: "galaxy", labels: true, motion: true, heat: false, space3d: false, query: "" };
      this.hovered = null;
      this.selected = null;
      this.viewPinned = false;
      this.pointer = null;
      this.drag = null;
      this.pendingCapture = null;
      this.hot = new Set();
      this.matches = new Set();
      this.frame = 0;
      this.alpha = 1;
      this.lastTime = performance.now();
      this.needsFrame = true;
      this.tour = null;
      this.stars = this.makeStars(160);
      this.dust = this.makeDust(48);
      this.reducedMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
      this.bind();
      this.resizeObserver = new ResizeObserver(() => this.resize());
      this.resizeObserver.observe(this.canvas.parentElement);
      this.resize();
      this.loop = this.loop.bind(this);
      requestAnimationFrame(this.loop);
    }

    makeStars(count) {
      return Array.from({ length: count }, (_, i) => ({
        x: (hash(`sx:${i}`) / 4294967295) * 2 - 1,
        y: (hash(`sy:${i}`) / 4294967295) * 2 - 1,
        z: 0.25 + (hash(`sz:${i}`) / 4294967295) * 0.9,
        s: 0.4 + (hash(`ss:${i}`) / 4294967295) * 1.6,
        tw: hash(`st:${i}`) / 4294967295,
      }));
    }

    makeDust(count) {
      return Array.from({ length: count }, (_, i) => ({
        a: (hash(`da:${i}`) / 4294967295) * TAU,
        r: 80 + (hash(`dr:${i}`) / 4294967295) * 520,
        s: 8 + (hash(`ds:${i}`) / 4294967295) * 28,
        hue: hash(`dh:${i}`) % 2,
      }));
    }

    bind() {
      this.canvas.addEventListener("contextmenu", (e) => e.preventDefault());
      this.canvas.addEventListener("auxclick", (e) => { if (e.button === 1) e.preventDefault(); });
      this.canvas.addEventListener("mousedown", (e) => { if (e.button === 1) e.preventDefault(); });
      this.canvas.addEventListener("pointerdown", (e) => this.pointerDown(e));
      this.canvas.addEventListener("pointermove", (e) => this.pointerMove(e));
      this.canvas.addEventListener("pointerup", (e) => this.pointerUp(e));
      this.canvas.addEventListener("pointercancel", (e) => this.pointerUp(e));
      this.canvas.addEventListener("pointerleave", () => {
        if (!this.drag) this.setHover(null);
      });
      this.canvas.addEventListener("wheel", (e) => {
        e.preventDefault();
        this.stopTour();
        let dy = e.deltaY;
        if (e.deltaMode === 1) dy *= 16;
        if (e.deltaMode === 2) dy *= this.height;
        const pixels = Math.max(-140, Math.min(140, dy));
        const rect = this.canvas.getBoundingClientRect();
        const cursor = { sx: e.clientX - rect.left, sy: e.clientY - rect.top };
        const pivot = this.viewPinned && this.selected
          ? this.zoomFocusScreen()
          : this.is3d() ? this.zoomFocusScreen() : cursor;
        this.aimZoom(this.zoomTarget * Math.exp(-pixels * 0.00092), pivot.sx, pivot.sy);
      }, { passive: false });
      this.canvas.addEventListener("dblclick", (e) => {
        const node = this.pickNode(this.eventPoint(e));
        if (node) this.onOpen(node.data);
      });
      this.canvas.addEventListener("keydown", (e) => this.onKey(e));
      if (this.minimap) {
        this.minimap.style.pointerEvents = "auto";
        this.minimap.style.cursor = "pointer";
        this.minimap.addEventListener("pointerdown", (e) => this.minimapJump(e));
      }
    }

    onKey(e) {
      if (e.key === "+" || e.key === "=") {
        e.preventDefault();
        this.zoomAt(1.22);
      } else if (e.key === "-") {
        e.preventDefault();
        this.zoomAt(1 / 1.22);
      } else if (e.key.toLowerCase() === "f") {
        e.preventDefault();
        this.fit();
      } else if (e.key.toLowerCase() === "t") {
        e.preventDefault();
        this.startTour();
      } else if (e.key === "Escape") {
        if (document.fullscreenElement || document.webkitFullscreenElement) return;
        this.stopTour();
        this.select(null);
      } else if (e.key === "Enter" && this.selected) {
        e.preventDefault();
        this.onOpen(this.selected.data);
      } else if (e.key.startsWith("Arrow")) {
        e.preventDefault();
        this.walk(e.key === "ArrowRight" || e.key === "ArrowDown" ? 1 : -1);
      }
    }

    resize() {
      const rect = this.canvas.parentElement.getBoundingClientRect();
      this.width = Math.max(320, rect.width);
      this.height = Math.max(360, rect.height);
      this.dpr = Math.min(2, window.devicePixelRatio || 1);
      this.canvas.width = Math.round(this.width * this.dpr);
      this.canvas.height = Math.round(this.height * this.dpr);
      this.canvas.style.width = `${this.width}px`;
      this.canvas.style.height = `${this.height}px`;
      this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
      this.needsFrame = true;
    }

    update(graph, options = {}) {
      const previous = this.nodeMap;
      this.options = { ...this.options, ...options };
      this.nodes = (graph.nodes || []).map((data, index) => {
        const old = previous.get(data.id);
        const node = old || {
          x: jitter(data.id, 1) * 260,
          y: jitter(data.id, 2) * 190,
          z: 0,
          vx: 0,
          vy: 0,
          vz: 0,
          pinned: false,
          phase: hash(data.id) / 4294967295,
        };
        if (!Number.isFinite(node.z)) node.z = 0;
        if (!Number.isFinite(node.vz)) node.vz = 0;
        node.data = data;
        node.index = index;
        node.r = data.radius || (data.kind === "customer" ? 19 : data.kind === "order" ? 12 : 6);
        node.match = this.nodeMatches(data);
        return node;
      });
      this.nodeMap = new Map(this.nodes.map((n) => [n.data.id, n]));
      this.edges = (graph.edges || [])
        .map((edge) => ({
          ...edge,
          source: this.nodeMap.get(edge.source),
          target: this.nodeMap.get(edge.target),
        }))
        .filter((edge) => edge.source && edge.target);
      this.calculateTargets();
      this.bridges = this.buildBridges();
      this.refreshMatches();
      this.alpha = 1;
      this.spaceTarget = this.options.space3d ? 1 : 0;
      if (this.selected && !this.nodeMap.has(this.selected.data.id)) this.select(null);
      else if (this.selected) {
        this.selected = this.nodeMap.get(this.selected.data.id);
        this.buildHot();
      }
      this.needsFrame = true;
      if (!previous.size && this.nodes.length) requestAnimationFrame(() => this.fit(false));
    }

    nodeMatches(data) {
      const q = String(this.options.query || "").trim().toLocaleLowerCase("ru");
      if (!q) return false;
      return [data.label, data.customer, data.product, data.status, data.type, data.number, data.name]
        .filter(Boolean)
        .join(" ")
        .toLocaleLowerCase("ru")
        .includes(q);
    }

    refreshMatches() {
      this.matches.clear();
      const q = String(this.options.query || "").trim();
      if (!q) return;
      this.nodes.forEach((n) => {
        n.match = this.nodeMatches(n.data);
        if (n.match) this.matches.add(n.data.id);
      });
    }

    setOptions(options) {
      const layoutChanged = options.layout && options.layout !== this.options.layout;
      const queryChanged = options.query !== undefined && options.query !== this.options.query;
      const spaceChanged = options.space3d !== undefined && options.space3d !== this.options.space3d;
      this.options = { ...this.options, ...options };
      if (layoutChanged) {
        this.calculateTargets();
        this.bridges = this.buildBridges();
        this.nodes.forEach((n) => {
          n.pinned = false;
        });
        this.alpha = 1;
      }
      if (queryChanged) this.refreshMatches();
      if (spaceChanged) this.setSpace3d(!!this.options.space3d);
      this.needsFrame = true;
    }

    setSpace3d(on) {
      this.options.space3d = !!on;
      this.spaceTarget = on ? 1 : 0;
      this.idleUntil = performance.now() + 1600;
      this.orbitVel.yaw = 0;
      this.orbitVel.pitch = 0;
      this.assignDepth();
      this.needsFrame = true;
    }

    planetOrbit(star, index, planet) {
      return (star?.r || 19) + 50 + index * (34 + (planet?.r || 12) * 0.42);
    }

    moonOrbit(planet, count) {
      return (planet?.r || 10) + 15 + Math.min(18, Math.max(0, count) * 1.35);
    }

    placeMoons() {
      const kids = new Map();
      this.nodes.forEach((n) => {
        if (n.data.kind !== "line") return;
        const list = kids.get(n.data.parent) || [];
        list.push(n);
        kids.set(n.data.parent, list);
      });
      kids.forEach((group) => {
        const parent = this.nodeMap.get(group[0].data.parent);
        const ring = this.moonOrbit(parent, group.length);
        const spin = (parent?.phase || 0) * TAU;
        group.forEach((n, i) => {
          const a = (i / Math.max(1, group.length)) * TAU + spin;
          n.tx = (parent?.tx || 0) + Math.cos(a) * ring;
          n.ty = (parent?.ty || 0) + Math.sin(a) * ring;
          n.orbitR = ring;
        });
      });
    }

    layoutSolarSystems(mode) {
      const customers = this.nodes.filter((n) => n.data.kind === "customer");
      const byCustomer = new Map(customers.map((n) => [n.data.id, []]));
      this.nodes.forEach((n) => {
        if (n.data.kind === "order") byCustomer.get(n.data.parent)?.push(n);
      });
      const systems = customers.map((star) => {
        const planets = (byCustomer.get(star.data.id) || []).slice().sort((a, b) => {
          const dv = (b.data.value || 0) - (a.data.value || 0);
          return dv || String(a.data.id).localeCompare(String(b.data.id), "ru");
        });
        const last = planets.length
          ? this.planetOrbit(star, planets.length - 1, planets[planets.length - 1])
          : star.r + 40;
        return { star, planets, radius: last + 32 };
      });
      if (mode === "ring") {
        const count = Math.max(1, systems.length);
        const maxR = Math.max(40, ...systems.map((sys) => sys.radius));
        const ringR = count <= 1 ? 0 : Math.max(150, ((maxR * 2 + 72) * count) / TAU);
        systems.forEach((sys, i) => {
          const a = (i / count) * TAU - Math.PI / 2 + 0.41;
          sys.star.tx = Math.cos(a) * ringR;
          sys.star.ty = Math.sin(a) * ringR;
        });
      } else {
        let spiral = 0;
        systems.forEach((sys, i) => {
          if (i === 0) {
            sys.star.tx = 0;
            sys.star.ty = 0;
          } else {
            spiral += sys.radius + 58;
            const a = i * GOLDEN;
            sys.star.tx = Math.cos(a) * spiral;
            sys.star.ty = Math.sin(a) * spiral * 0.92;
            spiral += sys.radius * 0.06;
          }
        });
      }
      systems.forEach((sys) => {
        sys.star.systemR = sys.radius;
        const spin = (sys.star.phase || 0) * TAU;
        sys.planets.forEach((planet, oi) => {
          const orbitR = this.planetOrbit(sys.star, oi, planet);
          const a = oi * GOLDEN + spin;
          planet.tx = sys.star.tx + Math.cos(a) * orbitR;
          planet.ty = sys.star.ty + Math.sin(a) * orbitR;
          planet.orbitR = orbitR;
        });
      });
      this.placeMoons();
    }

    calculateTargets() {
      const layout = this.options.layout;
      const customers = this.nodes.filter((n) => n.data.kind === "customer");
      const orders = this.nodes.filter((n) => n.data.kind === "order");
      const lines = this.nodes.filter((n) => n.data.kind === "line");

      if (layout === "timeline") {
        const dated = orders.filter((n) => Number.isFinite(n.data.time));
        const times = dated.map((n) => n.data.time);
        const min = Math.min(...times, Date.now());
        const max = Math.max(...times, min + 86400000);
        const values = orders.map((n) => Math.log1p(Math.max(0, n.data.value || 0)));
        const maxValue = Math.max(...values, 1);
        customers.forEach((n, i) => {
          n.tx = -520;
          n.ty = (i - (customers.length - 1) / 2) * 96;
        });
        orders.forEach((n) => {
          const parent = this.nodeMap.get(n.data.parent);
          const ratio = Number.isFinite(n.data.time) ? (n.data.time - min) / (max - min || 1) : 0.15;
          n.tx = -380 + ratio * 860;
          n.ty = (parent?.ty || 0) + jitter(n.data.id, 7) * 28;
        });
        this.placeMoons();
        this.timeline = { min, max, maxValue };
        this.assignDepth();
        return;
      }

      if (layout === "orbit") {
        this.layoutSolarSystems("ring");
        this.assignDepth();
        return;
      }

      if (layout === "constellation") {
        const types = new Map();
        lines.forEach((n) => {
          const key = n.data.type || "Без типа";
          if (!types.has(key)) types.set(key, []);
          types.get(key).push(n);
        });
        const typeList = [...types.keys()];
        const centers = new Map();
        typeList.forEach((type, i) => {
          const a = i * GOLDEN;
          const radius = typeList.length <= 1 ? 0 : 170 + Math.sqrt(i) * 140;
          centers.set(type, { x: Math.cos(a) * radius, y: Math.sin(a) * radius * 0.78 });
        });
        customers.forEach((n, i) => {
          const a = i * GOLDEN + 0.4;
          const radius = 40 + Math.sqrt(i + 1) * 90;
          n.tx = Math.cos(a) * radius;
          n.ty = Math.sin(a) * radius * 0.7;
        });
        orders.forEach((n) => {
          const parent = this.nodeMap.get(n.data.parent);
          const type = n.data.type || "Без типа";
          const c = centers.get(type) || { x: 0, y: 0 };
          n.tx = lerp(parent?.tx || 0, c.x, 0.55) + jitter(n.data.id, 3) * 36;
          n.ty = lerp(parent?.ty || 0, c.y, 0.55) + jitter(n.data.id, 4) * 36;
        });
        this.placeMoons();
        this.assignDepth();
        return;
      }

      this.layoutSolarSystems("spiral");
      this.assignDepth();
    }

    assignDepth() {
      this.nodes.forEach((n) => {
        const tilt = jitter(n.data.id, 19);
        if (n.data.kind === "customer") n.tz = 0;
        else if (n.data.kind === "order") n.tz = 5 + tilt * 7;
        else n.tz = 9 + jitter(n.data.id, 23) * 9;
      });
    }

    buildBridges() {
      const customers = this.nodes.filter((n) => n.data.kind === "customer");
      if (customers.length < 2) return [];
      const types = new Map();
      this.nodes.filter((n) => n.data.kind === "order" || n.data.kind === "line").forEach((n) => {
        const customer = n.data.customer;
        const type = n.data.type || "";
        if (!customer || !type) return;
        const set = types.get(customer) || new Set();
        set.add(type);
        types.set(customer, set);
      });
      const scored = [];
      for (let i = 0; i < customers.length; i += 1) {
        for (let j = i + 1; j < customers.length; j += 1) {
          const a = types.get(customers[i].data.customer) || new Set();
          const b = types.get(customers[j].data.customer) || new Set();
          let shared = 0;
          a.forEach((t) => {
            if (b.has(t)) shared += 1;
          });
          if (shared) scored.push({ source: customers[i], target: customers[j], weight: shared });
        }
      }
      scored.sort((a, b) => b.weight - a.weight);
      const mst = kruskalMst(customers).map((edge) => ({ source: edge.a, target: edge.b, weight: 1 }));
      return [...mst, ...scored.slice(0, 8)];
    }

    simulate(dt) {
      const step = Math.min(1.7, dt / 16.67);
      this.stepDepth(step);
      if (!this.options.motion || this.reducedMotion || this.alpha < 0.002) return;
      const alpha = this.alpha;
      this.grid.clear();
      this.nodes.forEach((n) => this.grid.add(n));

      this.nodes.forEach((n) => {
        if (n.pinned) return;
        const targetStrength = 0.014;
        n.vx += (n.tx - n.x) * targetStrength * alpha * step;
        n.vy += (n.ty - n.y) * targetStrength * alpha * step;
        this.grid.near(n.x, n.y, 1).forEach((other) => {
          if (other.index <= n.index) return;
          const related = n.data.parent === other.data.id || other.data.parent === n.data.id;
          let dx = other.x - n.x;
          let dy = other.y - n.y;
          let d2 = dx * dx + dy * dy;
          if (d2 < 0.01) {
            dx = jitter(n.data.id, other.index) * 0.25;
            dy = jitter(other.data.id, n.index) * 0.25;
            d2 = dx * dx + dy * dy;
          }
          const d = Math.sqrt(d2);
          const pad = related ? 5 : (n.data.kind === "customer" || other.data.kind === "customer" ? 18 : 8);
          const min = n.r + other.r + pad;
          if (d >= min * 1.75) return;
          const force = ((min * 1.75 - d) / Math.max(d, 1)) * 0.058 * alpha;
          const fx = dx * force;
          const fy = dy * force;
          if (!n.pinned) {
            n.vx -= fx;
            n.vy -= fy;
          }
          if (!other.pinned) {
            other.vx += fx;
            other.vy += fy;
          }
        });
      });

      this.edges.forEach((edge) => {
        const a = edge.source;
        const b = edge.target;
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const dist = Math.hypot(dx, dy) || 1;
        const ideal = Math.hypot((b.tx ?? b.x) - (a.tx ?? a.x), (b.ty ?? b.y) - (a.ty ?? a.y))
          || (edge.kind === "customer" ? 90 : 28);
        const force = (dist - ideal) * (edge.kind === "customer" ? 0.0014 : 0.0024) * alpha * step;
        const fx = (dx / dist) * force;
        const fy = (dy / dist) * force;
        if (!a.pinned) {
          a.vx += fx;
          a.vy += fy;
        }
        if (!b.pinned) {
          b.vx -= fx;
          b.vy -= fy;
        }
      });

      this.nodes.forEach((n) => {
        if (n.pinned) {
          n.vx = 0;
          n.vy = 0;
          return;
        }
        n.vx *= 0.83;
        n.vy *= 0.83;
        n.x += n.vx * step;
        n.y += n.vy * step;
      });
      this.alpha *= 0.975 ** step;
    }

    stepDepth(step) {
      this.nodes.forEach((n) => {
        const wantZ = this.spaceTarget > 0.5 ? (n.tz || 0) : 0;
        n.vz = (n.vz || 0) + (wantZ - (n.z || 0)) * 0.018 * step;
        n.vz *= 0.82;
        n.z = (n.z || 0) + n.vz * step;
      });
    }

    loop(time) {
      const dt = time - this.lastTime;
      this.lastTime = time;
      const moving = this.stepCamera(dt);
      const live = this.options.motion && !this.reducedMotion && (this.alpha > 0.002 || this.matches.size || this.edges.length);
      const heatPulse = this.options.heat && !this.reducedMotion;
      const spaceLive = Math.abs(this.spaceMix - this.spaceTarget) > 0.002 || (this.options.space3d && !this.reducedMotion);
      if (this.needsFrame || live || heatPulse || spaceLive || this.drag || this.tour || moving) {
        this.simulate(dt);
        this.draw(time);
        this.needsFrame = false;
      }
      this.frame = requestAnimationFrame(this.loop);
    }

    stepCamera(dt) {
      const step = Math.min(1.8, dt / 16.67);
      let moving = false;
      const mixGap = this.spaceTarget - this.spaceMix;
      if (Math.abs(mixGap) > 0.002) {
        const k = 1 - Math.exp(-(Math.max(dt, 0) / 1000) / 0.28);
        this.spaceMix += mixGap * k;
        moving = true;
      } else {
        this.spaceMix = this.spaceTarget;
      }
      if (this.drag) {
        this.camTween = null;
        this.orbitTween = null;
      } else if (this.orbitTween) {
        moving = this.stepOrbitTween() || moving;
      } else if (this.camTween) {
        moving = this.stepTween() || moving;
      } else {
        moving = this.easeZoom(dt) || moving;
      }
      if (!this.drag && (Math.abs(this.panVel.x) > 0.12 || Math.abs(this.panVel.y) > 0.12)) {
        this.panCamera(this.panVel.x * step, this.panVel.y * step);
        this.panVel.x *= 0.9 ** step;
        this.panVel.y *= 0.9 ** step;
        this.syncZoomAnchor();
        this.transformChanged();
        moving = true;
      }
      if (this.spaceMix > 0.01 && !this.drag) {
        if (Math.abs(this.orbitVel.yaw) > 0.00005 || Math.abs(this.orbitVel.pitch) > 0.00005) {
          this.orbit.yaw += this.orbitVel.yaw * step;
          this.orbit.pitch = clamp(this.orbit.pitch + this.orbitVel.pitch * step, 0.22, 1.08);
          this.orbitVel.yaw *= 0.94 ** step;
          this.orbitVel.pitch *= 0.94 ** step;
          moving = true;
        } else if (this.options.space3d && !this.reducedMotion && performance.now() > this.idleUntil) {
          this.orbit.yaw += 0.00115 * step;
          moving = true;
        }
      }
      return moving;
    }

    stepTween() {
      const tween = this.camTween;
      if (!tween) return false;
      const raw = tween.duration <= 0 ? 1 : clamp((performance.now() - tween.start) / tween.duration, 0, 1);
      const p = easeOut(raw);
      this.camera.x = tween.from.x + (tween.to.x - tween.from.x) * p;
      this.camera.y = tween.from.y + (tween.to.y - tween.from.y) * p;
      this.camera.zoom = tween.from.zoom + (tween.to.zoom - tween.from.zoom) * p;
      this.zoomTarget = tween.to.zoom;
      this.transformChanged();
      if (raw >= 1) this.camTween = null;
      return raw < 1;
    }

    stepOrbitTween() {
      const tween = this.orbitTween;
      if (!tween) return false;
      const raw = tween.duration <= 0 ? 1 : clamp((performance.now() - tween.start) / tween.duration, 0, 1);
      const p = raw < 0.5 ? 2 * raw * raw : 1 - ((-2 * raw + 2) ** 2) / 2;
      this.orbit.yaw = tween.from.yaw + (tween.to.yaw - tween.from.yaw) * p;
      this.orbit.pitch = tween.from.pitch + (tween.to.pitch - tween.from.pitch) * p;
      this.camera.zoom = tween.from.zoom + (tween.to.zoom - tween.from.zoom) * p;
      this.camera.x = tween.from.x + (tween.to.x - tween.from.x) * p;
      this.camera.y = tween.from.y + (tween.to.y - tween.from.y) * p;
      if (tween.from.tx != null && tween.to.tx != null) {
        this.orbit.targetX = tween.from.tx + (tween.to.tx - tween.from.tx) * p;
        this.orbit.targetY = tween.from.ty + (tween.to.ty - tween.from.ty) * p;
        this.orbit.targetZ = tween.from.tz + (tween.to.tz - tween.from.tz) * p;
      }
      this.zoomTarget = tween.to.zoom;
      this.transformChanged();
      if (raw >= 1) this.orbitTween = null;
      return raw < 1;
    }

    easeZoom(dt) {
      const from = this.camera.zoom;
      const to = this.zoomTarget;
      if (Math.abs(to - from) < 0.00035) {
        if (from !== to) this.applyZoom(to);
        return false;
      }
      const tau = this.reducedMotion ? 0.012 : 0.08;
      const k = 1 - Math.exp(-(Math.max(dt, 0) / 1000) / tau);
      this.applyZoom(from + (to - from) * k);
      return true;
    }

    applyZoom(next) {
      const zoom = clamp(next, 0.14, 5.4);
      const anchor = this.zoomAnchor;
      this.camera.zoom = zoom;
      this.camera.x = anchor.sx - this.width / 2 - anchor.wx * zoom;
      this.camera.y = anchor.sy - this.height / 2 - anchor.wy * zoom;
      this.transformChanged();
    }

    zoomFocusScreen() {
      if (this.viewPinned && this.selected) {
        const p = this.view(this.selected);
        if (p.visible && Number.isFinite(p.x) && Number.isFinite(p.y)) return { sx: p.x, sy: p.y };
      }
      if (this.is3d()) {
        const p = this.project(this.orbit.targetX, this.orbit.targetY, this.orbit.targetZ);
        if (p.visible && Number.isFinite(p.x) && Number.isFinite(p.y)) return { sx: p.x, sy: p.y };
      }
      return { sx: this.width / 2, sy: this.height / 2 };
    }

    syncZoomAnchor() {
      const zoom = this.camera.zoom || 1;
      const sx = this.zoomAnchor?.sx ?? this.width / 2;
      const sy = this.zoomAnchor?.sy ?? this.height / 2;
      this.zoomAnchor = {
        sx,
        sy,
        wx: (sx - this.width / 2 - this.camera.x) / zoom,
        wy: (sy - this.height / 2 - this.camera.y) / zoom,
      };
    }

    settleZoom() {
      this.camTween = null;
      const target = clamp(this.zoomTarget, 0.14, 5.4);
      if (Math.abs((this.camera.zoom || 1) - target) > 0.0002) this.applyZoom(target);
      this.zoomTarget = target;
    }

    aimZoom(target, sx, sy) {
      this.camTween = null;
      this.orbitTween = null;
      const zoom = this.camera.zoom || 1;
      const pivot = sx == null || sy == null ? this.zoomFocusScreen() : { sx, sy };
      this.zoomTarget = clamp(target, 0.14, 5.4);
      this.zoomAnchor = {
        sx: pivot.sx,
        sy: pivot.sy,
        wx: (pivot.sx - this.width / 2 - this.camera.x) / zoom,
        wy: (pivot.sy - this.height / 2 - this.camera.y) / zoom,
      };
      this.needsFrame = true;
    }

    theme() {
      const dark = document.documentElement.getAttribute("data-theme") === "dark";
      return dark
        ? {
          dark: true,
          bg: "#050b14",
          bg2: "#0a1626",
          nebula: ["rgba(15,118,110,0.16)", "rgba(37,99,235,0.12)", "rgba(124,58,237,0.1)"],
          grid: "rgba(148,163,184,.055)",
          ink: "#e2e8f0",
          muted: "#8b9bb0",
          edge: "rgba(148,163,184,.18)",
          hull: "rgba(20,184,166,0.07)",
        }
        : {
          dark: false,
          bg: "#f4f8fb",
          bg2: "#e8f2f4",
          nebula: ["rgba(15,118,110,0.08)", "rgba(37,99,235,0.06)", "rgba(201,162,39,0.05)"],
          grid: "rgba(15,118,110,.055)",
          ink: "#0f172a",
          muted: "#64748b",
          edge: "rgba(71,85,105,.16)",
          hull: "rgba(15,118,110,0.06)",
        };
    }

    is3d() {
      return this.spaceMix > 0.01;
    }

    cameraSpace(x, y, z = 0) {
      const px = x - this.orbit.targetX;
      const py = y - this.orbit.targetY;
      const pz = z - this.orbit.targetZ;
      const cy = Math.cos(this.orbit.yaw);
      const sy = Math.sin(this.orbit.yaw);
      const rx = px * cy - py * sy;
      const ry = px * sy + py * cy;
      const rz = pz;
      const cp = Math.cos(this.orbit.pitch);
      const sp = Math.sin(this.orbit.pitch);
      const zoom = this.camera.zoom || 1;
      const dist = this.orbit.dist / Math.max(0.18, zoom);
      return {
        cx: rx,
        cy: -ry * cp - rz * sp,
        depth: ry * sp - rz * cp + dist,
      };
    }

    project(x, y, z = 0) {
      const mix = this.spaceMix;
      const zoom = this.camera.zoom || 1;
      const ox = this.width / 2 + this.camera.x;
      const oy = this.height / 2 + this.camera.y;
      const ortho = { x: ox + x * zoom, y: oy + y * zoom, s: zoom, depth: 900, visible: true };
      if (mix < 0.001) return ortho;
      const cam = this.cameraSpace(x, y, z);
      const near = 42;
      if (cam.depth < near) return { x: ox, y: oy, s: 0, depth: cam.depth, visible: false };
      const persp = this.orbit.focal / cam.depth;
      return {
        x: lerp(ortho.x, ox + cam.cx * persp, mix),
        y: lerp(ortho.y, oy + cam.cy * persp, mix),
        s: lerp(ortho.s, persp, mix),
        depth: cam.depth,
        visible: true,
      };
    }

    projectedOk(p) {
      if (!(p && p.visible && Number.isFinite(p.x) && Number.isFinite(p.y) && p.s > 0.05)) return false;
      if (this.spaceMix > 0.01 && p.s >= 14) return false;
      return true;
    }

    onScreen(p, pad = 0) {
      return this.projectedOk(p)
        && p.x >= -pad && p.x <= this.width + pad
        && p.y >= -pad && p.y <= this.height + pad;
    }

    cameraWorld() {
      const zoom = Math.max(0.18, this.camera.zoom || 1);
      const dist = this.orbit.dist / zoom;
      const cy = Math.cos(this.orbit.yaw);
      const sy = Math.sin(this.orbit.yaw);
      const cp = Math.cos(this.orbit.pitch);
      const sp = Math.sin(this.orbit.pitch);
      return {
        x: this.orbit.targetX - dist * sp * sy,
        y: this.orbit.targetY - dist * sp * cy,
        z: this.orbit.targetZ + dist * cp,
      };
    }

    lookFromAt(cam, target) {
      const dx = cam.x - target.x;
      const dy = cam.y - target.y;
      const dz = cam.z - target.z;
      const dist = Math.max(48, Math.hypot(dx, dy, dz) || 48);
      const zoom = Math.max(0.18, this.camera.zoom || 1);
      this.orbit.targetX = target.x;
      this.orbit.targetY = target.y;
      this.orbit.targetZ = target.z;
      this.orbit.dist = dist * zoom;
      this.orbit.pitch = clamp(Math.acos(clamp(dz / dist, -1, 1)), 0.22, 1.08);
      if (Math.hypot(dx, dy) > 1e-3) this.orbit.yaw = Math.atan2(-dx, -dy);
    }

    rotateAroundAxis(point, origin, axis, angle) {
      const len = Math.hypot(axis.x, axis.y, axis.z) || 1;
      const ux = axis.x / len;
      const uy = axis.y / len;
      const uz = axis.z / len;
      const c = Math.cos(angle);
      const s = Math.sin(angle);
      const vx = point.x - origin.x;
      const vy = point.y - origin.y;
      const vz = point.z - origin.z;
      const dot = ux * vx + uy * vy + uz * vz;
      return {
        x: origin.x + vx * c + (uy * vz - uz * vy) * s + ux * dot * (1 - c),
        y: origin.y + vy * c + (uz * vx - ux * vz) * s + uy * dot * (1 - c),
        z: origin.z + vz * c + (ux * vy - uy * vx) * s + uz * dot * (1 - c),
      };
    }

    applyOrbitAroundPivot(dx, dy, drag) {
      const pivot = drag.pivot;
      const dYaw = -dx * 0.0074;
      const dPitch = clamp(drag.pitch - dy * 0.0054, 0.22, 1.08) - drag.pitch;
      let cam = this.rotateAroundAxis(drag.cam, pivot, { x: 0, y: 0, z: 1 }, dYaw);
      let target = this.rotateAroundAxis(drag.target, pivot, { x: 0, y: 0, z: 1 }, dYaw);
      cam = this.rotateAroundAxis(cam, pivot, drag.right, dPitch);
      target = this.rotateAroundAxis(target, pivot, drag.right, dPitch);
      this.lookFromAt(cam, target);
    }

    lockOrbitTarget(x, y, z = 8) {
      this.orbit.targetX = x;
      this.orbit.targetY = y;
      this.orbit.targetZ = z;
    }

    worldAtScreenCenter() {
      const zoom = this.camera.zoom || 1;
      if (!this.is3d()) {
        return {
          x: -this.camera.x / zoom,
          y: -this.camera.y / zoom,
          z: 0,
        };
      }
      const dist = this.orbit.dist / Math.max(0.18, zoom);
      const persp = this.orbit.focal / Math.max(48, dist);
      const camCx = -this.camera.x / persp;
      const camCy = -this.camera.y / persp;
      const cp = Math.cos(this.orbit.pitch);
      const ry = Math.abs(cp) > 0.08 ? -camCy / cp : 0;
      const rx = camCx;
      const cy = Math.cos(this.orbit.yaw);
      const sy = Math.sin(this.orbit.yaw);
      return {
        x: this.orbit.targetX + rx * cy + ry * sy,
        y: this.orbit.targetY - rx * sy + ry * cy,
        z: this.orbit.targetZ,
      };
    }

    absorbScreenPanIntoOrbit() {
      if (!this.is3d()) return;
      if (Math.abs(this.camera.x) < 0.35 && Math.abs(this.camera.y) < 0.35) {
        this.camera.x = 0;
        this.camera.y = 0;
        return;
      }
      const here = this.worldAtScreenCenter();
      this.orbit.targetX = here.x;
      this.orbit.targetY = here.y;
      this.camera.x = 0;
      this.camera.y = 0;
    }

    panCamera(dx, dy) {
      if (!dx && !dy) return;
      this.viewPinned = false;
      if (this.is3d()) {
        this.absorbScreenPanIntoOrbit();
        const z = this.orbit.targetZ;
        const tx = this.orbit.targetX;
        const ty = this.orbit.targetY;
        const p0 = this.project(tx, ty, z);
        const px = this.project(tx + 1, ty, z);
        const py = this.project(tx, ty + 1, z);
        const ax = px.x - p0.x;
        const ay = px.y - p0.y;
        const bx = py.x - p0.x;
        const by = py.y - p0.y;
        const det = ax * by - ay * bx;
        let wx;
        let wy;
        if (Math.abs(det) < 1e-5) {
          const s = Math.max(0.2, p0.s || this.camera.zoom || 1);
          wx = dx / s;
          wy = dy / s;
        } else {
          wx = (dx * by - dy * bx) / det;
          wy = (dy * ax - dx * ay) / det;
        }
        this.orbit.targetX -= wx;
        this.orbit.targetY -= wy;
      } else {
        this.camera.x += dx;
        this.camera.y += dy;
      }
    }

    prepareOrbitPivot() {
      this.camTween = null;
      this.orbitTween = null;
      if (this.viewPinned && this.selected) {
        this.orbitPivot = {
          x: this.selected.x,
          y: this.selected.y,
          z: (this.selected.z || 0) * this.spaceMix || 8,
        };
        return;
      }
      this.orbitPivot = this.worldAtScreenCenter();
    }

    clipFloorLine(x0, y0, x1, y1, near = 64, far = 2400) {
      const a0 = this.cameraSpace(x0, y0, 0);
      const b0 = this.cameraSpace(x1, y1, 0);
      if ((a0.depth < near && b0.depth < near) || (a0.depth > far && b0.depth > far)) return null;
      const atDepth = (p, q, d) => {
        const denom = q.depth - p.depth;
        if (Math.abs(denom) < 1e-8) return null;
        const t = (d - p.depth) / denom;
        if (t < -1e-4 || t > 1 + 1e-4) return null;
        return {
          cx: p.cx + (q.cx - p.cx) * t,
          cy: p.cy + (q.cy - p.cy) * t,
          depth: d,
        };
      };
      let a = a0;
      let b = b0;
      if (a0.depth < near) a = atDepth(a0, b0, near);
      else if (a0.depth > far) a = atDepth(a0, b0, far);
      if (b0.depth < near) b = atDepth(b0, a0, near);
      else if (b0.depth > far) b = atDepth(b0, a0, far);
      if (!a || !b) return null;
      const ox = this.width / 2 + this.camera.x;
      const oy = this.height / 2 + this.camera.y;
      const toScreen = (p) => {
        const persp = this.orbit.focal / Math.max(near, p.depth);
        return { x: ox + p.cx * persp, y: oy + p.cy * persp };
      };
      const sa = toScreen(a);
      const sb = toScreen(b);
      if (!Number.isFinite(sa.x + sa.y + sb.x + sb.y)) return null;
      const pad = 120;
      const on = (p) => p.x >= -pad && p.x <= this.width + pad && p.y >= -pad && p.y <= this.height + pad;
      if (!on(sa) && !on(sb)) return null;
      return { a: sa, b: sb, depth: (a.depth + b.depth) * 0.5 };
    }

    view(node) {
      const p = this.project(node.x, node.y, (node.z || 0) * this.spaceMix);
      return { ...p, r: Math.max(1.4, (node.r || 6) * p.s), node };
    }

    worldDeltaFromScreen(node, dx, dy) {
      const p0 = this.project(node.x, node.y, (node.z || 0) * this.spaceMix);
      const px = this.project(node.x + 1, node.y, (node.z || 0) * this.spaceMix);
      const py = this.project(node.x, node.y + 1, (node.z || 0) * this.spaceMix);
      const ax = px.x - p0.x;
      const ay = px.y - p0.y;
      const bx = py.x - p0.x;
      const by = py.y - p0.y;
      const det = ax * by - ay * bx;
      if (Math.abs(det) < 1e-5) return { x: dx / Math.max(0.2, p0.s), y: dy / Math.max(0.2, p0.s) };
      return { x: (dx * by - dy * bx) / det, y: (dy * ax - dx * ay) / det };
    }

    draw(time) {
      const ctx = this.ctx;
      const t = this.theme();
      ctx.save();
      ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
      if (this.spaceMix > 0.004) this.drawScene3d(ctx, t, time);
      else {
        this.drawSpace(ctx, t);
        ctx.translate(this.width / 2 + this.camera.x, this.height / 2 + this.camera.y);
        ctx.scale(this.camera.zoom, this.camera.zoom);
        if (this.options.layout === "timeline") this.drawTimeline(ctx, t);
        if (this.options.layout === "constellation" || this.options.layout === "timeline") this.drawHulls(ctx, t);
        this.drawOrbitRings(ctx, t);
        if (this.options.heat) this.drawHeat(ctx, t);
        this.drawBridges(ctx, t, time);
        this.drawEdges(ctx, t, time);
        this.drawNodes(ctx, t, time);
        if (this.options.heat) this.drawHeatMarks(ctx, t, time);
      }
      ctx.restore();
      if (this.options.heat) {
        ctx.save();
        ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
        this.drawHeatCallouts(ctx, t);
        ctx.restore();
      }
      this.drawMinimap(t);
    }

    drawScene3d(ctx, theme, time) {
      this.drawSpace3d(ctx, theme);
      this.drawShadows3d(ctx, theme);
      if (this.options.heat) this.drawHeat3d(ctx, theme);
      if (this.options.layout === "constellation" || this.options.layout === "timeline") this.drawHulls3d(ctx, theme);
      this.drawOrbitRings3d(ctx, theme);
      this.drawLinks3d(ctx, theme, time);
      this.drawNodes3d(ctx, theme, time);
      if (this.options.heat) this.drawHeatMarks3d(ctx, theme, time);
    }

    drawSpace3d(ctx, theme) {
      ctx.fillStyle = theme.bg;
      ctx.fillRect(0, 0, this.width, this.height);
      const fog = ctx.createRadialGradient(this.width * 0.5, this.height * 0.42, 40, this.width * 0.5, this.height * 0.5, Math.max(this.width, this.height) * 0.72);
      fog.addColorStop(0, theme.dark ? "rgba(14, 116, 144, 0.16)" : "rgba(15, 118, 110, 0.08)");
      fog.addColorStop(0.45, theme.dark ? "rgba(37, 99, 235, 0.07)" : "rgba(37, 99, 235, 0.04)");
      fog.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = fog;
      ctx.fillRect(0, 0, this.width, this.height);
      const zoom = this.camera.zoom || 1;
      const dist = this.orbit.dist / Math.max(0.18, zoom);
      const step = clamp(dist / 13, 38, 86);
      const cells = 16;
      const gx = Math.round(this.orbit.targetX / step) * step;
      const gy = Math.round(this.orbit.targetY / step) * step;
      const nearZ = 72;
      const farZ = dist * 1.48;
      const rgb = theme.dark ? "148,163,184" : "15,118,110";
      const bands = [[], [], [], [], [], []];
      const push = (x0, y0, x1, y1) => {
        const seg = this.clipFloorLine(x0, y0, x1, y1, nearZ, farZ);
        if (!seg) return;
        const t = clamp((seg.depth - nearZ) / Math.max(120, farZ - nearZ), 0, 0.999);
        bands[Math.min(bands.length - 1, Math.floor(t * bands.length))].push(seg);
      };
      for (let i = -cells; i <= cells; i += 1) {
        const x = gx + i * step;
        const y = gy + i * step;
        for (let j = -cells; j < cells; j += 1) {
          push(x, gy + j * step, x, gy + (j + 1) * step);
          push(gx + j * step, y, gx + (j + 1) * step, y);
        }
      }
      ctx.lineWidth = 1;
      ctx.lineCap = "butt";
      bands.forEach((list, i) => {
        if (!list.length) return;
        const fade = 1 - i / bands.length;
        ctx.strokeStyle = `rgba(${rgb},${(theme.dark ? 0.22 : 0.2) * fade})`;
        ctx.beginPath();
        list.forEach((seg) => {
          ctx.moveTo(seg.a.x, seg.a.y);
          ctx.lineTo(seg.b.x, seg.b.y);
        });
        ctx.stroke();
      });
      const far = ctx.createLinearGradient(0, 0, 0, this.height * 0.38);
      far.addColorStop(0, theme.dark ? "rgba(4,11,20,0.62)" : "rgba(244,248,251,0.62)");
      far.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = far;
      ctx.fillRect(0, 0, this.width, this.height);
      const near = ctx.createLinearGradient(0, this.height * 0.78, 0, this.height);
      near.addColorStop(0, "rgba(0,0,0,0)");
      near.addColorStop(1, theme.dark ? "rgba(2,6,14,0.28)" : "rgba(15,23,42,0.06)");
      ctx.fillStyle = near;
      ctx.fillRect(0, 0, this.width, this.height);
    }

    drawShadows3d(ctx, theme) {
      if (this.spaceMix < 0.2) return;
      this.nodes.forEach((n) => {
        if (n.data.kind === "customer") return;
        if (n.data.kind === "line" && this.camera.zoom < 0.42) return;
        const foot = this.project(n.x, n.y, 0);
        if (!this.projectedOk(foot)) return;
        const r = Math.max(2.2, n.r * 0.52 * Math.min(foot.s, 3.2));
        ctx.fillStyle = theme.dark ? "rgba(0,0,0,0.24)" : "rgba(15,23,42,0.1)";
        ctx.beginPath();
        ctx.ellipse(foot.x, foot.y, r, Math.max(1.1, r * 0.36), 0, 0, TAU);
        ctx.fill();
      });
    }

    strokeWorldCircle(ctx, x, y, z, radius, color, alpha) {
      if (radius < 8 || alpha < 0.01) return;
      const steps = radius > 140 ? 56 : 40;
      ctx.beginPath();
      let started = false;
      let last = null;
      for (let i = 0; i <= steps; i += 1) {
        const a = (i / steps) * TAU;
        const p = this.project(x + Math.cos(a) * radius, y + Math.sin(a) * radius, z);
        if (!this.projectedOk(p) || (last && Math.hypot(p.x - last.x, p.y - last.y) > 160)) {
          started = false;
          last = this.projectedOk(p) ? p : null;
          if (!started && last) {
            ctx.moveTo(last.x, last.y);
            started = true;
          }
          continue;
        }
        if (!started) {
          ctx.moveTo(p.x, p.y);
          started = true;
        } else ctx.lineTo(p.x, p.y);
        last = p;
      }
      ctx.strokeStyle = hexToRgba(color, alpha);
      ctx.stroke();
    }

    drawOrbitRings3d(ctx, theme) {
      if (this.options.layout === "timeline") return;
      const zoom = this.camera.zoom;
      if (zoom < 0.2) return;
      const base = (theme.dark ? 0.18 : 0.12) * this.spaceMix;
      ctx.lineCap = "round";
      ctx.lineWidth = 1.05;
      this.nodes.forEach((n) => {
        if (n.data.kind !== "order") return;
        const parent = this.nodeMap.get(n.data.parent);
        if (!parent) return;
        const r = Math.hypot(n.x - parent.x, n.y - parent.y);
        if (r < 18) return;
        const hot = this.hot.has(n.data.id) || this.hot.has(parent.data.id);
        this.strokeWorldCircle(
          ctx,
          parent.x,
          parent.y,
          (parent.z || 0) * this.spaceMix,
          r,
          parent.data.color || n.data.color || "#64748b",
          base * (hot ? 1.6 : 0.7),
        );
      });
      if (zoom < 0.48) return;
      ctx.lineWidth = 0.9;
      this.nodes.forEach((n) => {
        if (n.data.kind !== "line") return;
        const parent = this.nodeMap.get(n.data.parent);
        if (!parent) return;
        const r = Math.hypot(n.x - parent.x, n.y - parent.y);
        if (r < 8) return;
        const hot = this.hot.has(n.data.id) || this.hot.has(parent.data.id);
        this.strokeWorldCircle(
          ctx,
          parent.x,
          parent.y,
          (parent.z || 0) * this.spaceMix,
          r,
          parent.data.color || n.data.color || "#64748b",
          base * (hot ? 1.15 : 0.42),
        );
      });
    }

    drawOrbitRings(ctx, theme) {
      if (this.options.layout === "timeline") return;
      const zoom = this.camera.zoom;
      if (zoom < 0.28) return;
      const base = theme.dark ? 0.16 : 0.11;
      ctx.lineCap = "round";
      this.nodes.forEach((n) => {
        if (n.data.kind !== "order") return;
        const parent = this.nodeMap.get(n.data.parent);
        if (!parent) return;
        const r = Math.hypot(n.x - parent.x, n.y - parent.y);
        if (r < 18) return;
        const hot = this.hot.has(n.data.id) || this.hot.has(parent.data.id);
        ctx.beginPath();
        ctx.arc(parent.x, parent.y, r, 0, TAU);
        ctx.strokeStyle = hexToRgba(parent.data.color || n.data.color || "#64748b", base * (hot ? 1.5 : 0.65));
        ctx.lineWidth = (hot ? 1.15 : 0.85) / zoom;
        ctx.stroke();
      });
      if (zoom < 0.7) return;
      this.nodes.forEach((n) => {
        if (n.data.kind !== "line") return;
        const parent = this.nodeMap.get(n.data.parent);
        if (!parent) return;
        const r = Math.hypot(n.x - parent.x, n.y - parent.y);
        if (r < 8) return;
        const hot = this.hot.has(n.data.id) || this.hot.has(parent.data.id);
        ctx.beginPath();
        ctx.arc(parent.x, parent.y, r, 0, TAU);
        ctx.strokeStyle = hexToRgba(parent.data.color || n.data.color || "#64748b", base * (hot ? 1.1 : 0.4));
        ctx.lineWidth = 0.7 / zoom;
        ctx.stroke();
      });
    }

    drawStems3d(ctx, theme) {
      if (this.spaceMix < 0.2) return;
      ctx.lineCap = "round";
      this.nodes.forEach((n) => {
        if (n.data.kind === "line" && this.camera.zoom < 0.42) return;
        const top = this.view(n);
        const foot = this.project(n.x, n.y, 0);
        if (!this.projectedOk(top) || !this.projectedOk(foot)) return;
        const alpha = (theme.dark ? 0.22 : 0.16) * this.spaceMix;
        ctx.strokeStyle = hexToRgba(n.data.color || "#64748b", alpha);
        ctx.lineWidth = n.data.kind === "customer" ? 1.6 : 1;
        ctx.beginPath();
        ctx.moveTo(foot.x, foot.y);
        ctx.lineTo(top.x, top.y);
        ctx.stroke();
        ctx.fillStyle = hexToRgba(n.data.color || "#64748b", alpha * 1.4);
        const rx = Math.min(Math.max(2, top.r * 0.55), 28);
        const ry = Math.min(Math.max(1.1, top.r * 0.22), 12);
        ctx.beginPath();
        ctx.ellipse(foot.x, foot.y, rx, ry, 0, 0, TAU);
        ctx.fill();
      });
    }

    drawHeat3d(ctx, theme) {
      const customers = this.heatGroup("customer");
      const orders = this.heatGroup("order");
      const sources = customers.length ? customers : orders;
      if (!sources.length) return;
      const peak = this.heatPeak(sources);
      const dark = !!theme.dark;
      ctx.save();
      ctx.globalCompositeOperation = dark ? "screen" : "source-over";
      sources.slice().sort((a, b) => (a.data.debt || 0) - (b.data.debt || 0)).forEach((n) => {
        const t = heatTone(n.data.debt, peak);
        const p = this.view(n);
        if (!this.onScreen(p, 80)) return;
        const rad = Math.min((70 + 150 * t) * p.s, Math.max(this.width, this.height) * 0.35);
        this.paintHeatBlob(ctx, p.x, p.y, rad, t, (dark ? 0.42 : 0.36) + 0.32 * t, dark);
      });
      ctx.restore();
    }

    drawHulls3d(ctx, theme) {
      this.clusters().forEach((group) => {
        if (group.nodes.length < 2) return;
        const pts = inflateHull(convexHull(group.nodes.map((n) => ({ x: n.x, y: n.y }))), 22)
          .map((pt) => this.project(pt.x, pt.y, 8 * this.spaceMix))
          .filter((p) => p.visible);
        if (pts.length < 2) return;
        ctx.beginPath();
        organicPath(ctx, pts);
        ctx.fillStyle = hexToRgba(group.color, theme.dark ? 0.07 : 0.05);
        ctx.fill();
        ctx.strokeStyle = hexToRgba(group.color, 0.2);
        ctx.lineWidth = 1.1;
        ctx.stroke();
      });
    }

    drawLinks3d(ctx, theme, time) {
      const selected = this.selected;
      const motion = this.options.motion && !this.reducedMotion;
      const underlay = theme.dark ? "rgba(2,6,14,0.55)" : "rgba(255,255,255,0.78)";
      const drawOne = (edge, dashed) => {
        const hot = this.edgeIsHot(edge);
        const dim = !!(selected && !hot);
        const trunk = edge.kind === "customer";
        const base = (edge.source.data && edge.source.data.color) || "#64748b";
        const color = hot ? hexToRgba(selected.data.color, 0.95) : hexToRgba(base, trunk ? 0.82 : 0.62);
        this.drawLinkProjected(ctx, edge.source, edge.target, {
          lift: dashed ? 0.18 : trunk ? 0.16 : 0.1,
          color,
          flowColor: hexToRgba(hot ? selected.data.color : base, 1),
          width: hot ? (trunk ? 3.1 : 2.4) : dashed ? 1.35 : trunk ? 2.15 : 1.55,
          underlay,
          dashed,
          flow: !dashed && motion && (!selected || hot),
          time,
          arrows: hot,
          hot,
          dim,
          packets: dashed ? 0 : hot ? 2 : trunk ? 1 : 0,
        });
      };
      this.bridges.forEach((edge) => drawOne(edge, true));
      this.edges.forEach((edge) => {
        if (this.camera.zoom < 0.22 && edge.kind === "line" && !selected) return;
        drawOne(edge, false);
      });
      ctx.globalAlpha = 1;
    }

    drawLinkProjected(ctx, source, target, opt) {
      const a = this.view(source);
      const b = this.view(target);
      if (!this.projectedOk(a) || !this.projectedOk(b)) return;
      const s = (a.s + b.s) / 2;
      const from = { x: a.x + (b.x - a.x) * ((a.r + 2) / (Math.hypot(b.x - a.x, b.y - a.y) || 1)), y: a.y + (b.y - a.y) * ((a.r + 2) / (Math.hypot(b.x - a.x, b.y - a.y) || 1)) };
      const dist = Math.hypot(b.x - a.x, b.y - a.y) || 1;
      const to = { x: b.x - (b.x - a.x) * ((b.r + (opt.arrows ? 6 : 2)) / dist), y: b.y - (b.y - a.y) * ((b.r + (opt.arrows ? 6 : 2)) / dist) };
      const ctrl = { x: (from.x + to.x) / 2 - (to.y - from.y) * opt.lift, y: (from.y + to.y) / 2 + (to.x - from.x) * opt.lift };
      const width = opt.width || 1.6;
      ctx.save();
      ctx.globalAlpha = opt.dim ? 0.22 : 1;
      ctx.lineCap = "round";
      ctx.beginPath();
      ctx.moveTo(from.x, from.y);
      ctx.quadraticCurveTo(ctrl.x, ctrl.y, to.x, to.y);
      ctx.strokeStyle = opt.underlay;
      ctx.lineWidth = width + 1.7;
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(from.x, from.y);
      ctx.quadraticCurveTo(ctrl.x, ctrl.y, to.x, to.y);
      ctx.strokeStyle = opt.color;
      ctx.lineWidth = width;
      if (opt.dashed) ctx.setLineDash([7, 6]);
      ctx.stroke();
      ctx.setLineDash([]);
      if (opt.flow && !opt.dim) {
        ctx.strokeStyle = opt.flowColor || opt.color;
        ctx.lineWidth = Math.max(width * 0.55, 1.15);
        ctx.setLineDash([6, 8]);
        ctx.lineDashOffset = -(((opt.time || 0) * 0.055) % 14);
        ctx.beginPath();
        ctx.moveTo(from.x, from.y);
        ctx.quadraticCurveTo(ctrl.x, ctrl.y, to.x, to.y);
        ctx.stroke();
        ctx.setLineDash([]);
      }
      if (opt.arrows && s > 0.18) {
        const tip = this.quadPoint(from, ctrl, to, 1);
        const tan = this.quadTangent(from, ctrl, to, 0.97);
        this.drawChevronScreen(ctx, tip.x, tip.y, tan.x, tan.y, opt.hot ? 7.2 : 6.1, opt.color);
      }
      const packets = opt.dim ? 0 : (opt.packets || 0);
      for (let i = 0; i < packets; i += 1) {
        const t = (((opt.time || 0) * 0.00032) + i / Math.max(1, packets)) % 1;
        const pt = this.quadPoint(from, ctrl, to, t);
        const tan = this.quadTangent(from, ctrl, to, t);
        this.drawChevronScreen(ctx, pt.x, pt.y, tan.x, tan.y, opt.hot ? 6.4 : 5.2, opt.flowColor || opt.color);
      }
      ctx.restore();
    }

    drawChevronScreen(ctx, x, y, tx, ty, size, color) {
      const nx = -ty;
      const ny = tx;
      ctx.beginPath();
      ctx.moveTo(x + tx * size, y + ty * size);
      ctx.lineTo(x - tx * size * 0.72 + nx * size * 0.58, y - ty * size * 0.72 + ny * size * 0.58);
      ctx.lineTo(x - tx * size * 0.36, y - ty * size * 0.36);
      ctx.lineTo(x - tx * size * 0.72 - nx * size * 0.58, y - ty * size * 0.72 - ny * size * 0.58);
      ctx.closePath();
      ctx.fillStyle = color;
      ctx.fill();
    }

    volumeHeight() {
      return 0;
    }

    drawVolumeFallback(ctx, node, color, selected, theme) {
      const p = this.view(node);
      if (!this.projectedOk(p)) return null;
      const r = Math.max(4, node.r * Math.min(p.s, 3.4));
      ctx.fillStyle = hexToRgba(color, theme.dark ? 0.9 : 0.95);
      ctx.strokeStyle = hexToRgba(color, selected ? 0.95 : 0.45);
      ctx.lineWidth = selected ? 1.6 : 1;
      ctx.beginPath();
      ctx.arc(p.x, p.y, r, 0, TAU);
      ctx.fill();
      ctx.stroke();
      return { x: p.x, y: p.y, r, s: p.s, depth: p.depth };
    }

    starMetrics(node) {
      const r = node.r || 19;
      const mass = clamp((r - 16) / 16, 0, 1);
      const brightness = clamp(0.4 + Math.log1p(Math.max(0, node.data.value || 0)) / 14, 0.4, 1);
      return { mass, brightness, color: node.data.color || "#f59e0b" };
    }

    paintStar(ctx, x, y, r, color, opt) {
      const rgb = hexRgb(color);
      const brightness = opt.brightness ?? 0.7;
      const mass = opt.mass ?? 0.5;
      const pulse = opt.reduced ? 1 : 0.94 + 0.06 * Math.sin((opt.time || 0) / 480);
      const core = mixRgb(rgb, [255, 250, 240], 0.32 + brightness * 0.5);
      const glowR = r * (2.05 + mass * 1.7);
      const glow = ctx.createRadialGradient(x, y, r * 0.12, x, y, glowR);
      glow.addColorStop(0, rgbCss(core, 0.62 * brightness * pulse));
      glow.addColorStop(0.16, rgbCss(rgb, 0.32 * brightness));
      glow.addColorStop(0.42, rgbCss(rgb, (opt.dark ? 0.16 : 0.11) * brightness));
      glow.addColorStop(1, rgbCss(rgb, 0));
      ctx.fillStyle = glow;
      ctx.beginPath();
      ctx.arc(x, y, glowR, 0, TAU);
      ctx.fill();
      ctx.save();
      ctx.globalCompositeOperation = "lighter";
      ctx.translate(x, y);
      ctx.rotate(0.14);
      ctx.lineCap = "round";
      const spike = r * (1.65 + mass * 1.15);
      ctx.strokeStyle = rgbCss(core, 0.2 * brightness * pulse);
      ctx.lineWidth = Math.max(0.7, r * 0.07);
      for (let i = 0; i < 4; i += 1) {
        const a = (i * Math.PI) / 2;
        ctx.beginPath();
        ctx.moveTo(Math.cos(a) * r * 0.25, Math.sin(a) * r * 0.25);
        ctx.lineTo(Math.cos(a) * spike, Math.sin(a) * spike);
        ctx.stroke();
      }
      ctx.restore();
      const ball = ctx.createRadialGradient(x - r * 0.2, y - r * 0.22, r * 0.06, x, y, r);
      ball.addColorStop(0, rgbCss(mixRgb(core, [255, 255, 255], 0.4)));
      ball.addColorStop(0.38, rgbCss(core));
      ball.addColorStop(1, rgbCss(mixRgb(rgb, [28, 16, 8], 0.12)));
      ctx.fillStyle = ball;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, TAU);
      ctx.fill();
      if (opt.selected) {
        ctx.beginPath();
        ctx.arc(x, y, r * 1.24, 0, TAU);
        ctx.strokeStyle = rgbCss(core, 0.5);
        ctx.lineWidth = opt.lineWidth || Math.max(1, r * 0.05);
        ctx.stroke();
      }
    }

    drawStar3d(ctx, node, selected, theme, time) {
      const z = (node.z || 0) * this.spaceMix;
      const core = this.project(node.x, node.y, z);
      if (!this.projectedOk(core)) return null;
      const s = Math.min(core.s, 3.6);
      const metrics = this.starMetrics(node);
      const r = Math.max(6, node.r * s * (0.92 + metrics.mass * 0.18));
      if (r > Math.max(this.width, this.height) * 0.5) return null;
      this.paintStar(ctx, core.x, core.y, r, metrics.color, {
        selected,
        brightness: metrics.brightness,
        mass: metrics.mass,
        time,
        dark: !theme || theme.dark,
        reduced: this.reducedMotion || !this.options.motion,
      });
      return { x: core.x, y: core.y, r: r * 1.15, s: core.s, depth: core.depth, star: true };
    }

    paintSphere(ctx, x, y, r, color, opt) {
      const rgb = hexRgb(color);
      const light = mixRgb(rgb, [255, 244, 220], 0.5);
      const shade = mixRgb(rgb, [8, 10, 18], 0.58);
      if (opt.atmosphere && r > 5) {
        const halo = ctx.createRadialGradient(x, y, r * 0.68, x, y, r * 1.4);
        halo.addColorStop(0, rgbCss(rgb, 0));
        halo.addColorStop(0.62, rgbCss(rgb, opt.dark ? 0.11 : 0.08));
        halo.addColorStop(1, rgbCss(rgb, 0));
        ctx.fillStyle = halo;
        ctx.beginPath();
        ctx.arc(x, y, r * 1.4, 0, TAU);
        ctx.fill();
      }
      const g = ctx.createRadialGradient(x - r * 0.34, y - r * 0.36, r * 0.06, x + r * 0.1, y + r * 0.14, r);
      g.addColorStop(0, rgbCss(light));
      g.addColorStop(0.4, rgbCss(rgb));
      g.addColorStop(1, rgbCss(shade));
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, TAU);
      ctx.fill();
      if (r > 7) {
        ctx.fillStyle = "rgba(255,255,255,0.2)";
        ctx.beginPath();
        ctx.ellipse(x - r * 0.28, y - r * 0.3, r * 0.18, r * 0.11, -0.5, 0, TAU);
        ctx.fill();
      }
      ctx.beginPath();
      ctx.arc(x, y, r, 0, TAU);
      ctx.strokeStyle = hexToRgba(color, opt.selected ? 0.9 : 0.28);
      ctx.lineWidth = opt.lineWidth || 1;
      ctx.stroke();
    }

    drawBody3d(ctx, node, color, selected, theme) {
      const planet = node.data.kind === "order";
      const z = (node.z || 0) * this.spaceMix;
      const p = this.project(node.x, node.y, z);
      if (!this.projectedOk(p)) return this.drawVolumeFallback(ctx, node, color, selected, theme);
      const r = Math.max(planet ? 4.6 : 3, node.r * Math.min(p.s, 3.4) * (planet ? 1.02 : 0.82));
      if (r > Math.max(this.width, this.height) * 0.45) return null;
      this.paintSphere(ctx, p.x, p.y, r, color, {
        selected,
        atmosphere: planet && r > 5.5,
        lineWidth: selected ? 1.45 : 0.85,
        dark: !!theme.dark,
      });
      return { x: p.x, y: p.y, r, s: p.s, depth: p.depth };
    }

    drawNodes3d(ctx, theme, time) {
      const focus = this.selected;
      const searching = this.matches.size > 0;
      const ordered = this.nodes.slice().sort((a, b) => this.view(b).depth - this.view(a).depth);
      ordered.forEach((node) => {
        const p = this.view(node);
        if (!p.visible) return;
        const related = !focus || node === focus || this.hot.has(node.data.id);
        const matched = !searching || node.match;
        if (this.camera.zoom < 0.3 && node.data.kind === "line" && !related && !matched) return;
        ctx.globalAlpha = !focus || related ? 1 : 0.42;
        const color = node.data.color || "#64748b";
        const selected = node === this.selected;
        const hovered = node === this.hovered;
        const cap = node.data.kind === "customer"
          ? this.drawStar3d(ctx, node, selected, theme, time)
          : this.drawBody3d(ctx, node, color, selected, theme);
        if (!cap) return;
        if ((selected || hovered) && !cap.star && cap.r > 4 && cap.r < Math.max(this.width, this.height) * 0.55) {
          ctx.strokeStyle = hexToRgba(color, selected ? 0.5 : 0.3);
          ctx.lineWidth = 1.2;
          ctx.beginPath();
          ctx.arc(cap.x, cap.y, cap.r + 6, 0, TAU);
          ctx.stroke();
        }
        if (node.data.debt > 0.005) {
          ctx.strokeStyle = "#dc2626";
          ctx.lineWidth = 1.6;
          ctx.beginPath();
          ctx.arc(cap.x, cap.y, cap.r + 4, -Math.PI / 2, -Math.PI / 2 + TAU * clamp(node.data.debt / Math.max(node.data.value, 1), 0.08, 1));
          ctx.stroke();
        }
        const screen = { ...p, x: cap.x, y: cap.y, r: cap.r, s: cap.s };
        const mustLabel = selected || hovered || node.match || node.data.kind === "customer"
          || (node.data.kind === "order" && cap.s > 0.55)
          || (node.data.kind === "line" && cap.s > 1.2);
        if ((this.options.labels && mustLabel) || selected) this.drawLabel3d(ctx, node, screen, theme, selected || hovered || node.match);
      });
      ctx.globalAlpha = 1;
    }

    drawLabel3d(ctx, node, p, theme, emphasized) {
      const fontSize = clamp(node.data.kind === "customer" ? 12 : 11, 8, 15);
      ctx.font = `${node.data.kind === "customer" ? 650 : 500} ${fontSize}px Segoe UI, sans-serif`;
      const label = this.truncate(ctx, node.data.label || "Без названия", node.data.kind === "line" ? 120 : 170);
      const x = p.x + p.r + 8;
      const y = p.y + fontSize * 0.35;
      if (emphasized) {
        const width = ctx.measureText(label).width;
        ctx.fillStyle = theme.dark ? "rgba(8,16,28,0.86)" : "rgba(255,255,255,0.9)";
        ctx.beginPath();
        ctx.roundRect(x - 4, y - fontSize, width + 8, fontSize + 6, 5);
        ctx.fill();
      }
      ctx.fillStyle = theme.ink;
      ctx.fillText(label, x, y);
    }

    drawHeatMarks3d(ctx, theme, time) {
      const marks = this.heatGroup("customer");
      const foci = marks.length ? marks : this.heatGroup("order");
      if (!foci.length) return;
      const peak = this.heatPeak(foci);
      foci.forEach((n) => {
        const p = this.view(n);
        if (!this.onScreen(p, 24)) return;
        const t = heatTone(n.data.debt, peak);
        const [r, g, b] = heatRgb(t, theme.dark);
        const pulse = this.reducedMotion ? 1 : 0.72 + 0.28 * Math.sin((time || 0) / 380 + n.x * 0.012);
        ctx.strokeStyle = `rgba(${r},${g},${b},${0.55 + 0.35 * t})`;
        ctx.lineWidth = 2.4 + 2.8 * t;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r + 8 + 7 * pulse, 0, TAU);
        ctx.stroke();
      });
    }

    drawSpace(ctx, theme) {
      ctx.fillStyle = theme.bg;
      ctx.fillRect(0, 0, this.width, this.height);
      const gap = clamp(52 * this.camera.zoom, 28, 88);
      const ox = ((this.width / 2 + this.camera.x) % gap + gap) % gap;
      const oy = ((this.height / 2 + this.camera.y) % gap + gap) % gap;
      ctx.strokeStyle = theme.grid;
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let x = ox; x < this.width; x += gap) {
        ctx.moveTo(x + 0.5, 0);
        ctx.lineTo(x + 0.5, this.height);
      }
      for (let y = oy; y < this.height; y += gap) {
        ctx.moveTo(0, y + 0.5);
        ctx.lineTo(this.width, y + 0.5);
      }
      ctx.stroke();
    }

    heatGroup(kind) {
      return this.nodes.filter((n) => n.data.kind === kind && (n.data.debt || 0) > 0.01);
    }

    heatPeak(nodes) {
      return Math.max(0.01, ...nodes.map((n) => n.data.debt || 0));
    }

    paintHeatBlob(ctx, x, y, radius, t, alpha, dark) {
      const [r, g, b] = heatRgb(t, dark);
      const grd = ctx.createRadialGradient(x, y, 0, x, y, radius);
      grd.addColorStop(0, `rgba(${r},${g},${b},${alpha})`);
      grd.addColorStop(0.34, `rgba(${r},${g},${b},${alpha * 0.55})`);
      grd.addColorStop(0.68, `rgba(${r},${g},${b},${alpha * 0.18})`);
      grd.addColorStop(1, `rgba(${r},${g},${b},0)`);
      ctx.fillStyle = grd;
      ctx.beginPath();
      ctx.arc(x, y, radius, 0, TAU);
      ctx.fill();
    }

    drawHeat(ctx, theme) {
      const customers = this.heatGroup("customer");
      const orders = this.heatGroup("order");
      const lines = this.heatGroup("line");
      if (!customers.length && !orders.length && !lines.length) return;
      const zoom = this.camera.zoom;
      const dark = !!theme.dark;
      ctx.save();
      ctx.globalCompositeOperation = dark ? "screen" : "source-over";
      const paint = (nodes, baseR, spanR, a0, a1) => {
        if (!nodes.length) return;
        const peak = this.heatPeak(nodes);
        nodes.slice().sort((a, b) => (a.data.debt || 0) - (b.data.debt || 0)).forEach((n) => {
          const t = heatTone(n.data.debt, peak);
          this.paintHeatBlob(ctx, n.x, n.y, baseR + spanR * t, t, a0 + (a1 - a0) * t, dark);
        });
      };
      if (customers.length) paint(customers, 78, 170, dark ? 0.38 : 0.34, dark ? 0.88 : 0.72);
      else paint(orders, 64, 140, dark ? 0.36 : 0.32, dark ? 0.86 : 0.7);
      if (customers.length && zoom >= 0.48) paint(orders, 34, 72, dark ? 0.22 : 0.2, dark ? 0.58 : 0.48);
      if (zoom >= 0.92) paint(lines, 16, 38, dark ? 0.2 : 0.18, dark ? 0.5 : 0.42);
      ctx.restore();
    }

    drawHeatMarks(ctx, theme, time) {
      const marks = this.heatGroup("customer");
      const foci = marks.length ? marks : this.heatGroup("order");
      if (!foci.length) return;
      const zoom = this.camera.zoom;
      const peak = this.heatPeak(foci);
      foci.forEach((n) => {
        const t = heatTone(n.data.debt, peak);
        const [r, g, b] = heatRgb(t, theme.dark);
        const pulse = this.reducedMotion ? 1 : 0.72 + 0.28 * Math.sin((time || 0) / 380 + n.x * 0.012);
        ctx.strokeStyle = `rgba(${r},${g},${b},${0.55 + 0.35 * t})`;
        ctx.lineWidth = (2.4 + 2.8 * t) / zoom;
        ctx.beginPath();
        ctx.arc(n.x, n.y, n.r + (8 + 7 * pulse) / zoom, 0, TAU);
        ctx.stroke();
      });
    }

    worldToScreen(wx, wy, wz = 0) {
      if (this.spaceMix > 0.01) {
        const p = this.project(wx, wy, wz);
        return { x: p.x, y: p.y };
      }
      return {
        x: this.width / 2 + this.camera.x + wx * this.camera.zoom,
        y: this.height / 2 + this.camera.y + wy * this.camera.zoom,
      };
    }

    heatCalloutNodes() {
      const visible = (kind) => this.heatGroup(kind)
        .filter((n) => this.onScreen(this.view(n), 0))
        .sort((a, b) => b.data.debt - a.data.debt);
      const customers = visible("customer");
      if (customers.length) return customers.slice(0, 4);
      return visible("order").slice(0, 4);
    }

    drawHeatCallouts(ctx, theme) {
      const foci = this.heatCalloutNodes();
      if (!foci.length) return;
      const peak = this.heatPeak(foci);
      const placed = [];
      ctx.font = "600 11px Segoe UI, sans-serif";
      ctx.textAlign = "left";
      ctx.textBaseline = "middle";
      foci.forEach((n) => {
        const origin = this.spaceMix > 0.01
          ? this.project(n.x, n.y, (n.z || 0) * this.spaceMix)
          : { x: this.width / 2 + this.camera.x + n.x * this.camera.zoom, y: this.height / 2 + this.camera.y + n.y * this.camera.zoom, s: 1, visible: true };
        if (!this.onScreen(origin, 0)) return;
        const t = heatTone(n.data.debt, peak);
        const [r, g, b] = heatRgb(t, theme.dark);
        const name = this.truncate(ctx, n.data.label || "Долг", 118);
        const amount = compactMoney(n.data.debt);
        const titleW = ctx.measureText(name).width;
        ctx.font = "700 10px ui-monospace, Consolas, monospace";
        const sumW = ctx.measureText(amount).width;
        ctx.font = "600 11px Segoe UI, sans-serif";
        const w = Math.max(titleW, sumW) + 28;
        const h = 34;
        const nodeR = this.is3d() ? this.view(n).r : n.r * this.camera.zoom;
        let x = origin.x + nodeR + 16;
        let y = origin.y - h / 2;
        x = clamp(x, 14, this.width - w - 14);
        y = clamp(y, 86, this.height - h - 52);
        placed.forEach((prev) => {
          if (Math.abs(prev.y - y) < h + 8 && Math.abs(prev.x - x) < w + 12) y = clamp(prev.y + h + 8, 86, this.height - h - 52);
        });
        placed.push({ x, y });
        ctx.strokeStyle = `rgba(${r},${g},${b},0.55)`;
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.moveTo(origin.x, origin.y);
        ctx.lineTo(x - 4, y + h / 2);
        ctx.stroke();
        ctx.beginPath();
        ctx.roundRect(x, y, w, h, 8);
        ctx.fillStyle = theme.dark ? "rgba(8, 16, 28, 0.88)" : "rgba(255, 255, 255, 0.92)";
        ctx.fill();
        ctx.strokeStyle = `rgba(${r},${g},${b},0.85)`;
        ctx.stroke();
        ctx.fillStyle = `rgb(${r},${g},${b})`;
        ctx.beginPath();
        ctx.arc(x + 10, y + h / 2, 3.2, 0, TAU);
        ctx.fill();
        ctx.fillStyle = theme.ink;
        ctx.fillText(name, x + 18, y + 11);
        ctx.font = "700 10px ui-monospace, Consolas, monospace";
        ctx.fillStyle = `rgb(${r},${g},${b})`;
        ctx.fillText(amount, x + 18, y + 24);
        ctx.font = "600 11px Segoe UI, sans-serif";
      });
    }

    drawTimeline(ctx, theme) {
      ctx.strokeStyle = theme.grid;
      ctx.lineWidth = 1 / this.camera.zoom;
      ctx.setLineDash([5 / this.camera.zoom, 8 / this.camera.zoom]);
      [-250, -125, 0, 125, 250].forEach((v) => {
        ctx.beginPath();
        ctx.moveTo(-460, v);
        ctx.lineTo(500, v);
        ctx.stroke();
      });
      ctx.setLineDash([]);
      ctx.fillStyle = theme.muted;
      ctx.font = `${11 / this.camera.zoom}px Segoe UI`;
      ctx.textAlign = "left";
      ctx.fillText("← раньше", -450, 310);
      ctx.textAlign = "right";
      ctx.fillText("позже →", 490, 310);
      ctx.textAlign = "left";
    }

    clusters() {
      const groups = new Map();
      this.nodes.forEach((n) => {
        const key = n.data.kind === "customer" ? n.data.id : `customer:${n.data.customer}`;
        if (!groups.has(key)) groups.set(key, { color: n.data.color, nodes: [] });
        groups.get(key).nodes.push(n);
        if (n.data.kind === "customer") groups.get(key).color = n.data.color;
      });
      return groups;
    }

    drawHulls(ctx, theme) {
      if (this.camera.zoom < 0.28) return;
      this.clusters().forEach((group) => {
        if (group.nodes.length < 2) return;
        const pts = inflateHull(convexHull(group.nodes.map((n) => ({ x: n.x, y: n.y }))), 22);
        if (pts.length < 2) return;
        ctx.beginPath();
        organicPath(ctx, pts);
        ctx.fillStyle = hexToRgba(group.color, theme.dark ? 0.04 : 0.03);
        ctx.fill();
        ctx.strokeStyle = hexToRgba(group.color, 0.14);
        ctx.lineWidth = 1 / this.camera.zoom;
        ctx.stroke();
      });
    }

    drawBridges(ctx, theme, time) {
      if (!this.bridges.length || this.camera.zoom < 0.28) return;
      const selected = this.selected;
      this.bridges.forEach((edge) => {
        const hot = this.edgeIsHot(edge);
        const color = hot ? hexToRgba(selected.data.color, 0.7) : theme.dark ? "rgba(148,163,184,0.55)" : "rgba(71,85,105,0.5)";
        this.drawLink(ctx, edge.source, edge.target, {
          lift: 0.18,
          color,
          width: hot ? 2 : 1.35,
          underlay: theme.dark ? "rgba(2,6,14,0.5)" : "rgba(255,255,255,0.7)",
          dashed: true,
          flow: false,
          arrows: false,
          dim: selected && !hot,
        });
      });
      ctx.globalAlpha = 1;
    }

    edgeTip(from, toward, offset) {
      const dx = toward.x - from.x;
      const dy = toward.y - from.y;
      const dist = Math.hypot(dx, dy) || 1;
      return { x: from.x + (dx / dist) * offset, y: from.y + (dy / dist) * offset };
    }

    controlPoint(a, b, lift) {
      return {
        x: (a.x + b.x) / 2 - (b.y - a.y) * lift,
        y: (a.y + b.y) / 2 + (b.x - a.x) * lift,
      };
    }

    quadPoint(a, c, b, t) {
      const u = 1 - t;
      return {
        x: u * u * a.x + 2 * u * t * c.x + t * t * b.x,
        y: u * u * a.y + 2 * u * t * c.y + t * t * b.y,
      };
    }

    quadTangent(a, c, b, t) {
      const dx = 2 * (1 - t) * (c.x - a.x) + 2 * t * (b.x - c.x);
      const dy = 2 * (1 - t) * (c.y - a.y) + 2 * t * (b.y - c.y);
      const len = Math.hypot(dx, dy) || 1;
      return { x: dx / len, y: dy / len };
    }

    drawChevron(ctx, x, y, tx, ty, size, color) {
      const s = size / this.camera.zoom;
      const nx = -ty;
      const ny = tx;
      ctx.beginPath();
      ctx.moveTo(x + tx * s, y + ty * s);
      ctx.lineTo(x - tx * s * 0.72 + nx * s * 0.58, y - ty * s * 0.72 + ny * s * 0.58);
      ctx.lineTo(x - tx * s * 0.36, y - ty * s * 0.36);
      ctx.lineTo(x - tx * s * 0.72 - nx * s * 0.58, y - ty * s * 0.72 - ny * s * 0.58);
      ctx.closePath();
      ctx.fillStyle = color;
      ctx.fill();
    }

    drawLink(ctx, source, target, opt) {
      const zoom = this.camera.zoom;
      const from = this.edgeTip(source, target, (source.r || 8) + 2);
      const to = this.edgeTip(target, source, (target.r || 8) + (opt.arrows ? 6 : 2));
      const ctrl = this.controlPoint(from, to, opt.lift);
      const width = (opt.width || 1.6) / zoom;
      ctx.save();
      ctx.globalAlpha = opt.dim ? 0.22 : 1;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.setLineDash([]);
      ctx.beginPath();
      ctx.moveTo(from.x, from.y);
      ctx.quadraticCurveTo(ctrl.x, ctrl.y, to.x, to.y);
      ctx.strokeStyle = opt.underlay;
      ctx.lineWidth = width + 1.7 / zoom;
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(from.x, from.y);
      ctx.quadraticCurveTo(ctrl.x, ctrl.y, to.x, to.y);
      ctx.strokeStyle = opt.color;
      ctx.lineWidth = width;
      if (opt.dashed) ctx.setLineDash([7 / zoom, 6 / zoom]);
      ctx.stroke();
      ctx.setLineDash([]);
      if (opt.flow && !opt.dim) {
        const dash = 6 / zoom;
        const gap = 8 / zoom;
        ctx.strokeStyle = opt.flowColor || opt.color;
        ctx.globalAlpha = opt.dim ? 0.2 : 0.95;
        ctx.lineWidth = Math.max(width * 0.55, 1.15 / zoom);
        ctx.setLineDash([dash, gap]);
        ctx.lineDashOffset = -(((opt.time || 0) * 0.055) % (dash + gap));
        ctx.beginPath();
        ctx.moveTo(from.x, from.y);
        ctx.quadraticCurveTo(ctrl.x, ctrl.y, to.x, to.y);
        ctx.stroke();
        ctx.setLineDash([]);
      }
      if (opt.arrows && zoom > 0.2) {
        const tip = this.quadPoint(from, ctrl, to, 1);
        const tan = this.quadTangent(from, ctrl, to, 0.97);
        this.drawChevron(ctx, tip.x, tip.y, tan.x, tan.y, opt.hot ? 7.2 : 6.1, opt.color);
      }
      const packets = opt.dim ? 0 : (opt.packets || 0);
      for (let i = 0; i < packets; i += 1) {
        const t = (((opt.time || 0) * 0.00032) + i / packets) % 1;
        const p = this.quadPoint(from, ctrl, to, t);
        const tan = this.quadTangent(from, ctrl, to, t);
        this.drawChevron(ctx, p.x, p.y, tan.x, tan.y, opt.hot ? 6.4 : 5.2, opt.flowColor || opt.color);
      }
      ctx.restore();
    }

    drawEdges(ctx, theme, time) {
      const selected = this.selected;
      const hideLines = this.camera.zoom < 0.22;
      const motion = this.options.motion && !this.reducedMotion;
      const underlay = theme.dark ? "rgba(2,6,14,0.55)" : "rgba(255,255,255,0.78)";
      this.edges.forEach((edge) => {
        if (hideLines && edge.kind === "line" && !selected) return;
        const hot = this.edgeIsHot(edge);
        const dim = !!(selected && !hot);
        const trunk = edge.kind === "customer";
        const base = (edge.source.data && edge.source.data.color) || (hot && selected ? selected.data.color : "#64748b");
        const color = hot
          ? hexToRgba(selected.data.color, 0.95)
          : hexToRgba(base, trunk ? 0.82 : 0.68);
        const flow = motion && (!selected || hot) && (hot || trunk || this.camera.zoom > 0.5);
        this.drawLink(ctx, edge.source, edge.target, {
          lift: trunk ? 0.16 : 0.1,
          color,
          flowColor: hexToRgba(hot ? selected.data.color : base, 1),
          width: hot ? (trunk ? 3.1 : 2.4) : trunk ? 2.15 : 1.55,
          underlay,
          dashed: false,
          flow,
          time,
          arrows: hot,
          hot,
          dim,
          packets: !flow ? 0 : hot ? 2 : trunk ? 1 : 0,
        });
      });
      ctx.globalAlpha = 1;
    }

    drawNodes(ctx, theme, time, ghost = false) {
      const focus = this.selected;
      const zoom = this.camera.zoom;
      const searching = this.matches.size > 0;
      const ordered = this.nodes.slice().sort((a, b) => {
        const ah = a === focus || this.hot.has(a.data.id) ? 1 : 0;
        const bh = b === focus || this.hot.has(b.data.id) ? 1 : 0;
        return ah - bh;
      });
      ordered.forEach((node) => {
        const related = !focus || node === focus || this.hot.has(node.data.id);
        const matched = !searching || node.match;
        if (zoom < 0.3 && node.data.kind === "line" && !related && !matched) return;
        ctx.globalAlpha = !focus || related ? 1 : 0.48;
        const color = node.data.color || "#64748b";
        const selected = node === this.selected;
        const hovered = !ghost && node === this.hovered;
        const r = node.r;

        if ((selected || hovered) && zoom > 0.28) {
          ctx.strokeStyle = hexToRgba(color, selected ? 0.45 : 0.28);
          ctx.lineWidth = 1 / zoom;
          ctx.beginPath();
          ctx.arc(node.x, node.y, r + 6 / zoom, 0, TAU);
          ctx.stroke();
        }

        if (node.data.kind === "customer") {
          const metrics = this.starMetrics(node);
          this.paintStar(ctx, node.x, node.y, r, metrics.color, {
            selected,
            brightness: metrics.brightness,
            mass: metrics.mass,
            time,
            dark: !!theme.dark,
            reduced: this.reducedMotion || !this.options.motion,
            lineWidth: (selected ? 1.5 : 1) / zoom,
          });
        } else {
          this.paintSphere(ctx, node.x, node.y, node.data.kind === "order" ? r : r * 0.86, color, {
            selected,
            atmosphere: node.data.kind === "order" && zoom > 0.45,
            lineWidth: (selected ? 1.5 : 1) / zoom,
            dark: !!theme.dark,
          });
        }

        if (node.data.debt > 0.005) {
          ctx.strokeStyle = "#dc2626";
          ctx.lineWidth = 1.4 / zoom;
          ctx.beginPath();
          ctx.arc(node.x, node.y, r + 4 / zoom, -Math.PI / 2, -Math.PI / 2 + TAU * clamp(node.data.debt / Math.max(node.data.value, 1), 0.08, 1));
          ctx.stroke();
        }

        if (ghost) return;
        const mustLabel = selected || hovered || node.match || node.data.kind === "customer"
          || (node.data.kind === "order" && zoom > 0.62)
          || (node.data.kind === "line" && zoom > 1.45);
        if ((this.options.labels && mustLabel) || selected) this.drawLabel(ctx, node, theme, zoom, selected || hovered || node.match);
      });
      ctx.globalAlpha = 1;
    }

    drawLabel(ctx, node, theme, zoom, emphasized) {
      const fontSize = clamp((node.data.kind === "customer" ? 12 : 11) / Math.sqrt(zoom), 7.5, 15);
      const max = node.data.kind === "line" ? 140 : 190;
      ctx.font = `${node.data.kind === "customer" ? 650 : 500} ${fontSize}px Segoe UI, sans-serif`;
      const label = this.truncate(ctx, node.data.label || "Без названия", max / Math.sqrt(zoom));
      const x = node.x + node.r + 8 / zoom;
      const y = node.y + fontSize * 0.35;
      if (emphasized) {
        const width = ctx.measureText(label).width;
        ctx.fillStyle = theme.bg;
        ctx.globalAlpha *= 0.9;
        ctx.beginPath();
        ctx.roundRect(x - 4 / zoom, y - fontSize, width + 8 / zoom, fontSize + 6 / zoom, 5 / zoom);
        ctx.fill();
        ctx.globalAlpha = 1;
      }
      ctx.fillStyle = theme.ink;
      ctx.fillText(label, x, y);
    }

    truncate(ctx, text, maxWidth) {
      if (ctx.measureText(text).width <= maxWidth) return text;
      let out = String(text);
      while (out.length > 4 && ctx.measureText(`${out}…`).width > maxWidth) out = out.slice(0, -1);
      return `${out}…`;
    }

    drawMinimap(theme) {
      if (!this.miniCtx || !this.nodes.length) return;
      const ctx = this.miniCtx;
      const w = this.minimap.width;
      const h = this.minimap.height;
      const box = this.bounds();
      const scale = Math.min((w - 18) / Math.max(1, box.width), (h - 18) / Math.max(1, box.height));
      const ox = (w - box.width * scale) / 2 - box.minX * scale;
      const oy = (h - box.height * scale) / 2 - box.minY * scale;
      this.miniMap = { scale, ox, oy, box };
      ctx.clearRect(0, 0, w, h);
      ctx.fillStyle = theme.bg;
      ctx.fillRect(0, 0, w, h);
      if (this.options.heat) {
        const foci = this.heatGroup("customer");
        const dots = foci.length ? foci : this.heatGroup("order");
        if (dots.length) {
          const peak = this.heatPeak(dots);
          dots.forEach((n) => {
            const t = heatTone(n.data.debt, peak);
            const [r, g, b] = heatRgb(t, theme.dark);
            const rad = 5 + 11 * t;
            const x = n.x * scale + ox;
            const y = n.y * scale + oy;
            const grd = ctx.createRadialGradient(x, y, 0, x, y, rad);
            grd.addColorStop(0, `rgba(${r},${g},${b},0.9)`);
            grd.addColorStop(1, `rgba(${r},${g},${b},0)`);
            ctx.fillStyle = grd;
            ctx.beginPath();
            ctx.arc(x, y, rad, 0, TAU);
            ctx.fill();
          });
        }
      }
      this.edges.forEach((edge) => {
        ctx.strokeStyle = theme.edge;
        ctx.lineWidth = 0.6;
        ctx.beginPath();
        ctx.moveTo(edge.source.x * scale + ox, edge.source.y * scale + oy);
        ctx.lineTo(edge.target.x * scale + ox, edge.target.y * scale + oy);
        ctx.stroke();
      });
      this.nodes.forEach((n) => {
        ctx.fillStyle = n.data.color;
        ctx.beginPath();
        ctx.arc(n.x * scale + ox, n.y * scale + oy, n.data.kind === "customer" ? 2.7 : 1.5, 0, TAU);
        ctx.fill();
      });
      const left = (-this.width / 2 - this.camera.x) / this.camera.zoom;
      const top = (-this.height / 2 - this.camera.y) / this.camera.zoom;
      ctx.strokeStyle = "#14b8a6";
      ctx.lineWidth = 1;
      ctx.strokeRect(left * scale + ox, top * scale + oy, (this.width / this.camera.zoom) * scale, (this.height / this.camera.zoom) * scale);
    }

    minimapJump(e) {
      if (!this.miniMap) return;
      const rect = this.minimap.getBoundingClientRect();
      const sx = ((e.clientX - rect.left) / rect.width) * this.minimap.width;
      const sy = ((e.clientY - rect.top) / rect.height) * this.minimap.height;
      const wx = (sx - this.miniMap.ox) / this.miniMap.scale;
      const wy = (sy - this.miniMap.oy) / this.miniMap.scale;
      this.stopTour();
      this.viewPinned = false;
      this.orbit.targetX = wx;
      this.orbit.targetY = wy;
      this.idleUntil = performance.now() + 2000;
      this.animateCamera({ x: -wx * this.camera.zoom, y: -wy * this.camera.zoom, zoom: this.camera.zoom });
    }

    bounds(nodes = this.nodes) {
      if (!nodes.length) return { minX: -1, minY: -1, maxX: 1, maxY: 1, width: 2, height: 2 };
      let minX = Infinity;
      let minY = Infinity;
      let maxX = -Infinity;
      let maxY = -Infinity;
      nodes.forEach((n) => {
        minX = Math.min(minX, n.x - n.r);
        minY = Math.min(minY, n.y - n.r);
        maxX = Math.max(maxX, n.x + n.r);
        maxY = Math.max(maxY, n.y + n.r);
      });
      return { minX, minY, maxX, maxY, width: maxX - minX, height: maxY - minY };
    }

    fit(animated = true, nodes = this.nodes) {
      if (!nodes.length) return;
      this.stopTour();
      this.orbitTween = null;
      this.viewPinned = false;
      const box = this.bounds(nodes);
      const zoom = clamp(Math.min((this.width - 110) / Math.max(80, box.width), (this.height - 100) / Math.max(80, box.height)), 0.18, 2.5);
      const x = -((box.minX + box.maxX) / 2) * zoom;
      const y = -((box.minY + box.maxY) / 2) * zoom;
      this.orbit.targetX = (box.minX + box.maxX) / 2;
      this.orbit.targetY = (box.minY + box.maxY) / 2;
      this.orbit.targetZ = 8;
      this.zoomTarget = zoom;
      this.zoomAnchor = { sx: this.width / 2, sy: this.height / 2, wx: -x / zoom, wy: -y / zoom };
      if (!animated || this.reducedMotion) {
        this.camTween = null;
        this.camera = { x, y, zoom };
        this.transformChanged();
        return;
      }
      this.animateCamera({ x, y, zoom });
    }

    approachZoom(node) {
      if (!node) return 1;
      if (node.data.kind === "line") return 2.05;
      if (node.data.kind === "order") return 1.36;
      return 1.16;
    }

    approach(node) {
      if (!node) return;
      const want = this.approachZoom(node);
      const onTarget = Math.hypot(this.orbit.targetX - node.x, this.orbit.targetY - node.y) < 10;
      const zoomOk = Math.abs((this.camera.zoom || 1) - want) < 0.08;
      const centered = Math.hypot(this.camera.x, this.camera.y) < 28;
      if (this.selected === node && onTarget && zoomOk && centered) {
        this.viewPinned = true;
        return;
      }
      this.viewPinned = true;
      this.idleUntil = performance.now() + 2600;
      if (this.is3d() || this.options.space3d) this.flyAround(node, { spin: false });
      else {
        this.lockOrbitTarget(node.x, node.y, node.z || 36);
        this.animateCamera({ x: -node.x * want, y: -node.y * want, zoom: want }, 860);
      }
    }

    focus(id) {
      const node = this.findNode(id);
      if (!node) return;
      this.select(node);
      this.approach(node);
    }

    findNode(id) {
      if (!id) return null;
      return this.nodeMap.get(id)
        || this.nodeMap.get(`order:${id}`)
        || this.nodes.find((n) => n.data.rawId === id || n.data.orderId === id)
        || null;
    }

    flyAround(node, { spin = false } = {}) {
      if (!node) return;
      this.viewPinned = true;
      this.camTween = null;
      const z = (node.z || 0) * this.spaceMix || 8;
      const from = {
        yaw: this.orbit.yaw,
        pitch: this.orbit.pitch,
        zoom: this.camera.zoom || 1,
        x: this.camera.x,
        y: this.camera.y,
        tx: this.orbit.targetX,
        ty: this.orbit.targetY,
        tz: this.orbit.targetZ,
      };
      const dist = Math.hypot(node.x - from.tx, node.y - from.ty, z - from.tz) + Math.hypot(from.x, from.y);
      this.orbitTween = {
        from,
        to: {
          yaw: spin ? from.yaw + 0.55 + (node.phase || 0) * 0.18 : from.yaw,
          pitch: from.pitch,
          zoom: this.approachZoom(node),
          x: 0,
          y: 0,
          tx: node.x,
          ty: node.y,
          tz: z,
        },
        start: performance.now(),
        duration: this.reducedMotion ? 0 : spin ? 1320 : clamp(640 + dist * 0.55, 820, 1600),
      };
      this.zoomTarget = this.orbitTween.to.zoom;
      this.idleUntil = performance.now() + 2800;
      this.needsFrame = true;
    }

    startTour() {
      const hotspots = this.nodes
        .filter((n) => n.data.debt > 0.005)
        .sort((a, b) => b.data.debt - a.data.debt)
        .slice(0, 8);
      const path = hotspots.length ? hotspots : this.nodes.filter((n) => n.data.kind === "order").slice(0, 6);
      if (!path.length) return false;
      this.stopTour();
      this.tour = { path, index: 0 };
      this.visitTour();
      return true;
    }

    visitTour() {
      if (!this.tour) return;
      const node = this.tour.path[this.tour.index];
      if (!node) {
        this.stopTour();
        return;
      }
      this.select(node);
      this.idleUntil = performance.now() + 2800;
      if (this.is3d() || this.options.space3d) this.flyAround(node, { spin: true });
      else {
        this.lockOrbitTarget(node.x, node.y, node.z || 36);
        this.animateCamera({ x: -node.x * 1.35, y: -node.y * 1.35, zoom: 1.35 }, 860);
      }
      this.tour.timer = setTimeout(() => {
        if (!this.tour) return;
        this.tour.index += 1;
        if (this.tour.index >= this.tour.path.length) this.tour.index = 0;
        this.visitTour();
      }, 2400);
    }

    stopTour() {
      if (!this.tour) return;
      clearTimeout(this.tour.timer);
      this.tour = null;
    }

    walk(dir) {
      const pool = this.nodes.filter((n) => !this.selected || n.data.kind === this.selected.data.kind || this.hot.has(n.data.id));
      if (!pool.length) return;
      const ranked = pool.slice().sort((a, b) => a.x * 0.7 + a.y * 0.3 - (b.x * 0.7 + b.y * 0.3));
      const current = this.selected || ranked[0];
      const idx = Math.max(0, ranked.indexOf(current));
      const next = ranked[(idx + (dir > 0 ? 1 : ranked.length - 1)) % ranked.length];
      if (next) this.focus(next.data.id);
    }

    animateCamera(target, duration) {
      this.camTween = {
        from: { ...this.camera },
        to: { x: target.x, y: target.y, zoom: clamp(target.zoom, 0.14, 5.4) },
        start: performance.now(),
        duration: this.reducedMotion ? 0 : (duration ?? 780),
      };
      this.zoomTarget = this.camTween.to.zoom;
      this.zoomAnchor = {
        sx: this.width / 2,
        sy: this.height / 2,
        wx: -target.x / Math.max(target.zoom, 0.14),
        wy: -target.y / Math.max(target.zoom, 0.14),
      };
      this.needsFrame = true;
    }

    zoomAt(factor, sx, sy) {
      const pivot = sx == null || sy == null ? this.zoomFocusScreen() : { sx, sy };
      this.aimZoom(this.zoomTarget * factor, pivot.sx, pivot.sy);
    }

    transformChanged() {
      this.needsFrame = true;
      this.onTransform({ ...this.camera });
    }

    eventPoint(e) {
      const rect = this.canvas.getBoundingClientRect();
      const sx = e.clientX - rect.left;
      const sy = e.clientY - rect.top;
      return {
        sx,
        sy,
        wx: (sx - this.width / 2 - this.camera.x) / this.camera.zoom,
        wy: (sy - this.height / 2 - this.camera.y) / this.camera.zoom,
      };
    }

    hit(x, y) {
      let best = null;
      let bestD = Infinity;
      const padding = 8 / this.camera.zoom;
      this.nodes.forEach((n) => {
        const dx = Math.abs(x - n.x);
        const dy = Math.abs(y - n.y);
        const d = dx * dx + dy * dy;
        const rad = n.r + padding;
        if (d <= rad * rad && d < bestD) {
          best = n;
          bestD = d;
        }
      });
      return best;
    }

    hitScreen(sx, sy) {
      let best = null;
      let bestDepth = Infinity;
      this.nodes.forEach((n) => {
        const z = (n.z || 0) * this.spaceMix + this.volumeHeight(n) * 0.7;
        const p = this.project(n.x, n.y, z);
        if (!p.visible) return;
        const r = Math.max(8, (n.r || 6) * p.s);
        const dx = sx - p.x;
        const dy = sy - p.y;
        if (dx * dx + dy * dy <= (r + 10) ** 2 && p.depth < bestDepth) {
          best = n;
          bestDepth = p.depth;
        }
      });
      return best;
    }

    pickNode(point) {
      return this.is3d() ? this.hitScreen(point.sx, point.sy) : this.hit(point.wx, point.wy);
    }

    pointerDown(e) {
      if (e.button !== 0 && e.button !== 1) return;
      if (e.button === 1) e.preventDefault();
      this.stopTour();
      this.settleZoom();
      const point = this.eventPoint(e);
      const node = e.button === 1 ? null : this.pickNode(point);
      this.pointer = point;
      this.pendingCapture = e.pointerId;
      this.panVel.x = 0;
      this.panVel.y = 0;
      this.orbitVel.yaw = 0;
      this.orbitVel.pitch = 0;
      this.idleUntil = performance.now() + 2400;
      if (e.button === 1) {
        this.absorbScreenPanIntoOrbit();
        this.drag = { type: "pan", moved: false, lastSx: point.sx, lastSy: point.sy };
      } else if (this.is3d() && !node) {
        this.prepareOrbitPivot();
        const yaw = this.orbit.yaw;
        this.drag = {
          type: "orbit",
          yaw,
          pitch: this.orbit.pitch,
          moved: false,
          cam: this.cameraWorld(),
          target: { x: this.orbit.targetX, y: this.orbit.targetY, z: this.orbit.targetZ },
          pivot: { ...(this.orbitPivot || this.worldAtScreenCenter()) },
          right: { x: Math.cos(yaw), y: -Math.sin(yaw), z: 0 },
        };
      } else if (node) {
        this.drag = { type: "node", node, startX: node.x, startY: node.y, lastSx: point.sx, lastSy: point.sy, moved: false };
        node.pinned = true;
        this.select(node);
      } else {
        this.drag = { type: "pan", moved: false, lastSx: point.sx, lastSy: point.sy };
      }
      this.syncZoomAnchor();
    }

    pointerMove(e) {
      const point = this.eventPoint(e);
      if (this.drag && this.pointer) {
        const dx = point.sx - this.pointer.sx;
        const dy = point.sy - this.pointer.sy;
        if (Math.abs(dx) + Math.abs(dy) > 3) {
          this.drag.moved = true;
          if (this.pendingCapture != null) {
            try {
              this.canvas.setPointerCapture(this.pendingCapture);
            } catch {
              /* already captured */
            }
            this.pendingCapture = null;
            this.canvas.classList.add("is-panning");
          }
        }
        if (this.drag.type === "orbit") {
          this.applyOrbitAroundPivot(dx, dy, this.drag);
          this.orbitVel.yaw = -(point.sx - (this.drag.lastSx ?? point.sx)) * 0.00042;
          this.orbitVel.pitch = -(point.sy - (this.drag.lastSy ?? point.sy)) * 0.00028;
          this.drag.lastSx = point.sx;
          this.drag.lastSy = point.sy;
          this.idleUntil = performance.now() + 2400;
          this.transformChanged();
        } else if (this.drag.type === "pan") {
          const ddx = point.sx - (this.drag.lastSx ?? point.sx);
          const ddy = point.sy - (this.drag.lastSy ?? point.sy);
          this.panCamera(ddx, ddy);
          this.panVel.x = ddx;
          this.panVel.y = ddy;
          this.drag.lastSx = point.sx;
          this.drag.lastSy = point.sy;
          this.syncZoomAnchor();
          this.transformChanged();
        } else if (this.is3d()) {
          const step = this.worldDeltaFromScreen(this.drag.node, point.sx - this.drag.lastSx, point.sy - this.drag.lastSy);
          this.drag.node.x += step.x;
          this.drag.node.y += step.y;
          this.drag.node.tx = this.drag.node.x;
          this.drag.node.ty = this.drag.node.y;
          this.drag.lastSx = point.sx;
          this.drag.lastSy = point.sy;
          this.alpha = Math.max(this.alpha, 0.14);
          this.needsFrame = true;
        } else {
          this.drag.node.x = this.drag.startX + dx / this.camera.zoom;
          this.drag.node.y = this.drag.startY + dy / this.camera.zoom;
          this.drag.node.tx = this.drag.node.x;
          this.drag.node.ty = this.drag.node.y;
          this.alpha = Math.max(this.alpha, 0.14);
          this.needsFrame = true;
        }
        return;
      }
      this.setHover(this.pickNode(point), { x: point.sx, y: point.sy });
    }

    pointerUp(e) {
      if (!this.drag) return;
      const was = this.drag;
      if (was.type === "node") {
        was.node.pinned = false;
        if (!was.moved) {
          this.select(was.node);
          this.approach(was.node);
        }
      } else if (!was.moved) {
        this.select(null);
      }
      this.drag = null;
      this.pointer = null;
      this.pendingCapture = null;
      this.canvas.classList.remove("is-panning");
      this.syncZoomAnchor();
      try {
        this.canvas.releasePointerCapture(e.pointerId);
      } catch {
        /* already released */
      }
      this.alpha = Math.max(this.alpha, 0.08);
      this.needsFrame = true;
    }

    setHover(node, point) {
      if (node === this.hovered) {
        if (node) this.onHover(node.data, point);
        return;
      }
      this.hovered = node;
      this.canvas.classList.toggle("has-node", !!node);
      this.buildHot();
      this.onHover(node?.data || null, point);
      this.needsFrame = true;
    }

    select(node) {
      this.selected = node;
      if (!node) this.viewPinned = false;
      this.buildHot();
      this.onSelect(node?.data || null);
      this.needsFrame = true;
    }

    edgeIsHot(edge) {
      if (!this.selected || !edge?.source || !edge?.target) return false;
      if (edge.source === this.selected || edge.target === this.selected) return true;
      return this.hot.has(edge.source.data.id) && this.hot.has(edge.target.data.id);
    }

    buildHot() {
      this.hot.clear();
      const focus = this.selected || this.hovered;
      if (!focus) return;
      let cur = focus;
      const seen = new Set();
      while (cur && !seen.has(cur.data.id)) {
        seen.add(cur.data.id);
        this.hot.add(cur.data.id);
        cur = cur.data.parent ? this.nodeMap.get(cur.data.parent) : null;
      }
      this.edges.forEach((edge) => {
        if (edge.source === focus) this.hot.add(edge.target.data.id);
        if (edge.target === focus) this.hot.add(edge.source.data.id);
      });
      this.bridges.forEach((edge) => {
        if (edge.source === focus) this.hot.add(edge.target.data.id);
        if (edge.target === focus) this.hot.add(edge.source.data.id);
      });
    }

    destroy() {
      this.stopTour();
      cancelAnimationFrame(this.frame);
      this.resizeObserver.disconnect();
    }
  }

  window.FinOrderCloud = {
    create(config) {
      return new OrderCloud(config);
    },
  };
})();
