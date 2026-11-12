import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseSourceConfig } from '../src/config.js';
import { scrubDelta, scrubFile } from '../src/scrub.js';
import type { Delta, Member, Party } from '../src/types.js';

const member: Member = { paneId: 'p1', agent: 'claude', role: 'implementer', status: 'working', title: 'secret-title', say: 'secret-say', name: 'secret-name', lastChange: 5 };
const party: Party = {
  id: 'w1', label: 'secret-label', session: 'secret-session', repo: 'secret-repo', branch: 'secret-branch',
  isWorktree: true, status: 'working', members: { p1: member }, tokens: { role: 'architect', say: 'secret-token' },
};
const deltas: Delta[] = [
  { t: 1, kind: 'snapshot', world: { machine: 'secret-host', parties: { w1: party } } },
  { t: 2, kind: 'member', partyId: 'w1', member },
  { t: 3, kind: 'party', party },
  { t: 4, kind: 'say', partyId: 'w1', paneId: 'p1', text: 'secret-say' },
  { t: 5, kind: 'removed', partyId: 'w1' },
];

describe('scrubDelta', () => {
  it('leaves no original strings and keeps role, agent, status', () => {
    const out = deltas.map(scrubDelta).map((d) => JSON.stringify(d)).join('\n');
    expect(out).not.toContain('secret');
    expect(out).toContain('"role":"implementer"');
    expect(out).toContain('"agent":"claude"');
    expect(out).toContain('"status":"working"');
  });

  it('is deterministic and does not mutate input', () => {
    const a = scrubDelta(deltas[2]!) as Extract<Delta, { kind: 'party' }>;
    const b = scrubDelta(deltas[2]!) as Extract<Delta, { kind: 'party' }>;
    expect(a.party.repo).toBe(b.party.repo);
    expect(a.party.repo).not.toBe('secret-repo');
    expect(party.repo).toBe('secret-repo');
    expect(member.say).toBe('secret-say');
  });

  it('scrubs a file', () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'bw-scrub-'));
    const inp = path.join(dir, 'in.jsonl');
    const outp = path.join(dir, 'out.jsonl');
    writeFileSync(inp, deltas.map((d) => JSON.stringify(d) + '\n').join(''));
    expect(scrubFile(inp, outp)).toBe(5);
    expect(readFileSync(outp, 'utf8')).not.toContain('secret');
  });
});

describe('config', () => {
  it('parses scrub', () => {
    expect(parseSourceConfig('scrub = true').scrub).toBe(true);
    expect(parseSourceConfig('').scrub).toBeUndefined();
    expect(() => parseSourceConfig('scrub = "yes"')).toThrow();
  });
});
