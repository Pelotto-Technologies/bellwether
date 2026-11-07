# herdr-overlay

A Stream-Avatars-style pixel overlay for [Herdr](https://herdr.dev). Each Herdr
worktree workspace becomes a party of pixel characters that walk along the bottom of
your screen. One of them carries a light that shows the party's status (working,
done, blocked). A map mode shows every party as a glow on a pixel map; zoom into one to
see its members and what they are doing.

Reads the Herdr TUI socket API. Display only in v1, with interactive hooks stubbed.
Theme packs are swappable; the core knows roles (architect, implementer, reviewer,
...), not characters.

**Status:** planned, not yet built. The plan is in [docs/PLAN.md](docs/PLAN.md).

## Layout (planned)

```
packages/adapter    Herdr client, world model, WebSocket + recorder/replayer (TypeScript)
packages/renderer   PixiJS scene: strip mode, map mode, theme loader (web page)
packages/shell      Electron overlay window + tray
packages/cli        overlay install | uninstall | run | record | replay
themes/neutral      ships with the repo
themes/<private>    your own skins, gitignored
docs/               plan and research artifacts
```

## Research artifacts

`docs/research/` holds the verified protocol details this project rests on: the Herdr
TUI API schema (protocol 22), herdr-core's OpenRPC schema, the raw named-pipe probe
scripts, and a captured `working` → `idle` event log from a real agent pane.

## Supported agents

Claude Code and GitHub Copilot CLI are first-class targets for the installer. The
adapter itself is agent-agnostic: anything Herdr recognizes shows up.

## License

Not chosen yet. Herdr is Apache 2.0.
