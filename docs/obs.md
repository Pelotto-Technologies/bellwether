# Using Bellwether in OBS

The renderer is a plain web page, so OBS can show it as a Browser Source. No Electron
shell is needed.

## 1. Start the page

Live Herdr agents, with the published CLI:

```sh
npm install -g @pelotto-tech/bellwether
bellwether run   # serves the overlay on http://127.0.0.1:7341/
```

Mock agents from a checkout (good for setting up the scene):

```sh
pnpm install
pnpm mock        # builds, then serves adapter + renderer on http://127.0.0.1:7341/
```

From a checkout against live Herdr: `pnpm build && node packages/adapter/dist/bin.js --live --all --serve packages/renderer/dist`.

`--all` watches every running Herdr session; use `--session <name>` for one. With
`--serve`, the page and the delta WebSocket share one port (default 7341, change with
`--port`), so the page finds the adapter on its own origin. See `--help` for the other
flags. `source = "live"` in `bellwether.toml` sets the default source (the default is `auto`: Herdr if it is running, else agent events; see the README).

## 2. Add the Browser Source

1. Sources, `+`, Browser.
2. URL: `http://127.0.0.1:7341/?transparent`
3. Width and height: your canvas size (for example 1920 x 1080). Characters walk along
   the bottom edge of the page, so a full-canvas source puts them at the bottom of the
   scene.
4. Leave "Custom CSS" empty. `?transparent` already clears the page background.
5. Untick "Shutdown source when not visible" so the page keeps its connection.

## URL options

| Option | Effect |
|---|---|
| `?transparent` | No backdrop and no status chip. Use for OBS. |
| `?pack=<name>` | Skin pack: `neutral` (default), `aesir`, `wayfarers`, `scifi`, or a private folder under `themes/`. Beats `pack` in `bellwether.toml`; unknown names fall back to `neutral`. |
| `?scale=<1-6>` | Pixel scale, default 3. Characters are 24x32, so scale 3 is 72x96 pixels. Integer values keep the pixels sharp. |
| `?source=mock` | Skip the adapter; run mock agents inside the page. |
| `?ws=ws://host:port/deltas` | Connect to a specific adapter. |
| `?minimal` | Icon-only labels: a status icon under each party instead of a nameplate. |
| `?bubbles=0` | Hide chat bubbles. Press `b` in an interact window to toggle. |
| `?mode=map` | Start in map mode instead of the strip. The default is the strip; press `m` to toggle. Map mode is not click-through, so the strip is usually what you want in OBS. |

Options combine: `http://127.0.0.1:7341/?transparent&pack=aesir&scale=4`.

## Sizing

- Scale is the only size control. Pick the scale, then size the source to the strip you
  want; a wide, short source (for example 1920 x 200) works if you only want the strip.
- Do not stretch the source in OBS; change `?scale` instead, to avoid blurry pixels.
- The page follows the browser window size, so resizing the source just re-lays out.

## Running live versus mock

- Live needs Herdr running and agents in panes. Roles come from `HERDR_ROLE` or the
  installed skill and hook (`bellwether install`, see the README).
- Mock needs nothing and is the quickest way to check pack art and scale.
- The same page works from Vite (`pnpm dev`, `http://127.0.0.1:5173/`); OBS prefers the
  built page served by the adapter.
- If the adapter is unreachable the page falls back to the in-browser mock. Without
  `?transparent`, the chip in the corner says `adapter · <url>` or `mock · <reason>`.

## Troubleshooting

- **Only mock characters appear**: open the URL without `?transparent` in a normal
  browser and read the chip. `mock · ...` means the WebSocket failed; check the adapter
  is running and the port matches.
- **Black or white background in OBS**: `?transparent` is missing from the URL.
- **Blank page**: `packages/renderer/dist` is missing. Run `pnpm build`, and pass that
  folder to `--serve`.
- **Wrong skin**: unknown `?pack=` names fall back silently (the browser console warns).
  Packs are bundled at build time, so rebuild after adding a folder under `themes/`.
- **Blurry sprites**: a non-integer `?scale`, or the source is scaled in OBS.
- **Source freezes after switching scenes**: untick "Shutdown source when not visible",
  or use "Refresh cache of current page".
- **Everyone looks generic**: panes have no role. See "Give panes a role" in the README.
