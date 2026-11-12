import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AGENT_TARGETS, install, uninstall, findTarget, type AgentContext } from '../src/index.js';
import { buildEmitEvent, normalizeHookPayload } from '../src/hook/event.js';
import { cacheName, decodeWrap, encodeWrap, parseStatusLine, runStatusLineHook, statusLineText, vitalsTokenArgs, STATUSLINE_MARKER } from '../src/hook/statusline.js';
import { sayHookCommand, statusLineCommand } from '../src/install.js';

const ch = (...codes: number[]) => String.fromCharCode(...codes);

// The shape documented at https://code.claude.com/docs/en/statusline (only the fields we read).
const payload = {
  session_id: 'abc-123',
  cwd: '/w/proj',
  session_name: 'Fix the auth flow',
  model: { id: 'claude-opus-5-5', display_name: 'Opus 5.5' },
  workspace: { current_dir: '/w/proj', project_dir: '/w/proj' },
  context_window: { used_percentage: 12, remaining_percentage: 88 },
  effort: { level: 'high' },
  rate_limits: { five_hour: { used_percentage: 26.4, resets_at: 1738425600 } },
};

let root: string;
let home: string;
let eventsPath: string;
const env = (extra: Record<string, string> = {}) => ({ BELLWETHER_EVENTS: eventsPath, ...extra });
const events = () => (existsSync(eventsPath) ? readFileSync(eventsPath, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);
const run = (p: unknown, extra: Partial<Parameters<typeof runStatusLineHook>[0]> = {}) =>
  runStatusLineHook({ stdin: JSON.stringify(p), env: env(), home, now: 1000, ...extra });

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'bw-statusline-'));
  home = join(root, 'home');
  eventsPath = join(root, 'events.jsonl');
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

describe('parseStatusLine', () => {
  it('reads the documented fields and flips the quota to remaining', () => {
    expect(parseStatusLine(payload)).toEqual({ session: 'abc-123', cwd: '/w/proj', ctx: 88, quota: 74, model: 'Opus 5.5', effort: 'high', name: 'Fix the auth flow' });
  });
  it('leaves absent things absent: no guess without rate limits, effort or a name', () => {
    const v = parseStatusLine({ session_id: 's', model: { display_name: 'Haiku' }, context_window: { remaining_percentage: null } })!;
    expect(v).toEqual({ session: 's', model: 'Haiku' });
  });
  it('falls back to used_percentage for context and to cwd for the folder', () => {
    expect(parseStatusLine({ session_id: 's', cwd: '/c', context_window: { used_percentage: 30 } })).toMatchObject({ cwd: '/c', ctx: 70 });
  });
  it('needs a session id and sanitizes text', () => {
    expect(parseStatusLine({ model: { display_name: 'x' } })).toBeUndefined();
    expect(parseStatusLine('nope')).toBeUndefined();
    expect(parseStatusLine({ session_id: 's', session_name: `a${ch(0x202e)}${ch(0)}b${'c'.repeat(200)}` })!.name).toHaveLength(80);
  });
  it('prints a short line of its own', () => {
    expect(statusLineText(parseStatusLine(payload)!)).toBe('Opus 5.5 · ctx 88% · 5h 74%');
    expect(statusLineText({ session: 's', model: 'Haiku' })).toBe('Haiku');
  });
});

