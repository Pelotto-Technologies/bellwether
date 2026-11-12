import { applyDelta, emptyWorld, MockSource, type Delta, type World } from '@bellwether/adapter/core';

/** Longest line a bubble shows, so neighbouring bubbles stay readable. */
const MAX_LINE = 48;

export interface Bubble {
  text: string;
  until: number;
  /** Who the line is addressed to, when it is a message to another agent. */
  to?: { partyId: string; paneId: string } | undefined;
  /** Inferred by the renderer: no Herdr token backs it, so member updates never clear it. */
  local: boolean;
}

/**
 * Holds the renderer's copy of the world and the speech bubbles currently showing.
 * The renderer only ever sees Deltas; it never talks to Herdr.
 */
export class FeedState {
  world: World = emptyWorld();
  private bubbles = new Map<string, Bubble>();
  /** Hide every bubble (the "chat bubbles" setting). Characters still walk over to talk. */
  bubblesOn = true;
  /** Show vitals bars, model and quest (the "vitals" setting). */
  vitalsOn = true;
  /** Set by the page: asks the adapter to focus a pane in Herdr (double-click a member). */
  onFocus: ((paneId: string) => void) | undefined;
  /** Set by the page: asks the adapter to close a pane in Herdr (the panel's close button). */
  onClose: ((paneId: string) => void) | undefined;

  constructor(private sayTtlMs: number) {}

  apply(delta: Delta, now: number, local = false): void {
    this.world = applyDelta(this.world, delta);
    if (delta.kind === 'say') this.bubbles.set(`${delta.partyId}/${delta.paneId}`, { text: delta.text, until: now + this.sayTtlMs, to: delta.to, local });
    if (delta.kind === 'member' && delta.member.say === undefined) {
      // The say token expired or was cleared in Herdr.
      const key = `${delta.partyId}/${delta.member.paneId}`;
      if (this.bubbles.get(key)?.local === false) this.bubbles.delete(key);
    }
    if (delta.kind === 'snapshot') this.bubbles.clear();
  }

  private live(partyId: string, paneId: string, now: number): Bubble | undefined {
    const b = this.bubbles.get(`${partyId}/${paneId}`);
    if (!b || now > b.until) return undefined;
    return b;
  }

  /** Speech text if the bubble is still within its TTL and bubbles are on. */
  say(partyId: string, paneId: string, now: number): string | undefined {
    if (!this.bubblesOn) return undefined;
    const b = this.live(partyId, paneId, now);
    if (!b) return undefined;
    // A message names its listener, so a reader can tell who is being spoken to.
    const role = b.to && this.world.parties[b.to.partyId]?.members[b.to.paneId]?.role;
    const line = role ? `@${role} ${b.text}` : b.text;
    return line.length > MAX_LINE ? line.slice(0, MAX_LINE - 1).trimEnd() + '…' : line;
  }

  /** Whether a live message from someone else is addressed to this member. */
  addressedTo(partyId: string, paneId: string, now: number): boolean {
    for (const b of this.bubbles.values()) if (now <= b.until && b.to?.partyId === partyId && b.to.paneId === paneId) return true;
    return false;
  }

  /** Who a live line is addressed to, whether or not bubbles are shown. */
  sayTo(partyId: string, paneId: string, now: number): { partyId: string; paneId: string } | undefined {
    return this.live(partyId, paneId, now)?.to;
  }

  /** Whether the member is mid-conversation (talking, bubble shown or not). */
  talking(partyId: string, paneId: string, now: number): boolean {
    return this.live(partyId, paneId, now) !== undefined;
  }
}

export type FeedMode = { kind: 'ws'; url: string } | { kind: 'mock'; reason: string } | { kind: 'replay'; url: string };

export interface FeedHandle {
  mode: FeedMode;
  stop(): void;
  /** Sends a client message to the adapter, when connected. */
  send?(msg: unknown): void;
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
    handle.send = (msg) => {
      if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
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

/** Parses a recorded `.jsonl` delta stream, skipping blank and malformed lines. */
export function parseDeltas(text: string): Delta[] {
  const out: Delta[] = [];
  for (const line of text.split('\n')) {
    const l = line.trim();
    if (!l) continue;
    try {
      out.push(JSON.parse(l) as Delta);
    } catch {
      // ignore a torn final line
    }
  }
  return out;
}

/**
 * Plays recorded deltas with their original timing scaled by `speed`, looping
 * forever. Used by the static blog build: no adapter, no Herdr.
 */
export function playDeltas(
  deltas: Delta[],
  onDelta: (d: Delta) => void,
  opts: { speed?: number; loop?: boolean } = {},
): () => void {
  const speed = opts.speed && opts.speed > 0 ? opts.speed : 1;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let stopped = false;
  const step = (i: number) => {
    if (stopped) return;
    const d = deltas[i];
    if (!d) {
      if (opts.loop !== false && deltas.length > 0) step(0);
      return;
    }
    onDelta(d);
    const next = deltas[i + 1];
    const gap = next ? Math.max(0, next.t - d.t) / speed : 1000 / speed;
    timer = setTimeout(() => step(i + 1), gap);
  };
  step(0);
  return () => {
    stopped = true;
    if (timer) clearTimeout(timer);
  };
}

/** Fetches a recording and replays it. The first delta is normally a snapshot, so loops reset cleanly. */
export function replayFeed(
  url: string,
  speed: number,
  onDelta: (d: Delta) => void,
  onMode: (m: FeedMode) => void,
): FeedHandle {
  const handle: FeedHandle = { mode: { kind: 'replay', url }, stop: () => {} };
  let cancelled = false;
  handle.stop = () => {
    cancelled = true;
  };
  void fetch(url)
    .then((r) => {
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return r.text();
    })
    .then((text) => {
      if (cancelled) return;
      onMode(handle.mode);
      handle.stop = playDeltas(parseDeltas(text), onDelta, { speed });
    })
    .catch(() => {
      if (!cancelled) onMode({ kind: 'mock', reason: `could not load ${url}` });
    });
  return handle;
}
