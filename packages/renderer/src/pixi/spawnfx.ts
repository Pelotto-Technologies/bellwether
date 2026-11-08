import type { Graphics } from 'pixi.js';
import { puffParticles, SPAWN_DUR } from '../spawn.js';

/** Draws the arrival puff: square sparks in `color` flying out from (x, y), where y is the feet. `s` is the art pixel size. */
export function drawPuff(g: Graphics, x: number, y: number, age: number, color: number, s: number, radius = 14): void {
  if (age >= SPAWN_DUR) return;
  for (const p of puffParticles(age)) {
    const px = Math.round((x + p.dx * radius * s) / s) * s;
    const py = Math.round((y + p.dy * radius * s) / s) * s;
    g.rect(px, py, p.size * s, p.size * s).fill({ color, alpha: p.alpha });
  }
}
