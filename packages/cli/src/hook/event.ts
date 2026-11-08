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
}

/** Map one hook payload to its normalized line, or undefined for events and payloads we do not track. */
export function normalizeHookPayload(raw: unknown, ctx: EventContext = {}): NormalizedEvent | undefined {
  const p = obj(raw);
  if (!p) return undefined;
  const name = p.hook_event_name;
  if (typeof name !== 'string' || !Object.prototype.hasOwnProperty.call(EVENT_FOR_HOOK, name)) return undefined;
  const ev = EVENT_FOR_HOOK[name as SupportedHookEvent];
  const session = str(p.session_id);
  if (!session) return undefined;
  const env = ctx.env ?? process.env;
  const out: NormalizedEvent = {
    v: 1,
    t: ctx.now ?? Date.now(),
    agent: ctx.agent ?? 'claude',
    ev,
    session,
  };
  const cwd = str(p.cwd);
  if (cwd) out.cwd = cwd;
  const sub = str(p.agent_id);
  const subType = str(p.agent_type);
  if (sub) out.sub = sub;
  if (sub && subType) out.subType = subType;
  // A bare SubagentStart without an id cannot be tracked; the adapter skips it.
  if (ev === 'tool' || ev === 'tool_done') {
    const tool = str(p.tool_name);
    if (tool) out.tool = tool;
    const detail = toolDetail(tool, p.tool_input);
    if (detail) out.detail = detail;
  } else if (ev === 'wait') {
    const msg = str(p.message);
    if (msg) out.detail = shorten(msg);
  }
  const role = str(env.BELLWETHER_ROLE) ?? str(env.HERDR_ROLE);
  if (role) out.role = role.trim();
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
  home?: string;
  now?: number;
  rotateBytes?: number;
}

/** Hook body. Never throws: a broken hook must not slow or fail the agent. Returns the line it wrote. */
export function runEventHook(deps: EventHookDeps): NormalizedEvent | undefined {
  try {
    const raw: unknown = JSON.parse(deps.stdin);
    const line = normalizeHookPayload(raw, { now: deps.now, env: deps.env, agent: deps.agent });
    if (!line) return undefined;
    appendEvent(eventsFile(deps.env, deps.home), line, deps.rotateBytes);
    return line;
  } catch {
    return undefined;
  }
}
