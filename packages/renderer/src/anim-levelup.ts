/** The level-up flourish over a member: pure timing and geometry, so it can be tested. The Pixi drawing is in pixi/levelfx.ts. */

export const LEVELUP_SECONDS = 2.4;
const SPARKLES = 10;

export interface Sparkle {
  /** Offsets from the head, in pixel units. */
  dx: number;
  dy: number;
  alpha: number;
  /** Size in pixel units (1 or 2). */
  size: number;
}

export interface LevelUpFrame {
  /** Height of the arrow above the head, in pixel units. */
  arrowRise: number;
  alpha: number;
  /** The "LEVEL UP" text, above the arrow. */
  textAlpha: number;
  sparkles: Sparkle[];
}

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

/** A deterministic 0..1 value per sparkle index, so the pattern is stable between frames. */
const h = (i: number, k: number) => {
  const x = Math.sin(i * 127.1 + k * 311.7) * 43758.5453;
  return x - Math.floor(x);
};

/**
 * One frame of the flourish at `age` seconds, or undefined once it is over. The arrow pops up and floats; sparkles
 * rise around the head in a ring and fade; the text fades in and out. With `reduced` motion nothing moves:
 * the arrow and text fade in place and the sparkles are left out.
 */
export function levelUpFrame(age: number, reduced: boolean): LevelUpFrame | undefined {
  if (age < 0 || age >= LEVELUP_SECONDS) return undefined;
  const fadeIn = clamp01(age / 0.18);
  const fadeOut = clamp01((LEVELUP_SECONDS - age) / 0.5);
  const alpha = Math.min(fadeIn, fadeOut);
  if (reduced) return { arrowRise: 8, alpha, textAlpha: alpha, sparkles: [] };
  const rise = 6 + Math.min(age, 1.2) * 7 + Math.sin(age * 6) * 0.8;
  const sparkles: Sparkle[] = [];
  for (let i = 0; i < SPARKLES; i++) {
    const delay = h(i, 1) * 0.7;
    const p = clamp01((age - delay) / 1.3);
    if (p <= 0 || p >= 1) continue;
    const angle = (i / SPARKLES) * Math.PI * 2 + age * 1.5;
    sparkles.push({ dx: Math.round(Math.cos(angle) * (6 + 3 * h(i, 2))), dy: Math.round(-4 - p * 18 + Math.sin(angle) * 2), alpha: Math.sin(p * Math.PI), size: h(i, 3) > 0.6 ? 2 : 1 });
  }
  return { arrowRise: Math.round(rise), alpha, textAlpha: Math.min(alpha, clamp01((age - 0.1) / 0.2)), sparkles };
}
