import type { CueEvent } from './events.js';
import { CueGate, soundsFor } from './gate.js';
import { type CueKind, schedule } from './schedule.js';
import type { SoundStyle } from './style.js';

type ContextFactory = () => AudioContext | undefined;

const defaultFactory: ContextFactory = () => {
  const Ctor = (globalThis as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext }).AudioContext ?? (globalThis as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  return Ctor ? new Ctor() : undefined;
};

/** Peak of the quietest sound before the end of a note; exponential ramps cannot reach zero. */
const FLOOR = 0.0001;
const ATTACK_S = 0.006;
/** Cues start a hair after "now" so the first note is never clipped. */
const LEAD_S = 0.02;

export interface PlayerOptions {
  volume: number;
  enabled: boolean;
  /** Overridable in tests. */
  createContext?: ContextFactory;
  gate?: CueGate;
}

/**
 * A thin WebAudio layer over the pure cue schedules: one oscillator and gain envelope per note.
 * It tolerates a missing AudioContext and a suspended one (autoplay policy): a cue that arrives while
 * the context is suspended is dropped, never queued, so unlocking does not release a burst.
 */
export class SoundPlayer {
  private ctx: AudioContext | undefined;
  private master: GainNode | undefined;
  private failed = false;
  private enabled: boolean;
  private volume: number;
  private readonly gate: CueGate;
  private readonly createContext: ContextFactory;

  constructor(
    private style: SoundStyle,
    opts: PlayerOptions,
  ) {
    this.enabled = opts.enabled;
    this.volume = opts.volume;
    this.gate = opts.gate ?? new CueGate();
    this.createContext = opts.createContext ?? defaultFactory;
    if (this.enabled) this.ensure();
  }

  get isEnabled(): boolean {
    return this.enabled;
  }

  /** The context state, for the page's status and for tests. */
  get state(): AudioContextState | 'unavailable' {
    return this.ctx?.state ?? 'unavailable';
  }

  setEnabled(on: boolean): void {
    this.enabled = on;
    if (on) this.ensure();
  }

  setVolume(v: number): void {
    this.volume = v;
    if (this.master && this.ctx) this.master.gain.setTargetAtTime(v, this.ctx.currentTime, 0.01);
  }

  /** Browser autoplay policy: a context starts suspended until the first click or key. Call once. */
  unlockOnGesture(target: Pick<Window, 'addEventListener' | 'removeEventListener'> = window): void {
    const events = ['pointerdown', 'keydown', 'touchstart'] as const;
    const unlock = () => {
      if (this.enabled) this.ensure();
      void this.ctx?.resume().then(
        () => {
          if (this.ctx?.state === 'running') for (const e of events) target.removeEventListener(e, unlock);
        },
        () => {},
      );
    };
    for (const e of events) target.addEventListener(e, unlock);
  }

  private ensure(): AudioContext | undefined {
    if (this.ctx || this.failed) return this.ctx;
    try {
      const ctx = this.createContext();
      if (!ctx) {
        this.failed = true;
        return undefined;
      }
      const master = ctx.createGain();
      master.gain.value = this.volume;
      master.connect(ctx.destination);
      this.ctx = ctx;
      this.master = master;
      // Electron and OBS browser sources start running at once; a browser tab stays suspended until a gesture.
      if (ctx.state === 'suspended') void ctx.resume().catch(() => {});
    } catch {
      this.failed = true;
    }
    return this.ctx;
  }

  /** Plays the cues for a batch of events (one delta), after the gate. `now` is a monotonic clock in ms. */
  handle(events: readonly CueEvent[], now: number): void {
    for (const kind of soundsFor(events)) if (this.gate.allow(kind, now)) this.play(kind);
  }

  /** Plays one cue now. Returns whether anything was scheduled. */
  play(kind: CueKind): boolean {
    if (!this.enabled) return false;
    const ctx = this.ensure();
    const master = this.master;
    if (!ctx || !master) return false;
    if (ctx.state !== 'running') {
      void ctx.resume().catch(() => {});
      return false;
    }
    try {
      const t0 = ctx.currentTime + LEAD_S;
      for (const n of schedule(kind, this.style)) {
        const osc = ctx.createOscillator();
        const env = ctx.createGain();
        osc.type = n.wave;
        osc.frequency.value = n.freq;
        const start = t0 + n.start;
        const end = start + n.dur;
        env.gain.setValueAtTime(FLOOR, start);
        env.gain.exponentialRampToValueAtTime(Math.max(FLOOR, n.gain), start + ATTACK_S);
        env.gain.exponentialRampToValueAtTime(FLOOR, end);
        osc.connect(env);
        env.connect(master);
        osc.start(start);
        osc.stop(end + 0.02);
      }
      return true;
    } catch {
      return false;
    }
  }
}
