// Light RPG progression: XP, levels and the quest recap. Pure and browser-safe (no Node built-ins);
// persistence lives in stats-store.ts (Node only).
//
// What earns XP (per member, credited to the member's ROLE; every implementer shares the implementer level):
//   - 20 XP for each finished task (a working to done transition after at least 5 s of work)
//   - 2 XP for each minute spent working (accrued continuously)
//   - 5 XP bonus when a blocked member is unblocked within 2 minutes
// Only counters are kept: never prompt or say text, never repo, branch or party names.
import { TOOL_CATEGORIES, type Delta, type Member, type Moment, type Recap, type Role, ROLES, type Status, type ToolCategory } from './types.js';

export const XP = { task: 20, perMinute: 2, quickUnblock: 5 } as const;
/** A working to done transition counts as a task only after this much work, so flapping earns nothing. */
export const MIN_TASK_MS = 5000;
/** A blocked member counts as "unblocked quickly" inside this window. */
export const QUICK_UNBLOCK_MS = 120_000;
/** A party must stay fully done this long before its quest completes. */
export const QUEST_DWELL_MS = 10_000;
/** One accrual step never credits more than this, so a laptop asleep for hours earns nothing. */
export const MAX_ACCRUE_MS = 60_000;
export const MAX_LEVEL = 99;

/** Total XP needed to reach `level` (level 1 is 0 XP): going from level L to L+1 takes 20 (L+1) XP, so 40, 60, 80, ... */
export function xpForLevel(level: number): number {
  const l = Math.max(1, Math.min(MAX_LEVEL, Math.floor(level)));
  return 10 * (l - 1) * (l + 2);
}

export interface LevelInfo {
  level: number;
  /** XP earned inside the current level. */
  have: number;
  /** XP this level takes in all; `have / next` fills the bar. 0 at the level cap. */
  next: number;
}

/** Level, progress and span for a total XP. Negative or non-finite XP counts as 0. */
export function levelFor(xp: number): LevelInfo {
  const total = Number.isFinite(xp) && xp > 0 ? Math.floor(xp) : 0;
  let level = 1;
  while (level < MAX_LEVEL && total >= xpForLevel(level + 1)) level++;
  if (level >= MAX_LEVEL) return { level, have: 0, next: 0 };
  return { level, have: total - xpForLevel(level), next: xpForLevel(level + 1) - xpForLevel(level) };
}

interface ToolRule {
  category: ToolCategory;
  exact?: string[];
  has?: string[];
}

// Same families the camp scene uses for its activities; unknown names are `other`.
const TOOL_RULES: ToolRule[] = [
  { category: 'plan', has: ['todo', 'plan', 'think'] },
  { category: 'delegate', has: ['task', 'agent', 'delegate', 'dispatch'] },
  { category: 'shell', exact: ['sh', 'zsh', 'cmd'], has: ['bash', 'shell', 'terminal', 'exec', 'command'] },
  { category: 'edit', has: ['edit', 'write', 'patch', 'replace', 'create_file'] },
  { category: 'search', has: ['search', 'fetch', 'browse', 'http', 'web'] },
  { category: 'read', exact: ['ls', 'cat', 'head', 'tail'], has: ['read', 'grep', 'glob', 'view', 'list', 'find', 'open'] },
];

export function toolCategory(tool: string): ToolCategory {
  const name = tool.trim().toLowerCase();
  for (const r of TOOL_RULES) if (r.exact?.includes(name) || r.has?.some((h) => name.includes(h))) return r.category;
  return 'other';
}

/** Persistent counters for one role. */
export interface RoleTotals {
  xp: number;
  tasks: number;
  workingMs: number;
  blockedMs: number;
  messages: number;
  tools: Partial<Record<ToolCategory, number>>;
}

export interface Lifetime {
  tasks: number;
  quests: number;
  workingMs: number;
  blockedMs: number;
  messages: number;
}

/** Everything that is persisted. */
export interface StatsSnapshot {
  roles: Partial<Record<Role, RoleTotals>>;
  lifetime: Lifetime;
}

