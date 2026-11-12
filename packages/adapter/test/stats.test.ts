import { describe, expect, it } from 'vitest';
import { levelFor, MAX_LEVEL, MIN_TASK_MS, normalizeStats, QUEST_DWELL_MS, StatsTracker, toolCategory, XP, xpForLevel } from '../src/stats.js';
import type { Delta, Member, Party, Role, Status } from '../src/types.js';

const member = (paneId: string, role: Role, status: Status, extra: Partial<Member> = {}): Member => ({ paneId, agent: 'claude', role, status, lastChange: 0, ...extra });
const party = (id: string, members: Member[]): Party => ({ id, label: id, isWorktree: false, status: 'idle', tokens: {}, members: Object.fromEntries(members.map((m) => [m.paneId, m])) });
const snap = (...parties: Party[]): Delta => ({ t: 0, kind: 'snapshot', world: { machine: 'local', parties: Object.fromEntries(parties.map((p) => [p.id, p])) } });
const mem = (partyId: string, m: Member): Delta => ({ t: 0, kind: 'member', partyId, member: m });

function harness(totals?: Parameters<typeof normalizeStats>[0]) {
  let t = 1_000_000;
  const tr = new StatsTracker({ now: () => t, ...(totals ? { totals: normalizeStats(totals) } : {}) });
  return { tr, advance: (ms: number) => void (t += ms) };
}

describe('level curve', () => {
  it('has growing thresholds: 40, 100, 180, 280', () => {
    expect([1, 2, 3, 4, 5].map(xpForLevel)).toEqual([0, 40, 100, 180, 280]);
  });
  it('maps xp to level, progress and span', () => {
    expect(levelFor(0)).toEqual({ level: 1, have: 0, next: 40 });
    expect(levelFor(39)).toEqual({ level: 1, have: 39, next: 40 });
    expect(levelFor(40)).toEqual({ level: 2, have: 0, next: 60 });
    expect(levelFor(99.9)).toEqual({ level: 2, have: 59, next: 60 });
    expect(levelFor(100)).toEqual({ level: 3, have: 0, next: 80 });
  });
  it('survives garbage and the cap', () => {
    expect(levelFor(-5).level).toBe(1);
    expect(levelFor(NaN).level).toBe(1);
    expect(levelFor(1e12)).toEqual({ level: MAX_LEVEL, have: 0, next: 0 });
  });
  it('spans grow with the level', () => {
    let last = 0;
    for (let l = 1; l < 20; l++) {
      const span = xpForLevel(l + 1) - xpForLevel(l);
      expect(span).toBeGreaterThan(last);
      last = span;
    }
  });
});

describe('toolCategory', () => {
  it('maps common tools and falls back to other', () => {
    expect(toolCategory('Edit')).toBe('edit');
    expect(toolCategory('Bash')).toBe('shell');
    expect(toolCategory('Grep')).toBe('read');
    expect(toolCategory('WebSearch')).toBe('search');
    expect(toolCategory('Task')).toBe('delegate');
    expect(toolCategory('TodoWrite')).toBe('plan');
    expect(toolCategory('mystery')).toBe('other');
  });
});

