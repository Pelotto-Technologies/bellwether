import { ROLES, isRole, type Role } from './types.js';

export interface RoleHints {
  /** Pane tokens; `role` is set by the installed skill pack or SessionStart hook. */
  tokens?: Record<string, string>;
  /** Name from `herdr agent rename`. */
  agentName?: string | null;
  /** Pane title. */
  title?: string | null;
}

const MATCHABLE = ROLES.filter((r) => r !== 'generic');

function findRoleWord(text: string | null | undefined): Role | undefined {
  if (!text) return undefined;
  const words = text.toLowerCase().split(/[^a-z]+/);
  return MATCHABLE.find((role) => words.includes(role));
}

/**
 * Role fallback chain from docs/PLAN.md §1b: `role` token (written by the skill
 * pack or the HERDR_ROLE hook), then agent rename name, then pane title, then
 * `generic`. Names and titles match when they contain a role as a whole word,
 * so `reviewer-2` and `Lead architect` both resolve.
 */
export function resolveRole(hints: RoleHints): Role {
  const token = hints.tokens?.role?.trim().toLowerCase();
  if (isRole(token)) return token;
  return findRoleWord(hints.agentName) ?? findRoleWord(hints.title) ?? 'generic';
}
