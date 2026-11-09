import { createHash } from 'node:crypto';
import { appendFileSync, mkdirSync, renameSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, join } from 'node:path';

/** Hook events `bellwether hook event` handles; the plugin's hooks.json registers exactly these. */
export const SUPPORTED_HOOK_EVENTS = [
  'SessionStart',
  'UserPromptSubmit',
  'PreToolUse',
  'PostToolUse',
  'Notification',
  'Stop',
  'SubagentStart',
  'SubagentStop',
  'SessionEnd',
] as const;
export type SupportedHookEvent = (typeof SUPPORTED_HOOK_EVENTS)[number];

/** Kept in step with packages/adapter/src/hooks/event.ts (the CLI does not depend on the adapter). */
export type EventKind = 'start' | 'prompt' | 'tool' | 'tool_done' | 'wait' | 'stop' | 'end' | 'sub_start' | 'sub_stop';

export interface NormalizedEvent {
  v: 1;
  t: number;
  agent: string;
  ev: EventKind;
  session: string;
  cwd?: string;
  sub?: string;
  subType?: string;
  tool?: string;
  detail?: string;
  role?: string;
}

export const EVENT_FOR_HOOK: Record<SupportedHookEvent, EventKind> = {
  SessionStart: 'start',
  UserPromptSubmit: 'prompt',
  PreToolUse: 'tool',
  PostToolUse: 'tool_done',
  Notification: 'wait',
  Stop: 'stop',
  SubagentStart: 'sub_start',
  SubagentStop: 'sub_stop',
  SessionEnd: 'end',
};

/**
 * Copilot CLI names its hooks in camelCase and sends `sessionId`/`toolName`/`toolArgs`;
 * its payload may not carry the event name, so the installed command passes `--event`.
 * Unverified against a live Copilot CLI: unknown names are ignored, never fatal.
 */
export const COPILOT_HOOK_EVENTS: Record<string, SupportedHookEvent> = {
  sessionStart: 'SessionStart',
  userPromptSubmitted: 'UserPromptSubmit',
  preToolUse: 'PreToolUse',
  postToolUse: 'PostToolUse',
  agentStop: 'Stop',
  subagentStop: 'SubagentStop',
  sessionEnd: 'SessionEnd',
};

export const EVENT_KINDS: readonly EventKind[] = ['start', 'prompt', 'tool', 'tool_done', 'wait', 'stop', 'end', 'sub_start', 'sub_stop'];

export const MAX_DETAIL = 72;
export const ROTATE_BYTES = 5 * 1024 * 1024;

type Obj = Record<string, unknown>;

function obj(v: unknown): Obj | undefined {
  return v !== null && typeof v === 'object' && !Array.isArray(v) ? (v as Obj) : undefined;
}

function str(v: unknown): string | undefined {
  return typeof v === 'string' && v.trim() ? v : undefined;
}

/** One line, collapsed whitespace, capped with an ellipsis. */
export function shorten(text: string, max = MAX_DETAIL): string {
  const one = text.replace(/\s+/g, ' ').trim();
  return one.length > max ? one.slice(0, max - 1) + '…' : one;
}

function fileBase(p: string): string {
  return basename(p.replace(/\\/g, '/'));
}

/** Short description of a tool call: the tool name plus its file, pattern or command. Never file contents. */
export function toolDetail(tool: string | undefined, input: unknown): string | undefined {
  const inp = obj(input) ?? {};
  const name = tool ?? '';
  if (name === 'Task' || name === 'Agent') {
    const d = str(inp.description) ?? str(inp.prompt);
    return d ? shorten(d) : undefined;
  }
  const path = str(inp.file_path) ?? str(inp.notebook_path) ?? str(inp.path);
  if (path) return shorten(`${name} ${fileBase(path)}`.trim());
  if (name === 'Bash' || name === 'PowerShell') {
    // The description, or only the program name: a full command line can hold secrets.
    const d = str(inp.description) ?? str(inp.command)?.trim().split(/\s+/)[0];
    return d ? shorten(`${name}: ${d}`) : shorten(name);
  }
  const q = str(inp.pattern) ?? str(inp.query) ?? str(inp.url);
  if (q) return shorten(`${name} ${q}`.trim());
  return name ? shorten(name) : undefined;
}

