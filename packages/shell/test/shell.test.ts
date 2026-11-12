import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { adapterArgs } from '../src/adapter-args.js';
import { defaultMapBounds, mapWindowBounds, type DisplayInfo, pickDisplay, spanLayout, stripBounds, stripHeightFor, windowBounds } from '../src/bounds.js';
import { DEFAULT_CONFIG, effectiveSounds, loadConfig, normalizeConfig, saveConfig } from '../src/config.js';
import { errorPage, waitForReady } from '../src/ready.js';
import { existsSync } from 'node:fs';
import { adapterPaths, assetsDir } from '../src/paths.js';
import { applyAction, buildMenuModel } from '../src/tray-menu.js';
import { modeFromUrl, rendererUrl } from '../src/url.js';

const second: DisplayInfo = {
  id: 2,
  label: 'Side',
  bounds: { x: 1920, y: -200, width: 2560, height: 1440 },
  workArea: { x: 1920, y: -200, width: 2560, height: 1400 },
};
const primary: DisplayInfo = {
  id: 1,
  label: 'Main',
  primary: true,
  bounds: { x: 0, y: 0, width: 1920, height: 1080 },
  workArea: { x: 0, y: 0, width: 1920, height: 1040 },
};

describe('bounds', () => {
  it('pins the strip to the bottom edge at full width, with offsets', () => {
    expect(stripBounds(second, 160)).toEqual({ x: 1920, y: 1080, width: 2560, height: 160 });
  });
  it('can sit above the taskbar', () => {
    expect(stripBounds(primary, 100, true)).toEqual({ x: 0, y: 940, width: 1920, height: 100 });
  });
  it('clamps height to the display', () => {
    expect(stripBounds(primary, 5000).height).toBe(1080);
  });
  it('map mode is a centred window inside the work area', () => {
    expect(windowBounds(primary, 'map', 3)).toEqual({ x: 192, y: 104, width: 1536, height: 832 });
  });
  it('falls back to primary then first display', () => {
    expect(pickDisplay([second, primary], 2)?.id).toBe(2);
    expect(pickDisplay([second, primary], 99)?.id).toBe(1);
    expect(pickDisplay([second], undefined)?.id).toBe(2);
    expect(pickDisplay([], 1)).toBeUndefined();
  });
});

describe('config', () => {
  it('normalizes junk to defaults', () => {
    expect(normalizeConfig(null)).toEqual(DEFAULT_CONFIG);
    expect(normalizeConfig({ mode: 'x', port: 'a', displayId: 'z', scale: 9 })).toEqual(DEFAULT_CONFIG);
  });
  it('derives url from port unless url is given', () => {
    expect(normalizeConfig({ port: 9000 }).url).toBe('http://127.0.0.1:9000/?transparent');
    expect(normalizeConfig({ port: 9000, url: 'http://h:1/?transparent' }).url).toBe('http://h:1/?transparent');
  });
  it('round-trips through userData and survives a missing or corrupt file', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'bw-shell-'));
    const file = join(dir, 'nested', 'shell.json');
    expect(await loadConfig(file)).toEqual(DEFAULT_CONFIG);
    const cfg = { ...DEFAULT_CONFIG, mode: 'map' as const, displayId: 2, session: 'overlay-dev' };
    await saveConfig(file, cfg);
    expect(JSON.parse(await readFile(file, 'utf8'))).toEqual(cfg);
    expect(await loadConfig(file)).toEqual(cfg);
    await writeFile(file, '{nope');
    expect(await loadConfig(file)).toEqual(DEFAULT_CONFIG);
  });
});

describe('rendererUrl', () => {
  it('leaves strip mode untouched and adds mode=map for map', () => {
    expect(rendererUrl(DEFAULT_CONFIG)).toBe('http://127.0.0.1:7341/?transparent');
    expect(rendererUrl({ ...DEFAULT_CONFIG, mode: 'map' })).toBe('http://127.0.0.1:7341/?transparent=&mode=map');
    expect(rendererUrl({ url: 'http://x/?transparent&mode=map', mode: 'strip' })).toBe('http://x/?transparent=');
  });
});

