// The normalized event line `bellwether hook event` appends and HooksSource reads.
// Node-only (path defaults use os/path); the renderer never imports this.
import os from 'node:os';
import path from 'node:path';

export const HOOK_EVENT_VERSION = 1;

export const HOOK_EVENT_KINDS = ['start', 'prompt', 'tool', 'tool_done', 'wait', 'stop', 'end', 'sub_start', 'sub_stop'] as const;
export type HookEventKind = (typeof HOOK_EVENT_KINDS)[number];

/** One line of events.jsonl. Everything but `v`, `t`, `ev` and `session` is optional. */
export interface HookEvent {
  v: 1;
  /** Epoch milliseconds. */
  t: number;
  /** Opaque agent id as the writer chose it; the source never branches on it. */
  agent: string;
  ev: HookEventKind;
  session: string;
  cwd?: string;
  /** Subagent id, for sub_start / sub_stop and tool events fired inside a subagent. */
  sub?: string;
  subType?: string;
  tool?: string;
  /** Short single-line text, at most 72 characters. Never prompt text. */
  detail?: string;
  role?: string;
}

export const MAX_DETAIL = 72;

/** `$BELLWETHER_EVENTS`, else `<home>/.bellwether/events.jsonl`. */
export function defaultEventsFile(env: Record<string, string | undefined> = process.env, home = os.homedir()): string {
  return env.BELLWETHER_EVENTS || path.join(home, '.bellwether', 'events.jsonl');
}

function str(v: unknown): string | undefined {
  return typeof v === 'string' && v ? v : undefined;
}

/** Parse and validate one line; anything malformed or from another version yields undefined. */
export function parseHookEvent(line: string): HookEvent | undefined {
  const s = line.trim();
  if (!s.startsWith('{')) return undefined;
  let raw: Record<string, unknown>;
  try {
    raw = JSON.parse(s) as Record<string, unknown>;
  } catch {
    return undefined;
  }
  if (raw === null || typeof raw !== 'object') return undefined;
  if (raw.v !== HOOK_EVENT_VERSION) return undefined;
  if (typeof raw.t !== 'number' || !Number.isFinite(raw.t)) return undefined;
  if (!(HOOK_EVENT_KINDS as readonly unknown[]).includes(raw.ev)) return undefined;
  const session = str(raw.session);
  if (!session) return undefined;
  const e: HookEvent = { v: 1, t: raw.t, agent: str(raw.agent) ?? 'unknown', ev: raw.ev as HookEventKind, session };
  for (const k of ['cwd', 'sub', 'subType', 'tool', 'role'] as const) {
    const v = str(raw[k]);
    if (v) e[k] = v;
  }
  const detail = str(raw.detail);
  if (detail) e.detail = detail.replace(/\s+/g, ' ').slice(0, MAX_DETAIL);
  return e;
}
