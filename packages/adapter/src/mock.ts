import { createRng, pick } from './random.js';
import type { StatsSnapshot } from './stats.js';
import { BaseSource } from './source.js';
import { applyDelta, emptyWorld } from './world.js';
import type { Delta, GitState, Member, Party, Role, Status, World } from './types.js';

interface PartySeed {
  label: string;
  repo: string;
  branch?: string;
  roles: Role[];
}

const PARTIES: PartySeed[] = [
  // One orchestrator at the root of `api` leads three worktrees: they share a repo, so the overlay groups them.
  { label: 'api', repo: 'api', roles: ['orchestrator'] },
  { label: 'auth-refresh', repo: 'api', branch: 'feat/auth-refresh', roles: ['coordinator', 'architect', 'implementer', 'reviewer'] },
  { label: 'billing-export', repo: 'api', branch: 'feat/billing-export', roles: ['coordinator', 'implementer', 'implementer'] },
  { label: 'search-index', repo: 'api', branch: 'perf/search-index', roles: ['architect', 'researcher', 'implementer'] },
  { label: 'docs-site', repo: 'docs', branch: 'docs/getting-started', roles: ['coordinator', 'writer', 'researcher'] },
  { label: 'deploy-pipeline', repo: 'infra', roles: ['architect', 'ops', 'implementer'] },
];

/** Quest names the mock parties go on, by party label. Parties without one show no quest. */
const QUESTS: Record<string, string> = {
  'auth-refresh': 'Refresh the auth tokens',
  'billing-export': 'Export invoices as CSV',
  'search-index': 'Make the search index faster',
  'docs-site': 'Write the getting-started guide',
};

const MODELS = ['Opus 5.5', 'Opus 5.5', 'Sonnet 5.5', 'Haiku 5'] as const;
const EFFORTS = ['low', 'medium', 'high', 'high', 'xhigh'] as const;

/** Tools a working mock member cycles through, so the camp scene shows every activity. Not random: the mock stays deterministic. */
const TOOLS = ['Edit', 'Read', 'Bash', 'Grep', 'WebSearch', 'Task', 'Write', 'Glob'] as const;

// Mock git block: starting values per party (index), drifting every few steps from a separate rng.
// Several parties are dirty and/or ahead so the camp scene (crates, cart) always has something to show.
const MOCK_GIT: GitState[] = [
  { dirty: 7, ahead: 2, noRemote: false },
  { dirty: 3, ahead: 2, noRemote: false },
  { dirty: 12, ahead: 0, noRemote: false },
  { dirty: 0, ahead: 4, noRemote: false },
  { dirty: 1, ahead: 0, noRemote: false },
  { dirty: 14, ahead: 0, noRemote: true },
];

/** Fake XP per role for the mock, so its members show levels and two roles sit just below a level-up. */
export const MOCK_XP: Partial<Record<Role, number>> = { orchestrator: 150, coordinator: 95, architect: 210, implementer: 330, reviewer: 120, researcher: 50, writer: 30, ops: 85 };

/** Totals for the stats decorator when it wraps the mock. Never written to a file. */
export function mockTotals(): StatsSnapshot {
  return {
    roles: Object.fromEntries(Object.entries(MOCK_XP).map(([role, xp]) => [role, { xp, tasks: Math.floor(xp / 30), workingMs: xp * 30_000, blockedMs: 0, messages: 0, tools: {} }])),
    lifetime: { tasks: 0, quests: 0, workingMs: 0, blockedMs: 0, messages: 0 },
  };
}

/**
 * A party shaped like one a runner draws: a worktree workspace whose lead sits idle, one leaf at work and one leaf
 * finished (named, shown `done`). It is fixed: the random walk never touches it.
 */
const RUNNER_PARTY = 'fix-login (runner)';

