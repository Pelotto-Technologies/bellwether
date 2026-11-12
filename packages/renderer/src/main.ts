import { Application } from 'pixi.js';
import type { Delta } from '@bellwether/adapter/core';
import { createCues } from './cues/setup.js';
import { resolveOptions, servedCues, type ServedCues } from './cues/options.js';
import { connectFeed, FeedState, replayFeed, type FeedMode } from './feed.js';
import { guardFrame } from './guard.js';
import { inferHandoff } from './map/chatter.js';
import { hasMapArt, loadMapArt } from './map/assets.js';
import { loadCampArt } from './map/campart.js';
import { availablePacks, packData } from './packs.js';
import { MapScene } from './pixi/map.js';
import { loadArt } from './pixi/pack.js';
import { StripScene } from './pixi/strip.js';
import { pickPack } from './select.js';
import { parseSpan } from './sim.js';

const params = new URLSearchParams(location.search);
const modeParam = params.get('mode');
// `alerts` is a page with no scene at all: just the alert banners on a transparent page, for an OBS source of its own.
// `camp` is the map with one party's camp scene opened straight away.
const mode = modeParam === 'map' || modeParam === 'camp' ? 'map' : modeParam === 'alerts' ? 'alerts' : 'strip';
const transparent = params.has('transparent') || mode === 'alerts';
document.body.classList.add(transparent ? 'transparent' : 'backdrop');
if (mode === 'map') document.body.classList.add('map');
if (params.get('panel') === '0') document.body.classList.add('no-panel');

function deltaUrl(): string | null {
  if (params.get('source') === 'mock') return null;
  const explicit = params.get('ws');
  if (explicit) return explicit;
  // Served by `bellwether-adapter --serve`: same origin. Under Vite dev: the adapter's default port.
  const sameOrigin = location.port !== '5173' && location.protocol.startsWith('http');
  return sameOrigin ? `ws://${location.host}/deltas` : 'ws://127.0.0.1:7341/deltas';
}

/** The adapter serves `config.json` (from bellwether.toml); a missing file or a static host just means defaults. */
async function servedConfig(): Promise<{ pack?: string; scale?: number; minimal?: boolean; bubbles?: boolean; vitals?: boolean } & ServedCues> {
  try {
    const res = await fetch('./config.json', { cache: 'no-store' });
    if (!res.ok) return {};
    const cfg = (await res.json()) as { pack?: unknown; scale?: unknown; minimal?: unknown; bubbles?: unknown; vitals?: unknown };
    return {
      ...(typeof cfg.pack === 'string' ? { pack: cfg.pack } : {}),
      ...(typeof cfg.scale === 'number' ? { scale: cfg.scale } : {}),
      ...(typeof cfg.minimal === 'boolean' ? { minimal: cfg.minimal } : {}),
      ...(typeof cfg.bubbles === 'boolean' ? { bubbles: cfg.bubbles } : {}),
      ...servedCues(cfg),
      ...(typeof cfg.vitals === 'boolean' ? { vitals: cfg.vitals } : {}),
    };
  } catch {
    return {};
  }
}

