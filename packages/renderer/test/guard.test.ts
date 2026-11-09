import { describe, expect, it, vi } from 'vitest';
import { guardFrame } from '../src/guard.js';

describe('guardFrame', () => {
  it('swallows a throwing frame so the loop keeps going, and logs each message once', () => {
    let n = 0;
    const log = vi.fn();
    const tick = guardFrame(() => {
      n++;
      if (n < 4) throw new Error('boom');
    }, log);
    for (let i = 0; i < 5; i++) expect(() => tick()).not.toThrow();
    expect(n).toBe(5);
    expect(log).toHaveBeenCalledTimes(1);
  });
});
