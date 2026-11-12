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
  if (tokens.say && tokens.say_id) m.sayId = tokens.say_id;
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

/**
 * Local folder of each party: the worktree checkout path Herdr reports, else the cwd of
 * the workspace's lowest-numbered agent pane. Only parties in `parties` get an entry.
 */
export function foldersFromSnapshot(snap: SessionSnapshot, parties: Record<string, Party>, ctx: MapContext): Record<string, string> {
  const out: Record<string, string> = {};
  const recs = [...(snap.agents ?? []), ...(snap.panes ?? [])].sort((a, b) => paneNumber(a.pane_id) - paneNumber(b.pane_id));
  for (const ws of snap.workspaces) {
    const id = partyId(ctx.session, ws.workspace_id);
    const party = parties[id];
    if (!party) continue;
    const cwd = recs.find((r) => r.workspace_id === ws.workspace_id && r.pane_id in party.members && r.cwd)?.cwd;
    const folder = ws.worktree?.checkout_path || cwd;
    if (folder) out[id] = folder;
  }
  return out;
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
  resolveSayTargets(snap, byWs);
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

/**
 * A message hook writes `say_to` as the sender typed the target: a pane id, an agent
 * name or a terminal id. Resolve it to a member's pane id. A `say` addressed to
 * something that is not an agent (`herdr pane run w1:p4 "npm test"` into a shell)
 * is not chatter, so it is dropped.
 */
function resolveSayTargets(snap: SessionSnapshot, byWs: Map<string, Record<string, Member>>): void {
  const members = new Set<string>();
  for (const ms of byWs.values()) for (const id of Object.keys(ms)) members.add(id);
  const records = [...(snap.agents ?? []), ...(snap.panes ?? [])].filter((r) => members.has(r.pane_id));
  const tokensOf = new Map<string, Record<string, string>>();
  for (const r of [...(snap.agents ?? []), ...(snap.panes ?? [])]) if (!tokensOf.has(r.pane_id)) tokensOf.set(r.pane_id, r.tokens ?? {});
  for (const ms of byWs.values()) {
    for (const m of Object.values(ms)) {
      const to = tokensOf.get(m.paneId)?.say_to;
      if (!to || !m.say) continue;
      const target = resolveTargetPane(to, records);
      if (target && target !== m.paneId) m.sayTo = target;
      else {
        delete m.say;
        delete m.sayId;
      }
    }
  }
}

export function resolveTargetPane(target: string, records: Array<PaneInfo | AgentInfo>): string | undefined {
  const t = target.trim();
  const lower = t.toLowerCase();
  return (
    records.find((r) => r.pane_id === t)?.pane_id ??
    records.find((r) => 'name' in r && typeof r.name === 'string' && r.name.toLowerCase() === lower)?.pane_id ??
    records.find((r) => r.terminal_id === t)?.pane_id
  );
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
  return a.agent === b.agent && a.role === b.role && a.status === b.status && a.title === b.title && a.say === b.say && a.sayId === b.sayId && a.sayTo === b.sayTo;
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
  const owner = new Map<string, string>();
  for (const p of Object.values(next)) for (const id of Object.keys(p.members)) owner.set(id, p.id);
  const say = (partyId: string, m: Member): Delta => {
    const d: Delta = { t, kind: 'say', partyId, paneId: m.paneId, text: m.say! };
    const toParty = m.sayTo && owner.get(m.sayTo);
    if (toParty) d.to = { partyId: toParty, paneId: m.sayTo! };
    return d;
  };
  for (const id of Object.keys(prev)) if (!next[id]) out.push({ t, kind: 'removed', partyId: id });
  for (const [id, np] of Object.entries(next)) {
    const op = prev[id];
    if (!op) {
      out.push({ t, kind: 'party', party: np });
      for (const m of Object.values(np.members)) if (m.say) out.push(say(id, m));
      continue;
    }
    for (const paneId of Object.keys(op.members)) if (!np.members[paneId]) out.push({ t, kind: 'removed', partyId: id, paneId });
    for (const [paneId, nm] of Object.entries(np.members)) {
      const om = op.members[paneId];
      if (!om || !sameMember(om, nm)) out.push({ t, kind: 'member', partyId: id, member: nm });
      if (nm.say && (nm.say !== om?.say || nm.sayId !== om?.sayId)) out.push(say(id, nm));
    }
    if (!samePartyHeader(op, np)) out.push({ t, kind: 'party', party: np });
  }
  return out;
}
