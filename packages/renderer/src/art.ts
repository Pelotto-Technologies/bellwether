import { ROLES, STATUSES, type Role, type Status } from '@bellwether/adapter/core';

/** Parsed `art.json`: where a pack's sheets live and how its character is laid out. */

export const ANIMS = ['walk', 'idle', 'wave', 'talk', 'raise', 'blink'] as const;
export type AnimName = (typeof ANIMS)[number];

export interface RoleArt {
  sheet: string;
  displayName: string;
  cloak: string;
  light: string;
}

export interface SliceArt {
  frame: string;
  slice: number;
  tail?: string;
}

export interface Art {
  name: string;
  displayName: string;
  character: {
    w: number;
    h: number;
    anchor: { x: number; y: number };
    fps: Record<AnimName, number>;
    /** Frames per animation, counted from the frame list. */
    counts: Record<AnimName, number>;
  };
  roles: Record<Role, RoleArt>;
  status: Record<Status, string>;
  ground: { sheet: string; tiles: string[] };
  ui: { sheet: string; bubble: SliceArt; nameplate: SliceArt; statusIcons: Record<Status, string> };
}

const HEX = /^#[0-9a-f]{6}$/i;

function obj(v: unknown, where: string): Record<string, unknown> {
  if (!v || typeof v !== 'object' || Array.isArray(v)) throw new Error(`art: ${where} must be an object`);
  return v as Record<string, unknown>;
}
function str(v: unknown, where: string): string {
  if (typeof v !== 'string' || !v) throw new Error(`art: ${where} must be a non-empty string`);
  return v;
}
function hex(v: unknown, where: string): string {
  const s = str(v, where);
  if (!HEX.test(s)) throw new Error(`art: ${where} must be #rrggbb`);
  return s;
}
function num(v: unknown, where: string): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) throw new Error(`art: ${where} must be a number`);
  return v;
}
function slice(v: unknown, where: string): SliceArt {
  const o = obj(v, where);
  return {
    frame: str(o.frame, `${where}.frame`),
    slice: num(o.slice, `${where}.slice`),
    ...(typeof o.tail === 'string' ? { tail: o.tail } : {}),
  };
}

/** Validates an art manifest. Roles missing from the pack fall back to its `fallback` role (default `generic`). */
export function parseArt(raw: unknown): Art {
  const a = obj(raw, 'root');
  const ch = obj(a.character, 'character');
  const size = obj(ch.size, 'character.size');
  const anchor = obj(ch.anchor, 'character.anchor');
  const fpsRaw = obj(ch.fps, 'character.fps');
  const frames = Array.isArray(ch.frames) ? (ch.frames as unknown[]).filter((f): f is string => typeof f === 'string') : [];

  const counts = {} as Record<AnimName, number>;
  const fps = {} as Record<AnimName, number>;
  for (const anim of ANIMS) {
    counts[anim] = frames.filter((f) => new RegExp(`^${anim}_\\d+$`).test(f)).length;
    if (counts[anim] === 0) throw new Error(`art: character.frames has no ${anim}_N frames`);
    fps[anim] = Math.max(0.1, num(fpsRaw[anim], `character.fps.${anim}`));
  }

  const rolesRaw = obj(a.roles, 'roles');
  const fallbackName = typeof a.fallback === 'string' ? a.fallback : 'generic';
  const fallbackRaw = rolesRaw[fallbackName];
  if (!fallbackRaw) throw new Error(`art: fallback role "${fallbackName}" is missing`);
  const role = (v: unknown, where: string): RoleArt => {
    const o = obj(v, where);
    return {
      sheet: str(o.sheet, `${where}.sheet`),
      displayName: typeof o.displayName === 'string' ? o.displayName : where,
      cloak: hex(o.cloak, `${where}.cloak`),
      light: HEX.test(String(o.light)) ? String(o.light) : '#ffffff',
    };
  };
  const fallback = role(fallbackRaw, `roles.${fallbackName}`);

  const statusRaw = obj(a.status, 'status');
  const strip = obj(a.strip, 'strip');
  const ui = obj(a.ui, 'ui');
  const tiles = Array.isArray(strip.tiles) ? (strip.tiles as unknown[]).filter((t): t is string => typeof t === 'string') : [];
  if (!tiles.length) throw new Error('art: strip.tiles must list at least one tile');

  return {
    name: str(a.name, 'name'),
    displayName: typeof a.displayName === 'string' ? a.displayName : String(a.name),
    character: {
      w: num(size.w, 'character.size.w'),
      h: num(size.h, 'character.size.h'),
      anchor: { x: num(anchor.x, 'character.anchor.x'), y: num(anchor.y, 'character.anchor.y') },
      fps,
      counts,
    },
    roles: Object.fromEntries(
      ROLES.map((r) => [r, rolesRaw[r] ? role(rolesRaw[r], `roles.${r}`) : fallback]),
    ) as Record<Role, RoleArt>,
    status: Object.fromEntries(STATUSES.map((s) => [s, hex(statusRaw[s], `status.${s}`)])) as Record<Status, string>,
    ground: { sheet: str(strip.ground, 'strip.ground'), tiles },
    ui: {
      sheet: str(ui.sheet, 'ui.sheet'),
      bubble: slice(ui.bubble, 'ui.bubble'),
      nameplate: slice(ui.nameplate, 'ui.nameplate'),
      statusIcons: Object.fromEntries(
        STATUSES.map((st) => [st, typeof (ui.statusIcons as Record<string, unknown> | undefined)?.[st] === 'string' ? String((ui.statusIcons as Record<string, unknown>)[st]) : `status_${st}`]),
      ) as Record<Status, string>,
    },
  };
}
