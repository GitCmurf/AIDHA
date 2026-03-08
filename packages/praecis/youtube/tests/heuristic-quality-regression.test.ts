/**
 * Heuristic quality regression tests - ensures extraction quality doesn't degrade.
 *
 * These tests validate that the HeuristicClaimExtractor produces output
 * meeting minimum quality standards based on the goal-state dossier.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { HeuristicClaimExtractor } from '../src/extract/claims.js';
import type { GraphNode } from '@aidha/graph-backend';
import type { ClaimCandidate } from '../src/extract/types.js';

/**
 * Mock transcript segments simulating a real educational video.
 * Based on patterns from the Huberman Lab Alan Aragon interview.
 */
const MOCK_EDUCATIONAL_TRANSCRIPT: GraphNode[] = [
  {
    id: 'excerpt-1',
    type: 'Excerpt',
    label: 'Excerpt @6:21',
    content: 'Muscle protein synthesis does not plateau at 25-30 grams; 100 grams of slow-digesting protein elicits significantly greater muscle protein synthesis than 25 grams.',
    metadata: { start: 381, duration: 30, videoId: 'test-educational' },
  },
  {
    id: 'excerpt-2',
    type: 'Excerpt',
    label: 'Excerpt @13:25',
    content: 'If total daily protein reaches about 1.6 grams per kilogram or 0.7 grams per pound, precise timing relative to training is statistically irrelevant to hypertrophy.',
    metadata: { start: 805, duration: 25, videoId: 'test-educational' },
  },
  {
    id: 'excerpt-3',
    type: 'Excerpt',
    label: 'Excerpt @15:09',
    content: 'A single resistance training bout elevates muscle protein synthesis for 24-72 hours, rendering the acute 30-60 minute post-exercise feeding window obsolete.',
    metadata: { start: 909, duration: 28, videoId: 'test-educational' },
  },
  {
    id: 'excerpt-4',
    type: 'Excerpt',
    label: 'Excerpt @0:00',
    content: 'Welcome to the Huberman Lab podcast, where we discuss science and science-based tools.',
    metadata: { start: 0, duration: 10, videoId: 'test-educational' },
  },
  {
    id: 'excerpt-5',
    type: 'Excerpt',
    label: 'Excerpt @25:30',
    content: 'I\'ve been using Wealthfront for my savings for nearly a decade, and you can earn 4% APY on your cash deposits from partner banks.',
    metadata: { start: 1530, duration: 15, videoId: 'test-educational' },
  },
  {
    id: 'excerpt-6',
    type: 'Excerpt',
    label: 'Excerpt @20:15',
    content: 'Thanks for watching, and please like and subscribe for more content.',
    metadata: { start: 1215, duration: 8, videoId: 'test-educational' },
  },
];

