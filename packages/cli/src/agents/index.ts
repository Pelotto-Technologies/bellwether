import { claude } from './claude.js';
import { copilot } from './copilot.js';
import type { AgentTarget } from './types.js';

export type { AgentContext, AgentTarget, HookPaths, ToolHookCommand } from './types.js';

/** Installer targets, both first-class. Add a new agent by adding a target here. */
export const AGENT_TARGETS: readonly AgentTarget[] = [claude, copilot];

export function findTarget(id: string): AgentTarget | undefined {
  return AGENT_TARGETS.find((t) => t.id === id);
}
