import type { ShellConfig } from './config.js';

export interface AdapterLaunch {
  command: string;
  args: string[];
}

/**
 * Build the command line for the adapter bin. `adapterBin` is the path to
 * packages/adapter/dist/bin.js, `rendererDir` the built renderer to serve.
 * Without a session the adapter reads every running Herdr session. `--prefer-live` picks live
 * Herdr unless bellwether.toml or BELLWETHER_SOURCE chose the hooks source.
 */
export function adapterArgs(cfg: Pick<ShellConfig, 'session' | 'port'>, adapterBin: string, rendererDir: string): AdapterLaunch {
  const args = [adapterBin, '--prefer-live', '--port', String(cfg.port), '--serve', rendererDir, '--exit-with-parent'];
  if (cfg.session) args.push('--session', cfg.session);
  else args.push('--all');
  return { command: 'node', args };
}
