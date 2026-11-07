# Bellwether

A Stream-Avatars-style pixel overlay for [Herdr](https://herdr.dev). Each Herdr
worktree workspace becomes a party of pixel characters that walk along the bottom of
your screen. One of them carries a light that shows the party's status (working,
done, blocked). A map mode shows every party as a glow on a pixel map; zoom into one to
see its members and what they are doing.

Reads the Herdr TUI socket API. Display only in v1, with interactive hooks stubbed.
Theme packs are swappable; the core knows roles (architect, implementer, reviewer,
...), not characters.

**Status:** MVP. Strip mode runs on mock agents or live Herdr (`--live`); the installer lives in `packages/cli`. Map mode is in; the Electron shell is next. The plan is in [docs/PLAN.md](docs/PLAN.md).

## Run it

Needs Node 20+ and pnpm (`corepack enable` gives you the pinned version).

```sh
pnpm install
pnpm mock        # build, then serve mock agents + the overlay on one port
```

Open <http://127.0.0.1:7341/>. Parties of pixel agents walk along the bottom of the
window; the party label and the beacon's light show the rolled-up status (green
working, yellow done, red pulsing blocked, white idle, grey unknown). Blocked members
stop and hop, and speech bubbles show `say` lines.

For development with hot reload:

```sh
pnpm dev         # adapter mock server on :7341 and Vite on :5173
```

Open <http://127.0.0.1:5173/>. If the adapter is not reachable the page falls back to an
in-browser mock and says so in the corner chip.

Page options (query string):

| Option | Effect |
|---|---|
| `?transparent` | No backdrop or chip. Use this for an OBS browser source. |
| `?pack=aesir` | Skin pack: `neutral` (Workshop Crew, default), `aesir`, `wayfarers`, or a private folder under `themes/`. Overrides `pack` in `bellwether.toml`. |
| `?scale=4` | Pixel scale, 1 to 6 (default 3). |
| `?source=mock` | Skip the adapter and run the mock in the browser. |
| `?ws=ws://host:port/deltas` | Connect to a specific adapter. |

Characters come from the skin pack's 24x32 sprite sheets: each role has its own sheet,
members walk while working, raise a hand when blocked, wave when done, talk while a
speech bubble is up, and blink when idle. The beacon's status light and each cloak are
tinted through the sheet's masks, and bubbles and party nameplates use the pack's UI
pieces. A pack without `art.json` falls back to procedural figures from `theme.json`.

Pick a pack with `pack = "aesir"` in `bellwether.toml`, `--pack aesir` or
`BELLWETHER_PACK=aesir` on the adapter (it serves the choice as `/config.json`), or
`?pack=` in the URL. Unknown names fall back to `neutral`.

### Map mode

`?mode=map` (or press `m` to toggle with strip mode) shows a pixel world. Each repo is a
settlement placed by hashing its path into a grid, so it stays put between runs. Each
party camps beside its repo's settlement, with a glow in its rolled-up status colour
(green working, yellow done, red pulsing blocked). Members wander around the camp;
blocked ones stand still. When a member speaks (a `say` token, or an inferred hand-off
from a teammate who just finished) it walks over to a teammate, or to a party camped at
the same settlement, and the speech bubble shows.

- Click a glow, or a dot on the minimap in the corner, to zoom into that party. A panel
  lists its members with role, agent, status and their latest line. Esc, the panel's
  close button, or clicking empty ground zooms back out.
- The pack's map tileset and props (settlements, camps, campfires, glow) are used; pick
  the pack as above.

Layout, terrain, camera, chatter and wandering are pure modules under
`packages/renderer/src/map/` with tests; `src/pixi/map.ts` is the thin Pixi scene.

To watch your real Herdr agents instead, run the adapter against the live socket:

```sh
pnpm build
node packages/adapter/dist/bin.js --live --all --serve packages/renderer/dist
```

Adapter flags (`--help` for all): `--live` / `--mock` / `--replay <file.jsonl>`,
`--session <name>` or `--all`, `--socket <path>`, `--record <file.jsonl>` (add `--scrub`, or `scrub = true` in `bellwether.toml`, to hash repo, branch and workspace labels and strip `say` text and pane titles), `--scrub-file <in.jsonl> <out.jsonl>`, `--print`,
`--port`, `--serve <dir>`, `--pack <name>`. `source = "live"` in `bellwether.toml` or
`BELLWETHER_SOURCE=live` sets the default.

Guides: [using the page in OBS](docs/obs.md), [writing a skin pack](docs/themes.md).

Checks, the same ones CI runs:

```sh
pnpm typecheck && pnpm test && pnpm build
```

## Layout

```
packages/adapter    world model, mock source, WebSocket server, recorder/replayer; Herdr client next
packages/renderer   PixiJS strip and map modes and the theme loader (web page)
packages/shell      Electron overlay window + tray (planned)
packages/cli        bellwether install | uninstall (run | record | replay planned)
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

Apache License 2.0, the same as Herdr. Copyright 2026 Pelotto Technologies. See
[LICENSE](LICENSE). The public skin packs (`neutral`, `aesir`, `wayfarers`) are original
art under the same license.

Contributions: see [CONTRIBUTING.md](CONTRIBUTING.md).
