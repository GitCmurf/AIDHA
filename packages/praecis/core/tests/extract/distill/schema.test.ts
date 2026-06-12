import { describe, expect, it } from 'vitest';
import {
  parseSourceDistillation,
  DISTILLATION_SCHEMA_VERSION,
} from '../../../src/extract/distill/schema.js';

const excerptIds = new Set(['ex1', 'ex2']);

function validUnit(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'u1',
    kind: 'idea',
    text: 'A markdown wiki can answer questions by following explicit links instead of embedding similarity.',
    stance: 'asserted',
    evidence: [{ excerptId: 'ex1', quote: 'reads index files and follows explicit links' }],
    importance: 'core',
    ...overrides,
  };
}

function validPayload(units: unknown[] = [validUnit()]): string {
  return JSON.stringify({
    schemaVersion: DISTILLATION_SCHEMA_VERSION,
    sourceType: 'explainer',
    sourceCoherence: 'single_topic',
    theses: ['Markdown wikis with explicit links are a viable RAG alternative for small corpora.'],
    units,
  });
}

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
    const fenced = '```json\n' + validPayload() + '\n```';
    expect(parseSourceDistillation(fenced, excerptIds).ok).toBe(true);
  });

  it('rejects a recommendation without rationale', () => {
    const result = parseSourceDistillation(
      validPayload([validUnit({ kind: 'recommendation' })]),
      excerptIds
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.join(' ')).toMatch(/recommendation.*rationale/i);
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
      validUnit({ id: `u${i + 1}`, kind: 'recommendation' })
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
