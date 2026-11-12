import { HerdrConnection, type Connector } from './herdr/connection.js';
import { discoverSessions, resolveTarget, type PathEnv, type SessionTarget } from './herdr/paths.js';
import type { SourceConfig } from './config.js';

export interface AutoDeps {
  /** Replaces the whole probe (tests). Resolves true when a Herdr socket answers. */
  probe?: (cfg: SourceConfig) => Promise<boolean>;
  /** Socket opener for the probe (tests). */
  connector?: Connector;
  /** How long one connect attempt may take. Default 1000 ms. */
  timeoutMs?: number;
  pathEnv?: PathEnv;
}

export interface AutoChoice {
  /** The concrete source `auto` resolved to. */
  source: 'live' | 'hooks';
  /** One line for the log, saying why. */
  reason: string;
}

/** The sockets the live source would read for this config. Mirrors HerdrSource's target choice. */
async function probeTargets(cfg: SourceConfig, e: PathEnv | undefined): Promise<SessionTarget[]> {
  const { sessions, socket } = cfg.herdr;
  if (socket) return [resolveTarget({ socket, session: Array.isArray(sessions) ? sessions[0] : undefined }, e)];
  if (sessions === 'all') return discoverSessions(e);
  if (Array.isArray(sessions) && sessions.length) return sessions.map((session) => resolveTarget({ session }, e));
  return [resolveTarget({}, e)];
}

/**
 * Decide once, at startup, between live Herdr and the hooks (events file) source.
 * Live wins when at least one Herdr socket/pipe accepts a connection within the timeout;
 * anything else (no socket, stale socket, timeout) falls back to hooks.
 */
export async function chooseAutoSource(cfg: SourceConfig, deps: AutoDeps = {}): Promise<AutoChoice> {
  if (deps.probe) {
    return (await deps.probe(cfg))
      ? { source: 'live', reason: 'Herdr is reachable' }
      : { source: 'hooks', reason: 'Herdr is not reachable' };
  }
  const targets = await probeTargets(cfg, deps.pathEnv);
  if (!targets.length) return { source: 'hooks', reason: 'no running Herdr session found' };
  for (const t of targets) {
    try {
      const conn = await HerdrConnection.open(t.connectPath, deps.connector, deps.timeoutMs ?? 1000);
      conn.close();
      return { source: 'live', reason: `Herdr session "${t.session}" answered` };
    } catch {
      /* try the next target */
    }
  }
  return { source: 'hooks', reason: 'no Herdr socket answered' };
}