describe('adapterArgs', () => {
  it('reads all sessions by default', () => {
    expect(adapterArgs({ port: 7341 }, '/a/bin.js', '/r')).toEqual({
      command: 'node',
      args: ['/a/bin.js', '--auto', '--port', '7341', '--serve', '/r', '--exit-with-parent', '--all'],
    });
  });
  it('passes a chosen session instead of --all', () => {
    const { args } = adapterArgs({ port: 1, session: 'overlay-dev' }, 'b', 'r');
    expect(args).toContain('--session');
    expect(args).toContain('overlay-dev');
    expect(args).not.toContain('--all');
  });
});

describe('adapterPaths', () => {
  it('derives from the repo root and honours overrides', () => {
    const p = adapterPaths('/repo', {});
    expect(p.bin.replaceAll('\\', '/')).toBe('/repo/packages/adapter/dist/bin.js');
    expect(adapterPaths('/repo', { BELLWETHER_ADAPTER_BIN: '/x/bin.js' }).bin).toBe('/x/bin.js');
  });
});

describe('tray menu', () => {
  const labels = (m: ReturnType<typeof buildMenuModel>) => m.flatMap((i) => (i.kind === 'item' ? [i.label] : []));
  it('lists monitors and sessions with the active ones checked', () => {
    const m = buildMenuModel({ mode: 'strip', displayId: 2, session: 'a' }, [primary, second], ['a', 'b']);
    const checked = m.flatMap((i) => (i.kind === 'item' && i.checked ? [i.label] : []));
    expect(checked).toEqual(['Default (bellwether.toml)', 'Default (bellwether.toml)', 'Default (bellwether.toml)', 'Sounds', 'Vitals', 'Default (bellwether.toml)', '2: Side (2560x1440)', 'a']);
    expect(labels(m)).toContain('Switch to Map');
    expect(labels(m)).toContain('Quit Bellwether');
  });
  it('checks the primary monitor and all sessions by default, and keeps a vanished session visible', () => {
    const m = buildMenuModel({ mode: 'map', displayId: 77, session: 'gone' }, [primary, second], []);
    expect(labels(m)).toContain('gone');
    expect(labels(m)).toContain('Switch to Strip');
    const d = buildMenuModel({ mode: 'strip' }, [primary, second], []);
    expect(d.flatMap((i) => (i.kind === 'item' && i.checked ? [i.label] : []))).toEqual(['Default (bellwether.toml)', 'Default (bellwether.toml)', 'Default (bellwether.toml)', 'Sounds', 'Vitals', 'Default (bellwether.toml)', '1: Main (1920x1080) primary', 'All sessions']);
  });
  it('offers skins and applies the choice to the renderer URL', () => {
    const m = buildMenuModel({ mode: 'strip', pack: 'aesir' }, [primary], []);
    expect(m.flatMap((i) => (i.kind === 'item' && i.checked ? [i.label] : []))).toContain('Aesir');
    const r = applyAction(DEFAULT_CONFIG, { type: 'pick-pack', pack: 'wayfarers' });
    expect(r).toMatchObject({ restartAdapter: false, reload: true });
    expect(rendererUrl(r.cfg)).toBe('http://127.0.0.1:7341/?transparent=&pack=wayfarers');
    expect('pack' in applyAction(r.cfg, { type: 'pick-pack', pack: undefined }).cfg).toBe(false);
    expect(normalizeConfig({ pack: '../x' }).pack).toBeUndefined();
  });
  it('applies actions', () => {
    const t = applyAction(DEFAULT_CONFIG, { type: 'toggle-mode' });
    expect(t.cfg.mode).toBe('map');
    expect(t.reload).toBe(true);
    const s = applyAction(DEFAULT_CONFIG, { type: 'pick-session', session: 'x' });
    expect(s).toMatchObject({ restartAdapter: true, reload: true });
    expect(s.cfg.session).toBe('x');
    expect(applyAction(s.cfg, { type: 'pick-session', session: 'x' }).restartAdapter).toBe(false);
    expect('session' in applyAction(s.cfg, { type: 'pick-session', session: undefined }).cfg).toBe(false);
    expect(applyAction({ ...DEFAULT_CONFIG, spawnAdapter: false }, { type: 'pick-session', session: 'x' }).restartAdapter).toBe(false);
    expect(applyAction(DEFAULT_CONFIG, { type: 'pick-display', id: 3 }).cfg.displayId).toBe(3);
  });
});

