import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { electronCacheDir, locateShell } from '../src/overlay.js';

describe('overlay', () => {
  it('finds the shell bundled under runtime/', () => {
    const root = mkdtempSync(join(tmpdir(), 'bw-'));
    mkdirSync(join(root, 'dist'), { recursive: true });
    mkdirSync(join(root, 'runtime', 'shell', 'dist'), { recursive: true });
    writeFileSync(join(root, 'runtime', 'shell', 'dist', 'main.js'), '');
    expect(locateShell(join(root, 'dist'))).toBe(join(root, 'runtime', 'shell', 'dist', 'main.js'));
  });
  it('throws when the shell is missing', () => {
    expect(() => locateShell(join(mkdtempSync(join(tmpdir(), 'bw-')), 'dist'))).toThrow(/not built/);
  });
  it('lets BELLWETHER_HOME move the Electron cache', () => {
    expect(electronCacheDir({ BELLWETHER_HOME: '/x' })).toBe('/x');
  });
});
