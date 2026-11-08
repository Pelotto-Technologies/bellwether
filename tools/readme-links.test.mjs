import { test } from 'node:test';
import assert from 'node:assert/strict';
import { absolutizeLinks } from './readme-links.mjs';

test('relative images point at raw files and other links at the blob view', () => {
  const md = '![Strip](docs/images/a.png) see [OBS](docs/obs.md) and <img src="docs/brand/logo.png"> <a href="LICENSE">x</a>';
  assert.equal(
    absolutizeLinks(md),
    '![Strip](https://raw.githubusercontent.com/Pelotto-Technologies/bellwether/main/docs/images/a.png) see ' +
      '[OBS](https://github.com/Pelotto-Technologies/bellwether/blob/main/docs/obs.md) and ' +
      '<img src="https://raw.githubusercontent.com/Pelotto-Technologies/bellwether/main/docs/brand/logo.png"> ' +
      '<a href="https://github.com/Pelotto-Technologies/bellwether/blob/main/LICENSE">x</a>',
  );
});

test('absolute URLs and anchors are left alone', () => {
  const md = '[a](https://herdr.dev) [b](#quickstart) <a href="http://127.0.0.1:7341/">c</a> [d](mailto:x@y.z)';
  assert.equal(absolutizeLinks(md), md);
});
