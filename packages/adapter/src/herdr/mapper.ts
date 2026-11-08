// Pure mapping from Herdr protocol records to the Bellwether world model.
import { isOrchestrationLabel, resolveRole } from '../roles.js';
import { rollup } from '../rollup.js';
import type { Delta, Member, Party, Status } from '../types.js';
import type { AgentInfo, AgentStatusChanged, PaneInfo, SessionSnapshot, WorkspaceInfo } from './protocol.js';

const STATUSES = new Set<Status>(['working', 'done', 'blocked', 'idle', 'unknown']);

export function toStatus(s: unknown): Status {
  return typeof s === 'string' && STATUSES.has(s as Status) ? (s as Status) : 'unknown';
}

/** Party ids are unique across sessions: `<session>/<workspace_id>`. */
export function partyId(session: string, workspaceId: string): string {
  return `${session}/${workspaceId}`;
}

export interface MapContext {
  session: string;
  /** Branch names learned from worktree events, keyed by workspace_id. */
  branches?: ReadonlyMap<string, string>;
}

export function memberFromPane(pane: PaneInfo | AgentInfo, orchestrationRoot = false): Member | undefined {
  if (!pane.agent) return undefined;
  const tokens = pane.tokens ?? {};
  const name = 'name' in pane ? pane.name : undefined;
  const seq = 'state_change_seq' in pane ? pane.state_change_seq : undefined;
  const m: Member = {
    paneId: pane.pane_id,
    agent: pane.agent,
    role: resolveRole({ tokens, agentName: name, title: pane.title, orchestrationRoot }),
    status: toStatus(pane.agent_status),
    lastChange: seq ?? pane.revision ?? 0,
  };
  if (pane.title) m.title = pane.title;
  if (tokens.say) m.say = tokens.say;
  return m;
}

export function partyFromWorkspace(ws: WorkspaceInfo, members: Record<string, Member>, ctx: MapContext): Party {
  const list = Object.values(members);
  const p: Party = {
    id: partyId(ctx.session, ws.workspace_id),
    label: ws.label,
    session: ctx.session,
    isWorktree: ws.worktree?.is_linked_worktree ?? false,
    status: list.length ? rollup(list) : toStatus(ws.agent_status),
    members,
    tokens: { ...(ws.tokens ?? {}) },
  };
  if (ws.worktree?.repo_name) p.repo = ws.worktree.repo_name;
  const branch = ctx.branches?.get(ws.workspace_id);
  if (branch) p.branch = branch;
  return p;
}

/** Trailing pane number of an id like `w1:p3`, for ordering panes within a workspace. */
function paneNumber(id: string): number {
  const m = /(\d+)\D*$/.exec(id);
  return m ? Number(m[1]) : Number.MAX_SAFE_INTEGER;
}

/**
 * The first pane (lowest pane number) of each workspace whose label marks it an
 * orchestration workspace. Its agent is the orchestrator unless told otherwise.
 */
export function orchestrationRoots(snap: SessionSnapshot): Set<string> {
  const out = new Set<string>();
  for (const ws of snap.workspaces) {
    if (!isOrchestrationLabel(ws.label)) continue;
    const panes = [...(snap.panes ?? []), ...(snap.agents ?? [])].filter((p) => p.workspace_id === ws.workspace_id).map((p) => p.pane_id);
    const first = [...new Set(panes)].sort((a, b) => paneNumber(a) - paneNumber(b) || a.localeCompare(b))[0];
    if (first) out.add(first);
  }
  return out;
}

/** Build every party for one session from `session.snapshot`. Agent records win over pane records. */
export function partiesFromSnapshot(snap: SessionSnapshot, ctx: MapContext): Record<string, Party> {
  const byWs = new Map<string, Record<string, Member>>();
  const seen = new Set<string>();
  const roots = orchestrationRoots(snap);
  for (const rec of [...(snap.agents ?? []), ...(snap.panes ?? [])]) {
    if (seen.has(rec.pane_id)) continue;
    const m = memberFromPane(rec, roots.has(rec.pane_id));
    if (!m) continue;
    seen.add(rec.pane_id);
    let ms = byWs.get(rec.workspace_id);
    if (!ms) byWs.set(rec.workspace_id, (ms = {}));
    ms[m.paneId] = m;
  }
  const out: Record<string, Party> = {};
  for (const ws of snap.workspaces) {
    // A workspace with no agents has nothing to show; it appears once an agent starts.
    const members = byWs.get(ws.workspace_id);
    if (!members) continue;
    const p = partyFromWorkspace(ws, members, ctx);
    out[p.id] = p;
  }
  return out;
}

/** Every pane id in the snapshot, for per-pane status subscriptions. */
export function paneIds(snap: SessionSnapshot): string[] {
  return [...new Set((snap.panes ?? []).map((p) => p.pane_id))].sort();
}

/**
 * Apply a `pane.agent_status_changed` event. Returns the updated party, or
 * undefined when the pane is not a known member (caller should re-read).
 */
export function applyStatusChange(
  parties: Record<string, Party>,
  ev: AgentStatusChanged,
  ctx: MapContext,
): { party: Party; member: Member; rollupChanged: boolean } | undefined {
  const party = parties[partyId(ctx.session, ev.workspace_id)];
  const prev = party?.members[ev.pane_id];
  // The agent left its pane (back to the shell): only a re-read can say what remains.
  if (!party || !prev || ev.agent === null) return undefined;
  const member: Member = { ...prev, status: toStatus(ev.agent_status), lastChange: prev.lastChange + 1 };
  if (ev.agent) member.agent = ev.agent;
  if (ev.title) member.title = ev.title;
  const members = { ...party.members, [member.paneId]: member };
  const status = rollup(Object.values(members));
  const next: Party = { ...party, members, status };
  return { party: next, member, rollupChanged: status !== party.status };
}

function sameMember(a: Member, b: Member): boolean {
  return a.agent === b.agent && a.role === b.role && a.status === b.status && a.title === b.title && a.say === b.say;
}

function samePartyHeader(a: Party, b: Party): boolean {
  return (
    a.label === b.label &&
    a.repo === b.repo &&
    a.branch === b.branch &&
    a.isWorktree === b.isWorktree &&
    a.status === b.status &&
    a.session === b.session &&
    JSON.stringify(a.tokens) === JSON.stringify(b.tokens)
  );
}

/** Deltas that turn `prev` into `next`. New parties and header changes send the whole party. */
export function diffParties(prev: Record<string, Party>, next: Record<string, Party>, t: number): Delta[] {
  const out: Delta[] = [];
  for (const id of Object.keys(prev)) if (!next[id]) out.push({ t, kind: 'removed', partyId: id });
  for (const [id, np] of Object.entries(next)) {
    const op = prev[id];
    if (!op) {
      out.push({ t, kind: 'party', party: np });
      for (const m of Object.values(np.members)) if (m.say) out.push({ t, kind: 'say', partyId: id, paneId: m.paneId, text: m.say });
      continue;
    }
    for (const paneId of Object.keys(op.members)) if (!np.members[paneId]) out.push({ t, kind: 'removed', partyId: id, paneId });
    for (const [paneId, nm] of Object.entries(np.members)) {
      const om = op.members[paneId];
      if (!om || !sameMember(om, nm)) out.push({ t, kind: 'member', partyId: id, member: nm });
      if (nm.say && nm.say !== om?.say) out.push({ t, kind: 'say', partyId: id, paneId, text: nm.say });
    }
    if (!samePartyHeader(op, np)) out.push({ t, kind: 'party', party: np });
  }
  return out;
}
