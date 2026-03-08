import { describe, expect, it } from 'vitest';
import { InMemoryStore } from '@aidha/graph-backend';
import { purgeClaimsForVideo } from '../src/extract/purge.js';

class TransactionalPurgeStore extends InMemoryStore {
  private inTx = false;
  private enforce = false;
  private didMutateAfterDelete = false;

  enforceTransactionalReads(): void {
    this.enforce = true;
  }

  disableTransactionalReads(): void {
    this.enforce = false;
  }

  async runInTransaction<T>(work: () => Promise<T>): Promise<T> {
    this.inTx = true;
    try {
      return await work();
    } finally {
      this.inTx = false;
    }
  }

  override async queryNodes(...args: Parameters<InMemoryStore['queryNodes']>): ReturnType<InMemoryStore['queryNodes']> {
    if (this.enforce) {
      expect(this.inTx).toBe(true);
    }
    return super.queryNodes(...args);
  }

  override async getNode(...args: Parameters<InMemoryStore['getNode']>): ReturnType<InMemoryStore['getNode']> {
    if (this.enforce) {
      expect(this.inTx).toBe(true);
    }
    return super.getNode(...args);
  }

  override async deleteNode(...args: Parameters<InMemoryStore['deleteNode']>): ReturnType<InMemoryStore['deleteNode']> {
    const [id] = args;
    const result = await super.deleteNode(...args);
    if (!this.didMutateAfterDelete && id.startsWith('claim-purge-')) {
      this.didMutateAfterDelete = true;
      const resource = await super.getNode('youtube-purge-video');
      if (resource.ok && resource.value) {
        await super.upsertNode(
          'Resource',
          resource.value.id,
          {
            label: 'Updated Label',
            content: resource.value.content,
            metadata: {
              ...(resource.value.metadata as Record<string, unknown>),
              concurrentMetadata: 'keep-me',
            },
          },
          { detectNoop: true }
        );
      }
    }
    return result;
  }
}

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

  it('runs atomically when store supports transactions and preserves latest resource fields', async () => {
    const store = new TransactionalPurgeStore();
    await store.upsertNode('Resource', 'youtube-purge-video', {
      label: 'Purge Video',
      metadata: {
        videoId: 'purge-video',
        keep: 'me',
        lastClaimRunAt: '2026-02-10T00:00:00.000Z',
        lastClaimRunCreated: 1,
        lastClaimRunValidated: 1,
        lastClaimRunValidationErrors: 0,
        lastClaimRunEditorDiagnostics: '{}',
      },
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

    store.enforceTransactionalReads();
    const result = await purgeClaimsForVideo(store, 'purge-video');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.deletedClaims).toBe(1);
    expect(result.value.clearedRunMetadata).toBe(true);

    store.disableTransactionalReads();
    const resource = await store.getNode('youtube-purge-video');
    expect(resource.ok).toBe(true);
    if (!resource.ok) return;
    expect(resource.value?.label).toBe('Updated Label');
    expect(resource.value?.metadata?.['keep']).toBe('me');
    expect(resource.value?.metadata?.['concurrentMetadata']).toBe('keep-me');
    expect(resource.value?.metadata?.['lastClaimRunAt']).toBeUndefined();
    expect(resource.value?.metadata?.['lastClaimRunCreated']).toBeUndefined();
    expect(resource.value?.metadata?.['lastClaimRunValidated']).toBeUndefined();
    expect(resource.value?.metadata?.['lastClaimRunValidationErrors']).toBeUndefined();
    expect(resource.value?.metadata?.['lastClaimRunEditorDiagnostics']).toBeUndefined();

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
