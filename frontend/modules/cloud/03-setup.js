  class OrderCloud {
    constructor(config) {
      this.canvas = config.canvas;
      this.minimap = config.minimap || null;
      this.onHover = config.onHover || (() => {});
      this.onSelect = config.onSelect || (() => {});
      this.onOpen = config.onOpen || (() => {});
      this.onTransform = config.onTransform || (() => {});
      this.ctx = this.canvas.getContext("2d", { alpha: false, desynchronized: true });
      this.miniCtx = this.minimap?.getContext("2d") || null;
      this.nodes = [];
      this.edges = [];
      this.bridges = [];
      this.nodeMap = new Map();
      this.grid = new SpatialGrid();
      this.camera = { x: 0, y: 0, zoom: 1 };
      this.zoomTarget = 1;
      this.zoomAnchor = { sx: 0, sy: 0, wx: 0, wy: 0 };
      this.camTween = null;
      this.orbitTween = null;
      this.panVel = { x: 0, y: 0 };
      this.orbit = { yaw: 0.4, pitch: 0.68, dist: 1080, focal: 920, targetX: 0, targetY: 0, targetZ: 8 };
      this.orbitVel = { yaw: 0, pitch: 0 };
      this.orbitPivot = null;
      this.spaceMix = 0;
      this.spaceTarget = 0;
      this.idleUntil = 0;
      this.options = { layout: "galaxy", labels: true, motion: true, heat: false, space3d: false, query: "", catalog: false, openOnClick: false };
      this.hovered = null;
      this.selected = null;
      this.viewPinned = false;
      this.pointer = null;
      this.drag = null;
      this.pendingCapture = null;
      this.hot = new Set();
      this.matches = new Set();
      this.frame = 0;
      this.alpha = 1;
      this.lastTime = performance.now();
      this.needsFrame = true;
      this.tour = null;
      this.stars = this.makeStars(420);
      this.dust = this.makeDust(48);
      this.reducedMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
      this.bind();
      this.resizeObserver = new ResizeObserver(() => this.resize());
      this.resizeObserver.observe(this.canvas.parentElement);
      this.resize();
      this.loop = this.loop.bind(this);
      requestAnimationFrame(this.loop);
    }

    makeStars(count) {
      return Array.from({ length: count }, (_, i) => ({
        x: (hash(`sx:${i}`) / 4294967295) * 2 - 1,
        y: (hash(`sy:${i}`) / 4294967295) * 2 - 1,
        z: 0.25 + (hash(`sz:${i}`) / 4294967295) * 0.9,
        s: 0.4 + (hash(`ss:${i}`) / 4294967295) * 1.6,
        tw: hash(`st:${i}`) / 4294967295,
        hue: hash(`sh:${i}`) % 2,
      }));
    }

    makeDust(count) {
      return Array.from({ length: count }, (_, i) => ({
        a: (hash(`da:${i}`) / 4294967295) * TAU,
        r: 80 + (hash(`dr:${i}`) / 4294967295) * 520,
        s: 8 + (hash(`ds:${i}`) / 4294967295) * 28,
        hue: hash(`dh:${i}`) % 2,
      }));
    }

    bind() {
      this.canvas.addEventListener("contextmenu", (e) => e.preventDefault());
      this.canvas.addEventListener("auxclick", (e) => { if (e.button === 1) e.preventDefault(); });
      this.canvas.addEventListener("mousedown", (e) => { if (e.button === 1) e.preventDefault(); });
      this.canvas.addEventListener("pointerdown", (e) => this.pointerDown(e));
      this.canvas.addEventListener("pointermove", (e) => this.pointerMove(e));
      this.canvas.addEventListener("pointerup", (e) => this.pointerUp(e));
      this.canvas.addEventListener("pointercancel", (e) => this.pointerUp(e));
      this.canvas.addEventListener("pointerleave", () => {
        if (!this.drag) this.setHover(null);
      });
      this.canvas.addEventListener("wheel", (e) => {
        e.preventDefault();
        this.stopTour();
        let dy = e.deltaY;
        if (e.deltaMode === 1) dy *= 16;
        if (e.deltaMode === 2) dy *= this.height;
        const pixels = Math.max(-140, Math.min(140, dy));
        const rect = this.canvas.getBoundingClientRect();
        const cursor = { sx: e.clientX - rect.left, sy: e.clientY - rect.top };
        const pivot = this.viewPinned && this.selected
          ? this.zoomFocusScreen()
          : this.is3d() ? this.zoomFocusScreen() : cursor;
        this.aimZoom(this.zoomTarget * Math.exp(-pixels * 0.00092), pivot.sx, pivot.sy);
      }, { passive: false });
      this.canvas.addEventListener("dblclick", (e) => {
        const node = this.pickNode(this.eventPoint(e));
        if (!node) return;
        if (node.data.kind === "galaxy" && this.options.openOnClick) return;
        this.onOpen(node.data);
      });
      this.canvas.addEventListener("keydown", (e) => this.onKey(e));
      if (this.minimap) {
        this.minimap.style.pointerEvents = "auto";
        this.minimap.style.cursor = "pointer";
        this.minimap.addEventListener("pointerdown", (e) => this.minimapJump(e));
      }
    }

    onKey(e) {
        if (e.key === "+" || e.key === "=") {
          e.preventDefault();
        this.zoomAt(1.22);
        } else if (e.key === "-") {
          e.preventDefault();
        this.zoomAt(1 / 1.22);
        } else if (e.key.toLowerCase() === "f") {
          e.preventDefault();
          this.fit();
      } else if (e.key.toLowerCase() === "t") {
        e.preventDefault();
        this.startTour();
        } else if (e.key === "Escape") {
        if (document.fullscreenElement || document.webkitFullscreenElement) return;
        this.stopTour();
          this.select(null);
      } else if (e.key === "Enter" && this.selected) {
        e.preventDefault();
        this.onOpen(this.selected.data);
      } else if (e.key.startsWith("Arrow")) {
        e.preventDefault();
        this.walk(e.key === "ArrowRight" || e.key === "ArrowDown" ? 1 : -1);
      }
    }

    resize() {
      const rect = this.canvas.parentElement.getBoundingClientRect();
      this.width = Math.max(320, rect.width);
      this.height = Math.max(360, rect.height);
      this.dpr = Math.min(2, window.devicePixelRatio || 1);
      this.canvas.width = Math.round(this.width * this.dpr);
      this.canvas.height = Math.round(this.height * this.dpr);
      this.canvas.style.width = `${this.width}px`;
      this.canvas.style.height = `${this.height}px`;
      this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
      this.needsFrame = true;
    }

