# herdr-overlay

Pixel overlay for Herdr. Read `docs/PLAN.md` before doing anything; it holds the
verified protocol facts, the architecture, the phases and the open decisions.

## Ground rules

- The core is generic and publishable. Role vocabulary is `orchestrator`,
  `coordinator`, `architect`, `implementer`, `reviewer`, `researcher`, `writer`,
  `ops`, `generic`. Character names belong in theme packs only. `themes/neutral` is
  public; every other theme is private and gitignored. Never commit a private theme or
  reference its characters in core code, prompts or tests. `docs/PLAN.md` names the
  author's private skin as a worked example; scrub that before the repo goes public.
- Agent-agnostic adapter. Branch on Herdr's `agent` field only inside `packages/cli`
  (the installer). Claude Code and GitHub Copilot CLI are both first-class installer
  targets.
- Protocol knowledge lives in `packages/adapter` only. The renderer consumes `Delta`s
  and never talks to Herdr.
- Recordings (`*.jsonl`) and `overlay.toml` are local and gitignored. Published replays
  are scrubbed.
- Behavior changes come with tests. The adapter is tested against fixtures in
  `docs/research/` and a mock pipe server, never against a live Herdr.

## Local facts

- Herdr TUI 0.9.5: `%USERPROFILE%\.herdr\packages\standalone\releases\0.9.5-x86_64-pc-windows-msvc\herdr.exe`.
  Use a named session for experiments: `herdr --session overlay-dev server`, then
  `herdr --session overlay-dev server stop`. Never touch the default session.
- Windows socket is a named pipe at `\\.\pipe\<socket path>`; see `docs/PLAN.md` §1.
- herdr-core (`hc` 0.1.18) is installed but not used by v1.

## Workflow

- Stack: pnpm workspace, TypeScript, PixiJS, Electron. Node 20+.
- Phases are in `docs/PLAN.md` §3; each ends in something runnable. Do not start a
  phase's renderer work before its adapter deltas exist.
- Run the build and tests before reporting. Say plainly when you could not.
