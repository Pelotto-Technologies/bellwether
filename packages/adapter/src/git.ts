// Opt-in git state per party. Node only: not exported through the browser-safe `core` entry.
//
// Probing a folder runs `git status` there, and git can execute programs named in a
// repository's own config (filters, fsmonitor, textconv). The feature is therefore off
// unless the user turns it on, and `core.fsmonitor` is forced off on every call. See README.
import { execFile } from 'node:child_process';
import { normalizeCwd } from './hooks/source.js';
import type { Action } from './actions.js';
import type { DeltaListener, WorldSource } from './source.js';
import type { Delta, GitState, Party, World } from './types.js';
import { applyDelta, emptyWorld } from './world.js';

export interface GitRunResult {
  code: number;
  stdout: string;
}

/** Runs `git <args>` in `cwd`. Injectable so tests never spawn git. Rejects on spawn failure or timeout. */
export type GitRunner = (args: string[], opts: { cwd: string; timeoutMs: number }) => Promise<GitRunResult>;

export const DEFAULT_GIT_INTERVAL_MS = 30_000;
export const GIT_TIMEOUT_MS = 3000;

/** Flags on every call: no fsmonitor daemon, no bare repos found by accident. */
const SAFE_FLAGS = ['-c', 'safe.bareRepository=explicit', '-c', 'core.fsmonitor=false', '--no-optional-locks'];

/** Spawns git with an args array (no shell). */
export const runGit: GitRunner = (args, { cwd, timeoutMs }) =>
  new Promise((resolve, reject) => {
    execFile(
      'git',
      args,
      {
        cwd,
        timeout: timeoutMs,
        windowsHide: true,
        maxBuffer: 16 * 1024 * 1024,
        env: { ...process.env, GIT_OPTIONAL_LOCKS: '0', GIT_TERMINAL_PROMPT: '0' },
      },
      (err, stdout) => {
        if (!err) return resolve({ code: 0, stdout: String(stdout) });
        const code = (err as { code?: unknown }).code;
        // A non-zero exit (not a repository) is an answer; a missing binary or a timeout is not.
        if (typeof code === 'number' && !(err as { killed?: boolean }).killed) return resolve({ code, stdout: String(stdout ?? '') });
        reject(err);
      },
    );
  });

/** Parse `git status --porcelain=v2 --branch`: `# branch.ab +N -M` gives ahead, every entry line is one dirty file. */
export function parseStatusV2(out: string): { dirty: number; ahead: number } {
  let dirty = 0;
  let ahead = 0;
  for (const line of out.split('\n')) {
    if (!line) continue;
    if (line.startsWith('# ')) {
      const m = /^# branch\.ab \+(\d+) -(\d+)/.exec(line);
      if (m) ahead = Number(m[1]);
      continue;
    }
    // 1 ordinary, 2 renamed/copied, u unmerged, ? untracked. Ignored files ('!') are not listed by default.
    if (line[0] === '1' || line[0] === '2' || line[0] === 'u' || line[0] === '?') dirty++;
  }
  return { dirty, ahead };
}

/** Git state of `folder`, or undefined: not a repository, git missing, timeout or any error. */
export async function probeGit(folder: string, run: GitRunner = runGit, timeoutMs = GIT_TIMEOUT_MS): Promise<GitState | undefined> {
  try {
    const status = await run([...SAFE_FLAGS, 'status', '--porcelain=v2', '--branch'], { cwd: folder, timeoutMs });
    if (status.code !== 0) return undefined;
    const remote = await run([...SAFE_FLAGS, 'remote'], { cwd: folder, timeoutMs });
    if (remote.code !== 0) return undefined;
    return { ...parseStatusV2(status.stdout), noRemote: remote.stdout.trim() === '' };
  } catch {
    return undefined;
  }
}

export function sameGit(a: GitState | undefined, b: GitState | undefined): boolean {
  if (!a || !b) return a === b;
  return a.dirty === b.dirty && a.ahead === b.ahead && a.noRemote === b.noRemote;
}

export interface GitProbeOptions {
  /** Minimum time between probes of one folder. Default 30s. */
  intervalMs?: number;
  /** Probes running at once. Default 2. */
  concurrency?: number;
  /** How soon after a member goes working to done the folder is re-probed. Default 2s. */
  doneDelayMs?: number;
  timeoutMs?: number;
  run?: GitRunner;
  now?: () => number;
  log?: (msg: string) => void;
}

interface FolderState {
  folder: string;
  lastStart: number;
  /** Earliest time of an extra, event-driven probe. */
  due?: number | undefined;
  inflight: boolean;
  git?: GitState | undefined;
}

/**
 * Decorates any WorldSource with `Party.git`. Parties are probed by folder (several parties
 * or sessions in one folder probe once), at most once per interval, immediately when a folder
 * first appears and shortly after a member finishes work, never more than `concurrency` at a
 * time. A `party` delta goes out only when the state changed. Parties the source gives no
 * folder for (remote machines, unknown cwd) never get `git`.
 */
