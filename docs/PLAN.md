# Bellwether: implementation plan

A Stream-Avatars-style pixel overlay for Herdr. Parties (one per Herdr worktree
workspace) wander along the bottom of the screen; the beacon character's light shows the
party's status; a map mode shows a pixel map with a glow per party and lets you zoom
into one. Display only in v1, with the interactive hooks stubbed. Generic core +
swappable theme packs (a private skin for local use, public packs for publishing) so it
can go on the blog.

Status: research done, verified live on this machine on 2026-11-06. Nothing built yet.

---

## 1. What the research settled

### Herdr has two codebases. The TUI is the one that matters.

| | Herdr TUI (`herdr` 0.9.5) | herdr-core (`hc` 0.1.18) |
|---|---|---|
| What it is | The workspace/tab/pane TUI you use | A newer headless terminal runtime; the Herdr *app* is built on it |
| Depends on the other? | No | No |
| API | NDJSON over local socket, 102 methods, `events.subscribe` | JSON-RPC 2.0 over socket, OpenRPC via `hc schema`, `events.subscribe` |
| Agent status | `idle` `working` `blocked` `done` `unknown` (screen detection or integration reports) | OSC 7501 reports from the program only |

The overlay reads from the **TUI socket API**. Keep the adapter behind an interface so
a herdr-core backend can be added later if you migrate; the concepts map cleanly
(core: terminal with `parent`, `labels`, `status`; TUI: pane with `workspace_id`,
`tokens`, `agent_status`).

### Transport (verified)

- Windows: named pipe `\\.\pipe\<socket path>`. Default session:
  `\\.\pipe\C:\Users\<you>\AppData\Roaming\herdr\herdr.sock`. Named sessions:
  `...\herdr\sessions\<name>\herdr.sock`. Unix: the same path as a Unix socket.
  List live pipes with `[IO.Directory]::GetFiles("\\.\pipe\")` and filter on `herdr`.
- One JSON request per line, response echoes `id`. Node's `net.connect(pipePath)`
  handles both platforms with no native code.
- `session.snapshot` returns workspaces, tabs, panes, layouts, agents in one call.
  `herdr api snapshot` prints the same from the CLI.
- `events.subscribe` with a list of `{type}` entries keeps the connection open and
  streams `{"event": "...", "data": {...}}` lines. Verified payload for a real Claude
  Code agent:

  ```
  {"event":"pane.agent_status_changed","data":{"agent":"claude","agent_status":"working","pane_id":"w1:p3","workspace_id":"w1"}}
  {"event":"pane.agent_status_changed","data":{"agent":"claude","agent_status":"idle","pane_id":"w1:p3","workspace_id":"w1"}}
  ```

### Gotchas that shape the adapter

1. **`pane.agent_status_changed` is per pane.** It requires `pane_id` in the
   subscription entry; the global subscription list rejects it. The adapter must open
   a status subscription for every pane in the snapshot and re-open when
   `pane.created` / `pane.closed` fire. `workspace.updated` likely carries the rollup
   status for the workspace and is global (unverified, test in phase 1).
2. **`events_lost`** closes the subscription when the reader falls behind. Recovery is
   resubscribe + fresh `session.snapshot`. Snapshots and events have no shared
   sequence, so the adapter treats events as invalidation and re-reads.
3. **Herdr does not know a pane's role.** It sees `agent: "claude"` in pane `w1:p3`.
   The party role must be tagged. Best option: the coordinator runs
   `herdr pane report-metadata <pane> --source bellwether --token role=architect` when
   it spawns a member. Tokens appear on `pane.get`/`pane.list`/`agent.list` and the
   `tokens` field of `PaneInfo`. Fallbacks, in order: `agent rename` name (unique per
   server, so it collides across parties), pane `title`, workspace label parsing.
4. **Fake status reports from outside a pane are dropped.** `pane.report_agent` returns
   `ok` but Herdr clears it within a second if the pane is at a shell prompt. So the
   test harness cannot fake agents through Herdr; it replays recorded event logs or
   runs a mock pipe server instead.
5. **No "message" on blocked events.** The event carries `agent_status`, `agent`,
   `display_agent`, `title`, `state_labels`. For bubble text use a token (see 6) or
   `pane.read --source recent --lines 3` on transition to `blocked`.
6. **Agents "talking" is not a Herdr concept.** Two sources, both cheap:
   - *Declared*: an agent or the coordinator sets a short-lived token,
     `--token say="On my way to the repo" --ttl-ms 15000`. The overlay renders it as a
     speech bubble and the TTL clears it. Requires one line in your orchestration
     prompts.
   - *Inferred*: a `working` transition right after another member's turn ends reads
     as "the coordinator hands the implementer a task". Zero prompt changes, lower fidelity.
