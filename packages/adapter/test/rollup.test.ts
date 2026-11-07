import { describe, expect, it } from 'vitest';
import { rollup } from '../src/rollup.js';
import type { Status } from '../src/types.js';

const of = (...s: Status[]) => s.map((status) => ({ status }));

describe('rollup', () => {
  it('is unknown for an empty party', () => {
    expect(rollup([])).toBe('unknown');
  });
  it('picks the worst status: blocked > done > working > idle > unknown', () => {
    expect(rollup(of('idle', 'working'))).toBe('working');
    expect(rollup(of('working', 'done', 'idle'))).toBe('done');
    expect(rollup(of('done', 'blocked', 'working'))).toBe('blocked');
    expect(rollup(of('unknown', 'idle'))).toBe('idle');
    expect(rollup(of('unknown'))).toBe('unknown');
  });
});
