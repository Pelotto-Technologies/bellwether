import { describe, expect, it } from 'vitest';
import { DISMOUNT_AT, nextRiding, parkSpot, RIDE_MIN, summonPlan } from '../src/map/ride.js';
import { spawnWanderer, stepWanderer } from '../src/map/wander.js';

describe('riding', () => {
  it('mounts for long journeys only, and keeps riding until close', () => {
    expect(nextRiding(false, RIDE_MIN - 1, true)).toBe(false);
    expect(nextRiding(false, RIDE_MIN + 1, true)).toBe(true);
    expect(nextRiding(true, RIDE_MIN - 1, true)).toBe(true);
    expect(nextRiding(true, DISMOUNT_AT - 1, true)).toBe(false);
    expect(nextRiding(true, 100, false)).toBe(false);
  });

  it('plans a summon that takes 1 to 4 seconds', () => {
    const near = summonPlan(10, { x: 0, y: 0 }, { x: 20, y: 0 });
    expect(near.arrive).toBe(11);
    const far = summonPlan(10, { x: 0, y: 0 }, { x: 1000, y: 0 });
    expect(far.arrive).toBe(14);
    expect(far.speed).toBeCloseTo(250);
    const mid = summonPlan(0, { x: 0, y: 0 }, { x: 140, y: 0 });
    expect(mid.arrive).toBeCloseTo(2);
  });

  it('parks the mount behind the rider', () => {
    expect(parkSpot({ x: 50, y: 5 }, 1)).toEqual({ x: 40, y: 5 });
    expect(parkSpot({ x: 50, y: 5 }, -1)).toEqual({ x: 60, y: 5 });
  });

  it('lets a wanderer ride at an override speed', () => {
    const w = spawnWanderer('a', { x: 0, y: 0 }, 0);
    const slow = stepWanderer(w, 'a', 'idle', { x: 0, y: 0 }, 0, 1, { x: 200, y: 0 });
    const fast = stepWanderer(w, 'a', 'idle', { x: 0, y: 0 }, 0, 1, { x: 200, y: 0 }, undefined, 100);
    expect(fast.x - w.x).toBeGreaterThan(slow.x - w.x);
    expect(fast.x - w.x).toBeCloseTo(100, 0);
  });
});
