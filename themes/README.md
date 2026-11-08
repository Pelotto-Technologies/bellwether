# Themes

A theme maps the core's generic roles to sprites, colours, map art and line templates.
See `docs/PLAN.md` §2 "Theme pack" for the manifest shape.

- `neutral/` (Workshop Crew) ships with the repo and is the default.
- `aesir/` (Aesir) is the second public theme.
- `wayfarers/` (Wayfarers) is an original fantasy quest party.
- `scifi/` (Deep Space) is an original sci-fi survey crew on an alien outpost.
- Any other folder here is private and ignored by git. Keep personal skins there.

## Layout

```
themes/<pack>/
  theme.json          # renderer manifest: beacon, status palette, procedural role looks, "art"
  art.json            # generated art manifest (sprites, map, UI); theme.json points at it
  sprites/<role>.png  # one sheet per role, plus .json in PixiJS spritesheet format
  sprites/ground.*    # strip-mode ground tiles (16x16, tile horizontally)
  map/tileset.*       # 16x16 map tiles: grass, flowers, overlays, path and water autotiles
  map/props.*         # settlement, camp, campfire, signpost, mount, banner, glow, pins
  ui/ui.*             # speech bubble + tail, nameplate, minimap frame (9-slice), status icons
```

`theme.json` keeps working without the art: the renderer's procedural figures use its
`roles` looks. `art` is optional, so a pack can ship looks only.

## Character sheets

Characters are 24x32 and face right; mirror them to walk left. The anchor is the
bottom-centre of the feet (`art.json` → `character.anchor`). A sheet has 12 columns
(`walk_0..3`, `idle_0..1`, `wave_0..1`, `talk_0..1`, `raise_0`, `blink_0`) and three rows:

1. the frame in colour;
2. `<frame>_tip`: the status light in white/grey. Tint it with the status colour and
   draw it over the frame (blocked members can pulse its alpha);
3. `<frame>_cloak`: the cloak in grey. Tint it and draw it over the frame to recolour
   the cloak, for example per party.

Animations are listed in each sheet's `animations` (with `_tip` and `_cloak` twins), and
suggested frame rates in `art.json`.

## Map tiles

Paths and water are 16-tile autotiles. For a cell, set N=1, E=2, S=4, W=8 for each
neighbour with the same terrain and draw `path_<mask>` or `water_<mask>`; alternate
`water_<mask>` and `water_<mask>_b` for the shimmer. Overlays (`tree`, `bush`, `rock`,
`stump` or `runestone`) are transparent and go on top of grass.

## Regenerating

The public packs' art is drawn from code in `tools/spritegen` (palette-indexed pixel
templates, no image editor). Edit a pack spec in `tools/spritegen/packs/` or a template
in `parts.mjs` / `world.mjs`, then:

```
pnpm --filter @bellwether/spritegen art        # rewrite themes/*/
pnpm --filter @bellwether/spritegen test       # fails if committed art is stale
pnpm --filter @bellwether/spritegen preview out.html   # one-page animated preview
```

All public art is original. The Aesir pack draws on public-domain mythology only, and
avoids film and comic designs.
