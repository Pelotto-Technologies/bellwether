import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { agentNameFor, commandLine, defaultLabel, launchOrchestrator } from '../src/herdr/launch.js';
import { MockHerdr } from './mock-herdr.js';

let mock: MockHerdr;
let polls: number;
let agentAfter: number;

beforeEach(async () => {
  mock = new MockHerdr();
  polls = 0;
  agentAfter = 2;
  mock.handlers['workspace.create'] = () => ({ type: 'workspace_created', workspace: { workspace_id: 'w9' }, tab: {}, root_pane: { pane_id: 'w9:p1' } });
  mock.handlers['pane.get'] = () => ({ type: 'pane_info', pane: { pane_id: 'w9:p1', agent: ++polls >= agentAfter ? 'copilot' : null } });
  mock.handlers['agent.get'] = () => ({ type: 'agent_info', agent: { pane_id: 'w9:p1', name: null } });
  await mock.listen();
});
afterEach(() => mock.close());

const base = () => ({ target: { session: 'x', connectPath: mock.socketPath }, sleep: async () => {}, pollMs: 1 });
const methods = () => mock.requests.map((r) => r.method);

describe('launchOrchestrator', () => {
  it('creates, tags, types, waits, re-tags and renames', async () => {
    const r = await launchOrchestrator({ ...base(), cwd: '/src/myrepo', command: ['copilot', '--agent', 'my agent'] });
    expect(methods()).toEqual([
      'workspace.create',
      'pane.report_metadata',
      'pane.send_text',
      'pane.send_keys',
      'pane.get',
      'pane.get',
      'pane.report_metadata',
      'agent.get',
      'agent.rename',
    ]);
    const [create, tag, text, keys, , , retag, , rename] = mock.requests.map((q) => q.params);
    expect(create).toEqual({ cwd: '/src/myrepo', label: 'myrepo Orchestration', focus: true, env: { HERDR_ROLE: 'orchestrator' } });
    expect(tag).toEqual({ pane_id: 'w9:p1', source: 'bellwether', tokens: { role: 'orchestrator' } });
    expect(text).toEqual({ pane_id: 'w9:p1', text: 'copilot --agent "my agent"' });
    expect(keys).toEqual({ pane_id: 'w9:p1', keys: ['Enter'] });
    expect(retag).toEqual(tag);
    expect(rename).toEqual({ target: 'w9:p1', name: 'orchestrator-myrepo' });
    expect(r).toMatchObject({ paneId: 'w9:p1', role: 'orchestrator', agent: 'copilot', agentName: 'orchestrator-myrepo', timedOut: false });
  });

  it('honors label and role, and skips rename when the agent already has a name', async () => {
    mock.handlers['agent.get'] = () => ({ type: 'agent_info', agent: { name: 'manwe' } });
    const r = await launchOrchestrator({ ...base(), cwd: '/a/b', label: 'Custom', role: 'coordinator', command: ['claude'] });
    expect(mock.requests[0]!.params).toMatchObject({ label: 'Custom', env: { HERDR_ROLE: 'coordinator' } });
    expect(methods()).not.toContain('agent.rename');
    expect(r.agentName).toBe('manwe');
  });

  it('logs and ignores a rename error', async () => {
    mock.handlers['agent.rename'] = () => {
      throw { code: 'name_taken', message: 'taken' };
    };
    const logs: string[] = [];
    const r = await launchOrchestrator({ ...base(), cwd: '/a/b', command: ['claude'], log: (m) => logs.push(m) });
    expect(r.timedOut).toBe(false);
    expect(logs.some((l) => /rename.*skipped/.test(l))).toBe(true);
  });

  it('warns but succeeds when no agent appears before the timeout', async () => {
    agentAfter = Infinity;
    let t = 0;
    const logs: string[] = [];
    const r = await launchOrchestrator({ ...base(), cwd: '/a/b', command: ['claude'], timeoutMs: 5000, now: () => (t += 2000), log: (m) => logs.push(m) });
    expect(r.timedOut).toBe(true);
    expect(r.paneId).toBe('w9:p1');
    expect(logs.some((l) => /warning/.test(l))).toBe(true);
    expect(methods()).not.toContain('agent.rename');
    expect(methods().filter((m) => m === 'pane.report_metadata')).toHaveLength(1);
  });

  it('only creates and tags when no command is given', async () => {
    const r = await launchOrchestrator({ ...base(), cwd: '/a/b', command: [] });
    expect(methods()).toEqual(['workspace.create', 'pane.report_metadata']);
    expect(r.commandLine).toBeUndefined();
  });

  it('rejects an unknown role before connecting', async () => {
    await expect(launchOrchestrator({ ...base(), role: 'gandalf' })).rejects.toThrow(/unknown role/);
    expect(mock.requests).toHaveLength(0);
  });
});

describe('helpers', () => {
  it('derives label and agent name from cwd, including Windows paths', () => {
    expect(defaultLabel('C:\\src\\myrepo')).toBe('myrepo Orchestration');
    expect(defaultLabel('/x/y/')).toBe('y Orchestration');
    expect(agentNameFor('orchestrator', 'C:\\src\\My Repo!')).toBe('orchestrator-my-repo');
  });
  it('keeps the role word whole and the name within 32 chars', () => {
    const n = agentNameFor('orchestrator', '/x/' + 'a'.repeat(60));
    expect(n.length).toBeLessThanOrEqual(32);
    expect(n).toMatch(/^[a-z][a-z0-9_-]{0,31}$/);
    expect(n.startsWith('orchestrator-')).toBe(true);
    expect(agentNameFor('orchestrator', '/x/___')).toBe('orchestrator');
  });
  it('quotes args with spaces or quotes', () => {
    expect(commandLine(['a', 'b c', 'd"e', ''])).toBe('a "b c" "d\\"e" ""');
  });
});
