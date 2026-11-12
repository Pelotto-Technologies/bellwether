import type { World } from '@bellwether/adapter/core';
import { isFleetLead } from '../fleet.js';
import { repoKey, type MapLayout } from './layout.js';
import { campNode, HUB_ID, settlementNode } from './roads.js';

/**
 * Where on the road network a member stands on the map: a fleet lead at the hub, an orchestrator (a project node) at its
 * settlement, anyone else at its party's camp. Undefined when the member or the place is not on the map.
 */
export function nodeOf(world: World, layout: Pick<MapLayout, 'camps' | 'hub'>, partyId: string, paneId: string): string | undefined {
  const party = world.parties[partyId];
  const m = party?.members[paneId];
  if (!party || !m) return undefined;
  if (isFleetLead(m)) return layout.hub ? HUB_ID : undefined;
  if (m.role === 'orchestrator') return settlementNode(repoKey(party));
  return layout.camps.has(partyId) ? campNode(partyId) : undefined;
}

export interface Address {
  partyId: string;
  paneId: string;
}

/**
 * Whether a message makes a journey: it goes to a member of another party, or to or from a fleet lead. A line between
 * two members of one party keeps the chatter it always had (the speaker walks over to the listener).
 */
export function isJourney(world: World, from: Address, to: Address): boolean {
  if (from.partyId === to.partyId && from.paneId === to.paneId) return false;
  const a = world.parties[from.partyId]?.members[from.paneId];
  const b = world.parties[to.partyId]?.members[to.paneId];
  if (!a || !b) return false;
  return from.partyId !== to.partyId || isFleetLead(a) || isFleetLead(b);
}
