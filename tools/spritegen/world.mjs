// Ground, map tiles, props and UI pieces. Everything is drawn from code with a
// seeded RNG so output is deterministic.
import { Grid } from './canvas.mjs';

export const TILE = 16;

export function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const hash = (x, y, s = 0) => {
  let h = (x * 374761393 + y * 668265263 + s * 1442695041) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177) >>> 0;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
};

// ---------- ground (strip mode) ----------

/** A 16x16 strip-ground tile: grass lip on top, soil below. Tiles horizontally. */
export function groundTile(style, variant) {
  const g = new Grid(TILE, TILE);
  const r = rng(100 + variant);
  g.rect(0, 0, TILE, TILE, 'd');
  for (let x = 0; x < TILE; x++) {
    const lip = 4 + (hash(x, variant, 7) < 0.3 ? 1 : 0);
    for (let y = 0; y < lip; y++) g.set(x, y, y === 0 ? 'G' : 'g');
    g.set(x, lip, 'D');
    if (hash(x, variant, 9) < 0.35) g.set(x, lip + 1, 'D');
    if (style.snow && hash(x, variant, 3) < 0.55) g.set(x, 0, 'w');
  }
  for (let i = 0; i < 6; i++) {
    const x = Math.floor(r() * 15), y = 7 + Math.floor(r() * 8);
    g.set(x, y, 'p'); if (r() < 0.5) g.set(x + 1, y, 'P');
  }
  for (let i = 0; i < 5; i++) g.set(Math.floor(r() * 16), 1 + Math.floor(r() * 3), 'h');
  return g;
}

// ---------- map tiles ----------

function grassBase(g, style, seed) {
  g.rect(0, 0, TILE, TILE, 'g');
  const r = rng(seed);
  for (let i = 0; i < 14; i++) {
    const x = Math.floor(r() * 16), y = Math.floor(r() * 16);
    g.set(x, y, r() < 0.6 ? 'h' : 'G');
    if (r() < 0.5) g.set(x, y - 1, 'h');
  }
  if (style.snow) for (let i = 0; i < 7; i++) {
    const x = Math.floor(r() * 15), y = Math.floor(r() * 15);
    g.set(x, y, 'w'); if (r() < 0.6) g.set(x + 1, y, 'w');
  }
}

export function grassTile(style, variant) {
  const g = new Grid(TILE, TILE);
  grassBase(g, style, 200 + variant);
  return g;
}

export function flowerTile(style) {
  const g = grassTile(style, 9);
  const r = rng(77);
  for (let i = 0; i < 5; i++) {
    const x = 1 + Math.floor(r() * 13), y = 1 + Math.floor(r() * 13);
    const k = ['f', 'F', 'w'][i % 3];
    g.set(x, y, k); g.set(x - 1, y, k); g.set(x + 1, y, k); g.set(x, y - 1, k); g.set(x, y + 1, 'a');
  }
  return g;
}

// 4-bit neighbour mask: N=1, E=2, S=4, W=8.
function edgeDistance(x, y, mask, round = 4) {
  const dN = mask & 1 ? 99 : y, dS = mask & 4 ? 99 : 15 - y;
  const dW = mask & 8 ? 99 : x, dE = mask & 2 ? 99 : 15 - x;
  let d = Math.min(dN, dS, dW, dE);
  const v = Math.min(dN, dS), h = Math.min(dW, dE);
  if (v < round && h < round) d = Math.min(d, round - Math.hypot(round - v, round - h));
  return d;
}

