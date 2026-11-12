import { readFile } from 'node:fs/promises';
import { parse } from 'smol-toml';
import { GitProbeSource, type GitRunner } from './git.js';
import { HooksSource } from './hooks/source.js';
import { HerdrSource } from './herdr/source.js';
import { MockSource } from './mock.js';
import type { WorldSource } from './source.js';

export type SourceKind = 'mock' | 'live' | 'hooks';

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
 * source = "live"            # or "mock", or "hooks" (Claude Code plugin events, no Herdr)
 * pack = "aesir"             # skin pack: neutral, aesir, wayfarers, scifi, or a private theme folder
 * scale = 2                  # strip pixel scale, 1 to 6 (default 3); 2 is compact
 * minimal = true             # strip shows just a status icon under the feet, no nameplate
 * bubbles = false            # hide speech bubbles (default: shown)
 * scrub = true               # hash labels and strip say text in recordings
 * actions = true             # let the overlay prompt and send keys to agents (focus is always on)
 * [herdr]
 * sessions = "all"           # or ["default", "overlay-dev"]
 * # socket = "/path/to/herdr.sock"
 * [git]
 * enabled = true             # show uncommitted/unpushed counts per party (off by default; trust your repos)
 * # interval = 30            # seconds between probes of one folder
 * [hooks]
 * # file = "/path/to/events.jsonl"   # default ~/.bellwether/events.jsonl (or BELLWETHER_EVENTS)
 * ```
 */
export function parseSourceConfig(text: string): SourceConfig {
  const raw = parse(text) as Record<string, unknown>;
  const source = raw.source ?? DEFAULT_CONFIG.source;
  if (source !== 'mock' && source !== 'live' && source !== 'hooks') throw new Error(`bellwether.toml: source must be "mock", "live" or "hooks", got ${JSON.stringify(source)}`);
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
  if (raw.pack !== undefined && (typeof raw.pack !== 'string' || !/^[a-z0-9][a-z0-9_-]*$/i.test(raw.pack))) {
    throw new Error('bellwether.toml: pack must be a theme folder name');
  }
  if (raw.scale !== undefined && (typeof raw.scale !== 'number' || !Number.isInteger(raw.scale) || raw.scale < 1 || raw.scale > 6)) {
    throw new Error('bellwether.toml: scale must be a whole number from 1 to 6');
  }
  if (raw.minimal !== undefined && typeof raw.minimal !== 'boolean') throw new Error('bellwether.toml: minimal must be true or false');
  if (raw.bubbles !== undefined && typeof raw.bubbles !== 'boolean') throw new Error('bellwether.toml: bubbles must be true or false');
  if (raw.scrub !== undefined && typeof raw.scrub !== 'boolean') throw new Error('bellwether.toml: scrub must be true or false');
  if (raw.actions !== undefined && typeof raw.actions !== 'boolean') throw new Error('bellwether.toml: actions must be true or false');
  return { source, ...(raw.actions === true ? { actions: true } : {}), ...(raw.scrub === true ? { scrub: true } : {}), ...(typeof raw.pack === 'string' ? { pack: raw.pack } : {}), ...(typeof raw.scale === 'number' ? { scale: raw.scale } : {}), ...(raw.minimal === true ? { minimal: true } : {}), ...(raw.bubbles === false ? { bubbles: false } : {}), herdr, ...(typeof hk.file === 'string' ? { hooks: { file: hk.file } } : {}), ...(g.enabled === true ? { git: { enabled: true as const, ...(typeof g.interval === 'number' ? { interval: g.interval } : {}) } } : {}) };
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
  if (override === 'mock' || override === 'live' || override === 'hooks') cfg.source = override;
  // The hook writer only sees the env var, so it wins over the file to keep both ends on one path.
  if (env.BELLWETHER_EVENTS) cfg.hooks = { ...cfg.hooks, file: env.BELLWETHER_EVENTS };
  if (env.BELLWETHER_GIT === '1' || env.BELLWETHER_GIT === 'true') cfg.git = { ...cfg.git, enabled: true };
  else if (env.BELLWETHER_GIT === '0' || env.BELLWETHER_GIT === 'false') delete cfg.git;
  if (env.BELLWETHER_PACK && /^[a-z0-9][a-z0-9_-]*$/i.test(env.BELLWETHER_PACK)) cfg.pack = env.BELLWETHER_PACK;
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
}

/** Pick the world source named by config; with `[git] enabled` the live and hooks sources get the git probe on top. */
export function createSource(cfg: SourceConfig, deps: CreateSourceDeps = {}): WorldSource {
  const base = createBaseSource(cfg, deps);
  if (!cfg.git?.enabled || cfg.source === 'mock') return base;
  return new GitProbeSource(base, { intervalMs: cfg.git.interval ? cfg.git.interval * 1000 : undefined, run: deps.gitRunner, log: deps.log });
}

function createBaseSource(cfg: SourceConfig, deps: CreateSourceDeps): WorldSource {
  if (cfg.source === 'live') {
    return deps.live ? deps.live(cfg) : new HerdrSource({ sessions: cfg.herdr.sessions, socket: cfg.herdr.socket, log: deps.log });
  }
  if (cfg.source === 'hooks') {
    return deps.hooks ? deps.hooks(cfg) : new HooksSource({ file: cfg.hooks?.file, log: deps.log });
  }
  return deps.mock ? deps.mock(cfg) : new MockSource();
}
