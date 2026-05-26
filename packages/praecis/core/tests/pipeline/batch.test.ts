// SPDX-License-Identifier: Apache-2.0
// Copyright 2025-2026 Colin Farmer (GitCmurf)

import { describe, expect, it } from 'vitest';
import { runBatch } from '../../src/pipeline/batch.js';
import type { RunReport } from '../../src/interfaces/index.js';

const fixedClock = { now: () => new Date('2026-05-25T12:34:56.000Z') };

function report(overrides: Partial<RunReport> = {}): RunReport {
  return {
    sourceId: 'test',
    canonicalId: 'test:a',
    resourceId: 'test:a',
    excerptCount: 0,
    chunkCount: 0,
    segmentCount: 0,
    segments: [],
    chunks: [],
    excerptIds: [],
    claimsExtracted: 0,
    claimIds: [],
    claims: [],
    dedupAction: 'create',
    policyRoute: 'disabled',
    cacheHits: 0,
    cacheWrites: 0,
    tokenUsage: 0,
    spendUsd: 0,
    warnings: [],
    classification: { status: 'disabled', tagsMatched: 0, tagsAssigned: 0, warnings: [] },
    metadataConflictCount: 0,
    references: {
      referencesCreated: 0,
      referencesUpdated: 0,
      referencesNoop: 0,
      referenceEdgesCreated: 0,
      referenceEdgesUpdated: 0,
      referenceEdgesNoop: 0,
    },
    durationMs: 0,
    ...overrides,
  };
}

describe('runBatch', () => {
  it('records deterministic partial-failure telemetry and aggregate reports', async () => {
    const result = await runBatch({
      items: ['a', 'b'],
      clock: fixedClock,
      async runItem(item) {
        if (item === 'b') return { ok: false, error: new Error('boom') };
        return {
          ok: true,
          value: {
            report: report({
              classification: { status: 'completed' as const, tagsMatched: 2, tagsAssigned: 1, warnings: ['classified'] },
              metadataConflictCount: 3,
              references: {
                referencesCreated: 1,
                referencesUpdated: 2,
                referencesNoop: 3,
                referenceEdgesCreated: 4,
                referenceEdgesUpdated: 5,
                referenceEdgesNoop: 6,
              },
              warnings: ['warning'],
            }),
          },
        };
      },
    });

    expect(result.outcome).toBe('completed_with_errors');
    expect(result.total).toBe(2);
    expect(result.completed).toBe(1);
    expect(result.failed).toBe(1);
    expect(result.startedAt).toBe('2026-05-25T12:34:56.000Z');
    expect(result.completedAt).toBe('2026-05-25T12:34:56.000Z');
    expect(result.failures).toEqual([{ item: 'b', message: 'boom', timestamp: '2026-05-25T12:34:56.000Z' }]);
    expect(result.classification).toEqual({ status: 'completed', tagsMatched: 2, tagsAssigned: 1, warnings: ['classified'] });
    expect(result.metadataConflictCount).toBe(3);
    expect(result.references).toEqual({
      referencesCreated: 1,
      referencesUpdated: 2,
      referencesNoop: 3,
      referenceEdgesCreated: 4,
      referenceEdgesUpdated: 5,
      referenceEdgesNoop: 6,
    });
    expect(result.warnings).toEqual(['warning']);
  });

  it('marks all-failure batches as failed', async () => {
    const result = await runBatch({
      items: ['a'],
      clock: fixedClock,
      async runItem() {
        return { ok: false, error: new Error('nope') };
      },
    });

    expect(result.outcome).toBe('failed');
    expect(result.completed).toBe(0);
    expect(result.failed).toBe(1);
  });

  it('preserves item order when concurrency is greater than one', async () => {
    const result = await runBatch({
      items: ['slow', 'fast'],
      clock: fixedClock,
      concurrency: 2,
      async runItem(item) {
        if (item === 'slow') {
          await new Promise(resolve => setTimeout(resolve, 10));
        }
        return { ok: true, value: { report: report({ canonicalId: `test:${item}` }) } };
      },
    });

    expect(result.successes.map(success => success.item)).toEqual(['slow', 'fast']);
    expect(result.successes.map(success => success.value.report.canonicalId)).toEqual(['test:slow', 'test:fast']);
  });
});
