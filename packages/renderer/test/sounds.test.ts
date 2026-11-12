import { describe, expect, it, vi } from 'vitest';
import neutral from '../../../themes/neutral/theme.json';
import { CueGate } from '../src/cues/gate.js';
import { SoundPlayer } from '../src/cues/player.js';
import { cueLength, degreeToMidi, midiToFreq, MOTIFS, schedule, type CueKind } from '../src/cues/schedule.js';
import { DEFAULT_SOUNDS, parseRoot, parseSounds, TEMPO_RANGE } from '../src/cues/style.js';
import { parseTheme } from '../src/theme.js';

const KINDS = Object.keys(MOTIFS) as CueKind[];
const PACKS = ['neutral', 'aesir', 'wayfarers', 'scifi'] as const;

async function packTheme(name: string) {
  const mod = (await import(`../../../themes/${name}/theme.json`)) as { default: unknown };
  return parseTheme(mod.default);
}

describe('theme sounds block', () => {
  it('defaults when a pack defines none', () => {
    const { sounds: _ignored, ...bare } = neutral as typeof neutral & { sounds?: unknown };
    expect(parseTheme(bare).sounds).toEqual(DEFAULT_SOUNDS);
  });

  it('reads a valid block, with note names', () => {
    const t = parseTheme({ ...neutral, sounds: { wave: 'triangle', root: 'F#3', scale: 'dorian', tempo: 100 } });
    expect(t.sounds).toEqual({ wave: 'triangle', root: 54, scale: 'dorian', tempo: 100 });
    expect(parseTheme({ ...neutral, sounds: { root: 62 } }).sounds.root).toBe(62);
  });

  it('falls back field by field and clamps', () => {
    const t = parseTheme({ ...neutral, sounds: { wave: 'noise', root: 'H9', scale: 'locrian', tempo: 9000 } });
    expect(t.sounds).toEqual({ ...DEFAULT_SOUNDS, tempo: TEMPO_RANGE.max });
    expect(parseTheme({ ...neutral, sounds: { tempo: 5 } }).sounds.tempo).toBe(TEMPO_RANGE.min);
    expect(parseTheme({ ...neutral, sounds: 'loud' }).sounds).toEqual(DEFAULT_SOUNDS);
  });

  it('parses note names', () => {
    expect(parseRoot('C4')).toBe(60);
    expect(parseRoot('A4')).toBe(69);
    expect(parseRoot('Bb3')).toBe(58);
    expect(parseRoot('nope')).toBeUndefined();
  });

  it('gives the four public packs distinct settings', async () => {
    const styles = await Promise.all(PACKS.map(async (p) => JSON.stringify((await packTheme(p)).sounds)));
    expect(new Set(styles).size).toBe(PACKS.length);
    const waves = await Promise.all(PACKS.map(async (p) => (await packTheme(p)).sounds.wave));
    expect(new Set(waves).size).toBe(PACKS.length);
  });
});

describe('note schedules', () => {
  it('maps scale degrees to semitones, climbing octaves past the scale', () => {
    const c = { root: 60, scale: 'major' } as const;
    expect([0, 2, 4, 7, 9].map((d) => degreeToMidi(c, d))).toEqual([60, 64, 67, 72, 76]);
    expect([0, 2, 4, 7].map((d) => degreeToMidi({ root: 60, scale: 'pentatonic' }, d))).toEqual([60, 64, 69, 76]);
    expect(degreeToMidi(c, -1)).toBe(59);
    expect(midiToFreq(69)).toBeCloseTo(440);
    expect(midiToFreq(60)).toBeCloseTo(261.63, 1);
  });

  it('plays neutral done as C E G C at 132 bpm', async () => {
    const t = await packTheme('neutral');
    const notes = schedule('done', t.sounds);
    expect(notes.map((n) => n.midi)).toEqual([60, 64, 67, 72]);
    expect(notes.map((n) => Math.round(n.freq))).toEqual([262, 330, 392, 523]);
    const beat = 60 / 132;
    expect(notes.map((n) => n.start)).toEqual([0, 0.4 * beat, 0.8 * beat, 1.2 * beat]);
    expect(notes.every((n) => n.wave === 'square')).toBe(true);
  });

  it('plays scifi blocked on the whole-tone scale in sine', async () => {
    const t = await packTheme('scifi');
    const notes = schedule('blocked', t.sounds);
    // A4 root: degrees 4, 4, 1 of whole-tone are +8, +8, +2 semitones.
    expect(notes.map((n) => n.midi)).toEqual([77, 77, 71]);
    expect(notes[0]!.wave).toBe('sine');
  });

  it.each(PACKS)('%s: every cue is short, ordered, audible and in the audible range; fanfare under 1.5s', async (pack) => {
    const t = await packTheme(pack);
    for (const kind of KINDS) {
      const notes = schedule(kind, t.sounds);
      expect(notes.length).toBeGreaterThanOrEqual(1);
      expect(notes.length).toBeLessThanOrEqual(5);
      for (let i = 1; i < notes.length; i++) expect(notes[i]!.start).toBeGreaterThan(notes[i - 1]!.start);
      for (const n of notes) {
        expect(n.freq).toBeGreaterThan(100);
        expect(n.freq).toBeLessThan(4000);
        expect(n.gain).toBeGreaterThan(0);
        expect(n.gain).toBeLessThanOrEqual(1);
        expect(n.dur).toBeGreaterThan(0.03);
      }
      expect(cueLength(notes)).toBeLessThanOrEqual(1.5);
    }
    // message is the quietest, blocked is among the loudest; spawn stays quiet.
    const peak = (k: CueKind) => Math.max(...schedule(k, t.sounds).map((n) => n.gain));
    expect(peak('message')).toBeLessThan(peak('spawn'));
    expect(peak('spawn')).toBeLessThan(peak('done'));
  });

  it('keeps the fanfare under 1.5s even at the slowest tempo', () => {
    expect(cueLength(schedule('allDone', { ...DEFAULT_SOUNDS, tempo: TEMPO_RANGE.min }))).toBeLessThanOrEqual(1.5);
  });
});

