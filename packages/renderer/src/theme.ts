import { ROLES, STATUSES, type Role, type Status } from '@bellwether/adapter/core';
import { parseSounds, type SoundStyle } from './cues/style.js';

export const HATS = ['none', 'cap', 'hood', 'helm', 'point'] as const;
export const PROPS = ['none', 'staff', 'lantern', 'hammer', 'book'] as const;
export type Hat = (typeof HATS)[number];
export type Prop = (typeof PROPS)[number];

export interface RoleLook {
  body: string;
  accent: string;
  hat: Hat;
  prop: Prop;
}

export interface Theme {
  name: string;
  /** Role whose member carries the party's status light. */
  beacon: Role;
  palette: Record<Status, string>;
  outline: string;
  skin: string;
  ground: string;
  roles: Record<Role, RoleLook>;
  sayTtlMs: number;
  /** Flavour of the sound cues (optional `sounds` block in theme.json; defaults apply). */
  sounds: SoundStyle;
}

const HEX = /^#[0-9a-f]{6}$/i;

function color(value: unknown, where: string): string {
  if (typeof value !== 'string' || !HEX.test(value)) throw new Error(`theme: ${where} must be #rrggbb`);
  return value;
}

function oneOf<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return typeof value === 'string' && (allowed as readonly string[]).includes(value) ? (value as T) : fallback;
}

/**
 * Validates a theme.json. Missing roles fall back to the theme's `generic` look so a
 * theme pack only has to describe the roles it cares about.
 */
export function parseTheme(raw: unknown): Theme {
  if (!raw || typeof raw !== 'object') throw new Error('theme: not an object');
  const t = raw as Record<string, unknown>;
  const palette = (t.palette ?? {}) as Record<string, unknown>;
  const roles = (t.roles ?? {}) as Record<string, Record<string, unknown> | undefined>;
  const genericRaw = roles.generic;
  if (!genericRaw) throw new Error('theme: roles.generic is required');

  const look = (r: Record<string, unknown>, where: string): RoleLook => ({
    body: color(r.body, `${where}.body`),
    accent: color(r.accent, `${where}.accent`),
    hat: oneOf(r.hat, HATS, 'none'),
    prop: oneOf(r.prop, PROPS, 'none'),
  });
  const generic = look(genericRaw, 'roles.generic');

  return {
    name: typeof t.name === 'string' ? t.name : 'unnamed',
    beacon: oneOf(t.beacon, ROLES, 'coordinator'),
    palette: Object.fromEntries(
      STATUSES.map((s) => [s, color(palette[s], `palette.${s}`)]),
    ) as Record<Status, string>,
    outline: color(t.outline, 'outline'),
    skin: color(t.skin, 'skin'),
    ground: color(t.ground, 'ground'),
    roles: Object.fromEntries(
      ROLES.map((r) => {
        const entry = roles[r];
        return [r, entry ? look(entry, `roles.${r}`) : generic];
      }),
    ) as Record<Role, RoleLook>,
    sayTtlMs: typeof t.sayTtlMs === 'number' && t.sayTtlMs > 0 ? t.sayTtlMs : 6000,
    sounds: parseSounds(t.sounds),
  };
}
