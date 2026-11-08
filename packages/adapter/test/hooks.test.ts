import { appendFileSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createSource, loadSourceConfig, parseSourceConfig } from '../src/config.js';
import { defaultEventsFile, type HookEvent, HooksSource, hooksPartyId, normalizeCwd, parseHookEvent, subRole } from '../src/hooks/index.js';
import type { Delta, Party } from '../src/types.js';

const BASE = 1_800_000_000_000;
const FIXTURE = path.join(import.meta.dirname, 'fixtures', 'hooks', 'events.ndjson');
const PROJ = '/home/dev/proj';

let dir: string;
let file: string;
let clock: number;
let deltas: Delta[];
let source: HooksSource;

const line = (e: Partial<HookEvent> & Pick<HookEvent, 'ev' | 'session'>): string =>
  JSON.stringify({ v: 1, agent: 'claude', t: clock, cwd: PROJ, ...e }) + '\n';

function make(extra: Partial<ConstructorParameters<typeof HooksSource>[0]> = {}): HooksSource {
  deltas = [];
  source = new HooksSource({ file, now: () => clock, pollMs: 100_000, pruneMs: 100_000, machine: 'test', ...extra });
  source.on('delta', (d) => deltas.push(d));
  return source;
}

const party = (cwd = PROJ): Party | undefined => source.current[hooksPartyId(cwd)];

beforeEach(() => {
  dir = mkdtempSync(path.join(os.tmpdir(), 'bw-hooks-'));
  file = path.join(dir, 'events.jsonl');
  clock = BASE + 10_000;
});
afterEach(async () => {
  await source?.stop();
  rmSync(dir, { recursive: true, force: true });
});

describe('event parsing', () => {
  it('accepts a valid line and trims detail', () => {
    const e = parseHookEvent(JSON.stringify({ v: 1, t: 5, agent: 'claude', ev: 'tool', session: 's', detail: 'a\nb  c' }));
    expect(e).toMatchObject({ ev: 'tool', session: 's', detail: 'a b c' });
  });
  it('rejects malformed, unversioned and unknown lines', () => {
    for (const bad of ['', 'nope', '{', '[]', '{"v":2,"t":1,"ev":"tool","session":"s"}', '{"v":1,"t":1,"ev":"boom","session":"s"}', '{"v":1,"t":1,"ev":"tool"}']) {
      expect(parseHookEvent(bad)).toBeUndefined();
    }
  });
  it('defaults the file from BELLWETHER_EVENTS or home', () => {
    expect(defaultEventsFile({ BELLWETHER_EVENTS: '/x/e.jsonl' }, '/h')).toBe('/x/e.jsonl');
    expect(defaultEventsFile({}, '/h')).toBe(path.join('/h', '.bellwether', 'events.jsonl'));
  });
});

describe('party identity', () => {
  it('hashes Windows paths case- and slash-insensitively', () => {
    expect(hooksPartyId('C:\\Users\\Dev\\Repo')).toBe(hooksPartyId('c:/users/dev/repo/'));
    expect(hooksPartyId('/a/B')).not.toBe(hooksPartyId('/a/b'));
    expect(normalizeCwd('/a/b/')).toBe('/a/b');
  });
  it('maps subagent types to roles', () => {
    expect(subRole('Explore')).toBe('researcher');
    expect(subRole('Plan')).toBe('architect');
    expect(subRole('general-purpose')).toBe('implementer');
    expect(subRole('security-review')).toBe('reviewer');
    expect(subRole('code-reviewer')).toBe('reviewer');
    expect(subRole('statusline-setup')).toBe('generic');
    expect(subRole(undefined)).toBe('generic');
  });
});

