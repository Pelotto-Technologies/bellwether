import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';
import { NOOP_ACTION } from '../src/actions.js';
import { parseSourceConfig } from '../src/config.js';
import { HerdrSessionSource } from '../src/herdr/source.js';
import { MockSource } from '../src/mock.js';
import { ReplaySource } from '../src/recording.js';
import { DELTA_PATH, DeltaServer, isLocalOrigin } from '../src/server.js';
import { MockHerdr, until } from './mock-herdr.js';

let herdr: MockHerdr;
let source: HerdrSessionSource;
let server: DeltaServer | undefined;

beforeEach(async () => {
  herdr = new MockHerdr();
  await herdr.listen();
  source = new HerdrSessionSource({ target: { session: 'default', connectPath: herdr.socketPath }, refreshDebounceMs: 5 });
  await source.start();
  await until(() => herdr.statusSubPanes().length === 1);
});
afterEach(async () => {
  await server?.close();
  server = undefined;
  await source.stop();
  await herdr.close();
});

const calls = () => herdr.requests.filter((r) => /^(pane|agent)\./.test(r.method));

async function connect(actions: boolean, origin?: string): Promise<WebSocket> {
  server = new DeltaServer({ port: 0, actions });
  server.attach(source);
  const port = await server.listen();
  const ws = new WebSocket(`ws://127.0.0.1:${port}${DELTA_PATH}`, origin ? { origin } : {});
  await new Promise((r) => ws.once('open', r));
  return ws;
}

describe('Action on the live source', () => {
  it('maps to pane.focus, agent.prompt, agent.send_keys and pane.close', async () => {
    await source.actions.focus('w1:p3');
    await source.actions.prompt('w1:p3', 'hello');
    await source.actions.sendKeys('w1:p3', ['Enter']);
    await source.actions.close('w1:p3');
    expect(calls()).toEqual([
      { method: 'pane.focus', params: { pane_id: 'w1:p3' } },
      { method: 'agent.prompt', params: { target: 'w1:p3', text: 'hello' } },
      { method: 'agent.send_keys', params: { target: 'w1:p3', keys: ['Enter'] } },
      { method: 'pane.close', params: { pane_id: 'w1:p3' } },
    ]);
  });
});

describe('mock and replay actions', () => {
  it('no-op', async () => {
    for (const s of [new MockSource(), new ReplaySource([])]) {
      expect(s.actions).toBe(NOOP_ACTION);
      await expect(s.actions.focus('x')).resolves.toBeUndefined();
    }
  });
});

describe('DeltaServer client messages', () => {
  it('forwards focus without the actions flag, ignores prompt and sendKeys', async () => {
    const ws = await connect(false);
    ws.send(JSON.stringify({ type: 'prompt', paneId: 'w1:p3', text: 'nope' }));
    ws.send(JSON.stringify({ type: 'sendKeys', paneId: 'w1:p3', keys: ['Enter'] }));
    ws.send('not json');
    ws.send(JSON.stringify({ type: 'focus', paneId: 'w1:p3' }));
    await until(() => calls().length >= 1);
    await new Promise((r) => setTimeout(r, 50));
    expect(calls()).toEqual([{ method: 'pane.focus', params: { pane_id: 'w1:p3' } }]);
    ws.close();
  });

  it('forwards prompt and sendKeys with the actions flag', async () => {
    const ws = await connect(true);
    ws.send(JSON.stringify({ type: 'prompt', paneId: 'w1:p3', text: 'go' }));
    ws.send(JSON.stringify({ type: 'sendKeys', paneId: 'w1:p3', keys: ['Escape'] }));
    await until(() => calls().length >= 2);
    expect(calls().map((c) => c.method)).toEqual(['agent.prompt', 'agent.send_keys']);
    ws.close();
  });

  it('forwards close from the overlay itself, without the actions flag', async () => {
    const ws = await connect(false, 'http://127.0.0.1:7341');
    ws.send(JSON.stringify({ type: 'close', paneId: 'w1:p3' }));
    await until(() => calls().length >= 1);
    expect(calls()).toEqual([{ method: 'pane.close', params: { pane_id: 'w1:p3' } }]);
    ws.close();
  });

  it('refuses connections from another web page', async () => {
    server = new DeltaServer({ port: 0, actions: true });
    server.attach(source);
    const port = await server.listen();
    const ws = new WebSocket(`ws://127.0.0.1:${port}${DELTA_PATH}`, { origin: 'https://evil.example' });
    const status = await new Promise<number | undefined>((r) => {
      ws.once('unexpected-response', (_req, res) => r(res.statusCode));
      ws.once('open', () => r(undefined));
      ws.once('error', () => r(-1));
    });
    expect(status).toBe(401);
    ws.terminate();
    expect(calls()).toEqual([]);
  });

  it('survives an unknown pane', async () => {
    const ws = await connect(true);
    const { HerdrSource } = await import('../src/herdr/source.js');
    await expect(new HerdrSource().actions.focus('w9:p9')).rejects.toThrow(/no pane/);
    ws.send(JSON.stringify({ type: 'focus', paneId: 5 }));
    ws.close();
  });
});

describe('isLocalOrigin', () => {
  it('accepts no origin and loopback hosts, rejects the rest', () => {
    for (const o of [undefined, 'null', 'file://', 'http://127.0.0.1:7341', 'http://localhost:5173', 'http://[::1]:7341']) expect(isLocalOrigin(o)).toBe(true);
    for (const o of ['https://evil.example', 'http://127.0.0.1.evil.example', 'garbage']) expect(isLocalOrigin(o)).toBe(false);
  });
});

describe('config', () => {
  it('parses actions', () => {
    expect(parseSourceConfig('actions = true').actions).toBe(true);
    expect(parseSourceConfig('').actions).toBeUndefined();
    expect(() => parseSourceConfig('actions = 1')).toThrow();
  });
});
