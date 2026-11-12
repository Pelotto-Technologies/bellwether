import { readFile } from 'node:fs/promises';
import { parse } from 'smol-toml';
import { HooksSource } from './hooks/source.js';
import { HerdrSource } from './herdr/source.js';
import { MockSource } from './mock.js';
import type { WorldSource } from './source.js';
import { chooseAutoSource, type AutoDeps } from './auto.js';

export const ALERT_POSITIONS = ['off', 'top-left', 'top-right', 'top-center'] as const;
export type AlertPosition = (typeof ALERT_POSITIONS)[number];

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
 * scrub = true               # hash labels and strip say text in recordings
 * actions = true             # let the overlay prompt and send keys to agents (focus is always on)
 * [herdr]
 * sessions = "all"           # or ["default", "overlay-dev"]
 * # socket = "/path/to/herdr.sock"
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
  if (raw.pack !== undefined && (typeof raw.pack !== 'string' || !/^[a-z0-9][a-z0-9_-]*$/i.test(raw.pack))) {
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
  return { source, ...(raw.actions === true ? { actions: true } : {}), ...(raw.scrub === true ? { scrub: true } : {}), ...(typeof raw.pack === 'string' ? { pack: raw.pack } : {}), ...(typeof raw.scale === 'number' ? { scale: raw.scale } : {}), ...(raw.minimal === true ? { minimal: true } : {}), ...(raw.bubbles === false ? { bubbles: false } : {}), ...(raw.vitals === false ? { vitals: false } : {}), ...(typeof raw.sounds === 'boolean' ? { sounds: raw.sounds } : {}), ...(typeof raw.volume === 'number' ? { volume: raw.volume } : {}), ...(typeof raw.alerts === 'string' ? { alerts: raw.alerts as AlertPosition } : {}), herdr, ...(typeof hk.file === 'string' ? { hooks: { file: hk.file } } : {}) };
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
  if (env.BELLWETHER_PACK && /^[a-z0-9][a-z0-9_-]*$/i.test(env.BELLWETHER_PACK)) cfg.pack = env.BELLWETHER_PACK;
  return cfg;
}

export interface CreateSourceDeps {
  log?: (msg: string) => void;
  /** Factories, overridable in tests. */
  live?: (cfg: SourceConfig) => WorldSource;
  mock?: (cfg: SourceConfig) => WorldSource;
  hooks?: (cfg: SourceConfig) => WorldSource;
}

/**
 * Pick the world source named by config. `auto` should be resolved first (see `resolveAutoConfig`);
 * left unresolved it is treated as `hooks`, the safe no-Herdr choice.
 */
export function createSource(cfg: SourceConfig, deps: CreateSourceDeps = {}): WorldSource {
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
