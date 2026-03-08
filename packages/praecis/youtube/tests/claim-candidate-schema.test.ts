/**
 * Claim Candidate Schema Tests
 *
 * Tests the Zod schema validation for ClaimCandidate objects.
 */
import { describe, it, expect } from 'vitest';
import {
  ClaimCandidateSchema,
  validateClaimCandidate,
  isValidClaimCandidate,
  CLAIM_TYPES,
  CLAIM_CLASSIFICATIONS,
  CLAIM_STATES,
  CLAIM_METHODS,
  normalizeClaimType,
  normalizeClaimClassification,
} from '../src/extract/claim-candidate-schema.js';
import type { ClaimCandidate } from '../src/extract/types.js';

describe('ClaimCandidateSchema', () => {
  describe('valid claim validation', () => {
    it('validates a complete claim', () => {
      const claim = {
        text: 'This is a test claim',
        excerptIds: ['excerpt-1', 'excerpt-2'],
        confidence: 0.85,
        startSeconds: 120,
        type: 'insight',
        classification: 'fact',
        domain: 'technology',
        why: 'This is an important insight',
        evidenceType: 'empirical',
        method: 'llm',
        chunkIndex: 0,
        model: 'gpt-4',
        promptVersion: 'v1.0',
        extractorVersion: '1.0.0',
        state: 'draft',
        echoOverlapRatio: 0.5,
      };

      const result = ClaimCandidateSchema.safeParse(claim);
      expect(result.success).toBe(true);
    });

    it('validates a minimal claim with only required fields', () => {
      const claim = {
        text: 'Minimal claim',
        excerptIds: ['excerpt-1'],
      };

      const result = ClaimCandidateSchema.safeParse(claim);
      expect(result.success).toBe(true);
    });

    it('validates claim with all valid types', () => {
      for (const type of CLAIM_TYPES) {
        const claim = {
          text: `Claim with type ${type}`,
          excerptIds: ['excerpt-1'],
          type,
        };

        const result = ClaimCandidateSchema.safeParse(claim);
        expect(result.success).toBe(true);
      }
    });

    it('validates claim with all valid classifications', () => {
      for (const classification of CLAIM_CLASSIFICATIONS) {
        const claim = {
          text: `Claim with classification ${classification}`,
          excerptIds: ['excerpt-1'],
          classification,
        };

        const result = ClaimCandidateSchema.safeParse(claim);
        expect(result.success).toBe(true);
      }
    });

    it('validates claim with all valid states', () => {
      for (const state of CLAIM_STATES) {
        const claim = {
          text: `Claim with state ${state}`,
          excerptIds: ['excerpt-1'],
          state,
        };

        const result = ClaimCandidateSchema.safeParse(claim);
        expect(result.success).toBe(true);
      }
    });

    it('validates claim with all valid methods', () => {
      for (const method of CLAIM_METHODS) {
        const claim = {
          text: `Claim with method ${method}`,
          excerptIds: ['excerpt-1'],
          method,
        };

        const result = ClaimCandidateSchema.safeParse(claim);
        expect(result.success).toBe(true);
      }
    });
  });

  describe('missing required fields', () => {
    it('fails validation when text is missing', () => {
      const claim = {
        excerptIds: ['excerpt-1'],
      };

      const result = ClaimCandidateSchema.safeParse(claim);
      expect(result.success).toBe(false);
    });

    it('fails validation when text is empty', () => {
      const claim = {
        text: '',
        excerptIds: ['excerpt-1'],
      };

      const result = ClaimCandidateSchema.safeParse(claim);
      expect(result.success).toBe(false);
    });

    it('fails validation when excerptIds is missing', () => {
      const claim = {
        text: 'Claim without excerpts',
      };

      const result = ClaimCandidateSchema.safeParse(claim);
      expect(result.success).toBe(false);
    });

    it('fails validation when excerptIds is empty', () => {
      const claim = {
        text: 'Claim with empty excerpts',
        excerptIds: [],
      };

      const result = ClaimCandidateSchema.safeParse(claim);
      expect(result.success).toBe(false);
    });

    it('fails validation when both required fields are missing', () => {
      const claim = {};

      const result = ClaimCandidateSchema.safeParse(claim);
      expect(result.success).toBe(false);
    });
  });

  describe('type normalization', () => {
    it('accepts valid claim types', () => {
      for (const type of CLAIM_TYPES) {
        const claim = {
          text: 'Test claim',
          excerptIds: ['excerpt-1'],
          type,
        };

        const result = ClaimCandidateSchema.safeParse(claim);
        expect(result.success).toBe(true);
      }
    });

    it('rejects invalid claim types', () => {
      const claim = {
        text: 'Test claim',
        excerptIds: ['excerpt-1'],
        type: 'invalid-type',
      };

      const result = ClaimCandidateSchema.safeParse(claim);
      expect(result.success).toBe(false);
    });

    it('rejects numeric type', () => {
      const claim = {
        text: 'Test claim',
        excerptIds: ['excerpt-1'],
        type: 123,
      };

      const result = ClaimCandidateSchema.safeParse(claim);
      expect(result.success).toBe(false);
    });

    it('accepts undefined type', () => {
      const claim = {
        text: 'Test claim',
        excerptIds: ['excerpt-1'],
        type: undefined,
      };

      const result = ClaimCandidateSchema.safeParse(claim);
      expect(result.success).toBe(true);
    });
  });

  describe('classification normalization', () => {
    it('accepts valid classifications', () => {
      for (const classification of CLAIM_CLASSIFICATIONS) {
        const claim = {
          text: 'Test claim',
          excerptIds: ['excerpt-1'],
          classification,
        };

        const result = ClaimCandidateSchema.safeParse(claim);
        expect(result.success).toBe(true);
      }
    });

    it('rejects invalid classification', () => {
      const claim = {
        text: 'Test claim',
        excerptIds: ['excerpt-1'],
        classification: 'invalid-classification',
      };

      const result = ClaimCandidateSchema.safeParse(claim);
      expect(result.success).toBe(false);
    });

    it('accepts undefined classification', () => {
      const claim = {
        text: 'Test claim',
        excerptIds: ['excerpt-1'],
        classification: undefined,
      };

      const result = ClaimCandidateSchema.safeParse(claim);
      expect(result.success).toBe(true);
    });
  });

  describe('optional fields', () => {
    it('validates claim without optional fields', () => {
      const claim = {
        text: 'Minimal claim',
        excerptIds: ['excerpt-1'],
      };

      const result = ClaimCandidateSchema.safeParse(claim);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.confidence).toBeUndefined();
        expect(result.data.type).toBeUndefined();
        expect(result.data.classification).toBeUndefined();
      }
    });

    it('validates claim with some optional fields', () => {
      const claim = {
        text: 'Partial claim',
        excerptIds: ['excerpt-1'],
        confidence: 0.9,
        domain: 'science',
      };

      const result = ClaimCandidateSchema.safeParse(claim);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.confidence).toBe(0.9);
        expect(result.data.domain).toBe('science');
        expect(result.data.type).toBeUndefined();
      }
    });

    it('validates claim with all optional fields', () => {
      const claim = {
        text: 'Complete claim',
        excerptIds: ['excerpt-1'],
        confidence: 0.95,
        startSeconds: 0,
        type: 'fact',
        classification: 'mechanism',
        domain: 'biology',
        why: 'Well supported by evidence',
        evidenceType: 'experimental',
        method: 'heuristic',
        chunkIndex: 0,
        model: 'test-model',
        promptVersion: 'v1',
        extractorVersion: '1.0.0',
        state: 'accepted',
        echoOverlapRatio: 0.0,
      };

      const result = ClaimCandidateSchema.safeParse(claim);
      expect(result.success).toBe(true);
    });
  });

  describe('field constraints', () => {
    it('rejects negative startSeconds', () => {
      const claim = {
        text: 'Test claim',
        excerptIds: ['excerpt-1'],
        startSeconds: -1,
      };

      const result = ClaimCandidateSchema.safeParse(claim);
      expect(result.success).toBe(false);
    });

    it('rejects confidence above 1', () => {
      const claim = {
        text: 'Test claim',
        excerptIds: ['excerpt-1'],
        confidence: 1.5,
      };

      const result = ClaimCandidateSchema.safeParse(claim);
      expect(result.success).toBe(false);
    });

    it('rejects negative confidence', () => {
      const claim = {
        text: 'Test claim',
        excerptIds: ['excerpt-1'],
        confidence: -0.5,
      };

      const result = ClaimCandidateSchema.safeParse(claim);
      expect(result.success).toBe(false);
    });

    it('rejects echoOverlapRatio above 1', () => {
      const claim = {
        text: 'Test claim',
        excerptIds: ['excerpt-1'],
        echoOverlapRatio: 1.5,
      };

      const result = ClaimCandidateSchema.safeParse(claim);
      expect(result.success).toBe(false);
    });

    it('rejects negative echoOverlapRatio', () => {
      const claim = {
        text: 'Test claim',
        excerptIds: ['excerpt-1'],
        echoOverlapRatio: -0.5,
      };

      const result = ClaimCandidateSchema.safeParse(claim);
      expect(result.success).toBe(false);
    });

    it('rejects non-integer chunkIndex', () => {
      const claim = {
        text: 'Test claim',
        excerptIds: ['excerpt-1'],
        chunkIndex: 1.5,
      };

      const result = ClaimCandidateSchema.safeParse(claim);
      expect(result.success).toBe(false);
    });
  });
});