export function pathTile(style, mask) {
  const g = new Grid(TILE, TILE);
  grassBase(g, style, 300 + mask);
  const inside = (x, y) => {
    if (x < 0 || y < 0 || x > 15 || y > 15) return false;
    const jitter = x > 0 && x < 15 && y > 0 && y < 15 ? (hash(x, y, mask) < 0.25 ? 1 : 0) : 0;
    const lo = 3 + jitter, hi = 12 - jitter;
    const core = x >= lo && x <= hi && y >= lo && y <= hi;
    const n = mask & 1 && y < 8 && x >= lo && x <= hi;
    const s = mask & 4 && y > 7 && x >= lo && x <= hi;
    const w = mask & 8 && x < 8 && y >= lo && y <= hi;
    const e = mask & 2 && x > 7 && y >= lo && y <= hi;
    return core || n || s || w || e;
  };
  for (let y = 0; y < 16; y++)
    for (let x = 0; x < 16; x++) {
      if (!inside(x, y)) continue;
      const edge = [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx > 15 || ny > 15) return false;
        return !inside(nx, ny);
      });
      g.set(x, y, edge ? 'D' : hash(x, y, 40 + mask) < 0.08 ? 'p' : 'd');
    }
  return g;
}

export function waterTile(style, mask, frame = 0) {
  const g = new Grid(TILE, TILE);
  grassBase(g, style, 400 + mask);
  for (let y = 0; y < 16; y++)
    for (let x = 0; x < 16; x++) {
      const d = edgeDistance(x, y, mask);
      if (d < 2) continue;
      if (d < 3) { g.set(x, y, 's'); continue; }
      if (d < 4) { g.set(x, y, 'W'); continue; }
      const ripple = (x + y * 3 + frame * 4) % 11 === 0 && y % 4 === frame % 4;
      g.set(x, y, ripple ? 'W' : hash(x >> 2, y >> 1, frame) < 0.15 ? 'v' : 'u');
    }
  return g;
}

const TREE = [
  '......hhhh......',
  '....hhhhhhhh....',
  '...hhGhhhhhhh...',
  '..hhGGhhhhhhhh..',
  '..hGhhhhhhhhHh..',
  '.hhhhhhhhhhhHHh.',
  '.hhhhhhhhhhHHHh.',
  '.hhhhhhhhhHHHHh.',
  '..hhhhhhhHHHHh..',
  '..HhhhhhHHHHHH..',
  '...HHHHHHHHHH...',
  '.....HHtTHH.....',
  '.......tT.......',
  '.......tT.......',
  '......ttTT......',
  '................',
];
const PINE = [
  '.......h........',
  '......hhh.......',
  '.....hwhhh......',
  '......hhH.......',
  '....hwhhhh......',
  '...hhhhhhHH.....',
  '.....hhhH.......',
  '...hwhhhhhH.....',
  '..hhhhhhhhHHH...',
  '....hhhhhHH.....',
  '..hwhhhhhhhHH...',
  '.hhhhhhhhhhhHHH.',
  '..HHHHHHHHHHHH..',
  '.......tT.......',
  '......ttTT......',
  '................',
];
const BUSH = [
  '................', '................', '................', '................',
  '................', '................', '.....hhhh.......', '...hhGhhhhh.....',
  '..hhGhhhhhhH....', '..hhhhhfhhHHh...', '.hhhhhhhhHHHh...', '.hhfhhhhHHHHH...',
  '..HHhhhHHHHH....', '...HHHHHHHH.....', '................', '................',
];
const ROCK = [
  '................', '................', '................', '................',
  '................', '................', '.......rrr......', '.....rrRrrr.....',
  '....rRrrrrrq....', '...rRrrrrrqqq...', '...rrrrrrqqqq...', '..rrrrrrqqqqqq..',
  '..qqqqqqqqqqqq..', '................', '................', '................',
];
const STUMP = [
  '................', '................', '................', '................',
  '................', '................', '................', '.....tttttt.....',
  '....tTTtTTtt....', '....ttttttttt...', '....TtTTtTtT....', '....TtTTtTtT....',
  '...hTTTTTTTTh...', '................', '................', '................',
];
const RUNESTONE = [
  '................', '......rrrr......', '.....rrrrrr.....', '.....rRrrrrq....',
  '.....rRyrrqq....', '.....rRryrqq....', '.....rRyrrqq....', '.....rRrryqq....',
  '.....rRryrqq....', '.....rRyrrqq....', '.....rRrrrqq....', '.....rrrrrqq....',
  '....hqqqqqqqh...', '................', '................', '................',
];

