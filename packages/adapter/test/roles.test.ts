import { describe, expect, it } from 'vitest';
import { resolveRole } from '../src/roles.js';

describe('resolveRole', () => {
  it('prefers the role token', () => {
    expect(resolveRole({ tokens: { role: 'Reviewer' }, agentName: 'architect', title: 'ops' })).toBe('reviewer');
  });
  it('ignores an unknown role token and falls through', () => {
    expect(resolveRole({ tokens: { role: 'wizard' }, agentName: 'implementer-2' })).toBe('implementer');
  });
  it('falls back to the agent rename name, then the pane title', () => {
    expect(resolveRole({ agentName: 'reviewer-2' })).toBe('reviewer');
    expect(resolveRole({ agentName: 'bob', title: 'Lead architect' })).toBe('architect');
  });
  it('matches whole words only', () => {
    expect(resolveRole({ title: 'operations' })).toBe('generic');
  });
  it('defaults to generic', () => {
    expect(resolveRole({})).toBe('generic');
  });
});

describe('isOrchestrationLabel', () => {
  it('matches orchestration words, not substrings of other words', async () => {
    const { isOrchestrationLabel } = await import('../src/roles.js');
    for (const l of ['bellwether Orchestration', 'api-orchestrator', 'Orchestrate']) expect(isOrchestrationLabel(l)).toBe(true);
    for (const l of ['bellwether', 'orchestral', '', undefined]) expect(isOrchestrationLabel(l)).toBe(false);
  });
});
