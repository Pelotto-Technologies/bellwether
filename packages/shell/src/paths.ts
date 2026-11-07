import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Monorepo root, derived from this file (packages/shell/dist or src). */
export function repoRoot(from: string = dirname(fileURLToPath(import.meta.url))): string {
  return resolve(from, '..', '..', '..');
}

export interface AdapterPaths {
  bin: string;
  index: string;
  rendererDir: string;
}

export function adapterPaths(root: string = repoRoot(), env: NodeJS.ProcessEnv = process.env): AdapterPaths {
  const adapterDist = join(root, 'packages', 'adapter', 'dist');
  return {
    bin: env.BELLWETHER_ADAPTER_BIN ?? join(adapterDist, 'bin.js'),
    index: join(adapterDist, 'index.js'),
    rendererDir: env.BELLWETHER_RENDERER_DIR ?? join(root, 'packages', 'renderer', 'dist'),
  };
}

/** Names of what is missing so main.ts can tell the user to run `pnpm build`. */
export function missingBuilds(p: AdapterPaths): string[] {
  return [p.bin, join(p.rendererDir, 'index.html')].filter((f) => !existsSync(f));
}
