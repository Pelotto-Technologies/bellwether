<p align="center"><img src="docs/brand/logo.png" alt="Bellwether" width="420"></p>

<p align="center">
  <b>Your AI coding agents, as a party of tiny pixel characters.</b><br>
  A desktop and stream overlay for <a href="https://herdr.dev">Herdr</a>.
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/@pelotto-tech/bellwether"><img alt="npm" src="https://img.shields.io/npm/v/@pelotto-tech/bellwether?color=3ddc84"></a>
  <a href="https://github.com/Pelotto-Technologies/bellwether/actions/workflows/ci.yml"><img alt="CI" src="https://github.com/Pelotto-Technologies/bellwether/actions/workflows/ci.yml/badge.svg"></a>
  <a href="LICENSE"><img alt="License: Apache-2.0" src="https://img.shields.io/badge/license-Apache--2.0-blue"></a>
</p>

![Agents arriving, handing off work and getting unblocked on the strip](docs/images/strip-story.gif)

You run a handful of agents in Herdr: an orchestrator, a few implementers in their own
worktrees, a reviewer. Bellwether turns each of them into a little character walking along
the bottom of your screen, grouped into parties by workspace. At a glance you can see who is
working, who is done, who is stuck waiting on you, and who just told whom to do what.

It works with Claude Code, GitHub Copilot CLI and anything else Herdr recognizes, and it
comes in four art styles.

