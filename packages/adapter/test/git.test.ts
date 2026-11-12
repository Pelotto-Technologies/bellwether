import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createSource, loadSourceConfig, parseSourceConfig } from '../src/config.js';
import { type GitRunner, GitProbeSource, parseStatusV2, probeGit, runGit } from '../src/git.js';
import { parseRecording } from '../src/recording.js';
import { scrubDelta } from '../src/scrub.js';
import { BaseSource } from '../src/source.js';
import type { Delta, GitState, Member, Party } from '../src/types.js';
import { MockGenerator } from '../src/mock.js';

const HEAD = '# branch.oid abc\n# branch.head main\n';

describe('parseStatusV2', () => {
  it('clean with upstream', () => {
    expect(parseStatusV2(`${HEAD}# branch.upstream origin/main\n# branch.ab +0 -0\n`)).toEqual({ dirty: 0, ahead: 0 });
  });
  it('counts modified, renamed, unmerged and untracked entries', () => {
    const out = `${HEAD}# branch.upstream origin/main\n# branch.ab +0 -0\n1 .M N... 100644 100644 100644 a b a.ts\n2 R. N... 100644 100644 100644 a b R100 new.ts\told.ts\nu UU N... 1 2 3 4 a b c conflict.ts\n? notes.txt\n`;
    expect(parseStatusV2(out)).toEqual({ dirty: 4, ahead: 0 });
  });
  it('reads ahead and ignores behind', () => {
    expect(parseStatusV2(`${HEAD}# branch.upstream origin/main\n# branch.ab +2 -5\n`)).toEqual({ dirty: 0, ahead: 2 });
  });
  it('no upstream means ahead 0', () => {
    expect(parseStatusV2(`${HEAD}? new.txt\n`)).toEqual({ dirty: 1, ahead: 0 });
  });
  it('detached HEAD has no branch.ab', () => {
    expect(parseStatusV2('# branch.oid abc\n# branch.head (detached)\n1 .M N... 100644 100644 100644 a b f\n')).toEqual({ dirty: 1, ahead: 0 });
  });
  it('empty output is clean', () => {
    expect(parseStatusV2('')).toEqual({ dirty: 0, ahead: 0 });
  });
});

/** A runner answering `status` and `remote` from a table keyed by cwd. */
function fakeRunner(table: Record<string, { status?: string; remote?: string; code?: number }>) {
  const calls: { args: string[]; cwd: string; timeoutMs: number }[] = [];
  const run: GitRunner = async (args, opts) => {
    calls.push({ args, ...opts });
    const row = table[opts.cwd];
    if (!row) throw new Error('no such folder');
    if (row.code) return { code: row.code, stdout: '' };
    return { code: 0, stdout: (args.includes('status') ? row.status : row.remote) ?? '' };
  };
  return { run, calls };
}

describe('probeGit', () => {
  it('combines status and remote, with safe flags and an args array', async () => {
    const { run, calls } = fakeRunner({ '/r': { status: `${HEAD}# branch.upstream o/m\n# branch.ab +3 -0\n? a\n? b\n`, remote: 'origin\n' } });
    expect(await probeGit('/r', run)).toEqual({ dirty: 2, ahead: 3, noRemote: false });
    expect(calls).toHaveLength(2);
    for (const c of calls) {
      expect(c.args).toContain('core.fsmonitor=false');
      expect(c.args).toContain('--no-optional-locks');
      expect(c.timeoutMs).toBeLessThanOrEqual(3000);
    }
    expect(calls[0]!.args).toEqual(expect.arrayContaining(['status', '--porcelain=v2', '--branch']));
    expect(calls[1]!.args).toContain('remote');
  });
  it('no remote', async () => {
    const { run } = fakeRunner({ '/r': { status: HEAD, remote: '\n' } });
    expect(await probeGit('/r', run)).toEqual({ dirty: 0, ahead: 0, noRemote: true });
  });
  it('is undefined for a non-repository, a failing runner and a missing folder', async () => {
    const { run } = fakeRunner({ '/n': { code: 128 } });
    expect(await probeGit('/n', run)).toBeUndefined();
    expect(await probeGit('/gone', run)).toBeUndefined();
  });
});

