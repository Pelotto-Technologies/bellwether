import type { Delta } from './types.js';

/** Anything that produces world deltas: mock, live Herdr, replay. */
export interface WorldSource {
  start(): Promise<void>;
  stop(): Promise<void>;
  on(event: 'delta', fn: (d: Delta) => void): void;
}
