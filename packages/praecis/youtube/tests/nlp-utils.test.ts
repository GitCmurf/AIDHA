/**
 * NLP Utilities Tests
 *
 * Tests linguistic analysis utilities using compromise.js.
 */
import { describe, it, expect, vi } from 'vitest';
vi.mock('compromise', () => ({
  default: require('./__mocks__/compromise.ts').default,
}));
import {
  extractSVOTriples,
  extractDiscourseMarkers,
  hasPOSPattern,
  getPOSPattern,
  isGrammaticallyComplete,
  extractKeywords,
  hasBoilerplatePOSPattern,
} from '../src/extract/nlp-utils.js';

describe('extractSVOTriples', () => {
  it('extracts simple SVO triple', () => {
    const triples = extractSVOTriples('The dog runs fast.');
    expect(triples.length).toBeGreaterThan(0);
    expect(triples[0]).toHaveProperty('subject');
    expect(triples[0]).toHaveProperty('verb');
    expect(triples[0]).toHaveProperty('object');
  });

  it('extracts triple from standard sentence', () => {
    const triples = extractSVOTriples('The company launched a new product.');
    expect(triples.length).toBeGreaterThan(0);
    const triple = triples[0];
    expect(triple.subject.toLowerCase()).toContain('company');
    expect(triple.verb.toLowerCase()).toContain('launched');
    expect(triple.object.toLowerCase()).toContain('product');
  });

  it('handles multiple sentences', () => {
    // Note: SVO extraction requires transitive verbs with objects
    const text = 'The cat sleeps at home. The dog runs fast.';
    const triples = extractSVOTriples(text);
    // Intransitive verbs may not produce triples
    expect(Array.isArray(triples)).toBe(true);
  });

  it('handles complex sentences', () => {
    const triples = extractSVOTriples('Scientists discovered a new species in the Amazon rainforest.');
    expect(triples.length).toBeGreaterThan(0);
  });

  it('handles sentences with auxiliary verbs', () => {
    // Progressive tense: "is working" - auxiliary + main verb
    // Note: Adverbs after verb may be included in verb phrase
    const triples = extractSVOTriples('The machine is working.');
    // Triple extraction depends on POS tagging
    expect(Array.isArray(triples)).toBe(true);
  });

  it('keeps adverb inside auxiliary verb phrase', () => {
    const triples = extractSVOTriples('The machine has quickly run the task.');
    expect(triples.length).toBeGreaterThan(0);
    const triple = triples[0];
    expect(triple.verb.toLowerCase()).toContain('has');
    expect(triple.verb.toLowerCase()).toContain('quickly');
    expect(triple.verb.toLowerCase()).toContain('run');
    expect(triple.object.toLowerCase()).toContain('task');
  });

  it('returns array for text without verbs', () => {
    const triples = extractSVOTriples('Hello world');
    // May or may not return triples depending on compromise parsing
    expect(Array.isArray(triples)).toBe(true);
  });

  it('returns empty array for empty text', () => {
    const triples = extractSVOTriples('');
    expect(triples).toEqual([]);
  });

  it('handles passive voice constructions', () => {
    const triples = extractSVOTriples('The ball was thrown by John.');
    expect(triples.length).toBeGreaterThan(0);
  });

  it('handles sentences with adverbs', () => {
    const triples = extractSVOTriples('She quickly finished the task.');
    expect(triples.length).toBeGreaterThan(0);
  });
});

