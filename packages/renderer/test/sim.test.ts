import { describe, expect, it } from 'vitest';
import { assignRows, beaconAlpha, bob, bumps, layoutLanes, memberX, parseSpan, stepWalker, walkFrame, MAX_ROWS, ROAM_ROWS, ROW_FILL } from '../src/sim.js';

describe('layoutLanes', () => {
  it('splits the strip into contiguous lanes in stable order', () => {
    const lanes = layoutLanes(['w2', 'w1', 'w3'], 1000, 10);
    expect(lanes.get('w1')).toEqual({ start: 10, end: 10 + 980 / 3 });
    expect(lanes.get('w3')?.end).toBeCloseTo(990);
    expect(lanes.get('w2')?.start).toBeCloseTo(lanes.get('w1')!.end);
  });
  it('gives heavier groups wider lanes', () => {
    const lanes = layoutLanes(['a', 'b'], 1000, 0, { a: 3, b: 1 });
    expect(lanes.get('a')).toEqual({ start: 0, end: 750 });
    expect(lanes.get('b')).toEqual({ start: 750, end: 1000 });
  });
  it('handles no parties', () => {
    expect(layoutLanes([], 500).size).toBe(0);
  });
});

describe('stepWalker', () => {
  const lane = { start: 0, end: 200 };

  it('moves working parties and keeps the whole group inside the lane', () => {
    let w = { x: 100, dir: 1 as const } as { x: number; dir: 1 | -1 };
    let turned = false;
    for (let i = 0; i < 1000; i++) {
      w = stepWalker(w, 'working', lane, 50, 0.05);
      expect(w.x).toBeGreaterThanOrEqual(0);
      expect(w.x + 50).toBeLessThanOrEqual(200);
      if (w.dir === -1) turned = true;
    }
    expect(turned).toBe(true);
  });

  it('stops blocked parties', () => {
    expect(stepWalker({ x: 80, dir: 1 }, 'blocked', lane, 50, 1)).toEqual({ x: 80, dir: 1 });
  });

  it('copes with a group wider than its lane', () => {
    const w = stepWalker({ x: 0, dir: 1 }, 'working', lane, 400, 1);
    expect(w.x).toBe(0);
  });
});

describe('motion helpers', () => {
  it('places members left to right', () => {
    expect([0, 1, 2].map((i) => memberX(10, i, 20))).toEqual([10, 30, 50]);
  });
  it('hops blocked members, keeps idle ones still', () => {
    const hops = Array.from({ length: 20 }, (_, i) => bob('blocked', i * 0.1, 0));
    expect(Math.min(...hops)).toBeLessThan(-3);
    expect(bob('idle', 1.3, 0)).toBe(0);
  });
  it('stands when not moving and alternates steps when walking', () => {
    expect(walkFrame(false, 3, 0)).toBe(0);
    const frames = new Set(Array.from({ length: 12 }, (_, i) => walkFrame(true, i / 12, 0)));
    expect([...frames].sort()).toEqual([1, 2]);
  });
  it('pulses the beacon only when blocked', () => {
    expect(beaconAlpha('working', 0)).toBe(1);
    const a = Array.from({ length: 20 }, (_, i) => beaconAlpha('blocked', i * 0.1));
    expect(Math.max(...a) - Math.min(...a)).toBeGreaterThan(0.3);
  });
});

describe('depth rows', () => {
  const g = (n: number, span = 100) => Array.from({ length: n }, (_, i) => ({ id: `p${i}`, span }));
  it('keeps everyone in the front row while there is room to walk', () => {
    const rows = assignRows(g(5), 1000);
    expect(new Set(rows.values())).toEqual(new Set([0]));
  });
  it('opens just enough back rows when crowded, keeping each row under the fill line', () => {
    const rows = assignRows(g(20), 1000);
    const count = Math.max(...rows.values()) + 1;
    expect(count).toBe(4);
    for (let r = 0; r < count; r++) {
      const load = [...rows].filter(([, row]) => row === r).length * 100;
      expect(load).toBeLessThanOrEqual(1000 * ROW_FILL);
    }
  });
  it('caps the number of rows and stays deterministic', () => {
    const rows = assignRows(g(200), 1000);
    expect(Math.max(...rows.values())).toBe(MAX_ROWS - 1);
    expect([...assignRows(g(200), 1000)]).toEqual([...rows]);
  });
});

describe('parseSpan', () => {
  it('reads a window slice of a spanning strip', () => {
    expect(parseSpan('1920,5760')).toEqual({ offset: 1920, total: 5760 });
    expect(parseSpan('0,1920')).toEqual({ offset: 0, total: 1920 });
  });
  it('ignores anything malformed', () => {
    for (const raw of [null, '', 'x', '10', '-1,100', '100,100', '5,0', 'a,b']) expect(parseSpan(raw)).toBeUndefined();
  });
});

describe('roaming', () => {
  const g = (n: number, span = 100) => Array.from({ length: n }, (_, i) => ({ id: `p${i}`, span }));
  it('spreads even a quiet strip over a few rows so groups cross paths, never more rows than groups', () => {
    expect(new Set(assignRows(g(5), 4000, ROAM_ROWS).values())).toEqual(new Set([0, 1, 2]));
    expect(new Set(assignRows(g(2), 4000, ROAM_ROWS).values())).toEqual(new Set([0, 1]));
    expect([...assignRows(g(1), 4000, ROAM_ROWS).values()]).toEqual([0]);
    expect(Math.max(...assignRows(g(40), 1000, ROAM_ROWS).values())).toBe(MAX_ROWS - 1);
  });
  const w = (id: string, x: number, dir: 1 | -1, speed = 30, span = 50) => ({ id, x, dir, span, speed });
  it('turns both groups around when they meet head on in the same row', () => {
    expect(bumps([w('b', 140, -1), w('a', 100, 1)])).toEqual(new Set(['a', 'b']));
  });
  it('turns only the faster one when it catches up from behind', () => {
    expect(bumps([w('a', 100, 1, 34), w('b', 140, 1, 10)])).toEqual(new Set(['a']));
    expect(bumps([w('a', 100, -1, 10), w('b', 140, -1, 34)])).toEqual(new Set(['b']));
  });
  it('leaves groups alone when they are apart, moving apart, or one is standing still and the other walks away', () => {
    expect(bumps([w('a', 0, 1), w('b', 200, -1)])).toEqual(new Set());
    expect(bumps([w('a', 100, -1), w('b', 140, 1)])).toEqual(new Set());
    expect(bumps([w('a', 100, -1), w('b', 140, 1, 0)])).toEqual(new Set());
    expect(bumps([w('a', 100, 1), w('b', 140, -1, 0)])).toEqual(new Set(['a']));
  });
});