describe('validateClaimCandidate', () => {
  it('returns success for valid claim', () => {
    const claim = {
      text: 'Valid claim',
      excerptIds: ['excerpt-1'],
    };

    const result = validateClaimCandidate(claim);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.text).toBe('Valid claim');
    }
  });

  it('returns error for invalid claim', () => {
    const claim = {
      text: '',
      excerptIds: ['excerpt-1'],
    };

    const result = validateClaimCandidate(claim);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toContain('text');
    }
  });

  it('returns typed data on success', () => {
    const claim = {
      text: 'Typed claim',
      excerptIds: ['excerpt-1'],
      confidence: 0.8,
    };

    const result = validateClaimCandidate(claim);
    expect(result.success).toBe(true);
    if (result.success) {
      const typedClaim: ClaimCandidate = result.data;
      expect(typedClaim.text).toBe('Typed claim');
    }
  });
});

describe('isValidClaimCandidate', () => {
  it('returns true for valid claim', () => {
    const claim = {
      text: 'Valid claim',
      excerptIds: ['excerpt-1'],
    };

    expect(isValidClaimCandidate(claim)).toBe(true);
  });

  it('returns false for invalid claim', () => {
    const claim = {
      text: '',
      excerptIds: [],
    };

    expect(isValidClaimCandidate(claim)).toBe(false);
  });

  it('acts as type guard', () => {
    const unknownValue: unknown = {
      text: 'Test claim',
      excerptIds: ['excerpt-1'],
    };

    if (isValidClaimCandidate(unknownValue)) {
      // TypeScript should recognize unknownValue as ClaimCandidate
      expect(unknownValue.text).toBe('Test claim');
      expect(unknownValue.excerptIds).toEqual(['excerpt-1']);
    } else {
      expect.fail('Should have been valid');
    }
  });
});

