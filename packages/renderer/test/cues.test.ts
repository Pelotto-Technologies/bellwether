import { applyDelta, emptyWorld, type Delta, type Member, type Party, type World } from '@bellwether/adapter/core';
import { describe, expect, it } from 'vitest';
import { EventCore, isAllDone } from '../src/cues/events.js';
import { CueGate, soundsFor } from '../src/cues/gate.js';
import { ToastQueue, TOAST_TIMING, toastFor } from '../src/cues/toasts.js';

const member = (paneId: string, status: Member['status'], role: Member['role'] = 'implementer'): Member => ({ paneId, agent: 'claude', role, status, lastChange: 0 });
const party = (id: string, label: string, members: Member[]): Party => ({
  id,
  label,
  isWorktree: false,
  status: 'unknown',
  members: Object.fromEntries(members.map((m) => [m.paneId, m])),
  tokens: {},
});
const snapshot = (parties: Party[], t = 0): Delta => ({ t, kind: 'snapshot', world: { machine: 'local', parties: Object.fromEntries(parties.map((p) => [p.id, p])) } });

/** Feeds deltas through the core the way the page does: previous world, then apply. */
function run(core: EventCore, start: World, steps: { d: Delta; now: number }[]) {
  let world = start;
  const out: ReturnType<EventCore['process']> = [];
  for (const { d, now } of steps) {
    out.push(...core.process(world, d, now));
    world = applyDelta(world, d);
  }
  return { out, world };
}

