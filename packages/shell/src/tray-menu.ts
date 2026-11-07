import type { DisplayInfo } from './bounds.js';
import type { Mode, ShellConfig } from './config.js';

export type MenuAction =
  | { type: 'toggle-mode' }
  | { type: 'pick-display'; id: number }
  | { type: 'pick-pack'; pack: string | undefined }
  | { type: 'pick-session'; session: string | undefined }
  | { type: 'quit' };

export type MenuItem =
  | { kind: 'item'; label: string; checked?: boolean; enabled?: boolean; action?: MenuAction }
  | { kind: 'separator' };

/** Public packs shipped in themes/; a private or custom pack in the config is added to the list. */
export const BUILTIN_PACKS: readonly { name: string; label: string }[] = [
  { name: 'neutral', label: 'Workshop Crew' },
  { name: 'aesir', label: 'Aesir' },
  { name: 'wayfarers', label: 'Wayfarers' },
];

const modeLabel = (m: Mode) => (m === 'strip' ? 'Strip' : 'Map');

/** Pure description of the tray menu; main.ts turns it into an Electron Menu. */
export function buildMenuModel(
  cfg: Pick<ShellConfig, 'mode' | 'displayId' | 'session'> & { pack?: string },
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
    { kind: 'item', label: 'Skin', enabled: false },
    { kind: 'item', label: 'Default (bellwether.toml)', checked: !cfg.pack, action: { type: 'pick-pack', pack: undefined } },
    ...packs.map<MenuItem>((p) => ({ kind: 'item', label: p.label, checked: p.name === cfg.pack, action: { type: 'pick-pack', pack: p.name } })),
    { kind: 'separator' },
    { kind: 'item', label: 'Monitor', enabled: false },
    ...displays.map<MenuItem>((d, i) => ({
      kind: 'item',
      label: `${i + 1}: ${d.label} (${d.bounds.width}x${d.bounds.height})${d.primary ? ' primary' : ''}`,
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
    case 'pick-display':
      return { cfg: { ...cfg, displayId: action.id }, restartAdapter: false, reload: false };
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
