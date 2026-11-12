// Camp scene art: the clearing floor, a campfire (or an energy core), activity stations,
// effects, git props and scenery. Everything is drawn from code like the rest of the
// world art, and every piece comes in two flavours chosen by the pack's `camp.tone`:
// 'camp' (wood, iron and canvas) and 'outpost' (plating, holograms and pods).
import { Grid } from './canvas.mjs';
import { rng } from './world.mjs';

const hash = (x, y, s = 0) => {
  let h = (x * 374761393 + y * 668265263 + s * 1442695041) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177) >>> 0;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
};

function ell(g, cx, cy, rx, ry, k, fn) {
  for (let y = Math.floor(cy - ry); y <= Math.ceil(cy + ry); y++)
    for (let x = Math.floor(cx - rx); x <= Math.ceil(cx + rx); x++) {
      const dx = (x - cx) / rx, dy = (y - cy) / ry;
      if (dx * dx + dy * dy <= 1) g.set(x, y, fn ? fn(x, y, dx, dy) : k);
    }
}

function line(g, x0, y0, x1, y1, k) {
  const n = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0), 1);
  for (let i = 0; i <= n; i++) g.set(Math.round(x0 + ((x1 - x0) * i) / n), Math.round(y0 + ((y1 - y0) * i) / n), k);
}

/** Extra palette keys the camp art uses, on top of the pack's world palette. */
export function campPalette(style, tech) {
  return {
    ...style.palette,
    ...(tech
      ? { x: '#2a90ff', O: '#5ae8ff', z: '#b8f8ff', Z: '#ffffff' }
      : { x: '#e8402a', O: '#ff9a2a', z: '#ffe36a', Z: '#fff6c0' }),
    M: '#7c8396', H: '#b8c0d0', S: '#454b5e',
    U: tech ? '#5ae8ff' : '#8a64d8', V: tech ? '#c4faff' : '#c8b0ff',
    Q: tech ? '#4ae0ff' : '#72d05a', X: '#f4e8c6', I: '#6a4a30', j: '#ff4d5e', l: '#ffffff',
  };
}

// ---------- floor ----------

export function floorTile(tech, variant) {
  const g = new Grid(16, 16);
  if (tech) {
    g.rect(0, 0, 16, 16, 'r');
    g.rect(0, 0, 16, 1, 'R'); g.rect(0, 0, 1, 16, 'R');
    g.rect(0, 15, 16, 1, 'q'); g.rect(15, 0, 1, 16, 'q');
    for (const [x, y] of [[2, 2], [13, 2], [2, 13], [13, 13]]) g.set(x, y, 'M');
    if (variant === 1) { g.rect(5, 7, 6, 2, 'q'); g.rect(6, 7, 4, 1, 'U'); }
    if (variant === 2) { g.rect(4, 4, 8, 8, 'R'); g.rect(5, 5, 6, 6, 'r'); }
    if (variant === 3) for (let i = 0; i < 4; i++) g.set(4 + i * 3, 8, 'q');
    return g;
  }
  g.rect(0, 0, 16, 16, 'd');
  const r = rng(900 + variant);
  for (let i = 0; i < 16; i++) g.set(Math.floor(r() * 16), Math.floor(r() * 16), r() < 0.5 ? 'D' : 'p');
  for (let i = 0; i < 3; i++) { const x = Math.floor(r() * 14), y = Math.floor(r() * 14); g.set(x, y, 'P'); g.set(x + 1, y, 'p'); }
  return g;
}

// ---------- the fire ----------

function flame(g, cx, base, h, w, sway, keys) {
  for (let i = 0; i < h; i++) {
    const t = i / (h - 1);
    const half = Math.max(0, Math.round(w * Math.sin(Math.PI * Math.pow(1 - t, 0.62) * 0.92)));
    const off = Math.round(sway * t * t);
    for (let x = -half; x <= half; x++) {
      const inner = Math.abs(x) <= Math.max(0, half - 2) && t < 0.8;
      const core = Math.abs(x) <= Math.max(0, half - 4) && t < 0.55;
      g.set(cx + x + off, base - i, core ? keys[3] : inner ? keys[2] : t < 0.7 ? keys[1] : keys[0]);
    }
  }
}

