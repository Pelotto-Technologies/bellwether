import type { Member } from '@bellwether/adapter/core';
import { LOW_CONTEXT } from '../sim.js';

/** What a member is doing at its station in the camp scene. Pure: no Pixi, no art. */

export const ACTIVITIES = ['edit', 'read', 'shell', 'search', 'delegate', 'think', 'blocked', 'done', 'idle', 'unknown'] as const;
export type Activity = (typeof ACTIVITIES)[number];

/** Activities that come from a running tool, in the order they are tried. */
interface Rule {
  activity: Activity;
  /** Whole lower-cased names that match (short names that would match too much as substrings). */
  exact?: string[];
  /** Lower-cased fragments that match anywhere in the name. */
  has?: string[];
}

const RULES: Rule[] = [
  { activity: 'think', has: ['todo', 'plan', 'think'] },
  { activity: 'delegate', has: ['task', 'agent', 'delegate', 'dispatch'] },
  { activity: 'shell', exact: ['sh', 'zsh', 'cmd'], has: ['bash', 'shell', 'terminal', 'exec', 'command'] },
  { activity: 'edit', has: ['edit', 'write', 'patch', 'replace', 'create_file'] },
  { activity: 'search', has: ['search', 'fetch', 'browse', 'http', 'web'] },
  { activity: 'read', exact: ['ls', 'cat', 'head', 'tail'], has: ['read', 'grep', 'glob', 'view', 'list', 'find', 'open'] },
];

/** Maps a tool name (Claude Code, Copilot CLI, MCP, ...) to an activity. Unknown names fall back to `think`. */
export function toolActivity(tool: string | undefined): Activity {
  const name = tool?.trim().toLowerCase();
  if (!name) return 'think';
  for (const r of RULES) if (r.exact?.includes(name) || r.has?.some((h) => name.includes(h))) return r.activity;
  return 'think';
}

/** Status poses win over tools; a working member shows its tool, or paces while thinking. */
export function activityOf(m: Pick<Member, 'status' | 'tool'>): Activity {
  switch (m.status) {
    case 'blocked':
      return 'blocked';
    case 'done':
      return 'done';
    case 'idle':
      return 'idle';
    case 'unknown':
      return 'unknown';
    case 'working':
      return toolActivity(m.tool);
  }
}

const LABELS: Record<Activity, string> = {
  edit: 'Hammering',
  read: 'Reading',
  shell: 'Tinkering',
  search: 'Scouting',
  delegate: 'Giving orders',
  think: 'Thinking',
  blocked: 'Needs you',
  done: 'Resting',
  idle: 'Dozing',
  unknown: 'Waiting',
};

/** A short word for the panel: `Hammering · Edit`. */
export function activityLabel(m: Pick<Member, 'status' | 'tool'>): string {
  const a = activityOf(m);
  return a !== 'blocked' && a !== 'done' && a !== 'idle' && a !== 'unknown' && m.tool ? `${LABELS[a]} · ${m.tool}` : LABELS[a];
}

/** Whether the member's context is nearly spent: it droops and sweats at its station. */
export function isTired(m: Pick<Member, 'vitals'>): boolean {
  const c = m.vitals?.context;
  return c !== undefined && c < LOW_CONTEXT;
}

/** Activities where the member sits on a log instead of standing at a station prop. */
export function sits(a: Activity): boolean {
  return a === 'done' || a === 'idle' || a === 'unknown';
}
