import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

export type Mode = 'strip' | 'map';

export interface ShellConfig {
  mode: Mode;
  /** Electron display id; undefined means primary. */
  displayId?: number;
  /** Herdr session passed to the adapter; undefined means all sessions. */
  session?: string;
  /** Spawn the adapter ourselves (true) or attach to one already running (false). */
  spawnAdapter: boolean;
  /** Renderer URL (the adapter's served overlay). */
  url: string;
  port: number;
  stripHeight: number;
}

export const DEFAULT_PORT = 7341;

export const DEFAULT_CONFIG: ShellConfig = {
  mode: 'strip',
  spawnAdapter: true,
  url: `http://127.0.0.1:${DEFAULT_PORT}/?transparent`,
  port: DEFAULT_PORT,
  stripHeight: 160,
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
  if (typeof r.session === 'string' && r.session.length > 0) out.session = r.session;
  if (typeof r.spawnAdapter === 'boolean') out.spawnAdapter = r.spawnAdapter;
  if (typeof r.port === 'number' && Number.isInteger(r.port) && r.port > 0 && r.port < 65536) {
    out.port = r.port;
    out.url = `http://127.0.0.1:${r.port}/?transparent`;
  }
  if (typeof r.url === 'string' && r.url.length > 0) out.url = r.url;
  if (typeof r.stripHeight === 'number' && r.stripHeight >= 32 && r.stripHeight <= 1000) out.stripHeight = Math.round(r.stripHeight);
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
