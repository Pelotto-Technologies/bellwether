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
