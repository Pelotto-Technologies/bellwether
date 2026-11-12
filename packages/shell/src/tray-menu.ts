import type { DisplayInfo } from './bounds.js';
import type { AlertsSetting, Mode, ShellConfig } from './config.js';

export type MenuAction =
  | { type: 'toggle-mode' }
  | { type: 'pick-display'; id: number }
  | { type: 'toggle-span' }
  | { type: 'toggle-map-top' }
  | { type: 'reset-map' }
  | { type: 'pick-labels'; minimal: boolean | undefined }
  | { type: 'pick-bubbles'; bubbles: boolean | undefined }
  | { type: 'pick-sounds'; sounds: boolean }
  | { type: 'pick-alerts'; alerts: AlertsSetting | undefined }
  | { type: 'toggle-vitals' }
  | { type: 'toggle-recap' }
  | { type: 'pick-scale'; scale: number | undefined }
  | { type: 'pick-pack'; pack: string | undefined }
  | { type: 'pick-session'; session: string | undefined }
  | { type: 'quit' };

export type MenuItem =
  | { kind: 'item'; label: string; checked?: boolean; enabled?: boolean; action?: MenuAction; submenu?: MenuItem[] }
  | { kind: 'separator' };

/** Public packs shipped in themes/; a private or custom pack in the config is added to the list. */
export const BUILTIN_PACKS: readonly { name: string; label: string }[] = [
  { name: 'neutral', label: 'Workshop Crew' },
  { name: 'aesir', label: 'Aesir' },
  { name: 'wayfarers', label: 'Wayfarers' },
  { name: 'scifi', label: 'Deep Space' },
];

/** Alert banner positions offered in the tray's Alerts submenu. */
export const ALERT_CHOICES: readonly { alerts: AlertsSetting; label: string }[] = [
  { alerts: 'off', label: 'Off' },
  { alerts: 'top-left', label: 'Top left' },
  { alerts: 'top-right', label: 'Top right' },
  { alerts: 'top-center', label: 'Top centre' },
];

/** Strip sizes offered in the tray; the number is the art pixel scale. */
export const SIZES: readonly { scale: number; label: string }[] = [
  { scale: 1, label: 'Tiny' },
  { scale: 2, label: 'Compact' },
  { scale: 3, label: 'Normal' },
  { scale: 4, label: 'Large' },
];

const modeLabel = (m: Mode) => (m === 'strip' ? 'Strip' : 'Map');

