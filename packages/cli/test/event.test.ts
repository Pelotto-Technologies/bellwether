import { appendFileSync, existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { appendEvent, eventsFile, normalizeHookPayload, runEventHook, shorten, SUPPORTED_HOOK_EVENTS, toolDetail } from '../src/hook/event.js';

const base = { session_id: 's1', cwd: '/w/proj', transcript_path: '/t.jsonl' };
const ctx = { now: 1234, env: {} };

describe('normalizeHookPayload', () => {
  it('maps every supported event', () => {
    const kinds = SUPPORTED_HOOK_EVENTS.map((name) => normalizeHookPayload({ ...base, hook_event_name: name }, ctx)?.ev);
    expect(kinds).toEqual(['start', 'prompt', 'tool', 'tool_done', 'wait', 'stop', 'sub_start', 'sub_stop', 'end']);
  });

  it('writes the contract shape', () => {
    expect(normalizeHookPayload({ ...base, hook_event_name: 'Stop' }, ctx)).toEqual({ v: 1, t: 1234, agent: 'claude', ev: 'stop', session: 's1', cwd: '/w/proj' });
  });

  it('never stores prompt text', () => {
    const e = normalizeHookPayload({ ...base, hook_event_name: 'UserPromptSubmit', prompt: 'my secret plan' }, ctx)!;
    expect(e.detail).toBeUndefined();
    expect(JSON.stringify(e)).not.toContain('secret');
  });

  it('describes tool calls briefly', () => {
    const d = (tool_name: string, tool_input: unknown) => normalizeHookPayload({ ...base, hook_event_name: 'PreToolUse', tool_name, tool_input }, ctx)!.detail;
    expect(d('Edit', { file_path: '/a/b/main.ts', old_string: 'secret', new_string: 'x' })).toBe('Edit main.ts');
    expect(d('Read', { file_path: 'C:\\a\\b\\notes.md' })).toBe('Read notes.md');
    expect(d('Bash', { command: 'npm test', description: 'Run the tests' })).toBe('Bash: Run the tests');
    expect(d('Bash', { command: 'curl -H "Authorization: secret" x' })).toBe('Bash: curl');
    expect(d('Grep', { pattern: 'TODO' })).toBe('Grep TODO');
    expect(d('Task', { description: 'Review the auth module', prompt: 'long prompt' })).toBe('Review the auth module');
    expect(d('TodoWrite', { todos: [] })).toBe('TodoWrite');
    expect(d('Bash', undefined)).toBe('Bash');
  });

  it('caps detail at 72 characters on one line', () => {
    const e = normalizeHookPayload({ ...base, hook_event_name: 'Notification', message: 'x'.repeat(200) + '\nsecond' }, ctx)!;
    expect(e.detail).toHaveLength(72);
    expect(e.detail).not.toContain('\n');
    expect(shorten('a b', 10)).toBe('a b');
  });

  it('carries the notification message, subagent ids and role', () => {
    expect(normalizeHookPayload({ ...base, hook_event_name: 'Notification', message: 'Needs permission' }, ctx)!.detail).toBe('Needs permission');
    expect(normalizeHookPayload({ ...base, hook_event_name: 'SubagentStart', agent_id: 'a1', agent_type: 'Explore' }, ctx)).toMatchObject({ ev: 'sub_start', sub: 'a1', subType: 'Explore' });
    expect(normalizeHookPayload({ ...base, hook_event_name: 'PreToolUse', tool_name: 'Grep', agent_id: 'a1' }, ctx)).toMatchObject({ sub: 'a1', tool: 'Grep' });
    expect(normalizeHookPayload({ ...base, hook_event_name: 'Stop' }, { ...ctx, env: { HERDR_ROLE: 'writer' } })!.role).toBe('writer');
    expect(normalizeHookPayload({ ...base, hook_event_name: 'Stop' }, { ...ctx, env: { HERDR_ROLE: 'writer', BELLWETHER_ROLE: 'ops' } })!.role).toBe('ops');
  });

  it('honours the agent id and treats fields as optional', () => {
    expect(normalizeHookPayload({ session_id: 's', hook_event_name: 'SessionStart' }, { ...ctx, agent: 'copilot' })).toEqual({ v: 1, t: 1234, agent: 'copilot', ev: 'start', session: 's' });
  });

  it('ignores unknown events and unusable payloads', () => {
    expect(normalizeHookPayload({ ...base, hook_event_name: 'PreCompact' }, ctx)).toBeUndefined();
    expect(normalizeHookPayload({ ...base, hook_event_name: 'toString' }, ctx)).toBeUndefined();
    expect(normalizeHookPayload({ hook_event_name: 'Stop' }, ctx)).toBeUndefined();
    expect(normalizeHookPayload('x', ctx)).toBeUndefined();
    expect(normalizeHookPayload(null, ctx)).toBeUndefined();
  });

  it('describes a tool without input', () => {
    expect(toolDetail(undefined, undefined)).toBeUndefined();
  });
});

describe('writer', () => {
  let dir: string;
  beforeEach(() => void (dir = mkdtempSync(join(tmpdir(), 'bw-event-'))));
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  const payload = (extra: object = {}) => JSON.stringify({ ...base, hook_event_name: 'PreToolUse', tool_name: 'Read', tool_input: { file_path: '/x/a.ts' }, ...extra });

  it('finds the file from BELLWETHER_EVENTS or home', () => {
    expect(eventsFile({ BELLWETHER_EVENTS: '/e.jsonl' }, '/h')).toBe('/e.jsonl');
    expect(eventsFile({}, '/h')).toBe(join('/h', '.bellwether', 'events.jsonl'));
  });

  it('appends one line per event and creates the directory', () => {
    const home = join(dir, 'home');
    runEventHook({ stdin: payload(), env: {}, home, now: 1 });
    runEventHook({ stdin: payload({ hook_event_name: 'Stop' }), env: {}, home, now: 2 });
    const lines = readFileSync(join(home, '.bellwether', 'events.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatchObject({ v: 1, t: 1, ev: 'tool', detail: 'Read a.ts' });
    expect(lines[1]).toMatchObject({ ev: 'stop' });
  });

  it('rotates a file over the limit to .1, replacing the old backup', () => {
    const file = join(dir, 'events.jsonl');
    writeFileSync(file + '.1', 'older backup\n');
    writeFileSync(file, 'x'.repeat(100));
    runEventHook({ stdin: payload(), env: { BELLWETHER_EVENTS: file }, rotateBytes: 50 });
    expect(readFileSync(file + '.1', 'utf8')).toBe('x'.repeat(100));
    expect(readFileSync(file, 'utf8').trim().split('\n')).toHaveLength(1);
    // Under the limit: no rotation.
    const before = statSync(file).size;
    runEventHook({ stdin: payload(), env: { BELLWETHER_EVENTS: file }, rotateBytes: 5_000_000 });
    expect(statSync(file).size).toBeGreaterThan(before);
    expect(readFileSync(file + '.1', 'utf8')).toBe('x'.repeat(100));
  });

  it('rotates at 5 MB by default', () => {
    const file = join(dir, 'events.jsonl');
    writeFileSync(file, Buffer.alloc(5 * 1024 * 1024 + 1, 0x61));
    appendEvent(file, { v: 1, t: 1, agent: 'claude', ev: 'stop', session: 's' });
    expect(existsSync(file + '.1')).toBe(true);
    expect(statSync(file).size).toBeLessThan(200);
  });

  it('writes nothing for unknown events and swallows malformed stdin and write failures', () => {
    const file = join(dir, 'events.jsonl');
    const env = { BELLWETHER_EVENTS: file };
    expect(runEventHook({ stdin: payload({ hook_event_name: 'PreCompact' }), env })).toBeUndefined();
    expect(runEventHook({ stdin: 'not json', env })).toBeUndefined();
    expect(runEventHook({ stdin: '', env })).toBeUndefined();
    expect(runEventHook({ stdin: '[1,2]', env })).toBeUndefined();
    expect(existsSync(file)).toBe(false);
    // The target's parent is a regular file, so mkdir/append fail; the hook must not throw.
    appendFileSync(join(dir, 'blocker'), 'x');
    expect(() => runEventHook({ stdin: payload(), env: { BELLWETHER_EVENTS: join(dir, 'blocker', 'e.jsonl') } })).not.toThrow();
  });
});
