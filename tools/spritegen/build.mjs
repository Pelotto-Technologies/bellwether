// Renders both public theme packs' art into themes/<pack>/.
//   node tools/spritegen/build.mjs            write files
//   node tools/spritegen/build.mjs --check    exit 1 if committed art is stale
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Image } from './canvas.mjs';
import { encodePng, decodePng } from './png.mjs';
import { drawCharacter, ANIMATIONS, FRAMES, W, H, isTip, isCloak } from './character.mjs';
import * as Wd from './world.mjs';
import neutral from './packs/neutral.mjs';
import aesir from './packs/aesir.mjs';
import wayfarers from './packs/wayfarers.mjs';

export const PACKS = [neutral, aesir, wayfarers];
const here = path.dirname(fileURLToPath(import.meta.url));
export const THEMES_DIR = path.resolve(here, '../../themes');

const WORLD_STYLE = {
  neutral: {
    snow: false, building: 'cottage', mount: 'pony', ui: 'bubble',
    palette: {
      o: '#1b1530', g: '#6cb851', G: '#8fd46a', h: '#4f9a3f', w: '#ffffff', a: '#f2d24a',
      d: '#a87b4f', D: '#87603a', p: '#c49a6a', P: '#6f4f30', f: '#ff7aa8', F: '#ffd84a',
      s: '#e9d49a', u: '#4a9ad9', v: '#6ab4ea', W: '#cfeeff',
      L: '#4fa04a', K: '#2f7040', J: '#86cf62', t: '#9a6338', T: '#6a4024',
      r: '#a8a8b4', R: '#d0d0da', q: '#74748a', y: '#ffe08a', Y: '#e8a84a', k: '#5a3824',
      b: '#9a6a44', B: '#74502e', e: '#2a1e1a', m: '#3a2a22',
      c: '#ffffff', C: '#c8c8c8', n: '#2a2440', N: '#1f1a33',
      1: '#ffffff40', 2: '#ffffff70', 3: '#ffffffa8', 4: '#ffffffe0',
    },
    // Roofs for the cottage reuse r/R; give them a warm red.
    overrides: { settlement: { r: '#c4473a', R: '#9a3328', q: '#8a8a96', Q: '#6a6a78', v: '#d8d8e0' } },
    minimap: { grass: '#6cb851', path: '#a87b4f', water: '#4a9ad9', tree: '#2f7040', building: '#c4473a', background: '#1b1530' },
  },
  aesir: {
    snow: true, building: 'longhouse', mount: 'goat', ui: 'parchment',
    palette: {
      o: '#140f17', g: '#7a9a6a', G: '#9ab884', h: '#5e7e54', w: '#f2f6fa', a: '#d9a83a',
      d: '#6e5a48', D: '#54443a', p: '#8a7a66', P: '#3e322a', f: '#c8d8ff', F: '#e8c86a',
      s: '#cfc4a8', u: '#2e5a7a', v: '#3e7096', W: '#bfe0f0',
      L: '#2e5a48', K: '#1e3e34', J: '#4e7a5e', t: '#7a5232', T: '#54361e',
      r: '#8a8e96', R: '#aab0b8', q: '#5e626c', y: '#ffc35a', Y: '#d98a2a', k: '#2a1c14',
      b: '#9a948a', B: '#76706a', e: '#2a1e1a', m: '#d9d4c8', K2: '#000',
      c: '#ffffff', C: '#c8c8c8', n: '#3a2a20', N: '#2a1e16', P2: '#000',
      1: '#ffffff40', 2: '#ffffff70', 3: '#ffffffa8', 4: '#ffffffe0',
    },
    overrides: {
      settlement: { L: '#5e7e54', K: '#3e5a3a', J: '#7a9a6a', v: '#c8ccd4' },
      ui: { t: '#6a4a2e', T: '#4a321e', p: '#efe2c2', P: '#d9c8a0' },
      mount: { b: '#a8a49c', B: '#7e7a72', y: '#9a2f2f', Y: '#742222', h: '#e8dcc0', m: '#e8dcc0', t: '#a8a49c' },
    },
    minimap: { grass: '#7a9a6a', path: '#6e5a48', water: '#2e5a7a', tree: '#1e3e34', building: '#d9a83a', background: '#140f17' },
  },
};
WORLD_STYLE.wayfarers = {
  ...WORLD_STYLE.neutral,
  building: 'burrow',
  palette: { ...WORLD_STYLE.neutral.palette, g: '#74b850', G: '#9ad66c', h: '#56983c', L: '#5aa848', K: '#367838', J: '#8ad06a', o: '#1a1410' },
  overrides: {
    settlement: { L: '#6cb84e', J: '#8ad06a', G: '#9ad66c', p: '#c4a46a', k: '#5a3a1e', K: '#3a2410', u: '#3e8a3a', a: '#e8c44a', y: '#ffe08a', q: '#8a6a4a', v: '#d8d8e0', f: '#ff9ab8' },
    mount: { t: '#e8dcc0', m: '#e8dcc0', b: '#8a6a4a', B: '#6a4e34', y: '#8a3a2a', Y: '#6a2a1e' },
    ui: { p: '#fbf6ea', P: '#e8dfca', w: '#fbf6ea', W: '#e0d6c0' },
  },
  minimap: { grass: '#74b850', path: '#a87b4f', water: '#4a9ad9', tree: '#367838', building: '#e8c44a', background: '#1a1410' },
};
WORLD_STYLE.neutral.overrides.mount = { t: '#4a2e1c', m: '#4a2e1c', y: '#3a6ab8', Y: '#2a4e8a' };
WORLD_STYLE.neutral.overrides.ui = { p: '#ffffff', P: '#e0e0e0' };

