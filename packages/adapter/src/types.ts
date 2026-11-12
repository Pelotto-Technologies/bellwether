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

/** Git state of a party's folder; only present when the opt-in git probe is on. */
export interface GitState {
  /** Files with uncommitted changes, untracked ones included. */
  dirty: number;
  /** Commits not pushed to the upstream branch; 0 without an upstream. */
  ahead: number;
  /** The repository has no remote at all. */
  noRemote: boolean;
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
  /** Present only with the opt-in git probe, and only for parties on a local folder that is a repository. */
  git?: GitState;
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
  /** What the party calls this member ("Ada", "review-bot"): the `name` token or an event's `label`. At most 40 characters. Shown beside the role. */
  name?: string;
  /**
   * `fleet` marks the master of a whole fleet of projects (the `scope=fleet` token): it belongs to no repo, and the map
   * stands it at a hub of its own. Only ever set together with role `orchestrator`.
   */
  scope?: 'fleet';
  /** Set when a `state` token chose `status`, so Herdr's own status events do not undo it. */
  statusFromToken?: true;
  /** Name of the tool currently running: set on `tool`, cleared on `tool_done` and `stop`. Hooks source only for now. */
  tool?: string;
  /** Level of this member's ROLE (every implementer shares the implementer level). Present when the stats decorator is on. */
  level?: number;
  /** Progress inside the current level: `have` of `next` XP. Present with `level`. */
  xp?: { have: number; next: number };
  lastChange: number;
}

/** Coarse kinds of tool use, counted for the stats and the quest recap. Mapped from tool names by `toolCategory`. */
export const TOOL_CATEGORIES = ['edit', 'read', 'search', 'shell', 'delegate', 'plan', 'other'] as const;
export type ToolCategory = (typeof TOOL_CATEGORIES)[number];

/** A moment worth a flourish: a role levelled up, or a party finished its run of work. */
export type Moment = 'level_up' | 'quest_complete';

/** The results screen of a finished run: counters only, never text. */
export interface Recap {
  /** From the first member starting work to the last one finishing. */
  durationMs: number;
  /** Members of the party by role. */
  members: Partial<Record<Role, number>>;
  /** Tasks finished (working to done) during the run. */
  tasks: number;
  /** Time spent waiting on a person. */
  blockedMs: number;
  /** Tool uses by category. */
  tools: Partial<Record<ToolCategory, number>>;
  /** XP earned during the run, summed over members. */
  xp: number;
  /** Levels gained during the run, as the level each role reached. */
  levelUps: { role: Role; level: number }[];
}

export type Delta =
  | { t: number; kind: 'snapshot'; world: World }
  | { t: number; kind: 'member'; partyId: string; member: Member }
  | { t: number; kind: 'party'; party: Party }
  | { t: number; kind: 'removed'; partyId: string; paneId?: string }
  | { t: number; kind: 'say'; partyId: string; paneId: string; text: string; to?: { partyId: string; paneId: string } }
  | { t: number; kind: 'moment'; moment: Moment; partyId: string; paneId?: string; role?: Role; level?: number; recap?: Recap };

/** The only scope there is. */
export const FLEET_SCOPE = 'fleet' as const;

/** `scope=fleet` counts only for an orchestrator; any other value, or role, is ignored. */
export function fleetScope(scope: unknown, role: Role): 'fleet' | undefined {
  return role === 'orchestrator' && typeof scope === 'string' && scope.trim().toLowerCase() === FLEET_SCOPE ? FLEET_SCOPE : undefined;
}

export function isStatus(value: unknown): value is Status {
  return typeof value === 'string' && (STATUSES as readonly string[]).includes(value);
}

export function isRole(value: unknown): value is Role {
  return typeof value === 'string' && (ROLES as readonly string[]).includes(value);
}