/** The scripted quest: the docs-site party works and finishes in the first half minute, so a level-up and a recap show early. */
const DEMO_PARTY = 'docs-site';
/** Step numbers (odd, so they never meet the every-sixth git drift) at which each member starts and finishes. */
const DEMO_START = [3, 5, 7] as const;
const DEMO_DONE = [9, 11, 13] as const;
/** After the script the party rejoins the random walk. */
const DEMO_FREE_AFTER = 24;

/**
 * The fleet in the mock: a master over the three projects (api, docs, infra). Its workspace has no repo, and each project
 * has a node, a non-agent pane tagged as an orchestrator (the api one is the orchestrator the mock already has). All of it
 * is scripted by step number and draws nothing from the random stream, and `fleet: false` leaves the mock exactly as it was.
 */
const FLEET_PARTY = 'w8';
const FLEET_LEAD = { partyId: FLEET_PARTY, paneId: `${FLEET_PARTY}:p1` };
/** Project nodes in the order the lead visits them: api (the mock's own orchestrator), docs, infra. */
const FLEET_NODES = [
  { partyId: 'w1', paneId: 'w1:p1' },
  { partyId: 'w9', paneId: 'w9:p1' },
  { partyId: 'w10', paneId: 'w10:p1' },
] as const;
const FLEET_PARTIES = new Set([FLEET_PARTY, 'w9', 'w10']);
/** The coordinator that escalates to the lead, once. */
const FLEET_COORD = { partyId: 'w2', paneId: 'w2:p1' };
const FLEET_LINES = ['Prioritise the auth work', 'Docs can wait until Friday', 'Hold the deploy for now'];
/** The lead sends a line to one project this often (steps), starting at the first. */
const FLEET_EVERY = 44;
const FLEET_FIRST = 14;
/** One escalation: the coordinator blocks and tells the lead, the lead blocks for a few steps, then both go on. */
const ESCALATE = { block: 25, say: 26, leadBlocked: 28, leadWorking: 31, coordWorking: 35 } as const;
/** The lead once sends to all three projects in the same moment: one trip with three stops. */
const FLEET_BROADCAST = 40;

const AGENTS = ['claude', 'claude', 'copilot', 'codex'] as const;

const LINES: Partial<Record<Role, string[]>> = {
  coordinator: ['Handing off the next task', 'Two branches left to merge', 'Checking in on the team'],
  architect: ['Sketching the module split', 'This needs an interface', 'Reading the schema'],
  implementer: ['Tests are green', 'Fixing a flaky test', 'Wiring up the handler'],
  reviewer: ['Left three comments', 'Looks good to me', 'Can we name this better?'],
  researcher: ['Found the upstream issue', 'Comparing two libraries'],
  writer: ['Drafting the README', 'Tightening the intro'],
  ops: ['Pipeline is running', 'Bumping the runner image'],
  orchestrator: ['Starting a new worktree', 'Reviewing the plan'],
};

/** Weighted next-status table: mostly working/idle, sometimes done, rarely blocked. */
const NEXT: Record<Status, [Status, number][]> = {
  working: [['working', 3], ['done', 2], ['idle', 1], ['blocked', 1]],
  done: [['idle', 3], ['working', 2]],
  blocked: [['working', 3], ['blocked', 1]],
  idle: [['working', 4], ['idle', 2]],
  unknown: [['idle', 1], ['working', 1]],
};

function weighted(rng: () => number, table: [Status, number][]): Status {
  const total = table.reduce((n, [, w]) => n + w, 0);
  let roll = rng() * total;
  for (const [status, w] of table) {
    roll -= w;
    if (roll < 0) return status;
  }
  return table[table.length - 1]![0];
}

export interface MockOptions {
  seed?: number;
  machine?: string;
  /** Add a fleet lead over the projects (default true). `false` is the mock as it was before fleets existed. */
  fleet?: boolean;
}

/**
 * Deterministic world generator. `initial()` builds a starting World and
 * `step()` returns the next Delta. No timers, so tests can drive it directly.
 */
