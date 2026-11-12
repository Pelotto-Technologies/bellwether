/** Parsing of the sound and alert toggles: bellwether.toml (served as config.json), URL params and keys. Pure. */

export const ALERT_POSITIONS = ['off', 'top-left', 'top-right', 'top-center'] as const;
export type AlertPosition = (typeof ALERT_POSITIONS)[number];

export const DEFAULT_VOLUME = 0.3;

export function parseAlerts(value: unknown): AlertPosition | undefined {
  return typeof value === 'string' && (ALERT_POSITIONS as readonly string[]).includes(value) ? (value as AlertPosition) : undefined;
}

/** A volume from 0 to 1; numbers and numeric strings alike. Out of range clamps; garbage is undefined. */
export function parseVolume(value: unknown): number | undefined {
  const n = typeof value === 'string' && value.trim() !== '' ? Number(value) : value;
  if (typeof n !== 'number' || !Number.isFinite(n)) return undefined;
  return Math.min(1, Math.max(0, n));
}

/** `?sounds=0|1`; a bare `?sounds` means on. Undefined when the param is absent or unreadable. */
export function parseSwitch(value: string | null): boolean | undefined {
  if (value === null) return undefined;
  const v = value.trim().toLowerCase();
  if (v === '' || v === '1' || v === 'true' || v === 'on' || v === 'yes') return true;
  if (v === '0' || v === 'false' || v === 'off' || v === 'no') return false;
  return undefined;
}

/** The cue-related slice of the adapter's `config.json`, with wrong types dropped. */
export interface ServedCues {
  sounds?: boolean;
  volume?: number;
  alerts?: AlertPosition;
  /** `recap = false` in bellwether.toml hides the quest recap card. */
  recap?: boolean;
}

export function servedCues(cfg: unknown): ServedCues {
  if (!cfg || typeof cfg !== 'object') return {};
  const c = cfg as Record<string, unknown>;
  const volume = parseVolume(typeof c.volume === 'number' ? c.volume : undefined);
  const alerts = parseAlerts(c.alerts);
  return {
    ...(typeof c.sounds === 'boolean' ? { sounds: c.sounds } : {}),
    ...(volume !== undefined ? { volume } : {}),
    ...(alerts !== undefined ? { alerts } : {}),
    ...(typeof c.recap === 'boolean' ? { recap: c.recap } : {}),
  };
}

export interface CueOptions {
  sounds: boolean;
  volume: number;
  alerts: AlertPosition;
  /** Show the quest recap (the card, or a toast where there is no room for one). */
  recap: boolean;
  /** The full results card has room: false on the thin desktop strip window and on the alerts-only page, which get a one-line toast. */
  card: boolean;
}

/** `?recap=0` beats `recap = false` in bellwether.toml; on by default. */
export function resolveRecap(params: URLSearchParams, served: Pick<ServedCues, 'recap'>): boolean {
  return parseSwitch(params.get('recap')) ?? served.recap ?? true;
}

export interface ResolveInput {
  params: URLSearchParams;
  served: ServedCues;
  /** `strip`, `map` or `alerts` (the alerts-only page). */
  mode: 'strip' | 'map' | 'alerts';
  /** Another window of a strip that spans monitors: only the leftmost window makes noise. */
  spanFollower?: boolean;
  /** The page runs inside the desktop shell (Electron); its strip window is a thin bar. */
  desktop?: boolean;
}

/**
 * URL beats bellwether.toml beats the default. Sounds default off for a plain page (a browser tab or OBS source);
 * the desktop shell asks for them with `?sounds=1` unless the user turned them off.
 * Alerts default off, except on the alerts-only page, which exists to show them (top right).
 * The strip honours only an explicit `?alerts=`: the desktop strip window is a thin bar with no room for a banner,
 * so a `bellwether.toml` setting does not reach it.
 */
export function resolveOptions({ params, served, mode, spanFollower, desktop }: ResolveInput): CueOptions {
  const sounds = parseSwitch(params.get('sounds')) ?? served.sounds ?? false;
  const volume = parseVolume(params.get('volume')) ?? served.volume ?? DEFAULT_VOLUME;
  const fromUrl = parseAlerts(params.get('alerts'));
  const fromToml = mode === 'strip' ? undefined : served.alerts;
  let alerts = fromUrl ?? fromToml ?? (mode === 'alerts' ? 'top-right' : 'off');
  if (mode === 'alerts' && alerts === 'off' && fromUrl === undefined) alerts = 'top-right';
  // The desktop strip window is a thin bar, so the recap there is a one-line toast; a browser or OBS page has room for the card.
  const card = mode === 'map' || (mode === 'strip' && !desktop);
  return { sounds: sounds && !spanFollower, volume, alerts, recap: resolveRecap(params, served), card };
}

/** What the `a` key does: off becomes the remembered (or default) position, anything else turns off. */
export function toggleAlerts(current: AlertPosition, last: AlertPosition | undefined): AlertPosition {
  return current === 'off' ? (last && last !== 'off' ? last : 'top-right') : 'off';
}