/** This session's counters for one member. */
export interface MemberStats {
  partyId: string;
  paneId: string;
  role: Role;
  tasks: number;
  workingMs: number;
  blockedMs: number;
  messages: number;
  xp: number;
  tools: Partial<Record<ToolCategory, number>>;
}

const emptyRole = (): RoleTotals => ({ xp: 0, tasks: 0, workingMs: 0, blockedMs: 0, messages: 0, tools: {} });
const emptyLifetime = (): Lifetime => ({ tasks: 0, quests: 0, workingMs: 0, blockedMs: 0, messages: 0 });
export const emptyStats = (): StatsSnapshot => ({ roles: {}, lifetime: emptyLifetime() });

const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : 0);

/** Cleans untrusted JSON (a hand-edited or corrupt file) into a valid snapshot: unknown keys and bad numbers drop out. */
export function normalizeStats(raw: unknown): StatsSnapshot {
  const out = emptyStats();
  if (typeof raw !== 'object' || raw === null) return out;
  const r = raw as Record<string, unknown>;
  const roles = typeof r.roles === 'object' && r.roles !== null ? (r.roles as Record<string, unknown>) : {};
  for (const role of ROLES) {
    const t = roles[role];
    if (typeof t !== 'object' || t === null) continue;
    const o = t as Record<string, unknown>;
    const tools: Partial<Record<ToolCategory, number>> = {};
    const rawTools = typeof o.tools === 'object' && o.tools !== null ? (o.tools as Record<string, unknown>) : {};
    for (const c of TOOL_CATEGORIES) if (num(rawTools[c]) > 0) tools[c] = num(rawTools[c]);
    out.roles[role] = { xp: num(o.xp), tasks: num(o.tasks), workingMs: num(o.workingMs), blockedMs: num(o.blockedMs), messages: num(o.messages), tools };
  }
  const l = typeof r.lifetime === 'object' && r.lifetime !== null ? (r.lifetime as Record<string, unknown>) : {};
  out.lifetime = { tasks: num(l.tasks), quests: num(l.quests), workingMs: num(l.workingMs), blockedMs: num(l.blockedMs), messages: num(l.messages) };
  return out;
}

interface Tracked {
  partyId: string;
  paneId: string;
  role: Role;
  status: Status;
  /** Last time elapsed time was credited. */
  accruedAt: number;
  /** When the current stretch of work began (kept across a block). */
  workStart?: number;
  blockedAt?: number;
  tool?: string;
  session: MemberStats;
}

/** One run of work in a party: from someone starting to work until everyone is done. */
interface Run {
  startedAt: number;
  tasks: number;
  blockedMs: number;
  tools: Partial<Record<ToolCategory, number>>;
  xp: number;
  levelUps: { role: Role; level: number }[];
  /** Since when every member has been done or idle. */
  quietSince?: number | undefined;
}

export interface TrackerOptions {
  /** Clock in ms. Injected in tests. */
  now?: () => number;
  /** Persistent totals to continue from. */
  totals?: StatsSnapshot;
  dwellMs?: number;
}

const key = (partyId: string, paneId: string) => `${partyId}/${paneId}`;

/**
 * Turns the delta stream into stats. `apply` takes each delta, `tick` credits elapsed time and checks the quest
 * timers; both return the moments (level ups, quest completions) that happened. The clock is injected, so
 * time accounting is deterministic. Snapshots adopt the world silently: nothing is earned for what already was.
 */
export class StatsTracker {
  private readonly now: () => number;
  private readonly dwellMs: number;
  private totals: StatsSnapshot;
  private members = new Map<string, Tracked>();
  private runs = new Map<string, Run>();
  private moments: Delta[] = [];

  constructor(opts: TrackerOptions = {}) {
    this.now = opts.now ?? Date.now;
    this.dwellMs = opts.dwellMs ?? QUEST_DWELL_MS;
    this.totals = opts.totals ? normalizeStats(opts.totals) : emptyStats();
  }

  /** A copy of the persistent counters. */
  snapshot(): StatsSnapshot {
    return normalizeStats(JSON.parse(JSON.stringify(this.totals)));
  }

