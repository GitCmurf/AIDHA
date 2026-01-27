/**
 * Real YouTube client tests.
 *
 * Uses Innertube API (same approach as youtube-transcript-api).
 */
import { describe, it, expect } from 'vitest';
import { RealYouTubeClient } from '../src/client/youtube.js';

describe.skip('RealYouTubeClient (network)', () => {
  const client = new RealYouTubeClient();

  // Test video provided by user
  const TEST_VIDEO_ID = 'bY3ZMOn9mHQ';
  const TEST_VIDEO_URL = 'https://www.youtube.com/watch?v=bY3ZMOn9mHQ';

  describe('fetchVideo', () => {
    it('fetches video metadata from ID', async () => {
      const result = await client.fetchVideo(TEST_VIDEO_ID);
      expect(result.ok).toBe(true);
      if (!result.ok) return;

      expect(result.value.id).toBe(TEST_VIDEO_ID);
      expect(result.value.title).toContain('Math');
      expect(result.value.channelName).toBeTruthy();
    });

    it('fetches video metadata from URL', async () => {
      const result = await client.fetchVideo(TEST_VIDEO_URL);
      expect(result.ok).toBe(true);
      if (!result.ok) return;

      expect(result.value.id).toBe(TEST_VIDEO_ID);
    });

    it('returns error for non-existent video', async () => {
      const result = await client.fetchVideo('xxxxxxxxxxx');
      expect(result.ok).toBe(false);
    });
  });

  describe('fetchTranscript', () => {
    it('fetches transcript with segments via Innertube API', async () => {
      const result = await client.fetchTranscript(TEST_VIDEO_ID);
      expect(result.ok).toBe(true);
      if (!result.ok) return;

      expect(result.value.videoId).toBe(TEST_VIDEO_ID);
      expect(result.value.segments.length).toBeGreaterThan(100);
      expect(result.value.fullText).toContain('2 + 2');
      expect(result.value.language).toBe('en');
    });

    it('returns error for invalid video', async () => {
      const result = await client.fetchTranscript('xxxxxxxxxxx');
      expect(result.ok).toBe(false);
    });
  });

  describe('fetchVideoWithTranscript', () => {
    it('fetches both video and transcript together', async () => {
      const result = await client.fetchVideoWithTranscript(TEST_VIDEO_ID);
      expect(result.ok).toBe(true);
      if (!result.ok) return;

      expect(result.value.video.title).toContain('Math');
      expect(result.value.transcript).not.toBeNull();
      expect(result.value.transcript!.fullText.length).toBeGreaterThan(1000);
    });
  });
});
