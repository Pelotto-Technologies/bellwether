import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { install, uninstall, type AgentContext } from '../src/index.js';
import { eventHookCommand, sayHookCommand } from '../src/install.js';
import { buildEmitEvent, normalizeHookPayload, parseFlags } from '../src/hook/event.js';

const ctx = { now: 99, env: {} };

describe('Copilot CLI payloads', () => {
  it('maps camelCase hook names and fields', () => {
    const p = { timestamp: 1, cwd: '/w/app', toolName: 'edit', toolArgs: '{"path":"/w/app/a.ts"}' };
    const e = normalizeHookPayload(p, { ...ctx, agent: 'copilot', eventName: 'preToolUse' })!;
    expect(e).toMatchObject({ agent: 'copilot', ev: 'tool', tool: 'edit', cwd: '/w/app', detail: 'edit a.ts' });
    expect(e.session).toMatch(/^copilot-[0-9a-f]{8}$/);
    expect(normalizeHookPayload({ cwd: '/w/app' }, { ...ctx, agent: 'copilot', eventName: 'sessionEnd' })).toMatchObject({ ev: 'end', session: e.session });
  });

  it('uses an explicit session id, or BELLWETHER_SESSION', () => {
    expect(normalizeHookPayload({ sessionId: 'abc' }, { ...ctx, agent: 'copilot', eventName: 'sessionStart' })!.session).toBe('abc');
    expect(normalizeHookPayload({}, { now: 1, env: { BELLWETHER_SESSION: 'mine' }, agent: 'copilot', eventName: 'sessionStart' })!.session).toBe('mine');
  });

  it('still requires a session id for Claude Code', () => {
    expect(normalizeHookPayload({ hook_event_name: 'Stop' }, ctx)).toBeUndefined();
  });

  it('ignores events it does not know', () => {
    expect(normalizeHookPayload({ cwd: '/x' }, { ...ctx, agent: 'copilot', eventName: 'errorOccurred' })).toBeUndefined();
  });
});

describe('roles without Herdr', () => {
  it('takes the role from claude --agent at session start', () => {
    const e = normalizeHookPayload({ session_id: 's', hook_event_name: 'SessionStart', agent_type: 'reviewer' }, ctx)!;
    expect(e.role).toBe('reviewer');
    expect(e.sub).toBeUndefined();
  });

  it('does not turn a subagent type into the session role', () => {
    const e = normalizeHookPayload({ session_id: 's', hook_event_name: 'SubagentStart', agent_id: 'a', agent_type: 'Explore' }, ctx)!;
    expect(e.role).toBeUndefined();
    expect(e.subType).toBe('Explore');
  });

  it('lets BELLWETHER_ROLE win', () => {
    const e = normalizeHookPayload({ session_id: 's', hook_event_name: 'SessionStart', agent_type: 'reviewer' }, { now: 1, env: { BELLWETHER_ROLE: 'ops' } })!;
    expect(e.role).toBe('ops');
  });
});

describe('generic source', () => {
  it('passes a normalized line through, clamped', () => {
    const e = normalizeHookPayload({ v: 1, t: 5, agent: 'mytool', ev: 'tool', session: 'x', detail: 'a\n' + 'b'.repeat(200), junk: 1 }, ctx)!;
    expect(e).toMatchObject({ v: 1, t: 5, agent: 'mytool', ev: 'tool', session: 'x' });
    expect(e.detail).toHaveLength(72);
    expect(e).not.toHaveProperty('junk');
    expect(normalizeHookPayload({ v: 1, ev: 'nope', session: 'x' }, ctx)).toBeUndefined();
    expect(normalizeHookPayload({ v: 1, ev: 'stop' }, ctx)).toBeUndefined();
  });

  it('builds an event from emit flags', () => {
    const flags = parseFlags(['--ev', 'sub_start', '--session', 's', '--sub', 'w1', '--sub-type', 'reviewer', '--detail', 'Check the diff', '--agent', 'factory']);
    expect(buildEmitEvent(flags, {}, '/w/p', 7)).toEqual({ v: 1, t: 7, agent: 'factory', ev: 'sub_start', session: 's', cwd: '/w/p', sub: 'w1', subType: 'reviewer', detail: 'Check the diff' });
  });

  it('defaults the session per agent and folder, and rejects bad input', () => {
    const a = buildEmitEvent(parseFlags(['--ev', 'start']), {}, '/w/p', 1);
    expect(a.agent).toBe('generic');
    expect(a.session).toBe(buildEmitEvent(parseFlags(['--ev', 'stop']), {}, '/w/p', 2).session);
    expect(() => buildEmitEvent(parseFlags([]), {})).toThrow(/--ev/);
    expect(() => buildEmitEvent(parseFlags(['--ev', 'sub_stop']), {})).toThrow(/--sub/);
  });
});

