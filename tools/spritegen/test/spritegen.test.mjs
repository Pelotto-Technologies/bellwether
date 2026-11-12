import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { renderAll, PACKS, THEMES_DIR } from '../build.mjs';
import { decodePng, encodePng } from '../png.mjs';
import { drawFrame, FRAMES, W, H, isTip } from '../character.mjs';

const ROLES = ['orchestrator', 'coordinator', 'architect', 'implementer', 'reviewer', 'researcher', 'writer', 'ops', 'generic'];

test('png round-trips', () => {
  const rgba = new Uint8Array(3 * 2 * 4).map((_, i) => (i * 37) & 255);
  const d = decodePng(encodePng(3, 2, rgba));
  assert.equal(d.w, 3); assert.equal(d.h, 2);
  assert.deepEqual([...d.rgba], [...rgba]);
});

test('rendering is deterministic', () => {
  const a = renderAll(), b = renderAll();
  assert.deepEqual(Object.keys(a), Object.keys(b));
  for (const k of Object.keys(a)) assert.ok(Buffer.compare(Buffer.from(a[k]), Buffer.from(b[k])) === 0, k);
});

test('committed art matches the generator', () => {
  for (const [rel, buf] of Object.entries(renderAll())) {
    const file = path.join(THEMES_DIR, rel);
    assert.ok(fs.existsSync(file), `missing ${rel}; run node tools/spritegen/build.mjs`);
    if (rel.endsWith('.png')) {
      const have = decodePng(fs.readFileSync(file)), want = decodePng(buf);
      assert.equal(have.w, want.w, rel);
      assert.ok(Buffer.compare(Buffer.from(have.rgba), Buffer.from(want.rgba)) === 0, `${rel} is stale`);
    } else assert.equal(fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n'), buf.toString(), `${rel} is stale`);
  }
});

for (const pack of PACKS) {
  test(`${pack.name}: every role has a full sheet`, () => {
    const art = JSON.parse(fs.readFileSync(path.join(THEMES_DIR, pack.name, 'art.json'), 'utf8'));
    assert.deepEqual(Object.keys(art.roles).sort(), [...ROLES].sort());
    assert.ok(ROLES.includes(art.fallback));
    const theme = JSON.parse(fs.readFileSync(path.join(THEMES_DIR, pack.name, 'theme.json'), 'utf8'));
    assert.equal(theme.art, 'art.json');
    assert.ok(ROLES.includes(theme.beacon));
    for (const role of ROLES) {
      const sheet = JSON.parse(fs.readFileSync(path.join(THEMES_DIR, pack.name, art.roles[role].sheet), 'utf8'));
      const img = decodePng(fs.readFileSync(path.join(THEMES_DIR, pack.name, 'sprites', sheet.meta.image)));
      assert.equal(img.w, W * FRAMES.length); assert.equal(img.h, H * 3);
      for (const f of FRAMES) for (const suffix of ['', '_tip', '_cloak']) assert.ok(sheet.frames[f.name + suffix], `${role} ${f.name}${suffix}`);
    }
  });

  test(`${pack.name}: frames keep a margin, have a status light, and stay outlined`, () => {
    for (const spec of pack.characters) for (const f of FRAMES) {
      const g = drawFrame(spec, f);
      const box = g.bounds((k) => k != null && k !== 'z');
      assert.ok(box.x0 >= 0 && box.x1 <= W - 1 && box.y1 <= H - 1, `${spec.id} ${f.name} out of bounds`);
      assert.ok(g.bounds((k) => k === 'o').y1 === H - 1 || box.y1 < H - 1, `${spec.id} ${f.name} feet not outlined`);
      assert.ok(g.bounds(isTip), `${spec.id} ${f.name} has no status light`);
    }
  });
}

// Frames the renderer's camp scene asks for by name; a pack that loses one would crash it.
const CAMP_FRAMES = [
  ...[0, 1, 2, 3].flatMap((i) => [`floor_${i}`, `fire_${i}`]),
  'tent', 'tall_0', 'tall_1', 'low_0', 'low_1', 'seat', 'fx_alert_0', 'fx_alert_1', 'fx_question', 'fx_zzz_0', 'fx_zzz_1', 'fx_zzz_2', 'fx_sweat',
  'crate_0', 'crate_1', 'cart', 'cart_loaded',
  ...['edit', 'read', 'shell', 'search', 'delegate', 'think'].flatMap((s) => [0, 1, 2, 3].map((i) => `st_${s}_${i}`)),
  'st_blocked_0', 'st_blocked_1',
];

for (const pack of PACKS) {
  test(`${pack.name}: camp art has every frame the camp scene uses, and a camp block`, () => {
    const dir = path.join(THEMES_DIR, pack.name);
    const atlas = JSON.parse(fs.readFileSync(path.join(dir, 'map/camp.json'), 'utf8'));
    for (const name of CAMP_FRAMES) assert.ok(atlas.frames[name], `${pack.name} lacks ${name}`);
    const img = decodePng(fs.readFileSync(path.join(dir, 'map/camp.png')));
    for (const [name, f] of Object.entries(atlas.frames)) assert.ok(f.frame.x + f.frame.w <= img.w && f.frame.y + f.frame.h <= img.h, `${name} outside the image`);
    const art = JSON.parse(fs.readFileSync(path.join(dir, 'art.json'), 'utf8'));
    assert.ok(['camp', 'outpost'].includes(art.camp.tone));
    assert.equal(art.camp.sky.length, 2);
    assert.match(art.camp.glow, /^#[0-9a-f]{6}$/i);
    assert.ok(art.character.frames.includes('work_0') && art.character.frames.includes('work_1'));
  });

  test(`${pack.name}: station animations really animate`, () => {
    const dir = path.join(THEMES_DIR, pack.name);
    const atlas = JSON.parse(fs.readFileSync(path.join(dir, 'map/camp.json'), 'utf8'));
    const img = decodePng(fs.readFileSync(path.join(dir, 'map/camp.png')));
    const pixels = (name) => {
      const { x, y, w, h } = atlas.frames[name].frame;
      const out = [];
      for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) out.push(img.rgba.slice(((y + j) * img.w + x + i) * 4, ((y + j) * img.w + x + i) * 4 + 4).join(','));
      return out.join('|');
    };
    for (const [s, n] of [['edit', 4], ['read', 4], ['shell', 4], ['search', 4], ['delegate', 4], ['think', 4], ['blocked', 2]]) {
      const set = new Set(Array.from({ length: n }, (_, i) => pixels(`st_${s}_${i}`)));
      assert.ok(set.size >= 2, `${pack.name} st_${s} frames are all identical`);
    }
    assert.ok(new Set([0, 1, 2, 3].map((i) => pixels(`fire_${i}`))).size === 4, 'fire frames differ');
  });
}

test('only the scifi pack is an outpost; the others are camps', () => {
  const tones = Object.fromEntries(PACKS.map((p) => [p.name, p.camp?.tone ?? 'camp']));
  assert.equal(tones.scifi, 'outpost');
  for (const n of ['neutral', 'aesir', 'wayfarers']) assert.equal(tones[n], 'camp');
});
