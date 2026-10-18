import { describe, expect, it } from 'vitest';
import { applyGroundingVerdicts, parseGroundingVerdicts } from '../../../src/extract/distill/grounding.js';
import type { VerifiedUnit } from '../../../src/extract/distill/quote-verification.js';

const unit = (overrides: Partial<VerifiedUnit> = {}): VerifiedUnit => ({
  id: 'u1', kind: 'recommendation',
  text: 'Use the red indicator to check the device status.',
  rationale: 'An unsupported explanation.',
  attribution: { kind: 'speaker', name: 'An unsupported identity' },
  conditions: [{ type: 'temporal', text: 'during startup' }],
  stance: 'recommended', importance: 'core',
  evidence: [{ excerptId: 'ex1', quote: 'the red indicator stayed switched off', quoteVerification: 'exact' }],
  ...overrides,
});

describe('parseGroundingVerdicts', () => {
  it('parses semantic verdicts without accepting replacement evidence', () => {
    expect(parseGroundingVerdicts(JSON.stringify({ verdicts: [{
      unitId: 'u1', verdict: 'grounded', evidence: [{ excerptId: 'invented', quote: 'unsupported' }],
    }] }))).toEqual({ ok: true, value: [{ unitId: 'u1', verdict: 'grounded' }], errors: [] });
  });

  it.each([
    { verdicts: [{ unitId: 'u1', verdict: 'accepted' }] },
    { verdicts: [{ unitId: 'u1', verdict: 'rewrite', importance: 'unimportant' }] },
    { verdicts: [{ unitId: 'u1', verdict: 'rewrite', attribution: { kind: 'unknown', name: 'Invented' } }] },
  ])('rejects invalid semantic labels and contradictory attribution', payload => {
    const parsed = parseGroundingVerdicts(JSON.stringify(payload));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) throw new Error(parsed.errors.join('; '));
    expect(parsed.value).toEqual([]);
    expect(parsed.errors.length).toBeGreaterThan(0);
  });

  it('returns readable, bounded errors for missing JSON, truncation and malformed verdicts', () => {
    expect(parseGroundingVerdicts('No verdict available.')).toEqual({ ok: false, errors: ['Grounding response contains no JSON object.'] });
    const truncated = parseGroundingVerdicts('{"verdicts": [{"unitId":"u1"');
    expect(truncated.ok).toBe(false);
    if (!truncated.ok) expect(truncated.errors.join(' ')).toMatch(/not valid JSON/iu);
    expect(parseGroundingVerdicts('{"verdicts":"not an array"}').ok).toBe(false);
    const malformed = parseGroundingVerdicts(JSON.stringify({ verdicts: Array.from({ length: 20 }, () => ({ unitId: '', verdict: 'no' })) }));
    expect(malformed.ok).toBe(true);
    if (malformed.ok) {
      expect(malformed.errors).toHaveLength(11);
      expect(malformed.errors.at(-1)).toMatch(/more errors omitted/iu);
    }
  });
});

describe('applyGroundingVerdicts', () => {
  it('clears unsupported fields while retaining original evidence and unchanged qualifications', () => {
    const original = unit();
    const result = applyGroundingVerdicts([original], [{ unitId: 'u1', verdict: 'rewrite', rationale: null, attribution: null }]);
    expect(result).toEqual({ kept: [{
      id: 'u1', kind: 'recommendation', text: original.text,
      conditions: [{ type: 'temporal', text: 'during startup' }],
      stance: 'recommended', importance: 'core', evidence: original.evidence,
    }], rejected: [], diagnostics: [] });
    expect(result.kept[0]?.evidence).toBe(original.evidence);
    expect(original.rationale).toBe('An unsupported explanation.');
    expect(original.attribution?.name).toBe('An unsupported identity');
  });

  it('rejects a metadata-only rewrite that removes both forms of required limitation support', () => {
    const original = unit({ kind: 'limitation', stance: 'asserted' });
    const result = applyGroundingVerdicts([original], [{ unitId: 'u1', verdict: 'rewrite', rationale: null, conditions: [] }]);
    expect(result.kept).toEqual([]);
    expect(result.rejected).toEqual([{ unit: original, reason: 'ungrounded' }]);
    expect(result.diagnostics.join(' ')).toMatch(/limitation requires rationale or conditions/iu);
  });

  it('retains grounded units and ignores corrections attached to a grounded verdict', () => {
    const original = unit();
    expect(applyGroundingVerdicts([original], [{ unitId: 'u1', verdict: 'grounded', importance: 'incidental' }]))
      .toEqual({ kept: [original], rejected: [], diagnostics: [] });
  });

  it('keeps the first verdict and diagnoses unknown, duplicate and missing verdicts', () => {
    const first = unit();
    const missing = unit({ id: 'u2' });
    const result = applyGroundingVerdicts([first, missing], [
      { unitId: 'u1', verdict: 'ungrounded' },
      { unitId: 'u1', verdict: 'grounded' },
      { unitId: 'ghost', verdict: 'ungrounded' },
    ]);
    expect(result.kept).toEqual([missing]);
    expect(result.rejected).toEqual([{ unit: first, reason: 'ungrounded' }]);
    expect(result.diagnostics).toEqual([
      'Duplicate grounding verdict for unit u1 ignored.',
      'ghost: unknown unit, verdict ignored.',
      'Unit u2 received no grounding verdict; kept (quote verification already passed).',
    ]);
  });

  it('retains a draft with a diagnostic when a rewrite has no corrections', () => {
    const original = unit();
    const result = applyGroundingVerdicts([original], [{ unitId: 'u1', verdict: 'rewrite' }]);
    expect(result.kept).toEqual([original]);
    expect(result.diagnostics.join(' ')).toMatch(/original untrusted draft retained/iu);
  });

  it('normalizes corrected optional fields through the host schema without changing evidence', () => {
    const original = unit();
    const result = applyGroundingVerdicts([original], [{ unitId: 'u1', verdict: 'rewrite',
      text: 'Check the red indicator during the startup sequence.',
      rationale: '  The source gives this reason.  ',
      attribution: { kind: 'third_party', role: '  equipment supplier  ' },
      importance: 'supporting', stance: 'reported',
    }]);
    expect(result.kept[0]).toEqual({ ...original,
      text: 'Check the red indicator during the startup sequence.',
      rationale: 'The source gives this reason.',
      attribution: { kind: 'third_party', role: 'equipment supplier' },
      importance: 'supporting', stance: 'reported',
    });
    expect(result.kept[0]?.evidence).toBe(original.evidence);
  });
});
