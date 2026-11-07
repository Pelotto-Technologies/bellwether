// A mock Herdr server on a Unix socket (or Windows pipe) that speaks the NDJSON protocol.
import { mkdtempSync, readFileSync } from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import type { SessionSnapshot } from '../src/herdr/protocol.js';

export const FIXTURES = path.join(import.meta.dirname, 'fixtures', 'herdr');

export function loadSnapshot(): SessionSnapshot {
  return JSON.parse(readFileSync(path.join(FIXTURES, 'snapshot.json'), 'utf8')).result.snapshot;
}

export const RESEARCH_FIXTURES = path.join(import.meta.dirname, '..', '..', '..', 'docs', 'research', 'fixtures');

export function loadCapture(file = path.join(FIXTURES, 'capture-2026-11-06.ndjson')): Array<Record<string, any>> {
  return readFileSync(file, 'utf8').split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l));
}

interface Sub {
  sock: net.Socket;
  id: string;
  types: Set<string>;
  panes: Set<string>;
}

export class MockHerdr {
  snapshot: SessionSnapshot;
  readonly socketPath: string;
  readonly requests: Array<{ method: string; params: any }> = [];
  /** Called right after a snapshot is served, to simulate races. */
  afterSnapshot?: () => void;
  private server = net.createServer((s) => this.onConn(s));
  private subs: Sub[] = [];
  private sockets = new Set<net.Socket>();

  constructor(snapshot = loadSnapshot()) {
    this.snapshot = structuredClone(snapshot);
    const dir = mkdtempSync(path.join(os.tmpdir(), 'bw-herdr-'));
    this.socketPath = process.platform === 'win32' ? `\\\\.\\pipe\\${dir}\\herdr.sock` : path.join(dir, 'herdr.sock');
  }

  listen(): Promise<void> {
    return new Promise((r) => this.server.listen(this.socketPath, r));
  }

  async close(): Promise<void> {
    for (const s of this.sockets) s.destroy();
    await new Promise<void>((r) => this.server.close(() => r()));
  }

  get lifecycleSubs(): number {
    return this.subs.filter((s) => !s.sock.destroyed && s.types.has('pane.created')).length;
  }
  statusSubPanes(): string[][] {
    return this.subs.filter((s) => !s.sock.destroyed && s.panes.size).map((s) => [...s.panes].sort());
  }

  /** Push an event line to every subscriber whose filters match. */
  push(line: Record<string, any>): void {
    const ev: string = line.event;
    const dotted = ev.includes('.') ? ev : ev.replace('_', '.');
    for (const s of this.subs) {
      if (s.sock.destroyed) continue;
      if (dotted === 'pane.agent_status_changed') {
        if (s.panes.has(line.data.pane_id)) s.sock.write(JSON.stringify(line) + '\n');
      } else if (s.types.has(dotted)) s.sock.write(JSON.stringify(line) + '\n');
    }
  }

  /** Send events_lost to lifecycle subscribers and close them, as Herdr does. */
  loseEvents(): void {
    for (const s of this.subs) {
      if (s.sock.destroyed || !s.types.has('pane.created')) continue;
      s.sock.end(JSON.stringify({ id: s.id, error: { code: 'events_lost', message: 'subscriber fell behind' } }) + '\n');
    }
  }

  private onConn(sock: net.Socket): void {
    this.sockets.add(sock);
    sock.on('close', () => this.sockets.delete(sock));
    sock.on('error', () => {});
    let buf = '';
    sock.setEncoding('utf8');
    sock.on('data', (c: string) => {
      buf += c;
      let i: number;
      while ((i = buf.indexOf('\n')) >= 0) {
        const raw = buf.slice(0, i);
        buf = buf.slice(i + 1);
        if (raw.trim()) this.onRequest(sock, JSON.parse(raw));
      }
    });
  }

  private onRequest(sock: net.Socket, req: { id: string; method: string; params: any }): void {
    this.requests.push({ method: req.method, params: req.params });
    const reply = (o: object) => sock.write(JSON.stringify({ id: req.id, ...o }) + '\n');
    if (req.method === 'session.snapshot') {
      reply({ result: { type: 'session_snapshot', snapshot: this.snapshot } });
      return void this.afterSnapshot?.();
    }
    if (req.method === 'ping') return void reply({ result: { type: 'pong', version: '0.9.5', protocol: 22 } });
    if (req.method === 'events.subscribe') {
      const subs: Array<{ type: string; pane_id?: string }> = req.params.subscriptions;
      const known = new Set(this.snapshot.panes.map((p) => p.pane_id));
      const missing = subs.find((s) => s.pane_id && !known.has(s.pane_id));
      if (missing) {
        reply({ error: { code: 'pane_not_found', message: `no pane ${missing.pane_id}` } });
        return void sock.end();
      }
      const types = new Set(subs.filter((s) => !s.pane_id).map((s) => s.type));
      const panes = new Set(subs.filter((s) => s.pane_id).map((s) => s.pane_id!));
      this.subs.push({ sock, id: req.id, types, panes });
      return void reply({ result: { type: 'subscription_started' } });
    }
    reply({ error: { code: 'unknown_method', message: req.method } });
  }
}

export async function until(cond: () => boolean, ms = 2000): Promise<void> {
  const end = Date.now() + ms;
  while (!cond()) {
    if (Date.now() > end) throw new Error('timed out waiting for condition');
    await new Promise((r) => setTimeout(r, 5));
  }
}
