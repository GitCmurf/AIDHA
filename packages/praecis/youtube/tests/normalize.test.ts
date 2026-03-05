/**
 * Normalize Tests
 *
 * Tests the normalization functions for claim types and classifications.
 */
import { describe, it, expect } from 'vitest';
import {
  normalizeClaimType,
  normalizeClaimClassification,
  CLAIM_TYPES,
  CLAIM_CLASSIFICATIONS,
} from '../src/extract/claim-candidate-schema.js';

describe('normalizeClaimClassification', () => {
  describe('with valid values', () => {
    it('normalizes "fact" to "fact"', () => {
      expect(normalizeClaimClassification('fact')).toBe('fact');
    });

    it('normalizes "mechanism" to "mechanism"', () => {
      expect(normalizeClaimClassification('mechanism')).toBe('mechanism');
    });

    it('normalizes "opinion" to "opinion"', () => {
      expect(normalizeClaimClassification('opinion')).toBe('opinion');
    });

    it('handles all valid classifications', () => {
      for (const classification of CLAIM_CLASSIFICATIONS) {
        expect(normalizeClaimClassification(classification)).toBe(classification);
      }
    });
  });

  describe('with uppercase values', () => {
    it('normalizes "FACT" to "fact"', () => {
      expect(normalizeClaimClassification('FACT')).toBe('fact');
    });

    it('normalizes "MECHANISM" to "mechanism"', () => {
      expect(normalizeClaimClassification('MECHANISM')).toBe('mechanism');
    });

    it('normalizes "OPINION" to "opinion"', () => {
      expect(normalizeClaimClassification('OPINION')).toBe('opinion');
    });
  });

  describe('with mixed case values', () => {
    it('normalizes "Fact" to "fact"', () => {
      expect(normalizeClaimClassification('Fact')).toBe('fact');
    });

    it('normalizes "MeChAnIsM" to "mechanism"', () => {
      expect(normalizeClaimClassification('MeChAnIsM')).toBe('mechanism');
    });

    it('normalizes "OpInIoN" to "opinion"', () => {
      expect(normalizeClaimClassification('OpInIoN')).toBe('opinion');
    });
  });

  describe('with invalid values', () => {
    it('returns undefined for "theory"', () => {
      expect(normalizeClaimClassification('theory')).toBeUndefined();
    });

    it('returns undefined for "hypothesis"', () => {
      expect(normalizeClaimClassification('hypothesis')).toBeUndefined();
    });

    it('returns undefined for "speculation"', () => {
      expect(normalizeClaimClassification('speculation')).toBeUndefined();
    });

    it('returns undefined for random strings', () => {
      expect(normalizeClaimClassification('random')).toBeUndefined();
      expect(normalizeClaimClassification('invalid')).toBeUndefined();
      expect(normalizeClaimClassification('unknown')).toBeUndefined();
    });

    it('returns undefined for similar but invalid values', () => {
      expect(normalizeClaimClassification('facts')).toBeUndefined();
      expect(normalizeClaimClassification('opinions')).toBeUndefined();
      expect(normalizeClaimClassification('mechanisms')).toBeUndefined();
    });
  });

  describe('with edge cases', () => {
    it('returns undefined for undefined input', () => {
      expect(normalizeClaimClassification(undefined)).toBeUndefined();
    });

    it('returns undefined for empty string', () => {
      expect(normalizeClaimClassification('')).toBeUndefined();
    });

    it('returns undefined for whitespace only', () => {
      expect(normalizeClaimClassification('   ')).toBeUndefined();
      expect(normalizeClaimClassification('\t\n')).toBeUndefined();
    });

    it('does not trim whitespace (whitespace makes value invalid)', () => {
      // The implementation only lowercases, does not trim
      expect(normalizeClaimClassification('  fact  ')).toBeUndefined();
      expect(normalizeClaimClassification('\topinion\n')).toBeUndefined();
    });

    it('handles values with internal spaces', () => {
      expect(normalizeClaimClassification('fact opinion')).toBeUndefined();
    });
  });
});

