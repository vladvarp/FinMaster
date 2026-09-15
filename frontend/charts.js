const FinCharts = (() => {
  const instances = new WeakMap();
  const DUR = 560;
  let CURRENCY = "₽";

  const nfInt = new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 0 });
  const nfMoney = new Intl.NumberFormat("ru-RU", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  const reduceMotion = () => window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

  function cssVar(name, fallback) {
    const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    return v || fallback;
  }

  const isDark = () => document.documentElement.getAttribute("data-theme") === "dark";
  const ink = () => cssVar("--ink", "#0f172a");
  const muted = () => cssVar("--muted", "#64748b");
  const surface = () => cssVar("--card", "#ffffff");
  const gridColor = () => (isDark() ? "rgba(226,232,240,0.10)" : "rgba(15,23,42,0.07)");
  const axisColor = () => (isDark() ? "rgba(226,232,240,0.18)" : "rgba(15,23,42,0.14)");

  function fmtMoney(v) {
    return `${nfMoney.format(Number(v) || 0)} ${CURRENCY}`;
  }

  function fmtCount(v) {
    return nfInt.format(Math.round(Number(v) || 0));
  }

  function fmtCompact(v) {
    const n = Number(v) || 0;
    const abs = Math.abs(n);
    const dec = (x, d) => x.toFixed(d).replace(".", ",").replace(",0", "");
    if (abs >= 1e9) return `${dec(n / 1e9, 1)} млрд`;
    if (abs >= 1e6) return `${dec(n / 1e6, 1)} млн`;
    if (abs >= 1e4) return `${dec(n / 1e3, 0)} тыс`;
    if (abs >= 1e3) return `${dec(n / 1e3, 1)} тыс`;
    return nfInt.format(n);
  }

  const fmtValue = (v, kind) => (kind === "count" ? fmtCount(v) : fmtMoney(v));
  const fmtAxis = (v, kind) => (kind === "count" ? fmtCount(v) : fmtCompact(v));

  function hexToRgb(hex) {
    const raw = String(hex || "#0f766e").replace("#", "");
    if (raw.length === 3) {
      return [0, 1, 2].map((i) => parseInt(raw[i] + raw[i], 16));
    }
    if (raw.length < 6) return [15, 118, 110];
    return [0, 2, 4].map((i) => parseInt(raw.slice(i, i + 2), 16));
  }

  function rgba(hex, alpha) {
    const [r, g, b] = hexToRgb(hex);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  }

  function mix(hex, amount) {
    const [r, g, b] = hexToRgb(hex);
    const to = amount > 0 ? 255 : 0;
    const t = Math.abs(amount);
    const ch = (c) => Math.round(c + (to - c) * t);
    return `rgb(${ch(r)}, ${ch(g)}, ${ch(b)})`;
  }

  function niceMax(v) {
    if (!Number.isFinite(v) || v <= 0) return 1;
    const p = 10 ** Math.floor(Math.log10(v));
    const n = v / p;
    const nice = n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10;
    return nice * p;
  }

  const easeOut = (t) => 1 - (1 - t) ** 3;
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

  function roundRect(ctx, x, y, w, h, r) {
    const rr = Math.max(0, Math.min(r, w / 2, h / 2));
    ctx.beginPath();
    ctx.moveTo(x + rr, y);
    ctx.arcTo(x + w, y, x + w, y + h, rr);
    ctx.arcTo(x + w, y + h, x, y + h, rr);
    ctx.arcTo(x, y + h, x, y, rr);
    ctx.arcTo(x, y, x + w, y, rr);
    ctx.closePath();
  }

  function topRoundRect(ctx, x, y, w, h, r) {
    const rr = Math.max(0, Math.min(r, w / 2, h));
    ctx.beginPath();
    ctx.moveTo(x, y + h);
    ctx.lineTo(x, y + rr);
    ctx.quadraticCurveTo(x, y, x + rr, y);
    ctx.lineTo(x + w - rr, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + rr);
    ctx.lineTo(x + w, y + h);
    ctx.closePath();
  }

  function smoothPath(ctx, pts) {
    ctx.moveTo(pts[0].x, pts[0].y);
    if (pts.length === 2) {
      ctx.lineTo(pts[1].x, pts[1].y);
      return;
    }
    for (let i = 0; i < pts.length - 1; i++) {
      const p0 = pts[i - 1] || pts[i];
      const p1 = pts[i];
      const p2 = pts[i + 1];
      const p3 = pts[i + 2] || p2;
      const lo = Math.min(p1.y, p2.y);
      const hi = Math.max(p1.y, p2.y);
      const c1x = p1.x + (p2.x - p0.x) / 6;
      const c1y = clamp(p1.y + (p2.y - p0.y) / 6, lo, hi);
      const c2x = p2.x - (p3.x - p1.x) / 6;
      const c2y = clamp(p2.y - (p3.y - p1.y) / 6, lo, hi);
      ctx.bezierCurveTo(c1x, c1y, c2x, c2y, p2.x, p2.y);
    }
  }

  function size(canvas) {
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    const w = Math.max(160, rect.width || canvas.clientWidth || 320);
    const h = Math.max(140, rect.height || canvas.clientHeight || 240);
    const cw = Math.round(w * dpr);
    const chh = Math.round(h * dpr);
    if (canvas.width !== cw || canvas.height !== chh) {
      canvas.width = cw;
      canvas.height = chh;
    }
    const ctx = canvas.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    return { ctx, w, h };
  }

  function drawEmpty(ctx, w, h, text) {
    ctx.fillStyle = muted();
    ctx.font = "13px Segoe UI, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(text, w / 2, h / 2);
  }

  /* ============ tooltip ============ */

  function tipEl(inst) {
    const host = inst.canvas.parentElement;
    if (!host) return null;
    if (inst.tip && inst.tip.isConnected) return inst.tip;
    const el = document.createElement("div");
    el.className = "fin-tip";
    host.appendChild(el);
    inst.tip = el;
    return el;
  }

  function showTip(inst, html, x, y) {
    const el = tipEl(inst);
    if (!el) return;
    el.innerHTML = html;
    el.classList.add("show");
    const host = inst.canvas.parentElement;
    const hw = host.clientWidth;
    const left = clamp(x - el.offsetWidth / 2, 6, Math.max(6, hw - el.offsetWidth - 6));
    const top = Math.max(6, y - el.offsetHeight - 14);
    el.style.transform = `translate(${Math.round(left)}px, ${Math.round(top)}px)`;
  }

  function hideTip(inst) {
    inst.tip?.classList.remove("show");
  }

  function tipRow(color, label, value) {
    return `<div class="fin-tip-row"><i style="background:${color}"></i><span>${label}</span><b>${value}</b></div>`;
  }

  /* ============ instances ============ */

  function getInst(canvas, type) {
    let inst = instances.get(canvas);
    if (!inst) {
      inst = { canvas, type, from: [], current: [], target: [], hover: null, raf: 0, tip: null, geom: null, opts: null };
      instances.set(canvas, inst);
      bindEvents(inst);
    }
    if (inst.type !== type) {
      inst.type = type;
      inst.from = [];
    }
    return inst;
  }

  function bindEvents(inst) {
    const canvas = inst.canvas;
    canvas.addEventListener("pointermove", (e) => {
      const rect = canvas.getBoundingClientRect();
      inst.pointer = { x: e.clientX - rect.left, y: e.clientY - rect.top };
      hitTest(inst);
    });
    canvas.addEventListener("pointerleave", () => {
      inst.pointer = null;
      if (inst.hover !== null) {
        inst.hover = null;
        draw(inst);
      }
      hideTip(inst);
    });
    if (window.ResizeObserver) {
      const ro = new ResizeObserver(() => {
        if (inst.opts) draw(inst);
      });
      ro.observe(canvas);
    }
  }

  function update(inst, targets, opts) {
    inst.opts = opts;
    inst.target = targets.map((row) => row.slice());
    if (!inst.from.length || reduceMotion()) {
      inst.from = targets.map((row) => row.map(() => 0));
      if (reduceMotion()) inst.from = targets.map((row) => row.slice());
    }
    inst.from = inst.target.map((row, i) => row.map((_, j) => (inst.current[i]?.[j] ?? inst.from[i]?.[j] ?? 0)));
    animate(inst);
  }

  function animate(inst) {
    cancelAnimationFrame(inst.raf);
    const start = performance.now();
    const step = (now) => {
      const t = reduceMotion() ? 1 : Math.min(1, (now - start) / DUR);
      const e = easeOut(t);
      inst.current = inst.target.map((row, i) => row.map((v, j) => {
        const f = inst.from[i]?.[j] ?? 0;
        return f + (v - f) * e;
      }));
      draw(inst);
      if (t < 1) inst.raf = requestAnimationFrame(step);
      else inst.current = inst.target.map((row) => row.slice());
    };
    inst.raf = requestAnimationFrame(step);
  }

  function draw(inst) {
    if (!inst.opts) return;
    if (inst.type === "line") drawLine(inst);
    else if (inst.type === "bar") drawBar(inst);
    else drawDoughnut(inst);
  }

  function hitTest(inst) {
    if (!inst.pointer || !inst.geom) return;
    if (inst.type === "line") hitLine(inst);
    else if (inst.type === "bar") hitBar(inst);
    else hitDoughnut(inst);
  }

  /* ============ line ============ */

  function line(canvas, { labels = [], datasets = [], kind = "money" } = {}) {
    const inst = getInst(canvas, "line");
    update(inst, datasets.map((d) => (d.values || []).map((v) => Number(v) || 0)), { labels, datasets, kind });
  }

  function drawLine(inst) {
    const { ctx, w, h } = size(inst.canvas);
    const { labels, datasets, kind } = inst.opts;
    const values = inst.current;
    if (!labels.length || !values.flat().length) {
      inst.geom = null;
      drawEmpty(ctx, w, h, "Нет данных за выбранный период");
      return;
    }
    const targetMax = niceMax(Math.max(0, ...inst.target.flat()));
    const pad = { t: 18, r: 18, b: 30, l: 58 };
    const innerW = w - pad.l - pad.r;
    const innerH = h - pad.t - pad.b;
    const n = labels.length;

    ctx.font = "11px Segoe UI, sans-serif";
    ctx.textAlign = "right";
    ctx.textBaseline = "middle";
    const steps = 4;
    for (let i = 0; i <= steps; i++) {
      const y = pad.t + (innerH * i) / steps;
      ctx.strokeStyle = i === steps ? axisColor() : gridColor();
      ctx.setLineDash(i === steps ? [] : [4, 5]);
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(pad.l, y);
      ctx.lineTo(w - pad.r, y);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = muted();
      ctx.fillText(fmtAxis((targetMax * (steps - i)) / steps, kind), pad.l - 10, y);
    }

    const xAt = (i) => pad.l + (innerW * i) / Math.max(n - 1, 1);
    const yAt = (v) => pad.t + innerH * (1 - clamp(v / targetMax, 0, 1));

    ctx.fillStyle = muted();
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    const stride = Math.max(1, Math.ceil(n / Math.max(3, Math.floor(innerW / 78))));
    labels.forEach((label, i) => {
      if (i % stride !== 0 && i !== n - 1) return;
      ctx.fillText(String(label), xAt(i), h - pad.b + 9);
    });

    const geom = { pts: [], xAt, pad, innerW, innerH, n };
    datasets.forEach((ds, di) => {
      const color = ds.color || "#0f766e";
      const pts = (values[di] || []).map((v, i) => ({ x: xAt(i), y: yAt(v), v }));
      geom.pts.push(pts);
      if (!pts.length) return;

      const fill = ctx.createLinearGradient(0, pad.t, 0, pad.t + innerH);
      fill.addColorStop(0, rgba(color, isDark() ? 0.38 : 0.28));
      fill.addColorStop(1, rgba(color, 0));
      ctx.beginPath();
      smoothPath(ctx, pts);
      ctx.lineTo(pts[pts.length - 1].x, pad.t + innerH);
      ctx.lineTo(pts[0].x, pad.t + innerH);
      ctx.closePath();
      ctx.fillStyle = fill;
      ctx.fill();

      const stroke = ctx.createLinearGradient(pad.l, 0, pad.l + innerW, 0);
      stroke.addColorStop(0, mix(color, isDark() ? 0.28 : -0.12));
      stroke.addColorStop(1, color);
      ctx.beginPath();
      smoothPath(ctx, pts);
      ctx.strokeStyle = stroke;
      ctx.lineWidth = 2.6;
      ctx.lineJoin = "round";
      ctx.lineCap = "round";
      ctx.shadowColor = rgba(color, isDark() ? 0.55 : 0.3);
      ctx.shadowBlur = 12;
      ctx.shadowOffsetY = 4;
      ctx.stroke();
      ctx.shadowColor = "transparent";
      ctx.shadowBlur = 0;
      ctx.shadowOffsetY = 0;

      const last = pts[pts.length - 1];
      ctx.beginPath();
      ctx.arc(last.x, last.y, 4.5, 0, Math.PI * 2);
      ctx.fillStyle = color;
      ctx.fill();
      ctx.beginPath();
      ctx.arc(last.x, last.y, 8, 0, Math.PI * 2);
      ctx.strokeStyle = rgba(color, 0.35);
      ctx.lineWidth = 2;
      ctx.stroke();
    });

    inst.geom = geom;

    const hi = inst.hover;
    if (hi != null && hi >= 0 && hi < n) {
      const x = xAt(hi);
      ctx.strokeStyle = axisColor();
      ctx.setLineDash([3, 4]);
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x, pad.t);
      ctx.lineTo(x, pad.t + innerH);
      ctx.stroke();
      ctx.setLineDash([]);
      geom.pts.forEach((pts, di) => {
        const p = pts[hi];
        if (!p) return;
        const color = datasets[di].color || "#0f766e";
        ctx.beginPath();
        ctx.arc(p.x, p.y, 6.5, 0, Math.PI * 2);
        ctx.fillStyle = surface();
        ctx.fill();
        ctx.strokeStyle = color;
        ctx.lineWidth = 2.6;
        ctx.stroke();
      });
      const rows = datasets
        .map((ds, di) => tipRow(ds.color || "#0f766e", ds.label || "Сумма", fmtValue(inst.target[di]?.[hi] ?? 0, kind)))
        .join("");
      const top = Math.min(...geom.pts.map((pts) => pts[hi]?.y ?? Infinity));
      showTip(inst, `<div class="fin-tip-head">${String(labels[hi])}</div>${rows}`, x, top);
    } else {
      hideTip(inst);
    }
  }

  function hitLine(inst) {
    const g = inst.geom;
    if (!g) return;
    const { x, y } = inst.pointer;
    const inside = x >= g.pad.l - 12 && x <= g.pad.l + g.innerW + 12 && y >= g.pad.t - 10 && y <= g.pad.t + g.innerH + 10;
    const idx = inside ? clamp(Math.round(((x - g.pad.l) / Math.max(g.innerW, 1)) * Math.max(g.n - 1, 1)), 0, g.n - 1) : null;
    if (idx !== inst.hover) {
      inst.hover = idx;
      draw(inst);
    }
  }

  /* ============ bar ============ */

  function bar(canvas, { labels = [], datasets = [], scale = "shared", formats = [], legend = [] } = {}) {
    const inst = getInst(canvas, "bar");
    update(inst, datasets.map((d) => (d.values || []).map((v) => Number(v) || 0)), { labels, datasets, scale, formats, legend });
  }

  function drawBar(inst) {
    const { ctx, w, h } = size(inst.canvas);
    const { labels, datasets, scale, formats, legend } = inst.opts;
    const values = inst.current;
    if (!labels.length || !datasets.length) {
      inst.geom = null;
      drawEmpty(ctx, w, h, "Нет данных за выбранный период");
      return;
    }
    const grouped = scale === "group";
    const legendH = legend.length ? 26 : 0;
    const pad = { t: 38 + legendH, r: 18, b: 30, l: grouped ? 18 : 58 };
    const innerW = w - pad.l - pad.r;
    const innerH = h - pad.t - pad.b;
    const n = labels.length;
    const sharedMax = niceMax(Math.max(0, ...inst.target.flat()));

    if (legend.length) {
      ctx.font = "11px Segoe UI, sans-serif";
      ctx.textAlign = "left";
      ctx.textBaseline = "middle";
      let lx = pad.l;
      legend.forEach((item, i) => {
        const color = item.color || datasets[i]?.color || "#0f766e";
        ctx.fillStyle = color;
        roundRect(ctx, lx, 11, 9, 9, 3);
        ctx.fill();
        ctx.fillStyle = muted();
        const text = String(item.label || "");
        ctx.fillText(text, lx + 14, 16);
        lx += 14 + ctx.measureText(text).width + 16;
      });
    }

    if (!grouped) {
      ctx.font = "11px Segoe UI, sans-serif";
      ctx.textAlign = "right";
      ctx.textBaseline = "middle";
      for (let i = 0; i <= 4; i++) {
        const y = pad.t + (innerH * i) / 4;
        ctx.strokeStyle = i === 4 ? axisColor() : gridColor();
        ctx.setLineDash(i === 4 ? [] : [4, 5]);
        ctx.beginPath();
        ctx.moveTo(pad.l, y);
        ctx.lineTo(w - pad.r, y);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = muted();
        ctx.fillText(fmtCompact((sharedMax * (4 - i)) / 4), pad.l - 10, y);
      }
    } else {
      ctx.strokeStyle = axisColor();
      ctx.beginPath();
      ctx.moveTo(pad.l, pad.t + innerH);
      ctx.lineTo(w - pad.r, pad.t + innerH);
      ctx.stroke();
    }

    const group = innerW / Math.max(n, 1);
    const barW = Math.min(34, (group * 0.66) / Math.max(datasets.length, 1));
    const bars = [];

    labels.forEach((label, i) => {
      const kind = formats[i] || "money";
      const groupMax = grouped ? niceMax(Math.max(0.000001, ...inst.target.map((row) => row[i] || 0))) : sharedMax;
      const hovered = inst.hover === i;

      if (hovered) {
        ctx.fillStyle = isDark() ? "rgba(226,232,240,0.05)" : "rgba(15,23,42,0.035)";
        roundRect(ctx, pad.l + group * i + 3, pad.t - 6, group - 6, innerH + 6, 10);
        ctx.fill();
      }

      datasets.forEach((ds, di) => {
        const v = (values[di] || [])[i] || 0;
        const bh = Math.max(innerH * clamp(v / groupMax, 0, 1), v > 0 ? 3 : 0);
        const x = pad.l + group * i + group / 2 - (datasets.length * barW) / 2 + di * barW;
        const bw = barW - 4;
        const y = pad.t + innerH - bh;
        const color = ds.color || "#0f766e";

        const grad = ctx.createLinearGradient(0, y, 0, pad.t + innerH);
        grad.addColorStop(0, mix(color, 0.2));
        grad.addColorStop(1, color);
        ctx.fillStyle = grad;
        if (hovered) {
          ctx.shadowColor = rgba(color, 0.45);
          ctx.shadowBlur = 14;
          ctx.shadowOffsetY = 3;
        }
        topRoundRect(ctx, x, y, bw, bh, 6);
        ctx.fill();
        ctx.shadowColor = "transparent";
        ctx.shadowBlur = 0;
        ctx.shadowOffsetY = 0;

        const text = kind === "count" ? fmtCount(inst.target[di]?.[i] ?? 0) : fmtCompact(inst.target[di]?.[i] ?? 0);
        ctx.font = "650 11px Segoe UI, sans-serif";
        ctx.textAlign = "center";
        ctx.textBaseline = "bottom";
        ctx.fillStyle = ink();
        ctx.fillText(text, x + bw / 2, y - 5);
        bars.push({ i, di, x, y, w: bw, h: bh });
      });

      ctx.fillStyle = inst.hover === i ? ink() : muted();
      ctx.font = `${inst.hover === i ? "600 " : ""}11px Segoe UI, sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "top";
      ctx.fillText(String(label), pad.l + group * i + group / 2, h - pad.b + 9);
    });

    inst.geom = { bars, pad, innerW, innerH, group, n };

    if (inst.hover != null && inst.hover >= 0 && inst.hover < n) {
      const i = inst.hover;
      const kind = formats[i] || "money";
      const rows = datasets
        .map((ds, di) => tipRow(ds.color || "#0f766e", legend[di]?.label || ds.label || `Ряд ${di + 1}`, fmtValue(inst.target[di]?.[i] ?? 0, kind)))
        .join("");
      const top = Math.min(...bars.filter((b) => b.i === i).map((b) => b.y), pad.t + innerH);
      showTip(inst, `<div class="fin-tip-head">${String(labels[i])}</div>${rows}`, pad.l + group * i + group / 2, top);
    } else {
      hideTip(inst);
    }
  }

  function hitBar(inst) {
    const g = inst.geom;
    if (!g) return;
    const { x, y } = inst.pointer;
    const inside = x >= g.pad.l && x <= g.pad.l + g.innerW && y >= g.pad.t - 14 && y <= g.pad.t + g.innerH + 16;
    const idx = inside ? clamp(Math.floor((x - g.pad.l) / Math.max(g.group, 1)), 0, g.n - 1) : null;
    if (idx !== inst.hover) {
      inst.hover = idx;
      draw(inst);
    }
  }

  /* ============ doughnut ============ */

  function doughnut(canvas, items = []) {
    const inst = getInst(canvas, "doughnut");
    update(inst, [items.map((i) => Number(i.value) || 0)], { items });
  }

  function drawDoughnut(inst) {
    const { ctx, w, h } = size(inst.canvas);
    const { items } = inst.opts;
    const values = inst.current[0] || [];
    const targets = inst.target[0] || [];
    const total = targets.reduce((s, v) => s + Math.max(0, v), 0);
    if (!items.length || total <= 0) {
      inst.geom = null;
      drawEmpty(ctx, w, h, "Нет данных для диаграммы");
      return;
    }
    const wide = w > 380;
    const cx = wide ? Math.min(w * 0.32, 150) + 10 : w / 2;
    const cy = wide ? h / 2 : h * 0.42;
    const r = Math.min(wide ? w * 0.3 : w * 0.34, h * (wide ? 0.4 : 0.34));
    const inner = r * 0.62;
    const drawTotal = values.reduce((s, v) => s + Math.max(0, v), 0) || 1;
    const gap = 0.016;
    let a = -Math.PI / 2;
    const segs = [];

    items.forEach((item, i) => {
      const share = Math.max(0, values[i] || 0) / drawTotal;
      const sweep = share * Math.PI * 2;
      if (sweep <= 0.0005) {
        segs.push({ a0: a, a1: a, item, i });
        return;
      }
      const pad = sweep > gap * 2 ? gap / 2 : Math.min(gap / 4, sweep / 4);
      const a0 = a + pad;
      const a1 = a + sweep - pad;
      if (a1 <= a0) {
        segs.push({ a0: a, a1: a + sweep, item, i });
        a += sweep;
        return;
      }
      const hovered = inst.hover === i;
      const pop = hovered ? 7 : 0;
      const mid = a + sweep / 2;
      const ox = Math.cos(mid) * pop;
      const oy = Math.sin(mid) * pop;
      const color = item.color || "#94a3b8";
      const grad = ctx.createLinearGradient(cx - r, cy - r, cx + r, cy + r);
      grad.addColorStop(0, mix(color, 0.22));
      grad.addColorStop(1, color);

      ctx.beginPath();
      ctx.arc(cx + ox, cy + oy, r + (hovered ? 2 : 0), a0, a1);
      ctx.arc(cx + ox, cy + oy, inner, a1, a0, true);
      ctx.closePath();
      ctx.fillStyle = grad;
      if (hovered) {
        ctx.shadowColor = rgba(color, 0.5);
        ctx.shadowBlur = 16;
      }
      ctx.fill();
      ctx.shadowColor = "transparent";
      ctx.shadowBlur = 0;
      segs.push({ a0: a, a1: a + sweep, item, i });
      a += sweep;
    });

    const active = inst.hover != null ? items[inst.hover] : null;
    const centerValue = active ? Number(active.value) || 0 : total;
    const centerLabel = active ? `${Math.round((centerValue / total) * 100)}%` : "всего";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillStyle = ink();
    ctx.font = "700 16px Segoe UI, sans-serif";
    ctx.fillText(fmtCompact(centerValue), cx, cy - 9);
    ctx.fillStyle = muted();
    ctx.font = "11px Segoe UI, sans-serif";
    const sub = active ? `${centerLabel} · ${String(active.label || "")}` : centerLabel;
    const maxSub = inner * 1.8;
    let subText = sub;
    while (subText.length > 4 && ctx.measureText(subText).width > maxSub) subText = `${subText.slice(0, -2)}…`;
    ctx.fillText(subText, cx, cy + 10);

    if (wide) {
      const lx = Math.min(cx + r + 26, w - 150);
      const rows = items.slice(0, 7);
      const lh = 22;
      let ly = cy - (rows.length * lh) / 2 + lh / 2;
      ctx.textBaseline = "middle";
      rows.forEach((item, i) => {
        const on = inst.hover === i;
        ctx.fillStyle = item.color || "#94a3b8";
        roundRect(ctx, lx, ly - 5, 10, 10, 3);
        ctx.fill();
        ctx.fillStyle = on ? ink() : muted();
        ctx.font = `${on ? "650 " : ""}12px Segoe UI, sans-serif`;
        ctx.textAlign = "left";
        const name = String(item.label || "");
        let text = name;
        const room = w - lx - 78;
        while (text.length > 3 && ctx.measureText(text).width > room) text = `${text.slice(0, -2)}…`;
        ctx.fillText(text, lx + 16, ly);
        ctx.fillStyle = on ? ink() : muted();
        ctx.textAlign = "right";
        ctx.font = "600 11px Segoe UI, sans-serif";
        ctx.fillText(`${Math.round(((Number(item.value) || 0) / total) * 100)}%`, w - 14, ly);
        ly += lh;
      });
    }

    inst.geom = { segs, cx, cy, r, inner };

    if (active) {
      showTip(
        inst,
        `<div class="fin-tip-head">${String(active.label || "")}</div>${tipRow(active.color || "#94a3b8", "Сумма", fmtMoney(active.value))}`,
        cx,
        cy - r - 6
      );
    } else {
      hideTip(inst);
    }
  }

  function hitDoughnut(inst) {
    const g = inst.geom;
    if (!g) return;
    const dx = inst.pointer.x - g.cx;
    const dy = inst.pointer.y - g.cy;
    const dist = Math.hypot(dx, dy);
    let idx = null;
    if (dist >= g.inner - 4 && dist <= g.r + 8) {
      let ang = Math.atan2(dy, dx);
      const start = -Math.PI / 2;
      if (ang < start) ang += Math.PI * 2;
      const seg = g.segs.find((s) => ang >= s.a0 && ang < s.a1);
      if (seg) idx = seg.i;
    }
    if (idx !== inst.hover) {
      inst.hover = idx;
      draw(inst);
    }
  }

  function setCurrency(cur) {
    if (cur) CURRENCY = String(cur);
  }

  return { line, bar, doughnut, setCurrency };
})();
