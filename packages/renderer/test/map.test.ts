import { MockGenerator, type Member, type Party, type World } from '@bellwether/adapter/core';
import { describe, expect, it } from 'vitest';
import { fitZoom, nearestParty, screenToWorld, stepCamera, worldToScreen } from '../src/map/camera.js';
import { inferHandoff, pickPartner } from '../src/map/chatter.js';
import { describeParty, ago } from '../src/map/detail.js';
import { layoutMap, settlementName, TILE } from '../src/map/layout.js';
import { sliceTileset } from '../src/map/tileset.js';
import { autotileMask, buildTerrain, groundTileName } from '../src/map/terrain.js';
import { spawnWanderer, stepWanderer, type Bounds } from '../src/map/wander.js';

const member = (paneId: string, over: Partial<Member> = {}): Member => ({ paneId, agent: 'claude', role: 'implementer', status: 'idle', lastChange: 0, ...over });
const party = (id: string, repo: string, members: Member[], over: Partial<Party> = {}): Party => ({
  id,
  label: id,
  repo,
  isWorktree: true,
  status: 'idle',
  members: Object.fromEntries(members.map((m) => [m.paneId, m])),
  tokens: {},
  ...over,
});
const worldOf = (...ps: Party[]): World => ({ machine: 'local', parties: Object.fromEntries(ps.map((p) => [p.id, p])) });

describe('layoutMap extra settlements', () => {
  it('adds a settlement with no camps for a repo that only has a leader', () => {
    const l = layoutMap(worldOf(party('a', '/r/alpha', [member('1')])), ['/r/solo']);
    expect(l.settlements.map((s) => s.name).sort()).toEqual(['alpha', 'solo']);
    expect(l.camps.size).toBe(1);
  });
});

describe('layoutMap', () => {
  const w = worldOf(party('a', '/r/alpha', [member('1')]), party('b', '/r/alpha', [member('2')]), party('c', '/r/beta', [member('3')]));

  it('places one settlement per repo and one camp per party, inside the map', () => {
    const l = layoutMap(w);
    expect(l.settlements.map((s) => s.name).sort()).toEqual(['alpha', 'beta']);
    expect(l.camps.size).toBe(3);
    for (const s of l.settlements) {
      expect(s.tile.x).toBeGreaterThanOrEqual(0);
      expect(s.tile.x).toBeLessThan(l.w);
      expect(s.tile.y).toBeLessThan(l.h);
    }
  });

  it('is deterministic and independent of party order', () => {
    const reversed = worldOf(...Object.values(w.parties).reverse());
    expect(layoutMap(reversed).signature).toBe(layoutMap(w).signature);
  });

  it('never puts two settlements in the same cell', () => {
    const many = worldOf(...Array.from({ length: 20 }, (_, i) => party(`p${i}`, `/r/repo${i}`, [member(`m${i}`)])));
    const l = layoutMap(many);
    const cells = new Set(l.settlements.map((s) => `${Math.floor(s.tile.x / 16)},${Math.floor(s.tile.y / 12)}`));
    expect(cells.size).toBe(20);
  });

  it('keeps existing settlements put when a party is added to a known repo', () => {
    const before = layoutMap(w).settlements;
    const after = layoutMap(worldOf(...Object.values(w.parties), party('d', '/r/beta', [member('4')]))).settlements;
    expect(after).toEqual(before);
  });

  it('names settlements after the repo folder, Windows or POSIX', () => {
    expect(settlementName('C:\\work\\bellwether')).toBe('bellwether');
    expect(settlementName('/home/x/herdr/')).toBe('herdr');
  });
});

