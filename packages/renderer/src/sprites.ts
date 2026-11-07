import type { Hat, Prop, RoleLook, Theme } from './theme.js';

/**
 * Procedural pixel figures. Each frame is a grid of palette keys; a later phase
 * can swap this for generated sprite sheets without touching the scene.
 *
 *   .  transparent   o outline   s skin   e eye   b body   a accent
 *   h  hat           w wood      m metal  r book  k beacon tip (drawn as a glow, not a pixel)
 */
export const SPRITE_W = 12;
export const SPRITE_H = 18;

const HEAD = [
  '............',
  '............',
  '............',
  '....oooo....',
  '...osssso...',
  '...ossseo...',
  '...osssso...',
  '....oooo....',
];

const TORSO = [
  '...obbbbo...',
  '..obbaabbo..',
  '..obbaabbo..',
  '..sbbbbbbs..',
  '...obbbbo...',
];

const LEGS: Record<'stand' | 'stepA' | 'stepB', string[]> = {
  stand: ['...ob..bo...', '...ob..bo...', '...oo..oo...', '............', '............'],
  stepA: ['...ob..bo...', '..ob....bo..', '..oo....oo..', '............', '............'],
  stepB: ['....obbo....', '....obbo....', '....oooo....', '............', '............'],
};

const HATS: Record<Hat, string[]> = {
  none: [],
  cap: ['............', '............', '...hhhhh....', '...hhhhhhh..'],
  hood: ['............', '............', '...hhhhhh...', '..hhhhhhhh..', '..h......h..', '..h......h..', '..h......h..', '..hh....hh..'],
  helm: ['............', '.....mm.....', '....mmmm....', '...mmmmmm...'],
  point: ['......h.....', '.....hh.....', '....hhhh....', '..hhhhhhhh..'],
};

/** Props sit in the right-hand columns; `k` marks where a beacon light goes. */
const PROPS: Record<Prop, string[]> = {
  none: [],
  staff: ['', '', '..........k.', '..........w.', '..........w.', '..........w.', '..........w.', '..........w.', '..........w.', '..........w.', '..........w.', '..........w.', '..........w.', '..........w.', '..........w.'],
  lantern: ['', '', '', '', '', '', '', '', '', '..........m.', '.........mkm', '.........mkm', '..........m.'],
  hammer: ['', '', '', '', '', '', '', '.........mmm', '.........mmm', '..........w.', '..........w.', '..........w.', '..........w.'],
  book: ['', '', '', '', '', '', '', '', '', '', '.........rr.', '.........rr.'],
};

/** Overlay `top` onto `base`; '.' and blanks in `top` keep the base pixel. Hood cut-outs keep the face. */
function overlay(base: string[], top: string[]): string[] {
  return base.map((row, y) => {
    const t = top[y];
    if (!t) return row;
    let out = '';
    for (let x = 0; x < SPRITE_W; x++) {
      const c = t[x] ?? '.';
      out += c === '.' ? row[x] : c;
    }
    return out;
  });
}

export type FrameName = 'stand' | 'stepA' | 'stepB';
export const FRAME_NAMES: FrameName[] = ['stand', 'stepA', 'stepB'];

export function buildFrame(look: Pick<RoleLook, 'hat' | 'prop'>, frame: FrameName, withBeacon: boolean): string[] {
  let grid = [...HEAD, ...TORSO, ...LEGS[frame]];
  grid = overlay(grid, HATS[look.hat]);
  // Every beacon carries a light. If the role's prop has none, give it a lantern.
  const prop = withBeacon && (look.prop === 'none' || look.prop === 'book' || look.prop === 'hammer') ? 'lantern' : look.prop;
  grid = overlay(grid, PROPS[prop]);
  if (!withBeacon) grid = grid.map((row) => row.replaceAll('k', prop === 'staff' ? 'w' : 'm'));
  return grid;
}

/** Pixel coordinates of beacon light pixels in a frame (empty when the frame has none). */
export function beaconPixels(grid: string[]): { x: number; y: number }[] {
  const out: { x: number; y: number }[] = [];
  grid.forEach((row, y) => {
    for (let x = 0; x < row.length; x++) if (row[x] === 'k') out.push({ x, y });
  });
  return out;
}

export function paletteFor(look: RoleLook, theme: Theme): Record<string, string | null> {
  return {
    '.': null,
    k: null,
    o: theme.outline,
    e: theme.outline,
    s: theme.skin,
    b: look.body,
    a: look.accent,
    h: look.accent,
    w: '#7a5a3a',
    m: '#a7b0ba',
    r: '#8b2f2f',
  };
}

/** RGBA bytes for a frame, ready for ImageData. */
export function rasterize(grid: string[], palette: Record<string, string | null>): Uint8ClampedArray<ArrayBuffer> {
  const px = new Uint8ClampedArray(new ArrayBuffer(SPRITE_W * SPRITE_H * 4));
  grid.forEach((row, y) => {
    for (let x = 0; x < SPRITE_W; x++) {
      const hex = palette[row[x] ?? '.'];
      if (!hex) continue;
      const i = (y * SPRITE_W + x) * 4;
      px[i] = parseInt(hex.slice(1, 3), 16);
      px[i + 1] = parseInt(hex.slice(3, 5), 16);
      px[i + 2] = parseInt(hex.slice(5, 7), 16);
      px[i + 3] = 255;
    }
  });
  return px;
}
