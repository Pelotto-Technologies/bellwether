import { Assets, Rectangle, Texture } from 'pixi.js';
import { sliceTileset, type TilesetJson } from './tileset.js';

/** Loads a theme pack's map art (tileset + props atlas) into named textures. */

interface AtlasJson {
  frames: Record<string, { frame: { x: number; y: number; w: number; h: number } }>;
}

export interface MapArt {
  tile(name: string): Texture;
  prop(name: string): Texture;
  hasTile(name: string): boolean;
  hasProp(name: string): boolean;
}

// Eager so Vite bundles every public pack; a private local pack is picked up the same way.
const urls = import.meta.glob('../../../../themes/*/map/*.png', { eager: true, query: '?url', import: 'default' }) as Record<string, string>;
const jsons = import.meta.glob('../../../../themes/*/map/*.json', { eager: true, import: 'default' }) as Record<string, unknown>;

function find<T>(map: Record<string, T>, pack: string, file: string): T | undefined {
  return Object.entries(map).find(([k]) => k.endsWith(`/themes/${pack}/map/${file}`))?.[1];
}

export function hasMapArt(pack: string): boolean {
  return !!find(urls, pack, 'tileset.png') && !!find(jsons, pack, 'props.json');
}

export async function loadMapArt(pack: string): Promise<MapArt> {
  const tilesUrl = find(urls, pack, 'tileset.png');
  const propsUrl = find(urls, pack, 'props.png');
  const tileset = find(jsons, pack, 'tileset.json') as TilesetJson | undefined;
  const atlas = find(jsons, pack, 'props.json') as AtlasJson | undefined;
  if (!tilesUrl || !propsUrl || !tileset || !atlas) throw new Error(`theme "${pack}" has no map art`);

  const [tilesTex, propsTex] = await Promise.all([Assets.load<Texture>(tilesUrl), Assets.load<Texture>(propsUrl)]);
  for (const t of [tilesTex, propsTex]) t.source.scaleMode = 'nearest';

  const tiles = new Map<string, Texture>();
  for (const [name, r] of Object.entries(sliceTileset(tileset))) tiles.set(name, new Texture({ source: tilesTex.source, frame: new Rectangle(r.x, r.y, r.width, r.height) }));
  const props = new Map<string, Texture>();
  for (const [name, f] of Object.entries(atlas.frames)) {
    props.set(name, new Texture({ source: propsTex.source, frame: new Rectangle(f.frame.x, f.frame.y, f.frame.w, f.frame.h) }));
  }
  const need = <T>(m: Map<string, T>, n: string) => {
    const v = m.get(n);
    if (!v) throw new Error(`map art "${pack}" is missing "${n}"`);
    return v;
  };
  return { tile: (n) => need(tiles, n), prop: (n) => need(props, n), hasTile: (n) => tiles.has(n), hasProp: (n) => props.has(n) };
}
