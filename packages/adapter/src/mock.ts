import { createRng, pick } from './random.js';
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

  constructor(opts: MockOptions = {}) {
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
          status: pick(this.rng, ['working', 'working', 'idle', 'done'] as const),
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
    const delta: Delta = { t, kind: 'snapshot', world: { machine: this.world.machine, parties } };
    this.world = applyDelta(this.world, delta);
    return delta;
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

  step(t = 0): Delta {
    if (++this.steps % 6 === 0) return this.driftGit(t);
    const parties = Object.values(this.world.parties);
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
    this.timer = setInterval(() => this.emit(this.gen.step(Date.now())), this.intervalMs);
  }

  async stop(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }
}
