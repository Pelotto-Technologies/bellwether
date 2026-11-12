/**
 * The world model the adapter emits. Mirrors docs/PLAN.md §2 with the generic
 * vocabulary: a Herdr workspace is a `Party`, a pane with an agent is a `Member`.
 */

export const STATUSES = ['working', 'done', 'blocked', 'idle', 'unknown'] as const;
export type Status = (typeof STATUSES)[number];

export const ROLES = [
  'orchestrator',
  'coordinator',
  'architect',
  'implementer',
  'reviewer',
  'researcher',
  'writer',
  'ops',
  'generic',
] as const;
export type Role = (typeof ROLES)[number];

export interface World {
  /** 'local' or a saved-machine label. */
  machine: string;
  parties: Record<string, Party>;
}

/** One Herdr workspace. */
export interface Party {
  /** Herdr workspace_id. */
  id: string;
  label: string;
  /** Herdr session the workspace lives in ('default' or a named session). */
  session?: string;
  repo?: string;
  branch?: string;
  isWorktree: boolean;
  /** Rollup of member statuses; see `rollup()`. */
  status: Status;
  members: Record<string, Member>;
  tokens: Record<string, string>;
}

/** One pane running an agent. */
export interface Member {
  paneId: string;
  /** Herdr's agent field: 'claude', 'copilot', 'codex', ... Never branched on outside the installer. */
  agent: string;
  role: Role;
  status: Status;
  title?: string;
  say?: string;
  /** Pane id the current `say` is addressed to, when it is a message to another agent. */
  sayTo?: string;
  /** Changes with every message, so a repeated line still raises a new bubble. */
  sayId?: string;
  /** Remaining percentages, 0-100. Absent when unknown; never estimated. */
  vitals?: { context?: number; quota?: number; at: number };
  /** Display name of the model, e.g. "Opus 5.5". At most 40 characters. */
  model?: string;
  /** Reasoning effort, e.g. "high". At most 16 characters. */
  effort?: string;
  /** The agent session's human name. At most 80 characters. */
  quest?: string;
  /** Name of the tool currently running: set on `tool`, cleared on `tool_done` and `stop`. Hooks source only for now. */
  tool?: string;
  lastChange: number;
}

export type Delta =
  | { t: number; kind: 'snapshot'; world: World }
  | { t: number; kind: 'member'; partyId: string; member: Member }
  | { t: number; kind: 'party'; party: Party }
  | { t: number; kind: 'removed'; partyId: string; paneId?: string }
  | { t: number; kind: 'say'; partyId: string; paneId: string; text: string; to?: { partyId: string; paneId: string } };

export function isStatus(value: unknown): value is Status {
  return typeof value === 'string' && (STATUSES as readonly string[]).includes(value);
}

export function isRole(value: unknown): value is Role {
  return typeof value === 'string' && (ROLES as readonly string[]).includes(value);
}
