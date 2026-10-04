  /* ============ bar ============ */

  function bar(canvas, { labels = [], datasets = [], scale = "shared", formats = [], legend = [], tinyLabels = false } = {}) {
    const inst = getInst(canvas, "bar");
    update(inst, datasets.map((d) => (d.values || []).map((v) => Number(v) || 0)), { labels, datasets, scale, formats, legend, tinyLabels });
  }

  function drawBar(inst) {
    const { ctx, w, h } = size(inst.canvas);
    const { labels, datasets, scale, formats, legend, tinyLabels } = inst.opts;
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

        const raw = inst.target[di]?.[i] ?? 0;
        const text = kind === "count" ? fmtCount(raw) : tinyLabels ? fmtTiny(raw) : fmtCompact(raw);
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

