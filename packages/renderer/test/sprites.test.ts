import { describe, expect, it } from 'vitest';
import neutral from '../../../themes/neutral/theme.json';
import { beaconPixels, buildFrame, FRAME_NAMES, paletteFor, rasterize, SPRITE_H, SPRITE_W } from '../src/sprites.js';
import { HATS, parseTheme, PROPS } from '../src/theme.js';

const theme = parseTheme(neutral);

describe('sprites', () => {
  it('builds full-size frames for every hat, prop and frame', () => {
    for (const hat of HATS)
      for (const prop of PROPS)
        for (const frame of FRAME_NAMES) {
          const grid = buildFrame({ hat, prop }, frame, false);
          expect(grid).toHaveLength(SPRITE_H);
          for (const row of grid) expect(row).toHaveLength(SPRITE_W);
        }
  });

  it('gives every beacon a light and nobody else one', () => {
    for (const hat of HATS)
      for (const prop of PROPS) {
        expect(beaconPixels(buildFrame({ hat, prop }, 'stand', true)).length).toBeGreaterThan(0);
        expect(beaconPixels(buildFrame({ hat, prop }, 'stand', false))).toEqual([]);
      }
  });

  it('walk frames differ from the standing frame', () => {
    const look = theme.roles.implementer;
    expect(buildFrame(look, 'stepA', false)).not.toEqual(buildFrame(look, 'stand', false));
    expect(buildFrame(look, 'stepB', false)).not.toEqual(buildFrame(look, 'stepA', false));
  });

  it('rasterizes known palette keys to opaque pixels and leaves the rest clear', () => {
    const look = theme.roles.coordinator;
    const grid = buildFrame(look, 'stand', true);
    const px = rasterize(grid, paletteFor(look, theme));
    expect(px).toHaveLength(SPRITE_W * SPRITE_H * 4);
    const at = (x: number, y: number) => px[(y * SPRITE_W + x) * 4 + 3];
    expect(at(0, 0)).toBe(0); // transparent corner
    const tip = beaconPixels(grid)[0]!;
    expect(at(tip.x, tip.y)).toBe(0); // beacon tip is drawn as a glow, not a pixel
    expect(at(4, 4)).toBe(255); // face
  });
});
