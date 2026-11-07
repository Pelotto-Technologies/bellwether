import { existsSync, mkdirSync, rmSync, writeFileSync, chmodSync, readdirSync } from 'node:fs';
import { delimiter, join } from 'node:path';
import { homedir } from 'node:os';
import { AGENT_TARGETS, type AgentContext, type AgentTarget } from './agents/index.js';
import { readJsonObject, writeJsonObject } from './json-file.js';
import { HOOK_BASENAME, hookPs1, hookSh, skillMarkdown } from './skill.js';

export interface TargetPaths {
  configDir: string;
  settings: string;
  skill: string;
  hookSh: string;
  hookPs1: string;
}

export interface DetectResult {
  id: string;
  displayName: string;
  configDir: string;
  configDirExists: boolean;
  onPath: boolean;
}

export type Outcome =
  | { id: string; displayName: string; status: 'installed' | 'uninstalled'; paths: TargetPaths }
  | { id: string; displayName: string; status: 'skipped'; reason: string };

export function pathsFor(target: AgentTarget, ctx: AgentContext): TargetPaths {
  const configDir = target.configDir(ctx);
  return {
    configDir,
    settings: join(configDir, 'settings.json'),
    skill: join(configDir, 'skills', 'bellwether', 'SKILL.md'),
    hookSh: join(configDir, 'hooks', `${HOOK_BASENAME}.sh`),
    hookPs1: join(configDir, 'hooks', `${HOOK_BASENAME}.ps1`),
  };
}

export function detect(ctx: AgentContext, targets = AGENT_TARGETS): DetectResult[] {
  return targets.map((t) => {
    const configDir = t.configDir(ctx);
    return {
      id: t.id,
      displayName: t.displayName,
      configDir,
      configDirExists: existsSync(configDir),
      onPath: ctx.onPath(t.binary),
    };
  });
}

/**
 * Install the skill pack and SessionStart role hook for each target whose config dir
 * exists. Idempotent: an existing Bellwether entry is replaced, never duplicated.
 * Entries written by Herdr or the user are left alone.
 */
export function install(ctx: AgentContext, targets = AGENT_TARGETS): Outcome[] {
  return targets.map((t) => {
    const p = pathsFor(t, ctx);
    if (!existsSync(p.configDir)) {
      return { id: t.id, displayName: t.displayName, status: 'skipped', reason: `${p.configDir} does not exist` };
    }
    writeFile(p.skill, skillMarkdown());
    writeFile(p.hookSh, hookSh());
    try {
      chmodSync(p.hookSh, 0o755);
    } catch {
      // chmod is a no-op on Windows; the hook is invoked through `sh` anyway.
    }
    writeFile(p.hookPs1, hookPs1());
    const clean = t.removeSessionStartHook(readJsonObject(p.settings));
    writeJsonObject(p.settings, t.addSessionStartHook(clean, { sh: p.hookSh, ps1: p.hookPs1 }));
    return { id: t.id, displayName: t.displayName, status: 'installed', paths: p };
  });
}

/** Remove only what `install` wrote. Safe to run when nothing is installed. */
export function uninstall(ctx: AgentContext, targets = AGENT_TARGETS): Outcome[] {
  return targets.map((t) => {
    const p = pathsFor(t, ctx);
    if (!existsSync(p.configDir)) {
      return { id: t.id, displayName: t.displayName, status: 'skipped', reason: `${p.configDir} does not exist` };
    }
    if (existsSync(p.settings)) {
      const before = readJsonObject(p.settings);
      const after = t.removeSessionStartHook(before);
      if (after !== before) writeJsonObject(p.settings, after);
    }
    rmSync(join(p.configDir, 'skills', 'bellwether'), { recursive: true, force: true });
    rmSync(p.hookSh, { force: true });
    rmSync(p.hookPs1, { force: true });
    return { id: t.id, displayName: t.displayName, status: 'uninstalled', paths: p };
  });
}

function writeFile(path: string, content: string): void {
  mkdirSync(join(path, '..'), { recursive: true });
  writeFileSync(path, content, 'utf8');
}

/** Context for the real machine. */
export function systemContext(): AgentContext {
  const env = process.env;
  const exts = process.platform === 'win32' ? (env.PATHEXT ?? '.EXE;.CMD;.BAT;.PS1').split(';') : [''];
  return {
    env,
    home: homedir(),
    platform: process.platform,
    onPath(binary) {
      for (const dir of (env.PATH ?? '').split(delimiter)) {
        if (!dir) continue;
        let names: string[];
        try {
          names = readdirSync(dir);
        } catch {
          continue;
        }
        const lower = new Set(names.map((n) => n.toLowerCase()));
        if (exts.some((e) => lower.has((binary + e).toLowerCase()))) return true;
      }
      return false;
    },
  };
}
