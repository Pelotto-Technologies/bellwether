import type { Pt } from './layout.js';

/** Pure camera: world pixels <-> screen pixels, with a smooth zoom between overview and a focused party. */

export interface Camera {
  /** World point at the centre of the screen. */
  cx: number;
  cy: number;
  zoom: number;
}

export interface Size {
  w: number;
  h: number;
}

/** Zoom that fits the whole map in the screen (integer steps keep pixels crisp once large enough). */
export function fitZoom(map: Size, screen: Size, margin = 24): number {
  const z = Math.min((screen.w - margin * 2) / map.w, (screen.h - margin * 2) / map.h);
  return Math.max(0.25, z);
}

export function focusZoom(screen: Size): number {
  return Math.max(3, Math.round(Math.min(screen.w, screen.h) / 180));
}

export function worldToScreen(c: Camera, screen: Size, p: Pt): Pt {
  return { x: screen.w / 2 + (p.x - c.cx) * c.zoom, y: screen.h / 2 + (p.y - c.cy) * c.zoom };
}

export function screenToWorld(c: Camera, screen: Size, p: Pt): Pt {
  return { x: c.cx + (p.x - screen.w / 2) / c.zoom, y: c.cy + (p.y - screen.h / 2) / c.zoom };
}

/** Exponential approach: frame-rate independent, never overshoots. */
export function stepCamera(c: Camera, target: Camera, dt: number, rate = 8): Camera {
  const k = 1 - Math.exp(-rate * dt);
  const lerp = (a: number, b: number) => (Math.abs(b - a) < 0.001 ? b : a + (b - a) * k);
  // Zoom interpolates in log space so zooming in and out feel symmetric.
  const zoom = Math.exp(lerp(Math.log(c.zoom), Math.log(target.zoom)));
  return { cx: lerp(c.cx, target.cx), cy: lerp(c.cy, target.cy), zoom };
}

/** Id of the nearest party within `radius` world pixels of `p`, if any. */
export function nearestParty(points: { id: string; x: number; y: number }[], p: Pt, radius: number): string | undefined {
  let best: string | undefined;
  let bestD = radius * radius;
  for (const q of points) {
    const d = (q.x - p.x) ** 2 + (q.y - p.y) ** 2;
    if (d <= bestD) {
      bestD = d;
      best = q.id;
    }
  }
  return best;
}