export function fire(tech, frame) {
  const g = new Grid(44, 40);
  if (tech) {
    // A floating energy core above a plated ring.
    ell(g, 22, 35, 17, 5, 'S');
    ell(g, 22, 34, 17, 5, 'M');
    ell(g, 22, 34, 13, 3.4, 'S');
    ell(g, 22, 33, 9, 2, 'H');
    for (const x of [7, 37]) { g.rect(x - 1, 24, 3, 10, 'M'); g.set(x, 23, frame % 2 ? 'U' : 'V'); }
    g.outline('o');
    const bob = [0, -1, -1, 0][frame];
    const r = [7, 8, 8, 7][frame];
    ell(g, 22, 19 + bob, r + 3, r + 3, 'x');
    ell(g, 22, 19 + bob, r + 1, r + 1, 'O');
    ell(g, 22, 19 + bob, r - 1, r - 1, 'z');
    ell(g, 22, 19 + bob, r - 4, r - 4, 'Z');
    line(g, 7, 24, 22, 22 + bob, frame % 2 ? 'U' : 'x');
    line(g, 37, 24, 22, 22 + bob, frame % 2 ? 'x' : 'U');
    for (const [x, y] of [[[22, 6], [30, 10]], [[22, 4], [14, 9]], [[26, 5], [16, 8]], [[19, 6], [29, 8]]][frame]) g.set(x, y, 'z');
    return g;
  }
  // Stone ring, crossed logs, then the flame on top.
  ell(g, 22, 35, 18, 5, 'q');
  ell(g, 22, 34, 18, 5, 'r');
  ell(g, 22, 35, 13, 3.2, 'D');
  for (let a = 0; a < 12; a++) {
    const t = (a / 12) * Math.PI * 2;
    const sx = Math.round(22 + Math.cos(t) * 17), sy = Math.round(34.5 + Math.sin(t) * 4.4);
    g.rect(sx - 1, sy - 1, 4, 3, a % 2 ? 'R' : 'r');
  }
  g.stamp(['..tTtttt......ttTtt..', '...TttTttTTTttTtTt...'], 12, 31);
  g.stamp(['.TtT.TtTTt.'], 16, 33);
  g.outline('o');
  const keys = ['x', 'O', 'z', 'Z'];
  const h = [21, 24, 19, 23][frame];
  const sway = [-2, 0, 2, 0][frame];
  flame(g, 22, 32, h, 7, sway, keys);
  flame(g, 14, 31, 10 + (frame % 2) * 2, 3, -sway, keys.slice(0, 3));
  flame(g, 30, 31, 9 + ((frame + 1) % 2) * 2, 3, sway, keys.slice(0, 3));
  // Embers drifting up.
  const e = [[[16, 8], [28, 11]], [[18, 5], [27, 8]], [[15, 9], [29, 6]], [[19, 6], [25, 10]]][frame];
  for (const [x, y] of e) g.set(x, y, frame % 2 ? 'z' : 'O');
  return g;
}

// ---------- stations ----------

const SZ = 32;
const station = () => new Grid(SZ, SZ);

