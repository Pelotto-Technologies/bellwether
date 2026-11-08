import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { resolveStaticFile } from '../src/server.js';

const base = mkdtempSync(join(tmpdir(), 'bw-static-'));
const root = join(base, 'root');
mkdirSync(join(root, 'sub'), { recursive: true });
writeFileSync(join(root, 'index.html'), 'hi');
writeFileSync(join(root, 'sub', 'a.js'), 'x');
writeFileSync(join(base, 'secret.txt'), 'secret');
let linked = true;
try {
  symlinkSync(join(base, 'secret.txt'), join(root, 'link.txt'));
} catch {
  linked = false; // symlinks may need privileges on Windows
}

describe('resolveStaticFile', () => {
  it('serves files and directory indexes inside the root', () => {
    expect(resolveStaticFile(root, '/sub/a.js?x=1')).toMatch(/a\.js$/);
    expect(resolveStaticFile(root, '/')).toMatch(/index\.html$/);
  });
  it('404s missing files', () => {
    expect(resolveStaticFile(root, '/nope.js')).toBeUndefined();
  });
  it.each(['/../secret.txt', '/%2e%2e/secret.txt', '/sub/../../secret.txt', '/%2e%2e%2fsecret.txt', '/a%00.js', '/..%5csecret.txt', '/%zz'])(
    'rejects traversal attempt %s',
    (u) => {
      expect(resolveStaticFile(root, u)).toBe('forbidden');
    },
  );
  it.skipIf(!linked)('rejects symlinks that escape the root', () => {
    expect(resolveStaticFile(root, '/link.txt')).toBe('forbidden');
  });
});
