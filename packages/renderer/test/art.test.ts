import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ROLES } from '@bellwether/adapter/core';
import { ANIMS, parseArt } from '../src/art.js';
import { pickPack } from '../src/select.js';
import { frameNames } from '../src/anim.js';

const themes = join(import.meta.dirname, '../../../themes');
const packs = readdirSync(themes, { withFileTypes: true }).filter((d) => d.isDirectory() && existsSync(join(themes, d.name, 'art.json'))).map((d) => d.name);
const json = (...p: string[]) => JSON.parse(readFileSync(join(themes, ...p), 'utf8'));

describe('parseArt on the bundled packs', () => {
  it('finds the three public packs', () => {
    expect(packs).toEqual(expect.arrayContaining(['neutral', 'aesir', 'wayfarers']));
  });

  for (const pack of packs) {
    it(`${pack}: every role sheet has every frame, tip and cloak the renderer asks for`, () => {
      const art = parseArt(json(pack, 'art.json'));
      expect(art.character).toMatchObject({ w: 24, h: 32 });
      for (const role of ROLES) {
        const sheet = json(pack, art.roles[role].sheet);
        for (const anim of ANIMS)
          for (let i = 0; i < art.character.counts[anim]; i++) {
            const n = frameNames(anim, i);
            expect(sheet.frames, `${role} ${n.base}`).toHaveProperty(n.base);
            expect(sheet.frames).toHaveProperty(n.tip);
            expect(sheet.frames).toHaveProperty(n.cloak);
          }
      }
      const ground = json(pack, art.ground.sheet);
      for (const t of art.ground.tiles) expect(ground.frames).toHaveProperty(t);
      const ui = json(pack, art.ui.sheet);
      expect(ui.frames).toHaveProperty(art.ui.bubble.frame);
      expect(ui.frames).toHaveProperty(art.ui.bubble.tail!);
      expect(ui.frames).toHaveProperty(art.ui.nameplate.frame);
    });
  }

  it('rejects a manifest without walk frames', () => {
    const raw = json('neutral', 'art.json');
    raw.character.frames = raw.character.frames.filter((f: string) => !f.startsWith('walk'));
    expect(() => parseArt(raw)).toThrow(/walk/);
  });

  it('falls back to the fallback role for roles a pack omits', () => {
    const raw = json('neutral', 'art.json');
    delete raw.roles.ops;
    expect(parseArt(raw).roles.ops).toEqual(parseArt(raw).roles.generic);
  });
});

describe('pickPack', () => {
  const have = ['aesir', 'neutral', 'wayfarers'];
  it('prefers the first known candidate', () => {
    expect(pickPack(have, 'wayfarers', 'aesir')).toBe('wayfarers');
    expect(pickPack(have, 'nope', 'aesir')).toBe('aesir');
  });
  it('falls back to neutral, then anything', () => {
    expect(pickPack(have, null, undefined)).toBe('neutral');
    expect(pickPack(['zeta', 'beta'], 'x')).toBe('beta');
    expect(() => pickPack([])).toThrow();
  });
});
