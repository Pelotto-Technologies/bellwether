import { describe, expect, it } from 'vitest';
import { MockGenerator } from '../src/mock.js';
import { isRole, isStatus } from '../src/types.js';

describe('MockGenerator', () => {
  it('is deterministic for a seed', () => {
    const run = (seed: number) => {
      const g = new MockGenerator({ seed });
      return [g.initial(0), ...Array.from({ length: 50 }, (_, i) => g.step(i + 1))];
    };
    expect(run(7)).toEqual(run(7));
    expect(run(7)).not.toEqual(run(8));
  });

  it('starts with several parties of valid members', () => {
    const g = new MockGenerator();
    const d = g.initial();
    expect(d.kind).toBe('snapshot');
    const parties = Object.values(g.current.parties);
    expect(parties.length).toBeGreaterThanOrEqual(3);
    for (const p of parties) {
      expect(Object.keys(p.members).length).toBeGreaterThan(0);
      for (const m of Object.values(p.members)) {
        expect(isRole(m.role)).toBe(true);
        expect(isStatus(m.status)).toBe(true);
      }
    }
  });

  it('eventually produces every status and some speech', () => {
    const g = new MockGenerator({ seed: 3 });
    g.initial();
    const seen = new Set<string>();
    let says = 0;
    for (let i = 0; i < 500; i++) {
      const d = g.step(i);
      if (d.kind === 'member') seen.add(d.member.status);
      if (d.kind === 'say') says++;
    }
    expect([...seen].sort()).toEqual(['blocked', 'done', 'idle', 'working']);
    expect(says).toBeGreaterThan(0);
  });
});

describe('MockGenerator runner party', () => {
  it('has an idle coordinator, a working leaf and a named finished leaf, and keeps them through the random walk', () => {
    const g = new MockGenerator({ seed: 5 });
    g.initial();
    for (let i = 0; i < 300; i++) g.step(i);
    const p = Object.values(g.current.parties).find((q) => q.label.endsWith('(runner)'))!;
    const by = (role: string) => Object.values(p.members).find((m) => m.role === role)!;
    expect(by('coordinator').status).toBe('idle');
    expect(by('implementer').status).toBe('working');
    expect(by('reviewer')).toMatchObject({ status: 'done', name: 'Quill' });
    expect(p.status).toBe('done');
  });
});
