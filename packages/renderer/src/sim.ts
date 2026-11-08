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
