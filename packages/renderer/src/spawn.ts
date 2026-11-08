/** Spawn animation maths. Pure and pack-agnostic: it never looks at art, only at time. */

/** Seconds a new figure takes to arrive. */
export const SPAWN_DUR = 0.9;
/** Birth time for something that was already there when the overlay opened: its animation is over. */
export const NO_SPAWN = -99;

export interface SpawnPose {
  /** 0 to 1; multiplies the figure's alpha. */
  alpha: number;
  /** Multipliers on the figure's scale: it stretches tall and thin, then settles. */
  sx: number;
  sy: number;
  /** Pixels (art pixels, before scale) the figure still has to drop; positive is up. */
  lift: number;
}

const clamp01 = (n: number) => Math.min(1, Math.max(0, n));

/** Beam-in: fades up while dropping and snapping from a tall sliver to full size, with a small overshoot. */
export function spawnPose(age: number): SpawnPose {
  if (age >= SPAWN_DUR) return { alpha: 1, sx: 1, sy: 1, lift: 0 };
  const p = clamp01(age / SPAWN_DUR);
  const settle = 1 - (1 - p) ** 3;
  const bounce = Math.sin(p * Math.PI) * 0.12 * (1 - p);
  return {
    alpha: clamp01(p * 3),
    sx: 0.2 + 0.8 * settle + bounce,
    sy: 1.5 - 0.5 * settle - bounce,
    lift: 14 * (1 - settle),
  };
}

export interface Particle {
  /** Offset from the spawn point in units of one radius (multiply by the radius in pixels). */
  dx: number;
  dy: number;
  /** Side of the square, in art pixels. */
  size: number;
  alpha: number;
}

/** A ring of square sparks flying outward from the feet. Empty once the puff is over. */
export function puffParticles(age: number, count = 10): Particle[] {
  if (age < 0 || age >= SPAWN_DUR) return [];
  const p = age / SPAWN_DUR;
  const reach = 1 - (1 - p) ** 2;
  const out: Particle[] = [];
  for (let i = 0; i < count; i++) {
    const a = (i / count) * Math.PI * 2;
    // Flattened vertically so the ring reads as lying on the ground.
    out.push({ dx: Math.cos(a) * reach, dy: Math.sin(a) * reach * 0.35, size: 2 - p, alpha: 0.9 * (1 - p) });
  }
  return out;
}

/** Whether the OS asks for less motion. Spawns then simply appear. */
export function prefersReducedMotion(): boolean {
  try {
    return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}

/** Birth time for something first seen now: it animates unless the world was not yet loaded or motion is reduced. */
export function birthTime(now: number, primed: boolean, reduced: boolean): number {
  return primed && !reduced ? now : NO_SPAWN;
}
