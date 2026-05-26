// SPDX-License-Identifier: Apache-2.0
// Copyright 2025-2026 Colin Farmer (GitCmurf)

import { describe, expect, it } from 'vitest';
import { runBatch } from '../../src/pipeline/batch.js';

const fixedClock = { now: () => new Date('2026-05-25T12:34:56.000Z') };

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
            classification: { status: 'completed' as const, tagsMatched: 2, tagsAssigned: 1, warnings: ['classified'] },
            metadataConflictCount: 3,
            warnings: ['warning'],
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
});