/** Anvil on a stump (camp) or a fabricator bench with a welding arm (outpost). Sparks fly. */
export function stEdit(tech, f) {
  const g = station();
  if (tech) {
    g.rect(5, 22, 22, 9, 'S'); g.rect(5, 22, 22, 2, 'M'); g.rect(7, 25, 18, 1, 'q'); g.rect(8, 27, 3, 2, 'a'); g.rect(14, 27, 3, 2, 'U');
    g.rect(5, 20, 22, 3, 'H');
    g.rect(21, 10, 3, 11, 'M'); g.rect(14, 9, 10, 3, 'M'); g.rect(13, 12, 3, 5, 'S');
    g.set(14, 17, f % 2 ? 'V' : 'U');
    g.outline('o');
    const sp = [[[14, 18]], [[11, 17], [17, 16], [14, 14]], [[9, 15], [19, 14], [14, 11]], [[8, 18], [20, 17]]][f];
    for (const [x, y] of sp) g.set(x, y, f === 3 ? 'U' : 'V');
    if (f === 0) g.set(14, 18, 'Z');
    return g;
  }
  ell(g, 16, 28, 8, 3, 'T');
  g.rect(8, 22, 16, 7, 't'); g.rect(8, 22, 16, 1, 'p'); g.rect(20, 23, 4, 6, 'T');
  ell(g, 16, 22, 8, 2, 'p');
  g.stamp([
    '.HHHHHHHHHHHHHHH.',
    'HHHHHHHHHHHHHHHHM',
    '.MMMMMMMMMMMMMMM.',
    '....MMMMMMMMM....',
    '.....SSSSSSS.....',
    '....SSSSSSSSS....',
  ], 7, 14);
  g.outline('o');
  const sp = [[[16, 12, 'Z']], [[12, 10, 'z'], [20, 11, 'z'], [16, 8, 'Z']], [[9, 8, 'O'], [22, 8, 'z'], [16, 5, 'O']], [[8, 11, 'x'], [24, 10, 'O']]][f];
  for (const [x, y, k] of sp) g.set(x, y, k);
  return g;
}

/** A lectern with an open book whose page turns (camp), or a holo-lectern with scrolling text (outpost). */
export function stRead(tech, f) {
  const g = station();
  if (tech) {
    g.rect(14, 18, 4, 11, 'S'); g.rect(10, 28, 12, 3, 'M'); g.rect(11, 28, 10, 1, 'H');
    g.rect(9, 15, 14, 4, 'M'); g.rect(9, 15, 14, 1, 'H');
    g.outline('o');
    // Hologram panel above the emitter, rows of text scrolling upward.
    g.rect(6, 1, 20, 13, 'U');
    g.rect(7, 2, 18, 11, 'S');
    for (let r = 0; r < 4; r++) {
      const y = 3 + ((r * 3 + f * 1) % 11);
      const w = 6 + ((r * 5 + 3) % 9);
      if (y < 12) g.rect(8, y, w, 1, r % 2 ? 'U' : 'V');
    }
    return g;
  }
  g.rect(14, 19, 4, 11, 't'); g.rect(17, 19, 1, 11, 'T'); g.rect(10, 29, 12, 2, 'T'); g.rect(10, 29, 12, 1, 't');
  g.outline('o');
  // The book, open on the slope of the lectern.
  const book = new Grid(24, 14);
  book.rect(1, 3, 22, 10, 'I'); book.rect(2, 2, 10, 9, 'X'); book.rect(13, 2, 9, 9, 'X'); book.rect(12, 2, 1, 9, 'I');
  for (let r = 0; r < 4; r++) { book.rect(3, 3 + r * 2, 7, 1, 'k'); book.rect(14, 3 + r * 2, 6, 1, 'k'); }
  if (f === 1) { book.rect(13, 2, 9, 9, 'I'); book.rect(12, 0, 3, 11, 'X'); book.rect(12, 0, 1, 11, 'S'); book.rect(15, 3, 6, 6, 'X'); }
  if (f === 2) { book.rect(2, 2, 10, 9, 'I'); book.rect(3, 1, 9, 9, 'X'); for (let r = 0; r < 3; r++) book.rect(4, 3 + r * 2, 6, 1, 'k'); }
  book.outline('o');
  g.blit(book, 4, 6);
  return g;
}

