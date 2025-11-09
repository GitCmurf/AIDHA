import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { GraphStore } from '@aidha/graph-backend';
import { InMemoryStore } from '@aidha/graph-backend';
import { getReviewQueue, applyReviewAction } from '../src/review/index.js';

class FaultyInMemoryStore extends InMemoryStore {
  failNodeId?: string;

  override async upsertNode(
    type: Parameters<InMemoryStore['upsertNode']>[0],
    id: Parameters<InMemoryStore['upsertNode']>[1],
    data: Parameters<InMemoryStore['upsertNode']>[2],
    options?: Parameters<InMemoryStore['upsertNode']>[3]
  ): ReturnType<InMemoryStore['upsertNode']> {
    if (this.failNodeId && type === 'Claim' && id === this.failNodeId) {
      return { ok: false, error: new Error(`Injected failure for ${id}`) };
    }
    return super.upsertNode(type, id, data, options);
  }
}

class ConcurrentMutationStore extends InMemoryStore {
  mutateClaimId?: string;
  private didMutate = false;

  override async runInTransaction<T>(
    work: Parameters<InMemoryStore['runInTransaction']>[0]
  ): ReturnType<InMemoryStore['runInTransaction']> {
    if (!this.didMutate && this.mutateClaimId) {
      this.didMutate = true;
      const claim = await this.getNode(this.mutateClaimId);
      if (claim.ok && claim.value) {
        const metadata = {
          ...(claim.value.metadata as Record<string, unknown>),
          concurrentWrite: 'preserve-me',
        };
        await super.upsertNode(
          'Claim',
          claim.value.id,
          {
            label: claim.value.label,
            content: claim.value.content,
            metadata,
          },
          { detectNoop: true }
        );
      }
    }
    return super.runInTransaction(work);
  }
}

class NonTransactionalStoreProxy implements GraphStore {
  constructor(private readonly store: InMemoryStore) {}

  upsertNode(...args: Parameters<InMemoryStore['upsertNode']>) {
    return this.store.upsertNode(...args);
  }

  getNode(...args: Parameters<InMemoryStore['getNode']>) {
    return this.store.getNode(...args);
  }

  queryNodes(...args: Parameters<InMemoryStore['queryNodes']>) {
    return this.store.queryNodes(...args);
  }

  upsertEdge(...args: Parameters<InMemoryStore['upsertEdge']>) {
    return this.store.upsertEdge(...args);
  }

  getEdges(...args: Parameters<InMemoryStore['getEdges']>) {
    return this.store.getEdges(...args);
  }

  deleteNode(...args: Parameters<InMemoryStore['deleteNode']>) {
    return this.store.deleteNode(...args);
  }

  exportSnapshot(...args: Parameters<InMemoryStore['exportSnapshot']>) {
    return this.store.exportSnapshot(...args);
  }

  close() {
    return this.store.close();
  }
}

