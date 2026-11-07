import { rollup } from './rollup.js';
import type { Delta, Party, World } from './types.js';

export function emptyWorld(machine = 'local'): World {
  return { machine, parties: {} };
}

function withRollup(party: Party): Party {
  return { ...party, status: rollup(Object.values(party.members)) };
}

/**
 * Pure reducer: returns a new World with the delta applied. Unknown party or
 * pane ids are ignored rather than thrown on, because Herdr events and snapshots
 * share no sequence and can arrive slightly out of order.
 */
export function applyDelta(world: World, delta: Delta): World {
  switch (delta.kind) {
    case 'snapshot':
      return {
        ...delta.world,
        parties: Object.fromEntries(
          Object.entries(delta.world.parties).map(([id, p]) => [id, withRollup(p)]),
        ),
      };
    case 'party':
      return {
        ...world,
        parties: { ...world.parties, [delta.party.id]: withRollup(delta.party) },
      };
    case 'member': {
      const party = world.parties[delta.partyId];
      if (!party) return world;
      const members = { ...party.members, [delta.member.paneId]: delta.member };
      return {
        ...world,
        parties: { ...world.parties, [party.id]: withRollup({ ...party, members }) },
      };
    }
    case 'removed': {
      const party = world.parties[delta.partyId];
      if (!party) return world;
      if (delta.paneId === undefined) {
        const { [delta.partyId]: _gone, ...rest } = world.parties;
        return { ...world, parties: rest };
      }
      if (!party.members[delta.paneId]) return world;
      const { [delta.paneId]: _gone, ...members } = party.members;
      return {
        ...world,
        parties: { ...world.parties, [party.id]: withRollup({ ...party, members }) },
      };
    }
    case 'say': {
      const party = world.parties[delta.partyId];
      const member = party?.members[delta.paneId];
      if (!party || !member) return world;
      const members = { ...party.members, [member.paneId]: { ...member, say: delta.text } };
      return { ...world, parties: { ...world.parties, [party.id]: { ...party, members } } };
    }
  }
}

export function snapshotDelta(world: World, t = Date.now()): Delta {
  return { t, kind: 'snapshot', world };
}
