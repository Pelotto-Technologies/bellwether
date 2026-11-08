#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { createSource, loadSourceConfig } from './config.js';
import { launchOrchestrator } from './herdr/launch.js';
import { MockSource } from './mock.js';
import { recordTo, ReplaySource } from './recording.js';
import { scrubDelta, scrubFile } from './scrub.js';
import { DEFAULT_PORT, DELTA_PATH, DeltaServer } from './server.js';
import type { WorldSource } from './source.js';

const USAGE = `bellwether-adapter: stream Herdr world deltas over WebSocket

Source (default from bellwether.toml / BELLWETHER_SOURCE, else mock):
  --live               read the live Herdr TUI socket API
  --mock               generate mock agents
  --replay <file>      replay a recorded .jsonl (loops)
  --session <name>     live: one named session      --all   live: every running session
  --socket <path>      live: explicit socket/pipe path
  --config <file>      config file (default bellwether.toml)
  --seed <n>           mock seed (default 1)
  --interval <ms>      mock delta interval (default 1500)
  --speed <n>          replay speed multiplier (default 1)

Output:
  --port <n>           WebSocket port (default ${DEFAULT_PORT}); deltas on ${DELTA_PATH}
  --serve <dir>        also serve a built renderer from <dir>
  --record <file>      append every delta to a .jsonl file
  --scrub              with --record: hash repo/branch/workspace labels, strip say text and titles
  --scrub-file <in> <out>  scrub an existing .jsonl recording and exit
  --actions            let the overlay send prompts and keys to agents (focus is always allowed)
  --pack <name>        skin pack for the served overlay (default from bellwether.toml, else neutral)
  --print              print every delta to stdout as JSON lines
  -h, --help

Orchestrate (create a Herdr workspace, tag pane 1, type the command into it, then exit):
  --orchestrate [--cwd <dir>] [--label <text>] [--role <role>] [--session <name>] [--socket <path>]
                [--timeout <ms>] [-- <command...>]
                       args with spaces are wrapped in double quotes; default role orchestrator`;

const { values, positionals } = parseArgs({
  options: {
    live: { type: 'boolean' },
    mock: { type: 'boolean' },
    replay: { type: 'string' },
    session: { type: 'string' },
    all: { type: 'boolean' },
    socket: { type: 'string' },
    config: { type: 'string' },
    seed: { type: 'string' },
    interval: { type: 'string' },
    speed: { type: 'string' },
    port: { type: 'string' },
    serve: { type: 'string' },
    record: { type: 'string' },
    scrub: { type: 'boolean' },
    actions: { type: 'boolean' },
    'scrub-file': { type: 'string' },
    print: { type: 'boolean' },
    'exit-with-parent': { type: 'boolean' },
    pack: { type: 'string' },
    orchestrate: { type: 'boolean' },
    cwd: { type: 'string' },
    label: { type: 'string' },
    role: { type: 'string' },
    timeout: { type: 'string' },
    help: { type: 'boolean', short: 'h' },
  },
  allowPositionals: true,
});

let scrubConfig = false;
let actionsConfig = false;
let clientPack: string | undefined = values.pack;
let clientScale: number | undefined;
let clientMinimal = false;

if (values.help) {
  console.log(USAGE);
  process.exit(0);
}

if (values['scrub-file']) {
  const out = positionals[0];
  if (!out) {
    process.stderr.write('usage: --scrub-file <in.jsonl> <out.jsonl>\n');
    process.exit(1);
  }
  const n = scrubFile(values['scrub-file'], out);
  process.stderr.write(`bellwether-adapter: scrubbed ${n} deltas into ${out}\n`);
  process.exit(0);
}

const log = (m: string) => process.stderr.write(m + '\n');

if (values.orchestrate) {
  try {
    const r = await launchOrchestrator({
      session: values.session,
      socket: values.socket,
      cwd: values.cwd,
      label: values.label,
      role: values.role,
      command: positionals,
      timeoutMs: values.timeout ? Number(values.timeout) : undefined,
      log,
    });
    console.log(`workspace "${r.label}" created, pane ${r.paneId}, role ${r.role}`);
    if (r.commandLine) console.log(`ran: ${r.commandLine}`);
    else console.log('no command given; type one into the pane yourself');
    if (r.agent) console.log(`agent detected: ${r.agent}${r.agentName ? ` (named ${r.agentName})` : ''}`);
    else if (r.timedOut) console.log('agent not detected before the timeout (workspace and pane still exist)');
    process.exit(0);
  } catch (err) {
    log(`bellwether-adapter: ${(err as Error).message}`);
    process.exit(1);
  }
}

async function pickSource(): Promise<WorldSource> {
  if (values.replay) {
    return ReplaySource.fromFile(values.replay, { speed: Number(values.speed ?? 1), loop: true });
  }
  const cfg = await loadSourceConfig(values.config ?? 'bellwether.toml');
  if (values.pack) cfg.pack = values.pack;
  clientPack = cfg.pack ?? clientPack;
  clientScale = cfg.scale;
  clientMinimal = cfg.minimal ?? false;
  scrubConfig = cfg.scrub ?? false;
  actionsConfig = cfg.actions ?? false;
  if (values.live) cfg.source = 'live';
  if (values.mock) cfg.source = 'mock';
  if (values.session) cfg.herdr.sessions = [values.session];
  if (values.all) cfg.herdr.sessions = 'all';
  if (values.socket) cfg.herdr.socket = values.socket;
  log(`bellwether-adapter: source=${cfg.source}`);
  return createSource(cfg, {
    log,
    mock: () => new MockSource({ seed: Number(values.seed ?? 1), intervalMs: Number(values.interval ?? 1500) }),
  });
}

const source = await pickSource();
const server = new DeltaServer({ port: Number(values.port ?? DEFAULT_PORT), staticDir: values.serve, clientConfig: { ...(clientPack ? { pack: clientPack } : {}), ...(clientScale ? { scale: clientScale } : {}), ...(clientMinimal ? { minimal: true } : {}) }, actions: values.actions || actionsConfig, log });
server.attach(source);
if (values.record) {
  const rec = recordTo(values.record);
  const scrubOn = values.scrub || scrubConfig;
  source.on('delta', scrubOn ? (d) => rec(scrubDelta(d)) : rec);
}
if (values.print) source.on('delta', (d) => process.stdout.write(JSON.stringify(d) + '\n'));

const port = await server.listen();
await source.start();
log(`bellwether-adapter: deltas on ws://127.0.0.1:${port}${DELTA_PATH}`);
if (values.serve) log(`bellwether-adapter: overlay at http://127.0.0.1:${port}/`);

const shutdown = async () => {
  await source.stop();
  await server.close();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
// Launched by the desktop shell with a stdin pipe: when the parent dies for any reason
// (Ctrl+C, crash, killed terminal) the pipe closes and we exit instead of orphaning the port.
if (values['exit-with-parent']) {
  process.stdin.on('end', shutdown);
  process.stdin.on('close', shutdown);
  process.stdin.resume();
}
