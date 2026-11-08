// Thin Electron entry. All decisions live in the pure modules next to this file.
import { type ChildProcess, spawn } from 'node:child_process';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { app, BrowserWindow, dialog, globalShortcut, Menu, nativeImage, screen, Tray, type MenuItemConstructorOptions } from 'electron';
import { type DisplayInfo, pickDisplay, type Rect, spanLayout, windowBounds } from './bounds.js';
import { adapterArgs } from './adapter-args.js';
import { configPath, effectiveScale, loadConfig, saveConfig, validScale, type ShellConfig } from './config.js';
import { adapterPaths, assetsDir, missingBuilds } from './paths.js';
import { applyAction, buildMenuModel, type MenuAction, type MenuItem } from './tray-menu.js';
import { errorPage, waitForReady } from './ready.js';
import { modeFromUrl, rendererUrl } from './url.js';

let cfg: ShellConfig;
/** One window, or one per monitor while the strip spans them. */
let wins: BrowserWindow[] = [];
/** URL each window last loaded, so a window only reloads when its own URL changes. */
const loaded = new WeakMap<BrowserWindow, string>();
let tray: Tray | undefined;
let adapter: ChildProcess | undefined;
let sessions: string[] = [];
/** Scale served by the adapter from bellwether.toml; the window height follows it unless the tray overrides. */
let servedScale: number | undefined;
const paths = adapterPaths();

function displays(): DisplayInfo[] {
  const primary = screen.getPrimaryDisplay().id;
  return screen.getAllDisplays().map((d) => ({
    id: d.id,
    label: d.label || `Display ${d.id}`,
    bounds: d.bounds,
    workArea: d.workArea,
    primary: d.id === primary,
  }));
}

async function reachable(url: string): Promise<boolean> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(1000) });
    return res.ok;
  } catch {
    return false;
  }
}

function stopAdapter(): void {
  const child = adapter;
  adapter = undefined;
  if (!child?.pid) return;
  if (process.platform === 'win32') {
    // kill() on Windows does not reliably take the child tree down; force it.
    try {
      spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true });
    } catch {
      child.kill();
    }
  } else child.kill();
}

async function startAdapter(): Promise<void> {
  stopAdapter();
  if (!cfg.spawnAdapter) return;
  if (await reachable(cfg.url)) return; // attach to the one already running
  const missing = missingBuilds(paths);
  if (missing.length > 0) {
    dialog.showErrorBox('Bellwether', `Missing build output:\n${missing.join('\n')}\n\nRun "pnpm build" first.`);
    return;
  }
  const { command, args } = adapterArgs(cfg, paths.bin, paths.rendererDir);
  adapter = spawn(command, args, { stdio: ['pipe', 'inherit', 'inherit'], windowsHide: true });
  adapter.once('exit', () => {
    adapter = undefined;
  });
}

async function refreshServedScale(): Promise<void> {
  try {
    const res = await fetch(new URL('config.json', cfg.url).toString(), { signal: AbortSignal.timeout(1000) });
    servedScale = res.ok ? validScale(((await res.json()) as { scale?: unknown }).scale) : undefined;
  } catch {
    servedScale = undefined;
  }
}

async function refreshSessions(): Promise<void> {
  try {
    // Loaded lazily: protocol knowledge stays in the adapter package.
    const mod = (await import(pathToFileURL(paths.index).href)) as { discoverSessions?: () => Promise<{ session: string }[]> };
    sessions = (await mod.discoverSessions?.())?.map((s) => s.session) ?? [];
  } catch {
    sessions = [];
  }
}

interface Placement {
  bounds: Rect;
  slice?: { offset: number; total: number };
}

/** Where each window goes: one per monitor when the strip spans them, else one on the chosen monitor. */
function placements(): Placement[] {
  const ds = displays();
  const scale = effectiveScale(cfg, servedScale);
  if (cfg.mode === 'strip' && cfg.span && ds.length > 1) {
    return spanLayout(ds, scale).map((sl) => ({ bounds: sl.bounds, slice: { offset: sl.offset, total: sl.total } }));
  }
  const d = pickDisplay(ds, cfg.displayId);
  return d ? [{ bounds: windowBounds(d, cfg.mode, scale) }] : [];
}

