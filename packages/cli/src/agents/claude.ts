import { join } from 'node:path';
import { asArray, asObject, mentions, type Json, type JsonObject } from '../json-file.js';
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
    const hooks = asObject(settings.hooks);
    if (!Array.isArray(hooks.SessionStart)) return settings;
    const groups: Json[] = [];
    let changed = false;
    for (const group of hooks.SessionStart) {
      const g = asObject(group);
      if (!Array.isArray(g.hooks)) {
        if (mentions(group, HOOK_BASENAME)) changed = true;
        else groups.push(group);
        continue;
      }
      const inner = g.hooks.filter((h) => !mentions(h, HOOK_BASENAME));
      if (inner.length === g.hooks.length) groups.push(group);
      else {
        changed = true;
        if (inner.length > 0) groups.push({ ...g, hooks: inner });
      }
    }
    if (!changed) return settings;
    return pruneEvent(settings, hooks, groups);
  },
};

export function pruneEvent(settings: JsonObject, hooks: JsonObject, entries: Json[]): JsonObject {
  const nextHooks: JsonObject = { ...hooks, SessionStart: entries };
  if (entries.length === 0) delete nextHooks.SessionStart;
  const next: JsonObject = { ...settings, hooks: nextHooks };
  if (Object.keys(nextHooks).length === 0) delete next.hooks;
  return next;
}
