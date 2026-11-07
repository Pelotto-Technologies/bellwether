import { describe, expect, it } from 'vitest';
import { BLINK_EVERY, BLINK_LEN, chooseAnim, frameIndex, frameNames, WAVE_LEN } from '../src/anim.js';

const base = { moving: false, status: 'idle', talking: false } as const;

describe('chooseAnim', () => {
  it('talks whenever a bubble is up', () => {
    expect(chooseAnim({ ...base, status: 'blocked', talking: true }, 1, 0)).toBe('talk');
  });
  it('raises a hand when blocked', () => {
    expect(chooseAnim({ ...base, status: 'blocked' }, 1, 0)).toBe('raise');
  });
  it('walks when moving and working', () => {
    expect(chooseAnim({ moving: true, status: 'working', talking: false }, 1, 0)).toBe('walk');
  });
  it('waves in a window while done, otherwise walks', () => {
    expect(chooseAnim({ moving: true, status: 'done', talking: false }, WAVE_LEN / 2, 0)).toBe('wave');
    expect(chooseAnim({ moving: true, status: 'done', talking: false }, WAVE_LEN + 1, 0)).toBe('walk');
  });
  it('idles, blinking briefly', () => {
    expect(chooseAnim(base, BLINK_LEN / 2, 0)).toBe('blink');
    expect(chooseAnim(base, BLINK_EVERY / 2, 0)).toBe('idle');
  });
});

describe('frameIndex', () => {
  it('advances at fps and wraps', () => {
    expect(frameIndex(4, 8, 0, 0)).toBe(0);
    expect(frameIndex(4, 8, 0.13, 0)).toBe(1);
    expect(frameIndex(4, 8, 0.5, 0)).toBe(0);
  });
  it('never divides by zero', () => {
    expect(frameIndex(0, 8, 3, 0)).toBe(0);
  });
  it('names the base frame and its masks', () => {
    expect(frameNames('walk', 2)).toEqual({ base: 'walk_2', tip: 'walk_2_tip', cloak: 'walk_2_cloak' });
  });
});
