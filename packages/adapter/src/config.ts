import { readFile } from 'node:fs/promises';
import { parse } from 'smol-toml';
import { GitProbeSource, type GitRunner } from './git.js';
import { HooksSource } from './hooks/source.js';
import { HerdrSource } from './herdr/source.js';
import { MockSource, mockTotals } from './mock.js';
import { StatsSource } from './stats-source.js';
import { loadStats, StatsWriter } from './stats-store.js';
import type { WorldSource } from './source.js';
import { chooseAutoSource, type AutoDeps } from './auto.js';

export const ALERT_POSITIONS = ['off', 'top-left', 'top-right', 'top-center'] as const;
export type AlertPosition = (typeof ALERT_POSITIONS)[number];

/** A theme folder name, as `pack` and `BELLWETHER_PACK` take it. */
export const PACK_NAME = /^[a-z0-9][a-z0-9_-]*$/i;

export type SourceKind = 'mock' | 'live' | 'hooks' | 'auto';

export interface SourceConfig {
  source: SourceKind;
  /** Skin pack the overlay shows (a folder name under themes/). The renderer falls back to neutral if it is unknown. */
  pack?: string;
  /** Pixel scale of the strip, 1 to 6 (`scale = 2` for a compact strip). Default 3. */
  scale?: number;
  /** Strip shows only a small status icon below the feet instead of the nameplate above (`minimal = true`). */
  minimal?: boolean;
  /** Speech bubbles over agents; on by default, `bubbles = false` hides them. Carried only when false. */
  bubbles?: boolean;
  /** Sound cues (`sounds = true|false`). Unset: the desktop overlay plays them, a browser tab or OBS source does not. */
  sounds?: boolean;
  /** Master volume of the sound cues, 0 to 1 (`volume = 0.3`). */
  volume?: number;
  /** Alert banners: `off` (default), `top-left`, `top-right` or `top-center` (`alerts = "top-right"`). */
  alerts?: AlertPosition;
  /** Vitals (context, quota, model, quest) over agents; on by default, `vitals = false` hides them. Carried only when false. */
  vitals?: boolean;
  /** Scrub recordings at record time (`scrub = true`). */
  scrub?: boolean;
  /** Let the overlay send prompts and keys to agents (`actions = true`). Focus is always allowed. */
  actions?: boolean;
  herdr: {
    /** `"all"` discovers running sessions; a list names them; omitted uses HERDR_SESSION or default. */
    sessions?: 'all' | string[];
    socket?: string;
  };
  /**
   * Opt-in git state per party (`[git] enabled = true`). Probing runs `git status` in agents' folders,
   * which can run programs a repository's own config names, so it is off unless asked for. Carried only when on.
   */
  git?: {
    enabled: true;
    /** Seconds between probes of one folder. Default 30. */
    interval?: number;
  };
  /**
   * Levels and quest recap (`[stats] enabled = false` turns them off, `file = "..."` moves the counters file).
   * `createSource` adds the stats decorator only when `enabled` is true; the CLI resolves the default
   * (on, unless `--no-stats`, `BELLWETHER_STATS=0` or `enabled = false`) before calling it.
   */
  stats?: { enabled?: boolean; file?: string };
  /** Quest recap card on the overlay; on by default, `recap = false` hides it. Carried only when false. */
  recap?: boolean;
  /** The `hooks` source: agent sessions on this machine, no Herdr. Carried only when set. */
  hooks?: {
    /** Events file written by `bellwether hook event`. Default `~/.bellwether/events.jsonl`. */
    file?: string;
  };
}

export const DEFAULT_CONFIG: SourceConfig = { source: 'mock', herdr: {} };