  /** This session's per-member counters. */
  sessionStats(): MemberStats[] {
    return [...this.members.values()].map((m) => ({ ...m.session, tools: { ...m.session.tools } }));
  }

  roleXp(role: Role): number {
    return this.totals.roles[role]?.xp ?? 0;
  }

  /** The member with its role's level and XP progress. */
  annotate(m: Member): Member {
    const info = levelFor(this.roleXp(m.role));
    return { ...m, level: info.level, xp: { have: info.have, next: info.next } };
  }

  apply(delta: Delta): Delta[] {
    const now = this.now();
    this.moments = [];
    switch (delta.kind) {
      case 'snapshot': {
        const seen = new Set<string>();
        for (const p of Object.values(delta.world.parties)) {
          for (const m of Object.values(p.members)) {
            this.observe(p.id, m, now, true);
            seen.add(key(p.id, m.paneId));
          }
        }
        for (const k of [...this.members.keys()]) if (!seen.has(k)) this.members.delete(k);
        for (const id of [...this.runs.keys()]) if (!delta.world.parties[id]) this.runs.delete(id);
        break;
      }
      case 'party':
        for (const m of Object.values(delta.party.members)) this.observe(delta.party.id, m, now, false);
        break;
      case 'member':
        this.observe(delta.partyId, delta.member, now, false);
        break;
      case 'removed': {
        this.accrueAll(now);
        for (const [k, t] of [...this.members]) {
          if (t.partyId === delta.partyId && (delta.paneId === undefined || t.paneId === delta.paneId)) this.members.delete(k);
        }
        if (delta.paneId === undefined) this.runs.delete(delta.partyId);
        break;
      }
      case 'say': {
        const t = this.members.get(key(delta.partyId, delta.paneId));
        if (t && delta.to) {
          t.session.messages++;
          this.role(t.role).messages++;
          this.totals.lifetime.messages++;
        }
        break;
      }
      case 'moment':
        break;
    }
    this.checkQuests(now);
    return this.moments;
  }

  /** Credits elapsed time and fires quest timers. Call every second or so. */
  tick(): Delta[] {
    const now = this.now();
    this.moments = [];
    this.accrueAll(now);
    this.checkQuests(now);
    return this.moments;
  }

  private role(role: Role): RoleTotals {
    return (this.totals.roles[role] ??= emptyRole());
  }

  private observe(partyId: string, m: Member, now: number, adopt: boolean): void {
    const k = key(partyId, m.paneId);
    const t = this.members.get(k);
    if (!t) {
      const fresh: Tracked = {
        partyId,
        paneId: m.paneId,
        role: m.role,
        status: m.status,
        accruedAt: now,
        ...(m.status === 'working' ? { workStart: now } : {}),
        ...(m.status === 'blocked' ? { blockedAt: now } : {}),
        ...(m.tool ? { tool: m.tool } : {}),
        session: { partyId, paneId: m.paneId, role: m.role, tasks: 0, workingMs: 0, blockedMs: 0, messages: 0, xp: 0, tools: {} },
      };
      this.members.set(k, fresh);
      if (m.status === 'working') this.startRun(partyId, now);
      return;
    }
    this.accrue(t, now);
    t.role = m.role;
    t.session.role = m.role;
    const was = t.status;
    t.status = m.status;
    if (was !== m.status) this.transition(t, was, m.status, now, adopt);
    // After the transition, so the tool of a member that just started work lands in the run it started.
    if (m.tool && m.tool !== t.tool) this.countTool(t, m.tool);
    if (m.tool) t.tool = m.tool;
    else delete t.tool;
  }

  private transition(t: Tracked, was: Status, status: Status, now: number, adopt: boolean): void {
    const partyId = t.partyId;
    // A snapshot after a reconnect can flip statuses we missed; it never pays out.
    if (status === 'working') {
      if (was === 'blocked' && t.blockedAt !== undefined && !adopt && now - t.blockedAt <= QUICK_UNBLOCK_MS) this.award(t, XP.quickUnblock);
      if (was !== 'blocked' || t.workStart === undefined) t.workStart = now;
      delete t.blockedAt;
      this.startRun(partyId, now);
    } else if (status === 'blocked') {
      t.blockedAt = now;
    } else {
      if (status === 'done' && was === 'working' && !adopt && t.workStart !== undefined && now - t.workStart >= MIN_TASK_MS) this.finishTask(t);
      delete t.workStart;
      delete t.blockedAt;
    }
  }

