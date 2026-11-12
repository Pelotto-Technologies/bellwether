import { applyDelta, emptyWorld, MockGenerator, type Delta, type Member, type Party, type World } from '@bellwether/adapter/core';
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { EventCore, namesProjects } from '../src/cues/events.js';
import { toastFor } from '../src/cues/toasts.js';
import { FeedState } from '../src/feed.js';
import { groupFellowships } from '../src/fellowship.js';
import { describeFleet, fleetLeads, fleetRollup, hubBeacon, settlementStatuses, splitFleet, withoutFleet } from '../src/fleet.js';
import { layoutMap } from '../src/map/layout.js';
import { isJourney, nodeOf } from '../src/map/place.js';
import { buildTerrain } from '../src/map/terrain.js';

const member = (paneId: string, over: Partial<Member> = {}): Member => ({ paneId, agent: 'claude', role: 'implementer', status: 'idle', lastChange: 0, ...over });
const lead = (paneId: string, over: Partial<Member> = {}): Member => member(paneId, { role: 'orchestrator', scope: 'fleet', ...over });
const party = (id: string, repo: string | undefined, members: Member[], over: Partial<Party> = {}): Party => ({
  id,
  label: id,
  ...(repo ? { repo } : {}),
  isWorktree: !!repo,
  status: 'idle',
  members: Object.fromEntries(members.map((m) => [m.paneId, m])),
  tokens: {},
  ...over,
});
const worldOf = (...ps: Party[]): World => ({ machine: 'local', parties: Object.fromEntries(ps.map((p) => [p.id, p])) });

describe('splitFleet', () => {
  it('is the identity without a fleet lead: the very same world', () => {
    const w = worldOf(party('a', '/r/api', [member('1')]), party('b', '/r/api', [member('2', { role: 'orchestrator' })]));
    expect(splitFleet(w).world).toBe(w);
    expect(splitFleet(w).leads).toEqual([]);
    expect(withoutFleet(w.parties.a!)).toBe(w.parties.a);
  });

  it('drops the fleet workspace, so it is never a settlement or a camp', () => {
    const w = worldOf(party('fleet', undefined, [lead('f1')]), party('a', '/r/api', [member('1')]));
    const s = splitFleet(w);
    expect(Object.keys(s.world.parties)).toEqual(['a']);
    expect(s.leads.map((l) => l.member.paneId)).toEqual(['f1']);
    const l = layoutMap(s.world, [], { hub: true });
    expect(l.settlements.map((x) => x.name)).toEqual(['api']);
    expect(l.camps.size).toBe(1);
  });

  it('lifts a lead out of an ordinary repo workspace and keeps the rest of that party', () => {
    const w = worldOf(party('a', '/r/api', [member('1', { status: 'working' }), lead('f1', { status: 'blocked' })], { status: 'blocked' }));
    const s = splitFleet(w);
    expect(Object.keys(s.world.parties.a!.members)).toEqual(['1']);
    expect(s.world.parties.a!.status).toBe('working');
    expect(s.leads[0]).toMatchObject({ partyId: 'a' });
  });

  it('several leads all stand at the hub, in stable id order, without an error', () => {
    const w = worldOf(party('z', undefined, [lead('f9')]), party('a', undefined, [lead('f2'), lead('f1')]), party('r', '/r/x', [member('1')]));
    expect(fleetLeads(w).map((l) => l.member.paneId)).toEqual(['f1', 'f2', 'f9']);
    expect(groupFellowships(w, { leadAlone: true }).fleet).toHaveLength(3);
  });

  it('a fleet lead is never a repo leader: the repo keeps its own orchestrator and fellowship', () => {
    const w = worldOf(
      party('fleet', undefined, [lead('f1')]),
      party('root', '/r/api', [member('node', { role: 'orchestrator', name: 'api' })], { isWorktree: false }),
      party('wt', '/r/api', [member('1')]),
    );
    const v = groupFellowships(w, { leadAlone: true });
    expect(v.fellowships).toHaveLength(1);
    expect(v.fellowships[0]!.leaders.map((l) => l.member.paneId)).toEqual(['node']);
    expect(v.fleet.map((l) => l.member.paneId)).toEqual(['f1']);
    expect(v.world.parties.fleet).toBeUndefined();
  });

  it('a role other than orchestrator never counts, even with the scope', () => {
    const w = worldOf(party('a', '/r/api', [member('1', { scope: 'fleet' })]));
    expect(splitFleet(w).world).toBe(w);
  });
});

