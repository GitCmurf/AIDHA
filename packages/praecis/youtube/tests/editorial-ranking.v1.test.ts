import { describe, it, expect } from 'vitest';
import type { ClaimCandidate } from '../src/extract/types.js';
import { runEditorPassV1 } from '../src/extract/editorial-ranking.js';

function baseCandidates(): ClaimCandidate[] {
  return [
    {
      text: 'Deterministic IDs prevent duplicate nodes during repeated ingestion runs.',
      excerptIds: ['e-2'],
      startSeconds: 30,
      chunkIndex: 0,
      confidence: 0.55,
    },
    {
      text: 'Repeated ingestion stays idempotent when deterministic IDs are used for nodes.',
      excerptIds: ['e-2'],
      startSeconds: 30,
      chunkIndex: 0,
      confidence: 0.92,
    },
    {
      text: 'Hashing stable fields with SHA-256 produces repeatable identifiers across sessions.',
      excerptIds: ['e-3'],
      startSeconds: 70,
      chunkIndex: 1,
      confidence: 0.75,
    },
    {
      text: 'Capture actionable points only and keep evidence snippets concise for clean dossiers.',
      excerptIds: ['e-4'],
      startSeconds: 120,
      chunkIndex: 2,
      confidence: 0.74,
    },
  ];
}

describe('editorial ranking v1 characterization', () => {
  it('runEditorPassV1 is deterministic for equivalent candidate sets', () => {
    const normal = runEditorPassV1(baseCandidates(), {
      maxClaims: 10,
      chunkCount: 3,
    });
    const reversed = runEditorPassV1(baseCandidates().slice().reverse(), {
      maxClaims: 10,
      chunkCount: 3,
    });

    expect(normal.length).toBe(3);
    expect(normal.map(candidate => candidate.text)).toEqual(
      reversed.map(candidate => candidate.text)
    );
    expect(normal[0]?.text).toContain('idempotent');
    expect(normal[1]?.text).toContain('SHA-256');
  });

  it('v1 admits a known bad fragment ending with conjunction', () => {
    const candidates: ClaimCandidate[] = [
      {
        text: 'Use stable IDs and avoid duplicate nodes and',
        excerptIds: ['e-5'],
        startSeconds: 140,
        chunkIndex: 2,
        confidence: 0.8,
      },
    ];

    const selected = runEditorPassV1(candidates, {
      maxClaims: 5,
      chunkCount: 3,
    });

    expect(selected.map(candidate => candidate.text)).toContain(
      'Use stable IDs and avoid duplicate nodes and'
    );
  });
});
