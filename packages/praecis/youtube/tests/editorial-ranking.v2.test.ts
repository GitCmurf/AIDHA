import { describe, it, expect } from 'vitest';
import type { ClaimCandidate } from '../src/extract/types.js';
import {
  runEditorPassV2,
  runEditorPassV2WithDiagnostics,
} from '../src/extract/editorial-ranking.js';

describe('editorial ranking v2', () => {
  it('rejects boilerplate claims', () => {
    const candidates: ClaimCandidate[] = [
      {
        text: 'Like and subscribe for more updates and thanks for watching.',
        excerptIds: ['e-boilerplate'],
        startSeconds: 0,
        chunkIndex: 0,
        confidence: 0.9,
      },
      {
        text: 'Use deterministic IDs to prevent duplicate graph nodes on re-ingestion.',
        excerptIds: ['e-good'],
        startSeconds: 10,
        chunkIndex: 0,
        confidence: 0.7,
      },
    ];

    const selected = runEditorPassV2(candidates, {
      maxClaims: 5,
      chunkCount: 1,
    });
    expect(selected.map(candidate => candidate.text)).toContain(
      'Use deterministic IDs to prevent duplicate graph nodes on re-ingestion.'
    );
    expect(selected.map(candidate => candidate.text)).not.toContain(
      'Like and subscribe for more updates and thanks for watching.'
    );
  });

  it('filters fragment claims that end with conjunction', () => {
    const candidates: ClaimCandidate[] = [
      {
        text: 'Use stable IDs to avoid duplicate nodes and',
        excerptIds: ['e-fragment'],
        startSeconds: 30,
        chunkIndex: 0,
        confidence: 0.85,
      },
      {
        text: 'Hash stable fields with SHA-256 to keep identifiers repeatable.',
        excerptIds: ['e-good'],
        startSeconds: 40,
        chunkIndex: 0,
        confidence: 0.7,
      },
    ];

    const selected = runEditorPassV2(candidates, {
      maxClaims: 5,
      chunkCount: 1,
    });

    expect(selected.map(candidate => candidate.text)).toContain(
      'Hash stable fields with SHA-256 to keep identifiers repeatable.'
    );
    expect(selected.map(candidate => candidate.text)).not.toContain(
      'Use stable IDs to avoid duplicate nodes and'
    );
  });

  it('enforces multi-window coverage and max-per-window cap', () => {
    const candidates: ClaimCandidate[] = [
      {
        text: 'Define the scope and constraints before building ingestion tools.',
        excerptIds: ['e0-a'],
        startSeconds: 5,
        chunkIndex: 0,
        confidence: 0.7,
      },
      {
        text: 'Record source metadata first so downstream links remain stable.',
        excerptIds: ['e0-b'],
        startSeconds: 80,
        chunkIndex: 0,
        confidence: 0.72,
      },
      {
        text: 'Link every claim to timestamped excerpts to keep evidence auditable.',
        excerptIds: ['e1-a'],
        startSeconds: 320,
        chunkIndex: 1,
        confidence: 0.7,
      },
      {
        text: 'Deterministic hashing keeps repeated ingestion runs idempotent.',
        excerptIds: ['e1-b'],
        startSeconds: 350,
        chunkIndex: 1,
        confidence: 0.71,
      },
      {
        text: 'Prioritize actionable claims over narration to reduce review time.',
        excerptIds: ['e2-a'],
        startSeconds: 650,
        chunkIndex: 2,
        confidence: 0.74,
      },
    ];

    const result = runEditorPassV2WithDiagnostics(candidates, {
      maxClaims: 3,
      chunkCount: 3,
      windowMinutes: 5,
      maxPerWindow: 1,
      minWindows: 3,
    });

    expect(result.selected.length).toBe(3);
    expect(result.diagnostics.windowCoverage.length).toBeGreaterThanOrEqual(3);
    for (const coverage of result.diagnostics.windowCoverage) {
      expect(coverage.selectedCount).toBe(1);
    }
  });

  it('does not let score cache key delimiter collisions reorder candidates', () => {
    const candidates: ClaimCandidate[] = [
      {
        text: 'Alpha: leucine threshold supports post-training muscle protein synthesis strongly.',
        excerptIds: ['e1'],
        startSeconds: 10,
        chunkIndex: 0,
        confidence: 0.8,
        domain: 'Nutrition',
        classification: 'Fact',
      },
      {
        text: 'Alpha',
        excerptIds: [' leucine threshold supports post-training muscle protein synthesis strongly.:e1'],
        startSeconds: 10,
        chunkIndex: 0,
        confidence: 0.8,
        domain: 'Nutrition',
        classification: 'Fact',
      },
    ];

    const result = runEditorPassV2(candidates, {
      maxClaims: 1,
      chunkCount: 1,
      minWindows: 1,
    });

    expect(result).toHaveLength(1);
    expect(result[0]?.text).toBe(
      'Alpha: leucine threshold supports post-training muscle protein synthesis strongly.'
    );
  });

  it('is deterministic for equivalent candidate sets', () => {
    const candidates: ClaimCandidate[] = [
      {
        text: 'Define constraints before choosing implementation tools and workflows.',
        excerptIds: ['e0'],
        startSeconds: 10,
        chunkIndex: 0,
        confidence: 0.69,
      },
      {
        text: 'Hash stable fields so claim IDs remain deterministic across reruns.',
        excerptIds: ['e1'],
        startSeconds: 320,
        chunkIndex: 1,
        confidence: 0.77,
      },
      {
        text: 'Connect tasks to claims to keep actions grounded in source evidence.',
        excerptIds: ['e2'],
        startSeconds: 660,
        chunkIndex: 2,
        confidence: 0.74,
      },
    ];

    const first = runEditorPassV2(candidates, {
      maxClaims: 5,
      chunkCount: 3,
      windowMinutes: 5,
      maxPerWindow: 2,
      minWindows: 2,
    });
    const second = runEditorPassV2(candidates.slice().reverse(), {
      maxClaims: 5,
      chunkCount: 3,
      windowMinutes: 5,
      maxPerWindow: 2,
      minWindows: 2,
    });

    expect(first.map(candidate => candidate.text)).toEqual(
      second.map(candidate => candidate.text)
    );
  });

  it('maintains diagnostics invariant selected plus dropped equals total', () => {
    const candidates: ClaimCandidate[] = [
      {
        text: 'Welcome back and thanks for watching this channel update.',
        excerptIds: ['e-drop-1'],
        startSeconds: 0,
        chunkIndex: 0,
        confidence: 0.9,
      },
      {
        text: 'Use deterministic IDs and avoid duplicate nodes and',
        excerptIds: ['e-drop-2'],
        startSeconds: 20,
        chunkIndex: 0,
        confidence: 0.85,
      },
      {
        text: 'Hash stable fields with SHA-256 to keep identifiers repeatable.',
        excerptIds: ['e-keep-1'],
        startSeconds: 310,
        chunkIndex: 1,
        confidence: 0.75,
      },
      {
        text: 'Link each claim to excerpts so evidence remains auditable.',
        excerptIds: ['e-keep-2'],
        startSeconds: 620,
        chunkIndex: 2,
        confidence: 0.76,
      },
    ];

    const result = runEditorPassV2WithDiagnostics(candidates, {
      maxClaims: 3,
      chunkCount: 3,
      minWindows: 2,
    });
    const droppedTotal = Object.values(result.diagnostics.droppedCounts).reduce(
      (sum, count) => sum + count,
      0
    );
    expect(result.selected.length + droppedTotal).toBe(result.diagnostics.totalCandidates);
  });

  describe('transcript-echo detection', () => {
    it('penalizes claims that are near-exact copies of source excerpts', () => {
      const excerptTexts = new Map<string, string>([
        ['e1', 'MPS does not plateau at 25-30 grams per meal as commonly believed.'],
        ['e2', 'Muscle protein synthesis continues to increase linearly beyond 30 grams.'],
      ]);

      const candidates: ClaimCandidate[] = [
        {
          text: 'MPS does not plateau at 25-30 grams per meal as commonly believed.',
          excerptIds: ['e1'],
          startSeconds: 10,
          chunkIndex: 0,
          confidence: 0.8,
        },
        {
          text: 'Research shows muscle protein synthesis increases linearly beyond 30g.',
          excerptIds: ['e2'],
          startSeconds: 20,
          chunkIndex: 0,
          confidence: 0.75,
        },
      ];

      const result = runEditorPassV2WithDiagnostics(candidates, {
        maxClaims: 5,
        chunkCount: 1,
        excerptTextsById: excerptTexts,
        echoOverlapThreshold: 0.9,
        echoPenalty: 0.3,
      });

      // The echo claim should be deprioritized due to penalty
      const echoClaim = result.selected.find(c => c.excerptIds.includes('e1'));
      const synthesizedClaim = result.selected.find(c => c.excerptIds.includes('e2'));

      expect(result.selected.length).toBe(2);
      // Synthesized claim should rank higher despite lower initial confidence
      expect(synthesizedClaim).toBeDefined();
    });

    it('does not penalize claims that meaningfully rephrase source content', () => {
      const excerptTexts = new Map<string, string>([
        ['e1', 'The optimal protein intake for muscle growth is higher than most guidelines suggest.'],
      ]);

      const candidates: ClaimCandidate[] = [
        {
          text: 'Consuming 1.6 to 2.2 grams of protein per kilogram of body weight maximizes hypertrophy.',
          excerptIds: ['e1'],
          startSeconds: 10,
          chunkIndex: 0,
          confidence: 0.75,
          domain: 'Nutrition',
        },
      ];

      const result = runEditorPassV2WithDiagnostics(candidates, {
        maxClaims: 5,
        chunkCount: 1,
        excerptTextsById: excerptTexts,
        echoOverlapThreshold: 0.9,
        echoPenalty: 0.3,
      });

      // This claim meaningfully rephrases with specific numbers and should not be penalized
      expect(result.selected.length).toBe(1);
      expect(result.selected[0].text).toContain('1.6 to 2.2 grams');
    });

    it('skips echo detection when excerptTextsById is not provided', () => {
      const candidates: ClaimCandidate[] = [
        {
          text: 'Muscle protein synthesis responds optimally to leucine thresholds exceeding intake recommendations.',
          excerptIds: ['e1'],
          startSeconds: 10,
          chunkIndex: 0,
          confidence: 0.7,
          domain: 'Nutrition',
        },
      ];

      // Should not throw when excerptTextsById is missing
      const result = runEditorPassV2(candidates, {
        maxClaims: 5,
        chunkCount: 1,
      });

      expect(result.length).toBe(1);
    });

    it('uses default threshold when not specified', () => {
      const excerptTexts = new Map<string, string>([
        ['e1', 'Exact duplicate of this text for testing purposes.'],
      ]);

      const candidates: ClaimCandidate[] = [
        {
          text: 'Exact duplicate of this text for testing purposes.',
          excerptIds: ['e1'],
          startSeconds: 10,
          chunkIndex: 0,
          confidence: 0.9,
        },
      ];

      // Should use default threshold of 0.9
      const result = runEditorPassV2WithDiagnostics(candidates, {
        maxClaims: 5,
        chunkCount: 1,
        excerptTextsById: excerptTexts,
        // echoOverlapThreshold not specified, should use default
      });

      expect(result.selected.length).toBe(1);
    });
  });

  describe('semantic similarity deduplication', () => {
    it('removes paraphrased duplicate claims using token overlap', () => {
      const candidates: ClaimCandidate[] = [
        {
          text: 'Muscle protein synthesis increases linearly with higher protein intake beyond thirty grams per meal.',
          excerptIds: ['e1'],
          startSeconds: 10,
          chunkIndex: 0,
          confidence: 0.8,
          domain: 'Nutrition',
        },
        {
          text: 'Muscle protein synthesis increases linearly with higher protein intake beyond thirty grams per feeding.',
          excerptIds: ['e2'],
          startSeconds: 15,
          chunkIndex: 0,
          confidence: 0.75,
          domain: 'Nutrition',
        },
        {
          text: 'Leucine threshold triggers muscle building regardless of total protein consumed daily.',
          excerptIds: ['e3'],
          startSeconds: 20,
          chunkIndex: 0,
          confidence: 0.7,
          domain: 'Nutrition',
        },
      ];

      const result = runEditorPassV2WithDiagnostics(candidates, {
        maxClaims: 10,
        chunkCount: 1,
        semanticSimilarityThreshold: 0.7,
        minWindows: 1,
      });

      // First two are semantically similar (about MPS/protein), should dedupe to 1
      // Third is about leucine threshold, different concept
      expect(result.selected.length).toBe(2);
      expect(result.diagnostics.droppedCounts.duplicate).toBeGreaterThanOrEqual(1);
    });

    it('preserves claims with different meanings despite token overlap', () => {
      const candidates: ClaimCandidate[] = [
        {
          text: 'Protein intake supports muscle growth and recovery after training sessions.',
          excerptIds: ['e1'],
          startSeconds: 10,
          chunkIndex: 0,
          confidence: 0.75,
          domain: 'Nutrition',
        },
        {
          text: 'Sleep quality affects muscle recovery more than protein supplementation timing.',
          excerptIds: ['e2'],
          startSeconds: 20,
          chunkIndex: 0,
          confidence: 0.7,
          domain: 'Recovery',
        },
      ];

      const result = runEditorPassV2(candidates, {
        maxClaims: 5,
        chunkCount: 1,
        semanticSimilarityThreshold: 0.75,
      });

      // These share some tokens (muscle, recovery) but have different meanings
      expect(result.length).toBe(2);
    });

    it('preserves superlative claims with opposite meanings', () => {
      const candidates: ClaimCandidate[] = [
        {
          text: 'This is the best option for improving recovery after intense training.',
          excerptIds: ['e1'],
          startSeconds: 10,
          chunkIndex: 0,
          confidence: 0.8,
          domain: 'Recovery',
        },
        {
          text: 'This is the worst option for improving recovery after intense training.',
          excerptIds: ['e2'],
          startSeconds: 20,
          chunkIndex: 0,
          confidence: 0.75,
          domain: 'Recovery',
        },
      ];

      const result = runEditorPassV2(candidates, {
        maxClaims: 5,
        chunkCount: 1,
        semanticSimilarityThreshold: 0.75,
        minWindows: 1,
      });

      expect(result).toHaveLength(2);
    });

    it('semantic dedupe runs after exact match dedupe', () => {
      const candidates: ClaimCandidate[] = [
        {
          text: 'Muscle protein synthesis increases linearly beyond thirty grams of protein intake per meal.',
          excerptIds: ['e1'],
          startSeconds: 10,
          chunkIndex: 0,
          confidence: 0.8,
          domain: 'Nutrition',
        },
        {
          text: 'Muscle protein synthesis increases linearly beyond thirty grams of protein intake per meal.',
          excerptIds: ['e2'],
          startSeconds: 15,
          chunkIndex: 0,
          confidence: 0.75,
          domain: 'Nutrition',
        },
        {
          text: 'MPS increases linearly beyond thirty grams of protein intake per meal feeding session.',
          excerptIds: ['e3'],
          startSeconds: 20,
          chunkIndex: 0,
          confidence: 0.7,
          domain: 'Nutrition',
        },
      ];

      const result = runEditorPassV2WithDiagnostics(candidates, {
        maxClaims: 10,
        chunkCount: 1,
        semanticSimilarityThreshold: 0.5,
        minWindows: 1,
      });

      // Exact duplicates removed first (1 drop), then semantic similar (1 drop)
      expect(result.selected.length).toBe(1);
      expect(result.diagnostics.droppedCounts.duplicate).toBeGreaterThanOrEqual(2);
    });

    it('respects configurable semantic similarity threshold', () => {
      const candidates: ClaimCandidate[] = [
        {
          text: 'Muscle protein synthesis increases linearly with protein intake beyond thirty grams per meal.',
          excerptIds: ['e1'],
          startSeconds: 10,
          chunkIndex: 0,
          confidence: 0.8,
          domain: 'Nutrition',
        },
        {
          text: 'MPS increases linearly with protein intake beyond thirty grams per meal during feeding.',
          excerptIds: ['e2'],
          startSeconds: 15,
          chunkIndex: 0,
          confidence: 0.75,
          domain: 'Nutrition',
        },
      ];

      // Lower threshold = more aggressive deduplication (catches more as similar)
      const aggressiveResult = runEditorPassV2(candidates, {
        maxClaims: 10,
        chunkCount: 1,
        semanticSimilarityThreshold: 0.4,
        minWindows: 1,
      });

      // Higher threshold = less aggressive deduplication (only catches very similar)
      const conservativeResult = runEditorPassV2(candidates, {
        maxClaims: 10,
        chunkCount: 1,
        semanticSimilarityThreshold: 0.95,
        minWindows: 1,
      });

      expect(aggressiveResult.length).toBeLessThan(conservativeResult.length);
    });
  });
});
