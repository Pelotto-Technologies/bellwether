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

export const DEFAULT_STRIP_HEIGHT = 160;

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
export function windowBounds(display: DisplayInfo, mode: 'strip' | 'map', stripHeight: number): Rect {
  return mode === 'map' ? mapBounds(display) : stripBounds(display, stripHeight);
}

/** Find the display with `id`, else the primary one, else the first. */
export function pickDisplay(displays: readonly DisplayInfo[], id: number | undefined): DisplayInfo | undefined {
  return displays.find((d) => d.id === id) ?? displays.find((d) => d.primary) ?? displays[0];
}
