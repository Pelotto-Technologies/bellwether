// Scripted delta feeds for the README screenshots and GIFs. No Herdr, no real repos:
// every name here is made up, so the recordings are safe to publish as they are.

const T0 = 1_800_000_000_000;

function member(paneId, role, agent, status, extra = {}) {
  return { paneId, agent, role, status, lastChange: 0, ...extra };
}

function party(id, label, repo, branch, isWorktree, members, session = 'default') {
  const ms = Object.fromEntries(members.map((m) => [m.paneId, m]));
  return { id, label, session, repo, ...(branch ? { branch } : {}), isWorktree, status: rollup(members), members: ms, tokens: {} };
}

function rollup(members) {
  const s = members.map((m) => m.status);
  for (const k of ['blocked', 'working', 'done', 'idle']) if (s.includes(k)) return k;
  return 'unknown';
}

/** A busy afternoon: one orchestrated repo with three worktrees, a second repo with two parties, and a solo ops pane. */
export function busyWorld() {
  const atlas = '/src/atlas';
  const pixel = '/src/pixel-web';
  const infra = '/src/infra';
  return {
    machine: 'local',
    parties: {
      w1: party('w1', 'atlas Orchestration', atlas, 'main', false, [member('w1:p1', 'orchestrator', 'claude', 'working')]),
      w2: party('w2', 'atlas', atlas, 'auth', true, [
        member('w2:p1', 'architect', 'claude', 'done'),
        member('w2:p2', 'implementer', 'claude', 'working'),
        member('w2:p3', 'reviewer', 'copilot', 'idle'),
      ]),
      w3: party('w3', 'atlas', atlas, 'search', true, [
        member('w3:p1', 'researcher', 'copilot', 'working'),
        member('w3:p2', 'implementer', 'codex', 'working'),
      ]),
      w4: party('w4', 'atlas', atlas, 'billing', true, [
        member('w4:p1', 'implementer', 'claude', 'blocked', { say: 'Need a Stripe test key to go on' }),
        member('w4:p2', 'writer', 'copilot', 'done'),
      ]),
      w5: party('w5', 'pixel-web', pixel, 'main', false, [
        member('w5:p1', 'coordinator', 'copilot', 'working'),
        member('w5:p2', 'implementer', 'copilot', 'working'),
        member('w5:p3', 'reviewer', 'claude', 'done'),
      ]),
      w6: party('w6', 'pixel-web', pixel, 'dark-mode', true, [member('w6:p1', 'implementer', 'claude', 'idle')]),
      w7: party('w7', 'infra', infra, 'main', false, [member('w7:p1', 'ops', 'codex', 'working'), member('w7:p2', 'generic', 'copilot', 'idle')]),
    },
  };
}

/** Static scene: snapshot, then the same few speech lines on repeat so bubbles are up whenever a shot is taken. */
export function stillFeed({ addressed = true } = {}) {
  const world = busyWorld();
  const d = [{ t: T0, kind: 'snapshot', world }];
  for (let i = 0; i < 60; i++) {
    const t = T0 + 300 + i * 4000;
    d.push({ t, kind: 'say', partyId: 'w5', paneId: 'w5:p1', text: 'Footer next' });
    d.push({ t: t + 100, kind: 'say', partyId: 'w4', paneId: 'w4:p1', text: 'Need a Stripe test key to go on' });
    d.push({ t: t + 200, kind: 'say', partyId: 'w1', paneId: 'w1:p1', text: 'Add ranking tests', ...(addressed ? { to: { partyId: 'w3', paneId: 'w3:p2' } } : {}) });
  }
  d.push({ t: T0 + 600_000, kind: 'say', partyId: 'w7', paneId: 'w7:p1', text: 'zzz' });
  return d;
}

