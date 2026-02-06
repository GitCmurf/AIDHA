/**
 * Dossier export tests - WRITTEN FIRST (TDD Red Phase)
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { InMemoryStore } from '@aidha/graph-backend';
import { InMemoryRegistry } from '@aidha/taxonomy';
import { MockYouTubeClient } from '../src/client/mock.js';
import { IngestionPipeline } from '../src/pipeline/ingest.js';
import { ClaimExtractionPipeline } from '../src/extract/claims.js';
import { ReferenceExtractionPipeline } from '../src/extract/references.js';
import { DossierExporter } from '../src/export/dossier.js';

describe('DossierExporter', () => {
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

  async function setClaimState(claimId: string, state: 'draft' | 'accepted' | 'rejected') {
    const current = await graphStore.getNode(claimId);
    expect(current.ok).toBe(true);
    if (!current.ok || !current.value) return;
    const metadata = { ...(current.value.metadata ?? {}), state };
    await graphStore.upsertNode(
      'Claim',
      claimId,
      {
        label: current.value.label,
        content: current.value.content,
        metadata,
      },
      { detectNoop: true }
    );
  }

  it('renders a markdown dossier with claims and references', async () => {
    await ingestion.ingestPlaylist('test-playlist');

    const claimPipeline = new ClaimExtractionPipeline({ graphStore });
    await claimPipeline.extractClaimsForVideo('test-video');

    const refPipeline = new ReferenceExtractionPipeline({ graphStore });
    await refPipeline.extractReferencesForVideo('test-video');

    const exporter = new DossierExporter({ graphStore });
    const result = await exporter.renderVideoDossier('test-video');
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const md = result.value;
    expect(md).toContain('# Dossier: Test Video');
    expect(md).toContain('Channel: Test Channel');
    expect(md).toContain('https://www.youtube.com/watch?v=test-video');
    expect(md).toContain('Hello and welcome to this tutorial.');
    expect(md).toContain('Excerpt:');
    expect(md).toContain('https://example.com/docs');
    expect(md).toMatch(/t=\d+s/);
  });

  it('includes timestamped claim lines with excerpts', async () => {
    await ingestion.ingestPlaylist('test-playlist');

    const claimPipeline = new ClaimExtractionPipeline({ graphStore });
    await claimPipeline.extractClaimsForVideo('test-video');

    const exporter = new DossierExporter({ graphStore });
    const result = await exporter.renderVideoDossier('test-video');
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const md = result.value;
    const claimLines = md.split('\n').filter(line => /^\d+\.\s+\[\d+:\d+\]\(.*t=\d+s\)/.test(line));
    expect(claimLines.length).toBeGreaterThan(0);
    const excerptLines = md.split('\n').filter(line => line.trim().startsWith('- Excerpt:'));
    expect(excerptLines.length).toBeGreaterThan(0);
  });

  it('excludes rejected claims from the dossier', async () => {
    await ingestion.ingestPlaylist('test-playlist');

    const claimPipeline = new ClaimExtractionPipeline({ graphStore });
    await claimPipeline.extractClaimsForVideo('test-video');

    const claims = await graphStore.queryNodes({ type: 'Claim' });
    expect(claims.ok).toBe(true);
    if (!claims.ok) return;
    const rejected = claims.value.items[0];
    expect(rejected).toBeTruthy();
    if (!rejected) return;

    await setClaimState(rejected.id, 'rejected');

    const exporter = new DossierExporter({ graphStore });
    const result = await exporter.renderVideoDossier('test-video');
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const md = result.value;
    expect(md).not.toContain(rejected.content ?? rejected.label);
  });
});
