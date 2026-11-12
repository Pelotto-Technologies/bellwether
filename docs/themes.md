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
  `wave_N`, `talk_N`, `raise_N`, `blink_N`; the camp scene also plays `work_0..1`, a
  hammering pose, and shows `talk` instead when a sheet has none), `fps` per animation.
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

## Camp scene

The camp scene (click a camp, then **Enter camp**) draws one party at its stations around a
fire. It needs a second atlas, `map/camp.json` + `map/camp.png` (a normal spritesheet, found
the same way as `props`), and an optional `camp` block in `art.json`:

```json
"camp": { "atlas": "map/camp.json", "tone": "camp", "sky": ["#8fd0f0", "#e4f4fa"], "glow": "#ffa84a" }
```

| Key | Meaning |
|---|---|
| `tone` | `camp` (wood and canvas) or `outpost` (plating and holograms). The renderer uses it for the ground (a trodden clearing or a plated bay), the sky (clouds and sun, or stars and a moon) and the light. Default `camp`. |
| `sky` | Two `#rrggbb` colours: top of the sky, then the horizon. |
| `glow` | Colour of the fire's light (also used for its sparks). |
| `stations` | Informational: the activity stations the atlas draws. |

A pack with no `camp.*` files borrows the neutral pack's camp art (and look), so it still
renders. The frames the renderer asks for by name (all anchored bottom-centre unless noted):

| Frames | What |
|---|---|
| `floor_0..3` | 16x16 clearing tiles. |
| `fire_0..3` | The fire (or energy core), about 44x40, with the ground ring at the bottom. |
| `tent` | A tent or pod, about 44x34. |
| `tall_0..1`, `low_0..1` | Scenery: trees or pylons, bushes or rocks or crates. |
| `st_edit_0..3`, `st_read_0..3`, `st_shell_0..3`, `st_search_0..3`, `st_delegate_0..3`, `st_think_0..3` | One animated prop per activity (anvil, lectern, cauldron, lookout, map table, easel in the camp packs), 32x32 with the ground at row 31. The member stands beside it. |
| `st_blocked_0..1` | A signal lamp, unlit then lit. |
| `seat` | A log or bench drawn over the legs of a sitting member (done, idle, unknown). |
| `fx_alert_0..1`, `fx_question`, `fx_zzz_0..2`, `fx_sweat` | Marks beside and above the head. |
| `crate_0..1`, `cart`, `cart_loaded` | Git: crates for uncommitted files (up to nine), a loaded cart while commits are unpushed. |

Which activity a member plays is decided in the core from its status and tool name
(`packages/renderer/src/map/activity.ts`), so a pack only supplies art.

## UI

`ui/ui.json` supplies the speech bubble and its tail, the nameplate, the minimap frame
(9-slice) and one icon per status.

## Checklist for a new pack

1. Copy `themes/neutral` to `themes/<yours>` and edit `theme.json` and `art.json`.
2. Replace the PNGs and sheet JSONs (keep frame names and cell sizes).
3. `pnpm build`, then open `?pack=<yours>`; check every role, the beacon and a blocked
   member.
4. Keep it private unless it is original art you want to contribute.
