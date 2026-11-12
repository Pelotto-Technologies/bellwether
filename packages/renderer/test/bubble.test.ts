import { describe, expect, it } from 'vitest';
import { memberBox, overlapArea, placeBubble, TAIL } from '../src/map/bubble.js';

const scene = { w: 400, h: 300 };
const size = { w: 80, h: 20 };

describe('placeBubble', () => {
  it('sits straight above the speaker in empty space, tail at the speaker', () => {
    const p = placeBubble({ speaker: { x: 200, y: 200 }, size, obstacles: [], scene });
    expect(p.tailDown).toBe(true);
    expect(p.x).toBe(160);
    expect(p.y).toBe(200 - 37 - 20 - TAIL);
    expect(p.tailX).toBe(40);
    expect(p.overlap).toBe(0);
  });

  it('shifts away from a neighbour above and stays clear of it', () => {
    const neighbour = memberBox({ x: 200, y: 150 });
    const p = placeBubble({ speaker: { x: 200, y: 200 }, size, obstacles: [neighbour], scene });
    expect(p.overlap).toBe(0);
    expect(overlapArea({ x: p.x, y: p.y, w: 80, h: 20 + TAIL }, neighbour)).toBe(0);
  });

  it('flips below the speaker when the space above is taken', () => {
    const wall = { x: 0, y: 0, w: 400, h: 190 };
    const p = placeBubble({ speaker: { x: 200, y: 200 }, size, obstacles: [wall], scene });
    expect(p.tailDown).toBe(false);
    expect(p.y).toBeGreaterThan(200);
    expect(p.overlap).toBe(0);
  });

  it('is clamped to the scene and the tail still points at a speaker near the edge', () => {
    const p = placeBubble({ speaker: { x: 4, y: 100 }, size, obstacles: [], scene });
    expect(p.x).toBeGreaterThanOrEqual(2);
    expect(p.tailX).toBeGreaterThanOrEqual(7);
    const q = placeBubble({ speaker: { x: 399, y: 20 }, size, obstacles: [], scene });
    expect(q.x + 80).toBeLessThanOrEqual(398);
    expect(q.y).toBeGreaterThanOrEqual(2);
    expect(q.tailX).toBeLessThanOrEqual(73);
  });

  it('picks the least covering spot when nothing is free', () => {
    const everywhere = { x: 0, y: 0, w: 400, h: 300 };
    const p = placeBubble({ speaker: { x: 200, y: 200 }, size, obstacles: [everywhere], scene });
    expect(p.overlap).toBe(80 * (20 + TAIL));
  });
});
