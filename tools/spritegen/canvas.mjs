// A palette-indexed pixel grid. Pixels hold single-character palette keys;
// colours are resolved only when the grid is rendered to RGBA.

export function hex(c) {
  const s = c.replace('#', '');
  const n = parseInt(s.length === 6 ? s + 'ff' : s, 16);
  return [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
}

export class Grid {
  constructor(w, h) {
    this.w = w;
    this.h = h;
    this.px = new Array(w * h).fill(null);
  }
  inside(x, y) {
    return x >= 0 && y >= 0 && x < this.w && y < this.h;
  }
  get(x, y) {
    return this.inside(x, y) ? this.px[y * this.w + x] : null;
  }
  set(x, y, k) {
    if (k == null || k === '.' || k === ' ' || !this.inside(x, y)) return;
    this.px[y * this.w + x] = k === '_' ? null : k;
  }
  rect(x, y, w, h, k) {
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) this.set(x + i, y + j, k);
  }
  /** Stamp an ASCII template; '.' and ' ' are transparent, '_' erases. */
  stamp(rows, x, y, { flip = false, map = null } = {}) {
    const width = Math.max(...rows.map((r) => r.length));
    rows.forEach((row, j) => {
      for (let i = 0; i < row.length; i++) {
        let k = row[i];
        if (map && k in map) k = map[k];
        this.set(flip ? x + width - 1 - i : x + i, y + j, k);
      }
    });
  }
  /** Replace every pixel matching `from` with `to` inside an optional box. */
  swap(from, to) {
    for (let i = 0; i < this.px.length; i++) if (this.px[i] === from) this.px[i] = to;
  }
  /** Add a 1px outline (4-neighbour) around every opaque pixel. */
  outline(k = 'o', skip = () => false) {
    const add = [];
    for (let y = 0; y < this.h; y++)
      for (let x = 0; x < this.w; x++) {
        if (this.get(x, y) != null) continue;
        const n = [this.get(x - 1, y), this.get(x + 1, y), this.get(x, y - 1), this.get(x, y + 1)];
        if (n.some((v) => v != null && v !== k && !skip(v))) add.push([x, y]);
      }
    for (const [x, y] of add) this.set(x, y, k);
  }
  blit(src, x, y) {
    for (let j = 0; j < src.h; j++) for (let i = 0; i < src.w; i++) this.set(x + i, y + j, src.get(i, j));
  }
  clone() {
    const g = new Grid(this.w, this.h);
    g.px = this.px.slice();
    return g;
  }
  bounds(pred) {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (let y = 0; y < this.h; y++)
      for (let x = 0; x < this.w; x++)
        if (pred(this.get(x, y))) {
          x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y);
        }
    return x0 === Infinity ? null : { x0, y0, x1, y1 };
  }
}

/** An RGBA image that grids are composited into. */
export class Image {
  constructor(w, h) {
    this.w = w;
    this.h = h;
    this.rgba = new Uint8Array(w * h * 4);
  }
  /** Draw a grid at (x, y); `palette` maps keys to colours, `pick` can drop or recolour keys. */
  draw(grid, x, y, palette, pick = (k) => k) {
    for (let j = 0; j < grid.h; j++)
      for (let i = 0; i < grid.w; i++) {
        const k = grid.get(i, j);
        if (k == null) continue;
        const key = pick(k);
        if (key == null) continue;
        const col = palette[key];
        if (col == null) throw new Error(`no colour for key '${key}'`);
        this.put(x + i, y + j, typeof col === 'string' ? hex(col) : col);
      }
  }
  put(x, y, [r, g, b, a]) {
    if (x < 0 || y < 0 || x >= this.w || y >= this.h || a === 0) return;
    const o = (y * this.w + x) * 4;
    this.rgba[o] = r; this.rgba[o + 1] = g; this.rgba[o + 2] = b; this.rgba[o + 3] = a;
  }
}