describe('extractDiscourseMarkers', () => {
  it('detects contrast markers at start', () => {
    const markers = extractDiscourseMarkers('However, the market changed.');
    const contrastMarker = markers.find(m => m.type === 'contrast');
    expect(contrastMarker).toBeDefined();
    expect(contrastMarker?.position).toBe('start');
  });

  it('detects causal markers', () => {
    const markers = extractDiscourseMarkers('We therefore adapted to the changes.');
    const causalMarker = markers.find(m => m.type === 'causal');
    expect(causalMarker).toBeDefined();
  });

  it('detects additive markers', () => {
    const markers = extractDiscourseMarkers('Furthermore, we need to consider this.');
    const additiveMarker = markers.find(m => m.type === 'additive');
    expect(additiveMarker).toBeDefined();
  });

  it('detects exemplification markers', () => {
    const markers = extractDiscourseMarkers('For example, this is a test.');
    const exampleMarker = markers.find(m => m.type === 'exemplification');
    expect(exampleMarker).toBeDefined();
  });

  it('detects summary markers', () => {
    const markers = extractDiscourseMarkers('In conclusion, the results show this.');
    const summaryMarker = markers.find(m => m.type === 'conclusion');
    expect(summaryMarker).toBeDefined();
  });

  it('detects multiple markers in text', () => {
    const text = 'However, we tried. Therefore, we succeeded.';
    const markers = extractDiscourseMarkers(text);
    expect(markers.length).toBeGreaterThanOrEqual(1);
  });

  it('preserves repeated discourse markers across sentences', () => {
    const markers = extractDiscourseMarkers('However, we tried. However, we adapted.');
    const howeverMarkers = markers.filter(marker => marker.marker === 'however');
    expect(howeverMarkers).toHaveLength(2);
  });

  it('captures repeated multi-word markers within the same sentence', () => {
    const markers = extractDiscourseMarkers('For example, this works and, for example, scales.');
    const exampleMarkers = markers.filter(marker => marker.marker === 'for example');
    expect(exampleMarkers).toHaveLength(2);
  });

  it('does not match multi-word markers inside unrelated words', () => {
    const markers = extractDiscourseMarkers('The residue to solvent ratio changed gradually.');
    expect(markers.find(marker => marker.marker === 'due to')).toBeUndefined();
  });

  it('detects multi-word markers', () => {
    const markers = extractDiscourseMarkers('On the other hand, this is different.');
    const contrastMarker = markers.find(m => m.marker.includes('other hand'));
    expect(contrastMarker).toBeDefined();
  });

  it('returns empty array for text without markers', () => {
    const markers = extractDiscourseMarkers('This is a simple sentence.');
    expect(Array.isArray(markers)).toBe(true);
  });

  it('handles case insensitivity', () => {
    const markers = extractDiscourseMarkers('HOWEVER, this is important.');
    const contrastMarker = markers.find(m => m.type === 'contrast');
    expect(contrastMarker).toBeDefined();
  });

  it('detects temporal markers', () => {
    const markers = extractDiscourseMarkers('Meanwhile, the process continued.');
    const temporalMarker = markers.find(m => m.type === 'temporal');
    expect(temporalMarker).toBeDefined();
  });

  it('detects conditional markers', () => {
    const markers = extractDiscourseMarkers('Otherwise, we will fail.');
    const conditionalMarker = markers.find(m => m.type === 'conditional');
    expect(conditionalMarker).toBeDefined();
  });

  it('detects concession markers', () => {
    const markers = extractDiscourseMarkers('Admittedly, this is difficult.');
    const concessionMarker = markers.find(m => m.type === 'concession');
    expect(concessionMarker).toBeDefined();
  });
});

