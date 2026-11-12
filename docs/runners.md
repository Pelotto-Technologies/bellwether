# Driving Bellwether from a runner or orchestration framework

A runner is any program that starts agents for you (a task runner, a pipeline, a framework such
as Flock) and wants them to show up in the overlay with the right character, status and speech.
Bellwether has two doors, and a runner can use either or both:

- **With Herdr**: the runner draws into Herdr panes and tags them with `herdr pane report-metadata`.
  Bellwether reads Herdr; nothing else is installed.
- **Without Herdr**: the runner calls `bellwether emit` as work starts, runs tools and finishes.

Bellwether never branches on which agent a pane runs. Everything below is by role, status and tokens.

## Herdr: the token contract

All tokens are pane tokens written with the source `bellwether`:

```sh
herdr pane report-metadata <pane> --source bellwether --token role=reviewer --token name=Quill
```

Herdr stores tokens by name only, so the overlay reads them by name. Token values are capped at 80
characters by Herdr, token names are 1 to 32 letters, digits, `_` or `-`, and a report may set 16 keys.
`--ttl-ms N` makes a token expire by itself; an empty value clears it.

| Token | Values | Effect |
|---|---|---|
| `role` | `orchestrator`, `coordinator`, `architect`, `implementer`, `reviewer`, `researcher`, `writer`, `ops`, `generic` | The character. Case-insensitive. Also opts a pane that has no agent into the party (below). Any other value is ignored and the role falls back to the agent name, title and `generic`. |
| `say` | one line | A speech bubble. Bubbles are one line of at most 72 characters; do not put prompt text or secrets in it. Use `--ttl-ms 15000` so it clears. |
| `say_to` | pane id, agent name or terminal id | Makes the `say` a message to that member (an arrow between the two). A target that is not a member drops the bubble. |
| `say_id` | any string | Change it to raise a new bubble for a repeated line. |
| `state` | `done`, `idle`, `working`, `blocked` | Overrides the status Bellwether derived for the pane. Anything else, `unknown` included, is ignored. It stays until you clear it, so set it with `--ttl-ms` or clear it with `--token state=` when the pane works again. |
| `name` | text, at most 40 characters | What to call the member. Shown as `Name · role` in the party window and detail panel, and in alerts (`Name (reviewer) finished · label`). Not shown on the strip. |
| `hide` | `1`, `true`, `yes`, `on` | Removes the pane from the overlay, whatever it runs. |
| `ctx`, `quota` | 0 to 100 | Percent of the context window and of the usage quota remaining. |
| `model`, `effort`, `quest` | text (40, 16 and 80 characters) | Model display name, reasoning effort and the session's human name. |

```sh
# Tag a leaf and name it
herdr pane report-metadata w3:p2 --source bellwether --token role=implementer --token name=Rook

# A short bubble to the coordinator
herdr pane report-metadata w3:p2 --source bellwether --token say="Tests are green" \
  --token say_to=w3:p1 --token say_id=7 --ttl-ms 15000

# The leaf has finished; Herdr will say idle
herdr pane report-metadata w3:p2 --source bellwether --token state=done

# It works again
herdr pane report-metadata w3:p2 --source bellwether --token state=

# Vitals
herdr pane report-metadata w3:p2 --source bellwether --token ctx=62 --token quota=80 \
  --token model="Opus 5.5" --token effort=high --token quest="Fix the login flow"

# Keep a pane out of the overlay
herdr pane report-metadata w3:p4 --source bellwether --token hide=1
```

Herdr's own `display_agent` is not used as the name: for a detected agent it holds the product name
(`Claude Code`), which would label every member the same. Put a per-pane name in `name`.

### Panes that are not agents

A pane with no agent (a plain shell, such as the pane a runner uses to supervise a worktree) is not a
party member and is not drawn. A workspace holding only such panes shows no party. To draw one anyway, tag it
with a valid `role` (for example `role=ops`); `hide=1` removes it again.

### Finished versus waiting

