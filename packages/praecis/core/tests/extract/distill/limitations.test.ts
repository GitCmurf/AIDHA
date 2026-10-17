import { describe, expect, it } from 'vitest';
import { buildLimitationPrompt, parseLimitationRelations, applyLimitationRelations } from '../../../src/extract/distill/limitations.js';
import type { VerifiedUnit } from '../../../src/extract/distill/quote-verification.js';

const passages = new Map([
  ['a', 'In Trial A, the filter removed eighty percent of particles during the first measured hour. The maintenance team logged the reading on the original assembly and checked the sensor twice before closing the run.'],
  ['b', 'In Trial B, the filter removed eighty percent of particles during the first measured hour. A different assembly was used for this run, and the technicians checked the sensor twice before closing the trial.'],
  ['later', 'The maintenance team stated that the clogging limitation applies only to Trial A and not to Trial B because the original assembly was used there. Dr Vale repeated the team finding in a meeting but did not originate or test the limitation.'],
]);
const units: VerifiedUnit[] = [
  { id: 'a', kind: 'fact', text: 'Trial A filter removal was measured at eighty percent in the first hour.', stance: 'asserted', importance: 'core',
    evidence: [{ excerptId: 'a', quote: 'Trial A, the filter removed eighty percent of particles', quoteVerification: 'exact' }] },
  { id: 'b', kind: 'fact', text: 'Trial B filter removal was measured at eighty percent in the first hour.', stance: 'asserted', importance: 'core',
    evidence: [{ excerptId: 'b', quote: 'Trial B, the filter removed eighty percent of particles', quoteVerification: 'exact' }] },
  { id: 'limit', kind: 'limitation', text: 'The maintenance team identified clogging of the original filter assembly.', stance: 'reported', importance: 'core',
    rationale: 'The original assembly was used in Trial A.', conditions: [{ type: 'scale', text: 'original assembly' }],
    attribution: { kind: 'third_party', role: 'maintenance team' },
    evidence: [{ excerptId: 'later', quote: 'maintenance team stated that the clogging limitation applies only to Trial A', quoteVerification: 'exact' }] },
];
const relation = (targetUnitId: string, targetScope: string, quote = 'the clogging limitation applies only to Trial A and not to Trial B') => ({
  limitationUnitId: 'limit', targetUnitId, verdict: 'grounded',
  relationEvidence: { excerptId: 'later', quote },
  targetScope: { kind: 'trial', text: targetScope }, explanation: 'The later correction explicitly names the affected trial.',
});