/**
 * Parse the source section of `bellwether.toml`:
 *
 * ```toml
 * source = "live"            # or "mock", "hooks" (agent events file, no Herdr) or "auto" (live if Herdr answers at startup, else hooks)
 * pack = "aesir"             # skin pack: neutral, aesir, wayfarers, scifi, or a private theme folder
 * scale = 2                  # strip pixel scale, 1 to 6 (default 3); 2 is compact
 * minimal = true             # strip shows just a status icon under the feet, no nameplate
 * bubbles = false            # hide speech bubbles (default: shown)
 * sounds = true              # chiptune cues for done, blocked, new party (default: on in the desktop overlay only)
 * volume = 0.3               # sound volume, 0 to 1 (default 0.3)
 * alerts = "top-right"       # alert banners: off (default), top-left, top-right, top-center
 * vitals = false             # hide context and quota bars, model and quest (default: shown)
 * recap = false              # no quest recap card (default: shown after a party finishes its work)
 * scrub = true               # hash labels and strip say text in recordings
 * actions = true             # let the overlay prompt and send keys to agents (focus is always on)
 * [herdr]
 * sessions = "all"           # or ["default", "overlay-dev"]
 * # socket = "/path/to/herdr.sock"
 * [git]
 * enabled = true             # show uncommitted/unpushed counts per party (off by default; trust your repos)
 * # interval = 30            # seconds between probes of one folder
 * [stats]
 * enabled = false            # no XP, levels or quest recap (default: on). Counters only are kept in ~/.bellwether/stats.json
 * # file = "/path/to/stats.json"   # or BELLWETHER_STATS=<path>; BELLWETHER_STATS=0 turns it off
 * [hooks]
 * # file = "/path/to/events.jsonl"   # default ~/.bellwether/events.jsonl (or BELLWETHER_EVENTS)
 * ```
 */
