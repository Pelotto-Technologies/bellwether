// `bellwether pack`: which skin the overlay is showing. Resolution mirrors the overlay itself:
// the tray choice in the shell's shell.json, then BELLWETHER_PACK, then `pack` in bellwether.toml
// in the working directory, then the default. The shell and adapter own the file and name rules,
// so they are loaded from the build rather than copied here.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { locateRuntime } from './run.js';
import { locateShell } from './overlay.js';

export const PACK_SOURCES = ['shell', 'toml', 'env', 'default'] as const;
export type PackSource = (typeof PACK_SOURCES)[number];

/** The pack the renderer falls back to (packages/renderer/src/select.ts). */
export const DEFAULT_PACK = 'neutral';

export interface PackInfo {
  pack: string;
  source: PackSource;
  available: string[];
}

export interface PackInputs {
  /** `pack` in the shell's shell.json (the tray's Skin menu). */
  shell?: string;
  /** A valid BELLWETHER_PACK. */
  env?: string;
  /** `pack` in bellwether.toml. */
  toml?: string;
}

/** First of tray choice, environment, bellwether.toml, default. */
export function resolvePack(inputs: PackInputs): { pack: string; source: PackSource } {
  if (inputs.shell) return { pack: inputs.shell, source: 'shell' };
  if (inputs.env) return { pack: inputs.env, source: 'env' };
  if (inputs.toml) return { pack: inputs.toml, source: 'toml' };
  return { pack: DEFAULT_PACK, source: 'default' };
}

/**
 * Pack folders (a folder with a theme.json) under each of `themeDirs`, names only. The public packs the build
 * ships (`builtin`) come first; when no themes folder can be found they are listed as shipped.
 */
export function listPacks(themeDirs: string[], builtin: readonly string[]): string[] {
  const found = new Set<string>();
  let anyDir = false;
  for (const dir of themeDirs) {
    let names: string[];
    try {
      names = readdirSync(dir);
    } catch {
      continue;
    }
    anyDir = true;
    for (const n of names) if (existsSync(join(dir, n, 'theme.json'))) found.add(n);
  }
  if (!anyDir) return [...builtin];
  return [...builtin.filter((b) => found.has(b)), ...[...found].filter((n) => !builtin.includes(n)).sort()];
}

interface ShellConfigModule {
  CONFIG_FILE: string;
  normalizeConfig(raw: unknown): { pack?: string };
  userDataDir(appName: string, env?: NodeJS.ProcessEnv): string;
  appNameFromPackage(raw: unknown): string | undefined;
}
interface TrayMenuModule {
  BUILTIN_PACKS: readonly { name: string }[];
}
interface AdapterConfigModule {
  loadSourceConfig(file: string, env: NodeJS.ProcessEnv): Promise<{ pack?: string }>;
  PACK_NAME: RegExp;
}

async function load<T>(file: string): Promise<T> {
  return (await import(pathToFileURL(file).href)) as T;
}

export interface PackDeps {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  /** This module's folder, to find the built shell, adapter and (in a checkout) themes/. */
  here?: string;
}

/** Reads the shell config, the environment and bellwether.toml, and lists the packs. Throws when bellwether.toml is invalid. */
export async function readPackInfo(deps: PackDeps = {}): Promise<PackInfo> {
  const cwd = deps.cwd ?? process.cwd();
  const env = deps.env ?? process.env;
  const here = deps.here ?? dirname(fileURLToPath(import.meta.url));
  const inputs: PackInputs = {};
  let builtin: string[] = [DEFAULT_PACK];

  try {
    const main = locateShell(here);
    const shellDir = dirname(main);
    const cfg = await load<ShellConfigModule>(join(shellDir, 'config.js'));
    builtin = (await load<TrayMenuModule>(join(shellDir, 'tray-menu.js'))).BUILTIN_PACKS.map((p) => p.name);
    const appName = cfg.appNameFromPackage(JSON.parse(readFileSync(join(shellDir, '..', 'package.json'), 'utf8')));
    if (appName) {
      try {
        const saved = cfg.normalizeConfig(JSON.parse(readFileSync(join(cfg.userDataDir(appName, env), cfg.CONFIG_FILE), 'utf8')));
        if (saved.pack) inputs.shell = saved.pack;
      } catch {
        // No overlay settings saved yet.
      }
    }
  } catch {
    // The desktop shell is not built here, so there is no tray choice to read.
  }

  const adapter = await load<AdapterConfigModule>(join(dirname(locateRuntime(here).adapterBin), 'config.js'));
  const withToml = await adapter.loadSourceConfig(join(cwd, 'bellwether.toml'), {});
  if (withToml.pack) inputs.toml = withToml.pack;
  if (env.BELLWETHER_PACK && adapter.PACK_NAME.test(env.BELLWETHER_PACK)) inputs.env = env.BELLWETHER_PACK;

  const themeDirs = [join(cwd, 'themes'), join(here, '..', '..', '..', 'themes')];
  return { ...resolvePack(inputs), available: listPacks(themeDirs, builtin) };
}

/** What `bellwether pack` prints: the id, or with `json` the whole record. */
export function formatPack(info: PackInfo, json: boolean): string {
  return json ? JSON.stringify({ pack: info.pack, source: info.source, available: info.available }) : info.pack;
}
