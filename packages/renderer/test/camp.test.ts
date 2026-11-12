import type { Member, Party, World } from '@bellwether/adapter/core';
import { describe, expect, it } from 'vitest';
import { activityLabel, activityOf, isTired, sits, toolActivity } from '../src/map/activity.js';
import { bodyRect, crateCount, crateSlots, firePoint, fireRect, gitRects, hasCart, overlaps, sceneryLayout, stationLayout } from '../src/map/camp.js';
import { MAP_HOME, navReduce, resolveParty } from '../src/map/nav.js';

const party = (id: string, label: string, branch?: string, n = 1): Party => ({
  id,
  label,
  ...(branch ? { branch } : {}),
  isWorktree: !!branch,
  status: 'idle',
  members: Object.fromEntries(Array.from({ length: n }, (_, i) => [`${id}:p${i}`, { paneId: `${id}:p${i}`, agent: 'claude', role: 'generic', status: 'idle', lastChange: 0 } as Member])),
  tokens: {},
});
const worldOf = (...ps: Party[]): World => ({ machine: 'local', parties: Object.fromEntries(ps.map((p) => [p.id, p])) });

describe('toolActivity', () => {
  it('maps the common tools of each agent', () => {
    for (const t of ['Edit', 'Write', 'MultiEdit', 'NotebookEdit', 'apply_patch', 'str_replace_editor']) expect(toolActivity(t)).toBe('edit');
    for (const t of ['Read', 'Grep', 'Glob', 'LS', 'NotebookRead', 'view']) expect(toolActivity(t)).toBe('read');
    for (const t of ['Bash', 'PowerShell', 'shell', 'BashOutput']) expect(toolActivity(t)).toBe('shell');
    for (const t of ['WebSearch', 'WebFetch']) expect(toolActivity(t)).toBe('search');
    for (const t of ['Task', 'Agent', 'delegate']) expect(toolActivity(t)).toBe('delegate');
  });
  it('matches case-insensitively by substring and defaults to think', () => {
    expect(toolActivity('mcp__docs__SEARCH_pages')).toBe('search');
    expect(toolActivity('bash')).toBe('shell');
    expect(toolActivity('TodoWrite')).toBe('think');
    expect(toolActivity('SomethingNew')).toBe('think');
    expect(toolActivity(undefined)).toBe('think');
    expect(toolActivity('')).toBe('think');
  });
});

describe('activityOf', () => {
  it('lets status poses beat the tool, and a working member without a tool thinks', () => {
    expect(activityOf({ status: 'blocked', tool: 'Edit' })).toBe('blocked');
    expect(activityOf({ status: 'done' })).toBe('done');
    expect(activityOf({ status: 'idle' })).toBe('idle');
    expect(activityOf({ status: 'unknown' })).toBe('unknown');
    expect(activityOf({ status: 'working' })).toBe('think');
    expect(activityOf({ status: 'working', tool: 'Read' })).toBe('read');
  });
  it('sends a working member with no known tool to its role\'s craft', () => {
    expect(activityOf({ status: 'working', role: 'implementer' })).toBe('edit');
    expect(activityOf({ status: 'working', role: 'reviewer' })).toBe('read');
    expect(activityOf({ status: 'working', role: 'orchestrator' })).toBe('delegate');
    expect(activityOf({ status: 'working', role: 'architect' })).toBe('think');
    expect(activityOf({ status: 'working', role: 'implementer', tool: 'WebSearch' })).toBe('search');
    expect(activityOf({ status: 'blocked', role: 'implementer' })).toBe('blocked');
  });
  it('labels with the tool name only while a tool runs', () => {
    expect(activityLabel({ status: 'working', tool: 'Edit' })).toBe('Hammering · Edit');
    expect(activityLabel({ status: 'working' })).toBe('Thinking');
    expect(activityLabel({ status: 'idle', tool: 'Edit' })).toBe('Dozing');
  });
  it('knows who sits and who is tired', () => {
    expect(['done', 'idle', 'unknown'].every((a) => sits(a as never))).toBe(true);
    expect(sits('edit')).toBe(false);
    expect(isTired({ vitals: { context: 19, at: 0 } })).toBe(true);
    expect(isTired({ vitals: { context: 20, at: 0 } })).toBe(false);
    expect(isTired({})).toBe(false);
  });
});