/** An iron pot of bubbling stew over a small fire (camp), or a glass vat (outpost). */
export function stShell(tech, f) {
  const g = station();
  if (tech) {
    g.rect(7, 26, 18, 5, 'S'); g.rect(7, 26, 18, 1, 'M'); g.rect(9, 29, 3, 1, 'a');
    g.rect(8, 8, 16, 18, 'W');
    g.rect(9, 9, 14, 16, 'S');
    g.rect(9, 14, 14, 11, 'Q');
    g.rect(9, 14, 14, 1, 'V');
    g.rect(7, 6, 18, 3, 'M'); g.rect(7, 6, 18, 1, 'H');
    g.outline('o');
    for (const [x, y] of [[[12, 22], [18, 19]], [[13, 19], [19, 22], [16, 16]], [[12, 16], [17, 21]], [[18, 17], [13, 23], [20, 20]]][f]) g.set(x, y, 'V');
    return g;
  }
  // Little fire under the pot.
  g.stamp(['.TtTtTtT.'], 11, 29);
  g.rect(13, 26, 6, 3, 'x'); g.rect(14, 25, 4, 3, 'O'); g.set(15 + (f % 2), 24, 'z');
  // Pot.
  ell(g, 16, 18, 10, 9, 'S', (x, y, dx, dy) => (dx > 0.3 ? 'S' : dx < -0.3 ? 'M' : 'S'));
  ell(g, 16, 13, 10, 3, 'H');
  ell(g, 16, 13, 8, 2, 'Q');
  g.rect(5, 12, 2, 2, 'S'); g.rect(25, 12, 2, 2, 'S');
  g.outline('o');
  const b = [[[13, 13], [19, 12]], [[14, 12], [18, 13], [16, 11]], [[13, 12], [20, 13]], [[15, 13], [18, 12], [12, 12]]][f];
  for (const [x, y] of b) g.set(x, y, 'V');
  // Steam curls.
  const st = [[[14, 8], [15, 6], [14, 4]], [[16, 7], [17, 5], [16, 3]], [[15, 8], [14, 6], [15, 4]], [[17, 8], [16, 6], [17, 4]]][f];
  for (const [x, y] of st) { g.set(x, y, '3'); g.set(x + 1, y, '2'); }
  return g;
}

/** A lookout post with a brass spyglass and a pennant (camp), or a sweeping radar dish (outpost). */
export function stSearch(tech, f) {
  const g = station();
  if (tech) {
    g.rect(14, 16, 4, 14, 'S'); g.rect(10, 28, 12, 3, 'M'); g.rect(10, 28, 12, 1, 'H');
    g.rect(12, 14, 8, 3, 'M');
    g.outline('o');
    // Dish tilts through four angles.
    const tilt = [-3, -1, 1, -1][f];
    ell(g, 16, 8, 9, 5, 'H', (x, y, dx, dy) => (dy > 0.2 ? 'M' : 'H'));
    ell(g, 16, 8 + tilt / 2, 6, 3, 'S');
    g.outline('o');
    line(g, 16, 8, 16 + 2 * tilt, 0, 'M');
    g.set(16 + 2 * tilt, 0, f % 2 ? 'j' : 'a');
    return g;
  }
  g.rect(14, 8, 3, 22, 't'); g.rect(16, 8, 1, 22, 'T');
  g.rect(8, 28, 15, 3, 'T'); g.rect(8, 28, 15, 1, 't');
  g.rect(11, 15, 9, 2, 'T'); g.rect(11, 15, 9, 1, 't');
  g.outline('o');
  // Pennant.
  const flap = [[0, 1, 2, 1], [0, 0, 1, 2], [0, 1, 1, 2], [0, 0, 2, 1]][f];
  g.rect(15, 0, 1, 3, 'T');
  for (let i = 0; i < 4; i++) g.rect(17 + i * 2, 1 + (i ? flap[i] % 2 : 0), 2, 3 - Math.min(2, i), 'x');
  g.outline('o');
  // Spyglass resting on the crossbar.
  const ang = [[0, 0], [0, -1], [0, 0], [0, 1]][f];
  line(g, 10, 20, 24, 12 + ang[1], 'a');
  line(g, 10, 21, 24, 13 + ang[1], 'Y');
  g.rect(24, 11 + ang[1], 2, 4, 'y');
  g.outline('o');
  return g;
}

