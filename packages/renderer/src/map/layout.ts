import type { Party, World } from '@bellwether/adapter/core';
import { hash01 } from '../sim.js';
import { baseRoads, edgeCorners } from './roads.js';

/** Pure map layout: where each repo's settlement and each party's camp sit, in tiles. */

export const TILE = 16;
export const CELL_W = 16;
export const CELL_H = 12;
export const GRID_COLS = 6;

export interface Pt {
  x: number;
  y: number;
}

export interface Settlement {
  key: string;
  name: string;
  /** Tile position of the settlement's base (bottom centre). */
  tile: Pt;
}

export interface Camp {
  partyId: string;
  settlementKey: string;
  /** Tile position of the camp's base (bottom centre). */
  tile: Pt;
}

export interface MapLayout {
  cols: number;
  rows: number;
  /** Map size in tiles. */
  w: number;
  h: number;
  settlements: Settlement[];
  camps: Map<string, Camp>;
  /** Tile of the fleet hub, when the world has a fleet lead. Never moves a settlement or a camp. */
  hub?: Pt;
  /** Changes whenever the arrangement changes; lets the scene rebuild terrain only when needed. */
  signature: string;
}

export function repoKey(p: Party): string {
  return p.repo ?? p.label;
}

/** Neutral settlement name: the repo's folder name. */
export function settlementName(key: string): string {
  const parts = key.split(/[\\/]/).filter(Boolean);
  return parts[parts.length - 1] ?? key;
}

/**
 * Places each repo in a grid cell chosen by hashing its key, nudging to the next
 * free cell on collision. Repos are placed in hash order so the result does not
 * depend on the order parties arrive in.
 */
/** `extraKeys` adds settlements with no camps, for orchestrators standing alone at their repo. `hub` adds the fleet hub. */
export function layoutMap(world: World, extraKeys: string[] = [], opts: { hub?: boolean } = {}): MapLayout {
  const parties = Object.values(world.parties);
  const keys = [...new Set([...parties.map(repoKey), ...extraKeys])].sort((a, b) => hash01(a) - hash01(b) || a.localeCompare(b));
  const cols = GRID_COLS;
  const rows = Math.max(4, Math.ceil((keys.length * 1.6) / cols));
  const cells = cols * rows;
  const taken = new Set<number>();
  const settlements: Settlement[] = [];

  for (const key of keys) {
    let cell = Math.floor(hash01(key) * cells) % cells;
    while (taken.has(cell)) cell = (cell + 1) % cells;
    taken.add(cell);
    const cx = cell % cols;
    const cy = Math.floor(cell / cols);
    // Jitter inside the cell, keeping a margin so camps fit around it.
    const x = cx * CELL_W + 5 + Math.floor(hash01(key + 'x') * (CELL_W - 10));
    const y = cy * CELL_H + 5 + Math.floor(hash01(key + 'y') * (CELL_H - 8));
    settlements.push({ key, name: settlementName(key), tile: { x, y } });
  }

  const camps = new Map<string, Camp>();
  const byRepo = new Map<string, Party[]>();
  for (const p of parties) byRepo.set(repoKey(p), [...(byRepo.get(repoKey(p)) ?? []), p]);
  for (const s of settlements) {
    const group = (byRepo.get(s.key) ?? []).sort((a, b) => a.id.localeCompare(b.id));
    // Camps sit on a ring below the settlement, spread by slot, so they stay readable.
    group.forEach((p, i) => {
      const angle = Math.PI * (0.15 + (0.7 * (i + 0.5)) / group.length);
      const r = 4 + (i % 2) * 1.5;
      camps.set(p.id, {
        partyId: p.id,
        settlementKey: s.key,
        tile: clampTile(Math.round(s.tile.x + Math.cos(angle) * r * 1.5), Math.round(s.tile.y + Math.sin(angle) * r), cols * CELL_W, rows * CELL_H),
      });
    });
  }

  const hub = opts.hub ? placeHub(settlements, camps, cols * CELL_W, rows * CELL_H) : undefined;
  const signature = [
    ...settlements.map((s) => `${s.key}@${s.tile.x},${s.tile.y}`),
    ...[...camps.values()].map((c) => `${c.partyId}@${c.tile.x},${c.tile.y}`),
    ...(hub ? [`hub@${hub.x},${hub.y}`] : []),
  ].join('|');
  return { cols, rows, w: cols * CELL_W, h: rows * CELL_H, settlements, camps, ...(hub ? { hub } : {}), signature };
}

/** Tiles the hub keeps clear of a settlement and of a camp (a tile is wider than it is tall on screen, so y counts more). */
export const HUB_CLEAR_SETTLEMENT = 8;
export const HUB_CLEAR_CAMP = 6;

const away = (a: Pt, b: Pt) => Math.hypot(a.x - b.x, (a.y - b.y) * 1.4);

/**
 * The hub stands near the middle of the map: the spot is the map centre, or beside the settlement when there is only
 * one. If something is in the way it takes the nearest free spot on rings around that, so it never overlaps a
 * settlement, a camp or a road. It reads only the settlements and camps, and they never read it, so the hub cannot move
 * anything that was already placed, and it stays where it is while the places around it stay.
 */
export function placeHub(settlements: Settlement[], camps: Map<string, Camp>, w: number, h: number): Pt {
  const centre: Pt = { x: Math.floor(w / 2), y: Math.floor(h / 2) };
  const first = settlements[0];
  const base: Pt = settlements.length === 1 && first ? { x: first.tile.x + HUB_CLEAR_SETTLEMENT + 1, y: first.tile.y - 2 } : centre;
  const roadTiles = new Set<string>();
  const g = baseRoads({ settlements, camps });
  for (const e of g.edges) {
    const [a, c, b] = edgeCorners(g, e) as [Pt, Pt, Pt];
    for (const [p, q] of [[a, c], [c, b]] as const) {
      for (let x = Math.min(p.x, q.x); x <= Math.max(p.x, q.x); x++) for (let y = Math.min(p.y, q.y); y <= Math.max(p.y, q.y); y++) roadTiles.add(`${x},${y}`);
    }
  }
  const free = (p: Pt, withRoads: boolean) => {
    if (p.x < 6 || p.x > w - 7 || p.y < 8 || p.y > h - 4) return false;
    if (settlements.some((s) => away(s.tile, p) < HUB_CLEAR_SETTLEMENT)) return false;
    if ([...camps.values()].some((c) => away(c.tile, p) < HUB_CLEAR_CAMP)) return false;
    if (withRoads) for (let dx = -2; dx <= 2; dx++) for (let dy = -1; dy <= 0; dy++) if (roadTiles.has(`${p.x + dx},${p.y + dy}`)) return false;
    return true;
  };
  for (const withRoads of [true, false]) {
    for (let r = 0; r <= 48; r += 2) {
      const n = r === 0 ? 1 : Math.max(8, Math.round(r * 1.5));
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2;
        const p = { x: Math.round(base.x + Math.cos(a) * r * 1.4), y: Math.round(base.y + Math.sin(a) * r * 0.8) };
        if (free(p, withRoads)) return p;
      }
    }
  }
  return clampTile(base.x, base.y, w, h);
}

/** Keeps a camp a few tiles inside the map so it is never drawn on or past the edge. */
function clampTile(x: number, y: number, w: number, h: number): Pt {
  return { x: Math.min(w - 3, Math.max(2, x)), y: Math.min(h - 2, Math.max(3, y)) };
}

export function tileToWorld(t: Pt): Pt {
  return { x: (t.x + 0.5) * TILE, y: (t.y + 1) * TILE };
}
