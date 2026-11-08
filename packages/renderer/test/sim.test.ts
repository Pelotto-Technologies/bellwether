import { describe, expect, it } from 'vitest';
import { beaconAlpha, bob, layoutLanes, memberX, stepWalker, walkFrame } from '../src/sim.js';

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
