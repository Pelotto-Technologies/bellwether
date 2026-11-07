export const DEFAULT_PACK = 'neutral';

/**
 * First candidate that names an available pack wins (query string, then config).
 * Falls back to the default pack, then to whichever pack exists.
 */
export function pickPack(available: string[], ...candidates: (string | null | undefined)[]): string {
  for (const c of candidates) if (c && available.includes(c)) return c;
  if (available.includes(DEFAULT_PACK)) return DEFAULT_PACK;
  const first = [...available].sort()[0];
  if (!first) throw new Error('no theme packs found under themes/');
  return first;
}
