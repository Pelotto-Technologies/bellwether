#!/usr/bin/env node
import { AGENT_TARGETS, findTarget, type AgentTarget } from './agents/index.js';
import { spawnSync } from 'node:child_process';
import { adapterArgs, locateRuntime, RUN_COMMANDS, type RunCommand } from './run.js';
import { launchOverlay } from './overlay.js';
import { detect, install, systemContext, uninstall, type Outcome } from './install.js';

const USAGE = `usage: bellwether <command> [--agent <id>]...

commands:
  agents      show which coding agents are present
  install     write the skill pack and SessionStart role hook for each present agent
  uninstall   remove only what install wrote
  overlay     open the desktop overlay (click-through, always on top, tray menu)
  run         serve the overlay from live Herdr (adapter flags pass through)
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
      report(install(ctx, targets));
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
