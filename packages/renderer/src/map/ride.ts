import type { Pt } from './layout.js';

/** Pure rules for an orchestrator riding its mount between nodes of the map. */

/** Journeys longer than this (world px) are ridden. */
export const RIDE_MIN = 30;
/** The rider dismounts once this close to the destination. */
export const DISMOUNT_AT = 12;
/** Mounted speed, world px per second. */
export const RIDE_SPEED = 70;

/** Mount up for a long journey, stay up until close to the destination, then dismount. */
export function nextRiding(riding: boolean, dist: number, hasTarget: boolean): boolean {
  if (!hasTarget) return false;
  if (riding) return dist > DISMOUNT_AT;
  return dist > RIDE_MIN;
}

export interface SummonPlan {
  /** Scene time the rider reaches the new camp; it appears then. */
  arrive: number;
  /** Speed that makes the ride take exactly that long. */
  speed: number;
}

/** A new worktree is summoned when the orchestrator arrives: 1 to 4 seconds of riding, whatever the distance. */
export function summonPlan(now: number, from: Pt, to: Pt): SummonPlan {
  const dist = Math.hypot(to.x - from.x, to.y - from.y);
  const secs = Math.min(4, Math.max(1, dist / RIDE_SPEED));
  return { arrive: now + secs, speed: dist / secs };
}

/** Where a dismounted mount waits: a little behind the rider, relative to the way it faces. */
export function parkSpot(rider: Pt, dir: 1 | -1): Pt {
  return { x: rider.x - dir * 10, y: rider.y };
}

/** A leg of a journey takes this many seconds at the least and at the most, whatever the distance. */
export const LEG_MIN_S = 2;
export const LEG_MAX_S = 6;

export interface LegPlan {
  secs: number;
  /** Speed that makes the leg take exactly that long. */
  speed: number;
}

/** Like `summonPlan` but for a leg along roads: the pace scales with the distance, so a trip reads the same near or far. */
export function legPlan(dist: number): LegPlan {
  if (dist <= 0) return { secs: 0, speed: 0 };
  const secs = Math.min(LEG_MAX_S, Math.max(LEG_MIN_S, dist / RIDE_SPEED));
  return { secs, speed: dist / secs };
}
