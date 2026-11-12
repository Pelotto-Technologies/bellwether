import { createHash } from 'node:crypto';
import { open, stat } from 'node:fs/promises';
import os from 'node:os';
import { resolveRole } from '../roles.js';
import { diffParties } from '../herdr/mapper.js';
import { rollup } from '../rollup.js';
import { BaseSource } from '../source.js';
import type { Member, Party, Role, Status } from '../types.js';
import { defaultEventsFile, type HookEvent, parseHookEvent } from './event.js';

export interface HooksSourceOptions {
  /** Events file. Default: `$BELLWETHER_EVENTS` or `~/.bellwether/events.jsonl`. */
  file?: string;
  now?: () => number;
  /** How often the file size is checked. Default 500. */
  pollMs?: number;
  /** How often finished subagents and stale sessions are pruned. Default 1000. */
  pruneMs?: number;
  /** A finished subagent stays visible this long. Default 8000. */
  subLingerMs?: number;
  /** A session or subagent with no event for this long is dropped, unless it is `done`. Default 2h. */
  staleMs?: number;
  /** Events older than this are ignored on start. Default 12h. */
  lookbackMs?: number;
  machine?: string;
  log?: (msg: string) => void;
}

interface SessionState {
  id: string;
  agent: string;
  cwd: string;
  role?: string;
  status: Status;
  title?: string;
  say?: string;
  sayId?: string;
  context?: number;
  quota?: number;
  vitalsAt?: number;
  model?: string;
  effort?: string;
  quest?: string;
  tool?: string;
  lastEvent: number;
  lastChange: number;
}

interface SubState {
  session: string;
  sub: string;
  subType?: string;
  status: Status;
  title?: string;
  lastEvent: number;
  lastChange: number;
  doneAt?: number;
}

const BUILTIN_SUB_ROLES: Record<string, Role> = { explore: 'researcher', plan: 'architect', 'general-purpose': 'implementer' };
/** Tool names whose description is worth a speech bubble: the parent hands work to a subagent. */
const DELEGATE_TOOLS = new Set(['Task', 'Agent']);

/** Normalize for hashing: slashes forward, no trailing slash, case-folded when it looks like a Windows path. */
export function normalizeCwd(cwd: string): string {
  let p = cwd.replace(/\\/g, '/');
  // Trim trailing slashes with a loop: a `/\/+$/` regex is quadratic on long runs of `/`.
  let end = p.length;
  while (end > 0 && p[end - 1] === '/') end--;
  p = p.slice(0, end);
  if (/^[a-z]:/i.test(cwd) || cwd.includes('\\')) p = p.toLowerCase();
  return p || '/';
}

export function hooksPartyId(cwd: string): string {
  return 'hooks/' + createHash('sha1').update(normalizeCwd(cwd)).digest('hex').slice(0, 8);
}

function baseName(cwd: string): string {
  const parts = normalizeCwd(cwd).split('/').filter(Boolean);
  return parts[parts.length - 1] ?? cwd;
}

export function subRole(subType: string | undefined): Role {
  if (!subType) return 'generic';
  const byWord = resolveRole({ agentName: subType });
  if (byWord !== 'generic') return byWord;
  const lower = subType.toLowerCase();
  if (BUILTIN_SUB_ROLES[lower]) return BUILTIN_SUB_ROLES[lower]!;
  if (lower.includes('review')) return 'reviewer';
  return 'generic';
}

/**
 * Sessions of any agent, read from the normalized events file `bellwether hook event`
 * writes. No Herdr: one party per working directory, one member per session, plus a
 * member per running subagent.
 */
export class HooksSource extends BaseSource {
  readonly file: string;
  private sessions = new Map<string, SessionState>();
  private subs = new Map<string, SubState>();
  private parties: Record<string, Party> = {};
  private folders = new Map<string, string>();
  private offset = 0;
  private ino = 0;
  private pending: Buffer = Buffer.alloc(0);
  private polling = false;
  private running = false;
  private live = false;
  private sayCount = 0;
  private pollTimer?: NodeJS.Timeout;
  private pruneTimer?: NodeJS.Timeout;
  private readonly now: () => number;
  private readonly log: (msg: string) => void;
  private readonly subLingerMs: number;
  private readonly staleMs: number;
  private readonly lookbackMs: number;

  constructor(private readonly opts: HooksSourceOptions = {}) {
    super();
    this.file = opts.file ?? defaultEventsFile();
    this.now = opts.now ?? Date.now;
    this.log = opts.log ?? (() => {});
    this.subLingerMs = opts.subLingerMs ?? 8000;
    this.staleMs = opts.staleMs ?? 2 * 3600_000;
    this.lookbackMs = opts.lookbackMs ?? 12 * 3600_000;
  }

  /** Current parties (read-only view). */
  get current(): Readonly<Record<string, Party>> {
    return this.parties;
  }

  /** Working directory of a party, for the opt-in git probe. */
  partyFolder(partyId: string): string | undefined {
    return this.folders.get(partyId);
  }

