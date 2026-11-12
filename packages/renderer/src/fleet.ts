import { rollup, STATUS_PRIORITY, STATUSES, type Member, type Party, type Status, type World } from '@bellwether/adapter/core';
import { ago } from './map/detail.js';
import { repoKey, settlementName } from './map/layout.js';

/**
 * The fleet: one master agent over many projects. Everything here is derived from the world, and with no member
 * marked `scope: 'fleet'` every function is the identity, so a world without a fleet draws exactly as it always did.
 */

export interface FleetLead {
  /** The workspace the lead's pane lives in (its speech is keyed by it). */
  partyId: string;
  member: Member;
}

/** Whether a member is a fleet lead. The adapter only sets `scope` on orchestrators, but the renderer checks too. */
export function isFleetLead(m: Pick<Member, 'scope' | 'role'>): boolean {
  return m.scope === 'fleet' && m.role === 'orchestrator';
}

/** Every fleet lead in stable id order: the first is "the" lead that journeys treat as home. */
export function fleetLeads(world: World): FleetLead[] {
  return Object.values(world.parties)
    .sort((a, b) => a.id.localeCompare(b.id))
    .flatMap((p) =>
      Object.values(p.members)
        .filter(isFleetLead)
        .sort((a, b) => a.paneId.localeCompare(b.paneId))
        .map((member) => ({ partyId: p.id, member })),
    );
}

export function hasFleet(world: World): boolean {
  return Object.values(world.parties).some((p) => Object.values(p.members).some(isFleetLead));
}

/** A party without its fleet leads, rolled up again; the same object when it holds none. */
export function withoutFleet(p: Party): Party {
  if (!Object.values(p.members).some(isFleetLead)) return p;
  const members = Object.fromEntries(Object.entries(p.members).filter(([, m]) => !isFleetLead(m)));
  return { ...p, members, status: rollup(Object.values(members)) };
}

/**
 * Lifts the fleet leads out of every party. A party left with no members (the fleet workspace) is dropped, so it never
 * becomes a settlement or a camp. Returns the very same world when there is no fleet.
 */
export function splitFleet(world: World): { world: World; leads: FleetLead[] } {
  const leads = fleetLeads(world);
  if (!leads.length) return { world, leads };
  const parties: Record<string, Party> = {};
  for (const p of Object.values(world.parties)) {
    const kept = withoutFleet(p);
    if (Object.keys(kept.members).length > 0 || kept === p) parties[p.id] = kept;
  }
  return { world: { ...world, parties }, leads };
}

export interface SettlementStatus {
  /** The repo key the map places the settlement by. */
  key: string;
  name: string;
  /** The worst status of any member of any party of the repo, by the party rollup's own precedence. */
  status: Status;
  parties: number;
  agents: number;
  counts: Partial<Record<Status, number>>;
}

/**
 * Per settlement, the worst member status across all its parties (the project node, the coordinators and the leaves).
 * It is the party rollup applied one level up, never a second precedence: idle and unknown never outrank working, done
 * or blocked, so a long-idle coordinator or an idle project node does not make a settlement look busy.
 */
export function settlementStatuses(world: World): SettlementStatus[] {
  const byRepo = new Map<string, Party[]>();
  for (const p of Object.values(world.parties)) byRepo.set(repoKey(p), [...(byRepo.get(repoKey(p)) ?? []), p]);
  return [...byRepo]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([key, parties]) => {
      const members = parties.flatMap((p) => Object.values(p.members));
      const counts: Partial<Record<Status, number>> = {};
      for (const m of members) counts[m.status] = (counts[m.status] ?? 0) + 1;
      return { key, name: settlementName(key), status: rollup(members), parties: parties.length, agents: members.length, counts };
    });
}

/** The fleet's colour: the worst settlement. No settlements is `unknown`. */
export function fleetRollup(statuses: Pick<SettlementStatus, 'status'>[]): Status {
  return rollup(statuses);
}

/** The hub beacon shows the worse of the fleet and the lead's own status, so a lead waiting on the person is never hidden by calm camps. */
export function hubBeacon(fleet: Status, leads: FleetLead[]): Status {
  return rollup([{ status: fleet }, ...leads.map((l) => ({ status: l.member.status }))]);
}

/** Settlement name by party id, for alerts: the same grouping the map uses. */
export function settlementOf(p: Party): string {
  return settlementName(repoKey(p));
}

/** `1 blocked · 2 working · 1 idle`, worst first. */
export function countsLine(counts: Partial<Record<Status, number>>): string {
  return [...STATUSES]
    .filter((s) => counts[s])
    .sort((a, b) => STATUS_PRIORITY[b] - STATUS_PRIORITY[a])
    .map((s) => `${counts[s]} ${s}`)
    .join(' · ');
}

export interface FleetDetail {
  title: string;
  subtitle: string;
  /** The beacon colour. */
  status: Status;
  leads: { paneId: string; label: string; status: Status; line: string }[];
  settlements: { key: string; name: string; status: Status; line: string }[];
}

/** Text for the hub's panel: who leads, and one line per settlement. Pure. */
export function describeFleet(world: World, leads: FleetLead[], now: number): FleetDetail {
  const stat = settlementStatuses(world);
  const status = hubBeacon(fleetRollup(stat), leads);
  const agents = stat.reduce((n, s) => n + s.agents, 0);
  return {
    title: 'Fleet',
    subtitle: `${stat.length} ${stat.length === 1 ? 'project' : 'projects'} · ${agents} ${agents === 1 ? 'agent' : 'agents'}`,
    status,
    leads: leads.map((l) => ({
      paneId: l.member.paneId,
      label: l.member.name ? `${l.member.name} · fleet lead` : 'Fleet lead',
      status: l.member.status,
      line: l.member.say ?? l.member.title ?? `${l.member.status} for ${ago(now - l.member.lastChange)}`,
    })),
    settlements: stat.map((s) => ({ key: s.key, name: s.name, status: s.status, line: countsLine(s.counts) || 'no agents' })),
  };
}
