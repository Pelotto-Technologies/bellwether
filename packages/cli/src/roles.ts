/** Generic role vocabulary. Theme packs map these to sprites; the core never names characters. */
export const ROLES = [
  'orchestrator',
  'coordinator',
  'architect',
  'implementer',
  'reviewer',
  'researcher',
  'writer',
  'ops',
  'generic',
] as const;

export type Role = (typeof ROLES)[number];