7. **Worktrees are first class.** `worktree.created` includes the new `workspace` and
   `worktree {branch, path, label, open_workspace_id}`, and `WorkspaceInfo.worktree`
   carries provenance. "The coordinator spins up a worktree" is a real event the overlay can
   animate as a party setting out from the repo's settlement.

### Status to colour (configurable in the theme)

| Herdr status | Meaning | Beacon light |
|---|---|---|
| `working` | agent is running | green |
| `done` | finished, you have not looked yet | yellow |
| `blocked` | needs input, approval, decision | red, pulsing, member waves |
| `idle` | ready, seen | dim white |
| `unknown` | agent present, unclassified | grey |

Party rollup = worst member status (blocked > done > working > idle > unknown).

---

## 1b. Decisions made 2026-11-06 (round two)

- **Stack:** TypeScript + Electron.
- **Sessions:** the default session and named sessions. The adapter enumerates
  `herdr session list` (or the `sessions/*/herdr.sock` directory), opens one connection
  per running session, and tags every party with its session. SSH machines later,
  same shape.
- **One agent per pane.** Member = pane.
- **Role tagging ships with the product as an installable prompt pack**, not as a
  change you make by hand. See "Installable integration" below.
- **Product is generic and publishable; the author's own skin is private.** The public
  core speaks a generic role vocabulary and ships with public themes (`neutral`,
  `aesir`, `wayfarers`). Character names live only in theme packs, and a private skin
  is a gitignored folder under `themes/` that is never committed to the public repo. Product name: Bellwether (chosen 2026-11-06).

### Generic role vocabulary

The core and the prompt pack use these roles. A theme maps them to sprites.

| Role | Neutral skin | Aesir skin |
|---|---|---|
| `orchestrator` (the session you talk to) | Conductor | Odin |
| `coordinator` (per-worktree lead) | Foreman | Tyr |
| `architect` | Surveyor | Vidar |
| `implementer` | Builder | Thor |
| `reviewer` | Inspector | Baldur |
| `researcher` | Explorer | Mimir |
| `writer` | Scribe | Saga |
| `ops` | Mechanic | Aegir |
| `generic` (untagged) | Villager | villager |

Beacon role (the one whose light shows status) is set per theme; a private skin can
pick any role, for example `architect`.

### Installable integration (the "series of prompts")

`bellwether install` does three things, each idempotent and reversible with
`bellwether uninstall`:

1. **Writes a skill pack** for the coding agents (Claude Code first; `~/.claude/skills/bellwether/`):
   - *Coordinator instructions*: when you start a member in a pane, tag it:
     `herdr pane report-metadata <pane> --source bellwether --token role=<role>`.
     When you hand a member work, optionally set `--token say="<one short line>" --ttl-ms 15000`.
   - *Member instructions*: on start, if `HERDR_ENV=1`, tag your own pane with your role
     (`$HERDR_PANE_ID` is in the environment, so the member can do it itself). Short
     `say` lines at turn boundaries are encouraged, under 60 characters, no secrets.
   The pack is theme-neutral: it talks about `architect`, never a character name. Your private
   prompts can layer names on top.
2. **Installs a Claude Code `SessionStart` hook** (same mechanism Herdr's own `claude`
   integration uses) that reports `role` from `HERDR_ROLE` when the pane was split with
   that env var (`pane.split` accepts `env`). This covers orchestrations that set roles
   at spawn time without relying on the member to announce itself.
3. **Writes `bellwether.toml`** with the chosen theme, sessions, monitor and mode.

Fallback chain when a pane has no `role` token: `HERDR_ROLE`-derived hook report,
`agent rename` name, pane `title`, then `generic`.

### Agent support: Claude Code and GitHub Copilot CLI (both first-class)

Work uses Copilot CLI, so the installer targets both from phase 6, and the adapter is
agent-agnostic from day one (it reads Herdr's `agent` field, which is `claude`,
`copilot`, `codex`, ... and never branches on it except for the installer).

| | Claude Code | GitHub Copilot CLI |
|---|---|---|
| Herdr detection | screen manifest; `herdr integration install claude` for resume | screen manifest; `herdr integration install copilot` for resume |
| Hook mechanism Herdr itself uses | `~/.claude/settings.json` `SessionStart` + `hooks/herdr-agent-state.sh` | `~/.copilot/settings.json` (flat shape) `SessionStart` + `hooks/herdr-agent-state.sh`; `COPILOT_HOME` override; Windows gets a `.ps1`/`.cmd` variant |
| Our role hook | same file + event, our own script, additive edit that leaves Herdr's entry alone | same, using Herdr's flat-settings edit pattern (see `src/integration/config_edit.rs` in the herdr repo) |
| Our skill pack | `~/.claude/skills/bellwether/SKILL.md` | `~/.copilot/skills/bellwether/SKILL.md` if the installed Copilot CLI supports skills (verify at install time); otherwise a snippet the installer offers to append to `AGENTS.md` / `.github/copilot-instructions.md` |

