import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createSource } from '../src/config.js';
import { MockSource, mockTotals } from '../src/mock.js';
import { applyDelta, emptyWorld } from '../src/world.js';
import { parseRecording } from '../src/recording.js';
import { scrubDelta } from '../src/scrub.js';
import { BaseSource } from '../src/source.js';
import { StatsSource } from '../src/stats-source.js';
import { QUEST_DWELL_MS } from '../src/stats.js';
import type { Delta, Member, Party, Role, Status } from '../src/types.js';

class Fake extends BaseSource {
  async start() {}
  async stop() {}
  push(d: Delta) {
    this.emit(d);
  }
}
const member = (paneId: string, role: Role, status: Status, extra: Partial<Member> = {}): Member => ({ paneId, agent: 'claude', role, status, lastChange: 7, ...extra });
const party = (id: string, members: Member[]): Party => ({ id, label: id, isWorktree: false, status: 'idle', tokens: {}, members: Object.fromEntries(members.map((m) => [m.paneId, m])) });
const snap = (...ps: Party[]): Delta => ({ t: 0, kind: 'snapshot', world: { machine: 'local', parties: Object.fromEntries(ps.map((p) => [p.id, p])) } });

afterEach(() => vi.useRealTimers());

async function setup(totals?: ReturnType<typeof mockTotals>) {
  vi.useFakeTimers();
  const inner = new Fake();
  const src = new StatsSource(inner, { ...(totals ? { totals } : {}), refreshMs: 5000 });
  const out: Delta[] = [];
  src.on('delta', (d) => out.push(d));
  await src.start();
  return { inner, src, out, moments: () => out.filter((d) => d.kind === 'moment') };
}