  async start(): Promise<void> {
    if (this.running) return;
    this.running = true;
    this.live = false;
    try {
      await this.readNew();
    } catch (err) {
      this.log(`hooks: ${(err as Error).message}`);
    }
    this.prune();
    this.parties = this.build();
    const t = this.now();
    this.emit({ t, kind: 'snapshot', world: { machine: this.opts.machine ?? (os.hostname() || 'local'), parties: this.parties } });
    this.live = true;
    this.log(`hooks: watching ${this.file}`);
    this.pollTimer = setInterval(() => void this.poll(), this.opts.pollMs ?? 500);
    this.pruneTimer = setInterval(() => this.tick(), this.opts.pruneMs ?? 1000);
    this.pollTimer.unref?.();
    this.pruneTimer.unref?.();
  }

  async stop(): Promise<void> {
    this.running = false;
    clearInterval(this.pollTimer);
    clearInterval(this.pruneTimer);
  }

  /** Read whatever was appended since the last call and emit deltas. Called by the poll timer; exposed for tests. */
  async poll(): Promise<void> {
    if (!this.running || this.polling) return;
    this.polling = true;
    try {
      if (await this.readNew()) this.flush();
    } catch (err) {
      this.log(`hooks: ${(err as Error).message}`);
    } finally {
      this.polling = false;
    }
  }

  /** Drop finished subagents and stale sessions, emitting deltas. */
  tick(): void {
    if (!this.running) return;
    this.prune();
    this.flush();
  }

  /** Reads new bytes and folds the complete lines in. Returns whether any event was applied. */
  private async readNew(): Promise<boolean> {
    let size: number;
    let ino: number;
    try {
      const st = await stat(this.file);
      size = st.size;
      ino = st.ino;
    } catch {
      this.offset = 0;
      this.pending = Buffer.alloc(0);
      return false;
    }
    if (size < this.offset || (this.ino && ino && ino !== this.ino)) {
      // Truncated or rotated: start over from the top of the new file.
      this.offset = 0;
      this.pending = Buffer.alloc(0);
    }
    this.ino = ino;
    if (size === this.offset) return false;
    const fh = await open(this.file, 'r');
    let buf: Buffer;
    try {
      const len = size - this.offset;
      buf = Buffer.alloc(len);
      const { bytesRead } = await fh.read(buf, 0, len, this.offset);
      buf = buf.subarray(0, bytesRead);
      this.offset += bytesRead;
    } finally {
      await fh.close();
    }
    const data = Buffer.concat([this.pending, buf]);
    const lastNl = data.lastIndexOf(0x0a);
    if (lastNl < 0) {
      this.pending = data;
      return false;
    }
    this.pending = data.subarray(lastNl + 1);
    const cutoff = this.now() - this.lookbackMs;
    let applied = false;
    for (const line of data.subarray(0, lastNl).toString('utf8').split('\n')) {
      const e = parseHookEvent(line);
      if (!e || e.t < cutoff) continue;
      this.apply(e);
      applied = true;
    }
    return applied;
  }

  private session(e: HookEvent): SessionState {
    let s = this.sessions.get(e.session);
    if (!s) {
      s = { id: e.session, agent: e.agent, cwd: e.cwd ?? '(unknown)', status: 'idle', lastEvent: e.t, lastChange: e.t };
      this.sessions.set(e.session, s);
    }
    return s;
  }

  private setStatus(s: { status: Status; lastChange: number }, status: Status, t: number): void {
    if (s.status !== status) s.lastChange = t;
    s.status = status;
  }

  private say(s: SessionState, text: string | undefined): void {
    // History replayed at start is not chatter; only events that arrive live raise bubbles.
    if (!text || !this.live) return;
    s.say = text;
    s.sayId = String(++this.sayCount);
  }

