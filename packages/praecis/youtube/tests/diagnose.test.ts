import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { InMemoryStore } from '@aidha/graph-backend';
import { MockYouTubeClient } from '../src/client/mock.js';
import type { Result } from '../src/pipeline/types.js';
import { ClaimExtractionPipeline } from '@aidha/praecis-core';
import type { LlmClient, LlmCompletionRequest } from '@aidha/praecis-core';
import { LlmClaimExtractor, getEffectivePromptVersion } from '@aidha/praecis-core';
import { diagnoseTranscript, diagnoseExtraction } from '../src/diagnose/index.js';

class StubLlmClient implements LlmClient {
  private responses: string[];
  private index = 0;
  readonly requests: LlmCompletionRequest[] = [];

  constructor(responses: string[]) {
    this.responses = responses;
  }

  async generate(request: LlmCompletionRequest): Promise<Result<string>> {
    this.requests.push(request);
    const response = this.responses[this.index] ?? '{"claims": []}';
    this.index += 1;
    return { ok: true, value: response };
  }
}

describe('diagnostics', () => {
  let store: InMemoryStore;

  beforeEach(async () => {
    store = new InMemoryStore();
  });

  afterEach(async () => {
    await store.close();
  });

  it('diagnoses transcript availability with segment stats', async () => {
    const client = new MockYouTubeClient();
    const result = await diagnoseTranscript(client, 'test-video', {
      checkTooling: true,
      toolingProbe: async () => ({
        ok: true,
        value: {
          jsRuntime: {
            configured: 'node',
            executable: 'node',
            available: false,
            status: 'error',
            message: 'No supported JavaScript runtime found for yt-dlp.',
          },
          ffmpeg: {
            executable: 'ffmpeg',
            available: false,
            status: 'warn',
            message: 'ffmpeg not found; merged/best formats may be unavailable.',
          },
          ytdlp: {
            executable: 'yt-dlp',
            available: true,
            status: 'ok',
          },
        },
      }),
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.transcriptAvailable).toBe(true);
    expect(result.value.segmentCount).toBeGreaterThan(0);
    expect(result.value.coverageSeconds).toBeGreaterThan(0);
    expect(result.value.jsRuntime?.status).toBe('error');
    expect(result.value.ffmpeg?.status).toBe('warn');
    expect(result.value.issues.length).toBeGreaterThan(0);
  });

  it('diagnoses extraction quality and provenance gaps', async () => {
    await store.upsertNode('Resource', 'youtube-diag-video', {
      label: 'Diag Video',
      metadata: {
        videoId: 'diag-video',
        transcriptStatus: 'available',
      },
    });
    await store.upsertNode('Claim', 'diag-claim-1', {
      label: 'Claim one',
      content: 'Deterministic IDs reduce duplicates.',
      metadata: {
        resourceId: 'youtube-diag-video',
        state: 'accepted',
        method: 'llm',
      },
    });
    await store.upsertNode('Claim', 'diag-claim-2', {
      label: 'Claim two',
      content: 'Missing provenance should be flagged.',
      metadata: {
        resourceId: 'youtube-diag-video',
        state: 'draft',
        method: 'llm',
      },
    });
    await store.upsertNode('Excerpt', 'diag-excerpt-1', {
      label: 'Excerpt',
      content: 'Deterministic IDs reduce duplicates.',
      metadata: { resourceId: 'youtube-diag-video', start: 10, duration: 4 },
    });
    await store.upsertEdge('diag-claim-1', 'claimDerivedFrom', 'diag-excerpt-1', { metadata: {} }, { detectNoop: true });

    const result = await diagnoseExtraction(store, 'diag-video');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.claimCount).toBe(2);
    expect(result.value.claimsWithoutProvenance).toBe(1);
    expect(result.value.byState.draft).toBe(1);
    expect(result.value.byState.accepted).toBe(1);
    expect(result.value.issues.length).toBeGreaterThan(0);
  });

  it('diagnoses editorial extraction from cache without running LLM', async () => {
    const cacheDir = await mkdtemp(join(tmpdir(), 'aidha-diagnose-editor-'));
    const resourceId = 'youtube-editor-video';
    await store.upsertNode('Resource', resourceId, {
      label: 'Editor Video',
      metadata: {
        videoId: 'editor-video',
        transcriptStatus: 'available',
      },
    });
    await store.upsertNode('Excerpt', 'editor-excerpt-1', {
      label: 'Excerpt 1',
      content: 'Define deterministic IDs before processing multiple ingestion runs.',
      metadata: { resourceId, videoId: 'editor-video', start: 0, duration: 5, sequence: 0 },
    });
    await store.upsertNode('Excerpt', 'editor-excerpt-2', {
      label: 'Excerpt 2',
      content: 'Link each claim to excerpts so evidence remains auditable.',
      metadata: { resourceId, videoId: 'editor-video', start: 340, duration: 6, sequence: 1 },
    });

    const client = new StubLlmClient([
      JSON.stringify({
        claims: [
          {
            text: 'Define deterministic IDs before processing multiple ingestion runs.',
            excerptIds: ['editor-excerpt-1'],
            startSeconds: 0,
            type: 'instruction',
            confidence: 0.82,
          },
          {
            text: 'Link each claim to excerpts so evidence remains auditable.',
            excerptIds: ['editor-excerpt-2'],
            startSeconds: 340,
            type: 'insight',
            confidence: 0.79,
          },
        ],
      }),
    ]);
    const extractor = new LlmClaimExtractor({
      client,
      model: 'diag-model',
      promptVersion: 'v1',
      cacheDir,
      chunkMinutes: 10,
      editorVersion: 'v2',
      editorWindowMinutes: 5,
      editorMaxPerWindow: 2,
      editorMinWindows: 2,
    });
    const pipeline = new ClaimExtractionPipeline({ graphStore: store, extractor });
    const extraction = await pipeline.extractClaimsForVideo('youtube-editor-video', { maxClaims: 10 });
    expect(extraction.ok).toBe(true);
    if (!extraction.ok) return;

    const result = await diagnoseExtraction(store, 'editor-video', {
      includeEditor: true,
      model: 'diag-model',
      promptVersion: 'v1',
      chunkMinutes: 10,
      cacheDir,
      editorVersion: 'v2',
      maxClaims: 10,
      windowMinutes: 5,
      maxPerWindow: 2,
      minWindows: 2,
      minWords: 8,
      minChars: 50,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.editorial?.available).toBe(true);
    expect(result.value.editorial?.promptVersion).toContain(':pack:');
    expect(result.value.editorial?.cacheHits).toBeGreaterThan(0);
    expect(result.value.editorial?.consistencyOk).toBe(true);

    await rm(cacheDir, { recursive: true, force: true });
  });

  async function seedQualifiedExtraction() {
    const cacheDir = await mkdtemp(join(tmpdir(), 'aidha-diagnose-qualified-'));
    const resourceId = 'youtube-qualified-video';
    await store.upsertNode('Resource', resourceId, { label: 'Qualified source',
      metadata: { videoId: 'qualified-video', transcriptStatus: 'available' } });
    await store.upsertNode('Excerpt', 'qualified-excerpt', {
      label: 'Evidence', content: 'Deterministic identifiers prevent duplicate graph records during repeated ingestion.',
      metadata: { resourceId, start: 0, duration: 5, sequence: 0 },
    });
    const response = JSON.stringify({ claims: [{
      text: 'Deterministic identifiers prevent duplicate graph records during repeated ingestion.',
      excerptIds: ['qualified-excerpt'], confidence: 0.9, type: 'mechanism',
    }] });
    const client = new StubLlmClient([response, response]);
    const extractor = new LlmClaimExtractor({ client, model: 'diag-model',
      promptVersion: 'pass1-claim-mining-v2', promptPackId: 'enumeration-framework-v2', cacheDir });
    const extraction = await new ClaimExtractionPipeline({ graphStore: store, extractor })
      .extractClaimsForVideo(resourceId, { maxClaims: 10 });
    if (!extraction.ok) throw extraction.error;
    const found = await store.getNode(resourceId);
    if (!found.ok) throw found.error;
    if (!found.value) throw new Error('Expected real extraction Resource');
    const version = found.value.metadata?.['lastClaimRunPromptVersion'];
    if (typeof version !== 'string') throw new Error('Expected actual candidate prompt version in Resource metadata');
    expect(version).toBe(getEffectivePromptVersion('pass1-claim-mining-v2', 'enumeration-framework-v2'));
    expect(client.requests).toHaveLength(1);
    return { cacheDir, resource: found.value, client, response, version };
  }

  it.each(['resource', 'claim'] as const)('infers a revisioned non-generic cache from actual %s metadata', async metadataSource => {
    const seeded = await seedQualifiedExtraction();
    try {
      if (metadataSource === 'claim') {
        const metadata = { ...seeded.resource.metadata };
        delete metadata['lastClaimRunPromptVersion'];
        await store.upsertNode('Resource', seeded.resource.id, { label: seeded.resource.label, metadata });
      }
      const result = await diagnoseExtraction(store, 'qualified-video', { includeEditor: true, cacheDir: seeded.cacheDir });
      if (!result.ok) throw result.error;
      expect(result.value.editorial?.available).toBe(true);
      expect(result.value.editorial?.cacheHits).toBe(1);
      expect(result.value.editorial?.promptVersion).toBe(seeded.version);
      expect(seeded.client.requests).toHaveLength(1);
    } finally { await rm(seeded.cacheDir, { recursive: true, force: true }); }
  });

  it('normalizes qualified option provenance and honors an explicit pack override for cache lookup', async () => {
    const seeded = await seedQualifiedExtraction();
    try {
      const explicit = await diagnoseExtraction(store, 'qualified-video', { includeEditor: true, cacheDir: seeded.cacheDir,
        promptVersion: 'pass1-claim-mining-v2:pack:enumeration-framework-v2' });
      if (!explicit.ok) throw explicit.error;
      expect(explicit.value.editorial?.available).toBe(true);
      expect(explicit.value.editorial?.promptVersion).toBe(seeded.version);
      const excerpts = await store.queryNodes({ type: 'Excerpt', filters: { resourceId: seeded.resource.id } });
      if (!excerpts.ok) throw excerpts.error;
      await new LlmClaimExtractor({ client: seeded.client, model: 'diag-model', promptVersion: 'pass1-claim-mining-v2',
        promptPackId: 'generic-hierarchy', cacheDir: seeded.cacheDir })
        .extractClaims({ resource: seeded.resource, excerpts: excerpts.value.items });
      expect(seeded.client.requests).toHaveLength(2);
      const override = await diagnoseExtraction(store, 'qualified-video', { includeEditor: true, cacheDir: seeded.cacheDir,
        promptPackId: 'generic-hierarchy' });
      if (!override.ok) throw override.error;
      expect(override.value.editorial?.available).toBe(true);
      expect(override.value.editorial?.cacheHits).toBe(1);
      expect(override.value.editorial?.promptVersion).toBe(
        getEffectivePromptVersion('pass1-claim-mining-v2', 'generic-hierarchy'));
      expect(seeded.client.requests).toHaveLength(2);
    } finally { await rm(seeded.cacheDir, { recursive: true, force: true }); }
  });

  it('reports missing editorial cache with actionable message', async () => {
    await store.upsertNode('Resource', 'youtube-no-cache-video', {
      label: 'No Cache Video',
      metadata: {
        videoId: 'no-cache-video',
        transcriptStatus: 'available',
      },
    });
    await store.upsertNode('Excerpt', 'no-cache-excerpt-1', {
      label: 'Excerpt',
      content: 'No cache present for this transcript yet.',
      metadata: { resourceId: 'youtube-no-cache-video', start: 0, duration: 4, sequence: 0 },
    });
    await store.upsertNode('Claim', 'no-cache-claim-1', {
      label: 'No cache claim',
      content: 'A claim exists but cache files are missing.',
      metadata: {
        resourceId: 'youtube-no-cache-video',
        state: 'accepted',
        method: 'llm',
        model: 'diag-model',
        promptVersion: 'v1',
      },
    });

    const result = await diagnoseExtraction(store, 'no-cache-video', {
      includeEditor: true,
      model: 'diag-model',
      promptVersion: 'v1',
      chunkMinutes: 10,
      cacheDir: join(tmpdir(), 'aidha-diagnose-nonexistent-cache'),
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.editorial?.available).toBe(false);
    expect(result.value.editorial?.message).toContain('No cache found');
  });
});
