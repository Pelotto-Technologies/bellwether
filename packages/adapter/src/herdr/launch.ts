import { HerdrConnection, type Connector } from './connection.js';
import { resolveTarget, type SessionTarget } from './paths.js';
import { isRole, type Role } from '../types.js';

export interface LaunchOptions {
  /** Explicit session/socket; resolved with `resolveTarget` when `target` is not given. */
  session?: string;
  socket?: string;
  target?: SessionTarget;
  connector?: Connector;
  cwd?: string;
  label?: string;
  role?: string;
  /** Command argv typed into pane 1's shell. Empty or missing: only create and tag. */
  command?: string[];
  /** Milliseconds to wait for the pane to report an agent (default 60000). */
  timeoutMs?: number;
  pollMs?: number;
  log?: (m: string) => void;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

export interface LaunchResult {
  workspaceId?: string;
  label: string;
  paneId: string;
  role: Role;
  commandLine?: string;
  /** Agent kind reported by Herdr, when one was detected before the timeout. */
  agent?: string;
  agentName?: string;
  timedOut: boolean;
}

/**
 * Wrap an argument in double quotes when it has whitespace. Shells disagree on how to
 * escape a quote inside quotes (bash vs PowerShell vs cmd), so arguments containing a
 * double quote are refused rather than typed wrongly.
 */
export function quoteArg(a: string): string {
  if (a.includes('"')) throw new Error(`cannot type an argument containing a double quote: ${a}`);
  if (a !== '' && !/\s/.test(a)) return a;
  return `"${a}"`;
}

/** Drop trailing characters in `chars` (a loop, not a regex, so it stays linear). */
function trimEnd(s: string, chars: string): string {
  let end = s.length;
  while (end > 0 && chars.includes(s[end - 1]!)) end--;
  return s.slice(0, end);
}

function trimStart(s: string, chars: string): string {
  let start = 0;
  while (start < s.length && chars.includes(s[start]!)) start++;
  return s.slice(start);
}

/** Last path segment, for both `/` and `\\` separators, ignoring trailing separators. */
function folderName(cwd: string): string {
  const trimmed = trimEnd(cwd, '/\\');
  const cut = Math.max(trimmed.lastIndexOf('/'), trimmed.lastIndexOf('\\'));
  return trimmed.slice(cut + 1);
}

export function commandLine(argv: string[]): string {
  return argv.map(quoteArg).join(' ');
}

/** `orchestrator-<repo slug>` matching `[a-z][a-z0-9_-]{0,31}`; the role word is never truncated. */
export function agentNameFor(role: string, cwd: string): string {
  const slug = trimStart(trimEnd(folderName(cwd).toLowerCase().replace(/[^a-z0-9]+/g, '-'), '-'), '-');
  const room = 32 - role.length - 1;
  const tail = trimEnd(slug.slice(0, Math.max(0, room)), '-');
  return tail ? `${role}-${tail}` : role;
}

export function defaultLabel(cwd: string): string {
  return `${folderName(cwd) || 'workspace'} Orchestration`;
}

/**
 * Create a workspace, tag its root pane with a role, type the agent command into the
 * shell and wait for Herdr to detect the agent. Never throws on a detection timeout.
 */
export async function launchOrchestrator(opts: LaunchOptions = {}): Promise<LaunchResult> {
  const log = opts.log ?? (() => {});
  const roleIn = opts.role ?? 'orchestrator';
  if (!isRole(roleIn)) throw new Error(`unknown role "${roleIn}"`);
  const role: Role = roleIn;
  const cwd = opts.cwd ?? process.cwd();
  const label = opts.label ?? defaultLabel(cwd);
  const target = opts.target ?? resolveTarget({ session: opts.session, socket: opts.socket });
  const now = opts.now ?? Date.now;
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const pollMs = opts.pollMs ?? 500;
  const timeoutMs = opts.timeoutMs ?? 60_000;
  const command = opts.command?.length ? opts.command : undefined;
  // Validate the command line before touching Herdr.
  const line = command ? commandLine(command) : undefined;

  const conn = await HerdrConnection.open(target.connectPath, opts.connector);
  try {
    const created = (await conn.request('workspace.create', { cwd, label, focus: true, env: { HERDR_ROLE: role } })) as any;
    const paneId: string | undefined = created?.root_pane?.pane_id;
    if (!paneId) throw new Error('workspace.create returned no root pane');
    const workspaceId: string | undefined = created?.workspace?.workspace_id;
    const tag = () => conn.request('pane.report_metadata', { pane_id: paneId, source: 'bellwether', tokens: { role } });
    await tag();

    const result: LaunchResult = { workspaceId, label, paneId, role, timedOut: false };
    if (!command) {
      log(`created workspace "${label}" (pane ${paneId}, role ${role}); no command given, pane left at its shell`);
      return result;
    }

    result.commandLine = line;
    await conn.request('pane.send_text', { pane_id: paneId, text: line! });
    await conn.request('pane.send_keys', { pane_id: paneId, keys: ['Enter'] });

    const deadline = now() + timeoutMs;
    let agent: string | undefined;
    for (;;) {
      try {
        const r = (await conn.request('pane.get', { pane_id: paneId })) as any;
        if (r?.pane?.agent) {
          agent = r.pane.agent;
          break;
        }
      } catch (e) {
        log(`pane.get failed: ${(e as Error).message}`);
      }
      if (now() >= deadline) break;
      await sleep(pollMs);
    }

    if (!agent) {
      result.timedOut = true;
      log(`warning: no agent detected in pane ${paneId} within ${timeoutMs}ms; the workspace and pane were still created`);
      return result;
    }
    result.agent = agent;
    await tag();
    let hasName = false;
    try {
      const a = (await conn.request('agent.get', { target: paneId })) as any;
      hasName = Boolean(a?.agent?.name);
      if (hasName) result.agentName = a.agent.name;
    } catch (e) {
      log(`agent.get failed: ${(e as Error).message}`);
    }
    if (!hasName) {
      const name = agentNameFor(role, cwd);
      try {
        await conn.request('agent.rename', { target: paneId, name });
        result.agentName = name;
      } catch (e) {
        log(`rename to "${name}" skipped: ${(e as Error).message}`);
      }
    }
    return result;
  } finally {
    conn.close();
  }
}
