import { describe, expect, it } from 'vitest';
import { adapterArgs } from '../src/run.js';

describe('adapterArgs', () => {
  it('run defaults to live, all sessions, serving the renderer', () => {
    expect(adapterArgs('run', [], '/r')).toEqual(['--live', '--all', '--serve', '/r']);
  });
  it('run respects an explicit source', () => {
    expect(adapterArgs('run', ['--mock'], '/r')).toEqual(['--serve', '/r', '--mock']);
  });
  it('record passes the file and scrub flag', () => {
    expect(adapterArgs('record', ['a.jsonl', '--scrub'])).toEqual(['--live', '--all', '--record', 'a.jsonl', '--scrub']);
  });
  it('replay and scrub map to adapter flags', () => {
    expect(adapterArgs('replay', ['a.jsonl', '--speed', '4'], '/r')).toEqual(['--serve', '/r', '--replay', 'a.jsonl', '--speed', '4']);
    expect(adapterArgs('scrub', ['i', 'o'])).toEqual(['--scrub-file', 'i', 'o']);
  });
  it('rejects missing arguments', () => {
    expect(() => adapterArgs('record', [])).toThrow(/usage/);
    expect(() => adapterArgs('scrub', ['x'])).toThrow(/usage/);
  });
});