const TIP_MASK = { g: '#d9d9d9', G: '#ffffff', z: '#ffffff' };
const CLOAK_MASK = { c: '#ffffff', C: '#9a9a9a' };

function sheetJson(image, size, frames, animations, extra = {}) {
  return {
    frames: Object.fromEntries(frames.map(({ name, x, y, w, h }) => [name, {
      frame: { x, y, w, h }, rotated: false, trimmed: false,
      spriteSourceSize: { x: 0, y: 0, w, h }, sourceSize: { w, h },
    }])),
    animations,
    meta: { app: 'bellwether spritegen', version: '1', image, format: 'RGBA8888', size, scale: '1', ...extra },
  };
}

/** Pack a list of { name, grid, palette } left-to-right into rows no wider than maxW. */
function atlas(items, maxW = 256) {
  let x = 0, y = 0, rowH = 0, width = 0;
  const placed = items.map((it) => {
    if (x + it.grid.w > maxW) { x = 0; y += rowH; rowH = 0; }
    const p = { ...it, x, y, w: it.grid.w, h: it.grid.h };
    x += it.grid.w; rowH = Math.max(rowH, it.grid.h); width = Math.max(width, x);
    return p;
  });
  const img = new Image(width, y + rowH);
  for (const p of placed) img.draw(p.grid, p.x, p.y, p.palette);
  return { img, placed };
}

