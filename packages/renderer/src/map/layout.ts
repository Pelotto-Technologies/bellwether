import type { Party, World } from '@bellwether/adapter/core';
import { hash01 } from '../sim.js';

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
export function layoutMap(world: World): MapLayout {
  const parties = Object.values(world.parties);
  const keys = [...new Set(parties.map(repoKey))].sort((a, b) => hash01(a) - hash01(b) || a.localeCompare(b));
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
        tile: { x: Math.round(s.tile.x + Math.cos(angle) * r * 1.5), y: Math.round(s.tile.y + Math.sin(angle) * r) },
      });
    });
  }

  const signature = [...settlements.map((s) => `${s.key}@${s.tile.x},${s.tile.y}`), ...[...camps.values()].map((c) => `${c.partyId}@${c.tile.x},${c.tile.y}`)].join('|');
  return { cols, rows, w: cols * CELL_W, h: rows * CELL_H, settlements, camps, signature };
}

export function tileToWorld(t: Pt): Pt {
  return { x: (t.x + 0.5) * TILE, y: (t.y + 1) * TILE };
}
