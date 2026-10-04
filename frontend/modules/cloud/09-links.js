/* bundle-seam */
(() => {
  class OrderCloud {
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

        if ((selected || hovered) && zoom > 0.28 && node.data.kind !== "galaxy") {
          ctx.strokeStyle = hexToRgba(color, selected ? 0.45 : 0.28);
          ctx.lineWidth = 1 / zoom;
          ctx.beginPath();
          ctx.arc(node.x, node.y, r + 6 / zoom, 0, TAU);
          ctx.stroke();
        }

        if (node.data.kind === "galaxy") {
          this.paintGalaxy(ctx, node.x, node.y, r, node.data, {
            selected,
            hovered,
            dark: !!theme.dark,
            lineWidth: (selected ? 1.4 : 1) / zoom,
          });
        } else if (node.data.kind === "customer") {
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
        const mustLabel = selected || hovered || node.match || node.data.kind === "customer" || node.data.kind === "galaxy"
          || (node.data.kind === "order" && zoom > 0.62)
          || (node.data.kind === "line" && zoom > 1.45);
        const alwaysGalaxy = this.isCatalog() && node.data.kind === "galaxy";
        if ((this.options.labels && mustLabel) || selected || alwaysGalaxy) this.drawLabel(ctx, node, theme, zoom, selected || hovered || node.match || alwaysGalaxy);
      });
      ctx.globalAlpha = 1;
    }

    drawLabel(ctx, node, theme, zoom, emphasized) {
      const fontSize = clamp((node.data.kind === "galaxy" || node.data.kind === "customer" ? 12 : 11) / Math.sqrt(zoom), 7.5, 15);
      const max = node.data.kind === "line" ? 140 : node.data.kind === "galaxy" ? 220 : 190;
      ctx.font = `${node.data.kind === "customer" || node.data.kind === "galaxy" ? 650 : 500} ${fontSize}px Segoe UI, sans-serif`;
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
        ctx.arc(n.x * scale + ox, n.y * scale + oy, n.data.kind === "galaxy" ? 4 : n.data.kind === "customer" ? 2.7 : 1.5, 0, TAU);
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

    approachSubtree(node) {
      if (!node) return [];
      const kids = this.nodes.filter((n) => n.data.parent === node.data.id);
      if (node.data.kind === "line") return [node];
      if (node.data.kind === "order") return [node, ...kids];
      return [node, ...kids.flatMap((k) => this.approachSubtree(k))];
    }

    approachRadius(node) {
      const kind = node?.data?.kind;
      const cx = node.x;
      const cy = node.y;
      let radius = (node.r || 8) + 12;
      this.approachSubtree(node).forEach((n) => {
        const body = n.r || 0;
        radius = Math.max(radius, Math.hypot(n.x - cx, n.y - cy) + body);
        radius = Math.max(radius, Math.hypot((n.tx ?? n.x) - cx, (n.ty ?? n.y) - cy) + body);
      });
      if (kind === "customer") {
        const orders = this.nodes.filter((n) => n.data.parent === node.data.id);
        orders.forEach((planet, i) => {
          const moons = this.nodes.filter((n) => n.data.parent === planet.data.id);
          const orbit = planet.orbitR || this.planetOrbit(node, i, planet);
          const moonRing = moons.length ? this.moonOrbit(planet, moons.length) : 0;
          const moonR = moons.reduce((m, n) => Math.max(m, n.r || 0), 0);
          radius = Math.max(radius, orbit + moonRing + moonR);
        });
        if (node.systemR) radius = Math.max(radius, node.systemR);
        radius = Math.max(radius, (node.r || 19) + 36);
      } else if (kind === "order") {
        const moons = this.nodes.filter((n) => n.data.parent === node.data.id);
        const moonR = moons.reduce((m, n) => Math.max(m, n.r || 0), 4);
        radius = Math.max(radius, this.moonOrbit(node, moons.length) + moonR + 10);
      } else {
        radius = Math.max((node.r || 6) * 2.15 + 10, 16);
      }
      return radius * (kind === "line" ? 1.12 : 1.18);
    }

    zoomToFitRadius(radius) {
      const span = Math.max(36, radius * 2);
      const innerW = Math.max(120, this.width - 108);
      const innerH = Math.max(110, this.height - 96);
      let zoom = Math.min(innerW / span, innerH / span);
      if (this.is3d() || this.options.space3d) {
        const dist = Math.max(48, this.orbit.dist || 1080);
        const focal = Math.max(48, this.orbit.focal || 920);
        zoom *= dist / focal;
        const cp = Math.max(0.42, Math.abs(Math.cos(this.orbit.pitch || 0.68)));
        zoom *= Math.min(1, cp / 0.78);
      }
      const range = this.zoomRange();
      return clamp(zoom, range.min, range.max);
    }

    approachZoom(node) {
      if (!node) return 1;
      return this.zoomToFitRadius(this.approachRadius(node));
    }

    approach(node) {
      if (!node) return;
      const want = this.approachZoom(node);
      const onTarget = Math.hypot(this.orbit.targetX - node.x, this.orbit.targetY - node.y) < 10;
      const zoomOk = Math.abs((this.camera.zoom || 1) - want) < Math.max(0.08, want * 0.07);
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

    flyInto(node, duration = 1480) {
      if (!node) return Promise.resolve();
      this.stopTour();
      this.select(node);
      this.viewPinned = true;
      const ms = this.reducedMotion ? 0 : duration;
      const range = this.zoomRange();
      const fill = (Math.min(this.width, this.height) * 0.92) / Math.max(12, node.r);
      const zoom = clamp(fill, Math.max(range.min, 2.8), range.max);
      const z = (node.z || 0) * this.spaceMix || 8;
      if (this.is3d() || this.options.space3d) {
        this.camTween = null;
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
        this.orbitTween = {
          from,
          to: {
            yaw: from.yaw + 0.28,
            pitch: clamp(from.pitch - 0.2, 0.26, 0.92),
            zoom,
            x: 0,
            y: 0,
            tx: node.x,
            ty: node.y,
            tz: z,
          },
          start: performance.now(),
          duration: ms,
        };
        this.zoomTarget = zoom;
        this.needsFrame = true;
      } else {
        this.lockOrbitTarget(node.x, node.y, z);
        this.animateCamera({ x: -node.x * zoom, y: -node.y * zoom, zoom }, ms || 1);
      }
      this.idleUntil = performance.now() + ms + 500;
      return new Promise((resolve) => setTimeout(resolve, ms));
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
        || this.nodes.find((n) => n.data.rawId === id || n.data.orderId === id || n.data.path === id)
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
        to: { x: target.x, y: target.y, zoom: clamp(target.zoom, this.zoomRange().min, this.zoomRange().max) },
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
        const rad = (n.data.kind === "galaxy" ? n.r * 1.2 : n.r) + padding;
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
        const r = Math.max(8, (n.r || 6) * p.s * (n.data.kind === "galaxy" ? 1.15 : 1));
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
      } else if (this.isCatalog() && node) {
        this.select(node);
        if (this.is3d()) {
          this.prepareOrbitPivot();
          const yaw = this.orbit.yaw;
          this.drag = {
            type: "orbit",
            yaw,
            pitch: this.orbit.pitch,
            moved: false,
            clickNode: node,
            cam: this.cameraWorld(),
            target: { x: this.orbit.targetX, y: this.orbit.targetY, z: this.orbit.targetZ },
            pivot: { ...(this.orbitPivot || this.worldAtScreenCenter()) },
            right: { x: Math.cos(yaw), y: -Math.sin(yaw), z: 0 },
          };
        } else {
          this.drag = { type: "pan", moved: false, lastSx: point.sx, lastSy: point.sy, clickNode: node };
        }
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
      if (was.clickNode && !was.moved) {
        this.select(was.clickNode);
        if (this.options.openOnClick) this.onOpen(was.clickNode.data);
      } else if (was.type === "node") {
        was.node.pinned = false;
        if (!was.moved) {
          this.select(was.node);
          if (was.node.data.kind === "galaxy") {
            if (this.options.openOnClick) this.onOpen(was.node.data);
          } else this.approach(was.node);
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