describe('EventCore', () => {
  it('is silent on a snapshot, however many agents it holds', () => {
    const core = new EventCore();
    const big = snapshot(Array.from({ length: 8 }, (_, i) => party(`p${i}`, `proj-${i}`, [member('a', 'done'), member('b', 'blocked')])));
    expect(core.process(emptyWorld(), big, 0)).toEqual([]);
  });

  it('stays quiet for a moment after a snapshot, then speaks', () => {
    const core = new EventCore({ quietMs: 1000 });
    const snap = snapshot([party('p', 'alpha', [member('a', 'working'), member('b', 'working')])]);
    const { world } = run(core, emptyWorld(), [{ d: snap, now: 0 }]);
    const done: Delta = { t: 10, kind: 'member', partyId: 'p', member: member('a', 'done') };
    expect(core.process(world, done, 500)).toEqual([]);
    const done2: Delta = { t: 20, kind: 'member', partyId: 'p', member: member('b', 'done') };
    // b finishing after the quiet window is announced; the earlier, suppressed done is not replayed.
    const w2 = applyDelta(world, done);
    expect(core.process(w2, done2, 1500).map((e) => e.kind)).toEqual(['done', 'allDone']);
  });

  it('announces done and blocked transitions with role and label', () => {
    const core = new EventCore({ quietMs: 0 });
    const world = applyDelta(emptyWorld(), snapshot([party('p', 'auth-refresh', [member('a', 'working', 'reviewer'), member('b', 'working', 'architect')])]));
    core.process(emptyWorld(), snapshot([party('p', 'auth-refresh', [member('a', 'working', 'reviewer'), member('b', 'working', 'architect')])]), 0);
    const e1 = core.process(world, { t: 5, kind: 'member', partyId: 'p', member: member('a', 'done', 'reviewer') }, 100);
    expect(e1).toMatchObject([{ kind: 'done', role: 'reviewer', label: 'auth-refresh', partyId: 'p', paneId: 'a' }]);
    const e2 = core.process(applyDelta(world, { t: 5, kind: 'member', partyId: 'p', member: member('a', 'done', 'reviewer') }), { t: 6, kind: 'member', partyId: 'p', member: member('b', 'blocked', 'architect') }, 200);
    expect(e2).toMatchObject([{ kind: 'blocked', role: 'architect', label: 'auth-refresh' }]);
  });

  it('carries a member\'s name into its done cue', () => {
    const core = new EventCore({ quietMs: 0 });
    const named = (status: Member['status']): Member => ({ ...member('a', status, 'reviewer'), name: 'Quill' });
    const snap = snapshot([party('p', 'auth-refresh', [named('working'), member('b', 'working')])]);
    core.process(emptyWorld(), snap, 0);
    const [e] = core.process(applyDelta(emptyWorld(), snap), { t: 5, kind: 'member', partyId: 'p', member: named('done') }, 100);
    expect(e).toMatchObject({ kind: 'done', name: 'Quill', role: 'reviewer' });
    expect(toastFor(e!)?.text).toBe('Quill (reviewer) finished · auth-refresh');
  });

  it('does not announce status that did not change, or a member that arrives already done', () => {
    const core = new EventCore({ quietMs: 0 });
    const p = party('p', 'x', [member('a', 'working'), member('b', 'working')]);
    const { out } = run(core, emptyWorld(), [
      { d: snapshot([p]), now: 0 },
      { d: { t: 1, kind: 'member', partyId: 'p', member: { ...member('a', 'working'), say: 'hi' } }, now: 100 },
    ]);
    expect(out).toEqual([]);
  });

  it('measures how long a member worked, from delta timestamps, and omits it when unknown', () => {
    const core = new EventCore({ quietMs: 0 });
    const p = party('p', 'x', [member('a', 'idle'), member('b', 'idle')]);
    const { out } = run(core, emptyWorld(), [
      { d: snapshot([p], 0), now: 0 },
      { d: { t: 60_000, kind: 'member', partyId: 'p', member: member('a', 'working') }, now: 1 },
      { d: { t: 60_000 + 12 * 60_000, kind: 'member', partyId: 'p', member: member('a', 'done') }, now: 2 },
      { d: { t: 900_000, kind: 'member', partyId: 'p', member: member('b', 'done') }, now: 3 },
    ]);
    const dones = out.filter((e) => e.kind === 'done');
    expect(dones[0]?.durationMs).toBe(12 * 60_000);
    expect(dones[1]?.durationMs).toBeUndefined();
  });

  it('restarts the clock when a member starts working again', () => {
    const core = new EventCore({ quietMs: 0, flapMs: { done: 0 } });
    const p = party('p', 'x', [member('a', 'idle'), member('b', 'working')]);
    const { out } = run(core, emptyWorld(), [
      { d: snapshot([p]), now: 0 },
      { d: { t: 1000, kind: 'member', partyId: 'p', member: member('a', 'working') }, now: 1 },
      { d: { t: 2000, kind: 'member', partyId: 'p', member: member('a', 'done') }, now: 2 },
      { d: { t: 50_000, kind: 'member', partyId: 'p', member: member('a', 'working') }, now: 3 },
      { d: { t: 53_000, kind: 'member', partyId: 'p', member: member('a', 'done') }, now: 4 },
    ]);
    expect(out.filter((e) => e.kind === 'done').map((e) => e.durationMs)).toEqual([1000, 3000]);
  });

  it('drops a status that flaps back and forth inside the window', () => {
    const core = new EventCore({ quietMs: 0 });
    const p = party('p', 'x', [member('a', 'working'), member('b', 'working')]);
    const steps: { d: Delta; now: number }[] = [{ d: snapshot([p]), now: 0 }];
    for (let i = 0; i < 6; i++) {
      steps.push({ d: { t: 10 + i * 2, kind: 'member', partyId: 'p', member: member('a', 'done') }, now: 100 + i * 400 });
      steps.push({ d: { t: 11 + i * 2, kind: 'member', partyId: 'p', member: member('a', 'working') }, now: 300 + i * 400 });
    }
    const { out } = run(core, emptyWorld(), steps);
    expect(out.filter((e) => e.kind === 'done')).toHaveLength(1);
  });

  it('announces a flap again once its window has passed', () => {
    const core = new EventCore({ quietMs: 0, flapMs: { blocked: 1000 } });
    const p = party('p', 'x', [member('a', 'working'), member('b', 'working')]);
    const { out } = run(core, emptyWorld(), [
      { d: snapshot([p]), now: 0 },
      { d: { t: 1, kind: 'member', partyId: 'p', member: member('a', 'blocked') }, now: 100 },
      { d: { t: 2, kind: 'member', partyId: 'p', member: member('a', 'working') }, now: 200 },
      { d: { t: 3, kind: 'member', partyId: 'p', member: member('a', 'blocked') }, now: 5000 },
    ]);
    expect(out.filter((e) => e.kind === 'blocked')).toHaveLength(2);
  });

  it('announces a new party once, and a new member of a known party as a member', () => {
    const core = new EventCore({ quietMs: 0 });
    const known = party('p', 'alpha', [member('a', 'working')]);
    const fresh = party('q', 'search-index', [member('x', 'working', 'orchestrator'), member('y', 'working')]);
    const { out } = run(core, emptyWorld(), [
      { d: snapshot([known]), now: 0 },
      { d: { t: 1, kind: 'party', party: fresh }, now: 100 },
      { d: { t: 2, kind: 'member', partyId: 'p', member: member('b', 'working', 'reviewer') }, now: 200 },
    ]);
    expect(out).toMatchObject([
      { kind: 'spawn', scope: 'party', label: 'search-index', role: 'orchestrator' },
      { kind: 'spawn', scope: 'member', role: 'reviewer', label: 'alpha' },
    ]);
  });

  it('turns a say addressed to another agent into a message, and ignores plain speech', () => {
    const core = new EventCore({ quietMs: 0 });
    const p = party('p', 'x', [member('a', 'working', 'architect'), member('b', 'working')]);
    const { out } = run(core, emptyWorld(), [
      { d: snapshot([p]), now: 0 },
      { d: { t: 1, kind: 'say', partyId: 'p', paneId: 'a', text: 'secret prompt text' }, now: 100 },
      { d: { t: 2, kind: 'say', partyId: 'p', paneId: 'a', text: 'secret hand-off', to: { partyId: 'p', paneId: 'b' } }, now: 200 },
    ]);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ kind: 'message', role: 'architect' });
    expect(JSON.stringify(out)).not.toContain('secret');
  });

  it('fires allDone once when the last member finishes, and re-arms after someone resumes', () => {
    const core = new EventCore({ quietMs: 0, flapMs: { done: 0, allDone: 0 } });
    const p = party('p', 'x', [member('a', 'working'), member('b', 'working')]);
    const q = party('q', 'y', [member('c', 'done')]);
    const { out } = run(core, emptyWorld(), [
      { d: snapshot([p, q]), now: 0 },
      { d: { t: 1, kind: 'member', partyId: 'p', member: member('a', 'done') }, now: 100 },
      { d: { t: 2, kind: 'member', partyId: 'p', member: member('b', 'done') }, now: 200 },
      { d: { t: 3, kind: 'member', partyId: 'p', member: member('b', 'done') }, now: 300 },
      { d: { t: 4, kind: 'member', partyId: 'p', member: member('a', 'working') }, now: 400 },
      { d: { t: 5, kind: 'member', partyId: 'p', member: member('a', 'done') }, now: 500 },
    ]);
    expect(out.filter((e) => e.kind === 'allDone')).toHaveLength(2);
  });

  it('does not celebrate a world that is already all done at connect, or a lone agent', () => {
    const core = new EventCore({ quietMs: 0 });
    const lone = snapshot([party('p', 'x', [member('a', 'working')])]);
    const { out, world } = run(core, emptyWorld(), [
      { d: lone, now: 0 },
      { d: { t: 1, kind: 'member', partyId: 'p', member: member('a', 'done') }, now: 100 },
    ]);
    expect(out.map((e) => e.kind)).toEqual(['done']);
    expect(isAllDone(world)).toBe(false);
    const done = snapshot([party('p', 'x', [member('a', 'done'), member('b', 'done')])]);
    expect(new EventCore().process(emptyWorld(), done, 0)).toEqual([]);
  });

  it('forgets work start times when a party or pane is removed', () => {
    const core = new EventCore({ quietMs: 0, flapMs: { done: 0 } });
    const p = party('p', 'x', [member('a', 'idle'), member('b', 'idle')]);
    const { out } = run(core, emptyWorld(), [
      { d: snapshot([p]), now: 0 },
      { d: { t: 1000, kind: 'member', partyId: 'p', member: member('a', 'working') }, now: 1 },
      { d: { t: 2000, kind: 'removed', partyId: 'p', paneId: 'a' }, now: 2 },
      { d: { t: 3000, kind: 'member', partyId: 'p', member: member('a', 'done') }, now: 3 },
    ]);
    // `a` came back already done: a new member, not a finish.
    expect(out.filter((e) => e.kind === 'done')).toEqual([]);
  });
});