export function parseSourceConfig(text: string): SourceConfig {
  const raw = parse(text) as Record<string, unknown>;
  const source = raw.source ?? DEFAULT_CONFIG.source;
  if (source !== 'mock' && source !== 'live' && source !== 'hooks' && source !== 'auto') throw new Error(`bellwether.toml: source must be "mock", "live", "hooks" or "auto", got ${JSON.stringify(source)}`);
  const h = (raw.herdr ?? {}) as Record<string, unknown>;
  const herdr: SourceConfig['herdr'] = {};
  if (h.sessions !== undefined) {
    if (h.sessions === 'all') herdr.sessions = 'all';
    else if (typeof h.sessions === 'string') herdr.sessions = [h.sessions];
    else if (Array.isArray(h.sessions) && h.sessions.every((s) => typeof s === 'string')) herdr.sessions = h.sessions as string[];
    else throw new Error('bellwether.toml: herdr.sessions must be "all", a name, or a list of names');
  }
  if (typeof h.socket === 'string') herdr.socket = h.socket;
  const hk = (raw.hooks ?? {}) as Record<string, unknown>;
  if (hk.file !== undefined && (typeof hk.file !== 'string' || !hk.file)) throw new Error('bellwether.toml: hooks.file must be a path');
  const g = (raw.git ?? {}) as Record<string, unknown>;
  if (g.enabled !== undefined && typeof g.enabled !== 'boolean') throw new Error('bellwether.toml: git.enabled must be true or false');
  if (g.interval !== undefined && (typeof g.interval !== 'number' || !Number.isFinite(g.interval) || g.interval < 5 || g.interval > 3600)) {
    throw new Error('bellwether.toml: git.interval must be a number of seconds from 5 to 3600');
  }
  const st = (raw.stats ?? {}) as Record<string, unknown>;
  if (st.enabled !== undefined && typeof st.enabled !== 'boolean') throw new Error('bellwether.toml: stats.enabled must be true or false');
  if (st.file !== undefined && (typeof st.file !== 'string' || !st.file)) throw new Error('bellwether.toml: stats.file must be a path');
  if (raw.recap !== undefined && typeof raw.recap !== 'boolean') throw new Error('bellwether.toml: recap must be true or false');
  if (raw.pack !== undefined && (typeof raw.pack !== 'string' || !PACK_NAME.test(raw.pack))) {
    throw new Error('bellwether.toml: pack must be a theme folder name');
  }
  if (raw.scale !== undefined && (typeof raw.scale !== 'number' || !Number.isInteger(raw.scale) || raw.scale < 1 || raw.scale > 6)) {
    throw new Error('bellwether.toml: scale must be a whole number from 1 to 6');
  }
  if (raw.minimal !== undefined && typeof raw.minimal !== 'boolean') throw new Error('bellwether.toml: minimal must be true or false');
  if (raw.bubbles !== undefined && typeof raw.bubbles !== 'boolean') throw new Error('bellwether.toml: bubbles must be true or false');
  if (raw.sounds !== undefined && typeof raw.sounds !== 'boolean') throw new Error('bellwether.toml: sounds must be true or false');
  if (raw.volume !== undefined && (typeof raw.volume !== 'number' || !(raw.volume >= 0 && raw.volume <= 1))) throw new Error('bellwether.toml: volume must be a number from 0 to 1');
  if (raw.alerts !== undefined && !(ALERT_POSITIONS as readonly unknown[]).includes(raw.alerts)) throw new Error(`bellwether.toml: alerts must be one of ${ALERT_POSITIONS.map((p) => `"${p}"`).join(', ')}`);
  if (raw.scrub !== undefined && typeof raw.scrub !== 'boolean') throw new Error('bellwether.toml: scrub must be true or false');
  if (raw.actions !== undefined && typeof raw.actions !== 'boolean') throw new Error('bellwether.toml: actions must be true or false');
  if (raw.vitals !== undefined && typeof raw.vitals !== 'boolean') throw new Error('bellwether.toml: vitals must be true or false');
  return { source, ...(raw.actions === true ? { actions: true } : {}), ...(raw.scrub === true ? { scrub: true } : {}), ...(typeof raw.pack === 'string' ? { pack: raw.pack } : {}), ...(typeof raw.scale === 'number' ? { scale: raw.scale } : {}), ...(raw.minimal === true ? { minimal: true } : {}), ...(raw.bubbles === false ? { bubbles: false } : {}), ...(raw.vitals === false ? { vitals: false } : {}), ...(raw.recap === false ? { recap: false } : {}), ...(st.enabled !== undefined || typeof st.file === 'string' ? { stats: { ...(typeof st.enabled === 'boolean' ? { enabled: st.enabled } : {}), ...(typeof st.file === 'string' ? { file: st.file } : {}) } } : {}), ...(typeof raw.sounds === 'boolean' ? { sounds: raw.sounds } : {}), ...(typeof raw.volume === 'number' ? { volume: raw.volume } : {}), ...(typeof raw.alerts === 'string' ? { alerts: raw.alerts as AlertPosition } : {}), herdr, ...(typeof hk.file === 'string' ? { hooks: { file: hk.file } } : {}), ...(g.enabled === true ? { git: { enabled: true as const, ...(typeof g.interval === 'number' ? { interval: g.interval } : {}) } } : {}) };
}

/** Load config from a file (missing file means defaults), then apply env overrides. */
export async function loadSourceConfig(file = 'bellwether.toml', env: NodeJS.ProcessEnv = process.env): Promise<SourceConfig> {
  let cfg: SourceConfig = { ...DEFAULT_CONFIG, herdr: {} };
  try {
    cfg = parseSourceConfig(await readFile(file, 'utf8'));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
  }
  const override = env.BELLWETHER_SOURCE;
  if (override === 'mock' || override === 'live' || override === 'hooks' || override === 'auto') cfg.source = override;
  // The hook writer only sees the env var, so it wins over the file to keep both ends on one path.
  if (env.BELLWETHER_EVENTS) cfg.hooks = { ...cfg.hooks, file: env.BELLWETHER_EVENTS };
  if (env.BELLWETHER_GIT === '1' || env.BELLWETHER_GIT === 'true') cfg.git = { ...cfg.git, enabled: true };
  else if (env.BELLWETHER_GIT === '0' || env.BELLWETHER_GIT === 'false') delete cfg.git;
  // BELLWETHER_STATS: 0/false off, 1/true on, anything else is the counters file.
  const es = env.BELLWETHER_STATS?.trim();
  if (es) {
    if (es === '0' || es.toLowerCase() === 'false') cfg.stats = { ...cfg.stats, enabled: false };
    else if (es === '1' || es.toLowerCase() === 'true') cfg.stats = { ...cfg.stats, enabled: true };
    else cfg.stats = { ...cfg.stats, file: es };
  }
  if (env.BELLWETHER_PACK && PACK_NAME.test(env.BELLWETHER_PACK)) cfg.pack = env.BELLWETHER_PACK;
  return cfg;
}