describe('ready', () => {
  it('resolves once the probe succeeds, sleeping between tries', async () => {
    let n = 0;
    const sleeps: number[] = [];
    const ok = await waitForReady(async () => ++n >= 3, { delayMs: 10, sleep: async (ms) => void sleeps.push(ms) });
    expect(ok).toBe(true);
    expect(sleeps).toEqual([10, 10]);
  });
  it('gives up after the configured tries', async () => {
    const ok = await waitForReady(async () => false, { tries: 3, sleep: async () => {} });
    expect(ok).toBe(false);
  });
  it('builds a visible error page', () => {
    expect(decodeURIComponent(errorPage('http://x/<b>'))).toContain('cannot reach http://x/b');
  });
});

describe('assets', () => {
  it('ships the icons the tray and dock load', () => {
    const dir = assetsDir();
    for (const f of ['icon.png', 'icon.ico', 'icon.icns', 'tray.png', 'tray@2x.png', 'trayTemplate.png', 'trayTemplate@2x.png']) {
      expect(existsSync(join(dir, f)), f).toBe(true);
    }
  });
});

describe('modeFromUrl', () => {
  it('reads the mode a navigation asks for', () => {
    expect(modeFromUrl('http://127.0.0.1:7341/?mode=map')).toBe('map');
    expect(modeFromUrl('http://127.0.0.1:7341/?mode=strip')).toBe('strip');
    expect(modeFromUrl('http://127.0.0.1:7341/?transparent')).toBe('strip');
    expect(modeFromUrl('not a url')).toBeUndefined();
  });
});

describe('strip size', () => {
  it('sizes the window to the scale, never clipping the banner at 2, 3 or 4', async () => {
    const { stripHeightFor } = await import('../src/bounds.js');
    expect(stripHeightFor(3)).toBe(198);
    expect(stripHeightFor(2)).toBeLessThan(stripHeightFor(3));
    // Character, nameplate (about 14 art px) and banner all sit inside the window.
    for (const s of [1, 2, 3, 4]) expect(stripHeightFor(s)).toBeGreaterThanOrEqual((32 + 12) * s);
    expect(windowBounds(primary, 'strip', 2).height).toBe(stripHeightFor(2));
  });
  it('validates scale and picks menu, then served, then 3', async () => {
    const { effectiveScale } = await import('../src/config.js');
    expect(normalizeConfig({ scale: 2 }).scale).toBe(2);
    expect(normalizeConfig({ scale: 2.5 }).scale).toBeUndefined();
    expect(effectiveScale({ scale: 2 }, 4)).toBe(2);
    expect(effectiveScale({}, 4)).toBe(4);
    expect(effectiveScale({}, 99)).toBe(3);
  });
  it('menu picks a size, reloads, and puts it in the renderer URL', () => {
    const r = applyAction(DEFAULT_CONFIG, { type: 'pick-scale', scale: 2 });
    expect(r.cfg.scale).toBe(2);
    expect(r.reload).toBe(true);
    expect(rendererUrl(r.cfg)).toContain('scale=2');
    expect(rendererUrl(DEFAULT_CONFIG)).not.toContain('scale=');
    const items = buildMenuModel(r.cfg, [primary], []);
    expect(items.find((i) => i.kind === 'item' && i.label === 'Compact')).toMatchObject({ checked: true });
  });
});

