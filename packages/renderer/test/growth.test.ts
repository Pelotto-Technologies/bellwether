import type { World } from '@bellwether/adapter/core';
import { describe, expect, it } from 'vitest';
import { agentsByRepo, campSize, campSlots, pop, townSize, townSlots } from '../src/map/growth.js';

describe('growth', () => {
  it('grows towns by one building per four agents, capped', () => {
    expect([1, 3, 4, 8, 12, 100].map(townSize)).toEqual([1, 1, 2, 3, 4, 6]);
    expect(townSlots(townSize(100))).toHaveLength(6);
  });
  it('grows camps by one tent per two members, capped', () => {
    expect([0, 1, 2, 3, 6, 40].map(campSize)).toEqual([1, 1, 1, 2, 3, 4]);
    expect(campSlots(4)).toHaveLength(4);
  });
  it('counts every pane in a repo across parties', () => {
    const m = (id: string) => ({ paneId: id, agent: 'claude', role: 'generic' as const, status: 'idle' as const, lastChange: 0 });
    const p = (id: string, repo: string, ids: string[]) => ({ id, label: id, repo, isWorktree: true, status: 'idle' as const, members: Object.fromEntries(ids.map((i) => [i, m(i)])), tokens: {} });
    const w: World = { machine: 'local', parties: { a: p('a', 'x', ['1', '2']), b: p('b', 'x', ['3']), c: p('c', 'y', ['4']) } };
    expect(Object.fromEntries(agentsByRepo(w))).toEqual({ x: 3, y: 1 });
  });
  it('pops in from nothing, overshoots, then settles', () => {
    expect(pop(0)).toBe(0);
    expect(pop(1)).toBe(1);
    expect(Math.max(...[0.1, 0.2, 0.3, 0.4].map((t) => pop(t)))).toBeGreaterThan(1);
  });
});
