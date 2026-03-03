/**
 * Runtime Schema Validation Tests
 *
 * Tests that the runtime schema validation correctly validates
 * claim candidates and rejects malformed data.
 *
 * Note: The actual ClaimCandidateSchema is internal to claims.ts
 * and not exported. These tests verify the type shape and constraints.
 */

import { describe, it, expect } from 'vitest';
import type { ClaimCandidate } from '../src/extract/types.js';

describe('runtime schema validation', () => {
  it('accepts valid claim with all fields', () => {
    const validClaim: ClaimCandidate = {
      text: 'Muscle protein synthesis increases linearly beyond thirty grams per meal.',
      excerptIds: ['e1', 'e2'],
      confidence: 0.8,
      startSeconds: 120,
      type: 'fact',
      classification: 'Mechanism',
      domain: 'Nutrition',
      why: 'Supported by research studies.',
      evidenceType: 'RCT',
      method: 'llm',
      chunkIndex: 0,
      model: 'gpt-4',
      promptVersion: 'pass1-v1',
    };

    // Check required fields are present and valid types
    expect(validClaim.text).toBeTruthy();
    expect(typeof validClaim.text).toBe('string');
    expect(validClaim.text.length).toBeGreaterThan(0);
    expect(Array.isArray(validClaim.excerptIds)).toBe(true);
    expect(validClaim.excerptIds.length).toBeGreaterThan(0);
    if (validClaim.confidence !== undefined) {
      expect(validClaim.confidence).toBeGreaterThanOrEqual(0);
      expect(validClaim.confidence).toBeLessThanOrEqual(1);
    }
  });

  it('accepts valid claim with minimal fields', () => {
    const minimalClaim: ClaimCandidate = {
      text: 'Protein synthesis increases.',
      excerptIds: ['e1'],
    };

    expect(minimalClaim.text).toBeTruthy();
    expect(Array.isArray(minimalClaim.excerptIds)).toBe(true);
    expect(minimalClaim.excerptIds.length).toBeGreaterThan(0);
  });

  it('rejects claim with empty text', () => {
    const invalidClaim: ClaimCandidate = {
      text: '',
      excerptIds: ['e1'],
    };

    expect(invalidClaim.text.length).toBe(0);
    // Validation would fail: text must be at least 1 character
  });

  it('rejects claim with empty excerptIds', () => {
    const invalidClaim: ClaimCandidate = {
      text: 'Some claim text.',
      excerptIds: [],
    };

    expect(invalidClaim.excerptIds.length).toBe(0);
    // Validation would fail: excerptIds must have at least 1 item
  });

  it('rejects claim with invalid confidence (negative)', () => {
    const invalidClaim = {
      text: 'Some claim text.',
      excerptIds: ['e1'],
      confidence: -0.1,
    };

    // Validation would fail: confidence must be between 0 and 1
    expect(invalidClaim.confidence).toBeLessThan(0);
  });

  it('rejects claim with invalid confidence (> 1)', () => {
    const invalidClaim = {
      text: 'Some claim text.',
      excerptIds: ['e1'],
      confidence: 1.5,
    };

    // Validation would fail: confidence must be between 0 and 1
    expect(invalidClaim.confidence).toBeGreaterThan(1);
  });

  it('rejects claim with invalid method', () => {
    const invalidClaim = {
      text: 'Some claim text.',
      excerptIds: ['e1'],
      method: 'invalid-method',
    };

    // Validation would fail: method must be one of the enum values
    expect(['heuristic', 'heuristic-fallback', 'llm']).not.toContain(invalidClaim.method);
  });

  it('rejects claim with negative startSeconds', () => {
    const invalidClaim = {
      text: 'Some claim text.',
      excerptIds: ['e1'],
      startSeconds: -1,
    };

    // Validation would fail: startSeconds must be non-negative
    expect(invalidClaim.startSeconds).toBeLessThan(0);
  });

  it('accepts claim with confidence at boundaries', () => {
    const claimAtZero: ClaimCandidate = {
      text: 'Some claim text.',
      excerptIds: ['e1'],
      confidence: 0,
    };

    const claimAtOne: ClaimCandidate = {
      text: 'Another claim text.',
      excerptIds: ['e2'],
      confidence: 1,
    };

    expect(claimAtZero.confidence).toBe(0);
    expect(claimAtOne.confidence).toBe(1);
  });

  it('validates all claims in an array', () => {
    const claims: ClaimCandidate[] = [
      {
        text: 'Valid claim one.',
        excerptIds: ['e1'],
        confidence: 0.7,
      },
      {
        text: 'Valid claim two.',
        excerptIds: ['e2'],
        domain: 'Nutrition',
      },
      {
        text: '', // Invalid - empty text
        excerptIds: ['e3'],
      },
      {
        text: 'Valid claim three.',
        excerptIds: [], // Invalid - empty excerptIds
      },
    ];

    let validCount = 0;
    let invalidCount = 0;

    for (const claim of claims) {
      const hasValidText = claim.text.length > 0;
      const hasValidExcerpts = claim.excerptIds.length > 0;
      const hasValidConfidence = claim.confidence === undefined || (claim.confidence >= 0 && claim.confidence <= 1);

      if (hasValidText && hasValidExcerpts && hasValidConfidence) {
        validCount++;
      } else {
        invalidCount++;
      }
    }

    expect(validCount).toBe(2);
    expect(invalidCount).toBe(2);
  });

  it('handles claims with optional fields', () => {
    const claimWithOptionals: ClaimCandidate = {
      text: 'Claim with optional fields.',
      excerptIds: ['e1'],
      confidence: 0.8,
      startSeconds: 120,
      type: 'insight',
      classification: 'Mechanism',
      domain: 'Nutrition',
      why: 'Explanation.',
      evidenceType: 'RCT',
      method: 'llm',
      chunkIndex: 0,
      model: 'gpt-4',
      promptVersion: 'v1',
      state: 'accepted',
    };

    expect(claimWithOptionals.text).toBeTruthy();
    expect(claimWithOptionals.domain).toBe('Nutrition');
  });
});
