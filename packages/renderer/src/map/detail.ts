import type { Party } from '@bellwether/adapter/core';
import { modelLine } from '../vitals.js';

/** Text for the zoomed "see the session" panel. Pure so it can be tested. */

export interface DetailRow {
  paneId: string;
  role: string;
  status: string;
  agent: string;
  line: string;
  /** `Opus 5.5 · high`, when the agent reports a model. */
  model?: string;
  /** Percent remaining, when reported. */
  context?: number;
  quota?: number;
  quest?: string;
}

export interface Detail {
  title: string;
  subtitle: string;
  status: string;
  rows: DetailRow[];
}

export function describeParty(p: Party, settlement: string, beaconRole: string, now: number, vitals = true): Detail {
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
      ...(vitals ? vitalRow(m) : {}),
    })),
  };
}

function vitalRow(m: Party['members'][string]): Pick<DetailRow, 'model' | 'context' | 'quota' | 'quest'> {
  const model = modelLine(m);
  return {
    ...(model ? { model } : {}),
    ...(m.vitals?.context !== undefined ? { context: m.vitals.context } : {}),
    ...(m.vitals?.quota !== undefined ? { quota: m.vitals.quota } : {}),
    ...(m.quest ? { quest: m.quest } : {}),
  };
}

export function ago(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  return `${Math.floor(s / 3600)}h`;
}