The installer probes which agents are on `PATH` and which config dirs exist, installs
for each, and reports what it did. Uninstall removes only entries it wrote. Phase 6
tests run against scratch `CLAUDE_CONFIG_DIR` and `COPILOT_HOME` directories.

## 2. Architecture

```
Herdr server ──named pipe──▶ adapter (Node/TS)  ──WebSocket──▶ renderer (PixiJS web page)
                                   │                               ▲
                                   ├── writes events.jsonl         │
                                   └── replay mode reads it ───────┘
                                                               ▲
                                              Electron shell: transparent, always-on-top,
                                              click-through window; tray toggles strip/map
```

Four packages in one public repo (pnpm workspace, Apache 2.0 to match Herdr), plus a
private themes repo:

- `packages/adapter`: Herdr client, state model, WebSocket server, recorder/replayer.
  Pure TypeScript, no DOM. All the protocol knowledge lives here. One connection per
  session socket.
- `packages/renderer`: PixiJS scene, theme loader, strip and map modes. A plain web
  page, so it also runs as an OBS browser source and as a blog embed in replay mode.
- `packages/shell`: Electron wrapper. Transparent frameless window pinned to the
  bottom of a chosen monitor, `setIgnoreMouseEvents(true, {forward: true})`, tray menu.
  Thin on purpose.
- `packages/cli`: `bellwether install | uninstall | run | record | replay`. Owns the
  skill pack, the hook, and `bellwether.toml`.
- `themes/neutral` ships in the repo. `themes/aesir` later. Private skins
  live in a separate private repo (or a gitignored folder under `themes/`) and are loaded by path.

Why TypeScript + Electron rather than Rust + Tauri: Node speaks Windows named pipes and
Unix sockets natively, the renderer and the blog embed share one codebase, and the
transparent click-through overlay is a well-worn Electron path. Tauri 2 is the swap if
bundle size ever matters; the adapter and renderer would not change.

### Hooks source (no Herdr)

A second generic source, `HooksSource` (`packages/adapter/src/hooks/`), tails
`~/.bellwether/events.jsonl` (`BELLWETHER_EVENTS` overrides). Writers append one normalized
line per agent event (`{v, t, agent, ev, session, cwd, sub?, tool?, detail?, role?}`, type in
`hooks/event.ts`); the Claude Code plugin in `plugins/bellwether` does it by running
`bellwether hook event` from its hooks, which is the only place that names an agent. The
source maps one party per working directory, one member per session and one per running
subagent, and emits the same `Delta`s as the Herdr source (it reuses `diffParties`). Select it
with `--hooks`, `source = "hooks"` or `BELLWETHER_SOURCE=hooks`. Local sessions only.

### State model (what the adapter emits)

This is a sketch; see `packages/adapter/src/types.ts` for the source of truth.

```ts
type Status = 'working' | 'done' | 'blocked' | 'idle' | 'unknown';

interface World {
  machine: string;                  // 'local' or the saved-machine label
  parties: Record<string, Party>;
}
interface Party {                    // one Herdr workspace
  id: string;                       // workspace_id
  label: string;                    // workspace label
  repo?: string;                    // from worktree provenance path, or cwd
  branch?: string;                  // worktree.branch
  isWorktree: boolean;
  status: Status;                   // rollup
  members: Record<string, Member>;
  tokens: Record<string, string>;   // workspace tokens (quest, etc.)
}
interface Member {                   // one pane with an agent
  paneId: string;
  agent: string;                    // 'claude', 'codex', ...
  role?: string;                    // 'architect' from tokens.role, else fallback chain
  status: Status;
  title?: string;
  say?: string;                     // tokens.say, cleared on TTL expiry
  lastChange: number;               // state_change_seq
}
type Delta = { t: number; kind: 'snapshot'; world: World }
           | { t: number; kind: 'member'; partyId: string; member: Member }
           | { t: number; kind: 'party'; party: Party }
           | { t: number; kind: 'removed'; partyId: string; paneId?: string }
           | { t: number; kind: 'say'; partyId: string; paneId: string; text: string };
```

Deltas are what gets recorded to `events.jsonl`, so replay is exact and the renderer
never needs Herdr.

### Theme pack

```
themes/<pack>/
  theme.json        # roles -> sprite, colours, map tileset, settlement names
  sprites/*.png     # generated sprite sheets
  map/*.png
themes/neutral/     # public; every pack uses the same manifest shape
```