  private apply(e: HookEvent): void {
    if (e.ev === 'end') {
      this.sessions.delete(e.session);
      for (const [k, sub] of this.subs) if (sub.session === e.session) this.subs.delete(k);
      return;
    }
    const s = this.session(e);
    s.lastEvent = Math.max(s.lastEvent, e.t);
    s.agent = e.agent;
    if (e.role) s.role = e.role;
    if ((e.ev === 'start' || s.cwd === '(unknown)') && e.cwd) s.cwd = e.cwd;

    if (e.ev === 'vitals') {
      // Vitals never change the status. A field the event omits keeps its last value.
      if (e.ctx !== undefined) s.context = e.ctx;
      if (e.quota !== undefined) s.quota = e.quota;
      if (e.ctx !== undefined || e.quota !== undefined) s.vitalsAt = e.t;
      if (e.model) s.model = e.model;
      if (e.effort) s.effort = e.effort;
      if (e.name) s.quest = e.name;
      return;
    }

    const subKey = e.sub ? `${e.session}:${e.sub}` : undefined;
    if (e.ev === 'sub_start' || e.ev === 'sub_stop') {
      if (!subKey) return; // without an id there is nothing to track
      let sub = this.subs.get(subKey);
      if (!sub) {
        sub = { session: e.session, sub: e.sub!, status: 'working', lastEvent: e.t, lastChange: e.t };
        this.subs.set(subKey, sub);
      }
      sub.lastEvent = e.t;
      if (e.subType) sub.subType = e.subType;
      if (e.ev === 'sub_start') {
        this.setStatus(sub, 'working', e.t);
        delete sub.doneAt;
        if (e.detail) sub.title = e.detail;
      } else {
        this.setStatus(sub, 'done', e.t);
        sub.doneAt = e.t;
      }
      this.setStatus(s, s.status === 'idle' ? 'working' : s.status, e.t);
      return;
    }

    if (subKey && (e.ev === 'tool' || e.ev === 'tool_done')) {
      let sub = this.subs.get(subKey);
      if (!sub) {
        sub = { session: e.session, sub: e.sub!, status: 'working', lastEvent: e.t, lastChange: e.t };
        this.subs.set(subKey, sub);
      }
      sub.lastEvent = e.t;
      if (e.subType) sub.subType = e.subType;
      if (sub.status !== 'done') this.setStatus(sub, 'working', e.t);
      if (e.detail) sub.title = e.detail;
      if (e.ev === 'tool' && e.tool && DELEGATE_TOOLS.has(e.tool) && e.detail) this.say(s, e.detail);
      return;
    }

    switch (e.ev) {
      case 'start':
        this.setStatus(s, 'idle', e.t);
        break;
      case 'prompt':
      case 'tool':
      case 'tool_done':
        this.setStatus(s, 'working', e.t);
        if (e.detail) s.title = e.detail;
        if (e.ev === 'tool' && e.tool) s.tool = e.tool;
        else delete s.tool;
        if (e.ev === 'tool' && e.tool && DELEGATE_TOOLS.has(e.tool) && e.detail) this.say(s, e.detail);
        break;
      case 'wait':
        this.setStatus(s, 'blocked', e.t);
        if (e.detail) {
          s.title = e.detail;
          this.say(s, e.detail);
        }
        break;
      case 'stop':
        this.setStatus(s, 'done', e.t);
        delete s.tool;
        break;
    }
  }

  private prune(): void {
    const now = this.now();
    for (const [k, sub] of this.subs) {
      const gone = sub.doneAt !== undefined ? now - sub.doneAt >= this.subLingerMs : now - sub.lastEvent >= this.staleMs;
      if (gone || !this.sessions.has(sub.session)) this.subs.delete(k);
    }
    for (const [id, s] of this.sessions) {
      if (s.status !== 'done' && now - s.lastEvent >= this.staleMs) {
        this.sessions.delete(id);
        for (const [k, sub] of this.subs) if (sub.session === id) this.subs.delete(k);
      }
    }
  }

  private build(): Record<string, Party> {
    const activeSubs = new Map<string, number>();
    for (const sub of this.subs.values()) if (sub.status !== 'done') activeSubs.set(sub.session, (activeSubs.get(sub.session) ?? 0) + 1);
    const parties: Record<string, Party> = {};
    this.folders = new Map();
    const partyFor = (cwd: string): Party => {
      const id = hooksPartyId(cwd);
      if (cwd !== '(unknown)') this.folders.set(id, cwd);
      return (parties[id] ??= {
        id,
        label: baseName(cwd),
        repo: baseName(cwd),
        isWorktree: /\/(\.claude\/)?worktrees\//.test(normalizeCwd(cwd) + '/'),
        status: 'unknown',
        members: {},
        tokens: {},
      });
    };
    for (const s of this.sessions.values()) {
      let role = resolveRole({ tokens: s.role ? { role: s.role } : undefined, agentName: s.role });
      if (role === 'generic' && (activeSubs.get(s.id) ?? 0) > 0) role = 'orchestrator';
      const m: Member = { paneId: s.id, agent: s.agent, role, status: s.status, lastChange: s.lastChange };
      if (s.title) m.title = s.title;
      if (s.say) m.say = s.say;
      if (s.say && s.sayId) m.sayId = s.sayId;
      if (s.context !== undefined || s.quota !== undefined) {
        m.vitals = { at: s.vitalsAt ?? s.lastEvent, ...(s.context !== undefined ? { context: s.context } : {}), ...(s.quota !== undefined ? { quota: s.quota } : {}) };
      }
      if (s.model) m.model = s.model;
      if (s.effort) m.effort = s.effort;
      if (s.quest) m.quest = s.quest;
      if (s.tool) m.tool = s.tool;
      partyFor(s.cwd).members[s.id] = m;
    }
    for (const sub of this.subs.values()) {
      const parent = this.sessions.get(sub.session);
      if (!parent) continue;
      const id = `${sub.session}:${sub.sub}`;
      const m: Member = { paneId: id, agent: parent.agent, role: subRole(sub.subType), status: sub.status, lastChange: sub.lastChange };
      const title = sub.title ?? sub.subType;
      if (title) m.title = title;
      partyFor(parent.cwd).members[id] = m;
    }
    for (const p of Object.values(parties)) p.status = rollup(Object.values(p.members));
    return parties;
  }

  private flush(): void {
    const next = this.build();
    const deltas = diffParties(this.parties, next, this.now());
    this.parties = next;
    for (const d of deltas) this.emit(d);
  }
}