/** A table with a map, a route and waving flags (camp), or a holo-table with blips (outpost). */
export function stDelegate(tech, f) {
  const g = station();
  if (tech) {
    g.rect(4, 20, 24, 3, 'H'); g.rect(6, 23, 20, 8, 'S'); g.rect(6, 23, 20, 1, 'M'); g.rect(8, 27, 4, 2, 'U'); g.rect(20, 27, 4, 2, 'a');
    g.outline('o');
    ell(g, 16, 14, 11, 4, 'U');
    ell(g, 16, 14, 9, 3, 'S');
    ell(g, 16, 14, 4, 1.5, 'U');
    const blips = [[[10, 13], [21, 15]], [[11, 14], [22, 13]], [[12, 15], [20, 12]], [[13, 14], [19, 15]]][f];
    for (const [x, y] of blips) { g.set(x, y, 'V'); g.set(x + 1, y, 'U'); }
    g.rect(15, 5, 2, 8, '2');
    return g;
  }
  g.rect(4, 20, 24, 3, 'p'); g.rect(4, 20, 24, 1, 'X'); g.rect(4, 23, 24, 1, 'P');
  g.rect(6, 23, 3, 8, 't'); g.rect(23, 23, 3, 8, 't'); g.rect(6, 23, 1, 8, 'T'); g.rect(23, 23, 1, 8, 'T');
  g.rect(6, 17, 20, 4, 'X'); g.rect(6, 17, 20, 1, 'p');
  g.outline('o');
  // Map marks: a winding route and an X.
  for (const [x, y] of [[8, 19], [10, 18], [12, 19], [15, 18], [18, 19], [20, 18]]) g.set(x, y, 'k');
  g.set(22, 19, 'x'); g.set(23, 18, 'x'); g.set(23, 19, 'x'); g.set(22, 18, 'x');
  // A flag on a pin that waves.
  g.rect(12, 8, 1, 10, 'T');
  const flap = [[0, 0], [1, 1], [2, 0], [1, -1]][f];
  for (let i = 0; i < 5; i++) g.rect(13 + i, 8 + (i === 0 ? 0 : Math.round(flap[0] * (i / 4)) % 2), 1, 5 - i, 'x');
  g.outline('o');
  return g;
}

/** An easel with chalk scribbles that grow (camp), or a holo-board filling with text (outpost). */
export function stThink(tech, f) {
  const g = station();
  const prog = [4, 8, 12, 15][f];
  if (tech) {
    g.rect(14, 22, 4, 8, 'S'); g.rect(9, 29, 14, 2, 'M');
    g.outline('o');
    g.rect(3, 2, 26, 19, 'U'); g.rect(4, 3, 24, 17, 'S');
    for (let r = 0; r < 4; r++) g.rect(6, 5 + r * 4, Math.min(20, prog + r * 2), 1, r % 2 ? 'U' : 'V');
    g.set(6 + Math.min(20, prog + 8), 17, f % 2 ? 'V' : 'S');
    return g;
  }
  line(g, 9, 30, 13, 19, 't'); line(g, 22, 30, 18, 19, 't'); line(g, 16, 30, 16, 20, 'T');
  g.outline('o');
  g.rect(3, 2, 26, 19, 'I'); g.rect(4, 3, 24, 17, 'S');
  g.rect(3, 2, 26, 1, 't');
  // Chalk: a loop-the-loop line that gets longer, plus a question mark that blinks.
  for (let x = 0; x < prog; x++) g.set(6 + x, 12 - Math.round(Math.sin(x * 0.7) * 3), 'w');
  if (f % 2 === 0) { g.set(22, 6, 'w'); g.set(23, 6, 'w'); g.set(23, 7, 'w'); g.set(22, 8, 'w'); g.set(22, 10, 'w'); }
  g.outline('o');
  return g;
}

/** A signal lamp that flashes: lit red, then dim. */
export function stBlocked(tech, f) {
  const g = station();
  g.rect(15, 12, 3, 18, tech ? 'S' : 't'); g.rect(11, 29, 11, 2, tech ? 'M' : 'T');
  g.rect(11, 3, 11, 10, tech ? 'M' : 'a'); g.rect(12, 4, 9, 8, f ? 'j' : 'k');
  if (f) { g.rect(14, 6, 5, 3, 'Z'); g.set(16, 5, 'x'); }
  g.rect(10, 2, 13, 2, tech ? 'H' : 'S'); g.set(15, 1, tech ? 'H' : 'S');
  g.outline('o');
  return g;
}

