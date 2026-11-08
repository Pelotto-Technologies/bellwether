import { describe, expect, it } from 'vitest';
import { applyStatusChange, diffParties, paneIds, partiesFromSnapshot } from '../src/herdr/mapper.js';
import type { AgentStatusChanged } from '../src/herdr/protocol.js';
import path from 'node:path';
import { loadCapture, loadSnapshot, RESEARCH_FIXTURES } from './mock-herdr.js';

const ctx = { session: 'default' };

describe('partiesFromSnapshot', () => {
  const parties = partiesFromSnapshot(loadSnapshot(), ctx);

  it('makes one party per workspace with agents, keyed by session', () => {
    expect(Object.keys(parties).sort()).toEqual(['default/w1', 'default/w2']);
  });

  it('maps worktree provenance and tokens', () => {
    const p = parties['default/w1']!;
    expect(p).toMatchObject({ label: 'bellwether', repo: 'bellwether', isWorktree: true, session: 'default', tokens: { quest: 'adapter' } });
  });

  it('only panes with an agent become members', () => {
    expect(Object.keys(parties['default/w1']!.members)).toEqual(['w1:p3']);
    expect(parties['default/w3']).toBeUndefined();
  });

  it('reads role and say from tokens and state_change_seq from agents', () => {
    expect(parties['default/w1']!.members['w1:p3']).toEqual({
      paneId: 'w1:p3', agent: 'claude', role: 'architect', status: 'idle', title: 'adapter work', say: 'Mapping panes to members', lastChange: 12,
    });
  });

  it('falls back to a known role in the pane title, else generic; agent-agnostic', () => {
    const m = parties['default/w2']!.members['w2:p1']!;
    expect(m).toMatchObject({ agent: 'copilot', role: 'reviewer', status: 'blocked' });
  });

  it('rolls up worst member status', () => {
    expect(parties['default/w2']!.status).toBe('blocked');
  });

  it('applies learned worktree branches', () => {
    const ps = partiesFromSnapshot(loadSnapshot(), { session: 's', branches: new Map([['w1', 'feat/adapter']]) });
    expect(ps['s/w1']!.branch).toBe('feat/adapter');
  });

  it('lists every pane for status subscriptions', () => {
    expect(paneIds(loadSnapshot())).toEqual(['w1:p1', 'w1:p3', 'w2:p1', 'w3:p1']);
  });
});

describe('applyStatusChange over the recorded capture', () => {
  it('follows working then idle for the real claude pane', () => {
    let parties = partiesFromSnapshot(loadSnapshot(), ctx);
    const statuses: string[] = [];
    for (const line of loadCapture()) {
      if (line.event !== 'pane.agent_status_changed') continue;
      const res = applyStatusChange(parties, line.data as AgentStatusChanged, ctx)!;
      parties = { ...parties, [res.party.id]: res.party };
      statuses.push(`${res.member.status}/${res.party.status}/${res.rollupChanged}`);
    }
    expect(statuses).toEqual(['working/working/true', 'idle/idle/true']);
  });

  it('treats claude and copilot panes the same (mixed-agents fixture)', () => {
    let parties = partiesFromSnapshot(loadSnapshot(), ctx);
    const seen: string[] = [];
    for (const line of loadCapture(path.join(RESEARCH_FIXTURES, 'mixed-agents.events.ndjson'))) {
      if (line.event !== 'pane.agent_status_changed') continue;
      const res = applyStatusChange(parties, line.data as AgentStatusChanged, ctx)!;
      parties = { ...parties, [res.party.id]: res.party };
      seen.push(`${res.member.agent}:${res.member.status}`);
    }
    expect(seen).toEqual(['claude:working', 'copilot:working', 'copilot:blocked', 'claude:idle', 'copilot:working', 'copilot:done']);
    expect(parties['default/w1']!.status).toBe('idle');
    expect(parties['default/w2']!.status).toBe('done');
  });

  it('returns undefined for unknown panes so the caller re-reads', () => {
    const parties = partiesFromSnapshot(loadSnapshot(), ctx);
    expect(applyStatusChange(parties, { pane_id: 'w1:p1', workspace_id: 'w1', agent_status: 'working' }, ctx)).toBeUndefined();
  });
});

describe('diffParties', () => {
  const base = partiesFromSnapshot(loadSnapshot(), ctx);

  it('is empty when nothing changed', () => {
    expect(diffParties(base, partiesFromSnapshot(loadSnapshot(), ctx), 1)).toEqual([]);
  });

  it('reports removed panes and workspaces', () => {
    const snap = loadSnapshot();
    snap.workspaces = snap.workspaces.filter((w) => w.workspace_id !== 'w2');
    snap.agents = [];
    snap.panes = snap.panes.filter((p) => p.pane_id !== 'w1:p3' && p.workspace_id !== 'w2');
    const ds = diffParties(base, partiesFromSnapshot(snap, ctx), 1);
    expect(ds).toContainEqual({ t: 1, kind: 'removed', partyId: 'default/w2' });
    // w1's only agent is gone, so the workspace drops out as well.
    expect(ds).toContainEqual({ t: 1, kind: 'removed', partyId: 'default/w1' });
  });

  it('reports new members, say lines and party header changes', () => {
    const snap = loadSnapshot();
    snap.panes.push({ pane_id: 'w1:p4', terminal_id: 't9', workspace_id: 'w1', tab_id: 'w1:t1', focused: false, agent_status: 'working', revision: 1, agent: 'codex', tokens: { role: 'implementer', say: 'On it' } });
    snap.workspaces[0]!.label = 'bellwether-renamed';
    const ds = diffParties(base, partiesFromSnapshot(snap, ctx), 2);
    const kinds = ds.map((d) => d.kind);
    expect(kinds).toEqual(['member', 'say', 'party']);
    expect(ds[1]).toEqual({ t: 2, kind: 'say', partyId: 'default/w1', paneId: 'w1:p4', text: 'On it' });
  });
});