export class GitProbeSource implements WorldSource {
  private listeners: DeltaListener[] = [];
  private world: World = emptyWorld();
  private states = new Map<string, FolderState>();
  private inflight = 0;
  private running = false;
  private timer?: ReturnType<typeof setInterval>;
  private readonly intervalMs: number;
  private readonly concurrency: number;
  private readonly doneDelayMs: number;
  private readonly timeoutMs: number;
  private readonly run: GitRunner;
  private readonly now: () => number;
  private readonly log: (msg: string) => void;

  constructor(
    private readonly inner: WorldSource,
    opts: GitProbeOptions = {},
  ) {
    this.intervalMs = opts.intervalMs ?? DEFAULT_GIT_INTERVAL_MS;
    this.concurrency = Math.max(1, opts.concurrency ?? 2);
    this.doneDelayMs = opts.doneDelayMs ?? 2000;
    this.timeoutMs = opts.timeoutMs ?? GIT_TIMEOUT_MS;
    this.run = opts.run ?? runGit;
    this.now = opts.now ?? Date.now;
    this.log = opts.log ?? (() => {});
    inner.on('delta', (d) => this.onDelta(d));
  }

  get actions(): Action {
    return this.inner.actions;
  }

  partyFolder(partyId: string): string | undefined {
    return this.inner.partyFolder?.(partyId);
  }

  on(_event: 'delta', fn: DeltaListener): void {
    this.listeners.push(fn);
  }

  async start(): Promise<void> {
    this.running = true;
    this.timer = setInterval(() => this.pump(), Math.max(50, Math.min(1000, this.intervalMs)));
    this.timer.unref?.();
    await this.inner.start();
    this.pump();
  }

  async stop(): Promise<void> {
    this.running = false;
    clearInterval(this.timer);
    this.timer = undefined;
    await this.inner.stop();
  }

  private emit(d: Delta): void {
    for (const fn of this.listeners) fn(d);
  }

  private keyOf(partyId: string): { key: string; folder: string } | undefined {
    const folder = this.inner.partyFolder?.(partyId);
    return folder ? { key: normalizeCwd(folder), folder } : undefined;
  }

  private withGit(p: Party): Party {
    const k = this.keyOf(p.id);
    const git = k ? this.states.get(k.key)?.git : undefined;
    const { git: _old, ...rest } = p;
    return git ? { ...rest, git } : rest;
  }

  private onDelta(d: Delta): void {
    let out = d;
    if (d.kind === 'snapshot') {
      out = { ...d, world: { ...d.world, parties: Object.fromEntries(Object.entries(d.world.parties).map(([id, p]) => [id, this.withGit(p)])) } };
    } else if (d.kind === 'party') {
      out = { ...d, party: this.withGit(d.party) };
    }
    const prev = this.world;
    this.world = applyDelta(prev, out);
    this.noteFinished(prev, this.world, d);
    this.emit(out);
    this.pump();
  }

  /** A member going from working to done is a good moment for a fresh look. */
  private noteFinished(prev: World, next: World, d: Delta): void {
    const ids = d.kind === 'snapshot' ? Object.keys(next.parties) : d.kind === 'member' ? [d.partyId] : d.kind === 'party' ? [d.party.id] : [];
    for (const id of ids) {
      const before = prev.parties[id];
      const after = next.parties[id];
      if (!before || !after) continue;
      const finished = Object.values(after.members).some((m) => m.status === 'done' && before.members[m.paneId]?.status === 'working');
      const k = finished ? this.keyOf(id) : undefined;
      const st = k && this.states.get(k.key);
      if (st && st.due === undefined) st.due = this.now() + this.doneDelayMs;
    }
  }

  private pump(): void {
    if (!this.running) return;
    const now = this.now();
    const folders = new Map<string, string>();
    for (const id of Object.keys(this.world.parties)) {
      const k = this.keyOf(id);
      if (k && !folders.has(k.key)) folders.set(k.key, k.folder);
    }
    for (const [key, folder] of folders) {
      let st = this.states.get(key);
      if (!st) this.states.set(key, (st = { folder, lastStart: -Infinity, inflight: false }));
      st.folder = folder;
      if (st.inflight || this.inflight >= this.concurrency) continue;
      const dueAt = Math.min(st.lastStart + this.intervalMs, st.due ?? Infinity);
      if (dueAt <= now) this.probe(key, st, now);
    }
  }

  private probe(key: string, st: FolderState, now: number): void {
    st.inflight = true;
    st.lastStart = now;
    st.due = undefined;
    this.inflight++;
    this.log(`git: probing ${st.folder}`);
    void probeGit(st.folder, this.run, this.timeoutMs).then((git) => {
      this.inflight--;
      st.inflight = false;
      if (!this.running) return;
      st.git = git;
      this.publish(key, git);
      this.pump();
    });
  }

  /** Emit a party delta for every party in the folder whose git state differs. */
  private publish(key: string, git: GitState | undefined): void {
    for (const p of Object.values(this.world.parties)) {
      if (this.keyOf(p.id)?.key !== key || sameGit(p.git, git)) continue;
      const { git: _old, ...rest } = p;
      const party: Party = git ? { ...rest, git } : rest;
      const delta: Delta = { t: this.now(), kind: 'party', party };
      this.world = applyDelta(this.world, delta);
      this.emit(delta);
    }
  }
}