/** A log (camp) or a bench (outpost) in front of a sitting member's legs. */
export function seat(tech) {
  const g = new Grid(30, 9);
  if (tech) {
    g.rect(1, 1, 28, 4, 'M'); g.rect(1, 1, 28, 1, 'H'); g.rect(3, 5, 2, 3, 'S'); g.rect(25, 5, 2, 3, 'S'); g.rect(5, 4, 20, 1, 'S');
    g.outline('o');
    return g;
  }
  g.rect(2, 1, 26, 6, 't'); g.rect(2, 1, 26, 1, 'p'); g.rect(2, 5, 26, 2, 'T');
  ell(g, 3, 4, 2, 3, 'p'); ell(g, 3, 4, 1, 2, 'P');
  ell(g, 27, 4, 2, 3, 'p'); ell(g, 27, 4, 1, 2, 'P');
  for (const x of [9, 16, 21]) g.set(x, 3, 'T');
  g.outline('o');
  return g;
}

// ---------- effects ----------

function glyph(rows, keyFill, keyEdge) {
  const w = Math.max(...rows.map((r) => r.length));
  const g = new Grid(w + 2, rows.length + 2);
  g.stamp(rows, 1, 1, { map: { '#': keyFill } });
  g.outline(keyEdge);
  return g;
}

export function fxAlert(f) {
  const g = new Grid(14, 18);
  g.rect(1, 1, 12, 13, 'o'); g.rect(2, 2, 10, 11, f ? 'j' : 'w');
  g.stamp(['.', '.'], 0, 0);
  g.set(5, 14, 'o'); g.set(6, 14, 'o'); g.set(6, 15, 'o'); g.set(5, 15, 'o'); g.set(6, 16, 'o');
  g.set(5, 14, f ? 'j' : 'w'); g.set(6, 14, f ? 'j' : 'w');
  const ink = f ? 'w' : 'j';
  g.rect(6, 3, 2, 5, ink); g.rect(6, 10, 2, 2, ink);
  return g;
}

export function fxQuestion() {
  const g = new Grid(14, 18);
  g.rect(1, 1, 12, 13, 'o'); g.rect(2, 2, 10, 11, 'w');
  g.set(5, 14, 'o'); g.set(6, 14, 'o'); g.set(6, 15, 'o'); g.set(6, 16, 'o'); g.set(5, 14, 'w'); g.set(6, 14, 'w');
  g.stamp(['.####.', '.#..#.', '....#.', '...#..', '..#...', '......', '..#...'], 4, 3, { map: { '#': 'M' } });
  return g;
}

export function fxZzz(size) {
  const n = [4, 5, 7][size];
  const g = new Grid(n + 2, n + 2);
  g.rect(1, 1, n, 1, 'w'); g.rect(1, n, n, 1, 'w');
  for (let i = 0; i < n; i++) g.set(1 + n - 1 - i, 1 + i, 'w');
  g.outline('o');
  return g;
}

export function fxSweat() {
  return glyph(['.#.', '.#.', '###', '###', '.#.'], 'W', 'o');
}

// ---------- git ----------

export function crate(tech, variant) {
  const g = new Grid(16, 14);
  if (tech) {
    g.rect(1, 1, 14, 12, variant ? 'M' : 'S'); g.rect(1, 1, 14, 2, 'H'); g.rect(1, 5, 14, 1, 'q'); g.rect(1, 9, 14, 1, 'q');
    g.rect(6, 6, 4, 3, variant ? 'a' : 'U');
    g.outline('o');
    return g;
  }
  if (variant) {
    g.rect(1, 1, 14, 12, 'p'); g.rect(1, 1, 14, 1, 'X');
    for (const y of [4, 7, 10]) g.rect(1, y, 14, 1, 'P');
    g.rect(1, 12, 14, 1, 'P'); g.rect(3, 1, 2, 12, 'T'); g.rect(11, 1, 2, 12, 'T');
    g.outline('o');
    return g;
  }
  const a = 't', b = 'T';
  g.rect(1, 1, 14, 12, a); g.rect(1, 1, 14, 1, 'p');
  g.rect(1, 12, 14, 1, b);
  for (let i = 0; i < 13; i++) { g.set(1 + i, 2 + Math.floor(i * 10 / 13), b); g.set(14 - i, 2 + Math.floor(i * 10 / 13), b); }
  g.rect(1, 1, 1, 12, b); g.rect(14, 1, 1, 12, b);
  g.outline('o');
  return g;
}

