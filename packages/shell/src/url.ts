import type { ShellConfig } from './config.js';

/**
 * The renderer URL with the mode applied. Strip is the renderer default, so it adds nothing;
 * map adds `mode=map`. The renderer only checks `transparent` for presence.
 */
/** The mode a renderer URL asks for, when it names one. The page navigates to `?mode=...` to switch (the `m` key, the on-screen exit button). */
export function modeFromUrl(url: string): 'strip' | 'map' | undefined {
  try {
    const u = new URL(url);
    // The renderer defaults to strip, so a URL without `mode=map` asks for strip.
    return u.searchParams.get('mode') === 'map' ? 'map' : 'strip';
  } catch {
    return undefined;
  }
}

/** `slice` is this window's part of a strip that spans monitors; it only applies in strip mode. */
export function rendererUrl(cfg: Pick<ShellConfig, 'url' | 'mode' | 'pack' | 'scale' | 'minimal' | 'bubbles' | 'vitals' | 'sounds' | 'alerts'>, slice?: { offset: number; total: number }): string {
  const u = new URL(cfg.url);
  if (slice && cfg.mode === 'strip') u.searchParams.set('span', `${Math.round(slice.offset)},${Math.round(slice.total)}`);
  else if (u.searchParams.has('span')) u.searchParams.delete('span');
  if (cfg.mode === 'map') u.searchParams.set('mode', 'map');
  else if (u.searchParams.has('mode')) u.searchParams.delete('mode');
  if (cfg.pack) u.searchParams.set('pack', cfg.pack);
  else if (u.searchParams.has('pack')) u.searchParams.delete('pack');
  if (cfg.scale) u.searchParams.set('scale', String(cfg.scale));
  else if (u.searchParams.has('scale')) u.searchParams.delete('scale');
  if (cfg.minimal !== undefined) u.searchParams.set('minimal', cfg.minimal ? '1' : '0');
  else if (u.searchParams.has('minimal')) u.searchParams.delete('minimal');
  if (cfg.bubbles !== undefined) u.searchParams.set('bubbles', cfg.bubbles ? '1' : '0');
  else if (u.searchParams.has('bubbles')) u.searchParams.delete('bubbles');
  if (cfg.sounds !== undefined) u.searchParams.set('sounds', cfg.sounds ? '1' : '0');
  else if (u.searchParams.has('sounds')) u.searchParams.delete('sounds');
  // Banners need room: only the map window gets them. The strip window is a thin bar at the bottom.
  if (cfg.mode === 'map' && cfg.alerts !== undefined) u.searchParams.set('alerts', cfg.alerts);
  else if (u.searchParams.has('alerts')) u.searchParams.delete('alerts');
  if (cfg.vitals !== undefined) u.searchParams.set('vitals', cfg.vitals ? '1' : '0');
  else if (u.searchParams.has('vitals')) u.searchParams.delete('vitals');
  return u.toString();
}
