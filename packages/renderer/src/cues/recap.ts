import type { Recap, Role, ToolCategory } from '@bellwether/adapter/core';

/** The quest-complete results window: a pure model (what to list) that the page turns into DOM. */

export const RECAP_SHOW_MS = 12_000;

export interface RecapRow {
  label: string;
  value: string;
  /** Rows the card highlights (the XP total). */
  accent?: boolean;
}

export interface RecapModel {
  title: string;
  /** The party's label, when known. */
  party?: string;
  rows: RecapRow[];
  /** Tool categories used, most used first. */
  tools: { category: ToolCategory; label: string; count: number }[];
  /** `Implementer reached Lv 4`, one per level gained. */
  levelUps: string[];
  /** Roles that took part, in a fixed order, for the portraits. */
  roles: Role[];
  /** One line for the alert toast. */
  compact: string;
}

const TOOL_LABELS: Record<ToolCategory, string> = { edit: 'Edits', read: 'Reads', search: 'Searches', shell: 'Commands', delegate: 'Hand-offs', plan: 'Plans', other: 'Other' };

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

/** `42s`, `4m 12s`, `1h 05m`. */
export function formatSpan(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, '0')}s`;
  return `${Math.floor(s / 3600)}h ${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}m`;
}

const ROLE_ORDER: Role[] = ['orchestrator', 'coordinator', 'architect', 'implementer', 'reviewer', 'researcher', 'writer', 'ops', 'generic'];

/** `1 coordinator, 2 implementers`. */
export function membersLine(members: Recap['members']): string {
  return ROLE_ORDER.filter((r) => (members[r] ?? 0) > 0)
    .map((r) => plural(members[r]!, r))
    .join(', ');
}

export function recapModel(recap: Recap, party?: string): RecapModel {
  const tools = (Object.entries(recap.tools) as [ToolCategory, number][])
    .filter(([, n]) => n > 0)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([category, count]) => ({ category, label: TOOL_LABELS[category], count }));
  const rows: RecapRow[] = [
    { label: 'Time', value: formatSpan(recap.durationMs) },
    { label: 'Party', value: membersLine(recap.members) || 'none' },
    { label: 'Tasks done', value: String(recap.tasks) },
    { label: 'Waiting on you', value: recap.blockedMs >= 1000 ? formatSpan(recap.blockedMs) : 'none' },
    { label: 'Experience', value: `+${recap.xp} XP`, accent: true },
  ];
  return {
    title: 'Quest complete',
    ...(party ? { party } : {}),
    rows,
    tools,
    roles: ROLE_ORDER.filter((r) => (recap.members[r] ?? 0) > 0),
    levelUps: recap.levelUps.map((l) => `${cap(l.role)} reached Lv ${l.level}`),
    compact: ['Quest complete', party, plural(recap.tasks, 'task'), `+${recap.xp} XP`].filter(Boolean).join(' · '),
  };
}

/**
 * Which card is showing and for how long. Pure: the page supplies the clock. A new recap replaces the one on screen;
 * a click or Esc dismisses it; it goes by itself after `RECAP_SHOW_MS`.
 */
export class RecapController {
  private current: { model: RecapModel; shownAt: number } | undefined;
  constructor(private readonly showMs = RECAP_SHOW_MS) {}

  show(model: RecapModel, now: number): void {
    this.current = { model, shownAt: now };
  }

  dismiss(): void {
    this.current = undefined;
  }

  /** The card to show at `now`, or undefined. */
  visible(now: number): RecapModel | undefined {
    if (this.current && now - this.current.shownAt >= this.showMs) this.current = undefined;
    return this.current?.model;
  }
}
