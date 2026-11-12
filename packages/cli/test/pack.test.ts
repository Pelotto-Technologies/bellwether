import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { formatPack, listPacks, readPackInfo, resolvePack } from '../src/pack.js';

describe('resolvePack', () => {
  it('goes tray choice, environment, bellwether.toml, default', () => {
    expect(resolvePack({ shell: 'a', env: 'b', toml: 'c' })).toEqual({ pack: 'a', source: 'shell' });
    expect(resolvePack({ env: 'b', toml: 'c' })).toEqual({ pack: 'b', source: 'env' });
    expect(resolvePack({ toml: 'c' })).toEqual({ pack: 'c', source: 'toml' });
    expect(resolvePack({})).toEqual({ pack: 'neutral', source: 'default' });
  });
});

describe('listPacks', () => {
  const themes = (names: string[]) => {
    const dir = mkdtempSync(join(tmpdir(), 'bw-themes-'));
    for (const n of names) {
      mkdirSync(join(dir, n));
      if (n !== 'stray') writeFileSync(join(dir, n, 'theme.json'), '{}');
    }
    return dir;
  };
  it('lists folders with a theme.json, shipped ones first, then others by name', () => {
    expect(listPacks([themes(['zeta', 'aesir', 'neutral', 'stray', 'mine'])], ['neutral', 'aesir', 'wayfarers'])).toEqual(['neutral', 'aesir', 'mine', 'zeta']);
  });
  it('without any themes folder, lists the shipped packs', () => {
    expect(listPacks([join(tmpdir(), 'bw-no-such-dir')], ['neutral', 'aesir'])).toEqual(['neutral', 'aesir']);
  });
});

describe('formatPack', () => {
  const info = { pack: 'aesir', source: 'toml' as const, available: ['neutral', 'aesir'] };
  it('prints one line, or the JSON record', () => {
    expect(formatPack(info, false)).toBe('aesir');
    expect(JSON.parse(formatPack(info, true))).toEqual(info);
  });
});

describe('readPackInfo in this checkout', () => {
  // Needs the adapter build, which `pnpm check` makes before the tests of a clean run only for later packages, so skip quietly without it.
  it('reads bellwether.toml in the working directory, then BELLWETHER_PACK over it', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'bw-pack-'));
    writeFileSync(join(cwd, 'bellwether.toml'), 'pack = "wayfarers"\n');
    const home = mkdtempSync(join(tmpdir(), 'bw-home-'));
    const env = { HOME: home, XDG_CONFIG_HOME: join(home, 'cfg'), APPDATA: join(home, 'cfg') };
    let info;
    try {
      info = await readPackInfo({ cwd, env });
    } catch (err) {
      if (/not built/.test((err as Error).message)) return;
      throw err;
    }
    expect(info).toMatchObject({ pack: 'wayfarers', source: 'toml' });
    expect(info.available).toContain('neutral');
    expect(await readPackInfo({ cwd, env: { ...env, BELLWETHER_PACK: 'aesir' } })).toMatchObject({ pack: 'aesir', source: 'env' });
    expect(await readPackInfo({ cwd, env: { ...env, BELLWETHER_PACK: 'not valid!' } })).toMatchObject({ pack: 'wayfarers', source: 'toml' });
    expect(await readPackInfo({ cwd: mkdtempSync(join(tmpdir(), 'bw-empty-')), env })).toMatchObject({ pack: 'neutral', source: 'default' });
  });
});