export function decoTile(style, name) {
  const g = new Grid(TILE, TILE);
  const rows = { tree: style.snow ? PINE : TREE, bush: BUSH, rock: ROCK, stump: STUMP, runestone: RUNESTONE }[name];
  // Decorations are transparent overlays; they get an outline so they read on any ground.
  g.stamp(rows, 0, 0, { map: { h: 'L', H: 'K', G: 'J' } });
  g.outline('o');
  return g;
}

// ---------- props ----------

export function settlement(style) {
  if (style.building === 'burrow') {
    // A house dug into a grassy hill, with a round door and round windows.
    const g = new Grid(40, 28);
    for (let y = 2; y < 27; y++) for (let x = 0; x < 40; x++) {
      const dx = (x - 19.5) / 19.5, dy = (y - 27) / 25;
      if (dx * dx + dy * dy > 1) continue;
      g.set(x, y, hash(x, y, 12) < 0.12 ? 'J' : y < 6 || hash(x, y, 13) < 0.06 ? 'G' : 'L');
    }
    for (let y = 13; y < 27; y++) for (let x = 13; x < 27; x++) if (Math.hypot(x - 19.5, y - 20) < 7) g.set(x, y, 'p');
    for (let y = 14; y < 27; y++) for (let x = 14; x < 26; x++) if (Math.hypot(x - 19.5, y - 20.5) < 5.6) g.set(x, y, 'k');
    for (let y = 15; y < 27; y++) for (let x = 15; x < 25; x++) if (Math.hypot(x - 19.5, y - 20.8) < 4.6) g.set(x, y, x === 19 || x === 20 ? 'K' : 'u');
    g.set(19, 21, 'a'); g.set(20, 21, 'a');
    for (const cx of [7.5, 31.5]) for (let y = 17; y < 23; y++) for (let x = cx - 3; x < cx + 3; x++) {
      const d = Math.hypot(x + 0.5 - cx, y - 19.5);
      if (d < 2.9) g.set(Math.floor(x), y, d < 1.9 ? 'y' : 'p');
    }
    g.rect(28, 0, 2, 6, 'q'); g.set(29, 0, 'v');
    for (let x = 4; x < 36; x++) if (hash(x, 1, 14) < 0.3) g.set(x, 26, 'f');
    g.outline('o');
    return g;
  }
  if (style.building === 'dome') {
    // A glass habitat dome on a steel ring, with an airlock door and a beacon mast.
    const g = new Grid(40, 28);
    for (let y = 3; y < 23; y++) for (let x = 0; x < 40; x++) {
      const dx = (x - 19.5) / 19.5, dy = (y - 23) / 20;
      if (dx * dx + dy * dy > 1) continue;
      const rib = (x + 2) % 9 === 0;
      g.set(x, y, rib ? 'R' : hash(x, y, 21) < 0.08 || (x + y) % 11 === 0 && y < 14 ? 'W' : y < 9 ? 'v' : 'u');
    }
    g.rect(1, 23, 38, 4, 'q'); g.rect(1, 23, 38, 1, 'R'); g.rect(1, 26, 38, 1, 'r');
    for (let x = 4; x < 37; x += 6) g.set(x, 24, 'y');
    g.rect(16, 15, 8, 10, 'r'); g.rect(17, 16, 6, 9, 'e'); g.rect(19, 16, 2, 9, 'u');
    g.rect(16, 14, 8, 1, 'R'); g.set(19, 20, 'y'); g.set(20, 20, 'y');
    for (const cx of [8, 31]) { g.rect(cx, 15, 3, 3, 'y'); g.rect(cx, 15, 3, 1, 'Y'); }
    g.rect(29, 0, 1, 5, 'q'); g.set(29, 0, 'a'); g.set(28, 1, 'R'); g.set(30, 1, 'R');
    g.outline('o');
    return g;
  }
  if (style.building === 'longhouse') {
    const g = new Grid(48, 32);
    // turf roof
    for (let y = 4; y < 17; y++) {
      const inset = Math.max(0, 16 - y) >> 1;
      for (let x = 3 + inset; x < 45 - inset; x++) {
        const k = y < 7 && hash(x, y, 5) < 0.6 ? 'w' : y === 16 ? 'K' : hash(x, y, 6) < 0.18 ? 'J' : 'L';
        g.set(x, y, k);
      }
    }
    // crossed gable boards at both ends
    for (const gx of [4, 43]) for (let i = 0; i < 5; i++) { g.set(gx - i + 2, i, 'T'); g.set(gx + i - 2, i, 'T'); }
    // plank walls
    for (let y = 17; y < 29; y++) for (let x = 5; x < 43; x++) g.set(x, y, x % 4 === 0 ? 'T' : 't');
    g.rect(5, 28, 38, 1, 'T');
    // door and windows
    g.rect(21, 20, 6, 9, 'e'); g.rect(22, 21, 4, 8, 'k'); g.rect(21, 19, 6, 1, 'a');
    g.rect(10, 21, 3, 3, 'y'); g.rect(35, 21, 3, 3, 'y');
    g.set(30, 2, 'v'); g.set(31, 1, 'v'); g.set(30, 0, 'v');
    g.outline('o');
    return g;
  }
  const g = new Grid(32, 32);
  // cottage roof
  for (let y = 4; y < 16; y++) for (let x = 15 - (y - 4) - 2; x <= 16 + (y - 4) + 2; x++) {
    if (x < 1 || x > 30) continue;
    g.set(x, y, y % 3 === 0 ? 'R' : x < 16 ? 'r' : 'R');
  }
  g.rect(22, 3, 3, 6, 'q'); g.rect(22, 3, 3, 1, 'Q');
  g.set(23, 1, 'v'); g.set(24, 0, 'v');
  // walls
  g.rect(4, 16, 24, 13, 't'); g.rect(4, 16, 2, 13, 'T'); g.rect(4, 28, 24, 1, 'T');
  g.rect(14, 20, 5, 9, 'e'); g.rect(15, 21, 3, 8, 'k'); g.set(17, 25, 'a');
  g.rect(7, 19, 4, 4, 'y'); g.rect(22, 19, 4, 4, 'y'); g.rect(8, 21, 2, 1, 'Y'); g.rect(23, 21, 2, 1, 'Y');
  g.outline('o');
  return g;
}