export interface EventContext {
  now?: number;
  env?: Record<string, string | undefined>;
  /** Written into the `agent` field. */
  agent?: string;
  /** Hook name when the payload does not carry one (Copilot CLI: `--event preToolUse`). */
  eventName?: string;
}

function parseMaybe(v: unknown): unknown {
  if (typeof v !== 'string') return v;
  try {
    return JSON.parse(v);
  } catch {
    return undefined;
  }
}

/** Stable session id for agents whose hooks send none: one session per agent and folder. */
export function fallbackSession(agent: string, cwd: string | undefined, env: Record<string, string | undefined>): string {
  const fromEnv = str(env.BELLWETHER_SESSION);
  if (fromEnv) return fromEnv;
  return `${agent}-${createHash('sha1').update(cwd ?? '').digest('hex').slice(0, 8)}`;
}

/** An already-normalized line (the generic source: any tool pipes these in). Validated and clamped; undefined if unusable. */
export function passThrough(p: Obj, now: number): NormalizedEvent | undefined {
  if (p.v !== 1 || !EVENT_KINDS.includes(p.ev as EventKind)) return undefined;
  const session = str(p.session);
  if (!session) return undefined;
  const out: NormalizedEvent = {
    v: 1,
    t: typeof p.t === 'number' && Number.isFinite(p.t) ? p.t : now,
    agent: str(p.agent) ?? 'unknown',
    ev: p.ev as EventKind,
    session,
  };
  for (const k of ['cwd', 'sub', 'subType', 'tool', 'role'] as const) {
    const v = str(p[k]);
    if (v) out[k] = v;
  }
  const d = str(p.detail);
  if (d) out.detail = shorten(d);
  return out;
}

/** Map one hook payload to its normalized line, or undefined for events and payloads we do not track. */
export function normalizeHookPayload(raw: unknown, ctx: EventContext = {}): NormalizedEvent | undefined {
  const p = obj(raw);
  if (!p) return undefined;
  const env = ctx.env ?? process.env;
  const now = ctx.now ?? Date.now();
  if (p.v === 1 && p.ev !== undefined) return passThrough(p, now);
  const agent = ctx.agent ?? 'claude';
  let name = str(p.hook_event_name) ?? str(p.hookEventName) ?? ctx.eventName;
  if (name && Object.prototype.hasOwnProperty.call(COPILOT_HOOK_EVENTS, name)) name = COPILOT_HOOK_EVENTS[name]!;
  if (typeof name !== 'string' || !Object.prototype.hasOwnProperty.call(EVENT_FOR_HOOK, name)) return undefined;
  const ev = EVENT_FOR_HOOK[name as SupportedHookEvent];
  const cwd = str(p.cwd);
  const session = str(p.session_id) ?? str(p.sessionId) ?? (agent !== 'claude' ? fallbackSession(agent, cwd, env) : undefined);
  if (!session) return undefined;
  const out: NormalizedEvent = { v: 1, t: now, agent, ev, session };
  if (cwd) out.cwd = cwd;
  const sub = str(p.agent_id);
  const subType = str(p.agent_type);
  if (sub) out.sub = sub;
  if (sub && subType) out.subType = subType;
  // A bare SubagentStart without an id cannot be tracked; the adapter skips it.
  if (ev === 'tool' || ev === 'tool_done') {
    const tool = str(p.tool_name) ?? str(p.toolName);
    if (tool) out.tool = tool;
    const detail = toolDetail(tool, p.tool_input ?? parseMaybe(p.toolArgs ?? p.tool_args ?? p.toolInput));
    if (detail) out.detail = detail;
  } else if (ev === 'wait') {
    const msg = str(p.message);
    if (msg) out.detail = shorten(msg);
  }
  let role = str(env.BELLWETHER_ROLE) ?? str(env.HERDR_ROLE);
  // `claude --agent <name>` reports the agent's name at session start; the adapter maps it to a role.
  if (!role && ev === 'start' && !sub && subType) role = subType;
  if (role) out.role = role.trim();
  return out;
}

