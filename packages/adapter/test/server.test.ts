import { afterEach, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';
import { MockGenerator } from '../src/mock.js';
import { DELTA_PATH, DeltaServer } from '../src/server.js';
import type { Delta } from '../src/types.js';

let server: DeltaServer | undefined;
afterEach(async () => {
  await server?.close();
  server = undefined;
});

function collect(ws: WebSocket, n: number): Promise<Delta[]> {
  return new Promise((resolve, reject) => {
    const got: Delta[] = [];
    ws.on('error', reject);
    ws.on('message', (data) => {
      got.push(JSON.parse(String(data)) as Delta);
      if (got.length === n) resolve(got);
    });
  });
}

describe('DeltaServer', () => {
  it('sends a late client the current world, then live deltas', async () => {
    server = new DeltaServer({ port: 0 });
    const port = await server.listen();
    const gen = new MockGenerator({ seed: 2 });
    server.publish(gen.initial(1));

    const ws = new WebSocket(`ws://127.0.0.1:${port}${DELTA_PATH}`);
    const messages = collect(ws, 2);
    await new Promise((r) => ws.once('open', r));
    // Give the server a tick to send the snapshot before the live delta.
    await new Promise((r) => setTimeout(r, 20));
    const live = gen.step(2);
    server.publish(live);

    const [snap, next] = await messages;
    expect(snap?.kind).toBe('snapshot');
    if (snap?.kind === 'snapshot') {
      expect(Object.keys(snap.world.parties)).toEqual(Object.keys(gen.current.parties));
    }
    expect(next).toEqual(live);
    ws.close();
  });
});