/** Pure description of the tray menu; main.ts turns it into an Electron Menu. */
export function buildMenuModel(
  cfg: Pick<ShellConfig, 'mode' | 'displayId' | 'session' | 'scale' | 'minimal' | 'bubbles' | 'vitals' | 'recap' | 'alerts' | 'span' | 'mapAlwaysOnTop'> & { pack?: string; sounds?: boolean },
  displays: readonly DisplayInfo[],
  sessions: readonly string[],
): MenuItem[] {
  const other: Mode = cfg.mode === 'strip' ? 'map' : 'strip';
  const activeDisplay = displays.some((d) => d.id === cfg.displayId) ? cfg.displayId : (displays.find((d) => d.primary) ?? displays[0])?.id;
  const sessionNames = [...new Set(cfg.session ? [...sessions, cfg.session] : sessions)];
  const packs = [...BUILTIN_PACKS, ...(cfg.pack && !BUILTIN_PACKS.some((p) => p.name === cfg.pack) ? [{ name: cfg.pack, label: cfg.pack }] : [])];
  return [
    { kind: 'item', label: `Mode: ${modeLabel(cfg.mode)}`, enabled: false },
    { kind: 'item', label: `Switch to ${modeLabel(other)}`, action: { type: 'toggle-mode' } },
    { kind: 'separator' },
    { kind: 'item', label: 'Map window', enabled: false },
    { kind: 'item', label: 'Always on top', checked: !!cfg.mapAlwaysOnTop, action: { type: 'toggle-map-top' } },
    { kind: 'item', label: 'Reset position', action: { type: 'reset-map' } },
    { kind: 'separator' },
    { kind: 'item', label: 'Size', enabled: false },
    { kind: 'item', label: 'Default (bellwether.toml)', checked: !cfg.scale, action: { type: 'pick-scale', scale: undefined } },
    ...SIZES.map<MenuItem>((z) => ({ kind: 'item', label: z.label, checked: z.scale === cfg.scale, action: { type: 'pick-scale', scale: z.scale } })),
    { kind: 'separator' },
    { kind: 'item', label: 'Labels', enabled: false },
    { kind: 'item', label: 'Default (bellwether.toml)', checked: cfg.minimal === undefined, action: { type: 'pick-labels', minimal: undefined } },
    { kind: 'item', label: 'Full labels', checked: cfg.minimal === false, action: { type: 'pick-labels', minimal: false } },
    { kind: 'item', label: 'Icon only', checked: cfg.minimal === true, action: { type: 'pick-labels', minimal: true } },
    { kind: 'separator' },
    { kind: 'item', label: 'Chat bubbles', enabled: false },
    { kind: 'item', label: 'Default (bellwether.toml)', checked: cfg.bubbles === undefined, action: { type: 'pick-bubbles', bubbles: undefined } },
    { kind: 'item', label: 'Show', checked: cfg.bubbles === true, action: { type: 'pick-bubbles', bubbles: true } },
    { kind: 'item', label: 'Hide', checked: cfg.bubbles === false, action: { type: 'pick-bubbles', bubbles: false } },
    { kind: 'separator' },
    // `sounds` is the effective state (tray choice, else bellwether.toml, else on), so the box is ticked when cues play.
    { kind: 'item', label: 'Sounds', checked: cfg.sounds ?? true, action: { type: 'pick-sounds', sounds: !(cfg.sounds ?? true) } },
    {
      kind: 'item',
      label: 'Alerts (map window)',
      submenu: [
        { kind: 'item', label: 'Default (bellwether.toml)', checked: cfg.alerts === undefined, action: { type: 'pick-alerts', alerts: undefined } },
        ...ALERT_CHOICES.map<MenuItem>((c) => ({ kind: 'item', label: c.label, checked: c.alerts === cfg.alerts, action: { type: 'pick-alerts', alerts: c.alerts } })),
      ],
    },
    // Shown unless switched off here or in bellwether.toml; the first click from the default hides them.
    { kind: 'item', label: 'Vitals', checked: cfg.vitals !== false, action: { type: 'toggle-vitals' } },
    // The quest recap card (map window and browser pages) or one-line banner (strip); shown unless switched off here or in bellwether.toml.
    { kind: 'item', label: 'Quest recap', checked: cfg.recap !== false, action: { type: 'toggle-recap' } },
    { kind: 'separator' },
    { kind: 'item', label: 'Skin', enabled: false },
    { kind: 'item', label: 'Default (bellwether.toml)', checked: !cfg.pack, action: { type: 'pick-pack', pack: undefined } },
    ...packs.map<MenuItem>((p) => ({ kind: 'item', label: p.label, checked: p.name === cfg.pack, action: { type: 'pick-pack', pack: p.name } })),
    { kind: 'separator' },
    { kind: 'item', label: 'Monitor', enabled: false },
    ...(displays.length > 1
      ? [{ kind: 'item', label: 'Span all monitors (strip)', checked: !!cfg.span, action: { type: 'toggle-span' } } satisfies MenuItem]
      : []),
    ...displays.map<MenuItem>((d, i) => ({
      kind: 'item',
      label: `${i + 1}: ${d.label} (${d.bounds.width}x${d.bounds.height})${d.primary ? ' primary' : ''}`,
      // While spanning, the strip uses every monitor; the pick still sets where map mode opens.
      checked: d.id === activeDisplay,
      action: { type: 'pick-display', id: d.id },
    })),
    { kind: 'separator' },
    { kind: 'item', label: 'Session', enabled: false },
    { kind: 'item', label: 'All sessions', checked: !cfg.session, action: { type: 'pick-session', session: undefined } },
    ...sessionNames.map<MenuItem>((s) => ({
      kind: 'item',
      label: s,
      checked: s === cfg.session,
      action: { type: 'pick-session', session: s },
    })),
    { kind: 'separator' },
    { kind: 'item', label: 'Quit Bellwether', action: { type: 'quit' } },
  ];
}