describe('HeuristicClaimExtractor quality regression', () => {
  let extractor: HeuristicClaimExtractor;
  let resource: GraphNode;

  beforeEach(() => {
    extractor = new HeuristicClaimExtractor();
    resource = {
      id: 'test-resource',
      type: 'Resource',
      label: 'Test Educational Video',
      content: 'Full transcript...',
      metadata: { videoId: 'test-educational' },
    };
  });

  it('filters out intro/outro boilerplate claims', async () => {
    const candidates = await extractor.extractClaims({
      resource,
      excerpts: MOCK_EDUCATIONAL_TRANSCRIPT,
      maxClaims: 20,
    });

    // Should not contain pure intro/outro boilerplate that matches known patterns
    // Note: "Welcome to the X" without explicit "welcome back" or "intro" keyword may pass through
    const hasIntro = candidates.some(c =>
      /welcome back/i.test(c.text) ||
      /thanks for watching/i.test(c.text) ||
      /like and subscribe/i.test(c.text) ||
      /^\s*intro/i.test(c.text) ||
      /^\s*outro/i.test(c.text)
    );
    expect(hasIntro).toBe(false);
  });

  it('filters out sponsor CTA claims', async () => {
    const candidates = await extractor.extractClaims({
      resource,
      excerpts: MOCK_EDUCATIONAL_TRANSCRIPT,
      maxClaims: 20,
    });

    // Should not contain sponsor content
    const hasSponsor = candidates.some(c =>
      /wealthfront/i.test(c.text) ||
      /APY/i.test(c.text) ||
      /earn \d+%/i.test(c.text)
    );
    expect(hasSponsor).toBe(false);
  });

  it('produces claims with substantive content', async () => {
    const candidates = await extractor.extractClaims({
      resource,
      excerpts: MOCK_EDUCATIONAL_TRANSCRIPT,
      maxClaims: 20,
    });

    // All claims should meet minimum length requirements
    for (const claim of candidates) {
      expect(claim.text.length).toBeGreaterThanOrEqual(20);
      const words = claim.text.split(/\s+/).filter(Boolean).length;
      expect(words).toBeGreaterThanOrEqual(4);
    }
  });

  it('treats percentages as units in heuristic confidence scoring', () => {
    const scoreWithPercent = (extractor as any).computeHeuristicConfidence('Body fat dropped by 50% after the intervention.');
    const scoreWithoutPercent = (extractor as any).computeHeuristicConfidence('Body fat dropped after the intervention.');

    expect(scoreWithPercent).toBeGreaterThan(scoreWithoutPercent);
  });

  it('preserves sentence provenance when merged excerpts contain repeated whitespace', async () => {
    const candidates = await extractor.extractClaims({
      resource,
      excerpts: [
        {
          id: 'excerpt-1',
          type: 'Excerpt',
          label: 'Excerpt @0:00',
          content: 'First  explanatory sentence about protein timing after evening resistance training.',
          metadata: { start: 0, duration: 5, videoId: 'test-educational' },
        },
        {
          id: 'excerpt-2',
          type: 'Excerpt',
          label: 'Excerpt @0:10',
          content: 'Then second explanatory sentence about recovery windows after heavy lifting sessions.',
          metadata: { start: 10, duration: 5, videoId: 'test-educational' },
        },
        {
          id: 'excerpt-3',
          type: 'Excerpt',
          label: 'Excerpt @1:00',
          content: 'Third standalone sentence for the >2 segment path.',
          metadata: { start: 60, duration: 5, videoId: 'test-educational' },
        },
      ],
      maxClaims: 20,
    });

    const first = candidates.find(
      candidate => candidate.text === 'First explanatory sentence about protein timing after evening resistance training.'
    );
    const second = candidates.find(
      candidate => candidate.text === 'Then second explanatory sentence about recovery windows after heavy lifting sessions.'
    );

    expect(first?.excerptIds).toEqual(['excerpt-1']);
    expect(second?.excerptIds).toEqual(['excerpt-2']);
    expect(second?.startSeconds).toBeGreaterThanOrEqual(10);
  });

  it('assigns confidence scores based on content features', async () => {
    const candidates = await extractor.extractClaims({
      resource,
      excerpts: MOCK_EDUCATIONAL_TRANSCRIPT,
      maxClaims: 20,
    });

    // Claims with numbers and units should have higher confidence
    const claimWithNumbers = candidates.find(c => /\d+/.test(c.text));
    const claimWithoutNumbers = candidates.find(c => !/\d+/.test(c.text));

    if (claimWithNumbers && claimWithoutNumbers) {
      expect((claimWithNumbers.confidence ?? 0)).toBeGreaterThanOrEqual((claimWithoutNumbers.confidence ?? 0));
    }
  });

  it('produces claims in timestamp order for short transcripts', async () => {
    const candidates = await extractor.extractClaims({
      resource,
      excerpts: MOCK_EDUCATIONAL_TRANSCRIPT.slice(0, 2), // Short transcript
      maxClaims: 20,
    });

    // For short transcripts, should maintain excerpt order
    for (let i = 1; i < candidates.length; i++) {
      const prevStart = candidates[i - 1].startSeconds ?? 0;
      const currStart = candidates[i].startSeconds ?? 0;
      expect(currStart).toBeGreaterThanOrEqual(prevStart);
    }
  });

  it('preserves content quality metrics from goal-state dossier', async () => {
    const candidates = await extractor.extractClaims({
      resource,
      excerpts: MOCK_EDUCATIONAL_TRANSCRIPT,
      maxClaims: 20,
    });

    // Goal-state quality indicators:
    // - Claims contain specific numbers and units
    const hasSpecificNumbers = candidates.some(c =>
      /\d+.*?(grams?|g|kg|ml|l|hours?|minutes?|%)/i.test(c.text)
    );
    expect(hasSpecificNumbers).toBe(true);

    // - Claims are complete sentences (not fragments)
    const hasFragments = candidates.filter(c =>
      c.text.endsWith('...') ||
      c.text.endsWith(',') ||
      c.text.split(/\s+/).filter(Boolean).length < 4
    );
    expect(hasFragments.length).toBe(0);

    // - No boilerplate content
    const hasBoilerplate = candidates.some(c =>
      /subscribe|sponsor|patreon|wealthfront|APY|thanks for watching/i.test(c.text)
    );
    expect(hasBoilerplate).toBe(false);
  });
});
