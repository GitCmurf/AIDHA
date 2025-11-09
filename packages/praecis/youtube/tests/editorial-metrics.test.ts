import { describe, it, expect } from 'vitest';
import type { ClaimCandidate } from '../src/extract/types.js';
import {
  countBoilerplate,
  countFragments,
  timelineCoverage,
  dropCounts,
} from '../src/extract/editorial-metrics.js';
import { runEditorPassV1WithDiagnostics } from '../src/extract/editorial-ranking.js';

describe('editorial metrics', () => {
  it('counts fragments with default rules', () => {
    const candidates: ClaimCandidate[] = [
      { text: 'Too short', excerptIds: ['a'] },
      { text: 'Use stable IDs and avoid duplicate graph nodes and', excerptIds: ['b'] },
      {
        text: 'Deterministic IDs prevent duplicate nodes and keep ingestion idempotent.',
        excerptIds: ['c'],
      },
    ];

    expect(countFragments(candidates)).toBe(2);
  });

  it('counts boilerplate claims', () => {
    const candidates: ClaimCandidate[] = [
      { text: 'Welcome back and thanks for watching!', excerptIds: ['a'] },
      { text: 'Please like and subscribe for more.', excerptIds: ['b'] },
      { text: 'Use transcript evidence for each claim.', excerptIds: ['c'] },
    ];

    expect(countBoilerplate(candidates)).toBe(2);
  });

  it('computes timeline coverage by window', () => {
    const candidates: ClaimCandidate[] = [
      { text: 'A', excerptIds: ['a'], startSeconds: 0 },
      { text: 'B', excerptIds: ['b'], startSeconds: 120 },
      { text: 'C', excerptIds: ['c'], startSeconds: 360 },
    ];

    const coverage = timelineCoverage(candidates, 5);
    expect(coverage.windowsRepresented).toBe(2);
    expect(coverage.windowCounts).toEqual([
      { windowIndex: 0, count: 2 },
      { windowIndex: 1, count: 1 },
    ]);
  });

  it('returns dropped counts from diagnostics', () => {
    const result = runEditorPassV1WithDiagnostics(
      [
        {
          text: 'Like and subscribe for more.',
          excerptIds: ['e1'],
          startSeconds: 0,
          chunkIndex: 0,
          confidence: 0.9,
        },
        {
          text: 'Hash stable fields with SHA-256 to preserve deterministic IDs.',
          excerptIds: ['e2'],
          startSeconds: 60,
          chunkIndex: 0,
          confidence: 0.8,
        },
      ],
      { maxClaims: 10, chunkCount: 1 }
    );

    const counts = dropCounts(result.diagnostics);
    expect(counts.boilerplate).toBe(1);
    expect(counts.empty).toBe(0);
  });
});