describe('probeGit against a real repository', () => {
  let git = true;
  try {
    execFileSync('git', ['--version'], { stdio: 'ignore' });
  } catch {
    git = false;
  }
  it.skipIf(!git)('reads a temp repo', async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'bw-git-'));
    const g = (...a: string[]) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.com', ...a], { cwd: dir, stdio: 'ignore' });
    g('init', '-q');
    writeFileSync(path.join(dir, 'a.txt'), 'a');
    g('add', 'a.txt');
    g('commit', '-q', '-m', 'one');
    expect(await probeGit(dir, runGit)).toEqual({ dirty: 0, ahead: 0, noRemote: true });
    writeFileSync(path.join(dir, 'a.txt'), 'changed');
    writeFileSync(path.join(dir, 'b.txt'), 'new');
    expect(await probeGit(dir, runGit)).toEqual({ dirty: 2, ahead: 0, noRemote: true });
    g('remote', 'add', 'origin', 'https://example.invalid/x.git');
    expect((await probeGit(dir, runGit))?.noRemote).toBe(false);
    expect(await probeGit(mkdtempSync(path.join(os.tmpdir(), 'bw-nogit-')), runGit)).toBeUndefined();
  });
});

function member(paneId: string, status: Member['status'] = 'idle'): Member {
  return { paneId, agent: 'claude', role: 'generic', status, lastChange: 0 };
}
function party(id: string, status: Member['status'] = 'idle'): Party {
  return { id, label: id, isWorktree: false, status, members: { [`${id}:p1`]: member(`${id}:p1`, status) }, tokens: {} };
}

class FakeSource extends BaseSource {
  folders = new Map<string, string>();
  started = false;
  async start() {
    this.started = true;
  }
  async stop() {
    this.started = false;
  }
  partyFolder(id: string) {
    return this.folders.get(id);
  }
  push(d: Delta) {
    this.emit(d);
  }
  snapshot(...parties: Party[]) {
    this.emit({ t: 0, kind: 'snapshot', world: { machine: 'local', parties: Object.fromEntries(parties.map((p) => [p.id, p])) } });
  }
}

const state = (dirty: number, ahead = 0, noRemote = false): GitState => ({ dirty, ahead, noRemote });
const out = (s: GitState) => ({ status: `${HEAD}# branch.ab +${s.ahead} -0\n${'? f\n'.repeat(s.dirty)}`, remote: s.noRemote ? '' : 'origin\n' });

