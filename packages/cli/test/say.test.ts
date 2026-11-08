import { describe, expect, it } from 'vitest';
import { commandFromHookInput, runSayHook, sayArgs } from '../src/hook/say.js';
import { bubbleText, parseSends } from '../src/hook/sends.js';

describe('parseSends', () => {
  it('reads the forms herdr --skill teaches', () => {
    expect(parseSends('herdr agent prompt reviewer "Review the current diff" --wait --timeout 120000')).toEqual([
      { target: 'reviewer', text: 'Review the current diff', command: 'agent prompt' },
    ]);
    expect(parseSends(`herdr pane run w1:p3 'just test --watch'`)).toEqual([{ target: 'w1:p3', text: 'just test --watch', command: 'pane run' }]);
    expect(parseSends('herdr pane send-text w2:p1 hello there')[0]).toMatchObject({ target: 'w2:p1', text: 'hello there' });
  });

  it('accepts global flags, quoted binaries and HERDR_BIN_PATH', () => {
    expect(parseSends('herdr --machine lab agent prompt impl "go"')[0]).toMatchObject({ target: 'impl', text: 'go' });
    expect(parseSends('"${HERDR_BIN_PATH:-herdr}" agent prompt impl "go"')[0]).toMatchObject({ target: 'impl' });
    expect(parseSends('& $env:HERDR_BIN_PATH agent prompt impl "from powershell"')[0]).toMatchObject({ target: 'impl', text: 'from powershell' });
    expect(parseSends('C:\\Users\\b\\.herdr\\herdr.exe agent prompt --wait impl "x"')[0]).toMatchObject({ target: 'impl', text: 'x' });
  });

  it('stops at shell plumbing and skips flags with values', () => {
    expect(parseSends('herdr agent prompt impl "fix it" --timeout 5000 && herdr agent wait impl')[0]).toMatchObject({ text: 'fix it' });
    expect(parseSends('herdr agent prompt impl "a" | jq .')[0]).toMatchObject({ text: 'a' });
  });

  it('joins a quoted message that wraps, and ignores non-sends', () => {
    expect(parseSends('herdr agent prompt impl "first line\nsecond line"')[0]).toMatchObject({ text: 'first line second line' });
    expect(parseSends('herdr agent wait impl --until idle')).toEqual([]);
    expect(parseSends('herdr agent prompt --current "x"')).toEqual([]);
    expect(parseSends('herdr agent prompt "$TARGET" "x"')).toEqual([]);
    expect(parseSends('echo hello')).toEqual([]);
  });

  it('caps bubble text', () => {
    expect(bubbleText('a'.repeat(100), 10)).toBe('aaaaaaaaa…');
  });
});

describe('commandFromHookInput', () => {
  it('reads Claude Code and Copilot CLI payloads', () => {
    expect(commandFromHookInput(JSON.stringify({ tool_name: 'Bash', tool_input: { command: 'herdr x' } }))).toBe('herdr x');
    expect(commandFromHookInput(JSON.stringify({ toolName: 'bash', toolArgs: JSON.stringify({ command: 'herdr y' }) }))).toBe('herdr y');
    expect(commandFromHookInput(JSON.stringify({ toolName: 'powershell', toolArgs: { command: 'herdr z' } }))).toBe('herdr z');
    expect(commandFromHookInput('not json')).toBeUndefined();
  });
});

describe('runSayHook', () => {
  const stdin = JSON.stringify({ tool_name: 'Bash', tool_input: { command: 'herdr agent prompt impl "Fix the login test" --wait' } });
  const env = { HERDR_ENV: '1', HERDR_PANE_ID: 'w1:p1', HERDR_BIN_PATH: '/bin/herdr' };

  it('tags the sender pane with the message and its target', () => {
    const calls: Array<[string, string[]]> = [];
    runSayHook({ stdin, env, run: (b, a) => void calls.push([b, a]) });
    expect(calls).toHaveLength(1);
    const [bin, args] = calls[0]!;
    expect(bin).toBe('/bin/herdr');
    expect(args.slice(0, 5)).toEqual(['pane', 'report-metadata', 'w1:p1', '--source', 'bellwether']);
    expect(args).toContain('say=Fix the login test');
    expect(args).toContain('say_to=impl');
    expect(args.some((a) => /^say_id=[0-9a-f]{10}$/.test(a))).toBe(true);
    expect(args.slice(-2)).toEqual(['--ttl-ms', '15000']);
  });

  it('does nothing outside Herdr, for other commands, and survives a failing herdr', () => {
    const run = () => {
      throw new Error('boom');
    };
    expect(runSayHook({ stdin, env: { HERDR_PANE_ID: 'w1:p1' }, run })).toBeUndefined();
    expect(runSayHook({ stdin: JSON.stringify({ tool_input: { command: 'ls' } }), env, run })).toBeUndefined();
    expect(runSayHook({ stdin, env, run })).toBeDefined();
  });

  it('gives the same id when two hook entries see the same command', () => {
    expect(sayArgs('herdr agent prompt a "b"', 'w1:p1')).toEqual(sayArgs('herdr agent prompt a "b"', 'w1:p1'));
  });
});

describe('parseSends performance', () => {
  it('stays linear on adversarial input', () => {
    const evil = 'herdr -' + '-- -'.repeat(5000);
    const t0 = Date.now();
    expect(parseSends(evil)).toEqual([]);
    expect(Date.now() - t0).toBeLessThan(500);
  });

  it('finds a send after another herdr command on the same line', () => {
    expect(parseSends('herdr agent wait impl && herdr agent prompt impl "next"')).toEqual([{ target: 'impl', text: 'next', command: 'agent prompt' }]);
  });
});
