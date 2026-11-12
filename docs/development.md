# Development

Everything you need to run Bellwether from a checkout, find your way around the code and
regenerate the docs images. For the architecture and the verified Herdr protocol facts, see
[PLAN.md](PLAN.md).

## Run from source

Needs Node 20+ and pnpm (`corepack enable` gives you the pinned version).

```sh
pnpm install
pnpm mock        # build, then serve mock agents + the overlay on http://127.0.0.1:7341/
pnpm dev         # adapter mock server on :7341 and Vite with hot reload on :5173
pnpm shell       # build adapter and renderer, then launch the desktop overlay
```

Under `pnpm dev`, open <http://127.0.0.1:5173/>. If the adapter is not reachable the page
falls back to an in-browser mock and says so in the corner chip.

The `bellwether` binary is not on your PATH in a checkout. Run it through pnpm (it builds on
first use; `BELLWETHER_REBUILD=1` forces a rebuild), or link it with
`pnpm build && cd packages/cli && pnpm link --global`:

```sh
pnpm bellwether run
pnpm bellwether install
```

Checks, the same ones CI runs on Ubuntu and Windows:

```sh
pnpm typecheck && pnpm test && pnpm build
```

## Watching live Herdr from a checkout

```sh
pnpm build
node packages/adapter/dist/bin.js --live --all --serve packages/renderer/dist
```

Adapter flags (`--help` for all):

| Flag | Effect |
|---|---|
| `--live` / `--hooks` / `--mock` / `--auto` / `--replay <file.jsonl>` | Where deltas come from. `source` (`live`, `hooks`, `mock`, `auto`) in `bellwether.toml` or `BELLWETHER_SOURCE` sets the default. `--auto` (what `run` and `overlay` use) picks live Herdr if a socket answers at startup, else hooks. |
| `--session <name>` / `--all` | Which Herdr sessions to watch. |
| `--socket <path>` | Explicit socket or named pipe. |
| `--record <file.jsonl>` | Append every delta to a file. Add `--scrub` (or `scrub = true`) to hash repo, branch and workspace labels and strip speech and pane titles. |
| `--scrub-file <in> <out>` | Scrub an existing recording. |
| `--actions` | Let clients send `prompt` and `sendKeys` to agents (`actions = true`). Focusing and closing panes are always allowed for clients on the same machine. |
| `--print` | Print deltas as JSON lines. |
| `--port`, `--serve <dir>`, `--pack <name>` | Server port, static page directory, default skin. |

`node packages/adapter/dist/bin.js --live --session overlay-dev --print` is handy for
seeing exactly what the adapter makes of a session.

## The desktop shell

`packages/shell` wraps the page in a transparent, frameless, always-on-top, click-through
Electron window the width of one monitor, pinned to its bottom edge. It attaches to an
adapter already serving `http://127.0.0.1:7341/` or, if none answers, spawns one with
`--auto --all` (live Herdr if it answers, else the events file). Tray choices persist in `shell.json` in Electron's userData folder. Set
`BELLWETHER_ADAPTER_BIN` or `BELLWETHER_RENDERER_DIR` to point at other builds.
`pnpm install` downloads the Electron binary; CI skips it with
`ELECTRON_SKIP_BINARY_DOWNLOAD=1`.

## Layout

```
packages/adapter    world model, Herdr client, mock source, WebSocket server, recorder/replayer
packages/renderer   PixiJS strip and map modes and the theme loader (web page)
packages/shell      Electron overlay window and tray
packages/cli        bellwether install | uninstall | overlay | run | orchestrate | record | replay | scrub
themes/             public skin packs; any other folder is private and gitignored
tools/spritegen     generates the public packs' art from code
tools/icongen       generates the brand icon, tray icons and logo
tools/docshots      renders the README screenshots and GIFs
docs/research       verified Herdr protocol schemas, probes and captured event logs
```

Map layout, terrain, camera, chatter, wandering and riding are pure modules under
`packages/renderer/src/map/` with tests; `src/pixi/map.ts` is the thin Pixi scene.

## Regenerating the README images

The screenshots and GIFs come from scripted, made-up feeds in
`tools/docshots/scenario.mjs`, played through the built renderer in headless Chromium:

```sh
pnpm --filter @bellwether/renderer build
node tools/docshots/shoot.mjs            # everything, into docs/images/
node tools/docshots/shoot.mjs scifi      # only images whose name contains "scifi"
```

It needs Playwright with Chromium and `ffmpeg` on PATH for the GIFs. Re-run it after any
visible change to the renderer or a skin pack.

## Static replay page

`pnpm blog` builds a static, adapter-free bundle in `blog/`: the renderer plus the scrubbed
demo recording in `docs/demo/`. Host it anywhere and embed `embed.html?pack=aesir&scale=3`,
or point `?replay=<url>&speed=2` at your own scrubbed recording. Never publish an
unscrubbed recording.
