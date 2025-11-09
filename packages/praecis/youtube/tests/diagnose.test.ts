import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { InMemoryStore } from '@aidha/graph-backend';
import { MockYouTubeClient } from '../src/client/mock.js';
import type { Result } from '../src/pipeline/types.js';
import { ClaimExtractionPipeline } from '../src/extract/claims.js';
import type { LlmClient, LlmCompletionRequest } from '../src/extract/llm-client.js';
import { LlmClaimExtractor } from '../src/extract/llm-claims.js';
import { diagnoseTranscript, diagnoseExtraction } from '../src/diagnose/index.js';

class StubLlmClient implements LlmClient {
  private responses: string[];
  private index = 0;

  constructor(responses: string[]) {
    this.responses = responses;
  }

  async generate(_request: LlmCompletionRequest): Promise<Result<string>> {
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
    await store.upsertEdge('diag-claim-1', 'claimDerivedFrom', 'diag-excerpt-1', {}, { detectNoop: true });

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
    const extraction = await pipeline.extractClaimsForVideo('editor-video', { maxClaims: 10 });
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
    expect(result.value.editorial?.cacheHits).toBeGreaterThan(0);
    expect(result.value.editorial?.consistencyOk).toBe(true);

    await rm(cacheDir, { recursive: true, force: true });
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