- [Quickstart](#quickstart)
- [A tour](#a-tour): reading the strip, sizes, map mode, agents talking, fellowships
- [Skins](#skins): Workshop Crew, Aesir, Wayfarers, Deep Space
- [Giving agents a role](#giving-agents-a-role)
- [Where to show it](#where-to-show-it): desktop, OBS, browser
- [Configuration](#configuration) and [CLI reference](#cli-reference)

## Quickstart

You need Node 20+ and [Herdr](https://herdr.dev) running with at least one agent.

```sh
npm install -g @pelotto-tech/bellwether

bellwether install     # role tags and chat hooks for Claude Code and Copilot CLI
bellwether overlay     # the desktop overlay, with a tray menu
```

That is the whole loop: start agents in Herdr and a party appears for each workspace. The
first `bellwether overlay` downloads Electron into `~/.bellwether/electron` (about 100 MB,
once). Prefer a browser tab or OBS? `bellwether run` serves the same overlay at
<http://127.0.0.1:7341/>.

Want to look before connecting anything? From a checkout, `pnpm install && pnpm mock` serves
fake agents on the same port.

Already installed? After upgrading, run `bellwether install` again so your agents get the
newest hooks (chat bubbles need the one added in 0.1.11).

## A tour

### Reading the strip

![Strip mode with the Aesir skin](docs/images/aesir-strip.png)

- **Each nameplate is a party**: one Herdr workspace, labelled `workspace · branch`. The icon
  on the left is the party's overall status.
- **One member carries a beacon** whose light is the party's status: green working, yellow
  done, pulsing red blocked, white idle, grey unknown. Working members walk, blocked ones
  stop and raise a hand, finished ones wave, idle ones blink.
- **Worktrees get a tint.** When a repo has several parties, each worktree gets its own
  colour on cloaks, nameplate underline and ground tether, so `atlas · auth` and
  `atlas · search` are easy to tell apart.
- **The orchestrator leads.** An `orchestrator` with other agents in its repo walks in front
  carrying a banner striped in every worktree's colour (`★ atlas` above).
- **Speech bubbles** show what agents say, including messages one agent sends another
  (`@implementer Add ranking tests`).

New agents and worktrees arrive with a short spawn animation (skipped when your OS asks for
reduced motion). Double-click a member in a browser tab to jump Herdr to that pane.

### Sizes and labels

Pick a size from the tray menu (Tiny, Compact, Normal, Large), with `scale` in
`bellwether.toml`, or `?scale=1` to `6` in the URL.

| Tiny | Large |
|---|---|
| ![Tiny strip](docs/images/strip-tiny.png) | ![Large strip](docs/images/strip-large.png) |

For a quieter strip, **Icon only** labels drop the nameplates and put a small status icon
under each party's feet (`minimal = true`, or Labels in the tray menu):

![Icon-only labels](docs/images/strip-minimal.png)

### Crowds and multiple monitors

When the strip fills up, parties step back into depth rows (up to four) and keep walking,
passing behind each other instead of standing still. Got more than one monitor? Tick
**Span all monitors** under Monitor in the tray menu: the overlay puts a strip window on the
bottom of every monitor and joins them into one long strip, so parties wander across the
seams. Browser tabs can do the same with `?span=<offset>,<total>` (CSS pixels).

### Map mode

Press **Ctrl+Alt+M** (Cmd+Alt+M on macOS) anywhere, `m` in the page, or pick it in the tray
menu. Every repo becomes a settlement on a pixel world, each party camps beside its repo
with a glow in its status colour, and roads join it all up.

![The whole map](docs/images/map-overview.png)

Click a glow, or an orchestrator, to zoom in. A panel lists every member with role, agent,
status and latest line, and each member has a **close** button that closes its pane in
Herdr after a confirm. Esc, the ✕ or a click on empty ground zooms back out, and the
**Exit map** button returns to the strip.

![Zoomed into a settlement with the detail panel open](docs/images/map-detail.png)

Orchestrators stand at their repo's settlement and **ride a mount** out to each new
worktree they spawn, with a trail back home. Settlements gain a building for every four
agents and camps gain a tent for every two members, with a small pop as each goes up.

![An orchestrator riding out as new worktrees arrive](docs/images/map-story.gif)

### Agents talking to each other

Herdr raises no event when one agent prompts another, so `bellwether install` adds a small
pre-tool hook to Claude Code and Copilot CLI. When an agent runs `herdr agent prompt`,
`herdr pane run` or `herdr pane send-text` into another agent's pane, the hook tags the
sender with the first line of the message and who it is for. The overlay shows it as a
bubble addressed `@<role>`, and in map mode the speaker walks (or rides) over to the
listener. Finished hand-offs between teammates are inferred too.

Too chatty? Hide bubbles from the tray menu, with `bubbles = false`, `?bubbles=0`, or by
pressing `b` in the page.

### Fellowships: orchestrators and worktrees

Parties that share a Herdr session and repo form a **fellowship**. Bellwether works this out
from what Herdr already reports, so agents need no extra instructions. It only needs the
orchestrator's pane to have the `orchestrator` role, and its worktrees to be created in the
same repo (which Herdr's worktree commands do).

## Skins

Skins are theme packs. The core only knows roles (`architect`, `reviewer`, ...); each pack
decides what a role looks like. Pick one in the tray menu, with `pack = "..."` in
`bellwether.toml`, `--pack`, or `?pack=`. All four are original art under Apache-2.0.

Each line-up below shows the nine roles in order: orchestrator, coordinator, architect,
implementer, reviewer, researcher, writer, ops, generic.

### Workshop Crew (`neutral`, default)

A friendly crew of builders, scribes and surveyors in a workshop town.

![Workshop Crew cast](docs/images/neutral-cast.png)
![Workshop Crew strip](docs/images/neutral-strip.png)
![Workshop Crew map](docs/images/neutral-map.png)

### Aesir (`aesir`)

Gods and folk of the northern sagas, with rune-lit staves, longhouses and a fjord-side map.

![Aesir cast](docs/images/aesir-cast.png)
![Aesir strip](docs/images/aesir-strip.png)
![Aesir map](docs/images/aesir-map.png)

### Wayfarers (`wayfarers`)

An original fantasy quest party setting out from a hill country of burrow houses.

![Wayfarers cast](docs/images/wayfarers-cast.png)
![Wayfarers strip](docs/images/wayfarers-strip.png)
![Wayfarers map](docs/images/wayfarers-map.png)

### Deep Space (`scifi`)

A sci-fi survey crew working a glass-domed outpost on a violet-mossed alien world.

![Deep Space cast](docs/images/scifi-cast.png)
![Deep Space strip](docs/images/scifi-strip.png)
![Deep Space map](docs/images/scifi-map.png)

Want your own? Any other folder under `themes/` is a private pack that stays out of git.
See [writing a skin pack](docs/themes.md).

## Giving agents a role

Roles decide which character a pane gets: `orchestrator`, `coordinator`, `architect`,
`implementer`, `reviewer`, `researcher`, `writer`, `ops`, or `generic` (the default). They
are checked in this order:

1. **A pane tag.** The agent runs
   `herdr pane report-metadata "$HERDR_PANE_ID" --source bellwether --token role=reviewer`.
   The skill that `bellwether install` adds teaches agents to do this themselves.
2. **`HERDR_ROLE`.** Start the pane with `HERDR_ROLE=architect`; the installed hook tags it
   when the session starts.
3. **Names.** An agent name (`herdr agent rename`) or pane title containing a role word,
   such as `reviewer-2`. Needs no install.
4. **Orchestration workspaces.** The first pane of a workspace whose label contains
   `Orchestration` is the `orchestrator`.

To have agents tag themselves, add this to `~/.claude/CLAUDE.md` (or `AGENTS.md` /
`.github/copilot-instructions.md` for Copilot):

> When `HERDR_ENV=1`, use the `bellwether` skill at session start: tag your pane with
> your role. Orchestrators tag each pane they spawn with that member's role.

### Start an orchestrator in one command

`bellwether orchestrate` opens a new Herdr workspace named `<folder> Orchestration` in the
current directory, tags pane 1 as the orchestrator and starts your agent in it:

```sh
cd ~/src/myrepo
bellwether orchestrate -- claude
bellwether orchestrate --session overlay-dev --label "api Orchestration" -- copilot --autopilot
```

Options: `--cwd` (default: current directory), `--label` (default `<folder> Orchestration`),
`--role` (default `orchestrator`), `--session` or `--socket` (which Herdr), and `--timeout <ms>`
(how long to wait for the agent, default 60000). Once Herdr detects the agent, the role tag is
applied again and an unnamed agent is named `orchestrator-<repo>`. Leave off the command to
just create the workspace and tag pane 1.

## Where to show it

| You want | Do this |
|---|---|
| A desktop overlay | `bellwether overlay`: transparent, frameless, always on top and click-through, pinned to the bottom of one monitor, or spanning all of them. |
| A stream overlay | `bellwether run`, then an OBS Browser Source on `http://127.0.0.1:7341/?transparent`. See the [OBS guide](docs/obs.md). |
| A browser tab | `bellwether run` and open <http://127.0.0.1:7341/>. |

The desktop overlay's **tray menu** has everything in one place: switch strip and map,
Size, Labels, Chat bubbles, Skin, Monitor (or Span all monitors), Herdr Session (all, or one), and Quit. Choices are
remembered between runs.

### Keyboard

| Key | Where | Does |
|---|---|---|
| Ctrl+Alt+M (Cmd+Alt+M) | anywhere, desktop overlay | toggle strip and map |
| `m` | page | toggle strip and map |
| `b` | page | show or hide chat bubbles |
| Esc | map | zoom back out |
| double-click a member | strip, browser | focus that pane in Herdr |

## Configuration

Put a `bellwether.toml` in the directory you run from (it is gitignored):

```toml
source = "live"          # "live" for real Herdr, "mock" for fake agents
pack = "aesir"           # neutral | aesir | wayfarers | scifi | a private pack
scale = 2                # strip size, 1 to 6 (default 3)
minimal = false          # true: icon-only labels
bubbles = true           # false hides chat bubbles
scrub = false            # true hashes repo/branch names in recordings

[herdr]
sessions = "all"         # or ["default", "overlay-dev"]
# socket = "..."         # explicit socket or pipe path
```

Flags and environment variables override it (`--pack aesir` or `BELLWETHER_PACK=aesir`,
`--session <name>` or `--all`, `BELLWETHER_SOURCE=live`, `--port`), and the tray menu or
page URL overrides those:

| URL option | Effect |
|---|---|
| `?pack=aesir` | Skin pack. |
| `?scale=4` | Pixel scale, 1 to 6. |
| `?mode=map` | Start in map mode. |
| `?minimal` | Icon-only labels (`?minimal=0` for full). |
| `?bubbles=0` | Hide chat bubbles. |
| `?transparent` | No backdrop or status chip, for OBS. |
| `?source=mock` | Mock agents inside the page, no adapter. |
| `?ws=ws://host:port/deltas` | Connect to a specific adapter. |

## CLI reference

| Command | Does |
|---|---|
| `bellwether agents` | Show which coding agents are on PATH and which config dirs exist. |
| `bellwether install [--agent claude\|copilot]` | Add the skill, role hook and message hook to each present agent. Safe to re-run. |
| `bellwether uninstall` | Remove only what `install` wrote. |
| `bellwether overlay` | Open the desktop overlay. |
| `bellwether run` | Serve the overlay from live Herdr on port 7341. |
| `bellwether orchestrate [...] [-- CMD]` | New `<folder> Orchestration` workspace with pane 1 tagged and running CMD. |
| `bellwether record F [--scrub]` | Run live and append deltas to `F`. |
| `bellwether replay F [--speed n]` | Serve the overlay from a recording. |
| `bellwether scrub IN OUT` | Rewrite a recording with repo, branch and label names hashed and speech removed. |

`run`, `record` and `replay` pass adapter flags through; `--help` lists them.

### What `install` writes

| | Claude Code | GitHub Copilot CLI |
|---|---|---|
| Config dir | `~/.claude` or `$CLAUDE_CONFIG_DIR` | `~/.copilot` or `$COPILOT_HOME` |
| Skill | `skills/bellwether/SKILL.md` | `skills/bellwether/SKILL.md` |
| Hooks | role tag on session start, message tag before `herdr` sends | the same |
| `settings.json` | `SessionStart` and `PreToolUse` entries | `SessionStart` and `PreToolUse` entries |

Herdr's own entries and anything you added stay untouched, and running it twice changes
nothing. A missing config dir is skipped, not created, so start each agent once first. Let
Herdr detect your agents with `herdr integration install claude` (or `copilot`). Older
Copilot CLI builds without skills ignore the skill; the hooks still work.

The adapter itself is agent-agnostic: it reads Herdr's `agent` field and draws `claude`,
`copilot`, `codex` and anything else the same way.

### Record and share a replay

```sh
bellwether record session.jsonl --scrub   # hashes repo, branch and labels
bellwether replay session.jsonl --speed 4
```

Never publish a recording without `--scrub`. `pnpm blog` builds a static, adapter-free page
that plays a scrubbed recording, for embedding in a blog post.

## More

- [Writing a skin pack](docs/themes.md)
- [Using Bellwether in OBS](docs/obs.md)
- [Development: running from source, layout, adapter flags](docs/development.md)
- [Architecture and plan](docs/PLAN.md)
- [Contributing](CONTRIBUTING.md) and [security policy](SECURITY.md)

The screenshots and GIFs in this README are rendered from scripted, made-up agent feeds by
`node tools/docshots/shoot.mjs`.

## License

Apache License 2.0, the same as Herdr. Copyright 2026 Pelotto Technologies. See
[LICENSE](LICENSE). The public skin packs (`neutral`, `aesir`, `wayfarers`, `scifi`) are
original art under the same license.
