import { readdir, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

export const DEFAULT_SESSION = 'default';
const PIPE_PREFIX = '\\\\.\\pipe\\';

export interface PathEnv {
  platform?: NodeJS.Platform;
  env?: NodeJS.ProcessEnv;
  home?: string;
}

/** Herdr config dir: `%APPDATA%\herdr` on Windows, `$XDG_CONFIG_HOME/herdr` or `~/.config/herdr` elsewhere. */
export function herdrConfigDir(e: PathEnv = {}): string {
  const platform = e.platform ?? process.platform;
  const env = e.env ?? process.env;
  const home = e.home ?? os.homedir();
  const p = platform === 'win32' ? path.win32 : path.posix;
  if (platform === 'win32') return p.join(env.APPDATA ?? p.join(home, 'AppData', 'Roaming'), 'herdr');
  return p.join(env.XDG_CONFIG_HOME ?? p.join(home, '.config'), 'herdr');
}

/** Socket file path for a session (before Windows pipe prefixing). */
export function sessionSocketFile(session: string, e: PathEnv = {}): string {
  const platform = e.platform ?? process.platform;
  const p = platform === 'win32' ? path.win32 : path.posix;
  const dir = herdrConfigDir(e);
  return session === DEFAULT_SESSION ? p.join(dir, 'herdr.sock') : p.join(dir, 'sessions', session, 'herdr.sock');
}

/** What `net.connect` takes: the socket path on Unix, `\\.\pipe\<path>` on Windows. */
export function toConnectPath(socketFile: string, platform: NodeJS.Platform = process.platform): string {
  if (platform !== 'win32' || socketFile.startsWith(PIPE_PREFIX)) return socketFile;
  return PIPE_PREFIX + socketFile;
}

export interface SessionTarget {
  session: string;
  connectPath: string;
}

/**
 * Resolve one explicit target. Order mirrors Herdr: explicit socket, explicit
 * session, HERDR_SOCKET_PATH, HERDR_SESSION, default.
 */
export function resolveTarget(opts: { session?: string; socket?: string }, e: PathEnv = {}): SessionTarget {
  const platform = e.platform ?? process.platform;
  const env = e.env ?? process.env;
  if (opts.socket) return { session: opts.session ?? 'custom', connectPath: toConnectPath(opts.socket, platform) };
  if (opts.session) return { session: opts.session, connectPath: toConnectPath(sessionSocketFile(opts.session, e), platform) };
  if (env.HERDR_SOCKET_PATH) return { session: env.HERDR_SESSION ?? DEFAULT_SESSION, connectPath: toConnectPath(env.HERDR_SOCKET_PATH, platform) };
  const s = env.HERDR_SESSION ?? DEFAULT_SESSION;
  return { session: s, connectPath: toConnectPath(sessionSocketFile(s, e), platform) };
}

/**
 * Enumerate running sessions: the default socket plus `sessions/<name>/herdr.sock`.
 * On Windows a session is live when its pipe exists; elsewhere when the socket file exists.
 */
export async function discoverSessions(e: PathEnv = {}): Promise<SessionTarget[]> {
  const platform = e.platform ?? process.platform;
  const dir = herdrConfigDir(e);
  const p = platform === 'win32' ? path.win32 : path.posix;
  const names = [DEFAULT_SESSION];
  try {
    for (const d of await readdir(p.join(dir, 'sessions'), { withFileTypes: true })) if (d.isDirectory()) names.push(d.name);
  } catch {
    /* no named sessions */
  }
  let pipes: Set<string> | undefined;
  if (platform === 'win32') {
    try {
      pipes = new Set((await readdir(PIPE_PREFIX)).map((n) => n.toLowerCase()));
    } catch {
      pipes = new Set();
    }
  }
  const out: SessionTarget[] = [];
  for (const name of names) {
    const file = sessionSocketFile(name, e);
    const live = pipes ? pipes.has(file.toLowerCase()) : await exists(file);
    if (live) out.push({ session: name, connectPath: toConnectPath(file, platform) });
  }
  return out;
}

async function exists(f: string): Promise<boolean> {
  try {
    await stat(f);
    return true;
  } catch {
    return false;
  }
}
