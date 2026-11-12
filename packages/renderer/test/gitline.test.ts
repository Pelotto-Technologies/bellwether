import { describe, expect, it } from 'vitest';
import { gitParts, gitSummary, NO_REMOTE_MARK } from '../src/gitline.js';

describe('gitSummary', () => {
  it('is empty for a clean repository and for no git at all', () => {
    expect(gitSummary({ dirty: 0, ahead: 0, noRemote: false })).toEqual({ short: '', long: [] });
    expect(gitSummary(undefined)).toEqual({ short: '', long: [] });
  });

  it('summarizes dirty and ahead', () => {
    expect(gitSummary({ dirty: 3, ahead: 2, noRemote: false })).toEqual({
      short: '±3 ↑2',
      long: ['3 uncommitted files', '2 unpushed commits'],
    });
  });

  it('uses singular forms', () => {
    expect(gitSummary({ dirty: 1, ahead: 1, noRemote: false }).long).toEqual(['1 uncommitted file', '1 unpushed commit']);
  });

  it('marks a missing remote', () => {
    expect(gitSummary({ dirty: 0, ahead: 0, noRemote: true })).toEqual({ short: NO_REMOTE_MARK, long: ['no remote'] });
    expect(gitSummary({ dirty: 3, ahead: 0, noRemote: true })).toEqual({ short: `±3 ${NO_REMOTE_MARK}`, long: ['3 uncommitted files', 'no remote'] });
  });

  it('exposes parts for coloured rendering', () => {
    expect(gitParts({ dirty: 2, ahead: 1, noRemote: false }).map((p) => p.kind)).toEqual(['dirty', 'ahead']);
  });
});
