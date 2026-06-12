import { describe, expect, it } from 'vitest';
import { buildDistillationOutput } from '../../../src/extract/distill/report.js';
import type { ConsolidatedUnit } from '../../../src/extract/distill/consolidation.js';

function unit(id: string, overrides: Partial<ConsolidatedUnit> = {}): ConsolidatedUnit {
  return {
    id,
    kind: 'idea',
    text: `Unit ${id}: a canonical standalone proposition long enough to be a claim.`,
    stance: 'asserted',
    importance: 'core',
    evidence: [{ excerptId: 'ex1', quote: 'a verbatim quote with enough words present', quoteVerification: 'exact' }],
    ...overrides,
  };
}

const baseInput = {
  extractionIntent: 'knowledge_graph' as const,
  sourceType: 'explainer' as const,
  sourceCoherence: 'single_topic' as const,
  theses: ['The central thesis of the source, stated canonically.'],
  model: 'gpt-5.4-mini',
  promptVersion: 'distill-v1',
  recordedRelations: [],
  rejectedUnits: [],
  coverage: {
    citedExcerptCount: 1, excerptsCitedPercent: 100, citedTextPercent: 100,
    largestUncitedGapSeconds: 0, coreUnitsWithoutVerifiedEvidence: 0, weakQuoteCount: 0,
  },
  diagnostics: [] as string[],
};

describe('buildDistillationOutput', () => {
  it('projects idea units to draft claims with trusted=false and provenance metadata', () => {
    const output = buildDistillationOutput({ ...baseInput, units: [unit('u1')] });
    expect(output.claims).toHaveLength(1);
    const claim = output.claims[0]!;
    expect(claim.state).toBe('draft');
    expect(claim.text).toContain('Unit u1');
    expect(claim.excerptIds).toEqual(['ex1']);
    expect(claim.metadata?.['trusted']).toBe(false);
    expect(claim.metadata?.['qualityStatus']).toBe('reviewable');
    expect(claim.metadata?.['unitKind']).toBe('idea');
    expect(claim.metadata?.['stance']).toBe('asserted');
    expect(claim.metadata?.['method']).toBe('llm-distill');
  });

  it('routes examples to supportingUnits, not claims or rejected', () => {
    const example = unit('u2', { kind: 'example', stance: 'demonstrated', importance: 'supporting', supportsUnitIds: ['u1'] });
    const output = buildDistillationOutput({ ...baseInput, units: [unit('u1'), example] });
    expect(output.claims).toHaveLength(1);
    expect(output.supportingUnits).toHaveLength(1);
    expect(output.supportingUnits[0]?.supportsUnitIds).toEqual(['u1']);
    expect(output.rejectedClaims).toHaveLength(0);
  });

  it('routes rejected units to rejectedClaims with the rejection reason', () => {
    const output = buildDistillationOutput({
      ...baseInput,
      units: [],
      rejectedUnits: [{ unit: unit('u3'), reason: 'ungrounded' }],
    });
    expect(output.rejectedClaims).toHaveLength(1);
    expect(output.rejectedClaims[0]?.metadata?.['qualityStatus']).toBe('rejected');
    expect(output.rejectedClaims[0]?.metadata?.['rejectionReason']).toBe('ungrounded');
  });

  it('exposes the distillation report with coverage, theses, and relations', () => {
    const output = buildDistillationOutput({ ...baseInput, units: [unit('u1')] });
    expect(output.distillation.theses).toHaveLength(1);
    expect(output.distillation.coverage.excerptsCitedPercent).toBe(100);
    expect(output.distillation.unitCountsByKind['idea']).toBe(1);
  });

  it('adds a diagnostic when theses are empty', () => {
    const output = buildDistillationOutput({ ...baseInput, theses: [], units: [unit('u1')] });
    expect(output.distillation.diagnostics.join(' ')).toMatch(/no thesis/i);
  });

  it('preserves named third-party attribution in claim metadata', () => {
    const attributed = unit('u4', {
      stance: 'reported',
      attribution: { kind: 'named_third_party', name: 'Karpathy' },
    });
    const output = buildDistillationOutput({ ...baseInput, units: [attributed] });
    expect(output.claims[0]?.metadata?.['attribution']).toEqual({ kind: 'named_third_party', name: 'Karpathy' });
  });
});
