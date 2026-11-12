import type { Member, Party } from '@bellwether/adapter/core';
import { describe, expect, it } from 'vitest';
import { ACTIVITIES, type Activity } from '../src/map/activity.js';
import { campPanel, campPanelHtml, esc } from '../src/map/camppanel.js';
import { DEFAULT_CAMP_LOOK, parseCampLook } from '../src/map/camplook.js';
import { campPose, sweat, zzz } from '../src/map/pose.js';
import { DEFAULT_VITALS } from '../src/theme.js';

const m = (paneId: string, over: Partial<Member> = {}): Member => ({ paneId, agent: 'claude', role: 'implementer', status: 'working', lastChange: 0, ...over });
const party = (members: Member[], over: Partial<Party> = {}): Party => ({
  id: 'p',
  label: 'api',
  branch: 'feat/x',
  isWorktree: true,
  status: 'working',
  members: Object.fromEntries(members.map((x) => [x.paneId, x])),
  tokens: {},
  ...over,
});

describe('campPose', () => {
  it('gives every activity a pose, with prop frames inside the art (4 frames, 2 for the signal lamp)', () => {
    for (const a of ACTIVITIES) {
      for (let t = 0; t < 30; t += 0.07) {
        const p = campPose(a as Activity, t, 1.3);
        expect(Number.isInteger(p.dx) && Number.isInteger(p.dy)).toBe(true);
        expect(p.prop).toBeGreaterThanOrEqual(0);
        expect(p.prop).toBeLessThan(a === 'blocked' ? 2 : 4);
        expect(p.index).toBeGreaterThanOrEqual(0);
      }
    }
  });
  it('distinguishes the activities by character animation', () => {
    const anim = (a: Activity) => campPose(a, 1, 0).anim;
    expect(anim('edit')).toBe('work');
    expect(anim('shell')).toBe('work');
    expect(anim('delegate')).toBe('talk');
    expect(anim('blocked')).toBe('raise');
    expect(anim('idle')).toBe('blink');
    // Without the hammering frames a member gestures instead of showing a missing sprite.
    expect(campPose('edit', 0.1, 0, false).anim).toBe('talk');
  });
  it('hammers faster than it stirs, and alternates the character frame', () => {
    const frames = (a: Activity) => new Set(Array.from({ length: 40 }, (_, i) => campPose(a, i * 0.05, 0).index));
    expect(frames('edit')).toEqual(new Set([0, 1]));
    const flips = (a: Activity) => {
      let n = 0;
      let last = campPose(a, 0, 0).index;
      for (let i = 1; i < 400; i++) {
        const k = campPose(a, i * 0.01, 0).index;
        if (k !== last) n++;
        last = k;
      }
      return n;
    };
    expect(flips('edit')).toBeGreaterThan(flips('shell'));
  });
  it('paces within a few pixels and faces the way it walks', () => {
    const xs = Array.from({ length: 200 }, (_, i) => campPose('think', i * 0.05, 0));
    expect(Math.max(...xs.map((p) => Math.abs(p.dx)))).toBeLessThanOrEqual(6);
    expect(new Set(xs.filter((p) => p.anim === 'walk').map((p) => p.face))).toEqual(new Set([1, -1]));
  });
  it('rises z and drops sweat inside a small box', () => {
    for (let t = 0; t < 10; t += 0.1) {
      for (const z of zzz(t, 0)) {
        expect(z.y).toBeLessThanOrEqual(0);
        expect(z.alpha).toBeGreaterThanOrEqual(0);
      }
      const s = sweat(t, 0);
      expect(s.y).toBeLessThanOrEqual(7);
      expect(s.alpha).toBeGreaterThanOrEqual(0);
    }
  });
});

describe('camp panel', () => {
  const p = party([m('1', { role: 'coordinator', status: 'blocked', say: 'Need a key' }), m('2', { status: 'working', tool: 'Edit', model: 'Opus 5.5', effort: 'high', quest: 'Fix <it>', vitals: { context: 12, quota: 80, at: 0 } })], {
    git: { dirty: 3, ahead: 1, noRemote: true },
  });

  it('builds one row per member with its activity, line and tiredness, beacon first', () => {
    const d = campPanel(p, 'api', 'coordinator', 10_000);
    expect(d.title).toBe('api');
    expect(d.branch).toBe('feat/x');
    expect(d.quest).toBe('Fix <it>');
    expect(d.git).toEqual(['3 uncommitted files', '1 unpushed commit', 'no remote']);
    expect(d.rows.map((r) => r.paneId)).toEqual(['1', '2']);
    expect(d.rows[0]).toMatchObject({ activity: 'blocked', doing: 'Needs you', line: 'Need a key', tired: false });
    expect(d.rows[1]).toMatchObject({ activity: 'edit', doing: 'Hammering · Edit', tired: true, model: 'Opus 5.5 · high', context: 12, quota: 80 });
  });
  it('shows no git line without git state, and none of the vitals when they are off', () => {
    const q = party(p.members ? Object.values(p.members) : []);
    expect(campPanel(q, 'api', 'coordinator', 0).git).toEqual([]);
    const off = campPanel(p, 'api', 'coordinator', 0, false);
    expect(off.quest).toBeUndefined();
    expect(off.rows[1]).not.toHaveProperty('context');
    expect(off.rows[1]!.tired).toBe(false);
    expect(campPanel(party([m('1')], { git: { dirty: 0, ahead: 0, noRemote: false } }), 'api', 'x', 0).git).toEqual(['clean']);
  });
  it('renders escaped html with the close buttons, bars in the vitals colours and the faces it is given', () => {
    const html = campPanelHtml(campPanel(p, 'api', 'coordinator', 0), DEFAULT_VITALS, { implementer: 'data:image/png;base64,AAAA' });
    expect(html).toContain('data-close="1"');
    expect(html).toContain('data-close="2"');
    expect(html).toContain('Quest: Fix &lt;it&gt;');
    expect(html).toContain('3 uncommitted files · 1 unpushed commit · no remote');
    expect(html).toContain('src="data:image/png;base64,AAAA"');
    // Low HP turns the context bar red; the quota bar keeps its own colour.
    expect(html).toContain(`background:${DEFAULT_VITALS.low}`);
    expect(html).toContain(`background:${DEFAULT_VITALS.quota}`);
    expect(html).toContain('12%');
    expect(esc('<a href="x">&')).toBe('&lt;a href=&quot;x&quot;&gt;&amp;');
  });
});

describe('camp look', () => {
  it('reads the camp block and falls back field by field', () => {
    expect(parseCampLook({ camp: { tone: 'outpost', sky: ['#000011', '#223344'], glow: '#5ae8ff' } })).toEqual({ tone: 'outpost', sky: ['#000011', '#223344'], glow: '#5ae8ff' });
    expect(parseCampLook({})).toEqual(DEFAULT_CAMP_LOOK);
    expect(parseCampLook(undefined)).toEqual(DEFAULT_CAMP_LOOK);
    expect(parseCampLook({ camp: { tone: 'weird', sky: ['red'], glow: 3 } })).toEqual(DEFAULT_CAMP_LOOK);
  });
});
