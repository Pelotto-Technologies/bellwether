# Activity events (the `hooks` source)

The `hooks` source draws agents from a file of JSON lines, one event per line, default
`~/.bellwether/events.jsonl` (`BELLWETHER_EVENTS` or `[hooks] file` overrides it). No Herdr
is involved. Claude Code and Copilot CLI hooks write it for you (`bellwether install
--events`, or the Claude Code plugin). Any other tool can write it with `bellwether emit` or
by appending lines itself.

## Line format

```json
{"v":1,"t":1731196800000,"agent":"my-factory","ev":"tool","session":"job-42","cwd":"/code/app","detail":"Run migrations"}
```

| Field | Required | Meaning |
|---|---|---|
| `v` | yes | Always `1`. Other versions are ignored. |
| `t` | yes | Epoch milliseconds. |
| `ev` | yes | One of the kinds below. |
| `session` | yes | Stable id for one agent. Every event of that agent uses the same id. |
| `agent` | no | Free label for the tool (`claude`, `copilot`, `my-factory`). Never used to branch. |
| `cwd` | no | Working directory. Agents with the same directory form one party. |
| `role` | no | `orchestrator`, `coordinator`, `architect`, `implementer`, `reviewer`, `researcher`, `writer`, `ops` or `generic`. |
| `label` | no | What to call this member (40 characters; with `sub`, the subagent). Shown as `Name · role`. Not the same as `vitals`' `name`, which is the quest. |
| `sub`, `subType` | for `sub_*` | Id and type of a subagent (a worker under `session`). |
| `ctx`, `quota` | `vitals` only | Percent remaining, 0 to 100: `ctx` of the context window, `quota` of the 5-hour usage quota. Clamped; anything that is not a number is dropped. |
| `model`, `effort`, `name` | `vitals` only | Model display name (40 characters), reasoning effort (16) and the session's human name, shown as its quest (80). Control and bidi characters are stripped and whitespace collapsed. |
| `scope` | no | Only `fleet`, only with `role` `orchestrator`: the session is a fleet master and stands at the map hub. Anything else is dropped. |
| `to` | no | Only on `prompt`, `tool` and `wait` (200 characters): a `session` id. The line is a message to that session, drawn as a journey on the map. An unknown session gives a plain bubble. |
| `tool`, `detail` | no | Short label, at most 72 characters, one line. Never put prompt text or secrets here. |

## Kinds

| `ev` | Effect |
|---|---|
| `start` | Agent appears, idle. |
| `prompt`, `tool`, `tool_done` | Agent is working; `detail` becomes its label. |
| `wait` | Agent is blocked on a person; `detail` shows as a speech bubble. |
| `stop` | Agent is done. |
| `end` | Agent is removed. |
| `sub_start`, `sub_stop` | A worker joins or finishes under its session. It lingers a few seconds when done. |
| `vitals` | Updates the session's context, quota, model, effort and name without changing its status. Creates the session, idle, if it is unknown. |

A session with no events for two hours is dropped unless it is done. A session that runs
subagents and has no explicit role is drawn as an orchestrator; `subType` picks the worker's
role (`reviewer`, `Explore` as researcher, `Plan` as architect, and so on). A `tool` event whose
`tool` is `Task` or `Agent` raises a speech bubble with its `detail`.

## Vitals

A `vitals` line carries only the fields the writer knows. A field a line leaves out keeps its
last value, and nothing is ever estimated: with no `ctx`, no context bar is drawn.

```json
{"v":1,"t":1731196800000,"agent":"claude","ev":"vitals","session":"job-42","ctx":88,"quota":74,"model":"Opus 5.5","effort":"high","name":"Fix the auth flow"}
```

Claude Code is the only agent that provides this data today, through its status line
(`bellwether install --statusline`, which wraps any status line you already have). Anything
else can write the same line with `bellwether emit --ev vitals --ctx 88 --quota 74 --model "Opus 5.5" --effort high --name "Fix the auth flow"`.
Under Herdr the same values travel as pane tokens `ctx`, `quota`, `model`, `effort` and `quest`.

## Levels and moments (derived, not written)

Nothing here is an input. The adapter's stats decorator reads the same stream of `Delta`s these
events turn into and adds progression on top: each member gets `level` and `xp` (per role), and two
new delta kinds are emitted for the overlay, never by Herdr or an agent:

```ts
{ t, kind: 'moment', moment: 'level_up', partyId, paneId, role, level }
{ t, kind: 'moment', moment: 'quest_complete', partyId, recap }
```

`tool` events feed the tool-category counts in the recap (`edit`, `read`, `search`, `shell`,
`delegate`, `plan`, `other`); a `say` addressed to another agent counts as a message sent.
Moments carry counters only. See README "Levels and quest recap" for the XP rules and the
privacy of `~/.bellwether/stats.json`.

## Writing events

A runner driving many agents: see [runners.md](runners.md).

```sh
bellwether emit --ev <kind> [--session S] [--agent A] [--cwd D] [--role R] [--label NAME] [--sub ID] [--sub-type T] [--tool T] [--detail TEXT]
bellwether emit --ev vitals [--session S] [--ctx N] [--quota N] [--model M] [--effort E] [--name NAME]
```

Without `--session`, the session is `$BELLWETHER_SESSION`, else one per agent and folder.
`bellwether hook event` also accepts a ready-made line on stdin and validates it the same way.
Appends under the pipe-buffer size are atomic on local disks, so several writers can share the file.
