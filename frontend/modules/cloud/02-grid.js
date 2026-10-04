  class SpatialGrid {
    constructor(size = 56) {
      this.size = size;
      this.cells = new Map();
    }
    clear() {
      this.cells.clear();
    }
    key(x, y) {
      return `${Math.floor(x / this.size)}:${Math.floor(y / this.size)}`;
    }
    add(node) {
      const key = this.key(node.x, node.y);
      if (!this.cells.has(key)) this.cells.set(key, []);
      this.cells.get(key).push(node);
    }
    near(x, y, range = 1) {
      const cx = Math.floor(x / this.size);
      const cy = Math.floor(y / this.size);
      const out = [];
      for (let ix = cx - range; ix <= cx + range; ix += 1) {
        for (let iy = cy - range; iy <= cy + range; iy += 1) {
          const cell = this.cells.get(`${ix}:${iy}`);
          if (cell) out.push(...cell);
        }
      }
      return out;
    }
  }

