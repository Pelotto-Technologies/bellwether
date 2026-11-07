import { describe, expect, it } from 'vitest';
import neutral from '../../../themes/neutral/theme.json';
import { parseTheme } from '../src/theme.js';
import { ROLES } from '@bellwether/adapter/core';

describe('parseTheme', () => {
  it('accepts the shipped neutral theme and covers every role', () => {
    const theme = parseTheme(neutral);
    expect(theme.name).toBe('neutral');
    for (const role of ROLES) expect(theme.roles[role]).toBeDefined();
  });

  it('fills missing roles from generic', () => {
    const theme = parseTheme({ ...neutral, roles: { generic: neutral.roles.generic } });
    expect(theme.roles.architect).toEqual(theme.roles.generic);
  });

  it('rejects bad colours and a missing generic role', () => {
    expect(() => parseTheme({ ...neutral, outline: 'red' })).toThrow(/outline/);
    expect(() => parseTheme({ ...neutral, roles: {} })).toThrow(/generic/);
  });

  it('describes exactly the core roles', () => {
    // The neutral theme speaks roles only; private skins live outside the repo.
    expect(Object.keys(neutral.roles).sort()).toEqual([...ROLES].sort());
  });
});
