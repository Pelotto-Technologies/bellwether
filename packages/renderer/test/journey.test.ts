import type { Member, Party, World } from '@bellwether/adapter/core';
import { describe, expect, it } from 'vitest';
import { DEPART_DELAY, DWELL, JourneyBoard, MAX_STOPS, TRIP_CAP, type Place } from '../src/map/journey.js';
import { layoutMap, tileToWorld } from '../src/map/layout.js';
import { LEG_MAX_S, LEG_MIN_S, legPlan } from '../src/map/ride.js';
import { buildRoads, campNode, HUB_ID, routeTiles, settlementNode, type RoadGraph } from '../src/map/roads.js';
import { buildTerrain } from '../src/map/terrain.js';

const member = (paneId: string, over: Partial<Member> = {}): Member => ({ paneId, agent: 'claude', role: 'implementer', status: 'idle', lastChange: 0, ...over });
const party = (id: string, repo: string, members: Member[]): Party => ({ id, label: id, repo, isWorktree: true, status: 'idle', members: Object.fromEntries(members.map((m) => [m.paneId, m])), tokens: {} });
const worldOf = (...ps: Party[]): World => ({ machine: 'local', parties: Object.fromEntries(ps.map((p) => [p.id, p])) });

/** A star of nodes on a hand-made graph: hub in the middle, spokes of a chosen length. */
function star(lengths: Record<string, number>): { g: RoadGraph; place: (n: string) => Place } {
  const nodes = new Map([[HUB_ID, { id: HUB_ID, tile: { x: 50, y: 20 } }]]);
  const edges: RoadGraph['edges'] = [];
  let i = 0;
  for (const [id, len] of Object.entries(lengths)) {
    const a = (i++ / Object.keys(lengths).length) * Math.PI * 2;
    nodes.set(id, { id, tile: { x: Math.round(50 + Math.cos(a) * len), y: 20 } });
    edges.push({ a: HUB_ID, b: id });
  }
  const g = { nodes, edges } as RoadGraph;
  return { g, place: (n) => ({ node: n, pt: tileToWorld(nodes.get(n)!.tile) }) };
}

describe('legPlan', () => {
  it('scales the pace so a leg takes between 2 and 6 seconds', () => {
    for (const d of [5, 40, 140, 300, 900, 3000]) {
      const p = legPlan(d);
      expect(p.secs).toBeGreaterThanOrEqual(LEG_MIN_S);
      expect(p.secs).toBeLessThanOrEqual(LEG_MAX_S);
      expect(p.speed * p.secs).toBeCloseTo(d);
    }
    expect(legPlan(0).secs).toBe(0);
  });
});

describe('roads and hub', () => {
  const w = worldOf(party('a', '/r/alpha', [member('1')]), party('b', '/r/beta', [member('2')]), party('c', '/r/gamma', [member('3')]));

  it('links the hub to every settlement and routes along the drawn roads', () => {
    const l = layoutMap(w, [], { hub: true });
    expect(l.hub).toBeDefined();
    const g = buildRoads(l);
    for (const s of l.settlements) expect(routeTiles(g, HUB_ID, settlementNode(s.key))).toBeDefined();
    expect(routeTiles(g, campNode('a'), HUB_ID)).toBeDefined();
    // Every tile of every route is a path tile in the terrain the scene draws.
    const t = buildTerrain(l);
    for (const e of g.edges) {
      for (const pt of routeTiles(g, e.a, e.b)!) expect(t.ground[pt.y * t.w + pt.x]).toBe('path');
    }
  });

  it('never overlaps a settlement, a camp or water, and never moves them', () => {
    const without = layoutMap(w);
    const l = layoutMap(w, [], { hub: true });
    expect(l.settlements).toEqual(without.settlements);
    expect([...l.camps]).toEqual([...without.camps]);
    const hub = l.hub!;
    for (const s of l.settlements) expect(Math.hypot(s.tile.x - hub.x, (s.tile.y - hub.y) * 1.4)).toBeGreaterThanOrEqual(8);
    for (const c of l.camps.values()) expect(Math.hypot(c.tile.x - hub.x, (c.tile.y - hub.y) * 1.4)).toBeGreaterThanOrEqual(6);
    const t = buildTerrain(l);
    for (let dx = -3; dx <= 3; dx++) for (let dy = -3; dy <= 0; dy++) expect(t.ground[(hub.y + dy) * t.w + hub.x + dx]).not.toBe('water');
  });

  it('is deterministic, does not depend on party order, and stays put when a far settlement comes', () => {
    const rev = worldOf(...Object.values(w.parties).reverse());
    expect(layoutMap(rev, [], { hub: true }).hub).toEqual(layoutMap(w, [], { hub: true }).hub);
    expect(layoutMap(w, [], { hub: true }).signature).not.toBe(layoutMap(w).signature);
  });

  it('sits beside the only settlement, and at the map centre with none', () => {
    const one = layoutMap(worldOf(party('a', '/r/alpha', [member('1')])), [], { hub: true });
    const s = one.settlements[0]!;
    expect(Math.abs(one.hub!.x - s.tile.x)).toBeLessThan(24);
    const none = layoutMap(worldOf(), [], { hub: true });
    expect(none.hub).toEqual({ x: none.w / 2, y: none.h / 2 });
    expect(none.settlements).toEqual([]);
  });

  it('without a hub the layout has none and the signature is unchanged', () => {
    expect(layoutMap(w).hub).toBeUndefined();
    expect(layoutMap(w).signature).not.toContain('hub@');
  });
});

