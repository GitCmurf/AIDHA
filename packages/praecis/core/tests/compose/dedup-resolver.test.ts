// SPDX-License-Identifier: Apache-2.0
// Copyright 2025-2026 Colin Farmer (GitCmurf)

import { describe, it, expect, beforeEach } from 'vitest';
import { InMemoryStore } from '@aidha/graph-backend';
import type { GraphStore } from '@aidha/graph-backend';
import { DedupResolver } from '../../src/compose/dedup-resolver.js';
import type { RawSource } from '../../src/types/index.js';
import { urlCanonical } from '../../src/utils/url-canonical.js';

async function seedResource(store: GraphStore, canonicalId: string, dedupKeys: string[] = []) {
  await store.upsertNode('Resource', canonicalId, {
    label: canonicalId,
    metadata: { canonicalId, dedupKeys, sourceType: 'web', provenances: [] },
  });
}

function makeSource(canonicalId: string, dedupKeys?: string[]): RawSource {
  return {
    canonicalId,
    dedupKeys,
    sourceType: 'web',
    sensitivity: 'public',
    provenance: { ingestedAt: new Date().toISOString(), sourceType: 'web' },
    payload: {},
    label: canonicalId,
  };
}

describe('DedupResolver', () => {
  let store: InMemoryStore;
  let resolver: DedupResolver;

  beforeEach(() => {
    store = new InMemoryStore();
    resolver = new DedupResolver(store);
  });

  it('1. No match → create', async () => {
    const result = await resolver.resolve(makeSource('web:https://new.example.com/page'));
    expect(result).toEqual({ ok: true, value: { action: 'create' } });
  });

  it('2. CanonicalId match → merge', async () => {
    await seedResource(store, 'web:https://example.com/article');
    const result = await resolver.resolve(makeSource('web:https://example.com/article'));
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('unreachable');
    expect(result.value.action).toBe('merge');
    expect(result.value.matchedKey).toBe('web:https://example.com/article');
    expect(result.value.matchedNode).toBeDefined();
  });

  it('3. Strong dedupKey match → merge', async () => {
    const canonicalId = 'web:https://canonical.example.com/article';
    await seedResource(store, canonicalId);
    // source has a different canonicalId but a web: dedupKey that matches
    const src = makeSource('web:https://other.example.com/article', [canonicalId]);
    const result = await resolver.resolve(src);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('unreachable');
    expect(result.value.action).toBe('merge');
    expect(result.value.matchedKey).toBe(canonicalId);
  });

  it('4. Weak dedupKey match → corroborate', async () => {
    const shaKey = 'content-sha256:abc123';
    await seedResource(store, 'web:https://example.com/article', [shaKey]);
    // The store node's canonicalId is 'web:https://example.com/article'
    // Source has different canonicalId, but weak dedupKey matches that node via its dedupKey
    const src = makeSource('rss:https://feed.example.com:item-guid-789', [shaKey]);
    const result = await resolver.resolve(src);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('unreachable');
    expect(result.value.action).toBe('corroborate');
    expect(result.value.matchedKey).toBe(shaKey);
  });

  it('5. URL cross-vector (web↔rss) same canonical → merge', async () => {
    // Both derive the same canonical URL — path case must match
    const canonical = urlCanonical('https://Example.com/article?utm_source=email');
    await seedResource(store, canonical);
    const src = makeSource(urlCanonical('https://example.com/article'));
    const result = await resolver.resolve(src);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('unreachable');
    expect(result.value.action).toBe('merge');
  });

  it('6. RSS fallback (no article URL) → create', async () => {
    const src = makeSource('rss:https://feed.example.com/atom.xml:item-guid-123');
    const result = await resolver.resolve(src);
    expect(result).toEqual({ ok: true, value: { action: 'create' } });
  });

  it('7. Readwise with source_url → merge', async () => {
    const canonical = urlCanonical('https://example.com/article');
    await seedResource(store, canonical);
    const src = makeSource(canonical);
    const result = await resolver.resolve(src);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('unreachable');
    expect(result.value.action).toBe('merge');
  });

  it('8. Readwise without source_url → create', async () => {
    const src = makeSource('readwise:book:987');
    const result = await resolver.resolve(src);
    expect(result).toEqual({ ok: true, value: { action: 'create' } });
  });

  it('9. Multiple dedupKeys: first weak no-match, second strong match → merge', async () => {
    const webKey = 'web:https://example.com/article';
    await seedResource(store, webKey);
    // First key is weak and won't find a node; second is strong and finds the seeded one
    const src = makeSource('rss:https://feed.example.com:item-123', [
      'content-sha256:nomatch',
      webKey,
    ]);
    const result = await resolver.resolve(src);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('unreachable');
    expect(result.value.action).toBe('merge');
    expect(result.value.matchedKey).toBe(webKey);
  });

  it('10. findResourceByIdentity returns null → create', async () => {
    // Empty store, nothing to match
    const src = makeSource('web:https://example.com/no-match');
    const result = await resolver.resolve(src);
    expect(result).toEqual({ ok: true, value: { action: 'create' } });
  });
});