describe('terrain', () => {
  const l = layoutMap(worldOf(party('a', '/r/alpha', [member('1')]), party('c', '/r/beta', [member('3')])));
  const t = buildTerrain(l);

  it('is deterministic', () => {
    expect(buildTerrain(l).ground).toEqual(t.ground);
  });

  it('keeps buildings on dry land and links camps to their settlement by path', () => {
    for (const s of l.settlements) expect(t.ground[s.tile.y * t.w + s.tile.x]).not.toBe('water');
    for (const c of l.camps.values()) {
      expect(t.ground[c.tile.y * t.w + c.tile.x]).toBe('path');
    }
  });

  it('autotile masks use N=1 E=2 S=4 W=8 and treat off-map as same', () => {
    const small = { w: 3, h: 3, ground: Array(9).fill('grass') as ('grass' | 'path' | 'water')[], scenery: [], variant: Array(9).fill(0) as number[] };
    small.ground[4] = 'path';
    expect(autotileMask(small, 1, 1)).toBe(0);
    small.ground[1] = 'path';
    expect(autotileMask(small, 1, 1)).toBe(1);
    expect(autotileMask(small, 0, 0)).toBe(1 | 4 | 8); // N and W are off-map (count as same); E is path
    expect(groundTileName(small, 1, 1)).toBe('path_1');
  });
});

describe('tileset slicing', () => {
  it('maps tile index to its rectangle', () => {
    const r = sliceTileset({ tileSize: 16, columns: 8, tiles: { a: 0, b: 9 } });
    expect([r.a!.x, r.a!.y]).toEqual([0, 0]);
    expect([r.b!.x, r.b!.y]).toEqual([16, 16]);
  });
});

describe('camera', () => {
  const screen = { w: 800, h: 600 };
  it('round-trips world and screen coordinates', () => {
    const cam = { cx: 100, cy: 80, zoom: 3 };
    const s = worldToScreen(cam, screen, { x: 120, y: 90 });
    const w = screenToWorld(cam, screen, s);
    expect(w.x).toBeCloseTo(120);
    expect(w.y).toBeCloseTo(90);
  });
  it('fits the whole map', () => {
    const z = fitZoom({ w: 1536, h: 768 }, screen);
    expect(1536 * z).toBeLessThanOrEqual(800);
    expect(768 * z).toBeLessThanOrEqual(600);
  });
  it('converges on the target without overshoot', () => {
    let c = { cx: 0, cy: 0, zoom: 1 };
    const target = { cx: 100, cy: 50, zoom: 4 };
    for (let i = 0; i < 300; i++) {
      c = stepCamera(c, target, 1 / 60);
      expect(c.zoom).toBeLessThanOrEqual(4.0001);
      expect(c.cx).toBeLessThanOrEqual(100.0001);
    }
    expect(c).toEqual(target);
  });
  it('finds the nearest party within a radius', () => {
    const pts = [{ id: 'a', x: 0, y: 0 }, { id: 'b', x: 50, y: 0 }];
    expect(nearestParty(pts, { x: 40, y: 0 }, 20)).toBe('b');
    expect(nearestParty(pts, { x: 200, y: 0 }, 20)).toBeUndefined();
  });
});

describe('chatter', () => {
  it('prefers a teammate, deterministically', () => {
    const w = worldOf(party('a', '/r/x', [member('1'), member('2'), member('3')]));
    const l = layoutMap(w);
    const p = pickPartner(w, l.camps, 'a', '1')!;
    expect(p.partyId).toBe('a');
    expect(p.paneId).not.toBe('1');
    expect(pickPartner(w, l.camps, 'a', '1')).toEqual(p);
  });
  it('a lone member visits a party at the same settlement, never another repo', () => {
    const w = worldOf(party('a', '/r/x', [member('1')]), party('b', '/r/x', [member('2')]), party('c', '/r/y', [member('3')]));
    const l = layoutMap(w);
    expect(pickPartner(w, l.camps, 'a', '1')).toEqual({ partyId: 'b', paneId: '2' });
    expect(pickPartner(w, l.camps, 'c', '3')).toBeUndefined();
  });
  it('infers a hand-off when a member starts working right after a teammate finished', () => {
    const before = party('a', '/r/x', [member('1', { status: 'working', lastChange: 100 }), member('2', { status: 'idle', lastChange: 0 })]);
    const doneM = member('1', { status: 'done', lastChange: 1000 });
    const startM = member('2', { status: 'working', lastChange: 2500 });
    const after = party('a', '/r/x', [doneM, startM]);
    const h = inferHandoff(before, after, startM)!;
    expect(h.from.paneId).toBe('1');
    expect(h.text).toBe('Over to you');
    expect(inferHandoff(before, after, { ...startM, lastChange: 60_000 })).toBeUndefined();
    expect(inferHandoff(before, after, doneM)).toBeUndefined();
  });
});

