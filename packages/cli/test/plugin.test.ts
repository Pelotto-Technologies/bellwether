import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { EVENT_FOR_HOOK, SUPPORTED_HOOK_EVENTS } from '../src/hook/event.js';

const root = join(import.meta.dirname, '..', '..', '..');
const json = (rel: string) => JSON.parse(readFileSync(join(root, rel), 'utf8')) as any;
const cliVersion = json('packages/cli/package.json').version as string;

describe('Claude Code plugin files', () => {
  it('marketplace lists the plugin from ./plugins/bellwether', () => {
    const m = json('.claude-plugin/marketplace.json');
    expect(m.name).toBe('bellwether');
    expect(m.owner.name).toBe('Pelotto Technologies');
    expect(m.plugins).toHaveLength(1);
    expect(m.plugins[0]).toMatchObject({ name: 'bellwether', source: './plugins/bellwether' });
    expect(m.plugins[0].version).toBe(cliVersion);
  });

  it('plugin.json matches the CLI version and license', () => {
    const p = json('plugins/bellwether/.claude-plugin/plugin.json');
    expect(p).toMatchObject({ name: 'bellwether', license: 'Apache-2.0', version: cliVersion });
    expect(p.author.name).toBe('Pelotto Technologies');
    expect(p.homepage).toContain('github.com/Pelotto-Technologies/bellwether');
    expect(p.repository).toContain('github.com/Pelotto-Technologies/bellwether');
  });

  it('hooks.json registers exactly the events `bellwether hook event` handles', () => {
    const h = json('plugins/bellwether/hooks/hooks.json');
    expect(Object.keys(h.hooks).sort()).toEqual([...SUPPORTED_HOOK_EVENTS].sort());
    expect(Object.keys(EVENT_FOR_HOOK).sort()).toEqual([...SUPPORTED_HOOK_EVENTS].sort());
    for (const [name, groups] of Object.entries<any[]>(h.hooks)) {
      expect(groups).toHaveLength(1);
      const [group] = groups;
      expect(group.hooks).toEqual([{ type: 'command', command: 'bellwether hook event', timeout: 5 }]);
      // A matcher only makes sense for tool events.
      if (name === 'PreToolUse' || name === 'PostToolUse') expect(group.matcher).toBe('*');
      else expect(group.matcher).toBeUndefined();
    }
  });
});