Herdr reports `done` until someone looks at a pane and `idle` afterwards, and a runner's leaves are never
looked at one by one. So in a linked-worktree party, a member whose status goes from `working` to `idle` is shown as
`done` and stays `done` until it works again. This does not apply to `orchestrator` and `coordinator`
members, which sit idle for days, nor to a pane Bellwether first sees already idle (it cannot know the
history; send `state=done`). A `state` token wins over the rule. In the camp scene a `done` member sits by the
fire, content, and waves now and then (labelled "Resting"); an `idle` one dozes with eyes shut ("Dozing").

A party's colour is its worst member: blocked, then done, then working, then idle, then unknown. A coordinator
that is idle never makes the party look busy; a party of an idle coordinator and finished leaves shows `done`.

## How parties are grouped

- A **workspace is a party**. Tabs do not matter: panes in any tab of the workspace are members of its party.
- A workspace that is a linked git worktree is a **worktree party**; worktree workspaces of the same repository are
  grouped under that repository's settlement on the map, and the repo-root workspace (a person's own pane, tagged
  `orchestrator`) is where they set out from.
- The party label is the workspace label, so `<card>-<slug> (runner)` shows as that.

## Without Herdr: `bellwether emit`

```sh
bellwether emit --ev <kind> --session S [--agent A] [--cwd D] [--role R] [--label NAME] [--sub ID --sub-type T] [--tool T] [--detail TEXT]
```

One line is appended to `~/.bellwether/events.jsonl` (or `$BELLWETHER_EVENTS`). Run the overlay with
`bellwether overlay --hooks`. Agents with the same `--cwd` form one party; a path containing `worktrees/` is a
worktree party. The kinds and fields are in [EVENTS.md](EVENTS.md). `--label` is the member's display name (40
characters) and is separate from `vitals --name`, which is the session's quest.

A task's life as events, for a runner that gives each card a worktree with a lead and some workers:

```sh
D=/work/api-wt/142-fix-login
# The run starts: the lead appears
bellwether emit --ev start --session 142-lead --agent my-runner --cwd $D --role coordinator --label Lead
# A worker takes a task
bellwether emit --ev start --session 142-impl --cwd $D --role implementer --label Rook
bellwether emit --ev prompt --session 142-impl --cwd $D --detail "Fix the login redirect"
bellwether emit --ev tool --session 142-impl --cwd $D --tool Edit --detail "Edit auth.ts"
# It needs a person
bellwether emit --ev wait --session 142-impl --cwd $D --detail "Which login flow?"
# It finishes (shown done)
bellwether emit --ev stop --session 142-impl --cwd $D
# The lead hands out a short-lived helper
bellwether emit --ev sub_start --session 142-lead --cwd $D --sub r1 --sub-type reviewer --label Quill
bellwether emit --ev sub_stop --session 142-lead --cwd $D --sub r1
# The card is closed: remove everyone
bellwether emit --ev end --session 142-impl --cwd $D
bellwether emit --ev end --session 142-lead --cwd $D
```

| Runner moment | Event |
|---|---|
| Agent or task created | `start` (idle) |
| Task handed over, model turn begins | `prompt`, then `tool` / `tool_done` for each step (working) |
| Waiting on a person | `wait` with `--detail` (blocked, and the detail is its bubble) |
| Task finished | `stop` (done) |
| Agent torn down | `end` (removed) |
| A short-lived helper | `sub_start` / `sub_stop` with `--sub` |
| Context, quota, model | `vitals` |

Unlike Herdr, this source has no pane to leave behind, so a finished session stays `done` until you send `end`
(other sessions are dropped after two hours without events).

### Mapping your roles onto the nine

Map each of your agent kinds to the closest of `orchestrator`, `coordinator`, `architect`, `implementer`,
`reviewer`, `researcher`, `writer`, `ops` and `generic`: the person's own session is `orchestrator`; the lead
of a run or worktree is `coordinator`; planners and designers are `architect`; code writers are `implementer`;
checkers and testers are `reviewer`; explorers and searchers are `researcher`; documentation is `writer`;
deploy, CI and infrastructure agents are `ops`; anything else is `generic`. Use `name` or `--label` for the
distinction your own role names carry.

