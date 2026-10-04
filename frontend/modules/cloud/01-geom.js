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


/* bundle-seam */
})();
