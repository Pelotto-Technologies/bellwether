import { Assets, Rectangle, Texture } from 'pixi.js';
import { DEFAULT_CAMP_LOOK, parseCampLook, type CampLook } from './camplook.js';

/** Loads a pack's camp art (`map/camp.png` + `map/camp.json`) and its `camp` block from art.json. */

interface AtlasJson {
  frames: Record<string, { frame: { x: number; y: number; w: number; h: number } }>;
}

export interface CampArt {
  look: CampLook;
  frame(name: string): Texture;
  has(name: string): boolean;
}

const urls = import.meta.glob('../../../../themes/*/map/camp.png', { eager: true, query: '?url', import: 'default' }) as Record<string, string>;
const atlases = import.meta.glob('../../../../themes/*/map/camp.json', { eager: true, import: 'default' }) as Record<string, unknown>;
const arts = import.meta.glob('../../../../themes/*/art.json', { eager: true, import: 'default' }) as Record<string, unknown>;

function find<T>(map: Record<string, T>, pack: string, file: string): T | undefined {
  return Object.entries(map).find(([k]) => k.endsWith(`/themes/${pack}/${file}`))?.[1];
}

export function hasCampArt(pack: string): boolean {
  return !!find(urls, pack, 'map/camp.png') && !!find(atlases, pack, 'map/camp.json');
}

/** A pack without camp art borrows the neutral pack's, so the scene still renders. */
export async function loadCampArt(pack: string): Promise<CampArt> {
  const use = hasCampArt(pack) ? pack : 'neutral';
  const url = find(urls, use, 'map/camp.png');
  const atlas = find(atlases, use, 'map/camp.json') as AtlasJson | undefined;
  if (!url || !atlas) throw new Error('no pack ships camp art');
  const tex = await Assets.load<Texture>(url);
  tex.source.scaleMode = 'nearest';
  const frames = new Map<string, Texture>();
  for (const [name, f] of Object.entries(atlas.frames)) frames.set(name, new Texture({ source: tex.source, frame: new Rectangle(f.frame.x, f.frame.y, f.frame.w, f.frame.h) }));
  const look = hasCampArt(pack) ? parseCampLook(find(arts, pack, 'art.json')) : DEFAULT_CAMP_LOOK;
  return {
    look,
    has: (n) => frames.has(n),
    frame: (n) => {
      const t = frames.get(n);
      if (!t) throw new Error(`camp art "${use}" is missing "${n}"`);
      return t;
    },
  };
}