## Fleet: one master for many projects

Bellwether works without any of this and draws exactly the same map when no fleet marker is
present. The marker only adds a hub, rollups and journeys for runners that coordinate several
projects from one pane.

**Token contract.** Tag the master pane `role=orchestrator` and `scope=fleet` (any other
`scope`, or `scope=fleet` on another role, is ignored). Optionally add `name`.

```sh
herdr pane report-metadata <pane> --source bellwether --token role=orchestrator --token scope=fleet --token name=Dispatch
```

Without Herdr: `bellwether emit start --session lead --role orchestrator --scope fleet --label Dispatch`.

**Projects and messages.**
- A project is a normal workspace party, so repos become settlements as usual. A project
  that is a bare node (a pane that is not an agent) can be drawn with `role=orchestrator`,
  `name=<project>` and `state=<status>`.
- `say` plus `say_to` addresses another member, and `say_to` also matches a `name` token, so the
  master can address a project node by name. With hooks, `prompt`, `tool` and `wait` events
  take `to=<session id>` (`bellwether emit tool --session lead --to api-lead --detail "Rebase onto main"`).
- A `say` between members of different parties, in either direction, or between the master
  and a project, is drawn as a journey.

**What you see.**
- The master stands at a hub near the map centre, clear of settlements, camps, water and road
  ends. With none or one settlement it sits at the centre or beside the first one. Several
  masters all stand at the hub. Settlements are not moved to make room for it.
- A fleet-only party never becomes a settlement or camp, and a master inside a repo workspace
  is lifted out of that camp. Fleet members never appear in the camp scene.
- Rollup: each settlement shows its worst status (blocked, done, working, idle, unknown, so idle
  and unknown never hide done work). The hub beacon is the worst of the fleet and the master's
  own status, both shown.
- Journeys: messages sent within about half a second are merged into one trip of at most 6 stops,
  ordered for a short path; more become plain bubbles at home, as does an unknown target. Each leg
  takes about 2 to 6 seconds and a trip is capped at about 20 seconds, after which remaining bubbles
  appear at once. The bubble's timer starts on arrival, a marker shows the empty seat while the
  speaker is away, and the status colour is unaffected. Journeys need a fleet master; reduced
  motion, strip mode and the camp scene draw no travel.
- Alerts: toasts read `Name (reviewer) finished · party · settlement`, only when a master or more than one
  settlement exists. A blocked member that says something to the master raises "needs you" once.
  Clicking the master focuses its pane.
- A theme pack may supply `map.hub` (guild house, great hall, map room, signal tower); otherwise a generic
  hub is drawn, see [themes](themes.md).

**Scenarios.** A runner with 3 projects and an escalation: the master sends a line per project, a
project's coordinator blocks and says so to the master (toast, red pennant, beacon), the master blocks
briefly, then works again. `bellwether-adapter --mock` (or `pnpm mock`) plays exactly this; `--mock-fleet 0` turns it off.

## Picking a matching name pool

`bellwether pack` prints the skin the overlay is showing, so a runner can choose names that fit it:

```sh
$ bellwether pack
neutral
$ bellwether pack --json
{"pack":"neutral","source":"default","available":["neutral","aesir","wayfarers","scifi"]}
```

`source` says where the choice came from, in the order the overlay applies them: `shell` (the tray's Skin
menu, saved in the desktop overlay's `shell.json`), `env` (`BELLWETHER_PACK`), `toml` (`pack` in `bellwether.toml` in
the current directory), or `default`. `available` lists the pack folders found, by name only.

## Limits

- Speech bubbles are one line, 72 characters at most. Do not put prompt text, file contents or secrets in `say`,
  `--detail` or `--label`; recordings drop `say`, `title`, `quest` and `name` when scrubbed.
- At most 40 characters for `name`, `model` and `--label`; 16 for `effort`; 80 for `quest`.
- A pane belongs to one party and one member; a pane with no agent needs a `role` token to be drawn.
- `scope` is only `fleet`, only with `role=orchestrator`.
- Bellwether only displays: it does not start, stop or steer agents.