/** Returns a map of relative path -> Buffer|string for one pack. */
export function renderPack(pack) {
  const files = {};
  const style = WORLD_STYLE[pack.name];
  const png = (rel, img) => { files[rel] = encodePng(img.w, img.h, img.rgba); };
  const json = (rel, obj) => { files[rel] = JSON.stringify(obj, null, 2) + '\n'; };

  // Characters: row 0 colour, row 1 status-light mask, row 2 cloak mask.
  const roles = {};
  for (const spec of pack.characters) {
    const pal = { ...pack.palette, ...spec.colors };
    const frames = drawCharacter(spec);
    const img = new Image(W * frames.length, H * 3);
    const rects = [];
    frames.forEach(({ frame, grid }, i) => {
      img.draw(grid, i * W, 0, pal);
      img.draw(grid, i * W, H, TIP_MASK, (k) => (isTip(k) ? k : null));
      img.draw(grid, i * W, 2 * H, CLOAK_MASK, (k) => (isCloak(k) ? k : null));
      rects.push({ name: frame.name, x: i * W, y: 0, w: W, h: H });
      rects.push({ name: `${frame.name}_tip`, x: i * W, y: H, w: W, h: H });
      rects.push({ name: `${frame.name}_cloak`, x: i * W, y: 2 * H, w: W, h: H });
    });
    const anims = { ...ANIMATIONS };
    for (const [k, v] of Object.entries(ANIMATIONS)) {
      anims[`${k}_tip`] = v.map((n) => `${n}_tip`);
      anims[`${k}_cloak`] = v.map((n) => `${n}_cloak`);
    }
    png(`sprites/${spec.id}.png`, img);
    json(`sprites/${spec.id}.json`, sheetJson(`${spec.id}.png`, { w: img.w, h: img.h }, rects, anims));
    roles[spec.role] = { sheet: `sprites/${spec.id}.json`, displayName: spec.displayName, cloak: pal.c, light: pal.g };
  }

  // Strip ground.
  const ground = atlas([0, 1, 2, 3].map((v) => ({ name: `ground_${v}`, grid: Wd.groundTile(style, v), palette: style.palette })));
  png('sprites/ground.png', ground.img);
  json('sprites/ground.json', sheetJson('ground.png', { w: ground.img.w, h: ground.img.h }, ground.placed, {}));

  // Map tileset: fixed 16x16 grid, 8 columns.
  const tiles = [];
  for (let v = 0; v < 4; v++) tiles.push([`grass_${v}`, Wd.grassTile(style, v)]);
  tiles.push(['flowers', Wd.flowerTile(style)]);
  for (const d of ['tree', 'bush', 'rock']) tiles.push([d, Wd.decoTile(style, d)]);
  tiles.push([style.snow ? 'runestone' : 'stump', Wd.decoTile(style, style.snow ? 'runestone' : 'stump')]);
  for (let m = 0; m < 16; m++) tiles.push([`path_${m}`, Wd.pathTile(style, m)]);
  for (let m = 0; m < 16; m++) tiles.push([`water_${m}`, Wd.waterTile(style, m, 0)]);
  for (let m = 0; m < 16; m++) tiles.push([`water_${m}_b`, Wd.waterTile(style, m, 2)]);
  const cols = 8;
  const tilesetImg = new Image(cols * Wd.TILE, Math.ceil(tiles.length / cols) * Wd.TILE);
  const tileIndex = {};
  tiles.forEach(([name, grid], i) => {
    tilesetImg.draw(grid, (i % cols) * Wd.TILE, Math.floor(i / cols) * Wd.TILE, style.palette);
    tileIndex[name] = i;
  });
  png('map/tileset.png', tilesetImg);
  json('map/tileset.json', {
    image: 'tileset.png', tileSize: Wd.TILE, columns: cols, count: tiles.length,
    autotile: { mask: 'N=1 E=2 S=4 W=8; set a bit when the neighbour has the same terrain', path: 'path_<mask>', water: 'water_<mask>', waterAnimation: ['water_<mask>', 'water_<mask>_b'] },
    overlays: ['tree', 'bush', 'rock', style.snow ? 'runestone' : 'stump'],
    tiles: tileIndex,
  });

  // Props.
  const ov = (k) => ({ ...style.palette, ...(style.overrides[k] ?? {}) });
  const props = [
    { name: 'settlement', grid: Wd.settlement(style), palette: ov('settlement') },
    { name: 'camp', grid: Wd.tent(style), palette: ov('settlement') },
    ...[0, 1, 2, 3].map((f) => ({ name: `campfire_${f}`, grid: Wd.campfire(f), palette: { ...style.palette, r: '#e8402a', O: '#ff9a2a', y: '#ffe36a', t: '#8a5a33', T: '#5e3b20', q: '#5a5a66' } })),
    { name: 'signpost', grid: Wd.signpost(), palette: style.palette },
    ...[0, 1, 2, 3, 4].map((f) => ({ name: f < 4 ? `mount_walk_${f}` : 'mount_idle', grid: Wd.mount(style, f), palette: ov('mount') })),
    { name: 'banner_pole', grid: Wd.bannerPole(), palette: style.palette },
    { name: 'banner_cloth_0', grid: Wd.bannerCloth(0), palette: style.palette },
    { name: 'banner_cloth_1', grid: Wd.bannerCloth(1), palette: style.palette },
    { name: 'glow', grid: Wd.glow(32), palette: style.palette },
    { name: 'pin', grid: Wd.pin(false), palette: style.palette },
    { name: 'pin_ring', grid: Wd.pin(true), palette: style.palette },
  ];
  const propsAtlas = atlas(props);
  png('map/props.png', propsAtlas.img);
  json('map/props.json', sheetJson('props.png', { w: propsAtlas.img.w, h: propsAtlas.img.h }, propsAtlas.placed, {
    campfire: [0, 1, 2, 3].map((f) => `campfire_${f}`),
    mount_walk: [0, 1, 2, 3].map((f) => `mount_walk_${f}`),
    banner_cloth: ['banner_cloth_0', 'banner_cloth_1'],
  }));

  // UI.
  const uiPal = ov('ui');
  const ui = [
    { name: 'bubble', grid: Wd.bubble(style), palette: uiPal },
    { name: 'bubble_tail', grid: Wd.bubbleTail(style), palette: uiPal },
    { name: 'nameplate', grid: Wd.nameplate(style), palette: uiPal },
    { name: 'minimap_frame', grid: Wd.minimapFrame(style), palette: uiPal },
    ...Object.entries(pack.status).map(([s, col]) => ({ name: `status_${s}`, grid: Wd.statusIcon(s), palette: { ...uiPal, c: col, w: '#ffffff', o: style.palette.o } })),
  ];
  const uiAtlas = atlas(ui);
  png('ui/ui.png', uiAtlas.img);
  json('ui/ui.json', sheetJson('ui.png', { w: uiAtlas.img.w, h: uiAtlas.img.h }, uiAtlas.placed, {}));

  json('art.json', {
    $comment: 'Generated by tools/spritegen. Edit the pack spec there and rebuild; do not hand-edit.',
    name: pack.name,
    displayName: pack.displayName,
    description: pack.description,
    license: 'Apache-2.0',
    character: {
      size: { w: W, h: H }, facing: 'right', anchor: { x: 0.5, y: 30 / 32 },
      frames: FRAMES.map((f) => f.name),
      fps: { walk: 8, idle: 2, wave: 4, talk: 6, raise: 1, blink: 1 },
      layers: {
        tip: 'Frame name + "_tip": white status-light pixels. Tint with the status colour and draw over the base frame.',
        cloak: 'Frame name + "_cloak": grey cloak pixels. Tint and draw over the base frame to recolour the cloak.',
      },
    },
    roles,
    fallback: pack.fallback,
    status: pack.status,
    strip: { ground: 'sprites/ground.json', tiles: ['ground_0', 'ground_1', 'ground_2', 'ground_3'] },
    map: {
      tileset: 'map/tileset.json', props: 'map/props.json',
      settlement: 'settlement', camp: 'camp', campfire: 'campfire', signpost: 'signpost', mount: 'mount_walk',
      banner: { pole: 'banner_pole', cloth: 'banner_cloth', tint: true },
      glow: { frame: 'glow', tint: true }, pin: { frame: 'pin', ring: 'pin_ring', tint: true },
      minimap: style.minimap,
    },
    ui: {
      sheet: 'ui/ui.json',
      bubble: { frame: 'bubble', slice: 8, tail: 'bubble_tail' },
      nameplate: { frame: 'nameplate', slice: 4 },
      minimapFrame: { frame: 'minimap_frame', slice: 8 },
      statusIcons: Object.fromEntries(Object.keys(pack.status).map((s) => [s, `status_${s}`])),
    },
  });
  return files;
}