describe('source-backed limitation applicability', () => {
  it('shows both units, their own evidence, and the later source correction once in the prompt', () => {
    const prompt = buildLimitationPrompt(units, passages);
    expect(prompt.user).toContain('Trial A, the filter removed eighty percent');
    expect(prompt.user).toContain('Trial B, the filter removed eighty percent');
    expect(prompt.user).toContain('maintenance team stated that the clogging limitation');
    expect(prompt.user.match(/Dr Vale repeated the team finding/g)).toHaveLength(1);
    expect(prompt.user).toContain('not to Trial B');
  });

  it('attaches only a target-specific exact relation, preserving the limitation and its own evidence', () => {
    const parsed = parseLimitationRelations(JSON.stringify({ relations: [relation('a', 'Trial A'),
      { ...relation('b', 'Trial B'), verdict: 'unsupported' }] }));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const applied = applyLimitationRelations(units, parsed.value, passages, new Set(['a', 'b', 'limit']), 'knowledge_graph', 'other');
    expect(applied.byTarget.get('a')).toMatchObject([{ id: 'limit', text: units[2].text,
      attribution: { kind: 'third_party', role: 'maintenance team' },
      evidence: [{ excerptId: 'later', quoteVerification: 'exact' }],
      applicability: { trusted: false, targetScope: { kind: 'trial', text: 'Trial A' },
        relationEvidence: { excerptId: 'later', quoteVerification: 'exact' } } }]);
    expect(applied.byTarget.has('b')).toBe(false);
    expect(applied.diagnostics.some(message => message.includes('b'))).toBe(true);
  });

  it('accepts an affirmative paraphrase with a literal target anchor', () => {
    const correction = 'The maintenance team found Trial A clogging confined the measured result to its original assembly; Trial B used a different assembly. This correction was recorded after both runs had ended, and the original observations were retained in the source archive for later review.';
    const source = new Map([...passages, ['paraphrase', correction]]);
    const proposal = { ...relation('a', 'Trial A', 'Trial A clogging confined the measured result to its original assembly'),
      relationEvidence: { excerptId: 'paraphrase', quote: 'Trial A clogging confined the measured result to its original assembly' } };
    const result = applyLimitationRelations(units, [proposal], source,
      new Set(['a', 'b', 'limit']), 'knowledge_graph', 'other');
    expect(result.byTarget.get('a')).toHaveLength(1);
  });

  it('does not mistake a target name for a prefix of another name', () => {
    const source = new Map([...passages, ['prefix', 'The maintenance team said the clogging limitation affected Trial AB during the later run. Technicians separately documented the assembly and kept all measurements for independent review after the experiment ended.']]);
    const proposal = { ...relation('a', 'Trial A'), relationEvidence: {
      excerptId: 'prefix', quote: 'the clogging limitation affected Trial AB during the later run' } };
    const result = applyLimitationRelations(units, [proposal], source,
      new Set(['a', 'b', 'limit']), 'knowledge_graph', 'other');
    expect(result.byTarget.size).toBe(0);
  });

  it('treats a numeric continuation as part of the same target identifier', () => {
    const later = 'The maintenance team reported that clogging affected Trial 1.5 after the original assembly was used. Their later note was retained alongside the sensor readings and the separate Trial 1 record for review.';
    const own = 'Trial 1 used a revised assembly and removed eighty percent of particles during the measured hour. The operators checked the recorded sensor readings before closing this separate run.';
    const source = new Map([...passages, ['numeric-later', later], ['numeric-own', own]]);
    const target: VerifiedUnit = { ...units[0], evidence: [{ excerptId: 'numeric-own',
      quote: 'Trial 1 used a revised assembly and removed eighty percent of particles', quoteVerification: 'exact' }] };
    const proposal = { ...relation('a', 'Trial 1'), relationEvidence: { excerptId: 'numeric-later',
      quote: 'clogging affected Trial 1.5 after the original assembly was used' } };
    const result = applyLimitationRelations([target, units[2]], [proposal], source,
      new Set(['a', 'limit']), 'knowledge_graph', 'other');
    expect(result.byTarget.size).toBe(0);
    expect(result.diagnostics).toEqual([expect.stringContaining('relation quote lacks the literal target anchor')]);

    const qualifiedTarget: VerifiedUnit = { ...target, evidence: [{ excerptId: 'numeric-later',
      quote: 'clogging affected Trial 1.5 after the original assembly was used', quoteVerification: 'exact' }] };
    const qualified = applyLimitationRelations([qualifiedTarget, units[2]],
      [{ ...proposal, targetScope: { kind: 'trial', text: 'Trial 1.5' } }], source,
      new Set(['a', 'limit']), 'knowledge_graph', 'other');
    expect(qualified.byTarget.get('a')).toHaveLength(1);

    const punctuation = new Map([...source, ['punctuation',
      'The maintenance team reported clogging in Trial 1, after the original assembly was used. Their later note and the sensor readings were retained with the record for independent review.']]);
    const punctuated = applyLimitationRelations([target, units[2]], [{ ...proposal,
      relationEvidence: { excerptId: 'punctuation', quote: 'reported clogging in Trial 1, after the original assembly was used' } }],
    punctuation, new Set(['a', 'limit']), 'knowledge_graph', 'other');
    expect(punctuated.byTarget.get('a')).toHaveLength(1);
  });

  it('does not attach a signed or Unicode-prefixed target label to an unsigned or shorter one', () => {
    const cases = [
      { targetScope: '12345', sourceLabel: '+12345' },
      { targetScope: 'Trial 1', sourceLabel: '𐌰Trial 1' },
    ];
    for (const { targetScope, sourceLabel } of cases) {
      const own = `${targetScope} used the revised assembly during the measured run. The operators checked the sensor readings, recorded the result and retained the separate log for review.`;
      const later = `The maintenance team reported that clogging affected ${sourceLabel} after the original assembly was used. Their later note and the sensor readings were retained with the record for independent review.`;
      const source = new Map([...passages, ['target-own', own], ['target-later', later]]);
      const target: VerifiedUnit = { ...units[0], evidence: [{ excerptId: 'target-own',
        quote: `${targetScope} used the revised assembly during the measured run`, quoteVerification: 'exact' }] };
      const proposal = { ...relation('a', targetScope), relationEvidence: { excerptId: 'target-later',
        quote: `clogging affected ${sourceLabel} after the original assembly was used` } };
      const result = applyLimitationRelations([target, units[2]], [proposal], source,
        new Set(['a', 'limit']), 'knowledge_graph', 'other');
      expect(result.byTarget.size).toBe(0);
      expect(result.diagnostics).toEqual([expect.stringContaining('relation quote lacks the literal target anchor')]);
    }
  });

  it('abstains on conflicting proposals for the same endpoints', () => {
    const result = applyLimitationRelations(units,
      [relation('a', 'Trial A'), { ...relation('a', 'Trial A'), verdict: 'unsupported' }],
      passages, new Set(['a', 'b', 'limit']), 'knowledge_graph', 'other');
    expect(result.byTarget.size).toBe(0);
  });

  it('rejects a limitation as the target of another limitation', () => {
    const secondLimitation: VerifiedUnit = { ...units[2], id: 'limit2', text: 'A separate assembly warning was reported.' };
    const result = applyLimitationRelations([units[2], secondLimitation],
      [relation('limit2', 'Trial A')], passages, new Set(['limit', 'limit2']), 'knowledge_graph', 'other');
    expect(result.byTarget.size).toBe(0);
    expect(result.diagnostics).toEqual([expect.stringContaining('ineligible endpoint kind')]);
  });

  it('requires a whole origin role anchor while retaining an exact unnamed role', () => {
    const sourceText = 'A teammate recorded that the clogging limitation applies only to Trial A in the original assembly. The observation was entered after the first run and preserved with the sensor readings for independent review.';
    const source = new Map([...passages, ['role', sourceText]]);
    const roleUnit: VerifiedUnit = { ...units[2],
      attribution: { kind: 'third_party', role: 'team' },
      evidence: [{ excerptId: 'role', quote: 'A teammate recorded that the clogging limitation', quoteVerification: 'exact' }] };
    const proposal = { ...relation('a', 'Trial A'), relationEvidence: {
      excerptId: 'role', quote: 'the clogging limitation applies only to Trial A' } };
    const wrongOrigin = applyLimitationRelations([units[0], roleUnit], [proposal], source,
      new Set(['a', 'limit']), 'knowledge_graph', 'other');
    expect(wrongOrigin.byTarget.size).toBe(0);
    expect(wrongOrigin.diagnostics).toEqual([expect.stringContaining('limitation origin absent')]);
    const exactRole = applyLimitationRelations([units[0],
      { ...roleUnit, attribution: { kind: 'third_party', role: 'teammate' } }], [proposal], source,
      new Set(['a', 'limit']), 'knowledge_graph', 'other');
    expect(exactRole.byTarget.get('a')).toHaveLength(1);
  });

  it('rejects nonliteral, generic, ambiguous, wrong-kind, and ungrounded links without dropping units', () => {
    const cases = [
      { proposal: relation('a', 'Trial A', 'the invented words were never in this excerpt'), reason: 'nonliteral relation evidence' },
      { proposal: relation('a', 'Trial A', 'the original assembly was used there'), reason: 'lacks the literal target anchor' },
      { proposal: { ...relation('a', 'Trial A'), verdict: 'unsupported' as const }, reason: 'not affirmatively grounded' },
      { proposal: relation('b', 'Trial B', 'the clogging limitation applies only to Trial A'), reason: 'lacks the literal target anchor' },
      { proposal: { ...relation('b', 'Trial B'), limitationUnitId: 'a' }, reason: 'ineligible endpoint kind' },
    ];
    for (const { proposal, reason } of cases) {
      const result = applyLimitationRelations(units, [proposal], passages,
        new Set(['a', 'b', 'limit']), 'knowledge_graph', 'other');
      expect(result.byTarget.size).toBe(0);
      expect(result.diagnostics).toEqual([expect.stringContaining(reason)]);
    }
    const noGrounding = applyLimitationRelations(units, [relation('a', 'Trial A')], passages,
      new Set(['a']), 'knowledge_graph', 'other');
    expect(noGrounding.byTarget.size).toBe(0);
    expect(noGrounding.diagnostics).toEqual([expect.stringContaining('endpoint lacks affirmative grounding')]);
    const anotherClaim: VerifiedUnit = { ...units[1], id: 'c',
      evidence: [{ excerptId: 'a', quote: 'Trial A, the filter removed eighty percent of particles', quoteVerification: 'exact' }] };
    const ambiguous = applyLimitationRelations([...units, anotherClaim], [relation('a', 'Trial A')], passages,
      new Set(['a', 'b', 'c', 'limit']), 'knowledge_graph', 'other');
    expect(ambiguous.byTarget.size).toBe(0);
    expect(ambiguous.diagnostics).toEqual([expect.stringContaining('also names another claim')]);
  });
});
