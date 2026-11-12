import { spawnSync } from 'node:child_process';
import { chmodSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { appendEvent, cleanPercent, cleanText, eventsFile, MAX_EFFORT, MAX_MODEL, MAX_QUEST, type NormalizedEvent } from './event.js';

/** Marker on the installed `statusLine` command, so uninstall finds only ours. */
export const STATUSLINE_MARKER = 'bellwether-statusline';

/** How long the wrapped status line command may run before it is abandoned. */
export const WRAP_TIMEOUT_MS = 1500;

type Obj = Record<string, unknown>;

function obj(v: unknown): Obj | undefined {
  return v !== null && typeof v === 'object' && !Array.isArray(v) ? (v as Obj) : undefined;
}

function num(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined;
}

/** What one status line payload says about a session. Every value but `session` may be absent. */
export interface Vitals {
  session: string;
  cwd?: string;
  /** Percent of the context window remaining. */
  ctx?: number;
  /** Percent of the 5-hour quota remaining. */
  quota?: number;
  model?: string;
  effort?: string;
  name?: string;
}

/**
 * Read the fields Claude Code's status line JSON documents: `session_id`,
 * `workspace.current_dir` (or `cwd`), `context_window.remaining_percentage`,
 * `rate_limits.five_hour.used_percentage`, `model.display_name`, `effort.level`, `session_name`.
 * The quota is reported as used, so it is flipped to remaining. Nothing is estimated:
 * a field that is missing or not a number stays absent.
 */
export function parseStatusLine(raw: unknown): Vitals | undefined {
  const p = obj(raw);
  if (!p) return undefined;
  const session = typeof p.session_id === 'string' ? cleanText(p.session_id, 128) : undefined;
  if (!session) return undefined;
  const out: Vitals = { session };
  // `workspace.current_dir` is the documented one; `cwd` carries the same value.
  const dir = [obj(p.workspace)?.current_dir, p.cwd].find((d): d is string => typeof d === 'string' && d !== '');
  if (dir) out.cwd = dir;
  const cw = obj(p.context_window);
  const remaining = num(cw?.remaining_percentage);
  const usedCtx = num(cw?.used_percentage);
  const ctx = cleanPercent(remaining ?? (usedCtx !== undefined ? 100 - usedCtx : undefined));
  if (ctx !== undefined) out.ctx = ctx;
  const used = num(obj(obj(p.rate_limits)?.five_hour)?.used_percentage);
  const quota = cleanPercent(used !== undefined ? 100 - used : undefined);
  if (quota !== undefined) out.quota = quota;
  const model = cleanText(obj(p.model)?.display_name, MAX_MODEL);
  if (model) out.model = model;
  const effort = cleanText(obj(p.effort)?.level, MAX_EFFORT);
  if (effort) out.effort = effort;
  const name = cleanText(p.session_name, MAX_QUEST);
  if (name) out.name = name;
  return out;
}

/** The line Bellwether prints when no other status line is wrapped: `Opus 5.5 · ctx 88% · 5h 74%`. */
export function statusLineText(v: Vitals): string {
  const parts: string[] = [];
  if (v.model) parts.push(v.model);
  if (v.ctx !== undefined) parts.push(`ctx ${v.ctx}%`);
  if (v.quota !== undefined) parts.push(`5h ${v.quota}%`);
  return parts.join(' · ');
}

/** The `herdr` arguments that report these values as pane tokens, or undefined when there is nothing to report. */
export function vitalsTokenArgs(v: Vitals, paneId: string): string[] | undefined {
  const tokens: [string, string][] = [];
  if (v.ctx !== undefined) tokens.push(['ctx', String(v.ctx)]);
  if (v.quota !== undefined) tokens.push(['quota', String(v.quota)]);
  if (v.model) tokens.push(['model', v.model]);
  if (v.effort) tokens.push(['effort', v.effort]);
  if (v.name) tokens.push(['quest', v.name]);
  if (tokens.length === 0) return undefined;
  return ['pane', 'report-metadata', paneId, '--source', 'bellwether', ...tokens.flatMap(([k, val]) => ['--token', `${k}=${val}`])];
}

/** `<home>/.bellwether/vitals`: one tiny file per session remembers what was last reported. */
export function vitalsDir(home = homedir()): string {
  return join(home, '.bellwether', 'vitals');
}

/** A session id made safe for a file name, with a short hash so two ids never share a file. */
export function cacheName(session: string): string {
  const safe = session.replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 48);
  return `${safe}-${fnv1a(session)}.json`;
}