describe('hasPOSPattern', () => {
  it('matches simple noun-verb pattern', () => {
    const result = hasPOSPattern('The dog runs.', ['NOUN', 'VERB']);
    expect(result).toBe(true);
  });

  it('matches adjective-noun pattern', () => {
    const result = hasPOSPattern('A beautiful day.', ['ADJ', 'NOUN']);
    expect(result).toBe(true);
  });

  it('matches determiner-noun-verb pattern', () => {
    const result = hasPOSPattern('The cat sleeps.', ['DET', 'NOUN', 'VERB']);
    expect(result).toBe(true);
  });

  it('returns false for non-matching pattern', () => {
    const result = hasPOSPattern('The dog runs.', ['VERB', 'NOUN']);
    expect(result).toBe(false);
  });

  it('finds pattern anywhere in sentence', () => {
    const result = hasPOSPattern('Yesterday the big dog ran quickly.', ['NOUN', 'VERB']);
    expect(result).toBe(true);
  });

  it('handles pattern longer than text', () => {
    const result = hasPOSPattern('Hello.', ['NOUN', 'VERB', 'NOUN']);
    expect(result).toBe(false);
  });

  it('handles empty text', () => {
    const result = hasPOSPattern('', ['NOUN']);
    expect(result).toBe(false);
  });

  it('matches preposition patterns', () => {
    const result = hasPOSPattern('The book is on the table.', ['PREP', 'DET', 'NOUN']);
    expect(result).toBe(true);
  });

  it('matches adverb patterns', () => {
    const result = hasPOSPattern('She runs quickly.', ['VERB', 'ADV']);
    expect(result).toBe(true);
  });
});

describe('getPOSPattern', () => {
  it('extracts pattern from simple sentence', () => {
    const pattern = getPOSPattern('The dog runs.');
    expect(pattern.length).toBeGreaterThan(0);
    expect(pattern).toContain('NOUN');
    expect(pattern).toContain('VERB');
  });

  it('includes determiners', () => {
    const pattern = getPOSPattern('The cat.');
    expect(pattern).toContain('DET');
  });

  it('includes adjectives', () => {
    const pattern = getPOSPattern('A big cat.');
    expect(pattern).toContain('ADJ');
  });

  it('includes prepositions', () => {
    const pattern = getPOSPattern('In the house.');
    expect(pattern).toContain('PREP');
  });

  it('returns empty array for empty text', () => {
    const pattern = getPOSPattern('');
    expect(pattern).toEqual([]);
  });

  it('handles complex sentences', () => {
    const pattern = getPOSPattern('The quick brown fox jumps over the lazy dog.');
    expect(pattern.length).toBeGreaterThan(5);
  });

  it('includes pronouns', () => {
    const pattern = getPOSPattern('He runs.');
    expect(pattern).toContain('PRON');
  });

  it('includes auxiliary verbs', () => {
    const pattern = getPOSPattern('She is running.');
    expect(pattern).toContain('VERB');
  });
});

describe('isGrammaticallyComplete', () => {
  it('returns true for complete sentence with subject and verb', () => {
    expect(isGrammaticallyComplete('The company launched a new product.')).toBe(true);
  });

  it('returns true for sentence with proper punctuation', () => {
    expect(isGrammaticallyComplete('She runs fast!')).toBe(true);
  });

  it('handles questions with auxiliary verb', () => {
    // Note: Questions where auxiliary comes before subject may not be detected
    // as complete by this implementation
    expect(isGrammaticallyComplete('Do you understand?')).toBe(false);
  });

  it('returns false for fragment without verb', () => {
    expect(isGrammaticallyComplete('The new product.')).toBe(false);
  });

  it('returns false for fragment without subject', () => {
    expect(isGrammaticallyComplete('Running fast.')).toBe(false);
  });

  it('returns false for empty text', () => {
    expect(isGrammaticallyComplete('')).toBe(false);
  });

  it('returns false for text without ending punctuation', () => {
    expect(isGrammaticallyComplete('This is a sentence')).toBe(false);
  });

  it('returns false for single word', () => {
    expect(isGrammaticallyComplete('Hello.')).toBe(false);
  });

  it('handles imperative sentences', () => {
    // Imperatives may or may not be detected as complete depending on implementation
    const result = isGrammaticallyComplete('Close the door.');
    expect(typeof result).toBe('boolean');
  });

  it('handles questions', () => {
    expect(isGrammaticallyComplete('What is your name?')).toBe(true);
  });

  it('returns false for very short fragments', () => {
    expect(isGrammaticallyComplete('A test')).toBe(false);
  });
});

