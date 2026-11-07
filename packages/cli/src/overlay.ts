import { spawnSync, spawn } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { locateRuntime } from './run.js';

export const ELECTRON_VERSION = '33';

/** Where the Electron binary is installed on first use, so the base package stays small. */
export function electronCacheDir(env: NodeJS.ProcessEnv = process.env): string {
  return env.BELLWETHER_HOME ?? join(homedir(), '.bellwether', 'electron');
}

/** The bundled shell entry (published package), or the workspace build. */
export function locateShell(here = dirname(fileURLToPath(import.meta.url))): string {
  const candidates = [join(here, '..', 'runtime', 'shell', 'dist', 'main.js'), join(here, '..', '..', 'shell', 'dist', 'main.js')];
  const main = candidates.find(existsSync);
  if (!main) throw new Error('the desktop shell is not built; run pnpm build');
  return main;
}

function electronBinary(cacheDir: string): string | undefined {
  try {
    const path = createRequire(join(cacheDir, 'noop.js'))('electron') as unknown;
    return typeof path === 'string' && existsSync(path) ? path : undefined;
  } catch {
    return undefined;
  }
}

/** Finds Electron in the cache, installing it with npm the first time. */
export function ensureElectron(cacheDir = electronCacheDir()): string {
  const have = electronBinary(cacheDir);
  if (have) return have;
  console.error(`bellwether: installing Electron ${ELECTRON_VERSION} into ${cacheDir} (one time, ~100 MB)...`);
  mkdirSync(cacheDir, { recursive: true });
  const pkg = join(cacheDir, 'package.json');
  if (!existsSync(pkg)) writeFileSync(pkg, JSON.stringify({ name: 'bellwether-electron', private: true }));
  const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  const r = spawnSync(npm, ['install', `electron@${ELECTRON_VERSION}`, '--no-audit', '--no-fund'], { cwd: cacheDir, stdio: 'inherit', shell: process.platform === 'win32' });
  const bin = r.status === 0 ? electronBinary(cacheDir) : undefined;
  if (!bin) throw new Error('could not install Electron; try `npm install electron@' + ELECTRON_VERSION + '` in ' + cacheDir);
  return bin;
}

export function launchOverlay(_args: string[]): number {
  const rt = locateRuntime();
  if (!rt.rendererDist) throw new Error('overlay page is not built; run pnpm build');
  const electron = ensureElectron();
  const child = spawn(electron, [locateShell()], {
    stdio: 'inherit',
    env: { ...process.env, BELLWETHER_ADAPTER_BIN: rt.adapterBin, BELLWETHER_RENDERER_DIR: rt.rendererDist },
  });
  child.on('exit', (code) => process.exit(code ?? 0));
  return 0;
}
