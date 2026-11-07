import { EventEmitter } from 'node:events';
import type { WorldSource } from './source.js';
import type { Delta, Member, Party, Status, World } from './types.js';
import { rollup } from './rollup.js';

// Provisional mock source; superseded by the scaffold's richer MockSource.
const CYCLE: Status[] = ['idle', 'working', 'working', 'blocked', 'working', 'done'];

function member(paneId: string, role: string, status: Status): Member {
  return { paneId, agent: 'claude', role, status, lastChange: 0 };
}

export function mockWorld(): World {
  const mk = (id: string, label: string, ms: Member[]): Party => {
    const members = Object.fromEntries(ms.map((m) => [m.paneId, m]));
    return { id, label, session: 'mock', isWorktree: true, status: rollup(ms), members, tokens: {} };
  };
  return {
    machine: 'mock',
    parties: {
      'mock/w1': mk('mock/w1', 'api', [member('w1:p1', 'coordinator', 'working'), member('w1:p2', 'architect', 'idle'), member('w1:p3', 'implementer', 'working')]),
      'mock/w2': mk('mock/w2', 'docs', [member('w2:p1', 'coordinator', 'idle'), member('w2:p2', 'writer', 'done')]),
    },
  };
}

export class MockSource extends EventEmitter implements WorldSource {
  private timer?: NodeJS.Timeout;
  private world = mockWorld();
  private step = 0;

  constructor(private readonly intervalMs = 2000, private readonly now: () => number = Date.now) {
    super();
  }

  async start(): Promise<void> {
    this.emit('delta', { t: this.now(), kind: 'snapshot', world: this.world } satisfies Delta);
    this.timer = setInterval(() => this.tick(), this.intervalMs);
  }

  async stop(): Promise<void> {
    clearInterval(this.timer);
  }

  tick(): void {
    const parties = Object.values(this.world.parties);
    const party = parties[this.step % parties.length]!;
    const members = Object.values(party.members);
    const m = members[this.step % members.length]!;
    const next: Member = { ...m, status: CYCLE[(CYCLE.indexOf(m.status) + 1) % CYCLE.length]!, lastChange: m.lastChange + 1 };
    party.members[m.paneId] = next;
    party.status = rollup(Object.values(party.members));
    this.step++;
    const t = this.now();
    this.emit('delta', { t, kind: 'member', partyId: party.id, member: next } satisfies Delta);
    this.emit('delta', { t, kind: 'party', party } satisfies Delta);
  }
}
