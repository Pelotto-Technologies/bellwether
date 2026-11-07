import { describe, expect, it, vi } from 'vitest';
import { parseRecording, ReplaySource } from '../src/recording.js';
import type { Delta } from '../src/types.js';

const deltas: Delta[] = [
  { t: 1000, kind: 'removed', partyId: 'a' },
  { t: 3000, kind: 'removed', partyId: 'b' },
];

describe('recording', () => {
  it('parses jsonl and skips blank lines', () => {
    const text = deltas.map((d) => JSON.stringify(d)).join('\n\n') + '\n';
    expect(parseRecording(text)).toEqual(deltas);
  });

  it('replays with original gaps scaled by speed', async () => {
    vi.useFakeTimers();
    const src = new ReplaySource(deltas, { speed: 2 });
    const got: Delta[] = [];
    src.on('delta', (d) => got.push(d));
    await src.start();
    expect(got).toHaveLength(1);
    vi.advanceTimersByTime(999);
    expect(got).toHaveLength(1);
    vi.advanceTimersByTime(1);
    expect(got).toHaveLength(2);
    await src.stop();
    vi.useRealTimers();
  });
});