describe('labels', () => {
  it('menu switches to icon-only and passes it to the renderer', () => {
    const r = applyAction(DEFAULT_CONFIG, { type: 'pick-labels', minimal: true });
    expect(r.cfg.minimal).toBe(true);
    expect(r.reload).toBe(true);
    expect(rendererUrl(r.cfg)).toContain('minimal=1');
    expect(rendererUrl(applyAction(r.cfg, { type: 'pick-labels', minimal: false }).cfg)).toContain('minimal=0');
    expect(rendererUrl(applyAction(r.cfg, { type: 'pick-labels', minimal: undefined }).cfg)).not.toContain('minimal');
    expect(normalizeConfig({ minimal: 'x' }).minimal).toBeUndefined();
  });
});

describe('chat bubbles', () => {
  it('menu shows or hides bubbles and passes it to the renderer', () => {
    const r = applyAction(DEFAULT_CONFIG, { type: 'pick-bubbles', bubbles: false });
    expect(r.cfg.bubbles).toBe(false);
    expect(r.reload).toBe(true);
    expect(r.restartAdapter).toBe(false);
    expect(rendererUrl(r.cfg)).toContain('bubbles=0');
    expect(rendererUrl(applyAction(r.cfg, { type: 'pick-bubbles', bubbles: true }).cfg)).toContain('bubbles=1');
    expect(rendererUrl(applyAction(r.cfg, { type: 'pick-bubbles', bubbles: undefined }).cfg)).not.toContain('bubbles');
    expect(applyAction(r.cfg, { type: 'pick-bubbles', bubbles: false }).reload).toBe(false);
    expect(normalizeConfig({ bubbles: 'x' }).bubbles).toBeUndefined();
    expect(normalizeConfig({ bubbles: false }).bubbles).toBe(false);
    const items = buildMenuModel({ ...DEFAULT_CONFIG, bubbles: false }, [], []);
    expect(items.find((i) => i.kind === 'item' && i.label === 'Hide')).toMatchObject({ checked: true });
  });
});

describe('span all monitors', () => {
  const left: DisplayInfo = {
    id: 3,
    label: 'Left',
    bounds: { x: -1280, y: 100, width: 1280, height: 1024 },
    workArea: { x: -1280, y: 100, width: 1280, height: 984 },
  };
  it('lays one strip across every monitor, left to right, each window on its own bottom edge', () => {
    const slices = spanLayout([second, primary, left], 3);
    expect(slices.map((s) => s.displayId)).toEqual([3, 1, 2]);
    expect(slices.map((s) => s.offset)).toEqual([0, 1280, 3200]);
    expect(new Set(slices.map((s) => s.total))).toEqual(new Set([1280 + 1920 + 2560]));
    const h = stripHeightFor(3);
    expect(slices[0]!.bounds).toEqual({ x: -1280, y: 1124 - h, width: 1280, height: h });
    expect(slices[2]!.bounds).toEqual({ x: 1920, y: 1240 - h, width: 2560, height: h });
  });
  it('is a tray option that only shows with more than one monitor, and survives a reload of the config', () => {
    const label = 'Span all monitors (strip)';
    const find = (m: ReturnType<typeof buildMenuModel>) => m.find((i) => i.kind === 'item' && i.label === label);
    expect(find(buildMenuModel({ mode: 'strip' }, [primary], []))).toBeUndefined();
    const off = find(buildMenuModel({ mode: 'strip' }, [primary, second], []));
    expect(off).toMatchObject({ checked: false, action: { type: 'toggle-span' } });
    const r = applyAction(DEFAULT_CONFIG, { type: 'toggle-span' });
    expect(r.cfg.span).toBe(true);
    expect(r.reload).toBe(true);
    expect(find(buildMenuModel(r.cfg, [primary, second], []))).toMatchObject({ checked: true });
    expect(normalizeConfig(JSON.parse(JSON.stringify(r.cfg))).span).toBe(true);
    expect(applyAction(r.cfg, { type: 'toggle-span' }).cfg.span).toBeUndefined();
    expect(normalizeConfig({ span: 'yes' }).span).toBeUndefined();
  });
  it('tells each strip window its slice, and never in map mode', () => {
    expect(rendererUrl(DEFAULT_CONFIG, { offset: 1280, total: 5760 })).toContain('span=1280%2C5760');
    expect(rendererUrl({ ...DEFAULT_CONFIG, mode: 'map' }, { offset: 1280, total: 5760 })).not.toContain('span');
    expect(rendererUrl({ ...DEFAULT_CONFIG, url: 'http://x/?span=1,2' })).not.toContain('span');
  });
});