describe('GitProbeSource', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  async function setup(table: Record<string, ReturnType<typeof out>>, opts: { concurrency?: number } = {}) {
    const inner = new FakeSource();
    const { run, calls } = fakeRunner(table);
    const src = new GitProbeSource(inner, { run, intervalMs: 30_000, ...opts });
    const seen: Delta[] = [];
    src.on('delta', (d) => seen.push(d));
    await src.start();
    const probes = () => calls.filter((c) => c.args.includes('status')).map((c) => c.cwd);
    const parties = () => seen.filter((d): d is Extract<Delta, { kind: 'party' }> => d.kind === 'party');
    return { inner, src, seen, calls, probes, parties };
  }

  it('probes a party immediately when it appears and emits a party delta with git', async () => {
    const { inner, probes, parties, seen } = await setup({ '/a': out(state(3, 2)) });
    inner.folders.set('p1', '/a');
    inner.snapshot(party('p1'));
    await vi.advanceTimersByTimeAsync(0);
    expect(probes()).toEqual(['/a']);
    expect(parties()).toHaveLength(1);
    expect(parties()[0]!.party.git).toEqual(state(3, 2));
    expect(seen[0]!.kind).toBe('snapshot');
  });

  it('probes at most once per interval and emits only on change', async () => {
    const table = { '/a': out(state(1)) };
    const { inner, probes, parties } = await setup(table);
    inner.folders.set('p1', '/a');
    inner.snapshot(party('p1'));
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(29_000);
    expect(probes()).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1500);
    expect(probes()).toHaveLength(2);
    expect(parties()).toHaveLength(1); // unchanged result: no new delta
    table['/a'] = out(state(2));
    await vi.advanceTimersByTimeAsync(30_000);
    expect(parties()).toHaveLength(2);
    expect(parties()[1]!.party.git).toEqual(state(2));
  });

  it('drops git from the party when the folder stops being a repository', async () => {
    const table: Record<string, { status?: string; remote?: string; code?: number }> = { '/a': out(state(1)) };
    const { inner, parties } = await setup(table as never);
    inner.folders.set('p1', '/a');
    inner.snapshot(party('p1'));
    await vi.advanceTimersByTimeAsync(0);
    table['/a'] = { code: 128 };
    await vi.advanceTimersByTimeAsync(31_000);
    expect(parties()).toHaveLength(2);
    expect('git' in parties()[1]!.party).toBe(false);
  });

  it('probes a shared folder once and updates every party in it', async () => {
    const { inner, probes, parties } = await setup({ '/a': out(state(1)) });
    inner.folders.set('p1', '/a');
    inner.folders.set('p2', '/a/'); // same folder, different spelling
    inner.snapshot(party('p1'), party('p2'));
    await vi.advanceTimersByTimeAsync(0);
    expect(probes()).toHaveLength(1);
    expect(parties().map((d) => d.party.id).sort()).toEqual(['p1', 'p2']);
  });

  it('puts cached git on later party deltas from the source', async () => {
    const { inner, seen } = await setup({ '/a': out(state(4)) });
    inner.folders.set('p1', '/a');
    inner.snapshot(party('p1'));
    await vi.advanceTimersByTimeAsync(0);
    inner.push({ t: 1, kind: 'party', party: { ...party('p1'), label: 'renamed' } });
    const last = seen[seen.length - 1]!;
    expect(last.kind === 'party' && last.party.git).toEqual(state(4));
  });

  it('never runs more than the concurrency cap at once', async () => {
    const release: (() => void)[] = [];
    let running = 0;
    let peak = 0;
    const run: GitRunner = (args) =>
      new Promise((resolve) => {
        running++;
        peak = Math.max(peak, running);
        release.push(() => {
          running--;
          resolve({ code: 0, stdout: args.includes('status') ? HEAD : 'origin\n' });
        });
      });
    const inner = new FakeSource();
    const src = new GitProbeSource(inner, { run, concurrency: 2 });
    await src.start();
    const ps = ['a', 'b', 'c', 'd'].map((n) => party(n));
    ps.forEach((p) => inner.folders.set(p.id, `/${p.id}`));
    inner.snapshot(...ps);
    await vi.advanceTimersByTimeAsync(0);
    expect(peak).toBe(2);
    // Finish probes (status then remote each) until all four folders were seen.
    for (let i = 0; i < 20 && release.length; i++) {
      release.shift()!();
      await vi.advanceTimersByTimeAsync(0);
    }
    expect(peak).toBe(2);
  });

  it('re-probes shortly after a member goes from working to done', async () => {
    const { inner, probes } = await setup({ '/a': out(state(1)) });
    inner.folders.set('p1', '/a');
    inner.snapshot(party('p1', 'working'));
    await vi.advanceTimersByTimeAsync(0);
    expect(probes()).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(5000);
    expect(probes()).toHaveLength(1);
    inner.push({ t: 1, kind: 'member', partyId: 'p1', member: member('p1:p1', 'done') });
    await vi.advanceTimersByTimeAsync(1000);
    expect(probes()).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1500);
    expect(probes()).toHaveLength(2);
  });

  it('gives parties without a folder no git and never probes them', async () => {
    const { inner, probes, parties } = await setup({});
    inner.snapshot(party('remote'));
    await vi.advanceTimersByTimeAsync(60_000);
    expect(probes()).toEqual([]);
    expect(parties()).toEqual([]);
  });

  it('stops probing and ignores in-flight results after stop', async () => {
    const { inner, src, probes, parties } = await setup({ '/a': out(state(1)) });
    inner.folders.set('p1', '/a');
    inner.snapshot(party('p1'));
    await src.stop();
    await vi.advanceTimersByTimeAsync(120_000);
    expect(inner.started).toBe(false);
    expect(probes().length).toBeLessThanOrEqual(1);
    expect(parties()).toHaveLength(0);
  });
});

