# Bellwether plugin for Claude Code

Shows your Claude Code sessions in the [Bellwether](../../README.md) pixel overlay without
Herdr. Works for the Claude Code CLI and for local Code sessions in the Claude desktop app:
every session is an agent, every working directory a party, and subagents appear as extra
agents while they run.

## Install

```sh
npm i -g @pelotto-tech/bellwether@latest
```

Then, inside Claude Code:

```
/plugin marketplace add Pelotto-Technologies/bellwether
/plugin install bellwether@bellwether
```

Start the overlay:

```sh
bellwether overlay --hooks
```

Or set `source = "hooks"` in `bellwether.toml` (or `BELLWETHER_SOURCE=hooks`) and run
`bellwether overlay` / `bellwether run` as usual.

## What it does

The plugin registers `bellwether hook event` on `SessionStart`, `UserPromptSubmit`,
`PreToolUse`, `PostToolUse`, `Notification`, `Stop`, `SubagentStart`, `SubagentStop` and
`SessionEnd`. Each call appends one short JSON line to `~/.bellwether/events.jsonl` (override
with `BELLWETHER_EVENTS`; the file rotates to `events.jsonl.1` at 5 MB). The hook makes no
network calls, starts no processes and always exits 0, so it cannot slow or fail a session.

Stored per event: session id, working directory, event kind, and a short label (tool name and
file or command, or the notification text). Prompt text is never stored.

Set `BELLWETHER_ROLE` (for example `reviewer`) in a session's environment to give it a role;
otherwise it is a generic agent, or an orchestrator while it runs subagents.

## Limits

- Only sessions on this machine are visible. Cloud sessions run elsewhere and cannot write to
  this file.
- Sessions started before the plugin was installed appear on their next hook event.
- A session shows as done after `Stop` and disappears on `SessionEnd`, or after two hours
  without activity if it was killed.

## Not using the plugin system?

`bellwether install --events` writes the same hooks into `~/.claude/settings.json` (and
Copilot CLI's `~/.copilot/settings.json`). Use that or the plugin, not both. Other tools can feed
the same file with `bellwether emit`; see [`docs/EVENTS.md`](../../docs/EVENTS.md).