describe('HooksSource folding and snapshot', () => {
  it('folds the fixture into a snapshot', async () => {
    writeFileSync(file, readFileSync(FIXTURE));
    clock = BASE + 20_000; // a1 stopped at +3.5s and has lingered out
    await make().start();
    expect(deltas).toHaveLength(1);
    const snap = deltas[0]!;
    expect(snap.kind).toBe('snapshot');
    if (snap.kind !== 'snapshot') return;
    expect(snap.world.machine).toBe('test');
    const proj = snap.world.parties[hooksPartyId(PROJ)]!;
    expect(proj.label).toBe('proj');
    expect(proj.isWorktree).toBe(false);
    expect(Object.keys(proj.members).sort()).toEqual(['s1', 's1:a2']);
    expect(proj.members.s1).toMatchObject({ agent: 'claude', role: 'orchestrator', status: 'working', title: 'Review the auth module' });
    expect(proj.members['s1:a2']).toMatchObject({ role: 'reviewer', status: 'working' });
    // Replayed history raises no bubbles.
    expect(proj.members.s1!.say).toBeUndefined();
    const wt = Object.values(snap.world.parties).find((p) => p.isWorktree)!;
    expect(wt.label).toBe('feat-login');
    expect(wt.members.s2).toMatchObject({ role: 'architect', status: 'blocked' });
    expect(wt.status).toBe('blocked');
  });

  it('emits an empty snapshot when the file is missing, then picks the file up', async () => {
    await make().start();
    expect(deltas.map((d) => d.kind)).toEqual(['snapshot']);
    appendFileSync(file, line({ ev: 'start', session: 'a' }));
    await source.poll();
    expect(deltas.map((d) => d.kind)).toEqual(['snapshot', 'party']);
  });

  it('skips malformed lines and events older than the lookback', async () => {
    writeFileSync(file, 'garbage\n' + line({ ev: 'start', session: 'old', t: clock - 13 * 3600_000 }) + '{"v":1\n' + line({ ev: 'start', session: 'new' }));
    await make().start();
    expect(Object.keys(party()!.members)).toEqual(['new']);
  });
});

describe('HooksSource tailing', () => {
  it('emits party before member, then member updates, then removal', async () => {
    await make().start();
    appendFileSync(file, line({ ev: 'start', session: 's' }));
    await source.poll();
    expect(deltas[1]).toMatchObject({ kind: 'party' });
    appendFileSync(file, line({ ev: 'tool', session: 's', tool: 'Edit', detail: 'Edit a.ts' }));
    await source.poll();
    expect(deltas[2]).toMatchObject({ kind: 'member', partyId: hooksPartyId(PROJ), member: { paneId: 's', status: 'working', title: 'Edit a.ts' } });
    expect(deltas[3]).toMatchObject({ kind: 'party' }); // rollup changed idle -> working
    appendFileSync(file, line({ ev: 'stop', session: 's' }));
    await source.poll();
    expect(party()!.members.s!.status).toBe('done');
    appendFileSync(file, line({ ev: 'end', session: 's' }));
    await source.poll();
    expect(deltas.at(-1)).toEqual({ t: clock, kind: 'removed', partyId: hooksPartyId(PROJ) });
    expect(party()).toBeUndefined();
  });

  it('removes only the member when the party still has others', async () => {
    await make().start();
    appendFileSync(file, line({ ev: 'start', session: 'a' }) + line({ ev: 'start', session: 'b' }));
    await source.poll();
    appendFileSync(file, line({ ev: 'end', session: 'a' }));
    await source.poll();
    expect(deltas.at(-1)).toMatchObject({ kind: 'removed', partyId: hooksPartyId(PROJ), paneId: 'a' });
  });

  it('holds a partial last line until it is completed', async () => {
    await make().start();
    const full = line({ ev: 'start', session: 'p' });
    appendFileSync(file, full.slice(0, 20));
    await source.poll();
    expect(deltas).toHaveLength(1);
    appendFileSync(file, full.slice(20));
    await source.poll();
    expect(party()!.members.p).toBeDefined();
  });

  it('handles multi-byte text split across reads', async () => {
    await make().start();
    const buf = Buffer.from(line({ ev: 'tool', session: 'm', tool: 'Bash', detail: 'echo héllo ✓' }));
    const cut = buf.indexOf(0xc3) + 1; // inside the two-byte "é"
    appendFileSync(file, buf.subarray(0, cut));
    await source.poll();
    appendFileSync(file, buf.subarray(cut));
    await source.poll();
    expect(party()!.members.m!.title).toBe('echo héllo ✓');
  });

  it('starts over when the file is truncated or rotated', async () => {
    await make().start();
    appendFileSync(file, line({ ev: 'start', session: 'a' }) + line({ ev: 'tool', session: 'a', detail: 'x'.repeat(50) }));
    await source.poll();
    // Rotation like the writer does it: old file moves aside, a fresh, shorter one appears.
    renameSync(file, file + '.1');
    writeFileSync(file, line({ ev: 'start', session: 'b' }));
    await source.poll();
    expect(party()!.members.b).toBeDefined();
    // Plain truncation.
    writeFileSync(file, line({ ev: 'start', session: 'c', cwd: '/p' }));
    await source.poll();
    expect(party('/p')!.members.c).toBeDefined();
  });
});

