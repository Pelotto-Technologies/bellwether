import type { Activity } from './activity.js';

/** Pure pose choice for a member at its camp station: which character frame, how far it moves, which prop frame. */

export interface CampPose {
  /** Character animation and frame index within it ('work' is the camp scene's hammering pose). */
  anim: 'work' | 'idle' | 'blink' | 'talk' | 'raise' | 'wave' | 'walk';
  index: number;
  /** Pixel offsets from the station, whole pixels. */
  dx: number;
  dy: number;
  /** Which way to face, or 0 for toward the fire. */
  face: -1 | 0 | 1;
  /** Frame of the station prop's animation. */
  prop: number;
  /** Frame of the effect sprite over the head (alert, question), when the activity has one. */
  mark: number;
}

const FLIP = [0, 0, 0, 0, 0, 0, 0, 1, 2, 3, 0, 0];
/** Pacing: seconds to walk one way, then stand. */
const PACE_LEG = 2;
const PACE_PAUSE = 1;
const PACE_REACH = 6;

/** `has` says whether the sheet has the camp-only 'work' frames; without them the member gestures instead. */
export function campPose(a: Activity, t: number, phase: number, has = true): CampPose {
  const s = t + phase;
  const base: CampPose = { anim: 'idle', index: Math.floor(s * 2) % 2, dx: 0, dy: 0, face: 0, prop: 0, mark: 0 };
  const work = (rate: number): Pick<CampPose, 'anim' | 'index'> => (has ? { anim: 'work', index: Math.floor(s * rate) % 2 } : { anim: 'talk', index: Math.floor(s * rate) % 2 });
  switch (a) {
    case 'edit':
      return { ...base, ...work(4), prop: Math.floor(s * 4) % 4 };
    case 'shell':
      return { ...base, ...work(2.5), prop: Math.floor(s * 6) % 4 };
    case 'read':
      // Mostly still, with a blink now and then and a page turn every few seconds.
      return { ...base, anim: s % 4 < 0.2 ? 'blink' : 'idle', index: s % 4 < 0.2 ? 0 : Math.floor(s) % 2, dy: Math.floor(s * 1.2) % 2 === 0 ? 0 : 1, prop: FLIP[Math.floor(s * 3) % 12]! };
    case 'search':
      return { ...base, dx: Math.round(Math.sin(s * 0.9)), prop: Math.floor(s * 3) % 4 };
    case 'delegate':
      return { ...base, anim: 'talk', index: Math.floor(s * 3) % 2, prop: Math.floor(s * 6) % 4 };
    case 'think': {
      // Paces: a short walk one way, a pause, a walk back, a pause.
      const cycle = (PACE_LEG + PACE_PAUSE) * 2;
      const c = ((s % cycle) + cycle) % cycle;
      const leg = c < PACE_LEG + PACE_PAUSE ? 0 : 1;
      const into = c - leg * (PACE_LEG + PACE_PAUSE);
      const walking = into < PACE_LEG;
      const progress = Math.min(1, into / PACE_LEG);
      const x = leg === 0 ? -PACE_REACH + 2 * PACE_REACH * progress : PACE_REACH - 2 * PACE_REACH * progress;
      return { ...base, anim: walking ? 'walk' : 'idle', index: walking ? Math.floor(s * 6) % 4 : Math.floor(s * 2) % 2, dx: Math.round(x), face: walking ? (leg === 0 ? 1 : -1) : base.face, prop: Math.floor(s * 2) % 4 };
    }
    case 'blocked':
      return { ...base, anim: 'raise', index: 0, prop: Math.floor(s * 3) % 2, mark: Math.floor(s * 3) % 2 };
    case 'done':
      return { ...base, anim: s % 9 < 1.6 ? 'wave' : 'idle', index: s % 9 < 1.6 ? Math.floor(s * 4) % 2 : Math.floor(s * 2) % 2 };
    case 'idle':
      // Dozing: eyes shut except a brief glance every few seconds.
      return { ...base, anim: s % 5 < 0.4 ? 'idle' : 'blink', index: 0, dy: 1 };
    case 'unknown':
      return { ...base, mark: 0 };
  }
}

/** Rising `z`s for a dozing member: three, offset in time. Each is `{ size, x, y, alpha }` relative to the head. */
export function zzz(t: number, phase: number): { size: 0 | 1 | 2; x: number; y: number; alpha: number }[] {
  return [0, 1, 2].map((i) => {
    const p = (((t + phase) / 3 + i / 3) % 1 + 1) % 1;
    return { size: i as 0 | 1 | 2, x: Math.round(p * 6 + i * 2), y: -Math.round(p * 12), alpha: Math.sin(p * Math.PI) };
  });
}

/** A sweat drop that falls and fades, restarting every 1.4 s: `{ y, alpha }` relative to its start. */
export function sweat(t: number, phase: number): { y: number; alpha: number } {
  const p = (((t + phase) / 1.4) % 1 + 1) % 1;
  return { y: Math.round(p * 7), alpha: p < 0.8 ? 1 : 1 - (p - 0.8) / 0.2 };
}
