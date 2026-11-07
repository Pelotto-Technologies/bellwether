import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { discoverSessions, herdrConfigDir, resolveTarget, sessionSocketFile, toConnectPath } from '../src/herdr/paths.js';

const win = { platform: 'win32' as const, env: { APPDATA: 'C:\\Users\\dev\\AppData\\Roaming' }, home: 'C:\\Users\\dev' };
const nix = { platform: 'linux' as const, env: {}, home: '/home/dev' };

describe('socket paths', () => {
  it('uses APPDATA on Windows and ~/.config elsewhere', () => {
    expect(herdrConfigDir(win)).toBe('C:\\Users\\dev\\AppData\\Roaming\\herdr');
    expect(herdrConfigDir(nix)).toBe('/home/dev/.config/herdr');
    expect(herdrConfigDir({ ...nix, env: { XDG_CONFIG_HOME: '/x' } })).toBe('/x/herdr');
  });

  it('names default and named session sockets', () => {
    expect(sessionSocketFile('default', nix)).toBe('/home/dev/.config/herdr/herdr.sock');
    expect(sessionSocketFile('overlay-dev', win)).toBe('C:\\Users\\dev\\AppData\\Roaming\\herdr\\sessions\\overlay-dev\\herdr.sock');
  });

  it('prefixes Windows named pipes', () => {
    expect(toConnectPath('C:\\a\\herdr.sock', 'win32')).toBe('\\\\.\\pipe\\C:\\a\\herdr.sock');
    expect(toConnectPath('\\\\.\\pipe\\C:\\a\\herdr.sock', 'win32')).toBe('\\\\.\\pipe\\C:\\a\\herdr.sock');
    expect(toConnectPath('/a/herdr.sock', 'linux')).toBe('/a/herdr.sock');
  });

  it('resolves explicit socket, session, then env', () => {
    expect(resolveTarget({ socket: '/s.sock' }, nix)).toEqual({ session: 'custom', connectPath: '/s.sock' });
    expect(resolveTarget({ session: 'x' }, nix).connectPath).toBe('/home/dev/.config/herdr/sessions/x/herdr.sock');
    expect(resolveTarget({}, { ...nix, env: { HERDR_SOCKET_PATH: '/e.sock' } })).toEqual({ session: 'default', connectPath: '/e.sock' });
    expect(resolveTarget({}, { ...nix, env: { HERDR_SESSION: 'y' } }).session).toBe('y');
  });

  it('discovers sessions that have a socket', async () => {
    const xdg = mkdtempSync(path.join(os.tmpdir(), 'bw-xdg-'));
    const dir = path.join(xdg, 'herdr');
    mkdirSync(path.join(dir, 'sessions', 'live'), { recursive: true });
    mkdirSync(path.join(dir, 'sessions', 'stale'), { recursive: true });
    writeFileSync(path.join(dir, 'herdr.sock'), '');
    writeFileSync(path.join(dir, 'sessions', 'live', 'herdr.sock'), '');
    const found = await discoverSessions({ platform: 'linux', env: { XDG_CONFIG_HOME: xdg } });
    expect(found.map((s) => s.session)).toEqual(['default', 'live']);
  });
});