  private startRun(partyId: string, now: number): void {
    const run = this.runs.get(partyId);
    if (!run) this.runs.set(partyId, { startedAt: now, tasks: 0, blockedMs: 0, tools: {}, xp: 0, levelUps: [] });
    else run.quietSince = undefined;
  }

  private finishTask(t: Tracked): void {
    t.session.tasks++;
    this.role(t.role).tasks++;
    this.totals.lifetime.tasks++;
    const run = this.runs.get(t.partyId);
    if (run) run.tasks++;
    this.award(t, XP.task);
  }

  private countTool(t: Tracked, tool: string): void {
    const c = toolCategory(tool);
    t.session.tools[c] = (t.session.tools[c] ?? 0) + 1;
    const rt = this.role(t.role);
    rt.tools[c] = (rt.tools[c] ?? 0) + 1;
    const run = this.runs.get(t.partyId);
    if (run) run.tools[c] = (run.tools[c] ?? 0) + 1;
  }

  private award(t: Tracked, amount: number): void {
    const rt = this.role(t.role);
    const before = levelFor(rt.xp).level;
    rt.xp += amount;
    t.session.xp += amount;
    const run = this.runs.get(t.partyId);
    if (run) run.xp += amount;
    const after = levelFor(rt.xp).level;
    if (after > before) {
      run?.levelUps.push({ role: t.role, level: after });
      this.moments.push({ t: this.now(), kind: 'moment', moment: 'level_up', partyId: t.partyId, paneId: t.paneId, role: t.role, level: after });
    }
  }

  private accrueAll(now: number): void {
    for (const t of this.members.values()) this.accrue(t, now);
  }

  private accrue(t: Tracked, now: number): void {
    const dt = Math.min(Math.max(0, now - t.accruedAt), MAX_ACCRUE_MS);
    t.accruedAt = now;
    if (dt === 0) return;
    if (t.status === 'working') {
      t.session.workingMs += dt;
      this.role(t.role).workingMs += dt;
      this.totals.lifetime.workingMs += dt;
      this.award(t, (dt / 60_000) * XP.perMinute);
    } else if (t.status === 'blocked') {
      t.session.blockedMs += dt;
      this.role(t.role).blockedMs += dt;
      this.totals.lifetime.blockedMs += dt;
      const run = this.runs.get(t.partyId);
      if (run) run.blockedMs += dt;
    }
  }

  /** A run completes when every member is done or idle and has been for the dwell time. */
  private checkQuests(now: number): void {
    for (const [partyId, run] of [...this.runs]) {
      const members = [...this.members.values()].filter((m) => m.partyId === partyId);
      const quiet = members.length > 0 && members.every((m) => m.status === 'done' || m.status === 'idle');
      if (!quiet) {
        run.quietSince = undefined;
        continue;
      }
      run.quietSince ??= now;
      if (now - run.quietSince < this.dwellMs) continue;
      this.runs.delete(partyId);
      // Work that earned nothing (a blip, or nothing finished) is not a quest.
      if (run.tasks < 1) continue;
      this.totals.lifetime.quests++;
      const byRole: Partial<Record<Role, number>> = {};
      for (const m of members) byRole[m.role] = (byRole[m.role] ?? 0) + 1;
      const recap: Recap = {
        durationMs: Math.max(0, run.quietSince - run.startedAt),
        members: byRole,
        tasks: run.tasks,
        blockedMs: Math.round(run.blockedMs),
        tools: run.tools,
        xp: Math.floor(run.xp),
        levelUps: run.levelUps,
      };
      this.moments.push({ t: now, kind: 'moment', moment: 'quest_complete' satisfies Moment, partyId, recap });
    }
  }
}

