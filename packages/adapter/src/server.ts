import { createReadStream, realpathSync, statSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { extname, resolve, sep } from 'node:path';
import { WebSocketServer, type WebSocket } from 'ws';
import type { Action } from './actions.js';
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
  /** Served as `/config.json` so the renderer can pick the configured skin pack. */
  clientConfig?: Record<string, unknown>;
  /**
   * Also accept `prompt` and `sendKeys` client messages. Off by default; `focus` is
   * always accepted, and `close` is accepted from the overlay's own origin.
   */
  actions?: boolean;
  log?: (msg: string) => void;
}

/** Client to server messages on the delta socket. */
export type ClientMessage =
  | { type: 'focus'; paneId: string }
  | { type: 'prompt'; paneId: string; text: string }
  | { type: 'sendKeys'; paneId: string; keys: string[] }
  | { type: 'close'; paneId: string };

/**
 * Whether a WebSocket upgrade came from the overlay itself rather than some other
 * web page in the user's browser: no Origin (Electron, OBS, scripts) or a loopback one.
 * Closing panes is only accepted from such clients.
 */
export function isLocalOrigin(origin: string | undefined): boolean {
  if (!origin || origin === 'null' || origin.startsWith('file:')) return true;
  try {
    const host = new URL(origin).hostname;
    return host === '127.0.0.1' || host === 'localhost' || host === '[::1]' || host === '::1';
  } catch {
    return false;
  }
}

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
};

function finishStatic(root: string, file: string): string | 'forbidden' | undefined {
  if (!file.startsWith(root + sep)) return 'forbidden';
  // Symlink check: the real location must also be inside the real root.
  const real = realpathSync(file);
  if (!real.startsWith(root + sep)) return 'forbidden';
  return statSync(file).isFile() ? file : undefined;
}

/**
 * Maps a request URL to a file strictly inside `dir`. Returns 'forbidden' for
 * anything that decodes to a null byte, escapes the root lexically, or escapes
 * it through a symlink; undefined when the file does not exist.
 */
export function resolveStaticFile(dir: string, url: string): string | 'forbidden' | undefined {
  let urlPath: string;
  try {
    urlPath = decodeURIComponent(url.split('?')[0]!.split('#')[0]!);
  } catch {
    return 'forbidden';
  }
  if (urlPath.includes('\0') || urlPath.includes('\\')) return 'forbidden';
  let root: string;
  try {
    root = realpathSync(resolve(dir));
  } catch {
    return undefined;
  }
  if (!urlPath.startsWith('/')) urlPath = '/' + urlPath;
  if (urlPath.endsWith('/')) urlPath += 'index.html';
  const candidate = resolve(root, '.' + urlPath);
  if (!candidate.startsWith(root + sep)) return 'forbidden';
  try {
    if (statSync(candidate).isDirectory()) {
      const index = resolve(candidate, 'index.html');
      if (!index.startsWith(root + sep)) return 'forbidden';
      return finishStatic(root, index);
    }
    return finishStatic(root, candidate);
  } catch {
    return undefined;
  }
}

/**
 * Broadcasts every Delta from a source to WebSocket clients on `/deltas`.
 * A client that connects late first receives a snapshot of the current world.
 */
export class DeltaServer {
  private world: World = emptyWorld();
  private http: Server;
  private wss: WebSocketServer;
  private clients = new Set<WebSocket>();
  private action?: Action;

  constructor(private opts: DeltaServerOptions = {}) {
    this.http = createServer((req, res) => {
      if ((req.url ?? '').split('?')[0] === '/config.json' && this.opts.clientConfig) {
        res.writeHead(200, { 'content-type': MIME['.json']!, 'cache-control': 'no-store' });
        res.end(JSON.stringify(this.opts.clientConfig));
        return;
      }
      const dir = this.opts.staticDir;
      if (!dir) {
        res.writeHead(404).end();
        return;
      }
      const file = resolveStaticFile(dir, req.url ?? '/');
      if (file === 'forbidden') {
        res.writeHead(403).end();
        return;
      }
      if (!file) {
        res.writeHead(404).end();
        return;
      }
      res.writeHead(200, { 'content-type': MIME[extname(file)] ?? 'application/octet-stream' });
      createReadStream(file).pipe(res);
    });
    this.wss = new WebSocketServer({ server: this.http, path: DELTA_PATH });
    this.wss.on('connection', (ws, req) => {
      this.clients.add(ws);
      const local = isLocalOrigin(req.headers.origin);
      ws.on('close', () => this.clients.delete(ws));
      ws.on('message', (data) => this.onClientMessage(String(data), local));
      ws.send(JSON.stringify(snapshotDelta(this.world)));
    });
  }

  get currentWorld(): World {
    return this.world;
  }

  attach(source: WorldSource): void {
    this.action = source.actions;
    source.on('delta', (d) => this.publish(d));
  }

  private onClientMessage(raw: string, local = false): void {
    const action = this.action;
    let msg: Record<string, unknown>;
    try {
      msg = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      return;
    }
    if (!action || typeof msg.paneId !== 'string' || !msg.paneId) return;
    let run: Promise<void> | undefined;
    if (msg.type === 'focus') run = action.focus(msg.paneId);
    else if (msg.type === 'close' && local) {
      this.opts.log?.(`closing pane ${msg.paneId} (asked by the overlay)`);
      run = action.close(msg.paneId);
    }
    else if (this.opts.actions && msg.type === 'prompt' && typeof msg.text === 'string') run = action.prompt(msg.paneId, msg.text);
    else if (this.opts.actions && msg.type === 'sendKeys' && Array.isArray(msg.keys) && msg.keys.every((k) => typeof k === 'string')) {
      run = action.sendKeys(msg.paneId, msg.keys as string[]);
    }
    // Rejections (pane gone, Herdr down) are logged, never sent to the client.
    Promise.resolve(run).catch((err: Error) => this.opts.log?.(`action ${String(msg.type)} failed: ${err.message}`));
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