export interface EmitArgs {
  [flag: string]: string | undefined;
}

/** Parse `--flag value` pairs (no positionals). Unknown flags are kept so callers can reject them. */
export function parseFlags(args: string[]): EmitArgs {
  const out: EmitArgs = {};
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!;
    if (!a.startsWith('--')) continue;
    const next = args[i + 1];
    if (next !== undefined && !next.startsWith('--')) {
      out[a.slice(2)] = next;
      i++;
    } else out[a.slice(2)] = '';
  }
  return out;
}

/**
 * `bellwether emit` for tools that are not Claude Code or Copilot: build one event from
 * flags. `--ev` is required; the session defaults to $BELLWETHER_SESSION or one per
 * agent and folder. Throws with a usable message on bad input.
 */
export function buildEmitEvent(flags: EmitArgs, env: Record<string, string | undefined> = process.env, cwd = process.cwd(), now = Date.now()): NormalizedEvent {
  const ev = flags.ev as EventKind | undefined;
  if (!ev || !EVENT_KINDS.includes(ev)) throw new Error(`--ev must be one of: ${EVENT_KINDS.join(', ')}`);
  const agent = str(flags.agent) ?? 'generic';
  const dir = str(flags.cwd) ?? cwd;
  const out: NormalizedEvent = { v: 1, t: now, agent, ev, session: str(flags.session) ?? fallbackSession(agent, dir, env), cwd: dir };
  const role = str(flags.role) ?? str(env.BELLWETHER_ROLE);
  if (role) out.role = role.trim();
  for (const [flag, key] of [['sub', 'sub'], ['sub-type', 'subType'], ['tool', 'tool']] as const) {
    const v = str(flags[flag]);
    if (v) out[key] = v;
  }
  const detail = str(flags.detail);
  if (detail) out.detail = shorten(detail);
  if ((ev === 'sub_start' || ev === 'sub_stop') && !out.sub) throw new Error(`--sub is required for ${ev}`);
  return out;
}

/** `$BELLWETHER_EVENTS`, else `<home>/.bellwether/events.jsonl`. */
export function eventsFile(env: Record<string, string | undefined> = process.env, home = homedir()): string {
  return str(env.BELLWETHER_EVENTS) ?? join(home, '.bellwether', 'events.jsonl');
}

/** Append one line, first moving a file over `ROTATE_BYTES` to `<file>.1` (replacing any older one). */
export function appendEvent(file: string, line: NormalizedEvent, rotateBytes = ROTATE_BYTES): void {
  mkdirSync(dirname(file), { recursive: true });
  try {
    if (statSync(file).size > rotateBytes) renameSync(file, file + '.1');
  } catch {
    // No file yet, or a concurrent writer already rotated it.
  }
  appendFileSync(file, JSON.stringify(line) + '\n');
}

export interface EventHookDeps {
  stdin: string;
  env: Record<string, string | undefined>;
  agent?: string;
  eventName?: string;
  home?: string;
  now?: number;
  rotateBytes?: number;
}

/** Hook body. Never throws: a broken hook must not slow or fail the agent. Returns the line it wrote. */
export function runEventHook(deps: EventHookDeps): NormalizedEvent | undefined {
  try {
    const raw: unknown = JSON.parse(deps.stdin);
    const line = normalizeHookPayload(raw, { now: deps.now, env: deps.env, agent: deps.agent, eventName: deps.eventName });
    if (!line) return undefined;
    appendEvent(eventsFile(deps.env, deps.home), line, deps.rotateBytes);
    return line;
  } catch {
    return undefined;
  }
}
