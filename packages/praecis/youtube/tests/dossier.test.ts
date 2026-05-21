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
    expect(md).toMatch(/t=\d+/);
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
    const claimLines = md.split('\n').filter(line => /^\d+\.\s+\[\d+:\d+\]\(.*t=\d+/.test(line));
    expect(claimLines.length).toBeGreaterThan(0);
    const excerptLines = md.split('\n').filter(line => line.trim().startsWith('- Excerpt:'));
    expect(excerptLines.length).toBeGreaterThan(0);
    expect(md).toContain('- Speaker: Host');
  });

  it('excludes rejected claims from the dossier', async () => {
    await ingestion.ingestPlaylist('test-playlist');

    const claimPipeline = new ClaimExtractionPipeline({ graphStore });
    await claimPipeline.extractClaimsForVideo('test-video');

    const claims = await graphStore.queryNodes({ type: 'Claim' });
    expect(claims.ok).toBe(true);
    if (!claims.ok) return;
    const excerpts = await graphStore.queryNodes({
      type: 'Excerpt',
      filters: { resourceId: 'youtube-test-video' },
    });
    expect(excerpts.ok).toBe(true);
    if (!excerpts.ok) return;

    const claimExcerptIdsByClaimId = new Map<string, Set<string>>();
    for (const claim of claims.value.items) {
      const claimEdges = await graphStore.getEdges({
        predicate: 'claimDerivedFrom',
        subject: claim.id,
      });
      expect(claimEdges.ok).toBe(true);
      if (!claimEdges.ok) return;

      claimExcerptIdsByClaimId.set(
        claim.id,
        new Set(claimEdges.value.items.map(edge => edge.object))
      );
    }

    let rejected = undefined;
    for (const claim of claims.value.items) {
      const claimText = (claim.content ?? claim.label ?? '').trim();
      if (!claimText) continue;

      const otherExcerptIds = new Set<string>();
      for (const [otherClaimId, excerptIds] of claimExcerptIdsByClaimId.entries()) {
        if (otherClaimId === claim.id) continue;
        for (const excerptId of excerptIds) {
          otherExcerptIds.add(excerptId);
        }
      }

      const appearsInAnotherClaimExcerpt = excerpts.value.items.some(excerpt => {
        if (!otherExcerptIds.has(excerpt.id)) return false;
        return (excerpt.content ?? '').includes(claimText);
      });

      if (!appearsInAnotherClaimExcerpt) {
        rejected = claim;
        break;
      }
    }
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
      segments: Array<{ id: string; start: number; end: number; duration: number; text: string; speaker?: string }>;
    };
    expect(parsed.videoId).toBe('test-video');
    expect(parsed.resourceId).toBe('youtube-test-video');
    expect(parsed.segments.length).toBeGreaterThan(0);
    expect(parsed.segments[0]?.id).toMatch(/^excerpt-/);
    expect(parsed.segments[0]?.start).toBeTypeOf('number');
    expect(parsed.segments[0]?.duration).toBeTypeOf('number');
    expect(parsed.segments[0]?.text.length).toBeGreaterThan(0);
    expect(parsed.segments[0]?.speaker).toBe('Host');

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

  it('falls back to formatTimestamp label when Excerpt has no locator in metadata', async () => {
    // Manually construct a minimal graph without locator — simulates pre-CP-0d excerpts
    const videoId = 'legacy-video';
    const resourceId = `youtube-${videoId}`;

    await graphStore.upsertNode('Resource', resourceId, {
      label: 'Legacy Video',
      metadata: {
        videoId,
        url: `https://www.youtube.com/watch?v=${videoId}`,
        channelName: 'Legacy Channel',
      },
    });

    const excerptId = 'excerpt-legacy-001';
    // No `locator` key — only raw start/end timestamps
    await graphStore.upsertNode('Excerpt', excerptId, {
      label: 'Legacy excerpt',
      content: 'Old transcript text.',
      metadata: {
        videoId,
        resourceId,
        start: 3661,
        end: 3671,
        duration: 10,
        sequence: 0,
        source: 'youtube',
      },
    });

    const claimId = 'claim-legacy-001';
    await graphStore.upsertNode('Claim', claimId, {
      label: 'Legacy claim',
      content: 'A claim from the old transcript.',
      metadata: {
        resourceId,
        state: 'accepted',
      },
    });

    await graphStore.upsertEdge(claimId, 'claimDerivedFrom', excerptId, {});

    const exporter = new DossierExporter({ graphStore });
    const result = await exporter.buildVideoDossier(videoId);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const dossier = result.value;
    expect(dossier.claims).toHaveLength(1);

    const claim = dossier.claims[0];
    expect(claim).toBeDefined();
    if (!claim) return;

    // Fallback formatter produces h:mm:ss for times >= 3600s
    expect(claim.label).toBe('1:01:01');
    // Deep link uses buildTimestampUrl fallback
    expect(claim.deepLink).toContain('t=3661');
  });
});
