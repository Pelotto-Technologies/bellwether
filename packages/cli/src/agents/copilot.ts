import { join } from 'node:path';
import { asArray, asObject, mentions, type JsonObject } from '../json-file.js';
import { COPILOT_HOOK_EVENTS } from '../hook/event.js';
import { EVENT_MARKER, SAY_MARKER } from '../hook/say.js';
import { HOOK_BASENAME } from '../skill.js';
import { pruneEvent } from './claude.js';
import { posixPath } from './paths.js';
import type { AgentTarget } from './types.js';

/**
 * GitHub Copilot CLI: `~/.copilot/settings.json` (or `$COPILOT_HOME`), flat hook shape:
 * `hooks.SessionStart[] = { type: "command", bash, powershell, timeoutSec }`.
 * Same file and event Herdr's own `herdr integration install copilot` edits.
 */
export const copilot: AgentTarget = {
  id: 'copilot',
  displayName: 'GitHub Copilot CLI',
  binary: 'copilot',

  configDir(ctx) {
    return ctx.env.COPILOT_HOME || join(ctx.home, '.copilot');
  },

  addSessionStartHook(settings, hook) {
    const hooks = asObject(settings.hooks);
    const entries = asArray(hooks.SessionStart);
    const entry: JsonObject = {
      type: 'command',
      bash: `sh "${posixPath(hook.sh)}"`,
      powershell: `& "${hook.ps1}"`,
      timeoutSec: 10,
    };
    return { ...settings, hooks: { ...hooks, SessionStart: [...entries, entry] } };
  },

  removeSessionStartHook(settings) {
    const hooks = asObject(settings.hooks);
    if (!Array.isArray(hooks.SessionStart)) return settings;
    const kept = hooks.SessionStart.filter((e) => !mentions(e, HOOK_BASENAME));
    if (kept.length === hooks.SessionStart.length) return settings;
    return pruneEvent(settings, hooks, kept);
  },

  addToolHook(settings, hook) {
    const hooks = asObject(settings.hooks);
    const entries = asArray(hooks.PreToolUse);
    const entry: JsonObject = { type: 'command', bash: hook.posix, powershell: hook.powershell, timeoutSec: 10 };
    return { ...settings, hooks: { ...hooks, PreToolUse: [...entries, entry] } };
  },

  removeToolHook(settings) {
    const hooks = asObject(settings.hooks);
    if (!Array.isArray(hooks.PreToolUse)) return settings;
    const kept = hooks.PreToolUse.filter((e) => !mentions(e, SAY_MARKER));
    if (kept.length === hooks.PreToolUse.length) return settings;
    return pruneEvent(settings, hooks, kept, 'PreToolUse');
  },

  addEventHooks(settings, command) {
    const hooks = asObject(settings.hooks);
    const next: JsonObject = { ...hooks };
    for (const name of Object.keys(COPILOT_HOOK_EVENTS)) {
      const c = command('copilot', name);
      next[name] = [...asArray(hooks[name]), { type: 'command', bash: c.posix, powershell: c.powershell, timeoutSec: 5 }];
    }
    return { ...settings, hooks: next };
  },

  removeEventHooks(settings) {
    let out = settings;
    for (const [name, list] of Object.entries(asObject(settings.hooks))) {
      if (!Array.isArray(list)) continue;
      const kept = list.filter((e) => !mentions(e, EVENT_MARKER));
      if (kept.length !== list.length) out = pruneEvent(out, asObject(out.hooks), kept, name);
    }
    return out;
  },
};
