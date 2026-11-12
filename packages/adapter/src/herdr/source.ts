import { EventEmitter } from 'node:events';
import os from 'node:os';
import type { Action } from '../actions.js';
import type { WorldSource } from '../source.js';
import type { Delta, Party, World } from '../types.js';
import { type Connector, HerdrConnection, HerdrError } from './connection.js';
import { applyStatusChange, diffParties, foldersFromSnapshot, type MapContext, paneIds, partiesFromSnapshot } from './mapper.js';
import { discoverSessions, resolveTarget, type SessionTarget } from './paths.js';
import {
  AGENT_STATUS_CHANGED,
  type AgentStatusChanged,
  type EventLine,
  LIFECYCLE_SUBSCRIPTIONS,
  type SessionSnapshot,
  type WorktreeInfo,
} from './protocol.js';

export interface SessionSourceOptions {
  target: SessionTarget;
  connector?: Connector;
  now?: () => number;
  /** Coalesce bursts of lifecycle events into one re-read. */
  refreshDebounceMs?: number;
  /**
   * Safety-net re-read interval. Some changes (an `herdr agent rename`, an agent
   * exiting back to its shell) raise no lifecycle event, so without this a member
   * could keep a stale role or linger after its agent is gone. 0 disables it.
   */
  resyncMs?: number;
  /** Reconnect backoff bounds. */
  minBackoffMs?: number;
  maxBackoffMs?: number;
  log?: (msg: string) => void;
}

/**
 * Live source for one Herdr session.
 *
 * Follows the recovery rules in docs/research/socket-api.mdx: subscribe first,
 * then read `session.snapshot` on another connection; lifecycle events only
 * invalidate and trigger a serialized re-read; `events_lost` or a dropped
 * connection means reconnect, resubscribe and re-read. Agent status changes
 * arrive on a second, per-pane subscription that is reopened whenever the pane
 * set changes.
 */
export class HerdrSessionSource extends EventEmitter implements WorldSource {
  readonly session: string;
  private parties: Record<string, Party> = {};
  private branches = new Map<string, string>();
  private folders: Record<string, string> = {};
  private lifecycle?: HerdrConnection;
  private status?: HerdrConnection;
  private rpc?: HerdrConnection;
  private statusPanes = '';
  private running = false;
  private hasSnapshot = false;
  private refreshing = false;
  private dirty = false;
  private refreshTimer?: NodeJS.Timeout;
  private reconnectTimer?: NodeJS.Timeout;
  private resyncTimer?: NodeJS.Timeout;
  private backoff: number;
  private readonly now: () => number;
  private readonly log: (msg: string) => void;
  private readonly ctx: MapContext;

  constructor(private readonly opts: SessionSourceOptions) {
    super();
    this.session = opts.target.session;
    this.now = opts.now ?? Date.now;
    this.log = opts.log ?? (() => {});
    this.backoff = opts.minBackoffMs ?? 500;
    this.ctx = { session: this.session, branches: this.branches };
  }

  /** Current parties for this session (read-only view). */
  get current(): Readonly<Record<string, Party>> {
    return this.parties;
  }

  async start(): Promise<void> {
    if (this.running) return;
    this.running = true;
    const every = this.opts.resyncMs ?? 5000;
    if (every > 0) {
      this.resyncTimer = setInterval(() => {
        if (this.lifecycle && !this.refreshing) this.scheduleRefresh();
      }, every);
      this.resyncTimer.unref?.();
    }
    try {
      await this.connect();
    } catch (err) {
      this.log(`[${this.session}] connect failed: ${(err as Error).message}`);
      this.scheduleReconnect();
    }
  }

  async stop(): Promise<void> {
    this.running = false;
    clearTimeout(this.refreshTimer);
    clearTimeout(this.reconnectTimer);
    clearInterval(this.resyncTimer);
    for (const c of [this.lifecycle, this.status, this.rpc]) c?.close();
    this.lifecycle = this.status = this.rpc = undefined;
    this.statusPanes = '';
  }

  private emitDelta(d: Delta): void {
    this.emit('delta', d);
  }

  private async connect(): Promise<void> {
    const { connectPath } = this.opts.target;
    const lc = await HerdrConnection.open(connectPath, this.opts.connector);
    this.lifecycle = lc;
    lc.on('event', (e: EventLine) => this.onLifecycle(e));
    lc.on('error', (err: Error) => this.onStreamError('lifecycle', err));
    lc.on('close', () => this.onStreamClosed(lc));
    await lc.subscribe(LIFECYCLE_SUBSCRIPTIONS.map((type) => ({ type })));
    this.backoff = this.opts.minBackoffMs ?? 500;
    this.log(`[${this.session}] subscribed at ${connectPath}`);
    await this.refresh();
  }

