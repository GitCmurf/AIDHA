/**
 * Golden Dataset Integrity Test
 *
 * Validates that the golden dataset fixtures maintain minimum quality standards
 * and structural integrity for benchmarking.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

interface GoldenSample {
  id: string;
  timestamp: number;
  claimText: string;
  domain: string | null;
  classification: string | null;
  evidenceType: string | null;
  isTruePositive: boolean;
  notes: string;
}

interface GoldenDataset {
  videoId: string;
  title: string;
  channel: string;
  description: string;
  samples: GoldenSample[];
  metadata: {
    totalSamples: number;
    truePositives: number;
    falsePositives: number;
    domains: string[];
    classifications: string[];
    evidenceTypes: string[];
  };
}

function loadGoldenDataset(): GoldenDataset {
  const fixturePath = resolve(
    import.meta.dirname || __dirname,
    '../fixtures/extraction-golden/h_1zlead9ZU.samples.json'
  );
  const content = readFileSync(fixturePath, 'utf-8');
  return JSON.parse(content) as GoldenDataset;
}

describe('golden dataset integrity', () => {
  it('has minimum required sample count', () => {
    const dataset = loadGoldenDataset();

    expect(dataset.samples.length).toBeGreaterThanOrEqual(20);
    expect(dataset.metadata.totalSamples).toBe(dataset.samples.length);
  });

  it('has accurate true/false positive counts', () => {
    const dataset = loadGoldenDataset();

    const truePositives = dataset.samples.filter(s => s.isTruePositive).length;
    const falsePositives = dataset.samples.filter(s => !s.isTruePositive).length;

    expect(truePositives).toBe(dataset.metadata.truePositives);
    expect(falsePositives).toBe(dataset.metadata.falsePositives);
    expect(truePositives + falsePositives).toBe(dataset.samples.length);
  });

  it('has balanced true positive to false positive ratio', () => {
    const dataset = loadGoldenDataset();

    // Need at least 60% true positives for quality benchmarking
    const tpRatio = dataset.metadata.truePositives / dataset.metadata.totalSamples;
    expect(tpRatio).toBeGreaterThanOrEqual(0.6);
  });

  it('has all required fields for each sample', () => {
    const dataset = loadGoldenDataset();

    for (const sample of dataset.samples) {
      expect(sample.id).toMatch(/^sample-\d+$/);
      expect(typeof sample.timestamp).toBe('number');
      expect(sample.timestamp).toBeGreaterThanOrEqual(0);
      expect(sample.claimText).toBeTruthy();
      expect(sample.claimText.length).toBeGreaterThan(10);
      expect(sample.notes).toBeTruthy();
      expect(typeof sample.isTruePositive).toBe('boolean');
    }
  });

  it('has valid domain values for true positives', () => {
    const dataset = loadGoldenDataset();

    const truePositives = dataset.samples.filter(s => s.isTruePositive);
    expect(truePositives.length).toBeGreaterThan(0);

    for (const sample of truePositives) {
      expect(sample.domain).toBeTruthy();
      expect(sample.classification).toBeTruthy();
      expect(sample.evidenceType).toBeTruthy();
      expect(dataset.metadata.domains).toContain(sample.domain);
      expect(dataset.metadata.classifications).toContain(sample.classification);
      expect(dataset.metadata.evidenceTypes).toContain(sample.evidenceType);
    }
  });

  it('has null metadata values for false positives', () => {
    const dataset = loadGoldenDataset();

    const falsePositives = dataset.samples.filter(s => !s.isTruePositive);
    expect(falsePositives.length).toBeGreaterThan(0);

    // Count false positives with metadata (some may have metadata but are still false positives,
    // e.g., sponsor CTAs might be classified)
    let withMetadataCount = 0;
    for (const sample of falsePositives) {
      const hasMetadata = sample.domain || sample.classification || sample.evidenceType;
      if (hasMetadata) withMetadataCount++;
    }

    // Most false positives should not have full claim metadata
    // We allow some to have metadata (e.g., sponsor CTAs with classification)
    // but expect the majority to lack complete metadata
    const metadataRatio = withMetadataCount / falsePositives.length;
    expect(metadataRatio).toBeLessThan(0.5); // Less than 50% should have metadata
  });

  it('has valid video metadata', () => {
    const dataset = loadGoldenDataset();

    expect(dataset.videoId).toBe('h_1zlead9ZU');
    expect(dataset.title).toBeTruthy();
    expect(dataset.channel).toBeTruthy();
    expect(dataset.description).toBeTruthy();
  });

  it('has no duplicate sample IDs', () => {
    const dataset = loadGoldenDataset();

    const ids = dataset.samples.map(s => s.id);
    const uniqueIds = new Set(ids);

    expect(ids.length).toBe(uniqueIds.size);
  });

  it('has samples sorted by timestamp', () => {
    const dataset = loadGoldenDataset();

    for (let i = 1; i < dataset.samples.length; i++) {
      expect(dataset.samples[i].timestamp).toBeGreaterThanOrEqual(dataset.samples[i - 1].timestamp);
    }
  });

  it('covers multiple domains and classifications', () => {
    const dataset = loadGoldenDataset();

    expect(dataset.metadata.domains.length).toBeGreaterThanOrEqual(2);
    expect(dataset.metadata.classifications.length).toBeGreaterThanOrEqual(3);
    expect(dataset.metadata.evidenceTypes.length).toBeGreaterThanOrEqual(2);
  });

  it('includes common false positive patterns', () => {
    const dataset = loadGoldenDataset();

    const falsePositives = dataset.samples.filter(s => !s.isTruePositive);
    const notes = falsePositives.map(s => s.notes.toLowerCase()).join(' ');

    // Should include examples of common false positives
    expect(notes).toMatch(/boilerplate|intro|outro|fragment|sponsor|cta/);
  });

  it('has valid evidence types for true positives', () => {
    const dataset = loadGoldenDataset();

    const validEvidenceTypes = [
      'RCT',
      'Meta-analysis',
      'Cohort',
      'Case Study',
      'Review',
      'Expert Opinion',
      'Physiological Consensus',
      'Position Stand',
    ];

    // Check that dataset includes at least some standard evidence types
    for (const type of ['RCT', 'Meta-analysis', 'Physiological Consensus']) {
      expect(dataset.metadata.evidenceTypes).toContain(type);
    }

    const truePositives = dataset.samples.filter(s => s.isTruePositive);
    for (const sample of truePositives) {
      expect(validEvidenceTypes).toContain(sample.evidenceType);
    }
  });

  it('has notes explaining why false positives should be filtered', () => {
    const dataset = loadGoldenDataset();

    const falsePositives = dataset.samples.filter(s => !s.isTruePositive);

    for (const sample of falsePositives) {
      expect(sample.notes).toBeTruthy();
      expect(sample.notes.length).toBeGreaterThan(5);
      // Notes should explain the reason
      expect(sample.notes.toLowerCase()).toMatch(/filtered|deprioritized|boilerplate|fragment|intro|outro|sponsor|cta|pronoun/);
    }
  });
});
