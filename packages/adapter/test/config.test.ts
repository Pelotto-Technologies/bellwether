import { mkdtempSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { createSource, loadSourceConfig, parseSourceConfig } from '../src/config.js';
import { HerdrSource } from '../src/herdr/source.js';
import { MockSource } from '../src/mock.js';

describe('source config', () => {
  it('defaults to mock', async () => {
    expect(await loadSourceConfig('/nonexistent/bellwether.toml', {})).toEqual({ source: 'mock', herdr: {} });
  });

  it('parses live with sessions', () => {
    expect(parseSourceConfig('source = "live"\n[herdr]\nsessions = "all"\n')).toEqual({ source: 'live', herdr: { sessions: 'all' } });
    expect(parseSourceConfig('source = "live"\n[herdr]\nsessions = ["default", "overlay-dev"]\nsocket = "/s"\n')).toEqual({
      source: 'live', herdr: { sessions: ['default', 'overlay-dev'], socket: '/s' },
    });
    expect(parseSourceConfig('[herdr]\nsessions = "overlay-dev"\n').herdr.sessions).toEqual(['overlay-dev']);
  });

  it('rejects unknown sources', () => {
    expect(() => parseSourceConfig('source = "herdr"')).toThrow(/mock" or "live/);
  });

  it('BELLWETHER_SOURCE overrides the file', async () => {
    const f = path.join(mkdtempSync(path.join(os.tmpdir(), 'bw-cfg-')), 'bellwether.toml');
    writeFileSync(f, 'source = "mock"\n');
    expect((await loadSourceConfig(f, { BELLWETHER_SOURCE: 'live' })).source).toBe('live');
  });

  it('reads the skin pack and lets BELLWETHER_PACK override it', async () => {
    expect(parseSourceConfig('pack = "aesir"').pack).toBe('aesir');
    expect(parseSourceConfig('source = "mock"').pack).toBeUndefined();
    expect(() => parseSourceConfig('pack = "../x"')).toThrow(/theme folder name/);
    const f = path.join(mkdtempSync(path.join(os.tmpdir(), 'bw-cfg-')), 'bellwether.toml');
    writeFileSync(f, 'pack = "aesir"\n');
    expect((await loadSourceConfig(f, {})).pack).toBe('aesir');
    expect((await loadSourceConfig(f, { BELLWETHER_PACK: 'wayfarers' })).pack).toBe('wayfarers');
  });

  it('creates the matching source', () => {
    expect(createSource({ source: 'mock', herdr: {} })).toBeInstanceOf(MockSource);
    expect(createSource({ source: 'live', herdr: { sessions: ['x'] } })).toBeInstanceOf(HerdrSource);
  });
});

describe('strip scale', () => {
  it('reads scale from toml and rejects bad values', () => {
    expect(parseSourceConfig('scale = 2').scale).toBe(2);
    expect(parseSourceConfig('source = "mock"').scale).toBeUndefined();
    expect(() => parseSourceConfig('scale = 7')).toThrow(/scale/);
    expect(() => parseSourceConfig('scale = 2.5')).toThrow(/scale/);
  });
});

describe('minimal labels', () => {
  it('reads minimal from toml', () => {
    expect(parseSourceConfig('minimal = true').minimal).toBe(true);
    expect(parseSourceConfig('source = "mock"').minimal).toBeUndefined();
    expect(() => parseSourceConfig('minimal = "yes"')).toThrow(/minimal/);
  });
});
