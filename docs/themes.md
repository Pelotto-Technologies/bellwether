# Writing a skin pack

A pack is a folder under `themes/` that maps the core's generic roles to art and
colours. The core never names characters; the pack does. Read `themes/README.md` for the
file layout and the sprite sheet frame grid, and `themes/neutral/` for a complete
example. This guide covers the formats and how the renderer loads them.

## Public and private packs

`neutral`, `aesir`, `wayfarers` and `scifi` are public and committed. Any other folder under
`themes/` is private: `.gitignore` ignores `themes/*` except those four. Put personal
skins there and never commit them or mention their characters in core code, prompts or
tests. Packs are found automatically.

## Role vocabulary

Roles are `orchestrator`, `coordinator`, `architect`, `implementer`, `reviewer`,
`researcher`, `writer`, `ops`, `generic`. Statuses are `working`, `done`, `blocked`,
`idle`, `unknown`. A pack may rename roles for display (`displayName`) but the keys are
fixed.

## How the renderer loads a pack

`packages/renderer/src/packs.ts` bundles every `themes/*/theme.json`, `art.json` and
`{sprites,ui}/*.json|png` at build time with Vite globs. So:

- Adding or editing a pack needs a rebuild (or `pnpm dev`).
- Selection order: `?pack=`, then `pack` from `/config.json` (the adapter serves it from
  `bellwether.toml`, `--pack` or `BELLWETHER_PACK`), then `neutral`, then the first pack
  alphabetically.
- `theme.json` is required. `art.json` is optional; without it the renderer draws
  procedural figures from `theme.json`.
- `loadArt` loads every sheet `art.json` names with nearest-neighbour scaling. Roles
  sharing a sheet share the loaded copy. Missing files throw `pack <name>: missing ...`.

## theme.json

Parsed by `packages/renderer/src/theme.ts`. Colours are `#rrggbb`.

| Key | Meaning |
|---|---|
| `name` | Pack id. |
| `beacon` | Role that carries the status light (default `coordinator`). |
| `palette` | Status colours: `working`, `done`, `blocked`, `idle`, `unknown`. |
| `outline`, `skin`, `ground` | Procedural-figure colours. |
| `roles.<role>` | `body`, `accent`, `hat` (`none cap hood helm point`), `prop` (`none staff lantern hammer book`). `roles.generic` is required; missing roles use it. |
| `art` | Path to `art.json`, relative to the pack. |
| `sayTtlMs` | How long a speech bubble stays (default 6000). |

## art.json

Parsed by `packages/renderer/src/art.ts`. The public packs generate it with
`tools/spritegen`; a hand-made pack can write it directly. Paths are relative to the
pack folder.

- `name`, `displayName`, `description`, `license`.
- `character`: `size` `{w,h}` (24x32), `facing` (`right`), `anchor` `{x,y}` as
  fractions (bottom-centre of the feet), `frames` (must include `walk_N`, `idle_N`,
  `wave_N`, `talk_N`, `raise_N`, `blink_N`), `fps` per animation.
- `roles.<role>`: `sheet` (a sprite sheet JSON), `displayName`, `cloak` (`#rrggbb`),
  `light` (tip tint). `fallback` names the role used for roles you leave out
  (default `generic`, which must exist).
- `status`: a colour per status.
- `strip`: `ground` sheet and `tiles` (at least one frame name; 16x16, tile
  horizontally).
- `ui`: `sheet`, `bubble` and `nameplate` (`{frame, slice[, tail]}`, 9-slice margin in
  pixels), `minimapFrame`, `statusIcons` (frame per status, default `status_<status>`).
- `map`: `tileset`, `props`, frame names for `settlement`, `camp`, `campfire`,
  `signpost`, `mount`, `banner`, `glow`, `pin`, and `minimap` colours. These are used by map mode
  (`packages/renderer/src/map/` and `src/pixi/map.ts`); `art.ts` does not validate
  them, so check them in a build.

## Sprite sheets

Character sheets, `sprites/ground`, `map/props` and `ui/ui` use the PixiJS spritesheet
JSON format: `frames` (each with `frame {x,y,w,h}`, `sourceSize`,
`spriteSourceSize`), optional `animations` (name to frame list), and `meta`
(`image`, `size`, `scale`) beside a same-named `.png`. The renderer finds the PNG by
swapping `.json` for `.png`.

A character sheet is 12 columns by 3 rows of 24x32 cells: the frame in colour, its
`<frame>_tip` twin (status light in white, tinted by status), and its `<frame>_cloak`
twin (cloak in grey, tinted per party).

## Map, tileset and props

`map/tileset.json` is not a spritesheet: `tileSize` (16), `columns`, `count`, `tiles`
(names in grid order, like `grass_0`, `flowers`), `overlays` (transparent tiles drawn
on grass) and `autotile`. Paths and water are 16-tile autotiles: N=1, E=2, S=4, W=8 for
neighbours with the same terrain, giving `path_<mask>` and `water_<mask>` (alternate
with `water_<mask>_b` to shimmer). `map/props.json` is a normal spritesheet with the
settlement, camp, campfire frames, signpost, mount, banner pieces, glow and pins.

## UI

`ui/ui.json` supplies the speech bubble and its tail, the nameplate, the minimap frame
(9-slice) and one icon per status.

## Checklist for a new pack

1. Copy `themes/neutral` to `themes/<yours>` and edit `theme.json` and `art.json`.
2. Replace the PNGs and sheet JSONs (keep frame names and cell sizes).
3. `pnpm build`, then open `?pack=<yours>`; check every role, the beacon and a blocked
   member.
4. Keep it private unless it is original art you want to contribute.