export class MockGenerator {
  private rng: () => number;
  private world: World;
  private seq = 0;
  private toolSeq = 0;
  /** The usage quota is the account's, so every agent sees the same number; it only goes down. */
  private quota = 78;
  private gitRng: () => number;
  private steps = 0;
  private readonly fleet: boolean;
  /** Deltas a scripted step produced beyond the one `step()` returns; the timer source emits them in the same tick. */
  private extra: Delta[] = [];

  constructor(opts: MockOptions = {}) {
    this.fleet = opts.fleet !== false;
    this.rng = createRng(opts.seed ?? 1);
    this.gitRng = createRng((opts.seed ?? 1) + 1000);
    this.world = emptyWorld(opts.machine ?? 'local');
  }

  initial(t = 0): Delta {
    const parties: Record<string, Party> = {};
    PARTIES.forEach((seed, i) => {
      const id = `w${i + 1}`;
      const members: Record<string, Member> = {};
      seed.roles.forEach((role, j) => {
        const paneId = `${id}:p${j + 1}`;
        const member: Member = {
          paneId,
          agent: pick(this.rng, AGENTS),
          role,
          status: seed.label === DEMO_PARTY ? 'idle' : pick(this.rng, ['working', 'working', 'idle', 'done'] as const),
          title: role,
          lastChange: this.seq++,
        };
        // Only Claude Code reports vitals today, so the mock gives them to its claude agents alone.
        if (member.agent === 'claude') {
          member.vitals = { context: 6 + Math.floor(this.rng() * 94), quota: this.quota, at: t };
          member.model = pick(this.rng, MODELS);
          member.effort = pick(this.rng, EFFORTS);
          const quest = QUESTS[seed.label];
          if (quest) member.quest = quest;
        }
        if (member.status === 'working') member.tool = TOOLS[this.toolSeq++ % TOOLS.length];
        members[paneId] = member;
      });
      parties[id] = {
        id,
        label: seed.label,
        session: 'default',
        repo: seed.repo,
        branch: seed.branch,
        isWorktree: seed.branch !== undefined,
        status: 'unknown',
        members,
        tokens: {},
        git: { ...MOCK_GIT[i % MOCK_GIT.length]! },
      };
    });
    const rid = `w${PARTIES.length + 1}`;
    const leaf = (n: number, role: Role, status: Status, extra: Partial<Member> = {}): Member => ({ paneId: `${rid}:p${n}`, agent: 'copilot', role, status, lastChange: this.seq++, ...extra });
    parties[rid] = {
      id: rid,
      label: RUNNER_PARTY,
      session: 'default',
      repo: 'api',
      branch: 'feat/fix-login',
      isWorktree: true,
      status: 'unknown',
      members: Object.fromEntries(
        [
          leaf(1, 'coordinator', 'idle', { name: 'Lead' }),
          leaf(2, 'implementer', 'working', { tool: 'Edit', name: 'Rook' }),
          leaf(3, 'reviewer', 'done', { name: 'Quill', title: 'Review finished' }),
        ].map((m) => [m.paneId, m]),
      ),
      tokens: {},
      git: { dirty: 2, ahead: 1, noRemote: false },
    };
    if (this.fleet) this.addFleet(parties);
    const delta: Delta = { t, kind: 'snapshot', world: { machine: this.world.machine, parties } };
    this.world = applyDelta(this.world, delta);
    return delta;
  }

