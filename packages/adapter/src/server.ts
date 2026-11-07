import { createReadStream, statSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { WebSocketServer, type WebSocket } from 'ws';
import type { WorldSource } from './source.js';
import type { Delta, World } from './types.js';
import { applyDelta, emptyWorld, snapshotDelta } from './world.js';

export const DEFAULT_PORT = 7341;
export const DELTA_PATH = '/deltas';

export interface DeltaServerOptions {
  port?: number;
  host?: string;
  /** Optional directory to serve over HTTP (the built renderer), so one process runs the overlay. */
  staticDir?: string;
}

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
};

/**
 * Broadcasts every Delta from a source to WebSocket clients on `/deltas`.
 * A client that connects late first receives a snapshot of the current world.
 */
export class DeltaServer {
  private world: World = emptyWorld();
  private http: Server;
  private wss: WebSocketServer;
  private clients = new Set<WebSocket>();

  constructor(private opts: DeltaServerOptions = {}) {
    this.http = createServer((req, res) => {
      const dir = this.opts.staticDir;
      if (!dir) {
        res.writeHead(404).end();
        return;
      }
      const root = resolve(dir);
      const urlPath = decodeURIComponent((req.url ?? '/').split('?')[0] ?? '/');
      let file = normalize(join(root, urlPath));
      if (file !== root && !file.startsWith(root + sep)) {
        res.writeHead(403).end();
        return;
      }
      try {
        if (statSync(file).isDirectory()) file = join(file, 'index.html');
        statSync(file);
      } catch {
        res.writeHead(404).end();
        return;
      }
      res.writeHead(200, { 'content-type': MIME[extname(file)] ?? 'application/octet-stream' });
      createReadStream(file).pipe(res);
    });
    this.wss = new WebSocketServer({ server: this.http, path: DELTA_PATH });
    this.wss.on('connection', (ws) => {
      this.clients.add(ws);
      ws.on('close', () => this.clients.delete(ws));
      ws.send(JSON.stringify(snapshotDelta(this.world)));
    });
  }

  get currentWorld(): World {
    return this.world;
  }

  attach(source: WorldSource): void {
    source.on('delta', (d) => this.publish(d));
  }

  publish(delta: Delta): void {
    this.world = applyDelta(this.world, delta);
    const line = JSON.stringify(delta);
    for (const ws of this.clients) {
      if (ws.readyState === ws.OPEN) ws.send(line);
    }
  }

  listen(): Promise<number> {
    return new Promise((resolvePort, reject) => {
      this.http.once('error', reject);
      this.http.listen(this.opts.port ?? DEFAULT_PORT, this.opts.host ?? '127.0.0.1', () => {
        const addr = this.http.address();
        resolvePort(typeof addr === 'object' && addr ? addr.port : (this.opts.port ?? DEFAULT_PORT));
      });
    });
  }

  close(): Promise<void> {
    for (const ws of this.clients) ws.terminate();
    return new Promise((res) => this.wss.close(() => this.http.close(() => res())));
  }
}
