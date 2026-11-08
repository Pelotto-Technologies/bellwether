import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { renderAll, trayTemplate, OUT } from '../build.mjs';
import { decodePng } from '../../spritegen/png.mjs';

test('rendering is deterministic', () => {
  const a = renderAll(), b = renderAll();
  for (const k of Object.keys(a)) assert.ok(Buffer.compare(a[k], b[k]) === 0, k);
});

test('committed icons match the generator', () => {
  for (const [file, buf] of Object.entries(renderAll())) {
    assert.ok(fs.existsSync(file), `missing ${file}; run node tools/icongen/build.mjs`);
    assert.ok(Buffer.compare(fs.readFileSync(file), buf) === 0, `stale ${file}; run node tools/icongen/build.mjs`);
  }
});

test('mac tray template is black plus alpha only, 16 and 32 px', () => {
  for (const [scale, size] of [[1, 16], [2, 32]]) {
    const { w, h, rgba } = decodePng(trayTemplate(scale));
    assert.equal(w, size); assert.equal(h, size);
    let opaque = 0;
    for (let i = 0; i < rgba.length; i += 4) {
      assert.deepEqual([...rgba.slice(i, i + 3)], [0, 0, 0]);
      if (rgba[i + 3]) opaque++;
    }
    assert.ok(opaque > 0);
  }
});

test('ico and icns containers are well formed', () => {
  const ico = fs.readFileSync(`${OUT.assets}/icon.ico`);
  assert.equal(ico.readUInt16LE(2), 1);
  assert.equal(ico.readUInt16LE(4), 6);
  const icns = fs.readFileSync(`${OUT.assets}/icon.icns`);
  assert.equal(icns.toString('ascii', 0, 4), 'icns');
  assert.equal(icns.readUInt32BE(4), icns.length);
});
