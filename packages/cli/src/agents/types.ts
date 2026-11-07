import type { JsonObject } from '../json-file.js';

/** Where an agent target looks things up. Injected so tests never touch the real home dir. */
export interface AgentContext {
  env: Record<string, string | undefined>;
  home: string;
  platform: NodeJS.Platform;
  /** Whether an executable with this name is on PATH. */
  onPath(binary: string): boolean;
}

export interface HookPaths {
  sh: string;
  ps1: string;
}

/**
 * One coding agent the installer can integrate with. `id` is the value Herdr puts in
 * the `agent` field for this agent. This is the only place in Bellwether that knows
 * agents apart; the adapter and renderer stay agent-agnostic.
 */
export interface AgentTarget {
  id: string;
  displayName: string;
  binary: string;
  /** Config home, honouring the agent's own override variable. */
  configDir(ctx: AgentContext): string;
  /** Return settings with Bellwether's SessionStart entry added. Assumes none is present. */
  addSessionStartHook(settings: JsonObject, hook: HookPaths): JsonObject;
  /** Return settings with every Bellwether entry removed and all other entries untouched. */
  removeSessionStartHook(settings: JsonObject): JsonObject;
}