/** Animated story for GIFs: a small crew, then new arrivals, a hand-off, a block and a fix. */
export function storyFeed() {
  const full = busyWorld();
  const start = { machine: 'local', parties: { w1: full.parties.w1, w5: full.parties.w5 } };
  let t = T0;
  const d = [{ t, kind: 'snapshot', world: start }];
  const at = (ms, delta) => d.push({ t: (t += ms), ...delta });
  at(1200, { kind: 'say', partyId: 'w1', paneId: 'w1:p1', text: 'Splitting auth into its own worktree' });
  at(1200, { kind: 'party', party: full.parties.w2 });
  at(1800, { kind: 'party', party: full.parties.w3 });
  at(1500, { kind: 'say', partyId: 'w5', paneId: 'w5:p1', text: 'Footer next, then dark mode' });
  at(1500, { kind: 'member', partyId: 'w2', member: member('w2:p2', 'implementer', 'claude', 'done') });
  at(300, { kind: 'say', partyId: 'w2', paneId: 'w2:p2', text: 'Login flow done, over to review' });
  at(1200, { kind: 'member', partyId: 'w2', member: member('w2:p3', 'reviewer', 'copilot', 'working') });
  at(1500, { kind: 'party', party: full.parties.w4 });
  at(1800, { kind: 'say', partyId: 'w4', paneId: 'w4:p1', text: 'Need a Stripe test key to go on' });
  at(2500, { kind: 'member', partyId: 'w4', member: member('w4:p1', 'implementer', 'claude', 'working') });
  at(300, { kind: 'say', partyId: 'w4', paneId: 'w4:p1', text: 'Got it, thanks' });
  at(1500, { kind: 'say', partyId: 'w1', paneId: 'w1:p1', text: 'Billing is unblocked, wire up webhooks', to: { partyId: 'w4', paneId: 'w4:p1' } });
  at(2000, { kind: 'party', party: full.parties.w7 });
  at(600_000, { kind: 'say', partyId: 'w7', paneId: 'w7:p1', text: 'zzz' });
  return d;
}

/** One solo party per role, labelled with the role, for each pack's cast line-up. */
export function castFeed() {
  const roles = ['orchestrator', 'coordinator', 'architect', 'implementer', 'reviewer', 'researcher', 'writer', 'ops', 'generic'];
  const parties = Object.fromEntries(
    roles.map((role, i) => [`c${i}`, party(`c${i}`, role, `/src/${role}`, undefined, false, [member(`c${i}:p1`, role, 'claude', 'idle')])]),
  );
  return [{ t: T0, kind: 'snapshot', world: { machine: 'local', parties } }, { t: T0 + 600_000, kind: 'snapshot', world: { machine: 'local', parties } }];
}

/** A crowded strip: many small parties across made-up repos, enough to fill several depth rows. */
export function crowdFeed(count = 32) {
  const repos = ['atlas', 'pixel-web', 'infra', 'ledger', 'harbor', 'quill', 'orbit', 'sprout'];
  const branches = ['auth', 'search', 'billing', 'docs', 'perf', 'i18n', 'cache', 'ci', 'export', 'onboarding'];
  const roles = ['coordinator', 'architect', 'implementer', 'reviewer', 'researcher', 'writer', 'ops', 'implementer'];
  const statuses = ['working', 'working', 'working', 'idle', 'done'];
  const parties = {};
  for (let i = 0; i < count; i++) {
    const id = `k${i}`;
    const repo = repos[i % repos.length];
    const branch = branches[(i * 3) % branches.length];
    const size = 1 + ((i * 7) % 3);
    const ms = Array.from({ length: size }, (_, j) => member(`${id}:p${j}`, roles[(i + j * 3) % roles.length], 'claude', statuses[(i + j) % statuses.length]));
    parties[id] = party(id, repo, `/src/${repo}-${i}`, branch, true, ms);
  }
  const world = { machine: 'local', parties };
  return [{ t: T0, kind: 'snapshot', world }, { t: T0 + 600_000, kind: 'snapshot', world }];
}

export const toJsonl = (deltas) => deltas.map((x) => JSON.stringify(x)).join('\n') + '\n';