describe('StatsTracker transitions and time', () => {
  it('a snapshot earns nothing and adopts silently', () => {
    const { tr } = harness();
    expect(tr.apply(snap(party('w1', [member('p1', 'implementer', 'working'), member('p2', 'reviewer', 'done')])))).toEqual([]);
    expect(tr.snapshot().lifetime.tasks).toBe(0);
    expect(tr.roleXp('implementer')).toBe(0);
  });

  it('working to done after enough work finishes a task and earns task plus time XP', () => {
    const { tr, advance } = harness();
    tr.apply(snap(party('w1', [member('p1', 'implementer', 'idle')])));
    tr.apply(mem('w1', member('p1', 'implementer', 'working')));
    advance(60_000);
    tr.apply(mem('w1', member('p1', 'implementer', 'done')));
    const s = tr.snapshot();
    expect(s.roles.implementer?.tasks).toBe(1);
    expect(s.roles.implementer?.workingMs).toBe(60_000);
    expect(s.roles.implementer?.xp).toBeCloseTo(XP.task + XP.perMinute, 5);
    expect(s.lifetime.tasks).toBe(1);
    expect(tr.sessionStats()[0]).toMatchObject({ role: 'implementer', tasks: 1, workingMs: 60_000 });
  });

  it('flapping earns no task: a short burst of work is not a task', () => {
    const { tr, advance } = harness();
    tr.apply(snap(party('w1', [member('p1', 'implementer', 'idle')])));
    for (let i = 0; i < 5; i++) {
      tr.apply(mem('w1', member('p1', 'implementer', 'working')));
      advance(MIN_TASK_MS - 1000);
      tr.apply(mem('w1', member('p1', 'implementer', 'done')));
      advance(500);
    }
    expect(tr.snapshot().lifetime.tasks).toBe(0);
  });

  it('done to idle or a repeated status is not a task', () => {
    const { tr, advance } = harness();
    tr.apply(snap(party('w1', [member('p1', 'writer', 'done')])));
    advance(60_000);
    tr.apply(mem('w1', member('p1', 'writer', 'idle')));
    tr.apply(mem('w1', member('p1', 'writer', 'idle')));
    expect(tr.snapshot().lifetime.tasks).toBe(0);
  });

  it('counts time blocked and a quick unblock bonus, but not a slow one', () => {
    const { tr, advance } = harness();
    tr.apply(snap(party('w1', [member('p1', 'architect', 'working')])));
    advance(10_000);
    tr.apply(mem('w1', member('p1', 'architect', 'blocked')));
    advance(30_000);
    tr.apply(mem('w1', member('p1', 'architect', 'working')));
    let s = tr.snapshot().roles.architect!;
    expect(s.blockedMs).toBe(30_000);
    expect(s.xp).toBeCloseTo(XP.quickUnblock + (10_000 / 60_000) * XP.perMinute, 5);
    const before = s.xp;
    tr.apply(mem('w1', member('p1', 'architect', 'blocked')));
    advance(5 * 60_000);
    tr.apply(mem('w1', member('p1', 'architect', 'working')));
    s = tr.snapshot().roles.architect!;
    expect(s.xp).toBeCloseTo(before, 5);
  });

  it('tick credits working time, and one long gap is capped', () => {
    const { tr, advance } = harness();
    tr.apply(snap(party('w1', [member('p1', 'ops', 'working')])));
    advance(30_000);
    tr.tick();
    expect(tr.snapshot().roles.ops?.workingMs).toBe(30_000);
    advance(3 * 3600_000);
    tr.tick();
    expect(tr.snapshot().roles.ops?.workingMs).toBe(90_000);
  });

  it('counts tools by category when the tool changes, and messages sent to others', () => {
    const { tr } = harness();
    tr.apply(snap(party('w1', [member('p1', 'implementer', 'working'), member('p2', 'coordinator', 'working')])));
    tr.apply(mem('w1', member('p1', 'implementer', 'working', { tool: 'Edit' })));
    tr.apply(mem('w1', member('p1', 'implementer', 'working', { tool: 'Edit' })));
    tr.apply(mem('w1', member('p1', 'implementer', 'working')));
    tr.apply(mem('w1', member('p1', 'implementer', 'working', { tool: 'Bash' })));
    tr.apply({ t: 0, kind: 'say', partyId: 'w1', paneId: 'p2', text: 'secret text', to: { partyId: 'w1', paneId: 'p1' } });
    tr.apply({ t: 0, kind: 'say', partyId: 'w1', paneId: 'p2', text: 'to nobody' });
    const s = tr.snapshot();
    expect(s.roles.implementer?.tools).toEqual({ edit: 1, shell: 1 });
    expect(s.roles.coordinator?.messages).toBe(1);
    expect(JSON.stringify(s)).not.toContain('secret');
  });

  it('members of one role share XP and level', () => {
    const { tr, advance } = harness({ roles: { implementer: { xp: 39 } } });
    tr.apply(snap(party('w1', [member('a', 'implementer', 'idle'), member('b', 'implementer', 'idle')])));
    tr.apply(mem('w1', member('a', 'implementer', 'working')));
    advance(10_000);
    const moments = tr.apply(mem('w1', member('a', 'implementer', 'done')));
    expect(moments).toHaveLength(1);
    expect(moments[0]).toMatchObject({ kind: 'moment', moment: 'level_up', partyId: 'w1', paneId: 'a', role: 'implementer', level: 2 });
    expect(tr.annotate(member('b', 'implementer', 'idle')).level).toBe(2);
    expect(tr.annotate(member('b', 'implementer', 'idle')).xp?.next).toBe(60);
  });
});

