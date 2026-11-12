/** The `camp` block of a pack's art.json: pure, so it can be tested without Pixi. */

export interface CampLook {
  /** 'camp' (wood and canvas) or 'outpost' (plating and holograms). */
  tone: 'camp' | 'outpost';
  /** Sky gradient, top then horizon. */
  sky: [string, string];
  /** Colour of the fire's light. */
  glow: string;
}

export const DEFAULT_CAMP_LOOK: CampLook = { tone: 'camp', sky: ['#8fd0f0', '#e4f4fa'], glow: '#ffa84a' };

const HEX = /^#[0-9a-f]{6}$/i;

/** Reads the optional `camp` block of an art manifest; missing or malformed fields take the defaults. */
export function parseCampLook(raw: unknown): CampLook {
  const c = (raw as { camp?: Record<string, unknown> } | undefined)?.camp;
  if (!c || typeof c !== 'object') return DEFAULT_CAMP_LOOK;
  const sky = Array.isArray(c.sky) && c.sky.length === 2 && c.sky.every((s) => typeof s === 'string' && HEX.test(s)) ? (c.sky as [string, string]) : DEFAULT_CAMP_LOOK.sky;
  return {
    tone: c.tone === 'outpost' ? 'outpost' : 'camp',
    sky,
    glow: typeof c.glow === 'string' && HEX.test(c.glow) ? c.glow : DEFAULT_CAMP_LOOK.glow,
  };
}