describe('StatsSource', () => {
  it('annotates members of every delta kind with the level of their role', async () => {
    const { inner, out } = await setup();
    inner.push(snap(party('w1', [member('p1', 'implementer', 'idle'), member('p2', 'writer', 'idle')])));
    const s = out[0]!;
    if (s.kind !== 'snapshot') throw new Error();
    expect(s.world.parties.w1!.members.p1).toMatchObject({ level: 1, xp: { have: 0, next: 40 } });
    inner.push({ t: 1, kind: 'member', partyId: 'w1', member: member('p1', 'implementer', 'working') });
    expect(out[1]).toMatchObject({ kind: 'member', member: { level: 1, xp: { have: 0, next: 40 } } });
    inner.push({ t: 2, kind: 'party', party: party('w1', [member('p1', 'implementer', 'working')]) });
    expect(out[2]).toMatchObject({ kind: 'party', party: { members: { p1: { level: 1 } } } });
  });

  it('a level up pushes new bars to the whole role, then emits the moment', async () => {
    const { inner, out, moments } = await setup({ roles: { implementer: { xp: 39, tasks: 0, workingMs: 0, blockedMs: 0, messages: 0, tools: {} } }, lifetime: { tasks: 0, quests: 0, workingMs: 0, blockedMs: 0, messages: 0 } });
    inner.push(snap(party('w1', [member('a', 'implementer', 'idle')]), party('w2', [member('b', 'implementer', 'idle')])));
    inner.push({ t: 1, kind: 'member', partyId: 'w1', member: member('a', 'implementer', 'working') });
    await vi.advanceTimersByTimeAsync(10_000);
    out.length = 0;
    inner.push({ t: 2, kind: 'member', partyId: 'w1', member: member('a', 'implementer', 'done') });
    const kinds = out.map((d) => (d.kind === 'moment' ? `moment:${d.moment}` : d.kind === 'member' ? `member:${d.partyId}/${d.member.paneId}:${d.member.level}` : d.kind));
    expect(kinds).toEqual(['member:w1/a:2', 'member:w2/b:2', 'moment:level_up']);
    expect(moments()[0]).toMatchObject({ partyId: 'w1', paneId: 'a', role: 'implementer', level: 2 });
  });

  it('emits the quest once per run and again for the next run', async () => {
    const { inner, moments } = await setup();
    inner.push(snap(party('w1', [member('a', 'implementer', 'idle'), member('b', 'reviewer', 'idle')])));
    for (const run of [1, 2]) {
      inner.push({ t: run, kind: 'member', partyId: 'w1', member: member('a', 'implementer', 'working', { tool: 'Edit' }) });
      inner.push({ t: run, kind: 'member', partyId: 'w1', member: member('b', 'reviewer', 'working') });
      await vi.advanceTimersByTimeAsync(20_000);
      inner.push({ t: run, kind: 'member', partyId: 'w1', member: member('a', 'implementer', 'done') });
      inner.push({ t: run, kind: 'member', partyId: 'w1', member: member('b', 'reviewer', 'done') });
      await vi.advanceTimersByTimeAsync(QUEST_DWELL_MS + 3000);
      expect(moments().filter((m) => m.kind === 'moment' && m.moment === 'quest_complete')).toHaveLength(run);
      await vi.advanceTimersByTimeAsync(60_000);
      expect(moments().filter((m) => m.kind === 'moment' && m.moment === 'quest_complete')).toHaveLength(run);
    }
    const q = moments().filter((m) => m.kind === 'moment' && m.moment === 'quest_complete')[0]!;
    if (q.kind !== 'moment') throw new Error();
    expect(q.recap).toMatchObject({ tasks: 2, members: { implementer: 1, reviewer: 1 }, tools: { edit: 1 } });
  });

  it('keeps the world model and the server unchanged by a moment', () => {
    const w = applyDelta(emptyWorld(), snap(party('w1', [member('a', 'writer', 'idle')])));
    expect(applyDelta(w, { t: 1, kind: 'moment', moment: 'level_up', partyId: 'w1', paneId: 'a', role: 'writer', level: 2 })).toBe(w);
  });

  it('moments round trip through a recording and survive the scrub', () => {
    const d: Delta = { t: 5, kind: 'moment', moment: 'quest_complete', partyId: 'w1', recap: { durationMs: 1, members: { writer: 1 }, tasks: 1, blockedMs: 0, tools: { edit: 1 }, xp: 22, levelUps: [{ role: 'writer', level: 2 }] } };
    const text = [d, { t: 6, kind: 'moment', moment: 'level_up', partyId: 'w1', paneId: 'a', role: 'writer', level: 2 } as Delta].map((x) => JSON.stringify(x)).join('\n');
    const back = parseRecording(text);
    expect(back[0]).toEqual(d);
    expect(back.map(scrubDelta)).toEqual(back);
    const scrubbed = scrubDelta({ t: 0, kind: 'snapshot', world: { machine: 'm', parties: { w1: party('w1', [{ ...member('a', 'writer', 'idle'), level: 2, xp: { have: 1, next: 60 } }]) } } });
    if (scrubbed.kind !== 'snapshot') throw new Error();
    expect(scrubbed.world.parties.w1!.label).toMatch(/^ws-/);
    expect(scrubbed.world.parties.w1!.members.a).toMatchObject({ level: 2, xp: { have: 1, next: 60 } });
  });

  it('the mock shows a level up and a quest complete within 40 seconds', async () => {
    vi.useFakeTimers();
    const src = new StatsSource(new MockSource({ intervalMs: 1500 }), { totals: mockTotals() });
    const out: Delta[] = [];
    src.on('delta', (d) => out.push(d));
    await src.start();
    await vi.advanceTimersByTimeAsync(40_000);
    await src.stop();
    const moments = out.filter((d) => d.kind === 'moment');
    expect(moments.some((m) => m.kind === 'moment' && m.moment === 'level_up')).toBe(true);
    expect(moments.filter((m) => m.kind === 'moment' && m.moment === 'quest_complete')).toHaveLength(1);
  });
});

describe('createSource with stats', () => {
  const dir = () => mkdtempSync(path.join(os.tmpdir(), 'bw-cs-'));

  it('wraps live/hooks only when enabled, persists on stop, and never wraps a disabled config', async () => {
    const file = path.join(dir(), 'stats.json');
    const inner = new Fake();
    expect(createSource({ source: 'hooks', herdr: {} }, { hooks: () => inner })).toBe(inner);
    expect(createSource({ source: 'hooks', herdr: {}, stats: { enabled: false } }, { hooks: () => inner })).toBe(inner);
    const src = createSource({ source: 'hooks', herdr: {}, stats: { enabled: true } }, { hooks: () => inner, statsFile: file });
    expect(src).toBeInstanceOf(StatsSource);
    await src.start();
    inner.push(snap(party('w1', [member('a', 'writer', 'working')])));
    await src.stop();
    expect(existsSync(file)).toBe(true);
    expect(readFileSync(file, 'utf8')).not.toContain('w1');
  });

  it('the mock gets fake levels and never writes the file', async () => {
    const file = path.join(dir(), 'stats.json');
    const src = createSource({ source: 'mock', herdr: {}, stats: { enabled: true } }, { statsFile: file });
    expect(src).toBeInstanceOf(StatsSource);
    await src.start();
    await src.stop();
    expect(existsSync(file)).toBe(false);
  });
});