describe('quest completion', () => {
  const script = (dwell = QUEST_DWELL_MS) => {
    const h = harness();
    const ps = () => party('w1', []);
    void ps;
    h.tr.apply(snap(party('w1', [member('p1', 'coordinator', 'idle'), member('p2', 'implementer', 'idle')])));
    return { ...h, dwell };
  };
  const work = (h: ReturnType<typeof script>) => {
    h.tr.apply(mem('w1', member('p1', 'coordinator', 'working')));
    h.tr.apply(mem('w1', member('p2', 'implementer', 'working', { tool: 'Edit' })));
    h.advance(20_000);
  };
  const finish = (h: ReturnType<typeof script>) => {
    h.tr.apply(mem('w1', member('p2', 'implementer', 'done')));
    h.tr.apply(mem('w1', member('p1', 'coordinator', 'done')));
  };

  it('fires once after the party stays done for the dwell time, with a recap', () => {
    const h = script();
    work(h);
    finish(h);
    h.advance(QUEST_DWELL_MS - 1);
    expect(h.tr.tick()).toEqual([]);
    h.advance(1);
    const moments = h.tr.tick();
    expect(moments).toHaveLength(1);
    const m = moments[0]!;
    expect(m).toMatchObject({ kind: 'moment', moment: 'quest_complete', partyId: 'w1' });
    if (m.kind !== 'moment') throw new Error();
    expect(m.recap).toMatchObject({ tasks: 2, blockedMs: 0, members: { coordinator: 1, implementer: 1 }, tools: { edit: 1 }, levelUps: [] });
    expect(m.recap!.durationMs).toBe(20_000);
    expect(m.recap!.xp).toBe(2 * XP.task + Math.floor(2 * (20_000 / 60_000) * XP.perMinute));
    h.advance(60_000);
    expect(h.tr.tick()).toEqual([]);
  });

  it('does not fire when someone starts working again before the dwell ends, and re-arms for the next run', () => {
    const h = script();
    work(h);
    finish(h);
    h.advance(QUEST_DWELL_MS - 2000);
    h.tr.apply(mem('w1', member('p2', 'implementer', 'working')));
    h.advance(20_000);
    expect(h.tr.tick()).toEqual([]);
    h.tr.apply(mem('w1', member('p2', 'implementer', 'done')));
    h.advance(QUEST_DWELL_MS);
    const first = h.tr.tick();
    expect(first.filter((d) => d.kind === 'moment' && d.moment === 'quest_complete')).toHaveLength(1);
    // Second run: re-armed.
    work(h);
    finish(h);
    h.advance(QUEST_DWELL_MS);
    expect(h.tr.tick().filter((d) => d.kind === 'moment' && d.moment === 'quest_complete')).toHaveLength(1);
  });

  it('an idle member does not hold the quest back, a blocked one does', () => {
    const h = harness();
    h.tr.apply(snap(party('w1', [member('o', 'orchestrator', 'idle'), member('p', 'implementer', 'working')])));
    h.advance(20_000);
    h.tr.apply(mem('w1', member('p', 'implementer', 'blocked')));
    h.advance(QUEST_DWELL_MS * 2);
    expect(h.tr.tick()).toEqual([]);
    h.tr.apply(mem('w1', member('p', 'implementer', 'working')));
    h.advance(20_000);
    h.tr.apply(mem('w1', member('p', 'implementer', 'done')));
    h.advance(QUEST_DWELL_MS);
    const [m] = h.tr.tick();
    expect(m).toMatchObject({ moment: 'quest_complete' });
    if (m?.kind === 'moment') expect(m.recap!.blockedMs).toBe(QUEST_DWELL_MS * 2);
  });

  it('work that finished nothing is no quest', () => {
    const h = script();
    h.tr.apply(mem('w1', member('p1', 'coordinator', 'working')));
    h.advance(1000);
    h.tr.apply(mem('w1', member('p1', 'coordinator', 'done')));
    h.advance(QUEST_DWELL_MS * 2);
    expect(h.tr.tick()).toEqual([]);
  });

  it('records level ups of the run in the recap', () => {
    const h = harness({ roles: { implementer: { xp: 30 } } });
    h.tr.apply(snap(party('w1', [member('p2', 'implementer', 'idle')])));
    h.tr.apply(mem('w1', member('p2', 'implementer', 'working')));
    h.advance(10_000);
    h.tr.apply(mem('w1', member('p2', 'implementer', 'done')));
    h.advance(QUEST_DWELL_MS);
    const [m] = h.tr.tick();
    if (m?.kind !== 'moment') throw new Error('no moment');
    expect(m.recap!.levelUps).toEqual([{ role: 'implementer', level: 2 }]);
  });
});

describe('normalizeStats', () => {
  it('drops junk and keeps good numbers', () => {
    const s = normalizeStats({ roles: { implementer: { xp: 12, tasks: -3, tools: { edit: 4, nope: 9 } }, wizard: { xp: 1 } }, lifetime: { tasks: 'x', quests: 2 }, extra: 'secret' });
    expect(s.roles.implementer).toEqual({ xp: 12, tasks: 0, workingMs: 0, blockedMs: 0, messages: 0, tools: { edit: 4 } });
    expect(Object.keys(s.roles)).toEqual(['implementer']);
    expect(s.lifetime).toEqual({ tasks: 0, quests: 2, workingMs: 0, blockedMs: 0, messages: 0 });
    expect(JSON.stringify(s)).not.toContain('secret');
    expect(normalizeStats('nonsense')).toEqual(normalizeStats(null));
  });
});
