import { ROLES, isRole, type Role } from './types.js';

export interface RoleHints {
  /** Pane tokens; `role` is set by the installed skill pack or SessionStart hook. */
  tokens?: Record<string, string>;
  /** Name from `herdr agent rename`. */
  agentName?: string | null;
  /** Pane title. */
  title?: string | null;
  /**
   * True for the first pane of a workspace whose label names it an orchestration
   * workspace (`myrepo Orchestration`). That pane is taken to be the orchestrator.
   */
  orchestrationRoot?: boolean;
}

/** `Orchestration`, `orchestrator`, `orchestrate` as a whole word in a workspace label. */
export function isOrchestrationLabel(label: string | null | undefined): boolean {
  return !!label && /(^|[^a-z])orchestrat(ion|or|e)s?($|[^a-z])/i.test(label);
}

const MATCHABLE = ROLES.filter((r) => r !== 'generic');

function findRoleWord(text: string | null | undefined): Role | undefined {
  if (!text) return undefined;
  const words = text.toLowerCase().split(/[^a-z]+/);
  return MATCHABLE.find((role) => words.includes(role));
}

/**
 * Role fallback chain from docs/PLAN.md §1b: `role` token (written by the skill
 * pack or the HERDR_ROLE hook), then agent rename name, then the first pane of an
 * "... Orchestration" workspace, then pane title, then `generic`. Names and titles match when they contain a role as a whole word,
 * so `reviewer-2` and `Lead architect` both resolve.
 */
export function resolveRole(hints: RoleHints): Role {
  const token = hints.tokens?.role?.trim().toLowerCase();
  if (isRole(token)) return token;
  return findRoleWord(hints.agentName) ?? (hints.orchestrationRoot ? 'orchestrator' : undefined) ?? findRoleWord(hints.title) ?? 'generic';
}