  /** The fleet workspace and the project nodes. Built last, from fixed values, so the random stream is untouched. */
  private addFleet(parties: Record<string, Party>): void {
    const api = parties.w1?.members['w1:p1'];
    if (api) api.name = 'api';
    parties[FLEET_PARTY] = {
      id: FLEET_PARTY,
      label: 'fleet',
      session: 'default',
      isWorktree: false,
      status: 'unknown',
      members: {
        [FLEET_LEAD.paneId]: { paneId: FLEET_LEAD.paneId, agent: 'claude', role: 'orchestrator', scope: 'fleet', status: 'working', name: 'Fleet lead', title: 'Watching the projects', vitals: { context: 64, quota: this.quota, at: 0 }, model: 'Opus 5.5', effort: 'high', lastChange: this.seq++ },
      },
      tokens: {},
      git: { dirty: 0, ahead: 0, noRemote: false },
    };
    for (const [id, name] of [['w9', 'docs'], ['w10', 'infra']] as const) {
      parties[id] = {
        id,
        label: name,
        session: 'default',
        repo: name,
        isWorktree: false,
        status: 'unknown',
        members: { [`${id}:p1`]: { paneId: `${id}:p1`, agent: 'shell', role: 'orchestrator', status: 'idle', name, lastChange: this.seq++ } },
        tokens: {},
        git: { dirty: 0, ahead: 0, noRemote: false },
      };
    }
  }

  /** Current world after every delta handed out so far. */
  get current(): World {
    return this.world;
  }

  /** Every sixth step: one party's git counts move (a commit, an edit, a push). */
  private driftGit(t: number): Delta {
    const party = pick(this.gitRng, Object.values(this.world.parties));
    const g = party.git ?? { dirty: 0, ahead: 0, noRemote: false };
    const roll = this.gitRng();
    const git: GitState = roll < 0.4 ? { ...g, dirty: g.dirty + 1 } : roll < 0.6 ? { ...g, dirty: 0, ahead: g.noRemote ? 0 : g.ahead + 1 } : roll < 0.8 ? { ...g, ahead: 0 } : { ...g, dirty: Math.max(0, g.dirty - 2) };
    const delta: Delta = { t, kind: 'party', party: { ...party, git } };
    this.world = applyDelta(this.world, delta);
    return delta;
  }

  /** The scripted quest of the demo party at this step, if any: one member starts or finishes work. */
  private demo(t: number): Delta | undefined {
    const party = Object.values(this.world.parties).find((p) => p.label === DEMO_PARTY);
    if (!party) return undefined;
    const members = Object.values(party.members);
    const start = DEMO_START.indexOf(this.steps as 3);
    const done = DEMO_DONE.indexOf(this.steps as 9);
    const m = members[start >= 0 ? start : done];
    if (!m || (start < 0 && done < 0)) return undefined;
    const next: Member = { ...m, status: start >= 0 ? 'working' : 'done', say: undefined, lastChange: this.seq++ };
    if (start >= 0) next.tool = TOOLS[this.toolSeq++ % TOOLS.length];
    else delete next.tool;
    const delta: Delta = { t, kind: 'member', partyId: party.id, member: next };
    this.world = applyDelta(this.world, delta);
    return delta;
  }

  /** More deltas the last `step()` produced in the same moment, taken once. Empty for almost every step. */
  takeExtra(): Delta[] {
    return this.extra.splice(0);
  }

  private setStatus(who: { partyId: string; paneId: string }, status: Status, t: number): Delta | undefined {
    const m = this.world.parties[who.partyId]?.members[who.paneId];
    if (!m) return undefined;
    const next: Member = { ...m, status, say: undefined, lastChange: this.seq++ };
    const delta: Delta = { t, kind: 'member', partyId: who.partyId, member: next };
    this.world = applyDelta(this.world, delta);
    return delta;
  }

  private message(from: { partyId: string; paneId: string }, to: { partyId: string; paneId: string }, text: string, t: number): Delta {
    const delta: Delta = { t, kind: 'say', partyId: from.partyId, paneId: from.paneId, text, to: { ...to } };
    this.world = applyDelta(this.world, delta);
    return delta;
  }

