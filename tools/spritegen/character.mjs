// Composes a character spec into animation frames.
import { Grid } from './canvas.mjs';
import * as P from './parts.mjs';

export const W = 24;
export const H = 32;

// Frame order is the sheet's column order.
export const FRAMES = [
  { name: 'walk_0', bob: 0, legF: [1, 0], legB: [-1, 0], armF: 'swingB', armB: 'swingF', flutter: true },
  { name: 'walk_1', bob: -1, legF: [0, 0], legB: [0, 1], armF: 'down', armB: 'down' },
  { name: 'walk_2', bob: 0, legF: [-1, 0], legB: [1, 0], armF: 'swingF', armB: 'swingB', flutter: true },
  { name: 'walk_3', bob: -1, legF: [0, 1], legB: [0, 0], armF: 'down', armB: 'down' },
  { name: 'idle_0', bob: 0 },
  { name: 'idle_1', bob: 1 },
  { name: 'wave_0', bob: 0, armB: 'wave0', mouth: 'open' },
  { name: 'wave_1', bob: 0, armB: 'wave1', mouth: 'open' },
  { name: 'talk_0', bob: 0, armB: 'gesture', mouth: 'open' },
  { name: 'talk_1', bob: 0, mouth: 'closed' },
  { name: 'raise_0', bob: -1, armF: 'raise', mouth: 'open', raise: true },
  { name: 'blink_0', bob: 0, blink: true },
  // Hammering, tinkering: the held item goes up, then swings down. Used by the camp scene.
  { name: 'work_0', bob: -1, armF: 'raise', armUp: true },
  { name: 'work_1', bob: 1, armF: 'swingF' },
];

export const ANIMATIONS = {
  walk: ['walk_0', 'walk_1', 'walk_2', 'walk_3'],
  idle: ['idle_0', 'idle_1'],
  wave: ['wave_0', 'wave_1'],
  talk: ['talk_0', 'talk_1'],
  raise: ['raise_0'],
  blink: ['blink_0'],
  work: ['work_0', 'work_1'],
};

const TIP_KEYS = new Set(['g', 'G', 'z']);
const CLOAK_KEYS = new Set(['c', 'C']);
export const isTip = (k) => TIP_KEYS.has(k);
export const isCloak = (k) => CLOAK_KEYS.has(k);

function piece(g, part, x, y, map) {
  if (part && part.rows.length) g.stamp(part.rows, x + (part.dx ?? 0), y + (part.dy ?? 0), { map });
}

function leg(g, x, top, [dx, lift], back, bootKeys) {
  const p = back ? 'PPP' : 'Ppp';
  const bottom = 28 - lift;
  for (let y = top; y <= bottom; y++) g.stamp([p], y >= 26 - lift ? x + dx : x, y);
  const [b, B] = bootKeys;
  g.stamp([back ? B.repeat(3) : B + b + b, back ? B.repeat(4) : B + b + b + b], x + dx, 29 - lift);
}

function sparkle(g) {
  const box = g.bounds(isTip);
  if (!box) return;
  const cx = Math.round((box.x0 + box.x1) / 2);
  const cy = Math.round((box.y0 + box.y1) / 2);
  const rx = Math.ceil((box.x1 - box.x0) / 2) + 2;
  for (const [x, y] of [[cx - rx, cy], [cx + rx, cy], [cx - rx + 1, cy - 2], [cx + rx - 1, cy - 2], [cx - rx + 1, cy + 2], [cx + rx - 1, cy + 2]]) {
    if (g.get(x, y) == null) g.set(x, y, 'z');
  }
}

/** Draw one frame of a character spec. Returns a palette-key Grid. */
export function drawFrame(spec, frame) {
  const g = new Grid(W, H);
  const by = frame.bob ?? 0;
  const tx = P.TORSO.x, ty = P.TORSO.y + by;
  const sleeve = { u: spec.sleeve?.[0] ?? 't', U: spec.sleeve?.[1] ?? 'T' };
  const acc = (spec.accessories ?? []).map((n) => [n, P.ACCESSORIES[n]]);
  if (acc.some(([, a]) => !a)) throw new Error(`${spec.id}: unknown accessory`);

  // 1. behind the body
  for (const [name, a] of acc) {
    if (a.depth !== 'back') continue;
    const rows = name === 'cape' && frame.flutter ? a.flutter : a.rows;
    g.stamp(rows, tx + a.dx, ty + a.dy);
  }

  // 2. back arm, then anything worn on it
  const armB = P.ARMS[frame.armB ?? 'down'];
  g.stamp(armB.rows, P.SHOULDER_BACK.x + armB.dx, P.SHOULDER_BACK.y + by + armB.dy, { map: sleeve });
  for (const [, a] of acc) if (a.depth === 'arm') g.stamp(a.rows, tx + a.dx, ty + a.dy);

  // 3. legs
  const top = 23 + by;
  const boots = spec.barefoot ? ['s', 'S'] : spec.boots ?? ['b', 'B'];
  leg(g, 9, top, frame.legB ?? [0, 0], true, spec.barefoot ? ['s', 'S'] : ['b', 'B']);
  leg(g, 12, top, frame.legF ?? [0, 0], false, boots);

  // 4. torso
  const torso = P.TORSOS[spec.torso ?? 'tunic'];
  g.stamp(torso.rows, tx + torso.dx, ty);

  // 5. head and face
  const hx = P.HEAD.x, hy = P.HEAD.y + by;
  g.stamp(P.HEAD_ROWS, hx, hy);
  if (spec.blush) { g.set(hx + 5, hy + 6, 'n'); g.set(hx + 9, hy + 6, 'n'); }
  if (frame.blink) { g.set(hx + 6, hy + 5, 'k'); g.set(hx + 8, hy + 5, 'k'); }
  else for (const [ex, ey] of P.EYES) g.set(hx + ex, hy + ey, 'e');
  piece(g, P.HAIR[spec.hair ?? 'short'], hx, hy);
  piece(g, P.BEARDS[spec.beard ?? 'none'], hx, hy, { f: 'f', F: 'F' });
  const mouthKey = frame.mouth === 'open' ? 'k' : spec.beard && spec.beard !== 'none' && spec.beard !== 'mustache' ? 'F' : 'S';
  g.set(hx + 7, hy + 7, mouthKey);
  if (frame.mouth === 'open') g.set(hx + 8, hy + 7, 'k');
  piece(g, P.FACE_EXTRAS[spec.face ?? 'none'], hx, hy);
  piece(g, P.HATS[spec.hat ?? 'none'], hx, hy);

  // 6. worn in front
  for (const [, a] of acc) if (a.depth === 'front') g.stamp(a.rows, tx + a.dx, ty + a.dy);

  // 7. held item, then the front arm over its grip
  const armF = P.ARMS[frame.armF ?? 'down'];
  const sx = P.SHOULDER_FRONT.x + armF.dx, sy = P.SHOULDER_FRONT.y + by + armF.dy;
  const item = P.ITEMS[spec.item ?? 'none'];
  if (spec.item && item === undefined) throw new Error(`${spec.id}: unknown item ${spec.item}`);
  if (item) {
    const v = frame.raise || frame.armUp ? item.raise : item.hold;
    g.stamp(v.rows, sx + armF.grip[0] - v.grip[0], sy + armF.grip[1] - v.grip[1]);
  }
  g.stamp(armF.rows, sx, sy, { map: sleeve });

  if (frame.raise) sparkle(g);
  g.outline('o', (k) => k === 'z');
  return g;
}

export function drawCharacter(spec) {
  return FRAMES.map((f) => ({ frame: f, grid: drawFrame(spec, f) }));
}
