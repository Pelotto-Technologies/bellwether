import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { adapterArgs } from '../src/adapter-args.js';
import { type DisplayInfo, pickDisplay, stripBounds, windowBounds } from '../src/bounds.js';
import { DEFAULT_CONFIG, loadConfig, normalizeConfig, saveConfig } from '../src/config.js';
import { adapterPaths } from '../src/paths.js';
import { applyAction, buildMenuModel } from '../src/tray-menu.js';
import { rendererUrl } from '../src/url.js';

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
  it('map mode uses the work area', () => {
    expect(windowBounds(primary, 'map', 160)).toEqual(primary.workArea);
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
    expect(normalizeConfig({ mode: 'x', port: 'a', displayId: 'z', stripHeight: 1 })).toEqual(DEFAULT_CONFIG);
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
      args: ['/a/bin.js', '--live', '--port', '7341', '--serve', '/r', '--all'],
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
    expect(checked).toEqual(['Default (bellwether.toml)', '2: Side (2560x1440)', 'a']);
    expect(labels(m)).toContain('Switch to Map');
    expect(labels(m)).toContain('Quit Bellwether');
  });
  it('checks the primary monitor and all sessions by default, and keeps a vanished session visible', () => {
    const m = buildMenuModel({ mode: 'map', displayId: 77, session: 'gone' }, [primary, second], []);
    expect(labels(m)).toContain('gone');
    expect(labels(m)).toContain('Switch to Strip');
    const d = buildMenuModel({ mode: 'strip' }, [primary, second], []);
    expect(d.flatMap((i) => (i.kind === 'item' && i.checked ? [i.label] : []))).toEqual(['Default (bellwether.toml)', '1: Main (1920x1080) primary', 'All sessions']);
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
