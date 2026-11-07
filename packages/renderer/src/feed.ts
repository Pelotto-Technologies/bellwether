import { applyDelta, emptyWorld, MockSource, type Delta, type World } from '@bellwether/adapter/core';

/**
 * Holds the renderer's copy of the world and when each speech bubble expires.
 * The renderer only ever sees Deltas; it never talks to Herdr.
 */
export class FeedState {
  world: World = emptyWorld();
  private sayUntil = new Map<string, number>();

  constructor(private sayTtlMs: number) {}

  apply(delta: Delta, now: number): void {
    this.world = applyDelta(this.world, delta);
    if (delta.kind === 'say') this.sayUntil.set(`${delta.partyId}/${delta.paneId}`, now + this.sayTtlMs);
    if (delta.kind === 'member' && delta.member.say === undefined) {
      this.sayUntil.delete(`${delta.partyId}/${delta.member.paneId}`);
    }
    if (delta.kind === 'snapshot') this.sayUntil.clear();
  }

  /** Speech text if the bubble is still within its TTL. */
  say(partyId: string, paneId: string, now: number): string | undefined {
    const until = this.sayUntil.get(`${partyId}/${paneId}`);
    if (until === undefined || now > until) return undefined;
    return this.world.parties[partyId]?.members[paneId]?.say;
  }
}

export type FeedMode = { kind: 'ws'; url: string } | { kind: 'mock'; reason: string };

export interface FeedHandle {
  mode: FeedMode;
  stop(): void;
}

/**
 * Connects to the adapter's WebSocket. If it cannot connect before the first
 * message arrives, falls back to an in-browser mock so the page still shows life.
 */
export function connectFeed(
  url: string | null,
  onDelta: (d: Delta) => void,
  onMode: (m: FeedMode) => void,
): FeedHandle {
  const handle: FeedHandle = { mode: { kind: 'mock', reason: 'requested' }, stop: () => {} };

  const startMock = (reason: string) => {
    const mock = new MockSource({ seed: 1, intervalMs: 1500 });
    mock.on('delta', onDelta);
    void mock.start();
    handle.mode = { kind: 'mock', reason };
    handle.stop = () => void mock.stop();
    onMode(handle.mode);
  };

  if (!url) {
    startMock('requested');
    return handle;
  }

  let gotMessage = false;
  let closed = false;
  const open = () => {
    const ws = new WebSocket(url);
    handle.stop = () => {
      closed = true;
      ws.close();
    };
    ws.onmessage = (ev) => {
      if (!gotMessage) {
        gotMessage = true;
        handle.mode = { kind: 'ws', url };
        onMode(handle.mode);
      }
      onDelta(JSON.parse(String(ev.data)) as Delta);
    };
    ws.onclose = () => {
      if (closed) return;
      if (!gotMessage) startMock(`adapter not reachable at ${url}`);
      else setTimeout(open, 2000); // reconnect; the server resends a snapshot
    };
  };
  open();
  return handle;
}
