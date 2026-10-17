import { describe, expect, it } from 'vitest';
import { buildDistillationOutput } from '../../../src/extract/distill/report.js';
import type { DistillationOutputInput } from '../../../src/extract/distill/report.js';
import type { VerifiedUnit } from '../../../src/extract/distill/quote-verification.js';

const unit = (overrides: Partial<VerifiedUnit> = {}): VerifiedUnit => ({
  id: 'u1', kind: 'idea', text: 'The red indicator remains switched off during startup.',
  rationale: 'The test records the startup state.',
  conditions: [{ type: 'temporal', text: 'during startup' }],
  attribution: { kind: 'third_party', role: 'equipment supplier' },
  stance: 'reported', importance: 'core',
  evidence: [{ excerptId: 'ex1', quote: 'the red indicator stayed switched off', quoteVerification: 'exact' }],
  ...overrides,
});

const input = (overrides: Partial<DistillationOutputInput> = {}): DistillationOutputInput => ({
  extractionIntent: 'knowledge_graph', sourceType: 'explainer', sourcePurpose: 'Explain indicator behaviour.',
  sourceCoherence: 'single_topic', theses: ['The indicator records startup state.'], units: [unit()], rejectedUnits: [],
  coverage: { citedExcerptCount: 1, excerptsCitedPercent: 50, citedTextPercent: 60,
    largestUncitedGapSeconds: 10, coreUnitsWithoutVerifiedEvidence: 0, weakQuoteCount: 0 },
  diagnostics: [], model: 'synthetic-model', promptVersion: 'synthetic-prompt-v1',
  ...overrides,
});

describe('buildDistillationOutput', () => {
  it('emits qualified untrusted draft claims with literal evidence and model provenance', () => {
    const source = unit();
    expect(buildDistillationOutput(input({ units: [source] })).claims).toEqual([{
      text: source.text, excerptIds: ['ex1'], state: 'draft', type: 'insight', classification: 'insight',
      metadata: {
        method: 'llm-distill', model: 'synthetic-model', promptVersion: 'synthetic-prompt-v1',
        unitId: 'u1', unitKind: 'idea', stance: 'reported', importance: 'core', trusted: false,
        qualityStatus: 'reviewable', evidence: source.evidence, rationale: source.rationale,
        conditions: source.conditions, attribution: source.attribution,
      },
    }]);
  });

  it.each(['example', 'procedure'] as const)('preserves qualifications on supporting %s units', kind => {
    const source = unit({ kind, importance: 'supporting', supportsUnitIds: ['u2'] });
    const result = buildDistillationOutput(input({ units: [source, unit({ id: 'u2' })] }));
    expect(result.claims).toHaveLength(1);
    expect(result.rejectedClaims).toEqual([]);
    expect(result.supportingUnits).toEqual([{
      id: 'u1', kind, text: source.text, supportsUnitIds: ['u2'], excerptIds: ['ex1'],
      evidence: source.evidence, stance: 'reported', importance: 'supporting',
      rationale: source.rationale, conditions: source.conditions, attribution: source.attribution,
    }]);
  });

  it('routes runbook procedures to draft instruction claims', () => {
    const result = buildDistillationOutput(input({ extractionIntent: 'runbook', units: [unit({ kind: 'procedure' })] }));
    expect(result.supportingUnits).toEqual([]);
    expect(result.claims[0]?.type).toBe('instruction');
    expect(result.claims[0]?.metadata?.['trusted']).toBe(false);
  });

  it.each(['ungrounded', 'failed_quote_verification'] as const)('archives rejected evidence with its %s reason', reason => {
    const rejected = unit({ kind: 'example' });
    const result = buildDistillationOutput(input({ units: [], rejectedUnits: [{ unit: rejected, reason }] }));
    expect(result.claims).toEqual([]);
    expect(result.supportingUnits).toEqual([]);
    expect(result.rejectedClaims).toEqual([{
      text: rejected.text, excerptIds: ['ex1'], state: 'draft', type: 'example', classification: 'example',
      metadata: {
        method: 'llm-distill', model: 'synthetic-model', promptVersion: 'synthetic-prompt-v1',
        unitId: 'u1', unitKind: 'example', stance: 'reported', importance: 'core',
        trusted: false, qualityStatus: 'rejected', rejectionReason: reason,
        evidence: rejected.evidence, rationale: rejected.rationale,
        conditions: rejected.conditions, attribution: rejected.attribution,
      },
    }]);
  });

  it('keeps diagnostics and source fields while counting retained units independently of routing', () => {
    const original = input({
      units: [unit(), unit({ id: 'u2', kind: 'fact', importance: 'incidental' })],
      rejectedUnits: [{ unit: unit({ id: 'u3', kind: 'limitation' }), reason: 'ungrounded' }],
      diagnostics: ['A prior review warning.'],
    });
    const result = buildDistillationOutput(original);
    expect(result.distillation).toEqual({
      sourceType: 'explainer', sourcePurpose: 'Explain indicator behaviour.', sourceCoherence: 'single_topic',
      theses: ['The indicator records startup state.'], coverage: original.coverage,
      unitCountsByKind: { idea: 1, fact: 1 },
      diagnostics: ['A prior review warning.', 'Unit u2 (fact, incidental) projected to diagnostic.'],
    });
    expect(original.diagnostics).toEqual(['A prior review warning.']);
    expect(result.claims).toHaveLength(1);
  });

  it('deduplicates excerpt identities without discarding evidence or support links', () => {
    const original = unit({ supportsUnitIds: ['u2'], evidence: [
      { excerptId: 'ex1', quote: 'the red indicator stayed switched off', quoteVerification: 'exact' },
      { excerptId: 'ex1', quote: 'several independent checks recorded the same condition', quoteVerification: 'normalized' },
    ] });
    const result = buildDistillationOutput(input({ units: [original, unit({ id: 'u2' })] }));
    expect(result.claims[0]?.excerptIds).toEqual(['ex1']);
    expect(result.claims[0]?.metadata?.['evidence']).toEqual(original.evidence);
    expect(result.claims[0]?.metadata?.['supportsUnitIds']).toEqual(['u2']);
  });

  it('represents absent source context diagnostically without manufacturing units', () => {
    const result = buildDistillationOutput(input({ units: [], theses: [], sourcePurpose: undefined }));
    expect(result.claims).toEqual([]);
    expect(result.supportingUnits).toEqual([]);
    expect(result.distillation.unitCountsByKind).toEqual({});
    expect(result.distillation).not.toHaveProperty('sourcePurpose');
    expect(result.distillation.diagnostics).toEqual([
      'Distillation produced no thesis; review whether the source genuinely lacks one.',
      'Distillation produced no sourcePurpose.',
    ]);
  });
});

it('separates unresolved proposed links from live relationships to emitted units', () => {
  const rejected = unit({ id: 'rejected' });
  const supporting = unit({ id: 'example', kind: 'example', importance: 'supporting', supportsUnitIds: ['rejected', 'incidental', 'retained'] });
  const output = buildDistillationOutput(input({ units: [supporting, unit({ id: 'incidental', importance: 'incidental' }), unit({ id: 'retained' })],
    rejectedUnits: [{ unit: rejected, reason: 'ungrounded' }] }));
  expect(output.supportingUnits[0]?.supportsUnitIds).toEqual(['retained']);
  expect(output.supportingUnits[0]?.unresolvedSupportsUnitIds).toEqual(['rejected', 'incidental']);
  expect(output.rejectedClaims[0]?.metadata?.['unitId']).toBe('rejected');
  expect(output.distillation.diagnostics.join(' ')).toMatch(/example.*rejected.*incidental/u);
});
