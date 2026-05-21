// SPDX-License-Identifier: Apache-2.0
// Copyright 2025-2026 Colin Farmer (GitCmurf)

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { InMemoryStore } from '../../src/store/index.js';

describe('findResourceByIdentity', () => {
  let store: InMemoryStore;

  beforeEach(() => {
    store = new InMemoryStore();
  });

  afterEach(async () => {
    await store.close();
  });

  it('returns null when no Resource exists', async () => {
    const result = await store.findResourceByIdentity('yt:dQw4w9WgXcQ');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toBeNull();
  });

  it('returns null when no Resource matches the key', async () => {
    await store.upsertNode('Resource', 'res-1', {
      label: 'Some resource',
      metadata: { canonicalId: 'yt:someOtherId', dedupKeys: ['url:https://example.com'] },
    });
    const result = await store.findResourceByIdentity('yt:notFound');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toBeNull();
  });

  it('finds a Resource by canonicalId', async () => {
    await store.upsertNode('Resource', 'res-1', {
      label: 'Never Gonna Give You Up',
      metadata: { canonicalId: 'yt:dQw4w9WgXcQ' },
    });
    const result = await store.findResourceByIdentity('yt:dQw4w9WgXcQ');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).not.toBeNull();
    expect(result.value?.id).toBe('res-1');
  });

  it('finds a Resource by a dedupKey', async () => {
    await store.upsertNode('Resource', 'res-2', {
      label: 'Some article',
      metadata: {
        canonicalId: 'web:sha256:abc123',
        dedupKeys: ['url:https://example.com/article', 'doi:10.1000/xyz123'],
      },
    });
    const result = await store.findResourceByIdentity('url:https://example.com/article');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).not.toBeNull();
    expect(result.value?.id).toBe('res-2');
  });

  it('finds by second dedupKey when first does not match', async () => {
    await store.upsertNode('Resource', 'res-3', {
      label: 'Research paper',
      metadata: {
        dedupKeys: ['url:https://arxiv.org/abs/1234', 'doi:10.1000/xyz789'],
      },
    });
    const result = await store.findResourceByIdentity('doi:10.1000/xyz789');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).not.toBeNull();
    expect(result.value?.id).toBe('res-3');
  });

  it('does not match non-Resource nodes by canonicalId', async () => {
    await store.upsertNode('Excerpt', 'exc-1', {
      label: 'Excerpt',
      metadata: { canonicalId: 'should-not-match' },
    });
    const result = await store.findResourceByIdentity('should-not-match');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toBeNull();
  });
});