export function tent(style) {
  if (style.building === 'dome') {
    // A small landing pod: half-sphere shell with a lit hatch.
    const g = new Grid(24, 20);
    for (let y = 3; y < 18; y++) for (let x = 0; x < 24; x++) {
      const dx = (x - 11.5) / 11.5, dy = (y - 17.5) / 14.5;
      if (dx * dx + dy * dy <= 1) g.set(x, y, x < 12 ? 'r' : 'q');
    }
    for (let y = 10; y < 18; y++) for (let x = 8; x < 16; x++) if (Math.hypot(x - 11.5, (y - 17.5) * 1.2) < 4.2) g.set(x, y, y < 12 ? 'y' : 'k');
    g.set(11, 1, 'a'); g.set(11, 2, 'q'); g.set(12, 2, 'q');
    g.rect(1, 17, 22, 1, 'R');
    g.outline('o');
    return g;
  }
  const g = new Grid(24, 20);
  for (let y = 3; y < 18; y++) {
    const half = Math.floor((y - 3) * 0.75) + 1;
    for (let x = 12 - half; x <= 11 + half; x++) g.set(x, y, x < 12 ? 't' : 'T');
  }
  for (let y = 9; y < 18; y++) { const half = Math.floor((y - 9) * 0.45); for (let x = 12 - half; x <= 11 + half; x++) g.set(x, y, 'k'); }
  if (style.building === 'longhouse') { g.set(10, 1, 'w'); g.set(11, 2, 'w'); g.set(13, 1, 'w'); g.set(12, 2, 'w'); g.set(9, 0, 'w'); g.set(14, 0, 'w'); }
  else { g.set(12, 1, 'a'); g.set(12, 2, 'a'); g.set(13, 1, 'a'); }
  g.rect(2, 17, 20, 1, 'T');
  g.outline('o');
  return g;
}

