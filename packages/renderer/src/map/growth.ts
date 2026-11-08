import type { World } from '@bellwether/adapter/core';
import type { Pt } from './layout.js';
import { repoKey } from './layout.js';

/** Settlements and camps grow as agents arrive. Pure, so it can be tested. */

/** Offsets in world pixels from the base position, drawn back to front. */
const TOWN_SLOTS: Pt[] = [
  { x: 0, y: 0 },
  { x: -34, y: 5 },
  { x: 34, y: 5 },
  { x: -17, y: -9 },
  { x: 17, y: -9 },
  { x: 0, y: 12 },
];
const CAMP_SLOTS: Pt[] = [
  { x: 0, y: 0 },
  { x: -15, y: 3 },
  { x: -29, y: -1 },
  { x: -9, y: -9 },
];

/** One more building for every four agents working in a repo, up to the slots available. */
export function townSize(agents: number): number {
  return Math.max(1, Math.min(TOWN_SLOTS.length, 1 + Math.floor(agents / 4)));
}

/** One tent per two members. */
export function campSize(members: number): number {
  return Math.max(1, Math.min(CAMP_SLOTS.length, Math.ceil(members / 2)));
}

export function townSlots(n: number): Pt[] {
  return TOWN_SLOTS.slice(0, n);
}

export function campSlots(n: number): Pt[] {
  return CAMP_SLOTS.slice(0, n);
}

/** Agents (panes) per repo key, across every party in the raw world. */
export function agentsByRepo(world: World): Map<string, number> {
  const out = new Map<string, number>();
  for (const p of Object.values(world.parties)) out.set(repoKey(p), (out.get(repoKey(p)) ?? 0) + Object.keys(p.members).length);
  return out;
}

/** Ease-out-back pop for a freshly built piece: 0 before it exists, overshoots slightly, settles at 1. */
export function pop(age: number, duration = 0.55): number {
  if (age <= 0) return 0;
  if (age >= duration) return 1;
  const x = age / duration - 1;
  const c = 1.9;
  return 1 + (c + 1) * x ** 3 + c * x ** 2;
}