/** Creates or drops windows to match the placements, moves each into place and loads its URL if it changed. */
function placeWindows(reload = false): void {
  const want = placements();
  while (wins.length < want.length) wins.push(createWindow());
  while (wins.length > want.length) wins.pop()?.destroy();
  wins.forEach((w, i) => {
    const p = want[i]!;
    w.setBounds(p.bounds);
    // Moving between monitors with different scaling can land at the wrong size on Windows; a second set fixes it.
    const got = w.getBounds();
    if (got.width !== p.bounds.width || got.height !== p.bounds.height) w.setBounds(p.bounds);
    w.setAlwaysOnTop(true, 'screen-saver');
    // Map mode needs clicks; strip mode lets them fall through to whatever is underneath.
    if (cfg.mode === 'map') w.setIgnoreMouseEvents(false);
    else w.setIgnoreMouseEvents(true, { forward: true });
    const url = rendererUrl(cfg, p.slice);
    if (reload || loaded.get(w) !== url) {
      loaded.set(w, url);
      void w.loadURL(url);
    }
  });
}

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    transparent: true,
    frame: false,
    show: false,
    hasShadow: false,
    resizable: false,
    movable: false,
    skipTaskbar: true,
    focusable: false,
    alwaysOnTop: true,
    backgroundColor: '#00000000',
    webPreferences: { contextIsolation: true, sandbox: true, nodeIntegration: false },
  });
  // The page switches mode by navigating to `?mode=...` (the `m` key, the on-screen exit button).
  // Turn that into a real mode change so the window is resized too, instead of loading it in place.
  win.webContents.on('will-navigate', (e, url) => {
    if (url.startsWith('data:')) return;
    const next = modeFromUrl(url);
    if (next && next !== cfg.mode) {
      e.preventDefault();
      void dispatch({ type: 'toggle-mode' });
    }
  });
  win.once('ready-to-show', () => win.showInactive());
  // A failed load leaves a blank white page in the transparent window: retry, and show
  // a visible message meanwhile instead of a bare white bar.
  win.webContents.on('did-fail-load', (_e, _code, _desc, failedUrl, isMainFrame) => {
    if (!isMainFrame || failedUrl.startsWith('data:')) return;
    void win.loadURL(errorPage(failedUrl));
    setTimeout(() => {
      const url = loaded.get(win);
      if (!win.isDestroyed() && url) void win.loadURL(url);
    }, 2000);
  });
  return win;
}

function toElectron(items: MenuItem[]): MenuItemConstructorOptions[] {
  return items.map((i): MenuItemConstructorOptions => {
    if (i.kind === 'separator') return { type: 'separator' };
    const act = i.action;
    return {
      label: i.label,
      enabled: i.enabled ?? true,
      ...(i.checked !== undefined ? { type: 'checkbox' as const, checked: i.checked } : {}),
      ...(act ? { click: () => void dispatch(act) } : {}),
    };
  });
}

let raiseTimer: ReturnType<typeof setTimeout> | undefined;

/** The overlay sits above everything, including the tray menu, so drop it while a menu is open. */
function lowerWindow(): void {
  for (const w of wins) if (!w.isDestroyed()) w.setAlwaysOnTop(false);
  clearTimeout(raiseTimer);
  raiseTimer = setTimeout(raiseWindow, 20000); // safety net if the close event never arrives
}

function raiseWindow(): void {
  clearTimeout(raiseTimer);
  for (const w of wins) if (!w.isDestroyed()) w.setAlwaysOnTop(true, 'screen-saver');
}

function rebuildMenu(): void {
  const menu = Menu.buildFromTemplate(toElectron(buildMenuModel(cfg, displays(), sessions)));
  menu.on('menu-will-close', () => setTimeout(raiseWindow, 150));
  tray?.setContextMenu(menu);
}

async function dispatch(action: MenuAction): Promise<void> {
  if (action.type === 'quit') {
    app.quit();
    return;
  }
  const r = applyAction(cfg, action);
  cfg = r.cfg;
  await saveConfig(configPath(app.getPath('userData')), cfg);
  if (r.restartAdapter) await startAdapter();
  placeWindows(r.reload);
  rebuildMenu();
}

function trayIcon(): Electron.NativeImage {
  const dir = assetsDir();
  // macOS: the "Template" suffix makes Electron mark the image as a template, so the
  // menu bar tints it for light and dark. Windows and Linux use the colour sheep.
  const img = nativeImage.createFromPath(join(dir, process.platform === 'darwin' ? 'trayTemplate.png' : 'tray.png'));
  if (process.platform === 'darwin') img.setTemplateImage(true);
  return img;
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('window-all-closed', () => {
    /* tray app: stay alive */
  });
  app.on('before-quit', stopAdapter);
  app.on('will-quit', () => globalShortcut.unregisterAll());
  process.on('exit', stopAdapter);
  for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP'] as const) process.on(sig, () => app.quit());
  app.whenReady().then(async () => {
    cfg = await loadConfig(configPath(app.getPath('userData')));
    await Promise.all([startAdapter(), refreshSessions()]);
    await waitForReady(() => reachable(cfg.url));
    await refreshServedScale();
    placeWindows();
    if (process.platform === 'darwin') app.dock?.setIcon(nativeImage.createFromPath(join(assetsDir(), 'icon.png')));
    tray = new Tray(trayIcon());
    tray.setToolTip('Bellwether');
    tray.on('click', () => {
      lowerWindow();
      void refreshSessions().then(rebuildMenu);
    });
    tray.on('right-click', lowerWindow);
    // Always a way out of map mode, even if the tray menu misbehaves: Ctrl/Cmd+Alt+M toggles strip and map.
    globalShortcut.register('CommandOrControl+Alt+M', () => void dispatch({ type: 'toggle-mode' }));
    rebuildMenu();
    const onDisplays = () => {
      placeWindows();
      rebuildMenu();
    };
    screen.on('display-added', onDisplays);
    screen.on('display-removed', onDisplays);
    screen.on('display-metrics-changed', onDisplays);
  });
}
