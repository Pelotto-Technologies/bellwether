import { Application } from 'pixi.js';
import type { Delta } from '@bellwether/adapter/core';
import { connectFeed, FeedState, replayFeed, type FeedMode } from './feed.js';
import { inferHandoff } from './map/chatter.js';
import { hasMapArt, loadMapArt } from './map/assets.js';
import { availablePacks, packData } from './packs.js';
import { MapScene } from './pixi/map.js';
import { loadArt } from './pixi/pack.js';
import { StripScene } from './pixi/strip.js';
import { pickPack } from './select.js';

const params = new URLSearchParams(location.search);
const mode = params.get('mode') === 'map' ? 'map' : 'strip';
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
  const packName = pickPack(available, requested, await configuredPack());
  const pack = packData(packName);
  const theme = pack.theme;
  const art = await loadArt(pack);
  const app = new Application();
  await app.init({ backgroundAlpha: 0, resizeTo: window, antialias: false, autoDensity: true, resolution: window.devicePixelRatio || 1 });
  document.body.appendChild(app.canvas);

  const feed = new FeedState(theme.sayTtlMs);
  const scene =
    mode === 'map'
      ? new MapScene(app, theme, feed, await loadMapArt(hasMapArt(packName) ? packName : 'neutral'), art)
      : new StripScene(app, theme, feed, scale, art);
  window.addEventListener('keydown', (e) => {
    if (e.key !== 'm' && e.key !== 'M') return;
    const next = new URLSearchParams(location.search);
    next.set('mode', mode === 'map' ? 'strip' : 'map');
    location.search = next.toString();
  });
  const chip = document.getElementById('chip');

  const onDelta = (d: Delta) => {
    const before = d.kind === 'member' ? feed.world.parties[d.partyId] : undefined;
    feed.apply(d, performance.now());
    // Inferred chatter: a hand-off reads as the finished member saying something.
    if (d.kind === 'member' && before) {
      const after = feed.world.parties[d.partyId];
      const hand = after && inferHandoff(before, after, d.member);
      if (hand) feed.apply({ t: d.t, kind: 'say', partyId: d.partyId, paneId: hand.from.paneId, text: hand.text }, performance.now());
    }
  };
  const onMode = (mode: FeedMode) => {
    if (!chip) return;
    chip.textContent = mode.kind === 'ws' ? `adapter · ${mode.url}` : mode.kind === 'replay' ? `replay · ${mode.url}` : `mock · ${mode.reason}`;
  };
  const replay = params.get('replay');
  if (replay) replayFeed(replay, Number(params.get('speed') ?? 1), onDelta, onMode);
  else connectFeed(deltaUrl(), onDelta, onMode);

  app.ticker.add((ticker) => scene.update(ticker.deltaMS / 1000, performance.now()));
}

void main();
