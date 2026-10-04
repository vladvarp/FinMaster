    starMetrics(node) {
      const r = node.r || 19;
      const mass = clamp((r - 16) / 16, 0, 1);
      const brightness = clamp(0.4 + Math.log1p(Math.max(0, node.data.value || 0)) / 14, 0.4, 1);
      return { mass, brightness, color: node.data.color || "#f59e0b" };
    }

    paintStar(ctx, x, y, r, color, opt) {
      const rgb = hexRgb(color);
      const brightness = clamp(opt.brightness ?? 0.7, 0, 1);
      const mass = clamp(opt.mass ?? 0.5, 0, 1);
      const pulse = opt.reduced ? 1 : 0.94 + 0.06 * Math.sin((opt.time || 0) / 480);
      const glow = mixRgb(rgb, [255, 246, 220], 0.18 + brightness * 0.42);
      const hot = mixRgb(glow, [255, 255, 255], 0.28 + brightness * 0.55);
      const b = brightness * pulse;
      const dark = !!opt.dark;
      const add = dark ? "lighter" : "source-over";
      const haloR = r * (2.6 + mass * 1.6 + b * 1.1);
      const beam = r * (2.4 + mass * 1.8 + b * 2.4);
      const haze = r * (0.28 + mass * 0.1 + b * 0.16);
      const needle = r * (0.07 + b * 0.05);

      ctx.save();
      ctx.translate(x, y);

      const halo = ctx.createRadialGradient(0, 0, 0, 0, 0, haloR);
      halo.addColorStop(0, rgbCss(hot, (dark ? 0.5 : 0.42) * b));
      halo.addColorStop(0.2, rgbCss(rgb, (dark ? 0.26 : 0.2) * b));
      halo.addColorStop(0.55, rgbCss(rgb, (dark ? 0.1 : 0.07) * b));
      halo.addColorStop(1, rgbCss(rgb, 0));
      ctx.fillStyle = halo;
      ctx.beginPath();
      ctx.arc(0, 0, haloR, 0, TAU);
      ctx.fill();

      const flare = (angle, length, width, alpha) => {
        ctx.save();
        ctx.rotate(angle);
        ctx.scale(1, Math.max(0.018, width / Math.max(length, 1)));
        const g = ctx.createRadialGradient(0, 0, 0, 0, 0, length);
        g.addColorStop(0, rgbCss(hot, alpha));
        g.addColorStop(0.1, rgbCss(glow, alpha * 0.72));
        g.addColorStop(0.38, rgbCss(rgb, alpha * 0.22));
        g.addColorStop(1, rgbCss(rgb, 0));
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(0, 0, length, 0, TAU);
        ctx.fill();
        ctx.restore();
      };

      ctx.globalCompositeOperation = add;
      const strength = (dark ? 0.42 : 0.28) * (0.35 + b * 0.65);
      flare(0.04, beam, haze, strength);
      flare(Math.PI / 2 + 0.04, beam * 0.78, haze * 0.82, strength * 0.82);
      flare(0.04, beam * 1.12, needle, strength * 0.9);
      flare(Math.PI / 2 + 0.04, beam * 0.88, needle * 0.85, strength * 0.7);
      flare(Math.PI / 4, beam * 0.38, haze * 0.22, strength * 0.18);
      flare(-Math.PI / 4, beam * 0.38, haze * 0.22, strength * 0.18);

      ctx.globalCompositeOperation = "source-over";
      const coreR = r * (0.78 + mass * 0.08);
      const photosphere = ctx.createRadialGradient(-coreR * 0.16, -coreR * 0.18, 0, 0, 0, coreR);
      photosphere.addColorStop(0, rgbCss(mixRgb(hot, [255, 255, 255], 0.5 + b * 0.35), 0.98));
      photosphere.addColorStop(0.32, rgbCss(hot, 0.96));
      photosphere.addColorStop(0.7, rgbCss(glow, 0.78));
      photosphere.addColorStop(1, rgbCss(rgb, 0.08));
      ctx.fillStyle = photosphere;
      ctx.beginPath();
      ctx.arc(0, 0, coreR, 0, TAU);
      ctx.fill();

      ctx.globalCompositeOperation = add;
      const sparkR = r * (0.42 + b * 0.38);
      const spark = ctx.createRadialGradient(0, 0, 0, 0, 0, sparkR);
      spark.addColorStop(0, rgbCss([255, 255, 255], (dark ? 0.72 : 0.48) * b));
      spark.addColorStop(0.4, rgbCss(hot, (dark ? 0.32 : 0.2) * b));
      spark.addColorStop(1, rgbCss(hot, 0));
      ctx.fillStyle = spark;
      ctx.beginPath();
      ctx.arc(0, 0, sparkR, 0, TAU);
      ctx.fill();
      ctx.restore();

      if (opt.selected) {
        ctx.beginPath();
        ctx.arc(x, y, r * 1.28, 0, TAU);
        ctx.strokeStyle = rgbCss(hot, 0.5);
        ctx.lineWidth = opt.lineWidth || Math.max(1, r * 0.05);
        ctx.stroke();
      }
    }

    galaxyPalette(type, seed) {
      const palettes = {
        spiral: { core: [255, 226, 186], disk: [168, 178, 198], arm: [132, 164, 214], dust: [42, 32, 28] },
        barred: { core: [255, 214, 168], disk: [176, 168, 158], arm: [148, 170, 206], dust: [48, 34, 28] },
        elliptical: { core: [255, 232, 196], disk: [214, 196, 168], arm: [198, 178, 150], dust: [70, 56, 44] },
        lenticular: { core: [248, 228, 196], disk: [186, 176, 164], arm: [170, 164, 158], dust: [36, 28, 24] },
        flocculent: { core: [255, 220, 190], disk: [154, 166, 188], arm: [118, 156, 210], dust: [40, 34, 38] },
        irregular: { core: [236, 214, 190], disk: [140, 152, 168], arm: [96, 142, 196], dust: [32, 28, 30] },
      };
      const base = palettes[type] || palettes.spiral;
      const shift = ((seed % 17) - 8) * 1.6;
      const tint = (rgb) => [
        clamp(Math.round(rgb[0] + shift), 0, 255),
        clamp(Math.round(rgb[1] + shift * 0.4), 0, 255),
        clamp(Math.round(rgb[2] - shift * 0.5), 0, 255),
      ];
      return { core: tint(base.core), disk: tint(base.disk), arm: tint(base.arm), dust: base.dust };
    }

    paintGalaxy(ctx, x, y, r, data, opt) {
      const type = data.galaxy || "spiral";
      const seed = hash(data.id || data.path || "g");
      const pal = this.galaxyPalette(type, seed);
      const u = (key) => hash(`${seed}:${key}`) / 4294967295;
      const dark = opt.dark !== false;
      const tilt = type === "elliptical" ? 0.58 + u("t") * 0.3 : 0.26 + u("t") * 0.5;
      const rot = (u("r") - 0.5) * 1.35;
      const current = !!data.current;
      const add = "lighter";
      const arms = type === "spiral" || type === "barred" ? 2 : type === "flocculent" ? 5 : 0;
      const pitch = type === "flocculent" ? 0.31 : 0.19 + u("p") * 0.05;
      const armPhase = u("ph") * TAU;
      const armWidth = type === "flocculent" ? 0.55 : 0.22;
      const armDensity = (th, rad) => {
        if (!arms) return 0;
        let best = 0;
        for (let k = 0; k < arms; k += 1) {
          const ideal = Math.log(Math.max(0.08, rad / (r * 0.08))) / pitch;
          const a = th - armPhase - k * (TAU / arms) - ideal;
          const d = Math.abs(Math.atan2(Math.sin(a), Math.cos(a)));
          best = Math.max(best, Math.exp(-((d / armWidth) ** 2)));
        }
        return best;
      };

      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(rot);

      const haloR = r * (type === "elliptical" ? 2.55 : 2.2);
      const halo = ctx.createRadialGradient(0, 0, 0, 0, 0, haloR);
      halo.addColorStop(0, rgbCss(pal.core, dark ? 0.16 : 0.1));
      halo.addColorStop(0.22, rgbCss(pal.disk, dark ? 0.08 : 0.06));
      halo.addColorStop(1, rgbCss(pal.disk, 0));
      ctx.fillStyle = halo;
      ctx.beginPath();
      ctx.ellipse(0, 0, haloR, haloR * (type === "elliptical" ? tilt : Math.max(0.55, tilt)), 0, 0, TAU);
      ctx.fill();

      ctx.globalCompositeOperation = add;
      const diskR = r * 1.08;
      const disk = ctx.createRadialGradient(0, 0, r * 0.02, 0, 0, diskR);
      disk.addColorStop(0, rgbCss(mixRgb(pal.core, [255, 255, 255], 0.15), dark ? 0.42 : 0.28));
      disk.addColorStop(0.18, rgbCss(pal.core, dark ? 0.22 : 0.16));
      disk.addColorStop(0.55, rgbCss(pal.disk, dark ? 0.1 : 0.08));
      disk.addColorStop(1, rgbCss(pal.arm, 0));
      ctx.fillStyle = disk;
      ctx.beginPath();
      ctx.ellipse(0, 0, diskR, diskR * tilt, 0, 0, TAU);
      ctx.fill();

      if (type === "barred") {
        const bar = ctx.createLinearGradient(-r * 0.7, 0, r * 0.7, 0);
        bar.addColorStop(0, rgbCss(pal.core, 0));
        bar.addColorStop(0.5, rgbCss(pal.core, dark ? 0.28 : 0.18));
        bar.addColorStop(1, rgbCss(pal.core, 0));
        ctx.fillStyle = bar;
        ctx.beginPath();
        ctx.ellipse(0, 0, r * 0.68, r * 0.075 * tilt, 0.04, 0, TAU);
        ctx.fill();
      }

      const starN = Math.round(clamp(r * (r < 90 ? 2.4 : 1.15), 36, 220));
      for (let i = 0; i < starN; i += 1) {
        const rad = Math.pow(u(`sr${i}`), type === "elliptical" ? 0.72 : 0.52) * r;
        const th = u(`st${i}`) * TAU;
        let dens = Math.exp(-rad / (r * (type === "elliptical" ? 0.38 : 0.5)));
        const arm = armDensity(th, rad);
        if (type === "irregular") dens *= 0.35 + 0.9 * (0.5 + 0.5 * Math.sin(th * 2.2 + u("irr") * 4));
        else dens = dens * (0.28 + arm * 0.85) + (type === "elliptical" || type === "lenticular" ? dens * 0.55 : 0);
        if (u(`sk${i}`) > dens + 0.08) continue;
        const px = Math.cos(th) * rad;
        const py = Math.sin(th) * rad * tilt;
        const young = arm > 0.35 && rad > r * 0.18;
        const col = rad < r * 0.16 ? pal.core : young ? pal.arm : pal.disk;
        const sz = 0.35 + u(`ss${i}`) * (young ? 1.25 : 0.75);
        ctx.fillStyle = rgbCss(col, (dark ? 0.22 : 0.16) + dens * 0.42);
        ctx.fillRect(px, py, sz, sz);
      }

      if (type === "irregular") {
        const blobs = 3 + (seed % 3);
        for (let i = 0; i < blobs; i += 1) {
          const a = u(`ib${i}`) * TAU;
          const d = r * (0.16 + u(`id${i}`) * 0.46);
          const br = r * (0.12 + u(`is${i}`) * 0.16);
          const px = Math.cos(a) * d;
          const py = Math.sin(a) * d * tilt;
          const g = ctx.createRadialGradient(px, py, 0, px, py, br);
          g.addColorStop(0, rgbCss(i % 2 ? pal.arm : pal.core, dark ? 0.22 : 0.16));
          g.addColorStop(1, rgbCss(pal.disk, 0));
          ctx.fillStyle = g;
          ctx.beginPath();
          ctx.arc(px, py, br, 0, TAU);
          ctx.fill();
        }
      }

      if (type === "spiral" || type === "barred" || type === "lenticular") {
        ctx.globalCompositeOperation = "source-over";
        ctx.fillStyle = rgbCss(pal.dust, dark ? (type === "lenticular" ? 0.28 : 0.16) : 0.1);
        ctx.beginPath();
        ctx.ellipse(0, r * 0.03, r * 0.7, r * (type === "lenticular" ? 0.055 : 0.038) * tilt, 0.1, 0, TAU);
        ctx.fill();
      }

      ctx.globalCompositeOperation = add;
      const bulgeR = r * (type === "elliptical" ? 0.58 : type === "lenticular" ? 0.38 : 0.24);
      const bulge = ctx.createRadialGradient(-bulgeR * 0.1, -bulgeR * 0.08, 0, 0, 0, bulgeR);
      bulge.addColorStop(0, rgbCss(mixRgb(pal.core, [255, 255, 255], 0.42), dark ? 0.78 : 0.62));
      bulge.addColorStop(0.4, rgbCss(pal.core, dark ? 0.32 : 0.24));
      bulge.addColorStop(1, rgbCss(pal.core, 0));
      ctx.fillStyle = bulge;
      ctx.beginPath();
      ctx.ellipse(0, 0, bulgeR, bulgeR * (type === "elliptical" ? 0.8 : 0.88), 0, 0, TAU);
      ctx.fill();

      ctx.restore();
      if (opt.selected || opt.hovered || current) {
        ctx.beginPath();
        ctx.ellipse(x, y, r * 1.16, r * 1.16 * tilt, rot, 0, TAU);
        ctx.strokeStyle = rgbCss(pal.core, current || opt.selected ? 0.32 : 0.16);
        ctx.lineWidth = opt.lineWidth || Math.max(0.7, r * 0.018);
        ctx.stroke();
      }
    }

    drawStar3d(ctx, node, selected, theme, time) {
      const z = (node.z || 0) * this.spaceMix;
      const core = this.project(node.x, node.y, z);
      if (!this.projectedOk(core)) return null;
      const s = Math.min(core.s, 3.6);
      const metrics = this.starMetrics(node);
      const r = Math.max(6, node.r * s * (0.92 + metrics.mass * 0.18));
      if (r > Math.max(this.width, this.height) * 0.5) return null;
      this.paintStar(ctx, core.x, core.y, r, metrics.color, {
        selected,
        brightness: metrics.brightness,
        mass: metrics.mass,
        time,
        dark: !theme || theme.dark,
        reduced: this.reducedMotion || !this.options.motion,
      });
      return { x: core.x, y: core.y, r: r * 1.15, s: core.s, depth: core.depth, star: true };
    }

    paintSphere(ctx, x, y, r, color, opt) {
      const rgb = hexRgb(color);
      const light = mixRgb(rgb, [255, 244, 220], 0.5);
      const shade = mixRgb(rgb, [8, 10, 18], 0.58);
      if (opt.atmosphere && r > 5) {
        const halo = ctx.createRadialGradient(x, y, r * 0.68, x, y, r * 1.4);
        halo.addColorStop(0, rgbCss(rgb, 0));
        halo.addColorStop(0.62, rgbCss(rgb, opt.dark ? 0.11 : 0.08));
        halo.addColorStop(1, rgbCss(rgb, 0));
        ctx.fillStyle = halo;
        ctx.beginPath();
        ctx.arc(x, y, r * 1.4, 0, TAU);
        ctx.fill();
      }
      const g = ctx.createRadialGradient(x - r * 0.34, y - r * 0.36, r * 0.06, x + r * 0.1, y + r * 0.14, r);
      g.addColorStop(0, rgbCss(light));
      g.addColorStop(0.4, rgbCss(rgb));
      g.addColorStop(1, rgbCss(shade));
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, TAU);
      ctx.fill();
      if (r > 7) {
        ctx.fillStyle = "rgba(255,255,255,0.2)";
        ctx.beginPath();
        ctx.ellipse(x - r * 0.28, y - r * 0.3, r * 0.18, r * 0.11, -0.5, 0, TAU);
        ctx.fill();
      }
      ctx.beginPath();
      ctx.arc(x, y, r, 0, TAU);
      ctx.strokeStyle = hexToRgba(color, opt.selected ? 0.9 : 0.28);
      ctx.lineWidth = opt.lineWidth || 1;
      ctx.stroke();
    }

    drawGalaxy3d(ctx, node, selected, hovered, theme) {
      const z = (node.z || 0) * this.spaceMix;
      const p = this.project(node.x, node.y, z);
      if (!this.projectedOk(p)) return null;
      const r = Math.max(8, node.r * Math.min(p.s, this.isCatalog() ? 22 : 2.4));
      this.paintGalaxy(ctx, p.x, p.y, r, node.data, {
        selected,
        hovered,
        dark: true,
        lineWidth: selected ? 1.2 : 0.8,
      });
      return { x: p.x, y: p.y, r: r * 1.08, s: p.s, depth: p.depth, star: true };
    }

    drawBody3d(ctx, node, color, selected, theme) {
      const planet = node.data.kind === "order";
      const z = (node.z || 0) * this.spaceMix;
      const p = this.project(node.x, node.y, z);
      if (!this.projectedOk(p)) return this.drawVolumeFallback(ctx, node, color, selected, theme);
      const r = Math.max(planet ? 4.6 : 3, node.r * Math.min(p.s, 3.4) * (planet ? 1.02 : 0.82));
      if (r > Math.max(this.width, this.height) * 0.45) return null;
      this.paintSphere(ctx, p.x, p.y, r, color, {
        selected,
        atmosphere: planet && r > 5.5,
        lineWidth: selected ? 1.45 : 0.85,
        dark: !!theme.dark,
      });
      return { x: p.x, y: p.y, r, s: p.s, depth: p.depth };
    }

    drawNodes3d(ctx, theme, time) {
      const focus = this.selected;
      const searching = this.matches.size > 0;
      const ordered = this.nodes.slice().sort((a, b) => this.view(b).depth - this.view(a).depth);
      ordered.forEach((node) => {
        const p = this.view(node);
        if (!p.visible) return;
        const related = !focus || node === focus || this.hot.has(node.data.id);
        const matched = !searching || node.match;
        if (this.camera.zoom < 0.3 && node.data.kind === "line" && !related && !matched) return;
        ctx.globalAlpha = !focus || related ? 1 : 0.42;
        const color = node.data.color || "#64748b";
        const selected = node === this.selected;
        const hovered = node === this.hovered;
        const cap = node.data.kind === "galaxy"
          ? this.drawGalaxy3d(ctx, node, selected, hovered, theme)
          : node.data.kind === "customer"
          ? this.drawStar3d(ctx, node, selected, theme, time)
          : this.drawBody3d(ctx, node, color, selected, theme);
        if (!cap) return;
        if ((selected || hovered) && !cap.star && cap.r > 4 && cap.r < Math.max(this.width, this.height) * 0.55) {
          ctx.strokeStyle = hexToRgba(color, selected ? 0.5 : 0.3);
          ctx.lineWidth = 1.2;
          ctx.beginPath();
          ctx.arc(cap.x, cap.y, cap.r + 6, 0, TAU);
          ctx.stroke();
        }
        if (node.data.debt > 0.005) {
          ctx.strokeStyle = "#dc2626";
          ctx.lineWidth = 1.6;
          ctx.beginPath();
          ctx.arc(cap.x, cap.y, cap.r + 4, -Math.PI / 2, -Math.PI / 2 + TAU * clamp(node.data.debt / Math.max(node.data.value, 1), 0.08, 1));
          ctx.stroke();
        }
        const screen = { ...p, x: cap.x, y: cap.y, r: cap.r, s: cap.s };
        const mustLabel = selected || hovered || node.match || node.data.kind === "customer" || node.data.kind === "galaxy"
          || (node.data.kind === "order" && cap.s > 0.55)
          || (node.data.kind === "line" && cap.s > 1.2);
        const alwaysGalaxy = this.isCatalog() && node.data.kind === "galaxy";
        if ((this.options.labels && mustLabel) || selected || alwaysGalaxy) this.drawLabel3d(ctx, node, screen, theme, selected || hovered || node.match || alwaysGalaxy);
      });
      ctx.globalAlpha = 1;
    }

    drawLabel3d(ctx, node, p, theme, emphasized) {
      const fontSize = clamp(node.data.kind === "galaxy" || node.data.kind === "customer" ? 12 : 11, 8, 15);
      ctx.font = `${node.data.kind === "customer" || node.data.kind === "galaxy" ? 650 : 500} ${fontSize}px Segoe UI, sans-serif`;
      const label = this.truncate(ctx, node.data.label || "Без названия", node.data.kind === "galaxy" ? 200 : node.data.kind === "line" ? 120 : 170);
      const x = p.x + p.r + 8;
      const y = p.y + fontSize * 0.35;
      if (emphasized) {
        const width = ctx.measureText(label).width;
        ctx.fillStyle = theme.dark ? "rgba(8,16,28,0.86)" : "rgba(255,255,255,0.9)";
        ctx.beginPath();
        ctx.roundRect(x - 4, y - fontSize, width + 8, fontSize + 6, 5);
        ctx.fill();
      }
      ctx.fillStyle = theme.ink;
      ctx.fillText(label, x, y);
    }

    drawHeatMarks3d(ctx, theme, time) {
      const marks = this.heatGroup("customer");
      const foci = marks.length ? marks : this.heatGroup("order");
      if (!foci.length) return;
      const peak = this.heatPeak(foci);
      foci.forEach((n) => {
        const p = this.view(n);
        if (!this.onScreen(p, 24)) return;
        const t = heatTone(n.data.debt, peak);
        const [r, g, b] = heatRgb(t, theme.dark);
        const pulse = this.reducedMotion ? 1 : 0.72 + 0.28 * Math.sin((time || 0) / 380 + n.x * 0.012);
        ctx.strokeStyle = `rgba(${r},${g},${b},${0.55 + 0.35 * t})`;
        ctx.lineWidth = 2.4 + 2.8 * t;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r + 8 + 7 * pulse, 0, TAU);
        ctx.stroke();
      });
    }

    drawCatalogVoid(ctx, theme, parallax) {
      const w = this.width;
      const h = this.height;
      ctx.fillStyle = theme.bg || "#03060c";
      ctx.fillRect(0, 0, w, h);
      const yaw = parallax ? this.orbit.yaw : 0;
      const pitch = parallax ? this.orbit.pitch : 0;
      const cx = w * 0.5 + Math.sin(yaw) * 28;
      const cy = h * 0.46 + (pitch - 0.68) * 36;
      const wash = ctx.createRadialGradient(cx, cy, 12, w * 0.5, h * 0.5, Math.max(w, h) * 0.78);
      wash.addColorStop(0, "rgba(22, 34, 58, 0.55)");
      wash.addColorStop(0.38, "rgba(12, 18, 36, 0.28)");
      wash.addColorStop(1, "rgba(0, 0, 0, 0)");
      ctx.fillStyle = wash;
      ctx.fillRect(0, 0, w, h);
      const band = ctx.createLinearGradient(0, h * 0.38, w, h * 0.62);
      band.addColorStop(0, "rgba(0,0,0,0)");
      band.addColorStop(0.45, "rgba(48, 58, 86, 0.1)");
      band.addColorStop(0.55, "rgba(70, 52, 64, 0.08)");
      band.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = band;
      ctx.fillRect(0, 0, w, h);
      ctx.save();
      ctx.globalCompositeOperation = "lighter";
      this.stars.forEach((s) => {
        const x = ((((s.x * 0.5 + 0.5 + yaw * 0.035 * s.z) % 1) + 1) % 1) * w;
        const y = ((((s.y * 0.5 + 0.5 + pitch * 0.028 * s.z) % 1) + 1) % 1) * h;
        const tw = this.reducedMotion ? 0.7 : 0.45 + 0.55 * (0.5 + 0.5 * Math.sin(performance.now() * 0.0006 + s.tw * TAU));
        const a = (0.18 + s.s * 0.22) * tw;
        const size = s.s < 1.4 ? 1 : 1.35;
        ctx.fillStyle = s.hue ? `rgba(210,222,255,${a})` : `rgba(255,248,236,${a})`;
        ctx.fillRect(x, y, size, size);
      });
      ctx.restore();
    }

