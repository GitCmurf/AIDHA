import { describe, expect, it } from 'vitest';
import {
  parseSourceDistillation,
  DISTILLATION_SCHEMA_VERSION,
  distillationResponseSchema,
} from '../../../src/extract/distill/schema.js';

const excerptIds = new Set(['ex1', 'ex2']);

const validUnit = (overrides: Record<string, unknown> = {}): Record<string, unknown> => {
  return {
    id: 'u1',
    kind: 'idea',
    text: 'A markdown wiki can answer questions by following explicit links instead of embedding similarity.',
    stance: 'asserted',
    evidence: [{ excerptId: 'ex1', quote: 'reads index files and follows explicit links' }],
    importance: 'core',
    ...overrides,
  };
};

const validPayload = (units: unknown[] = [validUnit()]): string => {
  return JSON.stringify({
    schemaVersion: DISTILLATION_SCHEMA_VERSION,
    sourceType: 'explainer',
    sourceCoherence: 'single_topic',
    theses: ['Markdown wikis with explicit links are a viable RAG alternative for small corpora.'],
    units,
  });
};

describe('parseSourceDistillation', () => {
  it('parses a valid distillation', () => {
    const result = parseSourceDistillation(validPayload(), excerptIds);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.units).toHaveLength(1);
      expect(result.value.units[0]?.id).toBe('u1');
    }
  });

  it('extracts JSON from fenced markdown responses', () => {
    const fenced = ['```json', validPayload(), '```'].join('\n');
    expect(parseSourceDistillation(fenced, excerptIds).ok).toBe(true);
  });

  it('preserves markdown fences inside otherwise valid JSON strings', () => {
    const payload = validPayload([validUnit({
      text: 'A tutorial can store ```text code``` in a JSON string without fencing the whole response.',
    })]);
    expect(parseSourceDistillation(payload, excerptIds).ok).toBe(true);
  });

  it.each(['Explanation first.\n', ''])('selects the JSON fence after a non-JSON code block: %s', prefix => {
    const response = [prefix, '```text', 'Example {not JSON}', '```', '```json', validPayload(), '```'].join('\n');
    expect(parseSourceDistillation(response, excerptIds).ok).toBe(true);
  });

  it.each([
    ['The notation uses {excerptId}.\n', ''],
    ['', '\nThe notation uses {excerptId}.'],
    ['The notation uses {excerptId}.\n', '\nThe notation uses {otherId}.'],
  ])('ignores prose braces around a valid response: %s %s', (prefix, suffix) => {
    expect(parseSourceDistillation(`${prefix}${validPayload()}${suffix}`, excerptIds).ok).toBe(true);
  });

  it('tracks nested objects and escaped quotes while finding the JSON boundary', () => {
    const payload = validPayload([validUnit({ text: 'A quoted "brace }" and a literal backslash \\ remain part of this source description.' })]);
    expect(parseSourceDistillation(`${payload}\nThe notation uses {excerptId}.`, excerptIds).ok).toBe(true);
  });

  it('accepts a source recommendation without fabricating an unstated rationale', () => {
    const result = parseSourceDistillation(
      validPayload([validUnit({ kind: 'recommendation' })]),
      excerptIds
    );
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.units[0]?.rationale).toBeUndefined();
  });

  it('accepts a limitation with conditions but no rationale', () => {
    const result = parseSourceDistillation(
      validPayload([validUnit({
        kind: 'limitation',
        conditions: [{ type: 'scale', text: 'at enterprise corpus scale' }],
      })]),
      excerptIds
    );
    expect(result.ok).toBe(true);
  });

  it('rejects a limitation with neither rationale nor conditions', () => {
    const result = parseSourceDistillation(
      validPayload([validUnit({ kind: 'limitation' })]),
      excerptIds
    );
    expect(result.ok).toBe(false);
  });

  it('rejects duplicate unit ids', () => {
    const result = parseSourceDistillation(
      validPayload([validUnit(), validUnit({ text: 'Another idea entirely, long enough to pass.' })]),
      excerptIds
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.join(' ')).toMatch(/duplicate unit id/i);
  });

  it('rejects supportsUnitIds referencing unknown units', () => {
    const result = parseSourceDistillation(
      validPayload([validUnit({ supportsUnitIds: ['u99'] })]),
      excerptIds
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.join(' ')).toMatch(/unknown unit id "u99"/i);
  });

  it('rejects evidence citing unknown excerpt ids', () => {
    const result = parseSourceDistillation(
      validPayload([validUnit({ evidence: [{ excerptId: 'nope', quote: 'reads index files and follows explicit links' }] })]),
      excerptIds
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.join(' ')).toMatch(/unknown excerpt id "nope"/i);
  });

  it('allows empty theses (diagnostic, not failure)', () => {
    const payload = JSON.parse(validPayload());
    payload.theses = [];
    const result = parseSourceDistillation(JSON.stringify(payload), excerptIds);
    expect(result.ok).toBe(true);
  });

  it('returns readable errors for non-JSON responses', () => {
    const result = parseSourceDistillation('I could not produce JSON, sorry.', excerptIds);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors[0]).toMatch(/no JSON object/i);
  });

  it('rejects mismatched schemaVersion', () => {
    const payload = JSON.parse(validPayload());
    payload.schemaVersion = 42;
    const result = parseSourceDistillation(JSON.stringify(payload), excerptIds);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.join(' ')).toMatch(/schemaVersion must be 1/);
  });

  it('caps the error list with a truncation note', () => {
    const manyBadUnits = Array.from({ length: 20 }, (_, i) =>
      validUnit({ id: `u${i + 1}`, kind: 'limitation' })
    );
    const result = parseSourceDistillation(validPayload(manyBadUnits), excerptIds);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.length).toBeLessThanOrEqual(11);
      expect(result.errors[result.errors.length - 1]).toMatch(/more error/i);
    }
  });

  it('reports truncated JSON as invalid JSON', () => {
    const truncated = '{"schemaVersion":1, "units": [{"id": "u1", "kind": "idea"';
    const result = parseSourceDistillation(truncated, excerptIds);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors[0]).toMatch(/not valid JSON/i);
  });

  it('defaults stance to asserted when omitted', () => {
    const noStance = validUnit();
    delete (noStance as Record<string, unknown>)['stance'];
    const result = parseSourceDistillation(validPayload([noStance]), excerptIds);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.units[0]?.stance).toBe('asserted');
  });
});

