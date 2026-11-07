import type { Status } from '@bellwether/adapter/core';
import type { AnimName } from './art.js';

/** Pure animation choice for a member. No Pixi here. */

export interface AnimState {
  moving: boolean;
  status: Status;
  talking: boolean;
}

/** Idle members blink for BLINK_LEN seconds out of every BLINK_EVERY. */
export const BLINK_EVERY = 4;
export const BLINK_LEN = 0.18;
/** Finished members wave for WAVE_LEN seconds out of every WAVE_EVERY. */
export const WAVE_EVERY = 9;
export const WAVE_LEN = 1.6;

export function chooseAnim(s: AnimState, t: number, phase: number): AnimName {
  if (s.talking) return 'talk';
  if (s.status === 'blocked') return 'raise';
  if (s.status === 'done' && (t + phase * 7) % WAVE_EVERY < WAVE_LEN) return 'wave';
  if (s.moving) return 'walk';
  if ((t + phase * 3) % BLINK_EVERY < BLINK_LEN) return 'blink';
  return 'idle';
}

/** Index of the frame to show: advances at `fps`, wraps at `count`. */
export function frameIndex(count: number, fps: number, t: number, phase: number): number {
  return Math.floor((t + phase) * fps) % Math.max(1, count);
}

export function frameNames(anim: AnimName, index: number): { base: string; tip: string; cloak: string } {
  const base = `${anim}_${index}`;
  return { base, tip: `${base}_tip`, cloak: `${base}_cloak` };
}
