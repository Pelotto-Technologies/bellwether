import { existsSync, mkdtempSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadSourceConfig, parseSourceConfig } from '../src/config.js';
import { defaultStatsFile, loadStats, resolveStatsFile, STATS_VERSION, StatsWriter, writeStatsAtomic } from '../src/stats-store.js';
import type { StatsSnapshot } from '../src/stats.js';

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(path.join(os.tmpdir(), 'bw-stats-'));
});
afterEach(() => vi.useRealTimers());

const snap = (xp: number): StatsSnapshot => ({ roles: { implementer: { xp, tasks: 1, workingMs: 5, blockedMs: 0, messages: 0, tools: { edit: 2 } } }, lifetime: { tasks: 1, quests: 0, workingMs: 5, blockedMs: 0, messages: 0 } });

describe('loadStats', () => {
  it('a missing file is zero', () => {
    expect(loadStats(path.join(dir, 'nope.json')).roles).toEqual({});
  });
  it('a corrupt file, a wrong version and junk values are tolerated', () => {
    const f = path.join(dir, 's.json');
    const log = vi.fn();
    writeFileSync(f, '{ not json');
    expect(loadStats(f, log).roles).toEqual({});
    expect(log).toHaveBeenCalled();
    writeFileSync(f, JSON.stringify({ version: 99, roles: { implementer: { xp: 5 } } }));
    expect(loadStats(f).roles).toEqual({});
    writeFileSync(f, JSON.stringify({ version: STATS_VERSION, roles: { implementer: { xp: 'a', tasks: 3 } } }));
    expect(loadStats(f).roles.implementer).toMatchObject({ xp: 0, tasks: 3 });
  });
  it('round trips what was written', () => {
    const f = path.join(dir, 's.json');
    writeStatsAtomic(f, snap(42.123));
    expect(loadStats(f).roles.implementer?.xp).toBeCloseTo(42.12, 2);
    expect(JSON.parse(readFileSync(f, 'utf8')).version).toBe(STATS_VERSION);
  });
});

describe('writeStatsAtomic', () => {
  it('writes mode 0600, creates the directory and leaves no temp file', () => {
    const f = path.join(dir, 'sub', '.bellwether', 'stats.json');
    writeStatsAtomic(f, snap(1));
    if (process.platform !== 'win32') expect(statSync(f).mode & 0o777).toBe(0o600);
    expect(readdirSync(path.dirname(f))).toEqual(['stats.json']);
  });
  it('replaces an existing file and holds counters only', () => {
    const f = path.join(dir, 's.json');
    writeStatsAtomic(f, snap(1));
    writeStatsAtomic(f, snap(2));
    const text = readFileSync(f, 'utf8');
    expect(JSON.parse(text).roles.implementer.xp).toBe(2);
    expect(Object.keys(JSON.parse(text)).sort()).toEqual(['lifetime', 'roles', 'version']);
  });
  it('a failed write leaves the old file and no temp', () => {
    const f = path.join(dir, 's.json');
    writeStatsAtomic(f, snap(1));
    const bad = { roles: {}, lifetime: {} } as unknown as StatsSnapshot;
    Object.defineProperty(bad, 'roles', { get() { throw new Error('boom'); } });
    expect(() => writeStatsAtomic(f, bad)).toThrow();
    expect(loadStats(f).roles.implementer?.xp).toBe(1);
    expect(readdirSync(dir)).toEqual(['s.json']);
  });
});

describe('StatsWriter', () => {
  it('writes the first update at once and then at most once per interval', () => {
    vi.useFakeTimers();
    const f = path.join(dir, 's.json');
    const w = new StatsWriter(f, { now: () => Date.now(), minIntervalMs: 30_000 });
    w.update(snap(1));
    vi.advanceTimersByTime(1);
    expect(loadStats(f).roles.implementer?.xp).toBe(1);
    w.update(snap(2));
    w.update(snap(3));
    vi.advanceTimersByTime(29_000);
    expect(loadStats(f).roles.implementer?.xp).toBe(1);
    vi.advanceTimersByTime(1500);
    expect(loadStats(f).roles.implementer?.xp).toBe(3);
  });
  it('flush writes now, and does nothing when nothing is pending', () => {
    vi.useFakeTimers();
    const f = path.join(dir, 's.json');
    const w = new StatsWriter(f, { now: () => Date.now() });
    w.flush();
    expect(existsSync(f)).toBe(false);
    w.update(snap(1));
    vi.advanceTimersByTime(1);
    w.update(snap(7));
    w.flush();
    expect(loadStats(f).roles.implementer?.xp).toBe(7);
  });
  it('a write error is logged, never thrown', () => {
    const log = vi.fn();
    const blocker = path.join(dir, 'file');
    writeFileSync(blocker, 'x');
    const w = new StatsWriter(path.join(blocker, 'stats.json'), { log });
    expect(() => w.flush(snap(1))).not.toThrow();
    expect(log).toHaveBeenCalled();
  });
});

describe('enabling and the file location', () => {
  it('is on by default at ~/.bellwether/stats.json', () => {
    expect(resolveStatsFile(undefined, {}, false, '/home/u')).toBe(defaultStatsFile('/home/u'));
    expect(defaultStatsFile('/home/u')).toBe(path.join('/home/u', '.bellwether', 'stats.json'));
  });
  it('config, flag and env can turn it off', () => {
    expect(resolveStatsFile({ enabled: false }, {})).toBeUndefined();
    expect(resolveStatsFile(undefined, {}, true)).toBeUndefined();
    expect(resolveStatsFile(undefined, { BELLWETHER_STATS: '0' })).toBeUndefined();
    expect(resolveStatsFile(undefined, { BELLWETHER_STATS: 'false' })).toBeUndefined();
  });
  it('config and env move the file; the env wins', () => {
    expect(resolveStatsFile({ file: '/a.json' }, {})).toBe('/a.json');
    expect(resolveStatsFile({ file: '/a.json' }, { BELLWETHER_STATS: '/b.json' })).toBe('/b.json');
    expect(resolveStatsFile({ file: '/a.json' }, { BELLWETHER_STATS: '1' })).toBe('/a.json');
  });
  it('parses [stats] and recap from bellwether.toml and applies BELLWETHER_STATS', async () => {
    expect(parseSourceConfig('[stats]\nenabled = false\n').stats).toEqual({ enabled: false });
    expect(parseSourceConfig('[stats]\nfile = "/x.json"\n').stats).toEqual({ file: '/x.json' });
    expect(parseSourceConfig('recap = false\n').recap).toBe(false);
    expect(parseSourceConfig('source = "mock"').stats).toBeUndefined();
    expect(() => parseSourceConfig('[stats]\nenabled = "no"\n')).toThrow(/stats.enabled/);
    const f = path.join(dir, 'x.toml');
    writeFileSync(f, 'source = "mock"\n');
    expect((await loadSourceConfig(f, { BELLWETHER_STATS: '0' })).stats).toEqual({ enabled: false });
    expect((await loadSourceConfig(f, { BELLWETHER_STATS: '/s.json' })).stats).toEqual({ file: '/s.json' });
  });
});
