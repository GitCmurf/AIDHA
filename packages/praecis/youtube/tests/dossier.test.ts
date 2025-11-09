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
import type { ClaimState } from '../src/utils/claim-state.js';

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

  async function setAllClaimStates(state: ClaimState): Promise<string[]> {
    const claims = await graphStore.queryNodes({ type: 'Claim' });
    expect(claims.ok).toBe(true);
    if (!claims.ok) return [];
    const ids: string[] = [];
    for (const claim of claims.value.items) {
      await setClaimState(claim.id, state);
      ids.push(claim.id);
    }
    return ids;
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

  it('renders draft claims when state filters include drafts', async () => {
    await ingestion.ingestPlaylist('test-playlist');
    const claimPipeline = new ClaimExtractionPipeline({ graphStore });
    await claimPipeline.extractClaimsForVideo('test-video');

    const claimIds = await setAllClaimStates('draft');
    expect(claimIds.length).toBeGreaterThan(0);

    const exporter = new DossierExporter({ graphStore });
    const acceptedOnly = await exporter.renderVideoDossier('test-video');
    expect(acceptedOnly.ok).toBe(true);
    if (!acceptedOnly.ok) return;
    expect(acceptedOnly.value).toContain('_No claims extracted._');

    const draftIncluded = await exporter.renderVideoDossier('test-video', {
      states: ['accepted', 'draft'],
    });
    expect(draftIncluded.ok).toBe(true);
    if (!draftIncluded.ok) return;
    expect(draftIncluded.value).not.toContain('_No claims extracted._');
    expect(draftIncluded.value).toContain('[draft]');
  });

  it('exports transcript segments as deterministic JSON', async () => {
    await ingestion.ingestPlaylist('test-playlist');
    const exporter = new DossierExporter({ graphStore });

    const transcript = await exporter.exportTranscriptJson('test-video');
    expect(transcript.ok).toBe(true);
    if (!transcript.ok) return;

    const parsed = JSON.parse(transcript.value) as {
      videoId: string;
      resourceId: string;
      segments: Array<{ id: string; start: number; end: number; duration: number; text: string }>;
    };
    expect(parsed.videoId).toBe('test-video');
    expect(parsed.resourceId).toBe('youtube-test-video');
    expect(parsed.segments.length).toBeGreaterThan(0);
    expect(parsed.segments[0]?.id).toMatch(/^excerpt-/);
    expect(parsed.segments[0]?.start).toBeTypeOf('number');
    expect(parsed.segments[0]?.duration).toBeTypeOf('number');
    expect(parsed.segments[0]?.text.length).toBeGreaterThan(0);

    const second = await exporter.exportTranscriptJson('test-video');
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.value).toBe(transcript.value);
  });

  it('exports playlist transcript JSON with per-video segments', async () => {
    await ingestion.ingestPlaylist('test-playlist');
    const exporter = new DossierExporter({ graphStore });
    const result = await exporter.exportPlaylistTranscriptJson({
      playlistId: 'test-playlist',
      url: 'https://www.youtube.com/playlist?list=test-playlist',
      videoIds: ['test-video'],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const payload = JSON.parse(result.value) as {
      playlistId: string;
      videos: Array<{ videoId: string; segments: Array<{ id: string }> }>;
    };
    expect(payload.playlistId).toBe('test-playlist');
    expect(payload.videos.length).toBe(1);
    expect(payload.videos[0]?.videoId).toBe('test-video');
    expect((payload.videos[0]?.segments ?? []).length).toBeGreaterThan(0);
  });
});
