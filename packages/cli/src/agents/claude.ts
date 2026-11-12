import { join } from 'node:path';
import { asArray, asObject, mentions, type Json, type JsonObject } from '../json-file.js';
import { SUPPORTED_HOOK_EVENTS } from '../hook/event.js';
import { EVENT_MARKER, SAY_MARKER } from '../hook/say.js';
import { decodeWrap, encodeWrap, STATUSLINE_MARKER } from '../hook/statusline.js';
import { HOOK_BASENAME } from '../skill.js';
import { posixPath } from './paths.js';
import type { AgentTarget } from './types.js';

/**
 * Claude Code: `~/.claude/settings.json` (or `$CLAUDE_CONFIG_DIR`), nested hook shape:
 * `hooks.SessionStart[] = { matcher, hooks: [{ type: "command", command }] }`.
 */
export const claude: AgentTarget = {
  id: 'claude',
  displayName: 'Claude Code',
  binary: 'claude',

  configDir(ctx) {
    return ctx.env.CLAUDE_CONFIG_DIR || join(ctx.home, '.claude');
  },

  addSessionStartHook(settings, hook) {
    const hooks = asObject(settings.hooks);
    const groups = asArray(hooks.SessionStart);
    const entry: JsonObject = {
      matcher: 'startup|resume|clear|compact',
      hooks: [{ type: 'command', command: `sh "${posixPath(hook.sh)}"` }],
    };
    return { ...settings, hooks: { ...hooks, SessionStart: [...groups, entry] } };
  },

  removeSessionStartHook(settings) {
    return removeNested(settings, 'SessionStart', HOOK_BASENAME);
  },

  addToolHook(settings, hook) {
    const hooks = asObject(settings.hooks);
    const groups = asArray(hooks.PreToolUse);
    const entry: JsonObject = { matcher: 'Bash|PowerShell', hooks: [{ type: 'command', command: hook.posix, timeout: 10 }] };
    return { ...settings, hooks: { ...hooks, PreToolUse: [...groups, entry] } };
  },

  removeToolHook(settings) {
    return removeNested(settings, 'PreToolUse', SAY_MARKER);
  },

  addEventHooks(settings, command) {
    const hooks = asObject(settings.hooks);
    const next: JsonObject = { ...hooks };
    for (const name of SUPPORTED_HOOK_EVENTS) {
      const entry: JsonObject = { hooks: [{ type: 'command', command: command('claude', name).posix, timeout: 5 }] };
      if (name === 'PreToolUse' || name === 'PostToolUse') entry.matcher = '*';
      next[name] = [...asArray(hooks[name]), entry];
    }
    return { ...settings, hooks: next };
  },

  removeEventHooks(settings) {
    let out = settings;
    for (const name of Object.keys(asObject(settings.hooks))) out = removeNested(out, name, EVENT_MARKER);
    return out;
  },

  // Claude Code allows one `statusLine`: `{ type: "command", command, padding?, refreshInterval? }`.
  // An existing one is kept alive by wrapping: its command rides in `--wrap`, and its other keys stay.
  addStatusLine(settings, command) {
    const existing = settings.statusLine;
    if (existing === undefined) return { ...settings, statusLine: { type: 'command', command: command().posix } satisfies JsonObject };
    const prev = asObject(existing);
    if (typeof prev.command !== 'string' || prev.command === '') return settings; // not something we can wrap; leave it be
    const wrapped: JsonObject = { ...prev, command: command(encodeWrap(prev.command)).posix };
    return { ...settings, statusLine: wrapped };
  },

  removeStatusLine(settings) {
    const line = asObject(settings.statusLine);
    if (typeof line.command !== 'string' || !line.command.includes(STATUSLINE_MARKER)) return settings;
    const token = /--wrap\s+([A-Za-z0-9_-]+)/.exec(line.command)?.[1];
    const original = token ? decodeWrap(token) : undefined;
    if (original) {
      const restored: JsonObject = { ...line, command: original };
      return { ...settings, statusLine: restored };
    }
    const { statusLine: _ours, ...rest } = settings;
    return rest;
  },
};

/** Drop every hook mentioning `marker` from a nested `hooks[event]` group list. */
function removeNested(settings: JsonObject, event: string, marker: string): JsonObject {
  const hooks = asObject(settings.hooks);
  const list = hooks[event];
  if (!Array.isArray(list)) return settings;
  const groups: Json[] = [];
  let changed = false;
  for (const group of list) {
    const g = asObject(group);
    if (!Array.isArray(g.hooks)) {
      if (mentions(group, marker)) changed = true;
      else groups.push(group);
      continue;
    }
    const inner = g.hooks.filter((h) => !mentions(h, marker));
    if (inner.length === g.hooks.length) groups.push(group);
    else {
      changed = true;
      if (inner.length > 0) groups.push({ ...g, hooks: inner });
    }
  }
  if (!changed) return settings;
  return pruneEvent(settings, hooks, groups, event);
}

export function pruneEvent(settings: JsonObject, hooks: JsonObject, entries: Json[], event = 'SessionStart'): JsonObject {
  const nextHooks: JsonObject = { ...hooks, [event]: entries };
  if (entries.length === 0) delete nextHooks[event];
  const next: JsonObject = { ...settings, hooks: nextHooks };
  if (Object.keys(nextHooks).length === 0) delete next.hooks;
  return next;
}
