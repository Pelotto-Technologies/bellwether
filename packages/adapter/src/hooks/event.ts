// The normalized event line `bellwether hook event` appends and HooksSource reads.
// Node-only (path defaults use os/path); the renderer never imports this.
import os from 'node:os';
import path from 'node:path';
import { cleanPercent, cleanText, MAX_EFFORT, MAX_MODEL, MAX_NAME, MAX_QUEST } from '../sanitize.js';

export const HOOK_EVENT_VERSION = 1;

export const HOOK_EVENT_KINDS = ['start', 'prompt', 'tool', 'tool_done', 'wait', 'stop', 'end', 'sub_start', 'sub_stop', 'vitals'] as const;
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
  /** `fleet` marks the master of a fleet of projects (with role `orchestrator`); the map stands it at a hub. Anything else is dropped. */
  scope?: 'fleet';
  /** `prompt`, `tool` and `wait`: the session this line is a message to. With a `detail` it draws as a speech bubble to that session's member. */
  to?: string;
  /** Any event: what to call this session (or, with `sub`, this subagent), at most 40 characters. Becomes `Member.name`. */
  label?: string;
  /** `vitals` only: percent of the context window remaining, 0-100. */
  ctx?: number;
  /** `vitals` only: percent of the 5-hour usage quota remaining, 0-100. */
  quota?: number;
  /** `vitals` only: model display name, at most 40 characters. */
  model?: string;
  /** `vitals` only: reasoning effort, at most 16 characters. */
  effort?: string;
  /** `vitals` only: the session's human name, at most 80 characters. */
  name?: string;
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
  const label = cleanText(raw.label, MAX_NAME);
  if (label) e.label = label;
  if (typeof raw.scope === 'string' && raw.scope.trim().toLowerCase() === 'fleet') e.scope = 'fleet';
  const to = str(raw.to);
  if (to && (e.ev === 'prompt' || e.ev === 'tool' || e.ev === 'wait')) e.to = to.slice(0, 200);
  const detail = str(raw.detail);
  if (detail) e.detail = detail.replace(/\s+/g, ' ').slice(0, MAX_DETAIL);
  if (e.ev === 'vitals') {
    // Numbers are clamped; text is stripped of control and bidi characters. Anything invalid is dropped.
    for (const k of ['ctx', 'quota'] as const) {
      const n = typeof raw[k] === 'number' ? cleanPercent(raw[k]) : undefined;
      if (n !== undefined) e[k] = n;
    }
    for (const [k, max] of [['model', MAX_MODEL], ['effort', MAX_EFFORT], ['name', MAX_QUEST]] as const) {
      const v = cleanText(raw[k], max);
      if (v) e[k] = v;
    }
  }
  return e;
}
