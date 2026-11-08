import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

export type Mode = 'strip' | 'map';

export interface ShellConfig {
  mode: Mode;
  /** Electron display id; undefined means primary. */
  displayId?: number;
  /** Skin pack name (`neutral`, `aesir`, `wayfarers`, or a private folder); undefined defers to bellwether.toml. */
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
}

export const DEFAULT_SCALE = 3;

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

/** Merge untrusted JSON onto the defaults, dropping anything of the wrong type. */
export function normalizeConfig(raw: unknown): ShellConfig {
  const out: ShellConfig = { ...DEFAULT_CONFIG };
  if (typeof raw !== 'object' || raw === null) return out;
  const r = raw as Record<string, unknown>;
  if (r.mode === 'strip' || r.mode === 'map') out.mode = r.mode;
  if (typeof r.displayId === 'number' && Number.isFinite(r.displayId)) out.displayId = r.displayId;
  if (typeof r.pack === 'string' && /^[\w-]+$/.test(r.pack)) out.pack = r.pack;
   if (typeof r.session === 'string' && r.session.length > 0) out.session = r.session;
  if (typeof r.spawnAdapter === 'boolean') out.spawnAdapter = r.spawnAdapter;
  if (typeof r.port === 'number' && Number.isInteger(r.port) && r.port > 0 && r.port < 65536) {
    out.port = r.port;
    out.url = `http://127.0.0.1:${r.port}/?transparent`;
  }
  if (typeof r.url === 'string' && r.url.length > 0) out.url = r.url;
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
