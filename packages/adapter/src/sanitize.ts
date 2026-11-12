// Validation shared by every place untrusted vitals text and numbers enter the world model.

export const MAX_MODEL = 40;
export const MAX_EFFORT = 16;
export const MAX_QUEST = 80;
export const MAX_NAME = 40;

/** C0 and C1 controls, line and paragraph separators, bidi embeddings, overrides and isolates. */
const UNSAFE = /[\u0000-\u001f\u007f-\u009f\u200e\u200f\u2028\u2029\u202a-\u202e\u2066-\u2069]/g;

/** One line of display text: unsafe characters dropped, whitespace collapsed, capped at `max`. Undefined when nothing is left. */
export function cleanText(value: unknown, max: number): string | undefined {
  if (typeof value !== 'string') return undefined;
  // Controls such as tab and newline separate words, so they become spaces before the rest is dropped.
  const out = value.replace(/[\t\n\r\u2028\u2029]/g, ' ').replace(UNSAFE, '').replace(/\s+/g, ' ').trim();
  return out ? Array.from(out).slice(0, max).join('').trim() : undefined;
}

/** A percentage 0-100, rounded and clamped. Numbers and numeric strings are taken; anything else is dropped. */
export function cleanPercent(value: unknown): number | undefined {
  const n = typeof value === 'string' && value.trim() !== '' ? Number(value) : value;
  if (typeof n !== 'number' || !Number.isFinite(n)) return undefined;
  return Math.min(100, Math.max(0, Math.round(n)));
}
