    update(graph, options = {}) {
      const previous = this.nodeMap;
      this.options = { ...this.options, ...options };
      this.nodes = (graph.nodes || []).map((data, index) => {
        const old = previous.get(data.id);
        const node = old || {
          x: jitter(data.id, 1) * 260,
          y: jitter(data.id, 2) * 190,
          z: 0,
          vx: 0,
          vy: 0,
          vz: 0,
          pinned: false,
          phase: hash(data.id) / 4294967295,
        };
        if (!Number.isFinite(node.z)) node.z = 0;
        if (!Number.isFinite(node.vz)) node.vz = 0;
        node.data = data;
        node.index = index;
        node.r = data.radius || (data.kind === "galaxy" ? 36 : data.kind === "customer" ? 19 : data.kind === "order" ? 12 : 6);
        node.match = this.nodeMatches(data);
        return node;
      });
      this.nodeMap = new Map(this.nodes.map((n) => [n.data.id, n]));
      this.edges = (graph.edges || [])
        .map((edge) => ({
          ...edge,
          source: this.nodeMap.get(edge.source),
          target: this.nodeMap.get(edge.target),
        }))
        .filter((edge) => edge.source && edge.target);
      this.calculateTargets();
      this.bridges = this.buildBridges();
      this.refreshMatches();
      this.alpha = 1;
      this.spaceTarget = this.options.space3d ? 1 : 0;
      if (this.selected && !this.nodeMap.has(this.selected.data.id)) this.select(null);
      else if (this.selected) {
        this.selected = this.nodeMap.get(this.selected.data.id);
        this.buildHot();
      }
      this.needsFrame = true;
      if (!previous.size && this.nodes.length) requestAnimationFrame(() => this.fit(false));
    }

    nodeMatches(data) {
      const q = String(this.options.query || "").trim().toLocaleLowerCase("ru");
      if (!q) return false;
      return [data.label, data.customer, data.product, data.status, data.type, data.number, data.name, data.path, data.origin]
        .filter(Boolean)
        .join(" ")
        .toLocaleLowerCase("ru")
        .includes(q);
    }

    refreshMatches() {
      this.matches.clear();
      const q = String(this.options.query || "").trim();
      if (!q) return;
      this.nodes.forEach((n) => {
        n.match = this.nodeMatches(n.data);
        if (n.match) this.matches.add(n.data.id);
      });
    }

    setOptions(options) {
      const layoutChanged = (options.layout && options.layout !== this.options.layout)
        || (options.catalog !== undefined && options.catalog !== this.options.catalog);
      const queryChanged = options.query !== undefined && options.query !== this.options.query;
      const spaceChanged = options.space3d !== undefined && options.space3d !== this.options.space3d;
      this.options = { ...this.options, ...options };
      if (layoutChanged) {
        this.calculateTargets();
        this.bridges = this.buildBridges();
        this.nodes.forEach((n) => {
          n.pinned = false;
        });
        this.alpha = 1;
      }
      if (queryChanged) this.refreshMatches();
      if (spaceChanged) this.setSpace3d(!!this.options.space3d);
      this.needsFrame = true;
    }

    setSpace3d(on) {
      this.options.space3d = !!on;
      this.spaceTarget = on ? 1 : 0;
      this.idleUntil = performance.now() + 1600;
      this.orbitVel.yaw = 0;
      this.orbitVel.pitch = 0;
      this.assignDepth();
      this.needsFrame = true;
    }

    planetOrbit(star, index, planet) {
      return (star?.r || 19) + 50 + index * (34 + (planet?.r || 12) * 0.42);
    }

    moonOrbit(planet, count) {
      return (planet?.r || 10) + 15 + Math.min(18, Math.max(0, count) * 1.35);
    }

    placeMoons() {
      const kids = new Map();
      this.nodes.forEach((n) => {
        if (n.data.kind !== "line") return;
        const list = kids.get(n.data.parent) || [];
        list.push(n);
        kids.set(n.data.parent, list);
      });
      kids.forEach((group) => {
        const parent = this.nodeMap.get(group[0].data.parent);
        const ring = this.moonOrbit(parent, group.length);
        const spin = (parent?.phase || 0) * TAU;
        group.forEach((n, i) => {
          const a = (i / Math.max(1, group.length)) * TAU + spin;
          n.tx = (parent?.tx || 0) + Math.cos(a) * ring;
          n.ty = (parent?.ty || 0) + Math.sin(a) * ring;
          n.orbitR = ring;
        });
      });
    }

    layoutSolarSystems(mode) {
      const customers = this.nodes.filter((n) => n.data.kind === "customer");
      const byCustomer = new Map(customers.map((n) => [n.data.id, []]));
      this.nodes.forEach((n) => {
        if (n.data.kind === "order") byCustomer.get(n.data.parent)?.push(n);
      });
      const systems = customers.map((star) => {
        const planets = (byCustomer.get(star.data.id) || []).slice().sort((a, b) => {
          const dv = (b.data.value || 0) - (a.data.value || 0);
          return dv || String(a.data.id).localeCompare(String(b.data.id), "ru");
        });
        const last = planets.length
          ? this.planetOrbit(star, planets.length - 1, planets[planets.length - 1])
          : star.r + 40;
        return { star, planets, radius: last + 32 };
      });
      if (mode === "ring") {
        const count = Math.max(1, systems.length);
        const maxR = Math.max(40, ...systems.map((sys) => sys.radius));
        const ringR = count <= 1 ? 0 : Math.max(150, ((maxR * 2 + 72) * count) / TAU);
        systems.forEach((sys, i) => {
          const a = (i / count) * TAU - Math.PI / 2 + 0.41;
          sys.star.tx = Math.cos(a) * ringR;
          sys.star.ty = Math.sin(a) * ringR;
        });
      } else {
        let spiral = 0;
        systems.forEach((sys, i) => {
          if (i === 0) {
            sys.star.tx = 0;
            sys.star.ty = 0;
          } else {
            spiral += sys.radius + 58;
            const a = i * GOLDEN;
            sys.star.tx = Math.cos(a) * spiral;
            sys.star.ty = Math.sin(a) * spiral * 0.92;
            spiral += sys.radius * 0.06;
          }
        });
      }
      systems.forEach((sys) => {
        sys.star.systemR = sys.radius;
        const spin = (sys.star.phase || 0) * TAU;
        sys.planets.forEach((planet, oi) => {
          const orbitR = this.planetOrbit(sys.star, oi, planet);
          const a = oi * GOLDEN + spin;
          planet.tx = sys.star.tx + Math.cos(a) * orbitR;
          planet.ty = sys.star.ty + Math.sin(a) * orbitR;
          planet.orbitR = orbitR;
        });
      });
      this.placeMoons();
    }

    isCatalog() {
      return !!this.options.catalog;
    }

    calculateTargets() {
      if (this.isCatalog()) {
        this.layoutGalaxies();
        this.assignDepth();
        return;
      }
      const layout = this.options.layout;
      const customers = this.nodes.filter((n) => n.data.kind === "customer");
      const orders = this.nodes.filter((n) => n.data.kind === "order");
      const lines = this.nodes.filter((n) => n.data.kind === "line");

      if (layout === "timeline") {
        const dated = orders.filter((n) => Number.isFinite(n.data.time));
        const times = dated.map((n) => n.data.time);
        const min = Math.min(...times, Date.now());
        const max = Math.max(...times, min + 86400000);
        const values = orders.map((n) => Math.log1p(Math.max(0, n.data.value || 0)));
        const maxValue = Math.max(...values, 1);
        customers.forEach((n, i) => {
          n.tx = -520;
          n.ty = (i - (customers.length - 1) / 2) * 96;
        });
        orders.forEach((n) => {
          const parent = this.nodeMap.get(n.data.parent);
          const ratio = Number.isFinite(n.data.time) ? (n.data.time - min) / (max - min || 1) : 0.15;
          n.tx = -380 + ratio * 860;
          n.ty = (parent?.ty || 0) + jitter(n.data.id, 7) * 28;
        });
        this.placeMoons();
        this.timeline = { min, max, maxValue };
        this.assignDepth();
        return;
      }

      if (layout === "orbit") {
        this.layoutSolarSystems("ring");
        this.assignDepth();
        return;
      }

      if (layout === "constellation") {
        const types = new Map();
        lines.forEach((n) => {
          const key = n.data.type || "Без типа";
          if (!types.has(key)) types.set(key, []);
          types.get(key).push(n);
        });
        const typeList = [...types.keys()];
        const centers = new Map();
        typeList.forEach((type, i) => {
          const a = i * GOLDEN;
          const radius = typeList.length <= 1 ? 0 : 170 + Math.sqrt(i) * 140;
          centers.set(type, { x: Math.cos(a) * radius, y: Math.sin(a) * radius * 0.78 });
        });
        customers.forEach((n, i) => {
          const a = i * GOLDEN + 0.4;
          const radius = 40 + Math.sqrt(i + 1) * 90;
          n.tx = Math.cos(a) * radius;
          n.ty = Math.sin(a) * radius * 0.7;
        });
        orders.forEach((n) => {
          const parent = this.nodeMap.get(n.data.parent);
          const type = n.data.type || "Без типа";
          const c = centers.get(type) || { x: 0, y: 0 };
          n.tx = lerp(parent?.tx || 0, c.x, 0.55) + jitter(n.data.id, 3) * 36;
          n.ty = lerp(parent?.ty || 0, c.y, 0.55) + jitter(n.data.id, 4) * 36;
        });
        this.placeMoons();
        this.assignDepth();
        return;
      }

      this.layoutSolarSystems("spiral");
      this.assignDepth();
    }

    layoutGalaxies() {
      const nodes = this.nodes.filter((n) => n.data.kind === "galaxy");
      let spiral = 0;
      nodes.forEach((n, i) => {
        if (i === 0) {
          n.tx = 0;
          n.ty = 0;
        } else {
          spiral += (n.r + (nodes[i - 1]?.r || 32)) * 2.05 + 64;
          const a = i * GOLDEN + 0.27;
          n.tx = Math.cos(a) * spiral;
          n.ty = Math.sin(a) * spiral * 0.82;
        }
        n.tz = jitter(n.data.id, 21) * 38;
        n.x = n.tx;
        n.y = n.ty;
        n.z = n.tz;
        n.vx = 0;
        n.vy = 0;
      });
    }

    assignDepth() {
      this.nodes.forEach((n) => {
        const tilt = jitter(n.data.id, 19);
        if (n.data.kind === "galaxy") n.tz = n.tz || tilt * 26;
        else if (n.data.kind === "customer") n.tz = 0;
        else if (n.data.kind === "order") n.tz = 5 + tilt * 7;
        else n.tz = 9 + jitter(n.data.id, 23) * 9;
      });
    }

    buildBridges() {
      if (this.isCatalog()) return [];
      const customers = this.nodes.filter((n) => n.data.kind === "customer");
      if (customers.length < 2) return [];
      const types = new Map();
      this.nodes.filter((n) => n.data.kind === "order" || n.data.kind === "line").forEach((n) => {
        const customer = n.data.customer;
        const type = n.data.type || "";
        if (!customer || !type) return;
        const set = types.get(customer) || new Set();
        set.add(type);
        types.set(customer, set);
      });
      const scored = [];
      for (let i = 0; i < customers.length; i += 1) {
        for (let j = i + 1; j < customers.length; j += 1) {
          const a = types.get(customers[i].data.customer) || new Set();
          const b = types.get(customers[j].data.customer) || new Set();
          let shared = 0;
          a.forEach((t) => {
            if (b.has(t)) shared += 1;
          });
          if (shared) scored.push({ source: customers[i], target: customers[j], weight: shared });
        }
      }
      scored.sort((a, b) => b.weight - a.weight);
      const mst = kruskalMst(customers).map((edge) => ({ source: edge.a, target: edge.b, weight: 1 }));
      return [...mst, ...scored.slice(0, 8)];
    }

