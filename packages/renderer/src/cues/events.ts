import { applyDelta, type Delta, type Party, type Role, type World } from '@bellwether/adapter/core';
import type { CueKind } from './schedule.js';

/**
 * The pure event core shared by sounds and alerts: turns (previous world, delta) into the few
 * moments worth a cue. It carries only role, label and timing, never prompt or say text.
 */
export interface CueEvent {
  kind: CueKind;
  /** The delta's timestamp. */
  at: number;
  partyId?: string;
  paneId?: string;
  role?: Role;
  /** The party label. */
  label?: string;
  /** For `done`: how long the member had been working, when we saw it start. */
  durationMs?: number;
  /** For `spawn`: a whole party or one more member in a known party. */
  scope?: 'party' | 'member';
}

export interface EventCoreOptions {
  /** After a snapshot (connect, reconnect) nothing is announced for this long. */
  quietMs?: number;
  /** Minimum gap before the same cue for the same member is announced again, per kind. */
  flapMs?: Partial<Record<CueKind, number>>;
}

const DEFAULT_QUIET_MS = 1500;
const DEFAULT_FLAP_MS: Record<CueKind, number> = { done: 10_000, blocked: 10_000, spawn: 5000, message: 1200, allDone: 10_000 };

/** Fewer than two agents finishing is just a `done`, not a celebration. */
const ALL_DONE_MIN_MEMBERS = 2;

export function isAllDone(world: World): boolean {
  const members = Object.values(world.parties).flatMap((p) => Object.values(p.members));
  return members.length >= ALL_DONE_MIN_MEMBERS && members.every((m) => m.status === 'done');
}

const keyOf = (partyId: string, paneId: string) => `${partyId}/${paneId}`;

/** The role to show for a party as a whole: its first member's. */
function leadRole(p: Party): Role | undefined {
  return Object.values(p.members)[0]?.role;
}

export class EventCore {
  private quietUntil = 0;
  private allDone = false;
  /** When each member last started working, from delta timestamps. */
  private workStart = new Map<string, number>();
  private lastEmit = new Map<string, number>();
  private readonly quietMs: number;
  private readonly flapMs: Record<CueKind, number>;

  constructor(opts: EventCoreOptions = {}) {
    this.quietMs = opts.quietMs ?? DEFAULT_QUIET_MS;
    this.flapMs = { ...DEFAULT_FLAP_MS, ...opts.flapMs };
  }

  /** Events for one delta. `prev` is the world before it, `now` a monotonic clock for quiet and flap windows. */
  process(prev: World, delta: Delta, now: number): CueEvent[] {
    const next = applyDelta(prev, delta);
    const events: CueEvent[] = [];

    if (delta.kind === 'snapshot') {
      // Adopt the world silently: a snapshot must never announce every agent.
      this.quietUntil = now + this.quietMs;
      this.workStart.clear();
      this.allDone = isAllDone(next);
      return [];
    }

    if (delta.kind === 'say') {
      const from = prev.parties[delta.partyId]?.members[delta.paneId];
      if (from && delta.to) events.push({ kind: 'message', at: delta.t, partyId: delta.partyId, paneId: delta.paneId, role: from.role, label: prev.parties[delta.partyId]!.label });
    } else if (delta.kind === 'removed') {
      const prefix = `${delta.partyId}/`;
      for (const k of [...this.workStart.keys()]) if (delta.paneId === undefined ? k.startsWith(prefix) : k === keyOf(delta.partyId, delta.paneId)) this.workStart.delete(k);
    } else {
      this.diffParty(prev, next, delta.kind === 'member' ? delta.partyId : delta.party.id, delta.t, events);
    }

    const allNow = isAllDone(next);
    if (allNow && !this.allDone) events.push({ kind: 'allDone', at: delta.t });
    this.allDone = allNow;

    return events.filter((e) => this.admit(e, now));
  }

  private diffParty(prev: World, next: World, partyId: string, t: number, out: CueEvent[]): void {
    const before = prev.parties[partyId];
    const after = next.parties[partyId];
    if (!after) return;
    if (!before) {
      for (const m of Object.values(after.members)) if (m.status === 'working') this.workStart.set(keyOf(partyId, m.paneId), t);
      out.push({ kind: 'spawn', scope: 'party', at: t, partyId, label: after.label, ...(leadRole(after) ? { role: leadRole(after)! } : {}) });
      return;
    }
    for (const m of Object.values(after.members)) {
      const key = keyOf(partyId, m.paneId);
      const was = before.members[m.paneId];
      const base = { at: t, partyId, paneId: m.paneId, role: m.role, label: after.label };
      if (!was) {
        if (m.status === 'working') this.workStart.set(key, t);
        out.push({ kind: 'spawn', scope: 'member', ...base });
        continue;
      }
      if (was.status === m.status) continue;
      if (m.status === 'working') this.workStart.set(key, t);
      else if (m.status === 'done') {
        const started = this.workStart.get(key);
        this.workStart.delete(key);
        const ms = started === undefined ? NaN : t - started;
        out.push({ kind: 'done', ...base, ...(Number.isFinite(ms) && ms >= 0 ? { durationMs: ms } : {}) });
      } else if (m.status === 'blocked') out.push({ kind: 'blocked', ...base });
    }
  }

  /** Flap guard: the same cue for the same member is dropped inside its window. */
  private admit(e: CueEvent, now: number): boolean {
    if (now < this.quietUntil) return false;
    const key = `${e.kind}:${e.partyId ?? ''}/${e.paneId ?? ''}`;
    const last = this.lastEmit.get(key);
    if (last !== undefined && now - last < this.flapMs[e.kind]) return false;
    this.lastEmit.set(key, now);
    return true;
  }
}
