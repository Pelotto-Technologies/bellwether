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

/** The pre-tool message hook, as a command line for each shell. */
export interface ToolHookCommand {
  posix: string;
  powershell: string;
}

/** Builds the activity-event hook command for one hook name, for each shell. */
export type EventHookCommand = (agent: string, event: string) => ToolHookCommand;

/** Builds the status line command; `wrap` is the previous command, base64url, to run and print in its place. */
export type StatusLineCommand = (wrap?: string) => ToolHookCommand;

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
  /** Return settings with Bellwether's PreToolUse message hook added. Assumes none is present. */
  addToolHook(settings: JsonObject, hook: ToolHookCommand): JsonObject;
  /** Return settings with Bellwether's PreToolUse entries removed and all other entries untouched. */
  removeToolHook(settings: JsonObject): JsonObject;
  /** Return settings with an activity-event hook (`bellwether hook event`) on every event this agent has. Assumes none is present. */
  addEventHooks(settings: JsonObject, command: EventHookCommand): JsonObject;
  /** Return settings with every activity-event hook removed and all other entries untouched. */
  removeEventHooks(settings: JsonObject): JsonObject;
  /**
   * Optional: agents with a single status line slot. Return settings whose status line reports vitals through
   * Bellwether, wrapping an existing status line of someone else's instead of replacing it. Assumes ours is not present.
   */
  addStatusLine?(settings: JsonObject, command: StatusLineCommand): JsonObject;
  /** Optional: return settings with the status line restored to what it was before `addStatusLine` (or removed). The same object when it is not ours. */
  removeStatusLine?(settings: JsonObject): JsonObject;
}
