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

  const hexToRgba = (hex, alpha) => {
    const raw = String(hex || "#64748b").replace("#", "");
    const value = raw.length === 3 ? raw.split("").map((c) => c + c).join("") : raw;
    const n = Number.parseInt(value, 16);
    if (!Number.isFinite(n)) return `rgba(100,116,139,${alpha})`;
    return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${alpha})`;
  };

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
      this.panVel = { x: 0, y: 0 };
      this.options = { layout: "galaxy", labels: true, motion: true, heat: false, query: "" };
      this.hovered = null;
      this.selected = null;
      this.pointer = null;
      this.drag = null;
      this.hot = new Set();
      this.matches = new Set();
      this.frame = 0;
      this.alpha = 1;
      this.lastTime = performance.now();
      this.needsFrame = true;
      this.tour = null;
      this.heat = { grid: null, cols: 0, rows: 0, box: null };
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
        const rect = this.canvas.getBoundingClientRect();
        let dy = e.deltaY;
        if (e.deltaMode === 1) dy *= 16;
        if (e.deltaMode === 2) dy *= this.height;
        const pixels = Math.max(-140, Math.min(140, dy));
        this.aimZoom(this.zoomTarget * Math.exp(-pixels * 0.00092), e.clientX - rect.left, e.clientY - rect.top);
      }, { passive: false });
      this.canvas.addEventListener("dblclick", (e) => {
        const point = this.eventPoint(e);
        const node = this.hit(point.wx, point.wy);
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
        this.zoomAt(1.22, this.width / 2, this.height / 2);
      } else if (e.key === "-") {
        e.preventDefault();
        this.zoomAt(1 / 1.22, this.width / 2, this.height / 2);
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
          vx: 0,
          vy: 0,
          pinned: false,
          phase: hash(data.id) / 4294967295,
        };
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
      if (this.selected && !this.nodeMap.has(this.selected.data.id)) this.select(null);
      else if (this.selected) this.selected = this.nodeMap.get(this.selected.data.id);
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
      this.needsFrame = true;
    }

    calculateTargets() {
      const layout = this.options.layout;
      const customers = this.nodes.filter((n) => n.data.kind === "customer");
      const orders = this.nodes.filter((n) => n.data.kind === "order");
      const lines = this.nodes.filter((n) => n.data.kind === "line");
      const byCustomer = new Map(customers.map((n, i) => [n.data.id, { node: n, index: i, orders: [] }]));
      orders.forEach((n) => byCustomer.get(n.data.parent)?.orders.push(n));

      if (layout === "timeline") {
        const dated = orders.filter((n) => Number.isFinite(n.data.time));
        const times = dated.map((n) => n.data.time);
        const min = Math.min(...times, Date.now());
        const max = Math.max(...times, min + 86400000);
        const values = orders.map((n) => Math.log1p(Math.max(0, n.data.value || 0)));
        const maxValue = Math.max(...values, 1);
        customers.forEach((n, i) => {
          n.tx = -520;
          n.ty = (i - (customers.length - 1) / 2) * 78;
        });
        orders.forEach((n) => {
          const ratio = Number.isFinite(n.data.time) ? (n.data.time - min) / (max - min || 1) : 0.15;
          n.tx = -380 + ratio * 860;
          n.ty = 270 - (Math.log1p(Math.max(0, n.data.value || 0)) / maxValue) * 540 + jitter(n.data.id, 7) * 12;
        });
        const kids = new Map();
        lines.forEach((n) => {
          const list = kids.get(n.data.parent) || [];
          list.push(n);
          kids.set(n.data.parent, list);
        });
        kids.forEach((group) => {
          group.forEach((n, i) => {
            const parent = this.nodeMap.get(n.data.parent);
            const a = (i / Math.max(1, group.length)) * Math.PI - Math.PI / 2;
            n.tx = (parent?.tx || 0) + Math.cos(a) * 26;
            n.ty = (parent?.ty || 0) + 38 + Math.sin(a) * 10 + i * 4;
          });
        });
        this.timeline = { min, max, maxValue };
        return;
      }

      if (layout === "orbit") {
        const customerCount = Math.max(1, customers.length);
        customers.forEach((n, i) => {
          const a = (i / customerCount) * TAU - Math.PI / 2;
          const ring = 90 + customerCount * 6;
          n.tx = Math.cos(a) * ring;
          n.ty = Math.sin(a) * ring;
        });
        orders.forEach((n, i) => {
          const a = i * GOLDEN;
          const ring = 200 + Math.sqrt(i + 1) * 34;
          n.tx = Math.cos(a) * ring;
          n.ty = Math.sin(a) * ring;
        });
        lines.forEach((n) => {
          const parent = this.nodeMap.get(n.data.parent);
          const siblings = lines.filter((x) => x.data.parent === n.data.parent);
          const at = Math.max(0, siblings.indexOf(n));
          const a = (at / Math.max(1, siblings.length)) * TAU + jitter(n.data.parent, 8);
          const ring = 44 + Math.min(30, siblings.length * 2.2);
          n.tx = (parent?.tx || 0) + Math.cos(a) * ring;
          n.ty = (parent?.ty || 0) + Math.sin(a) * ring;
        });
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
        types.forEach((group, type) => {
          const c = centers.get(type);
          group.forEach((n, i) => {
            const parent = this.nodeMap.get(n.data.parent);
            const a = i * GOLDEN;
            const ring = 22 + Math.sqrt(i + 1) * 16;
            n.tx = lerp(parent?.tx || 0, c.x, 0.35) + Math.cos(a) * ring;
            n.ty = lerp(parent?.ty || 0, c.y, 0.35) + Math.sin(a) * ring;
          });
        });
        return;
      }

      customers.forEach((n, i) => {
        const a = i * GOLDEN;
        const radius = i ? 140 + Math.sqrt(i) * 165 : 0;
        n.tx = Math.cos(a) * radius;
        n.ty = Math.sin(a) * radius * 0.74;
        const group = byCustomer.get(n.data.id);
        const count = group?.orders.length || 0;
        (group?.orders || []).forEach((order, oi) => {
          const oa = (oi / Math.max(1, count)) * TAU + jitter(n.data.id, 5) * 0.8;
          const ring = 72 + Math.floor(oi / 8) * 58;
          order.tx = n.tx + Math.cos(oa) * ring;
          order.ty = n.ty + Math.sin(oa) * ring;
        });
      });
      const kids = new Map();
      lines.forEach((n) => {
        const list = kids.get(n.data.parent) || [];
        list.push(n);
        kids.set(n.data.parent, list);
      });
      kids.forEach((group) => {
        group.forEach((n, i) => {
          const parent = this.nodeMap.get(n.data.parent);
          const a = (i / Math.max(1, group.length)) * TAU + jitter(n.data.id, 11);
          const ring = 30 + Math.min(34, group.length * 2.4);
          n.tx = (parent?.tx || 0) + Math.cos(a) * ring;
          n.ty = (parent?.ty || 0) + Math.sin(a) * ring;
        });
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
      if (!this.options.motion || this.reducedMotion || this.alpha < 0.002) return;
      const alpha = this.alpha;
      this.grid.clear();
      this.nodes.forEach((n) => this.grid.add(n));

      this.nodes.forEach((n) => {
        if (n.pinned) return;
        const targetStrength = this.options.layout === "galaxy" ? 0.0062 : 0.013;
        n.vx += (n.tx - n.x) * targetStrength * alpha * step;
        n.vy += (n.ty - n.y) * targetStrength * alpha * step;
        this.grid.near(n.x, n.y, 1).forEach((other) => {
          if (other.index <= n.index) return;
          let dx = other.x - n.x;
          let dy = other.y - n.y;
          let d2 = dx * dx + dy * dy;
          if (d2 < 0.01) {
            dx = jitter(n.data.id, other.index) * 0.25;
            dy = jitter(other.data.id, n.index) * 0.25;
            d2 = dx * dx + dy * dy;
          }
          const d = Math.sqrt(d2);
          const min = n.r + other.r + (n.data.kind === "customer" || other.data.kind === "customer" ? 16 : 7);
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
        const ideal = edge.kind === "customer" ? 84 : 44;
        const force = (dist - ideal) * (edge.kind === "customer" ? 0.0019 : 0.0031) * alpha * step;
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

    loop(time) {
      const dt = time - this.lastTime;
      this.lastTime = time;
      const moving = this.stepCamera(dt);
      const live = this.options.motion && !this.reducedMotion && (this.alpha > 0.002 || this.matches.size || this.edges.length);
      if (this.needsFrame || live || this.drag || this.tour || moving) {
        this.simulate(dt);
        this.draw(time);
        this.needsFrame = false;
      }
      this.frame = requestAnimationFrame(this.loop);
    }

    stepCamera(dt) {
      const step = Math.min(1.8, dt / 16.67);
      let moving = false;
      if (this.camTween) {
        moving = this.stepTween() || moving;
      } else if (!this.drag) {
        moving = this.easeZoom(dt) || moving;
      }
      if (!this.drag && (Math.abs(this.panVel.x) > 0.12 || Math.abs(this.panVel.y) > 0.12)) {
        this.camera.x += this.panVel.x * step;
        this.camera.y += this.panVel.y * step;
        this.panVel.x *= 0.9 ** step;
        this.panVel.y *= 0.9 ** step;
        this.transformChanged();
        moving = true;
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

    aimZoom(target, sx, sy) {
      this.camTween = null;
      const zoom = this.camera.zoom || 1;
      this.zoomTarget = clamp(target, 0.14, 5.4);
      this.zoomAnchor = {
        sx,
        sy,
        wx: (sx - this.width / 2 - this.camera.x) / zoom,
        wy: (sy - this.height / 2 - this.camera.y) / zoom,
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

    draw(time) {
      const ctx = this.ctx;
      const t = this.theme();
      ctx.save();
      ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
      this.drawSpace(ctx, t);
      ctx.translate(this.width / 2 + this.camera.x, this.height / 2 + this.camera.y);
      ctx.scale(this.camera.zoom, this.camera.zoom);
      if (this.options.heat) this.drawHeat(ctx);
      if (this.options.layout === "timeline") this.drawTimeline(ctx, t);
      this.drawHulls(ctx, t);
      this.drawBridges(ctx, t, time);
      this.drawEdges(ctx, t, time);
      this.drawNodes(ctx, t, time);
      ctx.restore();
      this.drawMinimap(t);
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

    drawHeat(ctx) {
      if (!this.nodes.length) return;
      const box = this.bounds();
      const cols = 52;
      const rows = 34;
      const cells = new Float32Array(cols * rows);
      let peak = 0.0001;
      this.nodes.forEach((n) => {
        const w = Math.max(0, n.data.debt || 0);
        if (w < 0.01) return;
        const gx = ((n.x - box.minX) / Math.max(1, box.width)) * (cols - 1);
        const gy = ((n.y - box.minY) / Math.max(1, box.height)) * (rows - 1);
        const radius = 2.4;
        const x0 = Math.max(0, Math.floor(gx - radius));
        const x1 = Math.min(cols - 1, Math.ceil(gx + radius));
        const y0 = Math.max(0, Math.floor(gy - radius));
        const y1 = Math.min(rows - 1, Math.ceil(gy + radius));
        for (let y = y0; y <= y1; y += 1) {
          for (let x = x0; x <= x1; x += 1) {
            const d2 = (x - gx) ** 2 + (y - gy) ** 2;
            const add = w * Math.exp(-d2 / 2.1);
            const i = y * cols + x;
            cells[i] += add;
            if (cells[i] > peak) peak = cells[i];
          }
        }
      });
      const cw = box.width / cols;
      const ch = box.height / rows;
      for (let y = 0; y < rows; y += 1) {
        for (let x = 0; x < cols; x += 1) {
          const t = cells[y * cols + x] / peak;
          if (t < 0.06) continue;
          ctx.fillStyle = t > 0.72 ? "rgba(220,38,38,0.22)" : t > 0.4 ? "rgba(245,158,11,0.16)" : "rgba(14,165,233,0.1)";
          ctx.fillRect(box.minX + x * cw, box.minY + y * ch, cw + 0.5, ch + 0.5);
        }
      }
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
        const hot = selected && (edge.source === selected || edge.target === selected);
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
        const hot = !!(selected && (edge.source === selected || edge.target === selected));
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
          arrows: true,
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

        const fill = ctx.createLinearGradient(node.x - r, node.y - r, node.x + r, node.y + r);
        fill.addColorStop(0, hexToRgba(color, theme.dark ? 0.92 : 0.95));
        fill.addColorStop(1, hexToRgba(color, theme.dark ? 0.72 : 0.78));
        ctx.fillStyle = fill;
        ctx.strokeStyle = hexToRgba(color, selected ? 0.95 : 0.5);
        ctx.lineWidth = (selected ? 1.5 : 1) / zoom;
        ctx.beginPath();
        if (node.data.kind === "customer") {
          ctx.arc(node.x, node.y, r, 0, TAU);
          ctx.fill();
          ctx.stroke();
          ctx.beginPath();
          ctx.arc(node.x, node.y, Math.max(3, r * 0.38), 0, TAU);
          ctx.fillStyle = theme.bg;
          ctx.fill();
        } else if (node.data.kind === "order") {
          this.roundedBox(ctx, node.x, node.y, r * 1.7, r * 1.15, 2.2 / zoom);
          ctx.fill();
          ctx.stroke();
        } else {
          this.roundedBox(ctx, node.x, node.y, r * 1.15, r * 1.15, 1.2 / zoom);
          ctx.fill();
          ctx.stroke();
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
        if (this.options.labels && mustLabel) this.drawLabel(ctx, node, theme, zoom, selected || hovered || node.match);
      });
      ctx.globalAlpha = 1;
    }

    roundedBox(ctx, x, y, w, h, radius) {
      const rw = w / 2;
      const rh = h / 2;
      ctx.roundRect(x - rw, y - rh, w, h, radius);
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
      const box = this.bounds(nodes);
      const zoom = clamp(Math.min((this.width - 110) / Math.max(80, box.width), (this.height - 100) / Math.max(80, box.height)), 0.18, 2.5);
      const x = -((box.minX + box.maxX) / 2) * zoom;
      const y = -((box.minY + box.maxY) / 2) * zoom;
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

    focus(id) {
      const node = this.nodeMap.get(id);
      if (!node) return;
      this.select(node);
      this.animateCamera({ x: -node.x * 1.5, y: -node.y * 1.5, zoom: 1.5 });
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
      this.animateCamera({ x: -node.x * 1.35, y: -node.y * 1.35, zoom: 1.35 });
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

    animateCamera(target) {
      this.camTween = {
        from: { ...this.camera },
        to: { x: target.x, y: target.y, zoom: clamp(target.zoom, 0.14, 5.4) },
        start: performance.now(),
        duration: this.reducedMotion ? 0 : 520,
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
      this.aimZoom(this.zoomTarget * factor, sx, sy);
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
        const inside = n.data.kind === "order"
          ? dx <= n.r * 0.9 + padding && dy <= n.r * 0.62 + padding
          : n.data.kind === "line"
            ? dx <= n.r * 0.65 + padding && dy <= n.r * 0.65 + padding
            : dx * dx + dy * dy <= (n.r + padding) ** 2;
        const d = dx * dx + dy * dy;
        if (inside && d < bestD) {
          best = n;
          bestD = d;
        }
      });
      return best;
    }

    pointerDown(e) {
      if (e.button !== 0) return;
      this.stopTour();
      const point = this.eventPoint(e);
      const node = this.hit(point.wx, point.wy);
      this.canvas.setPointerCapture(e.pointerId);
      this.pointer = point;
      this.panVel.x = 0;
      this.panVel.y = 0;
      this.drag = node
        ? { type: "node", node, startX: node.x, startY: node.y, moved: false }
        : { type: "pan", x: this.camera.x, y: this.camera.y, moved: false, lastSx: point.sx, lastSy: point.sy };
      if (node) {
        node.pinned = true;
        this.select(node);
      }
      this.canvas.classList.add("is-dragging");
    }

    pointerMove(e) {
      const point = this.eventPoint(e);
      if (this.drag && this.pointer) {
        const dx = point.sx - this.pointer.sx;
        const dy = point.sy - this.pointer.sy;
        if (Math.abs(dx) + Math.abs(dy) > 3) this.drag.moved = true;
        if (this.drag.type === "pan") {
          this.camera.x = this.drag.x + dx;
          this.camera.y = this.drag.y + dy;
          this.panVel.x = point.sx - (this.drag.lastSx ?? point.sx);
          this.panVel.y = point.sy - (this.drag.lastSy ?? point.sy);
          this.drag.lastSx = point.sx;
          this.drag.lastSy = point.sy;
          this.transformChanged();
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
      this.setHover(this.hit(point.wx, point.wy), { x: point.sx, y: point.sy });
    }

    pointerUp(e) {
      if (!this.drag) return;
      const was = this.drag;
      if (was.type === "node") {
        was.node.pinned = false;
        if (!was.moved) this.select(was.node);
      } else if (!was.moved) {
        this.select(null);
      }
      this.drag = null;
      this.pointer = null;
      this.canvas.classList.remove("is-dragging");
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
      this.buildHot();
      this.onSelect(node?.data || null);
      this.needsFrame = true;
    }

    buildHot() {
      this.hot.clear();
      const focus = this.selected || this.hovered;
      if (!focus) return;
      this.hot.add(focus.data.id);
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
