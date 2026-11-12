import type { Member, Party, World } from '@bellwether/adapter/core';
import { splitFleet, type FleetLead } from './fleet.js';
import { repoKey } from './map/layout.js';
import { hash01 } from './sim.js';

/**
 * Fellowships: parties that share a project (same Herdr session and repo). Derived
 * from what Herdr already reports, so agents need no instructions.
 *
 * - An orchestrator whose repo has other agents *leads* them: it leaves its own
 *   party and is drawn as the leader of the whole group.
 * - Every party in a group of two or more (or under a leader) gets its own tint, so
 *   three worktrees of the same project do not all look alike.
 */

/** Twelve well-separated hues, mixed into each character's cloak. */
export const TINTS = [
  '#e63946',
  '#f4a261',
  '#ffd23f',
  '#8ac926',
  '#2ec4b6',
  '#3a86ff',
  '#7b5cff',
  '#c77dff',
  '#ff6fb5',
  '#b08968',
  '#06d6a0',
  '#00b4d8',
];

export interface Leader {
  /** The Herdr workspace the orchestrator pane lives in (speech is keyed by it). */
  partyId: string;
  member: Member;
}

export interface Fellowship {
  key: string;
  /** Repo folder name. */
  name: string;
  leaders: Leader[];
  /** Follower parties in stable order. */
  partyIds: string[];
}

export interface FellowshipView {
  /** The world with led orchestrators lifted out of their parties (empty parties dropped). */
  world: World;
  fellowships: Fellowship[];
  /** Follower party id to its fellowship. */
  byParty: Map<string, Fellowship>;
  /** Fleet leads (`scope: fleet`), lifted out of every party. Empty without a fleet. */
  fleet: FleetLead[];
  /** Party id to its tint; absent when the party stands alone and keeps the pack's colours. */
  tints: Map<string, string>;
}

export interface FellowshipOptions {
  /**
   * Lift an orchestrator out of its party even when nobody else is in its repo yet.
   * Map mode uses this so the orchestrator always stands at the settlement (the root
   * of its project) instead of camping like a worker; the strip keeps it as a party.
   */
  leadAlone?: boolean;
}

const cache = new WeakMap<World, FellowshipView>();
const aloneCache = new WeakMap<World, FellowshipView>();

function groupKey(p: Party): string {
  return `${p.session ?? ''}|${repoKey(p)}`;
}

function nameOf(key: string): string {
  const parts = key.slice(key.indexOf('|') + 1).split(/[\\/]/).filter(Boolean);
  return parts[parts.length - 1] ?? key;
}

/** Cached per world object: the feed replaces the world on every delta. */
export function groupFellowships(world: World, opts: FellowshipOptions = {}): FellowshipView {
  const store = opts.leadAlone ? aloneCache : cache;
  const hit = store.get(world);
  if (hit) return hit;
  const view = compute(world, !!opts.leadAlone);
  store.set(world, view);
  return view;
}

function compute(raw: World, leadAlone: boolean): FellowshipView {
  // A fleet lead belongs to no repo: it is lifted out first, so it never counts as a repo's leader or member.
  const { world, leads: fleet } = splitFleet(raw);
  const groups = new Map<string, Party[]>();
  for (const p of Object.values(world.parties)) groups.set(groupKey(p), [...(groups.get(groupKey(p)) ?? []), p]);

  const parties: Record<string, Party> = {};
  const fellowships: Fellowship[] = [];
  const byParty = new Map<string, Fellowship>();
  const tintable: string[] = [];

  for (const [key, members] of [...groups].sort((a, b) => a[0].localeCompare(b[0]))) {
    const sorted = [...members].sort((a, b) => a.id.localeCompare(b.id));
    const all = sorted.flatMap((p) => Object.values(p.members));
    const leaders: Leader[] = sorted.flatMap((p) =>
      Object.values(p.members)
        .filter((m) => m.role === 'orchestrator')
        .sort((a, b) => a.paneId.localeCompare(b.paneId))
        .map((member) => ({ partyId: p.id, member })),
    );
    const led = leaders.length > 0 && (leadAlone || all.length > leaders.length);

    const kept: Party[] = [];
    for (const p of sorted) {
      if (!led) {
        kept.push(p);
        continue;
      }
      const rest = Object.fromEntries(Object.entries(p.members).filter(([, m]) => m.role !== 'orchestrator'));
      if (Object.keys(rest).length > 0) kept.push({ ...p, members: rest });
    }
    for (const p of kept) parties[p.id] = p;

    if (led) {
      const f: Fellowship = { key, name: nameOf(key), leaders, partyIds: kept.map((p) => p.id) };
      fellowships.push(f);
      for (const id of f.partyIds) byParty.set(id, f);
    }
    if (led || kept.length >= 2) tintable.push(...kept.map((p) => p.id));
  }

  return { world: { ...world, parties }, fellowships, fleet, byParty, tints: assignTints(tintable) };
}

/**
 * Hash each party to a palette slot and probe forward on collision, so tints stay put
 * as long as the set of parties does, and are all different until the palette runs out.
 */
export function assignTints(ids: string[]): Map<string, string> {
  const out = new Map<string, string>();
  const used = new Set<number>();
  const order = [...ids].sort((a, b) => hash01(a) - hash01(b) || a.localeCompare(b));
  for (const id of order) {
    let slot = Math.floor(hash01(id + '#tint') * TINTS.length) % TINTS.length;
    if (used.size < TINTS.length) while (used.has(slot)) slot = (slot + 1) % TINTS.length;
    used.add(slot);
    out.set(id, TINTS[slot]!);
  }
  return out;
}

const channel = (hex: string, i: number) => parseInt(hex.slice(1 + i * 2, 3 + i * 2), 16);

/** Linear mix of two `#rrggbb` colours; `t` is the share of `b`. */
export function mixHex(a: string, b: string, t: number): string {
  const c = (i: number) => Math.round(channel(a, i) * (1 - t) + channel(b, i) * t);
  return `#${[0, 1, 2].map((i) => c(i).toString(16).padStart(2, '0')).join('')}`;
}

/** A follower party a leader walks over to when it speaks. */
export function pickFollower(f: Fellowship, paneId: string): string | undefined {
  return f.partyIds.length ? f.partyIds[Math.floor(hash01(paneId) * f.partyIds.length) % f.partyIds.length] : undefined;
}
