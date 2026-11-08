import type { Status } from '@bellwether/adapter/core';
import { SPEED, hash01 } from '../sim.js';
import type { Pt } from './layout.js';

/** Pure member movement around a camp, with optional "meet someone" overrides for chatter. */

/** Walkable rectangle in world pixels; wanderers never leave it. */
export interface Bounds {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export function clampTo(p: Pt, b?: Bounds): Pt {
  if (!b) return p;
  return { x: Math.min(b.x1, Math.max(b.x0, p.x)), y: Math.min(b.y1, Math.max(b.y0, p.y)) };
}

export interface Wanderer {
  x: number;
  y: number;
  /** Where the member is heading right now. */
  tx: number;
  ty: number;
  /** +1 faces right, -1 faces left. */
  dir: 1 | -1;
  /** Counter so each retarget is deterministic but different. */
  n: number;
}

export function spawnWanderer(id: string, home: Pt, radius: number, bounds?: Bounds): Wanderer {
  const a = hash01(id) * Math.PI * 2;
  const r = hash01(id + 'r') * radius;
  const { x, y } = clampTo({ x: home.x + Math.cos(a) * r, y: home.y + Math.sin(a) * r * 0.6 }, bounds);
  return { x, y, tx: x, ty: y, dir: 1, n: 0 };
}

function retarget(w: Wanderer, id: string, home: Pt, radius: number, bounds?: Bounds): Wanderer {
  const a = hash01(`${id}a${w.n}`) * Math.PI * 2;
  const r = (0.3 + 0.7 * hash01(`${id}r${w.n}`)) * radius;
  const t = clampTo({ x: home.x + Math.cos(a) * r, y: home.y + Math.sin(a) * r * 0.6 }, bounds);
  return { ...w, tx: t.x, ty: t.y, n: w.n + 1 };
}

/**
 * One step, kept inside `bounds` (the map edge). `meet` overrides the target (walk to a conversation partner and stop
 * short of them). Blocked members hold still; others stroll at their status speed.
 */
export function stepWanderer(w: Wanderer, id: string, status: Status, home: Pt, radius: number, dt: number, meet?: Pt, bounds?: Bounds, speedOverride?: number): Wanderer {
  let cur = w;
  if (meet) {
    // Stand a little to the side of the partner.
    const side = meet.x >= w.x ? -1 : 1;
    const t = clampTo({ x: meet.x + side * 9, y: meet.y }, bounds);
    cur = { ...w, tx: t.x, ty: t.y };
  } else if (Math.hypot(w.tx - w.x, w.ty - w.y) < 1) {
    cur = retarget(w, id, home, radius, bounds);
  }
  const speed = speedOverride ?? (meet ? Math.max(SPEED.working, 24) : SPEED[status]);
  if (speed === 0) return cur;
  const dx = cur.tx - cur.x;
  const dy = cur.ty - cur.y;
  const d = Math.hypot(dx, dy);
  if (d < 0.5) return cur;
  const step = Math.min(d, speed * dt);
  const dir: 1 | -1 = Math.abs(dx) > 0.5 ? (dx > 0 ? 1 : -1) : cur.dir;
  const p = clampTo({ x: cur.x + (dx / d) * step, y: cur.y + (dy / d) * step }, bounds);
  return { ...cur, x: p.x, y: p.y, dir };
}

export function isMoving(w: Wanderer): boolean {
  return Math.hypot(w.tx - w.x, w.ty - w.y) > 0.5;
}
