#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { createSource, loadSourceConfig, resolveAutoConfig } from './config.js';
import { launchOrchestrator } from './herdr/launch.js';
import { MockSource } from './mock.js';
import { recordTo, ReplaySource } from './recording.js';
import { scrubDelta, scrubFile } from './scrub.js';
import { DEFAULT_PORT, DELTA_PATH, DeltaServer } from './server.js';
import type { WorldSource } from './source.js';

const USAGE = `bellwether-adapter: stream Herdr world deltas over WebSocket

Source (default from bellwether.toml / BELLWETHER_SOURCE, else mock; source may be mock, live, hooks or auto):
  --live               read the live Herdr TUI socket API
  --mock               generate mock agents
  --hooks              read agent sessions from the events file the Claude Code plugin writes (no Herdr)
  --events <file>      hooks: events file (default BELLWETHER_EVENTS or ~/.bellwether/events.jsonl)
  --auto               live Herdr if a socket answers at startup, else hooks (default for run and overlay;
                       bellwether.toml or BELLWETHER_SOURCE naming live, hooks or auto wins). --prefer-live is an alias
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
  --git                show uncommitted/unpushed counts per party (runs git in agents' folders; only for repos you trust)
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
    hooks: { type: 'boolean' },
    events: { type: 'string' },
    auto: { type: 'boolean' },
    'prefer-live': { type: 'boolean' },
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
    git: { type: 'boolean' },
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
let clientBubbles = true;
let clientVitals = true;

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
  clientBubbles = cfg.bubbles ?? true;
  clientVitals = cfg.vitals ?? true;
  scrubConfig = cfg.scrub ?? false;
  actionsConfig = cfg.actions ?? false;
  // run/overlay default: auto, unless the config or env already named live, hooks or auto.
  if ((values.auto || values['prefer-live']) && cfg.source === 'mock') cfg.source = 'auto';
  if (values.live) cfg.source = 'live';
  if (values.mock) cfg.source = 'mock';
  if (values.hooks) cfg.source = 'hooks';
  if (values.git) cfg.git = { ...cfg.git, enabled: true };
  if (values.events) cfg.hooks = { ...cfg.hooks, file: values.events };
  if (values.session) cfg.herdr.sessions = [values.session];
  if (values.all) cfg.herdr.sessions = 'all';
  if (values.socket) cfg.herdr.socket = values.socket;
  const resolved = await resolveAutoConfig(cfg, { log });
  if (cfg.source !== 'auto') log(`bellwether-adapter: source=${cfg.source}`);
  return createSource(resolved, {
    log,
    mock: () => new MockSource({ seed: Number(values.seed ?? 1), intervalMs: Number(values.interval ?? 1500) }),
  });
}

const source = await pickSource();
const server = new DeltaServer({ port: Number(values.port ?? DEFAULT_PORT), staticDir: values.serve, clientConfig: { ...(clientPack ? { pack: clientPack } : {}), ...(clientScale ? { scale: clientScale } : {}), ...(clientMinimal ? { minimal: true } : {}), ...(clientBubbles ? {} : { bubbles: false }), ...(clientVitals ? {} : { vitals: false }) }, actions: values.actions || actionsConfig, log });
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
