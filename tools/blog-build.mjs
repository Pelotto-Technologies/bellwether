// Builds a static, adapter-free replay bundle in ./blog (renderer + a scrubbed recording).
// Usage: node tools/blog-build.mjs [recording.jsonl]   (default docs/demo/demo.events.jsonl)
import { cpSync, existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const recording = process.argv[2] ?? join(root, 'docs/demo/demo.events.jsonl');
const dist = join(root, 'packages/renderer/dist');
const out = join(root, 'blog');
if (!existsSync(dist)) throw new Error('build the renderer first: pnpm --filter @bellwether/renderer build');
if (!existsSync(recording)) throw new Error(`recording not found: ${recording}`);
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
cpSync(dist, out, { recursive: true });
cpSync(recording, join(out, 'replay.events.jsonl'));
// Entry page: loops the recording; embed with <iframe src=".../embed.html?pack=aesir&scale=3">.
writeFileSync(
  join(out, 'embed.html'),
  `<!doctype html><meta charset="utf-8"><title>Bellwether replay</title>
<script>
const p = new URLSearchParams(location.search);
if (!p.has('replay')) p.set('replay', './replay.events.jsonl');
if (!p.has('pack')) p.set('pack', 'aesir');
location.replace('./index.html?' + p.toString());
</script>
`,
);
console.log(`blog bundle written to ${out} (open embed.html over http)`);