const FIRE = [
  ['......y.........', '.....yOy........', '.....OrOy.......', '....yOrrOy......', '....OrrrOy......', '....OryrrO......'],
  ['.......y........', '......yOy.......', '.....yOrOy......', '....yOrrrO......', '....OrryrO......', '....OrrrrO......'],
  ['........y.......', '.....y.yOy......', '.....OyOrO......', '....yOrrrOy.....', '....OrryrOO.....', '....OOrrrrO.....'],
  ['......y.........', '......Oy........', '.....yrOy.......', '....yOrrOy......', '....OrryrO......', '....OrrrrOy.....'],
];

export function campfire(frame) {
  const g = new Grid(TILE, TILE);
  g.stamp(FIRE[frame], 1, 3);
  g.stamp(['...tTttTTt......', '..TttTTtTtT.....', '....q.qq.q......'], 2, 9);
  g.outline('o');
  return g;
}

export function signpost() {
  const g = new Grid(TILE, TILE);
  g.stamp([
    '................', '..tttttttttt....', '..tTTTTTTTTtt...', '..tTtTTtTTTtTt..', '..tTTTTTTTTtt...',
    '..tttttttttt....', '.......tT.......', '.......tT.......', '.......tT.......', '.......tT.......',
    '.......tT.......', '.......tT.......', '......htTh......', '.....hhhhhh.....',
  ], 0, 1, { map: { h: 'L' } });
  g.outline('o');
  return g;
}

export function bannerPole() {
  const g = new Grid(16, 24);
  g.rect(3, 1, 2, 23, 't'); g.rect(4, 1, 1, 23, 'T'); g.rect(2, 0, 4, 1, 'a');
  g.outline('o');
  return g;
}

export function bannerCloth(frame) {
  const g = new Grid(16, 24);
  const wave = frame ? [0, 0, 1, 1, 1, 0, 0, 0, -1, -1] : [0, 0, 0, -1, -1, 0, 0, 1, 1, 1];
  for (let x = 5; x < 15; x++) {
    const off = wave[x - 5];
    const bottom = x > 11 ? 12 - (x - 11) * 2 + off : 13 + off;
    for (let y = 2 + off; y < bottom; y++) g.set(x, y, y === 2 + off || x === 14 ? 'C' : 'c');
  }
  return g;
}

export function glow(size = 32) {
  // Stepped radial alpha in white; the renderer tints it per status.
  const g = new Grid(size, size);
  const c = (size - 1) / 2;
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const d = Math.hypot(x - c, y - c) / (size / 2);
      if (d < 0.25) g.set(x, y, '4'); else if (d < 0.5) g.set(x, y, '3'); else if (d < 0.75) g.set(x, y, '2'); else if (d < 1) g.set(x, y, '1');
    }
  return g;
}

export function pin(ring = false) {
  if (ring) {
    const g = new Grid(9, 9);
    g.stamp(['..ccccc..', '.c.....c.', 'c.......c', 'c.......c', 'c.......c', 'c.......c', 'c.......c', '.c.....c.', '..ccccc..'], 0, 0);
    return g;
  }
  const g = new Grid(7, 7);
  g.stamp(['.......', '..ccc..', '.ccccc.', '.ccccc.', '.ccccc.', '..ccc..', '.......'], 0, 0);
  g.outline('o');
  return g;
}

