import { createHash } from 'node:crypto';
import { bubbleText, parseSends } from './sends.js';

/** Marker on the installed pre-tool hook command, so uninstall finds only ours. */
export const SAY_MARKER = 'bellwether-say';
/** Marker on installed activity-event hook commands (`install --events`). */
export const EVENT_MARKER = 'bellwether-event';
/** How long a message bubble token lives in Herdr. */
export const SAY_TTL_MS = 15000;

type Obj = Record<string, unknown>;

function obj(v: unknown): Obj | undefined {
  return v !== null && typeof v === 'object' && !Array.isArray(v) ? (v as Obj) : undefined;
}

function parseMaybe(v: unknown): unknown {
  if (typeof v !== 'string') return v;
  try {
    return JSON.parse(v);
  } catch {
    return undefined;
  }
}

/**
 * The shell command in a pre-tool hook payload. Claude Code sends
 * `{tool_name, tool_input: {command}}`; Copilot CLI sends `{toolName, toolArgs}` with
 * `toolArgs` a JSON string (or object) holding `command`. Anything else: undefined.
 */
export function commandFromHookInput(raw: string): string | undefined {
  const root = obj(parseMaybe(raw.trim()));
  if (!root) return undefined;
  for (const key of ['tool_input', 'toolInput', 'toolArgs', 'tool_args', 'arguments', 'input']) {
    const args = obj(parseMaybe(root[key]));
    if (!args) continue;
    for (const k of ['command', 'cmd', 'script']) if (typeof args[k] === 'string') return args[k] as string;
  }
  return typeof root.command === 'string' ? root.command : undefined;
}

/**
 * `herdr` arguments that tag `paneId` with the message the command sends, or undefined
 * when the command sends none. `say_id` changes with every message (even a repeated
 * one) but not when two hook entries fire for the same command.
 */
export function sayArgs(command: string, paneId: string): string[] | undefined {
  const sends = parseSends(command);
  const last = sends[sends.length - 1];
  if (!last) return undefined;
  const text = bubbleText(last.text, 72);
  const minute = Math.floor(Date.now() / 60000);
  const id = createHash('sha1').update(`${paneId}|${command}|${minute}`).digest('hex').slice(0, 10);
  return [
    'pane', 'report-metadata', paneId,
    '--source', 'bellwether',
    '--token', `say=${text}`,
    '--token', `say_to=${last.target}`,
    '--token', `say_id=${id}`,
    '--ttl-ms', String(SAY_TTL_MS),
  ];
}

export interface SayHookDeps {
  stdin: string;
  env: Record<string, string | undefined>;
  run: (bin: string, args: string[]) => void;
}

/** Pre-tool hook body. Never blocks the tool: every failure is swallowed. Returns what it ran. */
export function runSayHook({ stdin, env, run }: SayHookDeps): string[] | undefined {
  if (env.HERDR_ENV !== '1' || !env.HERDR_PANE_ID) return undefined;
  // Fast path: most tool calls have nothing to do with herdr.
  if (!/herdr/i.test(stdin)) return undefined;
  const command = commandFromHookInput(stdin);
  if (!command) return undefined;
  const args = sayArgs(command, env.HERDR_PANE_ID);
  if (!args) return undefined;
  try {
    run(env.HERDR_BIN_PATH || 'herdr', args);
  } catch {
    // Bubbles are decoration; never fail the agent's tool call.
  }
  return args;
}
