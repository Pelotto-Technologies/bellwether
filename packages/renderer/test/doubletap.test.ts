import { describe, expect, it } from 'vitest';
import { DoubleTap } from '../src/doubletap.js';

describe('DoubleTap', () => {
  it('fires on a second tap inside the window, once', () => {
    const d = new DoubleTap(300);
    expect(d.tap('a', 0)).toBe(false);
    expect(d.tap('a', 200)).toBe(true);
    expect(d.tap('a', 250)).toBe(false);
  });
  it('ignores slow taps and other targets', () => {
    const d = new DoubleTap(300);
    d.tap('a', 0);
    expect(d.tap('b', 100)).toBe(false);
    expect(d.tap('a', 500)).toBe(false);
  });
});