async function main() {
  const available = availablePacks();
  const requested = params.get('pack');
  if (requested && !available.includes(requested)) console.warn(`bellwether: unknown pack "${requested}", have ${available.join(', ')}`);
  const served = await servedConfig();
  const packName = pickPack(available, requested, served.pack);
  // `?scale=` beats bellwether.toml; either way it is clamped to a whole number so pixels stay crisp.
  const minimal = params.has('minimal') ? params.get('minimal') !== '0' : served.minimal === true;
  const scale = Math.max(1, Math.min(6, Math.round(Number(params.get('scale') ?? served.scale ?? 3)) || 3));
  const span = parseSpan(params.get('span'));
  const pack = packData(packName);
  const theme = pack.theme;
  const art = await loadArt(pack);
  const app = new Application();
  await app.init({ backgroundAlpha: 0, resizeTo: window, antialias: false, autoDensity: true, resolution: window.devicePixelRatio || 1 });
  if (mode !== 'alerts') document.body.appendChild(app.canvas);

  const feed = new FeedState(theme.sayTtlMs);
  // Chat bubbles: `?bubbles=0` beats bellwether.toml (`bubbles = false`); B flips them for this page.
  feed.bubblesOn = params.has('bubbles') ? params.get('bubbles') !== '0' : served.bubbles !== false;
  // Vitals: `?vitals=0` beats bellwether.toml (`vitals = false`); V flips them for this page.
  feed.vitalsOn = params.has('vitals') ? params.get('vitals') !== '0' : served.vitals !== false;
  const scene =
    mode === 'alerts'
      ? undefined
      : mode === 'map'
        ? new MapScene(app, theme, feed, await loadMapArt(hasMapArt(packName) ? packName : 'neutral'), art, await loadCampArt(packName))
        : new StripScene(app, theme, feed, scale, art, minimal, span);
  // `?mode=camp&party=<id, label or branch>` opens that party's camp scene straight away.
  if (modeParam === 'camp' && scene instanceof MapScene) scene.openCamp(params.get('party') ?? '');
  // Sounds and alert banners (`s` and `a` keys), driven by the same deltas as the scene.
  const cues = createCues(resolveOptions({ params, served, mode, spanFollower: !!span && span.offset !== 0 }), theme, art, app.renderer);
  // Spanning monitors: one window per monitor, each showing its slice of one strip. The leftmost
  // window leads and shares where everyone is walking, so a party crossing a seam lines up.
  if (span && scene instanceof StripScene && typeof BroadcastChannel !== 'undefined') {
    const channel = new BroadcastChannel('bellwether-strip');
    if (span.offset === 0) setInterval(() => channel.postMessage(scene.walkers()), 100);
    else channel.onmessage = (e: MessageEvent) => Array.isArray(e.data) && scene.adopt(e.data);
  }
  window.addEventListener('keydown', (e) => {
    if (e.key === 'b' || e.key === 'B') {
      feed.bubblesOn = !feed.bubblesOn;
      return;
    }
    if (e.key === 'v' || e.key === 'V') {
      feed.vitalsOn = !feed.vitalsOn;
      return;
    }
    if ((e.key !== 'm' && e.key !== 'M') || mode === 'alerts') return;
    const next = new URLSearchParams(location.search);
    next.set('mode', mode === 'map' ? 'strip' : 'map');
    location.search = next.toString();
  });
  const chip = document.getElementById('chip');

  const onDelta = (d: Delta) => {
    const before = d.kind === 'member' ? feed.world.parties[d.partyId] : undefined;
    const prevWorld = feed.world;
    feed.apply(d, performance.now());
    cues.observe(prevWorld, d, performance.now());
    // Inferred chatter: a hand-off reads as the finished member saying something.
    // A real message to this member already explains why it started; no need to guess one.
    if (d.kind === 'member' && before && !feed.addressedTo(d.partyId, d.member.paneId, performance.now())) {
      const after = feed.world.parties[d.partyId];
      const hand = after && inferHandoff(before, after, d.member);
      if (hand) feed.apply({ t: d.t, kind: 'say', partyId: d.partyId, paneId: hand.from.paneId, text: hand.text, to: { partyId: d.partyId, paneId: d.member.paneId } }, performance.now(), true);
    }
  };
  const onMode = (mode: FeedMode) => {
    if (!chip) return;
    chip.textContent = mode.kind === 'ws' ? `adapter · ${mode.url}` : mode.kind === 'replay' ? `replay · ${mode.url}` : `mock · ${mode.reason}`;
  };
  const replay = params.get('replay');
  if (replay) replayFeed(replay, Number(params.get('speed') ?? 1), onDelta, onMode);
  else {
    const handle = connectFeed(deltaUrl(), onDelta, onMode);
    feed.onFocus = (paneId) => handle.send?.({ type: 'focus', paneId });
    feed.onClose = (paneId) => handle.send?.({ type: 'close', paneId });
  }

  app.ticker.add(
    guardFrame((ticker: { deltaMS: number }) => {
      scene?.update(ticker.deltaMS / 1000, performance.now());
      cues.frame(performance.now());
    }),
  );
}

void main();
