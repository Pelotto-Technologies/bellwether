import type { Party } from '@bellwether/adapter/core';
import { hash01 } from '../sim.js';
import type { Pt } from './layout.js';

/** Pure layout of the camp scene, in logical pixels (the scene is drawn at an integer zoom). */

export interface Rect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export interface Station {
  paneId: string;
  /** Feet position of the member. */
  x: number;
  y: number;
  /** Which way the member faces: toward the fire. The station prop stands that side. */
  side: 1 | -1;
}

/** Horizontal gap from a member to its station prop. */
export const PROP_DX = 19;
/** Columns of stations either side of the fire. */
const COL_INNER = 88;
const COL_GAP = 52;

/** Where the sky ends and the ground starts: a whole number of tiles down. */
export const horizonY = (h: number): number => Math.round((h * 0.26) / 16) * 16;

export const SCENE_MIN = { w: 300, h: 210 };

/** Where the fire stands for a scene of this size. */
export function firePoint(w: number, h: number): Pt {
  return { x: Math.round(w / 2), y: Math.round(h * 0.6) };
}

/** What a member and its prop cover on screen (sprite extents), as a rectangle. */
export function bodyRect(s: Station): Rect {
  const a = s.x - 14;
  const b = s.x + 14;
  const c = s.x + s.side * (PROP_DX + 15);
  return { x0: Math.min(a, c), x1: Math.max(b, c), y0: s.y - 31, y1: s.y + 1 };
}

/** The fire's sprite extent, which no member should stand in front of or behind. */
export function fireRect(f: Pt): Rect {
  return { x0: f.x - 24, x1: f.x + 24, y0: f.y - 40, y1: f.y + 4 };
}

/** Where git state is shown: crates at the lower right, the cart at the lower left. */
export function gitRects(w: number, h: number): { crates: Rect; cart: Rect } {
  return { crates: { x0: w - 56, x1: w, y0: h - 46, y1: h }, cart: { x0: 0, x1: 62, y0: h - 30, y1: h } };
}

export const overlaps = (a: Rect, b: Rect, m = 0): boolean => a.x0 < b.x1 + m && a.x1 > b.x0 - m && a.y0 < b.y1 + m && a.y1 > b.y0 - m;

/** Row offsets (from the fire's line) for `k` stations in a column; `shift` staggers the outer column. */
function rows(k: number, shift: number): number[] {
  const table: Record<number, number[]> = { 1: [8], 2: [-10, 26], 3: [-26, 8, 42] };
  return (table[k] ?? []).map((v) => v + shift);
}

/**
 * Seats `paneIds` in columns either side of the fire, all facing it: left and right alternate,
 * the inner columns fill first (three a side) and then the outer ones. A lone member stands
 * front-left. Sorted by pane id so nobody swaps places when a status changes.
 */
export function stationLayout(paneIds: readonly string[], w: number, h: number): Station[] {
  const f = firePoint(w, h);
  const ids = [...paneIds].sort();
  const inner = Math.min(COL_INNER, Math.floor(w / 2) - 74);
  const outer = Math.min(inner + COL_GAP, Math.floor(w / 2) - 19);
  if (ids.length === 1) return [{ paneId: ids[0]!, x: f.x - Math.min(78, inner - 10), y: f.y + 12, side: 1 }];
  const sides: [string[], string[]] = [[], []];
  ids.forEach((id, i) => sides[i % 2]!.push(id));
  const out: Station[] = [];
  sides.forEach((list, s) => {
    const dir: 1 | -1 = s === 0 ? 1 : -1;
    const col1 = list.slice(0, 3);
    const col2 = list.slice(3, 6);
    const place = (col: string[], dx: number, shift: number) => rows(col.length, shift).forEach((dy, i) => out.push({ paneId: col[i]!, x: f.x - dir * dx, y: f.y + dy, side: dir }));
    place(col1, inner, 0);
    // Past six a side the rest share the outer column, tighter.
    place(col2, outer, -8);
    for (const id of list.slice(6)) out.push({ paneId: id, x: f.x - dir * (outer + COL_GAP), y: f.y + 34, side: dir });
  });
  return out;
}

export function crateCount(git: Party['git']): number {
  if (!git || git.dirty <= 0) return 0;
  return Math.min(9, 1 + Math.floor(git.dirty / 3));
}

export function hasCart(git: Party['git']): boolean {
  return !!git && git.ahead > 0;
}

