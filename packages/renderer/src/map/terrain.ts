import { hash01 } from '../sim.js';
import type { MapLayout } from './layout.js';

/** Deterministic terrain for a layout: grass, paths between camps and settlements, ponds, scenery. */

export type Ground = 'grass' | 'path' | 'water';
export type Scenery = 'tree' | 'bush' | 'rock' | 'stump' | 'flowers';

export interface Terrain {
  w: number;
  h: number;
  ground: Ground[];
  scenery: (Scenery | undefined)[];
  /** Grass variation 0..3 per tile. */
  variant: number[];
}

const idx = (t: Terrain, x: number, y: number) => y * t.w + x;
const inside = (t: Terrain, x: number, y: number) => x >= 0 && y >= 0 && x < t.w && y < t.h;

function carve(t: Terrain, x0: number, y0: number, x1: number, y1: number): void {
  // L-shaped path: horizontal first, then vertical.
  const sx = Math.sign(x1 - x0);
  for (let x = x0; x !== x1; x += sx) if (inside(t, x, y0)) t.ground[idx(t, x, y0)] = 'path';
  const sy = Math.sign(y1 - y0);
  for (let y = y0; y !== y1 + sy && sy !== 0; y += sy) if (inside(t, x1, y)) t.ground[idx(t, x1, y)] = 'path';
  if (inside(t, x1, y1)) t.ground[idx(t, x1, y1)] = 'path';
}

function smoothNoise(x: number, y: number, seed: string): number {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const fx = x - x0;
  const fy = y - y0;
  const v = (i: number, j: number) => hash01(`${seed}${i},${j}`);
  const top = v(x0, y0) * (1 - fx) + v(x0 + 1, y0) * fx;
  const bot = v(x0, y0 + 1) * (1 - fx) + v(x0 + 1, y0 + 1) * fx;
  return top * (1 - fy) + bot * fy;
}

export function buildTerrain(layout: MapLayout): Terrain {
  const t: Terrain = {
    w: layout.w,
    h: layout.h,
    ground: new Array<Ground>(layout.w * layout.h).fill('grass'),
    scenery: new Array<Scenery | undefined>(layout.w * layout.h).fill(undefined),
    variant: [],
  };
  for (let i = 0; i < t.ground.length; i++) t.variant.push(Math.floor(hash01(`v${i}`) * 4));

  // Occupied tiles: nothing grows or floods within a few tiles of a building.
  const anchors = [...layout.settlements.map((s) => ({ ...s.tile, r: 4 })), ...[...layout.camps.values()].map((c) => ({ ...c.tile, r: 3 }))];
  const near = (x: number, y: number) => anchors.some((a) => Math.abs(a.x - x) <= a.r && Math.abs(a.y - y) <= a.r - 1);

  for (let y = 0; y < t.h; y++) {
    for (let x = 0; x < t.w; x++) {
      if (smoothNoise(x / 6, y / 6, 'water') > 0.74 && !near(x, y)) t.ground[idx(t, x, y)] = 'water';
    }
  }

  // Camps link to their settlement; settlements chain together in a stable order.
  const bySettlement = new Map(layout.settlements.map((s) => [s.key, s]));
  for (const c of layout.camps.values()) {
    const s = bySettlement.get(c.settlementKey)!;
    carve(t, c.tile.x, c.tile.y, s.tile.x, s.tile.y);
  }
  const ordered = [...layout.settlements].sort((a, b) => a.tile.x - b.tile.x || a.tile.y - b.tile.y);
  for (let i = 1; i < ordered.length; i++) carve(t, ordered[i - 1]!.tile.x, ordered[i - 1]!.tile.y, ordered[i]!.tile.x, ordered[i]!.tile.y);

  for (let y = 0; y < t.h; y++) {
    for (let x = 0; x < t.w; x++) {
      const i = idx(t, x, y);
      if (t.ground[i] !== 'grass' || near(x, y)) continue;
      const r = hash01(`s${x},${y}`);
      if (r < 0.06) t.scenery[i] = 'tree';
      else if (r < 0.085) t.scenery[i] = 'bush';
      else if (r < 0.1) t.scenery[i] = 'rock';
      else if (r < 0.108) t.scenery[i] = 'stump';
      else if (r < 0.15) t.scenery[i] = 'flowers';
    }
  }
  return t;
}

/** Bitmask of same-ground neighbours: N=1 E=2 S=4 W=8. Off-map counts as the same, so edges blend out. */
export function autotileMask(t: Terrain, x: number, y: number): number {
  const g = t.ground[idx(t, x, y)];
  const same = (nx: number, ny: number) => !inside(t, nx, ny) || t.ground[idx(t, nx, ny)] === g;
  return (same(x, y - 1) ? 1 : 0) | (same(x + 1, y) ? 2 : 0) | (same(x, y + 1) ? 4 : 0) | (same(x - 1, y) ? 8 : 0);
}

/** Tile name in the tileset for a ground tile. */
export function groundTileName(t: Terrain, x: number, y: number, frame: 0 | 1 = 0): string {
  const g = t.ground[idx(t, x, y)]!;
  if (g === 'grass') return `grass_${t.variant[idx(t, x, y)]}`;
  const mask = autotileMask(t, x, y);
  return g === 'path' ? `path_${mask}` : `water_${mask}${frame ? '_b' : ''}`;
}
