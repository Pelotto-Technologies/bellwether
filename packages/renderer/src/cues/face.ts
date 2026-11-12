import type { Role } from '@bellwether/adapter/core';
import { Container, Rectangle, Sprite, Texture, type Renderer } from 'pixi.js';
import { buildFrame, paletteFor, rasterize, SPRITE_W } from '../sprites.js';
import type { Theme } from '../theme.js';
import type { LoadedArt } from '../pixi/pack.js';

/** Share of the figure's height kept for the face crop (the head and shoulders). */
const ART_CROP = 0.5;
const PROCEDURAL_ROWS = 10;

/** A data URL of the role's head, or undefined when it cannot be drawn. Cached per role. */
export type FaceProvider = (role: Role) => string | undefined;

const hexNum = (hex: string) => parseInt(hex.slice(1), 16);

/** Procedural packs: rasterize the top of the stand frame onto a 2D canvas. */
function proceduralFace(theme: Theme, role: Role): string | undefined {
  const canvas = document.createElement('canvas');
  canvas.width = SPRITE_W;
  canvas.height = PROCEDURAL_ROWS;
  const ctx = canvas.getContext('2d');
  if (!ctx) return undefined;
  const px = rasterize(buildFrame(theme.roles[role], 'stand', false), paletteFor(theme.roles[role], theme));
  ctx.putImageData(new ImageData(px.slice(0, SPRITE_W * PROCEDURAL_ROWS * 4), SPRITE_W, PROCEDURAL_ROWS), 0, 0);
  return canvas.toDataURL();
}

/** Art packs: render the idle frame (base plus tinted cloak) off-screen and crop its top half. */
function artFace(renderer: Renderer, art: LoadedArt, role: Role): string | undefined {
  const sheet = art.sheets[role];
  const root = new Container();
  const base = new Sprite(sheet.textures['idle_0'] ?? Texture.EMPTY);
  const cloak = new Sprite(sheet.textures['idle_0_cloak'] ?? Texture.EMPTY);
  cloak.tint = hexNum(art.art.roles[role].cloak);
  root.addChild(base, cloak);
  try {
    const a = art.art.character.anchor;
    for (const sp of [base, cloak]) sp.anchor.set(a.x, a.y);
    const b = root.getLocalBounds();
    const canvas = renderer.extract.canvas({ target: root, frame: new Rectangle(b.x, b.y, b.width, Math.round(b.height * ART_CROP)), resolution: 1, clearColor: [0, 0, 0, 0] });
    return (canvas as HTMLCanvasElement).toDataURL?.();
  } finally {
    root.destroy({ children: true });
  }
}

export function makeFaceProvider(theme: Theme, art: LoadedArt | null, renderer: Renderer | undefined): FaceProvider {
  const cache = new Map<Role, string | undefined>();
  return (role) => {
    if (cache.has(role)) return cache.get(role);
    let url: string | undefined;
    try {
      url = art ? (renderer ? artFace(renderer, art, role) : undefined) : proceduralFace(theme, role);
    } catch {
      url = undefined;
    }
    cache.set(role, url);
    return url;
  };
}

