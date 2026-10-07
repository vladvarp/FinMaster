  /* ============ instances ============ */

  function getInst(canvas, type) {
    let inst = instances.get(canvas);
    if (!inst) {
      inst = { canvas, type, from: [], current: [], target: [], hover: null, raf: 0, tip: null, geom: null, opts: null };
      instances.set(canvas, inst);
      bindEvents(inst);
    }
    if (inst.type !== type) {
      inst.type = type;
      inst.from = [];
    }
    return inst;
  }

  function bindEvents(inst) {
    const canvas = inst.canvas;
    canvas.addEventListener("pointermove", (e) => {
      const rect = canvas.getBoundingClientRect();
      inst.pointer = { x: e.clientX - rect.left, y: e.clientY - rect.top };
      hitTest(inst);
    });
    canvas.addEventListener("pointerleave", () => {
      inst.pointer = null;
      if (inst.hover !== null) {
        inst.hover = null;
        draw(inst);
      }
      hideTip(inst);
    });
    canvas.addEventListener("click", (e) => {
      if (inst.type !== "line" || typeof inst.opts?.onPick !== "function") return;
      const rect = canvas.getBoundingClientRect();
      inst.pointer = { x: e.clientX - rect.left, y: e.clientY - rect.top };
      hitTest(inst);
      if (inst.hover == null) return;
      inst.opts.onPick(inst.hover, inst.opts.labels?.[inst.hover]);
    });
    if (window.ResizeObserver) {
      const ro = new ResizeObserver(() => {
        if (inst.opts) draw(inst);
      });
      ro.observe(canvas);
    }
  }

  function update(inst, targets, opts) {
    inst.opts = opts;
    inst.target = targets.map((row) => row.slice());
    if (opts.instant) {
      cancelAnimationFrame(inst.raf);
      inst.current = inst.target.map((row) => row.slice());
      inst.from = inst.target.map((row) => row.slice());
      draw(inst);
      if (inst.pointer) hitTest(inst);
      return;
    }
    if (!inst.from.length || reduceMotion()) {
      inst.from = targets.map((row) => row.map(() => 0));
      if (reduceMotion()) inst.from = targets.map((row) => row.slice());
    }
    inst.from = inst.target.map((row, i) => row.map((_, j) => (inst.current[i]?.[j] ?? inst.from[i]?.[j] ?? 0)));
    animate(inst);
  }

  function animate(inst) {
    cancelAnimationFrame(inst.raf);
    const start = performance.now();
    const step = (now) => {
      const t = reduceMotion() ? 1 : Math.min(1, (now - start) / DUR);
      const e = easeOut(t);
      inst.current = inst.target.map((row, i) => row.map((v, j) => {
        if (v == null || !Number.isFinite(v)) return null;
        const f = inst.from[i]?.[j];
        const from = f == null || !Number.isFinite(f) ? v : f;
        return from + (v - from) * e;
      }));
      draw(inst);
      if (t < 1) inst.raf = requestAnimationFrame(step);
      else inst.current = inst.target.map((row) => row.slice());
    };
    inst.raf = requestAnimationFrame(step);
  }

  function draw(inst) {
    if (!inst.opts) return;
    if (inst.type === "line") drawLine(inst);
    else if (inst.type === "bar") drawBar(inst);
    else drawDoughnut(inst);
  }

  function hitTest(inst) {
    if (!inst.pointer || !inst.geom) return;
    if (inst.type === "line") hitLine(inst);
    else if (inst.type === "bar") hitBar(inst);
    else hitDoughnut(inst);
  }

