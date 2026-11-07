import type { Party } from '@bellwether/adapter/core';

/** Text for the zoomed "see the session" panel. Pure so it can be tested. */

export interface DetailRow {
  paneId: string;
  role: string;
  status: string;
  agent: string;
  line: string;
}

export interface Detail {
  title: string;
  subtitle: string;
  status: string;
  rows: DetailRow[];
}

export function describeParty(p: Party, settlement: string, beaconRole: string, now: number): Detail {
  const members = Object.values(p.members).sort((a, b) => (a.role === beaconRole ? -1 : 0) - (b.role === beaconRole ? -1 : 0) || a.paneId.localeCompare(b.paneId));
  return {
    title: p.label,
    subtitle: [settlement, p.branch, p.isWorktree ? 'worktree' : undefined].filter(Boolean).join(' · '),
    status: p.status,
    rows: members.map((m) => ({
      paneId: m.paneId,
      role: m.role,
      status: m.status,
      agent: m.agent,
      // The latest line we know: speech, then pane title, then how long it has been in this state.
      line: m.say ?? m.title ?? `${m.status} for ${ago(now - m.lastChange)}`,
    })),
  };
}

export function ago(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  return `${Math.floor(s / 3600)}h`;
}
