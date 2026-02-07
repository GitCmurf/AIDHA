import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { InMemoryStore } from '@aidha/graph-backend';
import { MockYouTubeClient } from '../src/client/mock.js';
import { diagnoseTranscript, diagnoseExtraction } from '../src/diagnose/index.js';

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
});
