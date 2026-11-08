import { describe, expect, it } from 'vitest';
import { birthTime, NO_SPAWN, puffParticles, SPAWN_DUR, spawnPose } from '../src/spawn.js';

describe('spawn animation', () => {
  it('starts invisible and tall, ends at rest', () => {
    const start = spawnPose(0);
    expect(start.alpha).toBe(0);
    expect(start.sy).toBeGreaterThan(1);
    expect(start.sx).toBeLessThan(1);
    expect(start.lift).toBeGreaterThan(0);
    expect(spawnPose(SPAWN_DUR)).toEqual({ alpha: 1, sx: 1, sy: 1, lift: 0 });
    expect(spawnPose(5 - NO_SPAWN)).toEqual({ alpha: 1, sx: 1, sy: 1, lift: 0 });
  });

  it('settles monotonically in alpha and lift', () => {
    let alpha = -1;
    let lift = Infinity;
    for (let a = 0; a <= SPAWN_DUR; a += 0.05) {
      const p = spawnPose(a);
      expect(p.alpha).toBeGreaterThanOrEqual(alpha);
      expect(p.lift).toBeLessThanOrEqual(lift);
      alpha = p.alpha;
      lift = p.lift;
    }
  });

  it('puffs sparks outward, then nothing', () => {
    expect(puffParticles(5 - NO_SPAWN)).toEqual([]);
    expect(puffParticles(SPAWN_DUR)).toEqual([]);
    const early = puffParticles(0.1);
    const late = puffParticles(0.7);
    expect(early).toHaveLength(10);
    expect(Math.hypot(late[0]!.dx, late[0]!.dy)).toBeGreaterThan(Math.hypot(early[0]!.dx, early[0]!.dy));
    expect(late[0]!.alpha).toBeLessThan(early[0]!.alpha);
  });

  it('skips the animation for the first world and for reduced motion', () => {
    expect(birthTime(5, true, false)).toBe(5);
    expect(birthTime(5, false, false)).toBe(NO_SPAWN);
    expect(birthTime(5, true, true)).toBe(NO_SPAWN);
  });
});
