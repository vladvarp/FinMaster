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
        if (!this.isCatalog()) {
      if (this.options.layout === "timeline") this.drawTimeline(ctx, t);
          if (this.options.layout === "constellation" || this.options.layout === "timeline") this.drawHulls(ctx, t);
          this.drawOrbitRings(ctx, t);
          if (this.options.heat) this.drawHeat(ctx, t);
          this.drawBridges(ctx, t, time);
      this.drawEdges(ctx, t, time);
        }
      this.drawNodes(ctx, t, time);
        if (!this.isCatalog() && this.options.heat) this.drawHeatMarks(ctx, t, time);
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
      if (this.isCatalog()) {
        this.drawNodes3d(ctx, theme, time);
        return;
      }
      this.drawShadows3d(ctx, theme);
      if (this.options.heat) this.drawHeat3d(ctx, theme);
      if (this.options.layout === "constellation" || this.options.layout === "timeline") this.drawHulls3d(ctx, theme);
      this.drawOrbitRings3d(ctx, theme);
      this.drawLinks3d(ctx, theme, time);
      this.drawNodes3d(ctx, theme, time);
      if (this.options.heat) this.drawHeatMarks3d(ctx, theme, time);
    }

    drawSpace3d(ctx, theme) {
      if (this.isCatalog()) {
        this.drawCatalogVoid(ctx, theme, true);
        return;
      }
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

