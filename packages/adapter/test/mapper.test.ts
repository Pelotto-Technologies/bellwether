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