describe('stationLayout', () => {
  const sizes = [
    [300, 210],
    [313, 240],
    [316, 216],
    [420, 260],
    [640, 360],
  ] as const;
  for (const [w, h] of sizes) {
    it(`seats 1 to 10 members without overlap in ${w}x${h}`, () => {
      const f = firePoint(w, h);
      const git = gitRects(w, h);
      for (let n = 1; n <= 10; n++) {
        const ids = Array.from({ length: n }, (_, i) => `p${i}`);
        const st = stationLayout(ids, w, h);
        expect(st.map((s) => s.paneId).sort()).toEqual([...ids].sort());
        for (const s of st) {
          const r = bodyRect(s);
          expect(r.x0, `n=${n} ${s.paneId} left`).toBeGreaterThanOrEqual(0);
          expect(r.x1, `n=${n} ${s.paneId} right`).toBeLessThanOrEqual(w);
          expect(r.y0).toBeGreaterThanOrEqual(0);
          expect(s.y).toBeLessThanOrEqual(h - 4);
          expect(overlaps(r, fireRect(f))).toBe(false);
          expect(overlaps(r, git.crates)).toBe(false);
          expect(overlaps(r, git.cart)).toBe(false);
        }
        for (let i = 0; i < st.length; i++)
          for (let j = i + 1; j < st.length; j++) expect(overlaps(bodyRect(st[i]!), bodyRect(st[j]!)), `n=${n}: ${i} vs ${j}`).toBe(false);
      }
    });
  }
  it('faces everyone toward the fire and is stable under reordering', () => {
    const st = stationLayout(['b', 'a', 'c', 'd'], 313, 240);
    const f = firePoint(313, 240);
    for (const s of st) expect(s.side).toBe(s.x < f.x ? 1 : -1);
    expect(stationLayout(['d', 'c', 'a', 'b'], 313, 240)).toEqual(st);
  });
});

describe('sceneryLayout', () => {
  it('never puts scenery in front of a member', () => {
    const [w, h] = [313, 240];
    for (const n of [1, 4, 10]) {
      const st = stationLayout(Array.from({ length: n }, (_, i) => `p${i}`), w, h);
      const sc = sceneryLayout(w, h, st, 'x', 4);
      const pieces = [
        ...sc.tents.map((p) => ({ ...p, hw: 22, hgt: 34 })),
        ...sc.tall.map((p) => ({ ...p, hw: 14, hgt: 42 })),
        ...sc.low.map((p) => ({ ...p, hw: 9, hgt: 12 })),
      ];
      expect(sc.tents.length).toBeGreaterThan(0);
      for (const p of pieces)
        for (const s of st) {
          const r = { x0: p.x - p.hw, x1: p.x + p.hw, y0: p.y - p.hgt, y1: p.y };
          expect(overlaps(r, bodyRect(s), 1) && p.y >= s.y - 6).toBe(false);
        }
    }
  });
  it('is deterministic', () => {
    const st = stationLayout(['a', 'b'], 313, 240);
    expect(sceneryLayout(313, 240, st, 's', 2)).toEqual(sceneryLayout(313, 240, st, 's', 2));
  });
});

describe('git props', () => {
  it('draws nothing without git and caps the crate stack', () => {
    expect(crateCount(undefined)).toBe(0);
    expect(crateCount({ dirty: 0, ahead: 0, noRemote: false })).toBe(0);
    expect(crateCount({ dirty: 1, ahead: 0, noRemote: false })).toBe(1);
    expect(crateCount({ dirty: 400, ahead: 0, noRemote: false })).toBe(9);
    expect(crateSlots(99)).toHaveLength(9);
    expect(hasCart(undefined)).toBe(false);
    expect(hasCart({ dirty: 0, ahead: 0, noRemote: true })).toBe(false);
    expect(hasCart({ dirty: 0, ahead: 2, noRemote: false })).toBe(true);
  });
});

describe('navigation', () => {
  it('click focuses, enter goes to camp, back returns to a focused map, back again zooms out', () => {
    let n = navReduce(MAP_HOME, { t: 'click', party: 'a' });
    expect(n).toEqual({ view: 'map', focus: 'a' });
    n = navReduce(n, { t: 'enter', party: 'a' });
    expect(n).toEqual({ view: 'camp', party: 'a' });
    expect(navReduce(n, { t: 'click', party: 'b' })).toEqual(n);
    n = navReduce(n, { t: 'back' });
    expect(n).toEqual({ view: 'map', focus: 'a' });
    expect(navReduce(n, { t: 'back' })).toEqual(MAP_HOME);
    expect(navReduce(n, { t: 'click' })).toEqual(MAP_HOME);
  });
  it('leaves the camp or focus when the party disappears', () => {
    expect(navReduce({ view: 'camp', party: 'a' }, { t: 'gone', party: 'a' })).toEqual(MAP_HOME);
    expect(navReduce({ view: 'map', focus: 'a' }, { t: 'gone', party: 'a' })).toEqual(MAP_HOME);
    expect(navReduce({ view: 'camp', party: 'a' }, { t: 'gone', party: 'b' })).toEqual({ view: 'camp', party: 'a' });
  });
  it('resolves ?party= by id, label or branch, else the first populated party', () => {
    const w = worldOf(party('w2', 'Billing', 'feat/x'), party('w1', 'api', undefined, 0), party('w3', 'docs'));
    expect(resolveParty(w, 'w3')).toBe('w3');
    expect(resolveParty(w, 'BILLING')).toBe('w2');
    expect(resolveParty(w, 'feat/x')).toBe('w2');
    expect(resolveParty(w, 'nope')).toBeUndefined();
    expect(resolveParty(w, null)).toBe('w2');
    expect(resolveParty(worldOf(), null)).toBeUndefined();
  });
});
