import type { Member, Status } from './types.js';

const RANK: Record<Status, number> = { blocked: 4, done: 3, working: 2, idle: 1, unknown: 0 };

/** Party rollup = worst member status (blocked > done > working > idle > unknown). */
export function rollup(members: Iterable<Pick<Member, 'status'>>): Status {
  let worst: Status = 'unknown';
  for (const m of members) if (RANK[m.status] > RANK[worst]) worst = m.status;
  return worst;
}
