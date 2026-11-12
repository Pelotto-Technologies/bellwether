import type { Member } from '@bellwether/adapter/core';
import { describe, expect, it } from 'vitest';
import neutral from '../../../themes/neutral/theme.json';
import { describeParty } from '../src/map/detail.js';
import { LOW_CONTEXT, slowFactor, stepWalker } from '../src/sim.js';
import { DEFAULT_VITALS, parseTheme, vitalsLook } from '../src/theme.js';
import { barFill, hasVitals, isLow, lowestContext, modelLine, sharedQuest, withQuest } from '../src/vitals.js';

const m = (over: Partial<Member> = {}): Member => ({ paneId: 'p', agent: 'claude', role: 'generic', status: 'working', lastChange: 0, ...over });

describe('slowFactor', () => {
  it('is full speed from 20% up and when unknown', () => {
    expect(slowFactor(undefined)).toBe(1);
    expect(slowFactor(LOW_CONTEXT)).toBe(1);
    expect(slowFactor(100)).toBe(1);
    expect(slowFactor(NaN)).toBe(1);
  });
  it('eases down to half speed at zero', () => {
    expect(slowFactor(0)).toBe(0.5);
    expect(slowFactor(10)).toBeCloseTo(0.75);
    expect(slowFactor(19)).toBeLessThan(1);
    expect(slowFactor(-5)).toBe(0.5);
  });
  it('slows stepWalker but never moves a blocked group', () => {
    const lane = { start: 0, end: 1000 };
    const fast = stepWalker({ x: 100, dir: 1 }, 'working', lane, 50, 1);
    const slow = stepWalker({ x: 100, dir: 1 }, 'working', lane, 50, 1, slowFactor(0));
    expect(slow.x - 100).toBeCloseTo((fast.x - 100) / 2);
    expect(stepWalker({ x: 100, dir: 1 }, 'blocked', lane, 50, 1, 0.5).x).toBe(100);
  });
});

describe('vitals helpers', () => {
  it('fills bars in whole pixels, at least one when not empty', () => {
    expect(barFill(100, 12)).toBe(12);
    expect(barFill(50, 12)).toBe(6);
    expect(barFill(1, 12)).toBe(1);
    expect(barFill(0, 12)).toBe(0);
    expect(barFill(undefined, 12)).toBe(0);
  });
  it('knows low context and finds the weakest member', () => {
    expect(isLow(19)).toBe(true);
    expect(isLow(20)).toBe(false);
    expect(isLow(undefined)).toBe(false);
    expect(lowestContext([m({ vitals: { context: 60, at: 1 } }), m({ vitals: { context: 15, at: 1 } }), m()])).toBe(15);
    expect(lowestContext([m()])).toBeUndefined();
    expect(hasVitals(m({ vitals: { quota: 5, at: 1 } }))).toBe(true);
    expect(hasVitals(m())).toBe(false);
  });
  it('shows a quest on the nameplate only when everyone that has one shares it', () => {
    expect(sharedQuest([m({ quest: 'A' }), m({ quest: 'A' }), m()])).toBe('A');
    expect(sharedQuest([m({ quest: 'A' }), m({ quest: 'B' })])).toBeUndefined();
    expect(sharedQuest([m(), m()])).toBeUndefined();
    expect(withQuest('api · feat', [m({ quest: 'Fix auth' })])).toBe('api · feat — Fix auth');
    expect(withQuest('api', [m({ quest: 'A' }), m({ quest: 'B' })])).toBe('api');
  });
  it('describes the model line', () => {
    expect(modelLine({ model: 'Opus 5.5', effort: 'high' })).toBe('Opus 5.5 · high');
    expect(modelLine({ model: 'Opus 5.5' })).toBe('Opus 5.5');
    expect(modelLine({})).toBeUndefined();
  });
});

describe('theme vitals colours', () => {
  it('are optional: a pack without them gets the defaults', () => {
    expect(parseTheme(neutral).vitals).toBeUndefined();
    expect(vitalsLook(parseTheme(neutral))).toEqual(DEFAULT_VITALS);
  });
  it('are read, with partial packs falling back per colour, and validated', () => {
    expect(parseTheme({ ...neutral, vitals: { context: '#00ff00', low: '#ff0000' } }).vitals).toEqual({ context: '#00ff00', quota: DEFAULT_VITALS.quota, low: '#ff0000' });
    expect(() => parseTheme({ ...neutral, vitals: { quota: 'blue' } })).toThrow(/vitals.quota/);
  });
});

describe('map detail panel rows', () => {
  const party = { id: 'w1', label: 'api', isWorktree: false, status: 'working' as const, tokens: {}, members: { p: m({ model: 'Opus 5.5', effort: 'high', quest: 'Fix auth', vitals: { context: 30, quota: 70, at: 1 } }), q: m({ paneId: 'q' }) } };
  it('carries model, percentages and quest, only where reported', () => {
    const rows = describeParty(party, 's', 'coordinator', 0).rows;
    expect(rows[0]).toMatchObject({ paneId: 'p', model: 'Opus 5.5 · high', context: 30, quota: 70, quest: 'Fix auth' });
    expect(rows[1]).not.toHaveProperty('context');
    expect(rows[1]).not.toHaveProperty('model');
  });
  it('leaves vitals out when switched off', () => {
    expect(describeParty(party, 's', 'coordinator', 0, false).rows[0]).not.toHaveProperty('context');
  });
});