export function renderAll() {
  const out = {};
  for (const pack of PACKS) for (const [rel, buf] of Object.entries(renderPack(pack))) out[`${pack.name}/${rel}`] = buf;
  return out;
}

function same(rel, want) {
  const file = path.join(THEMES_DIR, rel);
  if (!fs.existsSync(file)) return false;
  const have = fs.readFileSync(file);
  if (!rel.endsWith('.png')) return have.toString().replace(/\r\n/g, '\n') === want.toString();
  const a = decodePng(have), b = decodePng(want);
  return a.w === b.w && a.h === b.h && Buffer.compare(Buffer.from(a.rgba), Buffer.from(b.rgba)) === 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const files = renderAll();
  if (process.argv.includes('--check')) {
    const stale = Object.entries(files).filter(([rel, buf]) => !same(rel, buf)).map(([rel]) => rel);
    if (stale.length) { console.error(`stale art (run node tools/spritegen/build.mjs):\n  ${stale.join('\n  ')}`); process.exit(1); }
    console.log(`art up to date (${Object.keys(files).length} files)`);
  } else {
    for (const [rel, buf] of Object.entries(files)) {
      const file = path.join(THEMES_DIR, rel);
      fs.mkdirSync(path.dirname(file), { recursive: true });
      if (!same(rel, buf)) fs.writeFileSync(file, buf);
    }
    console.log(`wrote ${Object.keys(files).length} files under themes/`);
  }
}
