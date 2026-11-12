import { appendFileSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { parseSourceConfig } from '../src/config.js';
import type { PaneInfo } from '../src/herdr/protocol.js';
import { memberFromPane, diffParties, partiesFromSnapshot } from '../src/herdr/mapper.js';
import { HooksSource, hooksPartyId, parseHookEvent, type HookEvent } from '../src/hooks/index.js';
import { MockGenerator } from '../src/mock.js';
import { cleanPercent, cleanText } from '../src/sanitize.js';
import { scrubDelta } from '../src/scrub.js';
import type { Delta, Member, Party } from '../src/types.js';
import { loadSnapshot } from './mock-herdr.js';

const ch = (...codes: number[]) => String.fromCharCode(...codes);
const BASE = 1_800_000_000_000;
const PROJ = '/home/dev/proj';

describe('sanitizing', () => {
  it('strips control and bidi characters, collapses whitespace and caps length', () => {
    const dirty = `Op${ch(0)}us${ch(0x202e)} 5${ch(9)}.5${ch(0x2066)}${ch(0x2069)}  x${ch(0x85)}${ch(0x7f)}\n\ny`;
    expect(cleanText(dirty, 40)).toBe('Opus 5 .5 x y');
    expect(cleanText('a'.repeat(100), 16)).toBe('a'.repeat(16));
    expect(cleanText('  ', 10)).toBeUndefined();
    expect(cleanText(ch(0x202e), 10)).toBeUndefined();
    expect(cleanText(42, 10)).toBeUndefined();
  });
  it('clamps percentages and drops what is not a number', () => {
    expect(cleanPercent(88.4)).toBe(88);
    expect(cleanPercent(140)).toBe(100);
    expect(cleanPercent(-5)).toBe(0);
    expect(cleanPercent('73')).toBe(73);
    for (const bad of [NaN, Infinity, '', 'abc', null, undefined, {}, true]) expect(cleanPercent(bad)).toBeUndefined();
  });
});

describe('vitals event parsing', () => {
  const line = (extra: Record<string, unknown>) => JSON.stringify({ v: 1, t: 5, agent: 'claude', ev: 'vitals', session: 's', ...extra });

  it('accepts ctx, quota, model, effort and name', () => {
    expect(parseHookEvent(line({ ctx: 88, quota: 74, model: 'Opus 5.5', effort: 'high', name: 'Fix auth' }))).toMatchObject({ ev: 'vitals', ctx: 88, quota: 74, model: 'Opus 5.5', effort: 'high', name: 'Fix auth' });
  });
  it('sanitizes strings, caps lengths, clamps numbers and drops invalid ones', () => {
    const e = parseHookEvent(line({ ctx: 250, quota: 'lots', model: `M${ch(0x202e)}x${'y'.repeat(80)}`, effort: 'h'.repeat(40), name: `a${ch(0)}  b${'c'.repeat(200)}` }))!;
    expect(e.ctx).toBe(100);
    expect(e.quota).toBeUndefined();
    expect(e.model).toHaveLength(40);
    expect(e.model).not.toContain(ch(0x202e));
    expect(e.effort).toHaveLength(16);
    expect(e.name).toHaveLength(80);
    expect(e.name!.startsWith('a b')).toBe(true);
  });
  it('carries vitals fields only on vitals events', () => {
    const e = parseHookEvent(JSON.stringify({ v: 1, t: 5, ev: 'tool', session: 's', ctx: 50, model: 'x' }))!;
    expect(e.ctx).toBeUndefined();
    expect(e.model).toBeUndefined();
  });
});

describe('HooksSource applies vitals', () => {
  let dir: string;
  let file: string;
  let clock: number;
  let source: HooksSource;
  let deltas: Delta[];

  const write = (e: Partial<HookEvent> & Pick<HookEvent, 'ev' | 'session'>) => appendFileSync(file, JSON.stringify({ v: 1, agent: 'claude', t: clock, cwd: PROJ, ...e }) + '\n');
  const member = (id = 's1'): Member | undefined => source.current[hooksPartyId(PROJ)]?.members[id];

  beforeEach(async () => {
    dir = mkdtempSync(path.join(os.tmpdir(), 'bw-vitals-'));
    file = path.join(dir, 'events.jsonl');
    writeFileSync(file, '');
    clock = BASE + 10_000;
    deltas = [];
    source = new HooksSource({ file, now: () => clock, pollMs: 100_000, pruneMs: 100_000, machine: 'test' });
    source.on('delta', (d) => deltas.push(d));
    await source.start();
  });
  afterEach(async () => {
    await source.stop();
    rmSync(dir, { recursive: true, force: true });
  });

  it('puts vitals, model, effort and quest on the member without changing its status', async () => {
    write({ ev: 'start', session: 's1' });
    write({ ev: 'tool', session: 's1', tool: 'Bash', detail: 'Bash: ls' });
    await source.poll();
    expect(member()!.status).toBe('working');
    write({ ev: 'vitals', session: 's1', ctx: 88, quota: 74, model: 'Opus 5.5', effort: 'high', name: 'Fix auth' });
    await source.poll();
    expect(member()).toMatchObject({ status: 'working', vitals: { context: 88, quota: 74, at: clock }, model: 'Opus 5.5', effort: 'high', quest: 'Fix auth' });
    expect(deltas.some((d) => d.kind === 'member' && d.member.vitals?.context === 88)).toBe(true);
  });

  it('keeps earlier values a later event omits, and never invents absent ones', async () => {
    write({ ev: 'vitals', session: 's1', ctx: 60, model: 'Opus 5.5' });
    await source.poll();
    expect(member()!.vitals).toEqual({ context: 60, at: clock });
    write({ ev: 'vitals', session: 's1', quota: 40 });
    await source.poll();
    expect(member()).toMatchObject({ vitals: { context: 60, quota: 40 }, model: 'Opus 5.5' });
  });

  it('creates an idle session when vitals arrive before start, in the right party', async () => {
    write({ ev: 'vitals', session: 's9', ctx: 30 });
    await source.poll();
    expect(member('s9')).toMatchObject({ status: 'idle', vitals: { context: 30 } });
    write({ ev: 'start', session: 's9' });
    await source.poll();
    expect(member('s9')).toMatchObject({ status: 'idle', vitals: { context: 30 } });
  });

  it('sets tool while a tool runs and clears it on tool_done and stop', async () => {
    write({ ev: 'tool', session: 's1', tool: 'Edit', detail: 'Edit a.ts' });
    await source.poll();
    expect(member()!.tool).toBe('Edit');
    write({ ev: 'tool_done', session: 's1', tool: 'Edit', detail: 'Edit a.ts' });
    await source.poll();
    expect(member()!.tool).toBeUndefined();
    write({ ev: 'tool', session: 's1', tool: 'Bash', detail: 'Bash: ls' });
    write({ ev: 'stop', session: 's1' });
    await source.poll();
    expect(member()!.tool).toBeUndefined();
  });

  it('ignores a subagent tool for the session tool', async () => {
    write({ ev: 'start', session: 's1' });
    write({ ev: 'sub_start', session: 's1', sub: 'a1', subType: 'Explore' });
    write({ ev: 'tool', session: 's1', sub: 'a1', tool: 'Grep', detail: 'Grep x' });
    await source.poll();
    expect(member()!.tool).toBeUndefined();
  });
});

describe('Herdr pane tokens', () => {
  const pane = (tokens: Record<string, string>): PaneInfo => ({ pane_id: 'w1:p1', terminal_id: 't', workspace_id: 'w1', tab_id: 'w1:t1', focused: false, agent_status: 'working', revision: 7, agent: 'claude', tokens }) as PaneInfo;

  it('maps ctx, quota, model, effort and quest with the same validation', () => {
    const m = memberFromPane(pane({ ctx: '88', quota: '74.4', model: `Opus${ch(0x202e)} 5.5`, effort: 'high', quest: 'Fix  auth' }))!;
    expect(m.vitals).toEqual({ context: 88, quota: 74, at: 7 });
    expect(m).toMatchObject({ model: 'Opus 5.5', effort: 'high', quest: 'Fix auth' });
  });
  it('drops invalid numbers and leaves vitals absent when nothing is valid', () => {
    const m = memberFromPane(pane({ ctx: 'lots', quota: '', model: ch(0) }))!;
    expect(m.vitals).toBeUndefined();
    expect(m.model).toBeUndefined();
    expect(memberFromPane(pane({ ctx: '300' }))!.vitals!.context).toBe(100);
  });
  it('reports a member delta when only a vital changes', () => {
    const snap = loadSnapshot();
    const ctx = { session: 'default' };
    const base = partiesFromSnapshot(snap, ctx);
    const target = snap.panes.find((p) => p.agent)!;
    for (const a of snap.agents ?? []) if (a.pane_id === target.pane_id) a.tokens = { ...(a.tokens ?? {}), ctx: '55' };
    target.tokens = { ...(target.tokens ?? {}), ctx: '55' };
    const ds = diffParties(base, partiesFromSnapshot(snap, ctx), 1);
    expect(ds.map((d) => d.kind)).toEqual(['member']);
  });
});

describe('scrub', () => {
  it('drops the quest but keeps model, effort and numbers', () => {
    const m: Member = { paneId: 'p1', agent: 'claude', role: 'generic', status: 'working', quest: 'secret-quest', model: 'Opus 5.5', effort: 'high', vitals: { context: 50, quota: 60, at: 1 }, lastChange: 1 };
    const party: Party = { id: 'w1', label: 'l', isWorktree: false, status: 'working', members: { p1: m }, tokens: { quest: 'secret-quest' } };
    const out = JSON.stringify([scrubDelta({ t: 1, kind: 'member', partyId: 'w1', member: m }), scrubDelta({ t: 1, kind: 'party', party }), scrubDelta({ t: 1, kind: 'snapshot', world: { machine: 'm', parties: { w1: party } } })]);
    expect(out).not.toContain('secret-quest');
    expect(out).toContain('"model":"Opus 5.5"');
    expect(out).toContain('"context":50');
    expect(m.quest).toBe('secret-quest');
  });
});

describe('mock vitals', () => {
  it('gives claude agents drifting vitals, a model and a quest, and others none', () => {
    const g = new MockGenerator({ seed: 1 });
    g.initial(0);
    const all = () => Object.values(g.current.parties).flatMap((p) => Object.values(p.members));
    const claude = all().filter((m) => m.agent === 'claude');
    expect(claude.length).toBeGreaterThan(0);
    for (const m of claude) {
      expect(m.vitals!.context).toBeGreaterThanOrEqual(0);
      expect(m.vitals!.context).toBeLessThanOrEqual(100);
      expect(m.model).toBeTruthy();
      expect(m.effort).toBeTruthy();
    }
    for (const m of all().filter((x) => x.agent !== 'claude')) expect(m.vitals).toBeUndefined();
    expect(claude.some((m) => m.quest)).toBe(true);
    const before = claude.map((m) => m.vitals!.context).join();
    for (let i = 0; i < 200; i++) g.step(i);
    expect(all().filter((m) => m.agent === 'claude').map((m) => m.vitals!.context).join()).not.toBe(before);
    for (const m of all()) if (m.vitals) expect(m.vitals.context).toBeGreaterThanOrEqual(0);
  });
});

describe('config', () => {
  it('reads vitals = false and carries it only when false', () => {
    expect(parseSourceConfig('vitals = false').vitals).toBe(false);
    expect(parseSourceConfig('vitals = true').vitals).toBeUndefined();
    expect(() => parseSourceConfig('vitals = "no"')).toThrow(/vitals/);
  });
});