  /** The scripted fleet behaviour at this step, if any. */
  private fleetStep(t: number): Delta | undefined {
    const n = this.steps;
    if (n === ESCALATE.block) return this.setStatus(FLEET_COORD, 'blocked', t);
    if (n === ESCALATE.say) return this.message(FLEET_COORD, FLEET_LEAD, 'Need a call on the token lifetime', t);
    if (n === ESCALATE.leadBlocked) return this.setStatus(FLEET_LEAD, 'blocked', t);
    if (n === ESCALATE.leadWorking) return this.setStatus(FLEET_LEAD, 'working', t);
    if (n === ESCALATE.coordWorking) return this.setStatus(FLEET_COORD, 'working', t);
    if (n === FLEET_BROADCAST) {
      const [first, ...rest] = FLEET_NODES.map((node, i) => this.message(FLEET_LEAD, node, FLEET_LINES[i]!, t));
      this.extra.push(...rest);
      return first;
    }
    if (n >= FLEET_FIRST && (n - FLEET_FIRST) % FLEET_EVERY === 0) {
      const i = ((n - FLEET_FIRST) / FLEET_EVERY) % FLEET_NODES.length;
      return this.message(FLEET_LEAD, FLEET_NODES[i]!, FLEET_LINES[i]!, t);
    }
    return undefined;
  }

  step(t = 0): Delta {
    this.steps++;
    if (this.fleet) {
      const scripted = this.fleetStep(t);
      if (scripted) return scripted;
    }
    if (this.steps % 6 === 0) return this.driftGit(t);
    const scripted = this.demo(t);
    if (scripted) return scripted;
    // While the scripted quest runs the demo party is left alone, so nothing disturbs it.
    const parties = Object.values(this.world.parties).filter((p) => p.label !== RUNNER_PARTY && (p.label !== DEMO_PARTY || this.steps > DEMO_FREE_AFTER) && !(this.fleet && FLEET_PARTIES.has(p.id)));
    const party = pick(this.rng, parties);
    const member = pick(this.rng, Object.values(party.members));
    const roll = this.rng();
    let delta: Delta;
    if (roll < 0.25 && member.status === 'working') {
      const lines = LINES[member.role] ?? ['Working on it'];
      delta = { t, kind: 'say', partyId: party.id, paneId: member.paneId, text: pick(this.rng, lines) };
    } else {
      const status = weighted(this.rng, NEXT[member.status]);
      const next: Member = { ...member, status, say: undefined, lastChange: this.seq++ };
      if (status === 'working') next.tool = TOOLS[this.toolSeq++ % TOOLS.length];
      else delete next.tool;
      if (member.vitals) {
        // Working eats context; at the bottom the agent compacts and starts over high.
        const used = status === 'working' ? 3 + Math.floor(this.rng() * 7) : 0;
        let context = (member.vitals.context ?? 100) - used;
        if (context <= 2) context = 90 + Math.floor(this.rng() * 8);
        if (this.rng() < 0.15) this.quota = Math.max(3, this.quota - 1);
        next.vitals = { context, quota: this.quota, at: t };
      }
      delta = { t, kind: 'member', partyId: party.id, member: next };
    }
    this.world = applyDelta(this.world, delta);
    return delta;
  }
}

export interface MockSourceOptions extends MockOptions {
  /** Milliseconds between deltas. */
  intervalMs?: number;
}

/** Timer-driven WorldSource over MockGenerator. Safe to use in the browser. */
export class MockSource extends BaseSource {
  private gen: MockGenerator;
  private timer: ReturnType<typeof setInterval> | undefined;
  private intervalMs: number;

  constructor(opts: MockSourceOptions = {}) {
    super();
    this.gen = new MockGenerator(opts);
    this.intervalMs = opts.intervalMs ?? 1500;
  }

  async start(): Promise<void> {
    this.emit(this.gen.initial(Date.now()));
    this.timer = setInterval(() => {
      this.emit(this.gen.step(Date.now()));
      for (const d of this.gen.takeExtra()) this.emit(d);
    }, this.intervalMs);
  }

  async stop(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }
}