  private onStreamError(which: string, err: Error): void {
    const code = err instanceof HerdrError ? err.code : 'error';
    this.log(`[${this.session}] ${which} stream: ${err.message}`);
    if (code === 'events_lost') {
      // Herdr closes the connection after this; onStreamClosed handles recovery.
    }
  }

  private onStreamClosed(conn: HerdrConnection): void {
    if (!this.running) return;
    if (conn === this.lifecycle) {
      this.lifecycle = undefined;
      this.status?.close();
      this.rpc?.close();
      this.scheduleReconnect();
    } else if (conn === this.status) {
      // Status stream lost (events_lost, or a pane vanished before subscribe): re-read and resubscribe.
      this.status = undefined;
      this.statusPanes = '';
      this.scheduleRefresh();
    }
  }

  private scheduleReconnect(): void {
    if (!this.running) return;
    clearTimeout(this.reconnectTimer);
    const delay = this.backoff;
    this.backoff = Math.min(this.backoff * 2, this.opts.maxBackoffMs ?? 15_000);
    this.reconnectTimer = setTimeout(() => {
      this.connect().catch((err) => {
        this.log(`[${this.session}] reconnect failed: ${(err as Error).message}`);
        this.scheduleReconnect();
      });
    }, delay);
  }

  private onLifecycle(e: EventLine): void {
    const type = e.data.type ?? e.event;
    if (type === 'worktree_created' || type === 'worktree_opened') {
      const wt = e.data.worktree as WorktreeInfo | undefined;
      const ws = e.data.workspace as { workspace_id?: string } | undefined;
      if (wt?.branch && ws?.workspace_id) this.branches.set(ws.workspace_id, wt.branch);
    }
    this.scheduleRefresh();
  }

  private onStatus(e: EventLine): void {
    if (e.event !== AGENT_STATUS_CHANGED) return;
    const ev = e.data as unknown as AgentStatusChanged;
    const res = applyStatusChange(this.parties, ev, this.ctx);
    if (!res) {
      // A pane we don't model as a member yet (agent just appeared): re-read.
      this.scheduleRefresh();
      return;
    }
    this.parties = { ...this.parties, [res.party.id]: res.party };
    const t = this.now();
    this.emitDelta({ t, kind: 'member', partyId: res.party.id, member: res.member });
    if (res.rollupChanged) this.emitDelta({ t, kind: 'party', party: res.party });
  }

  private scheduleRefresh(): void {
    if (!this.running) return;
    clearTimeout(this.refreshTimer);
    this.refreshTimer = setTimeout(() => void this.refresh(), this.opts.refreshDebounceMs ?? 50);
  }

  /** Serialized authoritative re-read. Events that land mid-read trigger one more read. */
  async refresh(): Promise<void> {
    if (!this.running) return;
    if (this.refreshing) {
      this.dirty = true;
      return;
    }
    this.refreshing = true;
    try {
      do {
        this.dirty = false;
        const snap = await this.snapshot();
        this.applySnapshot(snap);
        await this.syncStatusSubscription(snap);
      } while (this.dirty && this.running);
    } catch (err) {
      this.log(`[${this.session}] refresh failed: ${(err as Error).message}`);
      if (this.running && this.lifecycle) this.scheduleRefresh();
    } finally {
      this.refreshing = false;
    }
  }

  private async rpcConn(): Promise<HerdrConnection> {
    if (!this.rpc || this.rpc.isClosed) {
      this.rpc = await HerdrConnection.open(this.opts.target.connectPath, this.opts.connector);
      this.rpc.on('error', () => {});
    }
    return this.rpc;
  }

  /** Actions for this session, mapped to Herdr's request/response API. */
  readonly actions: Action = {
    focus: async (paneId) => void (await (await this.rpcConn()).request('pane.focus', { pane_id: paneId })),
    prompt: async (paneId, text) => void (await (await this.rpcConn()).request('agent.prompt', { target: paneId, text })),
    sendKeys: async (paneId, keys) => void (await (await this.rpcConn()).request('agent.send_keys', { target: paneId, keys })),
    close: async (paneId) => {
      await (await this.rpcConn()).request('pane.close', { pane_id: paneId });
      this.scheduleRefresh();
    },
  };

  /** Local folder of a party in this session, when Herdr reports one. */
  folderOf(partyId: string): string | undefined {
    return this.folders[partyId];
  }

  /** Whether this session currently has a member in `paneId`. */
  hasPane(paneId: string): boolean {
    return Object.values(this.parties).some((p) => paneId in p.members);
  }

  private async snapshot(): Promise<SessionSnapshot> {
    const rpc = await this.rpcConn();
    const res = await rpc.request('session.snapshot');
    if (res.type !== 'session_snapshot') throw new HerdrError('unexpected', `snapshot answered ${res.type}`);
    return res.snapshot as SessionSnapshot;
  }