describe('fleet rollup', () => {
  const w = worldOf(
    party('api-root', '/r/api', [member('node', { role: 'orchestrator', status: 'idle' })], { isWorktree: false }),
    party('api-1', '/r/api', [member('c', { role: 'coordinator', status: 'idle' }), member('i', { status: 'working' })]),
    party('docs-1', '/r/docs', [member('w', { role: 'writer', status: 'done' }), member('u', { status: 'unknown' })]),
    party('infra-1', '/r/infra', [member('o', { role: 'ops', status: 'blocked' }), member('d', { status: 'done' })]),
    party('quiet', '/r/quiet', [member('c', { role: 'coordinator', status: 'idle' }), member('n', { role: 'orchestrator', status: 'idle' }), member('x', { status: 'unknown' })]),
  );

  it('is the worst member of the repo by the party precedence: blocked > done > working > idle > unknown', () => {
    const by = Object.fromEntries(settlementStatuses(w).map((s) => [s.name, s.status]));
    expect(by).toEqual({ api: 'working', docs: 'done', infra: 'blocked', quiet: 'idle' });
  });

  it('long-idle coordinators and idle nodes never make a settlement look busy, and unknown never outranks anything', () => {
    const quiet = settlementStatuses(w).find((s) => s.name === 'quiet')!;
    expect(quiet.status).toBe('idle');
    expect(quiet.status).not.toBe('working');
    const onlyUnknown = settlementStatuses(worldOf(party('p', '/r/u', [member('1', { status: 'unknown' })])))[0]!;
    expect(onlyUnknown.status).toBe('unknown');
    const withIdle = settlementStatuses(worldOf(party('p', '/r/u', [member('1', { status: 'unknown' }), member('2', { status: 'idle' })])))[0]!;
    expect(withIdle.status).toBe('idle');
    // Idle and unknown sit below done, working and blocked, whatever else is in the repo.
    for (const s of ['done', 'working', 'blocked'] as const) {
      const r = settlementStatuses(worldOf(party('p', '/r/u', [member('1', { role: 'coordinator', status: 'idle' }), member('2', { status: 'unknown' }), member('3', { status: s })])))[0]!;
      expect(r.status).toBe(s);
    }
  });

  it('the fleet is the worst settlement; no settlement is unknown', () => {
    expect(fleetRollup(settlementStatuses(w))).toBe('blocked');
    expect(fleetRollup([])).toBe('unknown');
    expect(fleetRollup([{ status: 'idle' }, { status: 'working' }])).toBe('working');
  });

  it('the hub beacon is the worse of the fleet and its lead: a blocked lead shows over calm camps, and the reverse', () => {
    const lead1 = (status: Member['status']) => [{ partyId: 'f', member: lead('f1', { status }) }];
    expect(hubBeacon('working', lead1('blocked'))).toBe('blocked');
    expect(hubBeacon('blocked', lead1('working'))).toBe('blocked');
    expect(hubBeacon('done', lead1('idle'))).toBe('done');
    expect(hubBeacon('unknown', lead1('idle'))).toBe('idle');
    expect(hubBeacon('idle', [...lead1('working'), ...lead1('blocked')])).toBe('blocked');
  });

  it('describes the hub panel: the lead, and a one-line status per project', () => {
    const f = worldOf(party('fleet', undefined, [lead('f1', { name: 'Orion', status: 'blocked', say: 'Waiting on you' })]), ...Object.values(w.parties));
    const s = splitFleet(f);
    const d = describeFleet(s.world, s.leads, 1000);
    expect(d).toMatchObject({ title: 'Fleet', status: 'blocked' });
    expect(d.subtitle).toBe('4 projects · 10 agents');
    expect(d.leads).toEqual([{ paneId: 'f1', label: 'Orion · fleet lead', status: 'blocked', line: 'Waiting on you' }]);
    expect(d.settlements.find((r) => r.name === 'infra')).toMatchObject({ status: 'blocked', line: '1 blocked · 1 done' });
    expect(d.settlements.map((r) => r.name)).toEqual(['api', 'docs', 'infra', 'quiet']);
  });
});

describe('a world with no fleet draws as it always did', () => {
  const g = new MockGenerator({ seed: 1, fleet: false });
  const first = g.initial(0);
  const world = first.kind === 'snapshot' ? first.world : emptyWorld();
  const sum = (v: unknown) => createHash('sha1').update(JSON.stringify(v)).digest('hex').slice(0, 12);

  it('has the same layout and terrain as before the fleet existed (checksums taken from the previous code)', () => {
    const expected = ['c47288af477e', 'fc57a8b11aed', '2a8ccc09c857'];
    [[], ['/r/solo'], ['x', 'y', 'z']].forEach((extra, i) => {
      const l = layoutMap(world, extra);
      const t = buildTerrain(l);
      expect(l.hub).toBeUndefined();
      expect(sum([l.signature, t.ground, t.scenery])).toBe(expected[i]);
    });
  });

  it('groups fellowships as before and exposes no fleet', () => {
    const v = groupFellowships(world, { leadAlone: true });
    expect(v.fleet).toEqual([]);
    expect(v.fellowships.map((f) => f.name)).toEqual(['api']);
    expect(Object.keys(v.world.parties)).toContain('w2');
    expect(namesProjects(world)).toBe(true); // three repos: api, docs, infra, as before
  });

  it('with the fleet on, the map gains the hub and nothing else moves', () => {
    const on = new MockGenerator({ seed: 1 }).initial(0);
    const onWorld = on.kind === 'snapshot' ? on.world : emptyWorld();
    const base = layoutMap(splitFleet(onWorld).world, groupFellowships(onWorld, { leadAlone: true }).fellowships.map((f) => f.key.slice(f.key.indexOf('|') + 1)));
    const withHub = layoutMap(splitFleet(onWorld).world, groupFellowships(onWorld, { leadAlone: true }).fellowships.map((f) => f.key.slice(f.key.indexOf('|') + 1)), { hub: true });
    expect(withHub.settlements).toEqual(base.settlements);
    expect(withHub.hub).toBeDefined();
  });
});

