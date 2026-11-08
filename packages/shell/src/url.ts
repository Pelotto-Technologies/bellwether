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

export function rendererUrl(cfg: Pick<ShellConfig, 'url' | 'mode' | 'pack' | 'scale' | 'minimal' | 'bubbles'>): string {
  const u = new URL(cfg.url);
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
  return u.toString();
}
