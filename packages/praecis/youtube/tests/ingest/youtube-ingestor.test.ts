// SPDX-License-Identifier: Apache-2.0
// Copyright 2025-2026 Colin Farmer (GitCmurf)

import { describe, it, expect, beforeEach } from 'vitest';
import { MockYouTubeClient } from '../../src/client/mock.js';
import { YouTubeIngestor } from '../../src/ingest/youtube-ingestor.js';
import { SOURCE_ID } from '../../src/config/youtube-source-adapter.js';

describe('YouTubeIngestor', () => {
  let client: MockYouTubeClient;
  let ingestor: YouTubeIngestor;

  beforeEach(() => {
    client = new MockYouTubeClient();
    ingestor = new YouTubeIngestor(client);
  });

  it('has sourceId matching SOURCE_ID', () => {
    expect(ingestor.sourceId).toBe(SOURCE_ID);
    expect(ingestor.sourceId).toBe('youtube');
  });

  it('acquires a known video and returns ok result with correct shape', async () => {
    const result = await ingestor.acquire({ ref: 'test-video' });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const raw = result.value;
    expect(raw.canonicalId).toBe('youtube-test-video');
    expect(raw.sourceType).toBe('youtube');
    expect(raw.sensitivity).toBe('public');
    expect(raw.label).toBe('Test Video');
    expect(raw.dedupKeys).toEqual(['test-video']);
  });

  it('sets provenance fields correctly', async () => {
    const fixedIngestor = new YouTubeIngestor(client, { now: () => new Date('2026-05-25T12:34:56.000Z') });
    const result = await fixedIngestor.acquire({ ref: 'test-video' });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const { provenance } = result.value;
    expect(provenance.sourceUri).toBe('https://www.youtube.com/watch?v=test-video');
    expect(provenance.sourceType).toBe('youtube');
    expect(provenance.ingestedAt).toBe('2026-05-25T12:34:56.000Z');
  });

  it('populates payload with video metadata and transcript', async () => {
    const result = await ingestor.acquire({ ref: 'test-video' });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const { payload } = result.value;
    expect(payload.videoId).toBe('test-video');
    expect(payload.title).toBe('Test Video');
    expect(payload.channelId).toBe('UC-test');
    expect(payload.channelName).toBe('Test Channel');
    expect(payload.duration).toBe(300);
    expect(payload.publishedAt).toBe('2025-01-01T00:00:00.000Z');
    expect(payload.thumbnailUrl).toBe('https://example.com/thumb.jpg');
    expect(payload.transcript).not.toBeNull();
    expect(payload.transcript?.videoId).toBe('test-video');
    expect(payload.transcript?.segments).toHaveLength(2);
  });

  it('sets transcript to null when transcript is not available', async () => {
    // no-transcript-video exists in MOCK_VIDEOS but has no entry in MOCK_TRANSCRIPTS
    const result = await ingestor.acquire({ ref: 'no-transcript-video' });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.payload.transcript).toBeNull();
  });

  it('returns error when video is not found', async () => {
    const result = await ingestor.acquire({ ref: 'nonexistent-video' });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.message).toContain('Video not found');
  });

  it('succeeds with a second video that has an available transcript', async () => {
    const result = await ingestor.acquire({ ref: 'test-video-2' });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.payload.transcript).not.toBeNull();
  });
});
