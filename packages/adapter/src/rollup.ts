import type { Member, Status } from './types.js';

/** Higher wins. blocked > done > working > idle > unknown (docs/PLAN.md §1). */
export const STATUS_PRIORITY: Record<Status, number> = {
  blocked: 4,
  done: 3,
  working: 2,
  idle: 1,
  unknown: 0,
};

/** Party status is the worst member status. An empty party is `unknown`. */
export function rollup(members: Iterable<Pick<Member, 'status'>>): Status {
  let worst: Status = 'unknown';
  for (const m of members) {
    if (STATUS_PRIORITY[m.status] > STATUS_PRIORITY[worst]) worst = m.status;
  }
  return worst;
}