// Mounts face right. Four walk frames then one idle.
const PONY = [
  '........................',
  '...................ee...',
  '..................mbbb..',
  '.................mmbkbb.',
  '................mmbbbbbb',
  '...............mmbbbbbBk',
  '..............mmbbbB....',
  '.............mmbbbb.....',
  '....tbbbbbbbbbbbbbb.....',
  '...ttbbbbbbbbbbbbbb.....',
  '...ttbbyyyyybbbbbbb.....',
  '...t.bbyYYYybbbbbbB.....',
  '..tt.BBBBBBBBBBBBBB.....',
  '..t...BBBBBBBBBBBB......',
];
const GOAT = [
  '..................hh....',
  '.................h..h...',
  '.................h.bbb..',
  '..................bbkbb.',
  '.................bbbbbbb',
  '................bbbbbbB.',
  '...............bbbbbm...',
  '..............bbbbbmm...',
  '....tbbbbbbbbbbbbbm.....',
  '...ttbbbbbbbbbbbbbb.....',
  '....tbbyyyyybbbbbbb.....',
  '.....bbyYYYybbbbbbB.....',
  '.....BBBBBBBBBBBBBB.....',
  '......BBBBBBBBBBBB......',
];
const MOUNT_LEGS = [
  [[1, 0], [-1, 0], [-1, 0], [1, 0]],
  [[0, 1], [0, 0], [0, 0], [0, 1]],
  [[-1, 0], [1, 0], [1, 0], [-1, 0]],
  [[0, 0], [0, 1], [0, 1], [0, 0]],
  [[0, 0], [0, 0], [0, 0], [0, 0]],
];

export function mount(style, frame) {
  const g = new Grid(24, 20);
  const bob = frame === 1 || frame === 3 ? -1 : 0;
  const body = style.mount === 'goat' ? GOAT : PONY;
  const xs = [6, 9, 14, 17];
  MOUNT_LEGS[frame].forEach(([dx, lift], i) => {
    const k = i === 1 || i === 2 ? 'B' : 'b';
    for (let y = 14 + bob; y <= 17 - lift; y++) g.set(xs[i] + (y >= 16 - lift ? dx : 0), y, k), g.set(xs[i] + 1 + (y >= 16 - lift ? dx : 0), y, k);
    g.set(xs[i] + dx, 18 - lift, 'k'); g.set(xs[i] + 1 + dx, 18 - lift, 'k');
  });
  g.stamp(body, 0, 1 + bob);
  g.outline('o');
  return g;
}

// ---------- UI ----------

export function bubble(style) {
  const g = new Grid(24, 24);
  if (style.ui === 'parchment') {
    g.stamp([
      '..oooooooooooooooooooo..',
      '.oaTTTTTTTTTTTTTTTTTTao.',
      'oaTttttttttttttttttttTao',
      'oTtppppppppppppppppppptTo',
    ].map((r) => r.slice(0, 24)), 0, 0);
    for (let y = 4; y < 20; y++) g.stamp(['oTtp' + 'p'.repeat(16) + 'ptTo'], 0, y);
    g.stamp(['oTtppppppppppppppppppptTo'.slice(0, 24), 'oaTttttttttttttttttttTao', '.oaTTTTTTTTTTTTTTTTTTao.', '..oooooooooooooooooooo..'], 0, 20);
    for (let y = 4; y < 20; y++) for (let x = 4; x < 20; x++) if (hash(x, y, 11) < 0.06) g.set(x, y, 'P');
    return g;
  }
  g.stamp(['....oooooooooooooooo....', '..oowwwwwwwwwwwwwwwwoo..', '.owwwwwwwwwwwwwwwwwwwwo.', '.owwwwwwwwwwwwwwwwwwwwo.'], 0, 0);
  for (let y = 4; y < 20; y++) g.stamp(['owwwwwwwwwwwwwwwwwwwwwwo'], 0, y);
  g.stamp(['.owwwwwwwwwwwwwwwwwwwwo.', '.oWwwwwwwwwwwwwwwwwwwWo.', '..ooWWWWWWWWWWWWWWWWoo..', '....oooooooooooooooo....'], 0, 20);
  return g;
}

export function bubbleTail(style) {
  const g = new Grid(8, 6);
  const fill = style.ui === 'parchment' ? 'p' : 'w';
  g.stamp(['offfffo.', '.offfo..', '.offo...', '..oo....', '..o.....', '........'].map((r) => r.replaceAll('f', fill)), 0, 0);
  return g;
}