describe('review workflow', () => {
  let store: InMemoryStore;

  beforeEach(async () => {
    store = new InMemoryStore();
    await store.upsertNode('Resource', 'youtube-review-video', {
      label: 'Review Video',
      metadata: { videoId: 'review-video', url: 'https://www.youtube.com/watch?v=review-video' },
    });
    await store.upsertNode('Excerpt', 'review-excerpt-1', {
      label: 'Excerpt 1',
      content: 'Deterministic IDs avoid duplicate graph nodes.',
      metadata: { resourceId: 'youtube-review-video', start: 12, duration: 4, videoId: 'review-video' },
    });
    await store.upsertNode('Excerpt', 'review-excerpt-2', {
      label: 'Excerpt 2',
      content: 'Use stable hashes over canonical fields.',
      metadata: { resourceId: 'youtube-review-video', start: 44, duration: 4, videoId: 'review-video' },
    });
    await store.upsertNode('Claim', 'review-claim-draft', {
      label: 'Draft claim',
      content: 'Deterministic IDs avoid duplicate graph nodes.',
      metadata: { resourceId: 'youtube-review-video', videoId: 'review-video', state: 'draft' },
    });
    await store.upsertNode('Claim', 'review-claim-accepted', {
      label: 'Accepted claim',
      content: 'Stable hashes should use canonical field ordering.',
      metadata: { resourceId: 'youtube-review-video', videoId: 'review-video', state: 'accepted' },
    });
    await store.upsertEdge('review-claim-draft', 'claimDerivedFrom', 'review-excerpt-1', {}, { detectNoop: true });
    await store.upsertEdge('review-claim-accepted', 'claimDerivedFrom', 'review-excerpt-2', {}, { detectNoop: true });
  });

  afterEach(async () => {
    await store.close();
  });

  it('returns draft claims by default for review queue', async () => {
    const result = await getReviewQueue(store, { videoId: 'review-video' });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.length).toBe(1);
    expect(result.value[0]?.claimId).toBe('review-claim-draft');
    expect(result.value[0]?.timestampSeconds).toBe(12);
  });

  it('applies batch review actions including accept, tag, and task creation', async () => {
    const action = await applyReviewAction(store, {
      claimIds: ['review-claim-draft'],
      state: 'accepted',
      text: 'Use deterministic IDs to keep ingestion idempotent.',
      tags: ['idempotency'],
      createTask: {
        title: 'Document deterministic ID approach',
        projectId: 'inbox',
      },
    });
    expect(action.ok).toBe(true);
    if (!action.ok) return;
    expect(action.value.updatedClaims).toBe(1);
    expect(action.value.createdTasks).toBe(1);

    const claim = await store.getNode('review-claim-draft');
    expect(claim.ok).toBe(true);
    if (!claim.ok) return;
    expect(claim.value?.metadata?.['state']).toBe('accepted');
    expect(claim.value?.content).toContain('idempotent');

    const tagEdges = await store.getEdges({ subject: 'review-claim-draft', predicate: 'aboutTag' });
    expect(tagEdges.ok).toBe(true);
    if (!tagEdges.ok) return;
    expect(tagEdges.value.items.length).toBe(1);
  });

  it('rolls back all claim updates if a later claim write fails', async () => {
    const faultyStore = new FaultyInMemoryStore();
    await faultyStore.upsertNode('Resource', 'youtube-review-video', {
      label: 'Review Video',
      metadata: { videoId: 'review-video', url: 'https://www.youtube.com/watch?v=review-video' },
    });
    await faultyStore.upsertNode('Claim', 'claim-a', {
      label: 'Claim A',
      content: 'First claim text.',
      metadata: { resourceId: 'youtube-review-video', videoId: 'review-video', state: 'draft' },
    });
    await faultyStore.upsertNode('Claim', 'claim-b', {
      label: 'Claim B',
      content: 'Second claim text.',
      metadata: { resourceId: 'youtube-review-video', videoId: 'review-video', state: 'draft' },
    });
    faultyStore.failNodeId = 'claim-b';

    const action = await applyReviewAction(faultyStore, {
      claimIds: ['claim-a', 'claim-b'],
      state: 'accepted',
      tags: ['atomicity'],
    });
    expect(action.ok).toBe(false);

    const claimA = await faultyStore.getNode('claim-a');
    expect(claimA.ok).toBe(true);
    if (claimA.ok) {
      expect(claimA.value?.metadata?.['state']).toBe('draft');
    }

    const claimATags = await faultyStore.getEdges({ subject: 'claim-a', predicate: 'aboutTag' });
    expect(claimATags.ok).toBe(true);
    if (claimATags.ok) {
      expect(claimATags.value.items.length).toBe(0);
    }

    await faultyStore.close();
  });

  it('preserves concurrent metadata writes during transactional review apply', async () => {
    const concurrentStore = new ConcurrentMutationStore();
    await concurrentStore.upsertNode('Resource', 'youtube-review-video', {
      label: 'Review Video',
      metadata: { videoId: 'review-video', url: 'https://www.youtube.com/watch?v=review-video' },
    });
    await concurrentStore.upsertNode('Claim', 'claim-concurrent', {
      label: 'Concurrent Claim',
      content: 'Claim text.',
      metadata: { resourceId: 'youtube-review-video', videoId: 'review-video', state: 'draft' },
    });
    concurrentStore.mutateClaimId = 'claim-concurrent';

    const action = await applyReviewAction(concurrentStore, {
      claimIds: ['claim-concurrent'],
      state: 'accepted',
    });
    expect(action.ok).toBe(true);
    if (!action.ok) return;

    const claim = await concurrentStore.getNode('claim-concurrent');
    expect(claim.ok).toBe(true);
    if (!claim.ok) return;
    expect(claim.value?.metadata?.['state']).toBe('accepted');
    expect(claim.value?.metadata?.['concurrentWrite']).toBe('preserve-me');

    await concurrentStore.close();
  });

  it('deduplicates repeated claim IDs in a single batch', async () => {
    const action = await applyReviewAction(store, {
      claimIds: ['review-claim-draft', 'review-claim-draft'],
      state: 'accepted',
      tags: ['deduped'],
    });
    expect(action.ok).toBe(true);
    if (!action.ok) return;
    expect(action.value.updatedClaims).toBe(1);
    expect(action.value.updatedTags).toBe(1);
  });

  it('rejects multi-claim apply when backend lacks transaction support', async () => {
    const baseStore = new InMemoryStore();
    await baseStore.upsertNode('Resource', 'youtube-review-video', {
      label: 'Review Video',
      metadata: { videoId: 'review-video', url: 'https://www.youtube.com/watch?v=review-video' },
    });
    await baseStore.upsertNode('Claim', 'claim-nt-a', {
      label: 'Claim NT A',
      content: 'Claim NT A',
      metadata: { resourceId: 'youtube-review-video', videoId: 'review-video', state: 'draft' },
    });
    await baseStore.upsertNode('Claim', 'claim-nt-b', {
      label: 'Claim NT B',
      content: 'Claim NT B',
      metadata: { resourceId: 'youtube-review-video', videoId: 'review-video', state: 'draft' },
    });

    const proxy = new NonTransactionalStoreProxy(baseStore);
    const action = await applyReviewAction(proxy, {
      claimIds: ['claim-nt-a', 'claim-nt-b'],
      state: 'accepted',
    });
    expect(action.ok).toBe(false);

    const claimA = await baseStore.getNode('claim-nt-a');
    expect(claimA.ok).toBe(true);
    if (claimA.ok) expect(claimA.value?.metadata?.['state']).toBe('draft');

    const claimB = await baseStore.getNode('claim-nt-b');
    expect(claimB.ok).toBe(true);
    if (claimB.ok) expect(claimB.value?.metadata?.['state']).toBe('draft');

    await baseStore.close();
  });
});
