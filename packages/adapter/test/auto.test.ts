import { mkdtempSync } from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { chooseAutoSource } from '../src/auto.js';
import { createSource, loadSourceConfig, parseSourceConfig, resolveAutoConfig } from '../src/config.js';
import { HooksSource } from '../src/hooks/source.js';
import { MockHerdr } from './mock-herdr.js';

let herdr: MockHerdr | undefined;
afterEach(async () => {
  await herdr?.close();
  herdr = undefined;
});

const cfg = (socket?: string) => parseSourceConfig('source = "auto"\n' + (socket ? `[herdr]\nsocket = ${JSON.stringify(socket)}\n` : ''));

describe('auto source', () => {
  it('accepts auto in toml and BELLWETHER_SOURCE', async () => {
    expect(cfg().source).toBe('auto');
    expect((await loadSourceConfig('/nonexistent/bellwether.toml', { BELLWETHER_SOURCE: 'auto' })).source).toBe('auto');
  });

  it('picks live when a Herdr socket answers', async () => {
    herdr = new MockHerdr();
    await herdr.listen();
    const choice = await chooseAutoSource(cfg(herdr.socketPath), { timeoutMs: 500 });
    expect(choice.source).toBe('live');
  });

  it('falls back to hooks when nothing listens', async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'bw-auto-'));
    const socket = process.platform === 'win32' ? `\\\\.\\pipe\\${dir}\\none.sock` : path.join(dir, 'none.sock');
    const choice = await chooseAutoSource(cfg(socket), { timeoutMs: 200 });
    expect(choice.source).toBe('hooks');
  });

  it('falls back to hooks when the connect probe times out', async () => {
    const choice = await chooseAutoSource(cfg('/x'), { timeoutMs: 20, connector: () => new net.Socket() });
    expect(choice.source).toBe('hooks');
  });

  it('uses an injected probe and logs one line each', async () => {
    const lines: string[] = [];
    const live = await resolveAutoConfig(cfg(), { probe: async () => true, log: (m) => lines.push(m) });
    const hooks = await resolveAutoConfig(cfg(), { probe: async () => false, log: (m) => lines.push(m) });
    expect(live.source).toBe('live');
    expect(hooks.source).toBe('hooks');
    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatch(/picked live/);
    expect(lines[1]).toMatch(/picked hooks/);
  });

  it('leaves explicit sources alone and never probes them', async () => {
    let probed = false;
    for (const source of ['live', 'hooks', 'mock'] as const) {
      const out = await resolveAutoConfig({ source, herdr: {} }, { probe: async () => ((probed = true), true) });
      expect(out.source).toBe(source);
    }
    expect(probed).toBe(false);
  });

  it('createSource treats an unresolved auto as hooks', () => {
    expect(createSource({ source: 'auto', herdr: {} })).toBeInstanceOf(HooksSource);
  });
});