export function cart(tech, loaded) {
  const g = new Grid(40, 26);
  if (tech) {
    g.rect(4, 8, 30, 8, 'M'); g.rect(4, 8, 30, 2, 'H'); g.rect(4, 15, 30, 2, 'S');
    g.rect(34, 6, 4, 2, 'S'); g.rect(36, 4, 2, 3, 'S');
    g.rect(8, 19, 22, 2, 'U'); g.rect(10, 20, 18, 1, 'V');
    g.outline('o');
    if (loaded) { g.rect(7, 1, 10, 7, 'a'); g.rect(7, 1, 10, 1, 'Y'); g.rect(19, 3, 11, 5, 'U'); g.rect(19, 3, 11, 1, 'V'); g.outline('o'); }
    return g;
  }
  g.rect(3, 9, 28, 8, 't'); g.rect(3, 9, 28, 2, 'p'); g.rect(3, 15, 28, 2, 'T');
  for (const x of [8, 14, 20, 26]) g.rect(x, 10, 1, 6, 'T');
  g.rect(31, 7, 8, 2, 'T'); g.rect(36, 9, 2, 8, 'T');
  ell(g, 13, 19, 5, 5, 'k'); ell(g, 13, 19, 2, 2, 'p');
  g.rect(33, 17, 3, 6, 'T');
  g.outline('o');
  if (loaded) {
    ell(g, 10, 7, 7, 5, 'X', (x, y, dx, dy) => (dy > 0.4 || dx > 0.5 ? 's' : 'X'));
    ell(g, 21, 6, 7, 5, 's', (x, y, dx, dy) => (dy > 0.4 || dx > 0.5 ? 'p' : 's'));
    g.rect(9, 5, 3, 1, 'k'); g.rect(20, 4, 3, 1, 'k');
    g.rect(24, 2, 4, 5, 'w'); g.rect(24, 2, 4, 1, 'X'); g.outline('o');
  }
  return g;
}

// ---------- scenery ----------

export function tall(style, tech, variant) {
  if (tech) {
    const g = new Grid(20, 44);
    g.rect(7, 8, 6, 34, variant ? 'M' : 'S'); g.rect(7, 8, 2, 34, 'H');
    g.rect(5, 38, 10, 5, 'S'); g.rect(5, 38, 10, 1, 'M');
    g.rect(8, 14, 4, 1, 'U'); g.rect(8, 22, 4, 1, 'U'); g.rect(8, 30, 4, 1, 'U');
    g.rect(6, 4, 8, 5, 'M'); g.rect(8, 1, 4, 3, 'a');
    g.outline('o');
    return g;
  }
  const g = new Grid(32, 44);
  const r = rng(40 + variant);
  if (style.snow) {
    // A snowy pine in tiers.
    g.rect(14, 34, 4, 9, 't'); g.rect(17, 34, 1, 9, 'T');
    for (let tier = 0; tier < 4; tier++) {
      const top = 2 + tier * 8, half = 5 + tier * 3;
      for (let y = 0; y < 11; y++) {
        const w = Math.round((half * (y + 1)) / 11);
        for (let x = -w; x <= w; x++) g.set(16 + x, top + y, x < -w * 0.2 ? 'J' : x > w * 0.3 ? 'K' : 'L');
        if (y < 3) for (let x = -w; x <= w; x++) if (hash(x, y + tier * 11, variant) < 0.8) g.set(16 + x, top + y, 'w');
      }
    }
    g.outline('o');
    return g;
  }
  // A round-crowned tree.
  g.rect(13, 28, 6, 15, 't'); g.rect(17, 28, 2, 15, 'T'); g.rect(11, 40, 10, 3, 't');
  ell(g, 16, 16, 14 - variant, 13 - variant, 'L', (x, y, dx, dy) => (dx + dy < -0.5 ? 'J' : dx + dy > 0.4 ? 'K' : 'L'));
  for (let i = 0; i < 12; i++) {
    const x = 5 + Math.floor(r() * 22), y = 5 + Math.floor(r() * 22);
    if (g.get(x, y) != null) g.set(x, y, r() < 0.5 ? 'J' : 'K');
  }
  g.outline('o');
  return g;
}

