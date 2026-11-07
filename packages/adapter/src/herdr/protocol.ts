// Subset of the Herdr TUI socket protocol (protocol 22) that Bellwether reads.
// Source of truth: docs/research/herdr-api.schema.json.

export type AgentStatus = 'idle' | 'working' | 'blocked' | 'done' | 'unknown';

export interface WorkspaceWorktreeInfo {
  repo_key: string;
  repo_name: string;
  repo_root: string;
  checkout_path: string;
  is_linked_worktree: boolean;
}

export interface WorkspaceInfo {
  workspace_id: string;
  number: number;
  label: string;
  focused: boolean;
  pane_count: number;
  tab_count: number;
  active_tab_id: string;
  agent_status: AgentStatus;
  tokens?: Record<string, string>;
  worktree?: WorkspaceWorktreeInfo | null;
}

export interface PaneInfo {
  pane_id: string;
  terminal_id: string;
  workspace_id: string;
  tab_id: string;
  focused: boolean;
  agent_status: AgentStatus;
  revision: number;
  agent?: string | null;
  display_agent?: string | null;
  title?: string | null;
  label?: string | null;
  cwd?: string | null;
  state_labels?: Record<string, string>;
  tokens?: Record<string, string>;
}

export interface AgentInfo extends PaneInfo {
  name?: string | null;
  state_change_seq?: number;
}

export interface WorktreeInfo {
  branch?: string | null;
  path?: string;
  label?: string;
  open_workspace_id?: string | null;
  [k: string]: unknown;
}

export interface SessionSnapshot {
  version: string;
  protocol: number;
  workspaces: WorkspaceInfo[];
  tabs: unknown[];
  panes: PaneInfo[];
  layouts: unknown[];
  agents: AgentInfo[];
  focused_workspace_id?: string | null;
  focused_tab_id?: string | null;
  focused_pane_id?: string | null;
}

export interface Request {
  id: string;
  method: string;
  params: Record<string, unknown>;
}

export interface SuccessResponse {
  id: string;
  result: { type: string; [k: string]: unknown };
}

export interface ErrorResponse {
  id: string;
  error: { code: string; message: string };
}

/** Pushed on a subscription connection. Lifecycle kinds use underscores
 *  (`pane_closed`), subscription kinds use dots (`pane.agent_status_changed`). */
export interface EventLine {
  event: string;
  data: Record<string, unknown> & { type?: string };
}

export type Line = SuccessResponse | ErrorResponse | EventLine;

export function isEvent(l: Line): l is EventLine {
  return typeof (l as EventLine).event === 'string';
}
export function isError(l: Line): l is ErrorResponse {
  return typeof (l as ErrorResponse).error === 'object' && (l as ErrorResponse).error !== null;
}

export interface AgentStatusChanged {
  pane_id: string;
  workspace_id: string;
  agent_status: AgentStatus;
  agent?: string | null;
  display_agent?: string | null;
  title?: string | null;
  state_labels?: Record<string, string>;
}

/** Global lifecycle subscriptions. `pane.agent_status_changed` is per pane and
 *  is opened separately (PLAN §1 gotcha 1). */
export const LIFECYCLE_SUBSCRIPTIONS = [
  'workspace.created', 'workspace.updated', 'workspace.metadata_updated', 'workspace.renamed',
  'workspace.closed',
  'worktree.created', 'worktree.opened', 'worktree.removed',
  'tab.created', 'tab.closed',
  'pane.created', 'pane.closed', 'pane.updated', 'pane.moved', 'pane.exited', 'pane.agent_detected',
] as const;

export const AGENT_STATUS_CHANGED = 'pane.agent_status_changed';
