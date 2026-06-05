import { describe, expect, it } from 'vitest';
import { buildSourceSynopsis } from '../../src/extract/index.js';
import type { Chunk, DraftClaim } from '../../src/interfaces/index.js';

const chunks: readonly Chunk[] = [
  {
    id: 'chunk-pkm',
    text: 'The transcript explains a markdown wiki with raw and wiki folders.',
    locator: { kind: 'timecode', startSec: 120, endSec: 180 },
    segments: [],
  },
  {
    id: 'chunk-tools',
    text: 'Backlinks point to Claude Code, Perplexity, Visual Studio Code, Nano Banana, and permission modes.',
    locator: { kind: 'timecode', startSec: 181, endSec: 220 },
    segments: [],
  },
  {
    id: 'chunk-rag',
    text: 'For million-document systems, traditional RAG is better because file crawling and token usage scale poorly.',
    locator: { kind: 'timecode', startSec: 900, endSec: 960 },
    segments: [],
  },
];

function claim(overrides: Partial<DraftClaim>): DraftClaim {
  return {
    text: 'A markdown wiki can answer questions by following explicit links.',
    excerptIds: ['chunk-pkm'],
    state: 'draft',
    ...overrides,
  };
}

describe('buildSourceSynopsis', () => {
  it('normalizes reported-speech wrappers without losing evidence anchors', () => {
    const synopsis = buildSourceSynopsis({
      sourceId: 'youtube',
      canonicalId: 'youtube-example123',
      sourceUri: 'https://www.youtube.com/watch?v=example123',
      resourceId: 'youtube-example123',
      chunks,
      claims: [
        claim({
          text: 'The speaker claims that a markdown wiki can answer questions by following explicit links instead of embedding similarity.',
          type: 'mechanism',
          metadata: {
            rationale: 'Explicit links preserve author- or agent-created relationships that similarity search may only approximate.',
          },
        }),
      ],
    });

    expect(synopsis).toHaveLength(1);
    expect(synopsis[0]?.text).toBe('A markdown wiki can answer questions by following explicit links instead of embedding similarity.');
    expect(synopsis[0]?.kind).toBe('mechanism');
    expect(synopsis[0]?.evidenceRefs[0]?.localTranscriptRef).toBe('youtube-example123#chunk-pkm@120-180s');
    expect(synopsis[0]?.evidenceRefs[0]?.sourceRef).toBe('https://www.youtube.com/watch?v=example123');
    expect(synopsis[0]?.rationale).toContain('Explicit links preserve');
  });

  it('drops category-soup backlinks that list tags without a reviewable proposition', () => {
    const synopsis = buildSourceSynopsis({
      sourceId: 'youtube',
      canonicalId: 'youtube-example123',
      resourceId: 'youtube-example123',
      chunks,
      claims: [
        claim({
          text: 'The speaker uses backlinks in the knowledge system to navigate between concepts such as the WAT framework, Claude Code, Perplexity, Visual Studio Code, Nano Banana, and permission modes.',
          excerptIds: ['chunk-tools'],
        }),
      ],
    });

    expect(synopsis).toEqual([]);
  });

  it('corrects generic attribution mistakes without hard-coding a specific video', () => {
    const synopsis = buildSourceSynopsis({
      sourceId: 'youtube',
      canonicalId: 'youtube-example123',
      resourceId: 'youtube-example123',
      chunks,
      claims: [
        claim({
          text: "Claude Code's Karpathy prompt creates raw and wiki folders when used inside a connected vault.",
        }),
      ],
    });

    expect(synopsis[0]?.text).toBe("Karpathy's Claude Code prompt creates raw and wiki folders when used inside a connected vault.");
  });

  it('keeps recommendation rationale separate from the claim text', () => {
    const synopsis = buildSourceSynopsis({
      sourceId: 'youtube',
      canonicalId: 'youtube-example123',
      resourceId: 'youtube-example123',
      chunks,
      claims: [
        claim({
          text: 'For million-document systems, traditional RAG or knowledge-graph infrastructure is more appropriate than a markdown-wiki file crawl.',
          excerptIds: ['chunk-rag'],
          type: 'recommendation',
          metadata: {
            supportSummary: 'The transcript says file crawling and token usage become bottlenecks at very large scale.',
          },
        }),
      ],
    });

    expect(synopsis[0]?.kind).toBe('recommendation');
    expect(synopsis[0]?.text).not.toMatch(/^The speaker/);
    expect(synopsis[0]?.rationale).toBe('The transcript says file crawling and token usage become bottlenecks at very large scale.');
  });
});
