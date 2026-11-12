import { createHash } from 'node:crypto';
import { appendFileSync, mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { diffParties, partiesFromSnapshot } from '../src/herdr/mapper.js';
import { type HookEvent, HooksSource, hooksPartyId, parseHookEvent } from '../src/hooks/index.js';
import { MockGenerator } from '../src/mock.js';
import { scrubDelta } from '../src/scrub.js';
import type { Delta, Party } from '../src/types.js';
import { loadSnapshot } from './mock-herdr.js';

const ctx = { session: 'default' };

/** The fixture snapshot plus a fleet workspace (one master agent) and a project node (a shell pane called `api`). */
function fleetSnapshot(masterTokens: Record<string, string> = { role: 'orchestrator', scope: 'fleet' }, say: Record<string, string> = {}) {
  const s = loadSnapshot();
  s.workspaces = [
    ...s.workspaces,
    { workspace_id: 'w8', number: 8, label: 'fleet', focused: false, pane_count: 1, tab_count: 1, active_tab_id: 'w8:t1', agent_status: 'idle' } as never,
    { workspace_id: 'w9', number: 9, label: 'api', focused: false, pane_count: 1, tab_count: 1, active_tab_id: 'w9:t1', agent_status: 'unknown' } as never,
  ];
  s.panes = [
    ...s.panes,
    { pane_id: 'w8:p1', terminal_id: 't8', workspace_id: 'w8', tab_id: 'w8:t1', focused: false, agent_status: 'idle', revision: 1, agent: 'claude', tokens: { ...masterTokens, ...say } } as never,
    { pane_id: 'w9:p1', terminal_id: 't9', workspace_id: 'w9', tab_id: 'w9:t1', focused: false, agent_status: 'unknown', revision: 1, agent: null, tokens: { role: 'orchestrator', name: 'api', state: 'working' } } as never,
  ];
  return s;
}

describe('scope=fleet token', () => {
  it('marks an orchestrator as the fleet lead', () => {
    const m = partiesFromSnapshot(fleetSnapshot(), ctx)['default/w8']!.members['w8:p1']!;
    expect(m).toMatchObject({ role: 'orchestrator', scope: 'fleet' });
  });

  it('is ignored for any other value and for any other role', () => {
    expect(partiesFromSnapshot(fleetSnapshot({ role: 'orchestrator', scope: 'team' }), ctx)['default/w8']!.members['w8:p1']).not.toHaveProperty('scope');
    expect(partiesFromSnapshot(fleetSnapshot({ role: 'reviewer', scope: 'fleet' }), ctx)['default/w8']!.members['w8:p1']).not.toHaveProperty('scope');
  });

  it('a change of scope is a member delta', () => {
    const a = partiesFromSnapshot(fleetSnapshot({ role: 'orchestrator' }), ctx);
    const b = partiesFromSnapshot(fleetSnapshot(), ctx);
    expect(diffParties(a, b, 1).filter((d) => d.kind === 'member')).toHaveLength(1);
  });
});

describe('say_to across workspaces', () => {
  it('reaches a project node by its name token, and the master by pane id', () => {
    const toNode = partiesFromSnapshot(fleetSnapshot(undefined, { say: 'Go ahead', say_to: 'api', say_id: '1' }), ctx);
    expect(toNode['default/w8']!.members['w8:p1']).toMatchObject({ say: 'Go ahead', sayTo: 'w9:p1' });
    const base = partiesFromSnapshot(fleetSnapshot(), ctx);
    expect(diffParties(base, toNode, 1).filter((d) => d.kind === 'say')).toEqual([
      { t: 1, kind: 'say', partyId: 'default/w8', paneId: 'w8:p1', text: 'Go ahead', to: { partyId: 'default/w9', paneId: 'w9:p1' } },
    ]);
  });

  it('a project node draws through the role opt-in, its status from the state token', () => {
    const node = partiesFromSnapshot(fleetSnapshot(), ctx)['default/w9']!.members['w9:p1']!;
    expect(node).toMatchObject({ role: 'orchestrator', status: 'working', name: 'api' });
    expect(node).not.toHaveProperty('scope');
  });
});

describe('hooks source: scope and to', () => {
  const BASE = 1_800_000_000_000;
  let dir: string;
  let file: string;
  let clock: number;
  let source: HooksSource;
  let deltas: Delta[];
  const line = (e: Partial<HookEvent> & Pick<HookEvent, 'ev' | 'session'>) => JSON.stringify({ v: 1, agent: 'x', t: clock, cwd: '/p/api', ...e }) + '\n';
  const party = (cwd: string): Party | undefined => source.current[hooksPartyId(cwd)];

  beforeEach(async () => {
    dir = mkdtempSync(path.join(os.tmpdir(), 'bw-fleet-'));
    file = path.join(dir, 'events.jsonl');
    clock = BASE;
    deltas = [];
    source = new HooksSource({ file, now: () => clock, pollMs: 100_000, pruneMs: 100_000 });
    source.on('delta', (d) => deltas.push(d));
    await source.start();
  });
  afterEach(async () => {
    await source.stop();
    rmSync(dir, { recursive: true, force: true });
  });

  it('parses scope and to, and drops what does not apply', () => {
    expect(parseHookEvent(JSON.stringify({ v: 1, t: 1, ev: 'start', session: 's', role: 'orchestrator', scope: 'fleet' }))).toMatchObject({ scope: 'fleet' });
    expect(parseHookEvent(JSON.stringify({ v: 1, t: 1, ev: 'start', session: 's', scope: 'team' }))).not.toHaveProperty('scope');
    expect(parseHookEvent(JSON.stringify({ v: 1, t: 1, ev: 'prompt', session: 's', to: 'o' }))).toMatchObject({ to: 'o' });
    expect(parseHookEvent(JSON.stringify({ v: 1, t: 1, ev: 'stop', session: 's', to: 'o' }))).not.toHaveProperty('to');
  });

  it('marks the lead only together with role orchestrator', async () => {
    appendFileSync(file, line({ ev: 'start', session: 'lead', cwd: '/fleet', role: 'orchestrator', scope: 'fleet' }) + line({ ev: 'start', session: 'imp', role: 'implementer', scope: 'fleet' }));
    await source.poll();
    expect(party('/fleet')!.members.lead).toMatchObject({ role: 'orchestrator', scope: 'fleet' });
    expect(party('/p/api')!.members.imp).not.toHaveProperty('scope');
  });

  it('turns `to` into a say addressed to that session, in another party', async () => {
    appendFileSync(file, line({ ev: 'start', session: 'lead', cwd: '/fleet', role: 'orchestrator', scope: 'fleet' }) + line({ ev: 'start', session: 'node', role: 'orchestrator' }));
    await source.poll();
    deltas.length = 0;
    appendFileSync(file, line({ ev: 'prompt', session: 'lead', cwd: '/fleet', to: 'node', detail: 'Ship the fix' }));
    await source.poll();
    expect(deltas.filter((d) => d.kind === 'say')).toEqual([
      { t: clock, kind: 'say', partyId: hooksPartyId('/fleet'), paneId: 'lead', text: 'Ship the fix', to: { partyId: hooksPartyId('/p/api'), paneId: 'node' } },
    ]);
  });

  it('works on wait and tool too, and a blocked member keeps its bubble addressed', async () => {
    appendFileSync(file, line({ ev: 'start', session: 'lead', cwd: '/fleet', role: 'orchestrator', scope: 'fleet' }) + line({ ev: 'start', session: 'imp' }));
    await source.poll();
    deltas.length = 0;
    appendFileSync(file, line({ ev: 'wait', session: 'imp', to: 'lead', detail: 'Which login flow?' }));
    await source.poll();
    expect(deltas.find((d) => d.kind === 'say')).toMatchObject({ text: 'Which login flow?', to: { paneId: 'lead' } });
    expect(party('/p/api')!.members.imp!.status).toBe('blocked');
    deltas.length = 0;
    appendFileSync(file, line({ ev: 'tool', session: 'imp', tool: 'Edit', to: 'lead', detail: 'Edited auth.ts' }));
    await source.poll();
    expect(deltas.find((d) => d.kind === 'say')).toMatchObject({ to: { paneId: 'lead' } });
  });

  it('an unknown session, or oneself, gives a plain bubble', async () => {
    appendFileSync(file, line({ ev: 'start', session: 'a' }));
    await source.poll();
    deltas.length = 0;
    appendFileSync(file, line({ ev: 'prompt', session: 'a', to: 'nobody', detail: 'Hello' }));
    await source.poll();
    const say = deltas.find((d) => d.kind === 'say')!;
    expect(say).toMatchObject({ text: 'Hello' });
    expect(say).not.toHaveProperty('to');
    deltas.length = 0;
    appendFileSync(file, line({ ev: 'prompt', session: 'a', to: 'a', detail: 'Self' }));
    await source.poll();
    expect(deltas.find((d) => d.kind === 'say')).not.toHaveProperty('to');
  });
});

describe('scrub with a fleet', () => {
  it('hashes project names and drops names and text; adds nothing identifying', () => {
    const parties = partiesFromSnapshot(fleetSnapshot(undefined, { say: 'secret plan for acme', say_to: 'api', say_id: '1' }), ctx);
    const world = { machine: 'secret-host', parties };
    const snap = scrubDelta({ t: 1, kind: 'snapshot', world });
    const say = scrubDelta({ t: 2, kind: 'say', partyId: 'default/w8', paneId: 'w8:p1', text: 'secret plan for acme', to: { partyId: 'default/w9', paneId: 'w9:p1' } });
    const text = JSON.stringify([snap, say]);
    for (const leak of ['secret', 'acme', '"api"', '"label":"fleet"', '"name"']) expect(text).not.toContain(leak);
    // Structure the renderer needs survives: ids, role, scope and the address.
    expect(text).toContain('"scope":"fleet"');
    expect(say).toMatchObject({ text: '', to: { partyId: 'default/w9', paneId: 'w9:p1' } });
  });
});

describe('mock fleet', () => {
  const run = (opts: ConstructorParameters<typeof MockGenerator>[0], steps: number) => {
    const g = new MockGenerator(opts);
    const out: Delta[] = [g.initial(0)];
    for (let i = 1; i <= steps; i++) {
      out.push(g.step(i * 1500));
      out.push(...g.takeExtra());
    }
    return out;
  };

  it('without the fleet the mock is exactly what it was before (80 steps hash to the pre-fleet value)', () => {
    const g = new MockGenerator({ seed: 1, fleet: false });
    const ds: Delta[] = [g.initial(0)];
    for (let i = 1; i <= 80; i++) ds.push(g.step(i * 1500));
    expect(createHash('sha1').update(JSON.stringify(ds)).digest('hex')).toBe('0b535afc534b4e9509978ad2a38ec7e730d22866');
    expect(g.takeExtra()).toEqual([]);
    expect(JSON.stringify(ds)).not.toContain('"scope"');
  });

  it('with the fleet there is one lead in a repo-less workspace, and project nodes', () => {
    const first = run({ seed: 1 }, 0)[0]!;
    if (first.kind !== 'snapshot') throw new Error('snapshot expected');
    const parties = Object.values(first.world.parties);
    const leads = parties.flatMap((p) => Object.values(p.members)).filter((m) => m.scope === 'fleet');
    expect(leads).toHaveLength(1);
    expect(leads[0]).toMatchObject({ role: 'orchestrator', name: 'Fleet lead' });
    const home = parties.find((p) => leads[0]!.paneId in p.members)!;
    expect(home.repo).toBeUndefined();
    expect(Object.keys(home.members)).toEqual([leads[0]!.paneId]);
    const nodes = parties.flatMap((p) => Object.values(p.members)).filter((m) => m.role === 'orchestrator' && m.scope !== 'fleet' && m.name);
    expect(nodes.map((m) => m.name).sort()).toEqual(['api', 'docs', 'infra']);
  });

  it('is deterministic', () => {
    expect(JSON.stringify(run({ seed: 1 }, 120))).toBe(JSON.stringify(run({ seed: 1 }, 120)));
  });

  it('scripts the lead: a line to a project, one escalation that blocks it briefly, one send to three projects at once', () => {
    const ds = run({ seed: 1 }, 100);
    const says = ds.filter((d): d is Extract<Delta, { kind: 'say' }> => d.kind === 'say' && d.to !== undefined);
    const fromLead = says.filter((d) => d.paneId === 'w8:p1');
    // A periodic line, and the three at once share one timestamp.
    expect(fromLead[0]).toMatchObject({ to: { partyId: 'w1', paneId: 'w1:p1' } });
    const burst = fromLead.filter((d) => d.t === fromLead.find((x, i) => i > 0 && fromLead[i + 2]?.t === x.t)?.t);
    expect(new Set(burst.map((d) => d.to!.partyId))).toEqual(new Set(['w1', 'w9', 'w10']));
    const esc = says.filter((d) => d.paneId === 'w2:p1');
    expect(esc).toHaveLength(1);
    expect(esc[0]!.to).toEqual({ partyId: 'w8', paneId: 'w8:p1' });
    const leadStates = ds.filter((d) => d.kind === 'member' && d.member.paneId === 'w8:p1').map((d) => (d.kind === 'member' ? d.member.status : ''));
    expect(leadStates).toEqual(['blocked', 'working']);
    // The random walk never touches the fleet's own workspaces.
    expect(ds.some((d) => d.kind === 'member' && ['w9', 'w10'].includes(d.partyId))).toBe(false);
  });

  it('scrubbed, a mock fleet leaks no project name, lead name or line', () => {
    const first = run({ seed: 1 }, 0)[0]!;
    const text = JSON.stringify(scrubDelta(first));
    for (const leak of ['Fleet lead', '"docs"', '"infra"', '"api"', '"label":"fleet"', 'auth-refresh']) expect(text).not.toContain(leak);
    const sayAddr = scrubDelta({ t: 1, kind: 'say', partyId: 'w8', paneId: 'w8:p1', text: 'Hold the deploy for now', to: { partyId: 'w1', paneId: 'w1:p1' } });
    expect(JSON.stringify(sayAddr)).not.toContain('deploy');
  });
});