describe('runStatusLineHook', () => {
  it('appends one vitals event and prints its own line', () => {
    expect(run(payload)).toBe('Opus 5.5 · ctx 88% · 5h 74%');
    expect(events()).toEqual([{ v: 1, t: 1000, agent: 'claude', ev: 'vitals', session: 'abc-123', cwd: '/w/proj', ctx: 88, quota: 74, model: 'Opus 5.5', effort: 'high', name: 'Fix the auth flow' }]);
  });

  it('writes again only when a value changed', () => {
    run(payload);
    run(payload);
    run({ ...payload, rate_limits: { five_hour: { used_percentage: 26.2 } } }); // still 74 after rounding
    expect(events()).toHaveLength(1);
    run({ ...payload, context_window: { remaining_percentage: 87 } });
    expect(events()).toHaveLength(2);
    expect(events()[1].ctx).toBe(87);
    run({ ...payload, context_window: { remaining_percentage: 87 }, session_name: 'Renamed' });
    expect(events()).toHaveLength(3);
  });

  it('tracks sessions separately', () => {
    run(payload);
    run({ ...payload, session_id: 'other' });
    expect(events().map((e) => e.session)).toEqual(['abc-123', 'other']);
  });

  it('keeps a private cache file named safely per session', () => {
    run({ ...payload, session_id: '../../etc/passwd' });
    const dir = join(home, '.bellwether', 'vitals');
    const files = readdirSync(dir);
    expect(files).toHaveLength(1);
    expect(files[0]).toBe(cacheName('../../etc/passwd'));
    expect(files[0]).toMatch(/^[A-Za-z0-9_-]+\.json$/);
    if (process.platform !== 'win32') expect(statSync(join(dir, files[0]!)).mode & 0o777).toBe(0o600);
    expect(files.some((f) => f.endsWith('.tmp'))).toBe(false);
  });

  it('writes nothing for a payload without values or a session', () => {
    expect(run({ session_id: 's' })).toBe('');
    expect(run({ nothing: true })).toBe('');
    expect(events()).toEqual([]);
  });

  it('never throws on garbage, an unwritable events file or a broken cache', () => {
    expect(runStatusLineHook({ stdin: 'not json', env: env(), home })).toBe('');
    expect(runStatusLineHook({ stdin: '', env: env(), home })).toBe('');
    writeFileSync(join(root, 'file'), '');
    expect(() => run(payload, { env: { BELLWETHER_EVENTS: join(root, 'file', 'x', 'events.jsonl') } })).not.toThrow();
    mkdirSync(join(home, '.bellwether', 'vitals'), { recursive: true });
    writeFileSync(join(home, '.bellwether', 'vitals', cacheName('abc-123')), '{broken');
    expect(run(payload)).toBe('Opus 5.5 · ctx 88% · 5h 74%');
    expect(events()).toHaveLength(1);
  });

  describe('wrapping', () => {
    const wrap = encodeWrap('my-statusline --fancy "x"');

    it('round-trips the command through base64url', () => {
      expect(wrap).toMatch(/^[A-Za-z0-9_-]+$/);
      expect(decodeWrap(wrap)).toBe('my-statusline --fancy "x"');
    });

    it('runs the previous command with the same stdin and prints its stdout unchanged', () => {
      const seen: [string, string][] = [];
      const out = run(payload, { wrap, runWrapped: (c, stdin) => (seen.push([c, stdin]), '\u001b[32mgit:main\u001b[0m  \n') });
      expect(out).toBe('\u001b[32mgit:main\u001b[0m  \n');
      expect(seen).toEqual([['my-statusline --fancy "x"', JSON.stringify(payload)]]);
      expect(events()).toHaveLength(1);
    });

    it('swallows a failing or throwing wrapped command and still reports', () => {
      expect(run(payload, { wrap, runWrapped: () => undefined })).toBe('');
      expect(run({ ...payload, session_id: 'b' }, { wrap, runWrapped: () => { throw new Error('boom'); } })).toBe('');
      expect(events()).toHaveLength(2);
    });

    it('really runs a shell command with a short timeout (default runner)', () => {
      const cmd = process.platform === 'win32' ? 'echo hi' : 'cat >/dev/null; printf hi';
      expect(run(payload, { wrap: encodeWrap(cmd) })).toMatch(/^hi/);
      expect(run(payload, { wrap: encodeWrap('exit 3') })).toBe('');
    });
  });

  describe('Herdr pane tokens', () => {
    it('reports tokens through the injected runner, only on change', () => {
      const calls: [string, string[]][] = [];
      const runner = (bin: string, args: string[]) => void calls.push([bin, args]);
      const e = env({ HERDR_PANE_ID: 'w1:p3', HERDR_BIN_PATH: '/opt/herdr' });
      run(payload, { env: e, run: runner });
      run(payload, { env: e, run: runner });
      expect(calls).toEqual([['/opt/herdr', ['pane', 'report-metadata', 'w1:p3', '--source', 'bellwether', '--token', 'ctx=88', '--token', 'quota=74', '--token', 'model=Opus 5.5', '--token', 'effort=high', '--token', 'quest=Fix the auth flow']]]);
      run({ ...payload, context_window: { remaining_percentage: 80 } }, { env: e, run: runner });
      expect(calls).toHaveLength(2);
      expect(calls[1]![1]).toContain('ctx=80');
    });

    it('does nothing without a pane id and retries after a runner failure', () => {
      const calls: string[][] = [];
      run(payload, { run: (_b, a) => void calls.push(a) });
      expect(calls).toEqual([]);
      const e = env({ HERDR_PANE_ID: 'w1:p1' });
      let fail = true;
      const runner = (_b: string, a: string[]) => {
        if (fail) throw new Error('no herdr');
        calls.push(a);
      };
      expect(() => run(payload, { env: e, run: runner })).not.toThrow();
      fail = false;
      run(payload, { env: e, run: runner });
      expect(calls).toHaveLength(1);
    });

    it('builds no arguments when there is nothing to report', () => {
      expect(vitalsTokenArgs({ session: 's' }, 'w1:p1')).toBeUndefined();
    });
  });
});

describe('emit --ev vitals', () => {
  it('builds a vitals event from flags', () => {
    const e = buildEmitEvent({ ev: 'vitals', session: 's', ctx: '40', quota: '120', model: 'Opus 5.5', effort: 'low', name: 'My quest' }, {}, '/w', 5);
    expect(e).toMatchObject({ ev: 'vitals', session: 's', ctx: 40, quota: 100, model: 'Opus 5.5', effort: 'low', name: 'My quest' });
  });
  it('rejects a non-numeric percentage and an empty vitals event', () => {
    expect(() => buildEmitEvent({ ev: 'vitals', ctx: 'x' }, {}, '/w', 5)).toThrow(/--ctx/);
    expect(() => buildEmitEvent({ ev: 'vitals' }, {}, '/w', 5)).toThrow(/at least one/);
  });
  it('passes a ready-made vitals line through, sanitized', () => {
    const e = normalizeHookPayload({ v: 1, ev: 'vitals', session: 's', ctx: 500, model: `M${ch(0x202e)}` }, { now: 9, env: {} })!;
    expect(e).toMatchObject({ ev: 'vitals', ctx: 100, model: 'M' });
  });
});

