// SPDX-License-Identifier: Apache-2.0
// Copyright 2025-2026 Colin Farmer (GitCmurf)

import { describe, expect, it } from 'vitest';
import {
  parseGroundingVerdicts,
  applyGroundingVerdicts,
} from '../../../src/extract/distill/grounding.js';
import type { VerifiedUnit } from '../../../src/extract/distill/quote-verification.js';

function vUnit(id: string, overrides: Partial<VerifiedUnit> = {}): VerifiedUnit {
  return {
    id,
    kind: 'idea',
    text: 'A standalone canonical idea sentence that is long enough to be a claim.',
    stance: 'asserted',
    importance: 'core',
    evidence: [{ excerptId: 'ex1', quote: 'a supporting quote with enough words in it', quoteVerification: 'exact' }],
    ...overrides,
  };
}

describe('parseGroundingVerdicts', () => {
  it('parses a verdict array from a JSON response', () => {
    const raw = JSON.stringify({ verdicts: [{ unitId: 'u1', verdict: 'grounded' }] });
    const result = parseGroundingVerdicts(raw);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value[0]?.verdict).toBe('grounded');
  });

  it('rejects unknown verdict values', () => {
    const raw = JSON.stringify({ verdicts: [{ unitId: 'u1', verdict: 'maybe' }] });
    expect(parseGroundingVerdicts(raw).ok).toBe(false);
  });
});

describe('applyGroundingVerdicts', () => {
  it('keeps grounded units unchanged', () => {
    const result = applyGroundingVerdicts([vUnit('u1')], [{ unitId: 'u1', verdict: 'grounded' }]);
    expect(result.kept).toHaveLength(1);
    expect(result.rejected).toHaveLength(0);
  });

  it('applies rewrites to text and rationale', () => {
    const result = applyGroundingVerdicts(
      [vUnit('u1')],
      [{ unitId: 'u1', verdict: 'rewrite', text: 'A sharper canonical restatement of the same idea, still long enough.', rationale: 'Recovered reason from the cited excerpt.' }]
    );
    expect(result.kept[0]?.text).toBe('A sharper canonical restatement of the same idea, still long enough.');
    expect(result.kept[0]?.rationale).toBe('Recovered reason from the cited excerpt.');
  });

  it('moves ungrounded units to rejected with reason', () => {
    const result = applyGroundingVerdicts([vUnit('u1')], [{ unitId: 'u1', verdict: 'ungrounded' }]);
    expect(result.kept).toHaveLength(0);
    expect(result.rejected[0]?.unit.id).toBe('u1');
    expect(result.rejected[0]?.reason).toBe('ungrounded');
  });

  it('keeps units with no verdict and records a diagnostic', () => {
    const result = applyGroundingVerdicts([vUnit('u1'), vUnit('u2')], [{ unitId: 'u1', verdict: 'grounded' }]);
    expect(result.kept).toHaveLength(2);
    expect(result.diagnostics.join(' ')).toMatch(/u2.*no grounding verdict/i);
  });

  it('ignores verdicts for unknown unit ids with a diagnostic', () => {
    const result = applyGroundingVerdicts([vUnit('u1')], [
      { unitId: 'u1', verdict: 'grounded' },
      { unitId: 'u99', verdict: 'ungrounded' },
    ]);
    expect(result.kept).toHaveLength(1);
    expect(result.diagnostics.join(' ')).toMatch(/u99.*unknown/i);
  });

  it('treats rewrite without text as grounded with a diagnostic', () => {
    const result = applyGroundingVerdicts([vUnit('u1')], [{ unitId: 'u1', verdict: 'rewrite' }]);
    expect(result.kept).toHaveLength(1);
    expect(result.kept[0]?.text).toBe(vUnit('u1').text);
    expect(result.diagnostics.join(' ')).toMatch(/rewrite.*no text/i);
  });

  it('keeps the first verdict when duplicates arrive', () => {
    const result = applyGroundingVerdicts([vUnit('u1')], [
      { unitId: 'u1', verdict: 'ungrounded' },
      { unitId: 'u1', verdict: 'grounded' },
    ]);
    expect(result.kept).toHaveLength(0);
    expect(result.rejected).toHaveLength(1);
    expect(result.diagnostics.join(' ')).toMatch(/duplicate.*u1/i);
  });
});
