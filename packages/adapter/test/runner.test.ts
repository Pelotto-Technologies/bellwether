// What a runner that draws into Herdr relies on: agent-less panes, the `hide`, `state` and `name` tokens,
// and the finished-leaf rule. Fixture-shaped records only; no live Herdr.
import { describe, expect, it } from 'vitest';
import { applyStatusChange, diffParties, memberFromPane, partiesFromSnapshot, settledStatus, settleFinished } from '../src/herdr/mapper.js';
import type { PaneInfo, SessionSnapshot } from '../src/herdr/protocol.js';
import { rollup } from '../src/rollup.js';
import type { Member } from '../src/types.js';
import { scrubParty } from '../src/scrub.js';
import { loadSnapshot } from './mock-herdr.js';

const ctx = { session: 'default' };

function pane(id: string, over: Partial<PaneInfo> = {}): PaneInfo {
  return { pane_id: id, terminal_id: `t-${id}`, workspace_id: 'w1', tab_id: 'w1:t1', focused: false, agent_status: 'idle', revision: 1, agent: 'copilot', ...over };
}

/** A linked-worktree workspace: a coordinator, a runner shell pane (no agent) and two leaves. */
function runnerSnapshot(panes: PaneInfo[], linked = true): SessionSnapshot {
  const base = loadSnapshot();
  return {
    ...base,
    workspaces: [{ workspace_id: 'w1', number: 1, label: '142-fix-login (runner)', focused: false, pane_count: panes.length, tab_count: 2, active_tab_id: 'w1:t1', agent_status: 'idle', worktree: { repo_key: 'api', repo_name: 'api', repo_root: '/r/api', checkout_path: '/r/api-wt/142', is_linked_worktree: linked } }],
    panes,
    agents: panes.filter((p) => p.agent),
  };
}

describe('panes without an agent', () => {
  it('a plain shell pane is not a member, with or without other tokens', () => {
    expect(memberFromPane(pane('w1:p1', { agent: null, agent_status: 'unknown' }))).toBeUndefined();
    expect(memberFromPane(pane('w1:p1', { agent: null, agent_status: 'unknown', tokens: { name: 'Shell', say: 'hi', state: 'done' } }))).toBeUndefined();
    // Not a role either: a typo does not opt the pane in.
    expect(memberFromPane(pane('w1:p1', { agent: null, tokens: { role: 'wizard' } }))).toBeUndefined();
  });

  it('the recorded snapshot already ignores its agent-less panes', () => {
    const parties = partiesFromSnapshot(loadSnapshot(), ctx);
    expect(Object.keys(parties['default/w1']!.members)).toEqual(['w1:p3']);
    expect(parties['default/w3']).toBeUndefined();
  });

  it('a `role` token opts a shell pane in', () => {
    const m = memberFromPane(pane('w1:p1', { agent: null, agent_status: 'unknown', tokens: { role: 'ops' } }))!;
    expect(m).toMatchObject({ paneId: 'w1:p1', role: 'ops', status: 'unknown', agent: 'shell' });
  });

  it('a workspace holding only a plain shell shows no party; the opted-in one does', () => {
    const shellOnly = runnerSnapshot([pane('w1:p1', { agent: null, agent_status: 'unknown' })]);
    expect(partiesFromSnapshot(shellOnly, ctx)).toEqual({});
    const tagged = runnerSnapshot([pane('w1:p1', { agent: null, agent_status: 'unknown', tokens: { role: 'ops' } })]);
    expect(Object.keys(partiesFromSnapshot(tagged, ctx)['default/w1']!.members)).toEqual(['w1:p1']);
  });
});

describe('hide token', () => {
  it('removes an agent pane, and an opted-in shell pane', () => {
    expect(memberFromPane(pane('w1:p2', { tokens: { role: 'reviewer', hide: '1' } }))).toBeUndefined();
    expect(memberFromPane(pane('w1:p2', { agent: null, tokens: { role: 'ops', hide: 'true' } }))).toBeUndefined();
  });
  it('other values leave the pane alone', () => {
    expect(memberFromPane(pane('w1:p2', { tokens: { hide: '0' } }))).toBeDefined();
    expect(memberFromPane(pane('w1:p2', { tokens: { hide: '' } }))).toBeDefined();
  });
  it('a party whose every pane is hidden disappears', () => {
    const snap = runnerSnapshot([pane('w1:p2', { tokens: { hide: '1' } })]);
    expect(partiesFromSnapshot(snap, ctx)).toEqual({});
  });
});

describe('state token', () => {
  const m = (state: string | undefined, status: PaneInfo['agent_status'] = 'idle') => memberFromPane(pane('w1:p2', { agent_status: status, tokens: { role: 'reviewer', ...(state !== undefined ? { state } : {}) } }))!;

  it('overrides the status Herdr derived', () => {
    expect(m('done')).toMatchObject({ status: 'done', statusFromToken: true });
    expect(m('working', 'idle').status).toBe('working');
    expect(m('blocked', 'working').status).toBe('blocked');
    expect(m('idle', 'working').status).toBe('idle');
    expect(m(' DONE ').status).toBe('done');
  });
  it('ignores anything else, `unknown` included', () => {
    for (const bad of ['unknown', 'finished', '', 'done please']) expect(m(bad)).toMatchObject({ status: 'idle' });
    expect(m(undefined).statusFromToken).toBeUndefined();
  });
  it('is not undone by a Herdr status event, and not settled', () => {
    const snap = runnerSnapshot([pane('w1:p2', { agent_status: 'idle', tokens: { role: 'reviewer', state: 'done' } })]);
    const parties = partiesFromSnapshot(snap, ctx);
    const res = applyStatusChange(parties, { pane_id: 'w1:p2', workspace_id: 'w1', agent_status: 'working' }, ctx)!;
    expect(res.member.status).toBe('done');
  });
});

