import type { Member } from '@bellwether/adapter/core';
import { LOW_CONTEXT } from './sim.js';

/** Pure helpers for drawing and describing agent vitals. No Pixi here. */

export function hasVitals(m: Member): boolean {
  return m.vitals?.context !== undefined || m.vitals?.quota !== undefined;
}

/** Whole pixels of a bar `width` wide that are filled for `pct` remaining; any non-zero amount shows at least one. */
export function barFill(pct: number | undefined, width: number): number {
  if (pct === undefined || !Number.isFinite(pct) || pct <= 0) return 0;
  return Math.max(1, Math.min(width, Math.round((pct / 100) * width)));
}

export function isLow(pct: number | undefined): boolean {
  return pct !== undefined && pct < LOW_CONTEXT;
}

/** The lowest context remaining among members that report one, for the group's walking pace. */
export function lowestContext(members: readonly Member[]): number | undefined {
  let low: number | undefined;
  for (const m of members) {
    const c = m.vitals?.context;
    if (c !== undefined && (low === undefined || c < low)) low = c;
  }
  return low;
}

/** The quest every member that has one shares, else undefined (members without a quest do not count against it). */
export function sharedQuest(members: readonly Member[]): string | undefined {
  let quest: string | undefined;
  for (const m of members) {
    if (!m.quest) continue;
    if (quest !== undefined && quest !== m.quest) return undefined;
    quest = m.quest;
  }
  return quest;
}

/** `workspace · branch — quest`: the nameplate text with the shared quest after the dash. */
export function withQuest(label: string, members: readonly Member[]): string {
  const quest = sharedQuest(members);
  return quest ? `${label} — ${quest}` : label;
}

/** `Opus 5.5 · high`, whatever of the two is known. */
export function modelLine(m: Pick<Member, 'model' | 'effort'>): string | undefined {
  const parts = [m.model, m.effort].filter((p): p is string => !!p);
  return parts.length ? parts.join(' · ') : undefined;
}
