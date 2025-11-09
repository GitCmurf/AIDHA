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
});
