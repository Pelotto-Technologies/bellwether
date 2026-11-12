/** Speech bubble placement for the camp scene: prefer empty space, always tail-point at the speaker. Pure, so it can be tested. */

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface BubbleInput {
  /** The speaker's feet. */
  speaker: { x: number; y: number };
  /** Bubble body size (without the tail). */
  size: { w: number; h: number };
  /** Rectangles to keep clear: the other members and bubbles already placed. */
  obstacles: Rect[];
  scene: { w: number; h: number };
  /** Height of a member from the feet to the top of the head. */
  headH?: number;
  /** Extra lift for a mark over the head. */
  lift?: number;
}

export interface BubblePlacement {
  /** Top-left of the bubble body. */
  x: number;
  y: number;
  /** Tail position along the bubble's top or bottom edge, relative to `x`. */
  tailX: number;
  /** The tail sits on the bottom edge (bubble above the speaker); otherwise on the top edge (flipped below). */
  tailDown: boolean;
  /** Overlap area with the obstacles (0 when the bubble sits in empty space). */
  overlap: number;
}

export const TAIL = 4;
const MARGIN = 2;

export function overlapArea(a: Rect, b: Rect): number {
  const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
  return w > 0 && h > 0 ? w * h : 0;
}

/** The box a member occupies, from a station position. */
export function memberBox(st: { x: number; y: number }, headH = 37): Rect {
  return { x: st.x - 9, y: st.y - headH - 2, w: 18, h: headH + 2 };
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/**
 * Candidates in order of preference: straight above the speaker, then shifted sideways (the tail still points at the
 * speaker as long as it stays inside the bubble), then higher up, then flipped below the feet. The first with no
 * overlap wins; otherwise the one that covers the least.
 */
export function placeBubble(input: BubbleInput): BubblePlacement {
  const { speaker, size, obstacles, scene } = input;
  const headH = input.headH ?? 37;
  const lift = input.lift ?? 0;
  const { w: bw, h: bh } = size;
  const maxX = Math.max(MARGIN, scene.w - bw - MARGIN);
  const slide = Math.max(0, bw / 2 - 8);
  const aboveY = speaker.y - headH - bh - TAIL - lift;
  const belowY = speaker.y + 6 + TAIL;
  const spots: Array<{ x: number; y: number; down: boolean }> = [
    { x: speaker.x - bw / 2, y: aboveY, down: true },
    { x: speaker.x - bw / 2 + slide, y: aboveY, down: true },
    { x: speaker.x - bw / 2 - slide, y: aboveY, down: true },
    { x: speaker.x - bw / 2, y: aboveY - 14, down: true },
    { x: speaker.x - bw / 2 + slide, y: aboveY - 14, down: true },
    { x: speaker.x - bw / 2 - slide, y: aboveY - 14, down: true },
    { x: speaker.x - bw / 2, y: belowY, down: false },
    { x: speaker.x - bw / 2 + slide, y: belowY, down: false },
    { x: speaker.x - bw / 2 - slide, y: belowY, down: false },
  ];
  let best: BubblePlacement | undefined;
  for (const s of spots) {
    const x = Math.round(clamp(s.x, MARGIN, maxX));
    const y = Math.round(clamp(s.y, MARGIN, Math.max(MARGIN, scene.h - bh - TAIL - MARGIN)));
    const box = { x, y, w: bw, h: bh + TAIL };
    // The speaker never counts against their own bubble, but the body must not be covered by it either.
    const overlap = obstacles.reduce((sum, o) => sum + overlapArea(box, o), 0);
    const cand: BubblePlacement = { x, y, tailX: Math.round(clamp(speaker.x - x, 7, Math.max(7, bw - 7))), tailDown: s.down, overlap };
    if (overlap === 0) return cand;
    if (!best || overlap < best.overlap) best = cand;
  }
  return best!;
}
