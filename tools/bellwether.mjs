#!/usr/bin/env node
// Runs the CLI from a source checkout: `pnpm bellwether <command>`.
// Builds the adapter, renderer and CLI on first use (or with BELLWETHER_REBUILD=1).
import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const main = join(root, 'packages/cli/dist/main.js');
const needsBuild =
  process.env.BELLWETHER_REBUILD === '1' ||
  !existsSync(main) ||
  !existsSync(join(root, 'packages/adapter/dist/bin.js')) ||
  !existsSync(join(root, 'packages/renderer/dist'));

if (needsBuild) {
  console.error('bellwether: building (first run)...');
  const pnpm = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';
  const b = spawnSync(
    pnpm,
    ['--filter', '@bellwether/adapter', '--filter', '@bellwether/renderer', '--filter', '@bellwether/cli', 'build'],
    { cwd: root, stdio: 'inherit', shell: process.platform === 'win32' },
  );
  if (b.status !== 0) process.exit(b.status ?? 1);
}
const r = spawnSync(process.execPath, [main, ...process.argv.slice(2)], { cwd: process.cwd(), stdio: 'inherit' });
process.exit(r.status ?? 1);
