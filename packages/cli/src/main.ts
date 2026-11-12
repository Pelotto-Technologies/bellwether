#!/usr/bin/env node
import { AGENT_TARGETS, findTarget, type AgentTarget } from './agents/index.js';
import { spawnSync } from 'node:child_process';
import { adapterArgs, locateRuntime, RUN_COMMANDS, type RunCommand } from './run.js';
import { launchOverlay } from './overlay.js';
import { detect, eventHookCommand, install, sayHookCommand, statusLineCommand, systemContext, uninstall, type Outcome } from './install.js';
import { readFileSync } from 'node:fs';
import { runSayHook } from './hook/say.js';
import { runStatusLineHook } from './hook/statusline.js';
import { formatPack, readPackInfo } from './pack.js';
import { appendEvent, buildEmitEvent, eventsFile, parseFlags, runEventHook } from './hook/event.js';

const USAGE = `usage: bellwether <command> [--agent <id>]...

commands:
  agents      show which coding agents are present
  install     write the skill pack, role hook and message hook for each present agent;
              --events also adds activity hooks so the overlay works without Herdr;
              --statusline (Claude Code only) reports context, quota, model, effort and session
              name for the overlay's vitals, wrapping any status line you already have
  uninstall   remove only what install wrote
  overlay     open the desktop overlay (click-through, always on top, tray menu); uses Herdr if it is running, else agent events (--hooks forces events)
  run         serve the overlay in a browser; Herdr if running, else agent events (--live, --hooks, --mock force one; adapter flags pass through)
  emit        append one activity event for any tool: --ev start|prompt|tool|tool_done|wait|stop|end|sub_start|sub_stop|vitals
              [--session S --agent A --cwd D --role R --label NAME --sub ID --sub-type T --tool T --detail TEXT]
              vitals: --ev vitals [--ctx N --quota N --model M --effort E --name NAME] (N is percent remaining)
  pack        print the active skin pack id on one line; --json adds where it came from and the packs available:
              { "pack", "source": "shell"|"toml"|"env"|"default", "available": [...] }
  record F    run live and append deltas to F (add --scrub for a shareable file)
  replay F    serve the overlay from a recording
  orchestrate [--cwd D] [--label L] [--role R] [--session S] [--timeout MS] [-- CMD...]
              new Herdr workspace, pane 1 tagged with a role and running CMD
  scrub I O   rewrite a recording with repo, branch and label names hashed

agents: ${AGENT_TARGETS.map((t) => t.id).join(', ')} (default: all present)`;

function selectTargets(args: string[]): AgentTarget[] {
  const ids: string[] = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--agent' && args[i + 1]) ids.push(args[++i]!);
  }
  if (ids.length === 0) return [...AGENT_TARGETS];
  return ids.map((id) => {
    const t = findTarget(id);
    if (!t) throw new Error(`unknown agent "${id}"\n\n${USAGE}`);
    return t;
  });
}

function report(outcomes: Outcome[]): void {
  for (const o of outcomes) {
    if (o.status === 'skipped') console.log(`- ${o.displayName}: skipped (${o.reason})`);
    else console.log(`- ${o.displayName}: ${o.status} in ${o.paths.configDir}`);
  }
}

function main(argv: string[]): number {
  const [cmd, ...rest] = argv;
  if (cmd && (RUN_COMMANDS as string[]).includes(cmd)) {
    const rt = locateRuntime();
    const args = adapterArgs(cmd as RunCommand, rest, cmd === 'scrub' || cmd === 'orchestrate' ? undefined : rt.rendererDist);
    return spawnSync(process.execPath, [rt.adapterBin, ...args], { stdio: 'inherit' }).status ?? 1;
  }
  if (cmd === 'overlay') return launchOverlay(rest);
  if (cmd === 'hook' && rest[0] === 'say') {
    // Called by the agent before each shell command. Never fails the tool call.
    let stdin = '';
    try {
      stdin = readFileSync(0, 'utf8');
    } catch {
      return 0;
    }
    runSayHook({ stdin, env: process.env, run: (bin, args) => void spawnSync(bin, args, { stdio: 'ignore', timeout: 3000, windowsHide: true }) });
    return 0;
  }
  if (cmd === 'hook' && rest[0] === 'event') {
    // Called by the Claude Code plugin on session activity. Appends one line to a file; never fails the agent.
    try {
      const flags = parseFlags(rest.slice(1));
      runEventHook({ stdin: readFileSync(0, 'utf8'), env: process.env, ...(flags.agent ? { agent: flags.agent } : {}), ...(flags.event ? { eventName: flags.event } : {}) });
    } catch {
      // swallow
    }
    return 0;
  }
  if (cmd === 'hook' && rest[0] === 'statusline') {
    // Claude Code's statusLine command: reads the status JSON, reports vitals, prints the line to show. Never prints errors.
    let out = '';
    try {
      const flags = parseFlags(rest.slice(1));
      out = runStatusLineHook({ stdin: readFileSync(0, 'utf8'), env: process.env, ...(flags.wrap ? { wrap: flags.wrap } : {}) });
    } catch {
      // swallow
    }
    process.stdout.write(out);
    return 0;
  }
  if (cmd === 'emit') {
    try {
      const flags = parseFlags(rest);
      const line = buildEmitEvent(flags);
      appendEvent(eventsFile(), line);
      return 0;
    } catch (err) {
      console.error(`bellwether emit: ${(err as Error).message}`);
      return 2;
    }
  }
  if (cmd === 'pack') {
    // main() is synchronous, so the file reads run behind a promise that prints and sets the exit code.
    void readPackInfo().then(
      (info) => {
        console.log(formatPack(info, rest.includes('--json')));
        if (!rest.includes('--json') && info.available.length && !info.available.includes(info.pack)) console.error(`bellwether: pack "${info.pack}" was not found among ${info.available.join(', ')}; the overlay falls back`);
      },
      (err: Error) => {
        console.error(`bellwether pack: ${err.message}`);
        process.exitCode = 2;
      },
    );
    return 0;
  }
  const ctx = systemContext();
  const targets = selectTargets(rest);
  switch (cmd) {
    case 'agents':
      for (const d of detect(ctx, targets)) {
        const where = d.configDirExists ? d.configDir : `${d.configDir} (missing)`;
        console.log(`- ${d.displayName} [${d.id}]: ${d.onPath ? 'on PATH' : 'not on PATH'}, config ${where}`);
      }
      return 0;
    case 'install':
      report(install(ctx, targets, sayHookCommand(), rest.includes('--events') ? eventHookCommand() : undefined, rest.includes('--statusline') ? statusLineCommand() : undefined));
      if (rest.includes('--events')) console.log('\nActivity hooks added. Run `bellwether overlay` to watch them (no Herdr needed).');
      if (rest.includes('--statusline')) {
        const skipped = targets.filter((t) => !t.addStatusLine).map((t) => t.displayName);
        console.log(`\nStatus line set: it reports context, quota, model, effort and session name (Claude Code only${skipped.length ? `; ${skipped.join(', ')} skipped` : ''}).`);
      }
      return 0;
    case 'uninstall':
      report(uninstall(ctx, targets));
      return 0;
    default:
      console.error(USAGE);
      return cmd === undefined || cmd === '--help' || cmd === '-h' ? 0 : 2;
  }
}

try {
  process.exitCode = main(process.argv.slice(2));
} catch (err) {
  console.error((err as Error).message);
  process.exitCode = 2;
}
