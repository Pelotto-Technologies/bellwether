import type { ShellConfig } from './config.js';

/**
 * The renderer URL with the mode applied. Strip is the renderer default, so it adds nothing;
 * map adds `mode=map`. The renderer only checks `transparent` for presence.
 */
export function rendererUrl(cfg: Pick<ShellConfig, 'url' | 'mode'>): string {
  const u = new URL(cfg.url);
  if (cfg.mode === 'map') u.searchParams.set('mode', 'map');
  else if (u.searchParams.has('mode')) u.searchParams.delete('mode');
  return u.toString();
}