describe('git config', () => {
  it('is off by default', () => {
    expect(parseSourceConfig('source = "live"').git).toBeUndefined();
    expect(parseSourceConfig('[git]\nenabled = false\n').git).toBeUndefined();
  });
  it('parses enabled and interval', () => {
    expect(parseSourceConfig('[git]\nenabled = true\n').git).toEqual({ enabled: true });
    expect(parseSourceConfig('[git]\nenabled = true\ninterval = 60\n').git).toEqual({ enabled: true, interval: 60 });
  });
  it('rejects bad values', () => {
    expect(() => parseSourceConfig('[git]\nenabled = "yes"\n')).toThrow(/git.enabled/);
    expect(() => parseSourceConfig('[git]\nenabled = true\ninterval = 1\n')).toThrow(/git.interval/);
  });
  it('BELLWETHER_GIT turns it on', async () => {
    expect((await loadSourceConfig('/nonexistent/bellwether.toml', { BELLWETHER_GIT: '1' })).git).toEqual({ enabled: true });
    expect((await loadSourceConfig('/nonexistent/bellwether.toml', {})).git).toBeUndefined();
  });
  it('createSource wraps live and hooks, not mock, only when enabled', () => {
    expect(createSource({ source: 'hooks', herdr: {}, git: { enabled: true } })).toBeInstanceOf(GitProbeSource);
    expect(createSource({ source: 'live', herdr: { sessions: ['x'] }, git: { enabled: true } })).toBeInstanceOf(GitProbeSource);
    expect(createSource({ source: 'mock', herdr: {}, git: { enabled: true } })).not.toBeInstanceOf(GitProbeSource);
    expect(createSource({ source: 'hooks', herdr: {} })).not.toBeInstanceOf(GitProbeSource);
  });
});

describe('recording and scrub', () => {
  it('git survives a recording round trip and scrubbing', () => {
    const p: Party = { ...party('p1'), git: state(3, 2, true) };
    const d: Delta = { t: 1, kind: 'party', party: p };
    expect(parseRecording(JSON.stringify(d) + '\n')[0]).toEqual(d);
    const scrubbed = scrubDelta(d);
    expect(scrubbed.kind === 'party' && scrubbed.party.git).toEqual(state(3, 2, true));
  });
});

describe('mock git', () => {
  it('gives parties git values that drift', () => {
    const gen = new MockGenerator({ seed: 3 });
    const init = gen.initial();
    expect(init.kind === 'snapshot' && Object.values(init.world.parties).every((p) => p.git !== undefined)).toBe(true);
    const kinds = new Set<string>();
    for (let i = 0; i < 30; i++) kinds.add(gen.step().kind);
    expect(kinds.has('party')).toBe(true);
  });
});

describe('hooks source folders', () => {
  it('reports the session cwd as the party folder', async () => {
    const { HooksSource, hooksPartyId } = await import('../src/hooks/index.js');
    const dir = mkdtempSync(path.join(os.tmpdir(), 'bw-hookgit-'));
    const file = path.join(dir, 'events.jsonl');
    writeFileSync(file, JSON.stringify({ v: 1, t: Date.now(), agent: 'claude', ev: 'start', session: 's1', cwd: '/home/dev/proj' }) + '\n');
    const src = new HooksSource({ file, pollMs: 100_000, pruneMs: 100_000 });
    await src.start();
    expect(src.partyFolder(hooksPartyId('/home/dev/proj'))).toBe('/home/dev/proj');
    expect(src.partyFolder('nope')).toBeUndefined();
    await src.stop();
  });
});
