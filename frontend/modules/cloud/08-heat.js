    drawSpace(ctx, theme) {
      if (this.isCatalog()) {
        this.drawCatalogVoid(ctx, theme, false);
        return;
      }
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

    heatGroup(kind) {
      return this.nodes.filter((n) => n.data.kind === kind && (n.data.debt || 0) > 0.01);
    }

    heatPeak(nodes) {
      return Math.max(0.01, ...nodes.map((n) => n.data.debt || 0));
    }

    paintHeatBlob(ctx, x, y, radius, t, alpha, dark) {
      const [r, g, b] = heatRgb(t, dark);
      const grd = ctx.createRadialGradient(x, y, 0, x, y, radius);
      grd.addColorStop(0, `rgba(${r},${g},${b},${alpha})`);
      grd.addColorStop(0.34, `rgba(${r},${g},${b},${alpha * 0.55})`);
      grd.addColorStop(0.68, `rgba(${r},${g},${b},${alpha * 0.18})`);
      grd.addColorStop(1, `rgba(${r},${g},${b},0)`);
      ctx.fillStyle = grd;
      ctx.beginPath();
      ctx.arc(x, y, radius, 0, TAU);
      ctx.fill();
    }

    drawHeat(ctx, theme) {
      const customers = this.heatGroup("customer");
      const orders = this.heatGroup("order");
      const lines = this.heatGroup("line");
      if (!customers.length && !orders.length && !lines.length) return;
      const zoom = this.camera.zoom;
      const dark = !!theme.dark;
      ctx.save();
      ctx.globalCompositeOperation = dark ? "screen" : "source-over";
      const paint = (nodes, baseR, spanR, a0, a1) => {
        if (!nodes.length) return;
        const peak = this.heatPeak(nodes);
        nodes.slice().sort((a, b) => (a.data.debt || 0) - (b.data.debt || 0)).forEach((n) => {
          const t = heatTone(n.data.debt, peak);
          this.paintHeatBlob(ctx, n.x, n.y, baseR + spanR * t, t, a0 + (a1 - a0) * t, dark);
        });
      };
      if (customers.length) paint(customers, 78, 170, dark ? 0.38 : 0.34, dark ? 0.88 : 0.72);
      else paint(orders, 64, 140, dark ? 0.36 : 0.32, dark ? 0.86 : 0.7);
      if (customers.length && zoom >= 0.48) paint(orders, 34, 72, dark ? 0.22 : 0.2, dark ? 0.58 : 0.48);
      if (zoom >= 0.92) paint(lines, 16, 38, dark ? 0.2 : 0.18, dark ? 0.5 : 0.42);
      ctx.restore();
    }

    drawHeatMarks(ctx, theme, time) {
      const marks = this.heatGroup("customer");
      const foci = marks.length ? marks : this.heatGroup("order");
      if (!foci.length) return;
      const zoom = this.camera.zoom;
      const peak = this.heatPeak(foci);
      foci.forEach((n) => {
        const t = heatTone(n.data.debt, peak);
        const [r, g, b] = heatRgb(t, theme.dark);
        const pulse = this.reducedMotion ? 1 : 0.72 + 0.28 * Math.sin((time || 0) / 380 + n.x * 0.012);
        ctx.strokeStyle = `rgba(${r},${g},${b},${0.55 + 0.35 * t})`;
        ctx.lineWidth = (2.4 + 2.8 * t) / zoom;
        ctx.beginPath();
        ctx.arc(n.x, n.y, n.r + (8 + 7 * pulse) / zoom, 0, TAU);
        ctx.stroke();
      });
    }

    worldToScreen(wx, wy, wz = 0) {
      if (this.spaceMix > 0.01) {
        const p = this.project(wx, wy, wz);
        return { x: p.x, y: p.y };
      }
      return {
        x: this.width / 2 + this.camera.x + wx * this.camera.zoom,
        y: this.height / 2 + this.camera.y + wy * this.camera.zoom,
      };
    }

    heatCalloutNodes() {
      const visible = (kind) => this.heatGroup(kind)
        .filter((n) => this.onScreen(this.view(n), 0))
        .sort((a, b) => b.data.debt - a.data.debt);
      const customers = visible("customer");
      if (customers.length) return customers.slice(0, 4);
      return visible("order").slice(0, 4);
    }

    drawHeatCallouts(ctx, theme) {
      const foci = this.heatCalloutNodes();
      if (!foci.length) return;
      const peak = this.heatPeak(foci);
      const placed = [];
      ctx.font = "600 11px Segoe UI, sans-serif";
      ctx.textAlign = "left";
      ctx.textBaseline = "middle";
      foci.forEach((n) => {
        const origin = this.spaceMix > 0.01
          ? this.project(n.x, n.y, (n.z || 0) * this.spaceMix)
          : { x: this.width / 2 + this.camera.x + n.x * this.camera.zoom, y: this.height / 2 + this.camera.y + n.y * this.camera.zoom, s: 1, visible: true };
        if (!this.onScreen(origin, 0)) return;
        const t = heatTone(n.data.debt, peak);
        const [r, g, b] = heatRgb(t, theme.dark);
        const name = this.truncate(ctx, n.data.label || "Долг", 118);
        const amount = compactMoney(n.data.debt);
        const titleW = ctx.measureText(name).width;
        ctx.font = "700 10px ui-monospace, Consolas, monospace";
        const sumW = ctx.measureText(amount).width;
        ctx.font = "600 11px Segoe UI, sans-serif";
        const w = Math.max(titleW, sumW) + 28;
        const h = 34;
        const nodeR = this.is3d() ? this.view(n).r : n.r * this.camera.zoom;
        let x = origin.x + nodeR + 16;
        let y = origin.y - h / 2;
        x = clamp(x, 14, this.width - w - 14);
        y = clamp(y, 86, this.height - h - 52);
        placed.forEach((prev) => {
          if (Math.abs(prev.y - y) < h + 8 && Math.abs(prev.x - x) < w + 12) y = clamp(prev.y + h + 8, 86, this.height - h - 52);
        });
        placed.push({ x, y });
        ctx.strokeStyle = `rgba(${r},${g},${b},0.55)`;
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.moveTo(origin.x, origin.y);
        ctx.lineTo(x - 4, y + h / 2);
        ctx.stroke();
        ctx.beginPath();
        ctx.roundRect(x, y, w, h, 8);
        ctx.fillStyle = theme.dark ? "rgba(8, 16, 28, 0.88)" : "rgba(255, 255, 255, 0.92)";
        ctx.fill();
        ctx.strokeStyle = `rgba(${r},${g},${b},0.85)`;
        ctx.stroke();
        ctx.fillStyle = `rgb(${r},${g},${b})`;
        ctx.beginPath();
        ctx.arc(x + 10, y + h / 2, 3.2, 0, TAU);
        ctx.fill();
        ctx.fillStyle = theme.ink;
        ctx.fillText(name, x + 18, y + 11);
        ctx.font = "700 10px ui-monospace, Consolas, monospace";
        ctx.fillStyle = `rgb(${r},${g},${b})`;
        ctx.fillText(amount, x + 18, y + 24);
        ctx.font = "600 11px Segoe UI, sans-serif";
      });
    }

