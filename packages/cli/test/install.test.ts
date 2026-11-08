import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AGENT_TARGETS, detect, install, uninstall, findTarget, type AgentContext } from '../src/index.js';
import { sayHookCommand } from '../src/install.js';

let root: string;
let claudeDir: string;
let copilotDir: string;

function ctx(overrides: Partial<AgentContext> = {}): AgentContext {
  return {
    env: { CLAUDE_CONFIG_DIR: claudeDir, COPILOT_HOME: copilotDir },
    home: join(root, 'home'),
    platform: process.platform,
    onPath: (b) => b === 'copilot',
    ...overrides,
  };
}

const readJson = (p: string) => JSON.parse(readFileSync(p, 'utf8'));

// Shapes Herdr's own integrations leave behind; Bellwether must never disturb them.
const herdrClaudeEntry = {
  matcher: 'startup|resume|clear|compact|fork',
  hooks: [{ type: 'command', command: 'sh ~/.claude/hooks/herdr-agent-state.sh' }],
};
const herdrCopilotEntry = { type: 'command', bash: 'sh ~/.copilot/hooks/herdr-agent-state.sh', timeoutSec: 10 };

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'bellwether-cli-'));
  claudeDir = join(root, 'claude');
  copilotDir = join(root, 'copilot');
  mkdirSync(claudeDir);
  mkdirSync(copilotDir);
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

describe('agent targets', () => {
  it('ships Claude Code and Copilot CLI, keyed by Herdr agent id', () => {
    expect(AGENT_TARGETS.map((t) => t.id)).toEqual(['claude', 'copilot']);
  });

  it('honours CLAUDE_CONFIG_DIR and COPILOT_HOME, else falls back to home', () => {
    expect(findTarget('claude')!.configDir(ctx())).toBe(claudeDir);
    expect(findTarget('copilot')!.configDir(ctx())).toBe(copilotDir);
    const bare = ctx({ env: {} });
    expect(findTarget('claude')!.configDir(bare)).toBe(join(root, 'home', '.claude'));
    expect(findTarget('copilot')!.configDir(bare)).toBe(join(root, 'home', '.copilot'));
  });

  it('detects config dirs and binaries per agent', () => {
    rmSync(claudeDir, { recursive: true });
    const d = detect(ctx());
    expect(d.find((x) => x.id === 'claude')).toMatchObject({ configDirExists: false, onPath: false });
    expect(d.find((x) => x.id === 'copilot')).toMatchObject({ configDirExists: true, onPath: true });
  });
});

