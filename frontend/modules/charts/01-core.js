const FinCharts = (() => {
  const instances = new WeakMap();
  const DUR = 560;
  let CURRENCY = "₽";
  let MONEY_DECIMALS = 2;

  const nfInt = new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 0 });
  let nfMoney = new Intl.NumberFormat("ru-RU", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

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

  function fmtTiny(v) {
    return fmtCompact(v).replace(/ млн$/, "м").replace(/ тыс$/, "к");
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


/* bundle-seam */
})();
