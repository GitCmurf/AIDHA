// SPDX-License-Identifier: Apache-2.0
// Copyright 2025-2026 Colin Farmer (GitCmurf)

import { describe, expect, it } from 'vitest';
import {
  parseConsolidationRelations,
  applyConsolidation,
} from '../../../src/extract/distill/consolidation.js';
import type { VerifiedUnit } from '../../../src/extract/distill/quote-verification.js';

function vUnit(id: string, overrides: Partial<VerifiedUnit> = {}): VerifiedUnit {
  return {
    id,
    kind: 'recommendation',
    text: `Recommendation ${id}: prefer traditional RAG with current models for production retrieval.`,
    rationale: 'Current models handle retrieval better with established RAG infrastructure.',
    stance: 'recommended',
    importance: 'core',
    evidence: [{ excerptId: `ex-${id}`, quote: 'a supporting quote with enough words in it', quoteVerification: 'exact' }],
    ...overrides,
  };
}

describe('parseConsolidationRelations', () => {
  it('parses relations from JSON', () => {
    const raw = JSON.stringify({ relations: [{ type: 'merged_duplicate', sourceUnitId: 'u2', targetUnitId: 'u1' }] });
    const result = parseConsolidationRelations(raw);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value[0]?.type).toBe('merged_duplicate');
  });
});

describe('applyConsolidation', () => {
  it('merges duplicates: evidence unions, source removed, provenance recorded', () => {
    const result = applyConsolidation(
      [vUnit('u1'), vUnit('u2')],
      [{ type: 'merged_duplicate', sourceUnitId: 'u2', targetUnitId: 'u1' }]
    );
    expect(result.units).toHaveLength(1);
    const merged = result.units[0]!;
    expect(merged.id).toBe('u1');
    expect(merged.evidence.map(ref => ref.excerptId).sort()).toEqual(['ex-u1', 'ex-u2']);
    expect(merged.mergedFromUnitIds).toEqual(['u2']);
  });

  it('wires supports/example_of into supportsUnitIds on the source unit', () => {
    const example = vUnit('u2', { kind: 'example', stance: 'demonstrated', importance: 'supporting' });
    const result = applyConsolidation(
      [vUnit('u1'), example],
      [{ type: 'example_of', sourceUnitId: 'u2', targetUnitId: 'u1' }]
    );
    const updated = result.units.find(unit => unit.id === 'u2');
    expect(updated?.supportsUnitIds).toContain('u1');
  });

  it('folds limits into the target unit conditions', () => {
    const limitation = vUnit('u2', {
      kind: 'limitation',
      text: 'This recommendation is time-bounded to current model capabilities.',
      conditions: [{ type: 'temporal', text: 'as of mid-2026 model capabilities' }],
    });
    const result = applyConsolidation(
      [vUnit('u1'), limitation],
      [{ type: 'limits', sourceUnitId: 'u2', targetUnitId: 'u1' }]
    );
    const target = result.units.find(unit => unit.id === 'u1');
    expect(target?.conditions?.some(condition => condition.text.includes('time-bounded'))).toBe(true);
    // The limitation unit itself remains a unit (standalone limitation claims are valid).
    expect(result.units.find(unit => unit.id === 'u2')).toBeDefined();
  });

  it('records refines/contrasts without modifying units', () => {
    const before = [vUnit('u1'), vUnit('u2')];
    const result = applyConsolidation(before, [{ type: 'contrasts', sourceUnitId: 'u2', targetUnitId: 'u1' }]);
    expect(result.units).toEqual(before);
    expect(result.recordedRelations).toEqual([{ type: 'contrasts', sourceUnitId: 'u2', targetUnitId: 'u1' }]);
  });

  it('ignores relations with unknown unit ids, with a diagnostic', () => {
    const result = applyConsolidation([vUnit('u1')], [{ type: 'merged_duplicate', sourceUnitId: 'u9', targetUnitId: 'u1' }]);
    expect(result.units).toHaveLength(1);
    expect(result.diagnostics.join(' ')).toMatch(/u9/);
  });

  it('applies chain merges order-independently with transitive provenance', () => {
    const units = [vUnit('u1'), vUnit('u2'), vUnit('u3')];
    const orderA = applyConsolidation(units, [
      { type: 'merged_duplicate', sourceUnitId: 'u3', targetUnitId: 'u2' },
      { type: 'merged_duplicate', sourceUnitId: 'u2', targetUnitId: 'u1' },
    ]);
    const orderB = applyConsolidation(units, [
      { type: 'merged_duplicate', sourceUnitId: 'u2', targetUnitId: 'u1' },
      { type: 'merged_duplicate', sourceUnitId: 'u3', targetUnitId: 'u2' },
    ]);
    for (const result of [orderA, orderB]) {
      expect(result.units).toHaveLength(1);
      expect(result.units[0]?.id).toBe('u1');
      expect([...(result.units[0]?.mergedFromUnitIds ?? [])].sort()).toEqual(['u2', 'u3']);
      expect(result.units[0]?.evidence.map(ref => ref.excerptId).sort()).toEqual(['ex-u1', 'ex-u2', 'ex-u3']);
    }
  });

  it('survives cyclic merge instructions with a diagnostic', () => {
    const result = applyConsolidation([vUnit('u1'), vUnit('u2')], [
      { type: 'merged_duplicate', sourceUnitId: 'u2', targetUnitId: 'u1' },
      { type: 'merged_duplicate', sourceUnitId: 'u1', targetUnitId: 'u2' },
    ]);
    expect(result.units).toHaveLength(1);
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });

  it('remaps supportsUnitIds that referenced merged-away units', () => {
    const example = vUnit('u3', { kind: 'example', importance: 'supporting', supportsUnitIds: ['u2'] });
    const result = applyConsolidation([vUnit('u1'), vUnit('u2'), example], [
      { type: 'merged_duplicate', sourceUnitId: 'u2', targetUnitId: 'u1' },
    ]);
    expect(result.units.find(unit => unit.id === 'u3')?.supportsUnitIds).toEqual(['u1']);
  });

  it('remaps relation endpoints through merges', () => {
    const example = vUnit('u3', { kind: 'example', importance: 'supporting' });
    const result = applyConsolidation([vUnit('u1'), vUnit('u2'), example], [
      { type: 'merged_duplicate', sourceUnitId: 'u2', targetUnitId: 'u1' },
      { type: 'example_of', sourceUnitId: 'u3', targetUnitId: 'u2' },
    ]);
    expect(result.units.find(unit => unit.id === 'u3')?.supportsUnitIds).toContain('u1');
    expect(result.recordedRelations).toContainEqual({ type: 'example_of', sourceUnitId: 'u3', targetUnitId: 'u1' });
  });

  it('rejects unknown relation types with a readable error', () => {
    const raw = JSON.stringify({ relations: [{ type: 'banana', sourceUnitId: 'u1', targetUnitId: 'u2' }] });
    const result = parseConsolidationRelations(raw);
    expect(result.ok).toBe(false);
  });
});
