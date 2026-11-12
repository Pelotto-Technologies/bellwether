import type { CueEvent } from './events.js';
import type { CueKind } from './schedule.js';

export interface GateOptions {
  /** Most cues allowed in any rolling second. */
  maxPerSecond?: number;
  /** Minimum gap between two cues of the same kind, in ms. */
  minGapMs?: Partial<Record<CueKind, number>>;
}

const DEFAULT_GAP_MS: Record<CueKind, number> = { done: 150, blocked: 150, spawn: 300, message: 400, allDone: 1500 };

/** The all-done fanfare already says "done": drop the plain done that arrived with it. */
export function soundsFor(events: readonly CueEvent[]): CueKind[] {
  const hasAll = events.some((e) => e.kind === 'allDone');
  return events.filter((e) => !(hasAll && e.kind === 'done')).map((e) => e.kind);
}

/**
 * Rate limit for sound cues, a last line of defence after the event core's debouncing:
 * a rolling cap per second, a per-kind gap, and the quiet kinds (spawn, message) are the first to go
 * when the second is getting busy.
 */
export class CueGate {
  private recent: number[] = [];
  private lastByKind = new Map<CueKind, number>();
  private readonly max: number;
  private readonly gap: Record<CueKind, number>;

  constructor(opts: GateOptions = {}) {
    this.max = opts.maxPerSecond ?? 3;
    this.gap = { ...DEFAULT_GAP_MS, ...opts.minGapMs };
  }

  allow(kind: CueKind, now: number): boolean {
    this.recent = this.recent.filter((t) => now - t < 1000);
    const quiet = kind === 'spawn' || kind === 'message';
    if (this.recent.length >= (quiet ? this.max - 1 : this.max)) return false;
    const last = this.lastByKind.get(kind);
    if (last !== undefined && now - last < this.gap[kind]) return false;
    this.recent.push(now);
    this.lastByKind.set(kind, now);
    return true;
  }
}
