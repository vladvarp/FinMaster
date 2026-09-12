const FinCharts = (() => {
  const pad = { t: 18, r: 16, b: 36, l: 52 };

  function size(canvas) {
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    const w = Math.max(120, rect.width);
    const h = Math.max(120, rect.height);
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    const ctx = canvas.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return { ctx, w, h };
  }

  function niceMax(v) {
    if (v <= 0) return 1;
    const p = 10 ** Math.floor(Math.log10(v));
    const n = v / p;
    const nice = n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10;
    return nice * p;
  }

  function axisY(ctx, w, h, max, currency) {
    ctx.strokeStyle = "rgba(15, 23, 42, 0.08)";
    ctx.fillStyle = "#64748b";
    ctx.font = "11px Segoe UI, sans-serif";
    ctx.textAlign = "right";
    ctx.textBaseline = "middle";
    const steps = 4;
    for (let i = 0; i <= steps; i++) {
      const val = (max * (steps - i)) / steps;
      const y = pad.t + ((h - pad.t - pad.b) * i) / steps;
      ctx.beginPath();
      ctx.moveTo(pad.l, y);
      ctx.lineTo(w - pad.r, y);
      ctx.stroke();
      const label = currency ? formatCompact(val) : String(Math.round(val));
      ctx.fillText(label, pad.l - 8, y);
    }
  }

  function formatCompact(n) {
    const abs = Math.abs(n);
    if (abs >= 1_000_000) return `${(n / 1_000_000).toFixed(1)} млн`;
    if (abs >= 1000) return `${(n / 1000).toFixed(1)} тыс`;
    return String(Math.round(n));
  }

  function line(canvas, { labels = [], datasets = [] } = {}) {
    const { ctx, w, h } = size(canvas);
    ctx.clearRect(0, 0, w, h);
    const maxVal = niceMax(Math.max(0, ...datasets.flatMap((d) => d.values || [0])));
    axisY(ctx, w, h, maxVal, true);
    const n = Math.max(labels.length, 1);
    const innerW = w - pad.l - pad.r;
    const innerH = h - pad.t - pad.b;
    ctx.fillStyle = "#64748b";
    ctx.font = "11px Segoe UI, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    const step = Math.max(1, Math.ceil(n / 8));
    labels.forEach((label, i) => {
      if (i % step !== 0 && i !== n - 1) return;
      const x = pad.l + (innerW * i) / Math.max(n - 1, 1);
      ctx.fillText(String(label), x, h - pad.b + 10);
    });
    datasets.forEach((ds) => {
      const values = ds.values || [];
      ctx.beginPath();
      values.forEach((v, i) => {
        const x = pad.l + (innerW * i) / Math.max(n - 1, 1);
        const y = pad.t + innerH * (1 - (v || 0) / maxVal);
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
      ctx.strokeStyle = ds.color || "#0f766e";
      ctx.lineWidth = 2.2;
      ctx.stroke();
      ctx.lineTo(pad.l + innerW, pad.t + innerH);
      ctx.lineTo(pad.l, pad.t + innerH);
      ctx.closePath();
      ctx.fillStyle = ds.fill || "rgba(15, 118, 110, 0.12)";
      ctx.fill();
    });
  }

  function bar(canvas, { labels = [], datasets = [] } = {}) {
    const { ctx, w, h } = size(canvas);
    ctx.clearRect(0, 0, w, h);
    const maxVal = niceMax(Math.max(0, ...datasets.flatMap((d) => d.values || [0])));
    axisY(ctx, w, h, maxVal, true);
    const n = labels.length;
    const innerW = w - pad.l - pad.r;
    const innerH = h - pad.t - pad.b;
    const group = innerW / Math.max(n, 1);
    const barW = Math.min(28, (group * 0.7) / Math.max(datasets.length, 1));
    labels.forEach((label, i) => {
      datasets.forEach((ds, di) => {
        const v = (ds.values || [])[i] || 0;
        const bh = innerH * (v / maxVal);
        const x = pad.l + group * i + group / 2 - (datasets.length * barW) / 2 + di * barW;
        const y = pad.t + innerH - bh;
        ctx.fillStyle = ds.color || "#0f766e";
        roundRect(ctx, x, y, barW - 2, Math.max(bh, 0), 4);
        ctx.fill();
      });
      ctx.fillStyle = "#64748b";
      ctx.font = "11px Segoe UI, sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "top";
      ctx.fillText(String(label), pad.l + group * i + group / 2, h - pad.b + 10);
    });
  }

  function doughnut(canvas, items = []) {
    const { ctx, w, h } = size(canvas);
    ctx.clearRect(0, 0, w, h);
    const total = items.reduce((s, i) => s + (i.value || 0), 0) || 1;
    const cx = w * 0.38;
    const cy = h / 2;
    const r = Math.min(w, h) * 0.32;
    let a = -Math.PI / 2;
    items.forEach((item) => {
      const slice = ((item.value || 0) / total) * Math.PI * 2;
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.arc(cx, cy, r, a, a + slice);
      ctx.closePath();
      ctx.fillStyle = item.color || "#94a3b8";
      ctx.fill();
      a += slice;
    });
    ctx.beginPath();
    ctx.arc(cx, cy, r * 0.58, 0, Math.PI * 2);
    ctx.fillStyle = "#fff";
    ctx.fill();
    ctx.fillStyle = "#0f172a";
    ctx.font = "600 16px Segoe UI, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(String(Math.round(total)), cx, cy - 8);
    ctx.fillStyle = "#64748b";
    ctx.font = "11px Segoe UI, sans-serif";
    ctx.fillText("всего", cx, cy + 10);

    let ly = 24;
    items.slice(0, 8).forEach((item) => {
      ctx.fillStyle = item.color || "#94a3b8";
      roundRect(ctx, w * 0.68, ly, 10, 10, 3);
      ctx.fill();
      ctx.fillStyle = "#334155";
      ctx.font = "12px Segoe UI, sans-serif";
      ctx.textAlign = "left";
      ctx.textBaseline = "middle";
      const name = String(item.label || "");
      ctx.fillText(name.length > 18 ? `${name.slice(0, 17)}…` : name, w * 0.68 + 16, ly + 5);
      ly += 20;
    });
  }

  function roundRect(ctx, x, y, w, h, r) {
    const rr = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + rr, y);
    ctx.arcTo(x + w, y, x + w, y + h, rr);
    ctx.arcTo(x + w, y + h, x, y + h, rr);
    ctx.arcTo(x, y + h, x, y, rr);
    ctx.arcTo(x, y, x + w, y, rr);
    ctx.closePath();
  }

  return { line, bar, doughnut };
})();
