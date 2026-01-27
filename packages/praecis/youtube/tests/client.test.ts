/**
 * YouTube client tests - WRITTEN FIRST (TDD Red Phase)
 *
 * Uses mock client to test expected behavior without real API calls.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { MockYouTubeClient } from '../src/client/mock.js';
import type { YouTubeClient } from '../src/client/types.js';

describe('YouTubeClient', () => {
  let client: YouTubeClient;

  beforeEach(() => {
    client = new MockYouTubeClient();
  });

  describe('fetchPlaylist', () => {
    it('returns playlist with video IDs', async () => {
      const result = await client.fetchPlaylist('test-playlist');
      expect(result.ok).toBe(true);
      if (!result.ok) return;

      expect(result.value.id).toBe('test-playlist');
      expect(result.value.videoIds.length).toBeGreaterThan(0);
    });

    it('returns error for invalid playlist', async () => {
      const result = await client.fetchPlaylist('invalid-playlist-id');
      expect(result.ok).toBe(false);
    });
  });

  describe('fetchVideo', () => {
    it('returns video metadata', async () => {
      const result = await client.fetchVideo('test-video');
      expect(result.ok).toBe(true);
      if (!result.ok) return;

      expect(result.value.id).toBe('test-video');
      expect(result.value.title).toBeTruthy();
      expect(result.value.duration).toBeGreaterThan(0);
    });

    it('returns error for non-existent video', async () => {
      const result = await client.fetchVideo('non-existent');
      expect(result.ok).toBe(false);
    });
  });

  describe('fetchTranscript', () => {
    it('returns transcript with segments', async () => {
      const result = await client.fetchTranscript('test-video');
      expect(result.ok).toBe(true);
      if (!result.ok) return;

      expect(result.value.videoId).toBe('test-video');
      expect(result.value.segments.length).toBeGreaterThan(0);
      expect(result.value.fullText).toBeTruthy();
    });

    it('returns error for video without transcript', async () => {
      const result = await client.fetchTranscript('no-transcript');
      expect(result.ok).toBe(false);
    });
  });
});