describe('draggable map window', () => {
  it('defaults to a centred 80% window', () => {
    expect(defaultMapBounds(primary)).toEqual({ x: 192, y: 104, width: 1536, height: 832 });
  });
  it('restores a saved position and keeps it on screen', () => {
    const ds = [primary, second];
    expect(mapWindowBounds(ds, primary, { x: 100, y: 120, width: 800, height: 600 })).toEqual({ x: 100, y: 120, width: 800, height: 600 });
    expect(mapWindowBounds(ds, primary, { x: 1400, y: 600, width: 800, height: 600 })).toEqual({ x: 1120, y: 440, width: 800, height: 600 });
  });
  it('falls back to the default when the saved monitor is gone', () => {
    expect(mapWindowBounds([primary], primary, { x: 3000, y: 0, width: 800, height: 600 })).toEqual(defaultMapBounds(primary));
  });
  it('toggles always-on-top (default off) and resets the position', () => {
    expect(normalizeConfig({}).mapAlwaysOnTop).toBeUndefined();
    const on = applyAction(DEFAULT_CONFIG, { type: 'toggle-map-top' }).cfg;
    expect(on.mapAlwaysOnTop).toBe(true);
    expect(applyAction(on, { type: 'toggle-map-top' }).cfg.mapAlwaysOnTop).toBeUndefined();
    const m = buildMenuModel(on, [primary], []);
    expect(m).toContainEqual({ kind: 'item', label: 'Always on top', checked: true, action: { type: 'toggle-map-top' } });
    const moved = { ...on, mapBounds: { x: 1, y: 2, width: 400, height: 300 } };
    expect(applyAction(moved, { type: 'reset-map' }).cfg.mapBounds).toBeUndefined();
    expect(applyAction(moved, { type: 'pick-display', id: 2 }).cfg.mapBounds).toBeUndefined();
  });
  it('sanitises saved config', () => {
    expect(normalizeConfig({ mapAlwaysOnTop: true, mapBounds: { x: 1.4, y: 2, width: 500, height: 400 } })).toMatchObject({ mapAlwaysOnTop: true, mapBounds: { x: 1, y: 2, width: 500, height: 400 } });
    expect(normalizeConfig({ mapBounds: { x: 'a', y: 2, width: 5, height: 5 } }).mapBounds).toBeUndefined();
    expect(normalizeConfig({ mapAlwaysOnTop: 'yes' }).mapAlwaysOnTop).toBeUndefined();
  });
});

