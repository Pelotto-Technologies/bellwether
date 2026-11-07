import type { Delta } from './types.js';

export type DeltaListener = (delta: Delta) => void;

/** Anything that produces a Delta stream: the mock, a replay, or the live Herdr client. */
export interface WorldSource {
  start(): Promise<void>;
  stop(): Promise<void>;
  on(event: 'delta', fn: DeltaListener): void;
}

/** Small base class so sources share listener bookkeeping without Node's EventEmitter. */
export abstract class BaseSource implements WorldSource {
  private listeners: DeltaListener[] = [];

  on(_event: 'delta', fn: DeltaListener): void {
    this.listeners.push(fn);
  }

  protected emit(delta: Delta): void {
    for (const fn of this.listeners) fn(delta);
  }

  abstract start(): Promise<void>;
  abstract stop(): Promise<void>;
}
