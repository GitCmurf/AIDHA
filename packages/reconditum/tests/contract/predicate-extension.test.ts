// SPDX-License-Identifier: Apache-2.0
// Copyright 2025-2026 Colin Farmer (GitCmurf)

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Predicate } from '../../src/schema/index.js';
import { InMemoryStore } from '../../src/store/index.js';

describe('Predicate enum extension', () => {
  it('includes alsoSeenVia', () => {
    expect(Predicate.options).toContain('alsoSeenVia');
  });

  it('includes corroboratedBy', () => {
    expect(Predicate.options).toContain('corroboratedBy');
  });

  it('still includes all original predicates', () => {
    const values = Predicate.options;
    expect(values).toContain('relatedTo');
    expect(values).toContain('partOf');
    expect(values).toContain('references');
    expect(values).toContain('derivedFrom');
    expect(values).toContain('resourceHasExcerpt');
    expect(values).toContain('claimDerivedFrom');
  });
});

describe('edge creation with new predicates', () => {
  let store: InMemoryStore;

  beforeEach(() => {
    store = new InMemoryStore();
  });

  afterEach(async () => {
    await store.close();
  });

  it('can create an edge with alsoSeenVia predicate', async () => {
    await store.upsertNode('Resource', 'res-yt', { label: 'YouTube video' });
    await store.upsertNode('Resource', 'res-web', { label: 'Web article' });

    const result = await store.upsertEdge('res-yt', 'alsoSeenVia', 'res-web', {});
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.edge.predicate).toBe('alsoSeenVia');
    expect(result.value.created).toBe(true);
  });

  it('can create an edge with corroboratedBy predicate', async () => {
    await store.upsertNode('Resource', 'res-a', { label: 'Resource A' });
    await store.upsertNode('Resource', 'res-b', { label: 'Resource B' });

    const result = await store.upsertEdge('res-a', 'corroboratedBy', 'res-b', {});
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.edge.predicate).toBe('corroboratedBy');
    expect(result.value.created).toBe(true);
  });
});
