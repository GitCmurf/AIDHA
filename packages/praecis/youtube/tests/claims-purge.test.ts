import { describe, expect, it } from 'vitest';
import { InMemoryStore } from '@aidha/graph-backend';
import { purgeClaimsForVideo } from '../src/extract/purge.js';

describe('purgeClaimsForVideo', () => {
  it('deletes claims for a resource and keeps excerpts/resources', async () => {
    const store = new InMemoryStore();
    await store.upsertNode('Resource', 'youtube-purge-video', {
      label: 'Purge Video',
      metadata: { videoId: 'purge-video' },
    });
    await store.upsertNode('Excerpt', 'excerpt-purge-1', {
      label: 'Excerpt',
      content: 'Example excerpt text',
      metadata: { resourceId: 'youtube-purge-video', videoId: 'purge-video', start: 12 },
    });
    await store.upsertNode('Claim', 'claim-purge-1', {
      label: 'Claim',
      content: 'Claim text',
      metadata: { resourceId: 'youtube-purge-video', videoId: 'purge-video', state: 'accepted' },
    });
    await store.upsertEdge('claim-purge-1', 'claimDerivedFrom', 'excerpt-purge-1', {});

    const result = await purgeClaimsForVideo(store, 'purge-video');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.deletedClaims).toBe(1);
    expect(result.value.resourceId).toBe('youtube-purge-video');

    const claims = await store.queryNodes({ type: 'Claim', filters: { resourceId: 'youtube-purge-video' } });
    expect(claims.ok).toBe(true);
    if (!claims.ok) return;
    expect(claims.value.items).toHaveLength(0);

    const excerpts = await store.queryNodes({ type: 'Excerpt', filters: { resourceId: 'youtube-purge-video' } });
    expect(excerpts.ok).toBe(true);
    if (!excerpts.ok) return;
    expect(excerpts.value.items).toHaveLength(1);

    const edges = await store.getEdges({ predicate: 'claimDerivedFrom' });
    expect(edges.ok).toBe(true);
    if (!edges.ok) return;
    expect(edges.value.items).toHaveLength(0);

    await store.close();
  });

  it('is idempotent when no claims remain', async () => {
    const store = new InMemoryStore();
    await store.upsertNode('Resource', 'youtube-purge-video', {
      label: 'Purge Video',
      metadata: { videoId: 'purge-video' },
    });

    const first = await purgeClaimsForVideo(store, 'purge-video');
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(first.value.deletedClaims).toBe(0);

    const second = await purgeClaimsForVideo(store, 'purge-video');
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.value.deletedClaims).toBe(0);

    await store.close();
  });
});
