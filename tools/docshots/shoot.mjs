// Renders README screenshots and GIFs from scripted feeds (scenario.mjs) with the built
// renderer in headless Chromium. Run `pnpm --filter @bellwether/renderer build` first, then
// `node tools/docshots/shoot.mjs [filter]`. Needs Playwright (and ffmpeg for GIFs).
import { createServer } from 'node:http';
import { readFileSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import { join, extname, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { castFeed, stillFeed, storyFeed, toJsonl } from './scenario.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const dist = join(root, 'packages/renderer/dist');
const out = join(root, 'docs/images');
const tmp = join(root, 'tools/docshots/.tmp');
const filter = process.argv[2] ?? '';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const feeds = {
  'still.jsonl': toJsonl(stillFeed()), 'story.jsonl': toJsonl(storyFeed()), 'cast.jsonl': toJsonl(castFeed()),
  // Map stills: an addressed message would walk the orchestrator away from its settlement.
  'map.jsonl': toJsonl(stillFeed({ addressed: false })),
};
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.json': 'application/json' };
const server = createServer((req, res) => {
  const path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  const feed = feeds[path.slice(1)];
  if (feed) return res.writeHead(200, { 'content-type': 'application/x-ndjson' }).end(feed);
  const file = join(dist, path === '/' ? 'index.html' : path);
  if (!file.startsWith(dist) || !existsSync(file)) return res.writeHead(404).end();
  res.writeHead(200, { 'content-type': types[extname(file)] ?? 'application/octet-stream' }).end(readFileSync(file));
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}`;

const PACKS = ['neutral', 'aesir', 'wayfarers', 'scifi'];
const hideChip = '#chip{display:none!important}';
const browser = await chromium.launch();
mkdirSync(out, { recursive: true });

async function open(query, { w = 1280, h = 720, video } = {}) {
  const ctx = await browser.newContext({
    viewport: { width: w, height: h },
    deviceScaleFactor: 1,
    ...(video ? { recordVideo: { dir: tmp, size: { width: w, height: h } } } : {}),
  });
  const page = await ctx.newPage();
  page.on('dialog', (d) => d.dismiss());
  await page.goto(`${base}/?${query}`);
  await page.addStyleTag({ content: hideChip });
  return { ctx, page };
}

async function shot(name, query, opts = {}) {
  if (!name.includes(filter)) return;
  const { ctx, page } = await open(query, opts);
  await page.waitForTimeout(opts.wait ?? 2500);
  if (opts.before) await opts.before(page);
  await page.screenshot({ path: join(out, `${name}.png`), ...(opts.clip ? { clip: opts.clip } : {}) });
  await ctx.close();
  console.log('wrote', name);
}

/** Clicks around the overview map until the detail panel opens on a party whose title matches. */
async function focusParty(page, match) {
  const { width, height } = page.viewportSize();
  const title = () =>
    page.evaluate(() => {
      const el = document.getElementById('detail');
      return el && !el.hidden ? (el.querySelector('h2')?.textContent ?? '') : '';
    });
  for (let y = 60; y < height - 40; y += 20) {
    for (let x = 30; x < width - 30; x += 20) {
      await page.mouse.click(x, y);
      const t = await title();
      if (!t) continue;
      if (t.includes(match)) return true;
      await page.keyboard.press('Escape'); // wrong party: zoom back out and keep looking
      await page.waitForTimeout(900);
    }
  }
  throw new Error(`no party matching ${match}`);
}

/**
 * Records a GIF from lossless screenshots (video capture is lossy and bloats pixel-art GIFs).
 * Frames are taken as fast as the browser allows; the GIF plays them at the measured rate.
 */
async function gif(name, query, { seconds = 12, w = 1280, h = 720, width, before, trim = 1, colors = 128, rate = 10 } = {}) {
  if (!name.includes(filter)) return;
  rmSync(tmp, { recursive: true, force: true });
  mkdirSync(tmp, { recursive: true });
  const { ctx, page } = await open(query, { w, h });
  if (before) await before(page);
  await page.waitForTimeout(trim * 1000);
  const start = Date.now();
  let n = 0;
  while (Date.now() - start < seconds * 1000) {
    await page.screenshot({ path: join(tmp, `f${String(n++).padStart(4, '0')}.png`) });
  }
  const fps = n / ((Date.now() - start) / 1000);
  await ctx.close();
  const scale = width ? `,scale=${width}:-1:flags=neighbor` : '';
  const frames = join(tmp, 'f%04d.png');
  const palette = join(tmp, 'palette.png');
  const input = ['-framerate', fps.toFixed(2), '-i', frames];
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', ...input, '-vf', `fps=${rate}${scale},palettegen=max_colors=${colors}:stats_mode=full`, palette]);
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', ...input, '-i', palette, '-lavfi', `fps=${rate}${scale}[x];[x][1:v]paletteuse=dither=none:diff_mode=rectangle`, join(out, `${name}.gif`)]);
  rmSync(tmp, { recursive: true, force: true });
  console.log('wrote', name, `(${n} frames at ${fps.toFixed(1)} fps)`);
}

const STRIP = { w: 1600, h: 230 };
for (const pack of PACKS) {
  await shot(`${pack}-cast`, `pack=${pack}&replay=/cast.jsonl`, { w: 1500, h: 160 });
  await shot(`${pack}-strip`, `pack=${pack}&replay=/still.jsonl`, STRIP);
  // Zoomed onto the orchestrated settlement, panel hidden: the gallery is about the art.
  await shot(`${pack}-map`, `pack=${pack}&mode=map&replay=/map.jsonl`, {
    wait: 3000,
    before: async (p) => {
      await focusParty(p, 'Orchestration');
      await p.addStyleTag({ content: '#detail,#exit-map{display:none!important}' });
      await p.waitForTimeout(1500);
    },
  });
}
await shot('map-overview', `pack=aesir&mode=map&replay=/map.jsonl`, { wait: 3500 });
await shot('strip-tiny', `pack=aesir&scale=1&replay=/still.jsonl`, { w: 1280, h: 140 });
await shot('strip-large', `pack=aesir&scale=4&replay=/still.jsonl`, { w: 1280, h: 360 });
await shot('strip-minimal', `pack=aesir&minimal&replay=/still.jsonl`, STRIP);
await shot('map-detail', `pack=aesir&mode=map&replay=/map.jsonl`, { wait: 3000, before: async (p) => { await focusParty(p, 'atlas'); await p.waitForTimeout(1500); } });
await gif('strip-story', `pack=wayfarers&replay=/story.jsonl`, { w: 1280, h: 230, seconds: 18, trim: 0.5 });
await gif('map-story', `pack=aesir&mode=map&replay=/story.jsonl`, {
  w: 720,
  h: 405,
  seconds: 15,
  colors: 64,
  rate: 6,
  trim: 1.5,
  before: async (p) => {
    await p.waitForTimeout(1500);
    await focusParty(p, 'Orchestration');
    await p.addStyleTag({ content: '#detail,#exit-map{display:none!important}' });
  },
});

await browser.close();
server.close();
