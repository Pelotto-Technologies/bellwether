import { Application } from 'pixi.js';
import { connectFeed, FeedState } from './feed.js';
import { availablePacks, packData } from './packs.js';
import { loadArt } from './pixi/pack.js';
import { StripScene } from './pixi/strip.js';
import { pickPack } from './select.js';

const params = new URLSearchParams(location.search);
const transparent = params.has('transparent');
const scale = Math.max(1, Math.min(6, Number(params.get('scale') ?? 3)));
document.body.classList.add(transparent ? 'transparent' : 'backdrop');

function deltaUrl(): string | null {
  if (params.get('source') === 'mock') return null;
  const explicit = params.get('ws');
  if (explicit) return explicit;
  // Served by `bellwether-adapter --serve`: same origin. Under Vite dev: the adapter's default port.
  const sameOrigin = location.port !== '5173' && location.protocol.startsWith('http');
  return sameOrigin ? `ws://${location.host}/deltas` : 'ws://127.0.0.1:7341/deltas';
}

/** The adapter serves `config.json` (from bellwether.toml); a missing file or a static host just means defaults. */
async function configuredPack(): Promise<string | undefined> {
  try {
    const res = await fetch('./config.json', { cache: 'no-store' });
    if (!res.ok) return undefined;
    const cfg = (await res.json()) as { pack?: unknown };
    return typeof cfg.pack === 'string' ? cfg.pack : undefined;
  } catch {
    return undefined;
  }
}

async function main() {
  const available = availablePacks();
  const requested = params.get('pack');
  if (requested && !available.includes(requested)) console.warn(`bellwether: unknown pack "${requested}", have ${available.join(', ')}`);
  const pack = packData(pickPack(available, requested, await configuredPack()));
  const theme = pack.theme;
  const art = await loadArt(pack);
  const app = new Application();
  await app.init({ backgroundAlpha: 0, resizeTo: window, antialias: false, autoDensity: true, resolution: window.devicePixelRatio || 1 });
  document.body.appendChild(app.canvas);

  const feed = new FeedState(theme.sayTtlMs);
  const scene = new StripScene(app, theme, feed, scale, art);
  const chip = document.getElementById('chip');

  connectFeed(
    deltaUrl(),
    (d) => feed.apply(d, performance.now()),
    (mode) => {
      if (chip) chip.textContent = mode.kind === 'ws' ? `adapter · ${mode.url}` : `mock · ${mode.reason}`;
    },
  );

  app.ticker.add((ticker) => scene.update(ticker.deltaMS / 1000, performance.now()));
}

void main();
