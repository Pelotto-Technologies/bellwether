import { readFile } from 'node:fs/promises';
import { parse } from 'smol-toml';
import { HerdrSource } from './herdr/source.js';
import { MockSource } from './mock.js';
import type { WorldSource } from './source.js';

export type SourceKind = 'mock' | 'live';

export interface SourceConfig {
  source: SourceKind;
  /** Skin pack the overlay shows (a folder name under themes/). The renderer falls back to neutral if it is unknown. */
  pack?: string;
  /** Pixel scale of the strip, 1 to 6 (`scale = 2` for a compact strip). Default 3. */
  scale?: number;
  /** Strip shows only a small status icon below the feet instead of the nameplate above (`minimal = true`). */
  minimal?: boolean;
  /** Scrub recordings at record time (`scrub = true`). */
  scrub?: boolean;
  /** Let the overlay send prompts and keys to agents (`actions = true`). Focus is always allowed. */
  actions?: boolean;
  herdr: {
    /** `"all"` discovers running sessions; a list names them; omitted uses HERDR_SESSION or default. */
    sessions?: 'all' | string[];
    socket?: string;
  };
}

export const DEFAULT_CONFIG: SourceConfig = { source: 'mock', herdr: {} };

/**
 * Parse the source section of `bellwether.toml`:
 *
 * ```toml
 * source = "live"            # or "mock"
 * pack = "aesir"             # skin pack: neutral, aesir, wayfarers, or a private theme folder
scale = 2                  # strip pixel scale, 1 to 6 (default 3); 2 is compact
minimal = true             # strip shows just a status icon under the feet, no nameplate
 * scrub = true               # hash labels and strip say text in recordings
 * actions = true             # let the overlay prompt and send keys to agents (focus is always on)
 * [herdr]
 * sessions = "all"           # or ["default", "overlay-dev"]
 * # socket = "/path/to/herdr.sock"
 * ```
 */
export function parseSourceConfig(text: string): SourceConfig {
  const raw = parse(text) as Record<string, unknown>;
  const source = raw.source ?? DEFAULT_CONFIG.source;
  if (source !== 'mock' && source !== 'live') throw new Error(`bellwether.toml: source must be "mock" or "live", got ${JSON.stringify(source)}`);
  const h = (raw.herdr ?? {}) as Record<string, unknown>;
  const herdr: SourceConfig['herdr'] = {};
  if (h.sessions !== undefined) {
    if (h.sessions === 'all') herdr.sessions = 'all';
    else if (typeof h.sessions === 'string') herdr.sessions = [h.sessions];
    else if (Array.isArray(h.sessions) && h.sessions.every((s) => typeof s === 'string')) herdr.sessions = h.sessions as string[];
    else throw new Error('bellwether.toml: herdr.sessions must be "all", a name, or a list of names');
  }
  if (typeof h.socket === 'string') herdr.socket = h.socket;
  if (raw.pack !== undefined && (typeof raw.pack !== 'string' || !/^[a-z0-9][a-z0-9_-]*$/i.test(raw.pack))) {
    throw new Error('bellwether.toml: pack must be a theme folder name');
  }
  if (raw.scale !== undefined && (typeof raw.scale !== 'number' || !Number.isInteger(raw.scale) || raw.scale < 1 || raw.scale > 6)) {
    throw new Error('bellwether.toml: scale must be a whole number from 1 to 6');
  }
  if (raw.minimal !== undefined && typeof raw.minimal !== 'boolean') throw new Error('bellwether.toml: minimal must be true or false');
  if (raw.scrub !== undefined && typeof raw.scrub !== 'boolean') throw new Error('bellwether.toml: scrub must be true or false');
  if (raw.actions !== undefined && typeof raw.actions !== 'boolean') throw new Error('bellwether.toml: actions must be true or false');
  return { source, ...(raw.actions === true ? { actions: true } : {}), ...(raw.scrub === true ? { scrub: true } : {}), ...(typeof raw.pack === 'string' ? { pack: raw.pack } : {}), ...(typeof raw.scale === 'number' ? { scale: raw.scale } : {}), ...(raw.minimal === true ? { minimal: true } : {}), herdr };
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
  if (override === 'mock' || override === 'live') cfg.source = override;
  if (env.BELLWETHER_PACK && /^[a-z0-9][a-z0-9_-]*$/i.test(env.BELLWETHER_PACK)) cfg.pack = env.BELLWETHER_PACK;
  return cfg;
}

export interface CreateSourceDeps {
  log?: (msg: string) => void;
  /** Factories, overridable in tests. */
  live?: (cfg: SourceConfig) => WorldSource;
  mock?: (cfg: SourceConfig) => WorldSource;
}

/** Pick the world source named by config. */
export function createSource(cfg: SourceConfig, deps: CreateSourceDeps = {}): WorldSource {
  if (cfg.source === 'live') {
    return deps.live ? deps.live(cfg) : new HerdrSource({ sessions: cfg.herdr.sessions, socket: cfg.herdr.socket, log: deps.log });
  }
  return deps.mock ? deps.mock(cfg) : new MockSource();
}
