import type { Member, Party, Role, World } from '@bellwether/adapter/core';
import { describe, expect, it } from 'vitest';
import { assignTints, groupFellowships, mixHex, pickFollower, TINTS } from '../src/fellowship.js';

const member = (paneId: string, role: Role = 'implementer'): Member => ({ paneId, agent: 'claude', role, status: 'idle', lastChange: 0 });
const party = (id: string, repo: string | undefined, members: Member[], session = 'default'): Party => ({
  id,
  label: id,
  session,
  ...(repo ? { repo } : {}),
  isWorktree: true,
  status: 'idle',
  members: Object.fromEntries(members.map((m) => [m.paneId, m])),
  tokens: {},
});
const worldOf = (...ps: Party[]): World => ({ machine: 'local', parties: Object.fromEntries(ps.map((p) => [p.id, p])) });

describe('groupFellowships', () => {
  it('with leadAlone, a lone orchestrator still leads its repo (map mode stands it at the settlement)', () => {
    const w = worldOf(party('default/w1', 'api', [member('p1', 'orchestrator')]));
    expect(groupFellowships(w).fellowships).toHaveLength(0);
    const v = groupFellowships(w, { leadAlone: true });
    expect(Object.keys(v.world.parties)).toEqual([]);
    expect(v.fellowships).toHaveLength(1);
    expect(v.fellowships[0]!.leaders[0]!.partyId).toBe('default/w1');
    expect(v.fellowships[0]!.partyIds).toEqual([]);
    // Cached separately from the default grouping.
    expect(groupFellowships(w).fellowships).toHaveLength(0);
  });

  it('lifts an orchestrator out of its own party to lead the repo it works in', () => {
    const w = worldOf(
      party('default/w1', 'api', [member('p1', 'orchestrator')]),
      party('default/w2', 'api', [member('p2'), member('p3', 'reviewer')]),
      party('default/w3', 'api', [member('p4')]),
    );
    const v = groupFellowships(w);
    expect(Object.keys(v.world.parties).sort()).toEqual(['default/w2', 'default/w3']);
    expect(v.fellowships).toHaveLength(1);
    expect(v.fellowships[0]!.leaders.map((l) => l.member.paneId)).toEqual(['p1']);
    expect(v.fellowships[0]!.leaders[0]!.partyId).toBe('default/w1');
    expect(v.fellowships[0]!.partyIds).toEqual(['default/w2', 'default/w3']);
    expect(v.byParty.get('default/w2')).toBe(v.fellowships[0]);
  });

  it('keeps the rest of a mixed party when only its orchestrator is lifted out', () => {
    const w = worldOf(party('default/w1', 'api', [member('p1', 'orchestrator'), member('p2')]), party('default/w2', 'api', [member('p3')]));
    const v = groupFellowships(w);
    expect(Object.keys(v.world.parties['default/w1']!.members)).toEqual(['p2']);
    expect(v.fellowships[0]!.partyIds).toEqual(['default/w1', 'default/w2']);
  });

  it('leaves a lone orchestrator, and orchestrators of other repos or sessions, alone', () => {
    const w = worldOf(
      party('default/w1', 'api', [member('p1', 'orchestrator')]),
      party('default/w2', 'docs', [member('p2')]),
      party('other/w1', 'api', [member('p3')], 'other'),
    );
    const v = groupFellowships(w);
    expect(v.fellowships).toHaveLength(0);
    expect(Object.keys(v.world.parties)).toHaveLength(3);
  });

  it('ties a group to a repo even when each repo has a path-style name', () => {
    const w = worldOf(party('a', '/r/api', [member('1', 'orchestrator')]), party('b', '/r/api', [member('2')]));
    expect(groupFellowships(w).fellowships[0]!.name).toBe('api');
  });

  it('gives every worktree under one orchestrator its own tint', () => {
    const ws = Array.from({ length: 3 }, (_, i) => party(`default/w${i + 2}`, 'api', [member(`a${i}`), member(`b${i}`), member(`c${i}`)]));
    const v = groupFellowships(worldOf(party('default/w1', 'api', [member('o', 'orchestrator')]), ...ws));
    const tints = ws.map((p) => v.tints.get(p.id));
    expect(tints.every(Boolean)).toBe(true);
    expect(new Set(tints).size).toBe(3);
  });

  it('tints sibling worktrees without an orchestrator, but not a party that stands alone', () => {
    const v = groupFellowships(worldOf(party('a', 'api', [member('1')]), party('b', 'api', [member('2')]), party('c', 'docs', [member('3')])));
    expect(v.tints.has('a')).toBe(true);
    expect(v.tints.has('b')).toBe(true);
    expect(v.tints.has('c')).toBe(false);
  });

  it('is stable: the same world gives the same tints, in any party order', () => {
    const ps = ['a', 'b', 'c', 'd'].map((id) => party(id, 'api', [member(id + '1')]));
    const one = groupFellowships(worldOf(...ps)).tints;
    const two = groupFellowships(worldOf(...[...ps].reverse())).tints;
    expect([...one].sort()).toEqual([...two].sort());
  });

  it('returns the cached view for the same world object', () => {
    const w = worldOf(party('a', 'api', [member('1')]));
    expect(groupFellowships(w)).toBe(groupFellowships(w));
  });
});

describe('tints', () => {
  it('are all distinct until the palette runs out, then reuse', () => {
    const ids = Array.from({ length: TINTS.length }, (_, i) => `p${i}`);
    expect(new Set(assignTints(ids).values()).size).toBe(TINTS.length);
    const more = assignTints([...ids, 'extra']);
    expect(more.size).toBe(TINTS.length + 1);
  });

  it('mixHex blends two colours', () => {
    expect(mixHex('#000000', '#ffffff', 0.5)).toBe('#808080');
    expect(mixHex('#102030', '#102030', 0.7)).toBe('#102030');
  });

  it('pickFollower is stable and in range', () => {
    const f = { key: 'k', name: 'k', leaders: [], partyIds: ['a', 'b', 'c'] };
    expect(pickFollower(f, 'p1')).toBe(pickFollower(f, 'p1'));
    expect(f.partyIds).toContain(pickFollower(f, 'p9'));
    expect(pickFollower({ ...f, partyIds: [] }, 'p1')).toBeUndefined();
  });
});
