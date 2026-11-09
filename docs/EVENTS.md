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
| `sub`, `subType` | for `sub_*` | Id and type of a subagent (a worker under `session`). |
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

A session with no events for two hours is dropped unless it is done. A session that runs
subagents and has no explicit role is drawn as an orchestrator; `subType` picks the worker's
role (`reviewer`, `Explore` as researcher, `Plan` as architect, and so on). A `tool` event whose
`tool` is `Task` or `Agent` raises a speech bubble with its `detail`.

## Writing events

```sh
bellwether emit --ev <kind> [--session S] [--agent A] [--cwd D] [--role R] [--sub ID] [--sub-type T] [--tool T] [--detail TEXT]
```

Without `--session`, the session is `$BELLWETHER_SESSION`, else one per agent and folder.
`bellwether hook event` also accepts a ready-made line on stdin and validates it the same way.
Appends under the pipe-buffer size are atomic on local disks, so several writers can share the file.