describe('alerts name the project only when there is a fleet or more than one', () => {
  const snap = (...ps: Party[]): Delta => ({ t: 0, kind: 'snapshot', world: worldOf(...ps) });
  const start = (d: Delta) => applyDelta(emptyWorld(), d);

  it('keeps the old text for a lone project', () => {
    const core = new EventCore({ quietMs: 0 });
    const w = start(snap(party('auth', '/r/api', [member('a', { role: 'reviewer', status: 'working' })])));
    const out = core.process(w, { t: 5, kind: 'member', partyId: 'auth', member: member('a', { role: 'reviewer', name: 'Quill', status: 'done' }) }, 10);
    expect(toastFor(out[0]!)?.text).toBe('Quill (reviewer) finished · auth');
  });

  it('adds the settlement when there is a fleet lead', () => {
    const core = new EventCore({ quietMs: 0 });
    const w = start(snap(party('fleet', undefined, [lead('f1')]), party('auth', '/r/api', [member('a', { role: 'reviewer', status: 'working' })])));
    const out = core.process(w, { t: 5, kind: 'member', partyId: 'auth', member: member('a', { role: 'reviewer', name: 'Quill', status: 'done' }) }, 10);
    expect(toastFor(out[0]!)?.text).toBe('Quill (reviewer) finished · auth · api');
  });

  it('adds it for two projects, skips it when it is the party name, and truncates', () => {
    const core = new EventCore({ quietMs: 0 });
    const w = start(snap(party('api', '/r/api', [member('a', { status: 'working' })]), party('docs-1', '/r/docs', [member('b', { status: 'working' })])));
    const blocked = core.process(w, { t: 5, kind: 'member', partyId: 'docs-1', member: member('b', { status: 'blocked' }) }, 10);
    expect(toastFor(blocked[0]!)?.text).toBe('implementer needs you · docs-1 · docs');
    const same = core.process(w, { t: 6, kind: 'member', partyId: 'api', member: member('a', { status: 'blocked' }) }, 20);
    expect(toastFor(same[0]!)?.text).toBe('implementer needs you · api');
    expect(toastFor({ kind: 'blocked', at: 0, role: 'ops', label: 'x', settlement: 'p'.repeat(90) })!.text).toBe(`ops needs you · x · ${'p'.repeat(27)}…`);
  });

  it('a fleet lead\'s own alerts carry no project', () => {
    const core = new EventCore({ quietMs: 0 });
    const w = start(snap(party('fleet', undefined, [lead('f1', { status: 'working' })]), party('p', '/r/api', [member('a')])));
    const out = core.process(w, { t: 5, kind: 'member', partyId: 'fleet', member: lead('f1', { status: 'blocked' }) }, 10);
    expect(toastFor(out[0]!)?.text).toBe('orchestrator needs you · fleet');
  });

  it('a blocked member that tells the lead raises "needs you" once, in either order', () => {
    const base = snap(party('fleet', undefined, [lead('f1')]), party('p', '/r/api', [member('a', { status: 'working' })]));
    const toLead: Delta = { t: 6, kind: 'say', partyId: 'p', paneId: 'a', text: 'Which flow?', to: { partyId: 'fleet', paneId: 'f1' } };
    const block: Delta = { t: 5, kind: 'member', partyId: 'p', member: member('a', { status: 'blocked' }) };
    for (const order of [[block, toLead], [toLead, block]] as const) {
      const core = new EventCore({ quietMs: 0 });
      let w = start(base);
      const toasts: string[] = [];
      let now = 10;
      for (const d of order) {
        if (d === toLead && order[0] === toLead) w = applyDelta(w, { t: 4, kind: 'member', partyId: 'p', member: member('a', { status: 'blocked' }) });
        for (const e of core.process(w, d, (now += 100))) {
          const t = toastFor(e);
          if (t) toasts.push(t.text);
        }
        w = applyDelta(w, d);
      }
      expect(toasts).toEqual(['implementer needs you · p · api']);
    }
  });

  it('a say to the lead from a member that is not blocked is a plain message', () => {
    const core = new EventCore({ quietMs: 0 });
    const w = start(snap(party('fleet', undefined, [lead('f1')]), party('p', '/r/api', [member('a', { status: 'working' })])));
    const out = core.process(w, { t: 6, kind: 'say', partyId: 'p', paneId: 'a', text: 'FYI', to: { partyId: 'fleet', paneId: 'f1' } }, 10);
    expect(out.map((e) => e.kind)).toEqual(['message']);
  });
});