describe('normalizeClaimType', () => {
  it('normalizes uppercase type', () => {
    expect(normalizeClaimType('INSIGHT')).toBe('insight');
    expect(normalizeClaimType('FACT')).toBe('fact');
  });

  it('normalizes mixed case type', () => {
    expect(normalizeClaimType('InSight')).toBe('insight');
    expect(normalizeClaimType('Fact')).toBe('fact');
  });

  it('returns undefined for invalid type', () => {
    expect(normalizeClaimType('invalid')).toBeUndefined();
    expect(normalizeClaimType('unknown')).toBeUndefined();
  });

  it('returns undefined for undefined input', () => {
    expect(normalizeClaimType(undefined)).toBeUndefined();
  });

  it('returns undefined for empty string', () => {
    expect(normalizeClaimType('')).toBeUndefined();
  });

  it('returns undefined for whitespace', () => {
    expect(normalizeClaimType('   ')).toBeUndefined();
  });

  it('normalizes all valid types', () => {
    for (const type of CLAIM_TYPES) {
      expect(normalizeClaimType(type.toUpperCase())).toBe(type);
      expect(normalizeClaimType(type)).toBe(type);
    }
  });
});

describe('normalizeClaimClassification', () => {
  it('normalizes uppercase classification', () => {
    expect(normalizeClaimClassification('FACT')).toBe('fact');
    expect(normalizeClaimClassification('OPINION')).toBe('opinion');
  });

  it('normalizes mixed case classification', () => {
    expect(normalizeClaimClassification('Fact')).toBe('fact');
    expect(normalizeClaimClassification('MeChanIsM')).toBe('mechanism');
  });

  it('returns undefined for invalid classification', () => {
    expect(normalizeClaimClassification('invalid')).toBeUndefined();
    expect(normalizeClaimClassification('theory')).toBeUndefined();
  });

  it('returns undefined for undefined input', () => {
    expect(normalizeClaimClassification(undefined)).toBeUndefined();
  });

  it('returns undefined for empty string', () => {
    expect(normalizeClaimClassification('')).toBeUndefined();
  });

  it('returns undefined for whitespace', () => {
    expect(normalizeClaimClassification('   ')).toBeUndefined();
  });

  it('normalizes all valid classifications', () => {
    for (const classification of CLAIM_CLASSIFICATIONS) {
      expect(normalizeClaimClassification(classification.toUpperCase())).toBe(classification);
      expect(normalizeClaimClassification(classification)).toBe(classification);
    }
  });
});
