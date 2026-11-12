import type { World } from '@bellwether/adapter/core';

/**
 * Where the user is in map mode: looking at the map (optionally zoomed on one party) or inside
 * a party's camp scene. A tiny pure state machine so the transitions are testable.
 */

export type Nav = { view: 'map'; focus?: string } | { view: 'camp'; party: string };

export type NavEvent =
  | { t: 'click'; party?: string | undefined }
  /** Double click on a camp, the panel's "Enter camp" button or Enter. */
  | { t: 'enter'; party: string }
  /** Esc or the Back button. */
  | { t: 'back' }
  /** The party no longer exists. */
  | { t: 'gone'; party: string };

export const MAP_HOME: Nav = { view: 'map' };

export function navReduce(nav: Nav, e: NavEvent): Nav {
  switch (e.t) {
    case 'click':
      return nav.view === 'map' ? (e.party ? { view: 'map', focus: e.party } : MAP_HOME) : nav;
    case 'enter':
      return { view: 'camp', party: e.party };
    case 'back':
      // Camp goes back to the map zoomed on that camp; a second Esc zooms out.
      return nav.view === 'camp' ? { view: 'map', focus: nav.party } : MAP_HOME;
    case 'gone':
      if (nav.view === 'camp' && nav.party === e.party) return MAP_HOME;
      if (nav.view === 'map' && nav.focus === e.party) return MAP_HOME;
      return nav;
  }
}

/**
 * Finds the party a `?party=` value names: its id, else its label, else its branch (ignoring case).
 * With no value, the first party that has members, by id. Undefined while the world is empty.
 */
export function resolveParty(world: World, key: string | null | undefined): string | undefined {
  const parties = Object.values(world.parties).sort((a, b) => a.id.localeCompare(b.id));
  const k = key?.trim().toLowerCase();
  if (!k) return (parties.find((p) => Object.keys(p.members).length) ?? parties[0])?.id;
  return (
    parties.find((p) => p.id.toLowerCase() === k) ??
    parties.find((p) => p.label.toLowerCase() === k) ??
    parties.find((p) => p.branch?.toLowerCase() === k)
  )?.id;
}