describe('install --events', () => {
  let root: string;
  let claudeDir: string;
  let copilotDir: string;
  const c = (): AgentContext => ({ env: { CLAUDE_CONFIG_DIR: claudeDir, COPILOT_HOME: copilotDir }, home: root, platform: process.platform, onPath: () => false });
  const read = (d: string) => JSON.parse(readFileSync(join(d, 'settings.json'), 'utf8'));
  const userClaude = { hooks: { Stop: [{ hooks: [{ type: 'command', command: 'echo mine' }] }] } };
  const userCopilot = { hooks: { sessionEnd: [{ type: 'command', bash: 'echo mine' }] } };

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'bellwether-ev-'));
    claudeDir = join(root, 'claude');
    copilotDir = join(root, 'copilot');
    mkdirSync(claudeDir);
    mkdirSync(copilotDir);
    writeFileSync(join(claudeDir, 'settings.json'), JSON.stringify(userClaude));
    writeFileSync(join(copilotDir, 'settings.json'), JSON.stringify(userCopilot));
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it('adds event hooks only when asked, idempotently', () => {
    install(c(), undefined, sayHookCommand('/n', '/m.js'));
    expect(Object.keys(read(claudeDir).hooks)).not.toContain('SubagentStart');
    const cmd = eventHookCommand('/n', '/m.js');
    install(c(), undefined, sayHookCommand('/n', '/m.js'), cmd);
    install(c(), undefined, sayHookCommand('/n', '/m.js'), cmd);
    const cl = read(claudeDir).hooks;
    for (const n of ['SessionStart', 'PreToolUse', 'PostToolUse', 'SubagentStart', 'SubagentStop', 'SessionEnd']) expect(JSON.stringify(cl[n])).toContain('bellwether-event');
    expect(cl.SubagentStart).toHaveLength(1);
    expect(cl.PostToolUse[0].matcher).toBe('*');
    expect(cl.Stop).toHaveLength(2);
    const co = read(copilotDir).hooks;
    expect(co.preToolUse).toHaveLength(1);
    expect(co.preToolUse[0].bash).toContain('hook event --agent copilot --event preToolUse');
    expect(co.sessionEnd).toHaveLength(2);
  });

  it('a plain re-install keeps earlier event hooks; uninstall removes them and leaves user hooks', () => {
    const say = sayHookCommand('/n', '/m.js');
    install(c(), undefined, say, eventHookCommand('/n', '/m.js'));
    install(c(), undefined, say);
    expect(JSON.stringify(read(claudeDir))).toContain('bellwether-event');
    uninstall(c());
    expect(read(claudeDir)).toEqual(userClaude);
    expect(read(copilotDir)).toEqual(userCopilot);
  });
});

describe('emit --label', () => {
  it('names the session on any event, cleaned and capped, and passes through already-normalized lines', () => {
    expect(buildEmitEvent({ ev: 'start', session: 's', label: `  Ada\n${'x'.repeat(60)}` }, {}, '/w', 1).label).toBe(`Ada ${'x'.repeat(36)}`);
    expect(buildEmitEvent({ ev: 'sub_start', session: 's', sub: 'a', label: 'Scout' }, {}, '/w', 1).label).toBe('Scout');
    expect(buildEmitEvent({ ev: 'tool', session: 's', label: '  ' }, {}, '/w', 1).label).toBeUndefined();
    expect(normalizeHookPayload({ v: 1, ev: 'start', session: 's', label: 'Ada' }, { now: 1 })?.label).toBe('Ada');
  });
});
