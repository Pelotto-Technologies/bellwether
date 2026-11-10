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
/** Headroom for depth rows: a crowded strip stacks up to three rows behind the front, 4 art pixels apart. */
const DEPTH_ROOM = 12;

/** Window height the strip needs at an art `scale`: character, nameplate, banner and depth rows, plus a small margin. Gives 198 at scale 3. */
export function stripHeightFor(scale: number): number {
  return Math.ceil((CHARACTER_H + 14 + DEPTH_ROOM) * scale + 24);
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

/** Map window default: 80% of the work area, centred, so there is room to drag it around. */
export function defaultMapBounds(display: DisplayInfo): Rect {
  const a = display.workArea;
  const width = Math.round(a.width * 0.8);
  const height = Math.round(a.height * 0.8);
  return { x: a.x + Math.round((a.width - width) / 2), y: a.y + Math.round((a.height - height) / 2), width, height };
}

/**
 * Map window rectangle: the saved one when it is still on screen (a monitor may have been unplugged),
 * else the default on `display`. The size is kept, shrunk to fit its monitor, and the window is nudged fully into the work area.
 */
export function mapWindowBounds(displays: readonly DisplayInfo[], display: DisplayInfo, saved?: Rect): Rect {
  if (!saved) return defaultMapBounds(display);
  const cx = saved.x + saved.width / 2;
  const cy = saved.y + saved.height / 2;
  const host = displays.find((d) => cx >= d.workArea.x && cx < d.workArea.x + d.workArea.width && cy >= d.workArea.y && cy < d.workArea.y + d.workArea.height);
  if (!host) return defaultMapBounds(display);
  const a = host.workArea;
  const width = Math.max(320, Math.min(saved.width, a.width));
  const height = Math.max(240, Math.min(saved.height, a.height));
  return {
    x: Math.min(Math.max(saved.x, a.x), a.x + a.width - width),
    y: Math.min(Math.max(saved.y, a.y), a.y + a.height - height),
    width,
    height,
  };
}

/** Bounds for the current mode (map: the default; use `mapWindowBounds` for a remembered position). */
export function windowBounds(display: DisplayInfo, mode: 'strip' | 'map', scale: number): Rect {
  return mode === 'map' ? defaultMapBounds(display) : stripBounds(display, stripHeightFor(scale));
}

/** One strip window when the strip spans monitors: where it sits, and its slice of the whole strip. */
export interface SpanSlice {
  displayId: number;
  bounds: Rect;
  /** Left edge of this slice within the whole strip, in DIP. */
  offset: number;
  /** Width of the whole strip, in DIP. */
  total: number;
}

/**
 * Lays one strip across every display, left to right by position. Each display gets a window
 * pinned to its own bottom edge (monitors of different heights still line up at their feet),
 * and the slices join end to end so a party walking off one monitor appears on the next.
 */
export function spanLayout(displays: readonly DisplayInfo[], scale: number): SpanSlice[] {
  const sorted = [...displays].sort((a, b) => a.bounds.x - b.bounds.x || a.bounds.y - b.bounds.y);
  const total = sorted.reduce((n, d) => n + d.bounds.width, 0);
  let offset = 0;
  return sorted.map((d) => {
    const slice = { displayId: d.id, bounds: stripBounds(d, stripHeightFor(scale)), offset, total };
    offset += d.bounds.width;
    return slice;
  });
}

/** Find the display with `id`, else the primary one, else the first. */
export function pickDisplay(displays: readonly DisplayInfo[], id: number | undefined): DisplayInfo | undefined {
  return displays.find((d) => d.id === id) ?? displays.find((d) => d.primary) ?? displays[0];
}