describe('name token', () => {
  it('is cleaned and capped at 40 characters', () => {
    expect(memberFromPane(pane('w1:p2', { tokens: { name: '  Ada‮  Lovelace\n' } }))!.name).toBe('Ada Lovelace');
    expect(memberFromPane(pane('w1:p2', { tokens: { name: 'x'.repeat(60) } }))!.name).toBe('x'.repeat(40));
    expect(memberFromPane(pane('w1:p2', { tokens: { name: '   ' } }))!.name).toBeUndefined();
  });
  it('does not take Herdr display_agent, which holds the agent product name', () => {
    expect(memberFromPane(pane('w1:p2', { display_agent: 'Claude Code' }))!.name).toBeUndefined();
  });
  it('is part of the member diff and dropped by the scrub', () => {
    const before = partiesFromSnapshot(runnerSnapshot([pane('w1:p2')]), ctx);
    const after = partiesFromSnapshot(runnerSnapshot([pane('w1:p2', { tokens: { name: 'Quill' } })]), ctx);
    expect(diffParties(before, after, 1)).toEqual([expect.objectContaining({ kind: 'member', member: expect.objectContaining({ name: 'Quill' }) })]);
    expect(JSON.stringify(scrubParty(after['default/w1']!))).not.toContain('Quill');
  });
});

describe('finished leaves', () => {
  const m = (status: Member['status']) => ({ status });

  it('working then idle is done for a leaf in a worktree, and stays done', () => {
    expect(settledStatus(m('working'), 'idle', 'implementer', true)).toBe('done');
    expect(settledStatus(m('done'), 'idle', 'implementer', true)).toBe('done');
    expect(settledStatus(m('working'), 'working', 'implementer', true)).toBe('working');
    expect(settledStatus(m('done'), 'working', 'implementer', true)).toBe('working');
    expect(settledStatus(m('done'), 'blocked', 'implementer', true)).toBe('blocked');
  });
  it('never for a first sight, a plain workspace, or an orchestrator or coordinator', () => {
    expect(settledStatus(undefined, 'idle', 'implementer', true)).toBe('idle');
    expect(settledStatus(m('idle'), 'idle', 'implementer', true)).toBe('idle');
    expect(settledStatus(m('blocked'), 'idle', 'implementer', true)).toBe('idle');
    expect(settledStatus(m('working'), 'idle', 'implementer', false)).toBe('idle');
    expect(settledStatus(m('working'), 'idle', 'coordinator', true)).toBe('idle');
    expect(settledStatus(m('working'), 'idle', 'orchestrator', true)).toBe('idle');
  });

  it('through events then a re-read: the leaf stays done, the coordinator goes idle', () => {
    const panes = [
      pane('w1:p1', { tokens: { role: 'coordinator' }, agent_status: 'working' }),
      pane('w1:p2', { tokens: { role: 'implementer' }, agent_status: 'working' }),
    ];
    let parties = partiesFromSnapshot(runnerSnapshot(panes), ctx);
    for (const id of ['w1:p1', 'w1:p2']) {
      const res = applyStatusChange(parties, { pane_id: id, workspace_id: 'w1', agent_status: 'idle' }, ctx)!;
      parties = { ...parties, [res.party.id]: res.party };
    }
    expect(parties['default/w1']!.members['w1:p2']!.status).toBe('done');
    expect(parties['default/w1']!.members['w1:p1']!.status).toBe('idle');
    expect(parties['default/w1']!.status).toBe('done');
  });
});

describe('settleFinished over a re-read', () => {
  it('turns a leaf that was working into done, rolls the party up, and leaves the coordinator idle', () => {
    const at = (leaf: PaneInfo['agent_status']) => partiesFromSnapshot(runnerSnapshot([pane('w1:p1', { tokens: { role: 'coordinator' }, agent_status: 'idle' }), pane('w1:p2', { tokens: { role: 'implementer' }, agent_status: leaf })]), ctx);
    const working = settleFinished({}, at('working'));
    const idle = settleFinished(working, at('idle'));
    expect(idle['default/w1']!.members['w1:p2']!.status).toBe('done');
    expect(idle['default/w1']!.members['w1:p1']!.status).toBe('idle');
    expect(idle['default/w1']!.status).toBe('done');
    // And it stays done on the next re-read, until the leaf works again.
    expect(settleFinished(idle, at('idle'))['default/w1']!.members['w1:p2']!.status).toBe('done');
    expect(settleFinished(idle, at('working'))['default/w1']!.status).toBe('working');
  });
});

describe('a runner party: coordinator idle, leaves done', () => {
  it('rolls up to done, and an all-idle party to idle; an idle coordinator never lifts it to working or blocked', () => {
    expect(rollup([{ status: 'idle' }, { status: 'done' }, { status: 'done' }])).toBe('done');
    expect(rollup([{ status: 'idle' }, { status: 'idle' }, { status: 'unknown' }])).toBe('idle');
    const snap = runnerSnapshot([
      pane('w1:p1', { tokens: { role: 'coordinator' }, agent_status: 'idle' }),
      pane('w1:p2', { tokens: { role: 'implementer', state: 'done' }, agent_status: 'idle' }),
      pane('w1:p3', { tokens: { role: 'reviewer', state: 'done' }, agent_status: 'idle' }),
      pane('w1:p4', { agent: null, agent_status: 'unknown' }),
    ]);
    const p = partiesFromSnapshot(snap, ctx)['default/w1']!;
    expect(Object.keys(p.members)).toEqual(['w1:p1', 'w1:p2', 'w1:p3']);
    expect(p.members['w1:p1']!.status).toBe('idle');
    expect(p.status).toBe('done');
  });
});
