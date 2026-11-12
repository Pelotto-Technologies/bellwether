import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { parseRecording } from './recording.js';
import type { Delta, Member, Party, World } from './types.js';

/** Short stable sha256 prefix, so the same input always maps to the same label. */
export function hashLabel(value: string, prefix = ''): string {
  return prefix + createHash('sha256').update(value).digest('hex').slice(0, 8);
}

function scrubMember(m: Member): Member {
  // Quest and display names are free text a person typed, so they go like `say` does; model, effort and the numbers are not identifying.
  const { title: _title, say: _say, quest: _quest, name: _name, ...rest } = m;
  return rest;
}

/** Keeps ids, role, agent and status. Hashes label, repo, branch and session; drops free-form tokens except `role`. */
export function scrubParty(p: Party): Party {
  const out: Party = {
    ...p,
    label: hashLabel(p.label, 'ws-'),
    tokens: p.tokens?.role !== undefined ? { role: p.tokens.role } : {},
    members: Object.fromEntries(Object.entries(p.members).map(([k, m]) => [k, scrubMember(m)])),
  };
  if (p.repo !== undefined) out.repo = hashLabel(p.repo, 'repo-');
  if (p.branch !== undefined) out.branch = hashLabel(p.branch, 'br-');
  if (p.session !== undefined) out.session = hashLabel(p.session, 's-');
  return out;
}

function scrubWorld(w: World): World {
  return {
    ...w,
    machine: hashLabel(w.machine, 'm-'),
    parties: Object.fromEntries(Object.entries(w.parties).map(([k, p]) => [k, scrubParty(p)])),
  };
}

/** Privacy scrub for one delta (docs/PLAN.md section 4.2). Returns a new delta; the input is untouched. */
export function scrubDelta(d: Delta): Delta {
  switch (d.kind) {
    case 'snapshot':
      return { ...d, world: scrubWorld(d.world) };
    case 'member':
      return { ...d, member: scrubMember(d.member) };
    case 'party':
      return { ...d, party: scrubParty(d.party) };
    case 'say':
      return { ...d, text: '' };
    case 'removed':
      return d;
    case 'moment':
      // Ids, role, level and counters only: nothing to hash or drop.
      return d;
  }
}

/** Scrub an existing recording file into a new one. Returns the delta count. */
export function scrubFile(input: string, output: string): number {
  const deltas = parseRecording(readFileSync(input, 'utf8')).map(scrubDelta);
  writeFileSync(output, deltas.map((d) => JSON.stringify(d) + '\n').join(''));
  return deltas.length;
}