export function low(style, tech, variant) {
  const g = new Grid(18, 14);
  if (tech) {
    if (variant) { g.rect(2, 3, 14, 10, 'S'); g.rect(2, 3, 14, 2, 'M'); g.rect(4, 7, 10, 1, 'U'); }
    else { ell(g, 9, 8, 6, 5, 'M'); g.rect(3, 4, 12, 2, 'H'); g.rect(8, 1, 2, 3, 'S'); g.set(9, 0, 'a'); }
    g.outline('o');
    return g;
  }
  if (variant) {
    ell(g, 9, 8, 8, 5, 'r', (x, y, dx, dy) => (dx + dy < -0.3 ? 'R' : dx + dy > 0.4 ? 'q' : 'r'));
    if (style.snow) g.rect(5, 3, 8, 2, 'w');
    g.outline('o');
    return g;
  }
  ell(g, 9, 8, 8, 5, 'L', (x, y, dx, dy) => (dx + dy < -0.3 ? 'J' : dx + dy > 0.4 ? 'K' : 'L'));
  for (const [x, y] of [[5, 6], [11, 5], [8, 9], [13, 8]]) g.set(x, y, style.snow ? 'w' : variant ? 'F' : 'f');
  g.outline('o');
  return g;
}

/** A bigger tent for the camp: a canvas A-frame (camp) or a landing pod with a lit hatch (outpost). */
export function bigTent(style, tech) {
  if (tech) {
    const g = new Grid(44, 34);
    for (let y = 4; y < 31; y++) for (let x = 0; x < 44; x++) {
      const dx = (x - 21.5) / 21.5, dy = (y - 30.5) / 26.5;
      if (dx * dx + dy * dy <= 1) g.set(x, y, x < 22 ? 'r' : 'q');
    }
    for (let y = 17; y < 31; y++) for (let x = 14; x < 30; x++) if (Math.hypot(x - 21.5, (y - 30.5) * 1.15) < 8) g.set(x, y, y < 20 ? 'y' : 'k');
    g.rect(5, 18, 34, 1, 'R'); g.rect(8, 11, 28, 1, 'R');
    for (const x of [8, 14, 30, 36]) g.set(x, 15, 'U');
    g.rect(21, 1, 2, 4, 'q'); g.set(21, 0, 'a'); g.set(22, 0, 'j');
    g.rect(2, 30, 40, 1, 'R');
    g.outline('o');
    return g;
  }
  const g = new Grid(44, 34);
  for (let y = 4; y < 32; y++) {
    const half = Math.floor((y - 4) * 0.74) + 1;
    for (let x = 22 - half; x <= 21 + half; x++) g.set(x, y, x < 22 ? 't' : 'T');
  }
  // Door flaps.
  for (let y = 16; y < 32; y++) { const half = Math.floor((y - 16) * 0.5) + 1; for (let x = 22 - half; x <= 21 + half; x++) g.set(x, y, 'k'); }
  for (let y = 16; y < 32; y++) { g.set(22 - Math.floor((y - 16) * 0.5) - 1, y, 'D'); g.set(21 + Math.floor((y - 16) * 0.5) + 1, y, 'D'); }
  // Canvas stripes along the slope.
  for (let y = 8; y < 30; y += 5) for (let x = 0; x < 44; x++) if (g.get(x, y) === 't' || g.get(x, y) === 'T') g.set(x, y, g.get(x, y) === 't' ? 'p' : 't');
  if (style.snow) for (let i = 0; i < 36; i++) { const x = 15 + Math.floor((i % 14) * 1), y = 4 + Math.floor(i / 14) * 3; if (g.get(x + (i % 3), y) != null && hash(x, y, 4) < 0.6) g.set(x + (i % 3), y, 'w'); }
  g.rect(21, 1, 2, 5, 'T'); g.rect(23, 1, 4, 2, 'x'); g.set(27, 2, 'x');
  g.rect(3, 31, 38, 1, 'T');
  g.outline('o');
  return g;
}
