// Persistence for the stats counters. Node only: not exported through the browser-safe `core` entry.
//
// The file holds per-role totals and lifetime counters and nothing else: no prompt or say text,
// no repository, branch or party names. A missing or corrupt file just means starting from zero.
import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { emptyStats, normalizeStats, type StatsSnapshot } from './stats.js';

export const STATS_VERSION = 1;
export const STATS_WRITE_INTERVAL_MS = 30_000;

/** `<home>/.bellwether/stats.json`. */
export function defaultStatsFile(home = os.homedir()): string {
  return path.join(home, '.bellwether', 'stats.json');
}

export interface StatsSetting {
  enabled?: boolean;
  file?: string;
}

/**
 * Where stats are kept, or undefined when they are switched off. Off wins: `[stats] enabled = false`,
 * `--no-stats` (`flag`) and `BELLWETHER_STATS=0|false`. `BELLWETHER_STATS=<path>` overrides the file; `1|true` keeps the default.
 */
export function resolveStatsFile(cfg: StatsSetting | undefined, env: NodeJS.ProcessEnv = process.env, flagOff = false, home?: string): string | undefined {
  const e = env.BELLWETHER_STATS?.trim();
  if (flagOff || cfg?.enabled === false || e === '0' || e?.toLowerCase() === 'false') return undefined;
  if (e && e !== '1' && e.toLowerCase() !== 'true') return e;
  return cfg?.file || defaultStatsFile(home);
}

/** Reads the file, tolerating a missing, empty, corrupt or newer-version file (all mean zero). */
export function loadStats(file: string, log?: (msg: string) => void): StatsSnapshot {
  let text: string;
  try {
    text = readFileSync(file, 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') log?.(`bellwether-adapter: cannot read stats file ${file}: ${(err as Error).message}`);
    return emptyStats();
  }
  try {
    const raw = JSON.parse(text) as { version?: unknown };
    if (typeof raw !== 'object' || raw === null || raw.version !== STATS_VERSION) {
      log?.(`bellwether-adapter: ignoring stats file ${file} (unknown version)`);
      return emptyStats();
    }
    return normalizeStats(raw);
  } catch {
    log?.(`bellwether-adapter: ignoring corrupt stats file ${file}`);
    return emptyStats();
  }
}

/** Writes through a temp file and a rename, so a crash never leaves half a file. Mode 0600. */
export function writeStatsAtomic(file: string, snap: StatsSnapshot): void {
  const dir = path.dirname(file);
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const tmp = `${file}.${process.pid}.tmp`;
  const rounded: StatsSnapshot = JSON.parse(JSON.stringify(snap), (_k, v) => (typeof v === 'number' ? Math.round(v * 100) / 100 : v));
  try {
    writeFileSync(tmp, JSON.stringify({ version: STATS_VERSION, ...rounded }, null, 2) + '\n', { mode: 0o600 });
    renameSync(tmp, file);
  } catch (err) {
    rmSync(tmp, { force: true });
    throw err;
  }
}

export interface StatsWriterOptions {
  /** Minimum time between writes. Default 30 s. */
  minIntervalMs?: number;
  now?: () => number;
  log?: (msg: string) => void;
}

/** Debounced writer: `update` marks the latest totals, a write happens at most once per interval, `flush` writes now (shutdown). */
export class StatsWriter {
  private pending: StatsSnapshot | undefined;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private lastWrite = -Infinity;
  private readonly minIntervalMs: number;
  private readonly now: () => number;

  constructor(
    private readonly file: string,
    private readonly opts: StatsWriterOptions = {},
  ) {
    this.minIntervalMs = opts.minIntervalMs ?? STATS_WRITE_INTERVAL_MS;
    this.now = opts.now ?? Date.now;
  }

  update(snap: StatsSnapshot): void {
    this.pending = snap;
    if (this.timer) return;
    const wait = Math.max(0, this.lastWrite + this.minIntervalMs - this.now());
    this.timer = setTimeout(() => this.flush(), wait);
    this.timer.unref?.();
  }

  /** Writes the pending totals now. Never throws: a failed write is logged and retried on the next update. */
  flush(snap?: StatsSnapshot): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
    const data = snap ?? this.pending;
    this.pending = undefined;
    if (!data) return;
    this.lastWrite = this.now();
    try {
      writeStatsAtomic(this.file, data);
    } catch (err) {
      this.opts.log?.(`bellwether-adapter: cannot write stats file ${this.file}: ${(err as Error).message}`);
    }
  }
}