/** Crates stack in a pyramid: 3 wide at the bottom. Offsets from the stack's base centre. */
export function crateSlots(n: number): Pt[] {
  const spots: Pt[] = [
    { x: -17, y: 0 }, { x: 0, y: 0 }, { x: 17, y: 0 },
    { x: -8, y: -13 }, { x: 8, y: -13 }, { x: 0, y: -26 },
    { x: -17, y: -13 }, { x: 17, y: -13 }, { x: -8, y: -26 },
  ];
  return spots.slice(0, Math.min(9, Math.max(0, n)));
}

export interface Scenery {
  tents: Pt[];
  tall: { x: number; y: number; v: number }[];
  low: { x: number; y: number; v: number }[];
}

const TENT = { hw: 22, h: 34 };
const TALL = { hw: 14, h: 42 };
const LOW = { hw: 9, h: 12 };

/**
 * Tents along the horizon, a treeline above them and bushes and rocks about the edges. A piece is
 * dropped when it would stand in front of a member (its feet at or below the member's and overlapping),
 * so nothing ever hides a station; pieces behind a member may overlap it.
 */
export function sceneryLayout(w: number, h: number, stations: readonly Station[], seed: string, tents: number): Scenery {
  const f = firePoint(w, h);
  const horizon = horizonY(h);
  const bodies = stations.map((s) => ({ r: bodyRect(s), feet: s.y }));
  const avoid: { r: Rect; feet: number }[] = [...bodies, { r: fireRect(f), feet: f.y }];
  const g = gitRects(w, h);
  // Nothing grows over the git props, whatever its depth.
  avoid.push({ r: g.crates, feet: -99 }, { r: g.cart, feet: -99 });
  const ok = (x: number, y: number, hw: number, hgt: number): boolean => {
    const r = { x0: x - hw, x1: x + hw, y0: y - hgt, y1: y };
    return avoid.every((a) => !(overlaps(r, a.r, 1) && y >= a.feet - 6));
  };
  const placed: Rect[] = [];
  const free = (x: number, y: number, hw: number, hgt: number, gap = 2): boolean => {
    const r = { x0: x - hw, x1: x + hw, y0: y - hgt, y1: y };
    return placed.every((p) => !overlaps(r, p, -gap)) && ok(x, y, hw, hgt);
  };
  const take = (x: number, y: number, hw: number, hgt: number) => placed.push({ x0: x - hw, x1: x + hw, y0: y - hgt, y1: y });

  const out: Scenery = { tents: [], tall: [], low: [] };
  const tentY = horizon + 38;
  const tentSpots = [f.x - 70, f.x + 70, f.x - 150, f.x + 150, f.x, f.x - 110, f.x + 110];
  for (const x of tentSpots) {
    if (out.tents.length >= tents) break;
    if (x - TENT.hw >= 2 && x + TENT.hw <= w - 2 && free(x, tentY, TENT.hw, TENT.h)) { out.tents.push({ x, y: tentY }); take(x, tentY, TENT.hw, TENT.h); }
  }
  // Treeline: a row across the top and a few down each side.
  const rowY = horizon + 14;
  for (let x = -2, i = 0; x <= w + 2; x += 30 + Math.floor(hash01(`${seed}t${i}`) * 14), i++) {
    const y = rowY + Math.floor(hash01(`${seed}ty${i}`) * 10);
    if (free(x, y, TALL.hw, TALL.h, -6)) { out.tall.push({ x, y, v: i % 2 }); take(x, y, TALL.hw, TALL.h); }
  }
  for (const side of [0, 1]) {
    for (let i = 0; i < 3; i++) {
      const x = side ? w - 6 + Math.floor(hash01(`${seed}sx${i}${side}`) * 8) : 6 - Math.floor(hash01(`${seed}sx${i}${side}`) * 8);
      const y = Math.round(h * (0.55 + i * 0.2));
      if (free(x, y, TALL.hw, TALL.h)) { out.tall.push({ x, y, v: (i + side) % 2 }); take(x, y, TALL.hw, TALL.h); }
    }
  }
  for (let i = 0; i < 9; i++) {
    const x = 8 + Math.floor(hash01(`${seed}lx${i}`) * (w - 16));
    const y = horizon + 30 + Math.floor(hash01(`${seed}ly${i}`) * (h - horizon - 36));
    if (free(x, y, LOW.hw, LOW.h, 6)) { out.low.push({ x, y, v: i % 2 }); take(x, y, LOW.hw, LOW.h); }
  }
  return out;
}