describe('sounds and alerts', () => {
  it('the Sounds checkbox follows the effective state and flips it, persisted and passed to the page', () => {
    const on = buildMenuModel({ ...DEFAULT_CONFIG, sounds: true }, [], []);
    expect(on.find((i) => i.kind === 'item' && i.label === 'Sounds')).toMatchObject({ checked: true, action: { type: 'pick-sounds', sounds: false } });
    const off = buildMenuModel({ ...DEFAULT_CONFIG, sounds: false }, [], []);
    expect(off.find((i) => i.kind === 'item' && i.label === 'Sounds')).toMatchObject({ checked: false, action: { type: 'pick-sounds', sounds: true } });
    const r = applyAction(DEFAULT_CONFIG, { type: 'pick-sounds', sounds: false });
    expect(r.cfg.sounds).toBe(false);
    expect(r.reload).toBe(true);
    expect(applyAction(r.cfg, { type: 'pick-sounds', sounds: false }).reload).toBe(false);
    expect(rendererUrl(r.cfg)).toContain('sounds=0');
    expect(rendererUrl({ ...r.cfg, sounds: true })).toContain('sounds=1');
    expect(rendererUrl(DEFAULT_CONFIG)).not.toContain('sounds');
    expect(normalizeConfig({ sounds: 'x' }).sounds).toBeUndefined();
    expect(normalizeConfig({ sounds: false }).sounds).toBe(false);
  });

  it('sounds default on in the desktop overlay unless the tray or bellwether.toml says otherwise', () => {
    expect(effectiveSounds({}, undefined)).toBe(true);
    expect(effectiveSounds({}, false)).toBe(false);
    expect(effectiveSounds({ sounds: true }, false)).toBe(true);
    expect(effectiveSounds({ sounds: false }, true)).toBe(false);
  });

  it('the Alerts submenu picks a position, and only the map window gets it', () => {
    const items = buildMenuModel({ ...DEFAULT_CONFIG, alerts: 'top-right' }, [], []);
    const alerts = items.find((i) => i.kind === 'item' && i.label.startsWith('Alerts'));
    const sub = alerts && alerts.kind === 'item' ? (alerts.submenu ?? []) : [];
    expect(sub.map((i) => (i.kind === 'item' ? i.label : '-'))).toEqual(['Default (bellwether.toml)', 'Off', 'Top left', 'Top right', 'Top centre']);
    expect(sub.find((i) => i.kind === 'item' && i.label === 'Top right')).toMatchObject({ checked: true });
    const picked = applyAction({ ...DEFAULT_CONFIG, mode: 'map' }, { type: 'pick-alerts', alerts: 'top-left' });
    expect(picked.cfg.alerts).toBe('top-left');
    expect(picked.reload).toBe(true);
    expect(rendererUrl(picked.cfg)).toContain('alerts=top-left');
    expect(rendererUrl({ ...picked.cfg, mode: 'strip' })).not.toContain('alerts');
    expect(applyAction({ ...picked.cfg, mode: 'strip' }, { type: 'pick-alerts', alerts: 'off' }).reload).toBe(false);
    expect(applyAction(picked.cfg, { type: 'pick-alerts', alerts: undefined }).cfg.alerts).toBeUndefined();
    expect(normalizeConfig({ alerts: 'top-center' }).alerts).toBe('top-center');
    expect(normalizeConfig({ alerts: 'middle' }).alerts).toBeUndefined();
  });
});

describe('vitals toggle', () => {
  it('is a checkbox, on unless switched off, persisted and passed to the renderer', () => {
    const item = (cfg: Parameters<typeof buildMenuModel>[0]) => buildMenuModel(cfg, [], []).find((i) => i.kind === 'item' && i.label === 'Vitals');
    expect(item(DEFAULT_CONFIG)).toMatchObject({ checked: true, action: { type: 'toggle-vitals' } });
    const off = applyAction(DEFAULT_CONFIG, { type: 'toggle-vitals' });
    expect(off.cfg.vitals).toBe(false);
    expect(off.reload).toBe(true);
    expect(item(off.cfg)).toMatchObject({ checked: false });
    expect(rendererUrl(off.cfg)).toContain('vitals=0');
    const on = applyAction(off.cfg, { type: 'toggle-vitals' });
    expect(on.cfg.vitals).toBe(true);
    expect(rendererUrl(on.cfg)).toContain('vitals=1');
    expect(rendererUrl(DEFAULT_CONFIG)).not.toContain('vitals');
    expect(normalizeConfig({ vitals: false }).vitals).toBe(false);
    expect(normalizeConfig({ vitals: 'x' }).vitals).toBeUndefined();
  });
});
