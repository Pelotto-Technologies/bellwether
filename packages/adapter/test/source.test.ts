import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { HerdrSessionSource, HerdrSource } from '../src/herdr/source.js';
import type { Delta } from '../src/types.js';
import { loadCapture, MockHerdr, until } from './mock-herdr.js';

let herdr: MockHerdr;
let source: HerdrSessionSource;
let deltas: Delta[];

function start(): Promise<void> {
  source = new HerdrSessionSource({ target: { session: 'default', connectPath: herdr.socketPath }, refreshDebounceMs: 5, minBackoffMs: 10, maxBackoffMs: 50 });
  deltas = [];
  source.on('delta', (d: Delta) => deltas.push(d));
  return source.start();
}

beforeEach(async () => {
  herdr = new MockHerdr();
  await herdr.listen();
});
afterEach(async () => {
  await source?.stop();
  await herdr.close();
});

describe('HerdrSessionSource against a mock pipe server', () => {
  it('subscribes to lifecycle first, then snapshots, then opens per-pane status subscriptions', async () => {
    await start();
    await until(() => herdr.statusSubPanes().length === 1);
    expect(herdr.requests.map((r) => r.method).slice(0, 3)).toEqual(['events.subscribe', 'session.snapshot', 'events.subscribe']);
    expect(herdr.requests[0]!.params.subscriptions.some((s: any) => s.type === 'pane.agent_status_changed')).toBe(false);
    expect(herdr.statusSubPanes()).toEqual([['w1:p1', 'w1:p3', 'w2:p1', 'w3:p1']]);
    expect(deltas[0]!.kind).toBe('snapshot');
  });

  it('replays the recorded capture into member and party deltas, then removes the closed pane', async () => {
    await start();
    await until(() => herdr.statusSubPanes().length === 1);
    deltas.length = 0;
    const [working, idle, closed] = loadCapture();
    herdr.push(working!);
    await until(() => deltas.length >= 2);
    expect(deltas[0]).toMatchObject({ kind: 'member', partyId: 'default/w1', member: { paneId: 'w1:p3', status: 'working', role: 'architect' } });
    expect(deltas[1]).toMatchObject({ kind: 'party', party: { id: 'default/w1', status: 'working' } });
    herdr.push(idle!);
    await until(() => deltas.length >= 4);
    expect(deltas[2]).toMatchObject({ kind: 'member', member: { status: 'idle' } });

    // Herdr closes the pane: the event only invalidates; the re-read decides.
    herdr.snapshot.panes = herdr.snapshot.panes.filter((p) => p.pane_id !== 'w1:p3');
    herdr.snapshot.agents = herdr.snapshot.agents.filter((p) => p.pane_id !== 'w1:p3');
    herdr.push(closed!);
    await until(() => deltas.some((d) => d.kind === 'removed'));
    expect(deltas.find((d) => d.kind === 'removed')).toMatchObject({ partyId: 'default/w1', paneId: 'w1:p3' });
    await until(() => herdr.statusSubPanes().some((p) => p.length === 3));
    expect(herdr.statusSubPanes()).toEqual([['w1:p1', 'w2:p1', 'w3:p1']]);
  });

  it('re-reads when an agent appears in a pane it was not tracking', async () => {
    await start();
    await until(() => herdr.statusSubPanes().length === 1);
    deltas.length = 0;
    const pane = herdr.snapshot.panes.find((p) => p.pane_id === 'w1:p1')!;
    pane.agent = 'copilot';
    pane.agent_status = 'working';
    pane.tokens = { role: 'implementer' };
    herdr.push({ event: 'pane.agent_status_changed', data: { pane_id: 'w1:p1', workspace_id: 'w1', agent: 'copilot', agent_status: 'working' } });
    await until(() => deltas.some((d) => d.kind === 'member'));
    expect(deltas.find((d) => d.kind === 'member')).toMatchObject({ member: { paneId: 'w1:p1', agent: 'copilot', role: 'implementer', status: 'working' } });
  });

  it('recovers from events_lost by resubscribing and re-reading', async () => {
    await start();
    await until(() => herdr.lifecycleSubs === 1 && herdr.statusSubPanes().length === 1);
    deltas.length = 0;
    herdr.snapshot.workspaces[1]!.label = 'renamed while we were behind';
    herdr.loseEvents();
    await until(() => deltas.some((d) => d.kind === 'party'));
    expect(deltas.find((d) => d.kind === 'party')).toMatchObject({ party: { id: 'default/w2', label: 'renamed while we were behind' } });
    await until(() => herdr.lifecycleSubs === 1);
  });

  it('retries when a pane vanishes between snapshot and status subscribe', async () => {
    const realPanes = herdr.snapshot.panes;
    herdr.snapshot = { ...herdr.snapshot, panes: [...realPanes, { ...realPanes[0]!, pane_id: 'w1:p9' }] };
    herdr.afterSnapshot = () => {
      herdr.snapshot = { ...herdr.snapshot, panes: realPanes };
      herdr.afterSnapshot = undefined;
    };
    await start();
    await until(() => herdr.statusSubPanes().length === 1);
    expect(herdr.statusSubPanes()).toEqual([['w1:p1', 'w1:p3', 'w2:p1', 'w3:p1']]);
    const subs = herdr.requests.filter((r) => r.method === 'events.subscribe');
    expect(subs[1]!.params.subscriptions.map((s: any) => s.pane_id)).toContain('w1:p9');
  });

  it('reconnects with backoff when the server is not up yet', async () => {
    await herdr.close();
    const late = new MockHerdr();
    // Reuse the same path by pointing the source at the new server's path after it starts.
    source = new HerdrSessionSource({ target: { session: 'default', connectPath: late.socketPath }, refreshDebounceMs: 5, minBackoffMs: 10, maxBackoffMs: 20 });
    deltas = [];
    source.on('delta', (d: Delta) => deltas.push(d));
    await source.start();
    await new Promise((r) => setTimeout(r, 30));
    await late.listen();
    await until(() => deltas.some((d) => d.kind === 'snapshot'));
    await source.stop();
    await late.close();
    herdr = new MockHerdr();
    await herdr.listen();
  });
});

describe('HerdrSource', () => {
  it('merges sessions into one world', async () => {
    const other = new MockHerdr();
    await other.listen();
    const multi = new HerdrSource({ machine: 'test', refreshDebounceMs: 5, connector: undefined });
    // Point at both servers via explicit targets.
    (multi as any).targets = async () => [
      { session: 'default', connectPath: herdr.socketPath },
      { session: 'overlay-dev', connectPath: other.socketPath },
    ];
    const got: Delta[] = [];
    multi.on('delta', (d: Delta) => got.push(d));
    await multi.start();
    await until(() => got.filter((d) => d.kind === 'snapshot').length === 2);
    const last = got.filter((d) => d.kind === 'snapshot').at(-1)!;
    expect(last.kind === 'snapshot' && Object.keys(last.world.parties).sort()).toEqual([
      'default/w1', 'default/w2', 'default/w3', 'overlay-dev/w1', 'overlay-dev/w2', 'overlay-dev/w3',
    ]);
    expect(last.kind === 'snapshot' && last.world.machine).toBe('test');
    await multi.stop();
    await other.close();
  });
});
