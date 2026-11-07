import { Assets, Spritesheet, type SpritesheetData, type Texture } from 'pixi.js';
import type { Role } from '@bellwether/adapter/core';
import type { Art } from '../art.js';
import type { PackData } from '../packs.js';

export interface LoadedArt {
  art: Art;
  sheets: Record<Role, Spritesheet>;
  ground: Spritesheet;
  ui: Spritesheet;
}

async function loadSheet(pack: PackData, rel: string): Promise<Spritesheet> {
  const texture = (await Assets.load(pack.imageUrl(rel))) as Texture;
  texture.source.scaleMode = 'nearest';
  const sheet = new Spritesheet(texture, pack.sheetJson(rel) as SpritesheetData);
  await sheet.parse();
  return sheet;
}

/** Loads every sheet a pack's art manifest names. Roles that share a sheet share the loaded copy. */
export async function loadArt(pack: PackData): Promise<LoadedArt | null> {
  const art = pack.art;
  if (!art) return null;
  const cache = new Map<string, Promise<Spritesheet>>();
  const get = (rel: string) => {
    let p = cache.get(rel);
    if (!p) cache.set(rel, (p = loadSheet(pack, rel)));
    return p;
  };
  const roles = Object.keys(art.roles) as Role[];
  const [sheets, ground, ui] = await Promise.all([
    Promise.all(roles.map((r) => get(art.roles[r].sheet))),
    get(art.ground.sheet),
    get(art.ui.sheet),
  ]);
  return { art, sheets: Object.fromEntries(roles.map((r, i) => [r, sheets[i]!])) as Record<Role, Spritesheet>, ground, ui };
}