`theme.json` maps a role to a sprite and declares which role carries the status light
(`"beacon": "architect"`), a fallback sprite for untagged members, and the status
palette. The renderer knows nothing about character names.

---

## 3. Phases

Each phase ends in something you can run. Sizes are rough.

### Phase 1: adapter (weekend)

- Enumerate running sessions (default + named) and connect to each. Windows pipe
  and Unix socket. `--session` and `--socket` overrides.
- Bootstrap from `session.snapshot`; subscribe to lifecycle events; open per-pane
  status subscriptions; handle `events_lost`.
- Build `World`, emit `Delta`s over a local WebSocket, append to `events.jsonl`.
- `--replay events.jsonl --speed 4` mode.
- Tests: a mock pipe server that serves the recorded fixtures in `research/`, plus
  unit tests for the rollup and the role fallback chain.
- Done when: `adapter --session default` prints live deltas while you work in Herdr.

### Phase 2: renderer v0, strip mode (weekend)

- PixiJS page with a flat ground line; one rectangle per member, label above, colour
  from status; parties spaced along the strip.
- Blocked: member stops and bobs; beacon flashes red.
- Done when: the replayed research log animates in a browser tab.

### Phase 3: generated pixel art (weekend)

- Sprite generator script: palette-indexed pixel grids in code, rendered to PNG sprite
  sheets. 24x32 characters, 4-frame walk, 2-frame idle, 2-frame wave, 1 "raise hand".
  Light tip and cloak colours are palette slots so status tinting is a swap, not new art.
- One sheet per role, including a generic one for untagged members and the
  orchestrator session.
- Ground tiles, a few props (campfire, signpost, pony).
- Done when: strip mode runs with real sprites and walk cycles.

### Phase 4: Electron overlay shell (evening)

- Transparent, frameless, always-on-top, click-through window the width of the chosen
  monitor, pinned to its bottom edge. Tray icon: toggle strip/map, pick monitor, pick
  session, quit.
- Done when: the strip walks along the bottom of your second monitor over everything.

### Phase 5: map mode and minimap (two weekends)

- Pixel map. Each repo is a settlement placed deterministically (hash of repo path
  into a grid, nudged apart). Each worktree party camps near its settlement;
  `worktree.created` animates them setting out from it.
- Glow per party by rollup status; minimap in the corner with the same glows.
- Click a party (map mode is not click-through): zoom to its camp, show members,
  branch, last `pane.read` lines for the beacon's pane. This is the "see the session"
  view.
- Done when: all live workspaces show on the map with correct glows.

### Phase 6: installer and speech bubbles (weekend)

- `bellwether install`: skill pack, Claude Code `SessionStart` hook, `bellwether.toml`.
  `bellwether uninstall` reverses all three. Tested against a scratch `CLAUDE_CONFIG_DIR`.
- Render `tokens.say` as a bubble, clear on TTL.
- Inferred lines from status transitions, templated per theme ("the coordinator hands
  the implementer a task" in neutral; "the Foreman hands the Builder a task" in a named skin).
- Done when: a fresh install tags roles and agents visibly chat as they wander.

### Phase 7: interactive stub (evening)

- `Action` interface in the adapter with `focus(paneId)`, `prompt(paneId, text)`,
  `sendKeys(paneId, keys)` mapped to `pane.focus`, `agent.prompt`, `agent.send_keys`.
  Only `focus` wired in the UI (double-click a member jumps the TUI to that pane).
  The rest behind a flag.

### Phase 8: blog build

- Static renderer bundle in replay mode with a scrubbed `events.jsonl`.
- A public pack (such as Aesir) as the published default; private skins stay local.

---

## 4. Decisions still open (none block phase 1)

1. **Public product name.** Bellwether, decided.
2. **Privacy on published replays.** Default: `bellwether record --scrub` hashes repo,
   branch and workspace labels at record time and strips `say` text, so a blog replay
   never holds work data. Opt out for local-only recordings.
3. **OBS.** The renderer page already works as a browser source; nothing to decide
   until you stream it.
4. **Settlement names on the map.** Neutral theme uses the repo folder name;
   a private theme can map repos to named places in its own `theme.json`.

---

## 5. Research artifacts

`research/` holds everything the plan rests on:

- `subscribe.py`, `rpc.py`: the raw named-pipe probes used for verification.
- `events.log`: the live `working` → `idle` capture from a real Claude Code pane.
- `herdr-api.schema.json`: the TUI's full request/response/event schema (protocol 22).
- `herdr-core.openrpc.json`, `herdr-core-api.md`: herdr-core's API, for the future backend.
- `socket-api.mdx`, `agent-automation.mdx`, `add-herdr-support.mdx`: the TUI docs that matter.
