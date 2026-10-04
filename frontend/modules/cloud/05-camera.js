    simulate(dt) {
      const step = Math.min(1.7, dt / 16.67);
      this.stepDepth(step);
      if (this.isCatalog()) {
        this.nodes.forEach((n) => {
          if (n.pinned) return;
          n.x += ((n.tx ?? n.x) - n.x) * 0.06 * step;
          n.y += ((n.ty ?? n.y) - n.y) * 0.06 * step;
        });
        this.alpha *= 0.94 ** step;
        return;
      }
      if (!this.options.motion || this.reducedMotion || this.alpha < 0.002) return;
      const alpha = this.alpha;
      this.grid.clear();
      this.nodes.forEach((n) => this.grid.add(n));

      this.nodes.forEach((n) => {
        if (n.pinned) return;
        const targetStrength = 0.014;
        n.vx += (n.tx - n.x) * targetStrength * alpha * step;
        n.vy += (n.ty - n.y) * targetStrength * alpha * step;
        this.grid.near(n.x, n.y, 1).forEach((other) => {
          if (other.index <= n.index) return;
          const related = n.data.parent === other.data.id || other.data.parent === n.data.id;
          let dx = other.x - n.x;
          let dy = other.y - n.y;
          let d2 = dx * dx + dy * dy;
          if (d2 < 0.01) {
            dx = jitter(n.data.id, other.index) * 0.25;
            dy = jitter(other.data.id, n.index) * 0.25;
            d2 = dx * dx + dy * dy;
          }
          const d = Math.sqrt(d2);
          const pad = related ? 5 : (n.data.kind === "customer" || other.data.kind === "customer" ? 18 : 8);
          const min = n.r + other.r + pad;
          if (d >= min * 1.75) return;
          const force = ((min * 1.75 - d) / Math.max(d, 1)) * 0.058 * alpha;
          const fx = dx * force;
          const fy = dy * force;
          if (!n.pinned) {
            n.vx -= fx;
            n.vy -= fy;
          }
          if (!other.pinned) {
            other.vx += fx;
            other.vy += fy;
          }
        });
      });

      this.edges.forEach((edge) => {
        const a = edge.source;
        const b = edge.target;
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const dist = Math.hypot(dx, dy) || 1;
        const ideal = Math.hypot((b.tx ?? b.x) - (a.tx ?? a.x), (b.ty ?? b.y) - (a.ty ?? a.y))
          || (edge.kind === "customer" ? 90 : 28);
        const force = (dist - ideal) * (edge.kind === "customer" ? 0.0014 : 0.0024) * alpha * step;
        const fx = (dx / dist) * force;
        const fy = (dy / dist) * force;
        if (!a.pinned) {
          a.vx += fx;
          a.vy += fy;
        }
        if (!b.pinned) {
          b.vx -= fx;
          b.vy -= fy;
        }
      });

      this.nodes.forEach((n) => {
        if (n.pinned) {
          n.vx = 0;
          n.vy = 0;
          return;
        }
        n.vx *= 0.83;
        n.vy *= 0.83;
        n.x += n.vx * step;
        n.y += n.vy * step;
      });
      this.alpha *= 0.975 ** step;
    }

    stepDepth(step) {
      this.nodes.forEach((n) => {
        const wantZ = this.spaceTarget > 0.5 ? (n.tz || 0) : 0;
        n.vz = (n.vz || 0) + (wantZ - (n.z || 0)) * 0.018 * step;
        n.vz *= 0.82;
        n.z = (n.z || 0) + n.vz * step;
      });
    }

    loop(time) {
      const dt = time - this.lastTime;
      this.lastTime = time;
      const moving = this.stepCamera(dt);
      const live = this.options.motion && !this.reducedMotion && (this.alpha > 0.002 || this.matches.size || this.edges.length);
      const heatPulse = this.options.heat && !this.reducedMotion;
      const spaceLive = Math.abs(this.spaceMix - this.spaceTarget) > 0.002 || (this.options.space3d && !this.reducedMotion);
      if (this.needsFrame || live || heatPulse || spaceLive || this.drag || this.tour || moving) {
        this.simulate(dt);
        this.draw(time);
        this.needsFrame = false;
      }
      this.frame = requestAnimationFrame(this.loop);
    }

    stepCamera(dt) {
      const step = Math.min(1.8, dt / 16.67);
      let moving = false;
      const mixGap = this.spaceTarget - this.spaceMix;
      if (Math.abs(mixGap) > 0.002) {
        const k = 1 - Math.exp(-(Math.max(dt, 0) / 1000) / 0.28);
        this.spaceMix += mixGap * k;
        moving = true;
      } else {
        this.spaceMix = this.spaceTarget;
      }
      if (this.drag) {
        this.camTween = null;
        this.orbitTween = null;
      } else if (this.orbitTween) {
        moving = this.stepOrbitTween() || moving;
      } else if (this.camTween) {
        moving = this.stepTween() || moving;
      } else {
        moving = this.easeZoom(dt) || moving;
      }
      if (!this.drag && (Math.abs(this.panVel.x) > 0.12 || Math.abs(this.panVel.y) > 0.12)) {
        this.panCamera(this.panVel.x * step, this.panVel.y * step);
        this.panVel.x *= 0.9 ** step;
        this.panVel.y *= 0.9 ** step;
        this.syncZoomAnchor();
        this.transformChanged();
        moving = true;
      }
      if (this.spaceMix > 0.01 && !this.drag) {
        if (Math.abs(this.orbitVel.yaw) > 0.00005 || Math.abs(this.orbitVel.pitch) > 0.00005) {
          this.orbit.yaw += this.orbitVel.yaw * step;
          this.orbit.pitch = clamp(this.orbit.pitch + this.orbitVel.pitch * step, 0.22, 1.08);
          this.orbitVel.yaw *= 0.94 ** step;
          this.orbitVel.pitch *= 0.94 ** step;
          moving = true;
        } else if (this.options.space3d && !this.reducedMotion && performance.now() > this.idleUntil) {
          this.orbit.yaw += 0.00115 * step;
          moving = true;
        }
      }
      return moving;
    }

    stepTween() {
      const tween = this.camTween;
      if (!tween) return false;
      const raw = tween.duration <= 0 ? 1 : clamp((performance.now() - tween.start) / tween.duration, 0, 1);
      const p = easeOut(raw);
      this.camera.x = tween.from.x + (tween.to.x - tween.from.x) * p;
      this.camera.y = tween.from.y + (tween.to.y - tween.from.y) * p;
      this.camera.zoom = tween.from.zoom + (tween.to.zoom - tween.from.zoom) * p;
      this.zoomTarget = tween.to.zoom;
      this.transformChanged();
      if (raw >= 1) this.camTween = null;
      return raw < 1;
    }

    stepOrbitTween() {
      const tween = this.orbitTween;
      if (!tween) return false;
      const raw = tween.duration <= 0 ? 1 : clamp((performance.now() - tween.start) / tween.duration, 0, 1);
      const p = raw < 0.5 ? 2 * raw * raw : 1 - ((-2 * raw + 2) ** 2) / 2;
      this.orbit.yaw = tween.from.yaw + (tween.to.yaw - tween.from.yaw) * p;
      this.orbit.pitch = tween.from.pitch + (tween.to.pitch - tween.from.pitch) * p;
      this.camera.zoom = tween.from.zoom + (tween.to.zoom - tween.from.zoom) * p;
      this.camera.x = tween.from.x + (tween.to.x - tween.from.x) * p;
      this.camera.y = tween.from.y + (tween.to.y - tween.from.y) * p;
      if (tween.from.tx != null && tween.to.tx != null) {
        this.orbit.targetX = tween.from.tx + (tween.to.tx - tween.from.tx) * p;
        this.orbit.targetY = tween.from.ty + (tween.to.ty - tween.from.ty) * p;
        this.orbit.targetZ = tween.from.tz + (tween.to.tz - tween.from.tz) * p;
      }
      this.zoomTarget = tween.to.zoom;
      this.transformChanged();
      if (raw >= 1) this.orbitTween = null;
      return raw < 1;
    }

    easeZoom(dt) {
      const from = this.camera.zoom;
      const to = this.zoomTarget;
      if (Math.abs(to - from) < 0.00035) {
        if (from !== to) this.applyZoom(to);
        return false;
      }
      const tau = this.reducedMotion ? 0.012 : 0.08;
      const k = 1 - Math.exp(-(Math.max(dt, 0) / 1000) / tau);
      this.applyZoom(from + (to - from) * k);
      return true;
    }

    zoomRange() {
      return this.isCatalog() ? { min: 0.08, max: 16 } : { min: 0.14, max: 5.4 };
    }

    applyZoom(next) {
      const range = this.zoomRange();
      const zoom = clamp(next, range.min, range.max);
      const anchor = this.zoomAnchor;
      this.camera.zoom = zoom;
      this.camera.x = anchor.sx - this.width / 2 - anchor.wx * zoom;
      this.camera.y = anchor.sy - this.height / 2 - anchor.wy * zoom;
      this.transformChanged();
    }

    zoomFocusScreen() {
      if (this.viewPinned && this.selected) {
        const p = this.view(this.selected);
        if (p.visible && Number.isFinite(p.x) && Number.isFinite(p.y)) return { sx: p.x, sy: p.y };
      }
      if (this.is3d()) {
        const p = this.project(this.orbit.targetX, this.orbit.targetY, this.orbit.targetZ);
        if (p.visible && Number.isFinite(p.x) && Number.isFinite(p.y)) return { sx: p.x, sy: p.y };
      }
      return { sx: this.width / 2, sy: this.height / 2 };
    }

    syncZoomAnchor() {
      const zoom = this.camera.zoom || 1;
      const sx = this.zoomAnchor?.sx ?? this.width / 2;
      const sy = this.zoomAnchor?.sy ?? this.height / 2;
      this.zoomAnchor = {
        sx,
        sy,
        wx: (sx - this.width / 2 - this.camera.x) / zoom,
        wy: (sy - this.height / 2 - this.camera.y) / zoom,
      };
    }

    settleZoom() {
      this.camTween = null;
      const range = this.zoomRange();
      const target = clamp(this.zoomTarget, range.min, range.max);
      if (Math.abs((this.camera.zoom || 1) - target) > 0.0002) this.applyZoom(target);
      this.zoomTarget = target;
    }

    aimZoom(target, sx, sy) {
      this.camTween = null;
      this.orbitTween = null;
      const zoom = this.camera.zoom || 1;
      const pivot = sx == null || sy == null ? this.zoomFocusScreen() : { sx, sy };
      const range = this.zoomRange();
      this.zoomTarget = clamp(target, range.min, range.max);
      this.zoomAnchor = {
        sx: pivot.sx,
        sy: pivot.sy,
        wx: (pivot.sx - this.width / 2 - this.camera.x) / zoom,
        wy: (pivot.sy - this.height / 2 - this.camera.y) / zoom,
      };
      this.needsFrame = true;
    }

    theme() {
      if (this.isCatalog()) {
        return {
          dark: true,
          bg: "#03060c",
          bg2: "#070b14",
          nebula: ["rgba(36,52,92,0.16)", "rgba(78,42,70,0.08)", "rgba(18,70,88,0.07)"],
          grid: "rgba(0,0,0,0)",
          ink: "#e8eef6",
          muted: "#93a4bb",
          edge: "rgba(148,163,184,.12)",
          hull: "rgba(0,0,0,0)",
        };
      }
      const dark = document.documentElement.getAttribute("data-theme") === "dark";
      return dark
        ? {
          dark: true,
          bg: "#050b14",
          bg2: "#0a1626",
          nebula: ["rgba(15,118,110,0.16)", "rgba(37,99,235,0.12)", "rgba(124,58,237,0.1)"],
          grid: "rgba(148,163,184,.055)",
          ink: "#e2e8f0",
          muted: "#8b9bb0",
          edge: "rgba(148,163,184,.18)",
          hull: "rgba(20,184,166,0.07)",
        }
        : {
          dark: false,
          bg: "#f4f8fb",
          bg2: "#e8f2f4",
          nebula: ["rgba(15,118,110,0.08)", "rgba(37,99,235,0.06)", "rgba(201,162,39,0.05)"],
          grid: "rgba(15,118,110,.055)",
          ink: "#0f172a",
          muted: "#64748b",
          edge: "rgba(71,85,105,.16)",
          hull: "rgba(15,118,110,0.06)",
        };
    }

    is3d() {
      return this.spaceMix > 0.01;
    }

    cameraSpace(x, y, z = 0) {
      const px = x - this.orbit.targetX;
      const py = y - this.orbit.targetY;
      const pz = z - this.orbit.targetZ;
      const cy = Math.cos(this.orbit.yaw);
      const sy = Math.sin(this.orbit.yaw);
      const rx = px * cy - py * sy;
      const ry = px * sy + py * cy;
      const rz = pz;
      const cp = Math.cos(this.orbit.pitch);
      const sp = Math.sin(this.orbit.pitch);
      const zoom = this.camera.zoom || 1;
      const dist = this.orbit.dist / Math.max(0.18, zoom);
      return {
        cx: rx,
        cy: -ry * cp - rz * sp,
        depth: ry * sp - rz * cp + dist,
      };
    }

    project(x, y, z = 0) {
      const mix = this.spaceMix;
      const zoom = this.camera.zoom || 1;
      const ox = this.width / 2 + this.camera.x;
      const oy = this.height / 2 + this.camera.y;
      const ortho = { x: ox + x * zoom, y: oy + y * zoom, s: zoom, depth: 900, visible: true };
      if (mix < 0.001) return ortho;
      const cam = this.cameraSpace(x, y, z);
      const near = 42;
      if (cam.depth < near) return { x: ox, y: oy, s: 0, depth: cam.depth, visible: false };
      const persp = this.orbit.focal / cam.depth;
      return {
        x: lerp(ortho.x, ox + cam.cx * persp, mix),
        y: lerp(ortho.y, oy + cam.cy * persp, mix),
        s: lerp(ortho.s, persp, mix),
        depth: cam.depth,
        visible: true,
      };
    }

    projectedOk(p) {
      if (!(p && p.visible && Number.isFinite(p.x) && Number.isFinite(p.y) && p.s > 0.05)) return false;
      if (this.spaceMix > 0.01 && p.s >= 14) return false;
      return true;
    }

    onScreen(p, pad = 0) {
      return this.projectedOk(p)
        && p.x >= -pad && p.x <= this.width + pad
        && p.y >= -pad && p.y <= this.height + pad;
    }

    cameraWorld() {
      const zoom = Math.max(0.18, this.camera.zoom || 1);
      const dist = this.orbit.dist / zoom;
      const cy = Math.cos(this.orbit.yaw);
      const sy = Math.sin(this.orbit.yaw);
      const cp = Math.cos(this.orbit.pitch);
      const sp = Math.sin(this.orbit.pitch);
      return {
        x: this.orbit.targetX - dist * sp * sy,
        y: this.orbit.targetY - dist * sp * cy,
        z: this.orbit.targetZ + dist * cp,
      };
    }

    lookFromAt(cam, target) {
      const dx = cam.x - target.x;
      const dy = cam.y - target.y;
      const dz = cam.z - target.z;
      const dist = Math.max(48, Math.hypot(dx, dy, dz) || 48);
      const zoom = Math.max(0.18, this.camera.zoom || 1);
      this.orbit.targetX = target.x;
      this.orbit.targetY = target.y;
      this.orbit.targetZ = target.z;
      this.orbit.dist = dist * zoom;
      this.orbit.pitch = clamp(Math.acos(clamp(dz / dist, -1, 1)), 0.22, 1.08);
      if (Math.hypot(dx, dy) > 1e-3) this.orbit.yaw = Math.atan2(-dx, -dy);
    }

    rotateAroundAxis(point, origin, axis, angle) {
      const len = Math.hypot(axis.x, axis.y, axis.z) || 1;
      const ux = axis.x / len;
      const uy = axis.y / len;
      const uz = axis.z / len;
      const c = Math.cos(angle);
      const s = Math.sin(angle);
      const vx = point.x - origin.x;
      const vy = point.y - origin.y;
      const vz = point.z - origin.z;
      const dot = ux * vx + uy * vy + uz * vz;
      return {
        x: origin.x + vx * c + (uy * vz - uz * vy) * s + ux * dot * (1 - c),
        y: origin.y + vy * c + (uz * vx - ux * vz) * s + uy * dot * (1 - c),
        z: origin.z + vz * c + (ux * vy - uy * vx) * s + uz * dot * (1 - c),
      };
    }

    applyOrbitAroundPivot(dx, dy, drag) {
      const pivot = drag.pivot;
      const dYaw = -dx * 0.0074;
      const dPitch = clamp(drag.pitch - dy * 0.0054, 0.22, 1.08) - drag.pitch;
      let cam = this.rotateAroundAxis(drag.cam, pivot, { x: 0, y: 0, z: 1 }, dYaw);
      let target = this.rotateAroundAxis(drag.target, pivot, { x: 0, y: 0, z: 1 }, dYaw);
      cam = this.rotateAroundAxis(cam, pivot, drag.right, dPitch);
      target = this.rotateAroundAxis(target, pivot, drag.right, dPitch);
      this.lookFromAt(cam, target);
    }

    lockOrbitTarget(x, y, z = 8) {
      this.orbit.targetX = x;
      this.orbit.targetY = y;
      this.orbit.targetZ = z;
    }

    worldAtScreenCenter() {
      const zoom = this.camera.zoom || 1;
      if (!this.is3d()) {
        return {
          x: -this.camera.x / zoom,
          y: -this.camera.y / zoom,
          z: 0,
        };
      }
      const dist = this.orbit.dist / Math.max(0.18, zoom);
      const persp = this.orbit.focal / Math.max(48, dist);
      const camCx = -this.camera.x / persp;
      const camCy = -this.camera.y / persp;
      const cp = Math.cos(this.orbit.pitch);
      const ry = Math.abs(cp) > 0.08 ? -camCy / cp : 0;
      const rx = camCx;
      const cy = Math.cos(this.orbit.yaw);
      const sy = Math.sin(this.orbit.yaw);
      return {
        x: this.orbit.targetX + rx * cy + ry * sy,
        y: this.orbit.targetY - rx * sy + ry * cy,
        z: this.orbit.targetZ,
      };
    }

    absorbScreenPanIntoOrbit() {
      if (!this.is3d()) return;
      if (Math.abs(this.camera.x) < 0.35 && Math.abs(this.camera.y) < 0.35) {
        this.camera.x = 0;
        this.camera.y = 0;
        return;
      }
      const here = this.worldAtScreenCenter();
      this.orbit.targetX = here.x;
      this.orbit.targetY = here.y;
      this.camera.x = 0;
      this.camera.y = 0;
    }

    panCamera(dx, dy) {
      if (!dx && !dy) return;
      this.viewPinned = false;
      if (this.is3d()) {
        this.absorbScreenPanIntoOrbit();
        const z = this.orbit.targetZ;
        const tx = this.orbit.targetX;
        const ty = this.orbit.targetY;
        const p0 = this.project(tx, ty, z);
        const px = this.project(tx + 1, ty, z);
        const py = this.project(tx, ty + 1, z);
        const ax = px.x - p0.x;
        const ay = px.y - p0.y;
        const bx = py.x - p0.x;
        const by = py.y - p0.y;
        const det = ax * by - ay * bx;
        let wx;
        let wy;
        if (Math.abs(det) < 1e-5) {
          const s = Math.max(0.2, p0.s || this.camera.zoom || 1);
          wx = dx / s;
          wy = dy / s;
        } else {
          wx = (dx * by - dy * bx) / det;
          wy = (dy * ax - dx * ay) / det;
        }
        this.orbit.targetX -= wx;
        this.orbit.targetY -= wy;
      } else {
        this.camera.x += dx;
        this.camera.y += dy;
      }
    }

    prepareOrbitPivot() {
      this.camTween = null;
      this.orbitTween = null;
      if (this.viewPinned && this.selected) {
        this.orbitPivot = {
          x: this.selected.x,
          y: this.selected.y,
          z: (this.selected.z || 0) * this.spaceMix || 8,
        };
        return;
      }
      this.orbitPivot = this.worldAtScreenCenter();
    }

    clipFloorLine(x0, y0, x1, y1, near = 64, far = 2400) {
      const a0 = this.cameraSpace(x0, y0, 0);
      const b0 = this.cameraSpace(x1, y1, 0);
      if ((a0.depth < near && b0.depth < near) || (a0.depth > far && b0.depth > far)) return null;
      const atDepth = (p, q, d) => {
        const denom = q.depth - p.depth;
        if (Math.abs(denom) < 1e-8) return null;
        const t = (d - p.depth) / denom;
        if (t < -1e-4 || t > 1 + 1e-4) return null;
        return {
          cx: p.cx + (q.cx - p.cx) * t,
          cy: p.cy + (q.cy - p.cy) * t,
          depth: d,
        };
      };
      let a = a0;
      let b = b0;
      if (a0.depth < near) a = atDepth(a0, b0, near);
      else if (a0.depth > far) a = atDepth(a0, b0, far);
      if (b0.depth < near) b = atDepth(b0, a0, near);
      else if (b0.depth > far) b = atDepth(b0, a0, far);
      if (!a || !b) return null;
      const ox = this.width / 2 + this.camera.x;
      const oy = this.height / 2 + this.camera.y;
      const toScreen = (p) => {
        const persp = this.orbit.focal / Math.max(near, p.depth);
        return { x: ox + p.cx * persp, y: oy + p.cy * persp };
      };
      const sa = toScreen(a);
      const sb = toScreen(b);
      if (!Number.isFinite(sa.x + sa.y + sb.x + sb.y)) return null;
      const pad = 120;
      const on = (p) => p.x >= -pad && p.x <= this.width + pad && p.y >= -pad && p.y <= this.height + pad;
      if (!on(sa) && !on(sb)) return null;
      return { a: sa, b: sb, depth: (a.depth + b.depth) * 0.5 };
    }

    view(node) {
      const p = this.project(node.x, node.y, (node.z || 0) * this.spaceMix);
      return { ...p, r: Math.max(1.4, (node.r || 6) * p.s), node };
    }

    worldDeltaFromScreen(node, dx, dy) {
      const p0 = this.project(node.x, node.y, (node.z || 0) * this.spaceMix);
      const px = this.project(node.x + 1, node.y, (node.z || 0) * this.spaceMix);
      const py = this.project(node.x, node.y + 1, (node.z || 0) * this.spaceMix);
      const ax = px.x - p0.x;
      const ay = px.y - p0.y;
      const bx = py.x - p0.x;
      const by = py.y - p0.y;
      const det = ax * by - ay * bx;
      if (Math.abs(det) < 1e-5) return { x: dx / Math.max(0.2, p0.s), y: dy / Math.max(0.2, p0.s) };
      return { x: (dx * by - dy * bx) / det, y: (dy * ax - dx * ay) / det };
    }

