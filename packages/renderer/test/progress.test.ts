import { applyDelta, emptyWorld, type Delta, type Member, type Recap, type World } from '@bellwether/adapter/core';
import { describe, expect, it } from 'vitest';
import { LEVELUP_SECONDS, levelUpFrame } from '../src/anim-levelup.js';
import { EventCore } from '../src/cues/events.js';
import { CueGate, soundsFor } from '../src/cues/gate.js';
import { resolveOptions, resolveRecap, servedCues } from '../src/cues/options.js';
import { formatSpan, membersLine, RECAP_SHOW_MS, RecapController, recapModel } from '../src/cues/recap.js';
import { MOTIFS, schedule } from '../src/cues/schedule.js';
import { DEFAULT_SOUNDS } from '../src/cues/style.js';
import { toastFor } from '../src/cues/toasts.js';
import { describeParty } from '../src/map/detail.js';
import { campPanel, campPanelHtml } from '../src/map/camppanel.js';
import { levelBadge, levelBadgeHtml, xpBarHtml } from '../src/map/level.js';
import { DEFAULT_VITALS, parseTheme } from '../src/theme.js';

const packs = ['neutral', 'aesir', 'wayfarers'];

const recap: Recap = { durationMs: 252_000, members: { coordinator: 1, implementer: 2 }, tasks: 3, blockedMs: 65_000, tools: { edit: 5, shell: 2, read: 9 }, xp: 84, levelUps: [{ role: 'implementer', level: 4 }] };

describe('recap model', () => {
  it('lists time, party, tasks, blocked time and XP, tools most used first, and the level ups', () => {
    const m = recapModel(recap, 'api');
    expect(m.title).toBe('Quest complete');
    expect(m.rows.map((r) => [r.label, r.value])).toEqual([
      ['Time', '4m 12s'],
      ['Party', '1 coordinator, 2 implementers'],
      ['Tasks done', '3'],
      ['Waiting on you', '1m 05s'],
      ['Experience', '+84 XP'],
    ]);
    expect(m.tools.map((t) => `${t.label} ${t.count}`)).toEqual(['Reads 9', 'Edits 5', 'Commands 2']);
    expect(m.levelUps).toEqual(['Implementer reached Lv 4']);
    expect(m.roles).toEqual(['coordinator', 'implementer']);
    expect(m.compact).toBe('Quest complete · api · 3 tasks · +84 XP');
  });
  it('says none for no blocked time and handles an empty recap', () => {
    const m = recapModel({ durationMs: 0, members: {}, tasks: 1, blockedMs: 0, tools: {}, xp: 0, levelUps: [] });
    expect(m.rows.find((r) => r.label === 'Waiting on you')!.value).toBe('none');
    expect(m.rows.find((r) => r.label === 'Party')!.value).toBe('none');
    expect(m.tools).toEqual([]);
    expect(m.compact).toBe('Quest complete · 1 task · +0 XP');
  });
  it('formats spans and members', () => {
    expect([0, 42_000, 61_000, 3_725_000].map(formatSpan)).toEqual(['0s', '42s', '1m 01s', '1h 02m']);
    expect(membersLine({ writer: 1 })).toBe('1 writer');
  });
});

describe('RecapController', () => {
  it('shows for 12 seconds, a new recap replaces it, dismiss clears it', () => {
    const c = new RecapController();
    const a = recapModel(recap, 'a');
    expect(c.visible(0)).toBeUndefined();
    c.show(a, 1000);
    expect(c.visible(1000 + RECAP_SHOW_MS - 1)).toBe(a);
    expect(c.visible(1000 + RECAP_SHOW_MS)).toBeUndefined();
    const b = recapModel(recap, 'b');
    c.show(a, 0);
    c.show(b, 500);
    expect(c.visible(600)).toBe(b);
    c.dismiss();
    expect(c.visible(600)).toBeUndefined();
  });
});

