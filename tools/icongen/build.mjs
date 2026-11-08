// Renders the Bellwether icon set into packages/shell/assets and docs/brand.
//   node tools/icongen/build.mjs            write files
//   node tools/icongen/build.mjs --check    exit 1 if committed files are stale
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { encodePng } from '../spritegen/png.mjs';
import { SPRITE, TRAY, PALETTE, BG, BG2 } from './sprite.mjs';
import { WORDMARK_GLYPHS } from './font.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../..');
export const OUT = { assets: path.join(root, 'packages/shell/assets'), brand: path.join(root, 'docs/brand') };

class Canvas {
  constructor(w, h) { this.w = w; this.h = h; this.d = new Uint8Array(w * h * 4); }
  set(x, y, [r, g, b], a = 255) {
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return;
    const i = (y * this.w + x) * 4;
    this.d[i] = r; this.d[i + 1] = g; this.d[i + 2] = b; this.d[i + 3] = a;
  }
  rect(x, y, w, h, c) { for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) this.set(x + i, y + j, c); }
  png() { return encodePng(this.w, this.h, this.d); }
}

/** Draw a pixel grid at integer scale k with its top-left at (ox, oy). */
function blit(cv, grid, k, ox, oy, colorOf) {
  grid.forEach((row, y) => [...row].forEach((ch, x) => {
    const c = colorOf(ch, x, y);
    if (c) cv.rect(ox + x * k, oy + y * k, k, k, c);
  }));
}
const sprite = (ch) => PALETTE[ch];

/** Anti-aliased rounded square with a vertical gradient (4x4 supersampling). */
function roundedSquare(cv, x0, y0, size, radius) {
  for (let y = y0; y < y0 + size; y++) {
    for (let x = x0; x < x0 + size; x++) {
      let hit = 0;
      for (let sy = 0; sy < 4; sy++) for (let sx = 0; sx < 4; sx++) {
        const px = x + (sx + 0.5) / 4 - x0, py = y + (sy + 0.5) / 4 - y0;
        const cx = Math.min(Math.max(px, radius), size - radius), cy = Math.min(Math.max(py, radius), size - radius);
        if ((px - cx) ** 2 + (py - cy) ** 2 <= radius * radius) hit++;
      }
      if (!hit) continue;
      const t = (y - y0) / size;
      cv.set(x, y, BG.map((v, i) => Math.round(BG2[i] * (1 - t) + v * t)), Math.round((hit / 16) * 255));
    }
  }
}

/** App icon at `size` px. Large sizes get the rounded tile; small sizes draw the sheep alone. */
export function appIcon(size) {
  const cv = new Canvas(size, size);
  if (size < 64) {
    const k = Math.max(1, Math.floor(size / 16));
    blit(cv, SPRITE, k, Math.floor((size - 16 * k) / 2), Math.floor((size - 16 * k) / 2), sprite);
    return cv.png();
  }
  const tile = Math.round(size * 0.8);
  const t0 = Math.floor((size - tile) / 2);
  roundedSquare(cv, t0, t0, tile, tile * 0.225);
  const k = Math.floor((tile * 0.78) / 16);
  blit(cv, SPRITE, k, Math.floor((size - 16 * k) / 2), Math.floor((size - 16 * k) / 2), sprite);
  return cv.png();
}

/** macOS menu bar template: black plus alpha only, so the system tints it. */
export function trayTemplate(scale) {
  const cv = new Canvas(16 * scale, 16 * scale);
  blit(cv, TRAY, scale, 0, 0, (ch) => (ch === 'X' ? [0, 0, 0] : null));
  return cv.png();
}

/** Windows tray icon: the sheep alone with a dark rim so it reads on light and dark taskbars. */
export function trayColor(scale) {
  const cv = new Canvas(16 * scale, 16 * scale);
  const at = (x, y) => SPRITE[y]?.[x] ?? '.';
  blit(cv, SPRITE, scale, 0, 0, (ch, x, y) => {
    if (ch === '.') return null;
    if (ch === 'W' && [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => at(x + dx, y + dy) === '.')) return [86, 76, 112];
    return PALETTE[ch];
  });
  return cv.png();
}