/** 32-bit FNV-1a as 8 hex digits. Only tells file names apart; nothing here is secret. */
function fnv1a(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

interface Cache {
  /** Values last appended to the events file. */
  event?: string;
  /** Pane and values last sent to Herdr. */
  pane?: string;
}

function readCache(file: string): Cache {
  try {
    const c = obj(JSON.parse(readFileSync(file, 'utf8')));
    return { ...(typeof c?.event === 'string' ? { event: c.event } : {}), ...(typeof c?.pane === 'string' ? { pane: c.pane } : {}) };
  } catch {
    return {};
  }
}

/** Write through a temporary file and rename, so a reader never sees half a file. Mode 0600. */
function writeCache(file: string, cache: Cache): void {
  mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(cache), { mode: 0o600 });
  try {
    chmodSync(tmp, 0o600);
  } catch {
    // chmod is a no-op on Windows.
  }
  renameSync(tmp, file);
}

/** The values that matter for change detection: everything but the session and folder. */
function fingerprint(v: Vitals): string {
  return JSON.stringify([v.ctx ?? null, v.quota ?? null, v.model ?? null, v.effort ?? null, v.name ?? null]);
}

export function encodeWrap(command: string): string {
  return Buffer.from(command, 'utf8').toString('base64url');
}

export function decodeWrap(token: string): string | undefined {
  try {
    const text = Buffer.from(token, 'base64url').toString('utf8');
    return text || undefined;
  } catch {
    return undefined;
  }
}

export interface StatusLineDeps {
  stdin: string;
  env: Record<string, string | undefined>;
  /** `--wrap`: the previous status line command, base64url. */
  wrap?: string;
  home?: string;
  now?: number;
  /** Run `herdr`; injected so tests never start a process. */
  run?: (bin: string, args: string[]) => void;
  /** Run the wrapped command with the same stdin and return its stdout. */
  runWrapped?: (command: string, stdin: string) => string | undefined;
}

/** Run the previous status line command through the shell, with a short timeout. Failures give undefined. */
export function spawnWrapped(command: string, stdin: string): string | undefined {
  try {
    const r = spawnSync(command, { input: stdin, shell: true, encoding: 'utf8', timeout: WRAP_TIMEOUT_MS, windowsHide: true, stdio: ['pipe', 'pipe', 'ignore'] });
    return typeof r.stdout === 'string' ? r.stdout : undefined;
  } catch {
    return undefined;
  }
}

function spawnHerdr(bin: string, args: string[]): void {
  spawnSync(bin, args, { stdio: 'ignore', timeout: 3000, windowsHide: true });
}

/**
 * `bellwether hook statusline` body. Reports changed values as one `vitals` event (and as
 * Herdr pane tokens when running in a Herdr pane), then returns the text for Claude Code to
 * show: the wrapped command's output unchanged, or a short line of our own. Never throws.
 */
export function runStatusLineHook(deps: StatusLineDeps): string {
  let vitals: Vitals | undefined;
  try {
    vitals = parseStatusLine(JSON.parse(deps.stdin));
  } catch {
    vitals = undefined;
  }
  if (vitals) {
    try {
      report(vitals, deps);
    } catch {
      // Reporting is decoration; the status line must still print.
    }
  }
  const command = deps.wrap ? decodeWrap(deps.wrap) : undefined;
  if (command) {
    try {
      return (deps.runWrapped ?? spawnWrapped)(command, deps.stdin) ?? '';
    } catch {
      return '';
    }
  }
  return vitals ? statusLineText(vitals) : '';
}

function report(v: Vitals, deps: StatusLineDeps): void {
  const home = deps.home ?? homedir();
  const file = join(vitalsDir(home), cacheName(v.session));
  const cache = readCache(file);
  const next: Cache = { ...cache };
  const fp = fingerprint(v);
  let dirty = false;
  if (cache.event !== fp && fp !== fingerprint({ session: v.session })) {
    const line: NormalizedEvent = { v: 1, t: deps.now ?? Date.now(), agent: 'claude', ev: 'vitals', session: v.session };
    if (v.cwd) line.cwd = v.cwd;
    for (const k of ['ctx', 'quota', 'model', 'effort', 'name'] as const) if (v[k] !== undefined) (line as unknown as Obj)[k] = v[k];
    appendEvent(eventsFile(deps.env, home), line);
    next.event = fp;
    dirty = true;
  }
  const pane = deps.env.HERDR_PANE_ID;
  if (pane) {
    const paneFp = `${pane}|${fp}`;
    const args = cache.pane !== paneFp ? vitalsTokenArgs(v, pane) : undefined;
    if (args) {
      try {
        (deps.run ?? spawnHerdr)(deps.env.HERDR_BIN_PATH || 'herdr', args);
        next.pane = paneFp;
        dirty = true;
      } catch {
        // Herdr is not reachable; try again on the next refresh.
      }
    }
  }
  if (dirty) writeCache(file, next);
}
