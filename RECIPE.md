# Bellwether install recipe

For a coding agent. The user said something like "Install Bellwether from
https://github.com/Pelotto-Technologies/bellwether, read RECIPE.md first". Follow this sheet;
do not improvise beyond it. Bellwether shows each agent session as a tiny pixel character in a
desktop overlay. Herdr is optional and not needed.

## Prerequisites

- Node 20 or newer and npm on PATH (`node --version`).
- At least one agent that has been started once, so its config folder exists: Claude Code
  (`~/.claude` or `$CLAUDE_CONFIG_DIR`) or GitHub Copilot CLI (`~/.copilot` or `$COPILOT_HOME`).
  `bellwether agents` lists what it found. A missing config folder is skipped, not created.
- A desktop session for the overlay. The first `bellwether overlay` downloads Electron
  (about 100 MB) into `~/.bellwether/electron`.

## Install

```sh
npm i -g @pelotto-tech/bellwether
bellwether agents              # confirm your agent is listed
```

Then pick exactly one way to feed events. Never both, or every event is written twice.

**Hooks (default).** Writes the hooks into the agent's settings file:

```sh
bellwether install --events
```

Limit it to one agent with `--agent claude` or `--agent copilot`.

**Claude Code plugin (instead of hooks, Claude Code only).** Ask the user to run these inside
Claude Code, because they are slash commands:

```
/plugin marketplace add Pelotto-Technologies/bellwether
/plugin install bellwether@bellwether
```

Choose the plugin only if the user prefers plugins; otherwise use hooks. If one was used
before, run `bellwether uninstall` (hooks) or `/plugin uninstall bellwether@bellwether`
(plugin) before switching.

Using Herdr as well? Nothing extra is needed: `bellwether install --events` includes the
Herdr role and chat hooks, and the overlay picks Herdr automatically when it is running.

## Run it

```sh
bellwether overlay     # desktop overlay with a tray menu; leave it running
```

No desktop (remote shell, OBS)? `bellwether run` serves the same overlay at
<http://127.0.0.1:7341/>.

## Verify

1. Start a new agent session (or restart the existing one; hooks load at session start) in
   any project folder.
2. Within a few seconds a small character appears along the bottom of the screen with a
   nameplate for that folder. It walks while the agent works and waves when it finishes.
3. If nothing appears: check that `~/.bellwether/events.jsonl` exists and grows when the agent
   uses a tool (`tail -n 3 ~/.bellwether/events.jsonl`), and that exactly one of hooks or plugin
   is installed. Sessions on other machines and cloud sessions are not visible.

To check without any agent: `bellwether emit --ev start --session test --cwd .` then
`bellwether emit --ev end --session test`.

## Uninstall

```sh
bellwether uninstall                 # removes only what `install` wrote
npm uninstall -g @pelotto-tech/bellwether
```

For the plugin: `/plugin uninstall bellwether@bellwether` inside Claude Code. Optionally delete
`~/.bellwether` (events file and the cached Electron).

## What it writes on this machine

- Agent config folders (`~/.claude`, `~/.copilot` or their env overrides): a `bellwether` skill
  at `skills/bellwether/SKILL.md`, a small role hook script, and entries in `settings.json`
  (`SessionStart` and `PreToolUse` for the role and chat hooks, plus the activity hook events
  with `--events`). Existing entries are left alone and re-running changes nothing.
- `~/.bellwether/events.jsonl` (or `$BELLWETHER_EVENTS`): one short JSON line per event, rotated
  at 5 MB. Each line holds a session id, working directory, event kind and a short label such
  as a tool name and file. It never holds prompt text.
- `~/.bellwether/electron`: the Electron runtime, installed once by `bellwether overlay`.
- Nothing is sent over the network by the hooks. The overlay's page and adapter listen on
  `127.0.0.1:7341` only.