function ico(pngs) {
  const head = Buffer.alloc(6 + 16 * pngs.length);
  head.writeUInt16LE(1, 2); head.writeUInt16LE(pngs.length, 4);
  let off = head.length;
  pngs.forEach(({ size, buf }, i) => {
    const e = 6 + i * 16;
    head[e] = size >= 256 ? 0 : size; head[e + 1] = size >= 256 ? 0 : size;
    head.writeUInt16LE(1, e + 4); head.writeUInt16LE(32, e + 6);
    head.writeUInt32LE(buf.length, e + 8); head.writeUInt32LE(off, e + 12);
    off += buf.length;
  });
  return Buffer.concat([head, ...pngs.map((p) => p.buf)]);
}

function icns(entries) {
  const parts = entries.map(({ type, buf }) => {
    const h = Buffer.alloc(8);
    h.write(type, 0, 'ascii'); h.writeUInt32BE(buf.length + 8, 4);
    return Buffer.concat([h, buf]);
  });
  const len = 8 + parts.reduce((n, p) => n + p.length, 0);
  const h = Buffer.alloc(8);
  h.write('icns', 0, 'ascii'); h.writeUInt32BE(len, 4);
  return Buffer.concat([h, ...parts]);
}

function wordmark(cv, text, k, ox, oy, color) {
  let x = ox;
  for (const ch of text) {
    const g = WORDMARK_GLYPHS[ch];
    blit(cv, g, k, x, oy, (c) => (c === '#' ? color : null));
    x += (g[0].length + 1) * k;
  }
  return x - k;
}
const wordWidth = (text, k) => [...text].reduce((n, ch) => n + (WORDMARK_GLYPHS[ch][0].length + 1) * k, 0) - k;

/** README logo: the sheep and the wordmark on a transparent background. */
export function logo() {
  const k = 8, sk = 8;
  const w = 16 * sk + 6 * k + wordWidth('BELLWETHER', k), h = 16 * sk;
  const cv = new Canvas(w, h);
  blit(cv, SPRITE, sk, 0, 0, sprite);
  wordmark(cv, 'BELLWETHER', k, 16 * sk + 6 * k, Math.floor((h - 7 * k) / 2), [244, 168, 40]);
  return cv.png();
}

/** 1280x640 social preview for GitHub and npm. */
export function social() {
  const cv = new Canvas(1280, 640);
  for (let y = 0; y < 640; y++) {
    const t = y / 640;
    for (let x = 0; x < 1280; x++) cv.set(x, y, BG.map((v, i) => Math.round(BG2[i] * (1 - t) + v * t)));
  }
  const sk = 24;
  blit(cv, SPRITE, sk, 110, 128, sprite);
  const k = 10, wx = 110 + 16 * sk + 60;
  wordmark(cv, 'BELLWETHER', 10, wx, 250, [244, 168, 40]);
  // A herd of little pixel agents following the lead sheep.
  const dots = [[PALETTE.W, 0], [PALETTE.W, 1], [PALETTE.W, 2], [PALETTE.Y, 3]];
  dots.forEach(([c, i]) => cv.rect(wx + i * 7 * k, 400, 5 * k, 5 * k, c));
  return cv.png();
}

export function renderAll() {
  const out = {};
  const a = OUT.assets;
  out[path.join(a, 'icon.png')] = appIcon(1024);
  out[path.join(a, 'icon.ico')] = ico([16, 32, 48, 64, 128, 256].map((size) => ({ size, buf: appIcon(size) })));
  out[path.join(a, 'icon.icns')] = icns([
    ['icp4', 16], ['icp5', 32], ['ic11', 32], ['ic12', 64], ['ic07', 128], ['ic08', 256], ['ic13', 256], ['ic09', 512], ['ic14', 512], ['ic10', 1024],
  ].map(([type, size]) => ({ type, buf: appIcon(size) })));
  out[path.join(a, 'trayTemplate.png')] = trayTemplate(1);
  out[path.join(a, 'trayTemplate@2x.png')] = trayTemplate(2);
  out[path.join(a, 'tray.png')] = trayColor(1);
  out[path.join(a, 'tray@2x.png')] = trayColor(2);
  out[path.join(OUT.brand, 'logo.png')] = logo();
  out[path.join(OUT.brand, 'social.png')] = social();
  return out;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const files = renderAll();
  if (process.argv.includes('--check')) {
    const stale = Object.entries(files).filter(([f, b]) => !fs.existsSync(f) || Buffer.compare(fs.readFileSync(f), b) !== 0);
    if (stale.length) { console.error('stale icons (run node tools/icongen/build.mjs):\n' + stale.map(([f]) => path.relative(root, f)).join('\n')); process.exit(1); }
  } else {
    for (const [f, b] of Object.entries(files)) { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, b); }
    console.error(`icongen: wrote ${Object.keys(files).length} files`);
  }
}
