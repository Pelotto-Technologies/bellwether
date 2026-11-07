import type { Member, Party, World } from '@bellwether/adapter/core';
import type { Camp } from './layout.js';

/**
 * Who a speaking member walks over to. Prefer a teammate in the same party; otherwise
 * a member of another party camped at the same settlement (nearest camp first).
 */
export function pickPartner(world: World, camps: Map<string, Camp>, partyId: string, paneId: string): { partyId: string; paneId: string } | undefined {
  const party = world.parties[partyId];
  if (!party || !party.members[paneId]) return undefined;
  const mates = Object.values(party.members)
    .filter((m) => m.paneId !== paneId)
    .sort((a, b) => a.paneId.localeCompare(b.paneId));
  if (mates.length) return { partyId, paneId: mates[stableIndex(paneId, mates.length)]!.paneId };

  const mine = camps.get(partyId);
  if (!mine) return undefined;
  const neighbours = Object.values(world.parties)
    .filter((p) => p.id !== partyId && Object.keys(p.members).length > 0 && camps.get(p.id)?.settlementKey === mine.settlementKey)
    .sort((a, b) => dist(camps.get(a.id)!, mine) - dist(camps.get(b.id)!, mine) || a.id.localeCompare(b.id));
  const other = neighbours[0];
  if (!other) return undefined;
  const members = Object.values(other.members).sort((a, b) => a.paneId.localeCompare(b.paneId));
  return { partyId: other.id, paneId: members[0]!.paneId };
}

function dist(a: Camp, b: Camp): number {
  return Math.hypot(a.tile.x - b.tile.x, a.tile.y - b.tile.y);
}

function stableIndex(s: string, n: number): number {
  let h = 0;
  for (const c of s) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return h % n;
}

/**
 * Inferred chatter (docs/PLAN.md §1 item 6): a member starting to work shortly after
 * a teammate finished reads as a hand-off. Returns the speech line, or undefined.
 */
export function inferHandoff(before: Party | undefined, after: Party, changed: Member, maxGapMs = 8000): { from: Member; text: string } | undefined {
  if (!before || changed.status !== 'working') return undefined;
  const prev = before.members[changed.paneId];
  if (prev && prev.status === 'working') return undefined;
  const from = Object.values(after.members)
    .filter((m) => m.paneId !== changed.paneId && (m.status === 'done' || m.status === 'idle') && changed.lastChange - m.lastChange >= 0 && changed.lastChange - m.lastChange <= maxGapMs)
    .sort((a, b) => b.lastChange - a.lastChange)[0];
  if (!from) return undefined;
  return { from, text: `Over to you, ${changed.role}` };
}