describe('recap option parsing', () => {
  const q = (s: string) => new URLSearchParams(s);
  it('?recap=0 beats the toml, which beats the default (on)', () => {
    expect(resolveRecap(q(''), {})).toBe(true);
    expect(resolveRecap(q(''), { recap: false })).toBe(false);
    expect(resolveRecap(q('recap=0'), { recap: true })).toBe(false);
    expect(resolveRecap(q('recap=1'), { recap: false })).toBe(true);
    expect(resolveRecap(q('recap'), { recap: false })).toBe(true);
  });
  it('served config carries recap only when boolean', () => {
    expect(servedCues({ recap: false })).toEqual({ recap: false });
    expect(servedCues({ recap: 'no' })).toEqual({});
  });
  it('the full card has room in the map and in browser strips, not in the desktop strip or the alerts page', () => {
    const o = (mode: 'strip' | 'map' | 'alerts', desktop = false) => resolveOptions({ params: q(''), served: {}, mode, desktop }).card;
    expect(o('map')).toBe(true);
    expect(o('map', true)).toBe(true);
    expect(o('strip')).toBe(true);
    expect(o('strip', true)).toBe(false);
    expect(o('alerts')).toBe(false);
  });
});

describe('moments in the cue core', () => {
  const world = (): World => applyDelta(emptyWorld(), { t: 0, kind: 'snapshot', world: { machine: 'l', parties: { w1: { id: 'w1', label: 'api', isWorktree: false, status: 'idle', tokens: {}, members: { p1: { paneId: 'p1', agent: 'claude', role: 'implementer', status: 'idle', lastChange: 0 } } } } } });
  const levelUp: Delta = { t: 5, kind: 'moment', moment: 'level_up', partyId: 'w1', paneId: 'p1', role: 'implementer', level: 3 };
  const quest: Delta = { t: 6, kind: 'moment', moment: 'quest_complete', partyId: 'w1', recap };

  it('turns level_up and quest_complete into cues carrying only role, label, level and counters', () => {
    const core = new EventCore({ quietMs: 0 });
    expect(core.process(world(), levelUp, 10)).toEqual([{ kind: 'levelUp', at: 5, partyId: 'w1', paneId: 'p1', role: 'implementer', label: 'api', level: 3 }]);
    const [q] = core.process(world(), quest, 20);
    expect(q).toMatchObject({ kind: 'questComplete', partyId: 'w1', label: 'api', recap });
  });
  it('stays quiet right after a snapshot and drops a repeat inside the flap window', () => {
    const core = new EventCore();
    core.process(world(), { t: 0, kind: 'snapshot', world: world() }, 0);
    expect(core.process(world(), levelUp, 100)).toEqual([]);
    expect(core.process(world(), levelUp, 5000)).toHaveLength(1);
    expect(core.process(world(), levelUp, 5500)).toHaveLength(0);
  });
  it('ignores malformed moments', () => {
    const core = new EventCore({ quietMs: 0 });
    expect(core.process(world(), { t: 1, kind: 'moment', moment: 'quest_complete', partyId: 'w1' }, 1)).toEqual([]);
    expect(core.process(world(), { t: 1, kind: 'moment', moment: 'level_up', partyId: 'w1' }, 2)).toEqual([]);
  });
  it('has banners, sounds and gate entries for both cues', () => {
    expect(toastFor({ kind: 'levelUp', at: 0, role: 'implementer', level: 3 })).toMatchObject({ text: 'LEVEL UP · implementer reached Lv 3', role: 'implementer' });
    expect(toastFor({ kind: 'questComplete', at: 0, label: 'api', recap })?.text).toBe('Quest complete · api · 3 tasks · +84 XP');
    expect(toastFor({ kind: 'questComplete', at: 0 })).toBeUndefined();
    expect(soundsFor([{ kind: 'levelUp', at: 0 }, { kind: 'questComplete', at: 0 }])).toEqual(['levelUp', 'questComplete']);
    const gate = new CueGate();
    expect(gate.allow('levelUp', 0)).toBe(true);
    expect(gate.allow('levelUp', 100)).toBe(false);
  });
  it('plays per-pack flavour: the schedule follows the pack style', () => {
    for (const kind of ['levelUp', 'questComplete'] as const) {
      expect(MOTIFS[kind].degrees.length).toBe(MOTIFS[kind].beats.length);
      const a = schedule(kind, DEFAULT_SOUNDS);
      const b = schedule(kind, { ...DEFAULT_SOUNDS, wave: 'triangle', root: 55, tempo: 100 });
      expect(a.length).toBe(MOTIFS[kind].degrees.length);
      expect(b[0]!.freq).not.toBe(a[0]!.freq);
      expect(b[0]!.wave).toBe('triangle');
    }
  });
  it('every theme has a sound style, so both cues get a flavour in each pack', async () => {
    for (const name of packs) {
      const mod = (await import(`../../../themes/${name}/theme.json`)) as { default: unknown };
      const t = parseTheme(mod.default);
      expect(schedule('questComplete', t.sounds).length).toBeGreaterThan(0);
      expect(schedule('levelUp', t.sounds)[0]!.wave).toBe(t.sounds.wave);
    }
  });
});