describe('FeedState and couriers', () => {
  it('hands lines to the map once, lets a journey take one back and deliver it with its full TTL', () => {
    const feed = new FeedState(5000);
    const w = worldOf(party('x', '/r/api', [member('a')]), party('y', '/r/docs', [member('b')]));
    feed.apply({ t: 0, kind: 'snapshot', world: w }, 0);
    feed.apply({ t: 1, kind: 'say', partyId: 'x', paneId: 'a', text: 'Ship it', to: { partyId: 'y', paneId: 'b' } }, 1000);
    const [entry] = feed.drainSays();
    expect(entry).toMatchObject({ partyId: 'x', paneId: 'a', text: 'Ship it' });
    expect(feed.drainSays()).toEqual([]);
    expect(feed.say('x', 'a', 1500)).toBe('@implementer Ship it');
    feed.retract(entry!);
    expect(feed.say('x', 'a', 1500)).toBeUndefined();
    expect(feed.talking('x', 'a', 1500)).toBe(false);
    // It arrives 12 seconds later: the bubble lives its normal 5 seconds from then.
    feed.deliver(entry!, 13_000);
    expect(feed.say('x', 'a', 17_000)).toBe('@implementer Ship it');
    expect(feed.say('x', 'a', 18_100)).toBeUndefined();
  });

  it('a newer line is not taken back by the old one, and a snapshot forgets everything', () => {
    const feed = new FeedState(5000);
    feed.apply({ t: 0, kind: 'snapshot', world: worldOf(party('x', '/r/api', [member('a')])) }, 0);
    feed.apply({ t: 1, kind: 'say', partyId: 'x', paneId: 'a', text: 'one' }, 0);
    feed.apply({ t: 2, kind: 'say', partyId: 'x', paneId: 'a', text: 'two' }, 0);
    const [one, two] = feed.drainSays();
    feed.retract(one!);
    expect(feed.say('x', 'a', 10)).toBe('two');
    feed.apply({ t: 3, kind: 'say', partyId: 'x', paneId: 'a', text: 'three' }, 0);
    const e = feed.epoch;
    feed.apply({ t: 4, kind: 'snapshot', world: emptyWorld() }, 0);
    expect(feed.epoch).toBe(e + 1);
    expect(feed.drainSays()).toEqual([]);
    expect(two).toBeDefined();
  });
});

describe('places and journeys', () => {
  const w = worldOf(
    party('fleet', undefined, [lead('f1')]),
    party('root', '/r/api', [member('node', { role: 'orchestrator', name: 'api' })], { isWorktree: false }),
    party('wt', '/r/api', [member('i1'), member('i2')]),
    party('wt2', '/r/docs', [member('d1')]),
  );
  const l = layoutMap(splitFleet(w).world, ['/r/api'], { hub: true });

  it('puts a fleet lead at the hub, a project node at its settlement, anyone else at its camp', () => {
    expect(nodeOf(w, l, 'fleet', 'f1')).toBe('hub');
    expect(nodeOf(w, l, 'root', 'node')).toBe('s:/r/api');
    expect(nodeOf(w, l, 'wt', 'i1')).toBe('c:wt');
    expect(nodeOf(w, l, 'wt', 'nobody')).toBeUndefined();
    expect(nodeOf(w, { ...l, hub: undefined }, 'fleet', 'f1')).toBeUndefined();
  });

  it('a message makes a journey between parties, and to or from the lead; within a party it does not', () => {
    const a = (partyId: string, paneId: string) => ({ partyId, paneId });
    expect(isJourney(w, a('wt', 'i1'), a('wt2', 'd1'))).toBe(true);
    expect(isJourney(w, a('fleet', 'f1'), a('root', 'node'))).toBe(true);
    expect(isJourney(w, a('root', 'node'), a('fleet', 'f1'))).toBe(true);
    expect(isJourney(w, a('wt', 'i1'), a('wt', 'i2'))).toBe(false);
    expect(isJourney(w, a('wt', 'i1'), a('wt', 'i1'))).toBe(false);
    expect(isJourney(w, a('wt', 'i1'), a('wt', 'ghost'))).toBe(false);
  });
});
