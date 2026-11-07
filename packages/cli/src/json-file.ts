import { existsSync, readFileSync, writeFileSync } from 'node:fs';

export type Json = null | boolean | number | string | Json[] | { [k: string]: Json };
export type JsonObject = { [k: string]: Json };

export function readJsonObject(path: string): JsonObject {
  if (!existsSync(path)) return {};
  const text = readFileSync(path, 'utf8').trim();
  if (text === '') return {};
  const parsed = JSON.parse(text) as Json;
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`${path} is not a JSON object`);
  }
  return parsed;
}

export function writeJsonObject(path: string, value: JsonObject): void {
  writeFileSync(path, JSON.stringify(value, null, 2) + '\n', 'utf8');
}

export function asObject(v: Json | undefined): JsonObject {
  return v !== null && typeof v === 'object' && !Array.isArray(v) ? v : {};
}

export function asArray(v: Json | undefined): Json[] {
  return Array.isArray(v) ? v : [];
}

/** True when any string anywhere inside v contains needle. */
export function mentions(v: Json, needle: string): boolean {
  if (typeof v === 'string') return v.includes(needle);
  if (Array.isArray(v)) return v.some((x) => mentions(x, needle));
  if (v !== null && typeof v === 'object') return Object.values(v).some((x) => mentions(x, needle));
  return false;
}
