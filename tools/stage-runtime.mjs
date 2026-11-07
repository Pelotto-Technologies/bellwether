#!/usr/bin/env node
// Stages the built adapter and renderer into packages/cli/runtime so the published
// package is self-contained. Run by `prepack`. Publish from CI (clean checkout): the
// renderer bundles every theme folder present, so a local build with private packs
// would ship them.
import { cpSync, existsSync, rmSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'packages/cli/runtime');
const need = [
  join(root, 'packages/adapter/dist/bin.js'),
  join(root, 'packages/renderer/dist/index.html'),
  join(root, 'packages/cli/dist/main.js'),
  join(root, 'packages/shell/dist/main.js'),
];
for (const f of need) if (!existsSync(f)) throw new Error(`missing ${f}; run pnpm build first`);
rmSync(out, { recursive: true, force: true });
mkdirSync(join(out, 'adapter'), { recursive: true });
cpSync(join(root, 'packages/adapter/dist'), join(out, 'adapter/dist'), { recursive: true });
cpSync(join(root, 'packages/adapter/package.json'), join(out, 'adapter/package.json'));
cpSync(join(root, 'packages/renderer/dist'), join(out, 'renderer/dist'), { recursive: true });
mkdirSync(join(out, 'shell'), { recursive: true });
cpSync(join(root, 'packages/shell/dist'), join(out, 'shell/dist'), { recursive: true });
cpSync(join(root, 'packages/shell/package.json'), join(out, 'shell/package.json'));
cpSync(join(root, 'LICENSE'), join(root, 'packages/cli/LICENSE'));
cpSync(join(root, 'README.md'), join(root, 'packages/cli/README.md'));
console.error('stage-runtime: staged adapter, renderer and shell into packages/cli/runtime');
