  /* ============ line ============ */

  function line(canvas, { labels = [], datasets = [], kind = "money", instant = false } = {}) {
    const inst = getInst(canvas, "line");
    update(inst, datasets.map((d) => (d.values || []).map((v) => Number(v) || 0)), { labels, datasets, kind, instant });
  }

  function drawLine(inst) {
    const { ctx, w, h } = size(inst.canvas);
    const { labels, datasets, kind } = inst.opts;
    const values = inst.current;
    if (!labels.length || !values.flat().length || !datasets.length) {
      inst.geom = null;
      drawEmpty(ctx, w, h, "Нет данных за выбранный период");
      return;
    }
    const nums = inst.target.flat();
    const yMax = niceMax(Math.max(0, ...nums));
    const yMin = Math.min(0, ...nums) < 0 ? -niceMax(-Math.min(0, ...nums)) : 0;
    const span = yMax - yMin || 1;
    const pad = { t: 18, r: 18, b: 30, l: 58 };
    const innerW = w - pad.l - pad.r;
    const innerH = h - pad.t - pad.b;
    const n = labels.length;
    const xAt = (i) => pad.l + (innerW * i) / Math.max(n - 1, 1);
    const yAt = (v) => pad.t + innerH * (1 - clamp((v - yMin) / span, 0, 1));

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
      ctx.fillText(fmtAxis(yMax - (span * i) / steps, kind), pad.l - 10, y);
    }
    if (yMin < 0) {
      ctx.strokeStyle = axisColor();
      ctx.beginPath();
      ctx.moveTo(pad.l, yAt(0));
      ctx.lineTo(w - pad.r, yAt(0));
      ctx.stroke();
    }

    ctx.fillStyle = muted();
    ctx.textBaseline = "top";
    const stride = Math.max(1, Math.ceil(n / Math.max(3, Math.floor(innerW / 78))));
    labels.forEach((label, i) => {
      if (i % stride !== 0 && i !== n - 1) return;
      ctx.textAlign = n === 1 ? "center" : i === 0 ? "left" : i === n - 1 ? "right" : "center";
      ctx.fillText(String(label), xAt(i), h - pad.b + 9);
    });

    const geom = { pts: [], xAt, pad, innerW, innerH, n };
    datasets.forEach((ds, di) => {
      const color = ds.color || "#0f766e";
      const pts = (values[di] || []).map((v, i) => ({ x: xAt(i), y: yAt(v), v }));
      geom.pts.push(pts);
      if (!pts.length) return;
      const doFill = ds.fill === true || (ds.fill !== false && datasets.length === 1);

      if (doFill) {
        const z = yAt(0);
        const fill = ctx.createLinearGradient(0, pad.t, 0, pad.t + innerH);
        fill.addColorStop(0, rgba(color, isDark() ? 0.38 : 0.28));
        fill.addColorStop(1, rgba(color, 0));
        ctx.beginPath();
        smoothPath(ctx, pts);
        ctx.lineTo(pts[pts.length - 1].x, z);
        ctx.lineTo(pts[0].x, z);
        ctx.closePath();
        ctx.fillStyle = fill;
        ctx.fill();
      }

      const stroke = ctx.createLinearGradient(pad.l, 0, pad.l + innerW, 0);
      stroke.addColorStop(0, mix(color, isDark() ? 0.28 : -0.12));
      stroke.addColorStop(1, color);
      ctx.beginPath();
      smoothPath(ctx, pts);
      ctx.strokeStyle = stroke;
      ctx.lineWidth = doFill ? 2.6 : 2.1;
      ctx.lineJoin = "round";
      ctx.lineCap = "round";
      ctx.setLineDash(ds.dashed ? [6, 5] : []);
      ctx.shadowColor = doFill ? rgba(color, isDark() ? 0.55 : 0.3) : "transparent";
      ctx.shadowBlur = doFill ? 12 : 0;
      ctx.shadowOffsetY = doFill ? 4 : 0;
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.shadowColor = "transparent";
      ctx.shadowBlur = 0;
      ctx.shadowOffsetY = 0;

      const last = pts[pts.length - 1];
      ctx.beginPath();
      ctx.arc(last.x, last.y, doFill ? 4.5 : 3.4, 0, Math.PI * 2);
      ctx.fillStyle = color;
      ctx.fill();
      if (doFill) {
        ctx.beginPath();
        ctx.arc(last.x, last.y, 8, 0, Math.PI * 2);
        ctx.strokeStyle = rgba(color, 0.35);
        ctx.lineWidth = 2;
        ctx.stroke();
      }
    });

    inst.geom = geom;
    inst.canvas.style.cursor = "crosshair";

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