describe('wander', () => {
  const home = { x: 100, y: 100 };
  it('strolls inside the camp radius and holds still when blocked', () => {
    let w = spawnWanderer('m', home, 20);
    for (let i = 0; i < 2000; i++) {
      w = stepWanderer(w, 'm', 'working', home, 20, 0.05);
      expect(Math.hypot(w.x - home.x, (w.y - home.y) / 0.6)).toBeLessThanOrEqual(21);
    }
    const b = stepWanderer(w, 'm', 'blocked', home, 20, 1);
    expect({ x: b.x, y: b.y }).toEqual({ x: w.x, y: w.y });
  });
  it('walks toward a conversation partner and stops beside them', () => {
    let w = spawnWanderer('m', home, 20);
    const partner = { x: 160, y: 100 };
    for (let i = 0; i < 400; i++) w = stepWanderer(w, 'm', 'idle', home, 20, 0.05, partner);
    expect(Math.abs(w.x - partner.x)).toBeLessThanOrEqual(10);
    expect(w.dir).toBe(1);
  });
});

describe('describeParty', () => {
  it('lists the beacon first with the latest known line per member', () => {
    const p = party('a', '/r/x', [member('1', { role: 'implementer', status: 'working', title: 'fixing tests', lastChange: 0 }), member('2', { role: 'coordinator', status: 'blocked', say: 'need a decision', lastChange: 0 })], { branch: 'feat/x', status: 'blocked' });
    const d = describeParty(p, 'x', 'coordinator', 90_000);
    expect(d.subtitle).toBe('x · feat/x · worktree');
    expect(d.rows[0]).toMatchObject({ role: 'coordinator', line: 'need a decision' });
    expect(d.rows[1]!.line).toBe('fixing tests');
    expect(describeParty(party('b', '/r', [member('9')]), 'r', 'coordinator', 125_000).rows[0]!.line).toBe('idle for 2m');
    expect(ago(5000)).toBe('5s');
  });
  it('works on mock data', () => {
    const w = new MockGenerator({ seed: 3 }).initial(0);
    if (w.kind !== 'snapshot') throw new Error('expected snapshot');
    expect(layoutMap(w.world).camps.size).toBe(Object.keys(w.world.parties).length);
    expect(TILE).toBe(16);
  });
});

describe('map edges', () => {
  const bounds: Bounds = { x0: 8, y0: 16, x1: 120, y1: 90 };

  it('keeps wanderers inside the bounds even when home sits on the edge', () => {
    const home = { x: 4, y: 88 };
    let w = spawnWanderer('edge', home, 30, bounds);
    for (let i = 0; i < 2000; i++) {
      w = stepWanderer(w, 'edge', 'working', home, 30, 0.05, undefined, bounds);
      expect(w.x).toBeGreaterThanOrEqual(bounds.x0);
      expect(w.x).toBeLessThanOrEqual(bounds.x1);
      expect(w.y).toBeGreaterThanOrEqual(bounds.y0);
      expect(w.y).toBeLessThanOrEqual(bounds.y1);
    }
  });

  it('does not chase a conversation partner off the map', () => {
    const home = { x: 60, y: 50 };
    let w = spawnWanderer('m', home, 20, bounds);
    for (let i = 0; i < 400; i++) w = stepWanderer(w, 'm', 'idle', home, 20, 0.05, { x: 500, y: -40 }, bounds);
    expect(w.x).toBeLessThanOrEqual(bounds.x1);
    expect(w.y).toBeGreaterThanOrEqual(bounds.y0);
  });

  it('places every camp inside the map for many repos and worktrees', () => {
    const ps = Array.from({ length: 30 }, (_, i) => party(`p${i}`, `/r/repo${i % 7}`, [member(`m${i}`)]));
    const l = layoutMap(worldOf(...ps));
    for (const c of l.camps.values()) {
      expect(c.tile.x).toBeGreaterThanOrEqual(2);
      expect(c.tile.x).toBeLessThanOrEqual(l.w - 3);
      expect(c.tile.y).toBeGreaterThanOrEqual(3);
      expect(c.tile.y).toBeLessThanOrEqual(l.h - 2);
    }
  });
});
