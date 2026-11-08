export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface DisplayInfo {
  id: number;
  label: string;
  /** Full display bounds in DIP. */
  bounds: Rect;
  /** Bounds minus taskbar/dock in DIP. */
  workArea: Rect;
  primary?: boolean;
}

/** Characters are 24x32 art pixels; the strip also holds a nameplate and a banner above them. */
const CHARACTER_H = 32;

/** Window height the strip needs at an art `scale`: character, nameplate and banner, plus a small margin. Gives 162 at scale 3. */
export function stripHeightFor(scale: number): number {
  return Math.ceil((CHARACTER_H + 14) * scale + 24);
}

export const DEFAULT_STRIP_HEIGHT = stripHeightFor(3);

/**
 * Window rectangle for the strip: the display's full width, pinned to the bottom edge.
 * Uses the full bounds (not workArea) so the strip sits over the taskbar edge like an overlay;
 * pass `respectWorkArea` to sit above the taskbar instead.
 */
export function stripBounds(display: DisplayInfo, height = DEFAULT_STRIP_HEIGHT, respectWorkArea = false): Rect {
  const area = respectWorkArea ? display.workArea : display.bounds;
  const h = Math.max(1, Math.min(Math.round(height), area.height));
  return { x: area.x, y: area.y + area.height - h, width: area.width, height: h };
}

/** Map mode covers the whole display. */
export function mapBounds(display: DisplayInfo): Rect {
  return { ...display.workArea };
}

/** Bounds for the current mode. */
export function windowBounds(display: DisplayInfo, mode: 'strip' | 'map', scale: number): Rect {
  return mode === 'map' ? mapBounds(display) : stripBounds(display, stripHeightFor(scale));
}

/** Find the display with `id`, else the primary one, else the first. */
export function pickDisplay(displays: readonly DisplayInfo[], id: number | undefined): DisplayInfo | undefined {
  return displays.find((d) => d.id === id) ?? displays.find((d) => d.primary) ?? displays[0];
}