export interface CreateSourceDeps {
  log?: (msg: string) => void;
  /** Factories, overridable in tests. */
  live?: (cfg: SourceConfig) => WorldSource;
  mock?: (cfg: SourceConfig) => WorldSource;
  hooks?: (cfg: SourceConfig) => WorldSource;
  /** Git command runner for the opt-in git probe, overridable in tests. */
  gitRunner?: GitRunner;
  /** Counters file for the stats decorator, overriding `cfg.stats.file` and the default (tests). */
  statsFile?: string;
  /** Clock for the stats decorator (tests). */
  now?: () => number;
}

/**
 * Pick the world source named by config. `auto` should be resolved first (see `resolveAutoConfig`);
 * left unresolved it is treated as `hooks`, the safe no-Herdr choice. With `[git] enabled` the live and
 * hooks sources (so whatever `auto` resolves to) get the git probe on top; mock never does.
 */
export function createSource(cfg: SourceConfig, deps: CreateSourceDeps = {}): WorldSource {
  const base = createBaseSource(cfg, deps);
  const probed = !cfg.git?.enabled || cfg.source === 'mock' ? base : new GitProbeSource(base, { intervalMs: cfg.git.interval ? cfg.git.interval * 1000 : undefined, run: deps.gitRunner, log: deps.log });
  return withStats(probed, cfg, deps);
}

/**
 * With `cfg.stats.enabled` true, adds levels and moments on top. The mock gets fake totals and never touches a file;
 * every other source loads the counters file and saves it debounced and on stop.
 */
function withStats(src: WorldSource, cfg: SourceConfig, deps: CreateSourceDeps): WorldSource {
  if (cfg.stats?.enabled !== true) return src;
  if (cfg.source === 'mock') return new StatsSource(src, { totals: mockTotals(), ...(deps.now ? { now: deps.now } : {}) });
  const file = deps.statsFile ?? cfg.stats.file;
  if (!file) return src;
  const writer = new StatsWriter(file, { log: deps.log });
  return new StatsSource(src, { totals: loadStats(file, deps.log), onChange: (s) => writer.update(s), onStop: (s) => writer.flush(s), ...(deps.now ? { now: deps.now } : {}) });
}

function createBaseSource(cfg: SourceConfig, deps: CreateSourceDeps): WorldSource {
  if (cfg.source === 'live') {
    return deps.live ? deps.live(cfg) : new HerdrSource({ sessions: cfg.herdr.sessions, socket: cfg.herdr.socket, log: deps.log });
  }
  if (cfg.source === 'hooks' || cfg.source === 'auto') {
    return deps.hooks ? deps.hooks(cfg) : new HooksSource({ file: cfg.hooks?.file, log: deps.log });
  }
  return deps.mock ? deps.mock(cfg) : new MockSource();
}

/** Turn `source = "auto"` into `live` or `hooks` once, logging one line; other sources pass through unchanged. */
export async function resolveAutoConfig(cfg: SourceConfig, deps: AutoDeps & { log?: (msg: string) => void } = {}): Promise<SourceConfig> {
  if (cfg.source !== 'auto') return cfg;
  const choice = await chooseAutoSource(cfg, deps);
  deps.log?.(`bellwether-adapter: source=auto picked ${choice.source} (${choice.reason})`);
  return { ...cfg, source: choice.source };
}