export function nameplate(style) {
  const g = new Grid(16, 12);
  const [f, F] = style.ui === 'parchment' ? ['t', 'T'] : ['n', 'N'];
  g.stamp(['.oooooooooooooo.', 'offffffffffffffo', 'ofFFFFFFFFFFFFfo'].map((r) => r.replaceAll('f', f).replaceAll('F', F)), 0, 0);
  for (let y = 3; y < 9; y++) g.stamp([`o${F}${f.repeat(12)}${F}o`], 0, y);
  g.stamp([`o${F}${F.repeat(12)}${F}o`, `o${F.repeat(14)}o`, '.oooooooooooooo.'], 0, 9);
  if (style.ui === 'parchment') { g.set(1, 1, 'a'); g.set(14, 1, 'a'); g.set(1, 10, 'a'); g.set(14, 10, 'a'); }
  return g;
}

export function minimapFrame(style) {
  const g = new Grid(32, 32);
  const [f, F, hi] = style.ui === 'parchment' ? ['t', 'T', 'a'] : ['n', 'N', 'w'];
  for (let y = 0; y < 32; y++) for (let x = 0; x < 32; x++) {
    const d = Math.min(x, y, 31 - x, 31 - y);
    if (d === 0) { if (!((x === 0 || x === 31) && (y === 0 || y === 31))) g.set(x, y, 'o'); }
    else if (d < 4) g.set(x, y, d === 1 ? hi : d === 3 ? F : f);
    else if (d === 4) g.set(x, y, 'o');
  }
  if (style.ui === 'parchment') for (const [x, y] of [[2, 2], [29, 2], [2, 29], [29, 29], [15, 2], [15, 29], [2, 15], [29, 15]]) g.rect(x, y, 2, 2, 'a');
  return g;
}

const ICONS = {
  working: ['..ooooo..', '.occcccо.', 'occocccco', 'occcoccco', 'occccocco', 'occcccoco', 'occcccco.', '.occcccco', '..ooooo..'],
  done: ['..ooooo..', '.occcccco', 'occcccwco', 'occcccwco', 'owccwccco', 'occwwccco', 'occcwccco', '.occcccco', '..ooooo..'],
  blocked: ['..ooooo..', '.occwccco', 'occcwccco', 'occcwccco', 'occcwccco', 'occcccco.', 'occcwccco', '.occcccco', '..ooooo..'],
  idle: ['..ooooo..', '.occcccco', 'ocwwwwcco', 'occccwcco', 'occcwccco', 'occwcccco', 'ocwwwwcco', '.occcccco', '..ooooo..'],
  unknown: ['..ooooo..', '.occwwcco', 'occwccwco', 'occcccwco', 'occccwcco', 'occcwccco', 'occcccco.', '.occcwcco', '..ooooo..'],
};

export function statusIcon(name) {
  const g = new Grid(9, 9);
  const rows = ICONS[name].map((r) => r.replace(/о/g, 'o').padEnd(9, '.'));
  // Clean round shape: re-stamp a fixed disc then the glyph.
  const disc = ['..ooooo..', '.occcccо.', 'occcccccо', 'occcccccо', 'occcccccо', 'occcccccо', 'occcccccо', '.occcccо.', '..ooooo..'].map((r) => r.replace(/о/g, 'o'));
  g.stamp(disc, 0, 0);
  if (name === 'done') for (const [x, y] of [[2, 4], [3, 5], [4, 6], [5, 5], [6, 4], [7, 3]]) g.set(x, y, 'w');
  else rows.forEach((r, y) => [...r].forEach((k, x) => { if (k === 'w') g.set(x, y, 'w'); }));
  if (name === 'working') {
    g.stamp(['.........', '.........', '..w...w..', '...w.w...', '....w....', '...w.w...', '..w...w..', '.........', '.........'].map(() => '.........'), 0, 0);
    for (const [x, y] of [[4, 2], [4, 6], [2, 4], [6, 4], [3, 3], [5, 5], [5, 3], [3, 5]]) g.set(x, y, 'w');
    g.set(4, 4, 'c');
  }
  return g;
}
