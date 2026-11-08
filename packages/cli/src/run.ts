import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export type RunCommand = 'run' | 'record' | 'replay' | 'scrub' | 'orchestrate';

export const RUN_COMMANDS: RunCommand[] = ['run', 'record', 'replay', 'scrub', 'orchestrate'];

const SOURCE_FLAGS = ['--mock', '--live', '--hooks', '--replay'];

/** Maps `bellwether <cmd> ...` onto adapter flags. Pure, so it is easy to test. */
export function adapterArgs(cmd: RunCommand, rest: string[], serveDir?: string): string[] {
  const serve = serveDir ? ['--serve', serveDir] : [];
  switch (cmd) {
    case 'run':
      // Live Herdr unless the user chose a source with a flag. `--prefer-live` (rather than `--live`)
      // leaves bellwether.toml / BELLWETHER_SOURCE free to pick the hooks source.
      return [...(rest.some((a) => SOURCE_FLAGS.includes(a)) ? [] : ['--prefer-live', '--all']), ...serve, ...rest];
    case 'record': {
      const [file, ...more] = rest;
      if (!file || file.startsWith('-')) throw new Error('usage: bellwether record <file.jsonl> [--scrub] [adapter flags]');
      return [...(more.some((a) => SOURCE_FLAGS.includes(a)) ? [] : ['--prefer-live', '--all']), ...serve, '--record', file, ...more];
    }
    case 'replay': {
      const [file, ...more] = rest;
      if (!file || file.startsWith('-')) throw new Error('usage: bellwether replay <file.jsonl> [--speed n] [adapter flags]');
      return [...serve, '--replay', file, ...more];
    }
    case 'orchestrate':
      // No --serve: this command only talks to Herdr and exits. Flags and `-- <command>` pass through.
      return ['--orchestrate', ...rest];
    case 'scrub': {
      const [input, output] = rest;
      if (!input || !output) throw new Error('usage: bellwether scrub <in.jsonl> <out.jsonl>');
      return ['--scrub-file', input, output];
    }
  }
}

/** Finds the built adapter bin and renderer dist inside the published package (runtime/), or next to this package in the workspace or a release bundle. */
export function locateRuntime(here = dirname(fileURLToPath(import.meta.url))): { adapterBin: string; rendererDist?: string } {
  const candidates = [join(here, '..', 'runtime', 'adapter', 'dist', 'bin.js'), join(here, '..', '..', 'adapter', 'dist', 'bin.js'), join(here, '..', '..', '..', 'adapter', 'dist', 'bin.js')];
  const adapterBin = candidates.find(existsSync);
  if (!adapterBin) throw new Error('adapter is not built; run pnpm build');
  const dist = join(dirname(dirname(dirname(adapterBin))), 'renderer', 'dist');
  return { adapterBin, rendererDist: existsSync(dist) ? dist : undefined };
}