describe('orchestration workspaces', () => {
  function snap(label: string, panes: Array<{ id: string; agent?: string; tokens?: Record<string, string>; name?: string }>) {
    const base = loadSnapshot();
    const ws = { ...base.workspaces[0]!, workspace_id: 'w9', label };
    const recs = panes.map((p) => ({ ...base.panes[0]!, pane_id: p.id, workspace_id: 'w9', agent: p.agent ?? null, title: null, tokens: p.tokens ?? {} }));
    const agents = panes.filter((p) => p.agent).map((p) => ({ ...recs.find((r) => r.pane_id === p.id)!, name: p.name ?? null }));
    return { ...base, workspaces: [ws], panes: recs, agents };
  }

  it('makes the first pane of an "<repo> Orchestration" workspace the orchestrator', () => {
    const parties = partiesFromSnapshot(snap('bellwether Orchestration', [{ id: 'w9:p1', agent: 'copilot' }, { id: 'w9:p2', agent: 'claude' }]), ctx);
    const ms = parties['default/w9']!.members;
    expect(ms['w9:p1']!.role).toBe('orchestrator');
    expect(ms['w9:p2']!.role).toBe('generic');
  });

  it('counts pane 1 even before it has an agent, and leaves other workspaces alone', () => {
    const shellFirst = partiesFromSnapshot(snap('api Orchestration', [{ id: 'w9:p1' }, { id: 'w9:p2', agent: 'claude' }]), ctx);
    expect(shellFirst['default/w9']!.members['w9:p2']!.role).toBe('generic');
    const plain = partiesFromSnapshot(snap('api', [{ id: 'w9:p1', agent: 'claude' }]), ctx);
    expect(plain['default/w9']!.members['w9:p1']!.role).toBe('generic');
  });

  it('a role token or a role name still wins', () => {
    const parties = partiesFromSnapshot(snap('api orchestration', [{ id: 'w9:p1', agent: 'claude', tokens: { role: 'reviewer' } }]), ctx);
    expect(parties['default/w9']!.members['w9:p1']!.role).toBe('reviewer');
    const named = partiesFromSnapshot(snap('api orchestration', [{ id: 'w9:p1', agent: 'claude', name: 'architect' }]), ctx);
    expect(named['default/w9']!.members['w9:p1']!.role).toBe('architect');
  });
});

describe('agent leaving its pane', () => {
  it('asks for a re-read instead of keeping a stale member', () => {
    const parties = partiesFromSnapshot(loadSnapshot(), ctx);
    const ev = { pane_id: 'w1:p3', workspace_id: 'w1', agent_status: 'unknown', agent: null } as unknown as AgentStatusChanged;
    expect(applyStatusChange(parties, ev, ctx)).toBeUndefined();
  });
});

describe('messages between agents (say_to)', () => {
  function snap(tokens: Record<string, string>) {
    const s = loadSnapshot();
    s.agents = s.agents.map((a) => (a.pane_id === 'w2:p1' ? { ...a, name: 'impl' } : a.pane_id === 'w1:p3' ? { ...a, tokens: { role: 'architect', ...tokens } } : a));
    s.panes = s.panes.map((p) => (p.pane_id === 'w1:p3' ? { ...p, tokens: { role: 'architect', ...tokens } } : p));
    return s;
  }

  it('resolves the target by agent name or pane id, across workspaces', () => {
    expect(partiesFromSnapshot(snap({ say: 'Fix it', say_to: 'impl', say_id: 'a' }), ctx)['default/w1']!.members['w1:p3']).toMatchObject({ say: 'Fix it', sayTo: 'w2:p1', sayId: 'a' });
    expect(partiesFromSnapshot(snap({ say: 'Fix it', say_to: 'w2:p1' }), ctx)['default/w1']!.members['w1:p3']!.sayTo).toBe('w2:p1');
  });

  it('drops a say sent to a pane without an agent (a shell command, not chatter)', () => {
    const m = partiesFromSnapshot(snap({ say: 'npm test', say_to: 'w1:p1', say_id: 'a' }), ctx)['default/w1']!.members['w1:p3']!;
    expect(m.say).toBeUndefined();
    expect(m.sayTo).toBeUndefined();
  });

  it('emits a say delta addressed to the listener, again for a repeated line', () => {
    const a = partiesFromSnapshot(snap({ say: 'Fix it', say_to: 'impl', say_id: 'a' }), ctx);
    const b = partiesFromSnapshot(snap({ say: 'Fix it', say_to: 'impl', say_id: 'b' }), ctx);
    const base = partiesFromSnapshot(snap({}), ctx);
    expect(diffParties(base, a, 1).filter((d) => d.kind === 'say')).toEqual([
      { t: 1, kind: 'say', partyId: 'default/w1', paneId: 'w1:p3', text: 'Fix it', to: { partyId: 'default/w2', paneId: 'w2:p1' } },
    ]);
    expect(diffParties(a, b, 2).filter((d) => d.kind === 'say')).toHaveLength(1);
    expect(diffParties(a, a, 3)).toEqual([]);
  });
});