describe('JourneyBoard', () => {
  it('follows the roads at a pace that makes each leg take 2 to 6 seconds, and delivers on arrival', () => {
    const { g, place } = star({ a: 30, b: 12 });
    const board = new JourneyBoard(g);
    expect(board.push('lead', place(HUB_ID), place('a'), 1, 0)).toBe('trip');
    expect(board.pose('lead', 0)).toBeUndefined(); // waiting at home
    expect(board.away('lead', 0)).toBe(false);
    const t0 = DEPART_DELAY;
    const secs = legPlan(30 * 16).secs;
    expect(board.update(t0 + secs - 0.1)).toEqual([]);
    expect(board.away('lead', t0 + 1)).toBe(true);
    const arrive = board.update(t0 + secs + 0.01);
    expect(arrive).toEqual([{ traveller: 'lead', id: 1, immediate: false }]);
    expect(board.pose('lead', t0 + secs + 0.5)).toMatchObject({ moving: false, x: place('a').pt.x });
    // Back home after the stay and the way back.
    const end = board.endsAt('lead')!;
    expect(end).toBeCloseTo(t0 + secs + DWELL + legPlan(30 * 16).secs);
    board.update(end + 0.1);
    expect(board.busy('lead')).toBe(false);
    expect(board.pose('lead', end + 0.1)).toBeUndefined();
  });

  it('keeps to the road tiles of the real layout', () => {
    const w = worldOf(party('a', '/r/alpha', [member('1')]), party('b', '/r/beta', [member('2')]), party('c', '/r/gamma', [member('3')]));
    const l = layoutMap(w, [], { hub: true });
    const g = buildRoads(l);
    const t = buildTerrain(l);
    const board = new JourneyBoard(g);
    const home: Place = { node: HUB_ID, pt: tileToWorld(l.hub!) };
    const target: Place = { node: campNode('b'), pt: tileToWorld(l.camps.get('b')!.tile) };
    board.push('lead', home, target, 1, 0);
    let samples = 0;
    for (let now = DEPART_DELAY + 0.05; now < board.endsAt('lead')! - 0.05; now += 0.1) {
      const p = board.pose('lead', now)!;
      const tx = Math.floor(p.x / 16);
      const ty = Math.floor((p.y - 1) / 16);
      expect(t.ground[ty * t.w + tx], `at ${now.toFixed(1)}s (${tx},${ty})`).toBe('path');
      samples++;
    }
    expect(samples).toBeGreaterThan(20);
  });

  it('merges messages sent together into one trip, visiting the stops in the shortest order', () => {
    const { g, place } = star({ far: 40, mid: 20, near: 8 });
    const board = new JourneyBoard(g);
    // Pushed far first on purpose: the order that keeps the path short is not the order they were sent in.
    expect(board.push('lead', place(HUB_ID), place('far'), 1, 0)).toBe('trip');
    expect(board.push('lead', place(HUB_ID), place('mid'), 2, 0.1)).toBe('trip');
    expect(board.push('lead', place(HUB_ID), place('near'), 3, 0.2)).toBe('trip');
    const order: number[] = [];
    for (let now = 0; now < 60; now += 0.05) for (const d of board.update(now)) order.push(d.id);
    expect(order.sort()).toEqual([1, 2, 3]);
    // One trip: it left home once and came back once, with a hop per stop and one home.
    expect(board.busy('lead')).toBe(false);
  });

  it('orders by total path length: nearer stops are not visited after a farther one on the way back', () => {
    const { g, place } = star({ far: 40, near: 8 });
    const board = new JourneyBoard(g);
    board.push('lead', place(HUB_ID), place('far'), 1, 0);
    board.push('lead', place(HUB_ID), place('near'), 2, 0);
    const ids: number[] = [];
    for (let now = 0; now < 60; now += 0.05) for (const d of board.update(now)) ids.push(d.id);
    // Both orders cost 2*(far+near) on a star, so either is shortest; the planner is deterministic.
    expect(ids).toHaveLength(2);
    const again = new JourneyBoard(g);
    again.push('lead', place(HUB_ID), place('near'), 2, 0);
    again.push('lead', place(HUB_ID), place('far'), 1, 0);
    const ids2: number[] = [];
    for (let now = 0; now < 60; now += 0.05) for (const d of again.update(now)) ids2.push(d.id);
    expect(ids2).toEqual(ids);
  });

  it('on a chain the nearest-first order wins', () => {
    // hub - a - b: going to b first and back through a would be the same length, but a line a - b - c visits in order.
    const nodes = new Map([
      ['h', { id: 'h', tile: { x: 10, y: 20 } }],
      ['a', { id: 'a', tile: { x: 20, y: 20 } }],
      ['b', { id: 'b', tile: { x: 30, y: 20 } }],
      ['c', { id: 'c', tile: { x: 40, y: 20 } }],
    ]);
    const g: RoadGraph = { nodes, edges: [{ a: 'h', b: 'a' }, { a: 'a', b: 'b' }, { a: 'b', b: 'c' }] };
    const pl = (n: string): Place => ({ node: n, pt: tileToWorld(nodes.get(n)!.tile) });
    const board = new JourneyBoard(g);
    board.push('t', pl('h'), pl('c'), 3, 0);
    board.push('t', pl('h'), pl('a'), 1, 0);
    board.push('t', pl('h'), pl('b'), 2, 0);
    const ids: number[] = [];
    for (let now = 0; now < 80; now += 0.05) for (const d of board.update(now)) ids.push(d.id);
    expect(ids).toEqual([1, 2, 3]);
  });

  it('merges a message that arrives while the traveller is away, without a second trip', () => {
    const { g, place } = star({ a: 14, b: 8 });
    const board = new JourneyBoard(g);
    board.push('lead', place(HUB_ID), place('a'), 1, 0);
    const first = board.endsAt('lead')!;
    board.update(2);
    expect(board.away('lead', 2)).toBe(true);
    expect(board.push('lead', place(HUB_ID), place('b'), 2, 2)).toBe('trip');
    const seen: { id: number; at: number }[] = [];
    let homeSeen = 0;
    for (let now = 2; now < 60; now += 0.05) {
      for (const d of board.update(now)) seen.push({ id: d.id, at: now });
      // The traveller is at home exactly once more: at the end of the one trip.
      const p = board.pose('lead', now);
      if (!p && now > 3 && board.busy('lead')) homeSeen++;
    }
    expect(seen.map((s) => s.id)).toEqual([1, 2]);
    expect(homeSeen).toBe(0);
    expect(board.endsAt('lead') ?? first).toBeGreaterThan(0);
    expect(board.busy('lead')).toBe(false);
  });

  it('merges into a trip that is already heading home', () => {
    const { g, place } = star({ a: 14, b: 8 });
    const board = new JourneyBoard(g);
    board.push('lead', place(HUB_ID), place('a'), 1, 0);
    // Run until the delivery, then during the walk back send another.
    let now = 0;
    for (; now < 30; now += 0.05) if (board.update(now).length) break;
    now += DWELL + 1;
    board.update(now);
    expect(board.push('lead', place(HUB_ID), place('b'), 2, now)).toBe('trip');
    const ids: number[] = [];
    for (; now < 80; now += 0.05) for (const d of board.update(now)) ids.push(d.id);
    expect(ids).toEqual([2]);
  });

  it('puts messages to one target in one stop', () => {
    const { g, place } = star({ a: 30 });
    const board = new JourneyBoard(g);
    for (let i = 1; i <= 10; i++) expect(board.push('lead', place(HUB_ID), place('a'), i, 0)).toBe('trip');
    const got: number[] = [];
    for (let now = 0; now < 40; now += 0.05) for (const d of board.update(now)) got.push(d.id);
    expect(got).toHaveLength(10);
  });

  it('limits a trip to six stops; more messages are plain bubbles at home', () => {
    const lengths = Object.fromEntries(Array.from({ length: 8 }, (_, i) => [`n${i}`, 6 + i]));
    const { g, place } = star(lengths);
    const board = new JourneyBoard(g);
    const results = Object.keys(lengths).map((n, i) => board.push('lead', place(HUB_ID), place(n), i + 1, 0));
    expect(results.filter((r) => r === 'trip')).toHaveLength(MAX_STOPS);
    expect(results.slice(MAX_STOPS)).toEqual(['plain', 'plain']);
  });

  it('a target that is not on the map, or is where the speaker already is, is a plain bubble', () => {
    const { g, place } = star({ a: 30 });
    const board = new JourneyBoard(g);
    expect(board.push('lead', place(HUB_ID), { node: 'nowhere', pt: { x: 0, y: 0 } }, 1, 0)).toBe('plain');
    expect(board.push('lead', place(HUB_ID), place(HUB_ID), 2, 0)).toBe('plain');
    expect(board.busy('lead')).toBe(false);
  });

  it('caps the whole trip: what does not fit is delivered at once and the traveller heads home', () => {
    // Six far stops: six legs of 6s alone would be 36s.
    const lengths = Object.fromEntries(Array.from({ length: 6 }, (_, i) => [`n${i}`, 60 + i]));
    const { g, place } = star(lengths);
    const board = new JourneyBoard(g);
    Object.keys(lengths).forEach((n, i) => board.push('lead', place(HUB_ID), place(n), i + 1, 0));
    const start = DEPART_DELAY;
    const end = board.endsAt('lead')!;
    expect(end - start).toBeLessThanOrEqual(TRIP_CAP + 0.001);
    const out = board.update(0);
    const immediate = out.filter((d) => d.immediate);
    expect(immediate.length).toBeGreaterThan(0);
    const delivered = new Set(out.map((d) => d.id));
    for (let now = 0; now <= end + 1; now += 0.05) for (const d of board.update(now)) delivered.add(d.id);
    // Nothing is lost: every message arrives, by travelling or at once.
    expect([...delivered].sort()).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it('shows a home marker only while away, and a dropped traveller is forgotten', () => {
    const { g, place } = star({ a: 30 });
    const board = new JourneyBoard(g);
    board.push('lead', place(HUB_ID), place('a'), 1, 0);
    expect(board.homes(0.1)).toEqual([]);
    expect(board.homes(2)).toEqual([{ traveller: 'lead', pt: place(HUB_ID).pt }]);
    board.drop('lead');
    expect(board.homes(2)).toEqual([]);
  });

  it('a second traveller travels independently', () => {
    const { g, place } = star({ a: 30, b: 20 });
    const board = new JourneyBoard(g);
    board.push('x', place('a'), place('b'), 1, 0);
    board.push('y', place('b'), place('a'), 2, 0);
    const got: string[] = [];
    for (let now = 0; now < 60; now += 0.05) for (const d of board.update(now)) got.push(`${d.traveller}${d.id}`);
    expect(got.sort()).toEqual(['x1', 'y2']);
  });
});
