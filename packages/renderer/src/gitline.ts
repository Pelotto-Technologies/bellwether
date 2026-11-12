import type { GitState } from '@bellwether/adapter/core';

export type GitPartKind = 'dirty' | 'ahead' | 'remote';

export interface GitPart {
  kind: GitPartKind;
  /** Compact form for the strip nameplate. */
  short: string;
  /** Full sentence fragment for the map and tooltips. */
  long: string;
}

/** Marker shown for a repository without any remote. */
export const NO_REMOTE_MARK = '∅';

/** Default counter colours (dirty amber, ahead green, no remote red); a theme may override them. */
export const GIT_COLORS: Record<GitPartKind, number> = { dirty: 0xe8a838, ahead: 0x6fcf6f, remote: 0xe05a4f };

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** The non-clean parts of a git state, in display order. Empty when clean (or unknown). */
export function gitParts(git: GitState | undefined): GitPart[] {
  if (!git) return [];
  const out: GitPart[] = [];
  if (git.dirty > 0) out.push({ kind: 'dirty', short: `±${git.dirty}`, long: `${plural(git.dirty, 'uncommitted file', 'uncommitted files')}` });
  if (git.ahead > 0) out.push({ kind: 'ahead', short: `↑${git.ahead}`, long: `${plural(git.ahead, 'unpushed commit', 'unpushed commits')}` });
  if (git.noRemote) out.push({ kind: 'remote', short: NO_REMOTE_MARK, long: 'no remote' });
  return out;
}

/** One-line and list forms of a party's git state: `±3 ↑2` and `["3 uncommitted files", "2 unpushed commits"]`. Empty when clean. */
export function gitSummary(git: GitState | undefined): { short: string; long: string[] } {
  const parts = gitParts(git);
  return { short: parts.map((p) => p.short).join(' '), long: parts.map((p) => p.long) };
}
