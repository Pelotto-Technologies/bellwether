import { readFileSync } from 'node:fs';
import path from 'node:path';
import Ajv2020 from 'ajv/dist/2020.js';
import { describe, expect, it } from 'vitest';
import { FIXTURES, loadCapture, RESEARCH_FIXTURES } from './mock-herdr.js';

const schema = JSON.parse(readFileSync(path.join(import.meta.dirname, '../../../docs/research/herdr-api.schema.json'), 'utf8'));
const ajv = new (Ajv2020 as unknown as typeof Ajv2020.default)({ strict: false, allErrors: true, logger: false });
ajv.addSchema(schema, 'herdr');
const v = (name: string) => ajv.getSchema(`herdr#/schemas/${name}`)!;

describe('fixtures match the Herdr protocol 22 schema', () => {
  it('snapshot.json is a valid success response', () => {
    const ok = v('success_response')(JSON.parse(readFileSync(path.join(FIXTURES, 'snapshot.json'), 'utf8')));
    expect(ok, JSON.stringify(v('success_response').errors)).toBe(true);
  });

  it('every captured line is a valid lifecycle or subscription event', () => {
    for (const line of [...loadCapture(), ...loadCapture(path.join(RESEARCH_FIXTURES, 'mixed-agents.events.ndjson')).filter((l) => l.event)]) {
      const ok = v('event')(line) || v('subscription_event')(line);
      expect(ok, JSON.stringify(line)).toBe(true);
    }
  });
});
