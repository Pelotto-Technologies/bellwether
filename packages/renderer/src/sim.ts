import type { Status } from '@bellwether/adapter/core';

/** Pure strip-mode simulation: where each party is and how its members move. No Pixi here. */

export interface Lane {
  start: number;
  end: number;
}

export interface Walker {
  x: number;
  dir: 1 | -1;
}

export const SPEED: Record<Status, number> = {
  working: 34,
  done: 14,
  idle: 10,
  unknown: 8,
  blocked: 0,
};

/** Splits the strip into one lane per walking group, in a stable order. Lanes are equal unless `weights` says a group needs more room. */
export function layoutLanes(ids: string[], width: number, margin = 16, weights: Record<string, number> = {}): Map<string, Lane> {
  const lanes = new Map<string, Lane>();
  const sorted = [...ids].sort();
  const usable = Math.max(0, width - margin * 2);
  const total = sorted.reduce((n, id) => n + (weights[id] ?? 1), 0);
  let at = margin;
  for (const id of sorted) {
    const each = total ? (usable * (weights[id] ?? 1)) / total : 0;
    lanes.set(id, { start: at, end: at + each });
    at += each;
  }
  return lanes;
}

/**
 * Advances a party. `x` is the left edge of the group; the group is `span` pixels
 * wide and bounces between the lane edges. Members keep their order and simply
 * turn around, so nobody teleports. Blocked parties stand still.
 */
export function stepWalker(w: Walker, status: Status, lane: Lane, span: number, dt: number): Walker {
  const min = lane.start;
  const max = Math.max(min, lane.end - span);
  // A group wider than its lane cannot bounce; keep its heading rather than flipping every frame.
  if (max <= min) return { x: min, dir: w.dir };
  const x = Math.min(max, Math.max(min, w.x + w.dir * SPEED[status] * dt));
  let dir = w.dir;
  if (x >= max && dir === 1) dir = -1;
  else if (x <= min && dir === -1) dir = 1;
  return { x, dir };
}

/** Member positions run left to right from the group's left edge. */
export function memberX(groupX: number, index: number, spacing: number): number {
  return groupX + index * spacing;
}

/** Vertical offset in pixels: blocked members hop to get attention, walkers bounce a little. */
export function bob(status: Status, t: number, phase: number): number {
  if (status === 'blocked') return -Math.abs(Math.sin(t * 5 + phase)) * 6;
  if (status === 'working') return -Math.abs(Math.sin(t * 9 + phase)) * 1.5;
  return 0;
}

/** Walk-cycle frame index (0 = stand, 1/2 = steps). */
export function walkFrame(moving: boolean, t: number, phase: number): 0 | 1 | 2 {
  if (!moving) return 0;
  return Math.floor(t * 6 + phase) % 2 === 0 ? 1 : 2;
}

/** Beacon light alpha: steady, except blocked pulses. */
export function beaconAlpha(status: Status, t: number): number {
  if (status === 'blocked') return 0.45 + 0.55 * (0.5 + 0.5 * Math.sin(t * 8));
  if (status === 'idle' || status === 'unknown') return 0.6;
  return 1;
}

/** Stable small hash so each party/member gets its own phase and start position. */
export function hash01(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return ((h >>> 0) % 10000) / 10000;
}

/** At most this many depth rows; past it the back rows just get more crowded. */
export const MAX_ROWS = 4;
/** A row is full once its groups take this share of the width, so everyone keeps room to walk. */
export const ROW_FILL = 0.6;

/**
 * Splits walking groups into depth rows when the strip gets crowded. Row 0 is the front;
 * higher rows stand further back and are drawn behind. Everything fits in row 0 until the
 * groups fill `fill` of the width; then just enough rows are opened and groups are dealt
 * out, widest first, to the row with the least load. Ties go to the front.
 */
export function assignRows(groups: readonly { id: string; span: number }[], width: number, fill = ROW_FILL, maxRows = MAX_ROWS): Map<string, number> {
  const rows = new Map<string, number>();
  const room = Math.max(1, width * fill);
  const total = groups.reduce((n, g) => n + g.span, 0);
  const count = Math.max(1, Math.min(maxRows, Math.ceil(total / room)));
  const load = new Array<number>(count).fill(0);
  const order = [...groups].sort((a, b) => b.span - a.span || a.id.localeCompare(b.id));
  for (const g of order) {
    let best = 0;
    for (let r = 1; r < count; r++) if (load[r]! < load[best]!) best = r;
    load[best]! += g.span;
    rows.set(g.id, best);
  }
  return rows;
}

/** A window's slice of a strip that spans several monitors, in CSS pixels. */
export interface SpanView {
  /** Left edge of this window within the whole strip. */
  offset: number;
  /** Width of the whole strip across every monitor. */
  total: number;
}

/** Reads `?span=<offset>,<total>`; anything malformed means this window is the whole strip. */
export function parseSpan(raw: string | null): SpanView | undefined {
  if (!raw) return undefined;
  const [o, t] = raw.split(',').map(Number);
  if (o === undefined || t === undefined || !Number.isFinite(o) || !Number.isFinite(t) || o < 0 || t <= 0 || o >= t) return undefined;
  return { offset: o, total: t };
}