describe('install', () => {
  it('writes the skill pack and both hook scripts for each agent', () => {
    const out = install(ctx());
    expect(out.map((o) => o.status)).toEqual(['installed', 'installed']);
    for (const dir of [claudeDir, copilotDir]) {
      const skill = readFileSync(join(dir, 'skills', 'bellwether', 'SKILL.md'), 'utf8');
      expect(skill).toContain('name: bellwether');
      expect(skill).toContain('`architect`');
      expect(skill).toContain('If you orchestrate a project');
      const sh = readFileSync(join(dir, 'hooks', 'bellwether-role.sh'), 'utf8');
      expect(sh).toContain('report-metadata "$HERDR_PANE_ID" --source bellwether');
      expect(existsSync(join(dir, 'hooks', 'bellwether-role.ps1'))).toBe(true);
    }
  });

  it('adds a nested SessionStart group for Claude Code next to Herdr', () => {
    writeFileSync(join(claudeDir, 'settings.json'), JSON.stringify({ model: 'x', hooks: { SessionStart: [herdrClaudeEntry] } }));
    install(ctx());
    const s = readJson(join(claudeDir, 'settings.json'));
    expect(s.model).toBe('x');
    expect(s.hooks.SessionStart).toHaveLength(2);
    expect(s.hooks.SessionStart[0]).toEqual(herdrClaudeEntry);
    expect(s.hooks.SessionStart[1].hooks[0].command).toMatch(/^sh ".*bellwether-role\.sh"$/);
  });

  it('adds a flat SessionStart entry for Copilot CLI next to Herdr', () => {
    writeFileSync(join(copilotDir, 'settings.json'), JSON.stringify({ hooks: { SessionStart: [herdrCopilotEntry] } }));
    install(ctx());
    const s = readJson(join(copilotDir, 'settings.json'));
    expect(s.hooks.SessionStart).toHaveLength(2);
    expect(s.hooks.SessionStart[0]).toEqual(herdrCopilotEntry);
    const ours = s.hooks.SessionStart[1];
    expect(ours.type).toBe('command');
    expect(ours.bash).toMatch(/bellwether-role\.sh"$/);
    expect(ours.powershell).toMatch(/bellwether-role\.ps1"$/);
    expect(ours.hooks).toBeUndefined();
  });

  it('is idempotent', () => {
    install(ctx());
    install(ctx());
    expect(readJson(join(claudeDir, 'settings.json')).hooks.SessionStart).toHaveLength(1);
    expect(readJson(join(copilotDir, 'settings.json')).hooks.SessionStart).toHaveLength(1);
    expect(readJson(join(claudeDir, 'settings.json')).hooks.PreToolUse).toHaveLength(1);
    expect(readJson(join(copilotDir, 'settings.json')).hooks.PreToolUse).toHaveLength(1);
  });

  it('adds a PreToolUse message hook that runs this CLI with absolute paths', () => {
    const hook = sayHookCommand('C:\\Program Files\\nodejs\\node.exe', 'C:\\npm\\bellwether\\dist\\main.js');
    expect(hook.posix).toBe('"C:/Program Files/nodejs/node.exe" "C:/npm/bellwether/dist/main.js" hook say # bellwether-say');
    expect(hook.powershell).toBe('& "C:\\Program Files\\nodejs\\node.exe" "C:\\npm\\bellwether\\dist\\main.js" hook say # bellwether-say');
    install(ctx(), undefined, hook);
    const c = readJson(join(claudeDir, 'settings.json')).hooks.PreToolUse;
    expect(c).toEqual([{ matcher: 'Bash|PowerShell', hooks: [{ type: 'command', command: hook.posix, timeout: 10 }] }]);
    const k = readJson(join(copilotDir, 'settings.json')).hooks.PreToolUse;
    expect(k).toEqual([{ type: 'command', bash: hook.posix, powershell: hook.powershell, timeoutSec: 10 }]);
  });

  it('skips an agent whose config dir is missing', () => {
    rmSync(copilotDir, { recursive: true });
    const out = install(ctx());
    expect(out[1]).toMatchObject({ id: 'copilot', status: 'skipped' });
    expect(existsSync(copilotDir)).toBe(false);
  });

  it('installs only the selected agent', () => {
    install(ctx(), [findTarget('copilot')!]);
    expect(existsSync(join(claudeDir, 'settings.json'))).toBe(false);
    expect(existsSync(join(copilotDir, 'settings.json'))).toBe(true);
  });
});

describe('uninstall', () => {
  it('removes only Bellwether entries and files', () => {
    writeFileSync(join(claudeDir, 'settings.json'), JSON.stringify({ hooks: { SessionStart: [herdrClaudeEntry] } }));
    writeFileSync(join(copilotDir, 'settings.json'), JSON.stringify({ hooks: { SessionStart: [herdrCopilotEntry] } }));
    install(ctx());
    uninstall(ctx());
    expect(readJson(join(claudeDir, 'settings.json'))).toEqual({ hooks: { SessionStart: [herdrClaudeEntry] } });
    expect(readJson(join(copilotDir, 'settings.json'))).toEqual({ hooks: { SessionStart: [herdrCopilotEntry] } });
    for (const dir of [claudeDir, copilotDir]) {
      expect(existsSync(join(dir, 'skills', 'bellwether'))).toBe(false);
      expect(existsSync(join(dir, 'hooks', 'bellwether-role.sh'))).toBe(false);
    }
  });

  it('restores a settings file that had no hooks', () => {
    writeFileSync(join(copilotDir, 'settings.json'), JSON.stringify({ theme: 'dark' }));
    install(ctx());
    uninstall(ctx());
    expect(readJson(join(copilotDir, 'settings.json'))).toEqual({ theme: 'dark' });
  });

  it('keeps a user hook that shares a Claude group with ours', () => {
    const userHook = { type: 'command', command: 'echo hi' };
    install(ctx());
    const p = join(claudeDir, 'settings.json');
    const s = readJson(p);
    s.hooks.SessionStart[0].hooks.push(userHook);
    writeFileSync(p, JSON.stringify(s));
    uninstall(ctx());
    expect(readJson(p).hooks.SessionStart[0].hooks).toEqual([userHook]);
  });

  it('is safe when nothing is installed', () => {
    expect(() => uninstall(ctx())).not.toThrow();
    expect(existsSync(join(claudeDir, 'settings.json'))).toBe(false);
  });
});
