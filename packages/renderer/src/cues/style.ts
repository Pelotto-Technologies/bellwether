/** Per-pack flavour of the sound cues: `sounds` in theme.json. Pure; no WebAudio here. */

export const WAVES = ['square', 'triangle', 'sawtooth', 'sine'] as const;
export type Wave = (typeof WAVES)[number];

/** Semitone offsets of each scale from its root. Plain scales, not melodies. */
export const SCALES = {
  major: [0, 2, 4, 5, 7, 9, 11],
  minor: [0, 2, 3, 5, 7, 8, 10],
  dorian: [0, 2, 3, 5, 7, 9, 10],
  lydian: [0, 2, 4, 6, 7, 9, 11],
  pentatonic: [0, 2, 4, 7, 9],
  minorPentatonic: [0, 3, 5, 7, 10],
  wholeTone: [0, 2, 4, 6, 8, 10],
} as const;
export type ScaleName = keyof typeof SCALES;
export const SCALE_NAMES = Object.keys(SCALES) as ScaleName[];

export interface SoundStyle {
  wave: Wave;
  /** MIDI note of the scale's root (60 is middle C). */
  root: number;
  scale: ScaleName;
  /** Beats per minute; sets how long each cue takes. */
  tempo: number;
}

export const DEFAULT_SOUNDS: SoundStyle = { wave: 'square', root: 60, scale: 'major', tempo: 126 };

/** The tempo floor keeps the longest cue (the all-done fanfare, two beats) under 1.5 seconds. */
export const TEMPO_RANGE = { min: 80, max: 200 } as const;
export const ROOT_RANGE = { min: 36, max: 84 } as const;

const NOTE_NAMES: Record<string, number> = { c: 0, d: 2, e: 4, f: 5, g: 7, a: 9, b: 11 };

/** `60`, or a name like `C4`, `F#3`, `Bb4` (middle C is C4). Undefined when it is neither. */
export function parseRoot(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return Math.round(value);
  if (typeof value !== 'string') return undefined;
  const m = /^([a-g])([#b]?)(-?\d)$/i.exec(value.trim());
  if (!m) return undefined;
  const accidental = m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0;
  return 12 * (Number(m[3]) + 1) + NOTE_NAMES[m[1]!.toLowerCase()]! + accidental;
}

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

/** Validates the optional `sounds` block. Anything missing or invalid falls back to the default. */
export function parseSounds(raw: unknown): SoundStyle {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { ...DEFAULT_SOUNDS };
  const s = raw as Record<string, unknown>;
  const wave = (WAVES as readonly unknown[]).includes(s.wave) ? (s.wave as Wave) : DEFAULT_SOUNDS.wave;
  const scale = (SCALE_NAMES as readonly unknown[]).includes(s.scale) ? (s.scale as ScaleName) : DEFAULT_SOUNDS.scale;
  const root = parseRoot(s.root);
  const tempo = typeof s.tempo === 'number' && Number.isFinite(s.tempo) ? s.tempo : undefined;
  return {
    wave,
    scale,
    root: root === undefined ? DEFAULT_SOUNDS.root : clamp(root, ROOT_RANGE.min, ROOT_RANGE.max),
    tempo: tempo === undefined ? DEFAULT_SOUNDS.tempo : clamp(tempo, TEMPO_RANGE.min, TEMPO_RANGE.max),
  };
}
