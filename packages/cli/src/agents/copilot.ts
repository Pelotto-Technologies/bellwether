import { join } from 'node:path';
import { asArray, asObject, mentions, type JsonObject } from '../json-file.js';
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
};
