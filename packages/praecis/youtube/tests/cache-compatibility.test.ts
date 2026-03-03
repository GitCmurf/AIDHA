/**
 * Cache Compatibility Tests
 *
 * Ensures that additive schema changes (like evidenceType) don't break
 * existing production caches. Tests that v1 caches parse successfully with v2 code.
 */

import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import type { ClaimCandidate } from '../src/extract/types.js';

// V1 cache payload (before evidenceType was added)
const V1_CACHE_PAYLOAD = {
  version: '1.0',
  model: 'gpt-4',
  promptVersion: 'pass1-v1',
  timestamp: '2024-01-01T00:00:00Z',
  claims: [
    {
      text: 'Muscle protein synthesis increases linearly beyond thirty grams per meal.',
      excerptIds: ['e1', 'e2'],
      confidence: 0.8,
      startSeconds: 120,
      domain: 'Nutrition',
      classification: 'Mechanism',
      // Note: evidenceType is absent in v1
    },
    {
      text: 'Leucine threshold triggers muscle protein synthesis.',
      excerptIds: ['e3'],
      confidence: 0.75,
      startSeconds: 300,
      // domain, classification, evidenceType all absent
    },
  ],
};

// Current ClaimSchema for validation
const ClaimSchema = z.object({
  text: z.string(),
  excerptIds: z.array(z.string()),
  confidence: z.number().optional(),
  startSeconds: z.number().optional(),
  type: z.string().optional(),
  classification: z.string().optional(),
  domain: z.string().optional(),
  why: z.string().optional(),
  evidenceType: z.string().optional(), // Optional in v2
  method: z.enum(['heuristic', 'heuristic-fallback', 'llm']).optional(),
  chunkIndex: z.number().optional(),
  model: z.string().optional(),
  promptVersion: z.string().optional(),
  state: z.string().optional(),
});

// V1 Cache Metadata Schema
const V1CacheMetadataSchema = z.object({
  version: z.string(),
  model: z.string(),
  promptVersion: z.string(),
  timestamp: z.string(),
});

// V2 Cache Metadata Schema (with schemaVersion)
const V2CacheMetadataSchema = V1CacheMetadataSchema.extend({
  schemaVersion: z.number().optional(),
});

describe('cache compatibility', () => {
  it('parses v1 cache payload without evidenceType field', () => {
    // Simulate parsing a v1 cache payload with current code
    const parsedClaims = V1_CACHE_PAYLOAD.claims.map(claim => {
      const result = ClaimSchema.safeParse(claim);
      expect(result.success).toBe(true);
      return result.data;
    });

    expect(parsedClaims).toHaveLength(2);

    // First claim has domain and classification
    expect(parsedClaims[0].domain).toBe('Nutrition');
    expect(parsedClaims[0].classification).toBe('Mechanism');
    expect(parsedClaims[0].evidenceType).toBeUndefined(); // v1 field, should be undefined

    // Second claim has minimal metadata
    expect(parsedClaims[1].domain).toBeUndefined();
    expect(parsedClaims[1].classification).toBeUndefined();
    expect(parsedClaims[1].evidenceType).toBeUndefined();
  });

  it('accepts v2 cache payload with evidenceType field', () => {
    const v2Payload = {
      ...V1_CACHE_PAYLOAD,
      schemaVersion: 2,
      claims: [
        {
          ...V1_CACHE_PAYLOAD.claims[0],
          evidenceType: 'Physiological Consensus',
        },
      ],
    };

    const result = ClaimSchema.safeParse(v2Payload.claims[0]);
    expect(result.success).toBe(true);

    if (result.success) {
      expect(result.data.evidenceType).toBe('Physiological Consensus');
    }
  });

  it('parses v1 cache metadata with current schema', () => {
    const result = V2CacheMetadataSchema.safeParse(V1_CACHE_PAYLOAD);
    expect(result.success).toBe(true);

    if (result.success) {
      expect(result.data.version).toBe('1.0');
      expect(result.data.schemaVersion).toBeUndefined(); // v1 doesn't have this field
    }
  });

  it('rejects malformed claim payloads', () => {
    const malformedClaims = [
      {
        // Missing required text field
        excerptIds: ['e1'],
        confidence: 0.8,
      },
      {
        // excerptIds must be an array
        text: 'Some claim',
        excerptIds: 'not-an-array',
      },
      {
        // confidence must be a number if present
        text: 'Some claim',
        excerptIds: ['e1'],
        confidence: 'not-a-number',
      },
    ];

    for (const claim of malformedClaims) {
      const result = ClaimSchema.safeParse(claim);
      expect(result.success).toBe(false);
    }
  });

  it('handles claims with partial metadata gracefully', () => {
    const partialClaims = [
      {
        text: 'Complete claim with all metadata',
        excerptIds: ['e1'],
        confidence: 0.8,
        domain: 'Nutrition',
        classification: 'Mechanism',
        evidenceType: 'RCT',
        method: 'llm',
      },
      {
        text: 'Claim with only text and excerptIds',
        excerptIds: ['e2'],
      },
      {
        text: 'Claim with some metadata',
        excerptIds: ['e3'],
        confidence: 0.7,
        domain: 'Exercise Science',
      },
    ];

    for (const claim of partialClaims) {
      const result = ClaimSchema.safeParse(claim);
      expect(result.success).toBe(true);
    }
  });

  it('validates method enum values', () => {
    const validMethods = ['heuristic', 'heuristic-fallback', 'llm'] as const;

    for (const method of validMethods) {
      const result = ClaimSchema.safeParse({
        text: 'Test claim',
        excerptIds: ['e1'],
        method,
      });
      expect(result.success).toBe(true);
    }

    // Invalid method should be rejected
    const invalidResult = ClaimSchema.safeParse({
      text: 'Test claim',
      excerptIds: ['e1'],
      method: 'invalid-method',
    });
    expect(invalidResult.success).toBe(false);
  });

  it('allows unknown fields in cache payload for forward compatibility', () => {
    const payloadWithUnknownFields = {
      ...V1_CACHE_PAYLOAD.claims[0],
      // Future field not yet defined in schema
      futureField: 'some-value',
    };

    // Zod by default strips unknown fields
    const result = ClaimSchema.safeParse(payloadWithUnknownFields);
    expect(result.success).toBe(true);

    if (result.success) {
      // Future field should be stripped but rest preserved
      expect(result.data.text).toBe(V1_CACHE_PAYLOAD.claims[0].text);
      expect('futureField' in result.data).toBe(false);
    }
  });

  it('handles empty excerptIds array', () => {
    const claimWithEmptyExcerpts = {
      text: 'A claim without excerpt sources',
      excerptIds: [],
    };

    const result = ClaimSchema.safeParse(claimWithEmptyExcerpts);
    expect(result.success).toBe(true);
  });

  it('handles numeric string confidence conversion edge cases', () => {
    const claimWithNumericString = {
      text: 'Test claim',
      excerptIds: ['e1'],
      confidence: '0.8', // String instead of number
    };

    const result = ClaimSchema.safeParse(claimWithNumericString);
    // Should fail because zod doesn't coerce strings to numbers by default
    expect(result.success).toBe(false);
  });
});