  private applySnapshot(snap: SessionSnapshot): void {
    const next = partiesFromSnapshot(snap, this.ctx);
    this.folders = foldersFromSnapshot(snap, next, this.ctx);
    const t = this.now();
    if (!this.hasSnapshot) {
      this.hasSnapshot = true;
      this.parties = next;
      this.emitDelta({ t, kind: 'snapshot', world: { machine: 'local', parties: next } });
      return;
    }
    const deltas = diffParties(this.parties, next, t);
    this.parties = next;
    for (const d of deltas) this.emitDelta(d);
  }

  private async syncStatusSubscription(snap: SessionSnapshot): Promise<void> {
    const panes = paneIds(snap);
    const key = panes.join(',');
    if (key === this.statusPanes && this.status && !this.status.isClosed) return;
    const old = this.status;
    this.status = undefined;
    this.statusPanes = '';
    old?.close();
    if (!panes.length) {
      this.statusPanes = key;
      return;
    }
    const conn = await HerdrConnection.open(this.opts.target.connectPath, this.opts.connector);
    conn.on('event', (e: EventLine) => this.onStatus(e));
    conn.on('error', (err: Error) => this.onStreamError('status', err));
    conn.on('close', () => this.onStreamClosed(conn));
    this.status = conn;
    try {
      await conn.subscribe(panes.map((pane_id) => ({ type: AGENT_STATUS_CHANGED, pane_id })));
      this.statusPanes = key;
    } catch (err) {
      // Herdr rejects the whole request if any pane vanished; close fires and we re-read.
      conn.close();
      throw err;
    }
  }
}

export interface LiveOptions {
  /** `'all'` discovers running sessions; otherwise explicit names. Default: resolve one target from env. */
  sessions?: 'all' | string[];
  socket?: string;
  machine?: string;
  connector?: Connector;
  now?: () => number;
  refreshDebounceMs?: number;
  resyncMs?: number;
  minBackoffMs?: number;
  maxBackoffMs?: number;
  log?: (msg: string) => void;
}

/** Live Herdr source across one or more sessions, merged into one world. */
export class HerdrSource extends EventEmitter implements WorldSource {
  private children: HerdrSessionSource[] = [];
  private readonly machine: string;

  constructor(private readonly opts: LiveOptions = {}) {
    super();
    this.machine = opts.machine ?? os.hostname() ?? 'local';
  }

  async targets(): Promise<SessionTarget[]> {
    const { sessions, socket } = this.opts;
    if (socket) return [resolveTarget({ socket, session: Array.isArray(sessions) ? sessions[0] : undefined })];
    if (sessions === 'all') return discoverSessions();
    if (Array.isArray(sessions) && sessions.length) return sessions.map((session) => resolveTarget({ session }));
    return [resolveTarget({})];
  }

  async start(): Promise<void> {
    const targets = await this.targets();
    if (!targets.length) this.opts.log?.('no running Herdr sessions found');
    this.children = targets.map(
      (target) =>
        new HerdrSessionSource({
          target,
          connector: this.opts.connector,
          now: this.opts.now,
          refreshDebounceMs: this.opts.refreshDebounceMs,
          resyncMs: this.opts.resyncMs,
          minBackoffMs: this.opts.minBackoffMs,
          maxBackoffMs: this.opts.maxBackoffMs,
          log: this.opts.log,
        }),
    );
    for (const c of this.children) {
      c.on('delta', (d: Delta) => {
        // A session's snapshot replaces only its parties; send the merged world.
        if (d.kind === 'snapshot') this.emit('delta', { ...d, world: this.world() });
        else this.emit('delta', d);
      });
    }
    await Promise.all(this.children.map((c) => c.start()));
  }

  async stop(): Promise<void> {
    await Promise.all(this.children.map((c) => c.stop()));
    this.children = [];
  }

  /**
   * Routes to the session that owns the pane. Pane ids are session-local, so with
   * several sessions the first one holding the id wins.
   */
  readonly actions: Action = {
    focus: async (paneId) => this.route(paneId).focus(paneId),
    prompt: async (paneId, text) => this.route(paneId).prompt(paneId, text),
    sendKeys: async (paneId, keys) => this.route(paneId).sendKeys(paneId, keys),
    close: async (paneId) => this.route(paneId).close(paneId),
  };

  private route(paneId: string): Action {
    const child = this.children.find((c) => c.hasPane(paneId));
    if (!child) throw new Error(`no pane ${paneId} in any session`);
    return child.actions;
  }

  /** Local folder of a party, from the session that owns it. Herdr here is always the local machine. */
  partyFolder(partyId: string): string | undefined {
    for (const c of this.children) {
      const f = c.folderOf(partyId);
      if (f) return f;
    }
    return undefined;
  }

  world(): World {
    const parties: Record<string, Party> = {};
    for (const c of this.children) Object.assign(parties, c.current);
    return { machine: this.machine, parties };
  }
}
