# Bellwether

A Stream-Avatars-style pixel overlay for [Herdr](https://herdr.dev). Each Herdr
worktree workspace becomes a party of pixel characters that walk along the bottom of
your screen. One of them carries a light that shows the party's status (working,
done, blocked). A map mode shows every party as a glow on a pixel map; zoom into one to
see its members and what they are doing.

Reads the Herdr TUI socket API. Display only in v1, with interactive hooks stubbed.
Theme packs are swappable; the core knows roles (architect, implementer, reviewer,
...), not characters.

**Status:** early. The installer (`packages/cli`) exists; the rest is planned. The plan is in [docs/PLAN.md](docs/PLAN.md).

## Layout (planned)

```
packages/adapter    Herdr client, world model, WebSocket + recorder/replayer (TypeScript)
packages/renderer   PixiJS scene: strip mode, map mode, theme loader (web page)
packages/shell      Electron overlay window + tray
packages/cli        bellwether install | uninstall | run | record | replay
themes/neutral      ships with the repo
themes/<private>    your own skins, gitignored
docs/               plan and research artifacts
```

## Data sources

The adapter reads from a mock source (default) or live Herdr. Pick one in
`bellwether.toml` (gitignored) or with `BELLWETHER_SOURCE=mock|live`:

```toml
source = "live"
[herdr]
sessions = "all"        # every running session; or ["default", "overlay-dev"]
# socket = "..."        # explicit socket or pipe path
```

`pnpm --filter @bellwether/adapter build && node packages/adapter/dist/bin.js --live --session overlay-dev`
prints deltas as JSON lines.

## Research artifacts

`docs/research/` holds the verified protocol details this project rests on: the Herdr
TUI API schema (protocol 22), herdr-core's OpenRPC schema, the raw named-pipe probe
scripts, and a captured `working` → `idle` event log from a real agent pane.

## Supported agents

Claude Code and GitHub Copilot CLI are first-class targets for the installer. The
adapter itself is agent-agnostic: it reads Herdr's `agent` field (`claude`, `copilot`,
`codex`, ...) and draws every agent the same way, so anything Herdr recognizes shows up.
Only the installer (`packages/cli`) knows agents apart.

### Setup

1. Let Herdr detect each agent and resume its sessions:

   ```sh
   herdr integration install claude
   herdr integration install copilot
   ```

2. Install Bellwether's role tagging for every agent it finds:

   ```sh
   bellwether agents       # what is on PATH and which config dirs exist
   bellwether install      # all present agents
   bellwether install --agent copilot   # or just one
   ```

   For each agent whose config dir exists, this writes:

   | | Claude Code | GitHub Copilot CLI |
   |---|---|---|
   | Config dir | `~/.claude` or `$CLAUDE_CONFIG_DIR` | `~/.copilot` or `$COPILOT_HOME` |
   | Skill pack | `skills/bellwether/SKILL.md` | `skills/bellwether/SKILL.md` |
   | Role hook | `hooks/bellwether-role.sh` (+ `.ps1`) | `hooks/bellwether-role.sh` (+ `.ps1`) |
   | `settings.json` | `SessionStart` group with a `command` hook | flat `SessionStart` entry with `bash` and `powershell` |

   Herdr's own entries and anything you added stay untouched. Running it twice changes
   nothing. A missing config dir is skipped, not created: start the agent once first.

3. Give panes a role. Either split a pane with `HERDR_ROLE=<role>` in its environment
   (the hook tags it on session start), or let the agent follow the skill pack and tag
   itself. Roles: `orchestrator`, `coordinator`, `architect`, `implementer`, `reviewer`,
   `researcher`, `writer`, `ops`, `generic`.

`bellwether uninstall` removes only what `install` wrote.

Older Copilot CLI builds without skills support ignore the skill pack; the hook still
works. Paste the contents of `SKILL.md` into `AGENTS.md` or
`.github/copilot-instructions.md` if you want the instructions there.

## License

Not chosen yet. Herdr is Apache 2.0.