describe('install --statusline', () => {
  let claudeDir: string;
  let copilotDir: string;
  const ctx = (): AgentContext => ({ env: { CLAUDE_CONFIG_DIR: claudeDir, COPILOT_HOME: copilotDir }, home, platform: process.platform, onPath: () => true });
  const settings = () => JSON.parse(readFileSync(join(claudeDir, 'settings.json'), 'utf8'));
  const line = statusLineCommand('/usr/bin/node', '/opt/bw/main.js');
  const targets = () => AGENT_TARGETS.filter((t) => t.id === 'claude');

  beforeEach(() => {
    claudeDir = join(root, 'claude');
    copilotDir = join(root, 'copilot');
    mkdirSync(claudeDir);
    mkdirSync(copilotDir);
  });

  it('sets a bare statusLine when there is none, and uninstall removes the key', () => {
    install(ctx(), targets(), sayHookCommand(), undefined, line);
    expect(settings().statusLine).toEqual({ type: 'command', command: `"/usr/bin/node" "/opt/bw/main.js" hook statusline # ${STATUSLINE_MARKER}` });
    uninstall(ctx(), targets());
    expect(settings().statusLine).toBeUndefined();
  });

  it('wraps an existing statusLine, keeps its other keys, and restores it exactly', () => {
    const original = { type: 'command', command: '~/.claude/my-line.sh --x', padding: 2, refreshInterval: 5 };
    writeFileSync(join(claudeDir, 'settings.json'), JSON.stringify({ model: 'opus', statusLine: original }, null, 2));
    install(ctx(), targets(), sayHookCommand(), undefined, line);
    const s = settings().statusLine;
    expect(s.command).toContain('hook statusline --wrap ');
    expect(s.command).toContain(STATUSLINE_MARKER);
    expect(s).toMatchObject({ type: 'command', padding: 2, refreshInterval: 5 });
    const token = /--wrap (\S+)/.exec(s.command)![1]!;
    expect(decodeWrap(token)).toBe(original.command);
    uninstall(ctx(), targets());
    expect(settings().statusLine).toEqual(original);
    expect(settings().model).toBe('opus');
  });

  it('is idempotent: a re-install never double-wraps', () => {
    writeFileSync(join(claudeDir, 'settings.json'), JSON.stringify({ statusLine: { type: 'command', command: 'orig.sh' } }));
    install(ctx(), targets(), sayHookCommand(), undefined, line);
    const once = settings().statusLine.command;
    install(ctx(), targets(), sayHookCommand(), undefined, line);
    install(ctx(), targets(), sayHookCommand(), undefined, line);
    expect(settings().statusLine.command).toBe(once);
    expect(once.match(/hook statusline/g)).toHaveLength(1);
    uninstall(ctx(), targets());
    expect(settings().statusLine).toEqual({ type: 'command', command: 'orig.sh' });
  });

  it('does not touch the status line without the flag, and a plain re-install keeps ours', () => {
    writeFileSync(join(claudeDir, 'settings.json'), JSON.stringify({ statusLine: { type: 'command', command: 'orig.sh' } }));
    install(ctx(), targets());
    expect(settings().statusLine.command).toBe('orig.sh');
    install(ctx(), targets(), sayHookCommand(), undefined, line);
    install(ctx(), targets());
    expect(settings().statusLine.command).toContain(STATUSLINE_MARKER);
  });

  it('uninstall leaves a status line that is not ours alone', () => {
    writeFileSync(join(claudeDir, 'settings.json'), JSON.stringify({ statusLine: { type: 'command', command: 'orig.sh' } }));
    uninstall(ctx(), targets());
    expect(settings().statusLine).toEqual({ type: 'command', command: 'orig.sh' });
  });

  it('only Claude Code has a status line; Copilot settings are untouched', () => {
    expect(findTarget('copilot')!.addStatusLine).toBeUndefined();
    install(ctx(), AGENT_TARGETS, sayHookCommand(), undefined, line);
    expect(JSON.parse(readFileSync(join(copilotDir, 'settings.json'), 'utf8')).statusLine).toBeUndefined();
    expect(settings().statusLine.command).toContain(STATUSLINE_MARKER);
  });

  it('the installed command parses and runs through the wrapper end to end', () => {
    const cmd = line(encodeWrap('echo wrapped')).posix;
    expect(cmd).toMatch(/^"\/usr\/bin\/node" "\/opt\/bw\/main\.js" hook statusline --wrap [A-Za-z0-9_-]+ # bellwether-statusline$/);
  });
});
