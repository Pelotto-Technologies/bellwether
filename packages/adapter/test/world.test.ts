import { describe, expect, it } from 'vitest';
import type { Member, Party, World } from '../src/types.js';
import { applyDelta, emptyWorld } from '../src/world.js';

const member = (paneId: string, status: Member['status']): Member => ({
  paneId,
  agent: 'claude',
  role: 'implementer',
  status,
  lastChange: 0,
});

const party = (id: string, members: Member[]): Party => ({
  id,
  label: id,
  isWorktree: false,
  status: 'unknown',
  members: Object.fromEntries(members.map((m) => [m.paneId, m])),
  tokens: {},
});

function seeded(): World {
  return applyDelta(emptyWorld(), {
    t: 0,
    kind: 'snapshot',
    world: { machine: 'local', parties: { w1: party('w1', [member('w1:p1', 'idle'), member('w1:p2', 'working')]) } },
  });
}

describe('applyDelta', () => {
  it('rolls up party status on snapshot', () => {
    expect(seeded().parties.w1?.status).toBe('working');
  });

  it('updates a member and recomputes the rollup', () => {
    const w = applyDelta(seeded(), { t: 1, kind: 'member', partyId: 'w1', member: member('w1:p1', 'blocked') });
    expect(w.parties.w1?.members['w1:p1']?.status).toBe('blocked');
    expect(w.parties.w1?.status).toBe('blocked');
  });

  it('does not mutate the previous world', () => {
    const before = seeded();
    applyDelta(before, { t: 1, kind: 'member', partyId: 'w1', member: member('w1:p1', 'blocked') });
    expect(before.parties.w1?.members['w1:p1']?.status).toBe('idle');
  });

  it('removes a member, then a whole party', () => {
    let w = applyDelta(seeded(), { t: 1, kind: 'removed', partyId: 'w1', paneId: 'w1:p2' });
    expect(Object.keys(w.parties.w1?.members ?? {})).toEqual(['w1:p1']);
    expect(w.parties.w1?.status).toBe('idle');
    w = applyDelta(w, { t: 2, kind: 'removed', partyId: 'w1' });
    expect(w.parties).toEqual({});
  });

  it('adds a party', () => {
    const w = applyDelta(seeded(), { t: 1, kind: 'party', party: party('w2', [member('w2:p1', 'done')]) });
    expect(w.parties.w2?.status).toBe('done');
  });

  it('sets say text on a member', () => {
    const w = applyDelta(seeded(), { t: 1, kind: 'say', partyId: 'w1', paneId: 'w1:p1', text: 'hi' });
    expect(w.parties.w1?.members['w1:p1']?.say).toBe('hi');
  });

  it('ignores deltas for unknown parties or panes', () => {
    const w = seeded();
    expect(applyDelta(w, { t: 1, kind: 'member', partyId: 'nope', member: member('x', 'done') })).toBe(w);
    expect(applyDelta(w, { t: 1, kind: 'removed', partyId: 'w1', paneId: 'nope' })).toBe(w);
    expect(applyDelta(w, { t: 1, kind: 'say', partyId: 'w1', paneId: 'nope', text: 'x' })).toBe(w);
  });
});