/** A minimal fake AudioContext that records what was scheduled. */
function fakeContext(state: AudioContextState) {
  const oscillators: { type: string; freq: number; start: number; stop: number }[] = [];
  const ctx = {
    state,
    currentTime: 10,
    destination: {},
    resume: vi.fn(async () => {
      await Promise.resolve();
      ctx.state = 'running';
    }),
    createGain: () => ({ gain: { value: 1, setValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn(), setTargetAtTime: vi.fn() }, connect: vi.fn() }),
    createOscillator: () => {
      const rec = { type: '', freq: 0, start: 0, stop: 0 };
      oscillators.push(rec);
      return {
        set type(v: string) {
          rec.type = v;
        },
        frequency: {
          set value(v: number) {
            rec.freq = v;
          },
        },
        connect: vi.fn(),
        start: (t: number) => void (rec.start = t),
        stop: (t: number) => void (rec.stop = t),
      };
    },
  };
  return { ctx: ctx as unknown as AudioContext, oscillators, raw: ctx };
}

describe('SoundPlayer', () => {
  const style = DEFAULT_SOUNDS;

  it('schedules one oscillator per note, at the pack frequencies', () => {
    const f = fakeContext('running');
    const p = new SoundPlayer(style, { volume: 0.3, enabled: true, createContext: () => f.ctx });
    expect(p.play('done')).toBe(true);
    expect(f.oscillators.map((o) => Math.round(o.freq))).toEqual(schedule('done', style).map((n) => Math.round(n.freq)));
    expect(f.oscillators.every((o) => o.type === 'square' && o.stop > o.start && o.start >= 10)).toBe(true);
  });

  it('drops a cue while the context is suspended, and asks to resume', () => {
    const f = fakeContext('suspended');
    const p = new SoundPlayer(style, { volume: 0.3, enabled: true, createContext: () => f.ctx });
    expect(p.play('blocked')).toBe(false);
    expect(f.oscillators).toHaveLength(0);
    expect(f.raw.resume).toHaveBeenCalled();
  });

  it('survives a missing AudioContext and a throwing factory', () => {
    const none = new SoundPlayer(style, { volume: 0.3, enabled: true, createContext: () => undefined });
    expect(none.play('done')).toBe(false);
    expect(none.state).toBe('unavailable');
    const boom = new SoundPlayer(style, {
      volume: 0.3,
      enabled: true,
      createContext: () => {
        throw new Error('no audio');
      },
    });
    expect(boom.play('done')).toBe(false);
  });

  it('is silent when disabled and creates no context until enabled', () => {
    const create = vi.fn(() => fakeContext('running').ctx);
    const p = new SoundPlayer(style, { volume: 0.3, enabled: false, createContext: create });
    expect(p.play('done')).toBe(false);
    expect(create).not.toHaveBeenCalled();
    p.setEnabled(true);
    expect(create).toHaveBeenCalledTimes(1);
    expect(p.play('done')).toBe(true);
  });

  it('applies the gate to a batch of events', () => {
    const f = fakeContext('running');
    const p = new SoundPlayer(style, { volume: 0.3, enabled: true, createContext: () => f.ctx, gate: new CueGate({ maxPerSecond: 1 }) });
    p.handle([{ kind: 'done', at: 0 }, { kind: 'blocked', at: 0 }], 0);
    expect(f.oscillators).toHaveLength(schedule('done', style).length);
  });

  it('unlocks on the first gesture, then stops listening', async () => {
    const f = fakeContext('suspended');
    const p = new SoundPlayer(style, { volume: 0.3, enabled: true, createContext: () => f.ctx });
    const handlers = new Map<string, () => void>();
    const target = {
      addEventListener: (e: string, h: () => void) => void handlers.set(e, h),
      removeEventListener: (e: string) => void handlers.delete(e),
    };
    p.unlockOnGesture(target as unknown as Window);
    handlers.get('keydown')!();
    await Promise.resolve();
    await Promise.resolve();
    expect(f.raw.state).toBe('running');
    expect(handlers.size).toBe(0);
  });
});