/** Apply a menu action to the config; says whether the adapter must restart and the renderer reload. */
export function applyAction(cfg: ShellConfig, action: MenuAction): { cfg: ShellConfig; restartAdapter: boolean; reload: boolean } {
  switch (action.type) {
    case 'toggle-mode':
      return { cfg: { ...cfg, mode: cfg.mode === 'strip' ? 'map' : 'strip' }, restartAdapter: false, reload: true };
    case 'pick-display': {
      // Picking a monitor also brings the map window to it.
      const next = { ...cfg, displayId: action.id };
      delete next.mapBounds;
      return { cfg: next, restartAdapter: false, reload: false };
    }
    case 'toggle-map-top': {
      const next = { ...cfg };
      if (cfg.mapAlwaysOnTop) delete next.mapAlwaysOnTop;
      else next.mapAlwaysOnTop = true;
      return { cfg: next, restartAdapter: false, reload: false };
    }
    case 'reset-map': {
      const next = { ...cfg };
      delete next.mapBounds;
      return { cfg: next, restartAdapter: false, reload: false };
    }
    case 'toggle-span': {
      const next = { ...cfg };
      if (cfg.span) delete next.span;
      else next.span = true;
      return { cfg: next, restartAdapter: false, reload: true };
    }
    case 'pick-labels': {
      const next = { ...cfg };
      if (action.minimal === undefined) delete next.minimal;
      else next.minimal = action.minimal;
      return { cfg: next, restartAdapter: false, reload: cfg.minimal !== action.minimal };
    }
    case 'pick-bubbles': {
      const next = { ...cfg };
      if (action.bubbles === undefined) delete next.bubbles;
      else next.bubbles = action.bubbles;
      return { cfg: next, restartAdapter: false, reload: cfg.bubbles !== action.bubbles };
    }
    case 'pick-sounds':
      return { cfg: { ...cfg, sounds: action.sounds }, restartAdapter: false, reload: cfg.sounds !== action.sounds };
    case 'pick-alerts': {
      const next = { ...cfg };
      if (action.alerts === undefined) delete next.alerts;
      else next.alerts = action.alerts;
      // The strip never shows banners, so only the map window needs a reload.
      return { cfg: next, restartAdapter: false, reload: cfg.mode === 'map' && cfg.alerts !== action.alerts };
    }
    case 'toggle-vitals':
      return { cfg: { ...cfg, vitals: cfg.vitals === false }, restartAdapter: false, reload: true };
    case 'toggle-recap':
      return { cfg: { ...cfg, recap: cfg.recap === false }, restartAdapter: false, reload: true };
    case 'pick-scale': {
      const next = { ...cfg };
      if (action.scale) next.scale = action.scale;
      else delete next.scale;
      return { cfg: next, restartAdapter: false, reload: cfg.scale !== action.scale };
    }
    case 'pick-pack': {
      const next = { ...cfg };
      if (action.pack) next.pack = action.pack;
      else delete next.pack;
      return { cfg: next, restartAdapter: false, reload: cfg.pack !== action.pack };
    }
    case 'pick-session': {
      const next = { ...cfg };
      if (action.session) next.session = action.session;
      else delete next.session;
      const changed = cfg.session !== action.session;
      return { cfg: next, restartAdapter: cfg.spawnAdapter && changed, reload: changed };
    }
    case 'quit':
      return { cfg, restartAdapter: false, reload: false };
  }
}