describe('level-up flourish', () => {
  it('runs for a bounded time and floats the arrow up', () => {
    expect(levelUpFrame(-1, false)).toBeUndefined();
    expect(levelUpFrame(LEVELUP_SECONDS, false)).toBeUndefined();
    const early = levelUpFrame(0.3, false)!;
    const late = levelUpFrame(1.5, false)!;
    expect(late.arrowRise).toBeGreaterThan(early.arrowRise);
    expect(early.alpha).toBe(1);
    expect(levelUpFrame(LEVELUP_SECONDS - 0.05, false)!.alpha).toBeLessThan(0.2);
    expect(late.sparkles.length).toBeGreaterThan(0);
  });
  it('reduced motion: no sparkles and no movement', () => {
    const a = levelUpFrame(0.5, true)!;
    const b = levelUpFrame(1.5, true)!;
    expect(a.sparkles).toEqual([]);
    expect(a.arrowRise).toBe(b.arrowRise);
    expect(a.textAlpha).toBeGreaterThan(0);
  });
});

describe('level badge and panels', () => {
  const m = (extra: Partial<Member> = {}): Member => ({ paneId: 'p1', agent: 'claude', role: 'implementer', status: 'working', lastChange: 0, ...extra });
  it('badge text and bar fill', () => {
    expect(levelBadge(m())).toBeUndefined();
    expect(levelBadge(m({ level: 3, xp: { have: 12, next: 60 } }))).toEqual({ label: 'Lv 3', pct: 20, title: '12 / 60 XP' });
    expect(levelBadge(m({ level: 99, xp: { have: 0, next: 0 } }))).toMatchObject({ pct: 100 });
    expect(levelBadge(m({ level: 2, xp: { have: 999, next: 60 } }))!.pct).toBe(100);
  });
  it('html is empty without a level and escapes text', () => {
    expect(levelBadgeHtml(undefined)).toBe('');
    expect(xpBarHtml(undefined)).toBe('');
    expect(levelBadgeHtml(levelBadge(m({ level: 3, xp: { have: 1, next: 2 } })))).toContain('Lv 3');
    expect(xpBarHtml(levelBadge(m({ level: 3, xp: { have: 1, next: 2 } })))).toContain('width:50%');
  });
  const party = { id: 'w1', label: 'api', isWorktree: false, status: 'working' as const, tokens: {}, members: { p1: m({ level: 4, xp: { have: 30, next: 80 } }), p2: m({ paneId: 'p2', role: 'reviewer' }) } };
  it('map detail rows and the camp panel carry the badge for leveled members only', () => {
    const d = describeParty(party, 'Camp', 'architect', 0);
    expect(d.rows.find((r) => r.paneId === 'p1')!.level).toEqual({ label: 'Lv 4', pct: 38, title: '30 / 80 XP' });
    expect(d.rows.find((r) => r.paneId === 'p2')!.level).toBeUndefined();
    const panel = campPanel(party, 'Camp', 'architect', 0);
    const html = campPanelHtml(panel, DEFAULT_VITALS);
    expect(html).toContain('<span class="lv" title="30 / 80 XP">Lv 4</span>');
    expect(html.match(/class="xpbar"/g)).toHaveLength(1);
  });
});
