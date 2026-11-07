import { appendFileSync, readFileSync } from 'node:fs';
import { BaseSource } from './source.js';
import type { Delta } from './types.js';

/** Appends each delta as one JSON line. Recordings are local and gitignored. */
export function recordTo(path: string): (delta: Delta) => void {
  return (delta) => appendFileSync(path, JSON.stringify(delta) + '\n');
}

export function parseRecording(text: string): Delta[] {
  return text
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => JSON.parse(l) as Delta);
}

export interface ReplayOptions {
  /** Playback speed multiplier. */
  speed?: number;
  loop?: boolean;
}

/** Replays a recorded delta stream with its original timing, scaled by `speed`. */
export class ReplaySource extends BaseSource {
  private timer: ReturnType<typeof setTimeout> | undefined;
  private stopped = false;

  constructor(
    private deltas: Delta[],
    private opts: ReplayOptions = {},
  ) {
    super();
  }

  static fromFile(path: string, opts?: ReplayOptions): ReplaySource {
    return new ReplaySource(parseRecording(readFileSync(path, 'utf8')), opts);
  }

  async start(): Promise<void> {
    this.stopped = false;
    this.play(0);
  }

  private play(i: number): void {
    if (this.stopped) return;
    const delta = this.deltas[i];
    if (!delta) {
      if (this.opts.loop && this.deltas.length > 0) this.play(0);
      return;
    }
    this.emit(delta);
    const next = this.deltas[i + 1];
    const gap = next ? Math.max(0, next.t - delta.t) / (this.opts.speed ?? 1) : 1000;
    this.timer = setTimeout(() => this.play(i + 1), gap);
  }

  async stop(): Promise<void> {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
  }
}
