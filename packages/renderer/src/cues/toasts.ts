import type { Role, Status } from '@bellwether/adapter/core';
import { ago } from '../map/detail.js';
import type { CueEvent } from './events.js';

/** One alert banner. Role, party label and status only; never prompt or say text. */
export interface Toast {
  text: string;
  status: Status;
  /** Whose face to show, when it is about one member. */
  role?: Role;
}

const MAX_LABEL = 28;

function clip(label: string): string {
  return label.length > MAX_LABEL ? label.slice(0, MAX_LABEL - 1).trimEnd() + '…' : label;
}

/** The banner for an event, or undefined when it does not get one (messages and extra members stay sound-only). */
export function toastFor(e: CueEvent): Toast | undefined {
  const label = e.label ? clip(e.label) : undefined;
  const role = e.role ?? 'generic';
  switch (e.kind) {
    case 'done': {
      const took = e.durationMs !== undefined ? ago(e.durationMs) : undefined;
      return { text: [`${role} finished`, label, took].filter(Boolean).join(' · '), status: 'done', ...(e.role ? { role: e.role } : {}) };
    }
    case 'blocked':
      return { text: [`${role} needs you`, label].filter(Boolean).join(' · '), status: 'blocked', ...(e.role ? { role: e.role } : {}) };
    case 'spawn':
      return e.scope === 'party' && label ? { text: `New party: ${label}`, status: 'working', ...(e.role ? { role: e.role } : {}) } : undefined;
    case 'allDone':
      return { text: 'All quests complete', status: 'done' };
    case 'message':
      return undefined;
  }
}

export const TOAST_TIMING = { inMs: 350, holdMs: 4000, outMs: 350, gapMs: 250, maxQueue: 6, busyHoldMs: 2000 } as const;

export type ToastPhase = 'in' | 'hold' | 'out';

export interface ToastFrame {
  toast: Toast;
  phase: ToastPhase;
  /** How far in the banner is: 0 hidden, 1 fully shown. */
  shown: number;
}

/** Shows banners one at a time: slide in, hold, slide out, a short gap, the next. Pure; the page supplies the clock. */
export class ToastQueue {
  private queue: Toast[] = [];
  private current: { toast: Toast; startedAt: number; holdMs: number } | undefined;
  private nextAt = 0;

  /** Adds a banner; an identical one already waiting or showing is dropped, and the oldest waiting goes when the queue is full. */
  push(toast: Toast): void {
    if (this.current?.toast.text === toast.text || this.queue.some((q) => q.text === toast.text)) return;
    this.queue.push(toast);
    while (this.queue.length > TOAST_TIMING.maxQueue) this.queue.shift();
  }

  get waiting(): number {
    return this.queue.length;
  }

  clear(): void {
    this.queue = [];
    this.current = undefined;
  }

  frame(now: number): ToastFrame | null {
    const T = TOAST_TIMING;
    if (!this.current) {
      if (!this.queue.length || now < this.nextAt) return null;
      // A backlog drains faster so banners stay roughly current.
      this.current = { toast: this.queue.shift()!, startedAt: now, holdMs: this.queue.length >= 2 ? T.busyHoldMs : T.holdMs };
    }
    const c = this.current;
    const e = now - c.startedAt;
    if (e < T.inMs) return { toast: c.toast, phase: 'in', shown: e / T.inMs };
    if (e < T.inMs + c.holdMs) return { toast: c.toast, phase: 'hold', shown: 1 };
    if (e < T.inMs + c.holdMs + T.outMs) return { toast: c.toast, phase: 'out', shown: 1 - (e - T.inMs - c.holdMs) / T.outMs };
    this.current = undefined;
    this.nextAt = now + T.gapMs;
    return null;
  }
}
