/**
 * Extraction pipeline tests - WRITTEN FIRST (TDD Red Phase)
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { InMemoryStore } from '@aidha/graph-backend';
import { InMemoryRegistry } from '@aidha/taxonomy';
import { MockYouTubeClient } from '../src/client/mock.js';
import { IngestionPipeline } from '../src/pipeline/ingest.js';
import { ClaimExtractionPipeline } from '../src/extract/claims.js';
import { ReferenceExtractionPipeline } from '../src/extract/references.js';

class ConcurrentResourceMetadataStore extends InMemoryStore {
  private didUpdateResource = false;

  override async upsertNode(
    type: Parameters<InMemoryStore['upsertNode']>[0],
    id: Parameters<InMemoryStore['upsertNode']>[1],
    data: Parameters<InMemoryStore['upsertNode']>[2],
    options?: Parameters<InMemoryStore['upsertNode']>[3]
  ): ReturnType<InMemoryStore['upsertNode']> {
    if (!this.didUpdateResource && type === 'Claim') {
      this.didUpdateResource = true;
      const resource = await this.getNode('youtube-test-video');
      if (resource.ok && resource.value) {
        const metadata = {
          ...(resource.value.metadata as Record<string, unknown>),
          concurrentMetadata: 'keep-me',
        };
        await super.upsertNode(
          'Resource',
          resource.value.id,
          {
            label: resource.value.label,
            content: resource.value.content,
            metadata,
          },
          { detectNoop: true }
        );
      }
    }
    return super.upsertNode(type, id, data, options);
  }
}

class TransactionalResourceRunStatsStore extends InMemoryStore {
  private inTx = false;
  public transactionalWriteVerified = false;

  async runInTransaction<T>(work: () => Promise<T>): Promise<T> {
    this.inTx = true;
    try {
      return await work();
    } finally {
      this.inTx = false;
    }
  }

  override async upsertNode(
    type: Parameters<InMemoryStore['upsertNode']>[0],
    id: Parameters<InMemoryStore['upsertNode']>[1],
    data: Parameters<InMemoryStore['upsertNode']>[2],
    options?: Parameters<InMemoryStore['upsertNode']>[3]
  ): ReturnType<InMemoryStore['upsertNode']> {
    if (
      type === 'Resource' &&
      id === 'youtube-test-video' &&
      data.metadata &&
      typeof (data.metadata as Record<string, unknown>)['lastClaimRunAt'] === 'string'
    ) {
      expect(this.inTx).toBe(true);
      this.transactionalWriteVerified = true;
    }
    return super.upsertNode(type, id, data, options);
  }
}

class TransactionalClaimWriteFailureStore extends InMemoryStore {
  private claimEdgeWrites = 0;

  override async upsertEdge(
    subject: Parameters<InMemoryStore['upsertEdge']>[0],
    predicate: Parameters<InMemoryStore['upsertEdge']>[1],
    object: Parameters<InMemoryStore['upsertEdge']>[2],
    data: Parameters<InMemoryStore['upsertEdge']>[3],
    options?: Parameters<InMemoryStore['upsertEdge']>[4]
  ): ReturnType<InMemoryStore['upsertEdge']> {
    if (predicate === 'claimDerivedFrom') {
      this.claimEdgeWrites += 1;
      if (this.claimEdgeWrites === 2) {
        return { ok: false, error: new Error('forced edge failure') };
      }
    }
    return super.upsertEdge(subject, predicate, object, data, options);
  }
}

describe('Extraction pipelines', () => {
  let graphStore: InMemoryStore;
  let taxonomyRegistry: InMemoryRegistry;
  let youtubeClient: MockYouTubeClient;
  let ingestion: IngestionPipeline;

  beforeEach(async () => {
    graphStore = new InMemoryStore();
    taxonomyRegistry = new InMemoryRegistry();
    youtubeClient = new MockYouTubeClient();
    ingestion = new IngestionPipeline({
      graphStore,
      taxonomyRegistry,
      youtubeClient,
    });
  });

  afterEach(async () => {
    await graphStore.close();
    await taxonomyRegistry.close();
  });

  it('extracts claims with provenance edges', async () => {
    await ingestion.ingestPlaylist('test-playlist');

    const claimPipeline = new ClaimExtractionPipeline({ graphStore });
    const result = await claimPipeline.extractClaimsForVideo('test-video');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.claimsCreated).toBeGreaterThan(0);

    const claims = await graphStore.queryNodes({ type: 'Claim' });
    expect(claims.ok).toBe(true);
    if (!claims.ok) return;
    expect(claims.value.items.length).toBeGreaterThan(0);

    const edges = await graphStore.getEdges({ predicate: 'claimDerivedFrom' });
    expect(edges.ok).toBe(true);
    if (!edges.ok) return;
    expect(edges.value.items.length).toBeGreaterThan(0);
  });

  it('extracts references and links claims', async () => {
    await ingestion.ingestPlaylist('test-playlist');

    const claimPipeline = new ClaimExtractionPipeline({ graphStore });
    const claimResult = await claimPipeline.extractClaimsForVideo('test-video');
    expect(claimResult.ok).toBe(true);
    if (!claimResult.ok) return;

    const refPipeline = new ReferenceExtractionPipeline({ graphStore });
    const result = await refPipeline.extractReferencesForVideo('test-video');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.referencesCreated).toBeGreaterThan(0);

    const refs = await graphStore.queryNodes({ type: 'Reference' });
    expect(refs.ok).toBe(true);
    if (!refs.ok) return;
    const urls = refs.value.items.map(ref => ref.metadata?.url).filter(Boolean);
    expect(urls).toContain('https://example.com/docs');

    const edges = await graphStore.getEdges({ predicate: 'claimMentionsReference' });
    expect(edges.ok).toBe(true);
    if (!edges.ok) return;
    expect(edges.value.items.length).toBeGreaterThan(0);
  });

  it('preserves concurrent resource metadata while writing claim run stats', async () => {
    const concurrentStore = new ConcurrentResourceMetadataStore();
    const concurrentIngestion = new IngestionPipeline({
      graphStore: concurrentStore,
      taxonomyRegistry,
      youtubeClient,
    });

    await concurrentIngestion.ingestPlaylist('test-playlist');
    const claimPipeline = new ClaimExtractionPipeline({ graphStore: concurrentStore });
    const result = await claimPipeline.extractClaimsForVideo('test-video');
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const resource = await concurrentStore.getNode('youtube-test-video');
    expect(resource.ok).toBe(true);
    if (!resource.ok) return;
    expect(resource.value?.metadata?.['concurrentMetadata']).toBe('keep-me');
    expect(resource.value?.metadata?.['lastClaimRunAt']).toBeTypeOf('string');

    await concurrentStore.close();
  });

  it('writes claim run stats inside a transaction when supported', async () => {
    const transactionalStore = new TransactionalResourceRunStatsStore();
    const transactionalIngestion = new IngestionPipeline({
      graphStore: transactionalStore,
      taxonomyRegistry,
      youtubeClient,
    });

    await transactionalIngestion.ingestPlaylist('test-playlist');
    const claimPipeline = new ClaimExtractionPipeline({ graphStore: transactionalStore });
    const result = await claimPipeline.extractClaimsForVideo('test-video');
    expect(result.ok).toBe(true);
    expect(transactionalStore.transactionalWriteVerified).toBe(true);

    await transactionalStore.close();
  });

  it('rolls back claim writes when transactional extraction fails', async () => {
    const transactionalStore = new TransactionalClaimWriteFailureStore();
    const transactionalIngestion = new IngestionPipeline({
      graphStore: transactionalStore,
      taxonomyRegistry,
      youtubeClient,
    });

    await transactionalIngestion.ingestPlaylist('test-playlist');

    const excerptResult = await transactionalStore.queryNodes({
      type: 'Excerpt',
      filters: { resourceId: 'youtube-test-video' },
    });
    expect(excerptResult.ok).toBe(true);
    if (!excerptResult.ok) return;
    expect(excerptResult.value.items.length).toBeGreaterThanOrEqual(2);

    const extractor = {
      async extractClaims() {
        return [
          {
            text: 'First transactional claim',
            excerptIds: [excerptResult.value.items[0].id],
            confidence: 0.9,
            method: 'heuristic' as const,
          },
          {
            text: 'Second transactional claim',
            excerptIds: [excerptResult.value.items[1].id],
            confidence: 0.8,
            method: 'heuristic' as const,
          },
        ];
      },
    };

    const claimPipeline = new ClaimExtractionPipeline({
      graphStore: transactionalStore,
      extractor,
    });
    const result = await claimPipeline.extractClaimsForVideo('test-video');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.message).toContain('forced edge failure');

    const claims = await transactionalStore.queryNodes({ type: 'Claim' });
    expect(claims.ok).toBe(true);
    if (!claims.ok) return;
    expect(claims.value.items).toHaveLength(0);

    const edges = await transactionalStore.getEdges({ predicate: 'claimDerivedFrom' });
    expect(edges.ok).toBe(true);
    if (!edges.ok) return;
    expect(edges.value.items).toHaveLength(0);

    const resource = await transactionalStore.getNode('youtube-test-video');
    expect(resource.ok).toBe(true);
    if (!resource.ok) return;
    expect(resource.value?.metadata?.['lastClaimRunAt']).toBeUndefined();

    await transactionalStore.close();
  });
});
