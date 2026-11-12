import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import type { Rect } from './bounds.js';

export type Mode = 'strip' | 'map';

export const ALERT_POSITIONS = ['off', 'top-left', 'top-right', 'top-center'] as const;
export type AlertsSetting = (typeof ALERT_POSITIONS)[number];

export interface ShellConfig {
  mode: Mode;
  /** Electron display id; undefined means primary. */
  displayId?: number;
  /** Skin pack name (`neutral`, `aesir`, `wayfarers`, `scifi`, or a private folder); undefined defers to bellwether.toml. */
  pack?: string;
  /** Herdr session passed to the adapter; undefined means all sessions. */
  session?: string;
  /** Spawn the adapter ourselves (true) or attach to one already running (false). */
  spawnAdapter: boolean;
  /** Renderer URL (the adapter's served overlay). */
  url: string;
  port: number;
  /** Strip pixel scale (2 compact, 3 normal, 4 large); undefined defers to bellwether.toml, then 3. */
  scale?: number;
  /** Icon-only labels on the strip; undefined defers to bellwether.toml. */
  minimal?: boolean;
  /** Strip spans every monitor (one window each, one shared strip); undefined or false means one monitor. */
  span?: boolean;
  /** Speech bubbles shown (true) or hidden (false); undefined defers to bellwether.toml, then shown. */
  bubbles?: boolean;
  /** Sound cues on (true) or muted (false); undefined defers to bellwether.toml, then on: the desktop overlay plays sounds by default. */
  sounds?: boolean;
  /** Alert banner position in the map window; undefined defers to bellwether.toml, then off. The strip is a thin bar with no room for a banner. */
  alerts?: AlertsSetting;
  /** Vitals (bars, model, quest) shown (true) or hidden (false); undefined defers to bellwether.toml, then shown. */
  vitals?: boolean;
  /** Quest recap shown (true) or hidden (false); undefined defers to bellwether.toml, then shown. */
  recap?: boolean;
  /** Keep the map window above other windows. Default false: the map is a normal window you can drag and bury. */
  mapAlwaysOnTop?: boolean;
  /** Where the user last dropped the map window; undefined centres it on the chosen monitor. */
  mapBounds?: Rect;
}

export const DEFAULT_SCALE = 3;

/** Whether sounds play: the tray choice, else bellwether.toml's `sounds`, else on (the desktop overlay's default). */
export function effectiveSounds(cfg: Pick<ShellConfig, 'sounds'>, served?: boolean): boolean {
  return cfg.sounds ?? served ?? true;
}

/** Scale the strip actually uses: the menu choice, else the adapter's served `scale`, else 3. */
export function effectiveScale(cfg: Pick<ShellConfig, 'scale'>, served?: number): number {
  return validScale(cfg.scale) ?? validScale(served) ?? DEFAULT_SCALE;
}

export function validScale(n: unknown): number | undefined {
  return typeof n === 'number' && Number.isInteger(n) && n >= 1 && n <= 6 ? n : undefined;
}

export const DEFAULT_PORT = 7341;

export const DEFAULT_CONFIG: ShellConfig = {
  mode: 'strip',
  spawnAdapter: true,
  url: `http://127.0.0.1:${DEFAULT_PORT}/?transparent`,
  port: DEFAULT_PORT,
};

export const CONFIG_FILE = 'shell.json';

export function configPath(userDataDir: string): string {
  return join(userDataDir, CONFIG_FILE);
}

/**
 * Electron's `userData` folder, which holds `shell.json`: `<appData>/<app name>`, where appData is `%APPDATA%` on
 * Windows, `~/Library/Application Support` on macOS and `$XDG_CONFIG_HOME` (else `~/.config`) elsewhere, and the
 * app name is `productName` or `name` from the shell's package.json. For tools outside Electron (`bellwether pack`).
 */
export function userDataDir(appName: string, env: NodeJS.ProcessEnv = process.env, platform: NodeJS.Platform = process.platform, home: string = homedir()): string {
  const appData = platform === 'win32' ? (env.APPDATA ?? join(home, 'AppData', 'Roaming')) : platform === 'darwin' ? join(home, 'Library', 'Application Support') : (env.XDG_CONFIG_HOME ?? join(home, '.config'));
  return join(appData, appName);
}

/** The app name Electron derives from a package.json: `productName`, else `name`. */
export function appNameFromPackage(raw: unknown): string | undefined {
  if (typeof raw !== 'object' || raw === null) return undefined;
  const r = raw as Record<string, unknown>;
  const name = typeof r.productName === 'string' && r.productName ? r.productName : r.name;
  return typeof name === 'string' && name ? name : undefined;
}

/** Merge untrusted JSON onto the defaults, dropping anything of the wrong type. */
export function normalizeConfig(raw: unknown): ShellConfig {
  const out: ShellConfig = { ...DEFAULT_CONFIG };
  if (typeof raw !== 'object' || raw === null) return out;
  const r = raw as Record<string, unknown>;
  if (r.mode === 'strip' || r.mode === 'map') out.mode = r.mode;
  else if (r.mode === 'camp') out.mode = 'map'; // camp is entered from the map, so a stored camp reopens the map
  if (typeof r.displayId === 'number' && Number.isFinite(r.displayId)) out.displayId = r.displayId;
  if (typeof r.pack === 'string' && /^[\w-]+$/.test(r.pack)) out.pack = r.pack;
   if (typeof r.session === 'string' && r.session.length > 0) out.session = r.session;
  if (typeof r.spawnAdapter === 'boolean') out.spawnAdapter = r.spawnAdapter;
  if (typeof r.port === 'number' && Number.isInteger(r.port) && r.port > 0 && r.port < 65536) {
    out.port = r.port;
    out.url = `http://127.0.0.1:${r.port}/?transparent`;
  }
  if (typeof r.url === 'string' && r.url.length > 0) out.url = r.url;
  if (typeof r.minimal === 'boolean') out.minimal = r.minimal;
  if (typeof r.bubbles === 'boolean') out.bubbles = r.bubbles;
  if (typeof r.sounds === 'boolean') out.sounds = r.sounds;
  if (typeof r.alerts === 'string' && (ALERT_POSITIONS as readonly string[]).includes(r.alerts)) out.alerts = r.alerts as AlertsSetting;
  if (typeof r.vitals === 'boolean') out.vitals = r.vitals;
  if (typeof r.recap === 'boolean') out.recap = r.recap;
  if (r.span === true) out.span = true;
  if (typeof r.mapAlwaysOnTop === 'boolean') out.mapAlwaysOnTop = r.mapAlwaysOnTop;
  const b = r.mapBounds as Record<string, unknown> | null | undefined;
  if (b && typeof b === 'object' && [b.x, b.y, b.width, b.height].every((n) => typeof n === 'number' && Number.isFinite(n)) && (b.width as number) > 0 && (b.height as number) > 0) {
    out.mapBounds = { x: Math.round(b.x as number), y: Math.round(b.y as number), width: Math.round(b.width as number), height: Math.round(b.height as number) };
  }
  const scale = validScale(r.scale);
  if (scale !== undefined) out.scale = scale;
  return out;
}

export async function loadConfig(file: string): Promise<ShellConfig> {
  try {
    return normalizeConfig(JSON.parse(await readFile(file, 'utf8')));
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}

export async function saveConfig(file: string, cfg: ShellConfig): Promise<void> {
  await mkdir(dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  await writeFile(tmp, JSON.stringify(cfg, null, 2) + '\n', 'utf8');
  await rename(tmp, file);
}
