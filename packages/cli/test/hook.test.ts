import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, chmodSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { hookSh } from '../src/skill.js';

// Runs the POSIX hook against a fake herdr binary that logs its arguments.
const posix = process.platform !== 'win32';

describe.runIf(posix)('role hook (sh)', () => {
  function run(env: Record<string, string>) {
    const dir = mkdtempSync(join(tmpdir(), 'bellwether-hook-'));
    const log = join(dir, 'log');
    const fake = join(dir, 'herdr');
    writeFileSync(fake, `#!/bin/sh\necho "$@" >> "${log}"\n`);
    chmodSync(fake, 0o755);
    const hook = join(dir, 'hook.sh');
    writeFileSync(hook, hookSh());
    execFileSync('sh', [hook], { env: { PATH: process.env.PATH ?? '', HERDR_BIN_PATH: fake, ...env } });
    const out = existsSync(log) ? readFileSync(log, 'utf8').trim() : '';
    rmSync(dir, { recursive: true, force: true });
    return out;
  }

  it('reports a known role inside Herdr', () => {
    expect(run({ HERDR_ENV: '1', HERDR_PANE_ID: 'w1:p3', HERDR_ROLE: 'reviewer' })).toBe(
      'pane report-metadata w1:p3 --source bellwether --token role=reviewer',
    );
  });

  it('does nothing outside Herdr, without a pane, or for an unknown role', () => {
    expect(run({ HERDR_PANE_ID: 'w1:p3', HERDR_ROLE: 'reviewer' })).toBe('');
    expect(run({ HERDR_ENV: '1', HERDR_ROLE: 'reviewer' })).toBe('');
    expect(run({ HERDR_ENV: '1', HERDR_PANE_ID: 'w1:p3', HERDR_ROLE: 'wizard; rm -rf /' })).toBe('');
  });
});
