import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { InMemoryStore } from '@aidha/graph-backend';
import { findRelatedClaims } from '../src/retrieve/related.js';

describe('related claims', () => {
  let store: InMemoryStore;

  beforeEach(async () => {
    store = new InMemoryStore();
    await store.upsertNode('Resource', 'youtube-related-video', {
      label: 'Related Video',
      metadata: { videoId: 'related-video', url: 'https://www.youtube.com/watch?v=related-video' },
    });
    await store.upsertNode('Excerpt', 'related-excerpt-a', {
      label: 'Excerpt A',
      content: 'Deterministic IDs prevent duplicates.',
      metadata: { resourceId: 'youtube-related-video', start: 20, duration: 5, videoId: 'related-video' },
    });
    await store.upsertNode('Excerpt', 'related-excerpt-b', {
      label: 'Excerpt B',
      content: 'Canonical hashing ensures repeatable IDs.',
      metadata: { resourceId: 'youtube-related-video', start: 3670, duration: 5, videoId: 'related-video' },
    });
    await store.upsertNode('Excerpt', 'related-excerpt-c', {
      label: 'Excerpt C',
      content: 'Sponsor section unrelated content.',
      metadata: { resourceId: 'youtube-related-video', start: 60, duration: 5, videoId: 'related-video' },
    });

    await store.upsertNode('Claim', 'related-target', {
      label: 'Target',
      content: 'Use deterministic IDs for idempotent ingestion.',
      metadata: { resourceId: 'youtube-related-video', videoId: 'related-video', state: 'accepted' },
    });
    await store.upsertNode('Claim', 'related-shared-ref', {
      label: 'Shared reference',
      content: 'Stable hashes reduce duplicates in graph stores.',
      metadata: { resourceId: 'youtube-related-video', videoId: 'related-video', state: 'accepted' },
    });
    await store.upsertNode('Claim', 'related-draft', {
      label: 'Draft related',
      content: 'Deterministic hashes preserve repeatability.',
      metadata: { resourceId: 'youtube-related-video', videoId: 'related-video', state: 'draft' },
    });

    await store.upsertEdge('related-target', 'claimDerivedFrom', 'related-excerpt-a', {}, { detectNoop: true });
    await store.upsertEdge('related-shared-ref', 'claimDerivedFrom', 'related-excerpt-b', {}, { detectNoop: true });
    await store.upsertEdge('related-draft', 'claimDerivedFrom', 'related-excerpt-c', {}, { detectNoop: true });

    await store.upsertNode('Reference', 'ref-1', {
      label: 'Reference 1',
      metadata: { url: 'https://example.com/idempotency', resourceId: 'youtube-related-video' },
    });
    await store.upsertEdge('related-target', 'claimMentionsReference', 'ref-1', {}, { detectNoop: true });
    await store.upsertEdge('related-shared-ref', 'claimMentionsReference', 'ref-1', {}, { detectNoop: true });
  });

  afterEach(async () => {
    await store.close();
  });

  it('ranks related claims by shared signals and excludes drafts by default', async () => {
    const result = await findRelatedClaims(store, { claimId: 'related-target', limit: 5 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.length).toBe(1);
    expect(result.value[0]?.claimId).toBe('related-shared-ref');
    expect(result.value[0]?.timestampLabel).toBe('1:01:10');
    expect(result.value[0]?.sharedReferenceCount).toBeGreaterThan(0);
  });

  it('includes draft claims when requested', async () => {
    const result = await findRelatedClaims(store, {
      claimId: 'related-target',
      includeDrafts: true,
      limit: 5,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.some(hit => hit.claimId === 'related-draft')).toBe(true);
  });
});
