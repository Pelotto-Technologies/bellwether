// Decorator that adds levels and moments to any WorldSource. Browser-safe: persistence is injected (see stats-store.ts).
import type { Action } from './actions.js';
import type { DeltaListener, WorldSource } from './source.js';
import { StatsTracker, type StatsSnapshot } from './stats.js';
import type { Delta, Member, Party, World } from './types.js';
import { applyDelta, emptyWorld } from './world.js';

export interface StatsSourceOptions {
  /** Clock in ms. Injected in tests. */
  now?: () => number;
  /** Totals to continue from (the loaded file, or fake ones for the mock). */
  totals?: StatsSnapshot;
  /** Called with the new totals whenever they changed; the store debounces writes. */
  onChange?: (snapshot: StatsSnapshot) => void;
  /** Called once when the source stops (the store flushes). */
  onStop?: (snapshot: StatsSnapshot) => void;
  /** How often elapsed time is credited and quest timers checked. Default 1000 ms. */
  tickMs?: number;
  /** How often changed XP bars are pushed to viewers. Default 5000 ms. */
  refreshMs?: number;
  dwellMs?: number;
}

const sameAnnotation = (a: Member, b: Member) => a.level === b.level && a.xp?.have === b.xp?.have && a.xp?.next === b.xp?.next;

/**
 * Annotates members with `level` and `xp` (per ROLE) and emits `moment` deltas (`level_up`, `quest_complete`).
 * Wraps the source the way `GitProbeSource` does, so the server and recordings see one stream.
 */
export class StatsSource implements WorldSource {
  private listeners: DeltaListener[] = [];
  private world: World = emptyWorld();
  private readonly tracker: StatsTracker;
  private tickTimer?: ReturnType<typeof setInterval>;
  private lastRefresh = 0;
  private lastSaved = '';
  private readonly now: () => number;

  constructor(
    private readonly inner: WorldSource,
    private readonly opts: StatsSourceOptions = {},
  ) {
    this.now = opts.now ?? Date.now;
    this.tracker = new StatsTracker({ now: this.now, ...(opts.totals ? { totals: opts.totals } : {}), ...(opts.dwellMs !== undefined ? { dwellMs: opts.dwellMs } : {}) });
    inner.on('delta', (d) => this.onDelta(d));
  }

  get actions(): Action {
    return this.inner.actions;
  }

  partyFolder(partyId: string): string | undefined {
    return this.inner.partyFolder?.(partyId);
  }

  on(_event: 'delta', fn: DeltaListener): void {
    this.listeners.push(fn);
  }

  /** The tracker, for tests and diagnostics. */
  get stats(): StatsTracker {
    return this.tracker;
  }

  async start(): Promise<void> {
    this.lastRefresh = this.now();
    this.tickTimer = setInterval(() => this.tick(), this.opts.tickMs ?? 1000);
    (this.tickTimer as { unref?: () => void }).unref?.();
    await this.inner.start();
  }

  async stop(): Promise<void> {
    clearInterval(this.tickTimer);
    this.tickTimer = undefined;
    await this.inner.stop();
    this.tracker.tick();
    this.opts.onStop?.(this.tracker.snapshot());
  }

  private emit(d: Delta): void {
    for (const fn of this.listeners) fn(d);
  }

  private annotateParty(p: Party): Party {
    return { ...p, members: Object.fromEntries(Object.entries(p.members).map(([id, m]) => [id, this.tracker.annotate(m)])) };
  }

  private onDelta(d: Delta): void {
    const moments = this.tracker.apply(d);
    let out = d;
    if (d.kind === 'snapshot') out = { ...d, world: { ...d.world, parties: Object.fromEntries(Object.entries(d.world.parties).map(([id, p]) => [id, this.annotateParty(p)])) } };
    else if (d.kind === 'party') out = { ...d, party: this.annotateParty(d.party) };
    else if (d.kind === 'member') out = { ...d, member: this.tracker.annotate(d.member) };
    this.world = applyDelta(this.world, out);
    this.emit(out);
    // A level-up changed every member of that role: push the new bars before the flourish.
    if (moments.length) this.refresh();
    for (const m of moments) this.emit(m);
    this.save();
  }

  private tick(): void {
    const moments = this.tracker.tick();
    const now = this.now();
    const due = now - this.lastRefresh >= (this.opts.refreshMs ?? 5000);
    if (moments.length || due) this.refresh();
    for (const m of moments) this.emit(m);
    this.save();
  }

  /** Re-annotates every member and sends a `member` delta for each whose level or bar changed. */
  private refresh(): void {
    this.lastRefresh = this.now();
    for (const p of Object.values(this.world.parties)) {
      for (const m of Object.values(p.members)) {
        const next = this.tracker.annotate(m);
        if (sameAnnotation(m, next)) continue;
        const delta: Delta = { t: this.now(), kind: 'member', partyId: p.id, member: next };
        this.world = applyDelta(this.world, delta);
        this.emit(delta);
      }
    }
  }

  private save(): void {
    if (!this.opts.onChange) return;
    const snap = this.tracker.snapshot();
    const text = JSON.stringify(snap);
    if (text === this.lastSaved) return;
    this.lastSaved = text;
    this.opts.onChange(snap);
  }
}
