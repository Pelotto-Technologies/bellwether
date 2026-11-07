export { AGENT_TARGETS, findTarget } from './agents/index.js';
export type { AgentContext, AgentTarget, HookPaths } from './agents/index.js';
export { detect, install, uninstall, pathsFor, systemContext } from './install.js';
export type { DetectResult, Outcome, TargetPaths } from './install.js';
export { ROLES, type Role } from './roles.js';