describe('CueGate', () => {
  it('caps cues per rolling second', () => {
    const gate = new CueGate({ maxPerSecond: 3, minGapMs: { done: 0, blocked: 0 } });
    const allowed = [0, 100, 200, 300, 400, 900].filter((t, i) => gate.allow(i % 2 ? 'blocked' : 'done', t));
    expect(allowed).toEqual([0, 100, 200]);
    expect(gate.allow('done', 1050)).toBe(true);
  });

  it('spaces cues of one kind, and drops the quiet kinds first when busy', () => {
    const gate = new CueGate();
    expect(gate.allow('done', 0)).toBe(true);
    expect(gate.allow('done', 50)).toBe(false);
    expect(gate.allow('blocked', 100)).toBe(true);
    expect(gate.allow('message', 200)).toBe(false);
    expect(gate.allow('spawn', 300)).toBe(false);
    expect(gate.allow('message', 1200)).toBe(true);
  });

  it('plays only the fanfare when allDone arrives with a done', () => {
    expect(soundsFor([{ kind: 'done', at: 0 }, { kind: 'allDone', at: 0 }])).toEqual(['allDone']);
    expect(soundsFor([{ kind: 'done', at: 0 }])).toEqual(['done']);
  });
});

describe('toasts', () => {
  it('words each event from role, label and duration only', () => {
    expect(toastFor({ kind: 'done', at: 0, role: 'reviewer', label: 'auth-refresh', durationMs: 12 * 60_000 })?.text).toBe('reviewer finished · auth-refresh · 12m');
    expect(toastFor({ kind: 'done', at: 0, role: 'reviewer', label: 'auth-refresh' })?.text).toBe('reviewer finished · auth-refresh');
    expect(toastFor({ kind: 'blocked', at: 0, role: 'implementer', label: 'billing-export' })?.text).toBe('implementer needs you · billing-export');
    expect(toastFor({ kind: 'done', at: 0, role: 'reviewer', name: 'Quill', label: 'auth-refresh' })?.text).toBe('Quill (reviewer) finished · auth-refresh');
    expect(toastFor({ kind: 'blocked', at: 0, role: 'implementer', name: 'Rook', label: 'billing-export' })?.text).toBe('Rook (implementer) needs you · billing-export');
    expect(toastFor({ kind: 'spawn', at: 0, scope: 'party', label: 'search-index' })?.text).toBe('New party: search-index');
    expect(toastFor({ kind: 'allDone', at: 0 })?.text).toBe('All quests complete');
    expect(toastFor({ kind: 'message', at: 0, role: 'architect' })).toBeUndefined();
    expect(toastFor({ kind: 'spawn', at: 0, scope: 'member', label: 'x' })).toBeUndefined();
  });

  it('clips a long label', () => {
    const t = toastFor({ kind: 'blocked', at: 0, role: 'ops', label: 'a'.repeat(80) })!;
    expect(t.text.length).toBeLessThan(60);
    expect(t.text).toContain('…');
  });

  it('slides in, holds, slides out, one at a time', () => {
    const q = new ToastQueue();
    const a = { text: 'a', status: 'done' as const };
    const b = { text: 'b', status: 'blocked' as const };
    q.push(a);
    q.push(b);
    const { inMs, holdMs, outMs, gapMs } = TOAST_TIMING;
    expect(q.frame(1000)).toMatchObject({ toast: a, phase: 'in', shown: 0 });
    expect(q.frame(1000 + inMs / 2)?.shown).toBeCloseTo(0.5);
    expect(q.frame(1000 + inMs + 10)).toMatchObject({ toast: a, phase: 'hold', shown: 1 });
    expect(q.frame(1000 + inMs + holdMs + outMs / 2)).toMatchObject({ toast: a, phase: 'out' });
    expect(q.frame(1000 + inMs + holdMs + outMs + 1)).toBeNull();
    // The next one waits out the gap.
    expect(q.frame(1000 + inMs + holdMs + outMs + gapMs / 2)).toBeNull();
    expect(q.frame(1000 + inMs + holdMs + outMs + gapMs + 5)).toMatchObject({ toast: b, phase: 'in' });
  });

  it('holds about four seconds', () => {
    expect(TOAST_TIMING.holdMs).toBe(4000);
  });

  it('drops duplicates and the oldest beyond the queue limit', () => {
    const q = new ToastQueue();
    for (let i = 0; i < 10; i++) q.push({ text: `t${i}`, status: 'done' });
    q.push({ text: 't9', status: 'done' });
    expect(q.waiting).toBe(TOAST_TIMING.maxQueue);
    expect(q.frame(0)?.toast.text).toBe('t4');
  });

  it('shortens the hold when a backlog builds up', () => {
    const q = new ToastQueue();
    for (let i = 0; i < 4; i++) q.push({ text: `t${i}`, status: 'done' });
    q.frame(0);
    expect(q.frame(TOAST_TIMING.inMs + TOAST_TIMING.busyHoldMs + 10)).toMatchObject({ phase: 'out' });
  });
});