describe('statuses and bubbles', () => {
  it('maps events to statuses', async () => {
    await make().start();
    const status = () => party()!.members.s!.status;
    const send = async (ev: HookEvent['ev'], extra: Partial<HookEvent> = {}) => {
      appendFileSync(file, line({ ev, session: 's', ...extra }));
      await source.poll();
    };
    await send('start');
    expect(status()).toBe('idle');
    await send('prompt');
    expect(status()).toBe('working');
    await send('wait', { detail: 'needs permission' });
    expect(status()).toBe('blocked');
    await send('tool_done', { tool: 'Bash' });
    expect(status()).toBe('working');
    await send('stop');
    expect(status()).toBe('done');
  });

  it('raises a say on wait and on a delegating tool, not on plain tools', async () => {
    await make().start();
    appendFileSync(file, line({ ev: 'tool', session: 's', tool: 'Read', detail: 'Read a.ts' }));
    await source.poll();
    expect(deltas.some((d) => d.kind === 'say')).toBe(false);
    appendFileSync(file, line({ ev: 'tool', session: 's', tool: 'Task', detail: 'Explore the repo' }));
    await source.poll();
    expect(deltas.filter((d) => d.kind === 'say')).toEqual([{ t: clock, kind: 'say', partyId: hooksPartyId(PROJ), paneId: 's', text: 'Explore the repo' }]);
    appendFileSync(file, line({ ev: 'wait', session: 's', detail: 'Need approval' }));
    await source.poll();
    expect(deltas.filter((d) => d.kind === 'say').map((d) => (d as { text: string }).text)).toEqual(['Explore the repo', 'Need approval']);
  });
});

