#!/usr/bin/env node
// Prints deltas from the configured source as JSON lines.
// usage: bellwether-adapter [--live|--mock] [--session <name>|--all] [--socket <path>] [--config bellwether.toml]
import { createSource, loadSourceConfig } from './config.js';
import type { Delta } from './types.js';

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
const has = (f: string) => process.argv.includes(f);

const cfg = await loadSourceConfig(arg('--config') ?? 'bellwether.toml');
if (has('--live')) cfg.source = 'live';
if (has('--mock')) cfg.source = 'mock';
const session = arg('--session');
if (session) cfg.herdr.sessions = [session];
if (has('--all')) cfg.herdr.sessions = 'all';
const socket = arg('--socket');
if (socket) cfg.herdr.socket = socket;

const source = createSource(cfg, { log: (m) => process.stderr.write(m + '\n') });
source.on('delta', (d: Delta) => process.stdout.write(JSON.stringify(d) + '\n'));
process.stderr.write(`bellwether-adapter: source=${cfg.source}\n`);
await source.start();
const stop = () => void source.stop().then(() => process.exit(0));
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