it('preserves a source-given speaker role without inventing a personal name', () => {
  const result = parseSourceDistillation(validPayload([validUnit({ attribution: { kind: 'speaker', name: null, role: 'committee chair' } })]), excerptIds);
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(result.errors.join('; '));
  expect(result.value.units[0]?.attribution).toEqual({ kind: 'speaker', role: 'committee chair' });
});

it('represents role-only third parties and an explicitly unknown origin without a fabricated identity', () => {
  for (const attribution of [{ kind: 'third_party', role: 'equipment supplier' }, { kind: 'unknown', name: null, role: null }]) {
    const result = parseSourceDistillation(validPayload([validUnit({ attribution })]), excerptIds);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.errors.join('; '));
    expect(result.value.units[0]?.attribution?.kind).toBe(attribution.kind);
    expect(result.value.units[0]?.attribution?.name).toBeUndefined();
  }
});

it('rejects an unknown origin that also asserts an identity or role', () => {
  for (const attribution of [{ kind: 'unknown', name: 'Elin' }, { kind: 'unknown', role: 'committee chair' }]) {
    const result = parseSourceDistillation(validPayload([validUnit({ attribution })]), excerptIds);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.join('; ')).toContain('unknown attribution');
  }
});

it('uses required nullable wire fields and constrains generation to allowed excerpts', () => {
  expect(distillationResponseSchema(excerptIds)).toMatchObject({
    type: 'object',
    required: ['schemaVersion', 'sourceType', 'sourcePurpose', 'sourceCoherence', 'theses', 'units'],
    properties: {
      schemaVersion: { const: 1 },
      sourcePurpose: { anyOf: [{ type: 'string' }, { type: 'null' }] },
      units: { items: {
        required: ['id', 'kind', 'text', 'rationale', 'conditions', 'attribution', 'stance', 'evidence', 'supportsUnitIds', 'importance'],
        properties: {
          evidence: { items: { properties: { excerptId: { enum: ['ex1', 'ex2'] } } } },
        },
      } },
    },
  });
});

it('refuses to construct a generation schema without any source excerpts', () => {
  expect(() => distillationResponseSchema(new Set())).toThrow(/at least one excerpt/i);
});

it('accepts a genuinely empty proposal without a forced claim count', () => {
  const result = parseSourceDistillation(validPayload([]), new Set());
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(result.errors.join('; '));
  expect(result.value.units).toEqual([]);
});
