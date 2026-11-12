import { SCALES, type SoundStyle, type Wave } from './style.js';

export type CueKind = 'done' | 'blocked' | 'spawn' | 'message' | 'allDone' | 'levelUp' | 'questComplete';

/** A tiny original motif: scale degrees (0 is the root; degrees past the scale climb an octave) with lengths in beats. */
export interface Motif {
  degrees: number[];
  beats: number[];
  /** Loudness of the cue, 0 to 1, before the master volume. */
  gain: number;
}

export const MOTIFS: Record<CueKind, Motif> = {
  // A bright climb: an agent finished.
  done: { degrees: [0, 2, 4, 7], beats: [0.4, 0.4, 0.4, 1], gain: 0.9 },
  // Two pings and a drop: someone is waiting on you.
  blocked: { degrees: [4, 4, 1], beats: [0.4, 0.4, 1], gain: 1 },
  // A soft two-note hello. Quiet.
  spawn: { degrees: [0, 4], beats: [0.4, 0.8], gain: 0.45 },
  // One short blip. Very quiet.
  message: { degrees: [7], beats: [0.25], gain: 0.22 },
  // A longer rise to a held top note.
  allDone: { degrees: [0, 2, 4, 7, 9], beats: [0.25, 0.25, 0.25, 0.25, 1], gain: 1 },
  // A quick run up the scale to a held top note: a role levelled up.
  levelUp: { degrees: [0, 2, 4, 7, 11], beats: [0.2, 0.2, 0.2, 0.2, 1], gain: 0.95 },
  // A short fanfare: a stutter on the root, a lift, and a long held top. A party finished its quest.
  questComplete: { degrees: [0, 0, 4, 7, 11], beats: [0.2, 0.2, 0.3, 0.3, 1], gain: 1 },
};

export interface Note {
  midi: number;
  freq: number;
  /** Seconds after the cue starts. */
  start: number;
  /** Seconds the note sounds. */
  dur: number;
  /** 0 to 1 peak before the master volume. */
  gain: number;
  wave: Wave;
}

/** Square and sawtooth waves carry more energy than triangle and sine; even them out. */
export const WAVE_LEVEL: Record<Wave, number> = { square: 0.5, sawtooth: 0.45, triangle: 0.95, sine: 1 };

/** Share of a note's slot that sounds, so repeated pitches stay distinct. */
const ARTICULATION = 0.88;

export const midiToFreq = (midi: number) => 440 * 2 ** ((midi - 69) / 12);

/** The MIDI note of a scale degree; degrees past the scale's length climb by octaves. */
export function degreeToMidi(style: Pick<SoundStyle, 'root' | 'scale'>, degree: number): number {
  const steps = SCALES[style.scale];
  const octave = Math.floor(degree / steps.length);
  const index = ((degree % steps.length) + steps.length) % steps.length;
  return style.root + steps[index]! + 12 * octave;
}

/** The note schedule of one cue in a pack's style. Pure, so frequencies and timings are testable. */
export function schedule(kind: CueKind, style: SoundStyle): Note[] {
  const motif = MOTIFS[kind];
  const beat = 60 / style.tempo;
  const notes: Note[] = [];
  let at = 0;
  motif.degrees.forEach((degree, i) => {
    const length = motif.beats[i]! * beat;
    const midi = degreeToMidi(style, degree);
    notes.push({ midi, freq: midiToFreq(midi), start: at, dur: length * ARTICULATION, gain: motif.gain * WAVE_LEVEL[style.wave], wave: style.wave });
    at += length;
  });
  return notes;
}

/** Seconds from the cue's start to the end of its last note. */
export function cueLength(notes: readonly Note[]): number {
  return notes.reduce((end, n) => Math.max(end, n.start + n.dur), 0);
}