describe('normalizeClaimType', () => {
  describe('with valid types', () => {
    it('normalizes "insight" to "insight"', () => {
      expect(normalizeClaimType('insight')).toBe('insight');
    });

    it('normalizes "instruction" to "instruction"', () => {
      expect(normalizeClaimType('instruction')).toBe('instruction');
    });

    it('normalizes "fact" to "fact"', () => {
      expect(normalizeClaimType('fact')).toBe('fact');
    });

    it('normalizes "mechanism" to "mechanism"', () => {
      expect(normalizeClaimType('mechanism')).toBe('mechanism');
    });

    it('normalizes "opinion" to "opinion"', () => {
      expect(normalizeClaimType('opinion')).toBe('opinion');
    });

    it('normalizes "decision" to "decision"', () => {
      expect(normalizeClaimType('decision')).toBe('decision');
    });

    it('normalizes "warning" to "warning"', () => {
      expect(normalizeClaimType('warning')).toBe('warning');
    });

    it('normalizes "question" to "question"', () => {
      expect(normalizeClaimType('question')).toBe('question');
    });

    it('normalizes "summary" to "summary"', () => {
      expect(normalizeClaimType('summary')).toBe('summary');
    });

    it('normalizes "example" to "example"', () => {
      expect(normalizeClaimType('example')).toBe('example');
    });

    it('handles all valid types', () => {
      for (const type of CLAIM_TYPES) {
        expect(normalizeClaimType(type)).toBe(type);
      }
    });
  });

  describe('with uppercase values', () => {
    it('normalizes "INSIGHT" to "insight"', () => {
      expect(normalizeClaimType('INSIGHT')).toBe('insight');
    });

    it('normalizes "INSTRUCTION" to "instruction"', () => {
      expect(normalizeClaimType('INSTRUCTION')).toBe('instruction');
    });

    it('normalizes "FACT" to "fact"', () => {
      expect(normalizeClaimType('FACT')).toBe('fact');
    });

    it('normalizes "QUESTION" to "question"', () => {
      expect(normalizeClaimType('QUESTION')).toBe('question');
    });

    it('normalizes "SUMMARY" to "summary"', () => {
      expect(normalizeClaimType('SUMMARY')).toBe('summary');
    });
  });

  describe('with mixed case values', () => {
    it('normalizes "Insight" to "insight"', () => {
      expect(normalizeClaimType('Insight')).toBe('insight');
    });

    it('normalizes "InStRuCtIoN" to "instruction"', () => {
      expect(normalizeClaimType('InStRuCtIoN')).toBe('instruction');
    });

    it('normalizes "WaRnInG" to "warning"', () => {
      expect(normalizeClaimType('WaRnInG')).toBe('warning');
    });

    it('normalizes "ExAmPlE" to "example"', () => {
      expect(normalizeClaimType('ExAmPlE')).toBe('example');
    });
  });

  describe('with invalid types', () => {
    it('returns undefined for "theory"', () => {
      expect(normalizeClaimType('theory')).toBeUndefined();
    });

    it('returns undefined for "hypothesis"', () => {
      expect(normalizeClaimType('hypothesis')).toBeUndefined();
    });

    it('returns undefined for "idea"', () => {
      expect(normalizeClaimType('idea')).toBeUndefined();
    });

    it('returns undefined for random strings', () => {
      expect(normalizeClaimType('random')).toBeUndefined();
      expect(normalizeClaimType('invalid')).toBeUndefined();
      expect(normalizeClaimType('unknown')).toBeUndefined();
    });

    it('returns undefined for similar but invalid values', () => {
      expect(normalizeClaimType('insights')).toBeUndefined();
      expect(normalizeClaimType('facts')).toBeUndefined();
      expect(normalizeClaimType('opinions')).toBeUndefined();
      expect(normalizeClaimType('questions')).toBeUndefined();
    });

    it('returns undefined for partial matches', () => {
      expect(normalizeClaimType('warn')).toBeUndefined();
      expect(normalizeClaimType('decide')).toBeUndefined();
      expect(normalizeClaimType('instruct')).toBeUndefined();
    });
  });

  describe('with edge cases', () => {
    it('returns undefined for undefined input', () => {
      expect(normalizeClaimType(undefined)).toBeUndefined();
    });

    it('returns undefined for empty string', () => {
      expect(normalizeClaimType('')).toBeUndefined();
    });

    it('returns undefined for whitespace only', () => {
      expect(normalizeClaimType('   ')).toBeUndefined();
      expect(normalizeClaimType('\t\n')).toBeUndefined();
      expect(normalizeClaimType('     ')).toBeUndefined();
    });

    it('does not trim whitespace (whitespace makes value invalid)', () => {
      // The implementation only lowercases, does not trim
      expect(normalizeClaimType('  insight  ')).toBeUndefined();
      expect(normalizeClaimType('\twarning\n')).toBeUndefined();
      expect(normalizeClaimType('  fact  ')).toBeUndefined();
    });

    it('handles values with internal spaces', () => {
      expect(normalizeClaimType('insight fact')).toBeUndefined();
      expect(normalizeClaimType('fact opinion')).toBeUndefined();
    });

    it('handles values with punctuation', () => {
      expect(normalizeClaimType('insight!')).toBeUndefined();
      expect(normalizeClaimType('fact.')).toBeUndefined();
      expect(normalizeClaimType('warning?')).toBeUndefined();
    });

    it('handles numeric values', () => {
      expect(normalizeClaimType('123')).toBeUndefined();
      expect(normalizeClaimType('0')).toBeUndefined();
    });

    it('handles special characters', () => {
      expect(normalizeClaimType('@#$%')).toBeUndefined();
      expect(normalizeClaimType('fact&opinion')).toBeUndefined();
    });
  });
});

describe('CLAIM_TYPES constant', () => {
  it('contains all expected types', () => {
    expect(CLAIM_TYPES).toContain('insight');
    expect(CLAIM_TYPES).toContain('instruction');
    expect(CLAIM_TYPES).toContain('fact');
    expect(CLAIM_TYPES).toContain('mechanism');
    expect(CLAIM_TYPES).toContain('opinion');
    expect(CLAIM_TYPES).toContain('decision');
    expect(CLAIM_TYPES).toContain('warning');
    expect(CLAIM_TYPES).toContain('question');
    expect(CLAIM_TYPES).toContain('summary');
    expect(CLAIM_TYPES).toContain('example');
  });

  it('has exactly 10 types', () => {
    expect(CLAIM_TYPES).toHaveLength(10);
  });
});

describe('CLAIM_CLASSIFICATIONS constant', () => {
  it('contains all expected classifications', () => {
    expect(CLAIM_CLASSIFICATIONS).toContain('fact');
    expect(CLAIM_CLASSIFICATIONS).toContain('mechanism');
    expect(CLAIM_CLASSIFICATIONS).toContain('opinion');
  });

  it('has exactly 3 classifications', () => {
    expect(CLAIM_CLASSIFICATIONS).toHaveLength(3);
  });
});
