import { EventEmitter } from 'node:events';
import net from 'node:net';
import type { EventLine, Line, SuccessResponse } from './protocol.js';
import { isError, isEvent } from './protocol.js';

export class HerdrError extends Error {
  constructor(public readonly code: string, message: string) {
    super(`${code}: ${message}`);
    this.name = 'HerdrError';
  }
}

export type Connector = (connectPath: string) => net.Socket;
const defaultConnector: Connector = (p) => net.connect(p);

interface Pending {
  resolve: (r: SuccessResponse['result']) => void;
  reject: (e: Error) => void;
  timer?: NodeJS.Timeout;
}

/**
 * One NDJSON connection to a Herdr server socket (Unix socket or Windows named pipe).
 *
 * Events:
 * - `event` (EventLine) pushed lines on a subscription connection
 * - `error` (Error) a request-less error, e.g. `events_lost` on a subscription
 * - `close` () the socket closed
 */
export class HerdrConnection extends EventEmitter {
  private buf = '';
  private seq = 0;
  private pending = new Map<string, Pending>();
  private closed = false;

  private constructor(private readonly socket: net.Socket) {
    super();
    socket.setEncoding('utf8');
    socket.on('data', (chunk: string) => this.onData(chunk));
    socket.on('close', () => this.onClose());
    socket.on('error', (err) => this.failAll(err));
  }

  static open(connectPath: string, connector: Connector = defaultConnector, timeoutMs = 5000): Promise<HerdrConnection> {
    return new Promise((resolve, reject) => {
      const socket = connector(connectPath);
      const timer = setTimeout(() => {
        socket.destroy();
        reject(new HerdrError('connect_timeout', `no answer from ${connectPath}`));
      }, timeoutMs);
      socket.once('connect', () => {
        clearTimeout(timer);
        socket.removeListener('error', onErr);
        resolve(new HerdrConnection(socket));
      });
      const onErr = (err: Error) => {
        clearTimeout(timer);
        reject(err);
      };
      socket.once('error', onErr);
    });
  }

  get isClosed(): boolean {
    return this.closed;
  }

  request(method: string, params: Record<string, unknown> = {}, timeoutMs = 10_000): Promise<SuccessResponse['result']> {
    if (this.closed) return Promise.reject(new HerdrError('closed', 'connection closed'));
    const id = `bw_${++this.seq}`;
    return new Promise((resolve, reject) => {
      const p: Pending = { resolve, reject };
      if (timeoutMs > 0) {
        p.timer = setTimeout(() => {
          this.pending.delete(id);
          reject(new HerdrError('timeout', `${method} timed out`));
        }, timeoutMs);
      }
      this.pending.set(id, p);
      this.socket.write(JSON.stringify({ id, method, params }) + '\n');
    });
  }

  /** Start a subscription on this connection. Resolves on `subscription_started`. */
  async subscribe(subscriptions: Array<Record<string, unknown>>, timeoutMs = 10_000): Promise<void> {
    const res = await this.request('events.subscribe', { subscriptions }, timeoutMs);
    if (res.type !== 'subscription_started') throw new HerdrError('unexpected', `subscribe answered ${res.type}`);
  }

  close(): void {
    if (this.closed) return;
    this.socket.destroy();
  }

  private onData(chunk: string): void {
    this.buf += chunk;
    let nl: number;
    while ((nl = this.buf.indexOf('\n')) >= 0) {
      const raw = this.buf.slice(0, nl).trim();
      this.buf = this.buf.slice(nl + 1);
      if (!raw) continue;
      let line: Line;
      try {
        line = JSON.parse(raw) as Line;
      } catch {
        continue; // tolerate garbage lines
      }
      this.onLine(line);
    }
  }

  private onLine(line: Line): void {
    if (isEvent(line)) {
      this.emit('event', line as EventLine);
      return;
    }
    const p = this.pending.get(line.id);
    if (p) {
      this.pending.delete(line.id);
      if (p.timer) clearTimeout(p.timer);
      if (isError(line)) p.reject(new HerdrError(line.error.code, line.error.message));
      else p.resolve(line.result);
      return;
    }
    if (isError(line)) {
      // e.g. events_lost, sent with the original subscription id after it started
      this.emit('error', new HerdrError(line.error.code, line.error.message));
    }
  }

  private failAll(err: Error): void {
    for (const [, p] of this.pending) {
      if (p.timer) clearTimeout(p.timer);
      p.reject(err);
    }
    this.pending.clear();
  }

  private onClose(): void {
    this.closed = true;
    this.failAll(new HerdrError('closed', 'connection closed'));
    this.emit('close');
  }
}
