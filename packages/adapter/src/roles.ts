export const ROLES = [
  'orchestrator', 'coordinator', 'architect', 'implementer', 'reviewer',
  'researcher', 'writer', 'ops', 'generic',
] as const;
export type Role = (typeof ROLES)[number];

const KNOWN = new Set<string>(ROLES);

export interface RoleHints {
  token?: string | null;
  agentName?: string | null;
  title?: string | null;
}

/** Role fallback chain: role token, agent name, pane title, then generic. */
export function resolveRole(h: RoleHints): string {
  const token = h.token?.trim().toLowerCase();
  if (token) return token;
  for (const c of [h.agentName, h.title]) {
    const v = c?.trim().toLowerCase();
    if (v && KNOWN.has(v)) return v;
  }
  return 'generic';
}
