/* bundle-seam */
(() => {
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

  function setMoneyDecimals(raw) {
    const n = Number(raw);
    const d = Number.isFinite(n) ? Math.max(0, Math.min(4, Math.round(n))) : 2;
    MONEY_DECIMALS = d;
    nfMoney = new Intl.NumberFormat("ru-RU", { minimumFractionDigits: d, maximumFractionDigits: d });
  }

  return { line, bar, doughnut, setCurrency, setMoneyDecimals };
})();
