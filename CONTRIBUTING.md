# Contributing

Thanks for helping. Bellwether is a pixel overlay for Herdr; read `docs/PLAN.md` for the
architecture before larger changes.

## Before you open a PR

Node 20+ and pnpm (`corepack enable`). Run the same checks CI runs:

```sh
pnpm install --frozen-lockfile
pnpm typecheck && pnpm test && pnpm build
```

Behavior changes come with tests. CI runs on Ubuntu and Windows.

## Ground rules

- The core is generic. Role vocabulary is `orchestrator`, `coordinator`, `architect`,
  `implementer`, `reviewer`, `researcher`, `writer`, `ops`, `generic`. Character names
  belong in theme packs only.
- Protocol knowledge lives in `packages/adapter` only. The renderer consumes deltas and
  never talks to Herdr.
- The adapter is agent-agnostic. Branch on Herdr's `agent` field only in
  `packages/cli` (the installer).
- The adapter is tested against fixtures in `docs/research/` and a mock pipe server,
  never against a live Herdr.
- Recordings (`*.jsonl`) and `bellwether.toml` are local and gitignored. Scrub any replay
  you publish.

## Themes

`themes/neutral`, `themes/aesir` and `themes/wayfarers` are the public packs. Do not
commit any other folder under `themes/`; private skins are gitignored and must not be
referenced from core code, prompts or tests. New public art must be original. See
[docs/themes.md](docs/themes.md) for the pack format.

## License

By contributing you agree your work is licensed under Apache-2.0, as in `LICENSE`.

## Repository protection

Only maintainers can push. Everyone else: open issues, fork, and send pull requests.
`main` requires a pull request, passing CI and maintainer (code owner) approval; release tags (`v*`) cannot be moved or
deleted. The rulesets live in `.github/rulesets/` (importable under Settings, Rules).
Report vulnerabilities per `SECURITY.md`.