describe('subagents and roles', () => {
  it('runs a subagent through its lifecycle and promotes the parent to orchestrator', async () => {
    await make({ subLingerMs: 8000 }).start();
    appendFileSync(file, line({ ev: 'start', session: 's' }) + line({ ev: 'prompt', session: 's' }));
    await source.poll();
    expect(party()!.members.s!.role).toBe('generic');
    appendFileSync(file, line({ ev: 'sub_start', session: 's', sub: 'x1', subType: 'Explore' }));
    await source.poll();
    expect(party()!.members['s:x1']).toMatchObject({ role: 'researcher', status: 'working' });
    expect(party()!.members.s!.role).toBe('orchestrator');
    appendFileSync(file, line({ ev: 'tool', session: 's', sub: 'x1', subType: 'Explore', tool: 'Grep', detail: 'Grep foo' }));
    await source.poll();
    expect(party()!.members['s:x1']!.title).toBe('Grep foo');
    expect(party()!.members.s!.title).not.toBe('Grep foo');
    appendFileSync(file, line({ ev: 'sub_stop', session: 's', sub: 'x1', subType: 'Explore' }));
    await source.poll();
    expect(party()!.members['s:x1']!.status).toBe('done');
    expect(party()!.members.s!.role).toBe('generic');
    clock += 7000;
    source.tick();
    expect(party()!.members['s:x1']).toBeDefined();
    clock += 2000;
    source.tick();
    expect(party()!.members['s:x1']).toBeUndefined();
    expect(deltas).toContainEqual(expect.objectContaining({ kind: 'removed', paneId: 's:x1' }));
  });

  it('keeps an explicit role even with subagents, and skips a sub_start without an id', async () => {
    await make().start();
    appendFileSync(file, line({ ev: 'start', session: 's', role: 'reviewer' }) + line({ ev: 'sub_start', session: 's', subType: 'Plan' }) + line({ ev: 'sub_start', session: 's', sub: 'p', subType: 'Plan' }));
    await source.poll();
    expect(party()!.members.s!.role).toBe('reviewer');
    expect(Object.keys(party()!.members).sort()).toEqual(['s', 's:p']);
    expect(party()!.members['s:p']!.role).toBe('architect');
  });

  it('drops a session\'s subagents when it ends', async () => {
    await make().start();
    appendFileSync(file, line({ ev: 'start', session: 's' }) + line({ ev: 'sub_start', session: 's', sub: 'x' }));
    await source.poll();
    appendFileSync(file, line({ ev: 'end', session: 's' }));
    await source.poll();
    expect(party()).toBeUndefined();
  });
});

describe('staleness', () => {
  it('prunes silent sessions after 2h but keeps done ones', async () => {
    await make().start();
    appendFileSync(file, line({ ev: 'prompt', session: 'busy' }) + line({ ev: 'stop', session: 'finished' }));
    await source.poll();
    clock += 2 * 3600_000 + 1;
    source.tick();
    expect(Object.keys(party()!.members)).toEqual(['finished']);
  });

  it('prunes on startup', async () => {
    writeFileSync(file, line({ ev: 'prompt', session: 'stale', t: clock - 3 * 3600_000 }) + line({ ev: 'prompt', session: 'fresh', t: clock - 1000 }));
    await make().start();
    expect(Object.keys(party()!.members)).toEqual(['fresh']);
  });

  it('keeps a long-quiet session alive when new events arrive', async () => {
    await make().start();
    appendFileSync(file, line({ ev: 'prompt', session: 's' }));
    await source.poll();
    clock += 3600_000;
    appendFileSync(file, line({ ev: 'tool', session: 's', t: clock }));
    await source.poll();
    clock += 3600_000;
    source.tick();
    expect(party()!.members.s).toBeDefined();
  });
});

describe('config wiring', () => {
  it('parses source = "hooks" and [hooks] file', () => {
    expect(parseSourceConfig('source = "hooks"\n[hooks]\nfile = "/e.jsonl"\n')).toMatchObject({ source: 'hooks', hooks: { file: '/e.jsonl' } });
    expect(parseSourceConfig('source = "hooks"').hooks).toBeUndefined();
    expect(() => parseSourceConfig('source = "hooks"\n[hooks]\nfile = 3\n')).toThrow(/hooks.file/);
  });
  it('BELLWETHER_SOURCE=hooks and BELLWETHER_EVENTS override the file', async () => {
    const cfg = await loadSourceConfig('/nonexistent/bellwether.toml', { BELLWETHER_SOURCE: 'hooks', BELLWETHER_EVENTS: '/env.jsonl' });
    expect(cfg).toMatchObject({ source: 'hooks', hooks: { file: '/env.jsonl' } });
  });
  it('createSource builds a HooksSource on the configured file', () => {
    const s = createSource({ source: 'hooks', herdr: {}, hooks: { file: '/x.jsonl' } });
    expect(s).toBeInstanceOf(HooksSource);
    expect((s as HooksSource).file).toBe('/x.jsonl');
  });
});