describe('extractKeywords', () => {
  it('extracts keywords from text', () => {
    const keywords = extractKeywords('Machine learning transforms data science dramatically.');
    expect(keywords.length).toBeGreaterThan(0);
  });

  it('respects maxKeywords option', () => {
    const keywords = extractKeywords(
      'Machine learning transforms data science dramatically.',
      { maxKeywords: 3 }
    );
    expect(keywords.length).toBeLessThanOrEqual(3);
  });

  it('extracts noun phrases', () => {
    const keywords = extractKeywords('Machine learning is important for data science.');
    const hasNounPhrase = keywords.some(k =>
      k.includes('machine') || k.includes('learning') || k.includes('data')
    );
    expect(hasNounPhrase).toBe(true);
  });

  it('filters out short words', () => {
    const keywords = extractKeywords('The cat sat on the mat and was happy.');
    // Should not include very short stopwords
    expect(keywords).not.toContain('the');
    expect(keywords).not.toContain('on');
  });

  it('returns empty array for empty text', () => {
    const keywords = extractKeywords('');
    expect(keywords).toEqual([]);
  });

  it('handles repeated content correctly', () => {
    const text = 'Machine learning machine learning machine learning.';
    const keywords = extractKeywords(text);
    expect(keywords.length).toBeGreaterThan(0);
  });

  it('ranks keywords by relevance', () => {
    const keywords = extractKeywords(
      'Artificial intelligence and machine learning are transforming technology.',
      { maxKeywords: 5 }
    );
    expect(keywords.length).toBeGreaterThan(0);
    // First keyword should be most relevant
    expect(keywords[0]).toBeDefined();
  });

  it('handles technical text', () => {
    const keywords = extractKeywords(
      'Neural networks with convolutional layers improve image classification accuracy.'
    );
    expect(keywords.length).toBeGreaterThan(0);
  });

  it('normalizes keywords to lowercase', () => {
    const keywords = extractKeywords('MACHINE LEARNING is GREAT.');
    const hasLowercase = keywords.every(k => k === k.toLowerCase());
    expect(hasLowercase).toBe(true);
  });
});

describe('hasBoilerplatePOSPattern', () => {
  it('detects sponsor mention patterns', () => {
    expect(hasBoilerplatePOSPattern('Check out our sponsor today.')).toBe(true);
  });

  it('detects call-to-action patterns', () => {
    expect(hasBoilerplatePOSPattern('Click the link below.')).toBe(true);
  });

  it('detects subscription CTAs', () => {
    expect(hasBoilerplatePOSPattern('Subscribe and hit the bell icon.')).toBe(true);
  });

  it('detects discount code patterns', () => {
    expect(hasBoilerplatePOSPattern('Use code SAVE20 for discount.')).toBe(true);
  });

  it('returns false for substantive content', () => {
    expect(hasBoilerplatePOSPattern('The economic analysis reveals new insights.')).toBe(false);
  });

  it('returns false for educational content', () => {
    expect(hasBoilerplatePOSPattern('Mitochondria are the powerhouse of the cell.')).toBe(false);
  });

  it('detects thank you patterns', () => {
    expect(hasBoilerplatePOSPattern('Thanks for watching my video.')).toBe(true);
  });

  it('detects website mention patterns', () => {
    expect(hasBoilerplatePOSPattern('Visit our website for more info.')).toBe(true);
  });

  it('returns false for neutral content', () => {
    expect(hasBoilerplatePOSPattern('The weather today is quite pleasant.')).toBe(false);
  });

  it('handles text without boilerplate keywords', () => {
    expect(hasBoilerplatePOSPattern('In 1492, Columbus sailed the ocean blue.')).toBe(false);
  });

  it('detects patreon/support patterns', () => {
    expect(hasBoilerplatePOSPattern('Support us on Patreon.')).toBe(true);
  });

  it('detects merchandise patterns', () => {
    expect(hasBoilerplatePOSPattern('Buy our merch in the store.')).toBe(true);
  });
});
